import { Component, computed, inject, input, signal } from '@angular/core';

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

  /** Writes the eight bytes back over the `$F5` run they came from. */
  private commit(taps: number[]): void {
    this.pending.set(null);
    const text = `$F5 ${taps.map((tap) => `$${toHexByte(tap)}`).join(' ')}`;
    this.store.replace.set({ span: { ...this.command().span }, text });
  }
}
