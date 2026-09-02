import { Component, computed, input, output } from '@angular/core';

import { Button } from '../../../../shared/button/button';
import { IconChevronDown } from '../../../../shared/icons/icon-chevron-down';
import { IconChevronRight } from '../../../../shared/icons/icon-chevron-right';
import { IconMinus } from '../../../../shared/icons/icon-minus';
import { IconPlus } from '../../../../shared/icons/icon-plus';
import { Toggle } from '../../../../shared/toggle/toggle';
import { Toolbar } from '../../../../shared/toolbar/toolbar';
import { HistoryButtons } from '../../../history-buttons/history-buttons';
import { EDIT_MODES, type EditMode } from '../roll-edit';
import {
  BEAT_UNITS,
  MAX_BEATS,
  SNAPS,
  type SnapName,
  clampBeats,
  isBeatUnit,
} from '../roll-settings';

/**
 * The roll's own controls, which every view brings for itself.
 *
 * Its host is `display: contents`, so the `<amk-toolbar>` inside it is still the
 * roll's first flex child rather than a row nested in a wrapper with no layout
 * of its own.
 *
 * Zoom and rows are emitted as directions rather than values: what a press is
 * worth depends on the height the rows were stretched to, which is the parent's
 * arithmetic. The two fields parse their own DOM events, so nothing above them
 * has to know a `<select>` from an `<input>`.
 */
@Component({
  selector: 'amk-roll-toolbar',
  imports: [
    Button,
    Toggle,
    IconMinus,
    IconPlus,
    IconChevronDown,
    IconChevronRight,
    HistoryButtons,
    Toolbar,
  ],
  templateUrl: './roll-toolbar.html',
  host: { class: 'contents' },
})
export class RollToolbar {
  readonly follow = input.required<boolean>();
  readonly scrollNotes = input.required<boolean>();
  readonly allOctaves = input.required<boolean>();
  readonly beatsPerBar = input.required<number>();
  readonly beatUnit = input.required<number>();
  readonly percussionOpen = input.required<boolean>();
  readonly snap = input.required<SnapName>();
  readonly editMode = input.required<EditMode>();
  /** Why the picked channel cannot be edited, or null when it can. */
  readonly editRefusal = input.required<string | null>();
  /** Why the last gesture was not written out, or null when it was. */
  readonly gestureRefusal = input.required<string | null>();
  /** How many notes are selected. */
  readonly selected = input.required<number>();

  readonly zoomBy = output<number>();
  readonly rowHeightBy = output<number>();
  readonly followChange = output<boolean>();
  readonly scrollNotesChange = output<boolean>();
  readonly allOctavesChange = output<boolean>();
  readonly beatsPerBarChange = output<number>();
  readonly beatUnitChange = output<number>();
  readonly percussionOpenChange = output<boolean>();
  readonly snapChange = output<SnapName>();
  readonly editModeChange = output<EditMode>();

  /** For the two grid controls. */
  protected readonly beatUnits = BEAT_UNITS;
  protected readonly maxBeats = MAX_BEATS;

  /** For the Snap control. The names are the porter's, not the tick counts. */
  protected readonly snaps = SNAPS;
  protected readonly snapLabels: Record<SnapName, string> = {
    bar: 'Bar',
    beat: 'Beat',
    half: '½ beat',
    quarter: '¼ beat',
    eighth: '⅛ beat',
    // Built from `⅟` and subscript digits, the vulgar fractions running out at ⅛.
    sixteenth: '⅟₁₆ beat',
    off: 'Off',
  };

  /** For the Edits control. Both modes are named, so neither has to be inferred. */
  protected readonly editModes = EDIT_MODES;
  protected readonly editModeLabels: Record<EditMode, string> = {
    overwrite: 'Overwrite',
    insert: 'Insert',
    strict: 'Strict',
  };

  /**
   * How many notes are selected, said only while any are. Which channel is
   * being edited is the corner picker's to say, and the rings say which notes.
   */
  protected readonly selectedLabel = computed(() => {
    const selected = this.selected();
    return selected > 0 ? `${selected.toLocaleString()} selected` : null;
  });

  /**
   * The beats in a bar, off the field itself.
   *
   * On `change` — a blur or an Enter — rather than per keystroke, and text that
   * is not a number puts the standing count back into the field. `0` is a real
   * setting here, so a cleared field taken at face value would read as one and
   * blank the grid on the way to typing `12`.
   */
  protected setBeatsPerBar(event: Event): void {
    const field = event.target as HTMLInputElement;
    const parsed = Number.parseInt(field.value, 10);
    const beatsPerBar = Number.isNaN(parsed) ? this.beatsPerBar() : clampBeats(parsed);

    field.value = String(beatsPerBar);
    this.beatsPerBarChange.emit(beatsPerBar);
  }

  protected setSnap(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as SnapName;
    if (SNAPS.includes(value)) {
      this.snapChange.emit(value);
    }
  }

  protected setEditMode(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as EditMode;
    if (EDIT_MODES.includes(value)) {
      this.editModeChange.emit(value);
    }
  }

  protected setBeatUnit(event: Event): void {
    const parsed = Number.parseInt((event.target as HTMLSelectElement).value, 10);
    if (isBeatUnit(parsed)) {
      this.beatUnitChange.emit(parsed);
    }
  }
}
