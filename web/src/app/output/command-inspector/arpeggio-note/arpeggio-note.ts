import { Component, input, output } from '@angular/core';

import { Button } from '../../../shared/button/button';
import { Slider } from '../../../shared/slider/slider';

/** One entry of an arpeggio sequence, as the panel draws it. */
export interface ArpeggioNote {
  index: number;
  value: number;
  hex: string;
  meaning: string;
  isMarker: boolean;
  /** Only the last marker takes effect; an earlier one is dead weight. */
  isLive: boolean;
  /** Whether marking this row would still leave the driver something to play. */
  canMark: boolean;
}

/**
 * One row of `$FB`'s note list: an interval, or the loop point in its place.
 *
 * A marker occupies the slot rather than sitting between two, so it replaces the
 * slider rather than decorating it — which is why this branches instead of
 * drawing a slider with a badge.
 *
 * The row emits rather than writes: every one of its three gestures changes the
 * *length* of the command, and `$FB`'s first byte is a count of what follows, so
 * the rewrite has to be made against the whole list by the panel that holds it.
 */
@Component({
  selector: 'amk-arpeggio-note',
  imports: [Button, Slider],
  templateUrl: './arpeggio-note.html',
  host: { class: 'flex items-start gap-1.5' },
})
export class ArpeggioNoteRow {
  readonly note = input.required<ArpeggioNote>();
  /** Whether the sliders take an edit at all — a macro's bytes do not. */
  readonly editable = input.required<boolean>();
  /** Whether the list can change length; Remove and most of Loop need it. */
  readonly resizable = input.required<boolean>();

  /** The dragged value, by argument index — the count and duration come first. */
  readonly previewed = output<{ index: number; value: number }>();
  readonly committed = output<{ index: number; value: number }>();
  readonly looped = output<number>();
  readonly removed = output<number>();
}
