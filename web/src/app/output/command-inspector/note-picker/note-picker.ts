import { Component, computed, input, output } from '@angular/core';

import { type EnumOption, EnumSelect } from '../../../shared/enum-select/enum-select';

/** The lowest note byte, `$80` = `o1 c` (`hex_command_reference.html`'s note table). */
const FIRST_NOTE = 0x80;
/** The highest the table goes: `$C5` = `o6 a`. `o6 a+` and `o6 b` do not exist. */
const LAST_NOTE = 0xc5;

const PITCHES: readonly EnumOption[] = [
  'c',
  'c+',
  'd',
  'd+',
  'e',
  'f',
  'f+',
  'g',
  'g+',
  'a',
  'a+',
  'b',
].map((label, value) => ({ value, label }));

const OCTAVES: readonly EnumOption[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  value: n,
  label: `o${n}`,
}));

/**
 * A note byte as two dropdowns — the octave, then the pitch within it.
 *
 * One control over `$80`–`$C5` is 70 indistinguishable numbers; nobody knows
 * where `o4 c` is on that scale, and a slider slides through eleven wrong notes
 * to reach the right one. Splitting it the way the readme's own note table is
 * laid out — octaves down the side, pitches across — makes both choices small.
 *
 * The top of the range is ragged: `$C5` is `o6 a`, and `o6 a+`/`o6 b` are not
 * notes the table defines. Rather than offer them and write a byte past the
 * end, the pitch list shortens in the last octave.
 */
@Component({
  selector: 'amk-note-picker',
  imports: [EnumSelect],
  template: `
    <div class="grid grid-cols-2 gap-2">
      <amk-enum-select
        label="Octave"
        [value]="octave()"
        [options]="OCTAVES"
        [disabled]="disabled()"
        (commit)="setOctave($event)"
      />
      <amk-enum-select
        [label]="label()"
        [value]="pitch()"
        [options]="pitches()"
        [disabled]="disabled()"
        (commit)="setPitch($event)"
      />
    </div>
  `,
  host: { class: 'block' },
})
export class NotePicker {
  readonly value = input.required<number>();
  readonly label = input('Note');
  readonly disabled = input(false);

  readonly commit = output<number>();

  protected readonly OCTAVES = OCTAVES;

  private readonly clamped = computed(() =>
    Math.min(LAST_NOTE, Math.max(FIRST_NOTE, this.value())),
  );

  protected readonly octave = computed(() => Math.floor((this.clamped() - FIRST_NOTE) / 12) + 1);
  protected readonly pitch = computed(() => (this.clamped() - FIRST_NOTE) % 12);

  /** The last octave stops at `a`, so the list shortens rather than lying. */
  protected readonly pitches = computed(() =>
    this.octave() === 6 ? PITCHES.slice(0, 10) : PITCHES,
  );

  protected setOctave(octave: number): void {
    this.emit(octave, this.pitch());
  }

  protected setPitch(pitch: number): void {
    this.emit(this.octave(), pitch);
  }

  private emit(octave: number, pitch: number): void {
    const byte = FIRST_NOTE + (octave - 1) * 12 + pitch;
    // Choosing o6 while sitting on b would otherwise write a byte past the table.
    this.commit.emit(Math.min(LAST_NOTE, byte));
  }
}
