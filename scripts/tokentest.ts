/**
 * The MML source scanner.
 *
 * Most of what this checks is ordinary — that `$F5` gathers eight arguments,
 * that `("kick.brr", $02)` does not mistake its tuning byte for a command. The
 * one that earns its place is restartability: scanning line by line with the
 * state carried across must give exactly what scanning the whole document
 * gives. CodeMirror restarts the scanner at arbitrary lines, so a state machine
 * that quietly depends on having seen the start of the file works perfectly
 * here and mis-colours text there, months later, for no visible reason.
 *
 *   npm run tokentest
 */

import { Tag, tags } from "@lezer/highlight";

import {
	type ScanState,
	type Token,
	commandAt,
	commandStartingAt,
	copyState,
	LETTER_NAMES,
	startState,
	step,
	tokenize,
	TOKEN_TAGS,
	VCMD_NAMES,
} from "@amk/tokens";
import { type CommandScope, commandScope, parseTimeInForce } from "@amk/tokens/commands/in-force";

import { velocityTableAt } from "@amk/tokens/dialect";
import { resolveCommand } from "@amk/tokens/commands/describe";
import {
	DEFAULT_TEMPO,
	driverTempo,
	driverTickSeconds,
	tempoFadeSeconds,
	tempoFadeSteps,
	tickSeconds,
} from "@amk/tokens/commands/units";

import { check, summarise } from "./harness";

const at = (text: string, offset: number) => commandAt(tokenize(text).commands, offset);

/**
 * The token containing `offset`, notes included.
 *
 * Lives here because only these checks ask the question. The app maps a
 * position to a whole *command* through {@link commandAt} — that is what the
 * inspector and the hover show — and nothing in it needs a single token back
 * out of the list. Most of what follows is phrased as "what did the scanner
 * call this character", though, so the harness needs the lookup even when the
 * package does not.
 *
 * Half-open, unlike {@link commandAt}, which is end-inclusive so a caret parked
 * after the last argument still inspects the command it just finished. Here the
 * boundary belongs to exactly one token, which the pair of checks either side of
 * a note's end pins.
 */
function tokenAt(tokens: Token[], offset: number): Token | null {
	let low = 0;
	let high = tokens.length - 1;
	while (low <= high) {
		const mid = (low + high) >> 1;
		const token = tokens[mid];
		if (offset < token.start) {
			high = mid - 1;
		} else if (offset >= token.end) {
			low = mid + 1;
		} else {
			return token;
		}
	}

	return null;
}

console.log("\nhex commands gather their arguments");
{
	const source = "#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00 c4\n";
	const { commands } = tokenize(source);
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("$F5 is found", fir !== undefined);
	check("$F5 takes eight arguments", fir?.args.length === 8, `got ${fir?.args.length}`);
	check("$F5 is named", fir?.name === "FIR filter", fir?.name);
	check("$F5 is complete", fir?.complete === true);
	check("first coefficient is 0x7F", fir?.args[0].value === 0x7f);
	check(
		"the span covers command through last argument",
		source.slice(fir!.span.start, fir!.span.end) === "$F5 $7F $00 $00 $00 $00 $00 $00 $00",
		source.slice(fir!.span.start, fir!.span.end),
	);
	check(
		"the note after it is not swallowed",
		commands.some((c) => c.kind === "c"),
	);
}

console.log("\nan incomplete hex command is reported as incomplete");
{
	const { commands } = tokenize("#0 $F5 $7F $00\n");
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("two of eight arguments", fir?.args.length === 2);
	check("not complete", fir?.complete === false);
}

console.log("\nhex arguments are counted, not guessed");
{
	const { commands } = tokenize("#0 $E7 $10 $E7 $20\n");
	const volumes = commands.filter((c) => c.vcmd === 0xe7);
	check("two separate $E7 commands", volumes.length === 2, `got ${volumes.length}`);
	check(
		"each took one argument",
		volumes.every((c) => c.args.length === 1),
	);
}

console.log("\na byte outside $DA-$FE opens no command");
{
	// The tuning byte of a sample load is not a VCMD, and treating it as one
	// would eat the tokens after it as arguments.
	const { commands } = tokenize('#0 ("kick.brr", $02) c4\n');
	check("no command claims $02", !commands.some((c) => c.vcmd === 0x02));
	check(
		"the note still parses",
		commands.some((c) => c.kind === "c"),
	);
}

console.log("\n$FB takes its length from its first argument");
{
	// `parseHexCommand`'s `$FB` branch — the count byte is itself an argument, and `count + 1`
	// more follow it, so `$FB $02` wants four arguments in total.
	const short = tokenize("#0 $FB $02 $01 $02 $03\n").commands.find((c) => c.vcmd === 0xfb);
	check("count 2 means four arguments", short?.args.length === 4, `got ${short?.args.length}`);
	check("short form is complete", short?.complete === true);

	const truncated = tokenize("#0 $FB $02 $01 $02\n").commands.find((c) => c.vcmd === 0xfb);
	check("one argument short is incomplete", truncated?.complete === false);

	const long = tokenize("#0 $FB $80 $01 $02\n").commands.find((c) => c.vcmd === 0xfb);
	check("a high count means the three-argument form", long?.complete === true);
}

console.log("\na bar line abandons a half-written command");
{
	// parser.ts's dispatch loop resets hexLeft on `|`, so the bytes after one are fresh.
	const { commands } = tokenize("#0 $F5 $7F | $E7 $10\n");
	const volume = commands.find((c) => c.vcmd === 0xe7);
	check("$E7 after the bar is its own command", volume !== undefined);
	check("and took its argument", volume?.args.length === 1);

	// parser.ts's dispatch loop reports a stray character mid-command but still dispatches
	// it, so the note here is a note rather than being swallowed as an argument.
	const stray = tokenize("#0 $F5 $7F c4\n");
	check(
		"a note inside an unfinished command is still a note",
		stray.tokens.some((t) => t.kind === "note"),
	);
}

console.log("\nletter commands carry their arguments");
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

console.log("\na comma form of t, v or w is its hex fade, and reads as one");
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

console.log("\na tempo fade is priced across the tempo it changes, not the one it leaves");
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

console.log("\nthe label and the transport's clock read one model of a fade");
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

console.log("\n$51 holds one more than the byte, and wraps");
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

console.log("\na fade in a song with no tempo yet is read at the driver's default");
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

console.log("\na fade over 0 ticks is dropped, not applied");
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

/** The length of the note or rest written at `needle` — `undefined` for anything else. */
const lengthOf = (source: string, needle: string) => at(source, source.indexOf(needle))?.noteLength;

console.log("\nnotes and rests resolve their length");
{
	// getNoteLength (parser.ts), over the 192 ticks of a whole note. The
	// tooltip states the tick count outright, so a wrong fork here is a wrong
	// number on screen rather than a wrong colour.
	const plain = lengthOf("#0 c4\n", "c4");
	check("c4 is one segment", plain?.length === 1, `got ${plain?.length}`);
	check("of 48 ticks", plain?.[0].ticks === 48, String(plain?.[0].ticks));
	check("written as the denominator it was", plain?.[0].written === "4", plain?.[0].written);
	check("with no dots, no =, and nothing implied", plain?.[0].dots === 0 && !plain[0].exact && !plain[0].implicit);

	// parser.ts's `defaultNoteLength` — what the parser starts at, before any `l`.
	const bare = lengthOf("#0 c\n", "c");
	check("a bare c takes the standing default", bare?.[0].ticks === 24, String(bare?.[0].ticks));
	check("and says the length was implied", bare?.[0].implicit === true && bare[0].written === "");

	check("c8. is dotted", lengthOf("#0 c8.\n", "c8")?.[0].ticks === 36, String(lengthOf("#0 c8.\n", "c8")?.[0].ticks));
	check("c8.. doubles down", lengthOf("#0 c8..\n", "c8")?.[0].dots === 2);
	check("to 42 ticks", lengthOf("#0 c8..\n", "c8")?.[0].ticks === 42, String(lengthOf("#0 c8..\n", "c8")?.[0].ticks));

	const exact = lengthOf("#0 c=48\n", "c=48");
	check("c=48 is 48 ticks exactly", exact?.[0].ticks === 48 && exact[0].exact === true);
	check("c=48. dots an exact count under #amk 4", lengthOf("#0 c=48.\n", "c=48")?.[0].ticks === 72);

	check("a rest carries a length too", lengthOf("#0 r2\n", "r2")?.[0].ticks === 96);
	check("an accidental does not disturb it", lengthOf("#0 c+4\n", "c+4")?.[0].ticks === 48);
	// getNoteLength — outside 1..192 the written length is discarded entirely.
	check("c200 falls back to the default length", lengthOf("#0 c200\n", "c200")?.[0].ticks === 24);
	check("a command that is not a note carries none", at("#0 t144\n", 4)?.noteLength === undefined);
}

console.log("\na tie plays as one note");
{
	// accumulateTiedLength (parser.ts) — every segment after a `^` belongs
	// to the note that opened the run, which is why the tooltip totals them
	// rather than describing the `^` on its own.
	const source = "#0 c4^8\n";
	const tied = lengthOf(source, "c4");
	check("c4^8 has two segments", tied?.length === 2, `got ${tied?.length}`);
	check("48 then 24", tied?.[0].ticks === 48 && tied[1].ticks === 24);
	check(
		"and one span over both",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end) === "c4^8",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end),
	);
	check("so the caret on the ^ finds the note", at(source, source.indexOf("^"))?.noteLength?.length === 2);

	const open = lengthOf("#0 c4^\n", "c4");
	check("a ^ with no digits continues at the default", open?.[1].ticks === 24 && open[1].implicit === true);

	const three = lengthOf("#0 c4^8^16\n", "c4");
	check("ties accumulate without limit", three?.length === 3, `got ${three?.length}`);
	check("48 + 24 + 12", three?.map((s) => s.ticks).join() === "48,24,12", three?.map((s) => s.ticks).join());

	check("spacing does not break the run", lengthOf("#0 c4 ^ 8\n", "c4")?.length === 2);
	check("a rest ties too", lengthOf("#0 r4^8\n", "r4")?.length === 2);

	// The note after a tie is a fresh command, and the segment the `^` opened
	// took the default rather than reaching forward for the `8`.
	const next = tokenize("#0 c4^d8\n").commands.filter((c) => c.noteLength);
	check("a note after a tie is its own command", next.length === 2 && next[1].kind === "d");
	check("and the tie's segment is implied, not the d's length", next[0].noteLength?.[1].implicit === true);
}

console.log("\nthe default length follows `l`");
{
	// parseDefaultLength (parser.ts). One field on the parser, never
	// reset — so it is one running value here, not one per channel.
	check("l16 makes a bare note 12 ticks", lengthOf("#0 l16 c\n", "c")?.[0].ticks === 12);
	check("l8. dots the default", lengthOf("#0 l8. c\n", "c")?.[0].ticks === 36);
	check("l=48 sets it exactly", lengthOf("#0 l=48 c\n", "c")?.[0].ticks === 48);
	check("l=48. dots that", lengthOf("#0 l=48. c\n", "c")?.[0].ticks === 72);

	// AMK0071 and AMK0070 are errors, and an error leaves the old length standing.
	check("l0 is an error, so the previous length stands", lengthOf("#0 l16 l0 c\n", "c")?.[0].ticks === 12);
	check("l200 likewise", lengthOf("#0 l16 l200 c\n", "c")?.[0].ticks === 12);

	check("the length crosses lines and channels", lengthOf("#0 l16\n#1 c\n", "c")?.[0].ticks === 12);
	check("and a written length still wins over it", lengthOf("#0 l16 c4\n", "c4")?.[0].ticks === 48);
	check("the l command itself carries no note length", at("#0 l16\n", 3)?.noteLength === undefined);
}

console.log("\ndots and exact lengths fork by dialect");
{
	// Music.cpp:2960 — Addmusic 4.05 stops after the second dot.
	const am4 = lengthOf("#am4\n#0 c8...\n", "c8");
	check("#am4 stops adding after two dots", am4?.[0].ticks === 42, String(am4?.[0].ticks));
	check("and counts only the dots it applied", am4?.[0].dots === 2, String(am4?.[0].dots));
	check("#amk 4 applies every one", lengthOf("#0 c8...\n", "c8")?.[0].ticks === 45);

	// getNoteLength's `=` arm — exact counts predate dots, so below #amk 4 the dot is not
	// theirs to take.
	check("under #am4 an exact count takes no dots", lengthOf("#am4\n#0 c=48.\n", "c=48")?.[0].ticks === 48);
	check("under #amk 4 it does", lengthOf("#0 c=48.\n", "c=48")?.[0].ticks === 72);

	// parseDefaultLength — `l`'s dots and its `=` form are both #amk 4 and
	// above, and neither is the same fork a note takes.
	check("under #am4, l ignores its dots", lengthOf("#am4\n#0 l8. c\n", "c")?.[0].ticks === 24);
	check("under #amk 1 too", lengthOf("#amk 1\n#0 l8. c\n", "c")?.[0].ticks === 24);
	check(
		"while l= is an error there, leaving the length standing",
		lengthOf("#am4\n#0 l16 l=48 c\n", "c")?.[0].ticks === 12,
	);
	check("and a note's own = still works", lengthOf("#am4\n#0 c=48\n", "c=48")?.[0].ticks === 48);
}

console.log("\na lone dot still lengthens the note before it");
{
	// `l8 c.` is ordinary MML: getInt finds no digits and getNoteLengthModifier
	// dots the standing default anyway (getNoteLength). A lone `.` scans as
	// unknown — `step` reads one character with no memory of the token before it
	// — so `gather` is where it rejoins the note.
	const dotted = lengthOf("#0 c.\n", "c.");
	check("c. is the dotted default", dotted?.[0].ticks === 36, String(dotted?.[0].ticks));
	check("implied, and dotted once", dotted?.[0].implicit === true && dotted[0].dots === 1);
	check("c.. doubles down", lengthOf("#0 c..\n", "c.")?.[0].ticks === 42);
	check("it follows the standing length", lengthOf("#0 l4 c.\n", "c.")?.[0].ticks === 72);
	check("a rest takes one too", lengthOf("#0 r.\n", "r.")?.[0].ticks === 36);

	const tie = lengthOf("#0 c4^.\n", "c4");
	check("a tie's segment can be dotted alone", tie?.[1].ticks === 36, String(tie?.[1].ticks));

	const source = "#0 c.\n";
	check(
		"the span covers the dot",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end) === "c.",
		source.slice(at(source, 3)!.span.start, at(source, 3)!.span.end),
	);
}

console.log("\na triplet scales the notes inside it");
{
	// getNoteLengthModifier's second half (parser.ts): two thirds,
	// rounded half up, applied after the dots. A reader hovering a note wants
	// the length it plays at, so the brace state is followed here even though
	// the per-line colouring pass cannot carry it.
	const triplet = tokenize("#0 {c4 c4 c4}\n").commands.filter((c) => c.noteLength);
	check(
		"each note of {c4 c4 c4} plays 32 ticks",
		triplet.length === 3 && triplet.every((c) => c.noteLength?.[0].ticks === 32),
		triplet.map((c) => c.noteLength?.[0].ticks).join(),
	);
	check("and says so", triplet[0]?.noteLength?.[0].triplet === true);
	check("while the written denominator is untouched", triplet[0]?.noteLength?.[0].written === "4");

	const around = tokenize("#0 c4 {c4} c4\n").commands.filter((c) => c.noteLength);
	check(
		"the brace opens and closes",
		around.map((c) => c.noteLength?.[0].ticks).join() === "48,32,48",
		around.map((c) => c.noteLength?.[0].ticks).join(),
	);
	check("and only the middle one is flagged", around[2]?.noteLength?.[0].triplet === false);

	check("the default length is scaled too", lengthOf("#0 l4 {c}\n", "c}")?.[0].ticks === 32);
	check("dots go first, the triplet after", lengthOf("#0 {c4.}\n", "c4.")?.[0].ticks === 48);
	check(
		"a tie scales segment by segment",
		lengthOf("#0 {c4^8}\n", "c4")
			?.map((s) => s.ticks)
			.join() === "32,16",
	);
	check("a rest is a note here as anywhere", lengthOf("#0 {r4}\n", "r4")?.[0].ticks === 32);

	// floor(x * 2/3 + 0.5), so 7 ticks is 5 rather than 4.
	check("the two thirds round half up", lengthOf("#0 {c=7}\n", "c=7")?.[0].ticks === 5);

	// parseDefaultLength is the one call that passes allowTriplet: false, so an `l`
	// inside a triplet sets the plain length and the notes scale it themselves.
	check("l is not scaled", lengthOf("#0 {l4}c\n", "c\n")?.[0].ticks === 48);

	// The early return in getNoteLength's `=` arm is ahead of both modifiers.
	const old = lengthOf("#am4\n#0 {c=48}\n", "c=48");
	check("an exact count below #amk 4 escapes it", old?.[0].ticks === 48 && old[0].triplet === false);

	check("the state crosses lines", lengthOf("#0 {\nc4\n", "c4")?.[0].ticks === 32);
	check("and channels, as the parser's own flag does", lengthOf("#0 {\n#1 c4\n", "c4")?.[0].ticks === 32);

	// AMK0097 reports the second `{` and leaves the one block open, so the
	// first `}` closes it (parseTripletOpen and parseTripletClose).
	const nested = tokenize("#0 {{c4}c4\n").commands.filter((c) => c.noteLength);
	check(
		"a nested brace does not need two to close",
		nested.map((c) => c.noteLength?.[0].ticks).join() === "32,48",
		nested.map((c) => c.noteLength?.[0].ticks).join(),
	);
	check("and an unopened } leaves the note alone", lengthOf("#0 }c4\n", "c4")?.[0].ticks === 48);

	// #spc, #samples and #instruments are read by parseBlock, whose readers eat
	// their brace before parseTripletOpen could see it (parseSampleDefinitions,
	// parseInstrumentDefinitions and parseSpcInfo).
	const block = '#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n}\n#0 c4\n';
	check("a block directive's brace is not a triplet", lengthOf(block, "c4")?.[0].ticks === 48);
	check("nor #samples'", lengthOf('#samples\n{\n\t"kick.brr"\n}\n#0 c4\n', "c4")?.[0].ticks === 48);
	// The case that makes the distinction worth drawing: half-typed, the block
	// never closes, and a plain toggle would two-thirds the rest of the song.
	check("an unclosed one does not either", lengthOf('#samples\n{\n\t"kick.brr"\n#0 c4\n', "c4")?.[0].ticks === 48);
	check("and a real triplet after one still works", lengthOf(`${block}#0 {c4}\n`, "c4}")?.[0].ticks === 32);
}

console.log("\ncomments and strings");
{
	const { tokens } = tokenize("; a comment with $F5 in it\n#0 c4\n");
	check("the comment is one token", tokens[0].kind === "comment");
	check("the $F5 inside it is not a command", !tokenize("; $F5 $00\n").commands.length);

	const strung = tokenize('"a=b"\n#0 c4\n');
	check("a replacement directive reads as a string", strung.tokens[0].kind === "string");

	// An unterminated string is the state that must survive a line break.
	const open = tokenize('"unterminated\nstill inside"\n#0 c4\n');
	check("an unterminated string keeps running", open.tokens[0].kind === "string");
	check(
		"and the channel after it recovers",
		open.tokens.some((t) => t.kind === "channel"),
	);
}

console.log("\ndirectives and channels are told apart");
{
	const { tokens } = tokenize("#amk 4\n#samples\n#0 c4\n");
	check("#amk is a directive", tokens[0].kind === "directive");
	check("#samples is a directive", tokens.filter((t) => t.kind === "directive").length === 2);
	check(
		"#0 is a channel",
		tokens.some((t) => t.kind === "channel"),
	);
}

console.log("\ncommands carry the channel they were written under");
{
	// Source order is execution order within one channel and meaningless across
	// them, so anything reasoning about "runs after" needs this.
	const { commands } = tokenize("#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00\n#3 $F1 $05 $60 $00\n");
	const fir = commands.find((c) => c.vcmd === 0xf5);
	const echo = commands.find((c) => c.vcmd === 0xf1);
	check("the $F5 is in channel 0", fir?.channel === 0, String(fir?.channel));
	check("the $F1 is in channel 3", echo?.channel === 3, String(echo?.channel));

	// Above the first marker a command is on the channel the compiler starts
	// on, which `parser.ts:detectStartingChannel` (Music.cpp:385-400) takes as
	// the lowest `#N` found anywhere in the text — the first it *finds*, probing
	// `#0` up through `#7`, not the first the song declares — and 0 without one.
	const before = tokenize("$F5 $7F $00 $00 $00 $00 $00 $00 $00\n").commands[0];
	check("a command before any channel is on channel 0 when the song has none", before?.channel === 0);
	const lowest = tokenize("$ED $7F $E0\n#3 c8\n#0 c8\n").commands[0];
	check("and on the lowest channel the song declares, not the first", lowest?.channel === 0, String(lowest?.channel));
	const three = tokenize("$ED $7F $E0\n#3 c8\n#5 c8\n").commands[0];
	check("which is #3 in a song without #0", three?.channel === 3, String(three?.channel));
	// The probe is a substring search, so `#08` reads as `#0` there — and then
	// fails as a directive (AMK0031) and leaves the channel where it was.
	const substring = tokenize("$ED $7F $E0\n#08 c8\n#3 c8\n").commands;
	check('#08 makes the starting channel 0, as text.find("#0") does', substring[0]?.channel === 0);
	check(
		"and does not switch to channel 8, which the compiler rejects",
		substring.find((c) => c.noteLength !== undefined)?.channel === 0,
	);

	// A channel directive mid-line still applies to what follows it.
	const mixed = tokenize("#0 t100 #1 t200\n").commands.filter((c) => c.kind === "t");
	check("two tempo commands", mixed.length === 2);
	check("the first is channel 0", mixed[0]?.channel === 0);
	check("the second is channel 1", mixed[1]?.channel === 1, String(mixed[1]?.channel));

	// The channel persists across lines, since it is a mode not a prefix.
	const across = tokenize("#2\nt100\n$E7 $10\n").commands;
	check(
		"everything after #2 is channel 2",
		across.every((c) => c.channel === 2),
	);
}

console.log("\nlookup");
{
	const source = "#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00\n";
	const { commands } = tokenize(source);
	const start = source.indexOf("$F5");
	const end = source.indexOf("\n", start);

	check("the caret on the command byte finds it", commandAt(commands, start)?.vcmd === 0xf5);
	check("the caret mid-argument finds it", commandAt(commands, start + 10)?.vcmd === 0xf5);
	check("the caret just past the last argument still finds it", commandAt(commands, end)?.vcmd === 0xf5);
	check("the caret before the channel finds nothing", commandAt(commands, 0) === null);

	// tokenAt is half-open, so the boundary belongs to exactly one token.
	const noteSource = "#0 c4\n";
	const note = tokenize(noteSource);
	const noteAt = noteSource.indexOf("c");
	check("tokenAt lands inside the note", tokenAt(note.tokens, noteAt)?.kind === "note");
	check("tokenAt at the note's end is the next token", tokenAt(note.tokens, noteAt + 1)?.kind === "number");
}

console.log("\nevery kind has a highlight tag");
{
	const { tokens } = tokenize(
		'#amk 4\n"a=b"\n#0 t144 o4 l8 v200 w150 y10 q7F h2 @1 p1 n5 [c+4 ^ r8]3 *2 (1) < > | & / ? {c} $F5 $7F $00 $00 $00 $00 $00 $00 $00 ; end\n',
	);
	const kinds = new Set(tokens.map((t) => t.kind));
	const missing = [...kinds].filter((k) => !TOKEN_TAGS[k]);
	check("no token kind lacks a tag", missing.length === 0, missing.join(", "));
	check("the sample exercised a good spread", kinds.size >= 15, `${kinds.size} kinds`);
	check("nothing came out as unknown", !kinds.has("unknown"), [...kinds].join(", "));

	// Kept separate so the dense line above stays exactly as it is; it is
	// load-bearing for the three checks that precede this.
	const used = tokenize('"x=$EF $2b $2d $2d"\n#0 x\n').tokens;
	check(
		"a replacement token has a tag too",
		used.some((t) => t.kind === "replacement" && TOKEN_TAGS[t.kind] !== undefined),
	);
}

console.log("\nevery tag name resolves against @lezer/highlight");
{
	// The editor builds its tokenTable by looking TOKEN_TAGS values up on
	// `tags`. A name that misses — or that lands on one of the helper
	// *functions* that object also carries — would drop the highlight silently,
	// so this pins the name-resolution contract the adapter relies on.
	const names = [...new Set(Object.values(TOKEN_TAGS))];
	const unresolved = names.filter((name) => !((tags as unknown as Record<string, unknown>)[name] instanceof Tag));
	check("every TOKEN_TAGS value is a real Tag", unresolved.length === 0, unresolved.join(", "));
}

console.log("\nreplacements are expanded at the use site");
{
	// The report this came from, verbatim.
	const source = '"echo1=$EF"\n"echo2=$F1"\n\n#0 echo1 $2b $2d $2d\necho2 $05 $3c $00\n';
	const { tokens, commands } = tokenize(source);
	const use = source.indexOf("echo1", 20);

	check("the use site is one replacement token", tokenAt(tokens, use + 2)?.kind === "replacement");
	check("and not a note", tokenAt(tokens, use)?.kind !== "note");

	const echo = commandAt(commands, use + 1);
	check("the caret inside it inspects $EF", echo?.vcmd === 0xef, `got ${echo?.vcmd?.toString(16)}`);
	check("which knows it came through echo1", echo?.replacement === "echo1", echo?.replacement);
	check("the arguments written after it are its own", echo?.args.length === 3, `got ${echo?.args.length}`);
	check("the first is $2B", echo?.args[0].value === 0x2b);
	check("so it is complete", echo?.complete === true);
	check("its name is spelled out", echo?.name !== undefined && echo.name.length > 0, echo?.name);
	check(
		"the span runs from the macro to the last argument",
		source.slice(echo!.span.start, echo!.span.end) === "echo1 $2b $2d $2d",
		source.slice(echo!.span.start, echo!.span.end),
	);

	const second = commands.find((c) => c.vcmd === 0xf1);
	check("the second macro resolves too", second?.replacement === "echo2");
	check("and takes its three arguments", second?.args.length === 3, `got ${second?.args.length}`);
	check("the channel still carries across lines", second?.channel === 0, String(second?.channel));

	check(
		"the public token list stays ordered and non-overlapping",
		tokens.every((t, i) => i === 0 || t.start >= tokens[i - 1].end),
	);
}

console.log("\na definition only applies below itself");
{
	// `doReplacement` runs at the cursor and never behind it (parser.ts), so
	// there is no hoisting. A whole-document pre-pass would fail this.
	const { commands } = tokenize('echo1 $2b\n"echo1=$EF"\n#0 echo1 $2b $2d $2d\n');
	check("exactly one $EF", commands.filter((c) => c.vcmd === 0xef).length === 1);
}

console.log("\nlongest match wins, and there is no word boundary");
{
	const { commands } = tokenize('"e=$E7 $10"\n"ee=$EF $2b $2d $2d"\n#0 ee\n');
	check(
		"the longer definition wins",
		commands.some((c) => c.vcmd === 0xef),
	);
	check("the shorter one does not fire inside it", !commands.some((c) => c.vcmd === 0xe7));

	// doReplacement matches with a bare `startsWith`. `"c=…"` really does eat every note c.
	// It looks like a bug in this scanner and is not one.
	const shadowed = tokenize('"c=$E7 $10"\n#0 c4\n');
	check(
		"a definition can shadow a note letter",
		shadowed.commands.some((c) => c.vcmd === 0xe7),
	);
	check("leaving no note behind", !shadowed.tokens.some((t) => t.kind === "note"));
}

console.log("\na replacement can carry a whole run of commands");
{
	const source = '"x=$EF $2b $2d $2d c4"\n#0 x\n';
	const { commands } = tokenize(source);
	const use = source.indexOf("x", source.indexOf("#0"));

	check("both commands are found", commands.length === 2, `got ${commands.length}`);
	check("they share the one-character use site", commands[0].span.start === commands[1].span.start);
	check(
		"both know where they came from",
		commands.every((c) => c.replacement === "x"),
	);
	check("the caret resolves to the first, not whichever the search landed on", commandAt(commands, use)?.vcmd === 0xef);
}

console.log("\na replacement can supply arguments, or take them");
{
	const supplies = tokenize('"lo=$2b"\n#0 $EF lo $2d $2d\n').commands.find((c) => c.vcmd === 0xef);
	check(
		"a macro standing in for an argument counts as one",
		supplies?.args.length === 3,
		`got ${supplies?.args.length}`,
	);
	check("with its value read from the expansion", supplies?.args[0].value === 0x2b);
	check("and the command is marked", supplies?.replacement === "lo");

	const source = '"ef=$EF $2b"\n#0 ef $2d $2d\n';
	const straddles = tokenize(source).commands.find((c) => c.vcmd === 0xef);
	check("a command straddling the boundary is complete", straddles?.complete === true);
	check(
		"and its span is contiguous from the macro to the last real argument",
		source.slice(straddles!.span.start, straddles!.span.end) === "ef $2d $2d",
		source.slice(straddles!.span.start, straddles!.span.end),
	);
}

console.log("\na command knows which of its parts came through a macro");
{
	// The whole point of carrying provenance per part rather than per command:
	// `replacement` alone cannot tell "the bytes are not in the document" from
	// "the command byte is a macro and every argument is literal text", and only
	// the second of those can be rewritten in place. `@amk/tokens`'s `edits.ts` asks
	// this question; here is where the answer is pinned.
	const head = tokenize('"ech=$EF"\n#0 ech $80 $10 $10\n').commands.find((c) => c.vcmd === 0xef);
	check("the aggregate still fires", head?.replacement === "ech");
	check("the command byte names the macro", head?.headReplacement === "ech");
	check("and every argument is literal", head?.args.every((a) => a.replacement === undefined) === true);

	const arg = tokenize('"lo=$2b"\n#0 $EF lo $2d $2d\n').commands.find((c) => c.vcmd === 0xef);
	check("a macro standing in for one argument marks only that one", arg?.args[0].replacement === "lo");
	check("leaving the others literal", arg?.args.slice(1).every((a) => a.replacement === undefined) === true);
	check("and the command byte untouched", arg?.headReplacement === undefined);

	const whole = tokenize('"x=$EF $2b $2d $2d"\n#0 x\n').commands.find((c) => c.vcmd === 0xef);
	check(
		"a macro carrying the whole command marks every part",
		whole?.headReplacement === "x" && whole.args.every((a) => a.replacement === "x"),
	);

	// `head` is what lets an editor append a missing argument rather than only
	// overwrite the ones that are there, so it must stop at the command itself.
	const source = "#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00\n@@19\n";
	const { commands } = tokenize(source);
	const fir = commands.find((c) => c.vcmd === 0xf5);
	check("head covers the command byte alone", source.slice(fir!.head.start, fir!.head.end) === "$F5");
	const direct = commands.find((c) => c.direct === true);
	check("and the whole of the direct form's @@", source.slice(direct!.head.start, direct!.head.end) === "@@");
}

console.log("\nreplacements are transitive");
{
	// doReplacement re-runs the match on the text it just spliced in.
	const { commands } = tokenize('"a1=a2 $2d"\n"a2=$EF $2b"\n#0 a1 $2d\n');
	const echo = commands.find((c) => c.vcmd === 0xef);
	check("a macro naming another resolves through it", echo !== undefined);
	check("gathering arguments from both sides", echo?.args.length === 3, `got ${echo?.args.length}`);
	check("and is complete", echo?.complete === true);
}

console.log("\na recursive replacement cannot hang the editor");
{
	// The guard here is an active set plus a character budget rather than AMK's
	// 500 iterations, because expansion is a tree: `"g=g g"` doubles at every
	// level and would defeat any depth-only cap.
	const sources = ['"zz=zz $00"\n#0 zz\n', '"p1=p2"\n"p2=p1"\n#0 p1\n', '"g=g g"\n#0 g\n'];
	const started = Date.now();
	for (const [index, source] of sources.entries()) {
		const { tokens } = tokenize(source);
		check(`source ${index + 1} terminates`, tokens.length > 0);
		check(
			`source ${index + 1} still advances every token`,
			tokens.every((t) => t.end > t.start),
		);
	}

	const elapsed = Date.now() - started;
	// Crude, but an exponential regression is not a near miss.
	check("all three finish promptly", elapsed < 500, `took ${elapsed} ms`);
}

console.log("\na sample load is not a replacement definition");
{
	// parseOpenParen hands `("` to parseSampleLoad, which reads the name itself,
	// so that quote never reaches the directive arm.
	const loaded = tokenize('#0 ("kick=x.brr", $02) c4\n');
	check("no macro is defined by a sample name", !loaded.tokens.some((t) => t.kind === "replacement"));
	check(
		"and the note after it still parses",
		loaded.commands.some((c) => c.kind === "c"),
	);

	const inside = tokenize('"a=b"\n#0 ("a=b.brr", $02)\n');
	check("nor is one expanded inside one", !inside.tokens.some((t) => t.kind === "replacement"));
	check(
		"the name survives as a single string",
		inside.tokens.some((t) => t.kind === "string" && t.line === 2),
	);
}

console.log("\nreplacement edge cases");
{
	// An empty value expands to nothing, but `find` is non-empty so the scanner
	// still advances over it.
	const empty = tokenize('"x="\n#0 x c4\n');
	check(
		"an empty expansion still advances",
		empty.tokens.every((t) => t.end > t.start),
	);
	check(
		"and the music after it is untouched",
		empty.commands.some((c) => c.kind === "c"),
	);

	// preprocess.ts strips comments before the parser ever sees them.
	check(
		"a definition inside a comment defines nothing",
		!tokenize('; "a=$EF"\n#0 a\n').commands.some((c) => c.vcmd === 0xef),
	);

	// A body with no `=` is AMK0021 in the compiler and simply defines nothing here.
	check(
		"a body with no equals defines nothing",
		!tokenize('"nope"\n#0 nope\n').tokens.some((t) => t.kind === "replacement"),
	);

	// Nothing is carried between calls; the table lives in ScanState.
	tokenize('"leak=$EF"\n#0 leak $2b $2d $2d\n');
	check("no definition leaks into the next scan", !tokenize("#0 leak\n").commands.some((c) => c.vcmd === 0xef));
}

console.log("\nq and n read their arguments as hex");
{
	// parseQuantization and parseNoise both use getHex. Reading either as decimal is
	// wrong twice over: the value, and the `F` that would become a note.
	const q = tokenize("#0 q7F\n").commands.find((c) => c.kind === "q");
	check("q7F is $7F, not 7", q?.args[0]?.value === 0x7f, `got ${q?.args[0]?.value}`);
	const n = tokenize("#0 n1F\n").commands.find((c) => c.kind === "n");
	check("n1F is $1F, not 1", n?.args[0]?.value === 0x1f, `got ${n?.args[0]?.value}`);
	check("and the F is not a note", !tokenize("#0 n1F\n").tokens.some((t) => t.kind === "note"));
	check("nA-nF scan at all", tokenize("#0 nA\n").commands.find((c) => c.kind === "n")?.args[0]?.value === 0xa);
	check("q10 is $10, not ten", tokenize("#0 q10\n").commands.find((c) => c.kind === "q")?.args[0]?.value === 0x10);
	// getHex stops at two digits (parser.ts).
	check("only two digits are taken", tokenize("#0 q7F0\n").tokens.filter((t) => t.kind === "hexNumber").length === 1);
	// getHex opens with doReplacement (parser.ts), so a macro really can
	// supply the digits.
	check(
		"a macro can supply the digits, as getHex allows",
		tokenize('"x=1F"\n#0 nx\n').commands.find((c) => c.kind === "n")?.args[0]?.value === 0x1f,
	);
	// getHex skips no spaces, so the digits after one are not read as hex.
	check("a space stops the hex run", !tokenize("#0 n 1F\n").tokens.some((t) => t.kind === "hexNumber"));
}

console.log("\nthe @ forms");
{
	const direct = tokenize("#0 @@19\n").commands.filter((c) => c.kind === "@");
	check("@@19 is one command, not two", direct.length === 1);
	check("and it is marked direct", direct[0]?.direct === true);
	check("with the number intact", direct[0]?.args[0]?.value === 19);
	check("a plain @19 is not direct", tokenize("#0 @19\n").commands.find((c) => c.kind === "@")?.direct === undefined);

	// parseSampleLoad — `(@5, $02)` loads instrument 5's sample. The `@` belongs
	// to that command and does not change the instrument.
	check("(@5, $02) opens no instrument command", !tokenize("#0 (@5, $02) c4\n").commands.some((c) => c.kind === "@"));
	check(
		"but a bare (5) still works",
		tokenize("#0 (5)\n").tokens.some((t) => t.kind === "label"),
	);
}

console.log("\n#instruments is scanned as a block, not as commands");
{
	const source =
		'#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n\t@5 $8F $E0 $7F $02 $80\n\tn1F $00 $00 $7F $01 $00\n}\n';
	const index = tokenize(source);

	// The headline: an entry's ADSR bytes land in $DA-$FE, so without a block
	// mode the second byte opens a VCMD and eats the rest of the entry.
	check("no $xx inside the block opens a command", !index.tokens.some((t) => t.kind === "hex"));

	check("all three entries are found", index.instruments.length === 3);
	check("numbering starts at @30", index.instruments[0]?.number === 30);
	check("and runs upward", index.instruments.map((d) => d.number).join() === "30,31,32");
	check(
		"every one is complete",
		index.instruments.every((d) => d.complete),
	);
	check(
		"each carries its five bytes",
		index.instruments.every((d) => d.bytes.length === 5),
	);
	check("the first is a named file", index.instruments[0]?.sample.form === "file");
	check("with its name unquoted", (index.instruments[0]?.sample as { name: string }).name === "kick.brr");
	check("the second copies an instrument", index.instruments[1]?.sample.form === "copy");
	// readInstrumentSample — @5's sample is $07.
	check("resolving @5 to SRCN $07", (index.instruments[1]?.sample as { srcn: number }).srcn === 0x07);
	check("the third is noise", index.instruments[2]?.sample.form === "noise");
	// readInstrumentSample — the high bit is what marks it noise.
	check("with the high bit set", (index.instruments[2]?.sample as { byte: number }).byte === 0x9f);
	check(
		"the bytes are the ones written",
		index.instruments[0]?.bytes.map((b) => b.value).join() === [0xfe, 0x6a, 0xb8, 0x03, 0x00].join(),
	);

	// Every byte carries its own span, which is what makes one of them editable
	// without rewriting the entry around it. Slicing the span back out of the
	// source is the assertion: an off-by-one would still be a plausible-looking
	// number, and only the text can tell.
	check(
		"each byte's span slices back to its own $XX",
		index.instruments[0]?.bytes.map((b) => source.slice(b.span.start, b.span.end)).join(" ") === "$FE $6A $B8 $03 $00",
	);
	check(
		"the sample span covers the name and nothing else",
		source.slice(index.instruments[0].sampleSpan.start, index.instruments[0].sampleSpan.end) === '"kick.brr"',
	);
	check(
		"and covers both tokens of the @n form",
		source.slice(index.instruments[1].sampleSpan.start, index.instruments[1].sampleSpan.end) === "@5",
	);
	check(
		"and of the noise form",
		source.slice(index.instruments[2].sampleSpan.start, index.instruments[2].sampleSpan.end) === "n1F",
	);

	// Outside the block, hex commands work as before.
	check(
		"a $EF after the block still opens one",
		tokenize(`${source}#0 $EF $2b $2d $2d\n`).commands.some((c) => c.vcmd === 0xef),
	);

	// Numbering continues across blocks, which is why it lives in the second
	// pass rather than in ScanState.
	const two = tokenize(`${source}#instruments\n{\n\t@0 $FE $6A $B8 $01 $00\n}\n`);
	check("numbering continues across two blocks", two.instruments.map((d) => d.number).join() === "30,31,32,33");

	// Half-written source is the normal case for a scanner that runs per keystroke.
	const partial = tokenize('#instruments\n{\n\t"kick.brr" $FE $6A\n');
	check("an unterminated block does not hang", partial.instruments.length === 1);
	check("and its entry is marked incomplete", partial.instruments[0]?.complete === false);
	check("an #instruments with no brace yields nothing", tokenize("#instruments\n#0 c4\n").instruments.length === 0);
	check("and does not arm an unrelated brace", tokenize("#instruments\n#samples\n{ $FE }\n").instruments.length === 0);
	check("a song with no block has no entries", tokenize("#0 c4\n").instruments.length === 0);
}

console.log("\nknown divergences from AddmusicK, pinned on purpose");
{
	// Both come from the same root: `getInt`/`getHex` (parser.ts) expand
	// *inside* a token, which a model whose tokens are spans cannot express.

	// AMK's getInt expands once at the first digit, reading c44 as c84. The
	// scanner dispatches at each digit instead, so it sees two arguments.
	const midNumber = tokenize('"4=8"\n#0 c44\n').commands.find((c) => c.kind === "c");
	check("a macro inside a number is not folded into it", midNumber?.args.length === 2, `got ${midNumber?.args.length}`);

	// AMK's getHex expands after the `$`, turning $2b into $EF. scanHex takes the
	// byte whole, so it never gets the chance.
	check(
		"a macro naming hex digits does not rewrite a byte",
		!tokenize('"2b=EF"\n#0 $2b\n').commands.some((c) => c.vcmd === 0xef),
	);

	// The scanner does not evaluate `#if`, which `preprocess.ts` does before the
	// parser ever sees the text. So a block in an untaken branch is counted here
	// and dropped there. Harmless for a panel that describes what is under the
	// caret, and not worth a second preprocessor to fix.
	const branched = "#if 0\n#instruments\n{\n\t@0 $FE $6A $B8 $01 $00\n}\n#endif\n";
	check("an #instruments block in a false branch is still counted", tokenize(branched).instruments.length === 1);

	// `gather` associates the numbers that follow a letter command without
	// caring about the whitespace between, which is how `t 144` has always
	// worked. So `n 1F` reports a decimal 1 where AMK's getHex reports an error.
	// The tokens are right — the `1F` is not read as hex — but the command is
	// generous where AMK is strict.
	check(
		"a spaced argument is still gathered, where AMK would error",
		tokenize("#0 n 1F\n").commands.find((c) => c.kind === "n")?.args[0]?.value === 1,
	);

	// accumulateTiedLength folds consecutive rests into one the way it folds
	// ties (parser.ts). Only `^` is folded here, so a rest's tooltip stays
	// about the rest under the caret.
	const rests = tokenize("#0 r4 r8\n").commands.filter((c) => c.noteLength);
	check("consecutive rests stay separate", rests.length === 2 && rests[0].noteLength?.length === 1);

	// A pitch bend ahead makes AMK rewind the last tied segment and emit it as
	// its own note (accumulateTiedLength's rewind). The scanner ties regardless.
	check("a $DD ahead does not break the tie", lengthOf("#0 c4^8 $DD $00 $00 $00\n", "c4")?.length === 2);

	// The same whitespace generosity as `t 144` above, and getNoteLength reads
	// digits at the cursor — so AMK sees a bare `c` and a stray `4` here.
	check("a spaced length is still the note's", lengthOf("#0 c 4\n", "c 4")?.[0].ticks === 48);

	// preprocess.ts resolves the target markers before the parser runs, so the
	// file's *last* effective marker governs the whole song — but a resumable
	// scanner can only apply one from its line down. Well-formed songs put the
	// marker before any music, where the two agree.
	const positional = tokenize("#0 $FC $05 $7F $01 $02\n#amk 1\n#1 $FC $05 $7F\n").commands.filter(
		(c) => c.vcmd === 0xfc,
	);
	check(
		"a mid-file marker applies from its line down, not to the whole file",
		positional[0]?.args.length === 4 && positional[1]?.args.length === 2,
		`got ${positional[0]?.args.length} and ${positional[1]?.args.length}`,
	);

	// preprocess's argument read stops at a line end (its getArgument), so
	// a real `#amk\n1` fails AMK0401 and compiles nothing; the one-shot here
	// cannot see line breaks. Harmless: it only recolours a broken song.
	const split = tokenize("#amk\n1\n#0 $FC $05 $7F\n").commands.find((c) => c.vcmd === 0xfc);
	check("the #amk version one-shot crosses a newline", split?.args.length === 2, `got ${split?.args.length}`);

	// An $ED $82 upload aimed at $6136 appends to the compiler's instrument
	// table (parseHFDInstrumentHack), shifting `@30 + k` numbering; this pass
	// counts only #instruments blocks. Error-truncation shapes are not mirrored
	// either — e.g. $FA under #amm zeroes hexLeft on its error path
	// (parseHexCommand's AMK0156 path) — the compiler squiggles those, and the scanner
	// keeps AddmusicK's grouping.
	const hacked = tokenize(
		'#am4\n#0 $ED $82 $61 $36 $00 $05 $04 $FE $6A $B8 $03 $00\n#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n}\n',
	);
	check(
		"the HFD instrument hack does not shift @ numbering",
		hacked.instruments.length === 1 && hacked.instruments[0].number === 30,
	);
}

console.log("\na directive's bare-word argument is not music");
{
	const source = "#amk 4\n#option smwvtable\n#0 w255 c4\n";
	const { tokens } = tokenize(source);
	const word = tokenAt(tokens, source.indexOf("smwvtable"));
	check("smwvtable is one directive token", word?.kind === "directive", word?.kind);
	check("all of it", word !== null && word.end - word.start === "smwvtable".length, `${word?.start}-${word?.end}`);
	check("the w after it is still a global volume", tokenAt(tokens, source.indexOf("w255"))?.kind === "globalVolume");
	check("and the note is still a note", tokenAt(tokens, source.indexOf("c4"))?.kind === "note");

	const divide = tokenize("#option dividetempo 3\n").tokens;
	check("dividetempo is a directive word", tokenAt(divide, "#option ".length)?.kind === "directive");
	check("its count stays a number", tokenAt(divide, "#option dividetempo ".length)?.kind === "number");

	const defines = tokenize("#define !loud 1\n#ifdef !loud\n#0 c4\n#endif\n").tokens;
	check("a define's name is part of the directive", tokenAt(defines, "#define ".length)?.kind === "directive");
	check("its value stays a number", tokenAt(defines, "#define !loud ".length)?.kind === "number");

	// The flag is consumed by whatever token comes next, word or not, so it
	// cannot lie in wait and swallow music further down.
	const cleared = tokenize("#option\n$EF $01 $02 $03 c4\n").tokens;
	check("a non-word consumes the flag", tokenAt(cleared, "#option\n".length)?.kind === "hex");
	check(
		"music after it is untouched",
		cleared.some((t) => t.kind === "note"),
	);
}

console.log("\nthe velocity table follows the hex, not just the directives");
{
	const tableAt = (source: string, needle: string) => {
		const index = tokenize(source);
		const command = commandAt(index.commands, source.indexOf(needle));
		return command === null ? null : velocityTableAt(command, index, source);
	};

	check("#amk 4 starts on N-SPC", tableAt("#amk 4\n#0 q7F c4\n", "q7F") === "nspc");
	check("#amk 1 starts on SMW", tableAt("#amk 1\n#0 q7F c4\n", "q7F") === "smw");
	check("#option smwvtable switches", tableAt("#amk 4\n#option smwvtable\n#0 q7F c4\n", "q7F") === "smw");

	// Commands.asm:1087 — the driver takes the hex as readily as the directive.
	// AddmusicK's own usingSMWVTable is the thing that does not, which is why
	// this walks the commands rather than mirroring the compiler's bookkeeping.
	check("$FA $06 $00 switches", tableAt("#amk 4\n#0 $FA $06 $00 q7F c4\n", "q7F") === "smw");
	check(
		"and a later $FA $06 $01 switches back",
		tableAt("#amk 4\n#option smwvtable\n#0 $FA $06 $01 q7F c4\n", "q7F") === "nspc",
	);
	// main.asm:2373 compares against zero, so $05 is as N-SPC as $01 is.
	check("a value the driver does not test for is N-SPC", tableAt("#amk 4\n#0 $FA $06 $05 q7F c4\n", "q7F") === "nspc");

	// Commands.asm:610 stores #$01 outright, so $F4 $08 only goes the one way.
	check("$F4 $08 leaves SMW", tableAt("#amk 4\n#option smwvtable\n#0 $F4 $08 q7F c4\n", "q7F") === "nspc");
	check("#louder does the same", tableAt("#amk 4\n#option smwvtable\n#louder\n#0 q7F c4\n", "q7F") === "nspc");

	// $6F is one byte for the whole driver, so the walk does not stop at the
	// channel boundary the way echo-hazards.ts and fir-override.ts do.
	check("a switch in #1 is heard in #0", tableAt("#amk 4\n#1 $FA $06 $00\n#0 q7F c4\n", "q7F") === "smw");
}

console.log("\nthe target markers pick the dialect");
{
	// parseHexCommand — #amk 1's $FC is remote gain and takes two arguments.
	const amk1 = tokenize("#amk 1\n#0 $FC $05 $7F c4\n").commands;
	const gain = amk1.find((c) => c.vcmd === 0xfc);
	check("under #amk 1, $FC takes two arguments", gain?.args.length === 2, `got ${gain?.args.length}`);
	check("and is complete", gain?.complete === true);
	check("and is named remote gain", gain?.name === "remote gain", gain?.name);
	check("and carries its dialect", gain?.target.amkVersion === 1 && gain.target.program === 0);
	check(
		"the note after it survives",
		amk1.some((c) => c.kind === "c"),
	);

	// The flip point pins scanHex and expectedArgs against each other.
	const short = tokenize("#amk 1\n#0 $FC $05\n").commands.find((c) => c.vcmd === 0xfc);
	check("one argument short is incomplete", short?.complete === false);

	const amk4 = tokenize("#amk 4\n#0 $FC $05 $7F $01 $02\n").commands.find((c) => c.vcmd === 0xfc);
	check("under #amk 4, $FC takes four", amk4?.args.length === 4, `got ${amk4?.args.length}`);
	check("and is named remote code", amk4?.name === "remote code", amk4?.name);

	// The pre-spaced form (preprocess.ts's `amk=1` special case) arrives as the number `=1`.
	const eq = tokenize("#amk=1\n#0 $FC $05 $7F c4\n").commands.find((c) => c.vcmd === 0xfc);
	check("#amk=1 selects version 1", eq?.args.length === 2, `got ${eq?.args.length}`);

	// preprocess reads the directive word whole (its getArgument), so `#amk4`
	// is an unknown directive, not a marker.
	const glued = tokenize("#amk4\n#0 $FC $05 $7F $01 $02\n").commands.find((c) => c.vcmd === 0xfc);
	check("#amk4 without a space is no marker", glued?.args.length === 4, `got ${glued?.args.length}`);

	// preprocess.ts's `amk` case — once a legacy marker is seen, a later #amk is ignored…
	const guarded = tokenize("#am4\n#amk 4\n#0 $ED $80 $6C $20 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("#amk after #am4 is ignored", guarded?.args.length === 3, `got ${guarded?.args.length}`);

	// …while a later legacy marker always wins (its `amm` and `am4` cases).
	const amm = tokenize("#amk 4\n#amm\n#0 $E7 $10\n").commands.find((c) => c.vcmd === 0xe7);
	check("a later #amm wins over #amk", amm?.target.program === 2, String(amm?.target.program));

	const flipped = tokenize("#amm\n#am4\n#0 $ED $81 $05 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("a later #am4 wins over #amm", flipped?.args.length === 2 && flipped.name === "tune", flipped?.name);

	// parser.ts's initial targetAMKVersion — before any marker, the parser assumes #amk 4.
	const bare = tokenize("#0 $FC $01 $02 $03 $04\n").commands.find((c) => c.vcmd === 0xfc);
	check("no marker means the #amk 4 default", bare?.target.program === 0 && bare.target.amkVersion === 4);
}

console.log("\n#am4's $ED is HFD's escape");
{
	// parseHFDHex (parser.ts, Music.cpp:1466) — the sub-byte picks the form.
	const dsp = tokenize("#am4\n#0 $ED $80 $6C $20 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("$ED $80 takes a register and a value", dsp?.args.length === 3, `got ${dsp?.args.length}`);
	check("and is complete", dsp?.complete === true);
	check("and is named as the DSP write it compiles to", dsp?.name === "DSP write", dsp?.name);

	const tune = tokenize("#am4\n#0 $ED $81 $05 $E7 $10\n").commands;
	const tuned = tune.find((c) => c.vcmd === 0xed);
	check("$ED $81 takes one value", tuned?.args.length === 2, `got ${tuned?.args.length}`);
	check("and is named tune", tuned?.name === "tune", tuned?.name);
	check("the byte after it opens its own command", tune.find((c) => c.vcmd === 0xe7)?.args.length === 1);

	// $ED $82: address, then a big-endian count of the data bytes that follow —
	// count+1 of them, the do-while in parseHFDHex.
	const upload = tokenize("#am4\n#0 $ED $82 $61 $00 $00 $02 $AA $BB $CC c4\n").commands;
	const block = upload.find((c) => c.vcmd === 0xed);
	check("$ED $82 reads its count and the data", block?.args.length === 8, `got ${block?.args.length}`);
	check("and is complete", block?.complete === true);
	check("and is named ARAM upload", block?.name === "ARAM upload", block?.name);
	check(
		"the note after the data survives",
		upload.some((c) => c.kind === "c"),
	);

	const shortData = tokenize("#am4\n#0 $ED $82 $61 $00 $00 $02 $AA $BB\n").commands.find((c) => c.vcmd === 0xed);
	check("one data byte short is incomplete", shortData?.complete === false);

	const noCount = tokenize("#am4\n#0 $ED $82 $61 $00\n").commands.find((c) => c.vcmd === 0xed);
	check("a header cut before its count is incomplete", noCount?.complete === false);

	const adsr = tokenize("#am4\n#0 $ED $05 $7F c4\n").commands.find((c) => c.vcmd === 0xed);
	check("a low sub-byte is the plain ADSR form", adsr?.args.length === 2 && adsr.complete, `got ${adsr?.args.length}`);
	check("named as such", adsr?.name === "ADSR / GAIN", adsr?.name);

	// AMK0163 is the compiler's diagnostic; the scanner just ends the run.
	const bad = tokenize("#am4\n#0 $ED $83 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("$ED $83 takes nothing further", bad?.args.length === 1 && bad.complete === true);

	const amk = tokenize("#amk 4\n#0 $ED $80 $A0 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("under #amk 4, $ED is two-argument ADSR", amk?.args.length === 2, `got ${amk?.args.length}`);
}

console.log("\n#am4's $E5 forks on its first argument");
{
	// Music.cpp:1820, parseHexCommand's $E5 fork — a high bit means "load sample".
	const load = tokenize("#am4\n#0 $E5 $85 $04 c4\n").commands.find((c) => c.vcmd === 0xe5);
	check("a high first argument is a sample load", load?.args.length === 2, `got ${load?.args.length}`);
	check("named as the $F3 it compiles to", load?.name === "sample load", load?.name);
	check("and complete", load?.complete === true);

	const trem = tokenize("#am4\n#0 $E5 $20 $30 $40 c4\n").commands.find((c) => c.vcmd === 0xe5);
	check("a low first argument stays tremolo", trem?.args.length === 3 && trem.name === "tremolo", trem?.name);

	const amk = tokenize("#amk 4\n#0 $E5 $85 $04 $01\n").commands.find((c) => c.vcmd === 0xe5);
	check("no fork outside #am4", amk?.args.length === 3, `got ${amk?.args.length}`);
}

console.log("\na command takes its arguments and stops");
{
	// `scanHex` emits `hexArg` for any byte below $DA even with `hexLeft` at 0
	// (tokens.ts), because a sample load's tuning byte has to read as one.
	// So a byte standing after a full command looks exactly like an argument, and
	// `gather` must not claim it. The parser does not: `parseHexCommand` reads
	// it as a standalone literal and reports AMK0151 under #amk. Two things go
	// wrong if the scanner disagrees — the inspector draws a row for an argument
	// that is not one, and `spliceArg` writes over a byte the command does not own.
	const one = tokenize("#amk 2\n#0 $E7 $FF $00 c4\n").commands.find((c) => c.vcmd === 0xe7);
	check("a trailing byte is not claimed as an argument", one?.args.length === 1, `got ${one?.args.length}`);
	check("the command still ends at its own last argument", one?.span.end === one?.args[0]?.span.end);

	const two = tokenize("#amk 2\n#0 $E0 $C0 $12 $34 c4\n").commands.find((c) => c.vcmd === 0xe0);
	check("nor are two of them", two?.args.length === 1, `got ${two?.args.length}`);

	// The stop must not fire early on the commands whose length is decided by
	// their own arguments — `expectedArgs` returns null until the deciding byte
	// has been read, and null has to mean "keep going".
	const arp = tokenize("#amk 2\n#0 $FB $03 $10 $01 $02 $03 c4\n").commands.find((c) => c.vcmd === 0xfb);
	check("an arpeggio still gathers its whole list", arp?.args.length === 5, `got ${arp?.args.length}`);

	const upload = tokenize("#am4\n#0 $ED $82 $20 $00 $00 $02 $11 $22 $33 c4\n").commands.find((c) => c.vcmd === 0xed);
	check("an HFD upload still gathers its payload", upload?.args.length === 8, `got ${upload?.args.length}`);

	// parseHexCommand / scanHex — $FA $FE's toggle byte takes a
	// further byte when its high bit is set. `expectedArgs` and `scanHex` must
	// fork here together.
	const bits = tokenize("#amk 2\n#0 $FA $FE $81 $02 c4\n").commands.find((c) => c.vcmd === 0xfa);
	check("$FA $FE takes a third byte when the high bit is set", bits?.args.length === 3, `got ${bits?.args.length}`);
	check("and is complete with it", bits?.complete === true);

	const short = tokenize("#amk 2\n#0 $FA $FE $81\n").commands.find((c) => c.vcmd === 0xfa);
	check("and incomplete without it", short?.complete === false);

	const plain = tokenize("#amk 2\n#0 $FA $FE $01 $02 c4\n").commands.find((c) => c.vcmd === 0xfa);
	check("a low toggle byte takes no third", plain?.args.length === 2, `got ${plain?.args.length}`);
}

console.log("\nrestartability — the property CodeMirror relies on");
{
	const sources = [
		"#amk 4\n#0 $F5 $7F $00 $00 $00 $00 $00 $00 $00 c4\n",
		// A hex command split across a line break: the whole point of ScanState.
		"#amk 4\n#0 $F5 $7F $00 $00\n   $00 $00 $00 $00 $00 c4\n",
		'"a=b"\n#0 t144 [c4 d8 e2]4 $E7 $10\n; trailing comment\n',
		'#0 ("kick.brr", $02) $FB $03 $01 $02 $03 c4\n',
		'"unterminated\nstill inside"\n#0 c4\n',
		// Replacements cross line boundaries inside ScanState like everything
		// else, so a restart below a definition must still see it — and a restart
		// above one must still not.
		'"echo1=$EF"\n"echo2=$F1"\n\n#0 echo1 $2b $2d $2d\necho2 $05 $3c $00\n',
		'echo1 c4\n"echo1=$EF"\n#0 echo1 $2b $2d $2d\n',
		'"x=$EF $2b $2d $2d c4"\n#0 x\n',
		// An #instruments block spans lines, and its mode flag is the newest thing
		// in ScanState. A restart inside the block must still know it is inside.
		'#instruments\n{\n\t"kick.brr" $FE $6A $B8 $03 $00\n\t@5 $8F $E0 $7F $02 $80\n}\n#0 $EF $2b $2d $2d\n',
		// Hex letter arguments, whose one-shot flag is set and consumed within a
		// line but must not leak across one.
		"#0 q7F n1F\n#0 c4\n",
		// Left open at EOF, which is what a half-typed block looks like.
		'#instruments\n{\n\t"kick.brr" $FE $6A\n',
		// A directive's word argument on the next line — the parser's skipSpaces
		// crosses the break, so the flag must too, and a restart between the two
		// must still colour the word as part of the directive.
		"#option\nsmwvtable\n#0 c4\n",
		// The dialect fields cross every line below the marker.
		"#am4\n#0 $ED $80 $6C\n$E7 $10 c4\n",
		// awaitingHfdSub itself crosses the break — the parser's skipSpaces allows it.
		"#am4\n#0 $ED\n$80 $6C $20 c4\n",
		// An $ED $82 split inside its header: hfdCountHi crosses the break…
		"#am4\n#0 $ED $82 $61 $00\n$00 $02 $AA $BB $CC c4\n",
		// …and split between the count bytes, so the extension lands right after a restart.
		"#am4\n#0 $ED $82 $61 $00 $00\n$02 $AA $BB $CC c4\n",
		// The #amk version one-shot crossing the break (the pinned approximation).
		"#amk\n1\n#0 $FC $05 $7F c4\n",
		// A mid-file #amm: the dialect changes partway down the document.
		"#amk 4\n#0 c4\n#amm\n$FA $02 $05 c4\n",
		// #am4's shortened sample-load form split at the break.
		"#am4\n#0 $E5 $85\n$04 c4\n",
		// #amk 1's two-argument $FC split, with a fresh command right after.
		"#amk 1\n#0 $FC $05\n$7F $E7 $10\n",
	];

	for (const [index, source] of sources.entries()) {
		// Re-scan line by line, exactly as StreamLanguage would, carrying the
		// state across and copying it the way CodeMirror does.
		const manual: Token[] = [];
		let state: ScanState = startState();
		let offset = 0;
		let lineNumber = 1;
		for (const line of source.split("\n")) {
			state = copyState(state);
			let cursor = 0;
			while (cursor < line.length) {
				const { kind, end } = step(line, cursor, state);
				const next = end > cursor ? end : cursor + 1;
				if (kind) {
					manual.push({ kind, start: offset + cursor, end: offset + next, line: lineNumber });
				}

				cursor = next;
			}

			offset += line.length + 1;
			lineNumber++;
		}

		const whole = tokenize(source).tokens;
		check(
			`source ${index + 1}: line-by-line equals whole-document`,
			JSON.stringify(manual) === JSON.stringify(whole),
			`\n        line-by-line: ${JSON.stringify(manual).slice(0, 220)}\n        whole-doc:    ${JSON.stringify(whole).slice(0, 220)}`,
		);
	}
}

console.log("\ncopyState really copies");
{
	const original = startState();
	original.hexLeft = 3;
	original.currentHex = 0xf5;
	const copy = copyState(original);
	copy.hexLeft = 0;
	copy.currentHex = 0;
	check("mutating the copy leaves the original alone", original.hexLeft === 3 && original.currentHex === 0xf5);
	check("every field came across", Object.keys(copy).length === Object.keys(original).length);
	// The one compound field is shared rather than cloned, which is only safe
	// because it is never mutated in place — `withReplacement` returns a new one.
	check("the replacement table is shared, not deep-copied", copy.replacements === original.replacements);
}

console.log("\nthe scanner always makes progress");
{
	// Garbage in must not hang the editor.
	const nasty = "\0\x1b~`%:!\\\n#0 éé $ $$ $Z c\n";
	const { tokens } = tokenize(nasty);
	check("a hostile document terminates and yields tokens", tokens.length > 0);
	check(
		"every token advances",
		tokens.every((t) => t.end > t.start),
	);
	check(
		"tokens are ordered and never overlap",
		tokens.every((t, i) => i === 0 || t.start >= tokens[i - 1].end),
	);
}

console.log("\nan empty document is not a special case");
{
	check("empty text yields nothing", tokenize("").tokens.length === 0);
	check("empty text has no commands", tokenize("").commands.length === 0);
	check("a lone newline yields nothing", tokenize("\n").tokens.length === 0);
	check("commandAt on nothing is null", commandAt([], 0) === null);
	check("tokenAt on nothing is null", tokenAt([], 0) === null);
}

console.log("\naudit: the scanner agrees with the driver about command lengths");
{
	// Music.cpp:1807-1813 — every trailing byte with its high bit set extends the
	// hot patch by one, not just the first.
	const chain = tokenize("#amk 4\n#0 $FA $FE $80 $80 $10 $E7 $50 c4\n");
	const patch = chain.commands.find((c) => c.vcmd === 0xfa);
	check("a two-link $FA $FE chain keeps all four bytes", patch?.args.length === 4, `got ${patch?.args.length}`);
	check("and is complete", patch?.complete === true, String(patch?.complete));
	check(
		"so the command after it is still seen",
		chain.commands.some((c) => c.vcmd === 0xe7),
		chain.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);

	const short = tokenize("#amk 4\n#0 $FA $FE $10 c4\n");
	check("a plain $FA $FE still takes two", short.commands.find((c) => c.vcmd === 0xfa)?.args.length === 2, "");

	// Music.cpp:2762 — `#pad` reads its argument with `getHex(true)`, any length,
	// so `$DA0` is one number and not the VCMD `$DA`.
	const pad = tokenize("#amk 4\n#pad $DA0\n#0 $E7 $50 c4\n");
	check(
		"a three-digit #pad does not open a phantom VCMD",
		!pad.commands.some((c) => c.vcmd === 0xda),
		pad.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);
	check(
		"and the command after it survives",
		pad.commands.some((c) => c.vcmd === 0xe7),
		pad.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);

	// Music.cpp:433 — under #am4 an unfinished $E6 met by a non-hex byte is a
	// one-byte Tremolo Off, so it must not swallow what comes next.
	const tremolo = tokenize("#am4\n#0 $E6 c4 $E7 $50\n");
	check(
		"#am4's $E6 releases the next command",
		tremolo.commands.some((c) => c.vcmd === 0xe7),
		tremolo.commands.map((c) => c.vcmd?.toString(16)).join(", "),
	);

	// Music.cpp:2310 — `h` reads through getIntWithNegative.
	const source = "#amk 4\n#0 h-3 c4\n";
	const transpose = tokenize(source);
	const minus = tokenAt(transpose.tokens, source.indexOf("-"));
	check(
		"h's negative argument scans as one number",
		minus?.kind === "number" && source.slice(minus.start, minus.end) === "-3",
		`${minus?.kind} ${minus ? JSON.stringify(source.slice(minus.start, minus.end)) : ""}`,
	);
	check(
		"and nothing scans as unknown around it",
		!transpose.tokens.some((t) => t.kind === "unknown"),
		transpose.tokens
			.filter((t) => t.kind === "unknown")
			.map((t) => t.start)
			.join(", "),
	);
}

// ---------------------------------------------------------------------------
console.log("\nwhat a command reaches, and what the source alone can answer");
// ---------------------------------------------------------------------------
//
// The piano roll draws a glyph per command acting on a note. Two halves answer
// that and they must not overlap: anything that emits a VCMD is named by the
// walk, at the address the driver read it from, and the rest — `q`, `h` and
// `@21`-`@29`, which emit nothing — is named here. A command answered twice
// draws two glyphs for one setting; one answered neither way draws none.
{
	// Exhaustive, because a table that quietly loses an entry is a command the
	// roll silently stops drawing.
	const missing: string[] = [];
	const scopes = new Set<CommandScope>();
	for (const vcmd of Object.keys(VCMD_NAMES).map(Number)) {
		const source = `#amk 4\n#0 $${vcmd.toString(16).toUpperCase()}\n`;
		const command = tokenize(source).commands.find((entry) => entry.vcmd === vcmd);
		if (command === undefined) {
			missing.push(`${vcmd.toString(16)}`);
			continue;
		}

		scopes.add(commandScope(command));
	}

	check("every VCMD is gathered and scoped", missing.length === 0, missing.join(" "));

	const letters = Object.keys(LETTER_NAMES).filter((letter) => letter !== "<" && letter !== ">");
	const unscoped: string[] = [];
	for (const letter of letters) {
		const source = `#amk 4\n#0 ${letter}1\n`;
		const command = tokenize(source).commands.find((entry) => entry.kind.toLowerCase() === letter);
		if (command === undefined) {
			unscoped.push(letter);
			continue;
		}

		scopes.add(commandScope(command));
	}

	check("every named letter but the octave shifts is gathered", unscoped.length === 0, unscoped.join(" "));

	// `<` and `>` never become commands at all — `octaveShift` is absent from
	// `LETTER_COMMAND_KINDS` — so `commandScope` is never asked about them and
	// the roll has nothing to draw. Worth pinning, since they *are* in
	// `LETTER_NAMES` and reading that table would suggest otherwise.
	check(
		"an octave shift is not a command",
		tokenize(`#amk 4\n#0 c > d\n`).commands.every((command) => command.kind !== ">"),
	);

	const arms: CommandScope[] = ["note-state", "song", "position", "structure"];
	const unused = arms.filter((arm) => !scopes.has(arm));
	check("and every scope is reached by something", unused.length === 0, unused.join(", "));
}

// The exclusions, stated as the roll asks the question.
{
	const source = `#amk 4\n#0 t144 w200 o4 l8 $E4 $00 $EF $FF $28 $28 $F5 $7F $00 $00 $00 $00 $00 $00 $00 [ c8 ]2 *2\n`;
	const drawn = tokenize(source)
		.commands.filter((command) => commandScope(command) === "note-state")
		.map((command) => source.slice(command.span.start, command.span.end));
	check("nothing song-wide, positional or structural is note state", drawn.length === 0, drawn.join(" | "));
}

/**
 * What the parse-time half says is in force at the note written as `text`, as
 * the source spells the commands, space-joined.
 */
function inForceAt(source: string): (text: string) => string {
	const index = tokenize(source);
	const inForce = parseTimeInForce(index, source);
	return (text) => {
		const note = commandStartingAt(index.commands, source.indexOf(text));
		if (note === null) {
			throw new Error(`no command at ${text}`);
		}

		return (inForce.get(note) ?? []).map((command) => source.slice(command.span.start, command.span.end)).join(" ");
	};
}

// The parse-time half. Exact rather than approximate: `parser.ts` resolves these
// in one textual pass, so the `q` before a note in the source is the `q` that
// went into the bytes of every pass of it.
{
	const under = inForceAt(`#amk 4\n#0 q7f h2 c8 d8 q6e e8\n#1 f8\n`);
	check("a q and an h carry forward to the notes after them", under("c8") === "q7f h2");
	check("and to the one after that", under("d8") === "q7f h2");
	check("a second q replaces the first", under("e8") === "q6e h2");
	check("and none of it reaches another channel", under("f8") === "");
}

// Above the first marker a command is on the starting channel, and the parser's
// `q[channel]` and `instrument[channel]` survive the marker — so a `q` or a
// drum `@` written there is what the channel's first note goes out under.
// `parseQuantization` writes `q[prevChannel]` from inside a `[ ]` body too
// (Music.cpp:684-687), which is why the remote definition's `q` counts:
// `selftest` pins the bytes, `18 40 A4`.
{
	check("a q above the first channel is the q of its first note", inForceAt(`#amk 4\nq40\n#0 c8\n`)("c8") === "q40");
	check(
		"and so is one inside a remote definition above it",
		inForceAt(`#amk 4\n(!1)[q40 $F4 $09]\n#0 c8\n`)("c8") === "q40",
	);
	check(
		"a percussion @ above the first channel reaches its first note",
		inForceAt(`#amk 4\n@21\n#0 c8\n`)("c8") === "@21",
	);
	check(
		"and it is the lowest channel declared that they reach, not the first",
		inForceAt(`#amk 4\nq40\n#3 d8\n#0 c8\n`)("c8") === "q40" && inForceAt(`#amk 4\nq40\n#3 d8\n#0 c8\n`)("d8") === "",
	);
}

// `h` is one variable in the parser and every `#N` resets it (`parseHash`,
// Music.cpp:569) — including a marker re-entering the channel it is on, which
// is what a channel written in two blocks does.
{
	check("an h above the first channel reaches nothing", inForceAt(`#amk 4\nh5\n#0 c8\n`)("c8") === "");

	const split = inForceAt(`#amk 4\n#0 h5 c8\n#1 d8\n#0 e8\n`);
	check("an h holds until the channel's block ends", split("c8") === "h5");
	check("and a second block of the same channel does not inherit it", split("e8") === "");

	const twice = inForceAt(`#amk 4\n#0 h5 c8\n#0 d8\n`);
	check("even when the two blocks are back to back", twice("d8") === "");

	// A `q` is per channel and survives the marker, so the same song keeps it.
	const kept = inForceAt(`#amk 4\n#0 q40 c8\n#1 d8\n#0 e8\n`);
	check("where a q does carry into the channel's second block", kept("e8") === "q40");

	// A malformed marker is reported and resets nothing (AMK0031).
	check("a marker the compiler rejects resets nothing", inForceAt(`#amk 4\n#0 h5 c8\n#9 d8\n`)("d8") === "h5");
}

// `@21`-`@29` emit no `$DA`, so they are this half's; every other `@` emits one
// and is the walk's. Reporting both would draw two instrument glyphs on one note.
{
	const held = (source: string) => {
		const index = tokenize(source);
		const note = index.commands.find((command) => command.noteLength !== undefined);
		return note === undefined ? -1 : (parseTimeInForce(index, source).get(note) ?? []).length;
	};

	check("a percussion @ is answered here", held(`#amk 4\n#0 @21 c8\n`) === 1);
	check("a pitched @ is left to the walk", held(`#amk 4\n#0 @1 c8\n`) === 0);
	check("and @@21 is direct, so it emits and is left to the walk too", held(`#amk 4\n#0 @@21 c8\n`) === 0);
}

summarise();
