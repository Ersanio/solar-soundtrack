import { Component, computed, input, output } from '@angular/core';

import {
  type GainMode,
  attackSeconds,
  decaySeconds,
  decodeAdsr,
  decodeGain,
  encodeAdsr,
  encodeGain,
  gainModeName,
  releaseSeconds,
  sustainLevel,
} from '@spc/adsr';
import { Button } from '../../../shared/button/button';
import { type EnumOption, EnumSelect } from '../../../shared/enum-select/enum-select';
import { Slider } from '../../../shared/slider/slider';
import { duration, hex2 } from '../../../util/format';
import { AdsrGraph } from '../adsr-graph/adsr-graph';

/** The three bytes an envelope is written as, wherever it is written. */
export interface EnvelopeValue {
  /** ADSR1, its top bit included — that bit is what chooses between the two modes. */
  adsr1: number;
  adsr2: number;
  gain: number;
}

const GAIN_MODES: readonly EnumOption[] = [
  { value: 0, label: 'fixed level' },
  { value: 1, label: 'linear decrease' },
  { value: 2, label: 'exponential decrease' },
  { value: 3, label: 'linear increase' },
  { value: 4, label: 'bent increase' },
];

/** `decodeGain`'s modes in the order the two high bits of a ramping GAIN byte pick them. */
const RAMP_MODES: readonly GainMode[] = [
  'linearDecrease',
  'expDecrease',
  'linearIncrease',
  'bentIncrease',
];

/**
 * Where switching to ADSR lands when there is no envelope to switch back to.
 *
 * `$FF $E0` is the stock instrument table's most common pair — fastest attack
 * and decay, sustain at full, and a release of 0 that holds the note. Being what
 * most of SMW's own instruments use makes it the least surprising default.
 */
const DEFAULT_ADSR1 = 0xff;
const DEFAULT_ADSR2 = 0xe0;

/**
 * The envelope, tuned in the units it is heard in.
 *
 * One component for both places an envelope is written — `$ED` on a channel and
 * the three bytes inside an `#instruments` entry — because they are the same
 * three bytes and a reader moving between them should not have to learn two
 * panels. The caller maps {@link EnvelopeValue} onto whatever its own syntax is.
 *
 * Each slider is over the *rate index*, which is what the byte holds, and is
 * labelled with the time that rate produces. The rate ladder is geometric, so a
 * slider in seconds would spend most of its travel in the last few milliseconds;
 * this way every legal value is one step apart and the label says what you get.
 */
@Component({
  selector: 'amk-envelope-tuner',
  imports: [AdsrGraph, Button, EnumSelect, Slider],
  templateUrl: './envelope-tuner.html',
  host: { class: 'flex flex-col gap-3' },
})
export class EnvelopeTuner {
  readonly value = input.required<EnvelopeValue>();
  readonly disabled = input(false);
  /** Why editing is off, shown in place of the controls. */
  readonly lockedBecause = input<string | null>(null);

  readonly commit = output<EnvelopeValue>();

  protected readonly GAIN_MODES = GAIN_MODES;

  protected readonly envelope = computed(() => decodeAdsr(this.value().adsr1, this.value().adsr2));
  protected readonly usingAdsr = computed(() => this.envelope().adsrEnabled);
  protected readonly gain = computed(() => decodeGain(this.value().gain));

  // --- ADSR readouts ---------------------------------------------------------

  protected readonly attackLabel = computed(() => duration(attackSeconds(this.envelope().attack)));

  protected readonly decayLabel = computed(() => {
    const { decay, sustain } = this.envelope();
    return sustain >= 7
      ? 'instant — sustain is already at full level'
      : duration(decaySeconds(decay, sustain));
  });

  protected readonly sustainLabel = computed(
    () => `${Math.round(sustainLevel(this.envelope().sustain) * 100)}% of full`,
  );

  protected readonly releaseLabel = computed(() => {
    const { release, sustain } = this.envelope();
    const seconds = releaseSeconds(release, sustain);
    return Number.isFinite(seconds) ? duration(seconds) : 'held indefinitely';
  });

  /** AddmusicK calls this release; on the DSP it is the sustain-phase fall. */
  protected readonly releaseNote = computed(() =>
    this.envelope().release === 0 ? 'a rate of 0 never decays, so the note holds' : null,
  );

  // --- GAIN readouts ---------------------------------------------------------

  protected readonly gainModeIndex = computed(() => {
    const mode = this.gain().mode;
    return mode === 'direct' ? 0 : RAMP_MODES.indexOf(mode) + 1;
  });

  protected readonly gainIsDirect = computed(() => this.gain().mode === 'direct');
  protected readonly gainLevel = computed(() => Math.round((this.gain().level ?? 0) * 0x7f));

  protected readonly gainLevelLabel = computed(
    () => `${Math.round((this.gain().level ?? 0) * 100)}% of full`,
  );

  protected readonly gainRateLabel = computed(() => {
    const rate = this.gain().rate ?? 0;
    return rate === 0 ? 'a rate of 0 never advances, so the level holds' : `rate $${hex2(rate)}`;
  });

  protected readonly gainByteLabel = computed(() => `$${hex2(this.value().gain)}`);

  /** What the graph should draw: the GAIN path takes over when ADSR1's top bit is clear. */
  protected readonly graphAdsr1 = computed(() => (this.usingAdsr() ? this.value().adsr1 : 0));
  protected readonly graphAdsr2 = computed(() => (this.usingAdsr() ? this.value().adsr2 : 0));
  protected readonly graphGain = computed(() => (this.usingAdsr() ? 0 : this.value().gain));

  // --- editing ---------------------------------------------------------------

  /** Switches which of the two the DSP obeys, leaving both sets of bytes intact. */
  protected setMode(adsr: boolean): void {
    if (adsr === this.usingAdsr()) {
      return;
    }

    if (!adsr) {
      this.commit.emit({ ...this.value(), adsr1: this.value().adsr1 & 0x7f });
      return;
    }

    // Turning ADSR on over bytes that hold nothing would land on `$00 $00` —
    // an instant attack and a release of 0, which never decays. That is nobody's
    // starting point, so an all-zero pair becomes the stock table's own most
    // common setting instead. A pair that already says something is kept.
    const blank = (this.value().adsr1 & 0x7f) === 0 && this.value().adsr2 === 0;
    this.commit.emit(
      blank
        ? { ...this.value(), adsr1: DEFAULT_ADSR1, adsr2: DEFAULT_ADSR2 }
        : { ...this.value(), adsr1: this.value().adsr1 | 0x80 },
    );
  }

  protected setField(field: 'attack' | 'decay' | 'sustain' | 'release', value: number): void {
    const next = { ...this.envelope(), [field]: value };
    const { adsr1, adsr2 } = encodeAdsr(next);
    this.commit.emit({ ...this.value(), adsr1, adsr2 });
  }

  protected setGainMode(index: number): void {
    // Carry the rate across a mode change: someone auditioning the four ramps
    // wants to hear the same speed in each, not have it reset to zero.
    const gain =
      index === 0
        ? encodeGain({ mode: 'direct', level: this.gain().level ?? 1, rate: null })
        : encodeGain({ mode: RAMP_MODES[index - 1], level: null, rate: this.gain().rate ?? 0 });

    this.commit.emit({ ...this.value(), gain });
  }

  protected setGainLevel(level: number): void {
    this.commit.emit({
      ...this.value(),
      gain: encodeGain({ mode: 'direct', level: level / 0x7f, rate: null }),
    });
  }

  protected setGainRate(rate: number): void {
    const mode = this.gain().mode;
    if (mode === 'direct') {
      return;
    }

    this.commit.emit({ ...this.value(), gain: encodeGain({ mode, level: null, rate }) });
  }

  protected gainModeText(): string {
    return gainModeName(this.gain().mode);
  }
}
