import { TICKS_PER_WHOLE } from '@compiler/tables';
import { noiseHz } from '@spc/adsr';
import { type Resolver, choice, fixed, s8, ticks, u8 } from './param';
import { bpm, noteLengthName, panLabel, percentOf255 } from './units';

/** See `MAX_TEMPO` in `hex-params.ts`: the driver stores one more than you write. */
const MAX_TEMPO = 254;

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
 * The vibrato speed, which `$DE`'s readme entry calls a "Duration" and is not.
 *
 * The driver adds this byte to a phase accumulator once a tick
 * (`main.asm:3166-3169`), so it is a speed and bigger is faster. `p`'s own entry
 * gets it right — "the rate (speed)".
 */
const RATE = u8('Rate', 'rate', {
  min: 1,
  describe: (value) =>
    value === 0 ? 'a rate of 0 never advances, so the vibrato stays still' : 'higher is faster',
});

/**
 * `p` — `pRate,Extent` or `pDelay,Rate,Extent` (`parser.ts:1976-2035`).
 *
 * Adding a third argument moves the first one's meaning from rate to delay: the
 * same position says two different things depending on how many there are. That
 * is `p`'s own doing and not something the panel can smooth over, so it says so.
 */
const vibrato: Resolver = (command) =>
  command.args.length >= 3
    ? { params: [ticks('Delay'), RATE, u8('Depth', 'level')] }
    : {
        params: [RATE, u8('Depth', 'level')],
        note: 'With two arguments the first is the rate. Add a third and the first becomes a delay instead.',
      };

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
    note: 'The slider runs left to right; the byte counts the other way, 0 being hard right and 20 hard left.',
  };
};

/**
 * The denominators worth stopping on: every one that divides 192 evenly, so
 * every one that lands on a whole number of ticks, plus 128 to complete the
 * doubling. Between `l12` and `l192` there are 180 numbers that are not music,
 * and a slider that has to be dragged through them to reach `l16` is no use.
 */
const NOTE_DENOMINATORS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192] as const;

/** `l` — the length later notes fall back to (`parser.ts:1525-1552`). */
const defaultLength: Resolver = (command) => ({
  params: [
    u8('Length', 'index', {
      min: 1,
      max: TICKS_PER_WHOLE,
      stops: NOTE_DENOMINATORS,
      describe: (value) => {
        if (value < 1 || value > TICKS_PER_WHOLE) {
          return 'out of range, so the standing length is kept';
        }

        // parser.ts:1531 floors, so l128 and l192 both come to a single tick.
        const resolved = Math.floor(TICKS_PER_WHOLE / value);
        const named = noteLengthName(resolved);
        const rounded = TICKS_PER_WHOLE % value === 0 ? '' : ', rounded down';
        return `1/${value}${named ? ` — ${named}` : ''} · ${resolved} tick${resolved === 1 ? '' : 's'}${rounded}`;
      },
    }),
  ],
  note:
    command.target.amkVersion >= 4
      ? 'l=NN writes an exact tick count instead, and dots are allowed — both need #amk 4.'
      : undefined,
});

/**
 * A note or rest, whose arguments are the lengths of its tied segments.
 *
 * `c4^8` is one command with two of them, and the scanner has already worked out
 * what each comes to in ticks (`Command.noteLength`). So the row says the
 * denominator you wrote *and* the ticks it resolved to, which is the pair that
 * makes a tie legible — `c4^8` is 48 + 24, and nothing else on screen says so.
 *
 * The first segment may be absent (`c` alone takes the standing `l`), in which
 * case the command has no arguments and the table says so.
 */
const noteLength: Resolver = (command) => ({
  params: command.args.map((_argument, index) =>
    u8(index === 0 ? 'Length' : `Tied to`, 'index', {
      min: 1,
      max: TICKS_PER_WHOLE,
      stops: NOTE_DENOMINATORS,
      describe: (value) => {
        const resolved = command.noteLength?.[index]?.ticks;
        const named = resolved === undefined ? null : noteLengthName(resolved);
        return [
          `1/${value}`,
          named,
          resolved === undefined ? null : `${resolved} tick${resolved === 1 ? '' : 's'}`,
        ]
          .filter((part) => part !== null)
          .join(' · ');
      },
    }),
  ),
});

export const LETTER_PARAMS: Readonly<Record<string, Resolver>> = {
  t: (command) => {
    const target = u8('Tempo', 'rate', {
      // `parser.ts:1766` rejects a zero outright — AMK0079 — where the raw
      // `$E2 $00` it compiles to is legal and means the slowest tempo there is.
      min: 1,
      max: MAX_TEMPO,
      describe: (value) => `about ${bpm(value).toFixed(1)} BPM`,
    });

    // Confirmed against the emulator: the driver stores one more than the byte
    // written, so t253 is $FE, t254 is $FF, and t255 is $00 — at which the tick
    // accumulator can never carry and the song stops advancing entirely.
    const ceiling =
      'Stops at 254: the driver adds one, so t255 would be tempo 0 and the song would freeze.';

    return command.args.length >= 2
      ? {
          params: [ticks('Over'), target],
          note: `A tempo fade, which needs #amk 3 or above. ${ceiling}`,
        }
      : { params: [target], note: ceiling };
  },
  v: fadeable('Volume', percentOf255),
  w: fadeable('Global volume', percentOf255),
  y: pan,
  // `q` has a view of its own: two nibbles that mean two unrelated things, the
  // second read against a table the song chooses. See `quantization-command/`.
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
  // Notes and rests are commands too, and `gather` builds one for each. Without
  // an entry here every `c4` drew a row called "Argument 1" — a 0-255 number
  // field over a note length, next to a panel that knows exactly what it is.
  c: noteLength,
  d: noteLength,
  e: noteLength,
  f: noteLength,
  g: noteLength,
  a: noteLength,
  b: noteLength,
  r: noteLength,
  '^': noteLength,
  '[': fixed([u8('Repeats', 'index', { min: 1, describe: (n) => `plays ${n} times` })]),
  ']': fixed([u8('Repeats', 'index', { min: 1, describe: (n) => `plays ${n} times` })]),
  '*': fixed([
    u8('Repeats', 'index', { min: 1, describe: (n) => `replays the last loop ${n} times` }),
  ]),
};
