import { Component, computed, input, output } from '@angular/core';

import { type EnumOption, EnumSelect } from '../../../shared/enum-select/enum-select';
import { intervalName } from '../commands/units';

/**
 * How far the list reaches either way.
 *
 * Two octaves. An arpeggio is a chord taken one note at a time, and a chord
 * spanning more than two octaves is not one — the byte goes to ±127 and the
 * source may say so, but offering all 255 would bury the dozen anybody uses.
 */
const REACH = 24;

const INTERVALS: readonly EnumOption[] = Array.from({ length: REACH * 2 + 1 }, (_, i) => {
  const semitones = i - REACH;
  const sign = semitones > 0 ? '+' : '';
  return { value: semitones, label: `${sign}${semitones} — ${intervalName(semitones)}` };
});

/**
 * One arpeggio step, as the interval it plays.
 *
 * A slider was the wrong control for the same reason it was wrong for `$DD`'s
 * target: dragging one sweeps the document through every wrong note between
 * here and the right one, and the number it lands on says nothing about the
 * chord being built. `$DD` got two dropdowns because its byte is an absolute
 * note; these are *distances* from whatever note is playing, so one dropdown of
 * intervals is the same idea in the units this command uses.
 *
 * A value further out than the list goes is still shown — `amk-enum-select`
 * synthesises an option for anything it does not hold — so a song that says
 * `$40` reads as `$40` rather than being quietly snapped into range.
 */
@Component({
  selector: 'amk-interval-picker',
  imports: [EnumSelect],
  template: `
    <amk-enum-select
      [label]="label()"
      [value]="value()"
      [options]="INTERVALS"
      [disabled]="disabled()"
      [note]="note()"
      [unknownLabel]="unknownLabel()"
      (commit)="commit.emit($event)"
    />
  `,
  host: { class: 'block' },
})
export class IntervalPicker {
  /** Signed semitones — the caller converts to and from the byte. */
  readonly value = input.required<number>();
  readonly label = input('Note');
  readonly disabled = input(false);
  readonly note = input<string | null>(null);

  readonly commit = output<number>();

  protected readonly INTERVALS = INTERVALS;

  protected readonly unknownLabel = computed(() => {
    const value = this.value();
    return `${value > 0 ? '+' : ''}${value} — ${intervalName(value)}`;
  });
}
