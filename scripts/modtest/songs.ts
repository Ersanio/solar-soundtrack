/** `modtest`: songs — a module that holds several, each entered at an order of its own, found as libopenmpt finds subsongs, and one of them chosen, written and walked. */

import { withSong, writeTracker } from "@amk/import/tracker";
import { check, section } from "../harness";
import { type Cell, encoded, modBytes, pattern, period, played, problems, song, square } from "./support";
import { readMod } from "@amk/import/mod";

const SAMPLES = [{ pcm: square(32, 8), loopStart: 0, loopLength: 32 }];
const note = (semitones: number): Cell => ({ period: period(semitones), sample: 1 });
const jump = (order: number): Cell => ({ effect: 0xb, param: order });

section("songs: a module holding several");

{
	// Orders 0 and 1 each jump into a loop of their own, as Deus Ex's entry orders do; order 4 is
	// an empty pattern nothing reaches that loops on itself, order 5 one with a note.
	const bytes = modBytes({
		samples: SAMPLES,
		orders: [0, 1, 2, 3, 4, 5],
		patterns: [
			pattern([
				[0, 0, note(12)],
				[63, 0, jump(2)],
			]),
			pattern([
				[0, 1, note(19)],
				[63, 1, jump(3)],
			]),
			pattern([
				[0, 0, note(14)],
				[63, 0, jump(0)],
			]),
			pattern([
				[0, 1, note(21)],
				[63, 1, jump(1)],
			]),
			pattern([[63, 0, jump(4)]]),
			pattern([[0, 2, note(16)]]),
		],
	});
	const mod = readMod(bytes);
	const starts = mod.songs.map((s) => s.order).join();
	check("a song starts at each order no song before it plays", starts === "0,1,5", starts);
	check("the first is chosen", mod.chosen === 0 && mod.play === mod.songs[0].play);
	check(
		"each names its pattern and counts its orders",
		mod.songs.map((s) => `${s.pattern}:${s.orders}`).join() === "0:2,1:2,5:1",
		mod.songs.map((s) => `${s.pattern}:${s.orders}`).join(),
	);

	const second = withSong(mod, 1);
	const orders = [...new Set(second.play.segments.map((s) => s.order))].join();
	check("the second song plays only its own orders", orders === "1,3", orders);
	check("and loops to its own start", second.play.loopTick === 0 && !second.play.tooLong);
	check(
		"its channels' notes are its own",
		second.channelNotes.join() === "0,2,0,0" && mod.channelNotes.join() === "2,0,0,0",
		`${second.channelNotes.join()} / ${mod.channelNotes.join()}`,
	);
	check(
		"only the channels a song plays are listed and suggested",
		second.used.join() === "1" &&
			second.suggested.join() === "1" &&
			second.suggestedShared.join() === "1" &&
			mod.used.join() === "0" &&
			mod.suggested.join() === "0",
		`${second.used.join()} ${second.suggested.join()} ${second.suggestedShared.join()} / ${mod.used.join()} ${mod.suggested.join()}`,
	);
	check(
		"the samples stay, counted for the song chosen",
		second.samples.length === mod.samples.length && second.samples[0].notes === 2,
	);
	check("the reader's file is kept", second.file === mod.file && second.chosen === 1);

	const written = writeTracker(second, {
		keep: second.suggested,
		factors: new Map(),
		separation: 0.5,
		loop: "jump",
		sampleName: (index) => `MOD ${String(index).padStart(2, "0")}.brr`,
		fallbackTitle: null,
	});
	check("its one channel is written alone", written.channels.length === 1, String(written.channels.length));
	const built = song(written.text, encoded(second, written));
	check("the second song raises nothing", problems(built).length === 0, problems(built).join("; "));
	const at = second.suggested.indexOf(1);
	const walked = played(built, at).map((n) => n.tick);
	const struck = second.play.channels[1].keyOn.flatMap((on, t) => (on ? [t * 2] : []));
	check(
		"and every key-on it strikes is walked at its tick",
		walked.join() === struck.join() && struck.length === 2,
		`${walked.join()} / ${struck.join()}`,
	);
}
