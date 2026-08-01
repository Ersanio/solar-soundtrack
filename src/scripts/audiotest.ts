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

import { compiler } from "../src/compiler";
import { EMPTY_SAMPLE_NAME, bankSlotName } from "../src/compiler/tables";
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
import { SPC_CHANNELS, SPC_SAMPLE_RATE, instantiate } from "../src/spc/wasm-host";
import {
	TICK_POLL_HZ,
	applyChannelMutes,
	createMuteShadow,
	readDriverState,
	readNoteDuration,
	sawTick,
	tickVoice,
} from "../src/spc/driver-state";

const PUBLIC = join(import.meta.dirname, "..", "public");

// --- driver bundle loading (same shim as spctest) ---------------------------
const resp = (b: Buffer, ct: string) => ({
	ok: true,
	status: 200,
	headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? ct : null) },
	arrayBuffer() {
		return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
	},
	json() {
		return JSON.parse(b.toString("utf8")) as unknown;
	},
});
globalThis.fetch = ((input: string) => {
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

function compileToSpc(source: string): Uint8Array {
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
		seconds: result.stats?.tagSeconds,
		echoBufferSize: result.stats?.echoBufferSize,
		date: new Date(2026, 6, 28),
	}).spc;
}

/** Frames per emulated block, matching the rate the worklet polls the driver at. */
const BLOCK = SPC_SAMPLE_RATE / TICK_POLL_HZ;

/**
 * Renders with channels muted the way the app mutes them: by writing the
 * driver's mute register after every emulated block, exactly as `worklet.ts`
 * does. Nothing about the SPC image changes.
 *
 * `warmup` frames are rendered and thrown away first, so the song is past its
 * boot handshake by the time the level is measured; keep it and `frames` whole
 * multiples of {@link BLOCK}. `maskAt` is given the frame the block starts on,
 * counted from the very beginning, so a test can mute partway through.
 */
function renderMuted(spc: Uint8Array, warmup: number, frames: number, maskAt: (frame: number) => number): Int16Array {
	emu.loadSpc(spc);
	const shadow = createMuteShadow();
	const out = new Int16Array(frames * SPC_CHANNELS);

	let written = 0;
	for (let done = 0; done < warmup + frames; done += BLOCK) {
		const chunk = emu.renderView(Math.min(BLOCK, warmup + frames - done));
		if (done >= warmup) {
			out.set(chunk, written);
			written += chunk.length;
		}
		// After the block, like the worklet: a mask posted now takes effect on
		// the next one.
		applyChannelMutes(emu.aram(), maskAt(done), shadow);
	}
	return out.subarray(0, written);
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

console.log("\nthe mute register is composed, not assigned");
{
	// A pure check of the bookkeeping, with no emulator involved: a song can mute
	// its own channels through `$FA $05`, and taking a mixer mute away must not
	// take those with it.
	const aram = new Uint8Array(0x10000);
	const shadow = createMuteShadow();

	aram[0x5e] = 0b0000_1000; // the song's own doing
	aram[0x0241 + 2 * 1] = 200;

	applyChannelMutes(aram, 0b0000_0010, shadow);
	check("a mixer mute joins the song's own", aram[0x5e] === 0b0000_1010, `$5E = ${aram[0x5e].toString(2)}`);
	check("the muted channel's volume is taken", aram[0x0241 + 2 * 1] === 0);
	check("and its bit is flagged for rewriting", (aram[0x5c] & 0b10) !== 0);

	aram[0x5c] = 0;
	applyChannelMutes(aram, 0, shadow);
	check("lifting it leaves the song's own mute", aram[0x5e] === 0b0000_1000, `$5E = ${aram[0x5e].toString(2)}`);
	check("and hands the volume back", aram[0x0241 + 2 * 1] === 200);

	// A volume written while muted is the one that comes back.
	applyChannelMutes(aram, 0b0000_0010, shadow);
	aram[0x0241 + 2 * 1] = 90; // as a `v` command mid-mute would
	applyChannelMutes(aram, 0b0000_0010, shadow);
	aram[0x5c] = 0;
	applyChannelMutes(aram, 0, shadow);
	check("a volume set during the mute survives it", aram[0x0241 + 2 * 1] === 90, `got ${aram[0x0241 + 2 * 1]}`);
}

console.log("\nmuting a channel takes it out of the mix");
{
	// Two clearly different parts, so muting either one is audible in the level
	// rather than just in the bytes.
	const source = `#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4
#1 o3 v200 q7D @1 l4 [c e g e]4
`;
	const spc = compileToSpc(source);
	const render = (mask: number): Int16Array => renderMuted(spc, 4000, 32000, () => mask);

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
	check("an unmuted render is unchanged", rms(render(0b00)).toFixed(6) === rms(both).toFixed(6));
}

console.log("\na muted channel goes on carrying the song");
{
	// The whole point of muting at the driver rather than by blanking the
	// channel's pointer. Everything song-global here lives in `#0`: the tempo,
	// and the `/` that says where the intro ends. `#0` is also the shortest
	// channel, and the driver turns the song over when its *first* channel runs
	// out of data — so a `#0` that stopped being read would move the loop point
	// as well as losing the tempo.
	const source = `#amk 4
#0 t192 v200 @0 o4 q7F a1 / g1
#1 v180 @1 o3 q7F c1 d1 e1
`;
	const stats = compiler.compile({ source, aramAddress: plan.localPos, options: OPTIONS }).stats!;
	const spc = compileToSpc(source);
	// Every pass after the first is the loop on its own — the intro is played
	// once — so that is the gap between turnovers.
	const expected = stats.loopTicks;

	/** Ticks counted and loop turnovers seen over `seconds`, with `mask` held. */
	function follow(mask: number, seconds: number) {
		emu.loadSpc(spc);
		const shadow = createMuteShadow();

		// Let the song key on, so there is a voice to count off.
		for (let done = 0; done < SPC_SAMPLE_RATE / 20; done += BLOCK) {
			emu.renderView(BLOCK);
			applyChannelMutes(emu.aram(), mask, shadow);
		}

		const voice = tickVoice(emu.aram());
		let previous = readNoteDuration(emu.aram(), voice);
		let pointer = readDriverState(emu.aram()).trackPointers[0];
		let ticks = 0;
		const passes: number[] = [];
		let pending = -1;
		let before = 0;

		for (let frame = 0; frame < SPC_SAMPLE_RATE * seconds; frame += BLOCK) {
			emu.renderView(BLOCK);
			const aram = emu.aram();
			applyChannelMutes(aram, mask, shadow);

			const now = readNoteDuration(aram, voice);
			ticks += sawTick(previous, now);
			previous = now;

			// A 16-bit pointer read from outside the emulator can be caught
			// half-written; a real jump is still there on the next look.
			const next = readDriverState(aram).trackPointers[0];
			if (pending >= 0) {
				if (next < before) passes.push(pending);
				pending = -1;
			} else if (next < pointer) {
				pending = ticks;
				before = pointer;
			}
			pointer = next;
		}
		return { ticks, passes };
	}

	const seconds = 24;
	const open = follow(0b00, seconds);
	const muted = follow(0b01, seconds);
	const gaps = (passes: number[]) => passes.slice(1).map((v, i) => v - passes[i]);
	const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1];

	const openGap = median(gaps(open.passes));
	const mutedGap = median(gaps(muted.passes));

	check(
		`the song turns over every ${expected} ticks, as the compiler says`,
		gaps(open.passes).length >= 2 && Math.abs(openGap - expected) <= 1,
		`${gaps(open.passes).length} passes, median ${openGap}`,
	);
	check(
		"and muting the channel that carries the `/` does not move that",
		gaps(muted.passes).length >= 2 && mutedGap === openGap,
		`${mutedGap} muted vs ${openGap} open`,
	);
	// If `t192` had gone with the channel the driver would fall back to its own
	// tempo and the count would be out by a factor, not by a fraction of a
	// percent. The slack is for the drop-ticks a busy driver loses, which a
	// muted channel loses slightly fewer of.
	check(
		"and it still sets the tempo it declares",
		Math.abs(muted.ticks - open.ticks) < open.ticks * 0.01,
		`${muted.ticks} ticks muted vs ${open.ticks} open, over ${seconds}s`,
	);
	// The channel really was silent for all of that.
	check(
		"while making no sound",
		peak(renderMuted(spc, 4000, 32000, () => 0b11)) < 0.01,
		`peak ${peak(renderMuted(spc, 4000, 32000, () => 0b11)).toFixed(4)}`,
	);
}

console.log("\nmuting cuts a note that is already ringing");
{
	// `$5E` alone only stops the *next* note; the volume has to be taken too.
	// One very long note, muted a third of the way in, so anything still audible
	// afterwards is the ringing note the mute failed to cut.
	const source = "#amk 4\n#0 t20 v220 @0 o4 q7F c1\n";
	const spc = compileToSpc(source);

	const warmup = 32000; // 1s in, well inside the note
	const frames = 32000;
	const cutAt = warmup + 3200; // 100 ms into the measured window

	const open = renderMuted(spc, warmup, frames, () => 0);
	const cut = renderMuted(spc, warmup, frames, (frame) => (frame >= cutAt ? 0b1 : 0));

	// Skip past the cut itself: the driver needs a music tick to write VxVOL.
	const after = (samples: Int16Array) => samples.subarray((3200 + 3200) * SPC_CHANNELS);

	check("the note is ringing to begin with", peak(after(open)) > 0.02, `peak ${peak(after(open)).toFixed(4)}`);
	check("and the mute silences it", peak(after(cut)) < 0.002, `peak ${peak(after(cut)).toFixed(4)}`);
	check("without touching what came before", rms(cut.subarray(0, 3200 * SPC_CHANNELS)) === rms(open.subarray(0, 3200 * SPC_CHANNELS)));
}

console.log("\nunmuting gives the channel its volume back");
{
	const source = "#amk 4\n#0 t60 v220 @0 o4 q7D l8 [c d e f]8\n";
	const spc = compileToSpc(source);

	const warmup = 32000;
	const frames = 96000;
	const lift = warmup + 32000;

	const open = renderMuted(spc, warmup, frames, () => 0);
	const restored = renderMuted(spc, warmup, frames, (frame) => (frame < lift ? 0b1 : 0));
	// The emulator is left where the last render finished, so the register can be
	// read straight out of it.
	const volume = emu.aram()[0x0241];

	const tail = (samples: Int16Array) => samples.subarray(64000 * SPC_CHANNELS);

	check("the track volume register is back", volume === 220, `$0241 = ${volume}`);
	check("the channel is audible again", peak(tail(restored)) > 0.02, `peak ${peak(tail(restored)).toFixed(4)}`);
	check(
		"and at the level it had",
		Math.abs(rms(tail(restored)) - rms(tail(open))) < rms(tail(open)) * 0.1,
		`${rms(tail(restored)).toFixed(5)} vs ${rms(tail(open)).toFixed(5)}`,
	);
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

console.log("\nthe loop really lasts as long as the compiler says");
{
	/**
	 * Times a song's loop against the emulator.
	 *
	 * Each loop opens with one short note and is silent after it, so the gap
	 * between onsets is the period to the sample. First onset to last, so the
	 * threshold-crossing jitter is divided across every loop rather than counted
	 * once per measurement.
	 */
	function measureLoop(source: string, seconds: number): number {
		const emu = instantiate(new WebAssembly.Module(readFileSync(join(PUBLIC, "player", "spc.wasm"))));
		emu.loadSpc(compileToSpc(source));

		const total = SPC_SAMPLE_RATE * seconds;
		const mono = new Float64Array(total);
		for (let at = 0; at < total; at += 32000) {
			const out = emu.render(Math.min(32000, total - at));
			for (let i = 0; i < out.length / 2; i++) mono[at + i] = (out[i * 2] + out[i * 2 + 1]) / 2;
		}

		let loudest = 0;
		for (const value of mono) loudest = Math.max(loudest, Math.abs(value));

		const threshold = loudest * 0.15;
		const quiet = Math.round(0.2 * SPC_SAMPLE_RATE);
		const onsets: number[] = [];
		let silent = quiet;
		for (let i = 0; i < total; i++) {
			if (Math.abs(mono[i]) > threshold) {
				if (silent >= quiet) onsets.push(i);
				silent = 0;
			} else silent++;
		}

		const spans = onsets.length - 1;
		return spans > 1 ? (onsets[spans] - onsets[0]) / spans / SPC_SAMPLE_RATE : NaN;
	}

	// 408 ticks a loop: a 12-tick note and then quiet. Two tempos an octave
	// apart, because AddmusicK's rounding is wrong by a different amount at each
	// and a single reading could be matched by the wrong rate.
	for (const [tempo, seconds] of [
		[54, 60],
		[192, 30],
	] as const) {
		const source = `#amk 4\n#0 t${tempo} v255 @0 o4 q7F c16 r16 r1 r1\n`;
		const stats = compiler.compile({ source, aramAddress: plan.localPos, options: OPTIONS }).stats!;

		const measured = measureLoop(source, seconds);
		const claimed = stats.playback!.mainSeconds;
		const estimate = stats.mainSeconds!;

		check(
			`t${tempo}: the compiler's playback length matches the emulator`,
			Math.abs(measured / claimed - 1) < 0.005,
			`measured ${measured.toFixed(5)}s, claimed ${claimed.toFixed(5)}s (${((measured / claimed - 1) * 100).toFixed(3)}%)`,
		);
		// AddmusicK's rounding happens to land close at some tempos, so the claim
		// worth pinning is the relative one: whatever the tempo, the driver's rate
		// is far nearer the truth than the estimate is.
		const claimedError = Math.abs(measured / claimed - 1);
		const estimateError = Math.abs(measured / estimate - 1);
		check(
			`t${tempo}: and it beats AddmusicK's estimate by a wide margin`,
			claimedError * 5 < estimateError,
			`${(claimedError * 100).toFixed(4)}% vs ${(estimateError * 100).toFixed(4)}%`,
		);
	}
}

console.log("\nthe driver's own ticks are counted exactly");
{
	// This is what the playhead runs on, so it has to be exact rather than close:
	// an error of one tick a pass is a progress bar that walks away from the music.
	/**
	 * Counts ticks over `seconds`, noting the count at each pass of the song.
	 *
	 * Voice 0 carries no subloops in any of these songs, so its music pointer
	 * jumping backwards is the song coming round. That is not a general way to
	 * find the loop — a subloop moves the same pointer — but it is exact here,
	 * and it is the tick count being tested, not the detector.
	 */
	// Reuses the emulator the rest of the file uses: each instance carries a
	// 16 MiB heap, and standing up a dozen of them wedges the process.
	const core = emu;

	function count(spc: Uint8Array, seconds: number) {
		core.loadSpc(spc);
		const block = SPC_SAMPLE_RATE / TICK_POLL_HZ;

		// Let the song key on, so there is a voice to count off.
		core.renderView(SPC_SAMPLE_RATE / 20);
		const voice = tickVoice(core.aram());
		let previous = readNoteDuration(core.aram(), voice);
		let pointer = readDriverState(core.aram()).trackPointers[0];
		let ticks = 0;
		const passes: number[] = [];
		let pending = -1;
		let before = 0;

		for (let frame = 0; frame < SPC_SAMPLE_RATE * seconds; frame += block) {
			core.renderView(block);
			const aram = core.aram();

			const now = readNoteDuration(aram, voice);
			ticks += sawTick(previous, now);
			previous = now;

			// A 16-bit pointer read from outside the emulator can be caught
			// half-written, which looks like a jump backwards and is not one. A real
			// jump is still there on the next look.
			const next = readDriverState(aram).trackPointers[0];
			if (pending >= 0) {
				if (next < before) passes.push(pending);
				pending = -1;
			} else if (next < pointer) {
				pending = ticks;
				before = pointer;
			}
			pointer = next;
		}
		return { ticks, passes };
	}

	const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1];

	for (const [label, source, seconds] of [
		["one channel", "#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n", 24],
		["at the default tempo", "#amk 4\n#0 t54 v200 @0 o4 q7F a1g1e1e1\n", 40],
		[
			"eight channels, where a formula loses ticks",
			"#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n#1 v180 @1 o3 q7F c1c1c1c1\n#2 v160 @2 o4 q7F e1e1e1e1\n" +
				"#3 v160 @3 o3 q7F g1g1g1g1\n#4 v140 @0 o5 q7F a1a1a1a1\n#5 v140 @1 o2 q7F c1c1c1c1\n" +
				"#6 v120 @2 o4 q7F d1d1d1d1\n#7 v120 @3 o3 q7F f1f1f1f1\n",
			24,
		],
	] as const) {
		const stats = compiler.compile({ source, aramAddress: plan.localPos, options: OPTIONS }).stats!;
		const expected = stats.introTicks + stats.loopTicks;
		const { passes } = count(compileToSpc(source), seconds);
		const gaps = passes.slice(1).map((v, i) => v - passes[i]);

		// One tick of slack for where the poll lands relative to the jump itself;
		// the count between two passes is what has to come out right.
		check(
			`${label}: a pass is ${expected} ticks`,
			gaps.length >= 2 && Math.abs(median(gaps) - expected) <= 1,
			`${gaps.length} passes, median ${gaps.length ? median(gaps) : "-"}: ${[...new Set(gaps)].join(", ")}`,
		);
	}

	// A sparse song leaves the driver time to keep up, so the tick rate should
	// land on what the hardware documents: `$51` added to `$49` once per pass of
	// a 500 Hz main loop, a tick every 256 units. `$51` holds the `t` value plus
	// one, which is why the register is read rather than the tempo assumed.
	for (const tempo of [16, 54, 192]) {
		const source = `#amk 4\n#0 t${tempo} v200 @0 o4 q7F a1g1e1e1\n`;
		core.loadSpc(compileToSpc(source));
		// The register holds the boot default until the song's own `t` runs.
		core.renderView(SPC_SAMPLE_RATE / 4);
		const stored = core.aram()[0x51];
		check(`t${tempo}: the driver stores the tempo plus one`, stored === tempo + 1, `$51 reads ${stored}`);

		const seconds = 20;
		const { ticks } = count(compileToSpc(source), seconds);
		const rate = ticks / seconds;
		const documented = (stored * 500) / 256;

		check(
			`t${tempo}: counted ${rate.toFixed(2)} ticks/s against the driver's ${documented.toFixed(2)}`,
			Math.abs(rate / documented - 1) < 0.005,
			`off by ${((rate / documented - 1) * 100).toFixed(3)}%`,
		);
	}

	// A formula cannot do this: the driver drops ticks when the song keeps it
	// busy, so eight channels run measurably slower than the same song on one.
	const oneChannel = "#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n";
	const solo = count(compileToSpc(oneChannel), 24).ticks;
	const full = count(
		compileToSpc(
			"#amk 4\n#0 t192 v200 @0 o4 q7F a1g1e1e1\n#1 v180 @1 o3 q7F c1c1c1c1\n#2 v160 @2 o4 q7F e1e1e1e1\n" +
				"#3 v160 @3 o3 q7F g1g1g1g1\n#4 v140 @0 o5 q7F a1a1a1a1\n#5 v140 @1 o2 q7F c1c1c1c1\n" +
				"#6 v120 @2 o4 q7F d1d1d1d1\n#7 v120 @3 o3 q7F f1f1f1f1\n",
		),
		24,
	).ticks;
	check(
		"a busy song really does tick more slowly",
		full < solo,
		`${full} ticks against ${solo} over the same 24s (${(((full - solo) / solo) * 100).toFixed(2)}%)`,
	);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);