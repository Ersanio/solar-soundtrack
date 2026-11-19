/** The command hazards: commands that compile clean and misbehave — `$F7`'s dead slot, an unreachable `$DD`, `#am4`'s `$E4`, an arpeggio's dead loop points. */

import type { Command, NoteLengthSegment, Token, TokenIndex } from "./tokens";
import type { Diagnostic, Span } from "@amk/core/types";
import { noteFrames, VCMD } from "@amk/core/hardcoded-tables";
import { SST } from "@amk/core/messages/sst";
import { commandScope, isPercussionInstrument } from "./commands/in-force";

/**
 * Diagnostics for bytes that compile without a word and then break the song.
 *
 * Four findings, and what puts them together is that the compiler is silent on
 * all four: `$F7` is a command this driver never implemented, a `$DD` the
 * read-ahead cannot reach is dispatched into the same empty slot, `#am4`
 * rewrites a `$E4` on its way past, and an `$FB` list keeps only the last of its
 * loop points. AddmusicK builds every one of them cleanly, so nothing here can
 * be an `AMK` code.
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

/** `#am4`'s silent `$E4` offset (`parser.ts:3086`, Music.cpp:1863). */
const CODE_AM4_TRANSPOSE = "SST0508";

/** An `$FB` list with loop points before its last, which the driver steps over. */
const CODE_DEAD_LOOP_POINTS = "SST0517";

/** The byte that marks a loop point in an `$FB` list (`Commands.asm:1212-1213`). */
const ARPEGGIO_LOOP_POINT = 0x80;

/**
 * The entries of each loop point an `$FB` list holds before its last, which the driver passes over
 * without a step, or `[]` where there are none to report.
 *
 * Stepping onto a `$80` sets the loop point to the entry after it and reads on at once
 * (`Commands.asm:1211-1220`), and a key-on puts the index back to the start but leaves the loop
 * point where it was (`main.asm:2417-2423`). A sequence wraps only once its index reaches the
 * count, past every marker, so the loop point in force at every wrap is the one after the last,
 * and an earlier marker takes no step and changes nothing.
 *
 * A list that is nothing but markers, or ends in one, is left to the arpeggio inspector, which names
 * those as the hazards they are; so is a list still being written, whose last entry is not yet known.
 */
export function deadLoopPoints(command: Command): number[] {
	const count = command.args[0]?.value ?? 0;
	if (command.vcmd !== VCMD.Arpeggio || !command.complete || count === 0 || count >= 0x80) {
		return [];
	}

	const entries = command.args.slice(2).map((arg) => arg.value);
	const markers = entries.flatMap((value, index) => (value === ARPEGGIO_LOOP_POINT ? [index] : []));
	const last = markers[markers.length - 1];
	if (markers.length < 2 || markers.length === entries.length || last === entries.length - 1) {
		return [];
	}

	return markers.slice(0, -1);
}

/**
 * The shortest frame a `$DD` can ride on.
 *
 * The read-ahead is skipped on any tick that fetches music data
 * (`main.asm:2337-2339`), so every tick of a one-tick frame fetches and the peek
 * never runs at all. Lives here so the bend inspector and the diagnostic state
 * the rule once.
 */
export const MIN_BEND_TICKS = 2;

/** Where the pitch stands when the read-ahead picks a slide up, which is what the slide departs from. */
export type SlideFrom =
	/** The note last keyed on, or the rest that keyed it off: the pitch is that note's byte. */
	| { kind: "note"; span: Span }
	/**
	 * A `$DD` armed since that key-on, which has run to its end: the pitch is its target, `null`
	 * when the target is written as a note.
	 */
	| { kind: "slide"; span: Span; target: number | null };

/**
 * What stands in front of a `$DD`, and therefore whether it arms.
 *
 * `note` is the note, rest or tie whose frame the read-ahead reads it in — the one in front of a
 * blocker for `blocked`. `from` is where the pitch stands then, which is what the bend inspector
 * draws the slide from; `null` for a tie with no note before it on the channel.
 */
export type BendAnchor =
	/**
	 * The read-ahead arms the slide on tick `arms` of a frame of {@link MIN_BEND_TICKS} or more: 1
	 * straight after the note, later behind a slide still running. `window` is how many ticks it
	 * then has before a key-on resets it, and `lead` how many ticks of the note sounding come before
	 * that frame, so the arm is `lead + arms` ticks into it.
	 */
	| { kind: "rides"; note: Span; from: SlideFrom | null; frame: number; lead: number; arms: number; window: number }
	/**
	 * The last frame is one tick, so no read-ahead ever runs on it. `ticks` is the length that was
	 * cut into frames, and `tied` whether that length is a tie.
	 */
	| { kind: "tooShort"; note: Span; from: SlideFrom | null; ticks: number; tied: boolean }
	/** Something writing bytes stands between the note and the command. */
	| { kind: "blocked"; note: Span; from: SlideFrom | null; by: { name: string; span: Span } }
	/** A slide armed before it is still running when the frame ends, so the read-ahead never looks. */
	| { kind: "crowded"; note: Span; from: SlideFrom | null }
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

/**
 * The first `label` token of a `(n)m`, a `(!n, …)` or a `(!!n)` written strictly between two
 * offsets, named as the palette names it. `(!` scans as a one-character `(` with an `unknown` `!`
 * hard against it, and `(!!` with two, so the tokens after the label are what tell them apart.
 */
function callBetween(tokens: readonly Token[], from: number, to: number): { token: Token; name: string } | null {
	let at = tokenIndexAt(tokens, from);
	while (at < tokens.length && tokens[at].start < to && (tokens[at].kind !== "label" || tokens[at].end > to)) {
		at++;
	}

	if (at >= tokens.length || tokens[at].start >= to) {
		return null;
	}

	const bang = (n: number): boolean => {
		const before = tokens[at + n - 1];
		const token = tokens[at + n];
		return token?.start === before.end && token.kind === "unknown";
	};

	const name = !bang(1) ? "loop call" : bang(2) ? "remote code reset" : "remote code call";
	return { token: tokens[at], name };
}

/** The index of the first token starting at or after `offset`. */
function tokenIndexAt(tokens: readonly Token[], offset: number): number {
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (tokens[middle].start < offset) {
			low = middle + 1;
		} else {
			high = middle;
		}
	}

	return low;
}

/** A slide steps only on ticks that fetch no music data (`main.asm:2337-2339`), so a frame gives it one fewer than it lasts. */
function roomIn(frames: readonly number[]): number {
	return frames.reduce((sum, frame) => sum + Math.max(frame - 1, 0), 0);
}

/**
 * The frames a note, rest or tie run ending at `end` is emitted as, and the length the last of
 * them was cut from.
 *
 * `accumulateTiedLength` folds a run into one note, but gives its last segment up as a note of its
 * own to a `$DD` written straight after it (`parser.ts:2813-2827`, Music.cpp:2224) — comments are
 * gone by then, and anything else in between keeps the run whole. `emitNote` then writes a length
 * of `$80` ticks or more in `$60`-tick pieces.
 */
function framesOf(
	segments: readonly NoteLengthSegment[],
	end: number,
	tokens: readonly Token[],
	bends: ReadonlySet<number>,
): { frames: number[]; cut: number; split: boolean } {
	let at = tokenIndexAt(tokens, end);
	while (tokens[at]?.kind === "comment") {
		at++;
	}

	const total = segments.reduce((sum, segment) => sum + segment.ticks, 0);
	const last = segments[segments.length - 1]?.ticks ?? 0;
	const next = tokens[at];
	if (segments.length > 1 && next !== undefined && bends.has(next.start)) {
		return { frames: [...noteFrames(total - last), ...noteFrames(last)], cut: last, split: true };
	}

	return { frames: noteFrames(total), cut: total, split: false };
}

/**
 * The read-ahead ticks a slide keeps `$90+x` non-zero for, the one it arms on included, which is
 * how long a `$DD` written after it waits. The delay counts down first and then the steps
 * (`main.asm:558-576`). A duration of `$00` is decremented past zero into 255 more steps when there
 * is no delay, and with one leaves `$90+x` zero on the next tick. A duration not yet written holds
 * nothing back.
 */
function occupancy(command: Command): number {
	const delay = command.args[0]?.value ?? 0;
	const duration = command.args[1]?.value;
	if (duration === undefined) {
		return 1;
	}

	if (duration === 0) {
		return delay === 0 ? 256 : 1;
	}

	return delay + duration;
}

/**
 * The ticks a slide armed on tick `arms` of a frame of `frame` has before a key-on overwrites it
 * (`main.asm:465-466`).
 *
 * A tie written after the command keys nothing on, so each one adds its frames. A note, a rest, the
 * next `$DD` or a loop ends the count; a rest leaves the slide running, but on a keyed-off voice.
 */
function slideWindow(
	command: Command,
	index: TokenIndex,
	bends: ReadonlySet<number>,
	frame: number,
	arms: number,
): number {
	const { commands, tokens, ties } = index;
	const remote = command.inRemoteDefinition ?? false;
	const ours = (other: { channel: number; inRemoteDefinition?: boolean }): boolean =>
		other.channel === command.channel && (other.inRemoteDefinition ?? false) === remote;

	const stop =
		commands.find(
			(other) =>
				other.span.start >= command.span.end &&
				ours(other) &&
				(other.vcmd === VCMD.PitchBend || commandScope(other) === "structure"),
		) ?? null;
	let at = tokenIndexAt(tokens, command.span.end);
	while (at < tokens.length && tokens[at].kind !== "label") {
		at++;
	}

	const end = Math.min(stop?.span.start ?? Infinity, tokens[at]?.start ?? Infinity);
	const roomOf = (segments: readonly NoteLengthSegment[], runEnd: number): number =>
		roomIn(framesOf(segments, runEnd, tokens, bends).frames);

	let window = frame - arms;

	// A target written as a note returns before its length is read (`parser.ts:2766-2770`), so the
	// ties `gather` gave it are a tie of their own.
	const target = command.noteTarget;
	const targetNote = target && commands.find((other) => other.head.start === target.span.start && other.noteLength);
	if (targetNote?.noteLength && targetNote.noteLength.length > 1) {
		window += roomOf(targetNote.noteLength.slice(1), targetNote.span.end);
	}

	for (const run of ties) {
		if (run.span.start >= command.span.end && run.span.start < end && ours(run)) {
			window += roomOf(run.segments, run.span.end);
		}
	}

	return window;
}

/** One thing a channel's stream holds, in the order the driver meets it. */
type Item =
	/** A note, a rest or a tie: frames the read-ahead runs in. Only a note keys on. */
	| { kind: "frames"; span: Span; segments: readonly NoteLengthSegment[]; keysOn: boolean; rest: boolean; tie: boolean }
	| { kind: "bend"; span: Span; command: Command }
	/** A command writing bytes, which the read-ahead reads instead of a `$DD`. */
	| { kind: "blocker"; span: Span; name: string };

/**
 * Each channel's notes, rests, ties, slides and emitting commands, in source order.
 *
 * A `(!n)[ … ]` body is a stream of its own: it compiles to the loop block, so
 * nothing in it is adjacent to the channel it is written on. `gather` marks the
 * body and both brackets.
 */
function channelItems(index: TokenIndex): Item[][] {
	const { commands, ties, tokens } = index;
	const targets = new Set(
		commands.flatMap((other) => (other.noteTarget === undefined ? [] : [other.noteTarget.span.start])),
	);
	const channels = new Map<string, Item[]>();
	const add = (owner: { channel: number; inRemoteDefinition?: boolean }, item: Item): void => {
		const key = `${owner.channel}:${owner.inRemoteDefinition ?? false}`;
		const items = channels.get(key);
		if (items === undefined) {
			channels.set(key, [item]);
		} else {
			items.push(item);
		}
	};

	for (const command of commands) {
		const segments = command.noteLength;
		if (command.vcmd === VCMD.PitchBend) {
			add(command, { kind: "bend", span: command.span, command });
		} else if (segments !== undefined && targets.has(command.span.start)) {
			// A target written as a note returns before its length is read (`parser.ts:2766-2770`),
			// so the ties `gather` gave it are a tie of their own.
			let at = tokenIndexAt(tokens, command.head.end);
			while (at < tokens.length && tokens[at].kind !== "tie" && tokens[at].start < command.span.end) {
				at++;
			}

			const tie = tokens[at];
			if (segments.length > 1 && tie?.kind === "tie" && tie.start < command.span.end) {
				const span = { start: tie.start, end: command.span.end, line: tie.line };
				add(command, { kind: "frames", span, segments: segments.slice(1), keysOn: false, rest: false, tie: true });
			}
		} else if (segments !== undefined) {
			const rest = command.kind.toLowerCase() === "r";
			add(command, { kind: "frames", span: command.span, segments, keysOn: !rest, rest, tie: false });
		} else if (!emitsNothing(command)) {
			add(command, { kind: "blocker", span: command.span, name: command.name });
		}
	}

	for (const run of ties) {
		add(run, { kind: "frames", span: run.span, segments: run.segments, keysOn: false, rest: false, tie: true });
	}

	// Stable, so commands one replacement expanded to keep the order they were written in.
	return [...channels.values()].map((items) => items.sort((a, b) => a.span.start - b.span.start));
}

/**
 * What every `$DD` in the document rides on, or why it rides on nothing.
 *
 * `$DD` is not dispatched: the note before it reads it by peeking at the byte
 * standing at the track pointer (`main.asm:L_10E4`), and its own dispatch slot
 * holds `$0000`. The peek runs on every tick of a frame that fetches nothing
 * (`main.asm:2337-2339`) while no slide is running, `$90+x` being zero
 * (`main.asm:3247-3249`), and swallows all four bytes. So the question is a
 * _byte adjacency_, and four things break it — nothing in front of it, something
 * emitting in front of it, a frame too short for the peek to run in, and a slide
 * before it still running when the frame ends.
 *
 * The anchor is the **last frame** of the note, rest or tie in front of it rather
 * than the sum of its segments. `accumulateTiedLength` rewinds a tie out of a
 * `$DD`'s way (`parser.ts:2813-2827`, Music.cpp:2224), so `c4^8 $DD` emits the tie
 * as its own `[24][$C6]` frame and `$70+x` is reloaded from it
 * (`main.asm:2440-2441`) — 24 ticks is what the peek gets, not 72. A segment of
 * `$80` ticks or more is `emitNote`'s `$60`-tick pieces, so `c1 $DD` arms in a
 * frame of 96 and `c=193 $DD` in one of a single tick.
 *
 * A rest and a tie are frames as a note is: `$C7` and `$C6` go through the same
 * note path (`main.asm:2393-2441`) and set the same counters, so `c4 r4 $DD` arms
 * a slide on a keyed-off voice and is merely inaudible rather than fatal. Neither
 * touches `$90+x` (`main.asm:361-380`); only a key-on does (`main.asm:465-466`).
 *
 * A `$DD` written straight after another is picked up by the same frame's peek once
 * the slide before it has used up its delay and its steps, so a chain arms one
 * slide after another, each from the pitch the last one reached. Where that runs
 * past the frame, the fetch at its end reaches the `$DD` instead, and a slide still
 * running through a tie or a rest holds the peek off there too. Once one `$DD` of
 * a run cannot arm the song stops there, so the rest of the run takes its answer.
 *
 * Loops and calls are read in source order, as the rest of this file reads them.
 * Two limits, stated rather than modelled: `#halvetempo` halves every note and
 * every piece in the compiler (`parser.ts:2773`) and this package has no tempo
 * ratio, so a written two-tick note can be a one-tick emitted one —
 * `WalkNote.bend.frameTicks` is the authority there; and a pitch envelope
 * (`$EB`/`$EC`) loads `$90+x` at every key-on (`main.asm:465-469`), holding the
 * peek off as a slide does.
 */
export function bendAnchors(index: TokenIndex): Map<Command, BendAnchor> {
	const { commands, tokens } = index;
	const bends = new Set(
		commands.filter((command) => command.vcmd === VCMD.PitchBend).map((command) => command.span.start),
	);
	const anchors = new Map<Command, BendAnchor>();

	for (const items of channelItems(index)) {
		// Read-ahead ticks so far, and the tick on which `$90+x` is next zero.
		let peek = 0;
		let free = 0;
		// Ticks since the note sounding was keyed on.
		let ticks = 0;
		let from: SlideFrom | null = null;
		let frame: { note: Span; length: number; first: number; lead: number; cut: number; tied: boolean } | null = null;
		let blocker: { name: string; span: Span } | null = null;
		let failed: BendAnchor | null = null;
		let end = 0;

		for (const item of items) {
			if (item.kind === "frames") {
				if (item.keysOn) {
					free = peek;
				}

				if (item.keysOn || item.rest) {
					ticks = 0;
					from = { kind: "note", span: { ...item.span } };
				}

				const { frames, cut, split } = framesOf(item.segments, item.span.end, tokens, bends);
				for (const piece of frames.slice(0, -1)) {
					peek += Math.max(piece - 1, 0);
					ticks += piece;
				}

				const length = frames[frames.length - 1] ?? 0;
				frame = { note: { ...item.span }, length, first: peek, lead: ticks, cut, tied: item.tie || split };
				peek += Math.max(length - 1, 0);
				ticks += length;
				blocker = null;
				failed = null;
			} else if (item.kind === "blocker") {
				blocker = { name: item.name, span: { ...item.span } };
			} else {
				const call = callBetween(tokens, end, item.span.start);
				if (call !== null) {
					const { token, name } = call;
					blocker = { name, span: { start: token.start, end: token.end, line: token.line } };
				}

				const { command } = item;
				let anchor: BendAnchor;
				// Asked before the blocker, because nothing can stand *between* the command
				// and a note that is not there. It is what the head of a `(!n)[ … ]` body
				// answers: `gather` marks the definition’s own brackets as part of it, so the
				// opening one is otherwise read as a command written in front of the slide.
				if (frame === null) {
					anchor = { kind: "nothing" };
				} else if (blocker !== null) {
					anchor = { kind: "blocked", note: { ...frame.note }, from, by: blocker };
				} else if (failed !== null) {
					anchor = failed;
				} else if (frame.length < MIN_BEND_TICKS) {
					anchor = { kind: "tooShort", note: { ...frame.note }, from, ticks: frame.cut, tied: frame.tied };
				} else {
					const arm = Math.max(frame.first, free);
					if (arm > frame.first + frame.length - 2) {
						anchor = { kind: "crowded", note: { ...frame.note }, from };
					} else {
						const arms = arm - frame.first + 1;
						anchor = {
							kind: "rides",
							note: { ...frame.note },
							from,
							frame: frame.length,
							lead: frame.lead,
							arms,
							window: slideWindow(command, index, bends, frame.length, arms),
						};
						free = arm + occupancy(command);
						const target = command.noteTarget === undefined ? (command.args[2]?.value ?? null) : null;
						from = { kind: "slide", span: { ...command.span }, target };
					}
				}

				if (anchor.kind !== "rides") {
					failed = anchor;
				}

				anchors.set(command, anchor);
			}

			end = item.span.end;
		}
	}

	return anchors;
}

/**
 * What one `$DD` rides on. {@link bendAnchors} answers every one at once; a command scanned from an
 * earlier text is answered by the `$DD` that stands where it does in this one.
 */
export function bendAnchor(command: Command, index: TokenIndex): BendAnchor {
	const anchors = bendAnchors(index);
	const same =
		index.commands.find((other) => other === command) ??
		index.commands.find(
			(other) =>
				other.vcmd === VCMD.PitchBend &&
				other.span.start === command.span.start &&
				other.channel === command.channel &&
				(other.inRemoteDefinition ?? false) === (command.inRemoteDefinition ?? false),
		);
	return (same && anchors.get(same)) ?? { kind: "nothing" };
}

/** What the slide does instead of sliding, and the way out. One line per way it fails. */
function describeBend(anchor: BendAnchor): string {
	switch (anchor.kind) {
		case "nothing":
			return SST["0507.nothing"]();
		case "blocked":
			return SST["0507.blocked"](anchor.by.name);
		case "tooShort":
			if (anchor.ticks > 1) {
				return anchor.tied ? SST["0507.tie-pieces"](anchor.ticks) : SST["0507.note-pieces"](anchor.ticks);
			}

			return anchor.tied ? SST["0507.tie-one-tick"]() : SST["0507.note-one-tick"]();

		case "crowded":
			return SST["0507.crowded"]();
		case "rides":
			return "";
	}
}

/**
 * Every command in the document that compiles clean and then misbehaves.
 *
 * Only the `$FB` finding waits for `complete`, as `echoHazards` does. That guard
 * is about a warning flashing through the middle of writing a good command, and no
 * argument redeems a `$F7` or moves a `$DD` off the byte in front of it — a
 * slide's duration not yet written holds no later one back — so there is no
 * half-written state either finding would be wrong about. An `$FB` list's last
 * entry decides which inspector hazard it is instead, and is not known until it
 * is written.
 */
export function commandHazards(index: TokenIndex): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const anchors = bendAnchors(index);

	for (const command of index.commands) {
		if (command.vcmd === VCMD.WriteByte) {
			diagnostics.push({
				severity: "severe",
				code: CODE_DEAD_VCMD,
				message: SST["0506"](),
				span: { ...command.span },
			});
			continue;
		}

		if (command.vcmd === VCMD.PitchBend) {
			const anchor: BendAnchor = anchors.get(command) ?? { kind: "nothing" };
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
		if (command.vcmd === VCMD.GlobalTranspose && command.target.program === 1) {
			diagnostics.push({
				severity: "warning",
				code: CODE_AM4_TRANSPOSE,
				message: SST["0508"](),
				span: { ...command.span },
			});
			continue;
		}

		const dead = deadLoopPoints(command);
		if (dead.length > 0) {
			diagnostics.push({
				severity: "warning",
				code: CODE_DEAD_LOOP_POINTS,
				message: SST["0517"](dead.length + 1),
				span: { ...command.span },
			});
		}
	}

	return diagnostics;
}
