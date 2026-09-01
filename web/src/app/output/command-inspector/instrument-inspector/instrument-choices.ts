import { type Edit, argEditable, argumentText, insertAt, spliceArg } from '@amk/tokens/edits';
import {
  LAST_DRIVER_INSTRUMENT,
  instrumentByte,
  instrumentReach,
  selectedInstrument,
} from '@amk/tokens/commands/instruments';
import { FIRST_CUSTOM_INSTRUMENT } from '@amk/core/hardcoded-tables';
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

/**
 * Numbers, because that is what the source says.
 *
 * The one entry with no number of its own is the driver's last table slot: a
 * written 19 emits nothing, so only a raw `$DA $13` reaches it and there is no
 * `@19` to call it by.
 */
function labelOf(instrument: number): string {
  return instrument === LAST_DRIVER_INSTRUMENT ? `entry ${instrument}` : `@${instrument}`;
}

/** What this spelling leaves out, said once under the control. */
function noteFor(command: Command): string | null {
  if (command.vcmd === 0xda) {
    const drums = 'A drum is not a $DA at all — @21–@29 rewrite the next note instead.';
    return command.target.program === 1
      ? `${drums} Under #am4 a custom instrument is written from $13.`
      : drums;
  }

  if (command.direct === true) {
    return 'The direct form remaps 19–29 to custom instruments, so it cannot write a drum.';
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
    return 'no number written yet';
  }

  if (selected === null) {
    return `@${written}, which emits nothing`;
  }

  if (selected >= FIRST_CUSTOM_INSTRUMENT) {
    return `@${selected}, which this song does not define`;
  }

  return `$DA $${hex2(written)}, which reads past the driver’s table`;
}
