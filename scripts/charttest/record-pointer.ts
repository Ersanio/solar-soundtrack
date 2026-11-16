/** `charttest`: the pointer a MIDI recording is timed against. */

import "../localize";
import type { SongTimeline, TempoChange } from "@amk/spc/song-walk";
import { DEFAULT_TEMPO, ticksPerSecond } from "@amk/tokens/commands/units";
import { songClock, ticksPerSecondAt } from "../../web/src/app/state/song-clock";
import { recordTickStep } from "../../web/src/app/editor/views/piano-roll/roll-take";
import { check, section } from "../harness";
import { EPSILON } from "./support";

section("the record pointer");
{
	const song = (ticks: number, tempoChanges: TempoChange[]): SongTimeline => ({
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
		usedInstruments: [],
		unreachable: [],
		customInstruments: [],
		truncated: false,
		problems: [],
	});
	const at = (tempo: number, tick: number): TempoChange => ({ tick, tempo, fadeTicks: 0, address: 0, repeats: false });
	const near = (got: number, want: number): boolean => Math.abs(got - want) < EPSILON;

	// Two tempos, so the slope the pointer runs at depends on where it stands.
	const clock = songClock(song(192, [at(30, 0), at(60, 96)]))!;
	const slow = ticksPerSecondAt(clock, 10);
	const fast = ticksPerSecondAt(clock, 150);

	check("the two halves of the song run at different rates", fast > slow * 1.5, `${slow} and ${fast}`);
	check(
		"the pointer moves at the clock's rate where it stands",
		near(recordTickStep(10, 0.5, clock), 10 + slow / 2) && near(recordTickStep(150, 0.5, clock), 150 + fast / 2),
		`${recordTickStep(10, 0.5, clock)} and ${recordTickStep(150, 0.5, clock)}`,
	);

	// A take runs on past the last tick, and the song's last rate is the only
	// one there is to run on at.
	check(
		"past the end it keeps the song's last rate",
		near(recordTickStep(400, 1, clock), 400 + fast),
		`${recordTickStep(400, 1, clock)}`,
	);

	check("no time passing moves nothing", recordTickStep(48, 0, clock) === 48);
	// A key's own stamp can be a little before the frame the pointer was last
	// carried to; the pointer never runs backwards for it.
	check("nor does a stamp from before the last frame", recordTickStep(48, -0.01, clock) === 48);

	check(
		"a song with no clock runs at the driver's own starting tempo",
		near(recordTickStep(0, 1, null), ticksPerSecond(DEFAULT_TEMPO)),
		`${recordTickStep(0, 1, null)}`,
	);
}
