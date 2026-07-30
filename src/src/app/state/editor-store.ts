import { Service, computed, effect, inject, signal } from '@angular/core';

import { compilers } from '@compilers';
import type { CompileResult, Diagnostic, Span } from '@core/types';
import { buildSpc, spcFilename } from '@spc/export';
import { ARAM_SIZE, type AramBudget, computeBudget } from '@spc/layout';
import { caretPosition, downloadBlob, errorMessage } from '../util/format';
import { DriverStore } from './driver-store';
import { SampleStore } from './sample-store';

const STORAGE_KEY = 'webmml.draft';

const SAMPLE_SONG = `#amk 4

#spc
{
    #title  "Scaffold Test"
    #author "you"
    #game   "Super Mario World"
}

; ---- channel 0: lead ----
#0
t40 o4 v200 q7F @0 l8
c d e f g4 e4 c4 r4
(1)[e f g a b4 g4]2
o5 c1

; ---- channel 1: bass ----
#1
o2 v160 q7D @1 l8
[c c > c < c ]8
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

  readonly available = compilers.list();

  readonly source = signal(localStorage.getItem(STORAGE_KEY) ?? SAMPLE_SONG);
  readonly compilerId = signal(this.available[0]?.id ?? 'addmusick');
  readonly autoCompile = signal(true);
  readonly caret = signal(0);

  /**
   * A range the editor should select and scroll to, set when a diagnostic is
   * clicked. The editor owns the textarea, so this is how a sibling panel asks
   * for a selection without reaching across the component tree.
   */
  readonly reveal = signal<Span | null>(null);

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
    if (!plan) return null;

    const compiler = compilers.get(this.compilerId()) ?? this.available[0];
    if (!compiler) return null;

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
    return { result, elapsedMs: performance.now() - started, aramAddress: plan.localPos };
  });

  readonly result = computed<CompileResult | null>(() => this.compilation()?.result ?? null);
  readonly aramAddress = computed(() => this.compilation()?.aramAddress ?? null);

  /** Errors first, then by position — the order you want to fix them in. */
  readonly diagnostics = computed<Diagnostic[]>(() => {
    const order = { error: 0, warning: 1, info: 2 } as const;
    return [...(this.result()?.diagnostics ?? [])].sort(
      (a, b) => order[a.severity] - order[b.severity] || a.span.start - b.span.start,
    );
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
    if (named) return this.library.resolve(named);
    return this.drivers.driver()?.samples ?? [];
  });

  readonly budget = computed<AramBudget | null>(() => {
    const driver = this.drivers.driver();
    const plan = this.drivers.plan();
    if (!driver || !plan) return null;
    const result = this.result();
    return computeBudget(
      driver,
      this.samples(),
      plan,
      result?.data?.length ?? 0,
      result?.stats?.echoBufferSize ?? 0,
    );
  });

  readonly freeLabel = computed(() => {
    const budget = this.budget();
    if (!budget) return '';
    if (budget.overflowBytes > 0) return `over by ${budget.overflowBytes.toLocaleString()} B`;
    const percent = ((budget.freeBytes / ARAM_SIZE) * 100).toFixed(0);
    return `${budget.freeBytes.toLocaleString()} B free (${percent}%)`;
  });

  readonly caretLabel = computed(() => {
    const { line, column } = caretPosition(this.source(), this.caret());
    return `Ln ${line}, Col ${column}`;
  });

  /** Set by actions that can fail outside compilation (export, driver upload). */
  private readonly override = signal<Status | null>(null);

  readonly status = computed<Status>(() => {
    const override = this.override();
    if (override) return override;

    const driverError = this.drivers.loadError();
    if (driverError) return { kind: 'error', text: driverError };
    if (!this.drivers.ready()) return { kind: 'busy', text: 'loading driver…' };

    const compilation = this.compilation();
    if (!compilation) return { kind: 'busy', text: 'waiting for a driver' };

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
    if (!this.autoCompile()) return;
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
   * `muteChannels` is a preview affordance for playback only — exports never
   * pass one, so a downloaded SPC always contains the whole song.
   */
  assembleSpc(muteChannels = 0): Uint8Array | null {
    const driver = this.drivers.driver();
    const plan = this.drivers.plan();
    const result = this.result();
    if (!driver || !plan || !result?.ok || !result.data) return null;

    try {
      return buildSpc({
        songData: result.data,
        driver,
        samples: this.samples(),
        plan,
        tags: result.stats?.tags,
        seconds: result.stats?.seconds,
        echoBufferSize: result.stats?.echoBufferSize,
        muteChannels,
      }).spc;
    } catch (error) {
      this.override.set({ kind: 'error', text: errorMessage(error) });
      return null;
    }
  }

  downloadBin(): void {
    const result = this.result();
    if (!result?.data) return;
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
