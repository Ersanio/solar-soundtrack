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

import { argsRewritable, commandRewritable, spliceArgs, spliceCommand } from '@compiler/edits';
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
import { dragPreview } from '../commands/preview';
import { builtInFilterName, firOverriddenBy } from '../fir-override';
import { FirGraph } from '../fir-graph/fir-graph';
import { feedbackBefore } from '../../../util/echo-hazards';
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
 * recompiled song in place, that is also how the filter gets *auditioned* — what
 * you hear is only ever the document. Seeing it is a separate matter, and the
 * plot follows the coefficient fields as they are typed; see {@link
 * FirDesigner.shownTaps}.
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
   * A coefficient field commits on blur, which left the curve describing the
   * filter you were replacing for the whole time you were replacing it. These
   * feed the plot and every reading beside it, so the response, the corner, the
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

  /** The verdict the panel prints, so a filter is called dangerous as it is typed. */
  protected readonly stability = computed(() => echoStability(this.shownTaps(), this.feedback()));

  /**
   * Just the flag, so the effect below runs on a genuine change — and read off
   * the **committed** taps, which is the whole of why this is not
   * `stability().runaway`.
   *
   * The effect stops playback. A `3` typed on the way to `32` is a filter
   * nobody asked for and nobody wrote, and halting the song over one would make
   * the field unusable. So the warning goes live and the interlock does not: the
   * panel says a filter will run away while you are still typing it, and only
   * ever stops the music over one that is actually in the document.
   *
   * `echoStability` returns a fresh object each time, since the taps rebuild
   * from `command().args`. A `computed` over the boolean compares by value and
   * only notifies when it actually flips.
   */
  private readonly runaway = computed(() => echoStability(this.taps(), this.feedback()).runaway);

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
      if (!this.reading().became) {
        return;
      }

      untracked(() => {
        // A paused song is not audible, and resuming one is as deliberate an act
        // as pressing play.
        if (!this.playback.isPlaying()) {
          return;
        }

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
      hex: toHexByte(shown[index] ?? tap),
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

  /** Per keystroke. Half-typed text parses to `NaN` and the last reading stands. */
  protected previewTap(index: number, value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) {
      this.drag.set(index, clampTap(parsed));
    }
  }

  protected setTap(index: number, value: string): void {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return;
    }

    // Set here as well as on `input`, because a field typed away from and back
    // to its own value commits nothing — and a preview map is cleared by the
    // re-scan a commit causes, so without this it would keep showing the number
    // that was abandoned.
    this.drag.set(index, clampTap(parsed));

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
      this.store.apply(spliceCommand(source, command, `$F5 ${bytes.join(' ')}`));
      return;
    }

    this.store.apply(spliceArgs(source, command, bytes));
  }
}
