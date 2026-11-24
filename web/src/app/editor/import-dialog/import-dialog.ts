import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { detectFormat } from '@amk/import/format';
import {
  CHANNEL_LIMIT,
  type MidiImport,
  SmfError,
  addWhileFits,
  fits,
  oneEach,
  readMidi,
  writeMidi,
} from '@amk/import/midi';
import { familyOf } from '@amk/import/midi/gm';
import { STOCK_NAMES } from '../../output/command-inspector/instrument-inspector/instrument-choices';
import { Button } from '../../shared/button/button';
import { ButtonGroup } from '../../shared/button-group/button-group';
import { IconPause } from '../../shared/icons/icon-pause';
import { IconPlay } from '../../shared/icons/icon-play';
import { IconStop } from '../../shared/icons/icon-stop';
import { Modal } from '../../shared/modal/modal';
import { Toggle } from '../../shared/toggle/toggle';
import { Audition } from '../../state/audition';
import { DriverStore } from '../../state/driver-store';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import { Mixer } from '../../state/mixer';
import { Playback } from '../../state/playback';
import { stopAll } from '../../state/stop-all';
import { CHANNEL_BG, CHANNEL_SCOPE } from '../../util/channel-palette';
import { errorMessage } from '../../util/format';
import { readStored, writeStored } from '../../util/storage';
import {
  HIGHEST_PITCH,
  LOWEST_PITCH,
  isStock,
  isStockDrum,
  readDrumMap,
  soundOf,
  withInstrument,
  withPitch,
  writeDrumMap,
} from './import-drums';
import { type Candidate, buildCandidate } from './import-candidate';
import { ImportPreview } from './import-preview';
import { DRUM_NAMES, REFUSALS, kindOf, sourceOf, warningText } from './import-text';

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

/** The pitches a drum sound on a pitched instrument may be set to. */
const PITCHES = Array.from({ length: HIGHEST_PITCH - LOWEST_PITCH + 1 }, (_, i) => ({
  value: LOWEST_PITCH + i,
  label: keyName(LOWEST_PITCH + i),
}));

/**
 * The Import dialog: a file read into parts, the parts to keep and what to play them on, and a
 * preview of the song they make before it replaces the document.
 *
 * A MIDI channel playing chords is split into parts that play one note at a time, and a kit into
 * its families, so a file may make more parts than AddmusicK has channels; every instrument's first
 * voice, then the parts that sound the most, are kept until the porter chooses. Share channels lets
 * parts that never sound at once take turns on one channel, so the limit is eight channels rather
 * than eight parts. The drum map plays each GM drum sound on the instrument the porter picks, and is
 * kept across imports. Every change rewrites and recompiles the candidate, and a playing preview
 * carries on from where it was.
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
    kitCustom: $localize`:@@import.part.kit.custom:import.part.kit.custom`,
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
  protected readonly pitchOptions = PITCHES;
  protected readonly limit = CHANNEL_LIMIT;

  protected readonly fileName = signal('');
  protected readonly refusal = signal<string | null>(null);
  private readonly midi = signal<MidiImport | null>(null);
  protected readonly grid = signal(this.storedSnap());
  protected readonly keep = signal<readonly string[]>([]);
  private readonly instruments = signal<ReadonlyMap<string, number>>(new Map());
  /** The porter's sound for each GM drum key, kept across imports. */
  protected readonly drumMap = signal(readDrumMap());
  protected readonly showDrums = signal(false);
  protected readonly echo = signal(true);
  protected readonly loopAtMarkers = signal(true);
  protected readonly share = signal(false);
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
        drums: this.drumMap(),
        echo: this.echo(),
        share: this.share(),
        loop: this.loopAtMarkers() ? 'markers' : 'song',
        fallbackTitle: this.fileName().replace(/\.[^.]*$/, ''),
      },
      this.drivers.instruments(),
    );
  });

  /** The candidate compiled, assembled and walked: what the preview plays and what Import is held back by. */
  private readonly candidate = computed<Candidate>(() => {
    const written = this.written();
    if (!written || written.channels.length === 0) {
      return { song: null, error: null, result: null };
    }

    return buildCandidate(this.store, written.text);
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

    const keep = this.keep();
    const kept = new Set(keep);
    const channelOf = new Map(
      (this.written()?.channels ?? []).flatMap((ids, channel) => ids.map((id) => [id, channel])),
    );
    const chosen = this.instruments();
    return midi.parts.map((part) => {
      const on = kept.has(part.id);
      const channel = channelOf.get(part.id) ?? -1;
      const kind = kindOf(part, familyOf(part.program));
      return {
        id: part.id,
        on,
        disabled: !on && !this.room(midi, keep, part.id),
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

  protected readonly customDrums = computed(() => this.drumMap().size > 0);

  /** The drum sounds the file plays, lowest key first, each on its stock sound or the porter's. */
  protected readonly drumRows = computed(() => {
    const keys = this.midi()?.drumKeys ?? new Map<number, number>();
    const map = this.drumMap();
    return [...keys]
      .sort((a, b) => a[0] - b[0])
      .map(([key, hits]) => {
        const sound = soundOf(map, key);
        return {
          key,
          name: DRUM_NAMES[key] ?? String(key),
          hits,
          instrument: sound.instrument,
          pitched: !isStockDrum(sound.instrument),
          pitch: sound.key ?? null,
          custom: !isStock(key, sound),
        };
      });
  });

  protected readonly keptCount = computed(() => this.keep().length);
  protected readonly channelCount = computed(() => this.written()?.channels.length ?? 0);
  /** Whether no part left out could be kept. */
  protected readonly full = computed(() => {
    const midi = this.midi();
    if (!midi) {
      return false;
    }

    const keep = this.keep();
    return midi.parts.every((part) => keep.includes(part.id) || !this.room(midi, keep, part.id));
  });

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

    // Sanctioned effect: mirrors the drum map into storage.
    effect(() => writeDrumMap(this.drumMap()));
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
    this.showDrums.set(false);
    this.echo.set(true);
    this.midi.set(null);
    this.refusal.set(null);
    if (detectFormat(bytes) === null) {
      this.refusal.set(REFUSALS['not-midi']);
    } else {
      try {
        const midi = readMidi(bytes);
        this.keep.set(this.share() ? midi.suggestedShared : midi.suggested);
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

  /** Whether keeping `id` as well as `keep` still fits on AddmusicK's channels. */
  private room(midi: MidiImport, keep: readonly string[], id: string): boolean {
    if (!this.share()) {
      return keep.length < CHANNEL_LIMIT;
    }

    const next = midi.parts
      .filter((part) => part.id === id || keep.includes(part.id))
      .map((part) => part.id);
    return fits(midi.parts, next, midi.clash, CHANNEL_LIMIT);
  }

  /**
   * Sharing on keeps the porter's choice and adds the parts that now fit; sharing off keeps the
   * first eight of it by priority, one a channel.
   */
  protected toggleShare(): void {
    const midi = this.midi();
    const share = !this.share();
    this.share.set(share);
    if (midi) {
      this.keep.set(
        share
          ? addWhileFits(midi.parts, this.keep(), midi.clash, CHANNEL_LIMIT)
          : oneEach(midi.parts, this.keep(), CHANNEL_LIMIT),
      );
    }
  }

  protected toggleKeep(id: string): void {
    const midi = this.midi();
    if (!midi) {
      return;
    }

    const kept = new Set(this.keep());
    if (kept.has(id)) {
      kept.delete(id);
    } else if (this.room(midi, this.keep(), id)) {
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

  protected setDrumInstrument(key: number, event: Event): void {
    const instrument = Number((event.target as HTMLSelectElement).value);
    this.drumMap.set(withInstrument(this.drumMap(), key, instrument));
  }

  protected setDrumPitch(key: number, event: Event): void {
    const pitch = Number((event.target as HTMLSelectElement).value);
    this.drumMap.set(withPitch(this.drumMap(), key, pitch));
  }

  protected resetDrums(): void {
    this.drumMap.set(new Map());
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
