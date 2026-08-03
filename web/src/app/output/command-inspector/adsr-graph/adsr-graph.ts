import { Component, computed, input } from '@angular/core';

import {
  type EnvelopePoint,
  attackSeconds,
  decaySeconds,
  decodeAdsr,
  decodeGain,
  envelopeAdsr,
  envelopeGain,
  releaseSeconds,
  sustainLevel,
} from '@spc/adsr';

/**
 * Drawn in a fixed coordinate space and stretched to fit, as `fir-graph` is.
 * Stroke widths are therefore in viewBox units, not pixels.
 */
const VIEW_W = 320;
const VIEW_H = 120;

/**
 * Points kept from the stepped envelope.
 *
 * The DSP takes hundreds of steps to fall through an 11-bit envelope — a slow
 * release is over a thousand — and at 320 units wide none of that is visible.
 * Decimating keeps the DOM small on a panel that redraws as the caret moves.
 */
const MAX_POINTS = 200;

/**
 * Narrowest time window the plot will draw, in seconds.
 *
 * Without a floor, an envelope that is over in two samples — attack 15 with no
 * decay and no release — would be stretched across the whole plot and read as a
 * slow rise, which is the opposite of what it is. Ten milliseconds is short
 * enough not to squash anything real and long enough to make "instant" look it.
 */
const MIN_SPAN_SECONDS = 0.01;

/**
 * What an instrument's envelope bytes sound like, as a shape.
 *
 * Shared deliberately: the same three bytes appear in an instrument's table
 * entry and in the `$ED` command, so both views render this rather than each
 * drawing its own. It takes the raw bytes instead of a decoded envelope so the
 * two callers cannot decode them differently.
 */
@Component({
  selector: 'amk-adsr-graph',
  templateUrl: './adsr-graph.html',
  host: { class: 'block' },
})
export class AdsrGraph {
  readonly adsr1 = input.required<number>();
  readonly adsr2 = input.required<number>();
  readonly gain = input.required<number>();

  protected readonly VIEW_W = VIEW_W;
  protected readonly VIEW_H = VIEW_H;
  protected readonly VIEW_BOX = `0 0 ${VIEW_W} ${VIEW_H}`;

  private readonly envelope = computed(() => decodeAdsr(this.adsr1(), this.adsr2()));

  /** The curve, and whether it came from ADSR or GAIN. */
  private readonly points = computed<EnvelopePoint[]>(() => {
    const envelope = this.envelope();
    const raw = envelope.adsrEnabled ? envelopeAdsr(envelope) : envelopeGain(this.gain());
    if (raw.length <= MAX_POINTS) {
      return raw;
    }

    // Stride, keeping the last point so the curve still ends where it ends.
    const stride = Math.ceil(raw.length / MAX_POINTS);
    const out = raw.filter((_, i) => i % stride === 0);
    if (out[out.length - 1] !== raw[raw.length - 1]) {
      out.push(raw[raw.length - 1]);
    }

    return out;
  });

  /** Seconds the plot spans. Never zero, so the scale cannot divide by it. */
  private readonly duration = computed(() =>
    Math.max(this.points()[this.points().length - 1]?.t ?? 0, MIN_SPAN_SECONDS),
  );

  /**
   * The curve, held at its final level to the end of the window.
   *
   * An envelope that never releases stops at the sustain plateau, and a plot
   * that stopped with it would leave the rest of the window blank — as though
   * the note had ended, which is precisely the opposite of what "held
   * indefinitely" means.
   */
  private readonly drawn = computed<EnvelopePoint[]>(() => {
    const points = this.points();
    const last = points[points.length - 1];
    if (!last || last.level <= 0 || last.t >= this.duration()) {
      return points;
    }

    return [...points, { t: this.duration(), level: last.level }];
  });

  protected readonly durationLabel = computed(() => {
    const total = this.duration();
    return total >= 1 ? `${total.toFixed(2)} s` : `${(total * 1000).toFixed(0)} ms`;
  });

  protected readonly path = computed(() =>
    this.drawn()
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${this.xOf(p.t)} ${this.yOf(p.level)}`)
      .join(' '),
  );

  protected readonly sustainY = computed(() => {
    const envelope = this.envelope();
    if (!envelope.adsrEnabled) {
      return null;
    }

    return this.yOf(sustainLevel(envelope.sustain));
  });

  /** Where attack gives way to decay, and decay to the sustain fall. */
  protected readonly phaseMarks = computed(() => {
    const envelope = this.envelope();
    if (!envelope.adsrEnabled) {
      return [];
    }

    const attack = attackSeconds(envelope.attack);
    const decay = attack + decaySeconds(envelope.decay, envelope.sustain);
    return [
      { label: 'attack', x: this.xOf(attack) },
      { label: 'decay', x: this.xOf(decay) },
    ].filter((mark) => mark.x > 1 && mark.x < VIEW_W - 1);
  });

  /** What a screen reader gets instead of the picture. */
  protected readonly description = computed(() => {
    const envelope = this.envelope();
    if (!envelope.adsrEnabled) {
      const gain = decodeGain(this.gain());
      return gain.mode === 'direct'
        ? `Envelope: fixed GAIN at ${Math.round((gain.level ?? 0) * 100)} percent of full volume.`
        : `Envelope: GAIN ${gain.mode} at rate ${gain.rate}.`;
    }

    const release = releaseSeconds(envelope.release, envelope.sustain);
    return (
      `Envelope: attack ${seconds(attackSeconds(envelope.attack))}, ` +
      `decay ${seconds(decaySeconds(envelope.decay, envelope.sustain))} ` +
      `to ${Math.round(sustainLevel(envelope.sustain) * 100)} percent, ` +
      `then ${Number.isFinite(release) ? `fading over ${seconds(release)}` : 'held indefinitely'}.`
    );
  });

  private xOf(t: number): number {
    return (t / this.duration()) * VIEW_W;
  }

  /** Level to plot y, with two units of headroom so full level is not clipped. */
  private yOf(level: number): number {
    return VIEW_H - 2 - Math.min(Math.max(level, 0), 1) * (VIEW_H - 4);
  }
}

function seconds(value: number): string {
  return value >= 1 ? `${value.toFixed(2)} seconds` : `${(value * 1000).toFixed(0)} milliseconds`;
}
