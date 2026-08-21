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

import { SPC_CHANNELS, SPC_SAMPLE_RATE, type SpcCore } from "./wasm-host";
import {
	TICK_POLL_HZ,
	VOICES,
	applyChannelMutes,
	createMuteBackup,
	type MuteBackup,
	haltVoice,
	readNoteDuration,
	restoreTrackVolume,
	sawTick,
	startVoiceAt,
	tickVoice,
	voiceHasInstrument,
	voiceHasQuantization,
	voiceStarted,
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

/** Blocks of silence before the note, long enough for the driver to write every `VxVOL`. */
const SETTLE_BLOCKS = 4;

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
	 * halted before this is written, and the `$40` phrase table is only read when
	 * a voice reaches `$00` (`L_0C01`), so from that moment nothing reads the song
	 * block. Free space no ARAM budget can take away.
	 */
	scratchAt: number;
	/**
	 * Voices the mixer is silencing, as a bitmask. `0` for no mixer at all.
	 *
	 * Held through the fast-forward the way `worklet.ts` holds it, so the note
	 * arrives over the echo the transport is making rather than over the whole
	 * song's. Every other voice is halted before the note is handed over, so the
	 * echo buffer is the *only* route a silenced channel has into the recording —
	 * on a song with no echo this changes nothing at all, byte for byte.
	 *
	 * The target's own bit is ignored. Honouring it would take that voice's volume
	 * during the fast-forward and step 4 below would hand it straight back, so the
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
 * Rests follow, so the note keys off at the end of its length and its release is
 * heard, and there are enough of them to outlast {@link AUDITION_TAIL_SECONDS} at
 * a rate no driver can exceed. `$00` closes the block as a backstop; reaching it
 * would send the driver to the phrase table, which by then is underneath these
 * very bytes.
 */
export function noteFrames(note: number, ticks: number, quantization: number | null = null): Uint8Array {
	const bytes: number[] = [];
	let left = Math.max(1, Math.floor(ticks));

	/** `emitPendingQuantization` puts it straight after the duration byte. */
	const q = quantization === null ? [] : [quantization];

	if (left >= LONG_NOTE) {
		bytes.push(LONG_CHUNK, ...q, note);
		left -= LONG_CHUNK;

		while (left > LONG_CHUNK) {
			bytes.push(NOTE_TIE);
			left -= LONG_CHUNK;
		}

		if (left > 0) {
			// The duration byte carries over, so an exact chunk needs no new one.
			if (left !== LONG_CHUNK) {
				bytes.push(left);
			}

			bytes.push(NOTE_TIE);
		}
	} else {
		bytes.push(left, ...q, note);
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
 * The recipe, all of it against `main.asm`:
 *
 * 0. **Fast-forward under the mixer's mask**, so the echo the note is about to
 *    land on is the echo the transport is making. See `silenced`.
 * 1. **Silence every voice** through {@link applyChannelMutes} and render a few
 *    blocks, so whatever was ringing stops without a click and `MuteBackup` is
 *    holding the target voice's own volume.
 * 2. **Halt the other seven** with {@link haltVoice}. Nothing else parses music
 *    data from here, which is what makes the note repeatable and what frees the
 *    song block to write into. Tempo and the global fades (`L_0CD2`) run on
 *    regardless of voices.
 * 3. **Hand the target voice the note** — the frames at `scratchAt`, the pointer
 *    moved there, the duration counter forced to 1.
 * 4. **Give it its volume back** without the dirty bit, so the DSP keeps 0 until
 *    the new note keys on and recomputes it. See {@link restoreTrackVolume}.
 * 5. **Count the note's ticks off that voice**, the same `sawTick` machinery the
 *    worklet and the clock measurement use, then render the tail.
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
	const reachedTicks = fastForward(core, target, (request.silenced ?? 0) & ~(1 << channel), backup);

	for (let settle = 0; settle < SETTLE_BLOCKS; settle++) {
		applyChannelMutes(core.aram(), 0xff, backup);
		core.renderView(BLOCK);
	}

	const aram = core.aram();

	// Not called again: it would take the volume restored below straight back off
	// the target voice. A halted voice needs no upkeep — `L_0D1C` skips it.
	for (let voice = 0; voice < VOICES; voice++) {
		if (voice !== channel) {
			haltVoice(aram, voice);
		}
	}

	// A channel the song never played has neither an instrument nor a `q`, and a
	// note wants both: the driver's own remedy for the first is `@0`
	// (`main.asm:2319-2321`), and the compiler's for the second is `q7f`. Without
	// them the note plays on whatever the DSP happens to hold, for one tick, at no
	// volume. Supplied only where they are missing, so a channel the song has
	// written to keeps every byte of what it wrote.
	const prefix = voiceHasInstrument(aram, channel) ? [] : [VCMD_INSTRUMENT, DEFAULT_INSTRUMENT];
	const frames = noteFrames(note, held, voiceHasQuantization(aram, channel) ? null : DEFAULT_Q);
	aram.set(prefix, scratchAt);
	aram.set(frames, scratchAt + prefix.length);

	// `PlaySong` gives every channel `$FF` before a note of the song is read
	// (`main.asm:2137-2138`), so a channel the song never touches still has a
	// volume to be given back and a note auditioned on it is heard.
	startVoiceAt(aram, channel, scratchAt);
	restoreTrackVolume(aram, channel, backup.saved[channel]);

	return { ...record(core, channel, held), reachedTicks };
}

/**
 * Emulates up to `target` ticks and throws the audio away, stopping on the
 * driver's own tick count rather than on a sample count, as `worklet.ts`'s seek
 * does. Returns how far it actually got.
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
function fastForward(core: SpcCore, target: number, silenced: number, backup: MuteBackup): number {
	let ticks = 0;
	let voice = -1;
	let duration = 0;
	let rendered = 0;
	let stalledFor = 0;
	const cap = MAX_SEEK_SECONDS * SPC_SAMPLE_RATE;

	while (ticks < target && rendered < cap && stalledFor < SEEK_STALL_BLOCKS) {
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
			// here: the tick counted off a voice latched mid-fetch is the fetch, so
			// the note is handed over inside the pass that starts the song, where
			// `L_0C01` has still to install the track pointers and reads the frames
			// at `scratchAt` as a phrase (`main.asm:2288-2309`). See
			// {@link voiceStarted}.
			const playing = tickVoice(aram);
			if (voiceStarted(aram, playing)) {
				voice = playing;
				duration = readNoteDuration(aram, voice);
			}

			stalledFor++;
			continue;
		}

		const now = readNoteDuration(aram, voice);
		const stepped = sawTick(duration, now);
		duration = now;
		ticks += stepped;
		stalledFor = stepped > 0 ? 0 : stalledFor + 1;
	}

	return ticks;
}

/**
 * Renders the note and its tail, counting ticks off the one voice still playing.
 *
 * The note's length is ticks because it follows the music; the tail is seconds
 * because it does not. Both are bounded by {@link MAX_AUDITION_SECONDS}, so a
 * song at a crawl returns a short note rather than a long silence.
 */
function record(core: SpcCore, channel: number, held: number): { pcm: Int16Array; heldTicks: number } {
	const cap = MAX_AUDITION_SECONDS * SPC_SAMPLE_RATE;
	const pcm = new Int16Array(cap * SPC_CHANNELS);

	let ticks = 0;
	let duration = readNoteDuration(core.aram(), channel);
	let rendered = 0;
	let tail = -1;

	while (rendered < cap) {
		pcm.set(core.renderView(BLOCK), rendered * SPC_CHANNELS);
		rendered += BLOCK;

		if (tail < 0) {
			const now = readNoteDuration(core.aram(), channel);
			ticks += sawTick(duration, now);
			duration = now;
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
