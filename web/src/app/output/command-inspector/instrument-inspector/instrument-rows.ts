import { DEFAULT_TRANSPOSE } from '@amk/core/hardcoded-tables';
import {
  attackSeconds,
  decaySeconds,
  decodeAdsr,
  decodeGain,
  gainModeName,
  noiseHz,
  releaseSeconds,
  sustainLevel,
  tuningMultiplier,
  tuningSemitones,
} from '@amk/spc/adsr';
import { NOISE_FLAG } from '@amk/spc/instruments';
import { noteName } from '@amk/tokens/commands/units';
import { duration, hex2 } from '../../../util/format';

/**
 * A table entry's six or seven bytes, said in the units they mean.
 *
 * Free functions rather than a computed on the panel: reading an entry is
 * arithmetic over `@amk/spc/adsr` and one hardcoded table, and none of it
 * depends on which command the caret is on. The panel works out *which* entry is
 * being looked at, which is the part that needs the stores.
 */

/** One "what this argument means" line. */
export interface DetailRow {
  label: string;
  value: string;
  /** A sentence under the value, in prose rather than mono. Optional. */
  note?: string;
}

export interface DetailInputs {
  /** The entry's bytes: six, or seven for a drum. */
  bytes: readonly number[];
  /**
   * The sample byte, or `-1` when it cannot be stated.
   *
   * A custom instrument written as `"kick.brr"` has its SRCN decided by the
   * resolved `#samples` list, which the scanner does not build — so the byte is
   * genuinely unknown rather than zero.
   */
  srcn: number;
  /** What that SRCN names, when it can be stated. */
  sampleName: string | undefined;
  /** The instrument the driver actually loads, for the default-transpose table. */
  emitted: number | null;
}

export function detailRows(input: DetailInputs): DetailRow[] {
  const { bytes, srcn, sampleName, emitted } = input;
  const rows: DetailRow[] = [];

  if (srcn >= 0 && (srcn & NOISE_FLAG) !== 0) {
    const clock = srcn & 0x1f;
    rows.push({
      label: $localize`:@@inspector.instrument.sample:inspector.instrument.sample`,
      value: `noise, clock $${hex2(clock)}`,
      note: `${Math.round(noiseHz(clock)).toLocaleString()} Hz`,
    });
  } else if (srcn >= 0) {
    rows.push({
      label: $localize`:@@inspector.instrument.sample:inspector.instrument.sample`,
      value: `$${hex2(srcn)}`,
      note: sampleName,
    });
  } else {
    // The name is already on the "Defined as" row; what is missing is the
    // number, and it is missing because the compiler assigns it.
    rows.push({
      label: $localize`:@@inspector.instrument.sample:inspector.instrument.sample`,
      value: 'decided by #samples',
      note: $localize`:@@inspector.instrument.its-srcn-is-fixed-once:inspector.instrument.its-srcn-is-fixed-once`,
    });
  }

  const envelope = decodeAdsr(bytes[1], bytes[2]);
  if (envelope.adsrEnabled) {
    const release = releaseSeconds(envelope.release, envelope.sustain);
    rows.push({
      label: $localize`:@@inspector.instrument.envelope:inspector.instrument.envelope`,
      value: 'ADSR',
      note: $localize`:@@inspector.instrument.gain-is-not-used:inspector.instrument.gain-is-not-used ${hex2(bytes[3])}:byte:`,
    });
    rows.push({
      label: $localize`:@@inspector.instrument.attack:inspector.instrument.attack`,
      value: duration(attackSeconds(envelope.attack)),
    });
    rows.push({
      label: $localize`:@@inspector.instrument.decay:inspector.instrument.decay`,
      value: duration(decaySeconds(envelope.decay, envelope.sustain)),
      note: $localize`:@@inspector.instrument.to-of-full:inspector.instrument.to-of-full ${Math.round(sustainLevel(envelope.sustain) * 100)}:amount:`,
    });
    rows.push({
      label: $localize`:@@inspector.instrument.release:inspector.instrument.release`,
      value: Number.isFinite(release)
        ? duration(release)
        : $localize`:@@inspector.instrument.held-indefinitely:inspector.instrument.held-indefinitely`,
      // AddmusicK calls this release; on the DSP it is the sustain-phase fall.
      note:
        envelope.release === 0
          ? $localize`:@@inspector.instrument.a-rate-of-0-never:inspector.instrument.a-rate-of-0-never`
          : undefined,
    });
  } else {
    const gain = decodeGain(bytes[3]);
    rows.push({
      label: $localize`:@@inspector.instrument.envelope:inspector.instrument.envelope`,
      value: `GAIN $${hex2(bytes[3])}`,
      note: $localize`:@@inspector.instrument.adsr-is-off-so-bytes:inspector.instrument.adsr-is-off-so-bytes`,
    });
    rows.push(
      gain.mode === 'direct'
        ? {
            label: $localize`:@@inspector.instrument.level:inspector.instrument.level`,
            value: `${Math.round((gain.level ?? 0) * 100)}% of full`,
            note: $localize`:@@inspector.instrument.fixed:inspector.instrument.fixed`,
          }
        : {
            label: $localize`:@@inspector.instrument.mode:inspector.instrument.mode`,
            value: gainModeName(gain.mode),
            note:
              gain.rate === 0
                ? $localize`:@@inspector.instrument.a-rate-of-0-never-2:inspector.instrument.a-rate-of-0-never-2`
                : $localize`:@@inspector.instrument.rate:inspector.instrument.rate ${hex2(gain.rate ?? 0)}:byte:`,
          },
    );
  }

  const multiplier = tuningMultiplier(bytes[4], bytes[5]);
  rows.push({
    label: $localize`:@@inspector.instrument.tuning:inspector.instrument.tuning`,
    value: `×${multiplier.toFixed(3)}`,
    note: `$${hex2(bytes[4])}.$${hex2(bytes[5])} — ${semitones(tuningSemitones(multiplier))}`,
  });

  if (bytes.length > 6) {
    rows.push({
      label: $localize`:@@inspector.instrument.drum-note:inspector.instrument.drum-note`,
      value: `$${hex2(bytes[6])}`,
      note: noteName(bytes[6]),
    });
  }

  if (emitted !== null && emitted < DEFAULT_TRANSPOSE.length && DEFAULT_TRANSPOSE[emitted] !== 0) {
    const t = DEFAULT_TRANSPOSE[emitted];
    rows.push({
      label: $localize`:@@inspector.instrument.transposes:inspector.instrument.transposes`,
      // `parser.ts`'s `parseNote` subtracts, so a positive entry moves notes *down*.
      value: `${t > 0 ? '−' : '+'}${Math.abs(t)} semitones`,
      note: $localize`:@@inspector.instrument.applied-to-every-note-written:inspector.instrument.applied-to-every-note-written`,
    });
  }

  return rows;
}

/** The sample byte a written `#instruments` entry implies, or `-1` for a named file. */
export function sampleByte(sample: { form: string; srcn?: number; byte?: number }): number {
  if (sample.form === 'copy') {
    return sample.srcn ?? 0;
  }

  if (sample.form === 'noise') {
    return sample.byte ?? 0;
  }

  // A named file's SRCN is decided by the resolved `#samples` list, which the
  // scanner cannot know; the panel shows the name instead.
  return -1;
}

function semitones(value: number): string {
  if (!Number.isFinite(value)) {
    return $localize`:@@inspector.instrument.silent:inspector.instrument.silent`;
  }

  const rounded = value.toFixed(1);
  return $localize`:@@inspector.instrument.semitones:inspector.instrument.semitones ${value > 0 ? '+' : ''}:sign: ${rounded}:rounded:`;
}
