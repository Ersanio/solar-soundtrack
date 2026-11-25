import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import { ItError, readIt } from '@amk/import/it';
import { ModError, readMod } from '@amk/import/mod';
import { S3mError, readS3m } from '@amk/import/s3m';
import { XmError, readXm } from '@amk/import/xm';
import {
  TRACKER_CHANNEL_LIMIT,
  type TrackerImport,
  type TrackerSongOptions,
  type WrittenTrackerSong,
  addWhileFits,
  fitFactor,
  fitsShared,
  oneEach,
  planSample,
  plannedFrames,
  writeTracker,
} from '@amk/import/tracker';
import { type TrackerFormat, UmxError, isUmx, trackerFormatOf, unwrapUmx } from '@amk/import/umx';
import { type BrrSample, decodeBrr, emptySample, parseBrr } from '@amk/spc/brr';
import { brrDataBytes, encodeBrr } from '@amk/spc/brr-encode';
import { computeSpcLayout } from '@amk/spc/layout';
import { SPC_SAMPLE_RATE } from '@amk/spc/wasm-host';
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
import { SampleStore } from '../../state/sample-store';
import { stopAll } from '../../state/stop-all';
import { CHANNEL_BG, CHANNEL_SCOPE } from '../../util/channel-palette';
import { errorMessage } from '../../util/format';
import { type Candidate, buildCandidate } from '../import-dialog/import-candidate';
import { ImportPreview } from '../import-dialog/import-preview';
import {
  MOD_REFUSALS,
  IT_REFUSALS,
  S3M_REFUSALS,
  XM_REFUSALS,
  UMX_REFUSALS,
  modWarningText,
} from '../import-dialog/import-text';

/** What the porter chose for a sample: the factor that fits, a factor of their own, or none of its notes. */
type Choice = 'auto' | 'drop' | number;

/** A sample planned and encoded at one factor, with the loop frame and the rate it plays C-2 at. */
interface Encoding {
  sample: BrrSample;
  bytes: Uint8Array;
  loopStart: number | null;
  rate: number;
}

/** The most BRR a sample may be encoded to: its loop is a 16-bit offset, and no more would fit ARAM. */
const BRR_LIMIT = 0xffff;
/** Each format's reader. */
const READERS: Readonly<Record<TrackerFormat, (bytes: Uint8Array) => TrackerImport>> = {
  mod: readMod,
  s3m: readS3m,
  xm: readXm,
  it: readIt,
};

/** Why a file could not be read, in words. */
function refusalOf(error: unknown): string {
  if (error instanceof ModError) {
    return MOD_REFUSALS[error.code];
  }

  if (error instanceof S3mError) {
    return S3M_REFUSALS[error.code];
  }

  if (error instanceof XmError) {
    return XM_REFUSALS[error.code];
  }

  if (error instanceof ItError) {
    return IT_REFUSALS[error.code];
  }

  if (error instanceof UmxError) {
    return UMX_REFUSALS[error.code];
  }

  return errorMessage(error);
}

/** What the heading calls each format. */
const FORMAT_NAMES: Readonly<Record<TrackerFormat, string>> = {
  mod: 'MOD',
  s3m: 'S3M',
  xm: 'XM',
  it: 'IT',
};
const CHIP_CLASS =
  'inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] px-1 font-mono text-[10px] leading-none font-semibold text-(--on-ch)';
/** The factors a sample may be set to, besides Auto and Drop. */
const FACTORS: readonly { value: number; label: string }[] = [
  { value: 1, label: '1/1' },
  { value: 3 / 4, label: '3/4' },
  { value: 2 / 3, label: '2/3' },
  { value: 1 / 2, label: '1/2' },
  { value: 1 / 3, label: '1/3' },
  { value: 1 / 4, label: '1/4' },
  { value: 1 / 6, label: '1/6' },
  { value: 1 / 8, label: '1/8' },
];

/** How long a looping sample is heard for at least, so a short loop is a tone rather than a click. */
const LOOP_SECONDS = 2;

const kilobytes = (bytes: number): string => (bytes / 1024).toFixed(1);

/** Decoded `pcm` at `rate` as 32 kHz, interpolated linearly, its loop repeated out to {@link LOOP_SECONDS}. */
function heardAt(pcm: Int16Array, loopStart: number | null, rate: number): Int16Array {
  const frames = pcm.length;
  const start = loopStart ?? frames;
  const loops = start < frames;
  const step = rate / SPC_SAMPLE_RATE;
  const length = Math.ceil(
    loops ? Math.max(frames / step, LOOP_SECONDS * SPC_SAMPLE_RATE) : frames / step,
  );
  const at = (i: number): number =>
    i < frames ? pcm[i] : loops ? pcm[start + ((i - start) % (frames - start))] : 0;

  const out = new Int16Array(length);
  for (let j = 0; j < length; j++) {
    const position = j * step;
    const i = Math.floor(position);
    out[j] = Math.round(at(i) + (at(i + 1) - at(i)) * (position - i));
  }

  return out;
}

/** `text`, or `null` where there is none to show. */
const nonEmpty = (text: string | undefined): string | null =>
  text === undefined || text === '' ? null : text;

/** The file name, as a sample name can start: no `#`, `;` or `"`, which MML reads (`validateName`). */
function stemOf(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]*$/, '')
    .replace(/[#;"]/g, '')
    .trim();
  return stem === '' ? 'Module' : stem;
}

/**
 * The Import dialog for a tracker module (a MOD, an S3M, an XM or an IT, or a UMX holding one): its channels to
 * keep, each sample's resampling, and a preview of the song they make before it replaces the document
 * and its samples join the library.
 *
 * AddmusicK has far less room for samples than a module carries, so every sample left on Auto shares the
 * one factor that fills what ARAM has left once the song and `#default` are in, and a porter can set a
 * sample's own factor or drop it. Every change rewrites, re-encodes and recompiles the candidate, and a
 * playing preview carries on from where it was.
 */
@Component({
  selector: 'amk-mod-import-dialog',
  imports: [Button, ButtonGroup, IconPause, IconPlay, IconStop, Modal, Toggle],
  templateUrl: './mod-import-dialog.html',
  host: { class: 'contents' },
})
export class ModImportDialog {
  private readonly store = inject(EditorStore);
  private readonly drivers = inject(DriverStore);
  private readonly library = inject(SampleStore);
  private readonly requests = inject(EditorRequests);
  private readonly playback = inject(Playback);
  private readonly audition = inject(Audition);
  private readonly mixer = inject(Mixer);

  private readonly modal = viewChild.required(Modal);

  protected readonly text = {
    play: $localize`:@@import.preview.play.title:import.preview.play.title`,
    pause: $localize`:@@import.preview.pause.title:import.preview.pause.title`,
    oneShot: $localize`:@@import.mod.sample.one-shot:import.mod.sample.one-shot`,
    drop: $localize`:@@import.mod.rate.drop:import.mod.rate.drop`,
    unused: $localize`:@@import.mod.sample.unused:import.mod.sample.unused`,
    hear: $localize`:@@import.mod.sample.play.title:import.mod.sample.play.title`,
    stopHearing: $localize`:@@import.mod.sample.stop.title:import.mod.sample.stop.title`,
  };

  protected readonly separations = [
    { value: 1, label: '100%' },
    { value: 0.5, label: '50%' },
    { value: 0.25, label: '25%' },
    { value: 0, label: $localize`:@@import.mod.separation.mono:import.mod.separation.mono` },
  ];
  protected readonly limit = TRACKER_CHANNEL_LIMIT;

  protected readonly fileName = signal('');
  protected readonly refusal = signal<string | null>(null);
  private readonly mod = signal<TrackerImport | null>(null);
  /** The format the heading names: the module's, or `UMX` for a package it could not open. */
  private readonly format = signal('MOD');
  protected readonly keep = signal<readonly number[]>([]);
  private readonly choices = signal<ReadonlyMap<number, Choice>>(new Map());
  protected readonly separation = signal(0.5);
  protected readonly loopAtJump = signal(true);
  /** Write `#optimized` rather than `#default`, leaving the song's own samples more room. */
  protected readonly optimized = signal(false);
  /** Let channels whose notes never overlap take turns on one of AddmusicK's. */
  protected readonly share = signal(false);
  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly previewError = signal<string | null>(null);

  /** Each sample planned and encoded at a factor, kept for the dialog's life so a change re-encodes only what it moved. */
  private readonly encodings = new Map<string, Encoding>();

  protected readonly heading = computed(() => {
    const name = this.fileName();
    const format = this.format();
    return $localize`:@@import.mod.heading:import.mod.heading ${format}:format: ${name}:name:`;
  });

  protected readonly summary = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return '';
    }

    const { tag, channels, orders: count } = mod.song;
    const samples = mod.samples.length;
    return $localize`:@@import.mod.summary:import.mod.summary ${tag}:tag: ${channels}:channels: ${count}:orders: ${samples}:samples:`;
  });

  protected readonly loops = computed(() => (this.mod()?.play.loopTick ?? 0) > 0);

  private sampleName(index: number): string {
    return `${stemOf(this.fileName())} ${String(index).padStart(2, '0')}.brr`;
  }

  private choiceOf(index: number): Choice {
    return this.choices().get(index) ?? 'auto';
  }

  private encoded(mod: TrackerImport, index: number, factor: number): Encoding {
    const key = `${index}:${factor}`;
    let entry = this.encodings.get(key);
    if (!entry) {
      const name = this.sampleName(index);
      const source = mod.song.samples[index - 1];
      const plan = planSample(source, factor);
      const bytes = encodeBrr(plan.pcm, plan.loopStart);
      entry = {
        sample: parseBrr(name, bytes),
        bytes,
        loopStart: plan.loopStart,
        rate: source.baseHz * plan.factor,
      };
      this.encodings.set(key, entry);
    }

    return entry;
  }

  private options(factors: ReadonlyMap<number, number | 'drop'>): TrackerSongOptions {
    return {
      keep: this.keep(),
      factors,
      separation: this.separation(),
      loop: this.loopAtJump() ? 'jump' : 'song',
      sampleName: (index) => this.sampleName(index),
      fallbackTitle: stemOf(this.fileName()),
      optimized: this.optimized(),
      share: this.share(),
    };
  }

  /** Each sample's factor: its own, or `auto` for those left on Auto (1 where `auto` is `null`). */
  private factorsWith(auto: number | null): Map<number, number | 'drop'> {
    const factors = new Map<number, number | 'drop'>();
    for (const summary of this.mod()?.samples ?? []) {
      const choice = this.choiceOf(summary.index);
      if (choice !== 'auto') {
        factors.set(summary.index, choice);
      } else if (auto !== null) {
        factors.set(summary.index, auto);
      }
    }

    return factors;
  }

  /** The bytes ARAM has for the Auto samples once `written`, the stock set and the samples with a factor of their own are in. */
  private roomAfter(mod: TrackerImport, written: WrittenTrackerSong): number | null {
    const driver = this.drivers.driver();
    if (!driver) {
      return null;
    }

    const compiled = this.store.compileText(
      written.text,
      written.samples.map((s) => s.name),
    );
    const result = compiled?.result;
    if (!result?.ok || !result.data) {
      return null;
    }

    const extra = written.samples.map((s) =>
      this.choiceOf(s.index) === 'auto'
        ? emptySample(s.name)
        : this.encoded(mod, s.index, s.factor).sample,
    );
    const samples = this.library.resolveWith(
      result.sampleList ?? [],
      extra,
      result.stats?.sampleGroups,
    );
    return computeSpcLayout(driver, samples, result.data.length, result.stats?.echoBufferSize ?? 0)
      .freeBytes;
  }

  /** The largest factor, to a thousandth, that the Auto samples of `written` can share in `room`. */
  private fitIn(mod: TrackerImport, written: WrittenTrackerSong, room: number): number {
    const autos = written.samples
      .filter((s) => this.choiceOf(s.index) === 'auto')
      .map((s) => mod.song.samples[s.index - 1]);
    return Math.floor(fitFactor(autos, room, brrDataBytes) * 1000) / 1000;
  }

  /** The factor found on a write with every Auto sample at 1. */
  private readonly firstFactor = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return 1;
    }

    const written = writeTracker(mod, this.options(this.factorsWith(null)));
    const room = this.roomAfter(mod, written);
    return room === null ? 1 : this.fitIn(mod, written, room);
  });

  /**
   * The one factor every Auto sample shares, the largest that fits the room, to a thousandth. Each
   * instrument's tuning, and so the octave its notes are written in, moves with the factor, so the
   * song is measured again at the first factor found and the factor lowered if it no longer fits.
   */
  protected readonly autoFactor = computed(() => {
    const mod = this.mod();
    const first = this.firstFactor();
    if (!mod) {
      return first;
    }

    const written = writeTracker(mod, this.options(this.factorsWith(first)));
    const room = this.roomAfter(mod, written);
    return room === null ? first : Math.min(first, this.fitIn(mod, written, room));
  });

  private readonly written = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return null;
    }

    return writeTracker(mod, this.options(this.factorsWith(this.autoFactor())));
  });

  /** The song's samples, encoded, in `#instruments` order. */
  private readonly brrs = computed(() => {
    const mod = this.mod();
    const written = this.written();
    if (!mod || !written) {
      return [];
    }

    return written.samples.map((s) => ({
      name: s.name,
      index: s.index,
      ...this.encoded(mod, s.index, s.factor),
    }));
  });

  private readonly candidate = computed<Candidate>(() => {
    const written = this.written();
    if (!written || written.samples.length === 0) {
      return { song: null, error: null, result: null };
    }

    const extra = this.brrs().map((b) => b.sample);
    return buildCandidate(this.store, written.text, {
      names: extra.map((s) => s.sampleName),
      resolve: (list, groups) => this.library.resolveWith(list, extra, groups),
    });
  });

  protected readonly error = computed(() => this.candidate().error);
  protected readonly canImport = computed(
    () => this.written() !== null && this.candidate().song !== null,
  );

  /** The song's samples against what ARAM has for them. */
  protected readonly budget = computed(() => {
    const driver = this.drivers.driver();
    const result = this.candidate().result;
    const used = this.brrs().reduce((sum, b) => sum + b.sample.data.length, 0);
    if (!driver || !result?.data) {
      return null;
    }

    const extra = this.brrs().map((b) => b.sample);
    const samples = this.library.resolveWith(
      result.sampleList ?? [],
      extra,
      result.stats?.sampleGroups,
    );
    const free = computeSpcLayout(
      driver,
      samples,
      result.data.length,
      result.stats?.echoBufferSize ?? 0,
    ).freeBytes;
    const available = Math.max(1, used + free);
    return {
      used: kilobytes(used),
      available: kilobytes(available),
      over: free < 0,
      percent: Math.min(100, (100 * used) / available),
    };
  });

  protected readonly channelRows = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return [];
    }

    const keep = this.keep();
    const channelOf = new Map(
      (this.written()?.channels ?? []).flatMap((group, channel) =>
        group.map((index) => [index, channel]),
      ),
    );
    return mod.channelNotes.map((notes, index) => {
      const on = keep.includes(index);
      const at = channelOf.get(index) ?? -1;
      return {
        index,
        number: index + 1,
        on,
        disabled: !on && !this.room(mod, keep, index),
        channel: at >= 0 ? `#${at}` : null,
        chipClass: at >= 0 ? `${CHIP_CLASS} ${CHANNEL_BG[at]} ${CHANNEL_SCOPE[at]}` : '',
        notes,
      };
    });
  });

  protected readonly sampleRows = computed(() => {
    const mod = this.mod();
    const written = this.written();
    if (!mod || !written) {
      return [];
    }

    const auto = this.autoFactor();
    const autoLabel = $localize`:@@import.mod.rate.auto:import.mod.rate.auto ${auto.toFixed(2)}:factor:`;
    const bytes = new Map(this.brrs().map((b) => [b.index, b.sample.data.length]));
    const factors = new Map(written.samples.map((s) => [s.index, s.factor]));
    const sounding = this.audition.playing();
    return mod.samples.map((summary) => {
      const choice = this.choiceOf(summary.index);
      const factor = factors.get(summary.index);
      const size = bytes.get(summary.index);
      return {
        index: summary.index,
        playable: size !== undefined,
        sounding: sounding === this.sampleName(summary.index),
        name:
          nonEmpty(summary.name) ??
          $localize`:@@import.mod.sample.unnamed:import.mod.sample.unnamed ${summary.index}:index:`,
        frames: summary.frames.toLocaleString(),
        loop: summary.loop
          ? $localize`:@@import.mod.sample.loop:import.mod.sample.loop ${summary.loop.start}:start: ${summary.loop.length}:length:`
          : this.text.oneShot,
        notes: summary.notes,
        choice: String(choice),
        autoLabel,
        rate:
          factor === undefined
            ? ''
            : `${((mod.song.samples[summary.index - 1].baseHz * factor) / 1000).toFixed(1)} kHz`,
        options: this.factorOptions.map((option) => {
          const plan = plannedFrames(mod.song.samples[summary.index - 1], Number(option.value));
          return { ...option, disabled: brrDataBytes(plan.frames, plan.loops) > BRR_LIMIT };
        }),
        size:
          size === undefined
            ? choice === 'drop'
              ? this.text.drop
              : this.text.unused
            : `${kilobytes(size)} KB`,
      };
    });
  });

  protected readonly factorOptions = FACTORS.map((f) => ({
    value: String(f.value),
    label: f.label,
  }));

  protected readonly warnings = computed(() => {
    const mod = this.mod();
    const written = this.written();
    if (!mod || !written) {
      return [];
    }

    const label = (index: number): string =>
      nonEmpty(mod.samples.find((s) => s.index === index)?.name) ??
      $localize`:@@import.mod.sample.unnamed:import.mod.sample.unnamed ${index}:index:`;
    return written.warnings.map((warning) => modWarningText(warning, label));
  });

  /** How many of the song's samples would replace a library file of the same name. */
  protected readonly replacing = computed(
    () => this.brrs().filter((b) => this.library.has(b.name)).length,
  );

  protected readonly keptCount = computed(() => this.keep().length);
  protected readonly channelCount = computed(() => this.written()?.channels.length ?? 0);
  /** Whether no channel left out could be kept. */
  protected readonly full = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return false;
    }

    const keep = this.keep();
    return mod.channelNotes.every(
      (_, index) => keep.includes(index) || !this.room(mod, keep, index),
    );
  });

  constructor() {
    // Sanctioned effect: mirrors the candidate into the preview's player.
    effect(() => {
      const song = this.candidate().song;
      untracked(() => this.preview()?.load(song));
    });
  }

  /** Reads `bytes`, a tracker module or a UMX holding one, and opens the dialog on them, or on why they cannot be read. */
  openWith(name: string, bytes: Uint8Array): void {
    this.fileName.set(name);
    this.previewError.set(null);
    this.choices.set(new Map());
    this.separation.set(0.5);
    this.encodings.clear();
    this.mod.set(null);
    this.refusal.set(null);
    this.format.set(isUmx(bytes) ? 'UMX' : FORMAT_NAMES[trackerFormatOf(bytes) ?? 'mod']);
    try {
      const inner = isUmx(bytes)
        ? unwrapUmx(bytes)
        : { format: trackerFormatOf(bytes) ?? 'mod', bytes };
      this.format.set(FORMAT_NAMES[inner.format]);
      const read = READERS[inner.format](inner.bytes);
      this.keep.set(this.share() ? read.suggestedShared : read.suggested);
      this.loopAtJump.set(read.play.loopTick > 0);
      this.mod.set(read);
    } catch (error) {
      this.refusal.set(refusalOf(error));
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

  /** Whether keeping `index` as well as `keep` still fits on AddmusicK's channels. */
  private room(mod: TrackerImport, keep: readonly number[], index: number): boolean {
    return this.share() ? fitsShared(mod, [...keep, index]) : keep.length < TRACKER_CHANNEL_LIMIT;
  }

  /**
   * Sharing on keeps the porter's choice and adds the channels that now fit; sharing off keeps the
   * eight of it that strike the most notes, one each.
   */
  protected toggleShare(): void {
    const mod = this.mod();
    const share = !this.share();
    this.share.set(share);
    if (mod) {
      this.keep.set(share ? addWhileFits(mod, this.keep()) : oneEach(mod, this.keep()));
    }
  }

  protected toggleKeep(index: number): void {
    const mod = this.mod();
    if (!mod) {
      return;
    }

    const kept = new Set(this.keep());
    if (kept.has(index)) {
      kept.delete(index);
    } else if (this.room(mod, this.keep(), index)) {
      kept.add(index);
    }

    this.keep.set([...kept].sort((a, b) => a - b));
  }

  protected setChoice(index: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    const choice: Choice = value === 'auto' || value === 'drop' ? value : Number(value);
    const next = new Map(this.choices());
    next.set(index, choice);
    this.choices.set(next);
  }

  /** Plays a sample as encoded at its factor, at the pitch of the MOD's C-2, or stops it. */
  protected toggleSample(index: number): void {
    const name = this.sampleName(index);
    if (this.audition.playing() === name) {
      this.audition.stop();
      return;
    }

    const entry = this.brrs().find((b) => b.index === index);
    if (!entry) {
      return;
    }

    const preview = this.preview();
    if (preview?.state() === 'playing') {
      void preview.toggle();
    }

    stopAll(this.playback, this.audition);
    this.audition.play(name, heardAt(decodeBrr(entry.sample), entry.loopStart, entry.rate));
  }

  protected setSeparation(event: Event): void {
    this.separation.set(Number((event.target as HTMLSelectElement).value));
  }

  protected onScrub(event: Event): void {
    this.preview()?.scrubTo(Number((event.target as HTMLInputElement).value));
  }

  /** Adds the samples to the library and replaces the whole document with the song, one undo step back to what was open. */
  protected confirm(): void {
    const written = this.written();
    if (!written || !this.canImport()) {
      return;
    }

    stopAll(this.playback, this.audition);
    this.library.add(this.brrs().map((b) => ({ name: b.name, bytes: b.bytes })));
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
    const sounding = this.audition.playing();
    if (sounding !== null && this.brrs().some((b) => b.name === sounding)) {
      this.audition.stop();
    }

    this.preview()?.dispose();
    this.preview.set(null);
    this.mod.set(null);
    this.encodings.clear();
  }
}
