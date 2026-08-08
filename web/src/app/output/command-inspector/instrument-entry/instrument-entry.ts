import { Component, computed, inject, input } from '@angular/core';

import { spliceInstrumentBytes, spliceInstrumentSample } from '@amk/tokens/edits';
import { INSTRUMENT_TO_SAMPLE } from '@amk/core/tables';
import type { InstrumentDefinition } from '@amk/tokens';
import { encodeTuning, noiseHz, tuningMultiplier, tuningSemitones } from '@amk/spc/adsr';
import { type EnumOption, EnumSelect } from '../../../shared/enum-select/enum-select';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { SampleStore } from '../../../state/sample-store';
import { hex2 } from '../../../util/format';
import { sampleOptions } from '../commands/context';
import { dragPreview } from '../commands/preview';
import { type EnvelopeValue, EnvelopeTuner } from '../envelope-tuner/envelope-tuner';

/** The three things an entry's sample byte can be (`parser.ts:1224-1341`). */
const SAMPLE_FORMS: readonly EnumOption[] = [
  { value: 0, label: 'a .brr file' },
  { value: 1, label: "a stock instrument's sample (@n)" },
  { value: 2, label: 'noise (nXX)' },
];

/**
 * One `#instruments` entry, editable.
 *
 * An entry is a sample and five bytes — ADSR1, ADSR2, GAIN, tuning, subtuning —
 * and until now the panel could only read them out. The five are the same three
 * envelope bytes `$ED` writes plus an 8.8 pitch multiplier, so the envelope goes
 * through the same tuner and the multiplier gets a slider that says what it does
 * in semitones.
 *
 * Every control splices its own token, so changing what a drum is sampled from
 * does not reset an envelope somebody tuned, and vice versa.
 */
@Component({
  selector: 'amk-instrument-entry',
  imports: [EnumSelect, EnvelopeTuner, Slider],
  templateUrl: './instrument-entry.html',
  host: { class: 'flex flex-col gap-3' },
})
export class InstrumentEntryEditor {
  private readonly store = inject(EditorStore);
  private readonly library = inject(SampleStore);

  readonly entry = input.required<InstrumentDefinition>();

  protected readonly SAMPLE_FORMS = SAMPLE_FORMS;

  protected readonly bytes = computed(() => this.entry().bytes.map((b) => b.value));

  protected readonly form = computed(() => {
    switch (this.entry().sample.form) {
      case 'file':
        return 0;
      case 'copy':
        return 1;
      case 'noise':
        return 2;
    }
  });

  /** The names this song could name — its own `#samples` list, or the library's. */
  protected readonly sampleOptions = computed<EnumOption[]>(() =>
    sampleOptions(this.store, this.library),
  );

  protected readonly currentSampleIndex = computed(() => {
    const sample = this.entry().sample;
    if (sample.form !== 'file') {
      return -1;
    }

    return this.sampleOptions().findIndex((option) => option.label === sample.name);
  });

  protected readonly sampleName = computed(() => {
    const sample = this.entry().sample;
    return sample.form === 'file' ? sample.name : '';
  });

  /**
   * What the picker calls a name the song does not list.
   *
   * An entry may name a `.brr` that no `#samples` block loads — that is an
   * AMK0104 at compile time, and hiding it here would make the control show a
   * file the source does not name.
   */
  protected readonly unknownSampleLabel = computed(
    () => `"${this.sampleName()}" — not in this song’s #samples`,
  );

  /**
   * What the sliders are showing, dropped the moment the entry is re-scanned.
   *
   * Keyed by field rather than by byte index, because two of the three are not
   * bytes of the entry at all — the sample form is written before them, and the
   * tuning slider spans a pair. The sliders themselves bind to the committed
   * values below; only the readouts read these, since `amk-slider` compares a
   * gesture against the value bound to it and a preview fed back in never
   * commits.
   */
  private readonly drag = dragPreview(this.entry);

  protected preview(field: 'copy' | 'noise' | 'tuning', value: number): void {
    this.drag.set(field, value);
  }

  protected readonly copyFrom = computed(() => {
    const sample = this.entry().sample;
    return sample.form === 'copy' ? sample.instrument : 0;
  });

  protected readonly noiseClock = computed(() => {
    const sample = this.entry().sample;
    return sample.form === 'noise' ? sample.clock : 0;
  });

  private readonly shownCopyFrom = computed(() => this.drag.at('copy', this.copyFrom()));
  private readonly shownNoiseClock = computed(() => this.drag.at('noise', this.noiseClock()));

  protected readonly noiseLabel = computed(() => {
    const clock = this.shownNoiseClock();
    return clock === 0 ? 'silent' : `${Math.round(noiseHz(clock)).toLocaleString()} Hz`;
  });

  /** `@n` as the slider is showing it, so the label keeps up with the thumb. */
  protected readonly copyLabel = computed(() => `@${this.shownCopyFrom()}`);

  protected readonly copyNote = computed(() => {
    if (this.entry().sample.form !== 'copy') {
      return null;
    }

    // `parser.ts:1147` — a custom instrument cannot be based on another, so the
    // number is a stock one and its SRCN is fixed by AddmusicK's own table. The
    // scanner's own `srcn` is that same lookup, redone here because the dragged
    // number has not been scanned yet.
    const srcn = INSTRUMENT_TO_SAMPLE[this.shownCopyFrom()] ?? -1;
    return `takes @${this.shownCopyFrom()}'s sample, $${hex2(srcn)}`;
  });

  // --- envelope --------------------------------------------------------------

  protected readonly hasEnvelope = computed(() => this.bytes().length >= 3);

  protected readonly envelope = computed<EnvelopeValue>(() => {
    const [adsr1 = 0, adsr2 = 0, gain = 0] = this.bytes();
    return { adsr1, adsr2, gain };
  });

  /** Whether any of the three envelope bytes came through a macro. */
  protected readonly envelopeLocked = computed(() =>
    this.entry()
      .bytes.slice(0, 3)
      .some((byte) => byte.replacement !== undefined),
  );

  // --- tuning ----------------------------------------------------------------

  protected readonly hasTuning = computed(() => this.bytes().length >= 5);

  private readonly multiplier = computed(() => {
    const [, , , tuning = 0, sub = 0] = this.bytes();
    return tuningMultiplier(tuning, sub);
  });

  /**
   * The slider runs over the 8.8 pair as one 16-bit number, so every value the
   * two bytes can express is one step apart and none is unreachable.
   */
  protected readonly tuningRaw = computed(() => Math.round(this.multiplier() * 256));

  /**
   * The same 16-bit number as the slider is showing it, and the two bytes it
   * would be written as — so the `$04.$00` form follows the drag as well as the
   * multiplier does. Re-encoded through {@link encodeTuning}, which is the
   * function the commit path uses, so the readout cannot promise a pair the
   * write would not produce.
   */
  private readonly shownTuning = computed(() => {
    const raw = this.drag.at('tuning', this.tuningRaw());
    return { raw, multiplier: raw / 256, ...encodeTuning(raw / 256) };
  });

  protected readonly tuningLabel = computed(() => `×${this.shownTuning().multiplier.toFixed(3)}`);

  protected readonly tuningNote = computed(() => {
    const { multiplier, tuning, subTuning } = this.shownTuning();
    const semitones = tuningSemitones(multiplier);
    const said = Number.isFinite(semitones)
      ? `${semitones > 0 ? '+' : ''}${semitones.toFixed(1)} semitones`
      : 'silent';
    return `$${hex2(tuning)}.$${hex2(subTuning)} — ${said}`;
  });

  protected readonly tuningLocked = computed(() =>
    this.entry()
      .bytes.slice(3, 5)
      .some((byte) => byte.replacement !== undefined),
  );

  // --- editing ---------------------------------------------------------------

  protected setForm(form: number): void {
    if (form === this.form()) {
      return;
    }

    // A sensible default per form rather than the old one reinterpreted: a SRCN
    // read as a noise clock is a different sound, not a converted one.
    const text =
      form === 0
        ? `"${this.sampleOptions()[0]?.label ?? 'sample.brr'}"`
        : form === 1
          ? '@0'
          : 'n1F';
    this.write(spliceInstrumentSample(this.store.source(), this.entry(), text));
  }

  protected setSample(index: number): void {
    const name = this.sampleOptions()[index]?.label;
    if (name !== undefined) {
      this.write(spliceInstrumentSample(this.store.source(), this.entry(), `"${name}"`));
    }
  }

  protected setCopy(instrument: number): void {
    this.write(spliceInstrumentSample(this.store.source(), this.entry(), `@${instrument}`));
  }

  protected setNoise(clock: number): void {
    this.write(
      spliceInstrumentSample(
        this.store.source(),
        this.entry(),
        `n${clock.toString(16).toUpperCase().padStart(2, '0')}`,
      ),
    );
  }

  protected applyEnvelope(next: EnvelopeValue): void {
    this.write(
      spliceInstrumentBytes(this.store.source(), this.entry(), [
        `$${hex2(next.adsr1)}`,
        `$${hex2(next.adsr2)}`,
        `$${hex2(next.gain)}`,
      ]),
    );
  }

  protected setTuning(raw: number): void {
    const { tuning, subTuning } = encodeTuning(raw / 256);
    this.write(
      spliceInstrumentBytes(this.store.source(), this.entry(), [
        null,
        null,
        null,
        `$${hex2(tuning)}`,
        `$${hex2(subTuning)}`,
      ]),
    );
  }

  private write(edit: Parameters<EditorStore['apply']>[0]): void {
    this.store.apply(edit);
  }
}
