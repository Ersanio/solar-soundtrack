/** The song walk's public model: the timeline `walkSong` returns, and the notes, commands, loops and state in it. */

import type { SettingCarry } from "./repeat-settings";

/**
 * The song-wide and per-channel settings a note sounds under.
 *
 * Deliberately the whole of it, not the subset anything reads today. A view
 * takes what it shows — the roll's tooltip uses `instrument`, `volume`,
 * `quantization`, `noise`, `transpose`, `tune` and `tempo`, and leaves the
 * rest — but the walk is the only place any of it can be known, since the
 * command that set it may be thousands of ticks back on another channel.
 * Working it out here once is what makes a second reader of it free; deleting
 * the unread ones would make the next tooltip row a change to the walker.
 */
export interface NoteState {
	/** `$DA`'s operand, or the drum a `$D0`-`$D8` byte selected. `null` if unset. */
	instrument: number | null;
	/** `$E7`/`$E8` channel volume. */
	volume: number | null;
	/** `$DB`/`$DC` pan, as written — bits 6-7 are the surround flags. */
	pan: number | null;
	/** The raw `q` byte, or `null` while the channel has not set one. */
	quantization: number | null;
	/** `NoteDurations[(q >> 4) & 7]`, the multiplier on a note's last frame — see {@link WalkNote.gateTicks}. */
	gate: number;
	/** `!WaitTime` at the note's key-on: 2, or 1 while `$F4 $02` has it flipped. */
	waitTime: number;
	/** `VelocityValues[...]`, through whichever table is selected. */
	velocity: number;
	vibrato: boolean;
	tremolo: boolean;
	/** `$F8`'s clock, or `null` when the channel is not making noise. */
	noise: number | null;
	/** `$E4` song-wide transposition, in semitones. */
	transpose: number;
	/**
	 * `$FA $02`, the channel's own semitone tune — `!HTuneValues+x`, which the
	 * driver adds to every note number beside `$43` (`main.asm:439-442`).
	 */
	tune: number;
	/**
	 * The `t` value the song has last been *told* to reach — not `$51`, which is
	 * one higher.
	 *
	 * Through a `$E3` fade this is the target, which the driver has not got to
	 * yet: the fade steps once per tick and only a per-tick walk knows where it
	 * is partway. {@link SongTimeline.tempoChanges} is the authority on what a
	 * given tick really runs at; this is what the song asked for.
	 */
	tempo: number;
	/** `$E0`/`$E1` master volume. */
	globalVolume: number | null;
}

/**
 * A `$DD` as the driver will run it, on the note that read it.
 *
 * Named rather than left inline because `note-audition.ts` takes one: a note
 * auditioned on its own is handed these four bytes so the driver finds them
 * where it finds them in the song.
 */
export interface PitchSlide {
	/** `$91+x` — ticks the pitch stands still before it starts moving. */
	delay: number;
	/** `$90+x` — ticks it takes to arrive. */
	duration: number;
	/**
	 * The note byte the slide arrives at, as the **compiler emitted** it.
	 *
	 * Not a written pitch: `h` and the instrument's tuning are resolved at
	 * compile time into `NoteAddress.note`, which is the byte here. The driver
	 * adds `$43` and `!HTuneValues+x` itself when it arms the slide
	 * (`main.asm:3277-3285`), so nothing above it may transpose this again.
	 */
	target: number;
	/**
	 * How far into the note the frame the read-ahead found the `$DD` in **begins**.
	 *
	 * What tells `[len, note, $DD]` from `[len, note, $C6, $DD]`: the second
	 * starts the same slide a tie later. The peek runs only on a tick that does
	 * *not* fetch music data (`main.asm:2337-2339` jumps past `L_0CC6`'s
	 * read-ahead on one that does), so the pointer has to be standing on the
	 * `$DD` already. That distinction is the whole reason `Music.cpp:2224`
	 * rewinds a tie out of the way of a `$DD`.
	 */
	afterTicks: number;
	/**
	 * That frame's own length — `$0200+x` as it stood when the peek read the byte.
	 *
	 * Usually the note's last frame, and not always: a tie written *after* the
	 * command, `f+2 $DD $00 $D6 a+^2`, puts the `$DD` between two of the note's
	 * frames, with 96 ticks of it still to come. So {@link afterTicks} says where
	 * the arm sits and this says how long the frame holding it runs, which is the
	 * one thing that decides whether it arms at all: every tick of a one-tick
	 * frame fetches, so the read-ahead never runs on one and the command loop
	 * reaches the `$DD` and its `$0000` slot instead.
	 */
	frameTicks: number;
}

/** One sounding note, expanded onto the song's own tick timeline. */
export interface WalkNote {
	/** 0-7. The voice it sounds on, even when its bytes live in the loop block. */
	channel: number;
	/** Ticks from the start of the pass. */
	tick: number;
	/** Ticks the slot occupies. `$C6` ties are folded in. */
	ticks: number;
	/**
	 * Ticks it actually sounds before the key-off: `frameSoundingTicks` of the last frame, under the
	 * `!WaitTime` in force at its key-on, with every frame tied in front of it whole.
	 */
	gateTicks: number;
	/** The emitted byte. `$80`-`$C5` pitched, `$D0`-`$D8` a drum. */
	note: number;
	/** 0-69 for a pitched note, `null` for a drum. */
	key: number | null;
	/** 0-8 for `$D0`-`$D8`, `null` for a pitched note. */
	percussion: number | null;
	/**
	 * ARAM address of the note byte's own frame — the duration byte where the
	 * note carries one, the note byte where it reuses the standing duration.
	 * This is where `emitNote` began writing, so it is a key into `noteMap`.
	 */
	address: number;
	state: NoteState;
	/**
	 * ARAM address of the command in force in each of {@link SLOTS}, or `null`
	 * where nothing has written that slot yet.
	 *
	 * Addresses rather than values, because the point is to name the command: a
	 * `[ ]` body, a `[[ ]]` subloop and a `(1)n` call all replay one run of bytes
	 * under whatever state reached them, so which `$ED` a note sounds under is a
	 * fact about execution and not about the text. `CompileResult.commandMap`
	 * turns an address back into the source it was written as.
	 *
	 * Shared between consecutive notes for as long as nothing changes, exactly as
	 * {@link state} is.
	 */
	origins: readonly (number | null)[];
	/**
	 * The note whose `$D0`-`$D8` byte loaded the drum this note sounds on, by
	 * its {@link address} — its own for a drum note — or `null` when the
	 * instrument in force came from a `$DA` (or is the boot default).
	 *
	 * The instrument slot of {@link origins} cannot say this: `@21`-`@29` emit
	 * no command, the drum byte itself does the loading (`main.asm:381-388`),
	 * and it goes on being the sample under every note until the next `$DA` —
	 * through the `]` of the loop it was written in, a `*` or `(1)n` that replays
	 * it, and a call from another channel alike. So the walk names the note that
	 * did it, and the source, which knows which `@` was folded into *that* note,
	 * names the command from there. `CompileResult.noteMap` turns the address
	 * back into text.
	 */
	drumFrom: number | null;
	/**
	 * The `$DD` pitch slide this note's read-ahead picked up, or `null`.
	 *
	 * `$DD` is not dispatched — its slot in the command table holds `$0000` — and
	 * is instead consumed by a peek at the track pointer during the note before
	 * it (`main.asm:3256-3287`). So it is a property of *this* note rather than a
	 * command in its own right, in the way {@link drumFrom} is.
	 *
	 * {@link PitchSlide.afterTicks} carries where in the note it was found, which
	 * a walk that reported only the operands could not say — and two songs that
	 * differ only there are two different songs.
	 */
	bend: PitchSlide | null;
	/**
	 * ARAM address of that `$DD`, or `null` — a key into `CompileResult.commandMap`,
	 * which is how a reader names the command rather than only its operands.
	 *
	 * Its own field and not a member of {@link bend}: `bend` is the operands the
	 * driver runs, and this is where they were read from.
	 */
	bendFrom: number | null;
}

/**
 * One command the pass runs, on the tick it changes something.
 *
 * A *transition* and not an execution, for everything that takes a slot: it is
 * raised where {@link SLOTS} changes hands, which is the test `recordOrigin`
 * already makes. So a `[ v200 c8 ]2` raises one, its second pass writing the
 * address already in the slot, and `[ v100 c8 v200 d8 ]2` raises four. That is
 * the same answer `definedAt` gives from the note end, arrived at from the byte
 * end.
 *
 * `$DD` takes no slot and so has no transition to be raised on. It is an
 * execution, and is raised as one — see {@link SongTimeline.commands}.
 */
export interface WalkCommand {
	/** Ticks from the start of the pass. */
	tick: number;
	/**
	 * 0-7. Its own, because `CommandAddress.channel` is 8 for every byte that
	 * lives in the loop block, and a reader colouring by voice needs the voice.
	 */
	channel: number;
	/** ARAM address of the command byte — a key into `CompileResult.commandMap`. */
	address: number;
	/** The `$DA`-`$FE` byte itself. */
	vcmd: number;
	/**
	 * Whether a note *begins* on this very tick and sounds with it in force.
	 *
	 * Which is to say whether anything anchored on a note stands where this
	 * command runs. It is false in five shapes, and no scope tells them apart:
	 * a command the driver reads while its channel is resting, one it reads
	 * inside a `$C6` tie, where the sounding note began earlier, one replaced
	 * before the next note keys on, one with no note left after it at all, and
	 * `$DF`, `$F0`, `$FD` and `$FE`, which clear a slot rather than take one and
	 * so are in no {@link WalkNote.origins} at any tick.
	 *
	 * `origins` cannot answer this from the note end: it is anchored on a note
	 * that sounds, and the question is about the tick. Nor can
	 * {@link WalkCommand.vcmd}, which would restate the table `slotsOf` already
	 * is and would still reach only the last of the five.
	 */
	onANote: boolean;
}

/** A song-wide tempo command, on the tick the driver runs it. */
export interface TempoChange {
	/** Ticks from the start of the pass. */
	tick: number;
	/** The `t` byte: `$E2`'s only operand, `$E3`'s *second*. */
	tempo: number;
	/** `$E3`'s duration byte. 0 for `$E2`, which takes effect at once. */
	fadeTicks: number;
	/** ARAM address of the `$E2`/`$E3` byte — a key into `CompileResult.commandMap`. */
	address: number;
	/**
	 * Read after its channel reached the point the song loops back to, so every
	 * repetition runs it again. Always false in a song that does not loop.
	 */
	repeats: boolean;
}

/**
 * One execution of a loop on one voice: the call, its body, and every pass.
 *
 * The driver's own reading, off the same `$E9` and `$E6` frames the walk keeps
 * per {@link Track} — nothing here is derived from source, which cannot say
 * which voice replays a body or when. A body played from two places is two
 * runs; a `[[ ]]` inside a `[ ]` is one run per outer pass, since each outer
 * pass opens and closes it afresh.
 */
export interface LoopRun {
	/** 0-7 — the voice the passes sound on. */
	channel: number;
	/** `"call"` for `$E9` (`[ ]n`, `(n)m` and `*n`); `"sub"` for `$E6` (`[[ ]]n` and hex pairs). */
	kind: "call" | "sub";
	/**
	 * ARAM address of the `$E9`'s own byte, or of the closing `$E6`'s.
	 *
	 * A key into `CompileResult.commandMap` for a call site or either `$E6`
	 * spelling. A `]n`'s `$E9` is the one `recordCommand` drops — the `]` moved
	 * the channel out from under the offset (`parser.ts:508`) — so a run whose
	 * `from` maps to no command is the textual body playing at its own position,
	 * and that absence is how a reader tells a declaration from a recall.
	 */
	from: number;
	/** ARAM range of the body's bytes, `[start, end)`. For `"sub"`, `start` is past the `$E6 $00` pair. */
	body: { start: number; end: number };
	/** Times the body plays here — the `]]n` / `$E6 n+1` arithmetic already resolved. */
	count: number;
	/** One entry per pass, in order: the tick it enters the body at, and the ticks it runs. */
	passes: readonly { tick: number; ticks: number }[];
}

export interface SongTimeline {
	/** Sorted by tick, then by channel. */
	notes: readonly WalkNote[];
	/** Ticks in one pass: the intro plus a single trip round the loop. */
	ticks: number;
	/** Where the loop comes back to, or `null` for a song that does not loop. */
	loopTick: number | null;
	/**
	 * Every `$E2`/`$E3` the pass runs, ascending by tick and in driver order.
	 *
	 * The compiler cannot produce this list, which is why it is here.
	 * `estimateSeconds` is segment-wise over source text, so a `t` that executes
	 * more than once has no place in it (`parser.ts:1806`) and a fade has no
	 * segment at all (`parser.ts:1819`, porting `Music.cpp:809`) — either one
	 * makes it abandon the whole song's length. Walking bytes has neither
	 * problem: a `t` in a loop body appears once per iteration, at the tick that
	 * iteration reaches, because that is what the driver does with it.
	 *
	 * Cut at the end of the pass the same way {@link notes} is — a `t` past the
	 * shortest channel never runs, which is what `AMK0217` warns about.
	 */
	tempoChanges: readonly TempoChange[];
	/**
	 * The tempo command still in force when the pass ends, which is the tempo the
	 * repetition starts at: `L_0C01` loads new track pointers and leaves `$51`
	 * alone (`main.asm:2283-2326`), and only the start of a song resets it
	 * (`main.asm:2187`). `null` when no tempo command has run.
	 *
	 * Not always the last of {@link tempoChanges}. On the tick the pass ends the
	 * voices run in order and the first `$00` ends the phrase there
	 * (`main.asm:2337-2346`), so a `t` at the very end of a channel numbered no
	 * higher than the one that ends it has run and carries over, though that list
	 * cuts it with everything else on that tick.
	 */
	tempoAtEnd: TempoChange | null;
	/**
	 * Every setting the repeat starts its loop under differently from the first
	 * pass, judged at the loop's first note or rest, or at its first note for
	 * remote code a rest cannot read — see `repeat-settings.ts`.
	 * What a pass ends on is taken when {@link tempoAtEnd} is, so a command at the
	 * end of a channel counts on the same terms.
	 *
	 * Empty for a song that does not loop, and for one the walk cut short.
	 */
	carries: readonly SettingCarry[];
	/**
	 * Every command the pass runs that changes something, ascending by tick and
	 * in driver order.
	 *
	 * Neither the compiler nor {@link WalkNote.origins} can produce this list.
	 * `origins` names the command in force *at a note*, so it dates a command to
	 * the next note that sounds rather than to the tick the driver read it — a
	 * `v` written before a rest is a whole rest out — and it can never name the
	 * four commands that take a slot away instead of filling one (`$DF`, `$F0`,
	 * `$FD`, `$FE`), since after a `$DF` there is no vibrato and reporting the
	 * `$DF` as the vibrato in force would be a plain lie. Nor can it see a
	 * command with no note after it at all.
	 *
	 * A command that writes no slot is not here: `$F6`, `$F7` and `$F9` write a
	 * register or a byte once and nothing later reads it back as state, and
	 * `$E6`/`$E9` are the shape of the music rather than a setting. Neither is
	 * anything inside a `$FC` body, which the walk does not follow.
	 *
	 * `$DD` writes no slot either and is here all the same, raised by its own arm
	 * in `runCommand` rather than by `recordOrigin`. It is the one entry that is
	 * an execution and not a transition, so a `[ ]` body carrying one raises it
	 * once per pass: a slide really does run on every note that reads it, where a
	 * `v200` rewritten to the value already in the slot moves nothing. Its tick is
	 * the frame the read-ahead found it in, which is inside the note before it
	 * rather than at the tick the pointer reached the byte.
	 *
	 * Not everything here was written by anybody: AddmusicK prepends
	 * `$FA $04 <echo size>` and `$FA $06 $01` to the lowest channel itself
	 * (Music.cpp:2989-3050), and the driver runs them like any other. They are in
	 * no command map, so a reader joining back to source drops them there.
	 *
	 * It does not replace {@link tempoChanges}, which carries the tempo value and
	 * the fade length a clock needs; a `$E2` is in both, answering two questions.
	 *
	 * Cut at the end of the pass the same way {@link notes} is.
	 */
	commands: readonly WalkCommand[];
	/**
	 * Every loop the walk played through, in the order the runs opened.
	 *
	 * **Not** cut at the end of the pass, unlike {@link notes} — the piano roll
	 * needs the tail's runs for items past the cut, exactly as {@link channelTicks}
	 * is a full-walk figure. A reader that draws clips at {@link ticks} itself.
	 */
	loops: readonly LoopRun[];
	/** Ticks walked per channel, to cross-check against `stats.channelTicks`. */
	channelTicks: readonly number[];
	/** Channels the song writes to. */
	used: readonly boolean[];
	/** ARAM addresses of notes that never sound at all. Used for diagnostics. */
	unreachable: readonly number[];
	/** `#instruments` entries, six bytes each, `@30` first. */
	customInstruments: readonly (readonly number[])[];
	/** A budget ran out and the walk stopped early. */
	truncated: boolean;
	/** Anything malformed, named. Empty on a well-formed song. */
	problems: readonly string[];
}
