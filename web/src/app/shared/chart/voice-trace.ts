import { CAPTURE_FRAMES, type VoiceCapture } from '@amk/spc/protocol';

import { SCOPE_FULL_SCALE, heardGain, triggerFrame } from '../../state/analysis/scope';

const VOICES = 8;

/** Frames a scope shows: 16 ms, two cycles of anything from 125 Hz up. */
export const SCOPE_SPAN = CAPTURE_FRAMES / 2;

/**
 * One voice of a capture as an oscilloscope trace across a box, as heard and on the scopes' one
 * scale (`SCOPE_FULL_SCALE`), started on a rising zero crossing so a steady tone holds still.
 * A voice at volume 0 draws nothing. The caller sets the stroke.
 */
export function strokeVoiceTrace(
  context: CanvasRenderingContext2D,
  capture: VoiceCapture,
  voice: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const gain = heardGain(capture.volumes, voice) / SCOPE_FULL_SCALE;
  if (gain > 0) {
    strokeSamples(context, capture.outx, VOICES, voice, gain, x, y, width, height);
  }
}

/**
 * The voices in `mask` added together as heard, drawn as one trace on the same scale as
 * {@link strokeVoiceTrace}: the dry mix of those channels, without the echo. `scratch` holds
 * {@link CAPTURE_FRAMES} samples and is overwritten. Draws nothing when none of them is heard.
 */
export function strokeHeardSum(
  context: CanvasRenderingContext2D,
  capture: VoiceCapture,
  mask: number,
  scratch: Float32Array,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  scratch.fill(0);
  let heard = false;
  for (let voice = 0; voice < VOICES; voice++) {
    const gain = mask & (1 << voice) ? heardGain(capture.volumes, voice) / SCOPE_FULL_SCALE : 0;
    if (gain === 0) {
      continue;
    }

    heard = true;
    for (let frame = 0; frame < CAPTURE_FRAMES; frame++) {
      scratch[frame] += capture.outx[frame * VOICES + voice] * gain;
    }
  }

  if (heard) {
    strokeSamples(context, scratch, 1, 0, 1, x, y, width, height);
  }
}

function strokeSamples(
  context: CanvasRenderingContext2D,
  samples: ArrayLike<number>,
  stride: number,
  offset: number,
  gain: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const start = triggerFrame(samples, CAPTURE_FRAMES, SCOPE_SPAN, stride, offset);
  const mid = y + height / 2;
  const half = height / 2 - 1;
  context.beginPath();
  for (let n = 0; n < SCOPE_SPAN; n++) {
    const value = samples[(start + n) * stride + offset] * gain;
    const px = x + (n / (SCOPE_SPAN - 1)) * width;
    const py = mid - Math.max(-1, Math.min(1, value)) * half;
    if (n === 0) {
      context.moveTo(px, py);
    } else {
      context.lineTo(px, py);
    }
  }

  context.stroke();
}
