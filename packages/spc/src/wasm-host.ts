/**
 * Host for `assets/player/spc.wasm` — Blargg's snes_spc, Emscripten-built.
 *
 * The binary is vendored; everything that talks to it is ours. It imports eight
 * functions from a single module `a`, exports ten items under minified names, and
 * touches nothing outside that surface — so the same host runs unchanged in Node,
 * on the main thread and inside an AudioWorkletGlobalScope.
 *
 * Both mappings are pinned to the vendored binary and written out in CLAUDE.md.
 * Swapping in a different build means re-reading them; {@link instantiate} fails
 * loudly rather than silently mis-calling if an export is missing.
 */

/** The SPC700 DSP runs at a fixed rate; everything downstream resamples. */
export const SPC_SAMPLE_RATE = 32000;

/** The DSP is stereo, and `_playSPC` writes the two channels interleaved. */
export const SPC_CHANNELS = 2;

/** An `.spc` file carries the APU RAM image at this offset, 64 KiB of it. */
const SPC_RAM_AT = 0x100;
export const ARAM_SIZE = 0x10000;

/** And the DSP's 128 registers at this one. */
const SPC_DSP_REGS_AT = 0x10100;
const DSP_REGISTER_COUNT = 128;

/**
 * The vendored build's DSP state (snes_spc's "fast" `SPC_DSP::state_t`), laid
 * out relative to its `ram` pointer, which is the one word in the heap holding
 * the address of APU RAM. In front of that pointer sit `counter_select[32]`, then
 * `voices[8]`; the register file opens the struct, 308 bytes before the voices.
 * Read off the binary, and checked by `findDsp` every time an instance starts.
 */
const DSP_VOICES = 8;
const VOICE_STATE_SIZE = 140;
/** `voice_t.volume[2]`: the `VxVOL` pair the DSP mixes with, already masked. */
const VOICE_VOLUME_AT = 128;
/** `voice_t.enabled`: -1 for a voice that is heard, 0 for one that is muted. */
const VOICE_ENABLED_AT = 136;
const COUNTER_SELECT_SIZE = 32 * 4;
const VOICES_AFTER_REGS = 308;
/** `counters[4]`, which every `counter_select` entry points into. */
const COUNTERS_AFTER_REGS = 284;
const COUNTERS_SIZE = 4 * 4;
/** `surround_threshold`, two words past the `ram` pointer, and its value with surround allowed. */
const SURROUND_AFTER_RAM = 8;
const SURROUND_ALLOWED = -0x4000;

/** Where {@link instantiate} found the DSP's state: heap addresses. */
export interface DspLayout {
	regs: number;
	voices: number;
}

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
	for (const byte of bytes) {
		text += String.fromCharCode(byte);
	}

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
	 * addresses; `AddmusicKreadme/readme_files/aram_map.html` documents all of them.
	 *
	 * A window onto the heap rather than a copy, so it can be written as well as
	 * read and the SPC700 sees the change on its next instruction — which is how
	 * the note previewer hands the driver a note. `loadSpc` puts the pristine
	 * image back over anything written here.
	 *
	 * A fresh view each call: the wasm heap can be reallocated by `memory.grow`,
	 * which detaches any array handed out earlier. Valid only after `loadSpc`.
	 */
	aram(): Uint8Array;
	/**
	 * Silences the voices in `mask` inside the DSP, and gives every other voice
	 * this muted its volume back at once, mid-note.
	 *
	 * In the DSP because nothing the driver does can reach it there. The DSP masks
	 * every `VxVOL` write with the voice's `enabled` flag as the write lands, so a
	 * muted voice stays silent through a `v`, a `$E8` fade, a `q` or a tremolo, and
	 * the driver goes on doing exactly the work it does unmuted — see
	 * `packages/spc/CLAUDE.md` for why its own registers are the wrong place.
	 *
	 * Holds until the mask changes or `loadSpc` runs, which clears it. A snapshot
	 * carries it. Valid only after `loadSpc`.
	 */
	muteVoices(mask: number): void;
	/**
	 * Takes `voice` out of the mute without giving it a volume: it stays silent
	 * until the driver next writes its `VxVOL`, which a key-on always does
	 * (`NoteVCMD` sets the voice's flag in `$5C`, `main.asm:459`). A voice that is
	 * not muted is left as it is.
	 */
	unmuteOnNextWrite(voice: number): void;
	/**
	 * The whole emulator as it stands, to be put back with {@link restore}.
	 *
	 * The binary keeps every byte of its state in its own linear memory, so a copy
	 * of that memory is the emulator: the loaded song, the CPU, the DSP and the
	 * echo buffer. Valid for this instance only, and only after `loadSpc`.
	 */
	snapshot(): CoreSnapshot;
	/** Puts a {@link snapshot} of this instance back, as if nothing had run since. */
	restore(snapshot: CoreSnapshot): void;
	/** Anything the module wrote to stdout/stderr, which in practice means a crash message. */
	readonly output: string;
}

/** One emulator instance, frozen. Opaque to everything but the host that took it. */
export interface CoreSnapshot {
	/** The wasm memory, whole. */
	readonly memory: Uint8Array;
	/** The host's scratch buffer as the heap in {@link memory} knows it. */
	readonly scratch: number;
	readonly scratchFrames: number;
	/** Where APU RAM sits in {@link memory}. */
	readonly aramAt: number;
	/** And the DSP's registers and voices. */
	readonly dsp: DspLayout;
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
		if (!ptr) {
			return "";
		}

		let end = ptr;
		while (u8[end]) {
			end++;
		}

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
				if (code === ASM_CONST_FAILED) {
					failed = true;
				} else if (code !== ASM_CONST_READY) {
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
				// 65536 is the WebAssembly page size, not ARAM — it only happens to
				// be the same number as ARAM_SIZE.
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

	if (failed) {
		throw new SpcCoreError("snes_spc reported that it failed to initialise");
	}

	// One scratch buffer, grown on demand, rather than a malloc per render.
	let scratch = 0;
	let scratchFrames = 0;

	const reserve = (frames: number): void => {
		if (frames <= scratchFrames) {
			return;
		}

		if (scratch) {
			core.q(scratch);
		}

		// The +4 matches upstream: `_playSPC` writes one sample past the end when
		// interpolating the tail of a block.
		scratch = core.p(frames * SPC_CHANNELS * 2 + 4);
		if (!scratch) {
			throw new SpcCoreError(`could not allocate ${frames} frames inside the emulator`);
		}

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
		if (!ptr) {
			throw new SpcCoreError(`could not allocate ${spc.length} bytes for the SPC image`);
		}

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
		const image = spc.subarray(SPC_RAM_AT, SPC_RAM_AT + ARAM_SIZE);

		// The driver's code, which is neither zeroes nor a repeating pattern.
		const anchorAt = 0x400;
		const candidates: number[] = [];
		outer: for (let at = 0; at + ARAM_SIZE <= u8.length && candidates.length < 8; at++) {
			for (let k = 0; k < 16; k++) {
				if (u8[at + anchorAt + k] !== image[anchorAt + k]) {
					continue outer;
				}
			}

			for (let k = 0; k < ARAM_SIZE; k += 89) {
				if (u8[at + k] !== image[k]) {
					continue outer;
				}
			}

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
			if (!running) {
				return false;
			}

			// $0400 up is the driver's code, per the ARAM map. Reused heap is noise.
			for (let k = 0x400; k < 0x2000; k += 37) {
				if (u8[at + k] !== image[k]) {
					return false;
				}
			}

			return true;
		});

		if (live.length !== 1) {
			throw new SpcCoreError(
				`expected exactly one live APU RAM in the wasm heap, found ${live.length} of ${candidates.length} candidates`,
			);
		}

		return live[0];
	};

	/**
	 * Finds the DSP's state inside the wasm heap, with `spc` freshly loaded.
	 *
	 * The DSP keeps a pointer to APU RAM, so the struct is found by looking for the
	 * one word holding {@link findAram}'s answer with the surround threshold beside
	 * it. Everything else is then checked rather than assumed: every voice heard,
	 * every `counter_select` entry pointing into `counters`, and the register file
	 * holding the image's own 128 registers.
	 */
	const findDsp = (spc: Uint8Array, ramAt: number): DspLayout => {
		const fields: number[] = [];
		for (let at = 0; at + SURROUND_AFTER_RAM + 4 <= u8.length; at += 4) {
			if (view.getUint32(at, true) === ramAt && view.getInt32(at + SURROUND_AFTER_RAM, true) === SURROUND_ALLOWED) {
				fields.push(at);
			}
		}

		if (fields.length !== 1) {
			throw new SpcCoreError(
				`expected exactly one DSP state in the wasm heap, found ${fields.length}; spc.wasm is not the vendored build`,
			);
		}

		const select = fields[0] - COUNTER_SELECT_SIZE;
		const voices = select - DSP_VOICES * VOICE_STATE_SIZE;
		const regs = voices - VOICES_AFTER_REGS;
		const fail = (what: string): never => {
			throw new SpcCoreError(`the DSP state in the wasm heap ${what}; spc.wasm is not the vendored build`);
		};

		for (let voice = 0; voice < DSP_VOICES; voice++) {
			if (view.getInt32(voices + voice * VOICE_STATE_SIZE + VOICE_ENABLED_AT, true) !== -1) {
				fail(`has voice ${voice} muted at load`);
			}
		}

		for (let at = select; at < fields[0]; at += 4) {
			const counter = view.getUint32(at, true) - regs;
			if (counter < COUNTERS_AFTER_REGS || counter >= COUNTERS_AFTER_REGS + COUNTERS_SIZE) {
				fail("has a counter_select entry outside its counters");
			}
		}

		for (let reg = 0; reg < DSP_REGISTER_COUNT; reg++) {
			if (u8[regs + reg] !== spc[SPC_DSP_REGS_AT + reg]) {
				fail(`disagrees with the image at register $${reg.toString(16)}`);
			}
		}

		return { regs, voices };
	};

	let aramAt = -1;
	let dsp: DspLayout | null = null;

	const located = (): DspLayout => {
		if (!dsp) {
			throw new SpcCoreError("the DSP is only available once an SPC has been loaded");
		}

		return dsp;
	};

	return {
		loadSpc(spc: Uint8Array): void {
			load(spc);
			if (aramAt < 0) {
				aramAt = findAram(spc);
				// Finding it meant running the emulator, so put the song back.
				load(spc);
				dsp = findDsp(spc, aramAt);
			}
		},

		skip(seconds: number): void {
			if (seconds > 0) {
				core.n(Math.floor(seconds));
			}
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
			if (aramAt < 0) {
				throw new SpcCoreError("APU RAM is only available once an SPC has been loaded");
			}

			aramView ??= u8.subarray(aramAt, aramAt + ARAM_SIZE);
			return aramView;
		},

		muteVoices(mask: number): void {
			const { regs, voices } = located();
			for (let voice = 0; voice < DSP_VOICES; voice++) {
				const at = voices + voice * VOICE_STATE_SIZE;
				if (mask & (1 << voice)) {
					view.setInt32(at + VOICE_ENABLED_AT, 0, true);
					view.setInt32(at + VOICE_VOLUME_AT, 0, true);
					view.setInt32(at + VOICE_VOLUME_AT + 4, 0, true);
					continue;
				}

				if (view.getInt32(at + VOICE_ENABLED_AT, true) !== 0) {
					continue;
				}

				// `update_voice_vol`, which the DSP runs on every VOL write: the pair
				// as signed bytes. It also negates the negative side when their product
				// is below the surround threshold, and at the -0x4000 `findDsp` requires
				// no two signed bytes get there.
				const vol = regs + voice * 0x10;
				view.setInt32(at + VOICE_ENABLED_AT, -1, true);
				view.setInt32(at + VOICE_VOLUME_AT, view.getInt8(vol), true);
				view.setInt32(at + VOICE_VOLUME_AT + 4, view.getInt8(vol + 1), true);
			}
		},

		unmuteOnNextWrite(voice: number): void {
			view.setInt32(located().voices + voice * VOICE_STATE_SIZE + VOICE_ENABLED_AT, -1, true);
		},

		snapshot(): CoreSnapshot {
			if (aramAt < 0 || !dsp) {
				throw new SpcCoreError("a snapshot can only be taken once an SPC has been loaded");
			}

			return { memory: u8.slice(), scratch, scratchFrames, aramAt, dsp };
		},

		restore(snapshot: CoreSnapshot): void {
			if (snapshot.memory.length !== u8.length) {
				throw new SpcCoreError("that snapshot was not taken from this emulator instance");
			}

			u8.set(snapshot.memory);
			// The heap's own record of the scratch buffer went back with the memory,
			// so the host's has to go back with it.
			scratch = snapshot.scratch;
			scratchFrames = snapshot.scratchFrames;
			aramAt = snapshot.aramAt;
			dsp = snapshot.dsp;
			audioView = null;
			aramView = null;
		},

		get output(): string {
			return output;
		},
	};
}
