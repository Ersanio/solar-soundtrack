/**
 * What was in force at a point in the song:
 * - Tempo
 * - Which velocity table `q` reads against, from the hex as well as the directives
 *
 * A positional walk over the scanner's commands, not compiler output, so it
 * answers while the song is mid-edit. Same-channel only where that matters —
 * see README.md.
 */

import type { Command, TokenIndex } from "./tokens";

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

/**
 * Which velocity table is live where a command was written; SMW's or N-SPC's.
 *
 * Four things write it, and this reads all four, because what it answers is the
 * driver's `!SecondVTable` (ARAM `$6F`) rather than the compiler's own
 * `usingSMWVTable` — which AddmusicK leaves stale when the song writes the hex
 * by hand, and which is the one place the two disagree.
 *
 * Not filtered by channel: `$6F` is a single global byte, so a switch in `#1`
 * is heard in `#0`. That takes the across-channel caveat README.md states, for
 * the same reason {@link tempoBefore} takes it.
 */
export function velocityTableAt(command: Command, index: TokenIndex, text: string): "smw" | "nspc" {
	const before = command.span.start;
	const switches: { at: number; smw: boolean }[] = [];

	for (const token of index.tokens) {
		if (token.start >= before) {
			break;
		}

		if (token.kind !== "directive") {
			continue;
		}

		const word = text.slice(token.start, token.end).toLowerCase();
		if (word === "#louder") {
			// parser.ts:parseLouderCommand emits $F4 $08, which is N-SPC only.
			switches.push({ at: token.start, smw: false });
			continue;
		}

		if (word !== "#option") {
			continue;
		}

		const rest = text.slice(token.end).trimStart().toLowerCase();
		if (rest.startsWith("smwvtable")) {
			switches.push({ at: token.start, smw: true });
		} else if (rest.startsWith("nspcvtable")) {
			switches.push({ at: token.start, smw: false });
		}
	}

	for (const other of index.commands) {
		if (other.span.start >= before) {
			break;
		}

		if (other.vcmd === 0xfa && other.args[0]?.value === 0x06) {
			// Commands.asm:1087 stores the argument as written, and main.asm:2373
			// compares it against zero — so every other value is the N-SPC table.
			switches.push({ at: other.span.start, smw: (other.args[1]?.value ?? 0) === 0 });
		} else if (other.vcmd === 0xf4 && other.args[0]?.value === 0x08) {
			// Commands.asm:610 stores #$01 outright, so this one cannot switch back.
			switches.push({ at: other.span.start, smw: false });
		}
	}

	// Both lists are sorted, but they interleave, and taking the later of two
	// separate walks would answer a song that switches more than twice wrongly.
	// Filtered first, so what gets sorted is the handful of switches, not the song.
	switches.sort((a, b) => a.at - b.at);

	// Nothing switched it, so it stands as parser.ts:applyTarget set it.
	return (switches[switches.length - 1]?.smw ?? (command.target.program !== 0 || command.target.amkVersion < 2))
		? "smw"
		: "nspc";
}
