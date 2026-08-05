import type { Command } from '@compiler/tokens';

/**
 * What a command's arguments *mean*, in a form the panel can render and edit.
 *
 * Three deliberately small unions rather than one mixed one, because they are
 * consumed by different code and `switch-exhaustiveness-check` is an error here:
 * adding a member makes every renderer that handles it fail to compile until it
 * is handled, which is only useful if the union is about one thing.
 *
 * The rule that keeps this table honest: **a descriptor never states how many
 * arguments a command takes.** `tokens.ts` already carries that twice on
 * purpose — as `scanHex`'s `hexLeft` mutations and as `expectedArgs`, pinned
 * against each other by `tokentest` — and a third statement here would be
 * invisible to every harness. Descriptors describe as many parameters as they
 * know about and no more; {@link shapeOf} takes the count from `expectedArgs`
 * and pads the tail with raw rows.
 */

/** How the byte becomes the number a control edits. The write path needs only this. */
export type Codec = 'u8' | 's8' | 'nibbles' | 'bits';

/** What the number is, which is what the readout and the unit are drawn from. */
export type Role =
  | 'level'
  | 'ticks'
  | 'semitones'
  | 'rate'
  | 'index'
  | 'pan'
  | 'channelMask'
  | 'srcn'
  | 'note'
  | 'address'
  | 'opaque';

/** Which control to draw. Defaults fall out of the codec and range when unset. */
export type Control = 'slider' | 'number' | 'select' | 'toggles' | 'readonly';

/** One named choice for a {@link Control} of `'select'`. */
export interface ParamChoice {
  value: number;
  label: string;
}

/** One argument of a command, said in what it does. */
export interface ParamDescriptor {
  /** Shown as the control's label — "Feedback", "Volume L", "Over". */
  name: string;
  codec: Codec;
  role: Role;
  control?: Control;
  /** Inclusive, in the units the control edits. Defaults to the codec's own range. */
  min?: number;
  max?: number;
  choices?: readonly ParamChoice[];
  /**
   * The consequence the number does not state — "16 ms steps; 2 KiB of ARAM",
   * "$0A is centre". Runs against the whole command, since several of these
   * depend on a sibling argument.
   */
  describe?: (value: number, command: Command) => string | null;
  /**
   * This argument decides how many bytes after the command belong to it.
   *
   * `$FB`'s count, `#am4 $ED`'s sub-byte, `#am4 $E5`'s high bit, `$FA`'s
   * sub-byte. Never given a slider: dragging one would reinterpret the music
   * after it as data at every value on the way past.
   */
  structural?: boolean;
}

/** What {@link shapeOf} resolves a command to. */
export interface CommandShape {
  params: ParamDescriptor[];
  /** A sentence about the command as a whole, usually a dialect fork. */
  note?: string;
}

/** A command's parameters, given the arguments it has and the dialect it is in. */
export type Resolver = (command: Command) => CommandShape;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** The ~30 commands whose parameters really are a static list. */
export function fixed(params: ParamDescriptor[], note?: string): Resolver {
  return () => ({ params, note });
}

/** A plain 0-255 byte. */
export function u8(
  name: string,
  role: Role,
  extra: Partial<ParamDescriptor> = {},
): ParamDescriptor {
  return { name, codec: 'u8', role, ...extra };
}

/** A byte read as -128..127 — echo volumes, feedback, transpose, fine tune. */
export function s8(
  name: string,
  role: Role,
  extra: Partial<ParamDescriptor> = {},
): ParamDescriptor {
  return { name, codec: 's8', role, min: -128, max: 127, ...extra };
}

/** A byte that picks a mode, drawn as a select and never dragged. */
export function choice(
  name: string,
  choices: readonly ParamChoice[],
  extra: Partial<ParamDescriptor> = {},
): ParamDescriptor {
  return { name, codec: 'u8', role: 'index', control: 'select', choices, ...extra };
}

/** A duration in driver ticks. */
export function ticks(name: string, extra: Partial<ParamDescriptor> = {}): ParamDescriptor {
  return { name, codec: 'u8', role: 'ticks', ...extra };
}

/** A byte the inspector has nothing to say about, shown but not interpreted. */
export function raw(name: string): ParamDescriptor {
  return { name, codec: 'u8', role: 'opaque' };
}

/** The signed reading of a byte, for `s8` descriptors. */
export function toSigned(value: number): number {
  return value >= 0x80 ? value - 0x100 : value;
}

/** The byte a signed value writes back as. */
export function fromSigned(value: number): number {
  return value < 0 ? value + 0x100 : value;
}
