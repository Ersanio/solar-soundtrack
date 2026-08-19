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
      label: 'Sample',
      value: `noise, clock $${hex2(clock)}`,
      note: `${Math.round(noiseHz(clock)).toLocaleString()} Hz`,
    });
  } else if (srcn >= 0) {
    rows.push({ label: 'Sample', value: `$${hex2(srcn)}`, note: sampleName });
  } else {
    // The name is already on the "Defined as" row; what is missing is the
    // number, and it is missing because the compiler assigns it.
    rows.push({
      label: 'Sample',
      value: 'decided by #samples',
      note: 'its SRCN is fixed once the song compiles',
    });
  }

  const envelope = decodeAdsr(bytes[1], bytes[2]);
  if (envelope.adsrEnabled) {
    const release = releaseSeconds(envelope.release, envelope.sustain);
    rows.push({ label: 'Envelope', value: 'ADSR', note: `GAIN $${hex2(bytes[3])} is not used` });
    rows.push({ label: 'Attack', value: duration(attackSeconds(envelope.attack)) });
    rows.push({
      label: 'Decay',
      value: duration(decaySeconds(envelope.decay, envelope.sustain)),
      note: `to ${Math.round(sustainLevel(envelope.sustain) * 100)}% of full`,
    });
    rows.push({
      label: 'Release',
      value: Number.isFinite(release) ? duration(release) : 'held indefinitely',
      // AddmusicK calls this release; on the DSP it is the sustain-phase fall.
      note: envelope.release === 0 ? 'a rate of 0 never decays' : undefined,
    });
  } else {
    const gain = decodeGain(bytes[3]);
    rows.push({
      label: 'Envelope',
      value: `GAIN $${hex2(bytes[3])}`,
      note: 'ADSR is off, so bytes 1 and 2 are unused',
    });
    rows.push(
      gain.mode === 'direct'
        ? {
            label: 'Level',
            value: `${Math.round((gain.level ?? 0) * 100)}% of full`,
            note: 'fixed',
          }
        : {
            label: 'Mode',
            value: gainModeName(gain.mode),
            note:
              gain.rate === 0
                ? 'a rate of 0 never advances, so the level holds'
                : `rate $${hex2(gain.rate ?? 0)}`,
          },
    );
  }

  const multiplier = tuningMultiplier(bytes[4], bytes[5]);
  rows.push({
    label: 'Tuning',
    value: `×${multiplier.toFixed(3)}`,
    note: `$${hex2(bytes[4])}.$${hex2(bytes[5])} — ${semitones(tuningSemitones(multiplier))}`,
  });

  if (bytes.length > 6) {
    rows.push({
      label: 'Drum note',
      value: `$${hex2(bytes[6])}`,
      note: noteName(bytes[6]),
    });
  }

  if (emitted !== null && emitted < DEFAULT_TRANSPOSE.length && DEFAULT_TRANSPOSE[emitted] !== 0) {
    const t = DEFAULT_TRANSPOSE[emitted];
    rows.push({
      label: 'Transposes',
      // `parser.ts`'s `parseNote` subtracts, so a positive entry moves notes *down*.
      value: `${t > 0 ? '−' : '+'}${Math.abs(t)} semitones`,
      note: 'applied to every note written under it',
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
    return 'silent';
  }

  const rounded = value.toFixed(1);
  return `${value > 0 ? '+' : ''}${rounded} semitones`;
}

const NOTE_NAMES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];

/**
 * A note byte as it would be written in MML.
 *
 * `pitch + (octave - 1) * 12 + 0x80` (`parser.ts:getPitch`), read backwards.
 */
function noteName(byte: number): string {
  const pitch = byte & 0x7f;
  return `o${Math.floor(pitch / 12) + 1} ${NOTE_NAMES[pitch % 12]}`;
}
