import { type Signal, effect, signal, untracked } from '@angular/core';

import { ticksPerSecond } from '@amk/tokens/commands/units';
import { frameClock } from '../../../shared/chart/frame-clock';
import { type SongClock, ticksPerSecondAt } from '../../../state/song-clock';
import { clamp } from '../../../util/math';
import { advanceTick } from './roll-clock-step';

/**
 * How far a smoothed tick may run past its anchor.
 *
 * The anchors land ten times a second, so a sixth of a second is already more
 * rope than a healthy stream needs. It matters when the stream stalls — a long
 * recompile, a throttled tab — where the roll drifts a fraction of a second
 * ahead and stops, rather than sailing away from the audio.
 */
const MAX_EXTRAPOLATION = 0.15;

/** How often the readout is rewritten. Prose is read, not watched. */
const READOUT_MS = 500;

export interface ClockSources {
  /** Only run a frame callback while something is actually moving. */
  running: Signal<boolean>;
  /** The driver's own tick count and the stamp it landed at, ten times a second. */
  anchor: Signal<{ ticks: number; at: number }>;
  /** The measured clock, where the measurement has come back. */
  clock: Signal<SongClock | null>;
  /** The tempo as `t` writes it — not `DriverState.tempo`, which is one higher. `0` for none. */
  tempo: Signal<number>;
  /** The song's whole length in ticks. `0` for a song with no end to hold against. */
  pass: Signal<number>;
}

export interface RollClock {
  /** The playhead, in ticks, at frame rate. */
  tick: Signal<number>;
  /**
   * The playhead as the readout states it, twice a second.
   *
   * The transform wants a tick every frame; a line of text does not. A count and
   * a ticks-per-second restated sixty times a second are a blur the eye cannot
   * read at all, so the readout takes the same clock slowly and the display
   * keeps the frame-rate one to itself.
   */
  slowTick: Signal<number>;
  /** Put the playhead where a seek has just asked for, without waiting for an anchor. */
  jumpTo(tick: number): void;
}

/**
 * The roll's display clock: the driver's ten anchors a second, at frame rate.
 *
 * A composable in the shape of `shared/chart/frame-clock.ts`, and it must be
 * called from an injection context for the same reason — it starts an effect and
 * a frame callback of its own.
 *
 * The arithmetic is `advanceTick` in `roll-clock-step.ts`, where `charttest`
 * can reach it. What is here is the reading of the driver that the step is given.
 */
export function rollClock(sources: ClockSources): RollClock {
  /**
   * A signal rather than a `computed` because the clock carries its position
   * across frames — see `advanceTick`, which is where the reasoning and the
   * arithmetic both live.
   */
  const shown = signal(0);
  const slow = signal(0);
  let lastFrameAt = 0;
  let lastReadoutAt = 0;

  const frame = frameClock(sources.running);

  /** One frame of the display clock: read the driver, then hand it the step. */
  const advanceTo = (at: number): void => {
    const anchor = sources.anchor();
    const pass = sources.pass();
    // How fast ticks are really going by, which is not what the tempo says. The
    // driver runs at most one tick per pass of its main loop, so a song that
    // asks for more than it can manage gets fewer — at `t254` on eight channels
    // about 231 of the 498 a second it wrote. Extrapolating at the tempo byte
    // would put the playhead most of a quarter note ahead of what is sounding;
    // `charttest` pins the difference.
    //
    // The tempo byte is still the fallback, for a song with no clock at all: it
    // is what the clock would predict anyway, minus the driver's shortfall.
    const clock = sources.clock();
    const tempo = sources.tempo();
    const rate = clock
      ? ticksPerSecondAt(clock, anchor.ticks)
      : tempo > 0
        ? ticksPerSecond(tempo)
        : 0;

    const elapsed = lastFrameAt === 0 ? 0 : (at - lastFrameAt) / 1000;
    lastFrameAt = at;

    // Where the driver says the song is, carried the short way from the anchor
    // to now, and never past the end of the pass — the anchor is folded into one
    // pass, so running beyond it would draw the playhead off the end.
    const since = Math.max(0, (at - anchor.at) / 1000);
    const reach = anchor.ticks + Math.min(since, MAX_EXTRAPOLATION) * rate;

    shown.set(
      advanceTick({
        shown: shown(),
        target: pass > 0 ? clamp(reach, 0, pass) : Math.max(0, reach),
        rate,
        elapsed,
        pass,
      }),
    );

    if (at - lastReadoutAt >= READOUT_MS) {
      lastReadoutAt = at;
      slow.set(shown());
    }
  };

  // Sanctioned effect: driving the display clock. The frame stamp is the only
  // thing tracked — everything the step reads is deliberately untracked, so
  // this runs once per frame and not once per anchor as well.
  effect(() => {
    const at = frame();
    untracked(() => advanceTo(at));
  });

  return {
    tick: shown.asReadonly(),
    slowTick: slow.asReadonly(),
    jumpTo: (tick: number) => shown.set(tick),
  };
}
