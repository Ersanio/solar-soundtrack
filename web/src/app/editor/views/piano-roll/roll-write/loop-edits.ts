/** The loop box's gestures: its edge opening a gap or joining a split loop back up, and its ends resizing the body. */

import { spellRest } from '@amk/core/mml-text';
import type { LoopRun } from '@amk/spc/song-walk';
import { commandScope } from '@amk/tokens/commands/in-force';
import { MAX_LOOP_COUNT } from '@amk/tokens/commands/loops';
import { type Edit, insertAt, padAround, spliceOut, spliceRange } from '@amk/tokens/edits';
import {
  type EditContext,
  type Refusal,
  isEdits,
  REFUSE_LOOP_BODY_ROOM,
  REFUSE_LOOP_LEAD_ROOM,
  REFUSE_LOOP_LEFT_PASS,
  REFUSE_NESTED_LOOP,
  REFUSE_SPELL,
  REFUSE_SUB_SPLIT,
} from '../roll-edit';
import type { LoopSite, Strip, StripFrame, StripItem } from '../roll-strip';
import { refuse, spliceUnit } from './splice';
import { collapse, padChannels } from './gaps';

/**
 * How far the gap gesture may drag a construct leftward: the rest ticks
 * directly in front of it that can go without moving anything else.
 *
 * Closing space moves every command written after it, so a command in the
 * construct's own prefix leaves no slack at all, and a rest whose prefix holds
 * one may itself be consumed — the command stands before it and keeps its tick
 * — but ends the walk there: taking anything earlier would slide it. A rest
 * with a command **inside** its unit is a barrier outright, a respelling to
 * `r…` eating the command's text; so is one whose unit `growUnits` widened
 * past its own segments, which holds an `o` the same way, and one carrying a
 * `$DD`, which rides whatever stands in front of it.
 */
export function gapSlack(strip: Strip, at: number): number {
  return slackBefore(strip, at).ticks;
}

/**
 * {@link gapSlack}'s walk, with the item a full close would leave the construct
 * against.
 *
 * `abuts` is `null` where nothing is left standing there to name: the walk
 * stopped on a rest whose prefix holds a command, which keeps its tick and so
 * stays between the two, or it ran back off the root frame's start. Where the
 * item directly in front is not a rest at all the slack is 0 and `abuts` is
 * that item, which is how a pair already touching is told from a pair with
 * something between them.
 */
function slackBefore(strip: Strip, at: number): { ticks: number; abuts: number | null } {
  const root = strip.frames[0];
  const construct = strip.items[at];
  if (!construct || holdsCommands(strip, construct.prefixSpan.start, construct.prefixSpan.end)) {
    return { ticks: 0, abuts: null };
  }

  let ticks = 0;
  for (let index = at - 1; index >= root.from; index--) {
    const rest = strip.items[index];
    if (!respellable(strip, rest)) {
      return { ticks, abuts: index };
    }

    ticks += rest.ticks;
    if (holdsCommands(strip, rest.prefixSpan.start, rest.prefixSpan.end)) {
      return { ticks, abuts: null };
    }
  }

  return { ticks, abuts: null };
}

/**
 * Anything with a tick of its own written in `[from, to)`: `note-state` and
 * `song` commands, and a remote `$FC` call, which is no item and hides in a
 * prefix.
 *
 * A note or rest token is its item, `o` and `l` are parse state with no tick,
 * and both are how the windows that read this stay readable at all.
 */
function holdsCommands(strip: Strip, from: number, to: number): boolean {
  return strip.commands.some(
    (command) =>
      command.span.start >= from &&
      command.span.start < to &&
      command.noteLength === undefined &&
      commandScope(command) !== 'position',
  );
}

/**
 * Whether a rest's length may be rewritten or its unit taken out whole.
 *
 * A rest with a command **inside** its unit is a barrier outright, a respelling
 * to `r…` eating the command's text; so is one whose unit `growUnits` widened
 * past its own segments, which holds an `o` the same way, and one carrying a
 * `$DD`, which rides whatever stands in front of it.
 */
function respellable(strip: Strip, item: StripItem | undefined): boolean {
  if (item?.kind !== 'rest' || item.bend !== null) {
    return false;
  }

  const head = item.segments[0];
  const tail = item.segments[item.segments.length - 1];
  return (
    item.unitSpan.start === head?.span.start &&
    item.unitSpan.end === tail?.span.end &&
    !holdsCommands(strip, item.unitSpan.start, item.unitSpan.end)
  );
}

/**
 * The rests at one end of a loop's body, in text order, and what they come to.
 *
 * {@link gapSlack}'s walk turned round for a frame's own interior, and it stops
 * for the same reasons — plus one of its own: anything with a tick between the
 * run and the bracket ends it, since a command written past the body's last rest
 * runs after them and changing their length would move it.
 */
export function bodyRests(
  strip: Strip,
  frame: StripFrame,
  edge: 'start' | 'end',
): { rests: StripItem[]; ticks: number } {
  const step = edge === 'end' ? -1 : 1;
  const from = edge === 'end' ? frame.to - 1 : frame.from;
  const rests: StripItem[] = [];
  let ticks = 0;

  for (let index = from; index >= frame.from && index < frame.to; index += step) {
    const rest = strip.items[index];
    if (!respellable(strip, rest)) {
      break;
    }

    // The run is written over as one piece, so a command standing between two of
    // its members would be eaten; one before the whole run keeps its tick.
    const bracket =
      edge === 'end'
        ? holdsCommands(strip, rest.unitSpan.end, frame.span.end)
        : holdsCommands(strip, rest.prefixSpan.start, rest.unitSpan.start);
    if (bracket) {
      break;
    }

    rests.push(rest);
    ticks += rest.ticks;
  }

  return { rests: edge === 'end' ? rests.reverse() : rests, ticks };
}

/** The voice's earliest entry into a body — the one occurrence whose start can move. */
export function firstPassOn(frame: StripFrame, channel: number): number {
  let first = Number.POSITIVE_INFINITY;
  for (const run of frame.runs) {
    if (run.channel === channel) {
      for (const pass of run.passes) {
        first = Math.min(first, pass.tick);
      }
    }
  }

  return first;
}

/**
 * How many of the voice's passes of this body begin before `tick`, and whether
 * one of them ends exactly on it.
 *
 * The count is how far a pass's own box travels per tick the body gains: pass
 * `j` begins `j × delta` later, so its far end moves by `(j + 1) × delta` and a
 * handle that is to follow the pointer asks for a `delta` that much smaller.
 *
 * `abuts` settles the seam where two passes meet, which is every interior edge
 * of a loop: the two boxes' handles overlap there and only the left one's right
 * end has an answer, a later pass's start not being a thing that can move.
 */
export function passesAt(
  frame: StripFrame,
  channel: number,
  tick: number,
): { before: number; abuts: boolean } {
  let before = 0;
  let abuts = false;
  for (const run of frame.runs) {
    if (run.channel !== channel) {
      continue;
    }

    for (const pass of run.passes) {
      before += pass.tick < tick ? 1 : 0;
      abuts ||= pass.tick + pass.ticks === tick;
    }
  }

  return { before, abuts };
}

/** The token a recall repeats itself with: its own `(n)`, or a bare `*`. */
function recallHead(source: string, site: LoopSite): string {
  if (site.label === null) {
    return '*';
  }

  return source.slice(site.text.start, source.indexOf(')', site.text.start) + 1);
}

/**
 * The construct a full leftward close would put this one back against, and the
 * count the two would play as one.
 *
 * Two occurrences of one body with nothing between them are one construct
 * written twice, which is the split {@link openGap} writes read backwards. The
 * body is named by its first byte's ARAM address, so two identically spelled
 * bodies are two bodies and never join.
 *
 * `null` where the pair cannot be spelled as one: a right-hand half that is not
 * a recall — a body's first occurrence is always the left one — anything but
 * the rests standing between them, or a total past {@link MAX_LOOP_COUNT},
 * where the gesture still closes the gap and simply leaves the two calls
 * standing.
 *
 * What may stand between them is asked of the **text**, and has to be: the
 * intro `/` has a tick and is no command at all — `gather` raises none for an
 * operator — so {@link holdsCommands} cannot see it, and a join written over
 * one would carry it past the whole occurrence and move the song's loop point
 * with every note still on its tick. Blank is what the split leaves, so the
 * round trip never meets this; a `;` comment and a stray `o5` are turned away
 * with it, which is the price of asking a question the safe set cannot answer.
 *
 * The counts come off the walk and never off the digits: a count written
 * through a `"REP=4"` replacement has none to read.
 */
export function loopJoin(
  source: string,
  strip: Strip,
  at: number,
  run: LoopRun,
): { at: number; count: number } | null {
  const item = strip.items[at];
  const { abuts } = slackBefore(strip, at);
  if (abuts === null || item.frame !== 0 || item.loop?.kind !== 'recall') {
    return null;
  }

  const before = strip.items[abuts];
  const sibling = before.loop;
  if (before.kind !== 'construct' || before.address !== item.address || sibling === null) {
    return null;
  }

  // A `[[ ]]` names no body a recall could reach, so the address test turns one
  // away before this does; said rather than inferred, because the half that
  // stays is the one being handed a count and a `$E6` pair has nowhere to take
  // one — `close` is null and `label` is null, which spells `*n` over it.
  if (sibling.kind === 'sub') {
    return null;
  }

  for (let index = abuts + 1; index <= at; index++) {
    const gap = source.slice(
      strip.items[index - 1].unitSpan.end,
      strip.items[index].unitSpan.start,
    );
    if (gap.trim() !== '') {
      return null;
    }
  }

  // The sibling's own run and not `passesAt`, which counts every earlier pass
  // of the body the voice plays: the partner is the nearest occurrence, which
  // is the only reading whose ticks close.
  const body = strip.frames.find((frame) => frame.body === item.address);
  const played = body?.runs.find(
    (each) => each.channel === run.channel && each.passes[0]?.tick === before.instances[0]?.tick,
  );
  const count = (played?.passes.length ?? 0) + run.passes.length;
  return played && count <= MAX_LOOP_COUNT ? { at: abuts, count } : null;
}

/**
 * The two halves written as the one construct they play as: the count of the
 * half in front becomes the total, and the half behind goes.
 *
 * The surviving half keeps its own spelling — a declaration's `]n`, a `(n)m` or
 * a `*n` — because what makes the two joinable is that they play the same body,
 * and that says nothing about how either was written.
 */
function joinInto(context: EditContext, site: LoopSite, sibling: LoopSite, count: number): Edit[] {
  const { source } = context;
  const target = sibling.kind === 'declaration' ? sibling.close : sibling.text;
  if (target === null) {
    return [];
  }

  const text =
    sibling.kind === 'declaration' ? `]${count}` : `${recallHead(source, sibling)}${count}`;
  const counted = spliceRange(source, target, text);
  const removed = spliceOut(source, site.text);
  return [counted, removed].filter((edit): edit is Edit => edit !== null);
}

/**
 * `ticks` of rest written in front of a construct, so the whole occurrence
 * starts that much later.
 *
 * After the construct's prefix commands, which keep their tick by running before
 * it, and never abutting the text in front of it without a space.
 */
function openBefore(context: EditContext, site: LoopSite, ticks: number): Edit[] | Refusal {
  const text = spellRest(ticks, context.targetAMKVersion);
  if (text === null) {
    return refuse(REFUSE_SPELL);
  }

  const { source } = context;
  const start = site.text.start;
  const lead = padAround(source, start).before;
  const opened = insertAt(start, `${lead}r${text} `, site.text.line);
  return opened ? [opened] : [];
}

/**
 * `need` ticks taken out of the free space in front of a construct, so the whole
 * occurrence starts that much earlier.
 *
 * Only ever the rests {@link gapSlack} prices, spliced from the construct
 * backward, and it refuses rather than doing part of the job: a body already
 * grown at its head cannot be handed a partial close.
 */
function closeBefore(context: EditContext, at: number, need: number): Edit[] | Refusal {
  const { source, strip, targetAMKVersion } = context;
  if (need > gapSlack(strip, at)) {
    return refuse(REFUSE_LOOP_LEAD_ROOM);
  }

  const edits: Edit[] = [];
  let left = need;

  for (let index = at - 1; index >= strip.frames[0].from && left > 0; index--) {
    const rest = strip.items[index];
    if (left >= rest.ticks) {
      const removed = spliceOut(source, rest.unitSpan);
      if (removed) {
        edits.push(removed);
      }

      left -= rest.ticks;
      continue;
    }

    const text = spellRest(rest.ticks - left, targetAMKVersion);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const shortened = spliceUnit(source, rest.unitSpan, `r${text}`);
    if (shortened) {
      edits.push(shortened);
    }

    left = 0;
  }

  return left > 0 ? refuse(REFUSE_LOOP_LEAD_ROOM) : edits;
}

/**
 * The loop box's top or bottom edge dragged: `delta` ticks of time put in (or
 * taken out) where pass `pass` of `run` begins, everything on that voice from
 * there on sliding by the same amount.
 *
 * Time in means a tied rest; where the grab was mid-run, the recall's count is
 * split around it — `(1)5` grabbed at its third pass becomes `(1)2 r… (1)3`,
 * a declaration's `]3` becomes `] r… *2` (or its own label where it has one) —
 * and both halves replay the same body bytes, a recall's whole parse output
 * being its `$E9` (`parser.ts:2177-2257`, `Music.cpp:1003-1199`). The `*` a
 * declaration split writes directly follows its own `]` with only rests
 * between, and `prevLoop` is set by nothing but a normal `[`
 * (`parser.ts:2469`), so it recalls that declaration on every target. Counts
 * are written only above 1, and never with a space in front — `getInt` skips
 * none (`parser.ts:555`), so `(1) 2` would be `(1)1` and a stray character.
 *
 * Time out is only ever free space: the rests {@link gapSlack} prices, spliced
 * from the construct backward. The gesture and this clamp through the one
 * function, so what the drag allowed is what is written. Spending the whole of
 * that slack closes the gap, and where the occurrence in front plays the same
 * body the two are written back up as one construct with the counts added
 * ({@link loopJoin}) — the split above, read backwards.
 */
export function openGap(
  context: EditContext,
  at: number,
  run: LoopRun,
  pass: number,
  delta: number,
): Edit[] | Refusal {
  const { source, strip, targetAMKVersion } = context;
  const item = strip.items[at];
  const site = item?.loop;
  if (!item || !site || delta === 0) {
    return [];
  }

  // A construct inside another loop's body has no song-time text position to
  // move: its text plays wherever the outer loop does. The press refuses this
  // before a drag begins; this is the same answer for a caller that did not.
  if (item.frame !== 0) {
    return refuse(REFUSE_NESTED_LOOP);
  }

  const edits: Edit[] = [];

  if (delta > 0 && pass === 0) {
    // The whole occurrence moves.
    const opened = openBefore(context, site, delta);
    if (!isEdits(opened)) {
      return opened;
    }

    edits.push(...opened);
  } else if (delta > 0) {
    if (site.kind === 'sub') {
      return refuse(REFUSE_SUB_SPLIT);
    }

    const total = run.passes.length;
    if (pass >= total) {
      return [];
    }

    const text = spellRest(delta, targetAMKVersion);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const head = recallHead(source, site);
    const first = pass > 1 ? String(pass) : '';
    const second = total - pass > 1 ? String(total - pass) : '';
    const split =
      site.kind === 'recall'
        ? spliceRange(source, site.text, `${head}${first} r${text} ${head}${second}`)
        : site.close && spliceRange(source, site.close, `]${first} r${text} ${head}${second}`);
    if (!split) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(split);
  } else {
    if (pass !== 0) {
      return [];
    }

    const slack = gapSlack(strip, at);
    const need = Math.min(-delta, slack);
    if (need <= 0) {
      return [];
    }

    const closed = closeBefore(context, at, need);
    if (!isEdits(closed)) {
      return closed;
    }

    edits.push(...closed);

    // Spending the whole slack puts the construct back against the occurrence
    // in front of it, and two occurrences of one body touching are one
    // construct written twice. A close that stops short leaves a gap, which is
    // still two.
    const join = need === slack ? loopJoin(source, strip, at, run) : null;
    const sibling = join === null ? null : strip.items[join.at].loop;
    if (join && sibling) {
      edits.push(...joinInto(context, site, sibling, join.count));
    }
  }

  // The voice's end moves with everything after the split, and a moved note
  // past the song's end pads the other channels out to it, as a dragged one
  // does — the tail was written to be heard where it is going.
  const tail = context.channels[run.channel];
  const reach = (tail?.ticks ?? 0) + delta;
  if (delta > 0 && reach > context.playableTicks) {
    const padded = padChannels(context, reach, new Map([[run.channel, delta]]));
    if (padded === null) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(...padded);
  }

  return edits.sort((a, b) => a.span.start - b.span.start);
}

/**
 * The loop box's left or right end dragged: the body's own length changed by
 * `delta` ticks — grown by a rest at that end, shrunk by taking that end's rests
 * away — so every pass of it grows or tightens together.
 *
 * The two ends differ in what pays for the change. The **right** end puts the
 * ticks at the body's tail and the construct stands still, so the voice's music
 * runs `passes × delta` longer. The **left** end puts them at the body's head
 * and pulls the construct back by the same amount, so the grabbed occurrence's
 * first pass plays exactly where it played — a note at body-local `x` becomes
 * `(t0 - delta) + delta + x` — and the voice's end moves by one delta less, that
 * one having come out of the rests in front rather than been added to the song.
 * Which is why the left end is the **first occurrence's** alone: a later one's
 * start is carried by the passes before it, and no rest in front can hold it
 * still.
 *
 * It writes its own splices rather than going through {@link planEdits}, which
 * moves no note here and would have nothing to say. And it is the one gesture
 * that may rewrite a body's trailing rests: {@link realiseRegion} leaves a tail
 * alone deliberately — a channel ends where its music ends, and a deletion must
 * not silently shorten the loop — where this gesture's whole subject is that
 * length.
 */
export function resizeLoop(
  context: EditContext,
  at: number,
  body: StripFrame,
  grabbed: number,
  edge: 'start' | 'end',
  delta: number,
): Edit[] | Refusal {
  const { strip, targetAMKVersion } = context;
  const item = strip.items[at];
  const site = item?.loop;
  if (!item || !site || delta === 0) {
    return [];
  }

  if (edge === 'start') {
    // The construct has to move, and one inside another body has no song-time
    // position to move to: its text plays wherever the outer loop does.
    if (item.frame !== 0) {
      return refuse(REFUSE_NESTED_LOOP);
    }

    if (grabbed !== firstPassOn(body, strip.channel)) {
      return refuse(REFUSE_LOOP_LEFT_PASS);
    }
  }

  const edits: Edit[] = [];
  const run = bodyRests(strip, body, edge);
  const want = run.ticks + delta;
  if (want < 0) {
    return refuse(REFUSE_LOOP_BODY_ROOM);
  }

  if (run.rests.length > 0) {
    const written = collapse(context, run.rests, want);
    if (written === null) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(...written);
  } else {
    // Nothing at that end to grow, so a rest of its own — at the very edge of
    // the body's interior, which for the head is what keeps a command written
    // there on its tick: it runs at body-local `delta`, and the pass begins
    // `delta` earlier.
    const text = spellRest(delta, targetAMKVersion);
    if (text === null) {
      return refuse(REFUSE_SPELL);
    }

    const anchor = edge === 'end' ? body.span.end : body.span.start;
    // A bracket is its own separator, so only a token in front of the rest needs
    // a space put between them.
    const lead = /[\s[\]]/.test(context.source[anchor - 1] ?? '[') ? '' : ' ';
    const spaced = insertAt(
      anchor,
      edge === 'end' ? `${lead}r${text}` : `${lead}r${text} `,
      body.span.line,
    );
    if (spaced) {
      edits.push(spaced);
    }
  }

  if (edge === 'start') {
    const moved = delta > 0 ? closeBefore(context, at, delta) : openBefore(context, site, -delta);
    if (!isEdits(moved)) {
      return moved;
    }

    edits.push(...moved);
  }

  // Every voice that plays this body gets `its own passes × delta` longer; the
  // one whose construct moved gives a delta back, the rests in front having paid
  // for it. A moved note past the song's end pads the other channels out to meet
  // it, as a dragged one does.
  const grown = new Map<number, number>();
  for (const each of body.runs) {
    grown.set(each.channel, (grown.get(each.channel) ?? 0) + each.passes.length * delta);
  }

  if (edge === 'start') {
    grown.set(strip.channel, (grown.get(strip.channel) ?? 0) - delta);
  }

  let reach = 0;
  for (const [voice, by] of grown) {
    reach = Math.max(reach, (context.channels[voice]?.ticks ?? 0) + by);
  }

  if (delta > 0 && reach > context.playableTicks) {
    const padded = padChannels(context, reach, grown);
    if (padded === null) {
      return refuse(REFUSE_SPELL);
    }

    edits.push(...padded);
  }

  return edits.sort((a, b) => a.span.start - b.span.start);
}
