import { Component, input } from '@angular/core';

import type { TakeBar } from '../roll-record';

/** One spark off the end of a held note: where it flies to, in pixels, and when. */
interface Spark {
  x: string;
  y: string;
  /** Negative, so the sparks are already spread through their flights on the first frame. */
  delay: string;
  duration: string;
  /** Its classes: the animation, turning about its own middle, and its colour. */
  shape: string;
}

const spark = (x: number, y: number, delay: number, duration: number, tint: string): Spark => ({
  x: `${x}px`,
  y: `${y}px`,
  delay: `${-delay}s`,
  duration: `${duration}s`,
  shape: `animate-sparkle origin-center [transform-box:fill-box] ${tint}`,
});

/** A ring of them, uneven on purpose: evenly spaced and timed they read as a spinner. */
const SPARKS: readonly Spark[] = [
  spark(18, -16, 0, 0.55, 'fill-ink'),
  spark(-13, -19, 0.21, 0.7, 'fill-accent-soft'),
  spark(23, 3, 0.4, 0.6, 'fill-accent-soft'),
  spark(-19, 11, 0.1, 0.65, 'fill-ink'),
  spark(11, 19, 0.33, 0.5, 'fill-ink'),
  spark(-23, -4, 0.48, 0.75, 'fill-accent-soft'),
  spark(3, -24, 0.27, 0.6, 'fill-ink'),
  spark(-5, 23, 0.05, 0.7, 'fill-accent-soft'),
];

/**
 * A MIDI take in flight, drawn over the song: a bar per note played so far, and
 * one growing under each key still held.
 *
 * Two lists because they move at two rates. The notes already played change
 * when a key does; a held key's bar is as long as the pointer has travelled and
 * so changes every frame, and it is at most one bar per recorded channel.
 *
 * A held bar throws sparks off its growing end, as a held note does in a rhythm
 * game. They are CSS animations (`animate-sparkle` in `styles.css`) on elements
 * that live as long as the key is down, so the frame clock moves only the group
 * they sit in.
 *
 * An attribute component on a real `<g>`, like the others inside the roll's
 * `<svg>`.
 */
@Component({
  selector: 'g[amk-roll-take]',
  templateUrl: './roll-take.html',
})
export class RollTake {
  readonly done = input.required<readonly TakeBar[]>();
  readonly live = input.required<readonly TakeBar[]>();

  protected readonly sparks = SPARKS;
}
