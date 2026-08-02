/**
 * Reading what the N-SPC driver is doing, out of the emulator's APU RAM — and,
 * in one place, telling it what to do.
 *
 * Everything else in this app predicts playback: the compiler works out how long
 * a song should take, and the transport follows that prediction. This module
 * observes it instead. The driver keeps its whole working state in the zero
 * page, and `readme/readme_files/aram_map.html` documents every byte of it, so
 * the current tempo, the position of each voice in its music data and the tick
 * accumulator can simply be read.
 *
 * {@link applyChannelMutes} is the exception, and it lives here because it is
 * the same knowledge pointed the other way: APU RAM is a live window into the
 * emulator's heap, so the driver's own mute register can be written as easily as
 * its tempo can be read.
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
	/** `$5C`: voice bits whose `VxVOL` the driver must rewrite this tick. */
	VolumeDirty = 0x5c,
	/**
	 * `$5E`: the driver's own mute mask, one bit per voice.
	 *
	 * `main.asm:71` — "Used to mute a channel (via Yoshi Drums, etc.). One bit
	 * per channel, setting it stops a channel from playing."
	 */
	MuteMask = 0x5e,
	/** `$70-$7F`: music note duration, one byte per voice. */
	NoteDurations = 0x70,
	/** `$0241+2n`: per-voice track volume, as `v` and `$E8` leave it. */
	TrackVolumes = 0x0241,
}

/** N-SPC songs have eight music channels. */
export const VOICES = 8;

/** Every voice, as a bitmask. */
const ALL_VOICES = 0xff;

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
 * What {@link applyChannelMutes} has to remember between calls.
 *
 * Muting takes a channel's volume away from it, so the value has to be kept
 * somewhere until the channel is given it back.
 */
export interface MuteShadow {
	/** The mask last written, so `$5E` bits the song set itself survive. */
	applied: number;
	/** The track volume taken off each voice, waiting to be put back. */
	saved: Uint8Array;
	/** Voices whose volume has not been restored yet. */
	restoring: number;
}

export function createMuteShadow(): MuteShadow {
	return { applied: 0, saved: new Uint8Array(VOICES), restoring: 0 };
}

/** Forgets everything, for when the emulator is reloaded from the SPC image. */
export function resetMuteShadow(shadow: MuteShadow): void {
	shadow.applied = 0;
	shadow.restoring = 0;
	shadow.saved.fill(0);
}

/**
 * Silences the voices in `mask`, by writing the driver's own mute register.
 *
 * The alternative — building the SPC with those channels' pointers blanked —
 * silences them by making the driver skip them entirely, which is not the same
 * thing at all. A channel that is never parsed takes the whole song with it:
 * `$FA $04` (echo buffer size), `$FA $06` (playback mode), `t`, `w` and the echo
 * and FIR commands are all song-global but live in whichever channel the user
 * happened to type them in, and the intro ends when the *first* channel runs out
 * of data (`main.asm:2340-2346`), so dropping one moves the loop point. Muting
 * here leaves every channel parsing and only takes away its sound.
 *
 * Two registers, because `$5E` alone is not immediate:
 *
 * - `$5E` gates note dispatch (`main.asm:2389-2414`). With the bit set the
 *   driver skips `NoteVCMD` but still runs duration bookkeeping, every `$DA-$FF`
 *   command, loops, subroutines, remote code and the end-of-note key-off. It
 *   stops the *next* note, and does nothing to one already ringing.
 * - `$0241+2n` is the track volume the driver multiplies in on every tick
 *   (`main.asm:2813-2815`). Zeroing it and flagging the voice in `$5C` makes the
 *   driver write `VxVOL = 0` itself on its next tick (`main.asm:2816-2821`),
 *   which cuts the ringing note within a few milliseconds.
 *
 * Call once per emulated block. Re-applying is not just cheap insurance: `$5E`
 * is rebuilt from `$6E` whenever a song uses Yoshi drums (`main.asm:1813-1816`)
 * and zeroed when a song starts (`main.asm:2185`), and `$5C` is consumed and
 * cleared once per music tick (`main.asm:2501-2513`), so a single write can be
 * swallowed by the loop that was already running.
 */
export function applyChannelMutes(aram: Uint8Array, mask: number, shadow: MuteShadow): void {
	const wanted = mask & ALL_VOICES;
	if (wanted === 0 && shadow.applied === 0 && shadow.restoring === 0) return;

	// Voices let go of since the last call owe their volume back; ones muted
	// again before that happened can keep waiting.
	shadow.restoring = (shadow.restoring | (shadow.applied & ~wanted)) & ~wanted;

	// Composed rather than assigned, so a song muting its own channels with
	// `$FA $05` keeps those bits.
	aram[Addr.MuteMask] = (aram[Addr.MuteMask] & ~shadow.applied) | wanted;
	shadow.applied = wanted;

	let dirty = 0;
	for (let voice = 0; voice < VOICES; voice++) {
		const bit = 1 << voice;
		const at = Addr.TrackVolumes + voice * 2;

		if (wanted & bit) {
			// Non-zero means the song has written a volume since we last looked —
			// a `v` command, or a step of a volume fade. Keep the newest one.
			const volume = aram[at];
			if (volume !== 0) {
				shadow.saved[voice] = volume;
				aram[at] = 0;
				dirty |= bit;
			}
			continue;
		}

		if (!(shadow.restoring & bit)) continue;

		// Done once the value is back and the driver has consumed the flag. It
		// can be cleared out from under a write that lands mid-loop, in which
		// case the voice simply returns at its next note rather than mid-note.
		if (aram[at] === shadow.saved[voice] && (aram[Addr.VolumeDirty] & bit) === 0) {
			shadow.restoring &= ~bit;
			continue;
		}
		aram[at] = shadow.saved[voice];
		dirty |= bit;
	}

	// OR rather than assign, matching the driver's own `or ($5c),($48)`, so
	// voices that do not need a rewrite are not given one.
	aram[Addr.VolumeDirty] |= dirty;
}
