import {
  Component,
  DestroyRef,
  type ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';

import { CAPTURE_FRAMES, type VoiceCapture } from '@amk/spc/protocol';
import { canvasColors, fitCanvas } from '../../../../shared/chart/canvas-colors';
import { elementSize } from '../../../../shared/chart/element-size';
import { frameClock } from '../../../../shared/chart/frame-clock';
import {
  type CorrelationMeter,
  SCOPE_FULL_SCALE,
  correlation,
  heardGain,
  stepCorrelation,
  triggerFrame,
} from '../../../../state/analysis/scope';
import { Mixer } from '../../../../state/mixer';
import { Playback } from '../../../../state/playback';
import { Spectrum } from '../../../spectrum/spectrum';

/** Frames a scope shows: 16 ms, two cycles of anything from 125 Hz up. */
const SCOPE_SPAN = CAPTURE_FRAMES / 2;

const VOICES = 8;

/**
 * The live half of the Song Inspector: the spectrum, an oscilloscope per channel, and the stereo
 * vectorscope with its correlation, all following the song as it plays.
 *
 * The scopes draw each voice as heard — its waveform times its volume and the main volume, on one
 * scale for all eight (`SCOPE_FULL_SCALE`) — so a quiet channel looks quiet. A channel the song does not use or the
 * mixer silences keeps its box and shows nothing in it. Holding this view open is what asks the
 * audio thread for captures (`Playback.watchVoices`).
 */
@Component({
  selector: 'amk-live-meters',
  imports: [Spectrum],
  templateUrl: './live-meters.html',
  host: { class: 'flex flex-col gap-2' },
})
export class LiveMeters {
  private readonly playback = inject(Playback);
  private readonly mixer = inject(Mixer);

  private readonly scopes = viewChild.required<ElementRef<HTMLCanvasElement>>('scopes');
  private readonly vector = viewChild.required<ElementRef<HTMLCanvasElement>>('vector');
  private readonly meter = viewChild.required<ElementRef<HTMLCanvasElement>>('meter');
  private readonly scopeSize = elementSize(this.scopes);
  private readonly vectorSize = elementSize(this.vector);
  private readonly meterSize = elementSize(this.meter);
  private readonly colors = canvasColors();
  private readonly frame = frameClock(computed(() => this.playback.isPlaying()));

  /** The correlation meter as of the last frame, `null` with nothing playing. */
  private correlationMeter: CorrelationMeter | null = null;
  private lastFrame = 0;

  private readonly used = computed(() => {
    const used = new Set(this.mixer.channels().map((channel) => channel.index));
    return Array.from({ length: VOICES }, (_, voice) => used.has(voice));
  });

  constructor() {
    const release = this.playback.watchVoices();
    inject(DestroyRef).onDestroy(release);

    // Sanctioned effect: painting the three canvases, per frame while the song plays.
    effect(() => {
      const at = this.frame();
      const playing = this.playback.isPlaying();
      const scopeSize = this.scopeSize();
      const vectorSize = this.vectorSize();
      const meterSize = this.meterSize();
      const silenced = this.mixer.silenced();
      const used = this.used();
      this.colors.version();
      untracked(() => {
        const capture = playing ? this.playback.tap.capture : null;
        this.drawScopes(capture, scopeSize.width, scopeSize.height, silenced, used);
        this.drawVector(capture, vectorSize.width, vectorSize.height);

        const elapsed =
          this.lastFrame > 0 && at > this.lastFrame ? (at - this.lastFrame) / 1000 : 0;
        this.lastFrame = capture ? at : 0;
        this.correlationMeter = capture
          ? stepCorrelation(
              this.correlationMeter,
              correlation(capture.mix, 0, CAPTURE_FRAMES),
              elapsed,
            )
          : null;
        this.drawMeter(this.correlationMeter, meterSize.width, meterSize.height);
      });
    });
  }

  private drawScopes(
    capture: VoiceCapture | null,
    width: number,
    height: number,
    silenced: number,
    used: readonly boolean[],
  ): void {
    const context = fitCanvas(this.scopes().nativeElement, width, height);
    if (!context) {
      return;
    }

    context.clearRect(0, 0, width, height);
    const columns = 4;
    const rows = 2;
    const gap = 4;
    const cellW = (width - gap * (columns - 1)) / columns;
    const cellH = (height - gap * (rows - 1)) / rows;

    context.font = '10px ui-monospace, monospace';
    context.textBaseline = 'top';

    for (let voice = 0; voice < VOICES; voice++) {
      const x = (voice % columns) * (cellW + gap);
      const y = Math.floor(voice / columns) * (cellH + gap);
      const heard = used[voice] && !(silenced & (1 << voice));

      context.fillStyle = this.colors.color('inset');
      context.fillRect(x, y, cellW, cellH);
      context.fillStyle = this.colors.color('edge');
      context.fillRect(x, y + cellH / 2, cellW, 1);

      context.fillStyle = this.colors.color(heard ? 'ink' : 'ink-muted');
      context.globalAlpha = heard ? 1 : 0.5;
      context.fillText(`#${voice}`, x + 4, y + 3);
      context.globalAlpha = 1;

      if (!capture || !heard) {
        continue;
      }

      const gain = heardGain(capture.volumes, voice) / SCOPE_FULL_SCALE;
      if (gain === 0) {
        continue;
      }

      const start = triggerFrame(capture.outx, CAPTURE_FRAMES, SCOPE_SPAN, VOICES, voice);
      context.strokeStyle = this.colors.color(`ch-${voice}`);
      context.lineWidth = 1.25;
      context.beginPath();
      const mid = y + cellH / 2;
      const half = cellH / 2 - 2;
      for (let n = 0; n < SCOPE_SPAN; n++) {
        const value = capture.outx[(start + n) * VOICES + voice] * gain;
        const px = x + (n / (SCOPE_SPAN - 1)) * cellW;
        const py = mid - Math.max(-1, Math.min(1, value)) * half;
        if (n === 0) {
          context.moveTo(px, py);
        } else {
          context.lineTo(px, py);
        }
      }

      context.stroke();
    }
  }

  private drawVector(capture: VoiceCapture | null, width: number, height: number): void {
    const context = fitCanvas(this.vector().nativeElement, width, height);
    if (!context) {
      return;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = this.colors.color('inset');
    context.fillRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) / 2 - 2;

    // The mono axis upright and the two sides at 45°, as a goniometer draws them.
    context.strokeStyle = this.colors.color('edge');
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(cx, cy - radius);
    context.lineTo(cx, cy + radius);
    context.moveTo(cx - radius * Math.SQRT1_2, cy - radius * Math.SQRT1_2);
    context.lineTo(cx + radius * Math.SQRT1_2, cy + radius * Math.SQRT1_2);
    context.moveTo(cx + radius * Math.SQRT1_2, cy - radius * Math.SQRT1_2);
    context.lineTo(cx - radius * Math.SQRT1_2, cy + radius * Math.SQRT1_2);
    context.stroke();

    if (!capture) {
      return;
    }

    context.fillStyle = this.colors.color('accent');
    context.globalAlpha = 0.6;
    for (let frame = 0; frame < CAPTURE_FRAMES; frame++) {
      const l = capture.mix[frame * 2] / 32768 / SCOPE_FULL_SCALE;
      const r = capture.mix[frame * 2 + 1] / 32768 / SCOPE_FULL_SCALE;
      const px = cx + (r - l) * Math.SQRT1_2 * radius;
      const py = cy - (l + r) * Math.SQRT1_2 * radius;
      context.fillRect(px, py, 1.5, 1.5);
    }

    context.globalAlpha = 1;
  }

  /**
   * The correlation meter: +1 at the top, 0 across the middle, -1 at the bottom, filled from 0 to
   * the eased reading in the good colour above 0 and the danger colour below, with the lowest of
   * the last two seconds held as a tick and the reading written under it.
   */
  private drawMeter(meter: CorrelationMeter | null, width: number, height: number): void {
    const context = fitCanvas(this.meter().nativeElement, width, height);
    if (!context) {
      return;
    }

    context.clearRect(0, 0, width, height);
    const readout = 14;
    const plot = height - readout;
    const barX = 18;
    const barW = width - barX;
    const yOf = (value: number): number => ((1 - Math.max(-1, Math.min(1, value))) / 2) * plot;

    context.fillStyle = this.colors.color('inset');
    context.fillRect(barX, 0, barW, plot);
    context.fillStyle = this.colors.color('edge');
    context.fillRect(barX, Math.round(yOf(0)), barW, 1);

    context.font = '10px ui-monospace, monospace';
    context.fillStyle = this.colors.color('ink-muted');
    context.textAlign = 'right';
    context.textBaseline = 'top';
    context.fillText('+1', barX - 3, 0);
    context.textBaseline = 'middle';
    context.fillText('0', barX - 3, yOf(0));
    context.textBaseline = 'bottom';
    context.fillText('-1', barX - 3, plot);

    if (!meter) {
      return;
    }

    const zero = yOf(0);
    const top = yOf(meter.value);
    context.fillStyle = this.colors.color(meter.value >= 0 ? 'good' : 'danger');
    context.fillRect(barX + 2, Math.min(zero, top), barW - 4, Math.max(1, Math.abs(top - zero)));

    context.fillStyle = this.colors.color(meter.low >= 0 ? 'ink' : 'danger');
    context.fillRect(barX, Math.round(yOf(meter.low)), barW, 2);

    context.fillStyle = this.colors.color(meter.value >= 0 ? 'ink' : 'danger');
    context.textAlign = 'center';
    context.textBaseline = 'bottom';
    const sign = meter.value > 0.005 ? '+' : '';
    context.fillText(`${sign}${meter.value.toFixed(2)}`, barX + barW / 2, height);
  }
}
