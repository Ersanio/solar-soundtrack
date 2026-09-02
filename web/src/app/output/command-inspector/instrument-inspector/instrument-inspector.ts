import { Component, computed, inject, input } from '@angular/core';

import {
  FIRST_CUSTOM_INSTRUMENT,
  FIRST_PERCUSSION_INSTRUMENT,
  type InstrumentEntry,
  MELODIC_SLOTS,
} from '@amk/spc/instruments';
import { emittedInstrument } from '@amk/tokens/commands/instruments';
import type { Command } from '@amk/tokens';
import { CommitAudition } from '../../../state/commit-audition';
import { DriverStore } from '../../../state/driver-store';
import { EditorStore } from '../../../state/editor-store';
import { EnumSelect } from '../../../shared/enum-select/enum-select';
import { hex2 } from '../../../util/format';
import { AdsrGraph } from '../adsr-graph/adsr-graph';
import { InstrumentEntryEditor } from '../instrument-entry/instrument-entry';
import { HexPipe } from '../../../util/hex.pipe';
import { instrumentEdit, instrumentPicker } from './instrument-choices';
import { type DetailRow, detailRows, sampleByte } from './instrument-rows';

/** Which of the things `@n` — or a raw `$DA` — can mean. */
type Band = 'melodic' | 'unsupported' | 'percussion' | 'custom' | 'undefined' | 'beyond';

/**
 * What `@n` selects — which is a table entry, not a sample.
 *
 * The number bands are AddmusicK's, and they are not contiguous: `@0`-`@18` set
 * an instrument, `@19` and `@20` do nothing audible at all, `@21`-`@29` arm a
 * drum on the next note without emitting anything, and `@30` up are the song's
 * own. `parser.ts`'s `parseInstrument` has the one line that splits them.
 */
@Component({
  selector: 'amk-instrument-inspector',
  imports: [AdsrGraph, EnumSelect, HexPipe, InstrumentEntryEditor],
  templateUrl: './instrument-inspector.html',
  host: { class: 'block' },
})
export class InstrumentInspector {
  private readonly store = inject(EditorStore);
  private readonly drivers = inject(DriverStore);

  private readonly commitAudition = inject(CommitAudition);

  readonly command = input.required<Command>();

  /** The number written, before AddmusicK does anything to it. */
  protected readonly written = computed(() => {
    const args = this.command().args;
    return args.length > 0 ? args[0].value : -1;
  });

  protected readonly direct = computed(() => this.command().direct === true);

  /** Written as `$DA $xx` rather than `@n`, which skips every rule below. */
  protected readonly raw = computed(() => this.command().vcmd === 0xda);

  /** A raw `$DA` whose byte meant something else — #am4's `$13`-up numbering. */
  protected readonly rawRemapped = computed(() => this.raw() && this.emitted() !== this.written());

  /**
   * The number that reaches `$DA`, or `null` when nothing is emitted.
   *
   * The map lives in `@amk/tokens`, beside the inverse the picker below writes
   * through: a list of instruments and a write that disagreed about what a
   * number means would put an author on one they did not choose, and `edittest`
   * round-trips the pair to hold them together.
   */
  protected readonly emitted = computed<number | null>(() => emittedInstrument(this.command()));

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

  protected readonly band = computed<Band>(() => {
    const n = this.emitted();
    if (n === null) {
      const written = this.written();
      return written >= FIRST_PERCUSSION_INSTRUMENT ? 'percussion' : 'unsupported';
    }

    if (n < MELODIC_SLOTS) {
      return 'melodic';
    }

    // Only a raw `$DA` can land here: 20-29 is past the table, and where it
    // reads is a property of the driver's indexing code, which is not in the
    // AddmusicK sources this port was written against.
    if (n < FIRST_CUSTOM_INSTRUMENT) {
      return 'beyond';
    }

    return this.custom() ? 'custom' : 'undefined';
  });

  private readonly custom = computed(() => {
    const n = this.emitted();
    if (n === null || n < FIRST_CUSTOM_INSTRUMENT) {
      return null;
    }

    return this.store.tokens().instruments.find((entry) => entry.number === n) ?? null;
  });

  /** How many entries the song's `#instruments` blocks define. */
  protected readonly customCount = computed(() => this.store.tokens().instruments.length);

  /**
   * The dropdown: every instrument this command's spelling can reach.
   *
   * Drawn above the bands rather than inside the one that reads the bytes, since
   * `@19`, a `$DA` past the table and a custom instrument the song has not
   * defined are exactly where a porter wants to change the number.
   */
  protected readonly picker = computed(() => instrumentPicker(this.command(), this.customCount()));

  /**
   * Through `CommitAudition`, so the note the roll is asking about sounds again
   * under the new instrument once the change has compiled — which is the whole
   * reason to pick one from here rather than from the text.
   */
  protected setInstrument(instrument: number): void {
    this.commitAudition.apply(instrumentEdit(this.store.source(), this.command(), instrument));
  }

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
    if (!tables) {
      return null;
    }

    if (this.band() === 'percussion') {
      return tables.percussion[this.written() - FIRST_PERCUSSION_INSTRUMENT] ?? null;
    }

    const n = this.emitted();
    if (n === null || this.band() !== 'melodic') {
      return null;
    }

    return tables.melodic[n] ?? null;
  });

  /** The six or seven bytes, whether they came from the driver or the song. */
  protected readonly bytes = computed<number[] | null>(() => {
    const custom = this.custom();
    if (custom) {
      if (!custom.complete) {
        return null;
      }

      return [sampleByte(custom.sample), ...custom.bytes.map((byte) => byte.value)];
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
    if (!bytes) {
      return null;
    }

    return bytes.map((byte, i) => (i === 0 && !this.sampleKnown() ? '··' : hex2(byte))).join(' ');
  });

  /** The sample byte, which is a SRCN unless its high bit says noise. */
  private readonly srcn = computed(() => (this.sampleKnown() ? (this.bytes()?.[0] ?? -1) : -1));

  protected readonly adsr1 = computed(() => this.bytes()?.[1] ?? 0);
  protected readonly adsr2 = computed(() => this.bytes()?.[2] ?? 0);
  protected readonly gain = computed(() => this.bytes()?.[3] ?? 0);

  /** Whether to draw an envelope at all — there is nothing to draw without bytes. */
  protected readonly hasEnvelope = computed(() => this.bytes() !== null);

  protected readonly rows = computed<DetailRow[]>(() => {
    const bytes = this.bytes();
    if (!bytes) {
      return [];
    }

    return detailRows({
      bytes,
      srcn: this.srcn(),
      sampleName: this.sampleName(),
      emitted: this.emitted(),
    });
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
    if (srcn < 0) {
      return undefined;
    }

    const list = this.store.result()?.sampleList;
    if (list) {
      return list[srcn] ?? 'past the end of this song’s sample list';
    }

    return this.drivers.driver()?.samples[srcn]?.sampleName ?? 'not in the driver’s default set';
  });

  /** For `@30+`: the sample form as written in the block. */
  protected readonly customSample = computed(() => {
    const custom = this.custom();
    if (!custom) {
      return null;
    }

    const sample = custom.sample;
    if (sample.form === 'file') {
      return `"${sample.name}"`;
    }

    if (sample.form === 'copy') {
      return `@${sample.instrument}, whose sample is $${hex2(sample.srcn)}`;
    }

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
}
