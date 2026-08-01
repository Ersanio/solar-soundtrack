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
 * The axis runs octave to octave, 125 Hz to Nyquist, so the gridlines land on
 * the plot's own edges and the labels underneath line up with them without
 * being positioned by hand.
 */
const FROM_HZ = 125;
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

const OCTAVES = [125, 250, 500, 1000, 2000, 4000, 8000, 16000];

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
  });

  /** Log frequency to plot x. */
  private readonly xOf = (hz: number): number => {
    const t =
      (Math.log(Math.max(hz, FROM_HZ)) - Math.log(FROM_HZ)) / (Math.log(TO_HZ) - Math.log(FROM_HZ));
    return t * VIEW_W;
  };

  /** Gain to plot y, clamped to the floor so a null does not run off-canvas. */
  private readonly yOf = (gain: number): number => {
    const db = Math.max(20 * Math.log10(Math.max(gain, 1e-9)), FLOOR_DB);
    return ((TOP_DB - db) / (TOP_DB - FLOOR_DB)) * VIEW_H;
  };

  protected readonly unityY = computed(() => this.yOf(1));
  protected readonly authorityWidth = computed(() => this.xOf(FIR_AUTHORITY_HZ));

  protected readonly gridLines = computed(() =>
    OCTAVES.map((hz) => ({
      hz,
      x: this.xOf(hz),
      label: hz >= 1000 ? `${hz / 1000}k` : `${hz}`,
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

  protected readonly targetPath = computed(() => {
    const points = this.target();
    if (!points || points.length < 2) return null;
    const sorted = [...points].sort((a, b) => a.hz - b.hz);
    return sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${this.xOf(p.hz)} ${this.yOf(p.gain)}`).join(' ');
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

    const hz = FROM_HZ * Math.exp(Math.min(Math.max(tx, 0), 1) * Math.log(TO_HZ / FROM_HZ));
    const db = TOP_DB - Math.min(Math.max(ty, 0), 1) * (TOP_DB - FLOOR_DB);
    this.picked.emit({ hz, gain: 10 ** (db / 20) });
  }

  /** What a screen reader gets instead of the picture. */
  protected readonly description = computed(() => {
    const at = (hz: number) => (20 * Math.log10(Math.max(firMagnitude(this.taps(), hz), 1e-9))).toFixed(0);
    return (
      `Echo filter response: ${at(500)} decibels at 500 hertz, ${at(2000)} at 2 kilohertz, ` +
      `${at(8000)} at 8 kilohertz, ${at(14000)} at 14 kilohertz.`
    );
  });

  private pathOf(magnitudes: number[]): string {
    return magnitudes
      .map((gain, i) => `${i === 0 ? 'M' : 'L'}${this.xOf(this.frequencies[i])} ${this.yOf(gain)}`)
      .join(' ');
  }
}
