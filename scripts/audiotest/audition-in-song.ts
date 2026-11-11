/**
 * `audiotest`: an auditioned note with the rest of the song under it, and
 * handed over on a tick the whole song fetches on.
 */

import "../localize";
import { auditionNote } from "@amk/spc/note-audition";
import { SPC_CHANNELS, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { VOICES } from "@amk/spc/driver-state";
import { check, section } from "../harness";
import { peak, rms, crossingRate, driver, compileToSpc, emu } from "./support";

section("that note with the rest of the song under it");
{
	const identical = (a: Int16Array | Uint8Array, b: Int16Array | Uint8Array): boolean => {
		if (a.length !== b.length) {
			return false;
		}

		for (let index = 0; index < a.length; index++) {
			if (a[index] !== b[index]) {
				return false;
			}
		}

		return true;
	};

	const scratchAt = driver.manifest.localPos;
	const NOTE = 0xa4;

	// `#0` is the one auditioned; the other three hold a chord under it, `l1` so
	// they are still ringing for the whole of a 192-tick preview.
	const CHORD = `#amk 4
#0 t40 o5 v200 q7F @0 l8 c c c c @8 c c c c
#1 t40 o3 v220 q7F @8 l1 c c
#2 t40 o3 v220 q7F @8 l1 e e
#3 t40 o3 v220 q7F @8 l1 g g
`;

	const spc = compileToSpc(CHORD);
	const pristine = spc.slice();
	const asked = { atTicks: 96, channel: 0, note: NOTE, ticks: 192, scratchAt };
	const under = (silenced?: number) => auditionNote(emu, spc, { ...asked, silenced }).pcm;

	const everything = under();
	const noChord = under(0b1110);

	check(
		"the channels playing under the note are heard with it",
		rms(everything) > rms(noChord) * 1.2,
		`rms ${rms(everything).toFixed(5)} with them, ${rms(noChord).toFixed(5)} without`,
	);

	// And the mixer decides which, one bit at a time — the chord is three voices,
	// so silencing one of them has to sit between the other two answers.
	const oneOff = rms(under(0b0110));
	check(
		"and the mixer decides which of them, channel by channel",
		oneOff > rms(noChord) && oneOff < rms(everything),
		`${rms(noChord).toFixed(5)} < ${oneOff.toFixed(5)} < ${rms(everything).toFixed(5)}`,
	);

	// Silencing every one of them leaves the note by itself, which is the
	// note auditioned alone: the same note, at the same level, with nothing under it.
	const solo = auditionNote(emu, compileToSpc(`#amk 4\n#0 t40 o5 v200 q7F @0 l8 c c c c @8 c c c c\n`), asked);
	check(
		"silencing all of them leaves the note by itself",
		Math.abs(rms(noChord) - rms(solo.pcm)) < rms(solo.pcm) / 50,
		`${rms(noChord).toFixed(5)} against ${rms(solo.pcm).toFixed(5)} on its own`,
	);

	// The note is still the note: a park is not a halt, but the frames are still
	// written over the song's load address and the phrase table with it. A voice
	// that read a `$00` would walk that table over them and take all eight track
	// pointers with it, so an audition running up to the end of the song is the
	// case that says the parking holds. Every channel here ends at 384 ticks.
	const edge = auditionNote(emu, spc, { ...asked, atTicks: 192 });
	check(
		"a note auditioned into the end of the song still holds",
		edge.heldTicks === 192 && peak(edge.pcm) > 0.01,
		`held ${edge.heldTicks}, peak ${peak(edge.pcm).toFixed(4)}`,
	);

	check("and none of it writes to the image", identical(pristine, spc));
}

section("that note handed over on a tick the whole song fetches on");
{
	const identical = (a: Int16Array, b: Int16Array): boolean => {
		if (a.length !== b.length) {
			return false;
		}

		for (let index = 0; index < a.length; index++) {
			if (a[index] !== b[index]) {
				return false;
			}
		}

		return true;
	};

	/** How far two renders are apart, from `fromSeconds` on. */
	const diffRms = (a: Int16Array, b: Int16Array, fromSeconds = 0): number => {
		const from = Math.floor(fromSeconds * SPC_SAMPLE_RATE) * SPC_CHANNELS;
		const length = Math.min(a.length, b.length);
		let sum = 0;
		for (let index = from; index < length; index++) {
			const delta = (a[index] - b[index]) / 32768;
			sum += delta * delta;
		}

		return Math.sqrt(sum / (length - from));
	};

	const scratchAt = driver.manifest.localPos;
	const NOTE = 0xa4; // o4 c, two octaves under what the song below plays
	const AT = 96;
	const HELD = 192;

	/**
	 * Every channel changing instrument, volume and pan immediately in front of
	 * the note at {@link AT}, which is the tick the driver spends longest on: one
	 * music tick fetches, dispatches and keys on for all eight voices, and
	 * `L_0C4D` walks them 0 to 7 (`main.asm:2328-2459`). A hand-over that lands
	 * inside that walk gets a different answer per channel, which is what these
	 * check.
	 */
	const fetchingTogether = (second: string): string =>
		`#amk 4\n${Array.from(
			{ length: VOICES },
			(_, channel) => `#${channel} t40 o6 v200 q7F @0 l8 c c c c ${second} y15 v220 c c c c`,
		).join("\n")}\n`;

	const together = compileToSpc(fetchingTogether("@8"));
	const spread = Array.from(
		{ length: VOICES },
		(_, channel) => auditionNote(emu, together, { atTicks: AT, channel, note: NOTE, ticks: HELD, scratchAt }).pcm,
	);

	// Every one of them has to be heard at all. A hand-over that lands inside the
	// walk halts some other voice mid-fetch, which reads on through a pointer
	// whose high byte has just gone to zero and walks the phrase table over every
	// pointer at once — seven of the eight then played nothing.
	const quietest = spread.reduce((worst, pcm) => Math.min(worst, peak(pcm)), 1);
	check("every channel is heard", quietest > 0.01, `the quietest peaks at ${quietest.toFixed(4)}`);

	// And they are the same music under the same state, so they are the same
	// note. A level rather than an identity, for the reason the mask control
	// above gives: the arrival waits on a different voice's fetch for each
	// channel and lands the key-on a few CPU cycles apart, which moves the DSP's
	// free-running envelope counter under the attack.
	const level = rms(spread[0]);
	const apart = spread.map((pcm) => diffRms(spread[0], pcm));
	const worst = Math.max(...apart);
	check(
		"and hands the note over the same way",
		worst < level / 25 && spread.every((pcm) => Math.abs(peak(pcm) - peak(spread[0])) < 0.005),
		`channel ${apart.indexOf(worst)} is the furthest off, at ${worst.toExponential(2)} against a signal of ${level.toExponential(2)}`,
	);

	// Which is the whole of what the cycles reach: past the attack the eight agree
	// to within a five-hundredth of the signal, where a hand-over landing inside
	// the walk put a different instrument on one channel and silence on six.
	const settled = Math.max(...spread.map((pcm) => diffRms(spread[0], pcm, 0.25)));
	check(
		"leaving the body of the note where it was",
		settled < level / 200,
		`${settled.toExponential(2)} against a signal of ${level.toExponential(2)}`,
	);

	// The `@` in front of the note is dispatched by the same fetch that reads the
	// note, so a hand-over that arrives before that fetch hears the one before it
	// — and these two songs are the same length, so nothing but the instrument
	// moves.
	const late = (instrument: string): Int16Array =>
		auditionNote(emu, compileToSpc(fetchingTogether(instrument)), {
			atTicks: AT,
			channel: VOICES - 1,
			note: NOTE,
			ticks: HELD,
			scratchAt,
		}).pcm;

	check("and hears the @ written immediately in front of it", !identical(late("@8"), late("@0")));

	// One key-on each. The note is auditioned two octaves under what the song
	// plays, so a voice handed the note part-way through its own fetch — where
	// `L_0CB3` reloads `$70+x` from the song's duration byte over the 1 that was
	// just written there (`main.asm:2440-2441`) — goes on playing the song's note
	// and falls into the frames at `scratchAt` when it runs out, changing pitch
	// half way through the render.
	//
	// Asked for with every other channel silenced, so what the crossing rate is
	// measuring is the note and not the seven voices playing under it.
	const bare = Array.from(
		{ length: VOICES },
		(_, channel) =>
			auditionNote(emu, together, { atTicks: AT, channel, note: NOTE, ticks: HELD, scratchAt, silenced: 0xff }).pcm,
	);
	const pitches = bare.map((pcm) => [crossingRate(pcm, 0.05, 0.2), crossingRate(pcm, 0.6, 0.75)] as const);
	const drifted = pitches.findIndex(
		([opening, closing]) => !(opening > 0) || Math.abs(closing - opening) > opening * 0.05,
	);
	check(
		"and each keys on once, at its own pitch throughout",
		drifted < 0,
		drifted < 0
			? `${pitches[0][0].toFixed(0)} Hz start to finish`
			: `channel ${drifted} runs at ${pitches[drifted][0].toFixed(0)} Hz then ${pitches[drifted][1].toFixed(0)} Hz`,
	);
}
