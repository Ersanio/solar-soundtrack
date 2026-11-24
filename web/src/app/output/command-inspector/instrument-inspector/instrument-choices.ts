import { type Edit, argEditable, argumentText, insertAt, spliceArg } from '@amk/tokens/edits';
import {
  LAST_DRIVER_INSTRUMENT,
  instrumentByte,
  instrumentReach,
  selectedInstrument,
} from '@amk/tokens/commands/instruments';
import { FIRST_CUSTOM_INSTRUMENT, VCMD } from '@amk/core/hardcoded-tables';
import type { Command } from '@amk/tokens';
import type { EnumOption } from '../../../shared/enum-select/enum-select';
import { hex2 } from '../../../util/format';
import { argLockedBecause } from '../commands/context';

/**
 * The instrument picker: what it lists, what it shows, and what it writes.
 *
 * Free functions rather than computeds on the panel, in `instrument-rows.ts`'s
 * mould — none of this needs a store. Which instruments a spelling can reach is
 * `@amk/tokens`' question and is answered there; this is what the control says
 * about the answer, and the splice that follows a pick.
 *
 * The spelling the author wrote is kept: only the argument moves, in that
 * spelling's own numbering, and an instrument the spelling cannot express is
 * simply not listed. So the direct `@@` and a raw `$DA` offer no drums, neither
 * being able to write one.
 */

/** What the control draws, and what a refusal to draw it says. */
export interface InstrumentPicker {
  /** The instrument selected, or the number written where that is not one. */
  selected: number;
  options: readonly EnumOption[];
  note: string | null;
  /** What a `selected` outside {@link options} reads as — see `amk-enum-select`. */
  unknownLabel: string;
  editable: boolean;
  lockedBecause: string | null;
}

export function instrumentPicker(command: Command, customCount: number): InstrumentPicker {
  const written = command.args[0]?.value ?? -1;
  const selected = selectedInstrument(command);

  return {
    selected: selected ?? written,
    options: instrumentReach(command, customCount).map((instrument) => ({
      value: instrument,
      label: labelOf(instrument),
    })),
    note: noteFor(command),
    unknownLabel: unknownLabelFor(written, selected),
    // A number that has not been written yet is not locked: there is nothing in
    // the way, and a pick inserts one.
    editable: written < 0 || argEditable(command, 0),
    lockedBecause: written < 0 ? null : argLockedBecause(command, 0),
  };
}

/**
 * The splice a pick writes.
 *
 * `null` for an instrument this spelling cannot express, which is the same
 * answer `instrumentByte` gives and the reason the list is built from it.
 */
export function instrumentEdit(source: string, command: Command, instrument: number): Edit | null {
  const byte = instrumentByte(command, instrument);
  if (byte === null) {
    return null;
  }

  const text = argumentText(command, byte);
  if (command.args.length > 0) {
    return spliceArg(source, command, 0, text);
  }

  // `getInt` reads the digits hard against the `@` (`parser.ts:parseInstrument`)
  // where `getHex` reaches over spaces, so only the hex form takes a separator.
  return insertAt(
    command.head.end,
    command.vcmd === undefined ? text : ` ${text}`,
    command.head.line,
  );
}

/** What SMW's stock instruments and drums are known as. */
export const STOCK_NAMES: ReadonlyMap<number, string> = new Map([
  [0, $localize`:@@inspector.instrument.stock.flute:inspector.instrument.stock.flute`],
  [1, $localize`:@@inspector.instrument.stock.string:inspector.instrument.stock.string`],
  [
    2,
    $localize`:@@inspector.instrument.stock.glockenspiel:inspector.instrument.stock.glockenspiel`,
  ],
  [3, $localize`:@@inspector.instrument.stock.marimba:inspector.instrument.stock.marimba`],
  [4, $localize`:@@inspector.instrument.stock.cello:inspector.instrument.stock.cello`],
  [
    5,
    $localize`:@@inspector.instrument.stock.acoustic-steel-guitar:inspector.instrument.stock.acoustic-steel-guitar`,
  ],
  [6, $localize`:@@inspector.instrument.stock.trumpet:inspector.instrument.stock.trumpet`],
  [7, $localize`:@@inspector.instrument.stock.steel-drums:inspector.instrument.stock.steel-drums`],
  [
    8,
    $localize`:@@inspector.instrument.stock.acoustic-bass:inspector.instrument.stock.acoustic-bass`,
  ],
  [9, $localize`:@@inspector.instrument.stock.piano:inspector.instrument.stock.piano`],
  [10, $localize`:@@inspector.instrument.stock.snare-drum:inspector.instrument.stock.snare-drum`],
  [11, $localize`:@@inspector.instrument.stock.string-2:inspector.instrument.stock.string-2`],
  [12, $localize`:@@inspector.instrument.stock.bongo:inspector.instrument.stock.bongo`],
  [
    13,
    $localize`:@@inspector.instrument.stock.electric-piano:inspector.instrument.stock.electric-piano`,
  ],
  [14, $localize`:@@inspector.instrument.stock.slap-bass:inspector.instrument.stock.slap-bass`],
  [
    15,
    $localize`:@@inspector.instrument.stock.orchestra-hit:inspector.instrument.stock.orchestra-hit`,
  ],
  [16, $localize`:@@inspector.instrument.stock.harp:inspector.instrument.stock.harp`],
  [
    17,
    $localize`:@@inspector.instrument.stock.distortion-guitar:inspector.instrument.stock.distortion-guitar`,
  ],
  [18, $localize`:@@inspector.instrument.stock.string-3:inspector.instrument.stock.string-3`],
  [21, $localize`:@@inspector.instrument.stock.bass-drum:inspector.instrument.stock.bass-drum`],
  [
    22,
    $localize`:@@inspector.instrument.stock.light-cymbal:inspector.instrument.stock.light-cymbal`,
  ],
  [23, $localize`:@@inspector.instrument.stock.maracas:inspector.instrument.stock.maracas`],
  [24, $localize`:@@inspector.instrument.stock.wood-block:inspector.instrument.stock.wood-block`],
  [
    25,
    $localize`:@@inspector.instrument.stock.high-wood-block:inspector.instrument.stock.high-wood-block`,
  ],
  [26, $localize`:@@inspector.instrument.stock.low-snare:inspector.instrument.stock.low-snare`],
  [27, $localize`:@@inspector.instrument.stock.loud-snare:inspector.instrument.stock.loud-snare`],
  [28, $localize`:@@inspector.instrument.stock.soft-snare:inspector.instrument.stock.soft-snare`],
  [29, $localize`:@@inspector.instrument.stock.power-set:inspector.instrument.stock.power-set`],
]);

/**
 * Numbers first, because that is what the source says, with a stock
 * instrument's name beside its number.
 *
 * The one entry with no number of its own is the driver's last table slot: a
 * written 19 emits nothing, so only a raw `$DA $13` reaches it and there is no
 * `@19` to call it by.
 */
function labelOf(instrument: number): string {
  if (instrument === LAST_DRIVER_INSTRUMENT) {
    return $localize`:@@inspector.instrument.entry:inspector.instrument.entry ${instrument}:instrument:`;
  }

  const name = STOCK_NAMES.get(instrument);
  return name === undefined
    ? `@${instrument}`
    : $localize`:@@inspector.instrument.named:inspector.instrument.named ${instrument}:instrument: ${name}:name:`;
}

/** What this spelling leaves out, said once under the control. */
function noteFor(command: Command): string | null {
  if (command.vcmd === VCMD.Instrument) {
    const drums = $localize`:@@inspector.instrument.a-drum-is-not-a:inspector.instrument.a-drum-is-not-a`;
    return command.target.program === 1
      ? $localize`:@@inspector.instrument.under-am4-a-custom-instrument:inspector.instrument.under-am4-a-custom-instrument ${drums}:drums:`
      : drums;
  }

  if (command.direct === true) {
    return $localize`:@@inspector.instrument.the-direct-form-remaps-19:inspector.instrument.the-direct-form-remaps-19`;
  }

  return null;
}

/**
 * What the control calls a value the list does not hold.
 *
 * The panel's own bands, in its own words: a number that is not there, one that
 * emits nothing, one naming a custom instrument this song has not defined, and
 * one past the driver's table — which only a raw `$DA` can be, every other
 * spelling remapping 19-29 to a custom instrument or to nothing at all.
 */
function unknownLabelFor(written: number, selected: number | null): string {
  if (written < 0) {
    return $localize`:@@inspector.instrument.no-number-written-yet:inspector.instrument.no-number-written-yet`;
  }

  if (selected === null) {
    return $localize`:@@inspector.instrument.which-emits-nothing:inspector.instrument.which-emits-nothing ${written}:written:`;
  }

  if (selected >= FIRST_CUSTOM_INSTRUMENT) {
    return $localize`:@@inspector.instrument.which-this-song-does-not:inspector.instrument.which-this-song-does-not ${selected}:selected:`;
  }

  return $localize`:@@inspector.instrument.da-which-reads-past-the:inspector.instrument.da-which-reads-past-the ${hex2(written)}:written:`;
}
