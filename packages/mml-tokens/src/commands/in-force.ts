/**
 * Which commands act on a note, and which of them the source alone can answer.
 *
 * Two questions live here, and they are not the same one.
 *
 * **What a command reaches.** {@link commandScope} sorts every spelling into
 * the state a note sounds under, the song's own settings, where a note sits, and
 * the shape of the music. Nothing else in the package classifies commands that
 * way — `param.ts`'s `Role` is about one argument's units, and the palette's
 * `Category` is about which strip a button appears on.
 *
 * **Which one is in force.** For anything that emits a VCMD the answer is a fact
 * about execution, not about the text: a `[ ]` body, a `[[ ]]` subloop and a
 * `(1)n` call all replay one run of bytes under whatever state reached them, so
 * `v255 (1)[ c ]2 v200 (1)5` plays the same written `c` under two volumes. Only a
 * walk of the emitted stream can say which, and `@amk/spc/song-walk` does —
 * `CompileResult.commandMap` turns the address it reports back into source.
 *
 * {@link parseTimeInForce} covers the rest, and it covers them **exactly** rather
 * than approximately. `q`, `h` and `@21`-`@29` emit nothing of their own: they
 * fold into the notes that follow, `q` into each note's duration byte and the
 * other two into the note byte itself. `parser.ts` does that folding in one
 * textual pass with its own per-channel state, so the `q` in force at a note is
 * the `q` written before it on that channel — whatever loop the note sits in,
 * and however many times it is played, because the answer was decided once and
 * baked into the bytes. This is the same rule `echo-hazards.ts` and
 * `fir-override.ts` walk under, applied where it happens to be the whole truth.
 *
 * The two sets are disjoint by construction: a command is in the compiler's
 * command map or it is here. `tokentest` asserts it, because a command answered
 * twice would draw two glyphs for one setting.
 */

import { FIRST_PERCUSSION_INSTRUMENT } from "@amk/core/hardcoded-tables";
import type { Command } from "../tokens";

/** How far a command reaches, and therefore whether a note is the thing it acts on. */
export type CommandScope =
	/** Channel state a later note sounds under: `@`, `v`, `q`, `$ED`, `$DE`. */
	| "note-state"
	/** The song's own settings, heard on every channel at once: `t`, `w`, `$E4`, the echo unit. */
	| "song"
	/** Where a note sits or how long it lasts: `o`, `<`, `>`, `l`. */
	| "position"
	/** Notes themselves, and the shape around them: `[`, `]`, `*`, `$E9`, `(!n,`. */
	| "structure";

/** `@21`-`@29`, the nine drums, which emit no `$DA` (`parser.ts:1816-1847`). */
const LAST_PERCUSSION_INSTRUMENT = FIRST_PERCUSSION_INSTRUMENT + 8;

const SONG_VCMDS = new Set([
	0xe0, // global volume
	0xe1, // global volume fade
	0xe2, // tempo
	0xe3, // tempo fade
	0xe4, // global transpose
	// One DSP holds one echo unit, so all five reach every channel however they
	// are written — the reasoning `README.md` already gives for `$F5` and `$F1`.
	0xef,
	0xf0,
	0xf1,
	0xf2,
	0xf5,
	// A register, a byte and two output ports: each is written once and nothing
	// later reads it back as this channel's state.
	0xf6,
	0xf7,
	0xf9,
]);

/** `$E6` and `$E9` are what `[[ ]]` and `[ ]` compile to; `$FC` is a remote call. */
const STRUCTURE_VCMDS = new Set([0xe6, 0xe9, 0xfc]);

const SONG_LETTERS = new Set(["t", "w"]);
const POSITION_LETTERS = new Set(["o", "l", "<", ">"]);
const STRUCTURE_LETTERS = new Set(["[", "]", "*"]);

export function commandScope(command: Command): CommandScope {
	if (command.vcmd !== undefined) {
		if (SONG_VCMDS.has(command.vcmd)) {
			return "song";
		}

		return STRUCTURE_VCMDS.has(command.vcmd) ? "structure" : "note-state";
	}

	// A note, a rest or a tie. `gather` gives these — and only these — segments.
	if (command.noteLength !== undefined) {
		return "structure";
	}

	const kind = command.kind.toLowerCase();
	if (SONG_LETTERS.has(kind)) {
		return "song";
	}

	if (POSITION_LETTERS.has(kind)) {
		return "position";
	}

	return STRUCTURE_LETTERS.has(kind) ? "structure" : "note-state";
}

/** The slots {@link parseTimeInForce} keeps, in the order it reports them. */
type ParseTimeSlot = "instrument" | "quantization" | "transpose";

const PARSE_TIME_SLOTS: readonly ParseTimeSlot[] = ["instrument", "quantization", "transpose"];

/**
 * Whether an `@` is one the compiler resolves rather than emits.
 *
 * `@21`-`@29` set the percussion remap and write no `$DA`, so the walk never
 * sees them; `@@21` is the direct form and does emit one, which is why the
 * spelling matters and not only the number.
 */
function isPercussionInstrument(command: Command): boolean {
	const value = command.args[0]?.value ?? -1;
	return command.direct !== true && value >= FIRST_PERCUSSION_INSTRUMENT && value <= LAST_PERCUSSION_INSTRUMENT;
}

/** Which slot a command occupies here, or `null` if it is not one of ours. */
function parseTimeSlot(command: Command): ParseTimeSlot | null {
	if (command.vcmd !== undefined) {
		// `$DA` is the emitted spelling of `@`, and it takes the slot away from a
		// percussion `@` written before it: whichever came last is in force, and
		// only the walk can name that one.
		return command.vcmd === 0xda ? "instrument" : null;
	}

	switch (command.kind.toLowerCase()) {
		case "@":
			return "instrument";
		case "q":
			return "quantization";
		case "h":
			return "transpose";
		default:
			return null;
	}
}

/**
 * The commands with no bytes of their own that are in force at each note.
 *
 * Keyed by the note's own {@link Command}, which is what `commandAt` returns for
 * a caret and what a roll mark reaches through its source span. A note with none
 * of them is absent rather than present and empty.
 *
 * Channel-scoped, because that is how `parser.ts` keeps `q` and the transpose:
 * a command written under `#0` says nothing about a note under `#1`, even one
 * written between them.
 */
export function parseTimeInForce(commands: readonly Command[]): ReadonlyMap<Command, readonly Command[]> {
	const inForce = new Map<Command, readonly Command[]>();
	const byChannel = new Map<number, Map<ParseTimeSlot, Command>>();
	let frozen: readonly Command[] | null = null;
	let frozenChannel = -1;

	for (const command of commands) {
		// Before the first `#0` nothing is on a channel, so nothing it writes can
		// reach a note — which is what keeps a `(!1)[ … ]` body out of the answer.
		const channel = command.channel;
		if (channel === undefined) {
			continue;
		}

		let slots = byChannel.get(channel);
		if (slots === undefined) {
			slots = new Map();
			byChannel.set(channel, slots);
		}

		if (command.noteLength !== undefined) {
			// Shared between consecutive notes for as long as nothing changes, as
			// `WalkNote.origins` is: a run of notes under one state is one array.
			if (frozen === null || frozenChannel !== channel) {
				frozen = PARSE_TIME_SLOTS.flatMap((slot) => {
					const held = slots.get(slot);
					// The instrument slot reports only the spelling that emitted
					// nothing; anything else is the walk's to name.
					return held !== undefined && (slot !== "instrument" || isPercussionInstrument(held)) ? [held] : [];
				});
				frozenChannel = channel;
			}

			if (frozen.length > 0) {
				inForce.set(command, frozen);
			}

			continue;
		}

		const slot = parseTimeSlot(command);
		if (slot !== null && slots.get(slot) !== command) {
			slots.set(slot, command);
			frozen = null;
		}
	}

	return inForce;
}
