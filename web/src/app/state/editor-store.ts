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
import { type Command, commandAt, tokenize } from '@amk/tokens';
import type { CommandAddress, CompileResult, Diagnostic, NoteAddress, Span } from '@amk/core/types';
import { buildSpc, spcFilename } from '@amk/spc/export';
import { ARAM_SIZE, type AramBudget, computeBudget } from '@amk/spc/layout';
import {
  type SongTimeline,
  type WalkNote,
  unreachableChannels,
  walkSong,
} from '@amk/spc/song-walk';
import { echoHazards } from '@amk/tokens/echo-hazards';
import { commandsInForceOf } from './commands-in-force';
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

/**
 * A span to select, and whether the source view should come forward for it.
 *
 * See {@link EditorStore.reveal}. A separate type rather than a bare `Span`
 * because the flag is the whole difference between a summons and a question.
 */
export interface Reveal {
  span: Span;
  show: boolean;
}

/**
 * What {@link EditorStore.commandsInForce} answers while there is no walk to read.
 *
 * The same function every time, and it has to be: a computed notifies on a new
 * value, so returning a fresh closure per keystroke would rebuild the piano
 * roll's whole mark list on every one of them — the thing its two clocks exist
 * to avoid.
 */
const NOTHING_IN_FORCE = (): readonly Command[] => [];

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
   * A range the editor should select, set when a diagnostic or a piano roll bar
   * is clicked. The editor owns the view, so this is how a sibling panel asks
   * for a selection without reaching across the component tree.
   *
   * `show` is what separates the two callers. A diagnostic is a summons — bring
   * the source forward, scroll to it, take focus. A single click on a bar is a
   * question about that note, and the inspector answers it from the pane beside
   * the roll, so switching tabs would take away the thing being asked about. The
   * quiet form still goes through the document, because the caret is the one
   * statement of what is being inspected and panels do not write it.
   */
  readonly reveal = signal<Reveal | null>(null);

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

  /**
   * The last thing the emulator observed about this song.
   *
   * **Replaced, never cleared.** Compiling happens 150 ms after a keystroke and
   * measuring a second after that, so clearing this on recompile would leave the
   * song unmeasured for as long as anyone kept typing, with `AMK0503` and the
   * transport's length flicking on every pause.
   *
   * What it measures is how far the driver falls behind the tempo the song
   * asked for, and that is a property of the song's *texture* — how many
   * channels are live and what each tick costs them. A keystroke does not change
   * it. So the honest thing to hold between measurements is the last answer,
   * not no answer.
   */
  private readonly measured = signal<Measurement | null>(null);

  /**
   * Ticks to seconds, measured where possible and predicted where not.
   *
   * The prediction prices every tick at the tempo the song asked for, and the
   * driver does not always manage it — at `t254` on eight channels it runs at
   * under half the requested rate. `measure-clock.ts` says why no formula can
   * fix that and the emulator has to be watched instead.
   *
   * The prediction stands only until the first measurement lands, and after that
   * the previous measurement stands rather than the prediction: an edit moves
   * the tick count a little, where the prediction is wrong by up to a factor of
   * two on exactly the songs this exists for. Both ends clamp, so a measurement
   * that covers slightly fewer ticks than the song now has costs the readout the
   * difference and nothing more. The two have the same shape on purpose, so
   * nothing downstream knows which it holds.
   */
  readonly clock = computed<SongClock | null>(
    () => this.measured()?.clock ?? this.predictedClock(),
  );

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
   * first measurement is in, and silent for the few percent an ordinary busy
   * song loses — see {@link TEMPO_SHORTFALL_LIMIT}. Compared from the first
   * tick, so the pause `$FA $04` puts at the top of a song with echo is not
   * read as a rate; `tempoShortfall` says so.
   *
   * It stands on the last measurement rather than only on one taken from the
   * current bytes, which is what stops it blinking out on every keystroke; see
   * {@link measured}. The span is resolved from the undebounced scan, so it
   * still points at the tempo command in the document as it is now.
   */
  private tempoDiagnostics(): Diagnostic[] {
    const measured = this.measured();
    if (!measured) {
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

  /**
   * Which occurrence of a note the piano roll was last asked about.
   *
   * A note written once inside a loop is played many times, and the commands in
   * force can differ between them, so the caret — which names the *text* — is
   * one answer short. Set when a bar is clicked and read only while it is still
   * an occurrence of the note the caret is on, which is what makes moving the
   * caret enough to retire it.
   */
  readonly inspecting = signal<{ address: number; tick: number } | null>(null);

  /**
   * The command map by ARAM address, which is how the walk names a command.
   * The sibling of {@link notesByAddress}, and what turns `WalkNote.origins`
   * back into the text a command was written as.
   */
  readonly commandsByAddress = computed<ReadonlyMap<number, CommandAddress>>(
    () => new Map((this.result()?.commandMap ?? []).map((entry) => [entry.address, entry])),
  );

  /**
   * The note map by ARAM address, which is how the walk names a note. Built
   * once here because three readers key into it — the roll for a note's written
   * pitch and its source, and {@link unreachableSpans}.
   */
  readonly notesByAddress = computed<ReadonlyMap<number, NoteAddress>>(
    () => new Map((this.result()?.noteMap ?? []).map((entry) => [entry.address, entry])),
  );

  /**
   * The commands acting on a note, exactly — a lookup rather than a map. The
   * join itself is `commands-in-force.ts`, so `walktest` can pin it end to end;
   * this holds it to the current scan and compile.
   *
   * Empty for every note while the editor has moved past the text that compiled:
   * a span into a document that has changed points at the wrong thing, which is
   * the same test the roll's tooltip and its clicks take.
   */
  readonly commandsInForce = computed<(note: WalkNote) => readonly Command[]>(() => {
    if (this.compiledText() !== this.source()) {
      return NOTHING_IN_FORCE;
    }

    return commandsInForceOf({
      index: this.tokens(),
      text: this.source(),
      commands: this.commandsByAddress(),
      notes: this.notesByAddress(),
    });
  });

  /** The notes the song is too short to reach, for the editor to underline. */
  readonly unreachableSpans = computed<readonly Span[]>(() => {
    const timeline = this.timeline();
    if (!timeline || timeline.unreachable.length === 0) {
      return [];
    }

    const byAddress = this.notesByAddress();
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
   * Re-armed on every compile and never cancelled into nothing: a song that
   * will not play has no pass to measure, so no request goes out, but whatever
   * was measured last stays standing until something better arrives. See
   * {@link measured} for why that is the honest answer rather than a stale one.
   */
  private scheduleMeasure(data: Uint8Array | null, passTicks: number): void {
    clearTimeout(this.measureTimer);
    if (!data || passTicks <= 0 || typeof Worker === 'undefined') {
      return;
    }

    this.measureTimer = setTimeout(() => this.measure(passTicks), MEASURE_IDLE_MS);
  }

  private measure(passTicks: number): void {
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
