/**
 * `tokentest`: letter commands and their arguments, the comma forms of `t`, `v`
 * and `w` as fades, and the fade arithmetic the inspector label and the clock
 * share.
 */

import "../localize";
import { commandAt, tokenize } from "@amk/tokens";
import { resolveCommand } from "@amk/tokens/commands/describe";
import {
	DEFAULT_TEMPO,
	driverTempo,
	driverTickSeconds,
	tempoFadeSeconds,
	tempoFadeSteps,
	tickSeconds,
} from "@amk/tokens/commands/units";
import { check, section } from "../harness";
import { at } from "./support";

section("letter commands carry their arguments");
{
	const tempo = at("#0 t144 c4\n", 4);
	check("t144 is the tempo command", tempo?.kind === "t", tempo?.kind);
	check("its name is spelled out", tempo?.name === "tempo");
	check("its argument is 144", tempo?.args[0].value === 144, String(tempo?.args[0].value));

	const pan = at("#0 y10,1,2\n", 4);
	check("y10,1,2 takes three arguments", pan?.args.length === 3, `got ${pan?.args.length}`);
	check("the last is 2", pan?.args[2].value === 2);

	const note = at("#0 c+8.\n", 4);
	check("an accidental belongs to the note", note?.kind === "c");
	check("a dotted length is one argument", note?.args.length === 1, `got ${note?.args.length}`);

	const exact = at("#0 c=48\n", 4);
	check("an exact tick count is the note's argument", exact?.args[0].value === 48);
}

section("a comma form of t, v or w is its hex fade, and reads as one");
{
	// parser.ts:parseFadeableValue and parseTempo compile `w30,200` to exactly
	// `$E1 $1E $C8`, so the panel and the hover have to say the same thing about
	// both. This pins the naming and the parameter rows together, so the two
	// cannot disagree: `w30,200` is "global volume" and its duration row must call
	// 0 ticks what `$E1 $00` calls it.
	const CONTEXT = { tempo: 120, samples: [] };
	const shapeOf = (body: string, needle: string) => {
		const source = `#amk 4\n#0 ${body}\n`;
		const command = commandAt(tokenize(source).commands, source.indexOf(needle));
		if (command === null) {
			return null;
		}

		const resolved = resolveCommand(command, CONTEXT);
		return {
			name: command.name,
			// The raw column is decimal for a letter and `$xx` for a VCMD by design,
			// so what is compared is the naming and the reading, not the spelling.
			rows: resolved.rows.map((row) => `${row.descriptor.name}: ${row.note ?? ""}`),
		};
	};

	for (const [letter, hex, name] of [
		["w0,200", "$E1 $00 $C8", "global volume fade"],
		["v0,200", "$E8 $00 $C8", "volume fade"],
		["t0,200", "$E3 $00 $C8", "tempo fade"],
	] as const) {
		const written = shapeOf(letter, letter.slice(0, 2));
		const compiled = shapeOf(hex, hex.slice(0, 3));
		check(`${letter} is named "${name}"`, written?.name === name, written?.name);
		check(`so is the ${hex.slice(0, 3)} it compiles to`, compiled?.name === name, compiled?.name);
		check(
			`and both read their arguments the same way`,
			JSON.stringify(written?.rows) === JSON.stringify(compiled?.rows),
			`${JSON.stringify(written?.rows)} vs ${JSON.stringify(compiled?.rows)}`,
		);
	}

	// One argument is the plain set, and must not borrow the fade's name.
	for (const [body, name] of [
		["w200", "global volume"],
		["v200", "volume"],
		["t200", "tempo"],
		// `y` has three arguments and no fade at all; `$DC` is pan fade, but nothing
		// spells it with a letter, so the fade names must not reach it.
		["y10,1,2", "pan"],
	] as const) {
		check(`${body} is still "${name}"`, at(`#0 ${body}\n`, 4)?.name === name, at(`#0 ${body}\n`, 4)?.name);
	}
}

section("a tempo fade is priced across the tempo it changes, not the one it leaves");
{
	// $E3 steps the tempo once per tick (main.asm:2461) and a tick's length is
	// what the tempo *is*, so the elapsed time is the sum of every step's own
	// tick. Multiplying the count by the starting tick — the one thing the command
	// exists to change — would read t255,254 from t144 as 0.90 s against the
	// driver's 0.67, or 2.42 against 1.02 from the driver's default.
	const naive = (ticks: number, tempo: number) => ticks * tickSeconds(tempo);

	// The continuum the walk approximates, derived independently of it: ticks
	// whose length runs linearly between two tempos take the count times their
	// *logarithmic* mean. Undefined for a fade that changes nothing, which is why
	// the flat case below is checked against `naive` instead.
	const integral = (ticks: number, from: number, to: number) =>
		((256 / 500) * ticks * Math.log((to + 1) / (from + 1))) / (to - from);

	const near = (got: number | null, want: number, within: number) =>
		got !== null && Math.abs(got - want) / want < within;

	const up = tempoFadeSeconds(255, 144, 254) ?? 0;
	const down = tempoFadeSeconds(255, 254, 144) ?? 0;
	check("t255,254 out of t144 takes 0.67 s", near(up, integral(255, 144, 254), 0.02), `${up.toFixed(4)} s`);
	check("which the tempo it leaves overstates by a third", naive(255, 144) / up > 1.3, `${naive(255, 144)} s`);
	check("the same fade run backwards takes as long", near(down, up, 0.02), `${down.toFixed(4)} s vs ${up.toFixed(4)}`);
	check("where the tempo it leaves understates it", naive(255, 254) / down < 0.8, `${naive(255, 254)} s`);

	// The driver's own default, t53, which is where the gap is widest.
	const slow = tempoFadeSeconds(255, 53, 254) ?? 0;
	check("out of the driver's default it is 1.02 s", near(slow, integral(255, 53, 254), 0.02), `${slow.toFixed(4)} s`);
	check("not the 2.42 s a starting-tempo reading gives", naive(255, 53) / slow > 2.3, `${naive(255, 53)} s`);

	// A fade to the tempo already in force has nothing to account for, and one
	// tick is over before the snap, so both come back to the plain reading.
	check(
		"a fade to the standing tempo is the plain reading",
		near(tempoFadeSeconds(96, 144, 144), naive(96, 144), 1e-12),
		String(tempoFadeSeconds(96, 144, 144)),
	);
	check("and a one-tick fade is one tick of it", tempoFadeSeconds(1, 144, 254) === naive(1, 144));

	// Commands.asm:330's carry-set adc makes $FF tempo 0, which stops the song.
	check("a fade to a stop has no duration to give", tempoFadeSeconds(96, 144, 255) === null);
	check("nor does one out of a stopped song", tempoFadeSeconds(96, 255, 144) === null);
	check("nor does a fade over no ticks at all", tempoFadeSeconds(0, 144, 254) === null);
}

section("the label and the transport's clock read one model of a fade");
{
	// `tempoFadeSeconds` is a sum over `tempoFadeSteps`, and the editor's clock
	// walks the same list a tick at a time to say where in a fade a given tick
	// falls. Two models would be two answers to "how long is this song", both
	// plausible, differing only in the middle of a fade where nobody looks.
	const steps = tempoFadeSteps(255, 144, 254) ?? [];

	check("a fade has one tempo per tick", steps.length === 255, String(steps.length));

	// The snap is on the tick *after* the last, so the run never reaches the
	// target. A list that ended on it would be one tick short over its length,
	// and every total would come out a shade low in a way no eye would catch.
	check("and the last of them is not the target it snaps to", steps[254] !== driverTempo(254), String(steps[254]));
	check("it starts one above the tempo it leaves", steps[0] === driverTempo(144), String(steps[0]));

	// The clock coalesces equal-tempo ticks into segments, which is only sound
	// because the run never doubles back.
	check(
		"the run is monotone",
		steps.every((tempo, n) => n === 0 || tempo >= steps[n - 1]),
	);

	// Exact equality, not `near`: the same additions in the same order.
	for (const [ticks, from, to] of [
		[255, 144, 254],
		[255, 254, 144],
		[255, DEFAULT_TEMPO, 254],
		[1, 144, 254],
		[96, 144, 144],
	] as const) {
		const summed = (tempoFadeSteps(ticks, from, to) ?? []).reduce((total, t) => total + driverTickSeconds(t), 0);
		check(`t${ticks},${to} out of t${from} sums to its label`, tempoFadeSeconds(ticks, from, to) === summed);
	}

	// The clock has to give up in exactly the places the label does, or a song
	// gets a length the inspector says it cannot have.
	for (const [ticks, from, to] of [
		[96, 144, 255],
		[96, 255, 144],
		[0, 144, 254],
	] as const) {
		check(
			`t${ticks},${to} out of t${from} is null on both`,
			tempoFadeSteps(ticks, from, to) === null && tempoFadeSeconds(ticks, from, to) === null,
		);
	}
}

section("$51 holds one more than the byte, and wraps");
{
	// Commands.asm:320/:330 enter with the carry set, and it is an 8-bit adc.
	// The plausible-but-wrong reading is 256 — "as fast as it goes" — where the
	// register really holds 0 and the song stops dead.
	check("t255 wraps the register to a stop", driverTempo(255) === 0);
	check("t254 is the fastest that still runs", driverTempo(254) === 255);

	// `tickSeconds` reads a byte for a label and adds the one without wrapping,
	// so `t255` gets a length rather than a division by zero. That is the only
	// place the two spellings part company, and this is what fixes it there.
	let apart = 0;
	for (let tempo = 0; tempo <= 255; tempo++) {
		if (driverTickSeconds(driverTempo(tempo)) !== tickSeconds(tempo)) {
			apart++;
		}
	}

	check("the byte and the register agree everywhere but 255", apart === 1, `${apart} disagreements`);
	check("where the label still gives a length", Number.isFinite(tickSeconds(255)));
}

section("a fade in a song with no tempo yet is read at the driver's default");
{
	// main.asm:177 puts #$36 into $51 before a song touches it, so "no tempo set"
	// is not "no tempo" — the fade is audible and has a length. Only the rows
	// named Over take the default; a $DD delay or a $DE one still says nothing,
	// because those are read against the note they ride on rather than the clock.
	const overNote = (body: string, needle: string) => {
		const source = `#amk 4\n#0 ${body}\n`;
		const command = commandAt(tokenize(source).commands, source.indexOf(needle));
		return command === null ? null : resolveCommand(command, { tempo: null, samples: [] }).rows[0]?.note;
	};

	// 96 ticks at t53 — the tempo the driver is already running at, not the 0x36
	// Music.cpp:207 assumes as a written byte, which would come to 0.89 s.
	const plain = 96 * tickSeconds(DEFAULT_TEMPO);
	check("t53 is what $51 already holds", DEFAULT_TEMPO === 53 && plain.toFixed(2) === "0.91", plain.toFixed(4));

	for (const [body, needle] of [
		["v96,200", "v96"],
		["w96,200", "w96"],
		["$E8 $60 $C8", "$E8"],
		["$DC $60 $14", "$DC"],
		["$F2 $60 $10 $10", "$F2"],
		["$EA $60", "$EA"],
	] as const) {
		const note = overNote(body, needle);
		check(`${body} gives its seconds anyway`, note?.endsWith("0.91 s at the default t53") === true, note ?? "no row");
	}

	// The tempo fade takes the default as the tempo it *leaves*, and walks from it:
	// 1.08 s, between the 1.82 those ticks take at t53 and the 0.68 they take at t144.
	const fade = overNote("t192,144", "t192");
	check("a tempo fade walks from the default", fade?.endsWith("1.08 s, the default t53 → t144") === true, fade ?? "");

	// Everything else keeps saying nothing, which is the honest answer for a
	// duration that is not a fade: it has no tempo to be read against.
	check("a $DD delay still gives no seconds", overNote("$DD $18 $18 $A4", "$DD") === "24 ticks · an eighth note");
	check("nor does a $DE one", overNote("$DE $18 $02 $10", "$DE") === "24 ticks · an eighth note");
}

section("a fade over 0 ticks is dropped, not applied");
{
	// Every fade counter is tested before it is decremented and branches past its
	// own block on a zero — main.asm:2461 for $E3, :2472 for $F2, :2490 for $E1,
	// :2785 and :2817 for $E8 and $DC, :3302 for $EA. The destination byte is read
	// only where the counter *reaches* zero (main.asm:2464 for $E3), so `t0,200`
	// stores a tempo the driver never looks at and the song carries on unchanged.
	const durationRow = (body: string, needle: string) => {
		const source = `#amk 4\n#0 ${body}\n`;
		const command = commandAt(tokenize(source).commands, source.indexOf(needle));
		return command === null ? null : resolveCommand(command, { tempo: 144, samples: [] }).rows[0];
	};

	const durationNote = (body: string, needle: string) => durationRow(body, needle)?.note;

	for (const [body, needle] of [
		["t0,200", "t0"],
		["$E3 $00 $C8", "$E3"],
		["v0,200", "v0"],
		["$E8 $00 $C8", "$E8"],
		["w0,200", "w0"],
		["$E1 $00 $C8", "$E1"],
		["$DC $00 $14", "$DC"],
		["$F2 $00 $10 $10", "$F2"],
		["$EA $00", "$EA"],
	] as const) {
		const note = durationNote(body, needle);
		check(`${body} says the fade is skipped`, note?.startsWith("no fade") === true, note ?? "no row");
		check(`and does not call it instant`, note?.includes("instant") === false, note ?? "no row");
	}

	check(
		"a duration of 1 still gets an ordinary reading",
		durationNote("t1,200", "t1")?.startsWith("1 tick") === true,
		durationNote("t1,200", "t1") ?? "no row",
	);

	// The control floors at 1 so a fade that never runs cannot be dragged into a
	// song, in both spellings — but a 0 already written still shows as itself,
	// which is the pair of checks above.
	for (const [body, needle] of [
		["t18,144", "t18"],
		["$E3 $12 $90", "$E3"],
	] as const) {
		check(`${body} cannot be dragged down to no fade at all`, durationRow(body, needle)?.min === 1);
	}

	check("and a 0 in the source still reads as the 0 it is", durationRow("t0,200", "t0")?.value === 0);
}
