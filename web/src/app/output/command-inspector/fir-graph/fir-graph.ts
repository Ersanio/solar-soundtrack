import { Component, computed, input, output } from '@angular/core';

import {
  DSP_RATE,
  FIR_AUTHORITY_HZ,
  type FirTaps,
  echoStability,
  firCurveFrequencies,
  firMagnitude,
} from '@spc/fir';

/** Plot bounds. The floor is deep enough to show a real stopband. */
const TOP_DB = 12;
const FLOOR_DB = -48;
/**
 * The frequency axis is **linear**, DC to Nyquist, which is not what an audio
 * plot usually does and is deliberate.
 *
 * An 8-tap response is a degree-7 polynomial in `cos(ω)`, so its nulls and
 * ripples are spaced evenly in frequency. Every feature of AddmusicK's own
 * `EchoFilter0` — both nulls, both ripple peaks — sits above 8.7 kHz, which a
 * log axis over the same range squeezes into its rightmost seventh while
 * spending four octaves on a region {@link FIR_AUTHORITY_HZ} says the filter
 * cannot shape at all. Linear gives that top octave half the width instead.
 *
 * It also makes DC drawable. `firDcGain` is a real quantity — the manual's
 * low-pass sums to 132 and so lifts steady tones by 3% — and a log axis can
 * never show 0 Hz at all.
 *
 * The cost is that hearing is logarithmic and this is not. That argument is at
 * its weakest here: the octaves it would buy space for are exactly the ones the
 * filter has no authority over.
 */
const FROM_HZ = 0;
const TO_HZ = DSP_RATE / 2;
const POINTS = 160;

/** How many echo repeats to ghost in behind the main curve. */
const REPEATS = 4;

/**
 * Drawn in a fixed coordinate space and stretched to fit, the way the sample
 * browser's waveform is. Cheaper than measuring the element, and the only cost
 * is that stroke widths scale with it — which is why they are set in the
 * viewBox's own units rather than pixels.
 */
const VIEW_W = 320;
const VIEW_H = 150;

/** Every 2 kHz, so the ticks are evenly spaced and land on both plot edges. */
const TICKS = [0, 2000, 4000, 6000, 8000, 10000, 12000, 14000, 16000];

@Component({
  selector: 'amk-fir-graph',
  host: { class: 'block' },
  template: `
    <figure class="m-0">
      <svg
        [attr.viewBox]="VIEW_BOX"
        preserveAspectRatio="none"
        class="bg-inset border-edge h-32 w-full rounded-sm border"
        [class.cursor-crosshair]="drawable()"
        role="img"
        [attr.aria-label]="description()"
        (pointerdown)="drawable() && onPick($event)"
      >
        <!-- Where eight taps at 32 kHz have no real say. Drawn first, so
             everything else sits on top of it. -->
        <rect
          x="0"
          y="0"
          [attr.width]="authorityWidth()"
          [attr.height]="VIEW_H"
          class="fill-ink-muted/15"
        />

        @for (line of gridLines(); track line.hz) {
          <line
            [attr.x1]="line.x"
            [attr.x2]="line.x"
            y1="0"
            [attr.y2]="VIEW_H"
            class="stroke-edge"
            stroke-width="0.5"
          />
        }

        <!-- Unity, so "louder or quieter than what went in" reads at a glance. -->
        <line
          x1="0"
          [attr.x2]="VIEW_W"
          [attr.y1]="unityY()"
          [attr.y2]="unityY()"
          class="stroke-edge"
          stroke-width="1"
          stroke-dasharray="3 3"
        />

        @if (runawayBand(); as band) {
          <rect
            [attr.x]="band.x"
            y="0"
            [attr.width]="band.width"
            [attr.height]="VIEW_H"
            class="fill-danger/20"
          />
        }

        <!-- Successive echo repeats, fading back. The filter is inside the
             feedback loop, so this is the tail getting darker pass by pass. -->
        @for (ghost of repeatPaths(); track ghost.pass) {
          <path
            [attr.d]="ghost.d"
            fill="none"
            class="stroke-accent"
            [attr.stroke-opacity]="ghost.opacity"
            stroke-width="1"
          />
        }

        @if (targetPath(); as target) {
          <path
            [attr.d]="target"
            fill="none"
            class="stroke-warn"
            stroke-width="1.5"
            stroke-dasharray="4 3"
          />
        }

        <path [attr.d]="responsePath()" fill="none" class="stroke-accent" stroke-width="2" />
      </svg>

      <figcaption class="text-ink-muted mt-1 flex justify-between font-mono text-[10px]">
        @for (line of gridLines(); track line.hz) {
          <span>{{ line.label }}</span>
        }
      </figcaption>
    </figure>
  `,
})
export class FirGraph {
  readonly taps = input.required<FirTaps>();
  /** Echo feedback byte, for the runaway band. `0` disables the check. */
  readonly feedback = input(0);
  /** A drawn target curve, when the designer is in draw mode. */
  readonly target = input<{ hz: number; gain: number }[] | null>(null);
  /** Whether clicking the plot adds a point to that curve. */
  readonly drawable = input(false);
  /** Fired with a frequency and gain when the plot is clicked in draw mode. */
  readonly picked = output<{ hz: number; gain: number }>();

  protected readonly VIEW_W = VIEW_W;
  protected readonly VIEW_H = VIEW_H;
  protected readonly VIEW_BOX = `0 0 ${VIEW_W} ${VIEW_H}`;

  private readonly frequencies = firCurveFrequencies({
    fromHz: FROM_HZ,
    toHz: TO_HZ,
    points: POINTS,
    log: false,
  });

  /** Frequency to plot x. */
  private readonly xOf = (hz: number): number => {
    return ((hz - FROM_HZ) / (TO_HZ - FROM_HZ)) * VIEW_W;
  };

  /**
   * Gain to plot y, clamped at both ends so nothing runs off-canvas.
   *
   * A null falls to negative infinity, and a boost reaches +18 dB — `Σ|c|/128`
   * is 8 with every tap at the rail — which is past the top of the plot. Either
   * end is pinned to the edge and drawn at half thickness there, which reads as
   * "off the scale" rather than as the curve simply vanishing.
   */
  private readonly yOf = (gain: number): number => {
    const db = 20 * Math.log10(Math.max(gain, 1e-9));
    const clamped = Math.min(Math.max(db, FLOOR_DB), TOP_DB);
    return ((TOP_DB - clamped) / (TOP_DB - FLOOR_DB)) * VIEW_H;
  };

  protected readonly unityY = computed(() => this.yOf(1));
  protected readonly authorityWidth = computed(() => this.xOf(FIR_AUTHORITY_HZ));

  protected readonly gridLines = computed(() =>
    TICKS.map((hz) => ({
      hz,
      x: this.xOf(hz),
      label: hz === 0 ? '0' : `${hz / 1000}k`,
    })),
  );

  private readonly response = computed(() =>
    this.frequencies.map((hz) => firMagnitude(this.taps(), hz)),
  );

  protected readonly responsePath = computed(() => this.pathOf(this.response()));

  protected readonly repeatPaths = computed(() => {
    const first = this.response();
    const out: { pass: number; d: string; opacity: number }[] = [];
    for (let pass = 2; pass <= REPEATS; pass++) {
      out.push({
        pass,
        d: this.pathOf(first.map((magnitude) => magnitude ** pass)),
        opacity: 0.45 / (pass - 1),
      });
    }
    return out;
  });

  /**
   * The drawn target, including the flat runs past the outermost points.
   *
   * `fitToTarget` holds the first and last gain out to the edges of the band
   * rather than extrapolating the slope, so those two runs are as much a part
   * of what gets fitted as the segments between the points. Stroking only
   * between the points would show less than the fit is actually given — the
   * curve would appear to stop while the filter was still being told what to
   * do out there. FIRcon draws the same two extensions.
   */
  protected readonly targetPath = computed(() => {
    const points = this.target();
    if (!points || points.length < 2) return null;
    const sorted = [...points].sort((a, b) => a.hz - b.hz);
    const drawn = sorted.map((p) => `L${this.xOf(p.hz)} ${this.yOf(p.gain)}`).join(' ');
    const first = this.yOf(sorted[0].gain);
    const last = this.yOf(sorted[sorted.length - 1].gain);
    return `M0 ${first} ${drawn} L${VIEW_W} ${last}`;
  });

  protected readonly runawayBand = computed(() => {
    const feedback = this.feedback();
    if (!feedback) return null;
    const band = echoStability(this.taps(), feedback).runawayBand;
    if (!band) return null;
    const x = this.xOf(band.fromHz);
    // A band that is one sample wide still has to be visible.
    return { x, width: Math.max(this.xOf(band.toHz) - x, 2) };
  });

  /**
   * Turns a click into a point on the target curve.
   *
   * The plot is stretched to its container, so viewBox units and CSS pixels are
   * not the same size and the click has to be scaled back through the measured
   * rectangle rather than read off the event directly.
   */
  protected onPick(event: PointerEvent): void {
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const tx = (event.clientX - rect.left) / rect.width;
    const ty = (event.clientY - rect.top) / rect.height;

    const hz = FROM_HZ + Math.min(Math.max(tx, 0), 1) * (TO_HZ - FROM_HZ);
    const db = TOP_DB - Math.min(Math.max(ty, 0), 1) * (TOP_DB - FLOOR_DB);
    this.picked.emit({ hz, gain: 10 ** (db / 20) });
  }

  /** What a screen reader gets instead of the picture. */
  protected readonly description = computed(() => {
    const at = (hz: number) =>
      (20 * Math.log10(Math.max(firMagnitude(this.taps(), hz), 1e-9))).toFixed(0);
    return (
      `Echo filter response: ${at(0)} decibels at DC, ${at(2000)} at 2 kilohertz, ` +
      `${at(8000)} at 8 kilohertz, ${at(14000)} at 14 kilohertz.`
    );
  });

  private pathOf(magnitudes: number[]): string {
    return magnitudes
      .map((gain, i) => `${i === 0 ? 'M' : 'L'}${this.xOf(this.frequencies[i])} ${this.yOf(gain)}`)
      .join(' ');
  }
}
