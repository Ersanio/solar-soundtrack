import { Component, computed, inject, input, signal } from '@angular/core';

import { argsRewritable, commandRewritable, spliceArgs, spliceCommand } from '@amk/tokens/edits';
import type { Command } from '@amk/tokens';
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
} from '@amk/spc/fir';
import { Button } from '../../../shared/button/button';
import { Slider } from '../../../shared/slider/slider';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { dragPreview } from '../commands/preview';
import { builtInFilterName, firOverriddenBy } from '@amk/tokens/fir-override';
import { FirGraph } from '../fir-graph/fir-graph';
import { stopWhenRunaway } from '../runaway-guard';
import { feedbackBefore } from '@amk/tokens/echo-hazards';
import { Hex2Pipe } from '../../../util/hex.pipe';

type Mode = 'presets' | 'draw';

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
 * `Warm`, `Dark` and `Bright` are `designTone`'s output, so the tilt it designs
 * is one click away and needs no slider of its own.
 *
 * The taps come from the `$F5` under the caret and go back to the same place.
 * Committing them recompiles, and because the player already reloads a
 * recompiled song in place, that is also how the filter gets *auditioned* — what
 * you hear is only ever the document. Seeing it is a separate matter, and the
 * plot follows the coefficient fields as they are typed; see {@link
 * FirDesigner.shownTaps}.
 */
@Component({
  selector: 'amk-fir-designer',
  imports: [Button, FirGraph, Hex2Pipe, Slider],
  templateUrl: './fir-designer.html',
  host: { class: 'flex flex-col gap-3' },
})
export class FirDesigner {
  private readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  readonly command = input.required<Command>();

  protected readonly FIR_PRESETS = FIR_PRESETS;
  protected readonly mode = signal<Mode>('presets');

  /**
   * The eight coefficients as the document holds them.
   *
   * What gets written, and — the part that matters — what the runaway interlock
   * below judges. See {@link shownTaps} for the pair to this.
   */
  protected readonly taps = computed<FirTaps>(() => {
    const args = this.command().args;
    return Array.from({ length: FIR_TAPS }, (_, i) => toSigned(args[i]?.value ?? 0));
  });

  /**
   * The eight as the fields are showing them, per keystroke.
   *
   * A coefficient field commits on blur, and the plot must not wait for that:
   * these feed it and every reading beside it, so the response, the corner, the
   * tilt and the headroom warning all answer for what is typed.
   *
   * They deliberately do **not** feed the `[value]` binding on the inputs
   * themselves: writing a parsed number back into a field mid-word rewrites
   * `03` as `3` and takes the caret with it.
   */
  private readonly drag = dragPreview(this.command);

  protected readonly shownTaps = computed<FirTaps>(() =>
    this.taps().map((tap, index) => this.drag.at(index, tap)),
  );

  protected readonly target = signal<{ hz: number; gain: number }[]>([]);

  protected readonly description = computed(() => describeFir(this.shownTaps()));
  protected readonly activePreset = computed(() => matchPreset(this.shownTaps()));
  protected readonly headroom = computed(() => firHeadroom(this.shownTaps()));

  /**
   * The feedback the echo is running at, taken from the nearest preceding `$F1`
   * in the source — its second argument. Without it there is no way to say
   * whether this filter makes the echo run away, since that depends on both.
   *
   * Shared with the diagnostic that reports the same filter in the output pane,
   * so the two can never put a different number on it.
   */
  protected readonly feedback = computed(() =>
    feedbackBefore(this.command(), this.store.tokens().commands),
  );

  /** The verdict the panel prints, and the one the interlock acts on. */
  protected readonly stability = computed(() => echoStability(this.shownTaps(), this.feedback()));

  /**
   * Just the flag, so the interlock runs on a genuine change.
   *
   * Read off the **shown** taps, not the committed ones. The coefficients are
   * sliders, so a drag passes through every value between where it started and
   * where it is going — and the player is running the whole time, since a
   * preview does not recompile. A filter that runs away halfway across the
   * track is one you can hear, and waiting for the pointer to come up before
   * stopping is waiting through exactly the noise the interlock exists to
   * prevent.
   *
   * `echoStability` returns a fresh object each time, since the taps rebuild
   * from `command().args`. A `computed` over the boolean compares by value and
   * only notifies when it actually flips.
   */
  private readonly runaway = computed(() => this.stability().runaway);

  constructor() {
    stopWhenRunaway(this.command, this.runaway, 'FIR filter');
  }

  /**
   * A later `$F1` in this channel, which silently throws these coefficients
   * away when it runs. Worth saying while they are being tuned rather than
   * after.
   */
  protected readonly overriddenBy = computed(() => {
    const later = firOverriddenBy(this.command(), this.store.tokens().commands);
    if (!later) {
      return null;
    }

    return {
      line: later.span.line,
      filter: builtInFilterName(later.args[2]?.value ?? 0),
    };
  });

  /** `tap` positions the field and comes from the document; `hex` follows the typing. */
  protected readonly rows = computed(() => {
    const shown = this.shownTaps();
    return this.taps().map((tap, index) => ({
      index,
      tap,
      hex: `$${toHexByte(shown[index] ?? tap)}`,
    }));
  });

  protected readonly cornerLabel = computed(() => {
    const corner = this.description().cornerHz;
    if (corner === null) {
      return '—';
    }

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

  /** Every frame of a drag: redraws the curve, and arms the interlock below. */
  protected previewTap(index: number, value: number): void {
    this.drag.set(index, clampTap(value));
  }

  protected setTap(index: number, value: number): void {
    // Set here as well as on `preview`, because a slider dragged away from and
    // back to its own value commits nothing — and the preview map is cleared by
    // the re-scan a commit causes, so without this it would keep showing the
    // number that was abandoned.
    this.drag.set(index, clampTap(value));

    const next = [...this.taps()];
    next[index] = clampTap(value);
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
    if (this.target().length < 2) {
      return;
    }

    this.commit(fitToTarget(this.target()));
  }

  protected clearTarget(): void {
    this.target.set([]);
  }

  /**
   * Coefficients reached through a replacement are readable but not writable.
   *
   * The question is asked of the arguments alone, not of the whole command: a
   * `"fir"=$F5` followed by eight literal bytes is the common shape, and those
   * bytes are text the author typed and can be written over. Only when the
   * *coefficients themselves* came out of an expansion is there nothing to
   * write — they collapse onto the use site, so a splice would inline the macro
   * and swallow anything it carried past the command.
   */
  protected readonly readOnly = computed(
    () => !argsRewritable(this.command()) && !commandRewritable(this.command()),
  );

  /** Writes the eight bytes back over the arguments they came from. */
  private commit(taps: number[]): void {
    const command = this.command();
    const source = this.store.source();
    const bytes = taps.map((tap) => `$${toHexByte(tap)}`);

    // A half-written `$F5` has fewer argument spans than there are coefficients,
    // so there is nowhere to splice the missing ones — the run is rewritten
    // whole instead, which is the one case where losing the author's spacing is
    // unavoidable rather than careless.
    if (!command.complete) {
      this.requests.apply(spliceCommand(source, command, `$F5 ${bytes.join(' ')}`));
      return;
    }

    this.requests.apply(spliceArgs(source, command, bytes));
  }
}
