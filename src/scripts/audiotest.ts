/**
 * End-to-end audio check: MML -> SPC -> actual PCM samples.
 *
 * Runs the emulator through `src/spc/wasm-host.ts`, the same host the browser
 * uses — it is deliberately DOM-free so the audio path can be tested headless.
 * That means this script covers the real glue rather than a stand-in.
 *
 * This is what proves the whole pipeline: if the compiler, the driver layout,
 * the sample directory or the CPUIO handshake were wrong, the emulator would
 * run and produce silence.
 *
 *   npm run audiotest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { compilers } from "../src/compilers";
import { EMPTY_SAMPLE_NAME, bankSlotName } from "../src/compilers/addmusick/tables";
import {
	SAMPLE_BANK_BYTES,
	SAMPLE_BANK_SLOTS,
	type BrrSample,
	emptySample,
	parseSampleBank,
} from "../src/spc/brr";
import { loadDriver } from "../src/spc/driver";
import { buildSpc } from "../src/spc/export";
import { planAram } from "../src/spc/layout";
import { instantiate } from "../src/spc/wasm-host";

const PUBLIC = join(import.meta.dirname, "..", "public");

// --- driver bundle loading (same shim as spctest) ---------------------------
const resp = (b: Buffer, ct: string) => ({
	ok: true,
	status: 200,
	headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? ct : null) },
	async arrayBuffer() {
		return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
	},
	async json() {
		return JSON.parse(b.toString("utf8"));
	},
});
globalThis.fetch = (async (input: string) => {
	const path = join(PUBLIC, decodeURI(String(input)));
	try {
		const bytes = readFileSync(path);
		return resp(bytes, path.endsWith(".json") ? "application/json" : "application/octet-stream");
	} catch {
		return resp(Buffer.from("<!doctype html>"), "text/html");
	}
}) as unknown as typeof fetch;

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
	if (condition) console.log(`  ok    ${name}`);
	else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}

/** Peak absolute amplitude, as a fraction of full scale. */
function peak(samples: Int16Array): number {
	let max = 0;
	for (const sample of samples) max = Math.max(max, Math.abs(sample));
	return max / 32768;
}

function rms(samples: Int16Array): number {
	let sum = 0;
	for (const sample of samples) sum += sample * sample;
	return Math.sqrt(sum / samples.length) / 32768;
}

// ---------------------------------------------------------------------------

const driver = await loadDriver();
const plan = planAram(driver);
const compiler = compilers.get("addmusick")!;

/** What the host would pass: every name the driver bundle can resolve. */
const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};
const BY_NAME = new Map(driver.samples.map((sample) => [sample.sampleName, sample]));
BY_NAME.set(EMPTY_SAMPLE_NAME, emptySample(EMPTY_SAMPLE_NAME));

/**
 * Resolves names to samples the way the app does, preserving positions.
 *
 * Dropping an unresolvable name would shift every later SRCN down and rewire the
 * directory — which is exactly the bug this helper was written with, and it made
 * a `$DA`-selected instrument play silence while an `@`-selected one survived by
 * happening to sit at index 0.
 */
function resolveSamples(names: readonly string[]): BrrSample[] {
	return names.map((name) => BY_NAME.get(name) ?? emptySample(name));
}

function compileToSpc(source: string, muteChannels = 0): Uint8Array {
	const result = compiler.compile({ source, aramAddress: plan.localPos, options: OPTIONS });
	if (!result.ok || !result.data) {
		throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	}
	// Resolve the compiler's own list, exactly as the app does. Passing
	// `driver.samples` regardless would defeat the point of every `#samples` test.
	const samples = resolveSamples(result.sampleList ?? driver.samples.map((s) => s.sampleName));

	return buildSpc({
		songData: result.data,
		driver,
		samples,
		plan,
		tags: result.stats?.tags,
		seconds: result.stats?.seconds,
		echoBufferSize: result.stats?.echoBufferSize,
		muteChannels,
		date: new Date(2026, 6, 28),
	}).spc;
}

console.log("\nemulator boots");
const emu = instantiate(new WebAssembly.Module(readFileSync(join(PUBLIC, "player", "spc.wasm"))));
check("wasm instantiated and main() ran", true);

console.log("\na compiled song actually makes sound");
{
	const spc = compileToSpc(`#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4
#1 o3 v200 q7D @1 l4 [c e g e]4
`);
	emu.loadSpc(spc);
	// Discard the first moments: the driver needs a few ticks to key on.
	emu.render(4000);
	const samples = emu.render(32000); // one second at 32 kHz

	check("output is not silent", peak(samples) > 0.01, `peak ${peak(samples).toFixed(4)}`);
	check("output has real signal level", rms(samples) > 0.001, `rms ${rms(samples).toFixed(5)}`);
	check("output does not clip constantly", peak(samples) <= 1.0, `peak ${peak(samples).toFixed(4)}`);

	// Both channels should carry audio: a dead channel means the sample
	// directory or a pan command went wrong.
	const left = samples.filter((_, i) => i % 2 === 0);
	const right = samples.filter((_, i) => i % 2 === 1);
	check("left channel has signal", rms(Int16Array.from(left)) > 0.001);
	check("right channel has signal", rms(Int16Array.from(right)) > 0.001);
}

console.log("\nsilence really is silent (control)");
{
	// Rests only: proves the non-silence check above is measuring our song and
	// not some artefact of the driver or leftover state.
	const spc = compileToSpc("#amk 4\n#0 t40 o4 v220 @0 l1 r r r r\n");
	emu.loadSpc(spc);
	emu.render(4000);
	const samples = emu.render(32000);
	check("a song of rests produces near-silence", peak(samples) < 0.01, `peak ${peak(samples).toFixed(4)}`);
}

console.log("\nnotes differ audibly from each other");
{
	const render = (mml: string) => {
		emu.loadSpc(compileToSpc(mml));
		emu.render(4000);
		return emu.render(16000);
	};
	const low = render("#amk 4\n#0 t40 o2 v220 q7F @0 l1 c c c c\n");
	const high = render("#amk 4\n#0 t40 o5 v220 q7F @0 l1 c c c c\n");

	// Not a spectral test — just that two different pitches are not identical
	// buffers, which would mean the note byte never reached the DSP.
	let identical = low.length === high.length;
	if (identical) {
		for (let i = 0; i < low.length; i++) {
			if (low[i] !== high[i]) {
				identical = false;
				break;
			}
		}
	}
	check("o2 and o5 render differently", !identical);
	check("both are audible", peak(low) > 0.01 && peak(high) > 0.01, `${peak(low).toFixed(3)} / ${peak(high).toFixed(3)}`);
}

console.log("\nfast-forward lands somewhere different");
{
	const spc = compileToSpc(`#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g a b > c < b a g f e d c r
`);
	emu.loadSpc(spc);
	const fromStart = emu.render(8000);

	emu.loadSpc(spc);
	emu.skip(3); // seconds
	const fromThree = emu.render(8000);

	let identical = true;
	for (let i = 0; i < fromStart.length; i++) {
		if (fromStart[i] !== fromThree[i]) {
			identical = false;
			break;
		}
	}
	check("skipping 3s changes the output", !identical);
	check("still audible after skipping", peak(fromThree) > 0.005, `peak ${peak(fromThree).toFixed(4)}`);
}

console.log("\nmuting a channel takes it out of the mix");
{
	// Two clearly different parts, so muting either one is audible in the level
	// rather than just in the bytes.
	const source = `#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4
#1 o3 v200 q7D @1 l4 [c e g e]4
`;
	const render = (muteChannels: number): Int16Array => {
		emu.loadSpc(compileToSpc(source, muteChannels));
		emu.render(4000);
		return emu.render(32000);
	};

	const both = render(0b00);
	const noSecond = render(0b10);
	const noFirst = render(0b01);
	const neither = render(0b11);

	check("muting one channel lowers the level", rms(noSecond) < rms(both), `${rms(noSecond).toFixed(5)} vs ${rms(both).toFixed(5)}`);
	check("muting the other channel also lowers it", rms(noFirst) < rms(both), `${rms(noFirst).toFixed(5)} vs ${rms(both).toFixed(5)}`);
	check("each channel is still audible alone", peak(noSecond) > 0.01 && peak(noFirst) > 0.01, `${peak(noSecond).toFixed(3)} / ${peak(noFirst).toFixed(3)}`);
	check("muting either leaves a different mix", rms(noFirst).toFixed(6) !== rms(noSecond).toFixed(6));
	check("muting every used channel is silent", peak(neither) < 0.01, `peak ${peak(neither).toFixed(4)}`);

	// Muting must not disturb the song it was derived from.
	check("an unmuted build is unchanged", rms(render(0b00)).toFixed(6) === rms(both).toFixed(6));
}

console.log("\na song-declared sample set still plays");
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

console.log("\na custom instrument resolves in the emulator");
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

console.log("\noptimizeSampleUsage does not silence the song");
{
	// The pass replaces unplayed samples with a zero-length one. If usage tracking
	// missed anything, the SPC still looks valid and simply goes quiet — so this
	// renders it and compares against the unoptimised build of the same song.
	const source = "#amk 4\n#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4\n#1 o3 v200 q7D @1 l4 [c e g e]4\n";

	const render = (optimize: boolean): Int16Array => {
		const result = compiler.compile({
			source,
			aramAddress: plan.localPos,
			options: { ...OPTIONS, optimizeSampleUsage: optimize },
		});
		if (!result.ok || !result.data) throw new Error(result.diagnostics.map((d) => d.message).join("; "));
		const samples = resolveSamples(result.sampleList ?? []);
		const spc = buildSpc({
			songData: result.data,
			driver,
			samples,
			plan,
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
	check("at the same level as the full build", Math.abs(rms(lean) - rms(full)) < 0.0005,
		`rms ${rms(lean).toFixed(5)} vs ${rms(full).toFixed(5)}`);

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
		aramAddress: plan.localPos,
		options: OPTIONS,
	});
	// Pins the hazard that made the check above fail while it was being written: a
	// resolver that drops unresolvable names instead of holding their slots shifts
	// every later SRCN down, so the song plays the wrong samples. The two lists
	// must be the same length and the kept sample must stay at its own index.
	const holding = resolveSamples(hexSelected.sampleList ?? []);
	check("resolving preserves every slot", holding.length === (hexSelected.sampleList ?? []).length,
		`${holding.length} of ${(hexSelected.sampleList ?? []).length}`);

	// And a name that resolves to nothing at all must still hold its position,
	// rather than collapsing the list and renumbering every SRCN after it.
	const withUnknown = resolveSamples([driver.samples[0].sampleName, "no-such-file.brr", driver.samples[1].sampleName]);
	check("an unresolvable name still occupies its slot", withUnknown.length === 3, `${withUnknown.length}`);
	check("the samples around it keep their indices",
		withUnknown[0].sampleName === driver.samples[0].sampleName &&
			withUnknown[2].sampleName === driver.samples[1].sampleName,
		withUnknown.map((s) => s.sampleName).join(", "));

	const hexSamples = holding;
	emu.loadSpc(
		buildSpc({
			songData: hexSelected.data!,
			driver,
			samples: hexSamples,
			plan,
			echoBufferSize: hexSelected.stats?.echoBufferSize,
			date: new Date(2026, 6, 28),
		}).spc,
	);
	emu.render(4000);
	check("a sample selected by raw $DA survives optimisation", peak(emu.render(32000)) > 0.01);
}

console.log("\na .bnk sample bank plays through the emulator");
{
	// The decisive check for banks. A wrong slot walk, a wrong loop offset or a
	// directory that disagrees with the data all produce noise or silence rather
	// than a wrong timbre, so only rendering settles it.
	//
	// The bank is built here from a bundled sample's own blocks, so the audio has
	// a known-good reference: playing slot 3 of the bank must sound exactly like
	// playing that sample directly.
	const source = driver.samples[9]; // 0A SMW @9.brr — long enough to hear
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
	for (const slot of slots) withBank.set(slot.sampleName, slot);

	const options = {
		sampleNames: [...OPTIONS.sampleNames, "test.bnk"],
		sampleGroups: OPTIONS.sampleGroups,
	};

	const render = (mml: string, extra: Record<string, unknown> = {}): Int16Array => {
		const result = compiler.compile({ source: mml, aramAddress: plan.localPos, options: { ...options, ...extra } });
		if (!result.ok || !result.data) throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
		const samples = (result.sampleList ?? []).map((name) => withBank.get(name) ?? emptySample(name));
		emu.loadSpc(
			buildSpc({
				songData: result.data,
				driver,
				samples,
				plan,
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
	const direct = render(
		`#amk 4\n#samples { #default }\n#0 t40 o4 v220 q7F $F3 $09 $02 l1 c c\n`,
	);
	check("so is the same sample played directly", peak(direct) > 0.01, `peak ${peak(direct).toFixed(4)}`);
	check(
		"and the bank slot sounds identical to it",
		fromBank.length === direct.length && fromBank.every((value, index) => value === direct[index]),
		`rms ${rms(fromBank).toFixed(5)} vs ${rms(direct).toFixed(5)}`,
	);

	// Optimisation must not disturb a slot the song actually plays.
	const unoptimised = render(
		`#amk 4\n#samples { "test.bnk" }\n#0 t40 o4 v220 q7F $F3 $0${SLOT} $02 l1 c c\n`,
		{ optimizeSampleUsage: false },
	);
	check(
		"optimising a bank leaves the played slot untouched",
		fromBank.every((value, index) => value === unoptimised[index]),
		`rms ${rms(fromBank).toFixed(5)} vs ${rms(unoptimised).toFixed(5)}`,
	);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);