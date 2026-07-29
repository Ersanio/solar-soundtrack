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
	for (let index = 0; index < bytes.length; index++) text += String.fromCharCode(bytes[index]);
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

	let memory!: WebAssembly.Memory;
	let u8!: Uint8Array;
	let i16!: Int16Array;
	let view!: DataView;

	const refresh = (): void => {
		u8 = new Uint8Array(memory.buffer);
		i16 = new Int16Array(memory.buffer);
		view = new DataView(memory.buffer);
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
	};

	return {
		loadSpc(spc: Uint8Array): void {
			const ptr = core.p(spc.length);
			if (!ptr) throw new SpcCoreError(`could not allocate ${spc.length} bytes for the SPC image`);
			try {
				u8.set(spc, ptr);
				core.l(ptr, spc.length);
			} finally {
				core.q(ptr);
			}
		},

		skip(seconds: number): void {
			if (seconds > 0) core.n(Math.floor(seconds));
		},

		renderView(frames: number): Int16Array {
			reserve(frames);
			const count = frames * SPC_CHANNELS;
			core.m(scratch, count);
			return i16.subarray(scratch >> 1, (scratch >> 1) + count);
		},

		render(frames: number): Int16Array {
			return this.renderView(frames).slice();
		},

		get output(): string {
			return output;
		},
	};
}
