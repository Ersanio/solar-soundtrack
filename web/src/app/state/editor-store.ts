import { Service, computed, effect, inject, linkedSignal, signal, untracked } from '@angular/core';

import { compiler } from '@amk/compiler';
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
import { readLoops } from '@amk/tokens/commands/loops';
import { echoHazards } from '@amk/tokens/echo-hazards';
import { commandsInForceOf } from './commands-in-force';
import { type TimelineCommand, commandTimeline } from './command-timeline';
import { type SongClock, songClock } from './song-clock';
import { ClockMeasurer, tempoDiagnostic } from './clock-measurer';
import { caretPosition, downloadBlob, errorMessage } from '../util/format';
import { readStored, writeStored } from '../util/storage';
import { DriverStore } from './driver-store';
import { type NormalizeOutcome, normalizeSong } from './normalize-song';
import { SAMPLE_SONG } from './sample-song';
import { SampleStore } from './sample-store';

const STORAGE_KEY = 'solar-soundtrack.draft';

/** How long typing pauses before a compile fires. */
const DEBOUNCE_MS = 150;

export type StatusKind = 'ok' | 'info' | 'error' | 'busy';

export interface Status {
  kind: StatusKind;
  text: string;
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

@Service()
export class EditorStore {
  private readonly drivers = inject(DriverStore);
  private readonly library = inject(SampleStore);
  private readonly measurer = inject(ClockMeasurer);

  /**
   * The source as typed. The editor's CodeMirror document is the text
   * authority: this signal is written only from the editor's update listener
   * (via {@link edit}), and programmatic changes reach the document through
   * {@link replace} rather than by writing here — one-way sync, so there is no
   * mirror to feed back through.
   */
  readonly source = signal(readStored(STORAGE_KEY) ?? SAMPLE_SONG);
  readonly caret = signal(0);

  /**
   * The document's own selection, ordered, written from the same update listener
   * as {@link caret} — which is its head.
   *
   * A range as well as a point because the palette's two bracket forms go round
   * a run of music rather than landing at a point, and an empty range is how the
   * editor says there is nothing to put brackets round.
   */
  readonly selection = signal<{ start: number; end: number }>({ start: 0, end: 0 });

  /**
   * The text the compiler last ran on. It lags `source` by the typing debounce,
   * which is why the two are separate signals: the editor stays responsive at
   * keystroke speed while compilation runs at most every {@link DEBOUNCE_MS}.
   */
  private readonly committed = signal(this.source());
  private timer: ReturnType<typeof setTimeout> | undefined;

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
      options: this.compileOptions(),
    });
    return {
      result,
      elapsedMs: performance.now() - started,
      aramAddress: driver.manifest.localPos,
      text: this.committed(),
    };
  });

  /**
   * What the sample library holds, and what the user asked to be done with it.
   * A compiler that does not understand these keys ignores them, per the
   * `CompileRequest.options` contract. Read inside {@link compilation}, so the
   * compile tracks the library; read again by {@link normalize}, which compiles
   * the same song several times over and has to do it under the same options.
   */
  private compileOptions(): Record<string, unknown> {
    return {
      sampleNames: this.library.names(),
      sampleGroups: this.library.groups(),
      importantSamples: this.library.importantSamples(),
      optimizeSampleUsage: this.library.optimize(),
    };
  }

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
    () => this.measurer.measured()?.clock ?? this.predictedClock(),
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
      // The driver cannot keep up with the tempo. It stands on the last
      // measurement rather than only on one taken from the current bytes, which
      // is what stops it blinking out on every keystroke; the span comes from
      // the undebounced scan, so it still points at the tempo command as written.
      ...tempoDiagnostic(this.measurer.measured(), this.tempoSpan()),
    ];
    return all.sort((a, b) => order[a.severity] - order[b.severity] || a.span.start - b.span.start);
  });

  /** The `t` or `$E2`/`$E3` that set the rate, or the top of the document. */
  private tempoSpan(): Span {
    const command = this.tokens().commands.find(
      (c) => c.vcmd === 0xe2 || c.vcmd === 0xe3 || (c.vcmd === undefined && c.kind === 't'),
    );
    return command?.span ?? { start: 0, end: 0, line: 1 };
  }

  /**
   * The command map by ARAM address, which is how the walk names a command.
   * The sibling of {@link notesByAddress}, and what turns `WalkNote.origins`
   * back into the text a command was written as.
   */
  private readonly commandsByAddress = computed<ReadonlyMap<number, CommandAddress>>(
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

  /**
   * Every command that takes effect, and the tick it runs at — the roll's
   * command lane. The rule itself is `command-timeline.ts`, so `walktest` can pin
   * it; this holds it to the current scan and compile.
   *
   * Empty while the editor has moved past the text that compiled, for the reason
   * {@link commandsInForce} is: a span into a document that has changed points at
   * the wrong thing. Past that guard {@link tokens} *is* the compiled text's scan,
   * so nothing here needs a second one held back to the compile.
   */
  readonly commandTimeline = computed<readonly TimelineCommand[]>(() => {
    const timeline = this.timeline();
    if (!timeline || this.compiledText() !== this.source()) {
      return [];
    }

    return commandTimeline({
      timeline,
      index: this.tokens(),
      commands: this.commandsByAddress(),
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

  private readonly errorCount = computed(
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
   * The song's loop structure, off the same undebounced scan {@link tokens} is.
   *
   * Here rather than in each panel because three of them ask on every keystroke —
   * the two palettes, for what a bracket may go round, and the inspector, for
   * what construct the caret is in — and one pass answers all three.
   */
  readonly loops = computed(() => readLoops(this.source(), this.tokens()));

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

  /** Set by actions that report outside compilation, such as export — see {@link fail} and {@link say}. */
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
  /**
   * Normalizing rewrites the whole document off the compile of it, so the two
   * have to be the same text: while a keystroke is still inside the debounce
   * the spans the rewrite is built on point into a document that has moved.
   */
  readonly canNormalize = computed(
    () => this.result()?.ok === true && this.compiledText() === this.source(),
  );

  /**
   * The song rewritten for editing, or the reasons it cannot be — see
   * `normalize-song.ts`. `null` without a driver, since there is no address to
   * compile at. Reads the live document rather than `committed`, which is what
   * {@link canNormalize} guards.
   *
   * With a channel, only that channel's music is rewritten and every other one
   * is left exactly as it was — which is what the roll asks for when one channel
   * is in the way, and which above all does not refuse because some *other*
   * channel holds the shape being objected to. The check is the same either
   * way: the result is walked and compared against the original before anything
   * is applied.
   */
  normalize(channel?: number): NormalizeOutcome | null {
    const driver = this.drivers.driver();
    if (!driver) {
      return null;
    }

    return normalizeSong(this.source(), driver.manifest.localPos, this.compileOptions(), channel);
  }

  constructor() {
    // Sanctioned effect: mirroring signal state into an imperative store.
    effect(() => writeStored(STORAGE_KEY, this.source()));

    // Sanctioned effect: the compiled bytes drive an imperative sink, the
    // measuring worker. Idle-triggered rather than per-compile, because a
    // typing burst produces a compile every 150 ms and each measurement is a
    // whole pass of emulation — there is no point measuring a song the next
    // keystroke will replace.
    effect(() => {
      const compiled = this.compilation()?.result.data != null;
      const stats = this.result()?.stats;
      const passTicks = stats ? stats.introTicks + stats.loopTicks : 0;
      // The measurer needs the assembled SPC, which needs the resolved sample
      // set — so it is handed a way to build one rather than reaching for it.
      untracked(() => this.measurer.schedule(compiled, passTicks, () => this.assembleSpc()));
    });
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

  /**
   * Says why an action did nothing, where nothing went wrong — a note not
   * sounded because the mixer has its channel silenced, say. Not `fail`, which
   * paints the line as an error, and not `ok`, which reads as a success.
   */
  say(text: string): void {
    this.override.set({ kind: 'info', text });
  }

  /**
   * Drops a {@link say} hint that has stopped being true — the action it
   * explained having since succeeded. Only `info`, which is advice about the
   * last action and is superseded by the next one; an error outlives the action
   * that raised it and is cleared by editing, as it always was.
   */
  clearHint(): void {
    if (this.override()?.kind === 'info') {
      this.override.set(null);
    }
  }
}
