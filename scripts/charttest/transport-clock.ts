/**
 * `charttest`: the transport's tick-to-seconds clock over songs the compiler
 * will not time, and the roll's playhead following the music rather than the
 * written tempo.
 */

import "../localize";
import type { SongTimeline, TempoChange } from "@amk/spc/song-walk";
import {
	DEFAULT_TEMPO,
	driverTickSeconds,
	tempoFadeSeconds,
	tempoFadeSteps,
	tickSeconds,
} from "@amk/tokens/commands/units";
import { secondsAtTick, songClock, ticksPerSecondAt } from "../../web/src/app/state/song-clock";
import { advanceTick } from "../../web/src/app/editor/views/piano-roll/roll-clock-step";
import { clamp } from "../../web/src/app/util/math";
import { check, section } from "../harness";

section("the transport's clock, over songs the compiler will not time");
{
	/** Only the four fields `songClock` reads; the rest is padding. */
	const song = (ticks: number, tempoChanges: TempoChange[] = [], truncated = false): SongTimeline => ({
		notes: [],
		ticks,
		loopTick: null,
		tempoChanges,
		tempoAtEnd: null,
		carries: [],
		commands: [],
		loops: [],
		channelTicks: [ticks, 0, 0, 0, 0, 0, 0, 0],
		used: [true, false, false, false, false, false, false, false],
		unreachable: [],
		customInstruments: [],
		truncated,
		problems: [],
	});

	const at = (tempo: number, tick = 0): TempoChange => ({ tick, tempo, fadeTicks: 0, address: 0, repeats: false });
	const fade = (tick: number, tempo: number, fadeTicks: number): TempoChange => ({
		tick,
		tempo,
		fadeTicks,
		address: 0,
		repeats: false,
	});
	const near = (got: number, want: number) => Math.abs(got - want) < 1e-9;

	// A song with no `t` is not a song with no tempo — main.asm:177 has already
	// put #$36 into $51. Reading it as a written byte would give 55 and retime
	// every untempoed song by 1.85%.
	const bare = songClock(song(192))!;
	check(
		"no tempo command still clocks, at the driver's t53",
		near(bare.seconds, 192 * driverTickSeconds(54)),
		`${bare.seconds.toFixed(4)} s`,
	);
	check("and leaves no empty segment in front of a t at tick 0", songClock(song(192, [at(96)]))!.segments.length === 1);

	// Two exact terms, not one average: the halves do not agree by a constant.
	const stepped = songClock(song(384, [at(96, 192)]))!;
	check(
		"a $E2 takes effect on its own tick",
		near(stepped.seconds, 192 * driverTickSeconds(54) + 192 * driverTickSeconds(97)),
		`${stepped.seconds.toFixed(4)} s`,
	);

	// The whole point of the change: the clock and the inspector's label are one
	// model, so they cannot give a song two lengths.
	const faded = songClock(song(255, [fade(0, 254, 255)]))!;
	check(
		"a fade is priced tick by tick, exactly as its label is",
		faded.seconds === tempoFadeSeconds(255, DEFAULT_TEMPO, 254),
		`${faded.seconds.toFixed(4)} s`,
	);
	check("which is not what those ticks take at the tempo it leaves", faded.seconds < 255 * tickSeconds(DEFAULT_TEMPO));

	// A row per tick would work and make the binary search pointless.
	check(
		"equal-tempo ticks fold into segments",
		faded.segments.length < 255 &&
			faded.segments.every((s, n) => n === 0 || s.secondsPerTick !== faded.segments[n - 1].secondsPerTick),
		`${faded.segments.length} segments`,
	);

	// The table has to join up: a segment's own seconds plus its rate across its
	// span must land on the next one's, or the readout jumps at every boundary
	// while still looking monotone and plausible either side of it.
	check(
		"segments join up, so the readout does not jump at a boundary",
		faded.segments.every((s, n) => {
			const next = faded.segments[n + 1];
			return next === undefined || near(s.seconds + (next.tick - s.tick) * s.secondsPerTick, next.seconds);
		}),
	);
	check(
		"and seconds never run backwards",
		Array.from({ length: 256 }, (_, tick) => secondsAtTick(faded, tick)).every(
			(seconds, n, all) => n === 0 || seconds > all[n - 1],
		),
	);

	// The delta belongs to the written duration. Re-deriving it from the ticks
	// that survive is a different fade, and reads entirely reasonable.
	const cut = songClock(song(96, [fade(0, 254, 255)]))!;
	const first96 = (tempoFadeSteps(255, DEFAULT_TEMPO, 254) ?? [])
		.slice(0, 96)
		.reduce((total, tempo) => total + driverTickSeconds(tempo), 0);
	check("a fade cut short keeps the delta its written duration gave it", near(cut.seconds, first96));
	check("which is not the same as a shorter fade", !near(cut.seconds, tempoFadeSeconds(96, DEFAULT_TEMPO, 254)!));

	// The driver has one tempo, not a stack: a second command ends the ramp.
	const interrupted = songClock(song(192, [fade(0, 254, 255), at(53, 96)]))!;
	const ramped = (tempoFadeSteps(255, DEFAULT_TEMPO, 254) ?? [])
		.slice(0, 96)
		.reduce((total, tempo) => total + driverTickSeconds(tempo), 0);
	check(
		"a tempo command inside a fade ends it there",
		near(interrupted.seconds, ramped + 96 * driverTickSeconds(54)),
		`${interrupted.seconds.toFixed(4)} s`,
	);

	// Commands.asm:330's carry-set adc wraps $FF to 0. Not a division by zero,
	// not an infinite song: the pass genuinely never finishes.
	const stopped = songClock(song(384, [at(255, 192)]))!;
	check("t255 stops the song rather than running it fastest", stopped.stalled && stopped.ticks === 192);
	check(
		"and the clock pins there instead of diverging",
		Number.isFinite(stopped.seconds) && secondsAtTick(stopped, 999) === stopped.seconds,
	);
	check("a fade into a stop stops too", songClock(song(384, [fade(0, 255, 96)]))!.stalled);

	// `null` and not a zero-length clock: the callers read it as "no opinion, use
	// what the compiler said", and a song of no length would disable seeking.
	check("no walk, no clock", songClock(null) === null);
	check("nor for a song of no ticks", songClock(song(0)) === null);
	check("nor for a walk that ran out of budget", songClock(song(192, [], true)) === null);

	// The rate the roll extrapolates at, which has to be the clock's own slope.
	const rate = songClock(song(384, [at(96, 192)]))!;
	check("the clock reports its own rate", near(ticksPerSecondAt(rate, 0), 1 / driverTickSeconds(54)));
	check("which follows a tempo change", near(ticksPerSecondAt(rate, 300), 1 / driverTickSeconds(97)));
}

section("the roll's playhead follows the music, not the tempo it was written at");
{
	// The driver runs at most one tick per pass of its main loop, so a song that
	// asks for more than it can manage gets fewer — measured, about 231 of the
	// 498 ticks a second a t254 song on eight channels writes. A playhead
	// extrapolated at the tempo *byte* therefore races between anchors and sits a
	// steady distance ahead of the notes being sounded. There is no visual tell:
	// it scrolls perfectly smoothly, in the wrong place.
	const PASS = 7488;
	const MAX_EXTRAPOLATION = 0.15; // roll-clock.ts's MAX_EXTRAPOLATION
	const FPS = 60;

	/** The roll's clock over `seconds`, with `rate` as its belief about speed. */
	const drift = (trueRate: number, rate: number, seconds = 6) => {
		let shown = 0;
		let anchorTicks = 0;
		let anchorAt = 0;
		let last = 0;
		let worst = 0;

		for (let f = 1; f <= seconds * FPS; f++) {
			const now = (f * 1000) / FPS;
			// The transport posts the driver's own count about ten times a second.
			if (now - anchorAt >= 100) {
				anchorAt = now;
				anchorTicks = (now / 1000) * trueRate;
			}

			const elapsed = last === 0 ? 0 : (now - last) / 1000;
			last = now;

			const since = Math.max(0, (now - anchorAt) / 1000);
			const reach = anchorTicks + Math.min(since, MAX_EXTRAPOLATION) * rate;
			shown = advanceTick({ shown, target: clamp(reach, 0, PASS), rate, elapsed, pass: PASS });

			// Second half only, so the start-up transient is not the answer.
			if (f > seconds * FPS * 0.5) {
				worst = Math.max(worst, Math.abs(shown - (now / 1000) * trueRate));
			}
		}

		return worst;
	};

	check(
		"an ordinary song tracks within a couple of ticks",
		drift(105.5, 105.5) < 3,
		`${drift(105.5, 105.5).toFixed(1)}`,
	);

	// 231.2 measured against 498.0 nominal.
	const nominal = drift(231.2, 498.0);
	const measured = drift(231.2, 231.2);
	check("the tempo byte puts it more than a quarter note out", nominal > 48, `${nominal.toFixed(1)} ticks`);
	check("the clock's own rate keeps it within a 32nd", measured < 6, `${measured.toFixed(1)} ticks`);
}
