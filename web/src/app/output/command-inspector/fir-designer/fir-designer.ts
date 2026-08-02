import {
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';

import type { Command } from '@compiler/tokens';
import {
  FIR_PRESETS,
  FIR_TAPS,
  type FirTaps,
  clampTap,
  describeFir,
  echoStability,
  firHeadroom,
  fitToTarget,
  matchPreset,
  toHexByte,
  toSigned,
} from '@spc/fir';
import { Button } from '../../../shared/button/button';
import { EditorStore } from '../../../state/editor-store';
import { Playback } from '../../../state/playback';
import { builtInFilterName, firOverriddenBy } from '../fir-override';
import { FirGraph } from '../fir-graph/fir-graph';
import { Hex2Pipe } from '../../../util/hex.pipe';

type Mode = 'presets' | 'draw';

/** Which `$F5` the echo was last judged on, and what the verdict was. */
interface Reading {
  start: number;
  runaway: boolean;
}

/**
 * How close two drawn points have to be to count as the same one — about 3% of
 * the band, which is a click target's worth of the plot's width.
 */
const MERGE_HZ = 500;

/**
 * Three ways of writing the same eight bytes.
 *
 * Presets for the common case, the draw-and-fit interaction the community knows
 * from FIRcon, and the raw coefficients for anyone who wants them. They all read
 * and write one signal, so no two of them can disagree about what the filter is.
 *
 * There was a fourth — a tone slider over `designTone` — and it went
 * because it was a worse way to reach the presets it generates. `Warm`, `Dark`
 * and `Bright` are still that function's output, so the tilt it designs is
 * reachable in one click rather than by finding a slider position.
 *
 * The taps come from the `$F5` under the caret and go back to the same place.
 * Committing them recompiles, and because the player already reloads a
 * recompiled song in place, that is also how the filter gets auditioned — there
 * is no separate preview path.
 */
@Component({
  selector: 'amk-fir-designer',
  imports: [Button, FirGraph, Hex2Pipe],
  templateUrl: './fir-designer.html',
  host: { class: 'flex flex-col gap-3' },
})
export class FirDesigner {
  private readonly store = inject(EditorStore);
  private readonly playback = inject(Playback);

  readonly command = input.required<Command>();

  protected readonly FIR_PRESETS = FIR_PRESETS;
  protected readonly mode = signal<Mode>('presets');

  /**
   * The eight coefficients, as the DSP would read them.
   *
   * Read straight from the text with nothing held in front of it. The tone
   * slider needed a pending-edit signal here, because a drag fires continuously
   * and committing each frame would push a recompile through the typing debounce
   * dozens of times a second. Every control that is left commits once per
   * gesture, so the text can be the only source of truth again.
   */
  protected readonly taps = computed<FirTaps>(() => {
    const args = this.command().args;
    return Array.from({ length: FIR_TAPS }, (_, i) => toSigned(args[i]?.value ?? 0));
  });

  protected readonly target = signal<{ hz: number; gain: number }[]>([]);

  protected readonly description = computed(() => describeFir(this.taps()));
  protected readonly activePreset = computed(() => matchPreset(this.taps()));
  protected readonly headroom = computed(() => firHeadroom(this.taps()));

  /**
   * The feedback the echo is running at, taken from the nearest preceding `$F1`
   * in the source — its second argument. Without it there is no way to say
   * whether this filter makes the echo run away, since that depends on both.
   */
  protected readonly feedback = computed(() => {
    const self = this.command();
    let found = 0;
    for (const command of this.store.tokens().commands) {
      if (command.span.start >= self.span.start) break;
      // Same channel only: source order is execution order within a channel,
      // and means nothing between them.
      if (command.channel !== self.channel) continue;
      if (command.vcmd === 0xf1 && command.args.length >= 2) found = command.args[1].value;
    }
    return found;
  });

  protected readonly stability = computed(() => echoStability(this.taps(), this.feedback()));

  /**
   * Just the flag, so the effect below runs on a genuine change.
   *
   * `stability()` is a fresh object on every keystroke, since `taps()` rebuilds
   * from `command().args`. A `computed` over the boolean compares by value and
   * only notifies when it actually flips.
   */
  private readonly runaway = computed(() => this.stability().runaway);

  /**
   * The current reading, and whether it is one an edit just produced.
   *
   * `became` is the whole question: an edit to *this* `$F5` that turned a sane
   * filter into a runaway one. Moving the caret between two `$F5` commands
   * reuses this component with a new input rather than building a new one, so
   * the span is what tells arriving at a filter apart from editing it, and the
   * previous reading is what tells a new warning from a standing one.
   *
   * A `linkedSignal` rather than fields mutated inside the effect: the previous
   * value then lives in the signal graph, where it is derived in one place and
   * readable, instead of in instance state whose answer depends on how many
   * times the effect happened to have run.
   */
  private readonly reading = linkedSignal<Reading, Reading & { became: boolean }>({
    source: () => ({ start: this.command().span.start, runaway: this.runaway() }),
    computation: (next, previous) => ({
      ...next,
      became: next.runaway && previous?.value.start === next.start && !previous.value.runaway,
    }),
  });

  constructor() {
    // The song stops the moment an edit makes the echo run away, so the warning
    // beside the graph is never left sitting next to a song building towards
    // the clip it describes. Only the transition acts: opening the inspector on
    // a filter that is already bad is not an edit, and pressing play again with
    // the warning still up is a decision the user is entitled to make.
    effect(() => {
      if (!this.reading().became) return;

      untracked(() => {
        // A paused song is not audible, and resuming one is as deliberate an act
        // as pressing play.
        if (!this.playback.isPlaying()) return;
        this.playback.stop();
        this.store.fail(
          'playback automatically stopped to protect your ears and speakers due to a runaway FIR filter',
        );
      });
    });
  }

  /**
   * A later `$F1` in this channel, which silently throws these coefficients
   * away when it runs. Worth saying while they are being tuned rather than
   * after.
   */
  protected readonly overriddenBy = computed(() => {
    const later = firOverriddenBy(this.command(), this.store.tokens().commands);
    if (!later) return null;
    return {
      line: later.span.line,
      filter: builtInFilterName(later.args[2]?.value ?? 0),
    };
  });

  protected readonly rows = computed(() =>
    this.taps().map((tap, index) => ({ index, tap, hex: toHexByte(tap) })),
  );

  protected readonly cornerLabel = computed(() => {
    const corner = this.description().cornerHz;
    if (corner === null) return '—';
    return corner >= 1000 ? `${(corner / 1000).toFixed(1)} kHz` : `${Math.round(corner)} Hz`;
  });

  protected readonly tiltLabel = computed(() => {
    const tilt = this.description().tiltDb;
    return `${tilt > 0 ? '+' : ''}${tilt.toFixed(1)} dB`;
  });

  // --- editing ---------------------------------------------------------------

  protected applyPreset(taps: number[]): void {
    this.commit(taps);
  }

  protected setTap(index: number, value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    const next = [...this.taps()];
    next[index] = clampTap(parsed);
    this.commit(next);
  }

  protected addTargetPoint(point: { hz: number; gain: number }): void {
    // One point per frequency, so clicking twice near the same place moves the
    // handle rather than stacking two of them. Measured in plain hertz because
    // the plot's axis is linear: a log ratio would call two clicks 200 Hz apart
    // at the top of the band the same point while treating two overlapping ones
    // down at 100 Hz as distinct, which is backwards from what you can see.
    const kept = this.target().filter((p) => Math.abs(p.hz - point.hz) > MERGE_HZ);
    this.target.set([...kept, point].sort((a, b) => a.hz - b.hz));
  }

  protected fit(): void {
    if (this.target().length < 2) return;
    this.commit(fitToTarget(this.target()));
  }

  protected clearTarget(): void {
    this.target.set([]);
  }

  /**
   * A `$F5` reached through a replacement is readable but not writable.
   *
   * Its span covers the macro's name, not the bytes — everything the expansion
   * produced collapses onto the use site — so writing over it would inline the
   * macro, and would silently swallow anything the same expansion carried past
   * the command. The definition is the only honest place to edit.
   */
  protected readonly readOnly = computed(() => this.command().replacement !== undefined);

  /** Writes the eight bytes back over the `$F5` run they came from. */
  private commit(taps: number[]): void {
    if (this.readOnly()) return;
    const text = `$F5 ${taps.map((tap) => `$${toHexByte(tap)}`).join(' ')}`;
    this.store.replace.set({ span: { ...this.command().span }, text });
  }
}
