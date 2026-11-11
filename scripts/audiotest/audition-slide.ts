/** `audiotest`: an auditioned note sliding as the `$DD` riding on it says. */

import "../localize";
import { AUDITION_TAIL_SECONDS, auditionNote } from "@amk/spc/note-audition";
import type { PitchSlide } from "@amk/spc/song-walk";
import { SPC_CHANNELS, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { check, section } from "../harness";
import { crossingRate, firstDifference, driver, compileToSpc, emu } from "./support";

section("that note sliding, as the $DD riding on it says");
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
	const NOTE = 0xa4; // o4 c
	const UP = 0xb0; // an octave above it
	const DOWN = 0x98; // an octave below

	// `@0`, because the rate below has to track pitch over the whole range the
	// slides cross: its crossings double per octave from o2 to o6, where `@8`'s
	// sample is already pitched high enough that the DSP saturates above o4 and an
	// octave up reads the same as no slide at all.
	const spc = compileToSpc(`#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g a b > c
#1 t40 o3 v180 q7D @1 l4 [c e g e]2
`);
	const pristine = spc.slice();

	const HELD = 96;
	const sound = (slide: PitchSlide | null, note = NOTE): Int16Array =>
		auditionNote(emu, spc, { atTicks: 96, channel: 0, note, ticks: HELD, scratchAt, slide }).pcm;

	// The note's own span, off the buffer rather than off any tempo arithmetic:
	// `record` stops `AUDITION_TAIL_SECONDS` after the last tick.
	const noteSeconds = (pcm: Int16Array): number => pcm.length / SPC_CHANNELS / SPC_SAMPLE_RATE - AUDITION_TAIL_SECONDS;
	const early = (pcm: Int16Array): number => crossingRate(pcm, noteSeconds(pcm) * 0.05, noteSeconds(pcm) * 0.45);
	const late = (pcm: Int16Array): number => crossingRate(pcm, noteSeconds(pcm) * 0.55, noteSeconds(pcm) * 0.95);

	const flat = sound(null);
	const high = sound(null, UP);
	const low = sound(null, DOWN);

	// The control, and it ships: a crossing rate that did not track pitch on this
	// sample would prove only that something about the render changed.
	check(
		"the crossing rate tracks pitch on this sample",
		late(high) > late(flat) * 1.5 && late(low) < late(flat) / 1.5,
		`${late(low).toFixed(0)} < ${late(flat).toFixed(0)} < ${late(high).toFixed(0)}`,
	);

	const up = { delay: 0x00, duration: 0x60, target: UP, afterTicks: 0, frameTicks: HELD };
	const down = { delay: 0x00, duration: 0x60, target: DOWN, afterTicks: 0, frameTicks: HELD };
	const rising = sound(up);
	const falling = sound(down);

	// Both directions, because "any perturbation raises the rate" would pass one.
	check(
		"a note carrying a $DD slides up to its target",
		late(rising) > late(flat) * 1.1,
		`${late(rising).toFixed(0)} vs ${late(flat).toFixed(0)}`,
	);
	check("and down to it", late(falling) < late(flat) / 1.1, `${late(falling).toFixed(0)} vs ${late(flat).toFixed(0)}`);

	// A slide arrives rather than jumps, so the average over the window it is
	// still travelling through falls short of the note it is travelling to.
	check(
		"it arrives rather than jumps",
		late(rising) < late(high),
		`${late(rising).toFixed(0)} vs ${late(high).toFixed(0)}`,
	);

	// The three renders are byte-identical layouts one operand apart, so this
	// measures nothing at all: a delay the driver counts pushes the first sample
	// that differs strictly later.
	const delayed = (delay: number): Int16Array => sound({ ...up, delay });
	const at0 = delayed(0x00);
	const at20 = delayed(0x20);
	const at40 = delayed(0x40);
	check(
		"the delay operand is counted before the pitch moves",
		firstDifference(at0, at20) > 0 && firstDifference(at20, at40) > firstDifference(at0, at20),
		`${firstDifference(at0, at20)} then ${firstDifference(at20, at40)} frames`,
	);

	// A tie written after the command leaves the note running behind the four
	// bytes, and once the slide has armed it counts off `$90`/`$91` rather than
	// off frames — so a note split 48 and 48 around the arm sounds the same as one
	// that arms on its only frame. `f+2 $DD $00 $D6 a+^2` is that shape.
	const behind = sound({ ...up, frameTicks: 48 });
	check(
		"the ticks a note has left behind the arm do not move the slide",
		Math.abs(late(behind) - late(rising)) < late(rising) * 0.05,
		`${late(behind).toFixed(0)} vs ${late(rising).toFixed(0)} arming on one frame`,
	);
	check(
		"and it is a slide either way, not a flat note",
		late(behind) > late(flat) * 1.1,
		`${late(behind).toFixed(0)} vs ${late(flat).toFixed(0)} flat`,
	);

	// The reading the whole design turns on. `afterTicks` is not an operand: it is
	// where the frame the peek reads the bytes in begins, so the same three bytes
	// arm half a note apart and only the byte layout can say which.
	const armEarly = sound({ delay: 0x00, duration: 0x30, target: UP, afterTicks: 0, frameTicks: HELD });
	const armLate = sound({ delay: 0x00, duration: 0x30, target: UP, afterTicks: 48, frameTicks: 48 });
	check(
		"afterTicks holds the pitch still until the frame the peek reads it in",
		Math.abs(early(armLate) - early(flat)) < early(flat) * 0.05,
		`${early(armLate).toFixed(0)} vs ${early(flat).toFixed(0)} flat`,
	);
	check(
		"where the same slide at the head has already moved it",
		early(armEarly) > early(flat) * 1.1,
		`${early(armEarly).toFixed(0)} vs ${early(flat).toFixed(0)} flat`,
	);

	// The other end of the byte layout above: those bytes go in, and the driver
	// declines to arm them, because a one-tick frame has no tick that is not a
	// fetch tick. What it does instead is dispatch `$DD` into an empty slot, which
	// leaves the voice sounding well past the point the same note released — the
	// pitch is what is checked, since that is the claim being made.
	const short = sound({ delay: 0x00, duration: 0x30, target: UP, afterTicks: HELD - 1, frameTicks: 1 });
	check(
		"a slide behind a one-tick frame is never armed",
		Math.abs(late(short) - late(flat)) < late(flat) * 0.05,
		`${late(short).toFixed(0)} vs ${late(flat).toFixed(0)} flat`,
	);

	check("and a slide leaves the image alone", identical(pristine, spc));
}
