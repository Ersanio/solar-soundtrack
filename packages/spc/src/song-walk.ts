/**
 * Reads a compiled song the way the driver reads it, and says what sounds when.
 *
 * The compiler emits bytes and `noteMap` remembers which source text each note
 * came from, but this data is incomplete: neither records a pitch, a duration
 * or a tick.
 *
 * This walks the emitted stream exactly as `main.asm`'s fetch loop does and
 * produces the missing timeline — every note, on its own tick, with the state
 * in force.
 *
 * This is used to emulate the song inside the piano roll.
 *
 * Walking the bytes rather than the source is what makes it faithful. Two
 * behaviours make the point: `@29 o2a1b2c3` compiles to `$D8 $97 $98` on `#0`
 * but `$D8 $D8 $D8` on `#6` (`parser.ts:2672-2678`), and `@21`-`@29` emit no
 * `$DA` at all (`parser.ts:1812-1843`), so the instrument is only knowable by
 * following what the driver does with a `$D0` byte. A pass over the text would
 * have to re-derive both.
 *
 * Deliberately **not** modelled, because none of it moves a note in time:
 *   - runtime transposition (`$E4`, `$EE`, `$FA $02`). A row is the *emitted*
 *     note byte; transposition is reported as state instead of a moved bar.
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

import {
	FIRST_PERCUSSION_INSTRUMENT,
	FIRST_VCMD,
	HEX_LENGTHS,
	LAST_VCMD,
	NOTE_DURATIONS,
	NSPC_VELOCITY_OFFSET,
	VELOCITY_VALUES,
} from "@amk/core/hardcoded-tables";
import type { Diagnostic, NoteAddress } from "@amk/core/types";

/** N-SPC songs have eight music channels. */
const CHANNELS = 8;

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
const PERCUSSION_FIRST = 0xd0;
/** `$D0`-`$D8`, the driver's nine drums, reached as `@21`-`@29`. */
const PERCUSSION_COUNT = 9;

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
/** Bytes one channel may read in a phrase. Generous; only a loop can reach it. */
const STEP_BUDGET = 2_000_000;

/** The song-wide and per-channel settings a note sounds under. */
export interface NoteState {
	/** `$DA`'s operand, or the drum a `$D0`-`$D8` byte selected. `null` if unset. */
	instrument: number | null;
	/** `$E7`/`$E8` channel volume. */
	volume: number | null;
	/** `$DB`/`$DC` pan, as written — bits 6-7 are the surround flags. */
	pan: number | null;
	/** The raw `q` byte, or `null` while the channel has not set one. */
	quantization: number | null;
	/** `NoteDurations[(q >> 4) & 7]` — the fraction of the slot that sounds. */
	gate: number;
	/** `VelocityValues[...]`, through whichever table is selected. */
	velocity: number;
	vibrato: boolean;
	tremolo: boolean;
	/** `$F8`'s clock, or `null` when the channel is not making noise. */
	noise: number | null;
	/** `$E4` song-wide transposition, in semitones. */
	transpose: number;
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

/** One sounding note, expanded onto the song's own tick timeline. */
export interface WalkNote {
	/** 0-7. The voice it sounds on, even when its bytes live in the loop block. */
	channel: number;
	/** Ticks from the start of the pass. */
	tick: number;
	/** Ticks the slot occupies. `$C6` ties are folded in. */
	ticks: number;
	/** Ticks it actually sounds: `main.asm:2439-2449`, floored at one. */
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
}

/** A song-wide tempo command, on the tick the driver runs it. */
export interface TempoChange {
	/** Ticks from the start of the pass. */
	tick: number;
	/** The `t` byte: `$E2`'s only operand, `$E3`'s *second*. */
	tempo: number;
	/** `$E3`'s duration byte. 0 for `$E2`, which takes effect at once. */
	fadeTicks: number;
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
	 * more than once has no place in it (`parser.ts:1692`) and a fade has no
	 * segment at all (`parser.ts:1705`, porting `Music.cpp:809`) — either one
	 * makes it abandon the whole song's length. Walking bytes has neither
	 * problem: a `t` in a loop body appears once per iteration, at the tick that
	 * iteration reaches, because that is what the driver does with it.
	 *
	 * Cut at the end of the pass the same way {@link notes} is — a `t` past the
	 * shortest channel never runs, which is what `AMK0217` warns about.
	 */
	tempoChanges: readonly TempoChange[];
	/** Ticks walked per channel, to cross-check against `stats.channelTicks`. */
	channelTicks: readonly number[];
	/** Channels the song writes to. */
	used: readonly boolean[];
	/** Every `@n` the song sounds a note on, ascending and distinct. */
	usedInstruments: readonly number[];
	/** ARAM addresses of notes that never sound at all. Used for diagnostics. */
	unreachable: readonly number[];
	/** `#instruments` entries, six bytes each, `@30` first. */
	customInstruments: readonly (readonly number[])[];
	/** A budget ran out and the walk stopped early. */
	truncated: boolean;
	/** Anything malformed, named. Empty on a well-formed song. */
	problems: readonly string[];
}

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
	if (vcmd === 0xfb) {
		const count = song[index + 1] ?? 0;
		return count >= 0x80 ? 4 : count + 3;
	}

	// `$FA $FE`'s hot patch takes one further byte for *every* trailing byte
	// whose high bit is set: `.FACommand_readUntilPositive` (`main.asm:3006`)
	// loops while `bmi`, then steps once more past the byte that ended it.
	if (vcmd === 0xfa && song[index + 1] === 0xfe) {
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
	/**
	 * Where the current note's frame began, or -1 when it begins at the note
	 * byte itself. `emitNote` (`parser.ts:2766`) writes `[duration][q][note]`
	 * and the note map records the offset *before* any of it, so a note that
	 * carries a duration is addressed by that byte and not by its own.
	 */
	frameAt: number;
	/**
	 * `$E9`'s frame: `$C0+x` counts iterations, `$03E0/1` is where to return and
	 * `$03F0/1` is where to restart. `cmdE9` (`Commands.asm:161`) stores the
	 * count as written, and the `$00` handler decrements before testing, so the
	 * body runs exactly `count` times.
	 */
	callCount: number;
	callReturn: number;
	callRestart: number;
	/**
	 * `$E6`'s frame, which shares nothing with `$E9`'s — it is `$01E0/1` and
	 * `$01F0` (`Commands.asm:31`), so a subloop nests inside a call without
	 * either disturbing the other. `$E6 $00` stores `$FF`; the first closing
	 * `$E6 $n` sees `$FE` after its `dec` and loads `n`, so the body plays n+1
	 * times.
	 */
	loopCount: number;
	loopStart: number;
	state: ChannelState;
	/** The last frozen snapshot, reused until something changes. */
	snapshot: NoteState | null;
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
}

const word = (song: Uint8Array, at: number): number => song[at] | (song[at + 1] << 8);

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

	/** Blob index of an ARAM address, or -1 when it does not land in the blob. */
	const indexOf = (address: number): number => {
		const index = address - aramAddress;
		return index >= 0 && index < song.length ? index : -1;
	};

	// --- the phrase table --------------------------------------------------
	//
	// `L_0C01` (`main.asm:2283`) reads a word at a time: a non-zero high byte is
	// a pointer to eight channel starts, `$0000` ends the song, and `$00nn` is
	// "repeat nn times, target in the next word". `link.ts:268-277` writes the
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
	// and is only the repeat unit. That is the same range `worklet.ts:279-294`
	// folds the playhead into, so the drawing and the playhead agree.
	const loopEntry = loopTarget === null ? -1 : indexOf(loopTarget);
	const loopPhrase = loopEntry >= 0 ? indexOf(word(song, loopEntry)) : -1;

	// --- the instrument block ----------------------------------------------
	//
	// `buildHeader` (`link.ts:187-226`) writes the first phrase pointer at word
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

	for (let channel = 0; channel < CHANNELS; channel++) {
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
			frameAt: -1,
			callCount: 0,
			callReturn: -1,
			callRestart: -1,
			loopCount: 0,
			loopStart: -1,
			state: {
				instrument: null,
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
			},
			snapshot: null,
		});
	}

	// Song-wide state. Any channel may write it and every channel reads it.
	// `tempo` is 0 until the song sets one; the caller supplies its own default,
	// since what AddmusicK assumes for an untempoed song is a compiler question.
	const shared = { transpose: 0, tempo: 0, globalVolume: null as number | null, secondVelocityTable: true };
	let loopTick = loopPhrase >= 0 ? Number.POSITIVE_INFINITY : Number.NaN;
	let truncated = false;

	/** Freezes the state a note sounds under, reusing the last one when it stands. */
	const snapshot = (track: Track): NoteState => {
		track.snapshot ??= {
			instrument: track.state.instrument,
			volume: track.state.volume,
			pan: track.state.pan,
			quantization: track.state.quantization,
			gate: track.state.gate,
			velocity: track.state.velocity,
			vibrato: track.state.vibrato,
			tremolo: track.state.tremolo,
			noise: track.state.noise,
			transpose: shared.transpose,
			tempo: shared.tempo,
			globalVolume: shared.globalVolume,
		};

		return track.snapshot;
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
			if (track.at === loopAt[channel] && track.ticks < loopTick) {
				loopTick = track.ticks;
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
					track.at = -1;
					return;
				}

				track.callCount--;
				track.at = track.callCount === 0 ? track.callReturn : track.callRestart;
				track.frameAt = -1;
				continue;
			}

			if (byte < NOTE_LOWEST) {
				// A duration byte, and then one fetch that is *not* guarded against
				// zero (`main.asm:2374-2377` tests `bmi`, not `beq`). So a `$00`
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
		// The frame, not the note byte: `link.ts:78-84` addresses a note by where
		// its emission *began*, which is the duration byte whenever one was
		// written. Addressing the note byte instead misses the map on every note
		// that changes length, which is most of them.
		const address = aramAddress + (track.frameAt >= 0 ? track.frameAt : track.at);
		track.frameAt = -1;
		track.at += 1;

		const ticks = track.duration;

		// `$C6` returns before any key-on or key-off (`main.asm:2403-2405`), so the
		// note already sounding simply runs longer. Folding the tie into that note
		// is what makes a piano roll draw one bar rather than several.
		if (byte === NOTE_TIE_BYTE) {
			if (track.held >= 0) {
				const previous = notes[track.held];
				previous.ticks += ticks;
				// Every segment before the last sounds in full — the tie never keys
				// off — and only this one is cut short by the gate in force now.
				previous.gateTicks = previous.ticks - ticks + gateTicks(ticks, track.state.gate);
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
			}
		}

		track.held = notes.length;
		notes.push({
			channel,
			tick: track.ticks,
			ticks,
			gateTicks: gateTicks(ticks, track.state.gate),
			note: byte,
			key: percussion === null ? byte - NOTE_LOWEST : null,
			percussion,
			address,
			state: snapshot(track),
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

		switch (vcmd) {
			case 0xda: // instrument
				state.instrument = arg(0);
				state.noise = null;
				break;
			case 0xdb: // pan
			case 0xdc: // pan fade — the second byte is the target
				state.pan = vcmd === 0xdb ? arg(0) : arg(1);
				break;
			case 0xde:
				state.vibrato = true;
				break;
			case 0xdf:
				state.vibrato = false;
				break;
			case 0xe0:
			case 0xe1:
				shared.globalVolume = vcmd === 0xe0 ? arg(0) : arg(1);
				break;
			case 0xe2:
			case 0xe3:
				// `track.ticks` is the driver's own position for this command: a
				// channel is only ever advanced while it is the furthest behind
				// (the loop below), and `step` moves the clock at most once, in
				// `emitNote` — so the eight channels' commands are recorded in the
				// order the driver would run them, already ascending by tick.
				tempoChanges.push({
					tick: track.ticks,
					tempo: vcmd === 0xe2 ? arg(0) : arg(1),
					fadeTicks: vcmd === 0xe2 ? 0 : arg(0),
				});
				// The target, not what a fade is passing through — see
				// {@link NoteState.tempo}. Pricing a fade tick by tick is the
				// clock's job, and it reads `tempoChanges` to do it.
				shared.tempo = vcmd === 0xe2 ? arg(0) : arg(1);
				break;
			case 0xe4:
				shared.transpose = (arg(0) << 24) >> 24;
				break;
			case 0xe5:
				state.tremolo = true;
				break;
			case 0xe7:
			case 0xe8:
				state.volume = vcmd === 0xe7 ? arg(0) : arg(1);
				break;
			case 0xf8:
				state.noise = arg(0);
				break;
			case 0xfa:
				// `$FA $06` picks the velocity table. `main.asm:2379` tests it
				// against zero, so anything non-zero is the N-SPC half.
				if (arg(0) === 0x06) {
					shared.secondVelocityTable = arg(1) !== 0;
				}

				dirty = false;
				break;

			case 0xe6: {
				// `cmdE6` (`Commands.asm:31`). `$E6 $00` marks; a non-zero argument
				// closes, and the count is loaded on the first close only, so the
				// body plays one more time than the byte says.
				if (arg(0) === 0) {
					track.loopStart = argAt + 1;
					track.loopCount = 0xff;
				} else if (track.loopStart >= 0) {
					track.loopCount = track.loopCount === 0xff ? arg(0) : track.loopCount - 1;
					if (track.loopCount > 0) {
						track.at = track.loopStart;
						return;
					}

					track.loopStart = -1;
				}

				dirty = false;
				break;
			}

			case 0xe9: {
				// `cmdE9` (`Commands.asm:161`) — what a `[ ]` loop compiles to. The
				// count is stored as written and the `$00` handler decrements before
				// testing, so the body runs exactly that many times.
				const target = indexOf(arg(0) | (arg(1) << 8));
				const count = arg(2);
				if (target < 0) {
					// `*` before any `[ ]` emits `$E9 FF FF n` on purpose
					// (`parser.ts:2478-2487`, porting `Music.cpp:1321`), because
					// AddmusicK builds it. A call to nowhere ends the channel here
					// rather than throwing, so the other seven still draw.
					problems.push(`Channel ${channel} calls a loop that was never defined.`);
					track.at = -1;
					return;
				}

				if (count === 0) {
					break;
				}

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
		for (let channel = 0; channel < CHANNELS; channel++) {
			if (tracks[channel].at >= 0 && (next < 0 || tracks[channel].ticks < tracks[next].ticks)) {
				next = channel;
			}
		}

		if (next < 0) {
			break;
		}

		if (tracks[next].ticks > TICK_BUDGET || notes.length > NOTE_BUDGET) {
			truncated = true;
			problems.push("The song is longer than the roll will draw.");
			break;
		}

		step(next);
	}

	// --- results -------------------------------------------------------------
	const channelTicks = tracks.map((track) => track.ticks);
	const playing = channelTicks.filter((_, channel) => used[channel]);
	const ticks = playing.length > 0 ? Math.min(...playing) : 0;

	const instruments = new Set<number>();

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
		if (note.state.instrument !== null) {
			instruments.add(note.state.instrument);
		}

		// `PercNote` runs to `$D9` (`main.asm:355-360`) though AddmusicK only ever
		// emits `$D0`-`$D8`, so a tenth "drum" reads a percussion entry that is not
		// there. The byte sets its own instrument, so this is the one percussion
		// byte that can go wrong, and only from a malformed blob.
		if (note.percussion !== null && note.percussion >= PERCUSSION_COUNT) {
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
		channelTicks,
		used,
		unreachable,
		usedInstruments: [...instruments].sort((a, b) => a - b),
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
			channelTicks: new Array<number>(CHANNELS).fill(0),
			used: new Array<boolean>(CHANNELS).fill(false),
			unreachable: [],
			usedInstruments: [],
			customInstruments: [],
			truncated: false,
			problems: [...problems, ...reason],
		};
	}
}

/**
 * `AMK0502` — a channel with more music in it than the song is long.
 *
 * Sits beside `@amk/tokens`' echo hazards in the `AMK05xx` range: a diagnostic
 * about what the song *does* rather than about whether it builds. `severe`
 * because that is the band for "compiles cleanly, then misbehaves on playback",
 * which is exactly this — the extra music is dropped in silence.
 */
const CODE_UNREACHABLE = "AMK0502";

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

	const names = over.map((c) => `#${c.channel}`);
	const plural = over.length === 1 ? "is" : "are";

	return [
		{
			severity: "severe",
			code: CODE_UNREACHABLE,
			message:
				`${listOf(names)} ${plural} longer than the song. It lasts as long as its shortest channel, ` +
				`#${shortest.channel} at ${shortest.ticks} ticks, and everything past that is never played.`,
			span: first?.span ?? last?.span ?? { start: 0, end: 0, line: 1 },
		},
	];
}

/**
 * How much of a slot a note sounds for. `main.asm:2439-2449`:
 * `mul ya` over the duration and `NoteDurations[...]`, keep the high byte, and
 * `inc a` when it came out zero — so the shortest staccato is still one tick.
 */
function gateTicks(ticks: number, gate: number): number {
	return Math.max(1, (ticks * gate) >> 8);
}
