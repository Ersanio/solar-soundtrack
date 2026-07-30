/**
 * Runs the shipped worklet bundle the way the browser will.
 *
 * The audio thread is not a worker thread: an AudioWorkletGlobalScope exposes
 * only ECMAScript, `console`, and the AudioWorklet interfaces. No `fetch`, no
 * `setTimeout`, and — the one that actually bit — no `TextDecoder`, because
 * those are `[Exposed=(Window,Worker)]` and a worklet scope is neither.
 *
 * Node has all of them globally, so `audiotest` cannot catch a worklet reaching
 * for one; the failure only appears in a browser, as a dead play button. This
 * evaluates `public/player/spc-worklet.js` inside a `vm` context holding
 * nothing but that permitted set, then drives the real processor through real
 * render quanta and listens to what comes out.
 *
 *   npm run worklettest
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

import { compiler } from "../src/compilers";
import { loadDriver } from "../src/spc/driver";
import { buildSpc } from "../src/spc/export";
import { planAram } from "../src/spc/layout";
import type { FromWorklet, ToWorklet } from "../src/spc/protocol";

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
	const bytes = readFileSync(path);
	return resp(bytes, path.endsWith(".json") ? "application/json" : "application/octet-stream");
}) as unknown as typeof fetch;

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
	if (condition) console.log(`  ok    ${name}`);
	else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}

const SAMPLE_RATE = 48000; // deliberately not 32000, so resampling is exercised
const QUANTUM = 128;

interface Port {
	onmessage: ((event: { data: ToWorklet }) => void) | null;
	postMessage(message: FromWorklet): void;
	close(): void;
}

interface Processor {
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

/**
 * Everything an AudioWorkletGlobalScope offers, and nothing else. A bare `vm`
 * context starts with only the ECMAScript intrinsics — crucially it has no Node
 * globals — so anything the bundle needs has to be listed here explicitly.
 */
/**
 * The port the next processor will pick up. The scope's `AudioWorkletProcessor`
 * reads it at construction, which is how each processor gets its own.
 */
let nextPort: Port | null = null;

/**
 * One context for the whole run, built on first use.
 *
 * A context per processor is the obvious shape, and it crashes: V8 collects a
 * context whose sandbox object has gone out of scope, and the processor built
 * inside it then dies on the next call with "Not a native context" — a fatal
 * error, not an exception, so nothing can catch it. Sharing one context keeps
 * every processor in a realm that lives as long as the test run.
 */
let shared: {
	registered: new (options: unknown) => Processor;
	module: WebAssembly.Module;
	/** Held, not used: dropping it lets V8 collect the context. */
	scope: object;
} | null = null;

function setupScope(bundle: string, wasm: Uint8Array): NonNullable<typeof shared> {
	let registered: (new (options: unknown) => Processor) | null = null;

	const scope = createContext({
		console,
		sampleRate: SAMPLE_RATE,
		currentTime: 0,
		currentFrame: 0,
		AudioWorkletProcessor: class {
			readonly port = nextPort!;
		},
		registerProcessor: (_name: string, constructor: new (options: unknown) => Processor) => {
			registered = constructor;
		},
		__wasm: wasm,
	});

	runInContext(bundle, scope, { filename: "spc-worklet.js" });
	if (!registered) throw new Error("the bundle registered no processor");

	// Compile inside the context, as the page's posted module would arrive.
	const module = runInContext("new WebAssembly.Module(__wasm)", scope) as WebAssembly.Module;
	return { registered, module, scope };
}

function loadProcessor(bundle: string, wasm: Uint8Array): { processor: Processor; port: Port; sent: FromWorklet[] } {
	const sent: FromWorklet[] = [];
	const port: Port = {
		onmessage: null,
		postMessage: (message) => sent.push(message),
		close: () => {},
	};

	shared ??= setupScope(bundle, wasm);
	nextPort = port;
	const processor = new shared.registered({ processorOptions: { module: shared.module } });

	return { processor, port, sent };
}

/** Pumps `quanta` render blocks and returns the interleaved result. */
function render(processor: Processor, quanta: number): Float32Array {
	const out = new Float32Array(quanta * QUANTUM * 2);
	const left = new Float32Array(QUANTUM);
	const right = new Float32Array(QUANTUM);

	for (let block = 0; block < quanta; block++) {
		left.fill(0);
		right.fill(0);
		processor.process([], [[left, right]], {});
		for (let i = 0; i < QUANTUM; i++) {
			out[(block * QUANTUM + i) * 2] = left[i];
			out[(block * QUANTUM + i) * 2 + 1] = right[i];
		}
	}
	return out;
}

function peak(samples: Float32Array): number {
	let max = 0;
	for (const sample of samples) max = Math.max(max, Math.abs(sample));
	return max;
}

// ---------------------------------------------------------------------------

const driver = await loadDriver();
const plan = planAram(driver);

const result = compiler.compile({
	source: "#amk 4\n#0 t40 o4 v220 q7F @0 l8 c d e f g4 e4 c4 r4\n",
	aramAddress: plan.localPos,
});
if (!result.ok || !result.data) throw new Error("the test song did not compile");
const spc = buildSpc({
	songData: result.data,
	driver,
	samples: driver.samples,
	plan,
	tags: result.stats?.tags,
	seconds: result.stats?.tagSeconds,
	echoBufferSize: result.stats?.echoBufferSize,
	date: new Date(2026, 6, 28),
}).spc;

const bundlePath = join(PUBLIC, "player", "spc-worklet.js");
const bundle = readFileSync(bundlePath, "utf8");
const wasm = new Uint8Array(readFileSync(join(PUBLIC, "player", "spc.wasm")));

console.log("\nthe bundle survives a worklet scope");
const { processor, port, sent } = loadProcessor(bundle, wasm);
check("it registers a processor and constructs", true);
check(
	"constructing reported no error",
	!sent.some((m) => m.type === "error"),
	sent
		.filter((m) => m.type === "error")
		.map((m) => (m as { message: string }).message)
		.join("; "),
);

console.log("\nit reaches for nothing the audio thread lacks");
{
	// A worklet scope has none of these. Catching them here rather than in the
	// browser is the whole point of this file.
	const forbidden = ["TextDecoder", "TextEncoder", "fetch", "setTimeout", "setInterval", "XMLHttpRequest", "document", "window", "Blob", "URL", "crypto", "performance"];
	for (const name of forbidden) {
		const defined = runInContext(`typeof ${name} !== "undefined"`, createContext({})) as boolean;
		check(`${name} is absent from the scope`, !defined);
	}
}

console.log("\nsilence before a song is loaded");
{
	const samples = render(processor, 8);
	check("output is silent while idle", peak(samples) === 0, `peak ${peak(samples)}`);
}

console.log("\na loaded song renders audio through the resampler");
{
	port.onmessage!({
		data: { type: "load", spc, atSeconds: 0, introTicks: 0, loopTicks: 0, fadeSeconds: 0, songLoops: true, epoch: 1 },
	});

	render(processor, 200); // let the driver key on
	const samples = render(processor, 400); // ~1.07 s at 48 kHz

	check("no error was reported", !sent.some((m) => m.type === "error"), JSON.stringify(sent.filter((m) => m.type === "error")));
	check("output is not silent", peak(samples) > 0.01, `peak ${peak(samples).toFixed(4)}`);
	check("output stays inside full scale", peak(samples) <= 1.0, `peak ${peak(samples).toFixed(4)}`);

	const positions = sent.filter((m) => m.type === "position") as { seconds: number }[];
	check("it reports its position", positions.length > 0, `${positions.length} updates`);
	check(
		"position advances in step with the frames rendered",
		Math.abs(positions[positions.length - 1].seconds - (600 * QUANTUM) / SAMPLE_RATE) < 0.15,
		`${positions[positions.length - 1]?.seconds.toFixed(3)}s vs ${((600 * QUANTUM) / SAMPLE_RATE).toFixed(3)}s`,
	);
}

console.log("\npause and resume");
{
	port.onmessage!({ data: { type: "paused", paused: true } });
	const quiet = render(processor, 20);
	check("pausing silences the output", peak(quiet) === 0, `peak ${peak(quiet)}`);

	port.onmessage!({ data: { type: "paused", paused: false } });
	const loud = render(processor, 200);
	check("resuming brings it back", peak(loud) > 0.01, `peak ${peak(loud).toFixed(4)}`);
}

console.log("\nseeking lands somewhere else in the song");
{
	port.onmessage!({ data: { type: "seek", seconds: 0, epoch: 2 } });
	const fromStart = render(processor, 100);

	port.onmessage!({ data: { type: "seek", seconds: 3, epoch: 3 } });
	const fromThree = render(processor, 100);

	// The page discards positions stamped with an earlier epoch, which is what
	// stops a seek being undone by an update that was already on its way.
	const stamped = sent.filter((m) => m.type === "position") as { epoch: number }[];
	check(
		"positions carry the epoch of the seek that produced them",
		stamped.length > 0 && stamped[stamped.length - 1].epoch === 3,
		`epoch ${stamped[stamped.length - 1]?.epoch}`,
	);

	let identical = true;
	for (let i = 0; i < fromStart.length; i++) {
		if (fromStart[i] !== fromThree[i]) {
			identical = false;
			break;
		}
	}
	check("a seek changes what is rendered", !identical);
	check("still audible after seeking", peak(fromThree) > 0.005, `peak ${peak(fromThree).toFixed(4)}`);
}

/** A short pass, so a test does not have to render the whole song to see one. */
const LOOP_TICKS = 40;
const load = (over: Partial<Extract<ToWorklet, { type: "load" }>> = {}) => ({
	data: {
		type: "load" as const,
		spc,
		atSeconds: 0,
		introTicks: 0,
		loopTicks: LOOP_TICKS,
		fadeSeconds: 0.5,
		songLoops: true,
		epoch: 1,
		...over,
	},
});
type Position = Extract<FromWorklet, { type: "position" }>;
const positions = (messages: FromWorklet[]) => messages.filter((m): m is Position => m.type === "position");

/**
 * Starts a section from a clean slate on the processor already built.
 *
 * A processor per section is tidier and does not survive: each one stands up its
 * own 16 MiB emulator inside the vm context, and half a dozen of those take the
 * process down mid-run. `stop` plus a fresh `load` resets everything a test
 * looks at, so one emulator does for all of them.
 */
function restart(over: Partial<Extract<ToWorklet, { type: "load" }>> = {}, loop = false) {
	port.onmessage!({ data: { type: "stop" } });
	port.onmessage!({ data: { type: "loop", loop } });
	sent.length = 0;
	port.onmessage!(load(over));
	return { processor, sent };
}

console.log("\nthe end of a song is reported");
{
	const { processor: fresh, sent: freshSent } = restart();

	render(fresh, 700); // past 40 ticks at t40 plus 0.5 s of fade
	check("it reports the song ended", freshSent.some((m) => m.type === "ended"));

	const after = render(fresh, 20);
	check("nothing is rendered after the end", peak(after) === 0, `peak ${peak(after)}`);
}

console.log("\nthe playhead is counted off the driver, not predicted");
{
	const { processor: fresh, sent: freshSent } = restart({ loopTicks: 0 }); // no end, so it runs freely
	render(fresh, 900);

	const seen = positions(freshSent);
	check("ticks are reported", seen.length > 0 && seen.at(-1)!.ticks > 0, `${seen.at(-1)?.ticks} ticks`);
	check(
		"and they only ever go forwards",
		seen.every((m, i) => i === 0 || m.ticks >= seen[i - 1].ticks),
	);

	// The song is t40, so the driver ticks at roughly 40 * 500/256 = 78 Hz.
	const last = seen.at(-1)!;
	const rate = last.ticks / last.seconds;
	check("at about the rate the driver runs at", rate > 60 && rate < 95, `${rate.toFixed(2)} ticks/s`);

	// The whole point: this comes from the emulator, not from arithmetic. The
	// song is t40 and the register reads 41, because the driver stores the `t`
	// value plus one — which is exactly why reading it beats computing it.
	check("the driver state comes with it", last.driver.tempo === 41, `tempo ${last.driver.tempo}`);
	check("including where voice 0 is reading from", last.driver.trackPointers[0] > 0,
		`0x${last.driver.trackPointers[0].toString(16)}`);
}

console.log("\nlooping leaves the song running for the emulator to repeat");
{
	const { processor: fresh, sent: freshSent } = restart({}, true);

	render(fresh, 200); // let the driver key on
	const late = render(fresh, 900); // well past one pass plus the fade

	check("it never ends", !freshSent.some((m) => m.type === "ended"));
	check("and it is still at full volume", peak(late) > 0.01, `peak ${peak(late).toFixed(4)}`);

	const last = positions(freshSent).at(-1)!;
	check("the tick count runs past one pass", last.ticks > LOOP_TICKS, `${last.ticks} ticks`);
	check("the playhead wraps inside it", last.songTicks < LOOP_TICKS, `${last.songTicks} ticks`);
	// Integer arithmetic on a counted quantity: there is nothing here to drift.
	check(
		"exactly, however many passes have gone by",
		positions(freshSent).every((m) => m.songTicks === m.ticks % LOOP_TICKS),
	);
}

console.log("\nunticking loop finishes the pass rather than cutting out");
{
	const { processor: fresh, sent: freshSent } = restart({}, true);

	render(fresh, 900); // a couple of passes deep
	const before = positions(freshSent).at(-1)!.ticks;
	check("it is mid-pass when loop is unticked", before % LOOP_TICKS !== 0, `${before} ticks`);
	port.onmessage!({ data: { type: "loop", loop: false } });

	const rest = render(fresh, 60);
	check("it does not stop on the spot", !freshSent.some((m) => m.type === "ended"));
	check("and keeps playing to the loop point", peak(rest) > 0.01, `peak ${peak(rest).toFixed(4)}`);

	render(fresh, 900); // out past the next loop point and the fade
	check("then it ends", freshSent.some((m) => m.type === "ended"));
}

console.log("\na song with no loop point is restarted by hand");
{
	const { processor: fresh, sent: freshSent } = restart({ songLoops: false }, true);

	render(fresh, 900); // past one pass, so it has been round at least once
	check("it never ends", !freshSent.some((m) => m.type === "ended"));

	const last = positions(freshSent).at(-1)!;
	check("and the count itself restarts", last.ticks < LOOP_TICKS, `${last.ticks} ticks`);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
