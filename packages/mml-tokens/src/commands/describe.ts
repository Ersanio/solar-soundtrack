import { argEditable } from '../edits';
import { type Command, expectedArgs } from '../tokens';
import { hex2 } from '@amk/core/hex';
import { HEX_PARAMS } from './hex-params';
import { LETTER_PARAMS } from './letter-params';
import {
  type Control,
  type ParamChoice,
  type ParamContext,
  type ParamDescriptor,
  raw,
  toSigned,
} from './param';

/** One row of the parameter table: a descriptor bound to the value it describes. */
export interface ParamRow {
  index: number;
  descriptor: ParamDescriptor;
  /** The byte as written. `null` when the command has not been given this argument yet. */
  byte: number | null;
  /** The value the control edits — signed for `s8`, the byte otherwise. */
  value: number;
  control: Control;
  min: number;
  max: number;
  /** Slider stops, for a scale that is not linear. `null` for an ordinary range. */
  stops: readonly number[] | null;
  /** Fill the track from the middle — a balance rather than a level. */
  centred: boolean;
  /** Reverse the track, for a value that counts against the direction it means. */
  invert: boolean;
  /** Marks under the ends of the track, for a control whose extremes have names. */
  ends: readonly [string, string] | null;
  choices: readonly ParamChoice[];
  /** `$7F` / `20` — the raw form, always shown so the source stays readable off the panel. */
  raw: string;
  /** What the value means, from the descriptor. */
  note: string | null;
  editable: boolean;
  /** Why it is not editable, when it is not. */
  lockedBecause: string | null;
}

export interface ResolvedCommand {
  rows: ParamRow[];
  /** A sentence about the command as a whole — usually a dialect fork. */
  note: string | null;
  /** More arguments than the table names, and how many are not shown. */
  omitted: number;
  /** What those are, singular, when they are a payload rather than parameters. */
  tail: string | null;
}

/**
 * The most rows worth drawing.
 *
 * An `#am4` `$ED $82` upload carries a 16-bit count of data bytes and `$FB $7F`
 * carries 130 notes; past a couple of dozen the table stops being a readout and
 * starts being a hex dump, which the panel below it already is.
 */
const MAX_ROWS = 24;

/** Sensible control for a descriptor that did not ask for one. */
function controlFor(descriptor: ParamDescriptor): Control {
  if (descriptor.control) {
    return descriptor.control;
  }

  if (descriptor.choices) {
    return 'select';
  }

  // Anything that decides how the bytes after it are read is never dragged:
  // a slider would take the document through every value on the way past.
  if (descriptor.structural) {
    return 'number';
  }

  return descriptor.role === 'opaque' || descriptor.role === 'address' ? 'number' : 'slider';
}

function rangeFor(descriptor: ParamDescriptor): { min: number; max: number } {
  return {
    min: descriptor.min ?? (descriptor.codec === 's8' ? -128 : 0),
    max: descriptor.max ?? (descriptor.codec === 's8' ? 127 : 255),
  };
}

/**
 * Whether the slider should fill from the middle rather than from the left.
 *
 * Two kinds of number want it, and they are the same kind underneath: anything
 * signed, where zero is neutral and the sign is a direction, and pan, which is
 * unsigned only because AddmusicK counts it from one speaker to the other. Both
 * are balances rather than levels, and a level's fill misreads them — it draws
 * the neutral value as half full and one extreme as empty.
 */
function centredFor(descriptor: ParamDescriptor): boolean {
  return descriptor.codec === 's8' || descriptor.role === 'pan';
}

/**
 * The command's parameters, bound to what it actually says.
 *
 * The descriptor table names as many arguments as it can; how many there *are*
 * comes from `expectedArgs`, which is the compiler's own answer and the one
 * `tokentest` pins. So a command the table has never heard of still gets one row
 * per argument, and a command whose dialect fork the table has not caught up
 * with shows the extra arguments rather than hiding them.
 */
export function resolveCommand(command: Command, context: ParamContext): ResolvedCommand {
  const resolver =
    command.vcmd !== undefined
      ? HEX_PARAMS[command.vcmd]
      : LETTER_PARAMS[command.kind.toLowerCase()];

  const shape = resolver ? resolver(command, context) : { params: [], note: undefined };

  const expected =
    command.vcmd !== undefined ? expectedArgs(command.vcmd, command.args, command.target) : null;
  const total = Math.max(command.args.length, shape.params.length, expected ?? 0);
  // A payload stops at the last named row: the rest is bulk, and forty number
  // fields called "Argument 7" onwards are a hex dump with worse spacing.
  const shown = Math.min(total, shape.tail !== undefined ? shape.params.length : MAX_ROWS);

  const rows: ParamRow[] = [];
  for (let index = 0; index < shown; index++) {
    const descriptor = shape.params[index] ?? raw(`Argument ${index + 1}`);
    const arg = command.args[index] as Command['args'][number] | undefined;
    const byte = arg?.value ?? null;
    const { min, max } = rangeFor(descriptor);
    const value = byte === null ? min : descriptor.codec === 's8' ? toSigned(byte) : byte;

    const missing = byte === null;
    const macro = arg?.replacement;

    rows.push({
      index,
      descriptor,
      byte,
      value,
      control: missing ? 'readonly' : controlFor(descriptor),
      min,
      max,
      stops: descriptor.stops ?? null,
      centred: centredFor(descriptor),
      // Pan is the only value in the language that counts backwards from what
      // it does; `main.asm:3486`'s table runs from hard right to hard left.
      invert: descriptor.role === 'pan',
      ends: descriptor.role === 'pan' ? ['L', 'R'] : null,
      choices: descriptor.choices ?? [],
      raw: byte === null ? '—' : command.vcmd !== undefined ? `$${hex2(byte)}` : String(byte),
      note: byte === null ? null : (descriptor.describe?.(byte, command, context) ?? null),
      editable: !missing && argEditable(command, index),
      lockedBecause: missing
        ? 'not written yet'
        : macro !== undefined
          ? `comes from the "${macro}" replacement`
          : null,
    });
  }

  return { rows, note: shape.note ?? null, omitted: total - shown, tail: shape.tail ?? null };
}
