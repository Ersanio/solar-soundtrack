/**
 * What the palette offers, and what each entry writes.
 *
 * Names are never restated here - they come from `vcmdName` / `LETTER_NAMES` at
 * render time, so an entry follows the dialect for free and cannot drift from
 * the inspector beside it. Neither is arity: an entry carries the argument bytes
 * it wants, and `palettetest` checks that count against `expectedArgs` at every
 * dialect rather than this file claiming one.
 *
 * **The catalogue offers the spelling a person writes.** Thirteen hex commands
 * have no entry because a letter or bracket form writes them - `t144` is `$E2`,
 * `[ ]4` is `$E9`, `(!1,1,24)` is `$FC`. `palettetest`'s `SUPERSEDED` table
 * names every one and proves the claim against the compiler rather than
 * asserting it, so the palette still covers all of `$DA`-`$FE` and a new VCMD
 * still fails the suite until it has a button.
 *
 * The defaults are chosen to be in range, musically neutral and safe to click
 * mid-playback - `$F1`'s feedback is zero and `$F5` is SMW's own filter, because
 * both of those feed `runaway-guard.ts`.
 */

import { hex2 } from '@amk/core/hex';
import { type CommandTarget, expectedArgs, LETTER_NAMES, vcmdName } from '@amk/tokens';
import {
  type Availability,
  type PaletteForm,
  type SyntaxForm,
  formAvailability,
} from '@amk/tokens/commands/availability';
import type { CommandGlyph } from './command-icon';
import type { WrapKind, WrapVerdict } from './loop-wrap';

export type Category = 'notes' | 'volume' | 'pitch' | 'instrument' | 'echo' | 'loops' | 'misc';

/**
 * Offsets inside a snippet, not into the document - deliberately not `Span`,
 * which carries a line number this side of the insert cannot know.
 */
export interface TextRange {
  start: number;
  end: number;
}

export interface CategoryDef {
  id: Category;
  label: string;
}

export const CATEGORIES: readonly CategoryDef[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'volume', label: 'Volume' },
  { id: 'pitch', label: 'Pitch' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'echo', label: 'Echo' },
  { id: 'loops', label: 'Loops' },
  { id: 'misc', label: 'Misc' },
];

/** What every entry says regardless of how it is spelled. */
interface Described {
  category: Category;
  icon: CommandGlyph;
  /**
   * One sentence, for someone who reads music rather than `Music.cpp`: what you
   * would *hear*, with no byte counts, argument names or AddmusicK jargon. It is
   * the whole of the hover text and the whole of the line under the strip.
   */
  blurb: string;
}

interface HexEntry extends Described {
  kind: 'hex';
  vcmd: number;
  /** The bytes after the command byte, in order. */
  args: readonly number[];
  /**
   * What to know before writing the byte that no diagnostic will tell you.
   *
   * `availability` answers to AddmusicK, and `palettetest` holds it to that: a
   * `caution` has to produce a warning and an `ok` has to compile silently.
   * Neither fits a byte that compiles clean and jumps the SPC into the direct
   * page, nor one the dialect rewrites without a word, so those are said here.
   *
   * Only those. It costs the button its ordinary colour, which is worth a
   * crashed SPC and not worth a note about which of two spellings a dialect
   * takes - that is the palette's job to know and nobody else's to read.
   */
  caveat?: (target: CommandTarget) => string | undefined;
  /**
   * A name for the button, where `VCMD_NAMES`' is not one.
   *
   * It calls both `$EF` and `$F1` "echo parameters", which is true - they are
   * two halves of one setting - and on a button that does not show the byte
   * leaves two identical labels, so these two say which half they are instead.
   */
  label?: string;
  /**
   * Distinguishes two buttons that write the same byte, and is required of them.
   *
   * `$ED` is the only one: its first argument's top bit picks ADSR or GAIN, two
   * envelopes that share nothing but an opcode, and one button that wrote
   * whichever the default happened to be was a button for neither.
   */
  id?: string;
}

/**
 * An entry that puts brackets round the notes the porter picked out rather than
 * dropping its snippet at a point. `loop-wrap.ts` is what it writes and why.
 *
 * {@link LetterEntry.snippet} stays the standalone spelling — it is what
 * `palettetest` compiles the entry as, and it is the same construct a wrap
 * writes with its body left out.
 */
interface Wrapping {
  wraps?: WrapKind;
}

interface LetterEntry extends Described, Wrapping {
  kind: 'letter';
  /** The letter, which is also its key into `LETTER_NAMES` and `LETTER_PARAMS`. */
  id: string;
  snippet: string;
  /**
   * A name for the button, where `LETTER_NAMES`' is not one — as
   * {@link HexEntry.label} is for a byte.
   *
   * `[` is the only one. It writes both brackets, so "loop start" names half of
   * what the button does, and there is no `]` button beside it for the other
   * half to belong to.
   */
  label?: string;
  /**
   * The VCMD this spelling compiles to, where it compiles to one.
   *
   * Thirteen bytes have no button because a letter or bracket writes them, and
   * this is that claim - `palettetest` compiles both spellings and compares the
   * output byte for byte rather than taking it on trust. It is also how a
   * command read back out of a song finds its glyph: the roll meets `$E7` and
   * has to draw `v`'s speaker.
   */
  writes?: number;
}

interface SyntaxEntry extends Described, Wrapping {
  kind: 'syntax';
  id: string;
  /** As {@link LetterEntry.writes}. */
  writes?: number;
  /** Said in full, since no name table has a word for a spelling. */
  label: string;
  snippet: string;
  /** Which version rule governs it, or `null` when no dialect gates the form. */
  syntax: SyntaxForm | null;
  /**
   * The arguments to write as raw hex where the dialect refuses the spelling.
   *
   * Nothing here states arity: `expectedArgs` does, and its answer is also the
   * test for whether the fallback applies at all, since a byte that takes a
   * different number of arguments under a dialect is a different command there.
   */
  fallback?: readonly number[];
  /**
   * The command byte {@link fallback} writes, where {@link writes} is not it.
   *
   * `(!!n)` and `(!n,` are both `$FC`, and only one spelling may claim a byte -
   * `byWrites` and `palettetest` both read that claim, and the call is what a
   * `$FC` in a song usually is.
   */
  fallbackOf?: number;
  /**
   * Where in the song it is legal, when that is not everywhere. The two remote
   * forms are the only entries with an opinion, and it is `parseOpenParen`'s:
   * a definition has to precede every channel, and the reset form is a call, so
   * it has to follow one.
   */
  context?: 'before-channels' | 'channel';
}

type Entry = HexEntry | LetterEntry | SyntaxEntry;

const hex = (
  vcmd: number,
  args: readonly number[],
  rest: Omit<HexEntry, 'kind' | 'vcmd' | 'args'>,
): HexEntry => ({ kind: 'hex', vcmd, args, ...rest });

const letter = (
  id: string,
  snippet: string,
  rest: Described & { writes?: number; wraps?: WrapKind; label?: string },
): LetterEntry => ({
  kind: 'letter',
  id,
  snippet,
  ...rest,
});

/**
 * The catalogue, in the order the buttons appear.
 *
 * `$E5`'s first byte stays under `$80` and `$ED`'s outside `$80`-`$83` so that
 * under `#am4` neither default quietly becomes the sample-load or HFD form
 * (`parser.ts:parseHexCommand`, `parseHFDHex`).
 */
export const ENTRIES: readonly Entry[] = [
  // ─── Notes and timing ───────────────────────────────────────────────────
  letter('l', 'l8', {
    category: 'notes',
    icon: 'note',
    blurb: 'The default length notes take when you do not write one on them.',
  }),
  {
    kind: 'syntax',
    category: 'notes',
    id: 'l=',
    icon: 'noteTicks',
    label: 'default length, in ticks',
    blurb: 'Sets the default note length as an exact number of ticks.',
    snippet: 'l=48',
    syntax: 'exactLength',
  },
  letter('o', 'o4', {
    category: 'notes',
    icon: 'octave',
    blurb: 'Which octave the notes after it are played in.',
  }),
  letter('<', '<', {
    category: 'notes',
    icon: 'octaveDown',
    blurb: 'Drops everything after it by one octave.',
  }),
  letter('>', '>', {
    category: 'notes',
    icon: 'octaveUp',
    blurb: 'Lifts everything after it by one octave.',
  }),
  letter('q', 'q7f', {
    category: 'notes',
    icon: 'staccato',
    blurb: 'How much of each note actually sounds before it is cut short.',
  }),
  letter('t', 't144', {
    category: 'notes',
    writes: 0xe2,
    icon: 'metronome',
    blurb: 'How fast the song plays.',
  }),
  {
    kind: 'syntax',
    category: 'notes',
    id: 't,',
    writes: 0xe3,
    icon: 'metronomeFade',
    label: 'tempo fade',
    blurb: 'Slides the tempo to a new speed over time - an accelerando or a ritardando.',
    snippet: 't18,144',
    syntax: 'fade',
    fallback: [0x12, 0x90],
  },

  // ─── Volume and pan ─────────────────────────────────────────────────────
  letter('v', 'v200', {
    category: 'volume',
    writes: 0xe7,
    icon: 'speaker',
    blurb: 'How loud this channel plays.',
  }),
  {
    kind: 'syntax',
    category: 'volume',
    id: 'v,',
    writes: 0xe8,
    icon: 'hairpin',
    label: 'volume fade',
    blurb: "Slides this channel's volume over time - a crescendo or a diminuendo.",
    snippet: 'v18,200',
    syntax: 'fade',
    fallback: [0x12, 0xc8],
  },
  letter('w', 'w200', {
    category: 'volume',
    writes: 0xe0,
    icon: 'speakerMaster',
    blurb: 'How loud the whole song plays, every channel at once.',
  }),
  {
    kind: 'syntax',
    category: 'volume',
    id: 'w,',
    writes: 0xe1,
    icon: 'hairpinMaster',
    label: 'global volume fade',
    blurb: 'Slides the whole song louder or quieter over time - a fade-in or a fade-out.',
    snippet: 'w18,200',
    syntax: 'fade',
    fallback: [0x12, 0xc8],
  },
  letter('y', 'y10', {
    category: 'volume',
    writes: 0xdb,
    icon: 'pan',
    blurb: 'Where this channel sits between the left and right speakers.',
  }),
  hex(0xdc, [0x18, 0x0a], {
    category: 'volume',
    icon: 'panFade',
    blurb: 'Slides this channel across the stereo field over time.',
  }),
  hex(0xe5, [0x00, 0x12, 0x08], {
    category: 'volume',
    icon: 'tremolo',
    blurb: 'A steady wobble in volume; the sound pulses without changing pitch.',
  }),
  hex(0xfd, [], {
    category: 'volume',
    icon: 'tremoloOff',
    blurb: 'Stops the volume wobble and holds the note steady.',
  }),

  // ─── Pitch ──────────────────────────────────────────────────────────────
  letter('h', 'h0', {
    category: 'pitch',
    icon: 'sharp',
    blurb: 'Shifts every note written after it up or down by a number of semitones.',
  }),
  letter('p', 'p12,8', {
    category: 'pitch',
    writes: 0xde,
    icon: 'wave',
    blurb: 'A steady wobble in pitch.',
  }),
  hex(0xdf, [], {
    category: 'pitch',
    icon: 'waveOff',
    blurb: 'Stops the pitch wobble and holds the note still.',
  }),
  hex(0xea, [0x18], {
    category: 'pitch',
    icon: 'waveFade',
    blurb: 'Eases the vibrato in or out instead of switching it on at full depth.',
  }),
  hex(0xdd, [0x00, 0x18, 0xa4], {
    category: 'pitch',
    icon: 'slide',
    blurb: 'Slides smoothly from the note playing now to another one.',
    // main.asm:3256-3287 — the per-tick read-ahead peeks for $DD and swallows
    // all four bytes, and its dispatch slot is $0000 for anything the command
    // loop reaches first.
    caveat: () =>
      'Write it directly after a note of two ticks or more. Anywhere else the driver jumps to address zero and the SPC dies.',
  }),
  hex(0xec, [0x00, 0x18, 0x02], {
    category: 'pitch',
    icon: 'envelopeUp',
    blurb: 'Starts the note flat and bends it up into tune - a scoop into the pitch.',
  }),
  hex(0xeb, [0x00, 0x18, 0x02], {
    category: 'pitch',
    icon: 'envelopeDown',
    blurb: 'Lets the note fall away in pitch as it ends - a drop or a doit.',
  }),
  hex(0xfe, [], {
    category: 'pitch',
    icon: 'envelopeOff',
    blurb: 'Stops notes bending into or out of tune.',
  }),
  hex(0xe4, [0x00], {
    category: 'pitch',
    icon: 'sharpMaster',
    blurb: 'Shifts every channel at once up or down by a number of semitones.',
    // `parser.ts:parseHexCommand` (Music.cpp:1863) — Addmusic 4.05 stored one
    // more than was written, and AddmusicK reproduces it in silence. Below
    // `$F2`, so the non-native warning never covers it either.
    caveat: (target) =>
      target.program === 1
        ? 'Under #am4 the compiler adds one, so the transpose lands a semitone above what is written.'
        : undefined,
  }),
  hex(0xee, [0x00], {
    category: 'pitch',
    icon: 'tuningFork',
    blurb: 'Nudges the pitch by a fraction of a semitone, for detuning against another channel.',
  }),
  hex(0xfb, [0x02, 0x06, 0xa4, 0xa7], {
    category: 'pitch',
    icon: 'arpeggio',
    blurb: 'Cycles quickly through a set of notes.',
  }),

  // ─── Instrument ─────────────────────────────────────────────────────────
  letter('@', '@0', {
    category: 'instrument',
    writes: 0xda,
    icon: 'keys',
    blurb: 'Which instrument this channel plays.',
  }),
  letter('n', 'n10', {
    category: 'instrument',
    writes: 0xf8,
    icon: 'noise',
    blurb: 'Swaps the instrument for white noise.',
  }),
  hex(0xed, [0x3f, 0x4d], {
    id: 'adsr',
    category: 'instrument',
    icon: 'adsr',
    label: 'ADSR',
    blurb: 'How a note swells and dies away: attack, decay, sustain, release.',
  }),
  hex(0xed, [0x8e, 0x7f], {
    id: 'gain',
    category: 'instrument',
    icon: 'gain',
    label: 'GAIN',
    blurb: 'Drives the note’s loudness directly instead, holding or sliding it to a level.',
  }),
  hex(0xf3, [0x00, 0x04], {
    category: 'instrument',
    icon: 'sample',
    blurb: 'Swaps the sample and coarse tuning without touching how the note swells.',
  }),

  // ─── Echo ───────────────────────────────────────────────────────────────
  hex(0xef, [0xff, 0x28, 0x28], {
    category: 'echo',
    icon: 'echo',
    label: 'echo channels & volume',
    blurb: 'Adds delayed copies of the sound behind the music - a reverb.',
  }),
  hex(0xf1, [0x02, 0x00, 0x00], {
    category: 'echo',
    icon: 'echoDelay',
    label: 'echo delay & feedback',
    blurb: 'How far behind the echo sits, how much of it feeds back, and which filter shapes it.',
  }),
  hex(0xf2, [0x18, 0x28, 0x28], {
    category: 'echo',
    icon: 'echoFade',
    blurb: 'Fades the echo up or down over time without touching the music in front of it.',
  }),
  hex(0xf0, [], {
    category: 'echo',
    icon: 'echoOff',
    blurb: 'Turns the echo off and leaves the music dry.',
  }),
  hex(0xf5, [0xff, 0x08, 0x17, 0x24, 0x24, 0x17, 0x08, 0xff], {
    category: 'echo',
    icon: 'filter',
    blurb: 'Shapes the tone of the echo: how bright or muffled the repeats sound.',
  }),

  // ─── Loops ──────────────────────────────────────────────────────────────
  // The two bracket forms go round the notes the porter picked out rather than
  // landing at a point, so both are greyed until something is selected, and `*`
  // still inserts, having no run to wrap.
  //
  // There is no `]` button. A wrap writes both brackets, so a lone closing one
  // has nothing left to close: it was there to finish a `[` dropped at the caret,
  // which is not a thing the palette does any more.
  letter('[', '[ ]4', {
    category: 'loops',
    writes: 0xe9,
    wraps: 'loop',
    label: 'loop',
    icon: 'repeatStart',
    blurb: 'Repeats the notes you have selected.',
  }),
  {
    kind: 'syntax',
    category: 'loops',
    id: '[[',
    writes: 0xe6,
    wraps: 'subloop',
    icon: 'repeatNested',
    label: 'subloop',
    blurb: 'Repeats the selected notes inside a repeat that is already running.',
    snippet: '[[ ]]2',
    syntax: null,
  },
  letter('*', '*', {
    category: 'loops',
    icon: 'replay',
    blurb: 'Plays the last labelled loop again from wherever you are.',
  }),
  {
    kind: 'syntax',
    category: 'loops',
    id: '(!n)',
    icon: 'triggerDefine',
    label: 'remote code',
    blurb: 'Writes a snippet the driver can run by itself later. Goes above the first channel.',
    snippet: '(!1)[$F4 $09]',
    syntax: 'remoteLoop',
    context: 'before-channels',
  },
  {
    kind: 'syntax',
    category: 'loops',
    id: '(!n,',
    writes: 0xfc,
    icon: 'trigger',
    label: 'remote code call',
    blurb: 'Arms a remote snippet from here on, and says what should set it off.',
    snippet: '(!1,1,24)',
    syntax: 'remoteLoop',
    context: 'channel',
  },
  {
    kind: 'syntax',
    category: 'loops',
    id: '(!!n)',
    icon: 'triggerOff',
    label: 'remote code reset',
    blurb: 'Cancels a remote snippet so it stops firing.',
    snippet: '(!!1)',
    syntax: 'remoteReset',
    // Event type `$07`, the non-key-on slot, which is what `(!!1)` above emits —
    // `$00` for 0 and `$08` for -1 are the other two (`parser.ts:parseRemoteCall`).
    // The byte is the call's, so `writes` stays on `(!n,` and this names it.
    fallbackOf: 0xfc,
    fallback: [0x00, 0x00, 0x07, 0x00],
    context: 'channel',
  },

  hex(0xf4, [0x01], {
    category: 'misc',
    icon: 'toggle',
    label: 'toggles',
    blurb:
      'Nine on/off switches: legato, light staccato, echo for this channel, Yoshi drums and more.',
  }),
  hex(0xfa, [0x00, 0x00], {
    category: 'misc',
    icon: 'sliders',
    label: 'driver settings',
    blurb:
      'Eight settings that each take a value: pitch modulation, GAIN, tuning, amplify, echo buffer size.',
  }),
  hex(0xf6, [0x0c, 0x7f], {
    category: 'misc',
    icon: 'chip',
    blurb: 'Writes a value straight into one of the sound chip’s registers.',
  }),
  hex(0xf7, [0x00, 0x00, 0x00], {
    category: 'misc',
    icon: 'chipWrite',
    blurb: 'AddmusicM’s command for writing a byte anywhere in the driver’s memory.',
    // Commands.asm:633 — the body is commented out, so the label collapses onto
    // cmdF9 and the dispatch slot is $0000 (main.bin @ $13A6). AddmusicK
    // compiles it without a word.
    caveat: () =>
      'This driver never implemented it: the SPC jumps to address zero and dies. AddmusicK compiles it anyway.',
  }),
  hex(0xf9, [0x00, 0x00], {
    category: 'misc',
    icon: 'chipSend',
    blurb: 'Sends two bytes to the SNES for the ROM to read. Changes nothing you can hear.',
  }),
];

/** One button, resolved against the dialect in force where it would land. */
export interface ResolvedEntry {
  key: string;
  /** The byte it writes, for a hex entry. `palettetest` counts coverage off this. */
  vcmd?: number;
  /** {@link LetterEntry.writes} - the byte a spelled form compiles to. */
  writes?: number;
  icon: CommandGlyph;
  label: string;
  blurb: string;
  /** Exactly what gets inserted. */
  text: string;
  /** Which slice of `text` to leave selected - the first argument. */
  select: TextRange | null;
  availability: Availability;
  /**
   * A warning {@link availability} cannot carry, because it answers to the
   * compiler and this does not - what the driver does with the byte, or a
   * rewrite the dialect makes without a word. {@link HexEntry.caveat}.
   */
  caveat?: string;
  /** Where in the song this is legal, which is `'anywhere'` for all but two. */
  where: 'anywhere' | 'before-channels' | 'channel';
  /** Which construct this entry asks for, for the two that wrap a selection. */
  wraps?: WrapKind;
  /**
   * What a click would put round the selection, or why it cannot - `undefined`
   * for every entry that does not wrap, and for a caller that supplied no
   * selection at all.
   *
   * Deliberately not folded into {@link availability}, which answers to
   * AddmusicK: "nothing is selected" is the palette's own condition and no
   * compile of the snippet could confirm or refute it. `entryBlocked` is where
   * the two meet.
   */
  wrap?: WrapVerdict;
}

/**
 * Where in the song the caret is, for the two entries that care.
 *
 * `null` when the song has no channel at all, which reads as "before" - that is
 * what the parser will make of it too, since `channelDefined` is still false.
 */
export interface CaretPlace {
  beforeChannels: boolean;
  /**
   * What the two bracket forms would write round what is selected now.
   *
   * Both answers rather than one, because which of the two a click lands on is
   * decided by where the run is: asked for a loop inside a loop, `loop-wrap.ts`
   * offers the subloop. Absent where the caller has no selection to offer.
   */
  wrap?: { loop: WrapVerdict; subloop: WrapVerdict };
}

/** The position rule, which stacks on top of the dialect one. */
function placeAvailability(entry: SyntaxEntry, place: CaretPlace): Availability | null {
  if (entry.context === 'before-channels' && !place.beforeChannels) {
    return {
      state: 'blocked',
      reason:
        'Remote code has to be defined above the first channel; written inside one it is read as a call instead.',
    };
  }

  if (entry.context === 'channel' && place.beforeChannels) {
    return {
      state: 'blocked',
      reason: 'The reset form is a call, so it belongs inside a channel, below the first #0-#7.',
    };
  }

  return null;
}

/** The dialect rule for a spelling that has one; every letter parses everywhere. */
function formFor(entry: LetterEntry | SyntaxEntry): PaletteForm | null {
  if (entry.kind === 'letter') {
    return { kind: 'letter', letter: entry.id };
  }

  return entry.syntax === null ? null : { kind: 'syntax', id: entry.syntax };
}

const AVAILABLE: Availability = { state: 'ok', reason: null };

/** `$XX $YY …` — the one place a command's bytes become the text of a snippet. */
function hexText(vcmd: number, args: readonly number[]): string {
  return [vcmd, ...args].map((byte) => `$${hex2(byte)}`).join(' ');
}

/**
 * The raw-hex spelling of a form the dialect will not take as written.
 *
 * Offered only where the byte is still *this* command there, which is
 * `expectedArgs` agreeing with the count the fallback writes: `#amk 1`'s `$FC`
 * is remote gain and takes two arguments, so `(!!n)` has nothing to fall back to
 * and stays blocked. Asking `expectedArgs` rather than restating the dialect
 * rules keeps the fork in the one place `tokentest` already pins it.
 *
 * The swap says nothing about itself. A porter asked for a volume fade and gets
 * one; which of the two spellings their dialect takes is the palette's problem,
 * and `palettetest` compiles both to prove they are the same command. What the
 * button still reports is what AddmusicK will *say* about the bytes, which is
 * the byte's own availability rather than the refused spelling's — `$FC` carries
 * AMK0211 at `#amk 2` and the non-native warning under the legacy programs.
 */
function substitute(
  entry: SyntaxEntry,
  target: CommandTarget,
): { vcmd: number; text: string; availability: Availability } | null {
  const vcmd = entry.fallbackOf ?? entry.writes;
  if (entry.fallback === undefined || vcmd === undefined) {
    return null;
  }

  const args = entry.fallback.map((value) => ({ value }));
  if (expectedArgs(vcmd, args, target) !== entry.fallback.length) {
    return null;
  }

  return {
    vcmd,
    text: hexText(vcmd, entry.fallback),
    availability: formAvailability({ kind: 'hex', vcmd }, target),
  };
}

export function resolveEntry(
  entry: Entry,
  target: CommandTarget,
  place: CaretPlace,
): ResolvedEntry {
  if (entry.kind !== 'hex') {
    const form = formFor(entry);
    const dialect = form === null ? AVAILABLE : formAvailability(form, target);
    // A spelling this dialect refuses becomes the bytes it would have compiled
    // to, where those bytes still mean the same command here.
    const swap =
      entry.kind === 'syntax' && dialect.state === 'blocked' ? substitute(entry, target) : null;
    const reached = swap?.availability ?? dialect;
    // The dialect rule is reported first when both bite: being on `#amk 1` is
    // the more basic reason, and moving the caret would not fix it.
    const availability =
      reached.state !== 'blocked' && entry.kind === 'syntax'
        ? (placeAvailability(entry, place) ?? reached)
        : reached;
    const label = capitalise(
      entry.kind === 'syntax' ? entry.label : (entry.label ?? LETTER_NAMES[entry.id] ?? entry.id),
    );
    const text = swap?.text ?? entry.snippet;
    const wrap = entry.wraps === undefined ? undefined : place.wrap?.[entry.wraps];

    return {
      key: `text:${entry.id}`,
      vcmd: swap?.vcmd,
      writes: entry.writes,
      icon: entry.icon,
      label,
      // A loop asked for inside a loop comes back as the subloop, and the line
      // under the strip is where that is said - the button keeps its name, as it
      // does for the hex a dialect swaps a spelling for.
      blurb:
        wrap !== undefined && 'kind' in wrap && wrap.kind !== entry.wraps
          ? INSTEAD[wrap.kind]
          : entry.blurb,
      text,
      select: swap ? FIRST_HEX_ARG : firstNumberSpan(entry.snippet),
      availability,
      where: entry.kind === 'syntax' ? (entry.context ?? 'anywhere') : 'anywhere',
      wraps: entry.wraps,
      wrap,
    };
  }

  const availability = formAvailability({ kind: 'hex', vcmd: entry.vcmd }, target);
  const named = vcmdName(
    entry.vcmd,
    entry.args.map((value) => ({ value })),
    target,
  );
  const label = capitalise(entry.label ?? named);

  return {
    // Two buttons can write one byte — `$ED`'s ADSR and GAIN do — so the byte
    // alone is not a key.
    key: entry.id === undefined ? `hex:${entry.vcmd}` : `hex:${entry.vcmd}:${entry.id}`,
    vcmd: entry.vcmd,
    icon: entry.icon,
    label,
    blurb: entry.blurb,
    text: hexText(entry.vcmd, entry.args),
    select: entry.args.length > 0 ? FIRST_HEX_ARG : null,
    availability,
    caveat: entry.caveat?.(target),
    where: 'anywhere',
  };
}

/** What the readout says where a wrap lands on the other construct. */
const INSTEAD: Readonly<Record<WrapKind, string>> = {
  loop: 'Inside a subloop this makes an ordinary loop, which is what fits there.',
  subloop: 'Inside a loop this makes a subloop - a repeat within the repeat.',
};

/** The two digits of a hex snippet's first argument: `$XX ` then its own `$`. */
const FIRST_HEX_ARG: TextRange = { start: 5, end: 7 };

/** The digits of the first argument - the run every letter form puts it in. */
function firstNumberSpan(snippet: string): TextRange | null {
  const found = /[0-9a-fA-F]+/.exec(snippet);
  return found ? { start: found.index, end: found.index + found[0].length } : null;
}

/**
 * `VCMD_NAMES` and `LETTER_NAMES` are lower case, which suits running prose in
 * the inspector and not a button. Applied once here so the button face and the
 * readout under the strip cannot disagree about it.
 */
function capitalise(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}
