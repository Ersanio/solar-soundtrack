import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';

import type { Command } from '@compiler/tokens';
import {
  FIR_PRESETS,
  FIR_TAPS,
  type FirTaps,
  clampTap,
  describeFir,
  designTone,
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

type Mode = 'presets' | 'tone' | 'draw';

/**
 * Four ways of writing the same eight bytes.
 *
 * Presets for the common case, a tone control for "make it darker", the
 * draw-and-fit interaction the community knows from FIRcon, and the raw
 * coefficients for anyone who wants them. They all read and write one signal,
 * so no two of them can disagree about what the filter is.
 *
 * The taps come from the `$F5` under the caret and go back to the same place.
 * Committing them recompiles, and because the player already reloads a
 * recompiled song in place, that is also how the filter gets auditioned — there
 * is no separate preview path.
 */
@Component({
  selector: 'amk-fir-designer',
  imports: [Button, FirGraph],
  templateUrl: './fir-designer.html',
  host: { class: 'flex flex-col gap-3' },
})
export class FirDesigner {
  readonly command = input.required<Command>();

  private readonly store = inject(EditorStore);
  private readonly playback = inject(Playback);

  protected readonly FIR_PRESETS = FIR_PRESETS;
  protected readonly mode = signal<Mode>('presets');

  /**
   * A pending edit, held while a control is being dragged.
   *
   * `null` means "whatever is in the text". Slider drags fire continuously and
   * committing each one would push a recompile through the typing debounce
   * dozens of times a second, so the graph follows this and the text is only
   * written when the gesture ends.
   */
  private readonly pending = signal<number[] | null>(null);

  /** The eight coefficients, as the DSP would read them. */
  protected readonly taps = computed<FirTaps>(() => {
    const pending = this.pending();
    if (pending) return pending;
    const args = this.command().args;
    return Array.from({ length: FIR_TAPS }, (_, i) => toSigned(args[i]?.value ?? 0));
  });

  protected readonly tone = signal(0);
  protected readonly strength = signal(1);
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
   * The `$F5` the last reading was taken on, and what it said.
   *
   * Moving the caret between two `$F5` commands reuses this component with a new
   * input rather than building a new one, so the span is what tells arriving at
   * a filter apart from editing one. `-1` is no reading yet: a span offset is
   * never negative, so the first pass can never look like a continuation.
   */
  private lastStart = -1;
  private lastRunaway = false;

  constructor() {
    // The song stops the moment an edit makes the echo run away, so the warning
    // beside the graph is never left sitting next to a song building towards
    // the clip it describes. Only the transition acts: opening the inspector on
    // a filter that is already bad is not an edit, and pressing play again with
    // the warning still up is a decision the user is entitled to make.
    effect(() => {
      const start = this.command().span.start;
      const runaway = this.runaway();
      const sameCommand = this.lastStart === start;
      const wasRunaway = this.lastRunaway;
      this.lastStart = start;
      this.lastRunaway = runaway;

      // In order: nothing is wrong, the caret arrived on another `$F5` (or on
      // this one) rather than editing it, and an unchanged warning is not a new
      // one.
      if (!runaway || !sameCommand || wasRunaway) return;

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

  /** Live while dragging: the graph updates, the text does not. */
  protected previewTone(): void {
    this.pending.set(designTone({ tone: this.tone(), strength: this.strength() }));
  }

  protected commitTone(): void {
    this.commit(designTone({ tone: this.tone(), strength: this.strength() }));
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
    // handle rather than stacking two of them.
    const kept = this.target().filter((p) => Math.abs(Math.log(p.hz / point.hz)) > 0.2);
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
    this.pending.set(null);
    const text = `$F5 ${taps.map((tap) => `$${toHexByte(tap)}`).join(' ')}`;
    this.store.replace.set({ span: { ...this.command().span }, text });
  }
}
