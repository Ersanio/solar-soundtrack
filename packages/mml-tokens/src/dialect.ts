/**
 * What was in force at a point in the song:
 * - Which dialect the `#amk` / `#am4` / `#amm` markers put it in
 * - Tempo
 * - Which velocity table `q` reads against, from the hex as well as the directives
 *
 * A walk over the scanner's commands, not compiler output, so it answers while
 * the song is mid-edit. Positional, and same-channel only, where that matters —
 * see README.md. The dialect is the exception: the markers are resolved over the
 * whole file, because that is what `preprocess.ts` does with them.
 */

import { type Command, type CommandTarget, DEFAULT_TARGET, type TokenIndex } from "./tokens";

/**
 * The dialect the whole song compiles as — a marker anywhere in the file, not
 * only above the caret.
 *
 * `preprocess.ts` runs over the entire text before the parser starts, so the
 * file's last effective marker governs every line of it, a `#amk 2` on the last
 * line included. That is not the reading {@link Command.target} takes, and the
 * difference is not a lapse in either: `scanHex` decides how many argument bytes
 * a hex command swallows as it meets them, and `#am4`'s `$ED` and `#amk 1`'s
 * `$FC` swallow different numbers — so a command already scanned has to keep
 * answering for the marker that was standing when it was scanned, which is what
 * `tokentest` pins. This is for the other question, asked about text that does
 * not exist yet: what will AddmusicK make of what I am about to write.
 *
 * The last transition is the whole answer. `tokenize` records one wherever the
 * scanner's own two fields change, and those fields carry `scanHash`'s
 * precedence rules — a later `#amk` losing to an earlier `#am4`, the last of two
 * `#amk` lines winning — so the value they hold at the end of the document is
 * the value `preprocess` arrives at.
 */
export function songTarget(index: TokenIndex): CommandTarget {
	return index.targets[index.targets.length - 1]?.target ?? DEFAULT_TARGET;
}

/** The three markers, as `scanHash` lower-cases them. */
const TARGET_MARKERS = new Set(["#amk", "#am4", "#amm"]);

/**
 * Whether the song declares a target marker at all.
 *
 * Not answerable from {@link songTarget}: a transition is recorded only where
 * the dialect *changes*, and `#amk 4` changes nothing — it is already
 * {@link DEFAULT_TARGET}. So a song that declares the default correctly and one
 * that declares nothing at all produce the same empty list, and only the marker
 * itself tells them apart. AddmusicK rejects the second outright (AMK0002,
 * `parser.ts:applyTarget`), which is worth saying rather than assuming.
 */
export function hasDialectMarker(index: TokenIndex, text: string): boolean {
	return index.tokens.some(
		(token) => token.kind === "directive" && TARGET_MARKERS.has(text.slice(token.start, token.end).toLowerCase()),
	);
}

/**
 * Where the first `#0`-`#7` is, or `null` when the song has none yet.
 *
 * `parser.ts:parseOpenParen` (Music.cpp:1015) tells a remote code *definition*
 * from a *call* by nothing but this: `channelDefined` latches on the first
 * channel and never clears, so `(!1)[…]` above it defines and below it is read
 * as a call. Nothing else in the language depends on the boundary, which is why
 * this is a position rather than a flag on `ScanState`.
 */
export function channelsBeginAt(index: TokenIndex): number | null {
	return index.tokens.find((token) => token.kind === "channel")?.start ?? null;
}

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

/**
 * How many ticks a command has to work with, taken from the note it rides on.
 *
 * Asked only of `$DD`, which is read by the preceding note's read-ahead rather
 * than dispatched — `main.asm:L_10E4` peeks at the byte standing at the track
 * pointer. So an earlier `$DD` clears the answer twice over: its four bytes come
 * between the note and this command, and its last parameter may be a written
 * note that keys nothing on, `parseNote` appending that byte and returning
 * (`parser.ts:parseNote`). A chained `$DD` really does have no note in front of
 * it. Nothing else standing in the way is accounted for — a `v` between the two
 * breaks the read-ahead just as surely, and that is the panel's gap to close
 * rather than this one's to guess at.
 */
export function noteTicksBefore(command: Command, commands: readonly Command[]): number | null {
	let found: number | null = null;
	const targets = new Set(
		commands.flatMap((other) => (other.noteTarget === undefined ? [] : [other.noteTarget.span.start])),
	);

	for (const other of commands) {
		if (other.span.start >= command.span.start) {
			break;
		}

		if (other.channel !== command.channel || targets.has(other.span.start)) {
			continue;
		}

		if (other.vcmd === 0xdd) {
			found = null;
		} else if (NOTE_KINDS.has(other.kind.toLowerCase()) && other.noteLength) {
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
