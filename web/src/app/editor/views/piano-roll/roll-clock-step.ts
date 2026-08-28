import { clamp } from '../../../util/math';

/**
 * How the roll's playhead moves between the driver's anchors.
 *
 * Pure arithmetic, no Angular, so `charttest` can import it — the composable
 * that feeds it is `roll-clock.ts`, which cannot be imported from a harness
 * because it starts an effect and a frame callback. The two are apart for the
 * same reason `slider-track.ts` is apart from `slider.ts`.
 */

/** How fast the display closes a gap with the driver, in gaps per second. */
const CATCH_UP = 6;
/** A target this much music *ahead* is not drift; it is a seek. */
const SNAP_SECONDS = 1;
/**
 * A target this much music *behind* is not drift either; it is a loop wrap or a
 * seek backwards.
 *
 * A bound of its own, and much the smaller of the two, because the display only
 * ever trails: the ease settles `rate / CATCH_UP` — a sixth of a second of music
 * — behind the anchor and never overshoots it, so anything ahead of that is the
 * anchor having moved back. Sizing the backwards case off {@link SNAP_SECONDS}
 * instead cannot see a wrap at all on a short loop, since the anchor is folded
 * into one pass and the whole jump a wrap can make is one trip round it: `aaaa`
 * at `t54` is 96 ticks against a second's 107.
 */
const SNAP_BACK_SECONDS = 0.25;
/** A frame gap this long means the loop was stopped, not that time passed. */
const MAX_FRAME = 0.25;

export interface ClockStep {
  /** Where the display has got to. */
  shown: number;
  /** Where the driver says the song is, already carried to this instant. */
  target: number;
  /** Ticks per second in force. */
  rate: number;
  /** Seconds since the previous frame. */
  elapsed: number;
  /** Ticks in one pass, or 0 when the song is unknown. */
  pass: number;
}

/**
 * One frame of the playhead's own clock.
 *
 * The display carries its position across frames rather than deriving it from
 * the newest anchor, and that is the whole point. Anchors land ten times a
 * second and each arrives already slightly stale — mostly the time the message
 * spent getting here — so the gap between the display and the anchor stays
 * roughly *constant*. Re-deriving the position every frame would reproduce that
 * gap ten times a second as a lurch; running at the driver's own rate and easing
 * the gap shut turns a periodic jolt into a constant offset nobody can see.
 *
 * This is why interpolating over tempo does not break "ticks, not seconds": the
 * driver's own count steers it on every anchor, so the formula sets the velocity
 * between readings and never the position.
 */
export function advanceTick(step: ClockStep): number {
  const { shown, target, rate, elapsed, pass } = step;
  const hold = (tick: number) => (pass > 0 ? clamp(tick, 0, pass) : Math.max(0, tick));

  // A loop wrap, a seek, or the clock starting again after a pause. None of
  // those is drift, and easing across one would crawl the length of the song.
  // The two directions get their own bounds because they are not the same
  // question: forwards is a seek and can be told from drift by its size alone,
  // where backwards is measured against a lead the display is never supposed to
  // have — see {@link SNAP_BACK_SECONDS}.
  if (
    elapsed <= 0 ||
    elapsed > MAX_FRAME ||
    rate <= 0 ||
    target - shown > rate * SNAP_SECONDS ||
    shown - target > rate * SNAP_BACK_SECONDS
  ) {
    return hold(target);
  }

  return hold(shown + rate * elapsed + (target - shown) * Math.min(1, CATCH_UP * elapsed));
}
