/**
 * What was in force at a point in the song:
 * - Tempo
 * - Wich velocity table `q` reads against
 *
 * A positional walk over the scanner's commands, not compiler output, so it
 * answers while the song is mid-edit. Same-channel only where that matters —
 * see README.md.
 */

import type { Command, Token } from "./tokens";

/**
 * The tempo in force where a command sits, as it was *written*, or `null` when
 * the song has not set one yet.
 */
export function tempoBefore(command: Command, commands: readonly Command[]): number | null {
	let found: number | null = null;

	for (const other of commands) {
		if (other.span.start >= command.span.start) {
			break;
		}

		if (other.vcmd === 0xe2) {
			found = other.args[0]?.value ?? found;
		} else if (other.vcmd === 0xe3) {
			// `$E3 <duration> <tempo>` — the target is what stands afterwards.
			found = other.args[1]?.value ?? found;
		} else if (other.kind.toLowerCase() === "t" && other.args.length > 0) {
			// `t144` and `t30,80`: the tempo is last either way (`parser.ts:parseTempo`).
			found = other.args[other.args.length - 1].value;
		}
	}

	return found;
}

/** Note and rest letters, whose commands carry a resolved `noteLength`. */
const NOTE_KINDS = new Set(["c", "d", "e", "f", "g", "a", "b", "r"]);

/** How many ticks a command has to work with, taken from the note it rides on. */
export function noteTicksBefore(command: Command, commands: readonly Command[]): number | null {
	let found: number | null = null;

	for (const other of commands) {
		if (other.span.start >= command.span.start) {
			break;
		}

		if (other.channel !== command.channel) {
			continue;
		}

		if (NOTE_KINDS.has(other.kind.toLowerCase()) && other.noteLength) {
			// Tied segments are one note to the driver: `c4^8` keys on once.
			found = other.noteLength.reduce((total, segment) => total + segment.ticks, 0);
		}
	}

	return found;
}

/** Which velocity table is live where a command was written; SMW's or N-SPC's. */
export function velocityTableAt(command: Command, tokens: Token[], text: string): "smw" | "nspc" {
	// parser.ts:applyTarget — the default the dialect sets, before any #option.
	let smw = command.target.program !== 0 || command.target.amkVersion < 2;

	for (const token of tokens) {
		if (token.start >= command.span.start) {
			break;
		}

		if (token.kind !== "directive") {
			continue;
		}

		if (text.slice(token.start, token.end).toLowerCase() !== "#option") {
			continue;
		}

		const rest = text.slice(token.end).trimStart().toLowerCase();
		if (rest.startsWith("smwvtable")) {
			smw = true;
		} else if (rest.startsWith("nspcvtable")) {
			smw = false;
		}
	}

	return smw ? "smw" : "nspc";
}
