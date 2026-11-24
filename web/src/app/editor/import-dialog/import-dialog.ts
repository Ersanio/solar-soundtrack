import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { detectFormat } from '@amk/import/format';
import { CHANNEL_LIMIT, type MidiImport, SmfError, readMidi, writeMidi } from '@amk/import/midi';
import { familyOf } from '@amk/import/midi/gm';
import { walkSong } from '@amk/spc/song-walk';
import { STOCK_NAMES } from '../../output/command-inspector/instrument-inspector/instrument-choices';
import { Button } from '../../shared/button/button';
import { ButtonGroup } from '../../shared/button-group/button-group';
import { IconPause } from '../../shared/icons/icon-pause';
import { IconPlay } from '../../shared/icons/icon-play';
import { IconStop } from '../../shared/icons/icon-stop';
import { Modal } from '../../shared/modal/modal';
import { Toggle } from '../../shared/toggle/toggle';
import { Audition } from '../../state/audition';
import { parsing } from '../../state/draft-guard';
import { DriverStore } from '../../state/driver-store';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import { Mixer } from '../../state/mixer';
import { Playback } from '../../state/playback';
import { songClock } from '../../state/song-clock';
import { stopAll } from '../../state/stop-all';
import { CHANNEL_BG, CHANNEL_SCOPE } from '../../util/channel-palette';
import { errorMessage } from '../../util/format';
import { readStored, writeStored } from '../../util/storage';
import { type PreviewSong, ImportPreview } from './import-preview';
import { REFUSALS, kindOf, sourceOf, warningText } from './import-text';

const SNAP_KEY = 'solar-soundtrack.import-snap';
const LETTERS = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
const CHIP_CLASS =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] px-1 font-mono text-[10px] leading-none font-semibold text-(--on-ch)';
/** The stock instruments a melodic part may be played on, `@0`-`@18` and the drums. */
const INSTRUMENTS = [...STOCK_NAMES].map(([value, name]) => ({
  value,
  label: `@${value} · ${name}`,
}));

/** A MIDI key as MML names it, octave first: 60 is `o4 c`. */
function keyName(key: number): string {
  return `o${Math.floor((key - 24) / 12) + 1} ${LETTERS[key % 12]}`;
}

/**
 * The Import dialog: a file read into parts, the parts to keep and what to play them on, and a
 * preview of the song they make before it replaces the document.
 *
 * A MIDI channel playing chords is split into parts that play one note at a time, and a kit into
 * its families, so a file may make more parts than AddmusicK has channels; the eight that sound
 * the most are kept until the porter chooses. Every change rewrites and recompiles the candidate,
 * and a playing preview carries on from where it was.
 */
@Component({
  selector: 'amk-import-dialog',
  imports: [Button, ButtonGroup, IconPause, IconPlay, IconStop, Modal, Toggle],
  templateUrl: './import-dialog.html',
  host: { class: 'contents' },
})
export class ImportDialog {
  private readonly store = inject(EditorStore);
  private readonly drivers = inject(DriverStore);
  private readonly requests = inject(EditorRequests);
  private readonly playback = inject(Playback);
  private readonly audition = inject(Audition);
  private readonly mixer = inject(Mixer);

  private readonly modal = viewChild.required(Modal);

  protected readonly text = {
    play: $localize`:@@import.preview.play.title:import.preview.play.title`,
    pause: $localize`:@@import.preview.pause.title:import.preview.pause.title`,
    kit: $localize`:@@import.part.kit:import.part.kit`,
  };

  protected readonly snaps = [
    { ticks: 12, label: '1/16' },
    { ticks: 6, label: '1/32' },
    { ticks: 4, label: $localize`:@@import.snap.triplet:import.snap.triplet` },
    { ticks: 3, label: '1/64' },
    { ticks: 2, label: '1/96' },
    { ticks: 1, label: $localize`:@@import.snap.exact:import.snap.exact` },
  ];
  protected readonly instrumentOptions = INSTRUMENTS;
  protected readonly limit = CHANNEL_LIMIT;

  protected readonly fileName = signal('');
  protected readonly refusal = signal<string | null>(null);
  private readonly midi = signal<MidiImport | null>(null);
  protected readonly grid = signal(this.storedSnap());
  protected readonly keep = signal<readonly string[]>([]);
  private readonly instruments = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly echo = signal(true);
  protected readonly loopAtMarkers = signal(true);
  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly previewError = signal<string | null>(null);

  protected readonly heading = computed(() => {
    const name = this.fileName();
    return $localize`:@@import.heading:import.heading ${name}:name:`;
  });

  protected readonly hasMarkers = computed(() => this.midi()?.performance.loop != null);

  protected readonly summary = computed(() => {
    const midi = this.midi();
    if (!midi) {
      return '';
    }

    const { format, tracks, division } = midi.performance;
    const parts = midi.parts.length;
    return division.kind === 'ppq'
      ? $localize`:@@import.summary:import.summary ${format}:format: ${tracks}:tracks: ${division.ppq}:ppq: ${parts}:parts:`
      : $localize`:@@import.summary.smpte:import.summary.smpte ${format}:format: ${tracks}:tracks: ${parts}:parts:`;
  });

  private readonly written = computed(() => {
    const midi = this.midi();
    if (!midi) {
      return null;
    }

    return writeMidi(
      midi,
      {
        grid: this.grid(),
        keep: this.keep(),
        instruments: this.instruments(),
        echo: this.echo(),
        loop: this.loopAtMarkers() ? 'markers' : 'song',
        fallbackTitle: this.fileName().replace(/\.[^.]*$/, ''),
      },
      this.drivers.instruments(),
    );
  });

  /** The candidate compiled, assembled and walked: what the preview plays and what Import is held back by. */
  private readonly candidate = computed<{ song: PreviewSong | null; error: string | null }>(() => {
    const written = this.written();
    if (!written || written.channels.length === 0) {
      return { song: null, error: null };
    }

    const compiled = this.store.compileText(written.text);
    if (!compiled) {
      return { song: null, error: null };
    }

    const { result, aramAddress } = compiled;
    const failure = result.diagnostics.find((d) => d.severity === 'error');
    if (!result.ok || !result.data || failure) {
      return { song: null, error: failure ? `${failure.code}: ${failure.message}` : null };
    }

    let spc: Uint8Array | null;
    try {
      spc = this.store.spcFor(result);
    } catch (error) {
      return { song: null, error: errorMessage(error) };
    }

    const data = result.data;
    const timeline = parsing(() => walkSong(data, aramAddress));
    const stats = result.stats;
    return {
      song: spc
        ? {
            spc,
            introTicks: stats?.introTicks ?? 0,
            loopTicks: stats?.loopTicks ?? 0,
            loops: stats?.loops ?? true,
            clock: songClock(timeline),
          }
        : null,
      error: null,
    };
  });

  protected readonly error = computed(() => this.candidate().error);
  protected readonly canImport = computed(
    () => this.written() !== null && this.candidate().song !== null,
  );

  protected readonly rows = computed(() => {
    const midi = this.midi();
    if (!midi) {
      return [];
    }

    const kept = new Set(this.keep());
    const channels = this.written()?.channels ?? [];
    const full = kept.size >= CHANNEL_LIMIT;
    const chosen = this.instruments();
    return midi.parts.map((part) => {
      const on = kept.has(part.id);
      const channel = channels.indexOf(part.id);
      const kind = kindOf(part, familyOf(part.program));
      return {
        id: part.id,
        on,
        disabled: !on && full,
        channel: channel >= 0 ? `#${channel}` : null,
        chipClass:
          channel >= 0 ? `${CHIP_CLASS} ${CHANNEL_BG[channel]} ${CHANNEL_SCOPE[channel]}` : '',
        name: part.name ?? kind,
        kind,
        source: sourceOf(part),
        notes: part.noteCount,
        range: part.drums ? '' : `${keyName(part.low)} – ${keyName(part.high)}`,
        drums: part.drums,
        instrument: chosen.get(part.id) ?? part.instrument,
      };
    });
  });

  protected readonly keptCount = computed(() => this.keep().length);
  protected readonly full = computed(() => this.keep().length >= CHANNEL_LIMIT);

  protected readonly warnings = computed(() => {
    const midi = this.midi();
    const written = this.written();
    if (!midi || !written) {
      return [];
    }

    const label = (id: string): string => this.rows().find((row) => row.id === id)?.name ?? id;
    return written.warnings.map((warning) => warningText(warning, label));
  });

  constructor() {
    // Sanctioned effect: mirrors the candidate into the preview's player.
    effect(() => {
      const song = this.candidate().song;
      untracked(() => this.preview()?.load(song));
    });

    // Sanctioned effect: mirrors the Snap choice into storage.
    effect(() => writeStored(SNAP_KEY, String(this.grid())));
  }

  private storedSnap(): number {
    const stored = Number(readStored(SNAP_KEY));
    return [1, 2, 3, 4, 6, 12].includes(stored) ? stored : 3;
  }

  /** Reads `bytes` and opens the dialog on them, or on why they cannot be read. */
  openWith(name: string, bytes: Uint8Array): void {
    this.fileName.set(name);
    this.previewError.set(null);
    this.instruments.set(new Map());
    this.echo.set(true);
    this.midi.set(null);
    this.refusal.set(null);
    if (detectFormat(bytes) === null) {
      this.refusal.set(REFUSALS['not-midi']);
    } else {
      try {
        const midi = readMidi(bytes);
        this.keep.set(midi.suggested);
        this.loopAtMarkers.set(midi.performance.loop !== null);
        this.midi.set(midi);
      } catch (error) {
        this.refusal.set(error instanceof SmfError ? REFUSALS[error.code] : errorMessage(error));
      }
    }

    this.preview.set(
      new ImportPreview(
        () => this.mixer.volume() / 100,
        () => stopAll(this.playback, this.audition),
        (error) => this.previewError.set(errorMessage(error)),
      ),
    );
    this.preview()?.load(this.candidate().song);
    this.modal().open();
  }

  protected toggleKeep(id: string): void {
    const midi = this.midi();
    if (!midi) {
      return;
    }

    const kept = new Set(this.keep());
    if (kept.has(id)) {
      kept.delete(id);
    } else if (kept.size < CHANNEL_LIMIT) {
      kept.add(id);
    }

    this.keep.set(midi.parts.filter((part) => kept.has(part.id)).map((part) => part.id));
  }

  protected setInstrument(id: string, event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    const next = new Map(this.instruments());
    next.set(id, value);
    this.instruments.set(next);
  }

  protected setSnap(event: Event): void {
    this.grid.set(Number((event.target as HTMLSelectElement).value));
  }

  protected onScrub(event: Event): void {
    this.preview()?.scrubTo(Number((event.target as HTMLInputElement).value));
  }

  /** Replaces the whole document with the song, one undo step back to what was open. */
  protected confirm(): void {
    const written = this.written();
    if (!written || !this.canImport()) {
      return;
    }

    stopAll(this.playback, this.audition);
    const current = this.store.source();
    this.requests.applyAll(
      [{ span: { start: 0, end: current.length, line: 1 }, text: written.text, expect: current }],
      null,
      false,
      true,
    );
    this.modal().close();
  }

  protected close(): void {
    this.modal().close();
  }

  /** However the dialog closed, the preview stops and lets its audio go. */
  protected onClosed(): void {
    this.preview()?.dispose();
    this.preview.set(null);
    this.midi.set(null);
  }
}
