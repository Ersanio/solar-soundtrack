import type { Command, Token, TokenIndex } from "./tokens";
import type { Diagnostic, Span } from "@amk/core/types";
import { commandScope, isPercussionInstrument } from "./commands/in-force";

/**
 * Diagnostics for bytes that compile without a word and then break the song.
 *
 * Three findings, and what puts them together is that the compiler is silent on
 * all three: `$F7` is a command this driver never implemented, a `$DD` the
 * read-ahead cannot reach is dispatched into the same empty slot, and `#am4`
 * rewrites a `$E4` on its way past. AddmusicK builds every one of them cleanly,
 * so nothing here can be an `AMK` code.
 *
 * A pure pass over the scanner's output, as `echo-hazards.ts` is, and read off
 * the undebounced scan for the same reason: a byte written in the wrong place is
 * wrong on the keystroke that writes it rather than a compile later.
 *
 * It takes the whole {@link TokenIndex} where `echoHazards` takes the command
 * list, because the two ask different questions. That one asks what was last
 * _set_, where a loop call changes nothing; this one asks what stands
 * _adjacent_, where it changes everything — and `(`, `)` and `(!` are `label`
 * tokens that raise no {@link Command} at all, so the command list alone cannot
 * see a `(1)3` written between a note and its slide.
 */

/** `$F7`, whose body `Commands.asm:633` leaves commented out. */
const CODE_DEAD_VCMD = "SST0506";

/** A `$DD` no note's read-ahead picks up, so the command loop reaches it. */
const CODE_STRANDED_BEND = "SST0507";

/** `#am4`'s silent `$E4` offset (`parser.ts:3203`, Music.cpp:1863). */
const CODE_AM4_TRANSPOSE = "SST0508";

/**
 * The shortest frame a `$DD` can ride on.
 *
 * The read-ahead is skipped on any tick that fetches music data
 * (`main.asm:2337-2339`), so every tick of a one-tick frame fetches and the peek
 * never runs at all. Lives here so the bend inspector and the diagnostic state
 * the rule once.
 */
export const MIN_BEND_TICKS = 2;

/** What stands in front of a `$DD`, and therefore whether it arms. */
export type BendAnchor =
	/** A note or rest of {@link MIN_BEND_TICKS} or more: the read-ahead arms the slide. */
	| { kind: "rides"; ticks: number }
	/** One tick, so no read-ahead ever runs on it. */
	| { kind: "tooShort"; ticks: number }
	/** Something writing bytes stands between the note and the command. */
	| { kind: "blocked"; by: { name: string; span: Span } }
	/** Nothing precedes it on the channel. */
	| { kind: "nothing" };

/**
 * Whether a command writes no bytes, and so leaves a `$DD` where the note left it.
 *
 * `q`, `h` and `@21`-`@29` fold into the notes that follow rather than emitting
 * anything of their own (`commands/in-force.ts`), and `o` and `l` are resolved at
 * parse time; `<` and `>` are never gathered as commands, so they cannot reach
 * here. Everything else that is a {@link Command} emits.
 */
function emitsNothing(command: Command): boolean {
	if (command.vcmd !== undefined) {
		return false;
	}

	if (commandScope(command) === "position") {
		return true;
	}

	const kind = command.kind.toLowerCase();
	return kind === "q" || kind === "h" || isPercussionInstrument(command);
}

/** A `label` token — a `(n)m` or a `(!n)` — written strictly between two offsets. */
function callBetween(tokens: readonly Token[], from: number, to: number): Token | null {
	return tokens.find((token) => token.kind === "label" && token.start >= from && token.end <= to) ?? null;
}

/**
 * What a `$DD` rides on, or why it rides on nothing.
 *
 * `$DD` is not dispatched: the note before it reads it by peeking at the byte
 * standing at the track pointer (`main.asm:L_10E4`), and its own dispatch slot
 * holds `$0000`. So the question is a _byte adjacency_, and three things break
 * it — nothing in front of it, something emitting in front of it, and a frame
 * too short for the peek to run in.
 *
 * The anchor is the note's **last** segment rather than the sum of them.
 * `accumulateTiedLength` rewinds a tie out of a `$DD`'s way (`parser.ts:2895-2909`,
 * Music.cpp:2224), so `c4^8 $DD` emits the tie as its own `[24][$C6]` frame and
 * `$70+x` is reloaded from it (`main.asm:2440-2441`) — 24 ticks is what the peek
 * gets, not 72.
 *
 * A rest anchors a bend as a note does: `$C7` goes through the same note path
 * (`main.asm:2393-2441`) and sets the same counters, so `c4 r4 $DD` arms a slide
 * on a keyed-off voice and is merely inaudible rather than fatal.
 *
 * An earlier `$DD` clears the answer twice over — its four bytes come between the
 * note and this command, and its last parameter may be a written note that keys
 * nothing on, `parseNote` appending that byte and returning. A chained `$DD`
 * really does have no note in front of it.
 *
 * Two limits, stated rather than modelled, both of which need the walk to see.
 * `#halvetempo` halves every note in the compiler (`parser.ts:2855`) and this
 * package has no tempo ratio, so a written two-tick note can be a one-tick
 * emitted one. And `emitNote` chunks a note of `$80` ticks or more into frames,
 * so a 129-tick note ends in a one-tick frame that never arms.
 * `WalkNote.bend.frameTicks` is the authority for both.
 */
export function bendAnchor(command: Command, index: TokenIndex): BendAnchor {
	const { commands, tokens } = index;
	const targets = new Set(
		commands.flatMap((other) => (other.noteTarget === undefined ? [] : [other.noteTarget.span.start])),
	);
	// A `(!n)[ … ]` body compiles to the loop block, so nothing in it is adjacent
	// to the channel's own stream. `gather` marks the body and both brackets.
	const remote = command.inRemoteDefinition ?? false;

	let anchor: Command | null = null;
	let blocker: Command | null = null;

	for (const other of commands) {
		if (other.span.start >= command.span.start) {
			break;
		}

		if (
			other.channel !== command.channel ||
			(other.inRemoteDefinition ?? false) !== remote ||
			targets.has(other.span.start)
		) {
			continue;
		}

		if (other.vcmd === 0xdd) {
			anchor = null;
			blocker = null;
		} else if (other.noteLength !== undefined) {
			anchor = other;
			blocker = null;
		} else if (!emitsNothing(other)) {
			blocker = other;
		}
	}

	// Asked before the blocker, because nothing can stand *between* the command
	// and a note that is not there. It is what the head of a `(!n)[ … ]` body
	// answers: `gather` marks the definition’s own brackets as part of it, so the
	// opening one is otherwise read as a command written in front of the slide.
	if (anchor === null) {
		return { kind: "nothing" };
	}

	if (blocker !== null) {
		return { kind: "blocked", by: { name: blocker.name, span: { ...blocker.span } } };
	}

	// `(!` is two characters and `(` is one, which is the only thing separating a
	// remote call from a loop call without the source text to read.
	const call = callBetween(tokens, anchor.span.end, command.span.start);
	if (call !== null) {
		return {
			kind: "blocked",
			by: {
				name: call.end - call.start === 2 ? "remote call" : "loop call",
				span: { start: call.start, end: call.end, line: call.line },
			},
		};
	}

	const segments = anchor.noteLength ?? [];
	const ticks = segments[segments.length - 1]?.ticks ?? 0;
	return ticks >= MIN_BEND_TICKS ? { kind: "rides", ticks } : { kind: "tooShort", ticks };
}

/** What the slide does instead of sliding, and the way out. One line per way it fails. */
function describeBend(anchor: BendAnchor): string {
	const dies = "so the $DD runs as a command, jumps to address zero and the song stops.";

	switch (anchor.kind) {
		case "nothing":
			return `No note plays before this $DD on the channel, ${dies} Write it directly after a note of two ticks or more.`;
		case "blocked":
			return (
				`The ${anchor.by.name} written between this $DD and the note before it is what the driver reads instead` +
				` — the read-ahead only ever looks at the very next byte — ${dies} Move it to directly after the note.`
			);
		case "tooShort":
			return `The note before this $DD lasts one tick, and the read-ahead cannot run on the tick a note begins, ${dies} Give that note two ticks or more.`;
		case "rides":
			return "";
	}
}

/**
 * Every command in the document that compiles clean and then misbehaves.
 *
 * Nothing here waits for `complete`, where `echoHazards` does. That guard is
 * about a warning flashing through the middle of writing a good command, and no
 * argument redeems a `$F7` or moves a `$DD` off the byte in front of it, so
 * there is no half-written state either finding would be wrong about.
 */
export function commandHazards(index: TokenIndex): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];

	for (const command of index.commands) {
		if (command.vcmd === 0xf7) {
			diagnostics.push({
				severity: "severe",
				code: CODE_DEAD_VCMD,
				message:
					"$F7 was never implemented in this driver: its dispatch slot is $0000, so the SPC jumps to address zero and the song stops. AddmusicK compiles it without a word. There is no working form of this command — remove it.",
				span: { ...command.span },
			});
			continue;
		}

		if (command.vcmd === 0xdd) {
			const anchor = bendAnchor(command, index);
			if (anchor.kind !== "rides") {
				diagnostics.push({
					severity: "severe",
					code: CODE_STRANDED_BEND,
					message: describeBend(anchor),
					span: { ...command.span },
				});
			}

			continue;
		}

		// Below `$F2`, so the non-native warning never covers it either.
		if (command.vcmd === 0xe4 && command.target.program === 1) {
			diagnostics.push({
				severity: "warning",
				code: CODE_AM4_TRANSPOSE,
				message:
					"Under #am4 the compiler adds one to this transpose, so it lands a semitone above what is written. AddmusicK does this in silence — write one less than you want.",
				span: { ...command.span },
			});
		}
	}

	return diagnostics;
}
