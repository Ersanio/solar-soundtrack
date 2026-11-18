/** `audiotest`: one note, auditioned where the song is playing. */

import "../localize";
import { auditionNote, auditionFrames } from "@amk/spc/note-audition";
import { check, section } from "../harness";
import { peak, rms, driver, compileToSpc, emu } from "./support";

section("one note, auditioned where the song is playing");
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
	const NOTE = 0xa4; // o4 c, and what `@0` leaves alone

	// The frames the driver is handed, against what `emitNote` writes for a note
	// of the same length (`parser.ts:2839`, Music.cpp:2254).
	const long = auditionFrames(NOTE, 192);
	check(
		"192 ticks is a $60 note and a tie",
		long[0] === 0x60 && long[1] === NOTE && long[2] === 0xc6,
		[...long.subarray(0, 3)].map((b) => b.toString(16)).join(" "),
	);

	const short = auditionFrames(NOTE, 48);
	check("under 128 ticks is one frame", short[0] === 0x30 && short[1] === NOTE);
	check("a rest follows, so the note keys off and releases", short[2] === 0x7f && short[3] === 0xc7);
	check("the block is terminated", short[short.length - 1] === 0x00);

	// A `$DD` goes where `emitNote` would leave it, which is after the frame the
	// read-ahead reads it in — so that frame is what decides where the driver arms
	// it. `main.asm:2337-2339` skips the read-ahead on a tick that fetches, so the
	// pointer has to be standing on the byte already. `frameTicks` is that frame,
	// and it is the whole note's here.
	const SLIDE = { delay: 0x00, duration: 0x30, target: 0xb0, afterTicks: 0, frameTicks: 96 };
	const head = auditionFrames(NOTE, 96, null, SLIDE);
	check(
		"a slide arming at the head goes straight after the note byte",
		head[0] === 96 && head[1] === NOTE && head[2] === 0xdd && head[3] === 0x00 && head[4] === 0x30 && head[5] === 0xb0,
		[...head.subarray(0, 6)].map((b) => b.toString(16)).join(" "),
	);
	check("and the rests still follow the whole construct", head[6] === 0x7f && head[7] === 0xc7);
	check("and the block is still terminated", head[head.length - 1] === 0x00);

	// `Music.cpp:2224` rewinds a tie out of a `$DD`'s way so the arm lands on it,
	// and the duration byte carries over, so `c4^4 $DD` is four bytes not five.
	const tied = auditionFrames(NOTE, 96, null, { ...SLIDE, afterTicks: 48, frameTicks: 48 });
	check(
		"an arm halfway in is a tie of the ticks left",
		tied[0] === 48 && tied[1] === NOTE && tied[2] === 0xc6 && tied[3] === 0xdd,
		[...tied.subarray(0, 4)].map((b) => b.toString(16)).join(" "),
	);

	const uneven = auditionFrames(NOTE, 96, null, { ...SLIDE, afterTicks: 24, frameTicks: 72 });
	check(
		"an uneven arm respells the tail's own duration",
		uneven[0] === 24 && uneven[1] === NOTE && uneven[2] === 72 && uneven[3] === 0xc6 && uneven[4] === 0xdd,
		[...uneven.subarray(0, 5)].map((b) => b.toString(16)).join(" "),
	);

	// The head run *is* `emitNote`, so a chunked note needs no case of its own.
	const chunked = auditionFrames(NOTE, 200, null, { ...SLIDE, afterTicks: 192, frameTicks: 8 });
	check(
		"a chunked note keeps its $60 head and arms on its own last frame",
		chunked[0] === 0x60 &&
			chunked[1] === NOTE &&
			chunked[2] === 0xc6 &&
			chunked[3] === 8 &&
			chunked[4] === 0xc6 &&
			chunked[5] === 0xdd,
		[...chunked.subarray(0, 6)].map((b) => b.toString(16)).join(" "),
	);

	const quantized = auditionFrames(NOTE, 96, 0x7f, SLIDE);
	check(
		"the q byte still sits between the duration and the note, once",
		quantized[0] === 96 && quantized[1] === 0x7f && quantized[2] === NOTE && quantized[3] === 0xdd,
		[...quantized.subarray(0, 4)].map((b) => b.toString(16)).join(" "),
	);

	// A tie written *after* the command — `f+2 $DD $00 $D6 a+^2` — leaves the note
	// running behind the four bytes, so the `$DD` sits between two of its frames
	// and the rest of it follows as ties. The one shape where the arm is not the
	// note's last frame, and the reason `frameTicks` is carried at all.
	const inside = auditionFrames(NOTE, 192, null, SLIDE);
	check(
		"a note that goes on after the arm keeps its ties behind the slide",
		inside[0] === 96 &&
			inside[1] === NOTE &&
			inside[2] === 0xdd &&
			inside[3] === 0x00 &&
			inside[4] === 0x30 &&
			inside[5] === 0xb0 &&
			inside[6] === 0xc6,
		[...inside.subarray(0, 7)].map((b) => b.toString(16)).join(" "),
	);

	// A layout no `emitNote` could have written is dropped rather than approximated:
	// an arm at or past the note's end belongs to the note after it, one before the
	// head has no frame, a frame over `$7F` is a duration byte that reads as a note,
	// and one the note has not the ticks for is no frame of this note at all.
	check(
		"a slide arming past the note's end is not written",
		identical(auditionFrames(NOTE, 48, null, { ...SLIDE, afterTicks: 48, frameTicks: 48 }), auditionFrames(NOTE, 48)),
	);
	check(
		"nor one arming before the note starts",
		identical(auditionFrames(NOTE, 96, null, { ...SLIDE, afterTicks: -1 }), auditionFrames(NOTE, 96)),
	);
	check(
		"nor one on a frame no duration byte can say",
		identical(auditionFrames(NOTE, 200, null, { ...SLIDE, frameTicks: 200 }), auditionFrames(NOTE, 200)),
	);
	check(
		"nor one on a frame the note is not long enough to hold",
		identical(auditionFrames(NOTE, 96, null, { ...SLIDE, afterTicks: 48 }), auditionFrames(NOTE, 96)),
	);

	// A frame of one tick is written all the same, and the driver then never arms
	// it: the read-ahead is skipped on every tick that fetches music data
	// (`main.asm:2337-2339`) and a one-tick frame has no other kind, so the command
	// loop reaches the `$DD` and dispatches it into its empty slot. AddmusicK does
	// exactly this, and reproducing it is the point — a guard here would have the
	// preview say a song is fine where the transport plays the same wreckage.
	const oneTick = auditionFrames(NOTE, 48, null, { ...SLIDE, afterTicks: 47, frameTicks: 1 });
	check(
		"a frame of one tick is written all the same",
		oneTick[0] === 47 && oneTick[1] === NOTE && oneTick[2] === 1 && oneTick[3] === 0xc6 && oneTick[4] === 0xdd,
		[...oneTick.subarray(0, 5)].map((b) => b.toString(16)).join(" "),
	);

	const source = `#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g a b > c
#1 t40 o3 v180 q7D @1 l4 [c e g e]2
`;
	const spc = compileToSpc(source);
	const pristine = spc.slice();

	const play = (): Int16Array => {
		emu.loadSpc(spc);
		emu.render(4000);
		return emu.render(16000);
	};

	const before = play();
	const audition = auditionNote(emu, spc, { atTicks: 96, channel: 0, note: NOTE, ticks: 192, scratchAt });
	const after = play();

	check("the auditioned note is audible", peak(audition.pcm) > 0.01, `peak ${peak(audition.pcm).toFixed(4)}`);
	check("both channels carry it", rms(audition.pcm) > 0.001, `rms ${rms(audition.pcm).toFixed(5)}`);
	check("it reached the tick it was asked for", audition.reachedTicks === 96, `${audition.reachedTicks} ticks`);
	check("it held the note for the ticks asked for", audition.heldTicks === 192, `${audition.heldTicks} ticks`);

	// The pokes go into the emulator's ARAM, never into the caller's image, and
	// `loadSpc` puts the pristine one back over them. Together those are why an
	// audition cannot disturb anything: the app's second core is a different
	// core, and even the same core is left exactly as it was found.
	check("the SPC image is not written to", identical(pristine, spc));
	check("the song plays identically after an audition", identical(before, after));

	// A channel the song never touches has no instrument, and `PlaySong` gives
	// every channel `$FF` before a note is read, so it is still audible.
	const unused = auditionNote(emu, spc, { atTicks: 96, channel: 5, note: NOTE, ticks: 96, scratchAt });
	check("a channel the song never uses still sounds", peak(unused.pcm) > 0.01, `peak ${peak(unused.pcm).toFixed(4)}`);

	// The point of emulating rather than reconstructing: the note is played by
	// whatever the driver is holding when it arrives.
	const under = (instrument: string, atTicks = 48): Int16Array =>
		auditionNote(emu, compileToSpc(`#amk 4\n#0 t40 o4 v220 q7F ${instrument} l8 c d e f\n`), {
			atTicks,
			channel: 0,
			note: NOTE,
			ticks: 96,
			scratchAt,
		}).pcm;

	check("the instrument in force decides the sound", !identical(under("@0"), under("@8")));

	// Tick 0 is the commonest audition there is — the transport stopped at the top
	// of the song, and a note drawn against the left edge of the roll. The dump is
	// post-init but pre-`PlaySong`, so the fast-forward runs the driver's first
	// pass before the note is handed over: until it does there is no track pointer
	// to aim at the note, no `$FF` volume to hand back, and no `@` read.
	const atZero = auditionNote(emu, spc, { atTicks: 0, channel: 0, note: NOTE, ticks: 96, scratchAt });
	check("a note auditioned at tick 0 is audible", peak(atZero.pcm) > 0.01, `peak ${peak(atZero.pcm).toFixed(4)}`);
	check(
		"the song is started before the note is handed over",
		atZero.reachedTicks === 1,
		`${atZero.reachedTicks} ticks`,
	);
	check(
		"and tick 0 hears the instrument the channel sets before its first note",
		!identical(under("@0", 0), under("@8", 0)),
	);
	check("and it holds the note for the ticks asked for", atZero.heldTicks === 96, `${atZero.heldTicks} ticks`);

	// `$F1 $02` reserves 4 KiB, and the `$FA $04` the linker puts at the top of the
	// lowest channel (link.ts:171) clears it byte by byte inside the driver's first
	// pass — tens of milliseconds, far longer than a pass of the main loop. So the
	// tick the fast-forward counts has to be a tick of music: stopping on the fetch
	// that reads that command hands the note to a driver still in the clear, and
	// `SetInstrument` has already put `@0`'s tuning on the voice (Commands.asm:107).
	const echoed = (instrument: string): Int16Array =>
		auditionNote(emu, compileToSpc(`#amk 4\n#0 t40 $F1 $02 $40 $00 o4 v220 q7F ${instrument} l8 c d e f\n`), {
			atTicks: 0,
			channel: 0,
			note: NOTE,
			ticks: 96,
			scratchAt,
		}).pcm;

	check("an echo buffer to clear does not swallow the first tick", !identical(echoed("@0"), echoed("@8")));

	// How much work `L_0C31` does before the tick voice's own `$70` write is how
	// many channels the phrase names, so the channel count is what moves the
	// driver's first fetch against the poll — and a voice latched inside that
	// fetch counts it as a tick, hands the note over mid-pass, and the phrase walk
	// that follows reads the frames at `scratchAt` as its next phrase. Four
	// channels was silent, one and two were not, which is why this is a sweep and
	// not a song.
	for (let channels = 3; channels <= 8; channels++) {
		const parts = Array.from({ length: channels }, (_, channel) => `#${channel} t40 o4 v220 q7F @8 l8 c d e f`);
		const wide = auditionNote(emu, compileToSpc(`#amk 4\n${parts.join("\n")}\n`), {
			atTicks: 0,
			channel: 0,
			note: NOTE,
			ticks: 96,
			scratchAt,
		});

		check(
			`a note at tick 0 on a ${channels}-channel song sounds`,
			peak(wide.pcm) > 0.01 && wide.heldTicks === 96,
			`peak ${peak(wide.pcm).toFixed(4)}, held ${wide.heldTicks}`,
		);
	}

	// And the `q` in force decides how long it rings: no quantization byte is
	// written, so what the song left in `$0201+2n` is what shortens the note.
	const sustained = (q: string): number => {
		const { pcm } = auditionNote(emu, compileToSpc(`#amk 4\n#0 t40 o4 v220 ${q} @0 l8 c d e f\n`), {
			atTicks: 48,
			channel: 0,
			note: NOTE,
			ticks: 192,
			scratchAt,
		});

		const floor = peak(pcm) * 32768 * 0.05;
		let last = 0;
		for (let index = 0; index < pcm.length; index++) {
			if (Math.abs(pcm[index]) > floor) {
				last = index;
			}
		}

		return last / pcm.length;
	};

	const clipped = sustained("q1f");
	const full = sustained("q7f");
	check(
		"the q in force decides how long it rings",
		clipped < full - 0.05,
		`q1f ${clipped.toFixed(2)} of the render, q7f ${full.toFixed(2)}`,
	);

	// The two guards `worklet.ts`'s seek states, restated in `note-audition.ts`:
	// a target this song never reaches has to return rather than spin.
	const far = auditionNote(emu, spc, { atTicks: 10_000_000, channel: 0, note: NOTE, ticks: 96, scratchAt });
	check("a tick the song never reaches still returns", far.reachedTicks > 0, `${far.reachedTicks} ticks`);

	// The mixer's mask, held through the fast-forward the way `worklet.ts` holds
	// it. Every voice but the target is halted before the note is handed over, so
	// the echo buffer is the only route a silenced channel has into the recording
	// — which is exactly what the dry control below states.
	//
	// `$EF $03` puts channels 0 and 1 both in the echo, and both halves matter:
	// channel 1's bit is what the "out of the echo" check rides on, and channel
	// 0's is what would fail if `auditionNote` stopped ignoring the target's own
	// bit. `$F1 $02 $40 $00` is a 4 KiB buffer at the feedback `firtest` calls
	// stable rather than runaway.
	const parts = `o4 v220 q7F @0 l8 c d e f g a b > c\n#1 t40 o3 v180 q7D @1 l4 [c e g e]2\n`;
	const wet = compileToSpc(`#amk 4\n#0 t40 $EF $03 $50 $50 $F1 $02 $40 $00 ${parts}`);
	const dry = compileToSpc(`#amk 4\n#0 t40 ${parts}`);
	const wetPristine = wet.slice();

	const heard = (image: Uint8Array, silenced: number) =>
		auditionNote(emu, image, { atTicks: 96, channel: 0, note: NOTE, ticks: 96, scratchAt, silenced });

	const open = heard(wet, 0);
	const hushed = heard(wet, 0b10);

	check("a silenced channel is not heard under the note", !identical(open.pcm, hushed.pcm));
	check("and the note itself is still heard", peak(hushed.pcm) > 0.01, `peak ${peak(hushed.pcm).toFixed(4)}`);

	const diffRms = (a: Int16Array, b: Int16Array): number => {
		let sum = 0;
		const length = Math.min(a.length, b.length);
		for (let index = 0; index < length; index++) {
			const delta = (a[index] - b[index]) / 32768;
			sum += delta * delta;
		}

		return Math.sqrt(sum / length);
	};

	// The other channels are parked rather than halted, so they play on under the
	// note and a mask takes a whole channel out of what is heard, not only out of
	// the echo buffer.
	const dryDiff = diffRms(heard(dry, 0).pcm, heard(dry, 0b10).pcm);
	check(
		"which is a whole channel and not a few cycles",
		dryDiff > rms(open.pcm) / 4,
		`diff rms ${dryDiff.toExponential(2)} against signal ${rms(open.pcm).toExponential(2)}`,
	);

	// The mask is still held through the fast-forward, which is what keeps a
	// silenced channel out of the echo buffer the note lands on — the reason it is
	// passed to `fastForward` at all. No check isolates that: the same mask takes
	// the channel out of what is heard directly, which is far the larger of the
	// two, and a song contrived to separate them would be measuring the
	// instrument's release as much as the buffer.

	// `$5E` is still untouched, so the driver's work per pass is unchanged and the
	// fast-forward arrives at the same tick. Exact, because this song has slack
	// under the one-tick-per-pass ceiling; the `t254` case is pinned above.
	check(
		"and it moves neither the tick reached nor the tick count",
		hushed.reachedTicks === open.reachedTicks && hushed.heldTicks === open.heldTicks,
		`${hushed.reachedTicks}/${hushed.heldTicks} vs ${open.reachedTicks}/${open.heldTicks}`,
	);

	const unmasked = auditionNote(emu, wet, { atTicks: 96, channel: 0, note: NOTE, ticks: 96, scratchAt });
	check("no mask at all is the same as an empty one", identical(unmasked.pcm, open.pcm));

	// Honouring it would mute the target through the fast-forward and the
	// hand-over would unmute it again, so the note would sound anyway and the only
	// effect would be the target missing from its own echo.
	check("the target channel's own bit is ignored", identical(heard(wet, 0b01).pcm, open.pcm));
	check("however it is spelled", identical(heard(wet, 0xff).pcm, heard(wet, 0xfe).pcm));
	check("and a masked audition still leaves the image alone", identical(wetPristine, wet));
}
