import { Component, computed, inject, input, output } from '@angular/core';

import { ticksPerSecond } from '@amk/tokens/commands/units';
import { Checkbox } from '../../../../shared/checkbox/checkbox';
import { Toolbar } from '../../../../shared/toolbar/toolbar';
import { EditorStore } from '../../../../state/editor-store';
import { Playback } from '../../../../state/playback';
import { ticksPerSecondAt } from '../../../../state/song-clock';
import { HistoryButtons } from '../../../history-buttons/history-buttons';
import { NormalizeButton } from '../../../normalize-button/normalize-button';
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
  imports: [Checkbox, HistoryButtons, NormalizeButton, Toolbar],
  templateUrl: './roll-toolbar.html',
  host: { class: 'contents' },
})
export class RollToolbar {
  private readonly editor = inject(EditorStore);
  private readonly playback = inject(Playback);

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
  /** Whether a rewrite of that channel is the answer to the refusal. */
  readonly normalizable = input.required<boolean>();
  /** How many notes are selected, for the readout. */
  readonly selected = input.required<number>();
  /** The channel the corner's picker has selected, or null when none is. */
  readonly editChannel = input.required<number | null>();
  /** The tick the readout reports, which the parent takes slowly while playing. */
  readonly tick = input.required<number>();

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
    off: 'Off',
  };

  /** For the Edits control. Both modes are named, so neither has to be inferred. */
  protected readonly editModes = EDIT_MODES;
  protected readonly editModeLabels: Record<EditMode, string> = {
    strict: 'Strict',
    flexible: 'Flexible',
  };

  /**
   * Which channel the picker has selected, named in the roll's own terms.
   *
   * Nothing acts on the selection yet, so this is how it is read at all. Its own
   * label rather than a part of {@link readout}, since the two answer different
   * questions and one of them is scaffolding.
   */
  protected readonly editLabel = computed(() => {
    const channel = this.editChannel();
    if (channel === null) {
      return 'editing: none';
    }

    const selected = this.selected();
    const chosen = selected > 0 ? ` · ${selected} selected` : '';
    return `editing: #${channel}${chosen}`;
  });

  protected readonly readout = computed(() => {
    const song = this.editor.timeline();
    if (!song) {
      return 'no song';
    }

    const driver = this.playback.driver();
    // `DriverState.tempo` is `$51`, one higher than `t`.
    const tempo = driver && driver.tempo > 0 ? driver.tempo - 1 : 0;
    const tick = this.tick();
    const parts = [`tick ${Math.round(tick).toLocaleString()} of ${song.ticks.toLocaleString()}`];
    if (tempo > 0) {
      // The rate the song is *getting*, which on a busy one is not the rate the
      // tempo byte asks for — the driver runs at most one tick per pass of its
      // main loop. Both are shown when they part company by enough to matter,
      // since "t254 · 231 ticks/s" on its own reads like a bug in the readout.
      const clock = this.editor.clock();
      const asked = ticksPerSecond(tempo);
      const got = clock ? ticksPerSecondAt(clock, tick) : asked;
      const rate =
        got > 0 && got < asked * 0.95
          ? `${got.toFixed(1)} of ${asked.toFixed(1)} ticks/s`
          : `${asked.toFixed(1)} ticks/s`;
      parts.push(`t${tempo} · ${rate}`);
    }

    parts.push(`${song.notes.length.toLocaleString()} notes`);
    return parts.join(' · ');
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
