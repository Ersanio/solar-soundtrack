/** Our SPC driver's I/O through the emulator's ARAM. */

import { word } from "@amk/core/bytes";
import { SPC_SAMPLE_RATE } from "./wasm-host";

/** Zero-page addresses, from the ARAM map. */
export const Addr = {
	/** `$30-$3F`: music track pointer, one 16-bit pointer per voice. */
	TrackPointers: 0x30,
	/** `$44`: the sound effect tempo accumulator, stepped by the timer count. */
	SfxPhase: 0x44,
	/** `$48`: the voice bit every per-voice loop shifts along, and out to zero. */
	VoiceLoopBit: 0x48,
	/** `$49`: the music tempo accumulator, whose overflow is a music tick. */
	TickPhase: 0x49,
	/** `$51`: music tempo, as the `t` command and any fade leave it. */
	Tempo: 0x51,
	// `$5E` is the driver's own mute mask, and nothing here writes it — the
	// mixer mutes inside the DSP instead (`SpcCore.muteVoices`), and
	// `packages/spc/CLAUDE.md` says why disabling a channel is the wrong tool.
	/** `$70-$7F`: music note duration, one byte per voice. */
	NoteDurations: 0x70,
	/** `$C1+2n`: the instrument the voice is playing, 0 for one never given any. */
	Instruments: 0xc1,
	/** `$0200+2n`: the duration byte a voice last read, ahead of its note. */
	NoteDurationBytes: 0x0200,
	/** `$0201+2n`: the gate `q`'s high nybble chose, as a fraction of the duration. */
	NoteGates: 0x0201,
	/** `$0211+2n`: the velocity `q`'s low nybble chose, which scales `VxVOL`. */
	NoteVelocities: 0x0211,
} as const;

/** N-SPC songs have eight music channels. */
export const VOICES = 8;

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

/**
 * Whether the driver is part-way through one of its per-voice loops.
 *
 * Every one of them seeds `$48` with a single bit and shifts it out to zero on
 * the last voice: the phrase start (`main.asm:2313-2326`), the music fetch
 * (`:2330-2459`), the per-voice volume pass (`:2502-2511`), the off-tick one in
 * the main loop (`:265-274`) and `PlaySong`'s own (`:2131-2164`). A zero is
 * therefore the driver's own mark that no voice iteration is in flight, and it
 * holds for most of a pass, the loop at `MainLoop` spinning on `$FD` until the
 * timer comes round (`:186-187`).
 *
 * Anything writing a voice's track pointer or duration counter has to wait for
 * one. `L_0C4D` tests `$31+x` and then goes on reading music data through it
 * (`:2333-2341`), so a pointer taken from a voice already past that test sends
 * the fetch it is in the middle of into low RAM — and the `$00` it finds there
 * walks the phrase table (`L_0C01`), which reinstalls every voice's pointer from
 * a table an audition has written its own note frames over.
 */
export function inVoiceLoop(aram: Uint8Array): boolean {
	return aram[Addr.VoiceLoopBit] !== 0;
}

/**
 * `$44`, which the driver writes at the top of a pass of its main loop.
 *
 * It goes down before `ProcessSFX`, before the tempo accumulator and before any
 * voice loop (`main.asm:193`), so a change in it is both the earliest point in a
 * pass and the most repeatable one there is — {@link sawTick} reads it for the
 * first reason, and anything that has to hand the driver something at the same
 * instant twice running reads it for the second.
 */
export function passMark(aram: Uint8Array): number {
	return aram[Addr.SfxPhase];
}

/**
 * A number that changes when the music fetch loop reaches a voice.
 *
 * The duration counter alone cannot say it: `L_0C4D` decrements `$70+x` and
 * `L_0CB3` reloads it from the duration byte in the one pass (`main.asm:2337`,
 * `:2440-2441`), so a run of one-tick notes leaves 1 in it on either side of the
 * fetch. The track pointer moves on every fetch and stands still on every tick
 * between them, so the two together cover both.
 */
export function voiceFetchMark(aram: Uint8Array, voice: number): number {
	return (word(aram, Addr.TrackPointers + voice * 2) << 8) | aram[Addr.NoteDurations + voice * 2];
}

/**
 * Stops a voice reading music data without taking it out of the driver's
 * rotation, by putting the ceiling in its duration counter.
 *
 * Zeroing the track pointer's high byte would also stop it, and stops too much:
 * a voice the fetch loop skips is skipped by the per-voice volume and fade
 * routine as well (`L_0D1C`, `main.asm:2503-2505`), so its `VxVOL` is never
 * rewritten and whatever is ringing on it goes on ringing at the volume it had.
 * A parked voice keeps all of that — its fade, its vibrato, and the key-off its
 * own note is already counting down to, since `$0100+x` is decremented by the
 * read-ahead that runs on every tick the counter does not reach zero
 * (`main.asm:3213`). It simply never reaches the next note.
 *
 * 127 ticks is 0.25 s at an ordinary tempo and less at a fast one, so a caller
 * holding a voice for longer than that parks it again.
 */
export function parkVoice(aram: Uint8Array, voice: number): void {
	aram[Addr.NoteDurations + voice * 2] = 0x7f;
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
 * Emulator frames per poll, which is how often the driver's tempo accumulator
 * gets read by everything that counts ticks.
 *
 * 1 ms, so `$44` is sampled at {@link TICK_POLL_HZ} — twice the driver's main
 * loop rate, which is what makes the tick count exact. Measured against the
 * vendored core, 32 frames rather than 1024 costs about 4% more emulator time
 * and still runs 355x faster than realtime on an eight-channel song — a cheap
 * price for a playhead that cannot drift.
 */
export const POLL_BLOCK_FRAMES = SPC_SAMPLE_RATE / TICK_POLL_HZ;

/**
 * How long a seek will emulate without the tick count moving before it gives up,
 * in blocks of {@link POLL_BLOCK_FRAMES}.
 *
 * A target the song never reaches — one past the end of a song that does not
 * loop, or any target at all in a song with no note data to tick on — would
 * otherwise render until a wall-clock ceiling, which on the audio thread is a
 * freeze rather than a slow seek. Two seconds is four times the 0.512 s a tick
 * takes at the slowest tempo the driver can hold, so no real song can look
 * stalled while it is merely slow.
 */
export const SEEK_STALL_BLOCKS = 2 * TICK_POLL_HZ;

/**
 * And an outright ceiling, for a song that ticks forever without reaching the
 * target. `999` seconds is what the SPC format allows.
 */
export const MAX_SEEK_SECONDS = 999;

/**
 * Whether the driver is playing a voice, judged the way it judges it: the track
 * pointer's high byte alone (`main.asm:2315, 2331`, `mov a, $31+x` / `beq`). The
 * same test {@link tickVoice} walks, and the same one {@link haltVoice} turns off.
 */
export function voicePlaying(aram: Uint8Array, voice: number): boolean {
	return aram[Addr.TrackPointers + voice * 2 + 1] !== 0;
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
 * note of every channel (`parser.ts:2849`).
 */
export function voiceHasQuantization(aram: Uint8Array, voice: number): boolean {
	return aram[Addr.NoteGates + voice * 2] !== 0 && aram[Addr.NoteVelocities + voice * 2] !== 0;
}
