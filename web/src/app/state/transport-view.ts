import { type NoteAddress, type Span, noteAddressAt } from '@amk/core/types';

/**
 * What the transport shows, as arithmetic. Pure — no signals, no services — so
 * `charttest` can reach the three rules below, none of which a browser can be
 * made to demonstrate reliably: a mid-update read of ARAM, a mute mask under
 * solo, and a song the compiler declined to time.
 */

/** N-SPC songs have eight music channels. */
export const CHANNELS = 8;
export const ALL_CHANNELS = 0b11111111;
/** In the note map, the loop/subroutine block counts as a ninth channel. */
export const LOOP_BLOCK = 8;

export interface ChannelState {
  index: number;
  muted: boolean;
  soloed: boolean;
  /** Audible right now, once solo is taken into account. */
  audible: boolean;
}

/**
 * Which channels are silenced, as a mask.
 *
 * With a channel soloed only that channel is heard, and nothing else applies:
 * engaging solo clears the mutes outright rather than holding them, so what the
 * buttons show is always what is being heard.
 */
export function silencedMask(muted: number, soloed: number | null): number {
  return soloed === null ? muted : ~(1 << soloed) & ALL_CHANNELS;
}

/**
 * One row per channel the song actually writes to.
 *
 * A channel with no data has nothing to mute, so it gets no controls at all and
 * they appear as the song grows into them. The state behind them is untouched by
 * this: a channel that goes empty keeps its mute or solo and resumes it if the
 * channel comes back.
 */
export function channelStates(
  sizes: readonly number[],
  muted: number,
  soloed: number | null,
): ChannelState[] {
  const silenced = silencedMask(muted, soloed);

  return Array.from({ length: CHANNELS }, (_, index) => index)
    .filter((index) => (sizes[index] ?? 0) > 0)
    .map((index) => {
      const bit = 1 << index;
      return {
        index,
        muted: (muted & bit) !== 0,
        soloed: soloed === index,
        audible: (silenced & bit) === 0,
      };
    });
}

/**
 * The source spans being sounded right now, one per audible voice.
 *
 * Follows the driver's own read pointers rather than any clock, so loops, tempo
 * changes and dropped ticks cost it nothing.
 *
 * **A voice's pointer resolving into another voice's region is a mid-update
 * artefact** of reading ARAM between the driver's own writes, and those are
 * dropped rather than shown — which is the rule a browser cannot be made to
 * demonstrate on demand. The loop block is the exception and has to be: a
 * subroutine's notes belong to whichever voice called it.
 *
 * Sorted and de-duplicated, so two voices inside one subroutine decorate the
 * text once rather than twice.
 */
export function soundingSpans(
  map: readonly NoteAddress[],
  pointers: readonly number[],
  silenced: number,
): Span[] {
  const spans: Span[] = [];
  for (let voice = 0; voice < CHANNELS; voice++) {
    const pointer = pointers[voice];
    if (!pointer || (silenced & (1 << voice)) !== 0) {
      continue;
    }

    const entry = noteAddressAt(map, pointer);
    if (entry && (entry.channel === voice || entry.channel === LOOP_BLOCK)) {
      spans.push(entry.span);
    }
  }

  return spans
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .filter(
      (span, n, all) => n === 0 || span.start !== all[n - 1].start || span.end !== all[n - 1].end,
    );
}

/** The ticks and AddmusicK's own seconds for each half of a pass. */
export interface PassEstimate {
  introTicks: number;
  loopTicks: number;
  introSeconds: number;
  mainSeconds: number;
}

/**
 * Seconds at a tick, interpolated from `stats` alone.
 *
 * The fallback for a song the walk could not read, and the shape `CLAUDE.md`'s
 * ledger records as having been replaced *for the readout*: two straight lines,
 * exact at the intro/loop boundary and drifting between them. It stands only
 * where there is no clock at all, which is why it survives — and it is here
 * rather than inline so the drift is something a harness can state rather than
 * something a reader has to take on trust.
 */
export function estimatedSecondsAt(pass: PassEstimate, tick: number): number {
  if (pass.introTicks > 0 && tick < pass.introTicks) {
    return (tick / pass.introTicks) * pass.introSeconds;
  }

  if (pass.loopTicks <= 0) {
    return pass.introSeconds;
  }

  return pass.introSeconds + ((tick - pass.introTicks) / pass.loopTicks) * pass.mainSeconds;
}
