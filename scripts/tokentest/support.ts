/** What the `tokentest` sections share: `at`, `said`, `tokenAt`, `lengthOf` and `inForceAt`. */

import "../localize";
import { type Token, commandAt, commandStartingAt, tokenize } from "@amk/tokens";
import { parseTimeInForce } from "@amk/tokens/commands/in-force";
import type { BendAnchor } from "@amk/tokens/command-hazards";

export const at = (text: string, offset: number) => commandAt(tokenize(text).commands, offset);

/**
 * One string per {@link BendAnchor}, so a case reads as what the driver finds.
 *
 * `blocked` carries the command's name rather than its span: what the diagnostic
 * says is which command the driver read instead, and a span would pin the
 * harness to offsets that move whenever a case's text is edited.
 */
export function said(anchor: BendAnchor): string {
	switch (anchor.kind) {
		case "rides":
			return `rides:${anchor.frame}`;
		case "tooShort":
			return `tooShort:${anchor.ticks}`;
		case "blocked":
			return `blocked:${anchor.by.name}`;
		case "nothing":
			return "nothing";
	}
}

/**
 * The token containing `offset`, notes included.
 *
 * Lives here because only these checks ask the question. The app maps a
 * position to a whole *command* through {@link commandAt} — that is what the
 * inspector and the hover show — and nothing in it needs a single token back
 * out of the list. Most of what follows is phrased as "what did the scanner
 * call this character", though, so the harness needs the lookup even when the
 * package does not.
 *
 * Half-open, unlike {@link commandAt}, which is end-inclusive so a caret parked
 * after the last argument still inspects the command it just finished. Here the
 * boundary belongs to exactly one token, which the pair of checks either side of
 * a note's end pins.
 */
export function tokenAt(tokens: Token[], offset: number): Token | null {
	let low = 0;
	let high = tokens.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const token = tokens[mid];
		if (offset < token.start) {
			high = mid - 1;
		} else if (offset >= token.end) {
			low = mid + 1;
		} else {
			return token;
		}
	}

	return null;
}

/** The length of the note or rest written at `needle` — `undefined` for anything else. */
export const lengthOf = (source: string, needle: string) => at(source, source.indexOf(needle))?.noteLength;

/**
 * What the parse-time half says is in force at the note written as `text`, as
 * the source spells the commands, space-joined.
 */
export function inForceAt(source: string): (text: string) => string {
	const index = tokenize(source);
	const inForce = parseTimeInForce(index, source);
	return (text) => {
		const note = commandStartingAt(index.commands, source.indexOf(text));
		if (note === null) {
			throw new Error(`no command at ${text}`);
		}

		return (inForce.get(note) ?? []).map((command) => source.slice(command.span.start, command.span.end)).join(" ");
	};
}
