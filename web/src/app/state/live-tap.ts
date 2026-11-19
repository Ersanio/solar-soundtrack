/**
 * The newest voice capture from the audio thread, held for the live meters to read at frame rate.
 *
 * Not a signal: a capture lands forty times a second and the scopes redraw at the display's own
 * rate, so they pull from here on the frame clock rather than being pushed every capture. Angular-
 * free, so nothing but the reading of it belongs to a view.
 */

import type { VoiceCapture } from '@amk/spc/protocol';

export class LiveTap {
  private latest: VoiceCapture | null = null;

  /** The newest capture, or `null` when nothing has been captured since the song last stopped. */
  get capture(): VoiceCapture | null {
    return this.latest;
  }

  receive(capture: VoiceCapture): void {
    this.latest = capture;
  }

  clear(): void {
    this.latest = null;
  }
}
