import { Component, input } from '@angular/core';

import type { TakeBar } from '../roll-record';

/**
 * A MIDI take in flight, drawn over the song: a bar per note played so far, and
 * one growing under each key still held.
 *
 * Two lists because they move at two rates. The notes already played change
 * when a key does; a held key's bar is as long as the pointer has travelled and
 * so changes every frame, and it is at most one bar per recorded channel.
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
}
