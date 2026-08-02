import { Component, computed, inject, input } from '@angular/core';

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
} from '@spc/adsr';
import {
  FIRST_CUSTOM_INSTRUMENT,
  FIRST_PERCUSSION_INSTRUMENT,
  type InstrumentEntry,
  MELODIC_SLOTS,
  NOISE_FLAG,
} from '@spc/instruments';
import type { Command } from '@compiler/tokens';
import { DEFAULT_TRANSPOSE, INSTRUMENT_TO_SAMPLE } from '@compiler/tables';
import { DriverStore } from '../../../state/driver-store';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { AdsrGraph } from '../adsr-graph/adsr-graph';
import { HexPipe } from '../../../util/hex.pipe';

/** Which of the things `@n` — or a raw `$DA` — can mean. */
type Band = 'melodic' | 'unsupported' | 'percussion' | 'custom' | 'undefined' | 'beyond';

interface Row {
  label: string;
  value: string;
  note?: string;
}

/**
 * What `@n` selects — which is a table entry, not a sample.
 *
 * The number bands are AddmusicK's, and they are not contiguous: `@0`-`@18` set
 * an instrument, `@19` and `@20` do nothing audible at all, `@21`-`@29` arm a
 * drum on the next note without emitting anything, and `@30` up are the song's
 * own. `parser.ts:1594` is the one line that splits them.
 */
@Component({
  selector: 'amk-instrument-inspector',
  imports: [AdsrGraph, HexPipe],
  templateUrl: './instrument-inspector.html',
  host: { class: 'block' },
})
export class InstrumentInspector {
  private readonly store = inject(EditorStore);
  private readonly drivers = inject(DriverStore);

  readonly command = input.required<Command>();

  /** The number written, before AddmusicK does anything to it. */
  protected readonly written = computed(() => {
    const args = this.command().args;
    return args.length > 0 ? args[0].value : -1;
  });

  protected readonly direct = computed(() => this.command().direct === true);

  /** Written as `$DA $xx` rather than `@n`, which skips every rule below. */
  protected readonly raw = computed(() => this.command().vcmd === 0xda);

  /**
   * The number that reaches `$DA`, or `null` when nothing is emitted.
   *
   * `parser.ts:1597` remaps the direct form's 19-29 to custom instruments, and
   * it does so unconditionally — AddmusicK guards it with `convert`, which is on
   * unless its CLI is given `-c`. So `@@19` is `@30`, not driver entry 19.
   *
   * A hand-written `$DA` goes through none of this: the byte is the byte, which
   * is what makes it the only way to reach table entry 19.
   */
  protected readonly emitted = computed<number | null>(() => {
    const n = this.written();
    if (n < 0) return null;
    if (this.raw()) return n;
    if (n <= 18 || this.direct() || n >= FIRST_CUSTOM_INSTRUMENT) {
      return n >= 0x13 && n < FIRST_CUSTOM_INSTRUMENT ? n - 0x13 + FIRST_CUSTOM_INSTRUMENT : n;
    }
    return null;
  });

  /**
   * The `#instruments` entry the caret is sitting *inside*, if any.
   *
   * A definition and a use both look like `@5`, and the panel would otherwise
   * describe the sample-copy inside a block as though it changed the instrument.
   */
  protected readonly definingEntry = computed(() => {
    const at = this.command().span.start;
    return (
      this.store.tokens().instruments.find((d) => at >= d.span.start && at < d.span.end) ?? null
    );
  });

  /** The sample form of the entry the caret is defining, said in words. */
  protected readonly definitionSample = computed(() => {
    const sample = this.definingEntry()?.sample;
    if (!sample) return '';
    if (sample.form === 'file') return `"${sample.name}"`;
    if (sample.form === 'copy') {
      return `@${sample.instrument}'s sample, $${hex2(sample.srcn)}`;
    }
    return `noise at clock $${hex2(sample.clock)} — ${Math.round(noiseHz(sample.clock)).toLocaleString()} Hz`;
  });

  protected readonly definitionBytes = computed(
    () => this.definingEntry()?.bytes.map(hex2).join(' ') ?? '',
  );

  protected readonly band = computed<Band>(() => {
    const n = this.emitted();
    if (n === null) {
      const written = this.written();
      return written >= FIRST_PERCUSSION_INSTRUMENT ? 'percussion' : 'unsupported';
    }
    if (n < MELODIC_SLOTS) return 'melodic';
    // Only a raw `$DA` can land here: 20-29 is past the table, and where it
    // reads is a property of the driver's indexing code, which is not in the
    // AddmusicK sources this port was written against.
    if (n < FIRST_CUSTOM_INSTRUMENT) return 'beyond';
    return this.custom() ? 'custom' : 'undefined';
  });

  private readonly custom = computed(() => {
    const n = this.emitted();
    if (n === null || n < FIRST_CUSTOM_INSTRUMENT) return null;
    return this.store.tokens().instruments.find((entry) => entry.number === n) ?? null;
  });

  /** How many entries the song's `#instruments` blocks define. */
  protected readonly customCount = computed(() => this.store.tokens().instruments.length);

  /**
   * Which `#instruments` entry `@n` is, counting from 1 — `@30` is the first.
   * Null outside the custom band, which is the only place the template uses it.
   */
  protected readonly customEntry = computed(() => {
    const n = this.emitted();
    return n === null ? null : n - FIRST_CUSTOM_INSTRUMENT + 1;
  });

  /** The driver's own entry, for the melodic and percussion bands. */
  private readonly entry = computed<InstrumentEntry | null>(() => {
    const tables = this.drivers.instruments();
    if (this.band() === 'percussion') {
      return tables.percussion[this.written() - FIRST_PERCUSSION_INSTRUMENT] ?? null;
    }
    const n = this.emitted();
    if (n === null || this.band() !== 'melodic') return null;
    return tables.melodic[n] ?? null;
  });

  /** The six or seven bytes, whether they came from the driver or the song. */
  protected readonly bytes = computed<number[] | null>(() => {
    const custom = this.custom();
    if (custom) {
      if (!custom.complete) return null;
      return [sampleByte(custom.sample), ...custom.bytes];
    }
    const entry = this.entry();
    return entry ? [...entry.bytes] : null;
  });

  /**
   * Whether byte 0 can be stated at all.
   *
   * A custom instrument written as `"kick.brr"` has its SRCN decided by the
   * resolved `#samples` list, which the scanner does not build — so the byte is
   * genuinely unknown here rather than zero, and is shown as such.
   */
  protected readonly sampleKnown = computed(() => this.custom()?.sample.form !== 'file');

  protected readonly byteLabel = computed(() => {
    const bytes = this.bytes();
    if (!bytes) return null;
    return bytes.map((byte, i) => (i === 0 && !this.sampleKnown() ? '··' : hex2(byte))).join(' ');
  });

  /** The sample byte, which is a SRCN unless its high bit says noise. */
  private readonly srcn = computed(() => (this.sampleKnown() ? (this.bytes()?.[0] ?? -1) : -1));

  protected readonly isNoise = computed(() => {
    const srcn = this.srcn();
    return srcn >= 0 && (srcn & NOISE_FLAG) !== 0;
  });

  protected readonly adsr1 = computed(() => this.bytes()?.[1] ?? 0);
  protected readonly adsr2 = computed(() => this.bytes()?.[2] ?? 0);
  protected readonly gain = computed(() => this.bytes()?.[3] ?? 0);

  /** Whether to draw an envelope at all — there is nothing to draw without bytes. */
  protected readonly hasEnvelope = computed(() => this.bytes() !== null);

  protected readonly rows = computed<Row[]>(() => {
    const bytes = this.bytes();
    if (!bytes) return [];

    const rows: Row[] = [];
    if (this.isNoise()) {
      const clock = this.srcn() & 0x1f;
      rows.push({
        label: 'Sample',
        value: `noise, clock $${hex2(clock)}`,
        note: `${Math.round(noiseHz(clock)).toLocaleString()} Hz`,
      });
    } else if (this.sampleKnown()) {
      rows.push({ label: 'Sample', value: `$${hex2(this.srcn())}`, note: this.sampleName() });
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
      rows.push({ label: 'Attack', value: time(attackSeconds(envelope.attack)) });
      rows.push({
        label: 'Decay',
        value: time(decaySeconds(envelope.decay, envelope.sustain)),
        note: `to ${Math.round(sustainLevel(envelope.sustain) * 100)}% of full`,
      });
      rows.push({
        label: 'Release',
        value: Number.isFinite(release) ? time(release) : 'held indefinitely',
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

    const n = this.emitted();
    if (n !== null && n < DEFAULT_TRANSPOSE.length && DEFAULT_TRANSPOSE[n] !== 0) {
      const t = DEFAULT_TRANSPOSE[n];
      rows.push({
        label: 'Transposes',
        // `parser.ts:2278` subtracts, so a positive entry moves notes *down*.
        value: `${t > 0 ? '−' : '+'}${Math.abs(t)} semitones`,
        note: 'applied to every note written under it',
      });
    }

    return rows;
  });

  /**
   * The sample this SRCN names.
   *
   * Indexed by SRCN, which is the whole point: `sampleList`'s *order* is the
   * SRCN assignment, so `@5` is `INSTRUMENT_TO_SAMPLE[5]` = `$07` and not the
   * fifth entry. Falls back to the driver's own set before a compile exists.
   */
  private readonly sampleName = computed(() => {
    const srcn = this.srcn();
    if (srcn < 0) return undefined;
    const list = this.store.result()?.sampleList;
    if (list) return list[srcn] ?? 'past the end of this song’s sample list';
    return this.drivers.driver()?.samples[srcn]?.sampleName ?? 'not in the driver’s default set';
  });

  /** Set when the tables came from the bundled copy rather than the loaded driver. */
  protected readonly fallback = computed(() => this.drivers.instruments().source === 'bundled');
  protected readonly customDriver = computed(() => this.drivers.isCustom());

  /** For `@30+`: the sample form as written in the block. */
  protected readonly customSample = computed(() => {
    const custom = this.custom();
    if (!custom) return null;
    const sample = custom.sample;
    if (sample.form === 'file') return `"${sample.name}"`;
    if (sample.form === 'copy')
      return `@${sample.instrument}, whose sample is $${hex2(sample.srcn)}`;
    return `noise at clock $${hex2(sample.clock)}`;
  });

  protected readonly incompleteCustom = computed(() => {
    const custom = this.custom();
    return custom !== null && !custom.complete;
  });

  /** How the command was written, for the heading row. */
  protected readonly writtenLabel = computed(() =>
    this.raw() ? `$DA $${hex2(this.written())}` : `${this.direct() ? '@@' : '@'}${this.written()}`,
  );

  /** `@0`-`@18`, `@21`-`@29`, `@30`+ — stated once so the prose cannot drift. */
  protected readonly validRanges = '@0–@18, @21–@29 and @30 upward';

  protected readonly drumIndex = computed(() => this.written() - FIRST_PERCUSSION_INSTRUMENT);

  /** The SRCN a stock instrument would use, for the unsupported panel's example. */
  protected readonly stockSrcn = INSTRUMENT_TO_SAMPLE;
}

function sampleByte(sample: { form: string; srcn?: number; byte?: number }): number {
  if (sample.form === 'copy') return sample.srcn ?? 0;
  if (sample.form === 'noise') return sample.byte ?? 0;
  // A named file's SRCN is decided by the resolved `#samples` list, which the
  // scanner cannot know; the panel shows the name instead.
  return -1;
}

function time(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  return value >= 1 ? `${value.toFixed(2)} s` : `${(value * 1000).toFixed(0)} ms`;
}

function semitones(value: number): string {
  if (!Number.isFinite(value)) return 'silent';
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
