import { Component, computed, inject } from '@angular/core';

import type { SongTimeline } from '@amk/spc/song-walk';
import { DEFAULT_TEMPO, ticksPerSecond } from '@amk/tokens/commands/units';
import { ClockMeasurer } from '../state/clock-measurer';
import { EditorRequests } from '../state/editor-requests';
import { type StatusKind, EditorStore } from '../state/editor-store';
import { tempoShortfall } from '../state/measure-clock';
import { Playback } from '../state/playback';

/**
 * The dot per status, spelled out in full: Tailwind finds classes by scanning
 * source text, so a built-up name generates no CSS. `busy` pulses, being the
 * one kind that is about to change on its own.
 */
const DOT: Record<StatusKind, string> = {
  ok: 'size-2 shrink-0 rounded-full bg-good',
  info: 'size-2 shrink-0 rounded-full bg-ink-muted',
  error: 'size-2 shrink-0 rounded-full bg-danger',
  busy: 'size-2 shrink-0 rounded-full bg-ink-muted animate-pulse',
};

/**
 * The last `t` written at or before a tick, or the driver's own default where
 * none is. A fade is taken at its target, which is what stands once it is done.
 */
function writtenTempoAt(song: SongTimeline, tick: number): number {
  let tempo = DEFAULT_TEMPO;
  for (const change of song.tempoChanges) {
    if (change.tick > tick) {
      break;
    }

    tempo = change.tempo;
  }

  return tempo;
}

const TEXT: Record<StatusKind, string> = {
  ok: 'text-good',
  info: 'text-ink-muted',
  error: 'text-danger',
  busy: 'text-ink-muted',
};

/**
 * The one-row footer: FL's hint bar.
 *
 * It holds the compile status, the problem count, the free ARAM, the note
 * count, the tempo and tick rate at the playhead, and the credits — each a
 * line long and belonging to the whole song rather than to either pane, so
 * they sit at the same height on every screen and no pane has to keep a header
 * for them. The status, the counts, the space and the rate are what a porter
 * glances at between keystrokes; the problem count and the space are buttons
 * because the answer to "what problems?" and "what is using it?" is a section
 * of the output pane.
 */
@Component({
  selector: 'amk-status-bar',
  templateUrl: './status-bar.html',
  host: {
    class: 'border-edge bg-raised flex h-6 shrink-0 items-center gap-3 border-t px-3 text-xs',
  },
})
export class StatusBar {
  protected readonly store = inject(EditorStore);
  protected readonly requests = inject(EditorRequests);
  private readonly playback = inject(Playback);
  private readonly measurer = inject(ClockMeasurer);

  protected readonly dotClass = computed(() => DOT[this.store.status().kind]);
  protected readonly textClass = computed(() => TEXT[this.store.status().kind]);

  protected readonly problemsLabel = computed(() => {
    const count = this.store.diagnostics().length;

    if (count === 0) {
      return 'No problems';
    }

    return count === 1 ? '1 problem' : `${count} problems`;
  });

  /** The worst severity in the list decides the colour; `info` alone earns none. */
  protected readonly problemsClass = computed(() => {
    const diagnostics = this.store.diagnostics();

    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      return 'text-danger';
    }

    if (
      diagnostics.some(
        (diagnostic) => diagnostic.severity === 'warning' || diagnostic.severity === 'severe',
      )
    ) {
      return 'text-warn';
    }

    return 'text-ink-muted';
  });

  /** The walk's note count: a fact about the song, so it is here whatever view is showing. */
  protected readonly notesLabel = computed(() => {
    const song = this.store.timeline();
    return song ? `${song.notes.length.toLocaleString()} notes` : null;
  });

  /**
   * The tempo at the playhead and the ticks per second the driver manages there.
   *
   * The tempo is the driver's own while it is playing and the walk's last `t`
   * at or before the playhead otherwise, as `t` writes it — `DriverState.tempo`
   * is `$51`, one higher. The rate the song is *getting* is not always the rate
   * the tempo byte asks for: the driver runs at most one tick per pass of its
   * main loop, so a busy song gets fewer. Both are shown when they part company
   * by enough to matter, since `t254 · 231 ticks/s` on its own reads like a bug.
   *
   * The shortfall is the measurement's over the whole pass, the same figure
   * `SST0503` is raised on, applied at the playhead's tempo. Not the measured
   * clock's slope at the tick: the measurement polls once a tick in 5 ms
   * blocks, so a single segment reads 100 or 125 ticks/s on a song that plays
   * at 107, and a readout built on one would flicker between the two forms.
   * The measurement is the latest to land, which stands until the next does.
   */
  protected readonly rateLabel = computed(() => {
    const song = this.store.timeline();
    if (!song) {
      return null;
    }

    const tick = this.playback.position();
    const driver = this.playback.driver();
    const tempo = driver && driver.tempo > 0 ? driver.tempo - 1 : writtenTempoAt(song, tick);
    if (tempo <= 0) {
      return null;
    }

    const asked = ticksPerSecond(tempo);
    const measured = this.measurer.measured();
    const shortfall = measured ? tempoShortfall(measured) : null;
    const got = shortfall ? asked / shortfall : asked;
    const rate =
      got > 0 && got < asked * 0.95
        ? `${got.toFixed(1)} of ${asked.toFixed(1)} ticks/s`
        : `${asked.toFixed(1)} ticks/s`;
    return `t${tempo} · ${rate}`;
  });

  /** Red once the song no longer fits, which is the one reading that changes what a porter does next. */
  protected readonly aramClass = computed(() =>
    (this.store.budget()?.overflowBytes ?? 0) > 0 ? 'text-danger' : 'text-ink-muted',
  );
}
