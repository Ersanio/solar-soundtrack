import { Component, computed, input, output, viewChild } from '@angular/core';

import { Button } from '../../../../shared/button/button';
import { ButtonGroup } from '../../../../shared/button-group/button-group';
import { IconMinus } from '../../../../shared/icons/icon-minus';
import { IconPlus } from '../../../../shared/icons/icon-plus';
import { Toggle } from '../../../../shared/toggle/toggle';
import { Toolbar } from '../../../../shared/toolbar/toolbar';
import { HistoryButtons } from '../../../history-buttons/history-buttons';
import { IconRecord } from '../../../../shared/icons/icon-record';
import { IconRecording } from '../../../../shared/icons/icon-recording';
import { EDIT_MODES, type EditMode } from '../roll-edit';
import type { RecordPhase } from '../roll-record';
import { RollRecordDialog } from '../roll-record-dialog/roll-record-dialog';
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
    ButtonGroup,
    Toggle,
    IconMinus,
    IconPlus,
    IconRecord,
    IconRecording,
    HistoryButtons,
    RollRecordDialog,
    Toolbar,
  ],
  templateUrl: './roll-toolbar.html',
  host: { class: 'contents' },
})
export class RollToolbar {
  private readonly recordDialog = viewChild.required(RollRecordDialog);

  readonly recordPhase = input.required<RecordPhase>();
  /** How many notes the take in flight holds. */
  readonly recordNotes = input.required<number>();
  /** Why the last recording did not start or was not written whole, or null. */
  readonly recordMessage = input.required<string | null>();
  readonly keySounds = input.required<boolean>();
  readonly playSong = input.required<boolean>();
  /** The channel being edited, which a take is always recorded on. */
  readonly editChannel = input.required<number | null>();
  /** Every channel a take is spread over, the edited one included. */
  readonly recordChannels = input.required<readonly number[]>();

  /** The dialog's Arm, which arms a recording. */
  readonly recordArm = output();
  /** Record pressed while armed or recording, which ends the take. */
  readonly recordStop = output();
  readonly keySoundsChange = output<boolean>();
  readonly playSongChange = output<boolean>();
  readonly chordChannelToggle = output<number>();

  readonly follow = input.required<boolean>();
  readonly scrollNotes = input.required<boolean>();
  readonly allOctaves = input.required<boolean>();
  readonly beatsPerBar = input.required<number>();
  readonly beatUnit = input.required<number>();
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
  readonly snapChange = output<SnapName>();
  readonly editModeChange = output<EditMode>();

  /** For the two grid controls. */
  protected readonly beatUnits = BEAT_UNITS;
  protected readonly maxBeats = MAX_BEATS;

  /** For the Snap control. The names are the porter's, not the tick counts. */
  protected readonly snaps = SNAPS;
  protected readonly snapLabels: Record<SnapName, string> = {
    bar: $localize`:@@roll.snap.bar:roll.snap.bar`,
    beat: $localize`:@@roll.snap.beat:roll.snap.beat`,
    half: $localize`:@@roll.snap.half:roll.snap.half`,
    quarter: $localize`:@@roll.snap.quarter:roll.snap.quarter`,
    eighth: $localize`:@@roll.snap.eighth:roll.snap.eighth`,
    // Built from `⅟` and subscript digits, the vulgar fractions running out at ⅛.
    sixteenth: $localize`:@@roll.snap.sixteenth:roll.snap.sixteenth`,
    off: $localize`:@@roll.snap.off:roll.snap.off`,
  };

  /** For the Edits control. Both modes are named, so neither has to be inferred. */
  protected readonly editModes = EDIT_MODES;
  protected readonly editModeLabels: Record<EditMode, string> = {
    overwrite: $localize`:@@roll.mode.overwrite:roll.mode.overwrite`,
    insert: $localize`:@@roll.mode.insert:roll.mode.insert`,
    strict: $localize`:@@roll.mode.strict:roll.mode.strict`,
  };

  /**
   * How many notes are selected, said only while any are. Which channel is
   * being edited is the corner picker's to say, and the rings say which notes.
   */
  protected readonly selectedLabel = computed(() => {
    const selected = this.selected();
    return selected > 0
      ? $localize`:@@roll.selected:roll.selected ${selected.toLocaleString()}:selected:`
      : null;
  });

  /** What a recording is doing, said only while there is one. */
  protected readonly recordStatus = computed(() => {
    const notes = this.recordNotes();
    switch (this.recordPhase()) {
      case 'idle':
        return null;
      case 'armed':
        return $localize`:@@roll.record.waiting:roll.record.waiting`;
      case 'recording':
        return notes === 1
          ? $localize`:@@roll.record.recording.one:roll.record.recording.one`
          : $localize`:@@roll.record.recording.other:roll.record.recording.other ${notes.toLocaleString()}:count:`;
    }
  });

  /** Idle, Record asks for the settings before it arms; otherwise it stops. */
  protected pressRecord(): void {
    if (this.recordPhase() === 'idle') {
      this.recordDialog().open();
    } else {
      this.recordStop.emit();
    }
  }

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
