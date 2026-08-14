/**
 * The song's clock as the driver actually keeps it, by running the emulator.
 *
 * `song-clock.ts` predicts: it prices every tick at the tempo the song asked
 * for. The driver does not always manage that. Its main loop handles at most one
 * music tick per iteration (`main.asm`, `MainLoop`), so once the requested rate
 * approaches the loop rate it simply drops ticks — measurably 0.8% on eight busy
 * channels at an ordinary tempo, and **more than half** at `t254`, where 498
 * ticks a second are asked for and around 230 arrive. A transport built on the
 * prediction then counts at less than half speed, which is the bug this exists
 * to fix.
 *
 * No formula can answer it. The shortfall is a function of how much work each
 * tick costs, which varies with the number of live channels, the commands they
 * carry, and the passage being played — on the song that prompted this the
 * opening measures at 1.86x where the whole pass is 2.15x, so even sampling the
 * beginning is not enough. The only honest answer is to play the song and watch,
 * which is what this does.
 *
 * The result is a {@link SongClock}, the same shape `songClock` predicts, so
 * everything downstream reads one through the other without knowing which it
 * has. It costs about 90 ms for a half-minute pass, so it belongs on a worker —
 * `clock.worker.ts` is what calls it.
 */

import { SPC_SAMPLE_RATE, type SpcCore } from '@amk/spc/wasm-host';
import { TICK_POLL_HZ, readNoteDuration, sawTick, tickVoice } from '@amk/spc/driver-state';
import type { ClockSegment, SongClock } from './song-clock';

/** Emulated frames per poll, matching what `worklet.ts` counts ticks at. */
const BLOCK = SPC_SAMPLE_RATE / TICK_POLL_HZ;

/**
 * `$51` holds the driver tempo, and `driverTickSeconds` in `@amk/tokens` says
 * what one of its ticks is worth. Restated rather than imported only to keep
 * this module's imports to `@amk/spc`, which the worker already pulls in;
 * `walktest` asserts the two agree.
 */
const TEMPO = 0x51;
const nominalTickSeconds = (driverTempo: number): number => 256 / (500 * driverTempo);

/**
 * Points kept in the table. A pass is a few thousand ticks, and the rate only
 * changes when the texture does, so this is far finer than anything visible —
 * it exists to bound the message crossing back from the worker.
 */
const MAX_POINTS = 2048;

/**
 * How long the measurement will run before giving up, in emulated seconds.
 *
 * A song can fail to reach its own tick count — one that never keys on, or one
 * a `t255` stops dead — and this is a worker, so a runaway would spin a core
 * rather than freeze the page. `999` is the ceiling the SPC format allows.
 */
const MAX_SECONDS = 999;

export interface Measurement {
  /** The observed clock, or `null` when nothing could be measured. */
  clock: SongClock | null;
  /** Wall seconds one pass really takes. */
  seconds: number;
  /** What the same ticks would have taken at the tempo the song asked for. */
  nominalSeconds: number;
  /** Ticks reached; short of the pass when the song stalled or ran out. */
  ticks: number;
  /** The pass was not reached — the figures describe as far as it got. */
  truncated: boolean;
}

/**
 * Plays `spc` silently for one pass and records when each tick arrived.
 *
 * `passTicks` is where to stop, which the caller has from `stats` — the walk and
 * the compiler agree on it, and neither depends on tempo.
 */
export function measureClock(core: SpcCore, spc: Uint8Array, passTicks: number): Measurement {
  const empty: Measurement = {
    clock: null,
    seconds: 0,
    nominalSeconds: 0,
    ticks: 0,
    truncated: true,
  };
  if (passTicks <= 0) {
    return empty;
  }

  core.loadSpc(spc);

  const step = Math.max(1, Math.ceil(passTicks / MAX_POINTS));
  const points: { tick: number; seconds: number }[] = [{ tick: 0, seconds: 0 }];

  let ticks = 0;
  let nominalSeconds = 0;
  let voice = -1;
  let duration = 0;
  let rendered = 0;
  let marked = 0;
  const cap = MAX_SECONDS * SPC_SAMPLE_RATE;

  while (ticks < passTicks && rendered < cap) {
    core.renderView(BLOCK);
    rendered += BLOCK;

    const aram = core.aram();
    if (voice < 0) {
      // The song has not keyed on yet; latch the voice once it has, exactly as
      // `worklet.ts` does, so both count off the same one.
      voice = tickVoice(aram);
      duration = readNoteDuration(aram, voice);
      continue;
    }

    const now = readNoteDuration(aram, voice);
    const stepped = sawTick(duration, now);
    duration = now;
    if (stepped === 0) {
      continue;
    }

    ticks += stepped;
    // Priced at the tempo standing when the tick was seen, so a song that
    // changes tempo — or fades one — is compared against what it asked for at
    // each point rather than against an average it never plays at.
    nominalSeconds += nominalTickSeconds(aram[TEMPO] || 1) * stepped;

    if (ticks - marked >= step) {
      marked = ticks;
      points.push({ tick: ticks, seconds: rendered / SPC_SAMPLE_RATE });
    }
  }

  const seconds = rendered / SPC_SAMPLE_RATE;
  if (ticks <= 0) {
    return empty;
  }

  if (points[points.length - 1].tick !== ticks) {
    points.push({ tick: ticks, seconds });
  }

  return {
    clock: toClock(points, ticks, seconds),
    seconds,
    nominalSeconds,
    ticks,
    truncated: ticks < passTicks,
  };
}

/** Turns the recorded points into the segment table `song-clock.ts` reads. */
function toClock(
  points: readonly { tick: number; seconds: number }[],
  ticks: number,
  seconds: number,
): SongClock {
  const segments: ClockSegment[] = [];
  for (let n = 0; n < points.length - 1; n++) {
    const from = points[n];
    const to = points[n + 1];
    const span = to.tick - from.tick;
    if (span <= 0) {
      continue;
    }

    segments.push({
      tick: from.tick,
      seconds: from.seconds,
      secondsPerTick: (to.seconds - from.seconds) / span,
    });
  }

  // A pass so short that one poll covered it still needs a rate to divide by.
  if (segments.length === 0) {
    segments.push({ tick: 0, seconds: 0, secondsPerTick: seconds / Math.max(1, ticks) });
  }

  return { segments, ticks, seconds, stalled: false };
}

/**
 * How much slower the driver runs the song than it was written to go, as a
 * ratio — 1 when it keeps up.
 *
 * `null` when there is nothing to compare, which is not the same as 1.
 */
export function tempoShortfall(measured: Measurement): number | null {
  return measured.nominalSeconds > 0 && measured.seconds > 0
    ? measured.seconds / measured.nominalSeconds
    : null;
}
