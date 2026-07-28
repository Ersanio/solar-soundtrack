/**
 * End-to-end audio check: MML -> SPC -> actual PCM samples.
 *
 * The vendored `spc.js` glue is a web-only Emscripten build, so this loads
 * `spc.wasm` directly with stubbed runtime imports instead. Export names are
 * minified; the mapping below is read out of the glue:
 *
 *   j __wasm_call_ctors   l _loadSPC(ptr,len)   n _skipSPC(seconds)   q _free
 *   k _main(argc,argv)    m _playSPC(buf,count) p _malloc(size)       i memory
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
import { PLAYLIST_MARKUP_ID } from "../src/spc/player";

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

// --- the emulator -----------------------------------------------------------

interface Spc700 {
	loadSPC(spc: Uint8Array): void;
	skip(seconds: number): void;
	/** Renders `frames` stereo frames and returns interleaved 16-bit samples. */
	render(frames: number): Int16Array;
}

function createEmulator(): Spc700 {
	const bytes = readFileSync(join(PUBLIC, "player", "spc.wasm"));
	const stdout: number[] = [];

	let memory!: WebAssembly.Memory;
	const u8 = () => new Uint8Array(memory.buffer);

	const imports = {
		a: {
			// ___assert_fail
			a: (condition: number, file: number, line: number) => {
				throw new Error(`wasm assertion failed at line ${line} (cond ${condition}, file ${file})`);
			},
			// _emscripten_asm_const_int
			b: () => 0,
			// _exit
			c: (code: number) => {
				throw new Error(`wasm called exit(${code})`);
			},
			// _fd_write — capture printf so a crash message is visible
			d: (_fd: number, iov: number, iovcnt: number, pnum: number) => {
				const view = new DataView(memory.buffer);
				let written = 0;
				for (let i = 0; i < iovcnt; i++) {
					const ptr = view.getUint32(iov + i * 8, true);
					const len = view.getUint32(iov + i * 8 + 4, true);
					for (let k = 0; k < len; k++) stdout.push(u8()[ptr + k]);
					written += len;
				}
				view.setUint32(pnum, written, true);
				return 0;
			},
			// _fd_seek
			e: () => 0,
			// _emscripten_resize_heap
			f: (requested: number) => {
				const pages = Math.ceil((requested - memory.buffer.byteLength) / 65536);
				try {
					memory.grow(Math.max(pages, 1));
					return 1;
				} catch {
					return 0;
				}
			},
			// _fd_close
			g: () => 0,
			// __emscripten_memcpy_js
			h: (dest: number, src: number, num: number) => {
				u8().copyWithin(dest, src, src + num);
			},
		},
	};

	const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), imports);
	const e = instance.exports as unknown as Record<string, WebAssembly.ExportValue>;
	memory = e.i as WebAssembly.Memory;

	(e.j as () => void)(); // __wasm_call_ctors
	(e.k as (argc: number, argv: number) => number)(0, 0); // _main

	const malloc = e.p as (size: number) => number;
	const free = e.q as (ptr: number) => void;
	const loadSPC = e.l as (ptr: number, len: number) => void;
	const playSPC = e.m as (ptr: number, count: number) => void;
	const skipSPC = e.n as (seconds: number) => void;

	return {
		loadSPC(spc) {
			const ptr = malloc(spc.length);
			u8().set(spc, ptr);
			loadSPC(ptr, spc.length);
			free(ptr);
		},
		skip(seconds) {
			skipSPC(seconds);
		},
		render(frames) {
			const count = frames * 2; // interleaved stereo
			const ptr = malloc(count * 2 + 4);
			playSPC(ptr, count);
			const out = new Int16Array(memory.buffer, ptr, count).slice();
			free(ptr);
			return out;
		},
	};
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

function compileToSpc(source: string): Uint8Array {
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
		date: new Date(2026, 6, 28),
	}).spc;
}

console.log("\nvendored bundle can initialise without throwing");
{
	// The bundle carries a playlist UI that runs at file scope the moment the
	// script evaluates, and dereferences its markup unconditionally. With the
	// markup absent it throws — and because the Emscripten runtime is defined
	// *below* it in the same file, the wasm never gets set up at all. So the
	// markup is injected hidden; these checks keep it covering every lookup.
	const glue = readFileSync(join(PUBLIC, "player", "spc.js"), "utf8");
	const markup = readFileSync(join(PUBLIC, "player", "spc_player.html"), "utf8");

	check("markup is vendored alongside the emulator", markup.length > 1000, `${markup.length} bytes`);
	check("markup root matches what player.ts looks for", markup.includes(`id="${PLAYLIST_MARKUP_ID}"`));

	// Ordering is what makes a throw fatal rather than cosmetic.
	const uiAt = glue.indexOf('getElementById("spc-player-interface")');
	const runtimeAt = glue.indexOf("var moduleOverrides");
	check("UI code sits before the Emscripten runtime", uiAt > 0 && runtimeAt > uiAt, `${uiAt} vs ${runtimeAt}`);

	// Every id and class the script looks up has to exist, or an upgrade throws
	// somewhere new.
	const wanted = new Set<string>();
	for (const m of glue.matchAll(/getElementById\("([^"]+)"\)/g)) wanted.add(`#${m[1]}`);
	for (const m of glue.matchAll(/querySelector\("([^"]+)"\)/g)) wanted.add(m[1]);
	for (const m of glue.matchAll(/getElementsByClassName\("([^"]+)"\)/g)) wanted.add(`.${m[1]}`);

	const missing = [...wanted].filter((selector) => {
		const bare = selector.replace(/^[#.]/, "").split(".")[0];
		return !markup.includes(selector.startsWith("#") ? `id="${bare}"` : bare);
	});
	check(`all ${wanted.size} selectors exist in the markup`, missing.length === 0, missing.join(", "));

	// Hiding the UI is only safe if it does not take keystrokes from the editor.
	check("the bundled UI binds no keyboard handlers", !/addEventListener\("key/.test(glue));
}

console.log("\nemulator boots");
const emu = createEmulator();
check("wasm instantiated and main() ran", true);

console.log("\na compiled song actually makes sound");
{
	const spc = compileToSpc(`#amk 4
#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4
#1 o3 v200 q7D @1 l4 [c e g e]4
`);
	emu.loadSPC(spc);
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
	emu.loadSPC(spc);
	emu.render(4000);
	const samples = emu.render(32000);
	check("a song of rests produces near-silence", peak(samples) < 0.01, `peak ${peak(samples).toFixed(4)}`);
}

console.log("\nnotes differ audibly from each other");
{
	const render = (mml: string) => {
		emu.loadSPC(compileToSpc(mml));
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
	emu.loadSPC(spc);
	const fromStart = emu.render(8000);

	emu.loadSPC(spc);
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

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);