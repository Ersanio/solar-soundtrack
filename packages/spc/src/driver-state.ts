/** Our SPC driver's I/O through the emulator's ARAM. */

/** Zero-page addresses, from the ARAM map. */
const enum Addr {
	/** `$30-$3F`: music track pointer, one 16-bit pointer per voice. */
	TrackPointers = 0x30,
	/** `$44`: the sound effect tempo accumulator, stepped by the timer count. */
	SfxPhase = 0x44,
	/** `$49`: the music tempo accumulator, whose overflow is a music tick. */
	TickPhase = 0x49,
	/** `$51`: music tempo, as the `t` command and any fade leave it. */
	Tempo = 0x51,
	/** `$5C`: voice bits whose `VxVOL` the driver must rewrite this tick. */
	VolumeDirty = 0x5c,
	// `$5E` is the driver's own mute mask, and nothing here writes it — see
	// {@link applyChannelMutes} for why disabling a channel is the wrong tool.
	/** `$70-$7F`: music note duration, one byte per voice. */
	NoteDurations = 0x70,
	/** `$C1+2n`: the instrument the voice is playing, 0 for one never given any. */
	Instruments = 0xc1,
	/** `$0200+2n`: the duration byte a voice last read, ahead of its note. */
	NoteDurationBytes = 0x0200,
	/** `$0201+2n`: the gate `q`'s high nybble chose, as a fraction of the duration. */
	NoteGates = 0x0201,
	/** `$0211+2n`: the velocity `q`'s low nybble chose, which scales `VxVOL`. */
	NoteVelocities = 0x0211,
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
	/** `$51` as the driver holds it, which is the `t` value **plus one**. */
	tempo: number;
}

const word = (aram: Uint8Array, at: number): number => aram[at] | (aram[at + 1] << 8);

export function readDriverState(aram: Uint8Array): DriverState {
	return {
		trackPointers: Array.from({ length: VOICES }, (_, voice) => word(aram, Addr.TrackPointers + voice * 2)),
		tempo: aram[Addr.Tempo],
	};
}

/**
 * The voice to count ticks off: the lowest one the driver is playing.
 *
 * Decided the way the driver decides it — `L_0C31` and `L_0C4D`
 * (`main.asm:2315, 2331`) test the pointer's high byte alone, `mov a, $31+x` /
 * `beq`. The whole word would not do: at song start the driver points `$30`
 * into the zero page for its hot-patch reset (`main.asm:2104-2105`), a word
 * with a low byte and no high byte, and a poll landing there would count off
 * voice 0 for the rest of a song that never plays it — every tick lost, and the
 * playhead never moving, in a song whose lowest channel is `#1`.
 */
export function tickVoice(aram: Uint8Array): number {
	for (let voice = 0; voice < VOICES; voice++) {
		if (voicePlaying(aram, voice)) {
			return voice;
		}
	}

	return -1;
}

/**
 * Whether a voice has read a duration byte, which is the driver's own mark that
 * it is reading music rather than merely being pointed at some.
 *
 * The duration *counter* cannot answer this. `L_0C31` sets it to 1 for every
 * voice a phrase names, before any of them fetch (`main.asm:2314-2318`), and
 * `SetInstrument` runs between that and the `dec` at `L_0C4D`
 * (`main.asm:2319-2321, 2337`) — so a 1 there means "about to read music" as
 * readily as it means "reading it". `$0200+2n` is written from the byte before
 * the note (`main.asm:2363`), nothing writes it back, and the program's setup
 * zeroes the page (`main.asm:157-160`).
 */
export function voiceStarted(aram: Uint8Array, voice: number): boolean {
	return voice >= 0 && aram[Addr.NoteDurationBytes + voice * 2] !== 0;
}

/** What `$44` is stepped by per pass of the main loop, per timer count. */
const SFX_STEP = 0x38;

/**
 * The timer count behind a step of `$44`.
 *
 * `$FD` is a four-bit counter cleared on read and the main loop spins while it
 * is 0 (`main.asm:185-186`), so a pass carries a count of 1 to 15. `#$38` times
 * each of those is distinct modulo 256 and none of them is 0, so a step of `$44`
 * names the count that made it and no step at all means the loop has not been
 * round.
 */
const TIMER_COUNTS = new Uint8Array(256);
for (let count = 1; count <= 15; count++) {
	TIMER_COUNTS[(count * SFX_STEP) & 0xff] = count;
}

/**
 * What {@link sawTick} carries between readings of APU RAM.
 *
 * The driver's music tick is the overflow of an accumulator, so counting one
 * takes the accumulator's own state and not just a pair of samples of it.
 */
export interface TickPhase {
	/** `$44` as of the last reading, which is what names the timer count. */
	sfx: number;
	/** `$49`, carried forward by the same add the driver makes. */
	phase: number;
	/** `$51` as of the last reading: the tempo a pass since then is priced at. */
	tempo: number;
}

export function createTickPhase(): TickPhase {
	return { sfx: 0, phase: 0, tempo: 0 };
}

/** Starts counting from wherever the driver has got to. */
export function seedTickPhase(tick: TickPhase, aram: Uint8Array): void {
	tick.sfx = aram[Addr.SfxPhase];
	tick.phase = aram[Addr.TickPhase];
	tick.tempo = aram[Addr.Tempo];
}

/**
 * Whether a music tick happened since the last reading.
 *
 * The driver's own gate, `main.asm:220-238`: a pass of the main loop multiplies
 * the tempo by the timer count, adds it to `$49`, and plays a tick of music if
 * that carried (`bcs`) or if the product had a high byte at all (`cmp y, #$00`).
 * Those two are one statement — the tick is `$49 + tempo × count > $FF` — and
 * the second is the branch a song too busy to keep up leaves through, so a
 * detector without it drops the ticks of exactly the songs that drop ticks.
 *
 * Driven off `$44` rather than `$49`, though `$49` is the accumulator that
 * matters. The driver writes `$44` at the top of the pass and `$49` most of a
 * pass later (`main.asm:192, 226`), so a reading can land between the two, where
 * `$44` alone still says a pass has begun and names the count it began with. The
 * accumulator is then carried rather than re-read, which is also what keeps the
 * tempo the one standing *before* the pass, as `mov a, $51` reads it and not as
 * a `t` processed later in the same pass leaves it.
 *
 * Nothing here reads the note duration counter, and that is the point: `$70+2n`
 * is reloaded from the duration byte the moment it hits zero
 * (`main.asm:2337, 2440-2441`), so a note one tick long is loaded with the 1 the
 * counter already held and the tick that fetched it moves nothing at all.
 */
export function sawTick(tick: TickPhase, aram: Uint8Array): number {
	const sfx = aram[Addr.SfxPhase];
	const advance = tick.tempo * TIMER_COUNTS[(sfx - tick.sfx) & 0xff];
	const stepped = tick.phase + advance > 0xff ? 1 : 0;

	tick.phase = (tick.phase + advance) & 0xff;
	tick.sfx = sfx;
	tick.tempo = aram[Addr.Tempo];
	return stepped;
}

/**
 * How often {@link sawTick} has to be fed, in Hz.
 *
 * Twice the driver's main loop, which timer 0 holds to 2 ms (`main.asm:176`), so
 * no reading can span two passes — their steps of `$44` would add up to a count
 * that never happened, and {@link TIMER_COUNTS} would name it or name nothing.
 */
export const TICK_POLL_HZ = 1000;

/**
 * Whether the driver is playing a voice, judged the way it judges it: the track
 * pointer's high byte alone (`main.asm:2315, 2331`, `mov a, $31+x` / `beq`). The
 * same test {@link tickVoice} walks, and the same one {@link haltVoice} turns off.
 */
export function voicePlaying(aram: Uint8Array, voice: number): boolean {
	return aram[Addr.TrackPointers + voice * 2 + 1] !== 0;
}

/**
 * Takes a voice out of the driver's rotation, the way a channel that has run out
 * of music data leaves it.
 *
 * The high byte alone, because that is the whole of the test above. A halted
 * voice is skipped by the fetch loop (`main.asm:2331`) and by the per-voice
 * volume and fade routine (`L_0D1C`, `main.asm:2504`), so it neither reads music
 * data nor has its `VxVOL` rewritten — which means anything already ringing on it
 * goes on ringing at whatever volume it had. Silence it first.
 */
export function haltVoice(aram: Uint8Array, voice: number): void {
	aram[Addr.TrackPointers + voice * 2 + 1] = 0;
}

/**
 * Points a voice at music data and makes it fetch on the driver's next pass.
 *
 * Setting the duration counter to 1 is the driver's own way of forcing a fetch:
 * it is what `L_0C31` (`main.asm:2314-2318`) does to every voice as a song
 * starts, and `L_0C4D` decrements to zero and reads the next byte
 * (`main.asm:2337`).
 */
export function startVoiceAt(aram: Uint8Array, voice: number, address: number): void {
	aram[Addr.TrackPointers + voice * 2] = address & 0xff;
	aram[Addr.TrackPointers + voice * 2 + 1] = (address >> 8) & 0xff;
	aram[Addr.NoteDurations + voice * 2] = 1;
}

/**
 * Whether a voice has ever been given an instrument.
 *
 * Zero means none, which is the driver's own reading — at song start it tests
 * `$c1+x` and calls `SetInstrument` with 0 for any voice that has not got one
 * (`main.asm:2319-2321`).
 */
export function voiceHasInstrument(aram: Uint8Array, voice: number): boolean {
	return aram[Addr.Instruments + voice * 2] !== 0;
}

/**
 * Whether a voice has been given a `q` — the gate its notes are shortened to and
 * the velocity its volume is scaled by.
 *
 * Both are read out of one byte after a duration (`main.asm:2382-2397`) and both
 * are zero on a channel the song has not written to. A zero gate keys the note
 * off after a single tick (`main.asm:2444-2449` floors the counter at 1) and a
 * zero velocity scales `VxVOL` to nothing, so a note played on such a voice is
 * inaudible. The compiler never leaves one that way: it emits `q` with the first
 * note of every channel (`parser.ts:2863`).
 */
export function voiceHasQuantization(aram: Uint8Array, voice: number): boolean {
	return aram[Addr.NoteGates + voice * 2] !== 0 && aram[Addr.NoteVelocities + voice * 2] !== 0;
}

/**
 * Gives a voice its track volume back without asking for a `VxVOL` rewrite.
 *
 * The opposite half of {@link applyChannelMutes}, which sets the dirty bit
 * precisely so a note already ringing is cut. Leaving the bit alone means the
 * DSP keeps whatever it has until the voice's next note keys on and recomputes
 * it — `NoteVCMD` sets the flag itself (`main.asm:459`). So the volume is in
 * place for the note about to start and inaudible for the one about to end.
 */
export function restoreTrackVolume(aram: Uint8Array, voice: number, volume: number): void {
	aram[Addr.TrackVolumes + voice * 2] = volume;
}

/**
 * What {@link applyChannelMutes} has to remember between calls.
 *
 * Muting takes a channel's volume away from it, so the value has to be kept
 * somewhere until the channel is given it back.
 */
export interface MuteBackup {
	/** The mask last applied, so a voice let go of can be told from one still held. */
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
 * Silences the voices in `mask`, by taking their volume away.
 *
 * **By volume alone, and `$5E` is deliberately left alone.** The driver's own
 * mute register disables a channel, which makes the driver's main loop cheaper —
 * and the loop handles at most one music tick per pass, so on a song already at
 * that ceiling the song *speeds up* when a channel is muted. Measured on a
 * `t254` song: 233 ticks a second unmuted, 273 with seven voices muted, 301 with
 * all eight. Muting is a monitoring aid, and one that plays the song 29% fast is
 * telling the porter something untrue about their own music.
 *
 * Taking the track volume costs the driver nothing — it goes on parsing, keying
 * on and writing `VxVOL`, just with 0 in it — so the rate does not move at all,
 * and it is the register that actually silences: `$5E` only stops the *next*
 * note, where this cuts the one already ringing. With every voice taken the
 * output is exactly zero either way, so `$5E` bought nothing that this does not.
 *
 * Not touching `$5E` also means a song muting its own channels through
 * `$F4 $06` can never have those bits disturbed by the mixer.
 */
export function applyChannelMutes(aram: Uint8Array, mask: number, backup: MuteBackup): void {
	const wanted = mask & ALL_VOICES;
	if (wanted === 0 && backup.applied === 0 && backup.restoring === 0) {
		return;
	}

	// Voices let go of since the last call owe their volume back; ones muted
	// again before that happened can keep waiting.
	backup.restoring = (backup.restoring | (backup.applied & ~wanted)) & ~wanted;
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
