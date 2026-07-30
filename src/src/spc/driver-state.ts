/**
 * Reading what the N-SPC driver is doing, out of the emulator's APU RAM.
 *
 * Everything else in this app predicts playback: the compiler works out how long
 * a song should take, and the transport follows that prediction. This module
 * observes it instead. The driver keeps its whole working state in the zero
 * page, and `readme/readme_files/aram_map.html` documents every byte of it, so
 * the current tempo, the position of each voice in its music data and the tick
 * accumulator can simply be read.
 *
 * That matters because prediction is not exact and cannot be made exact. The
 * driver's main loop (`AddmusicKsrc/main.asm`, `MainLoop`) processes at most one
 * music tick per iteration, so a song that gives it enough work to do drops
 * ticks — measurably, around 0.8% on eight busy channels. No formula over tempo
 * can account for that, and a progress bar built on one drifts away from the
 * music it is supposed to be following.
 *
 * Intended to be useful beyond the transport: a piano roll or a tracker view
 * needs exactly this — where each voice is, right now, and at what tempo.
 */

/** Zero-page addresses, from the ARAM map. */
const enum Addr {
	/** `$30-$3F`: music track pointer, one 16-bit pointer per voice. */
	TrackPointers = 0x30,
	/** `$40-$41`: the phrase the song is playing, into the pointer table. */
	PhrasePointer = 0x40,
	/** `$49`: fractional counter for the music tempo ticker. */
	TempoCounter = 0x49,
	/** `$51`: music tempo, as the `t` command and any fade leave it. */
	Tempo = 0x51,
	/** `$70-$7F`: music note duration, one byte per voice. */
	NoteDurations = 0x70,
}

/** N-SPC songs have eight music channels. */
export const VOICES = 8;

/** Where the driver has got to, as of the last emulated sample. */
export interface DriverState {
	/**
	 * Byte address in APU RAM that each voice is reading its music data from.
	 * `0` for a voice the song does not use.
	 */
	trackPointers: number[];
	/** Address of the phrase entry being played, into the song's pointer table. */
	phrasePointer: number;
	/**
	 * `$51` as the driver holds it, which is the `t` value **plus one** — `t40`
	 * reads 40 here as 41, and `t192` as 193, right up to `t254` reading 255.
	 *
	 * Reported raw rather than adjusted, because it is this number the tempo
	 * ticker multiplies by, so it is this number that decides how fast the song
	 * actually plays. It also moves on its own during a `t` fade.
	 */
	tempo: number;
	/** How far the tick accumulator has got, `0-255`. See {@link countTicks}. */
	tempoCounter: number;
}

const word = (aram: Uint8Array, at: number): number => aram[at] | (aram[at + 1] << 8);

export function readDriverState(aram: Uint8Array): DriverState {
	return {
		trackPointers: Array.from({ length: VOICES }, (_, voice) => word(aram, Addr.TrackPointers + voice * 2)),
		phrasePointer: word(aram, Addr.PhrasePointer),
		tempo: aram[Addr.Tempo],
		tempoCounter: aram[Addr.TempoCounter],
	};
}

/**
 * The voice to count ticks off: the lowest one the song actually plays.
 *
 * `-1` when nothing is playing. One voice rather than all of them because the
 * driver walks the voices in turn within a single tick, so a poll can land
 * mid-walk and see the same tick twice — a single byte cannot be caught halfway.
 */
export function tickVoice(aram: Uint8Array): number {
	for (let voice = 0; voice < VOICES; voice++) {
		if (word(aram, Addr.TrackPointers + voice * 2) !== 0) return voice;
	}
	return -1;
}

/** That voice's note duration counter, which is what a music tick moves. */
export function readNoteDuration(aram: Uint8Array, voice: number): number {
	return voice < 0 ? 0 : aram[Addr.NoteDurations + voice * 2];
}

/**
 * Whether a music tick happened between two readings of {@link readNoteDuration}.
 *
 * The driver's per-voice loop opens with `dec $70+x` for every voice the song
 * uses (`main.asm`, `L_0C4D`), so one tick moves the counter by one. When it
 * reaches zero the next note is fetched and `$70` reloaded in the same tick.
 *
 * That reload is why a bare "did it change" is not enough. A note-ending tick
 * runs `1 -> 0 -> reload`, and a poll landing in the middle of it sees two
 * changes for one tick. Counting a rise only when the counter had not already
 * been seen at zero closes that: either the drop to zero is observed and the
 * rise after it is not counted, or neither is and the rise stands in for both.
 *
 * `$49` looks like the more direct signal and is not: the driver reaches its
 * tick handler either by that accumulator carrying **or** by `cmp y,#$00` being
 * non-zero, and only the carry leaves a trace. On a song busy enough to make the
 * driver fall behind, the second path carries a quarter of the ticks and
 * counting carries loses every one of them. `$70` is downstream of both.
 *
 * The requirement is sampling faster than the driver iterates — ~500 Hz, the
 * timer 0 rate from `mov $fa,#$10`. Slower, and two ticks fall between readings
 * and count as one. {@link TICK_POLL_HZ} is the rate that keeps that safe.
 */
export function sawTick(previous: number, current: number): number {
	if (current < previous) return 1;
	return current > previous && previous !== 0 ? 1 : 0;
}

/**
 * How often {@link sawTick} has to be fed, in Hz.
 *
 * Twice the driver's ~500 Hz main loop, so no tick can hide between readings.
 */
export const TICK_POLL_HZ = 1000;

/**
 * Where the song's main loop begins, per voice, in APU RAM.
 *
 * The song header opens with its phrase list: word 0 points at the pointer table
 * the song starts from, and a song with an intro carries a second table 16 bytes
 * later that the loop returns to instead (`link.ts` `buildHeader`, which writes
 * the loop target as `aramAddress + 2` exactly when there is an intro). Each
 * table is eight 16-bit voice pointers, `0` for a voice the song does not use.
 */
export function readLoopStarts(aram: Uint8Array, songAddress: number): number[] {
	const first = word(aram, songAddress);
	const hasIntro = word(aram, songAddress + 2) === first + 16;
	const table = hasIntro ? word(aram, songAddress + 2) : first;
	return Array.from({ length: VOICES }, (_, voice) => word(aram, table + voice * 2));
}
