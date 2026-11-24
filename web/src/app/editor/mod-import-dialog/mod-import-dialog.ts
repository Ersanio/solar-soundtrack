import { Component, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';

import {
  type ModImport,
  ModError,
  type ModSongOptions,
  MOD_CHANNEL_LIMIT,
  fitFactor,
  planSample,
  readMod,
  writeMod,
} from '@amk/import/mod';
import { type BrrSample, emptySample, parseBrr } from '@amk/spc/brr';
import { brrDataBytes, encodeBrr } from '@amk/spc/brr-encode';
import { computeSpcLayout } from '@amk/spc/layout';
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
import { MOD_REFUSALS, modWarningText } from '../import-dialog/import-text';

/** What the porter chose for a sample: the factor that fits, a factor of their own, or none of its notes. */
type Choice = 'auto' | 'drop' | number;

/** The rate a sample plays a MOD's C-2 at, before resampling (PAL Paula over period 428). */
const C2_HZ = 3_546_895 / 428;
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

const kilobytes = (bytes: number): string => (bytes / 1024).toFixed(1);

/** `text`, or `null` where there is none to show. */
const nonEmpty = (text: string | undefined): string | null =>
  text === undefined || text === '' ? null : text;

/** The file name, as a sample name can start: no `#`, `;` or `"`, which MML reads (`validateName`). */
function stemOf(fileName: string): string {
  const stem = fileName
    .replace(/\.[^.]*$/, '')
    .replace(/[#;"]/g, '')
    .trim();
  return stem === '' ? 'MOD' : stem;
}

/**
 * The Import dialog for a MOD: its channels to keep, each sample's resampling, and a preview of the
 * song they make before it replaces the document and its samples join the library.
 *
 * AddmusicK has far less room for samples than a MOD carries, so every sample left on Auto shares the
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
  };

  protected readonly separations = [
    { value: 1, label: '100%' },
    { value: 0.5, label: '50%' },
    { value: 0.25, label: '25%' },
    { value: 0, label: $localize`:@@import.mod.separation.mono:import.mod.separation.mono` },
  ];
  protected readonly limit = MOD_CHANNEL_LIMIT;

  protected readonly fileName = signal('');
  protected readonly refusal = signal<string | null>(null);
  private readonly mod = signal<ModImport | null>(null);
  protected readonly keep = signal<readonly number[]>([]);
  private readonly choices = signal<ReadonlyMap<number, Choice>>(new Map());
  protected readonly separation = signal(0.5);
  protected readonly loopAtJump = signal(true);
  /** Write `#optimized` rather than `#default`, leaving the song's own samples more room. */
  protected readonly optimized = signal(false);
  protected readonly preview = signal<ImportPreview | null>(null);
  protected readonly previewError = signal<string | null>(null);

  /** Each sample planned and encoded at a factor, kept for the dialog's life so a change re-encodes only what it moved. */
  private readonly encodings = new Map<string, { sample: BrrSample; bytes: Uint8Array }>();

  protected readonly heading = computed(() => {
    const name = this.fileName();
    return $localize`:@@import.mod.heading:import.mod.heading ${name}:name:`;
  });

  protected readonly summary = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return '';
    }

    const { tag, channels, orders } = mod.file;
    const count = orders.length;
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

  private encoded(
    mod: ModImport,
    index: number,
    factor: number,
  ): { sample: BrrSample; bytes: Uint8Array } {
    const key = `${index}:${factor}`;
    let entry = this.encodings.get(key);
    if (!entry) {
      const name = this.sampleName(index);
      const plan = planSample(mod.file.samples[index - 1], factor);
      const bytes = encodeBrr(plan.pcm, plan.loopStart);
      entry = { sample: parseBrr(name, bytes), bytes };
      this.encodings.set(key, entry);
    }

    return entry;
  }

  private options(factors: ReadonlyMap<number, number | 'drop'>): ModSongOptions {
    return {
      keep: this.keep(),
      factors,
      separation: this.separation(),
      loop: this.loopAtJump() ? 'jump' : 'song',
      sampleName: (index) => this.sampleName(index),
      fallbackTitle: stemOf(this.fileName()),
      optimized: this.optimized(),
    };
  }

  /** The song with every Auto sample at 1: its bytes are what the room is measured after, and they do not depend on the factors. */
  private readonly provisional = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return null;
    }

    const factors = new Map<number, number | 'drop'>();
    for (const [index, choice] of this.choices()) {
      if (choice !== 'auto') {
        factors.set(index, choice);
      }
    }

    return writeMod(mod, this.options(factors));
  });

  /** The bytes ARAM has for the Auto samples, once the song, the stock set and the samples with a factor of their own are in. */
  private readonly room = computed(() => {
    const mod = this.mod();
    const written = this.provisional();
    const driver = this.drivers.driver();
    if (!mod || !written || !driver) {
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
  });

  /** The one factor every Auto sample shares, the largest that fits the room, to a thousandth. */
  protected readonly autoFactor = computed(() => {
    const mod = this.mod();
    const written = this.provisional();
    const room = this.room();
    if (!mod || !written || room === null) {
      return 1;
    }

    const autos = written.samples
      .filter((s) => this.choiceOf(s.index) === 'auto')
      .map((s) => mod.file.samples[s.index - 1]);
    return Math.floor(fitFactor(autos, room, brrDataBytes) * 1000) / 1000;
  });

  private readonly written = computed(() => {
    const mod = this.mod();
    if (!mod) {
      return null;
    }

    const factors = new Map<number, number | 'drop'>();
    for (const summary of mod.samples) {
      const choice = this.choiceOf(summary.index);
      factors.set(summary.index, choice === 'auto' ? this.autoFactor() : choice);
    }

    return writeMod(mod, this.options(factors));
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
    return mod.channelNotes.map((notes, index) => {
      const at = keep.indexOf(index);
      return {
        index,
        number: index + 1,
        on: at >= 0,
        disabled: at < 0 && keep.length >= MOD_CHANNEL_LIMIT,
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
    return mod.samples.map((summary) => {
      const choice = this.choiceOf(summary.index);
      const factor = factors.get(summary.index);
      const size = bytes.get(summary.index);
      return {
        index: summary.index,
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
        rate: factor === undefined ? '' : `${((C2_HZ * factor) / 1000).toFixed(1)} kHz`,
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

  constructor() {
    // Sanctioned effect: mirrors the candidate into the preview's player.
    effect(() => {
      const song = this.candidate().song;
      untracked(() => this.preview()?.load(song));
    });
  }

  /** Reads `bytes` and opens the dialog on them, or on why they cannot be read. */
  openWith(name: string, bytes: Uint8Array): void {
    this.fileName.set(name);
    this.previewError.set(null);
    this.choices.set(new Map());
    this.separation.set(0.5);
    this.encodings.clear();
    this.mod.set(null);
    this.refusal.set(null);
    try {
      const mod = readMod(bytes);
      this.keep.set(mod.suggested);
      this.loopAtJump.set(mod.play.loopTick > 0);
      this.mod.set(mod);
    } catch (error) {
      this.refusal.set(error instanceof ModError ? MOD_REFUSALS[error.code] : errorMessage(error));
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

  protected toggleKeep(index: number): void {
    const kept = new Set(this.keep());
    if (kept.has(index)) {
      kept.delete(index);
    } else if (kept.size < MOD_CHANNEL_LIMIT) {
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
    this.preview()?.dispose();
    this.preview.set(null);
    this.mod.set(null);
    this.encodings.clear();
  }
}
