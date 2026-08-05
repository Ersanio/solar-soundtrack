import { TICKS_PER_WHOLE } from '@compiler/tables';

/**
 * Turning driver bytes into the units a musician thinks in.
 *
 * Shared by the descriptor tables and the bespoke panels so that a tempo, a tick
 * count or a note byte is never spelled two ways in one screen.
 */

/**
 * Seconds per driver tick at a tempo byte.
 *
 * `parser.ts:151-153` — a tick is `256 / (500 × (tempo + 1))` seconds.
 */
export function tickSeconds(tempo: number): number {
  return 256 / (500 * (tempo + 1));
}

/** Beats per minute for a tempo byte: 48 ticks to a quarter note. */
export function bpm(tempo: number): number {
  return 60 / (48 * tickSeconds(tempo));
}

/**
 * The tempo byte that comes closest to a BPM.
 *
 * Searched over the 256 candidates rather than inverted, so it cannot drift from
 * {@link bpm} and so the answer is always a byte that exists. `t0` is excluded:
 * the driver never advances at it.
 */
export function nearestTempo(target: number): number {
  let best = 1;
  let error = Infinity;
  for (let tempo = 1; tempo <= 0xff; tempo++) {
    const distance = Math.abs(bpm(tempo) - target);
    if (distance < error) {
      error = distance;
      best = tempo;
    }
  }

  return best;
}

/** `48 ticks · 0.51 s` — a duration said both ways, when a tempo is known. */
export function ticksLabel(ticks: number, tempo: number | null): string {
  if (tempo === null) {
    return `${ticks} ticks`;
  }

  return `${ticks} ticks · ${(ticks * tickSeconds(tempo)).toFixed(2)} s`;
}

/** `1/8` when the tick count is a whole-note fraction exactly, else `null`. */
export function wholeNoteFraction(ticks: number): string | null {
  return ticks > 0 && TICKS_PER_WHOLE % ticks === 0 ? `1/${TICKS_PER_WHOLE / ticks}` : null;
}

const NOTE_NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];

/**
 * A note byte as it would be written in MML.
 *
 * `pitch + (octave - 1) × 12 + 0x80` (`parser.ts` `getPitch`), read backwards.
 */
export function noteName(byte: number): string {
  const pitch = byte & 0x7f;
  return `o${Math.floor(pitch / 12) + 1} ${NOTE_NAMES[pitch % 12]}`;
}

/**
 * AddmusicK's pan, which runs 0 (hard right) to 20 (hard left) with 10 centre.
 *
 * Backwards from every other pan control anyone has used, and stated in words
 * here for exactly that reason.
 */
export function panLabel(value: number): string {
  if (value === 10) {
    return 'centre';
  }

  return value < 10 ? `right ${10 - value}/10` : `left ${value - 10}/10`;
}

/** `80%` of the byte range, for a 0-255 level. */
export function percentOf255(value: number): string {
  return `${Math.round((value / 255) * 100)}% of full`;
}

/** A signed byte with its hex form — how every echo volume and feedback reads. */
export function signedLabel(value: number): string {
  const signed = value >= 0x80 ? value - 0x100 : value;
  return `${signed > 0 ? '+' : ''}${signed}`;
}
