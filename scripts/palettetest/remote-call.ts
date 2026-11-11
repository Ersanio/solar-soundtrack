/** `palettetest`: reading a remote call and writing it back, against the `$FC` the compiler emits. */

import "../localize";
import { compiler } from "@amk/compiler";
import { tokenize } from "@amk/tokens";
import type { Edit } from "@amk/tokens/edits";
import { readLoops } from "@amk/tokens/commands/loops";
import { REMOTE_EVENTS, bodyCommands, readRemote, remoteAt, remoteBody } from "@amk/tokens/commands/remote";
import {
	DEFAULT_WAIT,
	remoteResetEdit,
	remoteTypeEdit,
	remoteView,
	remoteWaitEdit,
} from "../../web/src/app/output/command-inspector/remote-code/remote-focus";
import { check, section } from "../harness";
import { ARAM } from "./support";

// ---------------------------------------------------------------------------
section("reading a remote call, and writing it back");
// ---------------------------------------------------------------------------
//
// A call raises no `Command`, so `commands/remote.ts` reads it off the text, and
// the compiler is asked whether it read the same thing: the type and wait bytes
// the `$FC` carries, and the address it points at. Every splice the inspector
// writes is compiled again, which is what catches a wait left behind on a type
// that reads none (AMK0149) or missing from one that needs it (AMK0146).
{
	interface Emitted {
		type: number;
		wait: number;
		address: number;
	}

	const compiled = (song: string) => compiler.compile({ source: song, aramAddress: ARAM });

	const errorsIn = (song: string) =>
		compiled(song)
			.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
			.map((diagnostic) => diagnostic.code);

	/** Each `$FC` the song emits, keyed by where its text starts. */
	const emitted = (song: string): Map<number, Emitted> => {
		const result = compiled(song);
		const found = new Map<number, Emitted>();
		for (const entry of result.commandMap ?? []) {
			const at = entry.address - ARAM;
			if (result.data?.[at] === 0xfc) {
				const bytes = result.data.subarray(at, at + 5);
				found.set(entry.span.start, { type: bytes[3], wait: bytes[4], address: bytes[1] | (bytes[2] << 8) });
			}
		}

		return found;
	};

	/** Where the body's first command was emitted, which is what a call's address names. */
	const bodyAddress = (song: string, start: number) =>
		compiled(song).commandMap?.find((entry) => entry.span.start === start)?.address;

	const read = (song: string) => readRemote(song, tokenize(song));

	const callAt = (song: string, pick: string) => {
		const found = remoteAt(read(song), song.indexOf(pick));
		return found?.kind === "call" ? found : null;
	};

	const applied = (song: string, edit: Edit | null) =>
		edit === null ? song : song.slice(0, edit.span.start) + edit.text + song.slice(edit.span.end);

	const head = "#amk 4\n(!1)[$F4 $09 v200]\n#0 o4 l16 ";

	// Every spelling of the wait, and both kinds of type, read and then compiled.
	{
		const calls = [
			"(!1,1,$18)",
			"(! 1 , 2 , 8.)",
			"(!1,1,=20)",
			"(!1, -1)",
			"(!0, 0)",
			"(!1,1,)",
			"(!1, 1, $E0)",
			"(!1,1,=256)",
			"(!1,1,1)",
			"(!1,\n3)",
		];
		const song = `${head}${calls.join(" c4 ")} c4\n`;
		const bytes = emitted(song);
		const reads = read(song);

		check("the song compiles", errorsIn(song).length === 0, errorsIn(song).join(" "));
		check("every call is read", reads.length === calls.length && bytes.size === calls.length, String(reads.length));
		for (const call of reads) {
			const text = song.slice(call.from, call.to).replace("\n", "\\n");
			const out = bytes.get(call.from);
			if (call.kind !== "call" || out === undefined) {
				check(`${text} is a call the compiler emitted`, false);
				continue;
			}

			check(`${text} reads its type as the byte it writes`, (call.type & 0xff) === out.type, String(out.type));
			check(
				`${text} reads its wait as the byte it writes`,
				((call.wait?.ticks ?? 0) & 0xff) === out.wait,
				`${call.wait?.ticks} against ${out.wait}`,
			);
		}
	}

	// What is not a call this reading can stand behind, because it does not compile.
	{
		const refused = [
			{ name: "a wait on a type that reads none", song: `${head}(!1, 3, $E0) c4\n`, code: "AMK0149" },
			{ name: "a type 1 with no wait", song: `${head}(!1, 1) c4\n`, code: "AMK0146" },
			{ name: "remote code below #amk 2", song: "#amk 1\n#0 (!1, 3) c4\n", code: "AMK0117" },
			{ name: "the reset form at #amk 2", song: "#amk 2\n(!1)[$F4 $09]\n#0 (!!1) c4\n", code: "AMK0143" },
		];

		for (const { name, song, code } of refused) {
			check(`${name} is not read`, read(song).length === 0, String(read(song).length));
			check(`and really is ${code}`, errorsIn(song).includes(code), errorsIn(song).join(" "));
		}
	}

	// The body a call runs is the one its address points at.
	{
		const song = `${head}(!1, 1, $18) c4\n`;
		const index = tokenize(song);
		const call = callAt(song, "(!1, 1");
		const body = call === null ? null : remoteBody(readLoops(song, index), call);
		check("a call finds its body", body !== null);
		if (call !== null && body !== null) {
			const first = bodyCommands(index, body)[0];
			check(
				"at the address the $FC points at",
				first !== undefined && bodyAddress(song, first.span.start) === emitted(song).get(call.from)?.address,
			);
			check(
				"and every command in it is a chip",
				bodyCommands(index, body).length === 2,
				bodyCommands(index, body)
					.map((command) => song.slice(command.span.start, command.span.end))
					.join(" | "),
			);

			const view = remoteView({ index, loops: readLoops(song, index), construct: call });
			check(
				"each with its glyph",
				view.kind === "call" && view.chips.map((chip) => chip.icon).join() === "toggle,speaker",
				view.kind === "call" ? view.chips.map((chip) => chip.icon).join() : view.kind,
			);
		}

		// `(0)` takes slot 1, so a `(!1, …)` below it calls that body (Music.cpp:1156).
		const shared = "#amk 4\n#0 o4 (0)[$F4 $09 c4] (!1, 4) c4\n";
		const sharedCall = callAt(shared, "(!1,");
		const sharedBody = sharedCall === null ? null : remoteBody(readLoops(shared, tokenize(shared)), sharedCall);
		check("a (0) body answers a (!1) call", sharedBody !== null && !sharedBody.remote);
		const sharedFirst = sharedBody === null ? undefined : bodyCommands(tokenize(shared), sharedBody)[0];
		check(
			"which is what the compiler points it at",
			sharedFirst !== undefined &&
				sharedCall !== null &&
				bodyAddress(shared, sharedFirst.span.start) === emitted(shared).get(sharedCall.from)?.address,
		);

		// No body, and the compiler says so; a type that runs nothing never asks.
		const orphan = "#amk 4\n#0 o4 (!2, 1, $18) c4 (!0, 0) c4\n";
		const index2 = tokenize(orphan);
		const loops2 = readLoops(orphan, index2);
		const lonely = callAt(orphan, "(!2");
		const off = callAt(orphan, "(!0");
		check("a call with no body finds none", lonely !== null && remoteBody(loops2, lonely) === null);
		check(
			"and that is SST0509",
			compiled(orphan).diagnostics.filter((diagnostic) => diagnostic.code === "SST0509").length === 1,
		);
		const offView = off === null ? null : remoteView({ index: index2, loops: loops2, construct: off });
		check(
			"(!0, 0) says it runs no code rather than that nothing is defined",
			offView?.kind === "call" && offView.runsNothing?.startsWith("Type 0 runs no code") === true,
			offView?.kind === "call" ? (offView.runsNothing ?? "") : "",
		);
	}

	// Moving a call between types, and its wait, compiled and read back each time.
	{
		/** The `$FC` bytes of the one call in `song`, or `null` where it does not compile. */
		const one = (song: string): Emitted | null =>
			errorsIn(song).length > 0 ? null : ([...emitted(song).values()][0] ?? null);

		const typed = (song: string, pick: string, type: number) => {
			const call = callAt(song, pick);
			return applied(song, call ? remoteTypeEdit(song, call, type) : null);
		};

		const waited = (song: string, pick: string, ticks: number) => {
			const call = callAt(song, pick);
			return applied(song, call ? remoteWaitEdit(song, call, ticks) : null);
		};

		const start = `${head}(!1, 3) c4\n`;
		const onto = typed(start, "(!1,", 1);
		check("a move onto type 1 writes a wait", onto.includes("(!1, 1, $18)"), onto);
		check(
			"which compiles to the default",
			one(onto)?.type === 1 && one(onto)?.wait === DEFAULT_WAIT,
			JSON.stringify(one(onto)),
		);
		const back = typed(onto, "(!1,", 3);
		check("and a move off it takes the wait out again", back === start, back);

		const tight = `${head}(!1,3) c4\n`;
		check("the wait follows the call's own spacing", typed(tight, "(!1,", 2).includes("(!1,2,$18)"));

		const minus = typed(`${head}(!1, 1, $18) c4\n`, "(!1,", -1);
		check("a move onto -1 writes $FF", minus.includes("(!1, -1)") && one(minus)?.type === 0xff, minus);

		const between = typed(`${head}(!1, 1, 8) c4\n`, "(!1,", 2);
		check("a move between 1 and 2 keeps the wait", between.includes("(!1, 2, 8)") && one(between)?.wait === 24);

		const inHex = `${head}(!1, 1, $18) c4\n`;
		const full = waited(inHex, "(!1,", 256);
		check("a hex wait of 256 is written $00", full.includes("(!1, 1, $00)") && one(full)?.wait === 0, full);
		check("and reads back as 256", callAt(full, "(!1,")?.wait?.ticks === 256);

		const length = `${head}(!1, 1, 8) c4\n`;
		const quarter = waited(length, "(!1,", 48);
		check("a length stays a length", quarter.includes("(!1, 1, 4)") && one(quarter)?.wait === 48, quarter);
		const odd = waited(length, "(!1,", 30);
		check("as an = count where no denominator is exact", odd.includes("(!1, 1, =30)") && one(odd)?.wait === 30, odd);
		const dotted = waited(`${head}(!1, 1, 8.) c4\n`, "(!1,", 24);
		check("and the dots go with the old length", dotted.includes("(!1, 1, 8)") && one(dotted)?.wait === 24, dotted);

		const reset = "#amk 4\n(!1)[$F4 $09]\n#0 (!!1) c4\n";
		const found = remoteAt(read(reset), reset.indexOf("(!!"));
		const key = found?.kind === "reset" ? applied(reset, remoteResetEdit(reset, found, -1)) : reset;
		check(
			"a reset moved to -1 cancels the key-on code",
			key.includes("(!!-1)") && one(key)?.type === 0x08,
			JSON.stringify(one(key)),
		);
	}

	// A type written past the table is read by its byte, which is what `cmdFC` compares.
	{
		const song = `${head}(!1, 255) c4\n`;
		const index = tokenize(song);
		const call = callAt(song, "(!1,");
		const view = call === null ? null : remoteView({ index, loops: readLoops(song, index), construct: call });
		check(
			"a 255 is told as the -1 it writes",
			view?.kind === "call" && view.typeNote === REMOTE_EVENTS.find((event) => event.type === -1)?.note,
		);
	}
}
