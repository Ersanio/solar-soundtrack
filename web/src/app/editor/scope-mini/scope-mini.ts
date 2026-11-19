import {
  Component,
  type ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';

import { CAPTURE_FRAMES, type VoiceCapture } from '@amk/spc/protocol';
import { canvasColors, fitCanvas } from '../../shared/chart/canvas-colors';
import { elementSize } from '../../shared/chart/element-size';
import { frameClock } from '../../shared/chart/frame-clock';
import { strokeHeardSum } from '../../shared/chart/voice-trace';
import { EditorRequests } from '../../state/editor-requests';
import { Mixer } from '../../state/mixer';
import { Playback } from '../../state/playback';

/**
 * The top bar's oscilloscope: the channels that are heard added together into one trace, beside the
 * ARAM meter as FL keeps its small meters together. A click opens Audio Visualization, which has a
 * scope per channel.
 */
@Component({
  selector: 'amk-scope-mini',
  templateUrl: './scope-mini.html',
})
export class ScopeMini {
  protected readonly requests = inject(EditorRequests);
  private readonly playback = inject(Playback);
  private readonly mixer = inject(Mixer);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly size = elementSize(this.canvas);
  private readonly shown = computed(() => this.size().width > 0);
  private readonly colors = canvasColors();
  private readonly frame = frameClock(computed(() => this.playback.isPlaying() && this.shown()));
  private readonly sum = new Float32Array(CAPTURE_FRAMES);

  /** The channels the song has and the mixer lets through, as a mask. */
  private readonly heard = computed(() => {
    const silenced = this.mixer.silenced();
    let mask = 0;
    for (const channel of this.mixer.channels()) {
      if (!(silenced & (1 << channel.index))) {
        mask |= 1 << channel.index;
      }
    }

    return mask;
  });

  constructor() {
    // Sanctioned effect: holding the audio thread's capture while the scope is on screen; the top
    // bar hides it on narrow windows, where it would cost the worklet for nothing.
    effect((onCleanup) => {
      if (this.shown()) {
        onCleanup(this.playback.watchVoices());
      }
    });

    // Sanctioned effect: painting the canvas, per frame while the song plays.
    effect(() => {
      this.frame();
      const playing = this.playback.isPlaying();
      const size = this.size();
      const heard = this.heard();
      this.colors.version();
      untracked(() => {
        const capture = playing ? this.playback.tap.capture : null;
        this.draw(capture, size.width, size.height, heard);
      });
    });
  }

  private draw(capture: VoiceCapture | null, width: number, height: number, heard: number): void {
    const context = fitCanvas(this.canvas().nativeElement, width, height);
    if (!context) {
      return;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = this.colors.color('inset');
    context.fillRect(0, 0, width, height);
    context.fillStyle = this.colors.color('edge');
    context.fillRect(0, Math.floor(height / 2), width, 1);

    if (!capture) {
      return;
    }

    context.lineWidth = 1;
    context.strokeStyle = this.colors.color('accent');
    strokeHeardSum(context, capture, heard, this.sum, 0, 0, width, height);
  }
}
