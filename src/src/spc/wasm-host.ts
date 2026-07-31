/**
 * Host for `public/player/spc.wasm` — Blargg's snes_spc, Emscripten-built.
 *
 * The binary is vendored; everything that talks to it is ours. It imports eight
 * functions from a single module `a` and exports ten items under minified
 * names, and it touches nothing outside that surface: no DOM, no globals, no
 * reference to the SMW Central player it originally shipped with. So the same
 * host runs unchanged in Node, on the main thread, and inside an
 * AudioWorkletGlobalScope.
 *
 * Import mapping, read out of the upstream glue's `wasmImports`:
 *
 *   a ___assert_fail            e _fd_seek
 *   b _emscripten_asm_const_int f _emscripten_resize_heap
 *   c _exit                     g _fd_close
 *   d _fd_write                 h __emscripten_memcpy_js
 *
 * Export mapping, read out of its `wasmExports[...]` bindings:
 *
 *   i memory                j __wasm_call_ctors   k _main(argc,argv)
 *   l _loadSPC(ptr,len)     m _playSPC(ptr,count) n _skipSPC(seconds)
 *   p _malloc(size)         q _free(ptr)          r stack_alloc
 *
 * Both are pinned to the vendored binary. Swapping in a different build means
 * re-reading them; `instantiate` fails loudly rather than silently mis-calling
 * if an expected export is missing.
 */

/** The SPC700 DSP runs at a fixed rate; everything downstream resamples. */
export const SPC_SAMPLE_RATE = 32000;

/** The DSP is stereo, and `_playSPC` writes the two channels interleaved. */
export const SPC_CHANNELS = 2;

/** An `.spc` file carries the APU RAM image at this offset, 64 KiB of it. */
const SPC_RAM_AT = 0x100;
const SPC_RAM_SIZE = 0x10000;

/**
 * `EM_ASM` blocks compiled into the binary, keyed by the code address the wasm
 * passes to `_emscripten_asm_const_int`. Upstream routed these at its backend
 * singleton; they are the only way the module calls out on its own, and `main`
 * fires 4173 and nothing else. We just record what happened.
 */
const ASM_CONST_READY = 4173;
const ASM_CONST_FAILED = 4132;

export class SpcCoreError extends Error {}

/**
 * An AudioWorkletGlobalScope is not a WorkerGlobalScope, so it exposes neither
 * `TextDecoder` nor `fetch` — both are `[Exposed=(Window,Worker)]`. Nothing in
 * this module may reach for them. The only strings that cross the boundary are
 * snes_spc's own diagnostics, which are ASCII, so a byte walk covers it.
 */
function decodeAscii(bytes: Uint8Array): string {
	let text = "";
	for (const byte of bytes) text += String.fromCharCode(byte);
	return text;
}

export interface SpcCore {
	/** Loads a complete `.spc` file image and resets playback to its start. */
	loadSpc(spc: Uint8Array): void;
	/**
	 * Fast-forwards by emulating and discarding output. Whole seconds only —
	 * the export takes an `i32`, so fractions truncate.
	 */
	skip(seconds: number): void;
	/**
	 * Renders `frames` stereo frames into the core's own buffer and returns a
	 * view of it. The view is valid only until the next call — copy it if it has
	 * to outlive that.
	 */
	renderView(frames: number): Int16Array;
	/** As `renderView`, but returns an independent copy. */
	render(frames: number): Int16Array;
	/**
	 * The emulator's 64 KiB of APU RAM, live.
	 *
	 * This is the driver's own state — where each voice is reading its music
	 * data, what tempo it is running at, how far its tick accumulator has got —
	 * and reading it is the only way to know what the song is actually doing
	 * rather than what it was predicted to do. See `driver-state.ts` for the
	 * addresses; `readme/readme_files/aram_map.html` documents all of them.
	 *
	 * A window onto the heap rather than a copy, so it can be written as well as
	 * read and the SPC700 sees the change on its next instruction — which is how
	 * channel muting works, with no help from the core, which exports nothing for
	 * it. `loadSpc` puts the pristine image back over anything written here.
	 *
	 * A fresh view each call: the wasm heap can be reallocated by `memory.grow`,
	 * which detaches any array handed out earlier. Valid only after `loadSpc`.
	 */
	aram(): Uint8Array;
	/** Anything the module wrote to stdout/stderr, which in practice means a crash message. */
	readonly output: string;
}

interface Exports {
	i: WebAssembly.Memory;
	j(): void;
	k(argc: number, argv: number): number;
	l(ptr: number, len: number): void;
	m(ptr: number, count: number): void;
	n(seconds: number): void;
	p(size: number): number;
	q(ptr: number): void;
}

const REQUIRED = ["i", "j", "k", "l", "m", "n", "p", "q"] as const;

/**
 * Brings up one emulator instance.
 *
 * Takes an already-compiled module rather than bytes because an
 * AudioWorkletGlobalScope has no `fetch`: the page compiles once and posts the
 * `WebAssembly.Module` across, which is structured-cloneable.
 */
export function instantiate(module: WebAssembly.Module): SpcCore {
	let output = "";
	let failed = false;

	// `const` can't carry a definite-assignment assertion (`const x!: T` is a TS
	// syntax error), so this stays `let` even though it's only ever assigned once.
	// eslint-disable-next-line prefer-const
	let memory!: WebAssembly.Memory;
	let u8!: Uint8Array;
	let i16!: Int16Array;
	let view!: DataView;

	/**
	 * Views handed back by `renderView` and `aram`, cached.
	 *
	 * Both are called about a thousand times a second on the audio thread, and a
	 * fresh `subarray` each time is a fresh object each time — allocation the
	 * audio thread should not be doing. They are rebuilt only when the thing they
	 * point at actually moves: a grown heap, or a reallocated scratch buffer.
	 */
	let audioView: Int16Array | null = null;
	let audioFrames = -1;
	let aramView: Uint8Array | null = null;

	const refresh = (): void => {
		u8 = new Uint8Array(memory.buffer);
		i16 = new Int16Array(memory.buffer);
		view = new DataView(memory.buffer);
		audioView = null;
		aramView = null;
	};

	const cstring = (ptr: number): string => {
		if (!ptr) return "";
		let end = ptr;
		while (u8[end]) end++;
		return decodeAscii(u8.subarray(ptr, end));
	};

	const imports = {
		a: {
			// ___assert_fail(condition, file, line, function)
			a: (condition: number, file: number, line: number, fn: number): void => {
				throw new SpcCoreError(
					`snes_spc assertion failed: ${cstring(condition)} at ${cstring(file)}:${line} in ${cstring(fn)}`,
				);
			},
			// _emscripten_asm_const_int(code, signature, arguments)
			b: (code: number): number => {
				if (code === ASM_CONST_FAILED) failed = true;
				else if (code !== ASM_CONST_READY) {
					throw new SpcCoreError(`unknown EM_ASM callback ${code} — this is not the vendored binary`);
				}
				return 0;
			},
			// _exit
			c: (code: number): void => {
				throw new SpcCoreError(`snes_spc called exit(${code})${output ? `: ${output.trim()}` : ""}`);
			},
			// _fd_write — capture printf so a crash message survives
			d: (_fd: number, iov: number, iovcnt: number, pnum: number): number => {
				let written = 0;
				for (let i = 0; i < iovcnt; i++) {
					const ptr = view.getUint32(iov + i * 8, true);
					const len = view.getUint32(iov + i * 8 + 4, true);
					output += decodeAscii(u8.subarray(ptr, ptr + len));
					written += len;
				}
				view.setUint32(pnum, written, true);
				return 0;
			},
			// _fd_seek
			e: (): number => 0,
			// _emscripten_resize_heap — the vendored binary fixes min == max pages,
			// so this always fails there. Kept honest for a core that can grow.
			f: (requested: number): number => {
				const pages = Math.ceil((requested - memory.buffer.byteLength) / 65536);
				try {
					memory.grow(Math.max(pages, 1));
					refresh();
					return 1;
				} catch {
					return 0;
				}
			},
			// _fd_close
			g: (): number => 0,
			// __emscripten_memcpy_js
			h: (dest: number, src: number, num: number): void => {
				u8.copyWithin(dest, src, src + num);
			},
		},
	};

	const instance = new WebAssembly.Instance(module, imports);
	const exports = instance.exports as unknown as Record<string, unknown>;

	const missing = REQUIRED.filter((name) => exports[name] === undefined);
	if (missing.length) {
		throw new SpcCoreError(`spc.wasm is missing expected exports: ${missing.join(", ")}`);
	}

	const core = exports as unknown as Exports;
	memory = core.i;
	refresh();

	core.j(); // __wasm_call_ctors
	core.k(0, 0); // main, whose only job is the EM_ASM callback above

	if (failed) throw new SpcCoreError("snes_spc reported that it failed to initialise");

	// One scratch buffer, grown on demand, rather than a malloc per render.
	let scratch = 0;
	let scratchFrames = 0;

	const reserve = (frames: number): void => {
		if (frames <= scratchFrames) return;
		if (scratch) core.q(scratch);
		// The +4 matches upstream: `_playSPC` writes one sample past the end when
		// interpolating the tail of a block.
		scratch = core.p(frames * SPC_CHANNELS * 2 + 4);
		if (!scratch) throw new SpcCoreError(`could not allocate ${frames} frames inside the emulator`);
		scratchFrames = frames;
		audioView = null;
	};

	/** Emulates `frames` and throws the audio away. */
	const renderFrames = (frames: number): void => {
		reserve(frames);
		core.m(scratch, frames * SPC_CHANNELS);
	};

	const load = (spc: Uint8Array): void => {
		const ptr = core.p(spc.length);
		if (!ptr) throw new SpcCoreError(`could not allocate ${spc.length} bytes for the SPC image`);
		try {
			u8.set(spc, ptr);
			core.l(ptr, spc.length);
		} finally {
			core.q(ptr);
		}
	};

	/**
	 * Finds the emulator's APU RAM inside the wasm heap.
	 *
	 * snes_spc's RAM is a plain array in a struct it allocates for itself, and
	 * the binary exports no way to ask where. But a freshly loaded SPC leaves it
	 * holding the file's own 64 KiB RAM image, so it can be found by looking for
	 * that image in the heap.
	 *
	 * Two copies match: the live RAM and a pristine one the core keeps to reset
	 * from. They are identical at load, so they are told apart by running the
	 * emulator briefly and seeing which one the driver writes to. That costs a
	 * few milliseconds of emulation, which is why the answer is cached for the
	 * lifetime of the instance — the struct does not move.
	 */
	const findAram = (spc: Uint8Array): number => {
		const image = spc.subarray(SPC_RAM_AT, SPC_RAM_AT + SPC_RAM_SIZE);

		// The driver's code, which is neither zeroes nor a repeating pattern.
		const anchorAt = 0x400;
		const candidates: number[] = [];
		outer: for (let at = 0; at + SPC_RAM_SIZE <= u8.length && candidates.length < 8; at++) {
			for (let k = 0; k < 16; k++) if (u8[at + anchorAt + k] !== image[anchorAt + k]) continue outer;
			for (let k = 0; k < SPC_RAM_SIZE; k += 89) if (u8[at + k] !== image[k]) continue outer;
			candidates.push(at);
		}
		if (candidates.length === 0) {
			throw new SpcCoreError(
				"could not find the emulator's APU RAM in the wasm heap; spc.wasm is not the vendored build",
			);
		}

		// One of the matches is the copy of the file this very load allocated and
		// then freed; the heap hands that block straight back out for the audio
		// scratch buffer, so simply "did it change" is not enough to tell them
		// apart. The live RAM is the one the driver is *running in*: its zero page
		// moves, and its program — which nothing writes to — stays put.
		const before = candidates.map((at) => u8.slice(at, at + 0x100));
		renderFrames(SPC_SAMPLE_RATE / 20);

		const live = candidates.filter((at, index) => {
			const now = u8.subarray(at, at + 0x100);
			const running = before[index].some((value, offset) => value !== now[offset]);
			if (!running) return false;
			// $0400 up is the driver's code, per the ARAM map. Reused heap is noise.
			for (let k = 0x400; k < 0x2000; k += 37) if (u8[at + k] !== image[k]) return false;
			return true;
		});

		if (live.length !== 1) {
			throw new SpcCoreError(
				`expected exactly one live APU RAM in the wasm heap, found ${live.length} of ${candidates.length} candidates`,
			);
		}
		return live[0];
	};

	let aramAt = -1;

	return {
		loadSpc(spc: Uint8Array): void {
			load(spc);
			if (aramAt < 0) {
				aramAt = findAram(spc);
				// Finding it meant running the emulator, so put the song back.
				load(spc);
			}
		},

		skip(seconds: number): void {
			if (seconds > 0) core.n(Math.floor(seconds));
		},

		renderView(frames: number): Int16Array {
			reserve(frames);
			const count = frames * SPC_CHANNELS;
			core.m(scratch, count);
			if (!audioView || audioFrames !== frames) {
				audioView = i16.subarray(scratch >> 1, (scratch >> 1) + count);
				audioFrames = frames;
			}
			return audioView;
		},

		render(frames: number): Int16Array {
			return this.renderView(frames).slice();
		},

		aram(): Uint8Array {
			if (aramAt < 0) throw new SpcCoreError("APU RAM is only available once an SPC has been loaded");
			aramView ??= u8.subarray(aramAt, aramAt + SPC_RAM_SIZE);
			return aramView;
		},

		get output(): string {
			return output;
		},
	};
}
