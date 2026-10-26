import { Component, computed, inject, input } from '@angular/core';

import { TICKS_PER_WHOLE, WAIT_TIME, noteSoundingTicks } from '@amk/core/hardcoded-tables';
import type { WalkNote } from '@amk/spc/song-walk';
import { type Command, noteLengthTicks } from '@amk/tokens';
import { Slider } from '../../../shared/slider/slider';
import { CommitAudition } from '../../../state/commit-audition';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { dragPreview } from '../commands/preview';
import {
  READS_THE_DEFAULT,
  type NoteLengthRow,
  noteLengthEdit,
  noteLengthLabel,
  noteLengthRows,
} from './length-rows';

/** A row with both its readouts re-read from whatever the slider is showing. */
interface Shown extends NoteLengthRow {
  /** `1/8`, on the track. */
  readonly valueLabel: string | null;
  /** `1/8 · an eighth note · 24 ticks`, under it. */
  readonly note: string | null;
  /** What the segment plays for at the value the slider is showing. */
  readonly shownTicks: number;
}

/**
 * How long a note is, one control per length segment.
 *
 * The note view's own parameter table, in the place `<amk-param-table>` stands
 * for every other command — see `length-rows.ts` for why a note's lengths are
 * not `ParamDescriptor`s. It is the whole of what a note has to edit, so there
 * is no table beside it.
 */
@Component({
  selector: 'amk-note-length',
  imports: [Slider],
  templateUrl: './note-length.html',
  host: { class: 'block' },
})
export class NoteLength {
  private readonly store = inject(EditorStore);

  private readonly commitAudition = inject(CommitAudition);

  readonly command = input.required<Command>();

  /** The pass the note view is describing, off the walk; `null` where there is none to read. */
  readonly pass = input<WalkNote | null>(null);

  private readonly drag = dragPreview(this.command);

  protected readonly READS_THE_DEFAULT = READS_THE_DEFAULT;

  protected readonly TICKS_PER_WHOLE = TICKS_PER_WHOLE;

  protected readonly rows = computed<readonly Shown[]>(() => {
    const command = this.command();
    return noteLengthRows(command).map((row) => {
      const segment = command.noteLength?.[row.key];
      // A row with no stops is a tick count with no `1/n` to say, and the
      // template reads it out itself.
      if (row.stops === null || !segment) {
        return { ...row, valueLabel: null, note: null, shownTicks: row.ticks };
      }

      // Both readouts follow the drag rather than the document, which is the
      // whole of `dragPreview`: a reading taken from what is written would sit
      // there describing the value being dragged away from. `value` itself
      // stays as the document resolved it, or `amk-slider` would read every
      // gesture as a no-op and nothing would ever be written. A locked row
      // never previews, so it reads what is written and still reads `1/n`.
      const shown = this.drag.at(row.key, row.value);
      return {
        ...row,
        valueLabel: `1/${shown}`,
        note: noteLengthLabel(segment, shown),
        shownTicks: noteLengthTicks(segment, shown),
      };
    });
  });

  /**
   * How much of the note sounds before the driver keys it off, under its `q`.
   *
   * The walk's own figure for the length as written. While a slider is dragged it is the same
   * arithmetic, `noteSoundingTicks`, over the length being dragged to: priced on the whole note,
   * which is where a `^` rewound in front of a `$DD` can leave it a tick out until the release.
   */
  protected readonly sounding = computed(() => {
    const note = this.pass();
    const q = note?.state.quantization ?? null;
    if (note === null || q === null) {
      return null;
    }

    const ratio = this.store.tempoRatio();
    const rows = this.rows();
    const written = Math.floor(rows.reduce((sum, row) => sum + row.ticks, 0) / ratio);
    const shown = Math.floor(rows.reduce((sum, row) => sum + row.shownTicks, 0) / ratio);
    const ticks = note.ticks + shown - written;
    const sounds =
      shown === written
        ? note.gateTicks
        : noteSoundingTicks(ticks, note.state.gate, note.state.waitTime, ratio);

    const under = `under q${hex2(q)}${note.state.waitTime === WAIT_TIME ? '' : ' with light staccato'}`;
    const span = ratio === 1 ? `${ticks} ticks` : `the ${ticks} ticks the tempo ratio leaves it`;
    if (sounds >= ticks) {
      // A last piece of one tick has no tick left to key off on, so the note plays whole.
      return `Sounds for ${ticks === 1 ? 'its one tick' : `all ${span}`} ${under}`;
    }

    const percent = Math.round((sounds / ticks) * 100);
    return `Sounds for ${sounds} of ${span} ${under} (${percent}%), then ${ticks - sounds} of silence`;
  });

  protected preview(row: NoteLengthRow, value: number): void {
    this.drag.set(row.key, value);
  }

  protected commit(row: NoteLengthRow, value: number): void {
    this.commitAudition.apply(noteLengthEdit(this.store.source(), this.command(), row.key, value));
  }
}
