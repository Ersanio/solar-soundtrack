import { Component, computed, input, output } from '@angular/core';

import { Button } from '../../../../shared/button/button';
import { IconChevronDown } from '../../../../shared/icons/icon-chevron-down';
import { IconChevronRight } from '../../../../shared/icons/icon-chevron-right';
import { IconMinus } from '../../../../shared/icons/icon-minus';
import { IconPlus } from '../../../../shared/icons/icon-plus';
import { Toggle } from '../../../../shared/toggle/toggle';
import { Toolbar } from '../../../../shared/toolbar/toolbar';
import { HistoryButtons } from '../../../history-buttons/history-buttons';
import { IconRecord } from '../../../../shared/icons/icon-record';
import { CHANNELS } from '../../../../state/transport-view';
import { CHANNEL_BG } from '../../../../util/channel-palette';
import { EDIT_MODES, type EditMode } from '../roll-edit';
import type { RecordPhase } from '../roll-record';
import {
  BEAT_UNITS,
  MAX_BEATS,
  SNAPS,
  type SnapName,
  clampBeats,
  isBeatUnit,
} from '../roll-settings';

/**
 * A chord channel's chip: the channel's own colour as its only background, as
 * the corner picker's chips are, with the ring and the dim saying whether a
 * chord may land on it.
 */
const CHIP_CLASS =
  'flex h-5 w-5 cursor-pointer items-center justify-center rounded-[3px] font-mono text-[10px] leading-none font-semibold text-ink transition disabled:cursor-default';
const CHIP_ON = 'ring-ink ring-2 ring-inset';
const CHIP_OFF = 'opacity-40 hover:not-disabled:opacity-70';

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
    IconRecord,
    HistoryButtons,
    Toolbar,
  ],
  templateUrl: './roll-toolbar.html',
  host: { class: 'contents' },
})
export class RollToolbar {
  protected readonly text = {
    hidePercussion: $localize`:@@roll.percussion.hide.title:roll.percussion.hide.title`,
    choosePercussion: $localize`:@@roll.percussion.choose.title:roll.percussion.choose.title`,
    startRecording: $localize`:@@roll.record.start.title:roll.record.start.title`,
    stopRecording: $localize`:@@roll.record.stop.title:roll.record.stop.title`,
  };

  /** Whether MIDI keyboards are being listened to, which is what shows the Record group. */
  readonly midiOn = input.required<boolean>();
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

  readonly recordToggle = output();
  readonly keySoundsChange = output<boolean>();
  readonly playSongChange = output<boolean>();
  readonly chordChannelToggle = output<number>();

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

  /**
   * One chip per channel a chord can spread over. The edited channel's is lit
   * and takes no press, a take always being recorded on it.
   */
  protected readonly chordChips = computed(() => {
    const edited = this.editChannel();
    const chosen = new Set(this.recordChannels());
    return Array.from({ length: CHANNELS }, (_, channel) => {
      const fixed = channel === edited;
      const on = chosen.has(channel);
      return {
        channel,
        fixed,
        title: fixed
          ? $localize`:@@roll.record.chord.edited:roll.record.chord.edited ${channel}:channel:`
          : on
            ? $localize`:@@roll.record.chord.remove:roll.record.chord.remove ${channel}:channel:`
            : $localize`:@@roll.record.chord.add:roll.record.chord.add ${channel}:channel:`,
        class: `${CHIP_CLASS} ${CHANNEL_BG[channel]} ${on ? CHIP_ON : CHIP_OFF}`,
      };
    });
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
