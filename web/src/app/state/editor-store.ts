import { Service, computed, effect, inject, linkedSignal, signal } from '@angular/core';

import { compiler } from '@amk/compiler';
import type { Edit } from '@amk/tokens/edits';
import { commandAt, tokenize } from '@amk/tokens';
import type { CompileResult, Diagnostic, Span } from '@amk/core/types';
import { buildSpc, spcFilename } from '@amk/spc/export';
import { ARAM_SIZE, type AramBudget, computeBudget } from '@amk/spc/layout';
import { echoHazards } from '@amk/tokens/echo-hazards';
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

/** How long typing pauses before an auto-compile fires. */
const DEBOUNCE_MS = 150;

export type StatusKind = 'ok' | 'error' | 'busy';

export interface Status {
  kind: StatusKind;
  text: string;
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
  readonly autoCompile = signal(true);
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
   * Applies a splice built by `compiler/edits.ts`, ignoring the `null` those
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
   * The text the compiler last ran on. It lags `source` by the typing debounce,
   * which is why the two are separate signals: the textarea stays responsive at
   * keystroke speed while compilation runs at most every {@link DEBOUNCE_MS}.
   */
  private readonly committed = signal(this.source());
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** `null` until a driver supplies a load address — never a guessed one. */
  private readonly compilation = computed(() => {
    const plan = this.drivers.plan();
    if (!plan) {
      return null;
    }

    const started = performance.now();
    const result = compiler.compile({
      source: this.committed(),
      aramAddress: plan.localPos,
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
      aramAddress: plan.localPos,
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

  /**
   * Errors first, then by position — the order you want to fix them in.
   *
   * Two sources, running at different speeds on purpose. The compiler's come off `committed` and so
   * lag by the typing debounce; the echo hazards are scanned from {@link tokens}, which does not,
   * so a runaway echo is reported by the keystroke or paste that writes it and stays live even with
   * auto-compile switched off. A warning about what the song will do the moment you press play is
   * not worth holding back 150 ms, and the compiler could not produce it anyway — `$F5` never
   * reaches it.
   */
  readonly diagnostics = computed<Diagnostic[]>(() => {
    const order = { error: 0, severe: 1, warning: 2, info: 3 } as const;
    const all = [...(this.result()?.diagnostics ?? []), ...echoHazards(this.tokens().commands)];
    return all.sort((a, b) => order[a.severity] - order[b.severity] || a.span.start - b.span.start);
  });

  readonly errorCount = computed(
    () => this.diagnostics().filter((d) => d.severity === 'error').length,
  );

  /**
   * The sample set every export and budget is measured against.
   *
   * One place, so the budget in the output pane and the SPC the player loads
   * can never disagree. The compiler decides *which* names and in what order —
   * that ordering is the SRCN assignment — and the library supplies the bytes,
   * so replacing a bundled file changes what its instrument plays. A `null`
   * list means the compiler had no opinion, and the driver's own set stands.
   */
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
    const plan = this.drivers.plan();
    if (!driver || !plan) {
      return null;
    }

    const result = this.result();
    return computeBudget(
      driver,
      this.samples(),
      plan,
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
   * scan as commands. End-exclusive, matching how the definition's span is
   * built.
   */
  readonly instrumentAtCaret = computed(() => {
    const at = this.caret();
    return (
      this.tokens().instruments.find((entry) => at >= entry.span.start && at <= entry.span.end) ??
      null
    );
  });

  /** Set by actions that can fail outside compilation (export, driver upload). */
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
  }

  // --- editing --------------------------------------------------------------

  /** Records a keystroke, and schedules a compile when auto-compile is on. */
  edit(text: string): void {
    this.source.set(text);
    this.override.set(null);
    clearTimeout(this.timer);
    if (!this.autoCompile()) {
      return;
    }

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
    const plan = this.drivers.plan();
    const result = this.result();
    if (!driver || !plan || !result?.ok || !result.data) {
      return null;
    }

    try {
      return buildSpc({
        songData: result.data,
        driver,
        samples: this.samples(),
        plan,
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
