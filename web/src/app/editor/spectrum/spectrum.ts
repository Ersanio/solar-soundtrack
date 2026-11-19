import {
  Component,
  type ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';

import { canvasColors, fitCanvas } from '../../shared/chart/canvas-colors';
import { elementSize } from '../../shared/chart/element-size';
import { frameClock } from '../../shared/chart/frame-clock';
import {
  BLACKMAN,
  FLOOR_DB,
  THIRD_OCTAVES,
  analyserPower,
  bandLevels,
  levelFraction,
} from '../../state/analysis/spectrum-bands';
import { Playback } from '../../state/playback';
import { spectrumBars } from './spectrum-bars';

/** How fast a bar's peak cap falls back, in dB a second. */
const PEAK_FALL_DB = 24;

/** The bands labelled under the full-size meter. */
const LABELLED = new Set([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);

/**
 * The song's spectrum as it plays: the 28 third-octave bands from 31.5 Hz to 16 kHz, on the fixed
 * scale every song is read on (`state/analysis/spectrum-bands.ts`).
 *
 * `compact` is the top bar's: fourteen bars, each the louder of two bands, with no labels. Read
 * off the player's analyser at frame rate while the song plays, and drawn on a canvas, which is
 * repainted per frame where an SVG would rebuild its DOM.
 */
@Component({
  selector: 'amk-spectrum',
  templateUrl: './spectrum.html',
  host: { class: 'block' },
})
export class Spectrum {
  private readonly playback = inject(Playback);

  readonly compact = input(false, { transform: booleanAttribute });

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly size = elementSize(this.canvas);
  private readonly colors = canvasColors();
  private readonly frame = frameClock(computed(() => this.playback.isPlaying()));

  private readonly decibels = new Float32Array(this.playback.spectrumBins);
  private readonly power = new Float32Array(this.playback.spectrumBins);
  private readonly bands = new Float32Array(THIRD_OCTAVES.length);
  private peaks = new Float32Array(0);
  private lastFrame = 0;

  constructor() {
    // Sanctioned effect: painting a canvas, once a frame while the song plays and once more when
    // it stops, the theme changes or the box is resized.
    effect(() => {
      const at = this.frame();
      const playing = this.playback.isPlaying();
      const size = this.size();
      this.colors.version();
      this.compact();
      untracked(() => this.draw(at, playing, size.width, size.height));
    });
  }

  private draw(at: number, playing: boolean, width: number, height: number): void {
    const context = fitCanvas(this.canvas().nativeElement, width, height);
    if (!context) {
      return;
    }

    const compact = this.compact();
    const binHz = playing ? this.playback.readSpectrum(this.decibels) : null;
    if (binHz === null) {
      this.bands.fill(FLOOR_DB);
    } else {
      analyserPower(this.decibels, this.power);
      bandLevels(this.power, binHz, THIRD_OCTAVES, BLACKMAN, 1 / 4, this.bands);
    }

    const levels = spectrumBars(this.bands, compact);
    if (this.peaks.length !== levels.length) {
      this.peaks = new Float32Array(levels.length).fill(FLOOR_DB);
    }

    const elapsed = this.lastFrame > 0 && at > this.lastFrame ? (at - this.lastFrame) / 1000 : 0;
    this.lastFrame = playing ? at : 0;
    for (let n = 0; n < levels.length; n++) {
      this.peaks[n] = playing
        ? Math.max(levels[n], this.peaks[n] - PEAK_FALL_DB * elapsed)
        : FLOOR_DB;
    }

    const labels = compact ? 0 : 12;
    const plotHeight = height - labels;
    const gap = compact ? 1 : 2;
    const barWidth = (width - gap * (levels.length - 1)) / levels.length;

    context.clearRect(0, 0, width, height);

    if (!compact) {
      // Rules every 12 dB, so a level can be read off the scale.
      context.fillStyle = this.colors.color('edge');
      for (let db = FLOOR_DB + 12; db < 0; db += 12) {
        const y = Math.round(plotHeight * (1 - levelFraction(db))) + 0.5;
        context.fillRect(0, y, width, 1);
      }
    }

    context.fillStyle = this.colors.color(compact ? 'inset' : 'surface');
    for (let n = 0; n < levels.length; n++) {
      context.fillRect(n * (barWidth + gap), 0, barWidth, plotHeight);
    }

    context.fillStyle = this.colors.color('accent');
    for (let n = 0; n < levels.length; n++) {
      const h = plotHeight * levelFraction(levels[n]);
      context.fillRect(n * (barWidth + gap), plotHeight - h, barWidth, h);
    }

    if (playing) {
      context.fillStyle = this.colors.color('ink');
      for (let n = 0; n < levels.length; n++) {
        const y = plotHeight * (1 - levelFraction(this.peaks[n]));
        context.fillRect(n * (barWidth + gap), Math.min(plotHeight - 1, y), barWidth, 1);
      }
    }

    if (labels > 0) {
      context.fillStyle = this.colors.color('ink-muted');
      context.font = '10px ui-monospace, monospace';
      context.textAlign = 'center';
      context.textBaseline = 'bottom';
      THIRD_OCTAVES.forEach((band, n) => {
        if (LABELLED.has(band.centre)) {
          const text = band.centre >= 1000 ? `${band.centre / 1000}k` : `${band.centre}`;
          context.fillText(text, n * (barWidth + gap) + barWidth / 2, height);
        }
      });
    }
  }
}
