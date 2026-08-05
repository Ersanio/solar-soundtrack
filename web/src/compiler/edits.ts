/**
 * Rewriting a command in the source it was scanned from — the inverse of
 * `gather`.
 *
 * The command inspector edits MML by replacing text, not by re-emitting it, and
 * the two rules that make that safe both live here rather than in the panels:
 *
 * 1. **Only the parts that changed are replaced.** A splice runs from the first
 *    changed part to the last, and the text *between* the parts is copied out of
 *    the source verbatim. Column alignment, tabs and a `; comment` written
 *    mid-run all survive an edit to the byte beside them. Re-rendering the whole
 *    command from its values — which is what the FIR designer used to do — is
 *    two characters shorter to write and destroys all three.
 *
 * 2. **A part that came through a `"find=value"` replacement is not writable.**
 *    Every token from one expansion is stamped with the use site's span
 *    (`tokens.ts:1276`), so two arguments out of one macro share a single span
 *    and writing over either would clobber the other — and, if the expansion
 *    carried anything past the command, delete that too. `Command` carries
 *    provenance per part precisely so this can be asked per part: the common
 *    `"ech=$EF"` case, where the command byte is a macro and every argument is
 *    literal text, stays editable.
 *
 * Framework-free and DOM-free like the rest of `compiler/`, and deliberately so:
 * this is the one piece of the inspector that does arithmetic on the user's
 * document, and putting it here is what lets `edittest` gate it.
 */

import type { Span } from "../core/types";
import { type Command, HEX_ARG_LETTERS, type InstrumentDefinition } from "./tokens";

/**
 * How one of this command's arguments must be spelled to mean `byte`.
 *
 * Three radices, not two. A hex command's arguments are `$XX`; most letter
 * commands' are decimal; and `q` and `n` are **bare hex**, because `parser.ts`
 * reads those two with `getHex` rather than `getInt` ({@link HEX_ARG_LETTERS}).
 * So `n10` means `$10` — sixteen — and writing ten as `"10"` is wrong twice
 * over: the value is wrong, and it is wrong *silently*, since a decimal string
 * contains no hex letters to trip an error.
 *
 * Here rather than in the panel that happens to need it because it is a fact
 * about the language, and because this is the layer `edittest` can gate.
 */
export function argumentText(command: Command, byte: number): string {
	const hex = (byte & 0xff).toString(16).toUpperCase().padStart(2, "0");
	if (command.vcmd !== undefined) {
		return `$${hex}`;
	}

	return HEX_ARG_LETTERS.has(command.kind.toLowerCase()) ? hex : String(byte);
}

/**
 * A splice to apply to the document.
 *
 * {@link expect} is what the edit believes currently occupies {@link span}. The
 * scan the inspector reads is undebounced and so agrees with the document, but
 * only up to the microtask that carries the edit across — so the consumer
 * compares before it dispatches, and a span that has gone stale drops the edit
 * instead of corrupting text that moved underneath it.
 */
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

/**
 * Every argument is literal, whatever the command byte is.
 *
 * The `"ech=$EF"` case: the head names a macro, the arguments do not, and
 * rewriting them touches only text the author typed.
 */
export function argsRewritable(command: Command): boolean {
	return command.args.length > 0 && command.args.every((arg) => arg.replacement === undefined);
}

/** The whole run is literal — the only state in which the command byte may be rewritten. */
export function commandRewritable(command: Command): boolean {
	return command.replacement === undefined;
}

/**
 * Joins `parts` back together, taking the gaps between them from the source.
 *
 * `texts[i] === null` means "leave this part as written", which is how a
 * single-argument edit is expressed without the caller having to re-render the
 * ones either side of it. Returns `null` when nothing would change, so a control
 * that fires on every frame of a drag cannot push a no-op edit through the
 * compile debounce.
 */
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

/**
 * Rewrites the arguments, leaving the command byte as written.
 *
 * `texts` is one entry per argument; a `null` leaves that one alone. Shorter
 * than the argument list is fine — the rest are left as written.
 */
export function spliceArgs(source: string, command: Command, texts: (string | null)[]): Edit | null {
	return splice(source, partsOf(command), [null, ...texts]);
}

/** Rewrites the command byte itself, which only a wholly literal command permits. */
export function spliceHead(source: string, command: Command, text: string): Edit | null {
	const texts: (string | null)[] = new Array<string | null>(command.args.length + 1).fill(null);
	texts[0] = text;
	return splice(source, partsOf(command), texts);
}

/**
 * Replaces the whole run — command byte, arguments and the text between them.
 *
 * The blunt instrument, for the cases where a command's *shape* changes and no
 * part-by-part edit could express it. Refuses unless the entire run is literal.
 */
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

/**
 * Swaps the entry's sample form — `"kick.brr"` for `@1` for `n1F`.
 *
 * The five bytes after it are untouched, which is the point: changing what a
 * drum is sampled from should not reset the envelope somebody tuned.
 */
export function spliceInstrumentSample(source: string, entry: InstrumentDefinition, text: string): Edit | null {
	const texts: (string | null)[] = new Array<string | null>(entry.bytes.length + 1).fill(null);
	texts[0] = text;
	return splice(source, instrumentParts(entry), texts);
}
