import {
  NOTE_DURATIONS,
  NSPC_VELOCITY_OFFSET,
  TICKS_PER_WHOLE,
  VELOCITY_VALUES,
} from '@compiler/tables';
import { noiseHz } from '@spc/adsr';
import { hex2 } from '../../../util/format';
import { type Resolver, choice, fixed, s8, ticks, u8 } from './param';
import { bpm, panLabel, percentOf255 } from './units';

/**
 * What each single-letter command's arguments mean.
 *
 * The comma forms (`w40,180`, `v20,255`, `t30,80`) are `#amk 3` and above
 * (`parser.ts:1596`, `parser.ts:1740`), and the parser reads the *first* number
 * as the duration when there are two — so the descriptor list has to be chosen
 * by how many arguments were written, not by the letter alone.
 */

/** `v`, `w` and `t`: one argument sets, two fade. `parser.ts:1553-1610`, `1724-1760`. */
function fadeable(name: string, describe: (value: number) => string | null): Resolver {
  return (command) => {
    const target = u8(name, 'level', { describe });
    if (command.args.length < 2) {
      return { params: [target] };
    }

    return {
      params: [ticks('Over'), target],
      note: 'Two arguments make this a fade, which needs #amk 3 or above.',
    };
  };
}

/**
 * `q` — the one command whose readme entry is wrong.
 *
 * The readme calls the high nibble "how long of a delay there is between each
 * note". The driver (`main.asm:2365-2379`) masks it to three bits, indexes
 * `NoteDurations`, and multiplies the note's own duration by the result before
 * taking the high byte: it is a *gate time in 256ths of the note*, so the delay
 * is trailing silence proportional to how long the note is, not a fixed count.
 * `aram_map.html:666` says so — "quantization, which is in 256ths of a note".
 *
 * The low nibble is an index into one of two velocity tables, not a volume, and
 * which table is live is a property of the song: `#amk 2` moved the default from
 * SMW's to N-SPC's, and `#option smwvtable` / `nspcvtable` switch it mid-file.
 */
const quantization: Resolver = (command) => {
  // `parser.ts:415` — the positional half of the answer, the `#option` half
  // being a later refinement. `#am4` and `#amm` both report amkVersion 0.
  const nspc = command.target.program === 0 && command.target.amkVersion >= 2;
  const table = nspc ? 'N-SPC' : 'SMW';

  return {
    params: [
      u8('Quantization', 'index', {
        min: 0x01,
        max: 0x7f,
        describe: (value) => {
          const gate = NOTE_DURATIONS[(value >> 4) & 0x07];
          const velocity = VELOCITY_VALUES[(value & 0x0f) + (nspc ? NSPC_VELOCITY_OFFSET : 0)];
          const percent = Math.round((gate / 256) * 100);
          return `plays for ${percent}% of the note ($${hex2(gate)}), at velocity $${hex2(velocity)} of the ${table} table`;
        },
      }),
    ],
    note: `The first digit is a gate time in 256ths of the note, not a fixed delay; the second indexes the ${table} velocity table.`,
  };
};

/** `p` — `pRate,Extent` or `pDelay,Rate,Extent` (`parser.ts:1976-2035`). */
const vibrato: Resolver = (command) =>
  command.args.length >= 3
    ? { params: [ticks('Delay'), ticks('Rate'), u8('Extent', 'level')] }
    : { params: [ticks('Rate'), u8('Extent', 'level')] };

/** `y` — pan, then up to two surround flags (`parser.ts:1642-1689`). */
const pan: Resolver = (command) => {
  const surround = [
    choice('Surround, left', [
      { value: 0, label: 'off' },
      { value: 1, label: 'on' },
    ]),
    choice('Surround, right', [
      { value: 0, label: 'off' },
      { value: 1, label: 'on' },
    ]),
  ];

  return {
    params: [
      u8('Pan', 'pan', { max: 20, describe: panLabel }),
      ...surround.slice(0, Math.max(0, command.args.length - 1)),
    ],
    note: '0 is hard right and 20 is hard left, which is the opposite way round from most pan controls.',
  };
};

/** `l` — the length later notes fall back to (`parser.ts:1525-1552`). */
const defaultLength: Resolver = (command) => ({
  params: [
    u8('Denominator', 'index', {
      min: 1,
      max: TICKS_PER_WHOLE,
      describe: (value) => {
        if (value < 1 || value > TICKS_PER_WHOLE) {
          return 'out of range, so the standing length is kept';
        }

        const resolved = Math.floor(TICKS_PER_WHOLE / value);
        return `1/${value} — ${resolved} tick${resolved === 1 ? '' : 's'}`;
      },
    }),
  ],
  note:
    command.target.amkVersion >= 4
      ? 'l=NN writes an exact tick count instead, and dots are allowed — both need #amk 4.'
      : undefined,
});

export const LETTER_PARAMS: Readonly<Record<string, Resolver>> = {
  t: (command) => {
    const target = u8('Tempo', 'rate', {
      min: 1,
      describe: (value) => `about ${bpm(value).toFixed(1)} BPM`,
    });

    return command.args.length >= 2
      ? { params: [ticks('Over'), target], note: 'A tempo fade, which needs #amk 3 or above.' }
      : { params: [target] };
  },
  v: fadeable('Volume', percentOf255),
  w: fadeable('Global volume', percentOf255),
  y: pan,
  q: quantization,
  l: defaultLength,
  o: fixed([u8('Octave', 'index', { min: 0, max: 6 })]),
  '@': fixed([u8('Instrument', 'index')]),
  h: fixed([s8('Transpose', 'semitones', { min: -128, max: 127 })]),
  n: fixed(
    [
      u8('Noise clock', 'rate', {
        max: 0x1f,
        describe: (value) =>
          value === 0 ? 'silent' : `${Math.round(noiseHz(value)).toLocaleString()} Hz`,
      }),
    ],
    // One DSP register drives every voice's noise (`main.asm:2552` ModifyNoise),
    // so this is not a per-channel setting even though it is written on one.
    'Replaces the instrument’s sample until the next instrument change. One register serves every channel, so a later n retunes this one too.',
  ),
  p: vibrato,
  '[': fixed([u8('Repeats', 'index', { min: 1, describe: (n) => `plays ${n} times` })]),
  ']': fixed([u8('Repeats', 'index', { min: 1, describe: (n) => `plays ${n} times` })]),
  '*': fixed([
    u8('Repeats', 'index', { min: 1, describe: (n) => `replays the last loop ${n} times` }),
  ]),
};
