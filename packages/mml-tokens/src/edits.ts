/**
 * Rewriting a command in the source it was scanned from — the inverse of
 * `gather`. Enables you to edit commands from the inspector.
 */

import { hex2 } from "@amk/core/hex";
import type { Span } from "@amk/core/types";
import { type Command, HEX_ARG_LETTERS, type InstrumentDefinition } from "./tokens";

/** An 8-bit hex argument, used by q and n. */
export function argumentText(command: Command, byte: number): string {
	const hex = hex2(byte & 0xff);
	if (command.vcmd !== undefined) {
		return `$${hex}`;
	}

	return HEX_ARG_LETTERS.has(command.kind.toLowerCase()) ? hex : String(byte);
}

/** A splice to apply to the document. */
export interface Edit {
	span: Span;
	text: string;
	expect: string;
}

/** One part of a command: an argument, or the command byte itself. */
interface Part {
	span: Span;
	replacement?: string;
}

/** That one argument is literal source text, so writing over it writes over nothing else. */
export function argEditable(command: Command, index: number): boolean {
	const arg = command.args[index] as Command["args"][number] | undefined;
	return arg !== undefined && arg.replacement === undefined;
}

/** Every argument is literal, and not a replacement, and may be rewritten */
export function argsRewritable(command: Command): boolean {
	return command.args.length > 0 && command.args.every((arg) => arg.replacement === undefined);
}

/** The whole run is literal — the only state in which the command byte may be rewritten. */
export function commandRewritable(command: Command): boolean {
	return command.replacement === undefined;
}

/** Joins `parts` back together without changing the spacing of the text source. */
function splice(source: string, parts: Part[], texts: (string | null)[]): Edit | null {
	let first = -1;
	let last = -1;
	for (let i = 0; i < parts.length; i++) {
		const text = texts[i] as string | null | undefined;
		if (text === null || text === undefined || text === source.slice(parts[i].span.start, parts[i].span.end)) {
			continue;
		}

		// A part that came through a macro shares its span with everything else
		// the expansion produced. Refusing the whole splice rather than skipping
		// the part is deliberate: a caller asking to change it has asked for
		// something that cannot be done, and half-doing it would be worse.
		if (parts[i].replacement !== undefined) {
			return null;
		}

		if (first === -1) {
			first = i;
		}

		last = i;
	}

	if (first === -1) {
		return null;
	}

	let out = "";
	for (let i = first; i <= last; i++) {
		if (i > first) {
			// The text the author wrote between these two parts, verbatim.
			out += source.slice(parts[i - 1].span.end, parts[i].span.start);
		}

		const text = texts[i] as string | null | undefined;
		out += text ?? source.slice(parts[i].span.start, parts[i].span.end);
	}

	const span: Span = { start: parts[first].span.start, end: parts[last].span.end, line: parts[first].span.line };
	return { span, text: out, expect: source.slice(span.start, span.end) };
}

/** The command's parts in source order: the byte or letter, then its arguments. */
function partsOf(command: Command): Part[] {
	return [
		{ span: command.head, replacement: command.headReplacement },
		...command.args.map((arg) => ({ span: arg.span, replacement: arg.replacement })),
	];
}

/** Rewrites one argument, leaving the command byte and every other argument alone. */
export function spliceArg(source: string, command: Command, index: number, text: string): Edit | null {
	if (index < 0 || index >= command.args.length) {
		return null;
	}

	const texts: (string | null)[] = new Array<string | null>(command.args.length + 1).fill(null);
	texts[index + 1] = text;
	return splice(source, partsOf(command), texts);
}

/** Rewrites the arguments only, leaving the command byte as written. */
export function spliceArgs(source: string, command: Command, texts: (string | null)[]): Edit | null {
	return splice(source, partsOf(command), [null, ...texts]);
}

/** Rewrites the command byte itself, which only a wholly literal command permits. */
export function spliceHead(source: string, command: Command, text: string): Edit | null {
	const texts: (string | null)[] = new Array<string | null>(command.args.length + 1).fill(null);
	texts[0] = text;
	return splice(source, partsOf(command), texts);
}

/** Replaces the whole run — command byte, arguments and the text between them. */
export function spliceCommand(source: string, command: Command, text: string): Edit | null {
	if (!commandRewritable(command)) {
		return null;
	}

	const expect = source.slice(command.span.start, command.span.end);
	if (text === expect) {
		return null;
	}

	return { span: { ...command.span }, text, expect };
}

/** The five bytes of an `#instruments` entry, as splice parts. */
function instrumentParts(entry: InstrumentDefinition): Part[] {
	return [
		{ span: entry.sampleSpan },
		...entry.bytes.map((byte) => ({ span: byte.span, replacement: byte.replacement })),
	];
}

/** Rewrites one of an entry's five bytes — ADSR1, ADSR2, GAIN, tuning, subtuning. */
export function spliceInstrumentByte(
	source: string,
	entry: InstrumentDefinition,
	index: number,
	text: string,
): Edit | null {
	if (index < 0 || index >= entry.bytes.length) {
		return null;
	}

	const texts: (string | null)[] = new Array<string | null>(entry.bytes.length + 1).fill(null);
	texts[index + 1] = text;
	return splice(source, instrumentParts(entry), texts);
}

/** Rewrites several of an entry's bytes at once; `null` leaves one as written. */
export function spliceInstrumentBytes(
	source: string,
	entry: InstrumentDefinition,
	texts: (string | null)[],
): Edit | null {
	return splice(source, instrumentParts(entry), [null, ...texts]);
}

/** Swaps an #instrument entry's sample without touching the hex parameters */
export function spliceInstrumentSample(source: string, entry: InstrumentDefinition, text: string): Edit | null {
	const texts: (string | null)[] = new Array<string | null>(entry.bytes.length + 1).fill(null);
	texts[0] = text;
	return splice(source, instrumentParts(entry), texts);
}

/**
 * A splice over a plain source range.
 *
 * The builders above all start from a scanned {@link Command}, because that is
 * what an inspector has. The piano roll does not: it starts from a note's span
 * in `CompileResult.noteMap`, and the run it rewrites reaches past the command
 * into the octave written beside it. So this takes the range directly and
 * derives `expect` from it, which is the one thing no caller should be spelling
 * out for itself.
 *
 * `null` when the text is already what is there, matching the other builders and
 * `EditorRequests.apply`'s contract.
 */
export function spliceRange(source: string, span: Span, text: string): Edit | null {
	const expect = source.slice(span.start, span.end);
	if (text === expect) {
		return null;
	}

	return { span: { ...span }, text, expect };
}

/**
 * An insertion at an offset, as an empty range.
 *
 * Its own function rather than a `spliceRange` with `start === end` so that the
 * empty `expect` is deliberate where a reader meets it: there is nothing at an
 * offset for a race guard to check, and the guard is doing its job by comparing
 * two empty strings.
 */
export function insertAt(offset: number, text: string, line = 1): Edit | null {
	if (text === "") {
		return null;
	}

	return { span: { start: offset, end: offset, line }, text, expect: "" };
}
