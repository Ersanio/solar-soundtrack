import { hex2 } from '../../../util/format';
import { type ParamDescriptor, type Resolver, choice, fixed, raw, s8, ticks, u8 } from './param';
import { bpm, noteName, panLabel, percentOf255 } from './units';

/**
 * What each hex command's arguments mean, `$DA` through `$FE`.
 *
 * Names follow `hex_command_reference.html` so that a reader with the readme
 * open sees the same words; where the readme is wrong or silent — `$DB`'s
 * range, `$F1`'s delay, the `$F5` coefficients' interaction — the note says what
 * the driver actually does and cites it.
 *
 * Nothing here states an argument *count*: `expectedArgs` owns that, and
 * `shapeOf` pads whatever this table is short of. A resolver may therefore
 * describe only the arguments it can name, which is what makes the
 * value-dependent forms below expressible at all.
 */

// ---------------------------------------------------------------------------
// Shared descriptors
// ---------------------------------------------------------------------------

const DURATION = ticks('Over', {
  describe: (value) =>
    value === 0 ? 'instant — a duration of 0 applies the target at once' : null,
});

const PAN = u8('Pan', 'pan', {
  max: 20,
  describe: (value) => {
    if (value > 0x14) {
      // main.asm:3486 — `PanValues` has 21 entries, and the readme's own $13
      // ceiling is one short of the table it describes.
      return `past the driver's 21-entry pan table, which ends at $14`;
    }

    return panLabel(value);
  },
});

const ECHO_VOLUME = (side: string): ParamDescriptor =>
  s8(`Volume ${side}`, 'level', {
    describe: (value) => (value >= 0x80 ? 'negative, so this side is phase-inverted' : null),
  });

const SEMITONES = s8('Semitones', 'semitones', {
  describe: (value) => (value >= 0x80 ? 'bends downward' : 'bends upward'),
});

/** `$F4`'s sub-commands, every one the readme documents. */
const F4_SUBCOMMANDS = [
  { value: 0x00, label: '$00 — Yoshi drums on channel 5' },
  { value: 0x01, label: '$01 — legato toggle' },
  { value: 0x02, label: '$02 — light staccato toggle' },
  { value: 0x03, label: '$03 — echo toggle for this channel' },
  { value: 0x05, label: '$05 — SNES sync' },
  { value: 0x06, label: '$06 — Yoshi drums on this channel' },
  { value: 0x07, label: '$07 — tempo hike off' },
  { value: 0x08, label: '$08 — switch velocity table' },
  { value: 0x09, label: '$09 — restore instrument' },
] as const;

/** `$FA`'s sub-commands. `$05` is an error at `#amk 2`+ (`parser.ts:3047`). */
const FA_SUBCOMMANDS = [
  { value: 0x00, label: '$00 — pitch modulation' },
  { value: 0x01, label: '$01 — GAIN' },
  { value: 0x02, label: '$02 — semitone tune' },
  { value: 0x03, label: '$03 — amplify' },
  { value: 0x04, label: '$04 — echo buffer reserve' },
  { value: 0x7f, label: '$7F — hot patch preset' },
  { value: 0xfe, label: '$FE — hot patch toggle bits' },
] as const;

const HOT_PATCH_PRESETS = [
  { value: 0x00, label: '$00 — AddmusicK 1.0.8 and earlier' },
  { value: 0x01, label: '$01 — AddmusicK 1.0.9' },
  { value: 0x02, label: '$02 — AddmusicK Beta' },
  { value: 0x03, label: "$03 — Romi's Addmusic404" },
  { value: 0x04, label: '$04 — Addmusic405' },
  { value: 0x05, label: '$05 — AddmusicM' },
  { value: 0x06, label: "$06 — carol's MORE.bin" },
  { value: 0x07, label: '$07 — Vanilla SMW' },
] as const;

const ARPEGGIO_MODES = [
  { value: 0x00, label: '$00 — off' },
  { value: 0x80, label: '$80 — trill (two notes)' },
  { value: 0x81, label: '$81 — glissando' },
] as const;

/** `$FC`'s event types, from the syntax reference's remote-code entry. */
const REMOTE_TYPES = [
  { value: 0, label: '0 — cancel any remote code' },
  { value: 1, label: '1 — run after a set time' },
  { value: 2, label: '2 — run before a note ends' },
  { value: 3, label: '3 — run on key-off' },
  { value: 4, label: '4 — run on key-on' },
  { value: 5, label: '5 — run before a note, after key-on' },
  { value: 6, label: '6 — run on key-off, before the next note' },
] as const;

// ---------------------------------------------------------------------------
// The value-dependent forms
// ---------------------------------------------------------------------------

/**
 * `$E6` is two commands sharing a byte: `$00` opens a subloop, anything else
 * closes one and repeats it `n + 1` times (`parser.ts:3148-3164`).
 */
const subloop: Resolver = (command) => {
  const value = command.args[0]?.value;
  if (value === 0) {
    return {
      params: [choice('Subloop', [{ value: 0x00, label: '$00 — start' }], { structural: true })],
      note: 'Opens a subloop. The matching $E6 with a non-zero count closes it.',
    };
  }

  return {
    params: [
      u8('Repeat count', 'index', {
        min: 1,
        structural: true,
        describe: (n) => `plays the subloop ${n + 1} times — the byte is one less than the count`,
      }),
    ],
    note: 'Closes the subloop opened by the nearest earlier $E6 $00.',
  };
};

/**
 * `$ED` is ADSR, GAIN, or — under `#am4` — HFD's escape into four other
 * commands entirely (`parser.ts:3286`).
 */
const envelope: Resolver = (command) => {
  const sub = command.args[0]?.value;

  if (command.target.program === 1 && sub !== undefined && sub >= 0x80 && sub <= 0x83) {
    const form = choice(
      'HFD form',
      [
        { value: 0x80, label: '$80 — DSP write' },
        { value: 0x81, label: '$81 — semitone tune' },
        { value: 0x82, label: '$82 — ARAM upload' },
        { value: 0x83, label: '$83 — not implemented' },
      ],
      { structural: true },
    );

    if (sub === 0x80) {
      return {
        params: [form, u8('DSP register', 'address'), u8('Value', 'opaque')],
        note: 'Addmusic 4.05 wrote DSP registers through $ED. AddmusicK compiles this to $F6.',
      };
    }

    if (sub === 0x81) {
      return {
        params: [form, s8('Semitones', 'semitones')],
        note: 'Addmusic 4.05’s tune command. AddmusicK compiles this to $FA $02.',
      };
    }

    if (sub === 0x82) {
      return {
        params: [
          form,
          u8('Address, high', 'address'),
          u8('Address, low', 'address'),
          u8('Count, high', 'index', { structural: true }),
          u8('Count, low', 'index', { structural: true }),
        ],
        note: 'An ARAM upload: the two count bytes decide how many of the bytes after it belong to this command.',
      };
    }

    return { params: [form], note: 'AMK0163 — this form was never implemented.' };
  }

  if (sub !== undefined && (sub & 0x80) !== 0) {
    return {
      params: [
        choice('Mode', [{ value: 0x80, label: '$80 — GAIN' }], { structural: true }),
        u8('GAIN', 'rate'),
      ],
    };
  }

  return {
    params: [
      u8('ADSR1', 'rate', {
        max: 0x7f,
        describe: (value) => `decay ${(value >> 4) & 0x07}, attack ${value & 0x0f}`,
      }),
      u8('ADSR2', 'rate', {
        describe: (value) => `sustain ${(value >> 5) & 0x07}, release ${value & 0x1f}`,
      }),
    ],
  };
};

/** `#am4`'s `$E5` is tremolo, unless its first byte has the high bit — then a sample load. */
const tremolo: Resolver = (command) => {
  const first = command.args[0]?.value ?? 0;
  if (command.target.program === 1 && first >= 0x80) {
    return {
      params: [
        u8('Sample', 'srcn', {
          min: 0x80,
          structural: true,
          describe: (value) =>
            `sample $${hex2(value - 0x80)} — the high bit is what selects this form`,
        }),
        u8('Multiplication pitch', 'opaque'),
      ],
      note: 'Addmusic 4.05 overloaded $E5: a high first byte is a sample load, and AddmusicK compiles it to $F3.',
    };
  }

  return {
    params: [ticks('Delay'), ticks('Duration'), u8('Amplitude', 'level')],
  };
};

/**
 * `$FB`'s first byte is a count, and everything after the duration is a note in
 * the sequence — so the descriptor list grows with the command.
 */
const arpeggio: Resolver = (command) => {
  const count = command.args[0]?.value;

  if (count === 0x80 || count === 0x81) {
    return {
      params: [
        choice('Mode', ARPEGGIO_MODES, { structural: true }),
        ticks('Note duration'),
        s8(count === 0x80 ? 'Pitch change' : 'Semitones per step', 'semitones'),
      ],
    };
  }

  // `expectedArgs` gives `count + 2` arguments in total — the count, the
  // duration, and then exactly `count` notes.
  const notes: ParamDescriptor[] = [];
  for (let i = 0; i < Math.max(0, count ?? 0); i++) {
    notes.push(
      s8(`Note ${i + 1}`, 'semitones', {
        describe: (value) =>
          value === 0x80
            ? 'a loop point — the sequence restarts here'
            : 'semitones from the played note',
      }),
    );
  }

  return {
    params: [
      // A count, not a mode: `$80` and `$81` are the two values that mean
      // something else, and this arm has already ruled them out. Still a number
      // field rather than a slider, because dragging it would reinterpret the
      // notes after it as music at every value on the way past.
      u8('Notes in the sequence', 'index', {
        max: 0x7f,
        structural: true,
        describe: (value) =>
          value === 0
            ? 'arpeggio off'
            : `${value} note${value === 1 ? '' : 's'} follow the duration`,
      }),
      ticks('Note duration'),
      ...notes,
    ],
  };
};

/** `$FA` picks a different command per sub-byte. */
const misc: Resolver = (command) => {
  const sub = command.args[0]?.value;
  const selector = choice('Sub-command', FA_SUBCOMMANDS, { structural: true });

  switch (sub) {
    case 0x00:
      return {
        params: [
          selector,
          u8('Channels', 'channelMask', {
            control: 'toggles',
            describe: () => 'channel 0 cannot have pitch modulation',
          }),
        ],
      };
    case 0x01:
      return { params: [selector, u8('GAIN', 'rate')] };
    case 0x02:
      return { params: [selector, s8('Semitones', 'semitones')] };
    case 0x03:
      return {
        params: [
          selector,
          u8('Multiplier', 'level', {
            describe: (value) =>
              `volume × ${((value + 1) / 256).toFixed(3)} + 1 — $FF is just shy of double`,
          }),
        ],
      };
    case 0x04:
      return {
        params: [selector, u8('Largest delay', 'index', { max: 0x0f })],
        note: 'Inserted by the compiler at the start of every song; there is rarely a reason to write it by hand.',
      };
    case 0x7f:
      return { params: [selector, choice('Preset', HOT_PATCH_PRESETS)] };
    case 0xfe:
      return {
        params: [
          selector,
          u8('Bits', 'opaque', {
            control: 'toggles',
            structural: true,
            describe: (value) =>
              (value & 0x80) !== 0 ? 'the high bit defines a further byte of bits' : null,
          }),
        ],
      };
    default:
      return { params: [selector] };
  }
};

/** `#amk 1`'s `$FC` is remote *gain* — two arguments, not four (`parser.ts:2970`). */
const remote: Resolver = (command) => {
  if (command.target.amkVersion === 1) {
    return {
      params: [u8('GAIN', 'rate'), ticks('Delay')],
      note: 'Under #amk 1 this is remote gain, which the compiler rebuilds into a five-byte remote-code event.',
    };
  }

  return {
    params: [
      u8('Address, low', 'address', { control: 'readonly' }),
      u8('Address, high', 'address', { control: 'readonly' }),
      choice('Event type', REMOTE_TYPES),
      ticks('Wait', { describe: (value) => (value === 0 ? '$00 is treated as $0100' : null) }),
    ],
    note: 'The address is written by the compiler from a (!n) label; editing it by hand points the driver at nothing.',
  };
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const HEX_PARAMS: Readonly<Record<number, Resolver>> = {
  0xda: fixed([u8('Instrument', 'index')]),
  0xdb: fixed([PAN], 'Bits 6 and 7 enable surround for the right and left speaker.'),
  0xdc: fixed([DURATION, PAN]),
  0xdd: fixed([
    ticks('Delay'),
    ticks('Duration'),
    u8('Target note', 'note', { min: 0x80, max: 0xc5, describe: (value) => noteName(value) }),
  ]),
  0xde: fixed([ticks('Delay'), ticks('Duration'), u8('Amplitude', 'level')]),
  0xdf: fixed([]),
  0xe0: fixed([u8('Global volume', 'level', { describe: percentOf255 })]),
  0xe1: fixed([DURATION, u8('Global volume', 'level', { describe: percentOf255 })]),
  0xe2: fixed([
    u8('Tempo', 'rate', {
      min: 1,
      describe: (value) =>
        `about ${bpm(value).toFixed(1)} BPM — estimated; the driver drops ticks when it is busy`,
    }),
  ]),
  0xe3: fixed([
    DURATION,
    u8('Tempo', 'rate', { min: 1, describe: (value) => `about ${bpm(value).toFixed(1)} BPM` }),
  ]),
  0xe4: fixed([SEMITONES]),
  0xe5: tremolo,
  0xe6: subloop,
  0xe7: fixed([u8('Volume', 'level', { describe: percentOf255 })]),
  0xe8: fixed([DURATION, u8('Volume', 'level', { describe: percentOf255 })]),
  0xe9: fixed(
    [
      u8('Loop point, low', 'address', { control: 'readonly' }),
      u8('Loop point, high', 'address', { control: 'readonly' }),
      u8('Loop count', 'index'),
    ],
    'Written by the compiler from a [ ] loop. The readme says outright: do not use manually.',
  ),
  0xea: fixed([DURATION], 'Fades to the amplitude the last $DE set.'),
  0xeb: fixed([ticks('Delay'), ticks('Duration'), SEMITONES]),
  0xec: fixed([ticks('Delay'), ticks('Duration'), SEMITONES]),
  0xed: envelope,
  0xee: fixed([s8('Tuning', 'semitones')]),
  0xef: fixed([
    u8('Channels', 'channelMask', { control: 'toggles' }),
    ECHO_VOLUME('L'),
    ECHO_VOLUME('R'),
  ]),
  0xf0: fixed([]),
  0xf1: fixed([
    u8('Delay', 'index', {
      max: 0x0f,
      describe: (value) => {
        const masked = value & 0x0f;
        if (value > 0x0f) {
          // main.asm:2606 masks it, so an out-of-range value wraps in silence.
          return `$${hex2(value)} is out of range; the driver masks it to $${hex2(masked)}`;
        }

        return `${masked * 16} ms — ${masked * 2} KiB of ARAM reserved for the buffer`;
      },
    }),
    s8('Feedback', 'level', {
      describe: (value) =>
        value === 0
          ? 'no feedback — the echo plays once'
          : 'each repeat is this fraction of the last',
    }),
    choice('Filter', [
      { value: 0, label: '0 — SMW low-pass' },
      { value: 1, label: '1 — flat' },
    ]),
  ]),
  0xf2: fixed([DURATION, ECHO_VOLUME('L'), ECHO_VOLUME('R')]),
  0xf3: fixed([u8('Sample', 'srcn'), u8('Multiplication pitch', 'opaque')]),
  0xf4: fixed([choice('Sub-command', F4_SUBCOMMANDS, { structural: true })]),
  0xf5: fixed(
    Array.from({ length: 8 }, (_, i) => s8(`Coefficient ${i + 1}`, 'level')),
    'C7 multiplies the newest sample and C0 the oldest.',
  ),
  0xf6: fixed([u8('DSP register', 'address'), u8('Value', 'opaque')]),
  0xf7: fixed(
    [raw('Address, low'), raw('Address, high'), raw('Value')],
    'AddmusicM’s write-byte command.',
  ),
  0xf8: fixed([u8('Noise clock', 'rate', { max: 0x1f })]),
  0xf9: fixed(
    [raw('First byte'), raw('Second byte')],
    'Sent to the SNES side; what it means is the patch’s business.',
  ),
  0xfa: misc,
  0xfb: arpeggio,
  0xfc: remote,
  0xfd: fixed([]),
  0xfe: fixed([]),
};
