import {
  DestroyRef,
  Service,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';

import { compiler } from '@amk/compiler';
import type { Edit } from '@amk/tokens/edits';
import { commandAt, tokenize } from '@amk/tokens';
import type { CompileResult, Diagnostic, Span } from '@amk/core/types';
import { buildSpc, spcFilename } from '@amk/spc/export';
import { ARAM_SIZE, type AramBudget, computeBudget } from '@amk/spc/layout';
import { type SongTimeline, unreachableChannels, walkSong } from '@amk/spc/song-walk';
import { echoHazards } from '@amk/tokens/echo-hazards';
import { type SongClock, songClock } from './song-clock';
import { type Measurement, tempoShortfall } from './measure-clock';
import type { MeasureReply, MeasureRequest } from './clock.worker';
import { caretPosition, downloadBlob, errorMessage } from '../util/format';
import { DriverStore } from './driver-store';
import { SampleStore } from './sample-store';

const STORAGE_KEY = 'solar-soundtrack.draft';

const SAMPLE_SONG = `#amk 4

#spc
{
    #title  "Level Theme"
    #author "Akito Nakatsuka"
    #game   "Ice Climber (NES)"
    #comment "Demo for Solar Soundtrack"
}

#0 w255 t54
o2

g32. r12 e32. r48 f16 r16 g32. r8^48 > c32 r64 < b32 r64 > c32 r64 < b32 r64 > c32 < r64
g32. r12 e32. r48 f16 r16 g32. r8^48 > c32 r64 < b32 r64 > c32 r64 < b32 r64 > c32 < r64
a32. r12 f32. r48 g16 r16 a32. r8^48 > d32 r64 c+32 r64 d32 r64 c+32 r64 d32 < r64
a32. r12 f32. r48 g16 r16 a32. r8^48 > d32 r64 c+32 r64 d32 r64 c+32 r64 d32 < r64

b32. r12 g32. r48 a16 r16 b32. r8^48 > f32 r64 e32 r64 f32 r64 e32 r64 f32 < r64
b32. r12 g32. r48 a16 r16 b32. r8^48 > f32 r64 e32 r64 f32 r64 e32 r64 f32 r64

e16 c16 < g16 > e16 c16 < g16 > f16 d16 < a16 > f16 d16 < a16 >
f+16 d16 c16 f+16 d16 c16 g16 f16 d16 < b16 a+16 a16
`;

/** How long typing pauses before a compile fires. */
const DEBOUNCE_MS = 150;

/**
 * How long the song has to hold still before its clock is measured.
 *
 * Longer than {@link DEBOUNCE_MS} because measuring is a whole pass of emulation
 * — tens to hundreds of milliseconds of a worker core — and every keystroke
 * would throw the answer away. A second of quiet is far less than it takes to
 * reach for the transport, so the measured length is there before it is read.
 */
const MEASURE_IDLE_MS = 1000;

/**
 * Past this, the driver is not playing the song that was written and the porter
 * should be told. 1.10 rather than something tighter because eight busy channels
 * drop about 0.8% at an ordinary tempo and a few percent is ordinary; this is
 * for the songs that are out by a third or a half.
 */
const TEMPO_SHORTFALL_LIMIT = 1.1;

export type StatusKind = 'ok' | 'error' | 'busy';

export interface Status {
  kind: StatusKind;
  text: string;
}

/** Text bound for the caret, and which slice of it to leave selected. */
export interface Insertion {
  text: string;
  /**
   * Offsets *within* `text`, not into the document, which the sender does not
   * know — so not a `Span`, which carries a line number that would be a lie.
   */
  select: { start: number; end: number } | null;
}

@Service()
export class EditorStore {
  private readonly drivers = inject(DriverStore);
  private readonly library = inject(SampleStore);

  /**
   * The source as typed. The editor's CodeMirror document is the text
   * authority: this signal is written only from the editor's update listener
   * (via {@link edit}), and programmatic changes reach the document through
   * {@link replace} rather than by writing here — one-way sync, so there is no
   * mirror to feed back through.
   */
  readonly source = signal(localStorage.getItem(STORAGE_KEY) ?? SAMPLE_SONG);
  readonly caret = signal(0);

  /**
   * A range the editor should select and scroll to, set when a diagnostic is
   * clicked. The editor owns the view, so this is how a sibling panel asks
   * for a selection without reaching across the component tree.
   */
  readonly reveal = signal<Span | null>(null);

  /**
   * A splice the editor should apply, set when a panel edits a command in
   * place. The counterpart to {@link reveal}: that one asks for a selection,
   * this one asks for a change, and both exist because the editor owns the
   * view and nothing else may reach into it.
   *
   * A fresh object each time, so writing the same edit twice still takes.
   *
   * `expect` is what the splice believes occupies the span. Panels read the
   * *undebounced* scan, so their spans agree with the document — but only up to
   * the microtask that carries the edit across, and a control that fires on
   * `pointerup` is one gesture away from a document that has moved. The editor
   * compares before it dispatches, which turns that whole class of race from
   * silent corruption into an edit that simply does not take.
   */
  readonly replace = signal<Edit | null>(null);

  /**
   * Applies a splice built by `@amk/tokens`'s `edits.ts`, ignoring the `null` those
   * builders return when nothing would change.
   *
   * Here rather than in each panel so the no-op check and the defensive copy are
   * stated once: a slider fires per frame of a drag, and the builders answering
   * "that is the text already there" is what keeps a drag from pushing dozens of
   * identical recompiles through the typing debounce.
   */
  apply(edit: Edit | null): void {
    if (edit) {
      this.replace.set({ ...edit, span: { ...edit.span } });
    }
  }

  /**
   * Text the editor should drop in at the caret, set when the command palette
   * inserts a command. The third of the same family as {@link reveal} and
   * {@link replace}, and separate from `replace` for two reasons: it carries a
   * selection, which a splice does not, and it has no span at all — where a
   * splice knows the range it is overwriting, this one lands wherever the caret
   * happens to be, which only the view knows.
   */
  readonly insertion = signal<Insertion | null>(null);

  /**
   * Asks for `text` at the caret, selecting the slice `select` names once it is
   * there — the first argument, so that the inspector opens on the command and
   * typing over it replaces the placeholder.
   */
  insert(text: string, select: { start: number; end: number } | null): void {
    this.insertion.set({ text, select: select && { ...select } });
  }

  /**
   * The text the compiler last ran on. It lags `source` by the typing debounce,
   * which is why the two are separate signals: the editor stays responsive at
   * keystroke speed while compilation runs at most every {@link DEBOUNCE_MS}.
   */
  private readonly committed = signal(this.source());
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The measuring worker and the request in flight on it. */
  private worker: Worker | null = null;
  private measureTimer: ReturnType<typeof setTimeout> | undefined;
  private measureToken = 0;
  private measuring: Uint8Array | null = null;

  /** `null` until a driver supplies a load address — never a guessed one. */
  private readonly compilation = computed(() => {
    const driver = this.drivers.driver();
    if (!driver) {
      return null;
    }

    const started = performance.now();
    const result = compiler.compile({
      source: this.committed(),
      aramAddress: driver.manifest.localPos,
      // What the sample library holds, and what the user asked to be done with
      // it. A compiler that does not understand these keys ignores them, per the
      // `CompileRequest.options` contract.
      options: {
        sampleNames: this.library.names(),
        sampleGroups: this.library.groups(),
        importantSamples: this.library.importantSamples(),
        optimizeSampleUsage: this.library.optimize(),
      },
    });
    return {
      result,
      elapsedMs: performance.now() - started,
      aramAddress: driver.manifest.localPos,
      text: this.committed(),
    };
  });

  readonly result = computed<CompileResult | null>(() => this.compilation()?.result ?? null);
  readonly aramAddress = computed(() => this.compilation()?.aramAddress ?? null);

  /**
   * The text {@link result} was compiled from. The playhead compares it against
   * {@link source} to know whether what the editor shows is what is audible —
   * usually by reference, since {@link edit} commits the same string instance.
   */
  readonly compiledText = computed(() => this.compilation()?.text ?? null);

  /** The song as a timeline of notes on ticks, for the piano roll. */
  readonly timeline = computed<SongTimeline | null>(() => {
    const compiled = this.compilation();
    const data = compiled?.result.data;
    return data ? walkSong(data, compiled.aramAddress) : null;
  });

  /**
   * Ticks to seconds, predicted — `null` when the walk cannot say.
   *
   * Built off {@link timeline} rather than off `stats`, because the compiler
   * abandons the whole of a song's length over a tempo fade or a `t` that runs
   * more than once, and the walk does not. See `song-clock.ts`.
   */
  private readonly predictedClock = computed<SongClock | null>(() => songClock(this.timeline()));

  /** What the worker last measured, for the song {@link measuredFor} names. */
  private readonly measured = signal<Measurement | null>(null);
  private readonly measuredFor = signal<Uint8Array | null>(null);

  /**
   * Ticks to seconds, measured where possible and predicted where not.
   *
   * The prediction prices every tick at the tempo the song asked for, and the
   * driver does not always manage it — at `t254` on eight channels it runs at
   * under half the requested rate, which made the transport count at under half
   * speed. `measure-clock.ts` says why no formula can fix that and the emulator
   * has to be watched instead.
   *
   * The predicted clock is what stands until the measurement lands, about a
   * second after typing stops, and what stands for good if it fails. The two
   * have the same shape on purpose, so nothing downstream knows which it holds.
   */
  readonly clock = computed<SongClock | null>(() => {
    const measured = this.measured();
    const data = this.compilation()?.result.data;
    // Only for the bytes it was measured from: a stale clock on a song that has
    // been edited under it is worse than an honest prediction.
    if (measured?.clock && data && this.measuredFor() === data) {
      return measured.clock;
    }

    return this.predictedClock();
  });

  /**
   * Errors first, then by position — the order you want to fix them in.
   *
   * Two sources, running at different speeds on purpose. The compiler's come off `committed` and so
   * lag by the typing debounce; the echo hazards are scanned from {@link tokens}, which does not, so
   * a runaway echo is reported by the very keystroke or paste that writes it. A warning about what
   * the song will do the moment you press play is not worth holding back 150 ms, and the compiler
   * has no opinion to offer anyway: it copies `$F5` through on its length alone, because
   * `Music.cpp` has no `$F5` code to port.
   */
  readonly diagnostics = computed<Diagnostic[]>(() => {
    const order = { error: 0, severe: 1, warning: 2, info: 3 } as const;
    const timeline = this.timeline();
    const all = [
      ...(this.result()?.diagnostics ?? []), // Compiler diagnostics
      ...echoHazards(this.tokens().commands), // Echo hazard diagnostics
      ...(timeline ? unreachableChannels(timeline, this.result()?.noteMap ?? []) : []), // Unreachable notes in channels
      ...this.tempoDiagnostics(), // The driver cannot keep up with the tempo
    ];
    return all.sort((a, b) => order[a.severity] - order[b.severity] || a.span.start - b.span.start);
  });

  /**
   * `AMK0503` — the driver cannot run the song as fast as it is written.
   *
   * A fourth source, and the only one that had to be *played* to find out. The
   * driver handles at most one music tick per pass of its main loop, so a song
   * asking for more ticks a second than it can manage simply gets fewer: at
   * `t254` on eight channels around 230 of the 498 it asked for. That is not an
   * editor artefact — a SNES does the same, which is why AddmusicK's readme
   * warns about high tempos — so the song a porter ships plays at a tempo they
   * did not write.
   *
   * `severe` puts it with the echo hazards and `AMK0502` in the `AMK05xx` band:
   * it compiles cleanly and then misbehaves on playback. Held back until the
   * measurement is in, and silent for the few percent an ordinary busy song
   * loses — see {@link TEMPO_SHORTFALL_LIMIT}.
   */
  private tempoDiagnostics(): Diagnostic[] {
    const measured = this.measured();
    const data = this.compilation()?.result.data;
    if (!measured || !data || this.measuredFor() !== data) {
      return [];
    }

    const shortfall = tempoShortfall(measured);
    if (shortfall === null || shortfall < TEMPO_SHORTFALL_LIMIT) {
      return [];
    }

    const percent = Math.round((1 - 1 / shortfall) * 100);
    return [
      {
        severity: 'severe',
        code: 'AMK0503',
        message:
          `The driver cannot keep up with this song's tempo: it plays about ${percent}% slower than written. ` +
          `Lower the tempo, or give the busiest channels less to do.`,
        span: this.tempoSpan(),
      },
    ];
  }

  /** The `t` or `$E2`/`$E3` that set the rate, or the top of the document. */
  private tempoSpan(): Span {
    const command = this.tokens().commands.find(
      (c) => c.vcmd === 0xe2 || c.vcmd === 0xe3 || (c.vcmd === undefined && c.kind === 't'),
    );
    return command?.span ?? { start: 0, end: 0, line: 1 };
  }

  /** The notes the song is too short to reach, for the editor to underline. */
  readonly unreachableSpans = computed<readonly Span[]>(() => {
    const timeline = this.timeline();
    const map = this.result()?.noteMap;
    if (!timeline || !map || timeline.unreachable.length === 0) {
      return [];
    }

    const byAddress = new Map(map.map((entry) => [entry.address, entry]));
    return timeline.unreachable
      .map((address) => byAddress.get(address)?.span)
      .filter((span) => span !== undefined);
  });

  readonly errorCount = computed(
    () => this.diagnostics().filter((d) => d.severity === 'error').length,
  );

  /** The sample set every export and budget is measured against. */
  private readonly samples = computed(() => {
    const named = this.result()?.sampleList;
    if (named) {
      return this.library.resolve(named);
    }

    return this.drivers.driver()?.samples ?? [];
  });

  /**
   * An echo delay being dragged, before the document has it.
   *
   * The echo buffer is the largest single thing a song can spend ARAM on — 2 KiB
   * per step of `$F1`'s first argument — so the delay control is really an
   * allocator, and the number it moves lives in the output pane rather than
   * beside it. Set from the inspector; nobody else may write it.
   *
   * A `linkedSignal` over {@link result}, so it clears itself the moment a
   * compile has seen the real value — the same self-clearing the command
   * inspector's own `dragPreview` uses, and for the same reason: there is no
   * drag-ended event to forget, and it cannot be left showing a delay the song
   * does not have.
   */
  readonly echoDelayPreview = linkedSignal<CompileResult | null, number | null>({
    source: () => this.result(),
    computation: () => null,
  });

  readonly budget = computed<AramBudget | null>(() => {
    const driver = this.drivers.driver();
    if (!driver) {
      return null;
    }

    const result = this.result();
    return computeBudget(
      driver,
      this.samples(),
      result?.data?.length ?? 0,
      this.echoDelayPreview() ?? result?.stats?.echoBufferSize ?? 0,
    );
  });

  readonly freeLabel = computed(() => {
    const budget = this.budget();
    if (!budget) {
      return '';
    }

    if (budget.overflowBytes > 0) {
      return `over by ${budget.overflowBytes.toLocaleString()} B`;
    }

    const percent = ((budget.freeBytes / ARAM_SIZE) * 100).toFixed(0);
    return `${budget.freeBytes.toLocaleString()} B free (${percent}%)`;
  });

  readonly caretLabel = computed(() => {
    const { line, column } = caretPosition(this.source(), this.caret());
    return `Ln ${line}, Col ${column}`;
  });

  /**
   * The source scanned into tokens and commands.
   *
   * Off `source` rather than `committed`, deliberately: the inspector follows
   * the caret, and a caret that has moved to a command the compiler has not
   * seen yet would otherwise inspect the wrong thing for {@link DEBOUNCE_MS}.
   * Scanning is a single linear pass over a few kilobytes, which is cheap
   * enough to redo per keystroke — unlike compiling, which is why that one is
   * debounced and this one is not.
   */
  readonly tokens = computed(() => tokenize(this.source()));

  /** The command the caret is in, which the command inspector renders. */
  readonly commandAtCaret = computed(() => commandAt(this.tokens().commands, this.caret()));

  /**
   * The `#instruments` entry the caret is in, if any.
   *
   * Needed alongside {@link commandAtCaret} rather than derived from it: most of
   * an entry is not a command at all. `"kick.brr" $FF $E0 $B8 $02 $F0` is a
   * string token and five `hexArg`s, and `gather` builds commands from neither —
   * so a caret anywhere in that line finds nothing, and the entry editor would
   * be reachable only for the `@n` and `nXX` sample forms, which do happen to
   * scan as commands. End-*inclusive*, like `commandAt`: a `Span` is half-open,
   * so a caret resting immediately after the entry is one past `span.end` and
   * would otherwise find nothing to edit.
   */
  readonly instrumentAtCaret = computed(() => {
    const at = this.caret();
    return (
      this.tokens().instruments.find((entry) => at >= entry.span.start && at <= entry.span.end) ??
      null
    );
  });

  /** Set by actions that can fail outside compilation, such as export. */
  private readonly override = signal<Status | null>(null);

  readonly status = computed<Status>(() => {
    const override = this.override();
    if (override) {
      return override;
    }

    const driverError = this.drivers.loadError();
    if (driverError) {
      return { kind: 'error', text: driverError };
    }

    if (!this.drivers.ready()) {
      return { kind: 'busy', text: 'loading driver…' };
    }

    const compilation = this.compilation();
    if (!compilation) {
      return { kind: 'busy', text: 'waiting for a driver' };
    }

    const { result, elapsedMs } = compilation;
    if (result.ok && result.data) {
      return {
        kind: 'ok',
        text: `${result.data.length} bytes · ${elapsedMs.toFixed(1)} ms`,
      };
    }

    const errors = this.errorCount();
    return { kind: 'error', text: `${errors} error${errors === 1 ? '' : 's'}` };
  });

  /** Compilation is gated on a driver, so every producing action is too. */
  readonly canCompile = computed(() => this.drivers.ready());
  readonly canDownload = computed(() => this.result()?.ok === true && this.result()?.data !== null);

  constructor() {
    // Sanctioned effect: mirroring signal state into an imperative store.
    effect(() => localStorage.setItem(STORAGE_KEY, this.source()));

    // Sanctioned effect: the compiled bytes drive an imperative sink, the
    // measuring worker. Idle-triggered rather than per-compile, because a
    // typing burst produces a compile every 150 ms and each measurement is a
    // whole pass of emulation — there is no point measuring a song the next
    // keystroke will replace.
    effect(() => {
      const data = this.compilation()?.result.data ?? null;
      const stats = this.result()?.stats;
      const passTicks = stats ? stats.introTicks + stats.loopTicks : 0;
      untracked(() => this.scheduleMeasure(data, passTicks));
    });

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.measureTimer);
      this.worker?.terminate();
      this.worker = null;
    });
  }

  /**
   * Asks the worker for the song's real clock, once typing has settled.
   *
   * Nothing is measured for a song that will not play — no bytes, no pass to
   * measure over — and the previous answer is dropped at once rather than left
   * standing over new bytes, so {@link clock} falls back to the prediction for
   * the moment in between.
   */
  private scheduleMeasure(data: Uint8Array | null, passTicks: number): void {
    clearTimeout(this.measureTimer);
    if (this.measuredFor() !== data) {
      this.measured.set(null);
      this.measuredFor.set(null);
    }

    if (!data || passTicks <= 0 || typeof Worker === 'undefined') {
      return;
    }

    this.measureTimer = setTimeout(() => this.measure(data, passTicks), MEASURE_IDLE_MS);
  }

  private measure(data: Uint8Array, passTicks: number): void {
    const spc = this.assembleSpc();
    if (!spc) {
      return;
    }

    try {
      this.worker ??= this.startWorker();
      this.measureToken++;
      this.worker.postMessage({
        token: this.measureToken,
        spc,
        passTicks,
        // Resolved here, not in the worker: a relative fetch there would
        // resolve against the worker's own bundled URL rather than the app's
        // base href, which is `/<repo>/` on Pages.
        wasmUrl: new URL('player/spc.wasm', document.baseURI).href,
      } satisfies MeasureRequest);
      this.measuring = data;
    } catch {
      // No worker, or it refused the message. The prediction stands; a song
      // that cannot be measured is not a song that cannot be played.
      this.worker = null;
    }
  }

  private startWorker(): Worker {
    const worker = new Worker(new URL('./clock.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<MeasureReply>) => {
      const reply = event.data;
      // Superseded while it ran: a run cannot be cancelled, so late answers are
      // dropped here rather than fought over.
      if (reply.token !== this.measureToken || !reply.ok) {
        return;
      }

      this.measured.set(reply);
      this.measuredFor.set(this.measuring);
    };

    worker.onerror = () => {
      this.worker?.terminate();
      this.worker = null;
    };

    return worker;
  }

  // --- editing --------------------------------------------------------------

  /** Records a keystroke, and schedules the compile it will trigger. */
  edit(text: string): void {
    this.source.set(text);
    this.override.set(null);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.committed.set(text), DEBOUNCE_MS);
  }

  /** Compiles immediately, cancelling any pending debounce. */
  compileNow(): void {
    clearTimeout(this.timer);
    this.override.set(null);
    this.committed.set(this.source());
  }

  // --- outputs --------------------------------------------------------------

  /**
   * Assembles a playable SPC from the current compilation.
   *
   * Deliberately a method rather than a `computed`: building one copies the full
   * 64 KiB ARAM image plus every sample, which is wasted work on each keystroke
   * when nothing is playing and nothing is being exported.
   *
   * Always the whole song. Channel mutes are applied to the running emulator
   * rather than baked in here, so preview and export build the same bytes.
   */
  assembleSpc(): Uint8Array | null {
    const driver = this.drivers.driver();
    const result = this.result();
    if (!driver || !result?.ok || !result.data) {
      return null;
    }

    try {
      return buildSpc({
        songData: result.data,
        driver,
        samples: this.samples(),
        tags: result.stats?.tags,
        seconds: result.stats?.tagSeconds,
        echoBufferSize: result.stats?.echoBufferSize,
      }).spc;
    } catch (error) {
      this.override.set({ kind: 'error', text: errorMessage(error) });
      return null;
    }
  }

  downloadBin(): void {
    const result = this.result();
    if (!result?.data) {
      return;
    }

    const name = (result.stats?.tags.title ?? 'song').replace(/[^\w.-]+/g, '_');
    downloadBlob(`${name}.bin`, result.data);
  }

  /**
   * Both exports compile at the driver's load address, so the `.bin` and the
   * song inside the `.spc` are always the same bytes.
   */
  downloadSpc(): void {
    this.compileNow();
    const spc = this.assembleSpc();
    if (!spc) {
      this.override.set({ kind: 'error', text: 'cannot export: song has errors' });
      return;
    }

    downloadBlob(spcFilename(this.result()?.stats?.tags ?? {}), spc);
    this.override.set({ kind: 'ok', text: `SPC written · ${spc.length.toLocaleString()} bytes` });
  }

  fail(text: string): void {
    this.override.set({ kind: 'error', text });
  }
}
