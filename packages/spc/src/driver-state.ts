/** Our SPC driver's I/O through the emulator's ARAM. */

/** Zero-page addresses, from the ARAM map. */
const enum Addr {
	/** `$30-$3F`: music track pointer, one 16-bit pointer per voice. */
	TrackPointers = 0x30,
	/** `$40-$41`: the phrase the song is playing, into the pointer table. */
	PhrasePointer = 0x40,
	/** `$51`: music tempo, as the `t` command and any fade leave it. */
	Tempo = 0x51,
	/** `$5C`: voice bits whose `VxVOL` the driver must rewrite this tick. */
	VolumeDirty = 0x5c,
	/** `$5E`: the driver's own mute mask, one bit per voice. */
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
	/** `$51` as the driver holds it, which is the `t` value **plus one**. */
	tempo: number;
}

const word = (aram: Uint8Array, at: number): number => aram[at] | (aram[at + 1] << 8);

export function readDriverState(aram: Uint8Array): DriverState {
	return {
		trackPointers: Array.from({ length: VOICES }, (_, voice) => word(aram, Addr.TrackPointers + voice * 2)),
		phrasePointer: word(aram, Addr.PhrasePointer),
		tempo: aram[Addr.Tempo],
	};
}

/** The voice to count ticks off: the lowest one the song actually plays. */
export function tickVoice(aram: Uint8Array): number {
	for (let voice = 0; voice < VOICES; voice++) {
		if (word(aram, Addr.TrackPointers + voice * 2) !== 0) {
			return voice;
		}
	}

	return -1;
}

/** That voice's note duration counter, which is what a music tick moves. */
export function readNoteDuration(aram: Uint8Array, voice: number): number {
	return voice < 0 ? 0 : aram[Addr.NoteDurations + voice * 2];
}

/** Whether a music tick happened between two readings of {@link readNoteDuration}. */
export function sawTick(previous: number, current: number): number {
	if (current < previous) {
		return 1;
	}

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
export interface MuteBackup {
	/** The mask last written, so `$5E` bits the song set itself survive. */
	applied: number;
	/** The track volume taken off each voice, waiting to be put back. */
	saved: Uint8Array;
	/** Voices whose volume has not been restored yet. */
	restoring: number;
}

export function createMuteBackup(): MuteBackup {
	return { applied: 0, saved: new Uint8Array(VOICES), restoring: 0 };
}

/** Forgets everything, for when the emulator is reloaded from the SPC image. */
export function resetMuteBackup(backup: MuteBackup): void {
	backup.applied = 0;
	backup.restoring = 0;
	backup.saved.fill(0);
}

/**
 * Silences the voices in `mask`, by writing the driver's own registers.
 *
 * Muted through two registers:
 * $5E: Channel disable, but continues playing the current note or command
 * $0241+2n: Channel volume
 */
export function applyChannelMutes(aram: Uint8Array, mask: number, backup: MuteBackup): void {
	const wanted = mask & ALL_VOICES;
	if (wanted === 0 && backup.applied === 0 && backup.restoring === 0) {
		return;
	}

	// Voices let go of since the last call owe their volume back; ones muted
	// again before that happened can keep waiting.
	backup.restoring = (backup.restoring | (backup.applied & ~wanted)) & ~wanted;

	// Composed rather than assigned, so a song muting its own channels with
	// `$F4 $06` keeps those bits.
	aram[Addr.MuteMask] = (aram[Addr.MuteMask] & ~backup.applied) | wanted;
	backup.applied = wanted;

	let dirty = 0;
	for (let voice = 0; voice < VOICES; voice++) {
		const bit = 1 << voice;
		const at = Addr.TrackVolumes + voice * 2;

		if (wanted & bit) {
			// Non-zero means the song has written a volume since we last looked —
			// a `v` command, or a step of a volume fade. Keep the newest one.
			const volume = aram[at];
			if (volume !== 0) {
				backup.saved[voice] = volume;
				aram[at] = 0;
				dirty |= bit;
			}

			continue;
		}

		if (!(backup.restoring & bit)) {
			continue;
		}

		// Done once the value is back and the driver has consumed the flag. It
		// can be cleared out from under a write that lands mid-loop, in which
		// case the voice simply returns at its next note rather than mid-note.
		if (aram[at] === backup.saved[voice] && (aram[Addr.VolumeDirty] & bit) === 0) {
			backup.restoring &= ~bit;
			continue;
		}

		aram[at] = backup.saved[voice];
		dirty |= bit;
	}

	// OR rather than assign, matching the driver's own `or ($5c),($48)`, so
	// voices that do not need a rewrite are not given one.
	aram[Addr.VolumeDirty] |= dirty;
}
