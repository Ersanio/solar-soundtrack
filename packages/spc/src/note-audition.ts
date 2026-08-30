/**
 * Playing one note as it would sound at a point in the song.
 *
 * `driver-state.ts` reads the running driver and `song-walk.ts` predicts what the
 * song will do; this is the third use of the same knowledge — putting a note the
 * song does not contain in front of the driver and hearing what comes out.
 *
 * The state a note sounds under is enormous: an instrument, its sample and
 * envelope, a track volume that may be mid-fade, a pan, a tuning, `q`'s gate and
 * velocity, vibrato and tremolo phase, a pitch envelope, the global volume, the
 * tempo, and an echo buffer holding the last delay's worth of the song. Nothing
 * short of the driver knows all of it, and the walk deliberately models only part
 * of it. So the song is emulated from the top to the tick asked for and the note
 * is handed to the driver there, rather than reconstructed from a description.
 *
 * The output is PCM. Rendering ahead rather than playing live is what keeps this
 * off the audio thread the song is using: `worklet.ts` is never addressed, no
 * message reaches `SpcPlayer`, and the ARAM written here belongs to a second
 * emulator that is thrown away at the next `loadSpc`. A note can therefore be
 * auditioned while the song plays, which is the whole point of it. The cost is
 * that the length is fixed when the request is made — there is nothing to send a
 * note-off to.
 */

import type { PitchSlide } from "./song-walk";
import { SPC_CHANNELS, SPC_SAMPLE_RATE, type SpcCore } from "./wasm-host";
import {
	TICK_POLL_HZ,
	VOICES,
	applyChannelMutes,
	createMuteBackup,
	createTickPhase,
	type MuteBackup,
	inVoiceLoop,
	parkVoice,
	passMark,
	restoreTrackVolume,
	sawTick,
	seedTickPhase,
	startVoiceAt,
	tickVoice,
	voiceFetchMark,
	voiceHasInstrument,
	voiceHasQuantization,
	voicePlaying,
	voiceStarted,
	volumesSettled,
} from "./driver-state";

/** Emulated frames per poll, matching what `worklet.ts` counts ticks at. */
const BLOCK = SPC_SAMPLE_RATE / TICK_POLL_HZ;

/**
 * How long the release and the echo are given to ring out past the note.
 *
 * Seconds, and deliberately: everything that follows the music is denominated in
 * ticks, but this does not follow the music. It is an envelope releasing and an
 * echo buffer emptying, both of which run on the DSP's own clock at a rate no
 * tempo changes.
 */
export const AUDITION_TAIL_SECONDS = 1;

/** The last of the tail, ramped to zero so a sample still sounding does not click. */
const FADE_SECONDS = 0.02;

/**
 * An outright ceiling on one audition, in emulated seconds.
 *
 * A tick is 0.512 s at the slowest tempo the driver can hold, which would make
 * 192 of them a minute and a half. This is a click's answer, not a performance:
 * past this the note is cut and `heldTicks` says it was.
 */
const MAX_AUDITION_SECONDS = 10;

/**
 * How long the fast-forward will run without the tick count moving before it
 * gives up, and an outright ceiling — the same two guards `worklet.ts` states,
 * for the same reason. Restated rather than imported: `worklet.ts` is bundled
 * standalone for the audio thread and exports nothing.
 */
const SEEK_STALL_BLOCKS = 2 * TICK_POLL_HZ;
const MAX_SEEK_SECONDS = 999;

/** `$C6` holds the note, `$C7` releases it, `$00` ends the track. */
const NOTE_TIE = 0xc6;
const NOTE_REST = 0xc7;
const TRACK_END = 0x00;

/** `$DA` is the instrument command, and `@0` is what the driver defaults to. */
const VCMD_INSTRUMENT = 0xda;
const DEFAULT_INSTRUMENT = 0x00;

/** `$DD`, the pitch slide, which the note before it reads rather than the command loop. */
const VCMD_PITCH_SLIDE = 0xdd;

/**
 * The `q` a channel's first note carries when the song has not set one — `q7f`,
 * a full-length note at full velocity, which is what the compiler starts every
 * channel at (`parser.ts:187`).
 */
const DEFAULT_Q = 0x7f;

/** The most a duration byte can say; `$80` and up is a note. */
const MAX_DURATION = 0x7f;

/** Music.cpp:2254 — a note this long is split, into chunks of this. */
const LONG_NOTE = 0x80;
const LONG_CHUNK = 0x60;

/**
 * The driver's main loop handles at most one music tick per pass and runs at
 * about 500 Hz, so this is the most ticks a second of audio can contain. Used to
 * size the rests that follow the note, which have to outlast the tail.
 */
const MAX_TICK_HZ = 500;

/**
 * Blocks of silence before the note: the least the driver is ever given, and the
 * most it is ever waited for.
 *
 * The settle runs until the driver says it has written the `VxVOL`s it was asked
 * for, which is `$5C` going to zero (`main.asm:2512`). That is on a music tick,
 * and a tick is 0.512 s at the slowest tempo the driver can hold, so the wait is
 * bounded rather than left to the song — and a stopped song has no tick at all.
 */
const SETTLE_BLOCKS = 4;
const MAX_SETTLE_BLOCKS = 100;

/**
 * Frames per step while waiting for a voice's fetch, and how long either half of
 * the arrival waits.
 *
 * A pass of the driver's main loop is held to 2 ms by timer 0 (`main.asm:176`),
 * and the busiest of them — one music tick fetching, dispatching and keying on
 * for eight voices — runs past twice that, which is the same work the tempo
 * shortfall is made of. So the budget is many passes. The step is a fraction of
 * one; the pass boundary the second half looks for is found a frame at a time,
 * being a boundary rather than a stretch.
 */
const ARRIVE_STEP = 8;
const ARRIVE_FRAMES = SPC_SAMPLE_RATE / 20;

export interface NoteAuditionRequest {
	/** Where in the song the note is played, in music ticks. */
	atTicks: number;
	/** Music channel, 0 to 7. */
	channel: number;
	/**
	 * The note byte as the compiler would emit it — `$80`-`$C5` pitched, or
	 * `$D0`-`$D8` for a drum. Transposition is already in it: `h` and the
	 * instrument's tuning are applied at compile time (`parser.ts:2737-2741`), so
	 * a written pitch is not the byte that plays and this end cannot work out the
	 * difference.
	 */
	note: number;
	/** How long the note is held, in music ticks. */
	ticks: number;
	/**
	 * ARAM address of a few bytes the driver can be pointed at.
	 *
	 * The song's own load address is the natural answer: every other voice is
	 * parked before this is written, and the `$40` phrase table is only read when
	 * a voice reaches `$00` (`L_0C01`), which a parked voice never does. Free
	 * space no ARAM budget can take away.
	 */
	scratchAt: number;
	/**
	 * The `$DD` this note plays, as `song-walk.ts` read it, or nothing.
	 *
	 * The song's own `$DD` is never reached — the voice is pointed away from the
	 * song data before the note is handed over — so a slide has to be written into
	 * the frames, which {@link noteFrames} does. `target` must arrive **as the
	 * compiler emitted it**: the driver adds `$43` and `!HTuneValues+x` itself at
	 * arm time (`main.asm:3277-3285`), so anything that transposes a written pitch
	 * on the way here has to leave this alone.
	 */
	slide?: PitchSlide | null;
	/**
	 * Voices the mixer is silencing, as a bitmask. `0` for no mixer at all.
	 *
	 * **This is what the note is heard against.** The other seven voices are
	 * parked rather than halted, so they go on sounding whatever they are playing
	 * at that tick and the note arrives in the middle of it; the mask is what says
	 * which of them. It is held through the fast-forward the way `worklet.ts`
	 * holds it — so the echo the note lands on is the echo the transport is
	 * making — and pressed back on after every block of the recording, since the
	 * driver rewrites `VxVOL` as it goes and a mute that is not reapplied does not
	 * stick.
	 *
	 * The target's own bit is ignored. Honouring it would take that voice's volume
	 * during the fast-forward and step 5 below would hand it straight back, so the
	 * note would sound anyway and the only effect would be the target going
	 * missing from its own echo. A caller that wants silence needs no emulator.
	 */
	silenced?: number;
}

export interface AuditionedNote {
	/** Interleaved stereo at {@link SPC_SAMPLE_RATE}, owning its own buffer. */
	pcm: Int16Array;
	/**
	 * Ticks the fast-forward reached; short of `atTicks` if the song ended first,
	 * and 1 for a request of 0, since the driver has to be started before a note
	 * can be handed over.
	 */
	reachedTicks: number;
	/** Ticks the note was held; short of `ticks` if the ceiling above was hit. */
	heldTicks: number;
}

/**
 * One run of note frames, mirroring `Parser.emitNote` (`parser.ts:2853`,
 * Music.cpp:2254). Returns the last frame's own length, which is what the next
 * duration byte has to be compared against — the compiler drops one that repeats.
 */
function appendNote(bytes: number[], note: number, ticks: number, q: readonly number[]): number {
	let left = ticks;

	if (left < LONG_NOTE) {
		bytes.push(left, ...q, note);
		return left;
	}

	bytes.push(LONG_CHUNK, ...q, note);
	left -= LONG_CHUNK;

	while (left > LONG_CHUNK) {
		bytes.push(NOTE_TIE);
		left -= LONG_CHUNK;
	}

	if (left === 0) {
		return LONG_CHUNK;
	}

	// The duration byte carries over, so an exact chunk needs no new one.
	if (left !== LONG_CHUNK) {
		bytes.push(left);
	}

	bytes.push(NOTE_TIE);
	return left;
}

/**
 * The frames the driver is handed for one note, mirroring `Parser.emitNote`
 * (`parser.ts:2853`, Music.cpp:2254) so a note auditioned here is the same bytes
 * the compiler would write for a note of that length.
 *
 * **`quantization` is normally `null`.** The driver only reads a `q` byte when
 * the byte after the duration is below `$80` (`main.asm:2382-2397`), so leaving
 * it out is what makes the gate and velocity the song left in
 * `$0201+2n`/`$0211+2n` stand — which is what "as it would sound there" means.
 * It is supplied only for a voice that has none, where {@link DEFAULT_Q} stands
 * in for the `q` the compiler would emit with the channel's first note.
 *
 * **A `slide` is written where `emitNote` would leave it**, rather than modelled.
 * `$DD` is not dispatched: the note before it reads it by peeking at the byte
 * standing at the track pointer (`main.asm:L_10E4`), and only on a tick that does
 * not fetch music data — `main.asm:2337-2339` jumps past `L_0CC6`'s read-ahead on
 * one that does. So **where it arms is decided by the frame the peek reads it
 * in**, which {@link PitchSlide.afterTicks} and {@link PitchSlide.frameTicks}
 * carry between them and which is why `Music.cpp:2224` rewinds a tie out of a
 * `$DD`'s way. The four bytes go after that frame — straight after the note byte
 * for an `arm` of 0 — and whatever the note has left runs on behind them as ties,
 * which is what a tie written *after* the command leaves.
 *
 * A slide no `emitNote` could have written is **dropped**, and the frames come
 * out byte for byte those of the flat note: an approximate bend that sounds like
 * the real one is worse than none.
 *
 * Rests follow, so the note keys off at the end of its length and its release is
 * heard, and there are enough of them to outlast {@link AUDITION_TAIL_SECONDS} at
 * a rate no driver can exceed. `$00` closes the block as a backstop; reaching it
 * would send the driver to the phrase table, which by then is underneath these
 * very bytes.
 */
export function noteFrames(
	note: number,
	ticks: number,
	quantization: number | null = null,
	slide: PitchSlide | null = null,
): Uint8Array {
	const bytes: number[] = [];
	const held = Math.max(1, Math.floor(ticks));

	/** `emitPendingQuantization` puts it straight after the duration byte. */
	const q = quantization === null ? [] : [quantization];

	// Where the frame carrying the arm begins, how long it runs, and what is left
	// of the note behind it. A negative arm is a frame before the note's head; a
	// frame of no ticks, or one over `$7F`, is a duration byte no `emitNote`
	// wrote; and a negative remainder is a frame the note is not long enough for.
	const arm = slide === null ? 0 : Math.floor(slide.afterTicks);
	const frame = slide === null ? 0 : Math.floor(slide.frameTicks);
	const after = held - arm - frame;
	const bend = slide !== null && arm >= 0 && frame >= 1 && frame <= MAX_DURATION && after >= 0 ? slide : null;

	if (bend === null) {
		appendNote(bytes, note, held, q);
	} else {
		if (arm === 0) {
			bytes.push(frame, ...q, note);
		} else {
			const previous = appendNote(bytes, note, arm, q);
			if (frame !== previous) {
				bytes.push(frame);
			}

			bytes.push(NOTE_TIE);
		}

		bytes.push(VCMD_PITCH_SLIDE, bend.delay, bend.duration, bend.target);

		// The rest of the note, as the ties it is. Once the slide has armed it runs
		// off `$90`/`$91` rather than off frames, so what these are is inaudible and
		// only the total has to be right; chunking at `LONG_CHUNK` is what the
		// compiler would have written.
		let left = after;
		let standing = frame;
		while (left > 0) {
			const step = Math.min(left, LONG_CHUNK);
			if (step !== standing) {
				bytes.push(step);
			}

			bytes.push(NOTE_TIE);
			standing = step;
			left -= step;
		}
	}

	const rests = Math.ceil((MAX_TICK_HZ * AUDITION_TAIL_SECONDS) / MAX_DURATION) + 1;
	for (let rest = 0; rest < rests; rest++) {
		bytes.push(MAX_DURATION, NOTE_REST);
	}

	bytes.push(TRACK_END);
	return Uint8Array.from(bytes);
}

/**
 * Plays `spc` silently up to `atTicks`, then hands the driver one note and
 * records what comes out.
 *
 * **With the rest of the song still sounding under it.** The other seven voices
 * are parked, not halted: each one goes on playing the note it holds at that
 * tick, keys off where its own note ends, and never reads another byte of music
 * data. So a click on a note in a chord is that chord, and `silenced` says which
 * of its channels are in it.
 *
 * The recipe, all of it against `main.asm`:
 *
 * 0. **Fast-forward under the mixer's mask**, so the echo the note is about to
 *    land on is the echo the transport is making. See `silenced`.
 * 1. **Arrive**, which is not the same as reaching the tick: {@link arrive} waits
 *    for the target voice to have read that tick's music and for the driver to be
 *    out of its per-voice loop. Then {@link parkVoice}, so the settle cannot
 *    carry the voice past the tick that was asked for.
 * 2. **Silence every voice** through {@link applyChannelMutes} until the driver
 *    has cleared `$5C`, so whatever was ringing stops without a click and
 *    `MuteBackup` is holding the target voice's own volume. Then arrive again,
 *    the settle having rendered.
 * 3. **Park the other seven** with {@link parkOthers}, so they sound what they
 *    are playing at that tick and read no further music data. Nothing else
 *    parses from here, which is what makes the note repeatable and what frees
 *    the song block to write into.
 * 4. **Hand the target voice the note** — the frames at `scratchAt`, the pointer
 *    moved there, the duration counter forced to 1. A `slide` rides in those
 *    frames; `$90+x` needs no clearing first, since `NoteVCMD` reloads it from
 *    `$0300+x` on every key-on (`main.asm:465-466`) and the note about to sound
 *    is a key-on. A voice under an `$EE` pitch envelope is the exception, and
 *    does not bend in the song either.
 * 5. **Give it its volume back** without the dirty bit, so the DSP keeps 0 until
 *    the new note keys on and recomputes it. See {@link restoreTrackVolume}.
 * 6. **Count the note's ticks off the driver's tempo**, the same `sawTick`
 *    machinery the worklet and the clock measurement use, then render the tail.
 */
export function auditionNote(core: SpcCore, spc: Uint8Array, request: NoteAuditionRequest): AuditionedNote {
	const { channel, note, scratchAt } = request;
	// At least one tick, whatever is asked for. The dump's PC is the driver's main
	// loop with the song index still in `$F6`, and it takes four passes of the main
	// loop to become a song: `ReadInputRegister` copies `$F6` into `$02` only after
	// `ProcessAPU2Input` has looked (main.asm:243-246, 288-299), `PlaySong` runs on
	// the pass after that and writes every voice's `$FF` volume (main.asm:2137-2138),
	// and the `$0c` countdown it sets takes two more before `L_0C22` installs the
	// track pointers and `L_0C31`/`L_0C4D` give every voice an instrument and read
	// its opening commands (main.asm:2093, 2282, 2302-2341). Nought ticks is the
	// state before all of that: no pointer to aim at the note, no volume to give
	// back, and the phrase walk still to come during the recording, where it reads
	// the frames written at `scratchAt` as its next phrase.
	const target = Math.max(1, Math.floor(request.atTicks));
	const held = Math.max(1, Math.floor(request.ticks));

	core.loadSpc(spc);

	// One backup across both, so a voice the mixer silenced arrives at the settle
	// loop with 0 already in its track volume: `applyChannelMutes` keeps the value
	// it saved earlier rather than saving that zero over it.
	const backup = createMuteBackup();
	const silenced = (request.silenced ?? 0) & ~(1 << channel);
	const reachedTicks = fastForward(core, target, channel, silenced, backup);

	// The target voice has read the tick's music, so it can be parked: 127 ticks
	// it cannot fetch inside is what stops the settle below carrying it past the
	// tick that was asked for.
	parkVoice(core.aram(), channel);

	// Silence the target, and let the driver say when it has: `L_0D1C` walks every
	// voice and then clears `$5C` (`main.asm:2502-2512`), so a zero there is the
	// driver's own word for "the mute has reached the DSP" where a block count can
	// only guess at it — and the clear is on a music tick, 37 ms apart at `t55`.
	// Two readings of it, because the walk can clear the flags out from under a
	// write that landed inside it, and never fewer blocks than four, which is what
	// the settle was before it was asked.
	//
	// The target alone, plus whatever the mixer is already holding. The other
	// voices are about to be heard, and every one of them keyed on the note it
	// plays at this tick during the walk the arrival waited for — muting them here
	// would take the front off that attack and then hand it back a tick later.
	let quiet = 0;
	const hushed = silenced | (1 << channel);
	for (let settle = 0; settle < MAX_SETTLE_BLOCKS && (settle < SETTLE_BLOCKS || quiet < 2); settle++) {
		applyChannelMutes(core.aram(), hushed, backup);
		core.renderView(BLOCK);
		quiet = volumesSettled(core.aram()) ? quiet + 1 : 0;
	}

	// The settle rendered, so the driver has moved on: arrive again before any
	// voice's pointer is written. The note's own fetch is long past, so what this
	// is waiting for is the pass boundary — which is also what makes the settle's
	// own length stop mattering, a block either way landing at the same place.
	arrive(core, channel, true);

	const aram = core.aram();
	parkOthers(aram, channel);

	// A channel the song never played has neither an instrument nor a `q`, and a
	// note wants both: the driver's own remedy for the first is `@0`
	// (`main.asm:2319-2321`), and the compiler's for the second is `q7f`. Without
	// them the note plays on whatever the DSP happens to hold, for one tick, at no
	// volume. Supplied only where they are missing, so a channel the song has
	// written to keeps every byte of what it wrote.
	//
	// The prefix does not disturb a `$DD` in the frames: the command loop
	// dispatches it on the fetch tick, several bytes before the duration byte, so
	// the pointer standing after the note byte is the same either way.
	const prefix = voiceHasInstrument(aram, channel) ? [] : [VCMD_INSTRUMENT, DEFAULT_INSTRUMENT];
	const frames = noteFrames(note, held, voiceHasQuantization(aram, channel) ? null : DEFAULT_Q, request.slide ?? null);
	aram.set(prefix, scratchAt);
	aram.set(frames, scratchAt + prefix.length);

	// `PlaySong` gives every channel `$FF` before a note of the song is read
	// (`main.asm:2137-2138`), so a channel the song never touches still has a
	// volume to be given back and a note auditioned on it is heard.
	startVoiceAt(aram, channel, scratchAt);
	restoreTrackVolume(aram, channel, backup);

	return { ...record(core, held, channel, silenced, backup), reachedTicks };
}

/**
 * Parks every voice but the target, so the song sounds under the note without
 * reading another byte of music data.
 *
 * That second half is what the note rests on. The frames are written over the
 * song's load address, which is where the `$40` phrase table sits, and a voice
 * that reads a `$00` walks it (`L_0C01`) — reinstalling all eight track pointers
 * from a table the audition has just written its own note over. A parked voice
 * never reaches a `$00`, so what the phrase table now holds never matters.
 *
 * Called again after every block, because a park is only 127 ticks and a whole
 * note at an ordinary tempo is longer than that.
 */
function parkOthers(aram: Uint8Array, channel: number): void {
	for (let voice = 0; voice < VOICES; voice++) {
		if (voice !== channel) {
			parkVoice(aram, voice);
		}
	}
}

/**
 * Emulates up to `target` ticks and throws the audio away, stopping on the
 * driver's own tick count rather than on a sample count, as `worklet.ts`'s seek
 * does. Returns how far it actually got, and ends by {@link arrive}, which is
 * what turns the tick it counted into a point a note can be handed over at.
 *
 * It latches on a stricter reading of "the song has started" than the worklet
 * does, and has to: a playhead a tick out is a playhead a tick out, where a note
 * handed to a driver a tick early is not played at all. See the latch below.
 *
 * `silenced` is pressed back onto the driver after every block, exactly as
 * `worklet.ts`'s `afterBlock` does it and for the same reason: the driver rewrites
 * `VxVOL` as it goes, so a mute that is not reapplied does not stick. It costs
 * the tick count nothing — `$5E` is untouched, so the driver's work per pass of
 * its main loop is unchanged and `ticks` comes out the same either way.
 *
 * The mask is constant for the whole run, which is what keeps `MuteBackup.restoring`
 * at zero: bits enter it only when they leave the mask, and none do here.
 */
function fastForward(core: SpcCore, target: number, channel: number, silenced: number, backup: MuteBackup): number {
	let ticks = 0;
	let voice = -1;
	const tick = createTickPhase();
	let rendered = 0;
	let stalledFor = 0;
	let fetched = false;
	const cap = MAX_SEEK_SECONDS * SPC_SAMPLE_RATE;

	while (ticks < target && rendered < cap && stalledFor < SEEK_STALL_BLOCKS) {
		// Read before the block and not after it. The fetch loop for the tick this
		// block is about to report may run entirely inside the block, so the mark
		// has to come from before it for the change to be visible at all.
		const mark = voiceFetchMark(core.aram(), channel);
		core.renderView(BLOCK);
		rendered += BLOCK;

		const aram = core.aram();
		// Before the latch below returns, so a song that has not keyed on yet is
		// still being muted while we wait for it.
		applyChannelMutes(aram, silenced, backup);

		if (voice < 0) {
			// The song has not keyed on yet; latch the voice once it has, and once it
			// has read a duration byte. `worklet.ts` latches on the pointer alone,
			// which is enough for a playhead that can be a tick out and not enough
			// here: counting from a voice merely pointed at music starts a pass early,
			// so the note is handed over inside the pass that starts the song, where
			// `L_0C01` has still to install the track pointers and reads the frames
			// at `scratchAt` as a phrase (`main.asm:2288-2309`). See
			// {@link voiceStarted}.
			const playing = tickVoice(aram);
			if (voiceStarted(aram, playing)) {
				voice = playing;
			}

			seedTickPhase(tick, aram);
			stalledFor++;
			continue;
		}

		const stepped = sawTick(tick, aram);
		ticks += stepped;
		stalledFor = stepped > 0 ? 0 : stalledFor + 1;
		fetched = voiceFetchMark(aram, channel) !== mark;
	}

	arrive(core, channel, fetched);
	return ticks;
}

/**
 * Waits for a point the note can be handed over at: the target voice's music for
 * the tick already read, and no voice iteration in flight.
 *
 * The tick count cannot be that point on its own. `sawTick` reports a tick off
 * `$44`, which the driver writes at the top of a pass — a `$49` update and a
 * `ProcessAPU2Input` call before that tick's music runs (`main.asm:193, 227,
 * 239`) — and reading a tick without waiting for it is exactly what a playhead
 * wants. A note handed over on that reading is handed to a driver that has not
 * read it yet, and the tick a note starts on is the tick its own commands are
 * dispatched on: the `@`, the `v` and the `y` written in front of it come out of
 * the same fetch as the note byte (`L_0C57`, `:2340-2379`).
 *
 * So two things go wrong, and which one depends on where the target voice sits in
 * a walk that runs 0 to 7 (`:2328-2459`) — identical music on two channels gets
 * two different answers. Before its fetch, the note sounds under the previous
 * note's instrument, volume and pan. Inside it, `L_0CB3` reloads `$70+x` from the
 * song's own duration byte a moment after {@link startVoiceAt} has written 1
 * there (`:2440-2441`), so the voice plays the song's note and falls into the
 * frames at `scratchAt` when that runs out — a second key-on partway through the
 * audition. The same reload is why the other seven have to be parked from here
 * too: `$70+x` written into a voice already inside its fetch is overwritten a
 * moment later, and a voice that is not parked reads on to the next note and to
 * the `$00` past it.
 *
 * Bounded at both steps, because a voice the song does not play never fetches and
 * a driver that has stopped never comes round to another pass.
 */
function arrive(core: SpcCore, channel: number, fetched: boolean): void {
	const mark = voiceFetchMark(core.aram(), channel);
	// A voice reading no music data has no fetch to wait for, and waiting for one
	// would spend the whole budget on a channel the song never uses.
	let moved = fetched || !voicePlaying(core.aram(), channel);

	for (let waited = 0; waited < ARRIVE_FRAMES && !moved; waited += ARRIVE_STEP) {
		core.renderView(ARRIVE_STEP);
		moved = voiceFetchMark(core.aram(), channel) !== mark;
	}

	// And then to the top of the driver's next pass, a frame at a time. Which
	// fetch the wait above ended on decides how far into a pass it left off, so a
	// hand-over made there would put the key-on a few DSP cycles apart for two
	// channels playing identical music — inaudible, and enough that one audition
	// could not be compared with another. `$44` steps once a pass and does it
	// before any voice loop, so it is the same point every time as well as a safe
	// one; see {@link passMark}.
	let pass = passMark(core.aram());
	for (let waited = 0; waited < ARRIVE_FRAMES; waited++) {
		core.renderView(1);
		const aram = core.aram();
		if (passMark(aram) !== pass && !inVoiceLoop(aram)) {
			return;
		}

		pass = passMark(aram);
	}
}

/**
 * Renders the note and its tail, counting ticks off the driver's own tempo.
 *
 * The note's length is ticks because it follows the music; the tail is seconds
 * because it does not. Both are bounded by {@link MAX_AUDITION_SECONDS}, so a
 * song at a crawl returns a short note rather than a long silence.
 *
 * A slide's `delay + duration` may outrun the note, and the tail is deliberately
 * not stretched to cover it: the note keys off at its own length and the rest of
 * the bend goes unheard, which is what the song does — the note after it is where
 * the slide was going.
 *
 * The other seven are held here rather than left to themselves: {@link parkOthers}
 * every block, so none of them reaches the next note or a `$00`, and the mixer's
 * mask pressed back on, since the driver rewrites `VxVOL` as it goes and a mute
 * that is not reapplied does not stick. The target is out of that mask's reach —
 * {@link restoreTrackVolume} took it out of the backup — so the note keeps the
 * volume it was given.
 */
function record(
	core: SpcCore,
	held: number,
	channel: number,
	silenced: number,
	backup: MuteBackup,
): { pcm: Int16Array; heldTicks: number } {
	const cap = MAX_AUDITION_SECONDS * SPC_SAMPLE_RATE;
	const pcm = new Int16Array(cap * SPC_CHANNELS);

	let ticks = 0;
	const tick = createTickPhase();
	seedTickPhase(tick, core.aram());
	let rendered = 0;
	let tail = -1;

	while (rendered < cap) {
		pcm.set(core.renderView(BLOCK), rendered * SPC_CHANNELS);
		rendered += BLOCK;

		const aram = core.aram();
		parkOthers(aram, channel);
		applyChannelMutes(aram, silenced, backup);

		if (tail < 0) {
			ticks += sawTick(tick, core.aram());
			if (ticks >= held) {
				tail = rendered;
			}
		} else if (rendered - tail >= AUDITION_TAIL_SECONDS * SPC_SAMPLE_RATE) {
			break;
		}
	}

	return { pcm: fadeOut(pcm.subarray(0, rendered * SPC_CHANNELS)), heldTicks: ticks };
}

/** Ramps the last {@link FADE_SECONDS} to zero, and takes a copy while it is there. */
function fadeOut(pcm: Int16Array): Int16Array {
	const faded = pcm.slice();
	const frames = faded.length / SPC_CHANNELS;
	const over = Math.min(frames, Math.round(FADE_SECONDS * SPC_SAMPLE_RATE));

	for (let step = 0; step < over; step++) {
		const gain = (over - step - 1) / over;
		const at = (frames - over + step) * SPC_CHANNELS;
		for (let channel = 0; channel < SPC_CHANNELS; channel++) {
			faded[at + channel] = Math.round(faded[at + channel] * gain);
		}
	}

	return faded;
}
