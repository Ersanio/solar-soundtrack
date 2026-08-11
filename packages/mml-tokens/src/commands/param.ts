import type { Command } from "../tokens";
import { ticksLabel } from "./units";

export interface EnumOption {
	value: number;
	label: string;
}

/** How the byte becomes the number a control edits. The write path needs only this. */
export type Codec = "u8" | "s8" | "nibbles" | "bits";

/** What the number is, which is what the readout and the unit are drawn from. */
export type Role =
	"level" | "ticks" | "semitones" | "rate" | "index" | "pan" | "channelMask" | "srcn" | "note" | "address" | "opaque";

/** Which control to draw. Defaults fall out of the codec and range when unset. */
export type Control = "slider" | "number" | "select" | "toggles" | "readonly";

/** One named choice for a {@link Control} of `'select'`. */
export interface ParamChoice {
	value: number;
	label: string;
}

/** What a descriptor needs to know that is not in the command itself. */
export interface ParamContext {
	/** The tempo in force where this command sits, or `null` before any is set. */
	tempo: number | null;
	/** The song's resolved `#samples` list, in SRCN order. */
	samples: readonly EnumOption[];
}

/** One argument of a command, said in what it does. */
export interface ParamDescriptor {
	name: string;
	codec: Codec;
	role: Role;
	control?: Control;
	min?: number;
	max?: number;
	stops?: readonly number[];
	choices?: readonly ParamChoice[];
	/** The consequence the number does not state e.g. "16 ms steps; 2 KiB of ARAM" */
	describe?: (value: number, command: Command, context: ParamContext) => string | null;
	/** This argument decides how many bytes after the command belong to it. */
	structural?: boolean;
}

/** What `resolveCommand` resolves a command to. */
export interface CommandShape {
	params: ParamDescriptor[];
	/** A note about the command as a whole, usually a dialect fork. */
	note?: string;
	/** Escape hatch for commands like $ED $82 with a dynamic payload */
	tail?: string;
}

/** A command's parameters, given the arguments it has and the song around it. */
export type Resolver = (command: Command, context: ParamContext) => CommandShape;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** The ~30 commands whose parameters really are a static list. */
export function fixed(params: ParamDescriptor[], note?: string): Resolver {
	return () => ({ params, note });
}

/** A plain 0-255 byte. */
export function u8(name: string, role: Role, extra: Partial<ParamDescriptor> = {}): ParamDescriptor {
	return { name, codec: "u8", role, ...extra };
}

/** A byte read as -128..127 — echo volumes, feedback, transpose, fine tune. */
export function s8(name: string, role: Role, extra: Partial<ParamDescriptor> = {}): ParamDescriptor {
	return { name, codec: "s8", role, min: -128, max: 127, ...extra };
}

/** A byte that picks a mode, drawn as a select and never dragged. */
export function choice(
	name: string,
	choices: readonly ParamChoice[],
	extra: Partial<ParamDescriptor> = {},
): ParamDescriptor {
	return { name, codec: "u8", role: "index", control: "select", choices, ...extra };
}

/** A duration in driver ticks, read out as ticks, note length and seconds. */
export function ticks(name: string, extra: Partial<ParamDescriptor> = {}): ParamDescriptor {
	return {
		name,
		codec: "u8",
		role: "ticks",
		describe: (value, _command, context) => ticksLabel(value, context.tempo),
		...extra,
	};
}

/**
 * The fade duration `$E1`, `$E3` and `$E8` share with `w`, `t` and `v`'s comma
 * forms, which compile to exactly those three (`parser.ts:parseFadeableValue`,
 * `parseTempo`). Shared rather than restated, so the two spellings of one
 * command cannot drift apart.
 *
 * Not folded into {@link ticks}: a `$DD` or `$DE` delay of 0 means no delay,
 * where a fade over 0 ticks is the target applied at once.
 */
export const DURATION = ticks("Over", {
	describe: (value, _command, context) =>
		value === 0 ? "instant — a duration of 0 applies the target at once" : ticksLabel(value, context.tempo),
});

/** A byte the inspector has nothing to say about, shown but not interpreted. */
export function raw(name: string): ParamDescriptor {
	return { name, codec: "u8", role: "opaque" };
}

/** The signed reading of a byte, for `s8` descriptors. */
export function toSigned(value: number): number {
	return value >= 0x80 ? value - 0x100 : value;
}

/** The byte a signed value writes back as. */
export function fromSigned(value: number): number {
	return value < 0 ? value + 0x100 : value;
}
