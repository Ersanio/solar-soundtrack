import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';

/**
 * The note values a gesture may land on, and the steps between them.
 *
 * A note in MML is a duration rather than a region, so a length snaps to what
 * one length token can spell rather than to the grid — a start snaps to the
 * grid, and the two are different questions.
 */

/**
 * Every duration a note can be written as one length token, in ticks.
 *
 * `1`, `2`, `4`… and their dotted forms — exactly the set `spellLength` can
 * spell without falling back to `=N` — which is what a stretch snaps to. A
 * start snaps to the grid and a length snaps to this, because a note in MML is
 * a duration rather than a region and the porter thinks in note values.
 */
export const NOTE_LENGTHS: readonly number[] = (() => {
  const ticks = new Set<number>();
  for (let divisor = 1; divisor <= TICKS_PER_WHOLE; divisor++) {
    if (TICKS_PER_WHOLE % divisor !== 0) {
      continue;
    }

    const base = TICKS_PER_WHOLE / divisor;
    const half = Math.floor(base / 2);
    ticks.add(base);
    ticks.add(base + half);
    ticks.add(base + half + Math.floor(half / 2));
  }

  // A dotted whole note is past what one token holds, and `spellLength` says so
  // by answering `null` — so the rungs stop where the spelling does.
  return [...ticks].filter((each) => each <= TICKS_PER_WHOLE).sort((a, b) => a - b);
})();

/** The nearest length a note can be written as, at or above one tick. */
export function snapDuration(ticks: number): number {
  if (ticks <= NOTE_LENGTHS[0]) {
    return NOTE_LENGTHS[0];
  }

  // Past a whole note the ladder repeats: a tie is whole notes and a remainder,
  // so the same rungs are what a longer note lands on.
  const whole = Math.max(0, Math.floor((ticks - 1) / TICKS_PER_WHOLE)) * TICKS_PER_WHOLE;
  const left = ticks - whole;
  let nearest = NOTE_LENGTHS[0];
  for (const rung of NOTE_LENGTHS) {
    if (Math.abs(rung - left) < Math.abs(nearest - left)) {
      nearest = rung;
    }
  }

  return whole + nearest;
}

/**
 * The lengths the wheel steps a drawn note through, in ticks.
 *
 * The fourteen denominators that divide a whole note exactly — `l1`, `l2`, `l3`,
 * `l4`, `l6` … `l192` — which is the set the inspector's `l` slider stops on.
 * A stretch snaps to {@link NOTE_LENGTHS}, dotted rungs and all; a wheel does
 * not, because twice the rungs is twice the turns it takes to cross the ladder.
 */
export const DRAW_LENGTHS: readonly number[] = NOTE_LENGTHS.filter(
  (ticks) => TICKS_PER_WHOLE % ticks === 0,
);

/**
 * The next rung up (`1`) or down (`-1`) from a length, in ticks.
 *
 * The first rung strictly past `ticks` in the direction asked, so a length that
 * is not on the ladder at all — a tick-precise stretch, or one longer than a
 * whole note — is brought onto it by the first turn rather than ignored.
 */
export function stepDrawLength(ticks: number, direction: number): number {
  if (direction > 0) {
    return DRAW_LENGTHS.find((rung) => rung > ticks) ?? DRAW_LENGTHS[DRAW_LENGTHS.length - 1];
  }

  let below = DRAW_LENGTHS[0];
  for (const rung of DRAW_LENGTHS) {
    if (rung < ticks) {
      below = rung;
    }
  }

  return below;
}

/** A tick snapped to the grid the porter chose. `0` snaps to nothing. */
export function snapTick(tick: number, snap: number): number {
  return snap > 0 ? Math.round(tick / snap) * snap : Math.round(tick);
}
