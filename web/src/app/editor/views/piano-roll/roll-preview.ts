import type { PlacedNote, Plan } from './roll-edit';
import type { LaneStack } from './roll-layout';
import { NOTE_GAP, ROW_GAP } from './roll-metrics';

/**
 * A gesture in flight, drawn over the song.
 *
 * The fourth picture, and the one that does not come off the walk: the other
 * three are built from `WalkNote`s and say what the song *is*, where this is
 * built from a `Plan` and says what a pointer still down would make of it.
 *
 * Angular-free and pinned by `rolltest` through the plans it draws.
 */

/** One bar of a gesture in flight: where it is, and what it means. */
export interface PreviewBar {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the roll draws over the song while a pointer is down. */
export interface Preview {
  /** The notes the gesture is moving, drawn solid in the channel's colour. */
  live: readonly PreviewBar[];
  /** The notes a push will shift, drawn as a striped outline with nothing in it. */
  pushed: readonly PreviewBar[];
  /** Where two notes would sound at once, drawn red over both. */
  clash: readonly PreviewBar[];
  /** Ticks a note is giving up to the gesture, drawn hatched over that note's own bar. */
  erased: readonly PreviewBar[];
  /** Why nothing will be committed, or `null`. The live bars are red while it is set. */
  refused: string | null;
}

/**
 * The row a planned note belongs on.
 *
 * The sibling of `rowOf`, for a note that does not exist yet and so has no
 * `WalkNote` to ask about. A drum's row is its instrument and a pitch's is its
 * written key, which is the same rule `rowOf` follows by a longer road.
 */
export function rowOfPlaced(
  note: { written: number; drum: number | null },
  stack: LaneStack,
): number {
  return note.drum === null
    ? (stack.rowOfKey.get(note.written - 0x80) ?? -1)
    : (stack.rowOfDrum.get(note.drum) ?? -1);
}

export interface PreviewRequest {
  plan: Plan;
  stack: LaneStack;
  zoom: number;
  rowHeight: number;
  /** The rows the clash wash covers, which is every row the plan touches. */
  rows: number;
}

/**
 * A gesture in flight, as boxes.
 *
 * Everything the porter sees while dragging comes off one {@link Plan}, so the
 * red wash and the striped bars can never disagree with what pointer-up will
 * commit — they are the same answer drawn twice rather than two answers.
 */
export function buildPreview(request: PreviewRequest): Preview {
  const { plan, stack, zoom, rowHeight } = request;
  // Structural rather than `PlacedNote`, so a run of erased ticks can be boxed
  // by the same arithmetic: all it needs is where it starts, how long it is, and
  // which row it belongs on.
  const box = (
    note: { startTick: number; ticks: number; written: number; drum: number | null },
    at: number,
    kind: string,
  ): PreviewBar | null => {
    const row = rowOfPlaced(note, stack);
    return row < 0
      ? null
      : {
          id: `${kind}:${at}:${note.startTick}`,
          x: note.startTick * zoom,
          y: row * rowHeight + ROW_GAP,
          w: Math.max(1, note.ticks * zoom - NOTE_GAP),
          h: Math.max(1, rowHeight - ROW_GAP * 2),
        };
  };

  const bars = (notes: readonly PlacedNote[], kind: string): PreviewBar[] =>
    notes.map((note, at) => box(note, at, kind)).filter((bar): bar is PreviewBar => bar !== null);

  return {
    live: bars(plan.touched, 'live'),
    pushed: bars(plan.pushed, 'pushed'),
    // A clash is a run of ticks rather than a note, so it is drawn down the
    // whole stack: the two notes it names are on different rows and a wash on
    // one of them would say the other was fine.
    clash: plan.clashes.map((clash, at) => ({
      id: `clash:${at}:${clash.from}`,
      x: clash.from * zoom,
      y: 0,
      w: Math.max(1, (clash.to - clash.from) * zoom),
      h: request.rows * rowHeight,
    })),
    // A run of ticks like a clash, but drawn on the row of the note giving them
    // up rather than down the stack: it names that one note, and it is that
    // note's own bar underneath it.
    erased: plan.erased
      .map((span, at) =>
        box(
          {
            startTick: span.from,
            ticks: span.to - span.from,
            written: span.written,
            drum: span.drum,
          },
          at,
          'erased',
        ),
      )
      .filter((bar): bar is PreviewBar => bar !== null),
    refused: plan.refused,
  };
}
