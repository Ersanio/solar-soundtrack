/**
 * Reads a compiled song the way the driver reads it, and says what sounds when.
 *
 * The compiler emits bytes and `noteMap` remembers which source text each note
 * came from, along with the byte it emitted and the ticks it occupies — but not
 * *when* it sounds, and nothing about the state it sounds under. A song is not a
 * list of notes in source order: a `[ ]` plays its body many times, and the
 * instrument, volume and tempo in force at each of those come from commands on
 * a channel the note may not be on.
 *
 * This walks the emitted stream exactly as `main.asm`'s fetch loop does and
 * produces the missing timeline — every note, on its own tick, with the state
 * in force.
 *
 * This is used to emulate the song inside the piano roll.
 *
 * Walking the bytes rather than the source is what makes it faithful. Two
 * behaviours make the point: `@29 o2a1b2c3` compiles to `$D8 $97 $98` on `#0`
 * but `$D8 $D8 $D8` on `#6` (`parser.ts:2748-2754`), and `@21`-`@29` emit no
 * `$DA` at all (`parser.ts:1930-1956`), so the instrument is only knowable by
 * following what the driver does with a `$D0` byte. A pass over the text would
 * have to re-derive both.
 *
 * Deliberately **not** modelled, because none of it moves a note in time:
 *   - runtime transposition (`$E4`, `$EE`, `$FA $02`). {@link WalkNote.key} is
 *     the emitted byte's; `$E4` and `$FA $02` are reported as state. Which row
 *     a note draws on is the roll's decision, made from the written pitch in
 *     `noteMap`, and the transposition is a tooltip line rather than a moved bar.
 *   - `ShouldSkipKeyOff`'s (main.asm:2949) readahead, which is articulation.
 *   - the second trip round the loop, whose channel state carries over from the
 *     end of the first. Every {@link WalkNote.state} is the first pass's.
 *   - `$F3`, the sample load. It changes a voice's sample without changing its
 *     instrument number, so after `@10 (@1, $02)` a note still reports `@10`.
 *     Following it means tracking a per-voice SRCN override, which nothing yet
 *     needs; the lane rule is defined on `@n` and stays self-consistent.
 *
 * Feed the compiled song binary into {@link walkSong} to get its timeline.
 */

import { word } from "@amk/core/bytes";
import {
	FIRST_PERCUSSION_INSTRUMENT,
	FIRST_PERCUSSION_NOTE,
	FIRST_VCMD,
	HEX_LENGTHS,
	LAST_VCMD,
	NOTE_DURATIONS,
	NSPC_VELOCITY_OFFSET,
	VELOCITY_VALUES,
	WAIT_TIME,
	frameSoundingTicks,
	VCMD,
} from "@amk/core/hardcoded-tables";
import { SST } from "@amk/core/messages/sst";
import { VOICES } from "./driver-state";
import { CHANNEL_SLOTS, INSTRUMENT_SLOT, SLOTS, slotAt, slotsOf } from "./slots";
import type { LoopRun, NoteState, SongTimeline, TempoChange, WalkCommand, WalkNote } from "./song-walk-types";

export { SLOTS, type StateSlot, replacedByNextInSlot } from "./slots";
export type {
	LoopRun,
	NoteState,
	PitchSlide,
	SongTimeline,
	TempoChange,
	WalkCommand,
	WalkNote,
} from "./song-walk-types";
import { PERCUSSION_SLOTS } from "./instruments";
import type { Diagnostic, NoteAddress } from "@amk/core/types";
import {
	type ChannelSetting,
	type SettingCarry,
	type SettingChange,
	type SettingCommand,
	type SettingState,
	type SongChange,
	type SongSetting,
	channelCarries,
	channelStart,
	isChannelSetting,
	settingChanges,
	songCarries,
	songStart,
} from "./repeat-settings";

/** Bytes per `#instruments` entry — a sample byte and five more. `Music.cpp:2572`. */
const CUSTOM_INSTRUMENT_ENTRY_BYTES = 6;

/**
 * Note bytes, from `NoteVCMD` (`main.asm:355-386`), which tests in this order:
 * `cmp #$d0 / bcs PercNote`, then `cmp #$C6 / bcc NormalNote / beq` the tie.
 * So `$C7`-`$CF` all fall through to `if_rest` — the rest range is nine bytes
 * wide, not one — and percussion runs to `$D9` even though AddmusicK only ever
 * emits `$D0`-`$D8`.
 */
const NOTE_LOWEST = 0x80;
const NOTE_TIE_BYTE = 0xc6;
const REST_FIRST = 0xc7;
const PERCUSSION_FIRST = FIRST_PERCUSSION_NOTE;

/** `$80` is o1 c and `$C5` is o6 a: 70 keys, since `$C6` is already the tie. */
export const KEY_COUNT = 70;

/**
 * What a walk will not go past.
 *
 * `[[ ]]255` inside `[ ]255` is ~65000 passes of the body, and a
 * malformed blob can loop without bound. Both stop here and say so through
 * {@link SongTimeline.truncated} rather than hanging the tab.
 */
const TICK_BUDGET = 1_000_000;
const NOTE_BUDGET = 200_000;
/** The same, for a song of nothing but commands, which no note count bounds. */
const COMMAND_BUDGET = 200_000;
/** Bytes one channel may read in a phrase. Generous; only a loop can reach it. */
const STEP_BUDGET = 2_000_000;

/**
 * Total byte length of the VCMD at `index`, including the command byte.
 * Returns 0 for a byte that is not a VCMD, and clamps at the end of the blob.
 */
export function vcmdLength(song: Uint8Array, index: number): number {
	const vcmd = song[index];
	if (vcmd < FIRST_VCMD || vcmd > LAST_VCMD) {
		return 0;
	}

	// `$FB` is the arpeggio, and the only command whose note bytes are not
	// notes. `main.asm:2988-2997`: a count below $80 is followed by a step
	// length and that many note bytes; $80 and up is trill or glissando, which
	// carry two fixed arguments instead.
	if (vcmd === VCMD.Arpeggio) {
		const count = song[index + 1] ?? 0;
		return count >= 0x80 ? 4 : count + 3;
	}

	// `$FA $FE`'s hot patch takes one further byte for *every* trailing byte
	// whose high bit is set: `.FACommand_readUntilPositive` (`main.asm:3011-3015`)
	// loops while `bmi`, then steps once more past the byte that ended it.
	if (vcmd === VCMD.Settings && song[index + 1] === 0xfe) {
		let at = index + 2;
		while (at < song.length && song[at] >= 0x80) {
			at++;
		}

		return Math.min(at + 1, song.length) - index;
	}

	return HEX_LENGTHS[vcmd - FIRST_VCMD];
}

/** Where one channel has got to, and the two loop frames it can be inside. */
interface Track {
	/** Blob index of the next byte to read, or -1 once the channel has ended. */
	at: number;
	ticks: number;
	/** The standing duration, `$0200+x`. */
	duration: number;
	/** The note a `$C6` tie should extend, or -1 when a tie would be a rest. */
	held: number;
	/** See {@link WalkNote.drumFrom}; -1 while no drum byte is the sample in force. */
	drumFrom: number;
	/**
	 * Where the current note's frame began, or -1 when it begins at the note
	 * byte itself. `emitNote` (`parser.ts:2839`) writes `[duration][q][note]`
	 * and the note map records the offset *before* any of it, so a note that
	 * carries a duration is addressed by that byte and not by its own.
	 */
	frameAt: number;
	/**
	 * `$E9`'s frame: `$C0+x` counts iterations, `$03E0/1` is where to return and
	 * `$03F0/1` is where to restart. `cmdE9` (`Commands.asm:400-417`) stores the
	 * count as written, and the `$00` handler decrements before testing, so the
	 * body runs exactly `count` times.
	 */
	callCount: number;
	callReturn: number;
	callRestart: number;
	/**
	 * `$E6`'s frame, which shares nothing with `$E9`'s — it is `$01E0/1` and
	 * `$01F0` (`Commands.asm:365-392`), so a subloop nests inside a call without
	 * either disturbing the other. `$E6 $00` stores `$FF`; the first closing
	 * `$E6 $n` sees `$FE` after its `dec` and loads `n`, so the body plays n+1
	 * times.
	 */
	loopCount: number;
	loopStart: number;
	/**
	 * Whether the read pointer has reached the point the song loops back to, so
	 * everything read from here on runs again on every repetition.
	 */
	repeating: boolean;
	/** The channel's own carried settings, as they stand. */
	settings: Record<ChannelSetting, SettingState>;
	/** What ran between the loop point and the first note after it; `null` before the loop point. */
	loopHead: SettingChange[] | null;
	/** {@link settings} at the first note or rest after the loop point, once one has played. */
	atLoop: Readonly<Record<ChannelSetting, SettingState>> | null;
	/** {@link settings} at the first note after it, which a tie or rest is not. */
	atLoopNote: Readonly<Record<ChannelSetting, SettingState>> | null;
	/** How much of {@link loopHead} ran before {@link atLoop}. */
	headToFirst: number;
	/** {@link atLoop} was taken at a rest or a tie. */
	startsOnRest: boolean;
	/** A note was the channel's last event when it reached the loop point. */
	soundingAtLoop: boolean;
	/** The `$E9` run being played, or null. One per track, as the frame is. */
	pendingCall: PendingRun | null;
	/** The `$E6` run being played, or null. */
	pendingSub: PendingRun | null;
	state: ChannelState;
	/** Where each of this channel's slots was last written. See {@link WalkNote.origins}. */
	origins: (number | null)[];
	/**
	 * The entry that put each of those addresses there, so a slot can name the
	 * command occupying it and not merely the byte. The address cannot: a
	 * `[[ v100 v200 ]]2` raises two `v200` entries at one tick on one channel,
	 * and only one of them is the one in force.
	 */
	owners: (WalkCommand | null)[];
	/** The last frozen snapshot, reused until something changes. */
	snapshot: NoteState | null;
	/** The last frozen origins, reused on the same terms. */
	frozenOrigins: readonly (number | null)[] | null;
}

/**
 * A {@link LoopRun} still being played: the fields the finished run keeps, plus
 * where the current pass entered and where the run stands in open order.
 *
 * `from` and `body.end` are -1 until the first pass closes — a `"sub"`'s `from`
 * is its *closing* `$E6`, which the open has not seen — so a pending run that
 * never closes a pass has neither and is dropped rather than filed.
 */
interface PendingRun {
	opened: number;
	channel: number;
	kind: "call" | "sub";
	from: number;
	body: { start: number; end: number };
	passes: { tick: number; ticks: number }[];
	passStart: number;
}

/** The mutable half of {@link NoteState}, kept per channel. */
interface ChannelState {
	instrument: number | null;
	volume: number | null;
	pan: number | null;
	quantization: number | null;
	gate: number;
	velocity: number;
	vibrato: boolean;
	tremolo: boolean;
	noise: number | null;
	tune: number;
}

/**
 * Reads a compiled song into a timeline of one pass.
 *
 * `song` is the blob `CompileResult.data` carries and `aramAddress` is where it
 * will be loaded, which is what the pointers inside it are relative to.
 */
export function walkSong(song: Uint8Array, aramAddress: number): SongTimeline {
	const problems: string[] = [];
	const notes: WalkNote[] = [];
	const tempoChanges: TempoChange[] = [];
	const commands: WalkCommand[] = [];

	/** Blob index of an ARAM address, or -1 when it does not land in the blob. */
	const indexOf = (address: number): number => {
		const index = address - aramAddress;
		return index >= 0 && index < song.length ? index : -1;
	};

	// --- the phrase table --------------------------------------------------
	//
	// `L_0C01` (`main.asm:2283`) reads a word at a time: a non-zero high byte is
	// a pointer to eight channel starts, `$0000` ends the song, and `$00nn` is
	// "repeat nn times, target in the next word". `link.ts:287-296` writes the
	// marker as `$00FF` and the target as the phrase the loop re-enters.
	const phrases: number[] = [];
	let loopTarget: number | null = null;
	for (let at = 0; at + 1 < song.length; at += 2) {
		const entry = word(song, at);
		if (entry >> 8) {
			phrases.push(entry);
			continue;
		}

		if ((entry & 0xff) !== 0) {
			loopTarget = word(song, at + 2);
		}

		break;
	}

	if (phrases.length === 0) {
		return empty(["The song has no phrase to play."]);
	}

	const firstPhrase = indexOf(phrases[0]);
	if (firstPhrase < 0) {
		return empty([`The first phrase points outside the song (0x${phrases[0].toString(16)}).`]);
	}

	// One pass is the *first* phrase alone. It covers the whole of every channel,
	// intro included; a second phrase, when the song has one, starts at the `/`
	// and is only the repeat unit. That is the same range `worklet.ts:309-324`
	// folds the playhead into, so the drawing and the playhead agree.
	const loopEntry = loopTarget === null ? -1 : indexOf(loopTarget);
	const loopPhrase = loopEntry >= 0 ? indexOf(word(song, loopEntry)) : -1;

	// --- the instrument block ----------------------------------------------
	//
	// `buildHeader` (`link.ts:208-247`) writes the first phrase pointer at word
	// 0 as `add + instrLen`, and lays the `#instruments` entries at `add`, so
	// the block's length falls out of the two.
	const customInstruments: number[][] = [];
	{
		const headerWords = phrases.length + (loopTarget === null ? 1 : 2);
		const blockAt = headerWords * 2;
		const blockEnd = firstPhrase;
		for (let at = blockAt; at + CUSTOM_INSTRUMENT_ENTRY_BYTES <= blockEnd; at += CUSTOM_INSTRUMENT_ENTRY_BYTES) {
			customInstruments.push([...song.subarray(at, at + CUSTOM_INSTRUMENT_ENTRY_BYTES)]);
		}
	}

	// --- per-channel setup ---------------------------------------------------
	const tracks: Track[] = [];
	const used: boolean[] = [];
	/** Where each channel re-enters on the loop, for `loopTick`. */
	const loopAt: number[] = [];

	for (let channel = 0; channel < VOICES; channel++) {
		const start = word(song, firstPhrase + channel * 2);
		const at = start === 0 ? -1 : indexOf(start);
		if (start !== 0 && at < 0) {
			problems.push(`Channel ${channel} starts outside the song (0x${start.toString(16)}).`);
		}

		used.push(at >= 0);
		loopAt.push(loopPhrase >= 0 ? indexOf(word(song, loopPhrase + channel * 2)) : -1);
		tracks.push({
			at,
			ticks: 0,
			duration: 1,
			held: -1,
			drumFrom: -1,
			frameAt: -1,
			callCount: 0,
			callReturn: -1,
			callRestart: -1,
			loopCount: 0,
			loopStart: -1,
			repeating: false,
			settings: channelStart(),
			loopHead: null,
			atLoop: null,
			atLoopNote: null,
			headToFirst: 0,
			startsOnRest: false,
			soundingAtLoop: false,
			pendingCall: null,
			pendingSub: null,
			origins: new Array<number | null>(CHANNEL_SLOTS).fill(null),
			owners: new Array<WalkCommand | null>(CHANNEL_SLOTS).fill(null),
			frozenOrigins: null,
			state: {
				// `main.asm:2321` calls `SetInstrument` with 0 for every channel whose
				// `$C1+x` is still zero, which `main.asm:2193` has just made true of
				// all of them — so a channel that never writes an `@` plays `@0`.
				instrument: 0,
				volume: null,
				pan: null,
				quantization: null,
				// Before any `q`, the driver leaves `$0201`/`$0211` as the previous
				// note left them; a fresh voice has the full slot and full velocity.
				gate: 0xff,
				velocity: 0xff,
				vibrato: false,
				tremolo: false,
				noise: null,
				tune: 0,
			},
			snapshot: null,
		});
	}

	// Song-wide state. Any channel may write it and every channel reads it.
	// `tempo` is 0 until the song sets one; the caller supplies its own default,
	// since what AddmusicK assumes for an untempoed song is a compiler question.
	const shared = {
		transpose: 0,
		tempo: 0,
		globalVolume: null as number | null,
		secondVelocityTable: true,
		/** `!WaitTime`, which `$F4 $02` flips between 2 and 1 for every channel at once. */
		waitTime: WAIT_TIME,
		/** Song-wide slots, which every channel's next note reports. */
		origins: new Array<number | null>(SLOTS.length).fill(null),
		/** Their owners, as {@link Track.owners} is. Only the tail is ever used. */
		owners: new Array<WalkCommand | null>(SLOTS.length).fill(null),
		/** The song's own carried settings, as they stand. */
		settings: songStart(),
	};
	let loopTick = loopPhrase >= 0 ? Number.POSITIVE_INFINITY : Number.NaN;
	let truncated = false;
	let lastTempo: TempoChange | null = null;
	let tempoAtEnd: TempoChange | null = null;
	/** Every change to a song setting, in driver order, for the loop tick to be read off once known. */
	const songChanges: SongChange[] = [];
	let channelsAtEnd: Readonly<Record<ChannelSetting, SettingState>>[] | null = null;
	let songAtEnd: Readonly<Record<SongSetting, SettingState>> | null = null;
	let phraseEnded = false;

	/**
	 * What the bytes the driver just read do to the carried settings, kept the
	 * same way for a command, a frame's `q` byte and a note.
	 */
	const recordSettings = (
		channel: number,
		track: Track,
		address: number,
		bytes: readonly number[],
		onNote: boolean,
	): void => {
		for (const change of settingChanges(bytes, channel)) {
			const by: SettingCommand = { address, bytes, onNote, toggle: change.toggle };
			if (isChannelSetting(change.setting)) {
				const state = track.settings[change.setting];
				const values = change.apply(state.values);
				if (values !== state.values) {
					track.settings[change.setting] = { values, by };
				}

				if (track.loopHead !== null && track.atLoopNote === null && !phraseEnded) {
					track.loopHead.push(change);
				}
			} else {
				const state = shared.settings[change.setting];
				const values = change.apply(state.values);
				if (values !== state.values) {
					shared.settings[change.setting] = { values, by };
				}

				songChanges.push({ tick: track.ticks, repeats: track.repeating, change, by });
			}
		}
	};

	// --- loop runs -----------------------------------------------------------
	const finishedRuns: PendingRun[] = [];
	let runsOpened = 0;

	/**
	 * Files a run, keeping only what really played: a pending run with no closed
	 * pass — an unterminated `$E6 $00`, or a frame clobbered before its body's
	 * first `$00` — never entered its body's end and is dropped, which is also
	 * what leaves an unterminated subloop with no run at all.
	 */
	const settleRun = (pending: PendingRun | null): void => {
		if (pending !== null && pending.passes.length > 0) {
			finishedRuns.push(pending);
		}
	};

	const openRun = (
		channel: number,
		kind: "call" | "sub",
		from: number,
		bodyStart: number,
		tick: number,
	): PendingRun => ({
		opened: runsOpened++,
		channel,
		kind,
		from,
		body: { start: bodyStart, end: -1 },
		passes: [],
		passStart: tick,
	});

	/** Freezes the state a note sounds under, reusing the last one when it stands. */
	const snapshot = (track: Track): NoteState => {
		track.snapshot ??= {
			instrument: track.state.instrument,
			volume: track.state.volume,
			pan: track.state.pan,
			quantization: track.state.quantization,
			gate: track.state.gate,
			waitTime: shared.waitTime,
			velocity: track.state.velocity,
			vibrato: track.state.vibrato,
			tremolo: track.state.tremolo,
			noise: track.state.noise,
			transpose: shared.transpose,
			tune: track.state.tune,
			tempo: shared.tempo,
			globalVolume: shared.globalVolume,
		};

		return track.snapshot;
	};

	/**
	 * The commands in force, frozen alongside the state.
	 *
	 * The two halves are merged here rather than kept in one array because a
	 * song-wide command is written once and read by all eight channels; keeping
	 * one copy is what makes `invalidateAll` enough to publish it.
	 */
	const origins = (track: Track): readonly (number | null)[] => {
		if (track.frozenOrigins === null) {
			track.frozenOrigins = SLOTS.map((_, at) => (at < CHANNEL_SLOTS ? track.origins[at] : shared.origins[at]));

			// A note keys on here, so anything in force that also *ran* here is
			// reported by something standing on its own tick. One that ran earlier
			// is not: the ticks between it and this note are a rest or a tie, and
			// nothing is drawn over them. Only the first note after a slot changes
			// hands can share a command's tick, and that note always freezes afresh
			// — every write to a slot clears {@link Track.frozenOrigins}.
			for (let at = 0; at < SLOTS.length; at++) {
				const owner = at < CHANNEL_SLOTS ? track.owners[at] : shared.owners[at];
				if (owner !== null && owner.tick === track.ticks) {
					owner.onANote = true;
				}
			}
		}

		return track.frozenOrigins;
	};

	/**
	 * A song-wide command is read by every channel's next note, so every frozen
	 * snapshot is stale, not only the running channel's — the others would go on
	 * reporting the tempo or transposition in force when they were taken.
	 */
	/**
	 * Where each slot was last written, which is the whole of {@link WalkNote.origins}.
	 *
	 * One call in front of the dispatch rather than a line in each of its thirty
	 * arms: a command that set state and forgot to say so would leave a note
	 * reporting the one before it, which reads as entirely reasonable.
	 *
	 * It is also where a slot changing hands is known, so it is where
	 * {@link SongTimeline.commands} is raised — once per command however many
	 * slots it moved, `$DA` writing the instrument and clearing the noise in the
	 * one execution.
	 */
	const recordOrigin = (channel: number, track: Track, vcmd: number, sub: number, address: number): void => {
		const { writes, clears } = slotsOf(vcmd, sub);
		if (writes === null && clears === null) {
			return;
		}

		// Built before the loop so a slot can be given its owner in the same
		// statement that is given the address, and pushed only where one moved.
		const entry: WalkCommand = { tick: track.ticks, channel, address, vcmd, onANote: false };
		let moved = false;
		for (const [slot, to] of [
			[writes, address],
			[clears, null],
		] as const) {
			if (slot === null) {
				continue;
			}

			const at = slotAt(slot);
			const owner = to === null ? null : entry;
			if (at < CHANNEL_SLOTS) {
				if (track.origins[at] === to) {
					continue;
				}

				track.origins[at] = to;
				track.owners[at] = owner;
				track.frozenOrigins = null;
			} else {
				if (shared.origins[at] === to) {
					continue;
				}

				// Song-wide, so every channel's next note reports it, not only this
				// one's — the same reason {@link invalidateAll} exists.
				shared.origins[at] = to;
				shared.owners[at] = owner;
				invalidateAll();
			}

			moved = true;
		}

		if (moved) {
			commands.push(entry);
		}
	};

	const invalidateAll = (): void => {
		for (const track of tracks) {
			track.snapshot = null;
			track.frozenOrigins = null;
		}
	};

	/**
	 * Runs one channel until its next note lands, or until it ends.
	 *
	 * A channel is advanced only when it is the furthest behind, so the eight
	 * stay interleaved in tick order and song-wide commands land on every
	 * channel in the order the driver would run them.
	 */
	const step = (channel: number): void => {
		const track = tracks[channel];
		let steps = 0;

		for (;;) {
			if (track.at < 0) {
				return;
			}

			if (++steps > STEP_BUDGET) {
				problems.push(`Channel ${channel} did not reach an end.`);
				truncated = true;
				track.at = -1;
				return;
			}

			// The loop re-entry point, noted the moment the read pointer reaches it
			// at a frame boundary.
			if (track.at === loopAt[channel]) {
				track.repeating = true;
				if (track.loopHead === null) {
					track.loopHead = [];
					track.soundingAtLoop = track.held >= 0;
				}

				if (track.ticks < loopTick) {
					loopTick = track.ticks;
				}
			}

			if (track.at >= song.length) {
				problems.push(`Channel ${channel} read past the end of the song.`);
				track.at = -1;
				return;
			}

			const byte = song[track.at];

			// `$00` — end of channel, or the bottom of an `$E9` call.
			// `runningRemoteCodeGate` (`main.asm:2344-2358`) tests `$C0+x` first:
			// zero means the channel is finished and the whole song advances phrase,
			// otherwise it decrements and either returns or restarts the body.
			if (byte === 0) {
				if (track.callCount === 0) {
					// The first channel to end is the one that ends the phrase, and the
					// tempo and settings standing now are what the repetition starts at.
					if (!phraseEnded) {
						phraseEnded = true;
						tempoAtEnd = lastTempo;
						channelsAtEnd = tracks.map((each) => ({ ...each.settings }));
						songAtEnd = { ...shared.settings };
					}

					track.at = -1;
					return;
				}

				// The body's terminator: one pass of the pending call run closes
				// here, and the terminator's own address is where the body ends.
				const pending = track.pendingCall;
				if (pending !== null) {
					pending.body.end = aramAddress + track.at;
					pending.passes.push({ tick: pending.passStart, ticks: track.ticks - pending.passStart });
				}

				track.callCount--;
				track.at = track.callCount === 0 ? track.callReturn : track.callRestart;
				track.frameAt = -1;
				if (track.callCount === 0) {
					settleRun(pending);
					track.pendingCall = null;
				} else if (pending !== null) {
					pending.passStart = track.ticks;
				}

				continue;
			}

			if (byte < NOTE_LOWEST) {
				// A duration byte, and then one fetch that is *not* guarded against
				// zero (`main.asm:2364-2365` tests `bmi`, not `beq`). So a `$00`
				// sitting here is a `q` byte of zero, not the end of the channel —
				// reading it as an end would misframe everything after it.
				track.frameAt = track.at;
				track.duration = byte;
				const next = song[track.at + 1];
				track.at += 1;
				if (next !== undefined && next < NOTE_LOWEST) {
					track.state.quantization = next;
					track.state.gate = NOTE_DURATIONS[(next >> 4) & 7];
					track.state.velocity =
						VELOCITY_VALUES[(next & 0x0f) + (shared.secondVelocityTable ? NSPC_VELOCITY_OFFSET : 0)];
					track.snapshot = null;
					// The frame's own address, which is how `noteMap` knows the note.
					recordSettings(channel, track, aramAddress + track.frameAt, [next], true);
					track.at += 1;
				}

				continue;
			}

			if (byte > LAST_VCMD || byte < FIRST_VCMD) {
				emitNote(channel, track, byte);
				return;
			}

			runCommand(channel, track, byte);
			if (track.at < 0) {
				return;
			}
		}
	};

	/** A note, a tie or a rest. All three move the clock; only a note sounds. */
	const emitNote = (channel: number, track: Track, byte: number): void => {
		// The frame, not the note byte: `link.ts:91-98` addresses a note by where
		// its emission *began*, which is the duration byte whenever one was
		// written. Addressing the note byte instead misses the map on every note
		// that changes length, which is most of them.
		const address = aramAddress + (track.frameAt >= 0 ? track.frameAt : track.at);
		track.frameAt = -1;
		track.at += 1;

		// A drum byte loads its instrument as it keys on, so it is in force for
		// its own note.
		recordSettings(channel, track, address, [byte], true);

		// A tie or a rest counts as much as a note: what the loop starts under is
		// whatever was set before the first thing in it that takes time. Remote
		// code a rest cannot read is judged at the first note instead.
		if (track.loopHead !== null && track.atLoopNote === null && !phraseEnded) {
			const keysOn = byte !== NOTE_TIE_BYTE && !(byte >= REST_FIRST && byte < PERCUSSION_FIRST);
			if (track.atLoop === null) {
				track.atLoop = { ...track.settings };
				track.headToFirst = track.loopHead.length;
				track.startsOnRest = !keysOn;
			}

			if (keysOn) {
				track.atLoopNote = track.startsOnRest ? { ...track.settings } : track.atLoop;
			}
		}

		const ticks = track.duration;

		// `$C6` returns before any key-on or key-off (`main.asm:361-363`), so the
		// note already sounding simply runs longer. Folding the tie into that note
		// is what makes a piano roll draw one bar rather than several.
		if (byte === NOTE_TIE_BYTE) {
			if (track.held >= 0) {
				const previous = notes[track.held];
				previous.ticks += ticks;
				// Every segment before the last sounds in full — the tie never keys
				// off — and only this one is cut short by the gate in force now.
				previous.gateTicks = previous.ticks - ticks + frameSoundingTicks(ticks, track.state.gate, shared.waitTime);
			}

			track.ticks += ticks;
			return;
		}

		if (byte >= REST_FIRST && byte < PERCUSSION_FIRST) {
			track.held = -1;
			track.ticks += ticks;
			return;
		}

		// A `$D0`-`$D8` byte selects its drum as a side effect — `PercNote` calls
		// `SetupPercInstrument` and falls straight through to `NormalNote`
		// (`main.asm:381-388`). Nothing else says which instrument is loaded,
		// because `@21`-`@29` emit no `$DA`, so a pitched note after a drum is
		// still on the drum's sample until the next `$DA`.
		const percussion = byte >= PERCUSSION_FIRST ? byte - PERCUSSION_FIRST : null;
		if (percussion !== null) {
			const drum = FIRST_PERCUSSION_INSTRUMENT + percussion;
			if (track.state.instrument !== drum) {
				track.state.instrument = drum;
				track.snapshot = null;
				// The instrument slot goes empty rather than stale. What loaded this
				// drum is a note byte, not a command, so the last `$DA` is no longer
				// in force and naming it would be a plain lie; the `@21`-`@29` that
				// did it emitted nothing, so the source answers it — at the note
				// {@link WalkNote.drumFrom} names, which is what carries it through
				// loops and calls the text cannot see.
				track.origins[INSTRUMENT_SLOT] = null;
				track.owners[INSTRUMENT_SLOT] = null;
				track.frozenOrigins = null;
			}

			// Every drum byte reloads, so the newest one is the one in force — the
			// same drum twice over is still two loads.
			track.drumFrom = address;
		}

		track.held = notes.length;
		notes.push({
			channel,
			tick: track.ticks,
			ticks,
			gateTicks: frameSoundingTicks(ticks, track.state.gate, shared.waitTime),
			note: byte,
			key: percussion === null ? byte - NOTE_LOWEST : null,
			percussion,
			address,
			state: snapshot(track),
			origins: origins(track),
			drumFrom: track.drumFrom >= 0 ? track.drumFrom : null,
			bend: null,
			bendFrom: null,
		});

		track.ticks += ticks;
	};

	/** Everything `$DA`-`$FE`. Only the three that move a pointer are followed. */
	const runCommand = (channel: number, track: Track, vcmd: number): void => {
		// A command between a duration byte and its note would mean the frame did
		// not start where it looked like it did. AddmusicK never emits one, but a
		// stale `frameAt` would silently address the wrong note if it ever did.
		track.frameAt = -1;
		const length = vcmdLength(song, track.at);
		const argAt = track.at + 1;
		const arg = (n: number): number => song[argAt + n] ?? 0;
		const state = track.state;
		let dirty = true;

		// Taken before the switch: `$E6` and `$E9` move the pointer, and the
		// address wanted is the one the driver read this command from.
		recordOrigin(channel, track, vcmd, arg(0), aramAddress + track.at);
		recordSettings(channel, track, aramAddress + track.at, [...song.subarray(track.at, track.at + length)], false);

		switch (vcmd) {
			case VCMD.Instrument: // instrument
				state.instrument = arg(0);
				state.noise = null;
				// `SetInstrument` reloads the sample, so no drum byte is in force now.
				track.drumFrom = -1;
				break;
			case VCMD.Pan: // pan
			case VCMD.PanFade: // pan fade — the second byte is the target
				state.pan = vcmd === VCMD.Pan ? arg(0) : arg(1);
				break;
			case VCMD.PitchBend: {
				// Not dispatched by the driver at all — the note sounding now picks
				// it up by peeking at the track pointer (`main.asm:3256-3287`), on
				// any tick of that note where no slide is already running. A `$C6`
				// tie is one of those ticks, which is why `Music.cpp:2224` rewinds a
				// tie out of the way of a `$DD`, and why the peek's own position is
				// recorded rather than just the three bytes: the same operands found
				// a tie later are a different slide.
				//
				// The "no slide already running" half is not modelled: `main.asm:3247-3249`
				// reads it only while `$90+x` is zero, so a second `$DD` inside a
				// slide is ignored where this records it.
				const address = aramAddress + track.at;
				const held = track.held >= 0 ? notes[track.held] : null;

				// The frame the peek found it in. `track.ticks` has already run on
				// past that frame and `track.duration` is its own length, so the
				// difference is where it began — which is the note's last frame in
				// every shape but a tie written after the command, where the note goes
				// on afterwards. With no note to ride on, the command loop is what
				// reaches the byte — and jumps to `$0000` — so `track.ticks` is the
				// tick, that being where it does so.
				const tick = held === null ? track.ticks : track.ticks - track.duration;
				if (held !== null) {
					held.bend = {
						delay: arg(0),
						duration: arg(1),
						target: arg(2),
						afterTicks: tick - held.tick,
						frameTicks: track.duration,
					};
					held.bendFrom = address;
				}

				// `recordOrigin` raised nothing, `$DD` taking no slot and so having no
				// transition to be tested for. Every execution is an entry.
				commands.push({
					tick,
					channel,
					address,
					vcmd,
					onANote: held !== null && held.tick === tick,
				});

				dirty = false;
				break;
			}

			case VCMD.Vibrato:
				state.vibrato = true;
				break;
			case VCMD.VibratoOff:
				state.vibrato = false;
				break;
			case VCMD.GlobalVolume:
			case VCMD.GlobalVolumeFade:
				shared.globalVolume = vcmd === VCMD.GlobalVolume ? arg(0) : arg(1);
				invalidateAll();
				break;
			case VCMD.Tempo:
			case VCMD.TempoFade:
				// `track.ticks` is the driver's own position for this command: a
				// channel is only ever advanced while it is the furthest behind
				// (the loop below), and `step` moves the clock at most once, in
				// `emitNote` — so the eight channels' commands are recorded in the
				// order the driver would run them, already ascending by tick.
				lastTempo = {
					tick: track.ticks,
					tempo: vcmd === VCMD.Tempo ? arg(0) : arg(1),
					fadeTicks: vcmd === VCMD.Tempo ? 0 : arg(0),
					address: aramAddress + track.at,
					repeats: track.repeating,
				};
				tempoChanges.push(lastTempo);
				// The target, not what a fade is passing through — see
				// {@link NoteState.tempo}. Pricing a fade tick by tick is the
				// clock's job, and it reads `tempoChanges` to do it.
				shared.tempo = vcmd === VCMD.Tempo ? arg(0) : arg(1);
				invalidateAll();
				break;
			case VCMD.GlobalTranspose:
				shared.transpose = (arg(0) << 24) >> 24;
				invalidateAll();
				break;
			case VCMD.Tremolo:
			case VCMD.TremoloOff:
				// `$FD` is `$E5`'s tail with a zero depth (`Commands.asm:353`).
				state.tremolo = vcmd === VCMD.Tremolo && arg(2) !== 0;
				break;
			case VCMD.Volume:
			case VCMD.VolumeFade:
				state.volume = vcmd === VCMD.Volume ? arg(0) : arg(1);
				break;
			case VCMD.Noise:
				state.noise = arg(0);
				break;
			case VCMD.Toggles:
				// `eor !WaitTime, #$03` (`Commands.asm:595-597`). Read at a note
				// key-on, where the driver reads it at the key-off check, so a toggle
				// on another channel in between is not seen until the next note.
				if (arg(0) === 0x02) {
					shared.waitTime ^= 3;
					for (const each of tracks) {
						each.snapshot = null;
					}
				}

				dirty = false;
				break;
			case VCMD.Settings:
				// `$FA $06` picks the velocity table. `main.asm:2374-2375` tests it
				// against zero, so anything non-zero is the N-SPC half.
				if (arg(0) === 0x06) {
					shared.secondVelocityTable = arg(1) !== 0;
				}

				// `$FA $02` is the channel's semitone tune, and the one `$FA` that
				// changes what a note reports.
				if (arg(0) === 0x02) {
					state.tune = (arg(1) << 24) >> 24;
				} else {
					dirty = false;
				}

				break;

			case VCMD.Subloop: {
				// `cmdE6` (`Commands.asm:365-392`). `$E6 $00` marks; a non-zero argument
				// closes, and the count is loaded on the first close only, so the
				// body plays one more time than the byte says.
				if (arg(0) === 0) {
					// A mark while a sub is pending is the driver clobbering its one
					// frame — a crossed construct's shape. What the old run finished
					// is filed; a pass it never closed is not.
					settleRun(track.pendingSub);
					track.pendingSub = openRun(channel, "sub", -1, aramAddress + argAt + 1, track.ticks);
					track.loopStart = argAt + 1;
					track.loopCount = 0xff;
				} else if (track.loopStart >= 0) {
					// Every close ends a pass, and all of them stand at the one byte,
					// which is both the run's `from` and where the body ends.
					const pending = track.pendingSub;
					if (pending !== null) {
						pending.from = aramAddress + track.at;
						pending.body.end = aramAddress + track.at;
						pending.passes.push({ tick: pending.passStart, ticks: track.ticks - pending.passStart });
					}

					track.loopCount = track.loopCount === 0xff ? arg(0) : track.loopCount - 1;
					if (track.loopCount > 0) {
						if (pending !== null) {
							pending.passStart = track.ticks;
						}

						track.at = track.loopStart;
						return;
					}

					track.loopStart = -1;
					settleRun(pending);
					track.pendingSub = null;
				}

				dirty = false;
				break;
			}

			case VCMD.CallLoop: {
				// `cmdE9` (`Commands.asm:400-417`) — what a `[ ]` loop compiles to. The
				// count is stored as written and the `$00` handler decrements before
				// testing, so the body runs exactly that many times, and once for a zero.
				const target = indexOf(arg(0) | (arg(1) << 8));
				const count = arg(2);
				if (target < 0) {
					// `*` before any `[ ]` emits `$E9 FF FF n` on purpose
					// (`parser.ts:2564-2573`, porting `Music.cpp:240, 1337-1341`), because
					// AddmusicK builds it. A call to nowhere ends the channel here
					// rather than throwing, so the other seven still draw.
					problems.push(`Channel ${channel} calls a loop that was never defined.`);
					track.at = -1;
					return;
				}

				// A call while one is pending clobbers the driver's one frame; the
				// old run keeps what it finished, as the `$E6` mark does. A zero is no
				// run: its `$00` finds `$C0+x` at zero and ends the phrase (`main.asm:2345-2346`).
				settleRun(track.pendingCall);
				track.pendingCall =
					count === 0 ? null : openRun(channel, "call", aramAddress + track.at, arg(0) | (arg(1) << 8), track.ticks);
				track.callCount = count;
				track.callReturn = track.at + length;
				track.callRestart = target;
				track.at = target;
				return;
			}

			default:
				dirty = false;
				break;
		}

		if (dirty) {
			track.snapshot = null;
		}

		if (length === 0) {
			problems.push(`Channel ${channel} ran an unknown command 0x${vcmd.toString(16)}.`);
			track.at = -1;
			return;
		}

		track.at += length;
	};

	// --- the walk ------------------------------------------------------------
	//
	// Always advance whichever used channel is furthest behind. A phrase ends
	// when the first of them runs out, because `L_0C01` resets all eight
	// pointers together (`main.asm:2283-2301`) — so the shortest channel is what
	// the pass is worth.
	for (;;) {
		let next = -1;
		for (let channel = 0; channel < VOICES; channel++) {
			if (tracks[channel].at >= 0 && (next < 0 || tracks[channel].ticks < tracks[next].ticks)) {
				next = channel;
			}
		}

		if (next < 0) {
			break;
		}

		if (tracks[next].ticks > TICK_BUDGET || notes.length > NOTE_BUDGET || commands.length > COMMAND_BUDGET) {
			truncated = true;
			problems.push("The song is longer than the roll will draw.");
			break;
		}

		step(next);
	}

	// --- results -------------------------------------------------------------
	// One sweep covers every way a channel ends — its own `$00`, an error, the
	// budget — since the pending runs stay on the track either way.
	for (const track of tracks) {
		settleRun(track.pendingCall);
		settleRun(track.pendingSub);
	}

	const loops: LoopRun[] = finishedRuns
		.sort((a, b) => a.opened - b.opened)
		.map(({ channel, kind, from, body, passes }) => ({ channel, kind, from, body, count: passes.length, passes }));

	const channelTicks = tracks.map((track) => track.ticks);
	const playing = channelTicks.filter((_, channel) => used[channel]);
	const ticks = playing.length > 0 ? Math.min(...playing) : 0;

	const played: WalkNote[] = [];
	const dropped: number[] = [];
	for (const note of notes) {
		// A note the pass never reaches. Drawing music that does not play is the
		// more confusing of the two choices, so it is set aside instead — see
		// {@link SongTimeline.unreachable}, which is what reports it.
		if (note.tick >= ticks && ticks > 0) {
			dropped.push(note.address);
			continue;
		}

		played.push(note);

		// `PercNote` runs to `$D9` (`main.asm:355-360`) though AddmusicK only ever
		// emits `$D0`-`$D8`, so a tenth "drum" reads a percussion entry that is not
		// there. The byte sets its own instrument, so this is the one percussion
		// byte that can go wrong, and only from a malformed blob.
		if (note.percussion !== null && note.percussion >= PERCUSSION_SLOTS) {
			problems.push(`A percussion byte outside the driver's nine drums sounded (0x${note.note.toString(16)}).`);
		}
	}

	played.sort((a, b) => a.tick - b.tick || a.channel - b.channel);

	// A written note is dead only when *no* occurrence of it survives. Inside a
	// loop the same address sounds many times, and losing the last few
	// iterations is not the same as losing the note.
	const sounding = new Set(played.map((note) => note.address));
	const unreachable = [...new Set(dropped)].filter((address) => !sounding.has(address));

	let resolvedLoopTick: number | null = null;
	if (Number.isFinite(loopTick)) {
		resolvedLoopTick = loopTick;
	} else if (loopTick === Number.POSITIVE_INFINITY) {
		problems.push("The song loops, but no channel reached the point it loops back to.");
	}

	return {
		notes: played,
		ticks,
		loopTick: resolvedLoopTick,
		// The same cut `played` takes: a command past the shortest channel is
		// never reached, on this pass or any later one.
		tempoChanges: tempoChanges.filter((change) => ticks === 0 || change.tick < ticks),
		tempoAtEnd,
		carries:
			resolvedLoopTick === null || truncated || resolvedLoopTick >= ticks
				? []
				: carriesAt(resolvedLoopTick, ticks, channelsAtEnd, songAtEnd),
		// Sorted rather than pushed in order: a `$DD` is raised on the tick of the
		// note that read it, which is behind the tick the byte was reached at, so
		// `c4 v200 $DD …` records the two the other way round. Stable, so within one
		// tick the driver's own order is what stands.
		commands: commands.filter((command) => ticks === 0 || command.tick < ticks).sort((a, b) => a.tick - b.tick),
		loops,
		channelTicks,
		used,
		unreachable,
		customInstruments,
		truncated,
		problems,
	};

	function empty(reason: string[]): SongTimeline {
		return {
			notes: [],
			ticks: 0,
			loopTick: null,
			tempoChanges: [],
			tempoAtEnd: null,
			carries: [],
			commands: [],
			loops: [],
			channelTicks: new Array<number>(VOICES).fill(0),
			used: new Array<boolean>(VOICES).fill(false),
			unreachable: [],
			customInstruments: [],
			truncated: false,
			problems: [...problems, ...reason],
		};
	}

	/**
	 * Every setting the repeat starts its loop under differently. A function of
	 * its arguments rather than of the variables `step` assigns, which the
	 * compiler would otherwise read as never having left `null`.
	 */
	function carriesAt(
		at: number,
		passTicks: number,
		channels: readonly Readonly<Record<ChannelSetting, SettingState>>[] | null,
		wide: Readonly<Record<SongSetting, SettingState>> | null,
	): SettingCarry[] {
		if (channels === null || wide === null) {
			return [];
		}

		const found = [
			...tracks.flatMap((track, channel) =>
				track.atLoop === null || track.loopHead === null
					? []
					: channelCarries(
							channel,
							{
								atFirst: track.atLoop,
								atNote: track.atLoopNote,
								head: track.loopHead,
								headToFirst: track.headToFirst,
								startsOnRest: track.startsOnRest,
								soundingFirst: track.soundingAtLoop,
								// The walk runs each channel to its own end, so one longer
								// than the pass is the one the phrase change cuts.
								cutAtSeam: track.ticks > passTicks,
							},
							channels[channel],
						),
			),
			...songCarries(songChanges, at, wide),
		];

		// One `@` both sets the instrument and silences `n`; the setting named
		// first is the one reported.
		const seen = new Set<string>();
		return found.filter((carry) => {
			const key = `${carry.channel}:${carry.repeat.address}`;
			if (seen.has(key)) {
				return false;
			}

			seen.add(key);
			return true;
		});
	}
}

/**
 * `SST0502` — a channel with more music in it than the song is long.
 *
 * Sits beside `@amk/tokens`' echo hazards in the `SST05xx` range, which is the
 * band for diagnostics `Music.cpp` does not produce at all — this one is about
 * what the song *does* rather than about whether it builds. `severe` on its own
 * account rather than the range's: it compiles cleanly and then misbehaves on
 * playback, the extra music dropped in silence.
 */
const CODE_UNREACHABLE = "SST0502";

/** Spoken lists read better than comma-joined ones in a sentence. */
function listOf(names: string[]): string {
	return names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Reports channels the song is too short to reach the end of.
 *
 * The driver ends a phrase the moment *any* voice reads its terminating `$00`,
 * resetting all eight track pointers together (`main.asm:L_0C01`), so the song
 * is only as long as its shortest channel — `Music.cpp:3209` says the same, and
 * `stats.loopTicks` is computed from it. Everything written past that point is
 * dropped without a sound, which is why this is worth saying out loud: it is
 * nearly always a loop count or a note length out by a factor of two.
 *
 * `noteMap` supplies the span, so the report points at the first note that goes
 * unplayed rather than at the channel header.
 */
export function unreachableChannels(timeline: SongTimeline, noteMap: readonly NoteAddress[]): Diagnostic[] {
	const lengths = timeline.channelTicks
		.map((ticks, channel) => ({ ticks, channel }))
		.filter((c) => timeline.used[c.channel]);
	if (lengths.length < 2) {
		return [];
	}

	const shortest = lengths.reduce((a, b) => (b.ticks < a.ticks ? b : a));
	const over = lengths.filter((c) => c.ticks > shortest.ticks);
	if (over.length === 0) {
		return [];
	}

	// Point at the first note that never sounds. Often there is none to point
	// at: a channel that runs long only because a loop repeats too many times
	// loses iterations rather than notes, so fall back to the last thing written
	// on the longest channel, which is where its music runs past the end.
	const byAddress = new Map(noteMap.map((entry) => [entry.address, entry]));
	const first = timeline.unreachable
		.map((address) => byAddress.get(address))
		.filter((entry) => entry !== undefined)
		.sort((a, b) => a.span.start - b.span.start)[0];

	// The last note that *does* sound on the longest channel — click it and you
	// land where its music runs out. Taken from the walk rather than by
	// filtering `noteMap` on the channel, because a `[ ]` loop's notes are
	// recorded against the loop block and only the walk knows which voice calls
	// it; on a looping channel that filter finds nothing at all.
	const longest = over.reduce((a, b) => (b.ticks > a.ticks ? b : a));
	const surviving = timeline.notes.filter((note) => note.channel === longest.channel);
	const last = byAddress.get(surviving[surviving.length - 1]?.address ?? -1);

	const names = listOf(over.map((c) => `#${c.channel}`));

	return [
		{
			severity: "severe",
			code: CODE_UNREACHABLE,
			message:
				over.length === 1
					? SST["0502.one"](names, shortest.channel, shortest.ticks)
					: SST["0502.other"](names, shortest.channel, shortest.ticks),
			span: first?.span ?? last?.span ?? { start: 0, end: 0, line: 1 },
		},
	];
}
