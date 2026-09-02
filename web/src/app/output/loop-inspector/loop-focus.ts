import type { Span } from '@amk/core/types';
import { type Command, type TokenIndex, commandStartingAt } from '@amk/tokens';
import type { LoopConstruct, LoopReading, LoopSpan } from '@amk/tokens/commands/loops';
import {
  MAX_LOOP_COUNT,
  MAX_LOOP_LABEL,
  MAX_SUBLOOP_COUNT,
  loopAt,
  loopTargets,
  loopsAt,
  nextLoopLabel,
} from '@amk/tokens/commands/loops';
import type { EnumOption } from '@amk/tokens/commands/param';
import {
  type Edit,
  argEditable,
  argumentText,
  insertAt,
  spliceArg,
  spliceRange,
} from '@amk/tokens/edits';
import { argLockedBecause } from '../command-inspector/commands/context';

/**
 * Which of the language's five loop spellings a construct is.
 *
 * `star` is told from `call` because only one of the two names the body it
 * plays, and `remote` from `loop` because a `(!n)[ … ]` body cannot repeat at
 * all — AddmusicK raises AMK0164 for a count on one (`parser.ts:parseLoopEnd`).
 */
export type LoopKind = 'loop' | 'subloop' | 'call' | 'star' | 'remote';

/** The Repeats control, bound to wherever this spelling keeps its count. */
export interface LoopCountView {
  plays: number;
  min: number;
  max: number;
  /** What the number means, beside the field. */
  note: string;
  editable: boolean;
  /** Why it cannot be written, when it cannot. */
  lockedBecause: string | null;
  /** A count the document already holds that AddmusicK would refuse. */
  warn: string | null;
}

/** The Recalls control: which declared body a call plays. */
export interface LoopRecallView {
  /** The label as written, or -1 for a `*`, which names none. */
  label: number;
  options: readonly EnumOption[];
  note: string;
  /** What a label nothing declares above this call reads as. */
  unknownLabel: string;
}

/**
 * Naming a body that has none, so that a call can reach it.
 *
 * Only ever offered, never a rename: a `(n)` is what every `(n)m` in the song
 * names this body by, and changing it would point every one of them at a label
 * nothing declares.
 */
export interface LoopNameView {
  /** The number a click writes — the lowest the song is not already using. */
  label: number;
  note: string;
}

/** One loop the caret is about, as the panel draws it. */
export interface LoopFocus {
  /** `@for` identity — the construct's own range, which is unique in a document. */
  key: string;
  kind: LoopKind;
  title: string;
  /** The construct as written, on one line and elided in the middle when long. */
  written: string;
  /**
   * Whether the caret is on the construct's own text rather than inside its
   * body. What tells the inspector to stand its generic parameter table down:
   * the count is drawn here, and drawn better than the table can draw it.
   */
  onText: boolean;
  count: LoopCountView | null;
  recalls: LoopRecallView | null;
  name: LoopNameView | null;
  /** A sentence about the construct as a whole — usually why there is no count. */
  note: string | null;
  /** The reading the writers below splice from. Not for the template. */
  construct: LoopConstruct;
  /** The command whose first argument the count is, where a spelling gathers one. */
  countCommand: Command | null;
}

export interface LoopFocusRequest {
  source: string;
  index: TokenIndex;
  reading: LoopReading;
  caret: number;
  /** What the piano roll last took hold of — see `EditorRequests.inspectingLoop`. */
  hint: { text: Span; body: Span } | null;
}

/** The most of a construct worth showing before the middle comes out. */
const WRITTEN_MAX = 44;

const TITLES: Readonly<Record<LoopKind, string>> = {
  loop: 'Loop',
  subloop: 'Subloop',
  call: 'Loop call',
  star: 'Loop call',
  remote: 'Remote code',
};

/**
 * The loops the caret is about, innermost first.
 *
 * Every construct it is inside at all — the brackets, the body, the count or the
 * label — because a loop is what a note inside it plays under, and a porter
 * reading a body wants the same answer at its fourth note as at its first.
 *
 * The roll's `hint` **redirects** that list and never lengthens it. A press on a
 * box's edge selects the body's notes and leaves the caret on the first of them,
 * where the text alone cannot say whether the box was the declaration's or one
 * of its recalls'; so the construct it names goes to the head, and only while
 * the caret is genuinely inside the body it named — which is what retires the
 * hint the moment the porter looks somewhere else. Matched on the body rather
 * than on the label, since an unlabelled `[ ]` recalled by a `*` has no name for
 * the roll's reading and this one to agree on.
 */
export function loopFocus(request: LoopFocusRequest): readonly LoopFocus[] {
  const { source, index, reading, caret, hint } = request;
  const inside = loopsAt(reading, caret);
  const on = loopAt(reading, caret);
  const constructs = [...inside];

  const named = hint === null ? null : loopAt(reading, hint.text.start);
  const holds =
    hint !== null &&
    inside.some((each) => {
      const body = bodyOf(each);
      return body !== null && body.from === hint.body.start && body.to === hint.body.end;
    });

  if (named !== null && holds) {
    const already = constructs.indexOf(named);
    if (already >= 0) {
      constructs.splice(already, 1);
    }

    constructs.unshift(named);
  }

  return constructs.map((construct) => view(source, index, reading, construct, construct === on));
}

/** A span's body range, or `null` for a recall, whose body is elsewhere. */
function bodyOf(construct: LoopConstruct): { from: number; to: number } | null {
  return isSpan(construct) ? { from: construct.bodyFrom, to: construct.bodyTo } : null;
}

/** A declaration rather than a recall — the one has a body between its brackets. */
function isSpan(construct: LoopConstruct): construct is LoopSpan {
  return 'bodyFrom' in construct;
}

function kindOf(construct: LoopConstruct): LoopKind {
  if (isSpan(construct)) {
    return construct.remote ? 'remote' : construct.kind === 'sub' ? 'subloop' : 'loop';
  }

  return construct.kind === 'star' ? 'star' : 'call';
}

function view(
  source: string,
  index: TokenIndex,
  reading: LoopReading,
  construct: LoopConstruct,
  onText: boolean,
): LoopFocus {
  const kind = kindOf(construct);
  const on = construct.count.on;
  const countCommand = on === null ? null : commandStartingAt(index.commands, on);
  const call = kind === 'call' || kind === 'star';

  return {
    key: `${construct.from}:${construct.to}`,
    kind,
    title: TITLES[kind],
    written: elide(source.slice(construct.from, construct.to)),
    onText,
    count: kind === 'remote' ? null : countView(construct, kind, countCommand),
    recalls: call ? recallView(reading, construct) : null,
    name: nameView(reading, kind, construct),
    note: noteFor(kind, construct),
    construct,
    countCommand,
  };
}

function countView(
  construct: LoopConstruct,
  kind: LoopKind,
  command: Command | null,
): LoopCountView {
  const sub = kind === 'subloop';
  const min = sub ? 2 : 1;
  const max = sub ? MAX_SUBLOOP_COUNT : MAX_LOOP_COUNT;
  const { plays, at } = construct.count;
  const written = at.end > at.start;

  return {
    plays: plays ?? min,
    min,
    max,
    note: countNote(construct, plays, written),
    editable: !written || command === null || argEditable(command, 0),
    lockedBecause: written && command !== null ? argLockedBecause(command, 0) : null,
    warn: countWarning(plays, kind, min, max),
  };
}

function countNote(construct: LoopConstruct, plays: number | null, written: boolean): string {
  if (plays === null) {
    return 'nothing is written, and a subloop must be given a count';
  }

  const times = `plays ${plays} time${plays === 1 ? '' : 's'}`;
  if (!written) {
    return `${times} — nothing is written, and a missing count reads as 1`;
  }

  // The byte and the number disagree for exactly one spelling, and a porter
  // reading the hex dump beside this needs to know which way round it is.
  return construct.count.lessOne ? `${times} — the byte is one less than the count` : times;
}

function countWarning(
  plays: number | null,
  kind: LoopKind,
  min: number,
  max: number,
): string | null {
  if (plays === null) {
    // Only a subloop reads as none: every other spelling defaults a missing
    // count to 1.
    return 'A subloop must be given a count (AMK0128).';
  }

  if (plays < min) {
    return kind === 'subloop'
      ? 'A subloop cannot repeat only once (AMK0126).'
      : 'A loop count must be between 1 and 255 (AMK0116).';
  }

  if (plays > max) {
    return kind === 'subloop'
      ? 'Past 256 the count wraps: the driver is given one less than it, through a byte.'
      : 'A loop count must be between 1 and 255 (AMK0116).';
  }

  return null;
}

function recallView(reading: LoopReading, construct: LoopConstruct): LoopRecallView {
  const star = !isSpan(construct) && construct.kind === 'star';
  const options: EnumOption[] = loopTargets(reading, construct.from).map((span) => ({
    value: span.label,
    label: `(${span.label})`,
  }));

  if (star) {
    // `*` takes `prevLoop`, the last `[` opened, so what it plays is decided by
    // where it is written rather than by a number in it. Choosing a label writes
    // the labelled call that says the same thing out loud.
    options.unshift({ value: -1, label: 'the loop written above it' });
  }

  return {
    label: isSpan(construct) ? -1 : (construct.label ?? -1),
    options,
    note: star
      ? 'A * replays whichever loop was opened above it. Naming one writes a (n) call in its place.'
      : 'Only loops declared above this call — AddmusicK reads a song in order (AMK0115).',
    unknownLabel: 'no loop with this number is declared above here',
  };
}

function nameView(
  reading: LoopReading,
  kind: LoopKind,
  construct: LoopConstruct,
): LoopNameView | null {
  if (kind !== 'loop' || !isSpan(construct) || construct.label !== null) {
    return null;
  }

  const label = nextLoopLabel(reading.slots);
  return label === null
    ? null
    : {
        label,
        // A `(!n)` takes slot n and a `(n)` takes slot n + 1 (`parser.ts:2460`,
        // `:2517`), so the allocator counts both kinds or walks into AMK0124.
        note: 'A body with no name can only be replayed by a *, which names nothing a piano roll can point at.',
      };
}

function noteFor(kind: LoopKind, construct: LoopConstruct): string | null {
  if (kind === 'remote') {
    return 'A remote code definition cannot repeat (AMK0164). Its body runs where a (!n, …) call fires it.';
  }

  const label = kind === 'loop' && isSpan(construct) ? construct.label : null;
  return label === null
    ? null
    : `Named (${label}), so a (${label})n call replays this body from anywhere below it.`;
}

/** One line, and not more of it than a panel column can hold. */
function elide(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= WRITTEN_MAX
    ? flat
    : `${flat.slice(0, WRITTEN_MAX - 22)} … ${flat.slice(-18)}`;
}

/**
 * The splice a Repeats change writes.
 *
 * Three routes, and which one is taken is decided by what the spelling wrote
 * rather than by the spelling itself. A gathered count goes through `spliceArg`,
 * which brings `edits.ts`'s per-part macro interlock and the command's own radix
 * with it — `$nn` for the `$E6`, decimal for a `]` or a `*`. A count not written
 * yet has nothing to overwrite and `spliceArg` refuses an index past
 * `args.length`, so it is an insertion; `getInt` skips no spaces, so decimal
 * digits go hard against the bracket where a hex byte must stand apart. And a
 * `(n)m`'s digits no command gathers at all.
 */
export function loopCountEdit(source: string, focus: LoopFocus, plays: number): Edit | null {
  const { at, lessOne } = focus.construct.count;
  const written = lessOne ? plays - 1 : plays;

  if (at.end > at.start) {
    return focus.countCommand
      ? spliceArg(source, focus.countCommand, 0, argumentText(focus.countCommand, written))
      : spliceRange(source, { start: at.start, end: at.end, line: 1 }, String(written));
  }

  const text = lessOne
    ? ` $${written.toString(16).toUpperCase().padStart(2, '0')}`
    : String(written);
  return insertAt(at.start, text, 1);
}

/**
 * The splice that gives an unnamed body a name.
 *
 * `parseLabelLoop` reads the number, sees the `[` hard against it and returns
 * with `loopLabel` set, which `parseLoopStart` then files in `loopPointers`
 * (`parser.ts:2736`) — so the label goes immediately in front of the bracket and
 * nowhere else. Nothing between them: `labelBefore` and the parser's own
 * lookbehind both test adjacency.
 */
export function loopNameEdit(focus: LoopFocus, label: number): Edit | null {
  if (focus.name === null || label < 0 || label > MAX_LOOP_LABEL) {
    return null;
  }

  return insertAt(focus.construct.from, `(${label})`, 1);
}

/**
 * The splice that points a call at another body.
 *
 * A `(n)m` rewrites its digits. A `*n` has none — naming a body is the whole
 * difference between the two spellings — so the construct itself is rewritten as
 * the labelled call that says what it plays, carrying its count across as
 * written so a bare `*` stays a single pass.
 */
export function loopTargetEdit(source: string, focus: LoopFocus, label: number): Edit | null {
  if (label < 0 || label > MAX_LOOP_LABEL) {
    return null;
  }

  const construct = focus.construct;
  if (!isSpan(construct) && construct.labelAt !== null) {
    return spliceRange(source, { ...construct.labelAt, line: 1 }, String(label));
  }

  if (focus.kind !== 'star') {
    return null;
  }

  const { at } = construct.count;
  const digits = at.end > at.start ? source.slice(at.start, at.end) : '';
  return spliceRange(
    source,
    { start: construct.from, end: construct.to, line: 1 },
    `(${label})${digits}`,
  );
}
