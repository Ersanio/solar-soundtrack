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
 * The one thing it does not say is which drum a note still *sounds* on after
 * the note that loaded it — that travels with the drum byte, so the walk names
 * the loading note (`WalkNote.drumFrom`) and this map is asked about that one.
 *
 * The two sets are disjoint by construction: a command is in the compiler's
 * command map or it is here. `tokentest` asserts it, because a command answered
 * twice would draw two glyphs for one setting.
 */

import { FIRST_PERCUSSION_INSTRUMENT } from "@amk/core/hardcoded-tables";
import type { Command, TokenIndex } from "../tokens";

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
export const LAST_PERCUSSION_INSTRUMENT = FIRST_PERCUSSION_INSTRUMENT + 8;

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
export function isPercussionInstrument(command: Command): boolean {
	const value = command.args[0]?.value ?? -1;
	return (
		command.kind === "@" &&
		command.direct !== true &&
		value >= FIRST_PERCUSSION_INSTRUMENT &&
		value <= LAST_PERCUSSION_INSTRUMENT
	);
}

/**
 * Which slot a command occupies here, or `null` if it is not one of ours.
 *
 * `$DA` is not: it emits, so the walk names it, and it leaves the parser's
 * `instrument[channel]` alone — only `@` writes that (Music.cpp:908), which is
 * why `#6 @21 c $DA $00 d` still folds `d` into a drum byte.
 */
function parseTimeSlot(command: Command): ParseTimeSlot | null {
	if (command.vcmd !== undefined) {
		return null;
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

/** `[` and `]` are one character each, so `[[` and `]]` are two commands touching. */
function touches(first: Command, second: Command | undefined, kind: string): boolean {
	return second?.kind === kind && second.span.start === first.span.end;
}

/** A pitched letter, which is what the drum remap folds into; a rest is left alone. */
function isPitchedNote(command: Command): boolean {
	return command.noteLength !== undefined && command.kind.toLowerCase() !== "r";
}

/**
 * The commands with no bytes of their own that are in force at each note.
 *
 * Keyed by the note's own {@link Command}, which is what `commandAt` returns for
 * a caret and what a roll mark reaches through its source span. A note with none
 * of them is absent rather than present and empty.
 *
 * Each slot is kept the way `parser.ts` keeps the state behind it, so the answer
 * is what went into the bytes and not an approximation of it:
 *
 *   - **`q`** is `q[channel]`, per channel and untouched by a `#N`: a command
 *     written under `#0` says nothing about a note under `#1`, even one written
 *     between them. One written above the first marker is on the starting
 *     channel (`Command.channel`), and that is where `parseQuantization` puts it
 *     even from a `(!1)[ ]` body — it writes `q[prevChannel]` (Music.cpp:684-687),
 *     so `(!1)[q40 …]` above `#0` is the `q` of `#0`'s first note.
 *   - **`h`** is one variable, `hTranspose`, and `parseHash` (Music.cpp:569)
 *     resets it at every `#N` — the one it is already on included. So it is one
 *     slot here, cleared at every marker: an `h` above the first channel reaches
 *     nothing, and a channel declared in two blocks does not carry the first
 *     block's `h` into the second. `gather` raises no command for a `#N` and
 *     `Command.channel` cannot see a channel re-entering itself, so the markers
 *     are read off `index.tokens`; `text` is what says whether one is a real
 *     `#0`-`#7`, since a malformed one is reported and resets nothing (AMK0030,
 *     AMK0031).
 *   - **`@21`-`@29`** is `instrument[channel]`'s drum-ness, which only `@` writes
 *     (Music.cpp:908). A `[` copies it into the loop block and a `]` copies
 *     nothing back (Music.cpp:1239, `parseLoopStart`), so an `@` inside a `[ ]`
 *     is gone at the `]` and one before it is back — `#0 @21 [ @0 c ]2 d` folds
 *     `d` into a drum. And the first pitched note it folds clears it, except on
 *     `#6`/`#7` under `#amk` (Music.cpp:2178-2183): `@21 c d` is one drum byte
 *     and one pitched byte. That is a statement about *folding*. Which drum a
 *     later note still *sounds* on is the walk's — `WalkNote.drumFrom` names the
 *     note whose drum byte loaded it, and this map, asked about that note, names
 *     its `@`.
 */
export function parseTimeInForce(index: TokenIndex, text: string): ReadonlyMap<Command, readonly Command[]> {
	const inForce = new Map<Command, readonly Command[]>();
	const byChannel = new Map<number, Map<ParseTimeSlot, Command>>();
	let transpose: Command | null = null;
	/** The channel's drum `@` while a `[ ]` body works on its copy; `undefined` is "none held". */
	let outsideLoop: { held: Command | undefined } | null = null;
	let frozen: readonly Command[] | null = null;
	let frozenChannel = -1;

	const markers = index.tokens.filter((token) => token.kind === "channel");
	let marker = 0;

	const commands = index.commands;
	for (let i = 0; i < commands.length; i++) {
		const command = commands[i];
		while (marker < markers.length && markers[marker].start < command.span.start) {
			const declared = Number.parseInt(text.slice(markers[marker].start + 1, markers[marker].end), 10);
			if (declared >= 0 && declared <= 7 && transpose !== null) {
				transpose = null;
				frozen = null;
			}

			marker++;
		}

		const channel = command.channel;
		let slots = byChannel.get(channel);
		if (slots === undefined) {
			slots = new Map();
			byChannel.set(channel, slots);
		}

		// `[[ ]]` never leaves the channel (`handleSuperLoopEnter`), so its brackets
		// are stepped over; a lone `[` inside a `[ ]` is AMK0123 and does nothing,
		// as a `]` outside one is AMK0129.
		if (command.kind === "[") {
			if (touches(command, commands[i + 1], "[")) {
				i++;
			} else {
				outsideLoop ??= { held: slots.get("instrument") };
			}

			continue;
		}

		if (command.kind === "]") {
			if (touches(command, commands[i + 1], "]")) {
				i++;
			} else if (outsideLoop !== null) {
				if (outsideLoop.held === undefined) {
					slots.delete("instrument");
				} else {
					slots.set("instrument", outsideLoop.held);
				}

				outsideLoop = null;
				frozen = null;
			}

			continue;
		}

		if (command.noteLength !== undefined) {
			// Shared between consecutive notes for as long as nothing changes, as
			// `WalkNote.origins` is: a run of notes under one state is one array.
			if (frozen === null || frozenChannel !== channel) {
				frozen = PARSE_TIME_SLOTS.flatMap((slot) => {
					const held = slot === "transpose" ? transpose : (slots.get(slot) ?? null);
					// The instrument slot reports only the spelling that emitted
					// nothing; anything else is the walk's to name.
					return held !== null && (slot !== "instrument" || isPercussionInstrument(held)) ? [held] : [];
				});
				frozenChannel = channel;
			}

			if (frozen.length > 0) {
				inForce.set(command, frozen);
			}

			// The drum byte this note became clears the remap behind it, unless the
			// channel is one of the two SFX channels of an AddmusicK song.
			const drum = slots.get("instrument");
			if (
				drum !== undefined &&
				isPercussionInstrument(drum) &&
				isPitchedNote(command) &&
				(command.target.program !== 0 || (channel !== 6 && channel !== 7))
			) {
				slots.delete("instrument");
				frozen = null;
			}

			continue;
		}

		const slot = parseTimeSlot(command);
		if (slot === "transpose") {
			if (transpose !== command) {
				transpose = command;
				frozen = null;
			}
		} else if (slot !== null && slots.get(slot) !== command) {
			slots.set(slot, command);
			frozen = null;
		}
	}

	return inForce;
}
