/**
 * Ticks to seconds, for a song the compiler could not put a clock on.
 *
 * `estimateSeconds` (`parser.ts:3459`) is segment-wise over source text, so two
 * ordinary things defeat it: a `t` that runs more than once has no place in the
 * list (`parser.ts:1692`), and a tempo fade has no segment at all
 * (`parser.ts:1705`, porting `Music.cpp:809`). Either one makes it abandon the
 * song's length outright.
 *
 * `@amk/spc`'s walk records every tempo command on the tick the driver runs it,
 * and `@amk/tokens`' `tempoFadeSteps` is the driver's own per-tick model of a
 * fade — but `@amk/spc` may not reach `@amk/tokens` and `@amk/tokens` may not
 * reach `@amk/spc/song-walk` (`eslint.config.js`'s `SPC_BEYOND_THE_MATHS`). The
 * app is the only place the two can be put together, so the join lives here
 * rather than in either package. Nothing about it is app-specific otherwise.
 *
 * This maps **one pass**, as the walk does. A song that sets `t` only inside its
 * loop re-enters on pass two at the tempo standing at the end of pass one, which
 * a pass-one table does not model; it moves the m:ss readout across a sliver at
 * the top of the loop and never the playhead, which is a driver-counted tick.
 */

import type { SongTimeline } from '@amk/spc/song-walk';
import {
  DEFAULT_TEMPO,
  driverTempo,
  driverTickSeconds,
  tempoFadeSteps,
} from '@amk/tokens/commands/units';
import { clamp } from '../util/math';

/** One stretch of the pass at a single driver tempo. */
export interface ClockSegment {
  /** First tick of the stretch. */
  tick: number;
  /** Seconds from the start of the pass to {@link tick}. */
  seconds: number;
  /** How long one tick of it takes. Never 0 — a stall ends the table instead. */
  secondsPerTick: number;
}

export interface SongClock {
  /** Ascending, gapless, and always starting at tick 0. */
  readonly segments: readonly ClockSegment[];
  /** Ticks the clock covers: one pass, or the tick the song stalls on. */
  readonly ticks: number;
  /** Seconds those ticks take. */
  readonly seconds: number;
  /**
   * A tempo of 0 was reached and the song stops advancing short of the pass.
   * `t255` does it outright — the driver's carry-set `adc` wraps `$FF` to 0 —
   * and so does a fade that ends there.
   *
   * Read by `charttest` and by nothing in the app, which needs no separate
   * branch for it: `ticks` already stops where the song does, so clamping
   * against it does the right thing without anyone asking why.
   */
  readonly stalled: boolean;
}

/**
 * A fade is at most 255 segments and a song is at most a few thousand commands,
 * so this is generous. It exists because a malformed blob can walk a very long
 * way before a budget stops it, and a table nobody can binary-search usefully is
 * worse than no clock.
 */
const MAX_SEGMENTS = 100_000;

/**
 * The clock for a walked song, or `null` when there is no honest one to give.
 *
 * `null` rather than a zero-length clock, and the callers lean on the
 * difference: it means "no opinion, use whatever the compiler said", where a
 * clock reading 0 everywhere would be a song of no length and would disable
 * seeking. A truncated walk qualifies because its tick count is a floor and not
 * the answer.
 */
export function songClock(timeline: SongTimeline | null): SongClock | null {
  if (!timeline || timeline.ticks <= 0 || timeline.truncated) {
    return null;
  }

  const segments: ClockSegment[] = [];
  let standing = DEFAULT_TEMPO;
  let tick = 0;
  let seconds = 0;
  let stalled = false;

  /** Opens a segment, unless it would repeat the rate already running. */
  const open = (at: number, driver: number): boolean => {
    if (driver === 0) {
      stalled = true;
      return false;
    }

    const secondsPerTick = driverTickSeconds(driver);
    const last = segments[segments.length - 1];
    // A `t` on tick 0 must not leave a zero-length default in front of it, and
    // a fade's steps repeat the same floored tempo for runs of ticks.
    if (last?.secondsPerTick === secondsPerTick) {
      return true;
    }

    if (last?.tick === at) {
      segments.pop();
    }

    segments.push({ tick: at, seconds, secondsPerTick });
    return true;
  };

  /** Runs the clock forward to `to` at whatever rate is open. */
  const advanceTo = (to: number): void => {
    const rate = segments[segments.length - 1]?.secondsPerTick ?? 0;
    seconds += (to - tick) * rate;
    tick = to;
  };

  // The song is already running before it sets anything: `main.asm:177` puts
  // `#$36` straight into `$51`, which is the register and not a written byte.
  open(0, driverTempo(DEFAULT_TEMPO));

  const changes = timeline.tempoChanges;
  for (let n = 0; n < changes.length && !stalled; n++) {
    const change = changes[n];
    if (change.tick > tick) {
      advanceTo(change.tick);
    }

    if (change.fadeTicks === 0) {
      open(tick, driverTempo(change.tempo));
      standing = change.tempo;
      continue;
    }

    const steps = tempoFadeSteps(change.fadeTicks, standing, change.tempo);
    if (steps === null) {
      // The fade ends the song, or leaves one already stopped. `tempoFadeSeconds`
      // gives the same answer for the same fade, so the transport and the
      // command inspector never disagree about which fades have no duration.
      stalled = true;
      break;
    }

    // The delta is fixed by the *written* duration and the run is then cut short
    // by whatever comes next — re-deriving it from the surviving count is a
    // different fade, and a perfectly plausible-looking one.
    const until = Math.min(changes[n + 1]?.tick ?? timeline.ticks, change.tick + change.fadeTicks);
    const ran = Math.max(0, until - change.tick);
    for (let step = 0; step < ran; step++) {
      if (!open(change.tick + step, steps[step])) {
        break;
      }

      advanceTo(change.tick + step + 1);
      if (segments.length > MAX_SEGMENTS) {
        return null;
      }
    }

    if (stalled) {
      break;
    }

    if (ran >= change.fadeTicks) {
      // Ran to the end, so the driver snaps to the target on the next tick.
      standing = change.tempo;
      open(tick, driverTempo(change.tempo));
    } else if (ran > 0) {
      // Cut short by whatever comes next. A following fade ramps from where the
      // driver actually got to, not from a target it never reached — the step
      // list is driver-side, so a byte is one less.
      standing = steps[ran - 1] - 1;
    }
  }

  if (!stalled) {
    advanceTo(timeline.ticks);
  }

  return { segments, ticks: tick, seconds, stalled };
}

/**
 * The second a tick falls on. Clamped at both ends; monotone in between.
 *
 * One direction only, and that is the point: ticks are what the transport, the
 * roll and the emulator all hold, so seconds are produced for a label and never
 * consumed.
 */
export function secondsAtTick(clock: SongClock, tick: number): number {
  const at = clamp(tick, 0, clock.ticks);
  const segment = segmentAt(clock, at);
  return Math.min(clock.seconds, segment.seconds + (at - segment.tick) * segment.secondsPerTick);
}

/**
 * How fast ticks are going by at a tick, in ticks per second.
 *
 * For the one thing that has to draw the song against a wall clock rather than
 * follow it: a view running at frame rate, interpolating between two of the
 * transport's ten-a-second anchors. It needs a velocity, and `ticksPerSecond`
 * off the tempo byte is the wrong one — that is the rate the song *asked* for,
 * and on a song the driver cannot keep up with it is nearly double what it gets,
 * which puts the playhead a quarter note ahead of what is sounding.
 *
 * The clock's own slope is the right one, because a measured clock's slope is
 * what the driver actually did.
 */
export function ticksPerSecondAt(clock: SongClock, tick: number): number {
  const perTick = segmentAt(clock, clamp(tick, 0, clock.ticks)).secondsPerTick;
  return perTick > 0 ? 1 / perTick : 0;
}

/** The last segment starting at or before `at`. */
function segmentAt(clock: SongClock, at: number): ClockSegment {
  let low = 0;
  let high = clock.segments.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (clock.segments[mid].tick <= at) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return clock.segments[low];
}
