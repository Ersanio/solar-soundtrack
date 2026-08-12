import { Component, computed, input, output } from '@angular/core';

import {
  type GainMode,
  attackSeconds,
  decaySeconds,
  decodeAdsr,
  decodeGain,
  encodeAdsr,
  encodeGain,
  releaseSeconds,
  sustainLevel,
} from '@amk/spc/adsr';
import { Button } from '../../../shared/button/button';
import { type EnumOption, EnumSelect } from '../../../shared/enum-select/enum-select';
import { Slider } from '../../../shared/slider/slider';
import { duration, hex2 } from '../../../util/format';
import { AdsrGraph } from '../adsr-graph/adsr-graph';
import { dragPreview } from '../commands/preview';

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

/** One named starting point. */
export interface AdsrPreset {
  name: string;
  adsr1: number;
  adsr2: number;
  /** The shape in words, for the button's tooltip. */
  note: string;
}

/**
 * Six envelopes worth starting from.
 *
 * Chosen by working backwards from `attackSeconds`/`decaySeconds`/
 * `releaseSeconds` rather than by picking bytes that looked plausible, and
 * spread across the ladders so no two are a nudge apart: instant-attack short
 * decay against slow-attack long release, sustain at full against sustain at an
 * eighth. `adsrtest` pins the two extremes, so a change to the envelope maths
 * that moved these out of their stated times fails rather than quietly
 * relabelling the buttons.
 */
const PRESETS: readonly AdsrPreset[] = [
  { name: 'Pluck', adsr1: 0xdf, adsr2: 0x31, note: 'instant attack, 59 ms to a quarter level' },
  { name: 'Piano', adsr1: 0xbf, adsr2: 0x4d, note: 'instant attack, 114 ms decay, long tail' },
  { name: 'Pad', adsr1: 0x86, adsr2: 0xe9, note: '256 ms swell, holds, ~7 s release' },
  { name: 'Organ', adsr1: 0x8f, adsr2: 0xf3, note: 'instant on, holds, ~0.7 s release' },
  { name: 'Strings', adsr1: 0x99, adsr2: 0xcc, note: '64 ms swell, sustains near full' },
  { name: 'Percussive', adsr1: 0xff, adsr2: 0x14, note: 'instant attack, gone in ~200 ms' },
];

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
  protected readonly PRESETS = PRESETS;

  /** Which preset the bytes currently are, so the active one can be marked. */
  protected readonly activePreset = computed(() => {
    const { adsr1, adsr2 } = this.value();
    return PRESETS.find((p) => p.adsr1 === adsr1 && p.adsr2 === adsr2) ?? null;
  });

  /** Applying one always turns ADSR on — its bytes have the top bit set. */
  protected applyPreset(preset: AdsrPreset): void {
    this.commit.emit({ ...this.value(), adsr1: preset.adsr1, adsr2: preset.adsr2 });
  }

  /**
   * Values a slider is showing mid-drag, dropped once the commit lands.
   *
   * The sliders bind to {@link envelope} and {@link gain} — the *document* — and
   * the graph and the time readouts bind to {@link shown} and {@link shownGain}.
   * That split is not cosmetic: `amk-slider` decides whether a gesture changed
   * anything by comparing against the value bound to it, so binding the preview
   * back into it would make every drag look like a no-op and nothing would ever
   * be written.
   */
  private readonly drag = dragPreview(this.value);

  /** What the document says. The sliders' positions come from here. */
  protected readonly envelope = computed(() => decodeAdsr(this.value().adsr1, this.value().adsr2));
  protected readonly usingAdsr = computed(() => this.envelope().adsrEnabled);
  protected readonly gain = computed(() => decodeGain(this.value().gain));

  /** What the controls are showing, which mid-drag is not the same thing. */
  protected readonly shown = computed(() => {
    const committed = this.envelope();
    return {
      ...committed,
      attack: this.drag.at('attack', committed.attack),
      decay: this.drag.at('decay', committed.decay),
      sustain: this.drag.at('sustain', committed.sustain),
      release: this.drag.at('release', committed.release),
    };
  });

  protected readonly shownGain = computed(() => {
    const committed = this.gain();
    if (committed.mode === 'direct') {
      const level = this.drag.at('level', Math.round((committed.level ?? 0) * 0x7f));
      return { ...committed, level: level / 0x7f };
    }

    return { ...committed, rate: this.drag.at('rate', committed.rate ?? 0) };
  });

  protected preview(field: string, value: number): void {
    this.drag.set(field, value);
  }

  // --- ADSR readouts ---------------------------------------------------------

  protected readonly attackLabel = computed(() => duration(attackSeconds(this.shown().attack)));

  protected readonly decayLabel = computed(() => {
    const { decay, sustain } = this.shown();
    return sustain >= 7
      ? 'instant — sustain is already at full level'
      : duration(decaySeconds(decay, sustain));
  });

  protected readonly sustainLabel = computed(
    () => `${Math.round(sustainLevel(this.shown().sustain) * 100)}% of full`,
  );

  protected readonly releaseLabel = computed(() => {
    const { release, sustain } = this.shown();
    const seconds = releaseSeconds(release, sustain);
    return Number.isFinite(seconds) ? duration(seconds) : 'held indefinitely';
  });

  /** AddmusicK calls this release; on the DSP it is the sustain-phase fall. */
  protected readonly releaseNote = computed(() =>
    this.shown().release === 0 ? 'a rate of 0 never decays, so the note holds' : null,
  );

  // --- GAIN readouts ---------------------------------------------------------

  protected readonly gainModeIndex = computed(() => {
    const mode = this.gain().mode;
    return mode === 'direct' ? 0 : RAMP_MODES.indexOf(mode) + 1;
  });

  protected readonly gainIsDirect = computed(() => this.gain().mode === 'direct');

  /** The slider's position: the document's level. */
  protected readonly gainLevel = computed(() => Math.round((this.gain().level ?? 0) * 0x7f));

  protected readonly gainLevelLabel = computed(
    () => `${Math.round((this.shownGain().level ?? 0) * 100)}% of full`,
  );

  protected readonly gainRateLabel = computed(() => {
    const rate = this.shownGain().rate ?? 0;
    return rate === 0 ? 'a rate of 0 never advances, so the level holds' : `rate $${hex2(rate)}`;
  });

  protected readonly gainByteLabel = computed(() => `$${hex2(this.value().gain)}`);

  /**
   * What the graph should draw: the GAIN path takes over when ADSR1's top bit is
   * clear.
   *
   * Re-encoded from {@link envelope} and {@link gain} rather than read off the
   * input, which is what lets the curve follow a drag — those two are where the
   * previewed values live.
   */
  private readonly encoded = computed(() => encodeAdsr(this.shown()));

  protected readonly graphAdsr1 = computed(() => (this.usingAdsr() ? this.encoded().adsr1 : 0));
  protected readonly graphAdsr2 = computed(() => (this.usingAdsr() ? this.encoded().adsr2 : 0));
  protected readonly graphGain = computed(() =>
    this.usingAdsr() ? 0 : encodeGain(this.shownGain()),
  );

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
}
