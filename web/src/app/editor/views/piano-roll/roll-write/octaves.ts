/** Which `o`, `<` and `>` an edit reads, keeps, writes or drops, so every note still sounds in the octave it was written in. */

import { octaveFor, spellOctave } from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import { tokenize } from '@amk/tokens';
import type { Edit } from '@amk/tokens/edits';
import type { EditContext, PlacedNote } from '../roll-edit';
import { octaveModel } from '../roll-octave';
import { channelMarkers, type Strip, type StripFrame, type StripItem } from '../roll-strip';
import { removeSpan } from './splice';
import { interiorFrom, type Region } from './regions';

/**
 * Whether a note sets its own absolute octave, so an octave put back in front of
 * it would be saying the same thing twice.
 *
 * Including a note this same plan is moving: transposing a run of four would
 * otherwise write `o5 c o4 o5 d o4 o5 e o4 o5 f`, where every restore is undone
 * by the octave immediately after it.
 */
export function writesItsOwnOctave(
  strip: Strip,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
): boolean {
  const note = strip.items[index];
  const planned = survivors.get(index);
  return (
    note.hasLeadingOctave || (planned?.drum === null && octaveFor(planned.written) !== note.octave)
  );
}

/** Whether a run is being written into the region straight after `index`, or the one ending at it. */
function runAfter(regions: readonly Region[], index: number): boolean {
  return regions.some((region) => region.after === index && region.born.length > 0);
}

export function runBefore(regions: readonly Region[], index: number): boolean {
  return regions.some((region) => region.before === index && region.born.length > 0);
}

/** Whether a run is laid over the item, which takes its whole unit out. */
export function underRun(regions: readonly Region[], frame: StripFrame, index: number): boolean {
  return regions.some(
    (region) =>
      region.born.length > 0 && index >= interiorFrom(region, frame) && index < region.before,
  );
}

/**
 * What the edited text does with the octave first, after `index`'s unit.
 *
 * `'read'` where a note, a loop or a run being written reads it before anything
 * sets it, `'set'` where a note writes its own first, `'end'` where nothing
 * follows. A note being removed takes its own `o`s and its read with it; what is
 * written between its segments stays, and so does everything between units.
 *
 * Past the end of a body the text runs on into whatever follows the closing
 * bracket, which another frame of the same gesture may be rewriting, so that
 * answers `'read'`. Past the end of the channel it is the document's own next
 * event, `octave` being one variable that a `#N` does not reset.
 */
function octaveNext(
  context: EditContext,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
  regions: readonly Region[],
): 'read' | 'set' | 'end' {
  const { strip, frame } = context;
  const { octaves } = strip;
  if (runAfter(regions, index)) {
    return 'read';
  }

  let from = strip.items[index].unitSpan.end;
  for (let at = index + 1; at < frame.to; at++) {
    const item = strip.items[at];
    const between = octaves.first(from, item.unitSpan.start);
    if (between !== null) {
      return between;
    }

    if (item.kind === 'construct') {
      // A body written here reads what its text reads first; a recall parses no
      // notes, and the octave passes it by.
      const inner = octaves.first(item.unitSpan.start, item.unitSpan.end);
      if (inner !== null) {
        return inner;
      }

      from = item.unitSpan.end;
      continue;
    }

    if (item.kind === 'note' && survivors.has(at)) {
      return writesItsOwnOctave(strip, at, survivors) ? 'set' : 'read';
    }

    if (item.kind === 'note') {
      // A removed note: its read goes, and so do its own `o`s but the ones kept.
      const head = item.segments[0];
      const last = item.segments[item.segments.length - 1];
      const kept = underRun(regions, frame, at)
        ? { lead: false, trail: false }
        : keptOctaves(context, item);
      const found =
        (kept.lead ? octaves.first(item.unitSpan.start, head.span.start) : null) ??
        octaves.first(head.span.end, last.span.start) ??
        (kept.trail ? octaves.first(last.span.end, item.unitSpan.end) : null);
      if (found !== null) {
        return found;
      }
    } else {
      const found = octaves.first(item.unitSpan.start, item.unitSpan.end);
      if (found !== null) {
        return found;
      }
    }

    from = item.unitSpan.end;
  }

  return frame.body >= 0 ? 'read' : octaves.next(from);
}

/**
 * The octave to put back after a note whose own has been rewritten: the one in
 * force after the unit as it was written, or `null` where nothing reads it
 * before something sets it again ({@link octaveNext}).
 */
export function exitOctaveFor(
  context: EditContext,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
  regions: readonly Region[],
): number | null {
  const item = context.strip.items[index];
  const exit = item.exitOctave ?? item.octave;
  return octaveNext(context, index, survivors, regions) === 'read' ? exit : null;
}

/**
 * The octaves a drum's own unit carried, as the text to put back around it.
 *
 * `leadsAUnit` takes an `o` as well as a percussion `@` (`roll-strip.ts`), so a
 * drum's unit reaches over its `@` to an octave written beside it — and a drum
 * is written `@21 c<length>`, the letter having no say in the byte, so
 * {@link noteText} spells none and the splice would take that `o` away. It is
 * the octave every note after the drum is standing in, and a lane change says
 * nothing about it, so it is **restated** rather than respelled. `null` where
 * `o` cannot reach what was written.
 */
export function drumOctaves(item: StripItem): { lead: string; exit: string } | null {
  // `channelStrip` refuses a channel whose note it cannot read an octave from,
  // so `-1` is unreachable rather than a case with an answer — and it refuses
  // through `spellOctave`, since dropping the `o` is the whole failure here.
  const lead = item.hasLeadingOctave ? spellOctave(item.octave ?? -1) : '';
  // Only an `o` the unit holds after its last segment; one standing between its
  // segments is not part of the splice and stays.
  const trailing = item.unitSpan.end > item.segments[item.segments.length - 1].span.end;
  const exit = !trailing || item.exitOctave === null ? '' : spellOctave(item.exitOctave);
  if (lead === null || exit === null) {
    return null;
  }

  return { lead: lead === '' ? '' : `${lead} `, exit: exit === '' ? '' : ` ${exit}` };
}

/**
 * Which of a removed note's own `o`s stay in the text: one something still reads,
 * so the notes after it keep the octave they were written under with nothing put
 * back. One that only ever fed this note is dropped with it. Not where the unit
 * also holds the drum `@` this note consumed, which goes with it.
 */
export function keptOctaves(
  context: EditContext,
  item: StripItem,
): { lead: boolean; trail: boolean } {
  const { octaves } = context.strip;
  const head = item.segments[0];
  const last = item.segments[item.segments.length - 1];
  const fedDrum =
    item.drum !== null &&
    item.drum.span.start >= item.unitSpan.start &&
    item.drum.span.start < head.span.start;
  return {
    lead: item.hasLeadingOctave && !fedDrum && octaves.next(head.span.end) === 'read',
    trail: item.unitSpan.end > last.span.end && octaves.next(item.unitSpan.end) === 'read',
  };
}

/**
 * The porter's own `o`, `<` and `>` an edit has left with nothing to read them —
 * read by something before it and by nothing after — taken out, so an edit leaves
 * no octave standing in front of another that undoes it.
 *
 * Only the edited channel's, and only text no edit touches. Taking out an octave
 * nothing reads changes no note, so this is spelling and never music.
 */
export function deadOctaves(context: EditContext, sorted: readonly Edit[]): Edit[] {
  const { source, strip, frame } = context;
  if (sorted.length === 0) {
    return [];
  }

  const index = tokenize(source);
  const markers = channelMarkers(index, source);
  /** The channel a root offset is written on; `-1` above the first marker. */
  const owner = (offset: number): number => {
    let channel = -1;
    for (const marker of markers) {
      if (marker.start > offset) {
        break;
      }

      channel = marker.channel;
    }

    return channel;
  };

  // A body's text is its own frame's, which the same gesture may be rewriting.
  const inBody = (offset: number): boolean =>
    strip.frames.some(
      (each) =>
        each !== frame &&
        each.body >= 0 &&
        offset >= each.span.start &&
        offset < each.span.end &&
        (frame.body < 0 || each.span.start >= frame.span.start),
    );
  const ours = (offset: number): boolean =>
    !inBody(offset) &&
    (frame.body >= 0
      ? offset >= frame.span.start && offset < frame.span.end
      : owner(offset) === strip.channel);

  const candidates: Span[] = [
    ...index.tokens
      .filter((token) => token.kind === 'octaveShift')
      .map((token) => ({ start: token.start, end: token.end, line: token.line })),
    ...index.commands
      .filter(
        (command) =>
          command.kind.toLowerCase() === 'o' &&
          command.replacement === undefined &&
          !command.inRemoteDefinition,
      )
      .map((command) => command.span),
  ];

  let text = '';
  let cursor = 0;
  /** Where each edit's own text lands in the edited text. */
  const written: { start: number; end: number }[] = [];
  for (const edit of sorted) {
    text += source.slice(cursor, edit.span.start);
    written.push({ start: text.length, end: text.length + edit.text.length });
    text += edit.text;
    cursor = edit.span.end;
  }

  text += source.slice(cursor);
  const after = octaveModel(text, tokenize(text));
  /** Where an offset no edit covers lands in the edited text. */
  const moved = (offset: number): number =>
    sorted.reduce(
      (at, edit) =>
        edit.span.end <= offset ? at + edit.text.length - (edit.span.end - edit.span.start) : at,
      offset,
    );

  const out: Edit[] = [];
  for (const span of candidates) {
    if (!ours(span.start)) {
      continue;
    }

    const gone = removeSpan(source, span);
    const from = gone[0]?.span.start ?? span.start;
    const touched = sorted.some(
      (edit) =>
        (edit.span.start < span.end && edit.span.end > from) ||
        (edit.span.start === edit.span.end && edit.span.start > from && edit.span.start < span.end),
    );
    const end = moved(span.start) + span.end - span.start;
    if (touched || after.next(end) === 'read') {
      continue;
    }

    // Read before the edit, or unread already and now standing straight in front
    // of an octave the edit wrote, which is the stacking `o4 o3` this is for — but
    // not where that octave is the one that overrode it before, rewritten in place.
    const next = after.nextAt(end);
    const was = strip.octaves.nextAt(span.end);
    const restated =
      was !== null && sorted.some((edit) => was >= edit.span.start && was < edit.span.end);
    const behindOurs =
      !restated &&
      next !== null &&
      written.some((range) => next >= range.start && next < range.end);
    if (strip.octaves.next(span.end) === 'read' || behindOurs) {
      out.push(...gone);
    }
  }

  return out;
}
