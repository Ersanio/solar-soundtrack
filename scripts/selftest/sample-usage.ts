/**
 * `selftest`: `optimizeSampleUsage`, a `.bnk` sample bank under `#samples`,
 * sample importance, and which samples the song plays.
 */

import "../localize";
import type { CompileResult } from "@amk/core/types";
import { check, section } from "../harness";
import { compile, STOCK, LIBRARY } from "./support";

section("optimizeSampleUsage");
{
	const EMPTY = "EMPTY.brr";
	const names = (result: CompileResult): readonly string[] => result.sampleList ?? [];
	const kept = (result: CompileResult): number => names(result).filter((name) => name !== EMPTY).length;
	const run = (source: string, optimize?: boolean) =>
		compile(source, 0x3e00, { ...LIBRARY, optimizeSampleUsage: optimize });

	// On by default, as in AddmusicK (globals.cpp:40; its -u flag turns it off).
	const oneInstrument = run("#amk 4\n#0 o4 @0 c4\n");
	check("the list keeps its length", names(oneInstrument).length === 20, `${names(oneInstrument).length}`);
	check("only the played sample survives", kept(oneInstrument) === 1, `${kept(oneInstrument)} kept`);
	check("and it stays at its own SRCN", names(oneInstrument)[0] === STOCK[0], names(oneInstrument)[0]);

	const off = run("#amk 4\n#0 o4 @0 c4\n", false);
	check("optimizeSampleUsage: false keeps everything", kept(off) === 20, `${kept(off)} kept`);

	// @0 is SRCN 0 and @1 is SRCN 1, so two instruments keep two samples.
	const two = run("#amk 4\n#0 o4 @0 c4\n#1 o4 @1 c4\n");
	check("two instruments keep two samples", kept(two) === 2, `${kept(two)} kept`);

	// Importance does not follow from having written a name out; it comes from
	// the host, and the "importance comes from the host" section covers it.

	// Nothing is important by default here, so an unplayed group member goes.
	const group = run("#amk 4\n#samples { #optimized }\n#0 o4 @0 c4\n");
	check(
		"an unplayed group member is dropped",
		kept(group) === 1 && names(group).length === 5,
		`${kept(group)} of ${names(group).length}`,
	);

	// Every path that selects a sample has to mark it, or the pass silences it.
	for (const [source, expected, label] of [
		["#amk 4\n#0 o4 @0 c4\n", 1, "@n"],
		["#amk 4\n#0 o4 $F3 $07 $02 c4\n", 1, "$F3"],
		["#amk 4\n#0 o4 $DA $05 c4\n", 1, "raw $DA, which AMK itself misses"],
		["#amk 4\n#samples { #default }\n#instruments { @9 $8F $E0 $00 $02 $B0 }\n#0 o4 @30 c4\n", 1, "@30"],
		['#amk 4\n#samples { #default }\n#0 o4 ("' + STOCK[9] + '", $02) c4\n', 1, "a sample load"],
		["#amk 4\n(!1)[$F3 $07 $02]\n#0 o4 (!1, -1) c4\n", 1, "$F3 inside remote code"],
	] as const) {
		const result = run(source);
		check(
			`${label} marks its sample as used`,
			result.ok && kept(result) >= expected,
			result.ok ? `${kept(result)} kept` : result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// A song that plays nothing at all still gets a full-length directory.
	const silent = run("#amk 4\n#0 o4 l1 r r\n");
	check("a song with no instrument keeps the directory length", names(silent).length === 20);
}

section("#samples with a .bnk sample bank");
{
	const names = (result: CompileResult): readonly string[] => result.sampleList ?? [];
	const run = (source: string, extra: Record<string, unknown> = {}) =>
		compile(source, 0x3e00, { ...LIBRARY, ...extra });

	// A bank contributes all 64 slots, blanks included. Keeping the blanks is what
	// holds a ported song's SRCNs where the original game put them.
	const bank = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 c4\n', { optimizeSampleUsage: false });
	check("a bank compiles", bank.ok, bank.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	check("it contributes 64 entries", names(bank).length === 64, `${names(bank).length}`);
	check("slot 0 is named :00", names(bank)[0] === "zelda.bnk:00", names(bank)[0]);
	check("slot 63 is named :3F", names(bank)[63] === "zelda.bnk:3F", names(bank)[63]);

	// After a group, the bank's slots start at that group's length.
	const after = run('#amk 4\n#samples { #default "zelda.bnk" }\n#0 o4 @0 c4\n', { optimizeSampleUsage: false });
	check("#default then a bank puts slot 0 at SRCN 20", names(after)[20] === "zelda.bnk:00", names(after)[20]);
	check("and the whole list is 84 long", names(after).length === 84, `${names(after).length}`);

	// A bank is addressed positionally. Referencing one by name where a single
	// sample is expected has to fail, because only slot names are in the list.
	for (const [source, code, label] of [
		[
			'#amk 4\n#samples { "zelda.bnk" }\n#instruments { "zelda.bnk" $8F $E0 $00 $02 $B0 }\n#0 c4\n',
			"AMK0089",
			"a bank as an #instruments base",
		],
		['#amk 4\n#samples { "zelda.bnk" }\n#0 o4 ("zelda.bnk", $02) c4\n', "AMK0132", "a bank as a sample load"],
	] as const) {
		const result = run(source);
		check(
			`${label} is rejected with ${code}`,
			!result.ok && result.diagnostics.some((d) => d.code === code),
			result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "),
		);
	}

	// $F3 addresses a slot by SRCN, which is the only way to reach one.
	const played = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 $F3 $05 $02 c4\n');
	check(
		"a slot reached by $F3 survives optimisation",
		played.ok && names(played)[5] === "zelda.bnk:05",
		`${names(played)[5]}`,
	);
	check("its unplayed neighbours do not", names(played)[6] === "EMPTY.brr", names(played)[6]);
}

section("importance comes from the host, not from the syntax");
{
	const names = (result: CompileResult): readonly string[] => result.sampleList ?? [];
	const kept = (result: CompileResult): number => names(result).filter((n) => n !== "EMPTY.brr").length;
	const run = (source: string, important: readonly string[] = []) =>
		compile(source, 0x3e00, { ...LIBRARY, importantSamples: important });

	// The rule AMK uses — a name written out in #samples is important — is gone.
	// A checkbox is a better signal of intent than having typed a filename.
	const unmarked = run('#amk 4\n#samples { "kick.brr" "drums/snare.brr" }\n#0 o4 $F3 $00 $02 c4\n');
	check("an unmarked named sample is reclaimed when unplayed", kept(unmarked) === 1, `${kept(unmarked)} kept`);

	const marked = run('#amk 4\n#samples { "kick.brr" "drums/snare.brr" }\n#0 o4 $F3 $00 $02 c4\n', ["drums/snare.brr"]);
	check("marking it important keeps it", kept(marked) === 2, `${kept(marked)} kept`);
	check("and it stays at its own SRCN", names(marked)[1] === "drums/snare.brr", names(marked)[1]);

	// Group members are no different — importance is per name, wherever it came from.
	const group = run("#amk 4\n#samples { #optimized }\n#0 o4 @0 c4\n", [STOCK[3]]);
	check("an important group member is kept", names(group)[3] === STOCK[3], names(group)[3]);
	check("an unimportant one is not", names(group)[2] === "EMPTY.brr", names(group)[2]);

	// Bank slots take part too.
	const slot = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 c4\n', ["zelda.bnk:07"]);
	check("an important bank slot is kept", names(slot)[7] === "zelda.bnk:07", names(slot)[7]);
	check("an unimportant slot is emptied", names(slot)[8] === "EMPTY.brr", names(slot)[8]);

	// The implicit `#default` fallback never goes through `pushSample`, so its
	// importance is honoured separately — most songs omit `#samples`.
	const implicitImportant = run("#amk 4\n#0 o4 @0 c4\n", [STOCK[9], STOCK[12]]);
	check(
		"the implicit #default fallback honours importance",
		names(implicitImportant)[9] === STOCK[9] && names(implicitImportant)[12] === STOCK[12],
		`[9]=${names(implicitImportant)[9]} [12]=${names(implicitImportant)[12]}`,
	);
	check("and still reclaims the rest", names(implicitImportant)[11] === "EMPTY.brr", names(implicitImportant)[11]);
	check(
		"an explicit #samples { #default } agrees with it",
		names(run("#amk 4\n#samples { #default }\n#0 o4 @0 c4\n", [STOCK[9], STOCK[12]])).join() ===
			names(implicitImportant).join(),
	);

	// `stats.sampleNames` is what the song asked for, before anything was emptied —
	// which is how the browser can say a sample is not in the song at all.
	const asked = run("#amk 4\n#0 o4 @0 c4\n");
	check(
		"stats.sampleNames is the pre-optimisation list",
		asked.stats?.sampleNames.length === 20 && !asked.stats?.sampleNames.includes("EMPTY.brr"),
		`${asked.stats?.sampleNames.length} names, EMPTY present: ${asked.stats?.sampleNames.includes("EMPTY.brr")}`,
	);
	check("while sampleList is the optimised one", names(asked).includes("EMPTY.brr"));
}

section("which samples the song actually plays");
{
	const used = (result: CompileResult): readonly string[] => result.stats?.usedSampleNames ?? [];
	const run = (source: string) => compile(source, 0x3e00, LIBRARY);

	// Being included and being played are different things, and the browser marks
	// them differently, so the compiler has to tell them apart.
	const one = run("#amk 4\n#0 o4 @0 c4\n");
	check("only the played sample is reported used", used(one).length === 1, used(one).join(", "));
	check("and it is the right one", used(one)[0] === STOCK[0], used(one)[0]);
	check("the asked-for list is still the whole group", one.stats?.sampleNames.length === 20);

	// instrToSample[14] is SRCN 0x0D, i.e. the fourteenth entry — the case in the
	// filenames where the instrument number and the SRCN differ.
	const fourteen = run("#amk 4\n#0 o4 @14 c4\n");
	check("@14 marks SRCN 0x0D as used", used(fourteen)[0] === STOCK[0x0d], used(fourteen).join(", "));

	// Every route into a sample counts, not just `@n`.
	check("$F3 counts", used(run("#amk 4\n#0 o4 $F3 $07 $02 c4\n"))[0] === STOCK[7], "");
	const load = run(`#amk 4\n#samples { #default }\n#0 o4 ("${STOCK[9]}", $02) c4\n`);
	check("a sample load counts", used(load).includes(STOCK[9]), used(load).join(", "));
	const custom = run("#amk 4\n#samples { #default }\n#instruments { @9 $8F $E0 $00 $02 $B0 }\n#0 o4 @30 c4\n");
	check("a custom instrument's own sample counts", used(custom).includes(STOCK[0x0a]), used(custom).join(", "));

	// Bank slots report by slot name, which is what the browser rows are keyed on.
	const bank = run('#amk 4\n#samples { "zelda.bnk" }\n#0 o4 $F3 $05 $02 c4\n');
	check("a played bank slot is reported by its slot name", used(bank)[0] === "zelda.bnk:05", used(bank).join(", "));

	// A name listed twice must be reported once, whichever SRCN was played.
	const twice = run("#amk 4\n#samples { #default #default }\n#0 o4 @0 c4\n");
	check("a duplicated name is reported once", used(twice).length === 1, used(twice).join(", "));

	const silent = run("#amk 4\n#0 o4 l1 r r\n");
	check("a song playing nothing reports nothing used", used(silent).length === 0, used(silent).join(", "));
}
