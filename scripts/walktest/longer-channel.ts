/** `walktest`: a channel longer than the song is reported, not drawn. */

import "../localize";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSpc } from "@amk/spc/export";
import { createTickPhase, sawTick, seedTickPhase, TICK_POLL_HZ } from "@amk/spc/driver-state";
import { emptySample } from "@amk/spc/brr";
import { instantiate, SPC_SAMPLE_RATE } from "@amk/spc/wasm-host";
import { type SongTimeline, unreachableChannels } from "@amk/spc/song-walk";
import { SPC_ASSETS, check, section } from "../harness";
import { build, BY_NAME, driver } from "./support";

// ---------------------------------------------------------------------------
section("a channel longer than the song is reported, not drawn");
// ---------------------------------------------------------------------------
{
	// `#1` runs twice as long as `#0`. The driver ends a phrase the moment any
	// voice reads its `$00`, so half of `#1` is never played — silently, which
	// is what makes it worth a diagnostic rather than a shrug.
	const uneven = build("#amk 4\n#0 @0 o4 l8 [c d e f g f e d]4\n#1 @1 o3 l4 [c e g e]8\n");
	const [warning] = unreachableChannels(uneven.timeline, uneven.result.noteMap ?? []);

	check("an over-long channel is reported", warning !== undefined);
	check("it is SST0502 and severe", warning?.code === "SST0502" && warning?.severity === "severe", warning?.code);
	check("it names the channel that runs long", warning?.message.includes("#1") === true, warning?.message);
	check(
		"and the shortest channel it is measured against",
		warning?.message.includes("#0") === true && warning?.message.includes("768") === true,
		warning?.message,
	);
	check(
		// `#1` loses four of eight iterations of `[c e g e]`, and all four of those
		// notes still sound in the iterations that survive. Reporting them would
		// tell an author a note is dead while they can hear it playing, so a loop
		// that repeats too often must kill no written note at all.
		"losing loop iterations kills no written note",
		uneven.timeline.unreachable.length === 0,
		`${uneven.timeline.unreachable.length} reported`,
	);
	check(
		"but the channel is still reported, with a span to jump to",
		warning !== undefined && warning.span.end > warning.span.start,
		JSON.stringify(warning?.span),
	);

	// Straight-line music past the cutoff is where notes really do die.
	const tailSource = "#amk 4\n#0 @0 o4 l4 c d e f\n#1 @1 o4 l4 c d e f g a b > c\n";
	const tail = build(tailSource);
	const dead = tail.timeline.unreachable;
	const byAddress = new Map((tail.result.noteMap ?? []).map((e) => [e.address, e]));
	const text = (address: number) => {
		const span = byAddress.get(address)?.span;
		return span ? tailSource.slice(span.start, span.end) : "?";
	};

	check("notes written past the end are unreachable", dead.length === 4, `${dead.length}`);
	check(
		"every unreachable address is one the compiler mapped",
		dead.every((address) => byAddress.has(address)),
	);
	check(
		"none of them is a note that also sounds",
		dead.every((address) => !tail.timeline.notes.some((note) => note.address === address)),
	);
	check(
		"they are the four written past the cutoff",
		dead.map(text).sort().join(" ") === "a b c g",
		dead.map(text).join(" "),
	);

	// The roll must not also complain about it; it is not in `problems`, so the
	// same fact is not reported in two places with two different wordings.
	check("the walk keeps quiet about it", uneven.timeline.problems.length === 0, uneven.timeline.problems.join(" | "));

	// Channels of equal length, and a song with only one, have nothing to say.
	const even = build("#amk 4\n#0 @0 o4 l8 [c d e f g f e d]4\n#1 @1 o3 l4 [c e g e]4\n");
	check("even channels are not reported", unreachableChannels(even.timeline, even.result.noteMap ?? []).length === 0);
	check("and no note is unreachable", even.timeline.unreachable.length === 0);

	const alone = build("#amk 4\n#0 @0 o4 l8 c d e f\n");
	check(
		"a single-channel song is never over-long",
		unreachableChannels(alone.timeline, alone.result.noteMap ?? []).length === 0,
	);

	// Three long channels should read as a list rather than as three warnings.
	const many = build("#amk 4\n#0 @0 o4 l8 [c d]1\n#1 @1 o4 l8 [c d]4\n#2 @2 o4 l8 [c d]4\n#3 @3 o4 l8 [c d]4\n");
	const [multi] = unreachableChannels(many.timeline, many.result.noteMap ?? []);
	check(
		"several over-long channels are one diagnostic",
		unreachableChannels(many.timeline, many.result.noteMap ?? []).length === 1,
	);
	check(
		"listing all of them",
		["#1", "#2", "#3"].every((name) => multi?.message.includes(name)),
		multi?.message,
	);
}

/**
 * The running driver's ARAM a few ticks into the repeat, for the walk's account
 * of what a pass carries over to be checked against.
 */
const repeatPlayer = instantiate(new WebAssembly.Module(readFileSync(join(SPC_ASSETS, "player", "spc.wasm"))));
export function aramInRepeat(source: string): { aram: Uint8Array | null; timeline: SongTimeline } {
	const { result, timeline } = build(source);
	repeatPlayer.loadSpc(
		buildSpc({
			songData: result.data ?? new Uint8Array(0),
			driver,
			samples: (result.sampleList ?? []).map((name) => BY_NAME.get(name) ?? emptySample(name)),
			echoBufferSize: result.stats?.echoBufferSize,
			date: new Date(2026, 6, 28),
		}).spc,
	);

	const phase = createTickPhase();
	let seeded = false;
	let ticks = 0;
	for (let poll = 0; poll < 30 * TICK_POLL_HZ; poll++) {
		repeatPlayer.renderView(SPC_SAMPLE_RATE / TICK_POLL_HZ);
		const aram = repeatPlayer.aram();
		if (!seeded) {
			seedTickPhase(phase, aram);
			seeded = true;
			continue;
		}

		ticks += sawTick(phase, aram);
		if (ticks >= timeline.ticks + 8) {
			return { aram: aram.slice(), timeline };
		}
	}

	return { aram: null, timeline };
}
