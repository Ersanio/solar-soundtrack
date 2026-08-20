import { clamp } from '../../util/math';

/**
 * Where a slider's thumb sits, and what its track looks like. Pure arithmetic,
 * no Angular — `charttest` covers it, because both of the claims below fail
 * invisibly at every value but the extremes.
 *
 * The track is a coordinate space of its own. A slider with `stops` is an index
 * into that list rather than a value, and an inverted one is mirrored, so three
 * numbers are in play at once: the value the document holds, the index the track
 * is really on, and the fraction the gradient is drawn from.
 */

/** The track's ends: `0`-based over the stops, or the plain min/max. */
export interface TrackBounds {
  low: number;
  high: number;
}

export function trackBounds(
  stops: readonly number[] | null,
  min: number,
  max: number,
): TrackBounds {
  return stops ? { low: 0, high: Math.max(0, stops.length - 1) } : { low: min, high: max };
}

/**
 * Where the thumb sits: the value itself, or its index among the stops.
 *
 * A value that is not a stop takes the nearest index, so the thumb is never left
 * somewhere the track cannot represent.
 */
export function trackPosition(value: number, stops: readonly number[] | null): number {
  if (!stops) {
    return value;
  }

  let best = 0;
  let error = Infinity;
  for (let i = 0; i < stops.length; i++) {
    const distance = Math.abs(stops[i] - value);
    if (distance < error) {
      error = distance;
      best = i;
    }
  }

  return best;
}

/**
 * A coordinate reflected through the middle of the track, or itself.
 *
 * **Its own inverse** — the mirror of a mirror is the original — which is what
 * lets one function serve both directions: the thumb's drawn position on the way
 * out, and the raw input's value on the way back in. Mirroring the coordinate
 * rather than setting `direction: rtl`, which is the other way to reverse a
 * range input and is honoured inconsistently: Firefox and WebKit disagree about
 * whether it also flips the keyboard arrows. Doing the arithmetic means every
 * browser and every input method agrees.
 */
export function mirror(coordinate: number, bounds: TrackBounds, invert: boolean): number {
  return invert ? bounds.low + bounds.high - coordinate : coordinate;
}

/** The thumb's place along the track, 0–1, as drawn. */
export function trackFraction(position: number, bounds: TrackBounds): number {
  const span = bounds.high - bounds.low;
  return span === 0 ? 0 : (position - bounds.low) / span;
}

/**
 * The whole track, as one gradient on the input itself.
 *
 * Drawn here rather than through `::-webkit-slider-runnable-track` and
 * `::-moz-range-track`, which cannot be given the same declaration in one rule —
 * a browser drops a whole selector list it does not recognise, so styling both
 * means writing everything twice and keeping the copies in step. A background on
 * the element is one declaration every browser already agrees about, and the
 * vendor tracks are only made transparent so it shows through.
 *
 * The stripe *is* the input's content box — 12px of it, held there by 2px of
 * vertical padding — and the background is clipped to it. That is what rounds
 * the ends: `border-radius` clips a background at the content edge with the
 * radius reduced by the padding, so a pill on the 16px box arrives at the stripe
 * as exactly half its height. Sizing the stripe with `background-size` instead
 * paints the same pixels but leaves nothing to round them against.
 *
 * The centre tick is part of the same gradient rather than an element beside it,
 * so it cannot drift out of alignment with the fill it marks.
 */
export function trackImage(fraction: number, centred: boolean): string {
  const track = 'var(--color-edge)';
  const fill = 'var(--color-accent)';
  const at = clamp(fraction * 100, 0, 100);

  if (!centred) {
    return `linear-gradient(to right, ${fill} 0 ${at}%, ${track} ${at}% 100%)`;
  }

  const [from, to] = at < 50 ? [at, 50] : [50, at];

  // The detent is listed first, which in CSS puts it *over* the fill — and it
  // has to be, because the fill always reaches the centre by definition, so a
  // mark underneath it could never be seen at any value.
  return (
    `linear-gradient(to right, transparent 0 calc(50% - 1px),` +
    ` var(--color-ink-muted) calc(50% - 1px) calc(50% + 1px), transparent calc(50% + 1px) 100%),` +
    ` linear-gradient(to right, ${track} 0 ${from}%, ${fill} ${from}% ${to}%,` +
    ` ${track} ${to}% 100%)`
  );
}

/** The number beside the label: the caller's own wording, or the value signed. */
export function readout(value: number, valueLabel: string | null, signed: boolean): string {
  if (valueLabel !== null) {
    return valueLabel;
  }

  return signed && value > 0 ? `+${value}` : String(value);
}

/** A raw track coordinate read back as a value, mirroring and stops undone. */
export function valueAt(
  raw: number,
  stops: readonly number[] | null,
  bounds: TrackBounds,
  invert: boolean,
  fallback: number,
): number {
  const coordinate = mirror(raw, bounds, invert);
  return stops ? (stops[coordinate] ?? fallback) : coordinate;
}
