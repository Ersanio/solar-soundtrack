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

function compileToSpc(source: string, muteChannels = 0): Uint8Array {
	const result = compiler.compile({ source, aramAddress: plan.localPos });
	if (!result.ok || !result.data) {
		throw new Error(result.diagnostics.map((d) => `${d.code} ${d.message}`).join("; "));
	}
	return buildSpc({
		songData: result.data,
		driver,
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

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);