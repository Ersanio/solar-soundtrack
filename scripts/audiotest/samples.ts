/**
 * `audiotest`: sample sets through the emulator: `#samples`, a custom
 * instrument, `optimizeSampleUsage` and a `.bnk` bank.
 */

import "../localize";
import { compiler } from "@amk/compiler";
import { bankSlotName } from "@amk/core/hardcoded-tables";
import { SAMPLE_BANK_BYTES, SAMPLE_BANK_SLOTS, emptySample, parseSampleBank } from "@amk/spc/brr";
import { buildSpc } from "@amk/spc/export";
import { check, section } from "../harness";
import { peak, rms, driver, OPTIONS, BY_NAME, resolveSamples, compileToSpc, emu } from "./support";

section("a song-declared sample set still plays");
{
	// One sample instead of twenty. If the writer had fallen back to the driver's
	// set, the directory would be wrong and this would still make noise — so the
	// check that matters is that `@0`'s SRCN 0 now points at the sample we named.
	const only = driver.samples[0].sampleName;
	const spc = compileToSpc(`#amk 4\n#samples { "${only}" }\n#0 t40 o4 v220 q7F ("${only}", $02) l8 c d e f\n`);
	emu.loadSpc(spc);
	emu.render(4000);
	const samples = emu.render(32000);
	check("a one-sample song is audible", peak(samples) > 0.01, `peak ${peak(samples).toFixed(4)}`);
}

section("a custom instrument resolves in the emulator");
{
	// The only end-to-end proof that `@30` works: the driver has to find the
	// instrument table via zero-page $6C, which it only sets while loading a song.
	// A wrong header offset here produces silence or noise, not a wrong timbre.
	const base = "#amk 4\n#samples { #default }\n";
	const entry = "$8F $E0 $00 $02 $B0";

	const custom = compileToSpc(`${base}#instruments { @0 ${entry} }\n#0 t40 o4 v220 q7F @30 l8 c d e f g4 e4 c4 r4\n`);
	emu.loadSpc(custom);
	emu.render(4000);
	const customAudio = emu.render(32000);
	check("@30 is audible", peak(customAudio) > 0.01, `peak ${peak(customAudio).toFixed(4)}`);
	check("@30 has real signal level", rms(customAudio) > 0.001, `rms ${rms(customAudio).toFixed(5)}`);

	// Same sample, different ADSR: @30 must not simply sound like @0.
	const stock = compileToSpc(`${base}#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4\n`);
	emu.loadSpc(stock);
	emu.render(4000);
	const stockAudio = emu.render(32000);
	check("@0 is audible too", peak(stockAudio) > 0.01, `peak ${peak(stockAudio).toFixed(4)}`);

	let identical = true;
	for (let index = 0; index < customAudio.length; index++) {
		if (customAudio[index] !== stockAudio[index]) {
			identical = false;
			break;
		}
	}

	check("the custom envelope changes the sound", !identical);

	// A second entry, so @31 exercises the six-byte stride in the driver. Both
	// need ADSR1 bit 7 set: clearing it selects GAIN mode, and a $00 GAIN byte
	// makes the instrument silent no matter what else is right.
	const two = compileToSpc(
		`${base}#instruments { @0 ${entry} @1 $8F $E0 $00 $02 $B0 }\n#0 t40 o4 v220 q7F @31 l8 c d e f\n`,
	);
	emu.loadSpc(two);
	emu.render(4000);
	check("@31 is audible with two entries defined", peak(emu.render(32000)) > 0.01);
}

section("optimizeSampleUsage does not silence the song");
{
	// The pass replaces unplayed samples with a zero-length one. If usage tracking
	// missed anything, the SPC still looks valid and simply goes quiet — so this
	// renders it and compares against the unoptimised build of the same song.
	const source = "#amk 4\n#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4\n#1 o3 v200 q7D @1 l4 [c e g e]4\n";

	const render = (optimize: boolean): Int16Array => {
		const result = compiler.compile({
			source,
			aramAddress: driver.manifest.localPos,
			options: { ...OPTIONS, optimizeSampleUsage: optimize },
		});
		if (!result.ok || !result.data) {
			throw new Error(result.diagnostics.map((d) => d.message).join("; "));
		}

		const samples = resolveSamples(result.sampleList ?? []);
		const spc = buildSpc({
			songData: result.data,
			driver,
			samples,
			echoBufferSize: result.stats?.echoBufferSize,
			date: new Date(2026, 6, 28),
		}).spc;
		emu.loadSpc(spc);
		emu.render(4000);
		return emu.render(32000);
	};

	const lean = render(true);
	const full = render(false);

	check("an optimised song is still audible", peak(lean) > 0.01, `peak ${peak(lean).toFixed(4)}`);
	check(
		"at the same level as the full build",
		Math.abs(rms(lean) - rms(full)) < 0.0005,
		`rms ${rms(lean).toFixed(5)} vs ${rms(full).toFixed(5)}`,
	);

	// Dropping only unplayed samples must not change a single sample of output.
	let identical = lean.length === full.length;
	if (identical) {
		for (let index = 0; index < lean.length; index++) {
			if (lean[index] !== full[index]) {
				identical = false;
				break;
			}
		}
	}

	check("and byte-for-byte identical, since only unplayed samples went", identical);

	// A song reaching a sample only through raw `$DA` — the tracking hole AMK has.
	const hexSelected = compiler.compile({
		source: "#amk 4\n#0 t40 o4 v220 q7F $DA $01 l8 c d e f\n",
		aramAddress: driver.manifest.localPos,
		options: OPTIONS,
	});
	// Pins that a resolver holds a slot for an unresolvable name: dropping it shifts
	// every later SRCN down, so the song plays the wrong samples. The two lists
	// must be the same length and the kept sample must stay at its own index.
	const holding = resolveSamples(hexSelected.sampleList ?? []);
	check(
		"resolving preserves every slot",
		holding.length === (hexSelected.sampleList ?? []).length,
		`${holding.length} of ${(hexSelected.sampleList ?? []).length}`,
	);

	// And a name that resolves to nothing at all must still hold its position,
	// rather than collapsing the list and renumbering every SRCN after it.
	const withUnknown = resolveSamples([driver.samples[0].sampleName, "no-such-file.brr", driver.samples[1].sampleName]);
	check("an unresolvable name still occupies its slot", withUnknown.length === 3, `${withUnknown.length}`);
	check(
		"the samples around it keep their indices",
		withUnknown[0].sampleName === driver.samples[0].sampleName &&
			withUnknown[2].sampleName === driver.samples[1].sampleName,
		withUnknown.map((s) => s.sampleName).join(", "),
	);

	const hexSamples = holding;
	emu.loadSpc(
		buildSpc({
			songData: hexSelected.data!,
			driver,
			samples: hexSamples,
			echoBufferSize: hexSelected.stats?.echoBufferSize,
			date: new Date(2026, 6, 28),
		}).spc,
	);
	emu.render(4000);
	check("a sample selected by raw $DA survives optimisation", peak(emu.render(32000)) > 0.01);
}

section("a .bnk sample bank plays through the emulator");
{
	// The decisive check for banks. A wrong slot walk, a wrong loop offset or a
	// directory that disagrees with the data all produce noise or silence rather
	// than a wrong timbre, so only rendering settles it.
	//
	// The bank is built here from a bundled sample's own blocks, so the audio has
	// a known-good reference: playing slot 3 of the bank must sound exactly like
	// playing that sample directly.
	const source = driver.samples[9]; // 09 SMW @7.brr — long enough to hear
	const SLOT = 3;

	const bank = new Uint8Array(SAMPLE_BANK_BYTES);
	{
		const image = bank.subarray(12);
		const at = SAMPLE_BANK_SLOTS * 4;
		const start = at + 0x8000;
		const loop = start + source.loopOffset;
		image[SLOT * 4] = start & 0xff;
		image[SLOT * 4 + 1] = (start >> 8) & 0xff;
		image[SLOT * 4 + 2] = loop & 0xff;
		image[SLOT * 4 + 3] = (loop >> 8) & 0xff;
		image.set(source.data, at);
	}

	const slots = parseSampleBank(bank, (index) => bankSlotName("test.bnk", index));
	check("the bank parses to 64 slots", slots.length === SAMPLE_BANK_SLOTS, `${slots.length}`);
	check(
		"the populated slot round-trips the sample's bytes",
		slots[SLOT].data.length === source.data.length && slots[SLOT].loopOffset === source.loopOffset,
		`${slots[SLOT].data.length} vs ${source.data.length} bytes`,
	);

	// Resolve bank slots alongside the bundled library, as the app does.
	const withBank = new Map(BY_NAME);
	for (const slot of slots) {
		withBank.set(slot.sampleName, slot);
	}

	const options = {
		sampleNames: [...OPTIONS.sampleNames, "test.bnk"],
		sampleGroups: OPTIONS.sampleGroups,
	};

	const render = (mml: string, extra: Record<string, unknown> = {}): Int16Array => {
		const result = compiler.compile({
			source: mml,
			aramAddress: driver.manifest.localPos,
			options: { ...options, ...extra },
		});
		if (!result.ok || !result.data) {
			throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
		}

		const samples = (result.sampleList ?? []).map((name) => withBank.get(name) ?? emptySample(name));
		emu.loadSpc(
			buildSpc({
				songData: result.data,
				driver,
				samples,
				echoBufferSize: result.stats?.echoBufferSize,
				date: new Date(2026, 6, 28),
			}).spc,
		);
		emu.render(4000);
		return emu.render(32000);
	};

	// $F3 selects the slot by SRCN, the only way a bank sample is reachable.
	const fromBank = render(`#amk 4\n#samples { "test.bnk" }\n#0 t40 o4 v220 q7F $F3 $0${SLOT} $02 l1 c c\n`);
	check("a bank slot is audible", peak(fromBank) > 0.01, `peak ${peak(fromBank).toFixed(4)}`);

	// The same sample, reached the ordinary way, at the same SRCN.
	const direct = render(`#amk 4\n#samples { #default }\n#0 t40 o4 v220 q7F $F3 $09 $02 l1 c c\n`);
	check("so is the same sample played directly", peak(direct) > 0.01, `peak ${peak(direct).toFixed(4)}`);
	check(
		"and the bank slot sounds identical to it",
		fromBank.length === direct.length && fromBank.every((value, index) => value === direct[index]),
		`rms ${rms(fromBank).toFixed(5)} vs ${rms(direct).toFixed(5)}`,
	);

	// Optimisation must not disturb a slot the song actually plays.
	const unoptimised = render(`#amk 4\n#samples { "test.bnk" }\n#0 t40 o4 v220 q7F $F3 $0${SLOT} $02 l1 c c\n`, {
		optimizeSampleUsage: false,
	});
	check(
		"optimising a bank leaves the played slot untouched",
		fromBank.every((value, index) => value === unoptimised[index]),
		`rms ${rms(fromBank).toFixed(5)} vs ${rms(unoptimised).toFixed(5)}`,
	);
}
