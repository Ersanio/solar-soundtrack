import type { Span } from '@amk/core/types';
import type { Command, TokenIndex } from '@amk/tokens';
import {
  type LoopReading,
  loopContents,
  loopStateAt,
  loopTargets,
  nextLoopLabel,
} from '@amk/tokens/commands/loops';
import { type Edit, insertAt, padAround } from '@amk/tokens/edits';
import { caretPosition } from '../../util/format';
import { unitStartBefore } from '../views/piano-roll/roll-strip';

/**
 * Putting brackets round the notes a porter picked out.
 *
 * The palette's other buttons drop a command at a point; these two take a run of
 * music and wrap it, so what a click writes depends on where the run is as well
 * as on the dialect. AddmusicK holds one `[ ]` and one `[[ ]]` open at a time,
 * in either order — that is what the four `baseLoopIs*`/`extraLoopIs*` flags
 * account for (`parser.ts:2852-2881`, Music.cpp:3552-3589) — so **which** of the
 * two a wrap writes is decided here rather than by the button pressed: asked for
 * a loop inside a loop, this offers the subloop, in the mould of `substitute()`
 * in `catalog.ts`, which hands back the bytes where the dialect refuses the
 * spelling. The readout says which it landed on.
 *
 * Everything it reasons from is the token stream — `@amk/tokens/commands/loops`
 * is the bracket reading, and this is the policy over it — so the same answer
 * serves the caret palette and the roll's, and neither needs a compile.
 */

export type WrapKind = 'loop' | 'subloop';

export interface WrapOffer {
  kind: WrapKind;
  /** The `(n)` the loop is named with; `null` for a subloop, which names no body. */
  label: number | null;
  /** The run the brackets go round, grown out to whole note units. */
  at: Span;
  /** What goes in front of that run, its own padding included. */
  open: string;
  /** What goes after it. */
  close: string;
  /** The repeat count's digits inside {@link close}, which the palette leaves selected. */
  countAt: { start: number; end: number };
}

export type WrapVerdict = WrapOffer | { refused: string };

export function isWrap(verdict: WrapVerdict): verdict is WrapOffer {
  return 'kind' in verdict;
}

/** Said by both verdicts: with the brackets unpaired there is nothing to reason from. */
export const BRACKETS_UNPAIRED = 'This song’s loop brackets do not pair up.';

export const WRAP_NOTHING = 'Select the notes the loop should play.';
export const WRAP_NO_NOTES = 'That selection holds no notes to loop.';
export const WRAP_SPLIT = 'Those notes are on both sides of a loop bracket.';
export const WRAP_CHANNELS = 'Those notes are on more than one channel.';
export const WRAP_INTRO = 'The intro marker cannot be written inside a loop (AMK0080).';
export const WRAP_REPLACEMENT = 'That music is written through a replacement.';
export const WRAP_DEEP = 'A loop and a subloop is as deep as AddmusicK goes.';

/**
 * Calling a loop the song has already written.
 *
 * The other half of the brackets, and the same policy layer: a `(n)m` names its
 * body, so what a click can write depends on what is declared above the caret
 * rather than only on the dialect.
 */
export interface CallOffer {
  /** The body it plays: the nearest labelled declaration above the caret. */
  label: number;
  /** The text to write, padding included. */
  text: string;
  /** The count's digits inside {@link text}, which the palette leaves selected. */
  countAt: { start: number; end: number };
}

export type CallVerdict = CallOffer | { refused: string };

export function isCall(verdict: CallVerdict): verdict is CallOffer {
  return 'label' in verdict;
}

export const CALL_NONE =
  'No named loop is written above the cursor. Loops made here name themselves.';
export const CALL_NESTED = 'A loop cannot be called from inside another loop (AMK0112).';

/**
 * What a fresh loop opens on.
 *
 * The least a repeat can be, so the music the porter picked out plays once more
 * than it did and no further; it is also the only count a subloop may open on,
 * `]]1` being AMK0126 (`parser.ts:2759`). It is left selected, so the command
 * inspector's own **Repeats** field is where it changes.
 */
const COUNT = 2;

export interface WrapRequest {
  source: string;
  index: TokenIndex;
  reading: LoopReading;
  /** The run the porter picked out, or `null` where nothing is selected. */
  run: { start: number; end: number } | null;
  want: WrapKind;
}

export function wrapVerdict(request: WrapRequest): WrapVerdict {
  const { source, index, reading, run, want } = request;
  if (run === null || run.end <= run.start) {
    return { refused: WRAP_NOTHING };
  }

  // A `$DD`'s last parameter may be written as a note, and `gather` raises a note
  // command for it as well as filing it under `noteTarget` — but it emits nothing
  // and sounds nothing, so it is no part of what a porter picked out.
  const bends = index.commands.filter((command) => command.vcmd === 0xdd);
  const sounds = (command: Command): boolean =>
    (command.name === 'note' || command.name === 'rest') &&
    !bends.some(
      (bend) => command.span.start >= bend.span.start && command.span.end <= bend.span.end,
    );

  const picked = index.commands.filter(
    (command) => sounds(command) && command.span.start < run.end && command.span.end > run.start,
  );

  if (picked.length === 0) {
    return { refused: WRAP_NO_NOTES };
  }

  if (!reading.sound) {
    return { refused: BRACKETS_UNPAIRED };
  }

  const channel = picked[0].channel;
  if (picked.some((command) => command.channel !== channel)) {
    return { refused: WRAP_CHANNELS };
  }

  // The head reaches back over the note's own leading `o` and drum `@`, as every
  // insertion in the roll does. For a drum that is not tidiness: `[` copies the
  // remap into slot 8 and the note there clears slot 8 alone (`parser.ts:2725`,
  // `:3013`), so a `@21` left outside the brackets would still be standing when
  // the loop ends and would hand the drum to the note after it.
  const head = unitStartBefore(source, index.commands, picked[0]);
  let start = head.start;
  let end = tailAfter(index, channel, picked[picked.length - 1]);

  // A construct the porter's own selection covers whole is wrapped round rather
  // than reached into — the notes inside it are the body's, and the run the
  // brackets go round is what was picked out.
  for (const span of reading.spans) {
    if (run.start <= span.from && span.to <= run.end) {
      start = Math.min(start, span.from);
      end = Math.max(end, span.to);
    }
  }

  for (const recall of reading.recalls) {
    if (run.start <= recall.from && recall.to <= run.end) {
      start = Math.min(start, recall.from);
      end = Math.max(end, recall.to);
    }
  }

  const at: Span = { start, end, line: caretPosition(source, start).line };

  const between = index.commands.filter(
    (command) => command.span.start >= at.start && command.span.end <= at.end,
  );
  if (between.some((command) => command.replacement !== undefined)) {
    return { refused: WRAP_REPLACEMENT };
  }

  for (const token of index.tokens) {
    if (token.start < at.start || token.end > at.end) {
      continue;
    }

    // Neither raises a command, so the command list above cannot see them.
    if (token.kind === 'channel') {
      return { refused: WRAP_CHANNELS };
    }

    if (token.kind === 'operator' && source[token.start] === '/') {
      return { refused: WRAP_INTRO };
    }
  }

  const contents = loopContents(reading, at.start, at.end);
  if (contents.crosses) {
    return { refused: WRAP_SPLIT };
  }

  const { inCall, inSub } = loopStateAt(reading, at.start);
  // A `[` is AMK0123 inside a body and a `(n)` or `*` inside one is AMK0112, so
  // a loop that may be written may always carry its label as well.
  const loopFits = !inCall && !contents.holdsCall;
  const subFits = !inSub && !contents.holdsSub;

  const loop = (): WrapOffer => {
    const label = nextLoopLabel(reading.slots);
    const open = label === null ? '[ ' : `(${label})[ `;
    return { ...offerOf(source, at, open, ` ]${COUNT}`), kind: 'loop', label, at };
  };

  const subloop = (): WrapOffer => ({
    ...offerOf(source, at, '[[ ', ` ]]${COUNT}`),
    kind: 'subloop',
    label: null,
    at,
  });

  // The construct asked for where it fits, the other where only the other does:
  // AddmusicK holds one of each, in either order, so the depth is what runs out
  // and not the button. `INSTEAD` in `catalog.ts` is the readout for the swap.
  const [first, second] = want === 'loop' ? [loopFits, subFits] : [subFits, loopFits];
  if (first) {
    return want === 'loop' ? loop() : subloop();
  }

  if (second) {
    return want === 'loop' ? subloop() : loop();
  }

  return { refused: WRAP_DEEP };
}

/**
 * What a click on **Loop call** would write at the caret, or why it cannot.
 *
 * The body is the nearest labelled declaration **above** the caret, which is not
 * a preference but the rule: `parseLoopStart` writes `loopPointers` at the
 * opening bracket and `parseLabelLoop` refuses a label that is not in there yet
 * (AMK0115), so a call can only ever name a loop the parser has already read.
 * Nearest rather than lowest-numbered because that is what a porter means by
 * "again", and it is the body a `*` written here would play.
 */
export function callVerdict(request: {
  source: string;
  index: TokenIndex;
  reading: LoopReading;
  caret: number;
}): CallVerdict {
  const { source, reading, caret } = request;
  if (!reading.sound) {
    return { refused: BRACKETS_UNPAIRED };
  }

  // `parseLabelLoop` and `parseStarLoop` both refuse outright while the parser is
  // writing the loop block — a call inside a `[ ]` body is AMK0112. A `[[ ]]`
  // leaves `channel` alone, so a call inside a subloop is fine.
  if (loopStateAt(reading, caret).inCall) {
    return { refused: CALL_NESTED };
  }

  const above = loopTargets(reading, caret);
  if (above.length === 0) {
    return { refused: CALL_NONE };
  }

  const nearest = above[above.length - 1];

  const body = `(${nearest.label})${COUNT}`;
  const { before, after } = padAround(source, caret);
  const text = `${before}${body}${after}`;
  const digits = text.lastIndexOf(String(COUNT));

  return {
    label: nearest.label,
    text,
    countAt: { start: digits, end: digits + String(COUNT).length },
  };
}

/** The one splice, and where the count lands afterwards. */
export function callEdits(offer: CallOffer, caret: number): Edit[] {
  const edit = insertAt(caret, offer.text);
  return edit === null ? [] : [edit];
}

export function callSelection(offer: CallOffer, caret: number): { anchor: number; head: number } {
  return { anchor: caret + offer.countAt.start, head: caret + offer.countAt.end };
}

/** The two splices, one at each end, so everything between them survives as written. */
export function wrapEdits(offer: WrapOffer): Edit[] {
  const edits = [
    insertAt(offer.at.start, offer.open, offer.at.line),
    insertAt(offer.at.end, offer.close, offer.at.line),
  ];

  return edits.filter((edit): edit is Edit => edit !== null);
}

/** Where the caret lands afterwards: the count, in the document the batch leaves. */
export function wrapSelection(offer: WrapOffer): { anchor: number; head: number } {
  const base = offer.at.end + offer.open.length;
  return { anchor: base + offer.countAt.start, head: base + offer.countAt.end };
}

/**
 * Padding and the count's own offsets.
 *
 * MML is whitespace-separated, so a bracket lands beside a space where the
 * neighbouring character is not one — `padAround`'s rule, read at the run's two
 * ends.
 */
function offerOf(
  source: string,
  at: Span,
  open: string,
  close: string,
): { open: string; close: string; countAt: { start: number; end: number } } {
  const { before, after } = padAround(source, at.start, at.end);
  const digits = /\d+/.exec(close);
  return {
    open: `${before}${open}`,
    close: `${close}${after}`,
    countAt: digits
      ? { start: digits.index, end: digits.index + digits[0].length }
      : { start: close.length, end: close.length },
  };
}

/**
 * Where the closing bracket goes: past the last note, and past a `$DD` riding on
 * it.
 *
 * `$DD` is not dispatched — the note before it reads it by peeking at the byte
 * standing at the track pointer (`main.asm:L_10E4`) — so a bracket written
 * between the two puts the body's own `$00` where the slide was, and the note
 * stops bending. `afterBend` in `roll-write.ts` moves an anchor for the same
 * reason.
 */
function tailAfter(index: TokenIndex, channel: number, last: Command): number {
  let end = last.span.end;
  for (const command of index.commands) {
    if (command.channel !== channel || command.span.start < end) {
      continue;
    }

    if (command.vcmd !== 0xdd) {
      break;
    }

    end = command.span.end;
  }

  return end;
}
