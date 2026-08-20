/**
 * Normalizing a song: the passes in `@amk/compiler/normalize`, each checked
 * against the walk of the original before the next one runs.
 *
 * Here rather than in the compiler because only the app can reach both halves:
 * the compiler rewrites text and the walk in `@amk/spc` reads bytes, and the
 * package boundary keeps each from the other. It is pure and takes no Angular,
 * so `normalizetest` drives it directly — the same arrangement `song-clock.ts`
 * and `commands-in-force.ts` have.
 *
 * The rule is that nothing reaches the document unless every intermediate song
 * plays the same notes, on the same ticks, under the same state, at the same
 * written pitch. A pass that cannot hold to that says why; a pass that thinks it
 * has and has not is caught here, with the first note that moved.
 */

import { compiler } from '@amk/compiler';
import {
  type NormalizeInput,
  type PassResult,
  UNROLL_ROUNDS,
  drumPerNote,
  flattenTriplets,
  inlineReplacements,
  orderChannels,
  precheck,
  resolvePreprocessor,
  unrollLoops,
  writeDefaults,
} from '@amk/compiler/normalize';
import type { CompileResult, Diagnostic, NoteAddress, ParseTrace, Span } from '@amk/core/types';
import { type NoteState, type SongTimeline, type WalkNote, walkSong } from '@amk/spc/song-walk';
import { DEFAULT_TEMPO } from '@amk/tokens/commands/units';

/** The passes, in the order they run; a successful outcome names the ones that changed the song. */
export type NormalizePass =
  'preprocessor' | 'replacements' | 'triplets' | 'loops' | 'channels' | 'defaults' | 'drums';

export type NormalizeOutcome =
  | { ok: true; text: string; diagnostics: Diagnostic[]; changed: readonly NormalizePass[] }
  | { ok: false; diagnostics: Diagnostic[] };

/** A compiled song beside its walk, which is what two songs are compared on. */
export interface Walked {
  timeline: SongTimeline;
  noteMap: readonly NoteAddress[];
}

/** What the comparison may let pass, and only once the defaults pass has run. */
export interface Allowances {
  /** The `t` written for a song that never set one, or null while none has been. */
  writtenTempo: number | null;
}

interface Compiled {
  result: CompileResult;
  data: Uint8Array;
  trace: ParseTrace;
}

const NOWHERE: Span = { start: 0, end: 0, line: 1 };

const STATE_KEYS = [
  'instrument',
  'volume',
  'pan',
  'quantization',
  'gate',
  'velocity',
  'vibrato',
  'tremolo',
  'noise',
  'transpose',
  'tune',
  'tempo',
  'globalVolume',
] as const satisfies readonly (keyof NoteState)[];

const NOTE_KEYS = [
  'channel',
  'tick',
  'ticks',
  'gateTicks',
  'note',
  'key',
  'percussion',
] as const satisfies readonly (keyof WalkNote)[];

function refusal(code: string, message: string, span: Span = NOWHERE): Diagnostic {
  return { severity: 'error', code, message, span: { ...span } };
}

function compileTraced(
  source: string,
  aramAddress: number,
  options: Readonly<Record<string, unknown>>,
): Compiled | Diagnostic[] {
  const result = compiler.compile({ source, aramAddress, options: { ...options, trace: true } });
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (!result.ok || !result.data || !result.trace || errors.length > 0) {
    return errors;
  }

  return { result, data: result.data, trace: result.trace };
}

/**
 * Rewrites `source` for editing, or says why it cannot be.
 *
 * All or nothing: a refusal from any pass, or any difference between a pass's
 * output and the original, refuses the whole song. The diagnostics on success
 * are informational — what the defaults pass chose not to write, and why.
 */
export function normalizeSong(
  source: string,
  aramAddress: number,
  options: Readonly<Record<string, unknown>>,
): NormalizeOutcome {
  const original = compileTraced(source, aramAddress, options);
  if (Array.isArray(original)) {
    return {
      ok: false,
      diagnostics: [
        refusal('AMK0600', 'The song has to compile without errors before it can be normalized.'),
        ...original,
      ],
    };
  }

  const walked: Walked = {
    timeline: walkSong(original.data, aramAddress),
    noteMap: original.result.noteMap ?? [],
  };
  if (walked.timeline.truncated || walked.timeline.problems.length > 0) {
    return {
      ok: false,
      diagnostics: [
        refusal(
          'AMK0601',
          `The song cannot be read through to the end: ${walked.timeline.problems.join(' ') || 'the walk ran out of room.'}`,
        ),
      ],
    };
  }

  const input: NormalizeInput = { text: source, result: original.result, trace: original.trace };
  const blocked = precheck(input);
  if (blocked.length > 0) {
    return { ok: false, diagnostics: blocked };
  }

  const tempoAtStart = walked.timeline.tempoChanges.some((change) => change.tick === 0);
  const allowances: Allowances = { writtenTempo: null };
  const notes: Diagnostic[] = [];
  const changed: NormalizePass[] = [];
  let current = input;

  /** Checks a pass's output and makes it the current song, or returns the refusal. */
  const advance = (pass: NormalizePass, name: string, out: PassResult): Diagnostic[] | null => {
    notes.push(...out.diagnostics.filter((d) => d.severity !== 'error'));
    const errors = out.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length > 0) {
      return errors;
    }

    if (!out.changed) {
      return null;
    }

    const next = compileTraced(out.text, aramAddress, options);
    if (Array.isArray(next)) {
      return [
        refusal(
          'AMK0600',
          `Rewriting the ${name} produced a song that does not compile, so nothing was changed.`,
        ),
        ...next,
      ];
    }

    const candidate: Walked = {
      timeline: walkSong(next.data, aramAddress),
      noteMap: next.result.noteMap ?? [],
    };
    const difference = timelinesAgree(walked, candidate, allowances);
    if (difference !== null) {
      const at = walked.noteMap.find((entry) => entry.address === difference.address);
      return [
        refusal(
          'AMK0603',
          `Rewriting the ${name} would change the music (${difference.message}), so nothing was changed.`,
          at?.span,
        ),
      ];
    }

    current = { text: out.text, result: next.result, trace: next.trace };
    if (!changed.includes(pass)) {
      changed.push(pass);
    }

    return null;
  };

  const steps: [NormalizePass, string, (input: NormalizeInput) => PassResult][] = [
    ['preprocessor', 'preprocessor directives', resolvePreprocessor],
    ['replacements', 'replacements', inlineReplacements],
    ['triplets', 'triplets', flattenTriplets],
  ];
  for (const [pass, name, run] of steps) {
    const blockedBy = advance(pass, name, run(current));
    if (blockedBy) {
      return { ok: false, diagnostics: blockedBy };
    }
  }

  for (let round = 0; ; round++) {
    const out = unrollLoops(current);
    if (!out.changed && out.diagnostics.length === 0) {
      break;
    }

    if (round === UNROLL_ROUNDS) {
      return {
        ok: false,
        diagnostics: [refusal('AMK0614', 'The loops did not unroll within the rounds allowed.')],
      };
    }

    const blockedBy = advance('loops', 'loops', out);
    if (blockedBy) {
      return { ok: false, diagnostics: blockedBy };
    }
  }

  const rest: [NormalizePass, string, (input: NormalizeInput) => PassResult][] = [
    ['channels', 'channel blocks', orderChannels],
    [
      'defaults',
      'channel defaults',
      (song) => {
        const out = writeDefaults(song, { tempoAtStart, bootTempo: DEFAULT_TEMPO });
        if (out.changed && !tempoAtStart) {
          allowances.writtenTempo = DEFAULT_TEMPO;
        }

        return out;
      },
    ],
    ['drums', 'drum notes', drumPerNote],
  ];
  for (const [pass, name, run] of rest) {
    const blockedBy = advance(pass, name, run(current));
    if (blockedBy) {
      return { ok: false, diagnostics: blockedBy };
    }
  }

  return { ok: true, text: current.text, diagnostics: notes, changed };
}

/**
 * Whether two songs play the same music — `null` when they do, else the first
 * difference and, where it is a note, the original's address of it.
 *
 * Per note: the tick, the slot and gate, the byte, the whole of the state it
 * sounds under, and the pitch it was **written** at — the roll's row, which the
 * bytes alone cannot say. Addresses, origins and `drumFrom` are left out, being
 * exactly what a rewrite moves. Per song: its length, where it loops, every
 * channel's ticks, which are used, the instruments sounded, and every tempo
 * command in driver order.
 *
 * The one allowance is the `t` the defaults pass writes for a song that never
 * set one: the driver boots at that tempo, so the walk of the original reads 0
 * where the candidate reads the written value, and has one tempo command fewer.
 */
export function timelinesAgree(
  a: Walked,
  b: Walked,
  allowances: Allowances,
): { message: string; address?: number } | null {
  const ta = a.timeline;
  const tb = b.timeline;
  const same = (name: string, x: unknown, y: unknown): { message: string } | null =>
    JSON.stringify(x) === JSON.stringify(y)
      ? null
      : { message: `${name} ${String(x)} would become ${String(y)}` };

  const tempoOf = (tempo: number): number =>
    allowances.writtenTempo !== null && tempo === 0 ? allowances.writtenTempo : tempo;
  let changes = tb.tempoChanges;
  if (
    allowances.writtenTempo !== null &&
    !ta.tempoChanges.some((change) => change.tick === 0) &&
    changes.length > 0 &&
    changes[0].tick === 0 &&
    changes[0].tempo === allowances.writtenTempo &&
    changes[0].fadeTicks === 0
  ) {
    changes = changes.slice(1);
  }

  const song =
    same('the length in ticks', ta.ticks, tb.ticks) ??
    same('the loop point', ta.loopTick, tb.loopTick) ??
    same('the channel tick counts', ta.channelTicks, tb.channelTicks) ??
    same('the channels used', ta.used, tb.used) ??
    same('the walk being cut short', ta.truncated, tb.truncated) ??
    same('the instruments sounded', ta.usedInstruments, tb.usedInstruments) ??
    same('the custom instruments', ta.customInstruments, tb.customInstruments) ??
    same('the walk problems', ta.problems, tb.problems) ??
    same('the tempo commands', ta.tempoChanges, changes) ??
    same('the note count', ta.notes.length, tb.notes.length);
  if (song) {
    return song;
  }

  const writtenA = new Map(a.noteMap.map((entry) => [entry.address, entry.written]));
  const writtenB = new Map(b.noteMap.map((entry) => [entry.address, entry.written]));
  for (let at = 0; at < ta.notes.length; at++) {
    const x = ta.notes[at];
    const y = tb.notes[at];
    const where = `the note on #${x.channel} at tick ${x.tick}`;
    for (const key of NOTE_KEYS) {
      if (x[key] !== y[key]) {
        return {
          message: `${where}: ${key} ${String(x[key])} would become ${String(y[key])}`,
          address: x.address,
        };
      }
    }

    for (const key of STATE_KEYS) {
      const p = key === 'tempo' ? tempoOf(x.state.tempo) : x.state[key];
      const q = key === 'tempo' ? tempoOf(y.state.tempo) : y.state[key];
      if (p !== q) {
        return {
          message: `${where}: ${key} ${String(p)} would become ${String(q)}`,
          address: x.address,
        };
      }
    }

    if (writtenA.get(x.address) !== writtenB.get(y.address)) {
      return {
        message: `${where}: written as ${String(writtenA.get(x.address))}, would be written as ${String(writtenB.get(y.address))}`,
        address: x.address,
      };
    }
  }

  return null;
}
