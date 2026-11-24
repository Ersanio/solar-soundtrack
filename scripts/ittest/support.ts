/** What every `ittest` section shares: an IT file built in memory, imported, its samples encoded, and the song compiled, walked, diagnosed and assembled as the editor does. */

import "../localize";
import { type ItImport, readIt } from "@amk/import/it";
import { type TrackerSongOptions, type WrittenTrackerSong, writeTracker } from "@amk/import/tracker";
import type { BrrSample } from "@amk/spc/brr";
import { setPitchWide } from "@amk/spc/pitch";
import type { WalkNote } from "@amk/spc/song-walk";
import { type Song, encoded, song } from "../modtest/support";

export { played, problems } from "../modtest/support";

// --- An IT writer --------------------------------------------------------------

/** A cell: a note (60 is C-5, or a name such as `C-5`, `^^^` for a cut, `===` for a note off), an instrument, a volume column byte, a command letter and its parameter. */
export interface Cell {
	note?: number | string;
	instrument?: number;
	volume?: number;
	command?: string;
	param?: number;
}

export interface SampleSpec {
	name?: string;
	/** 8-bit values (-128..127) unless `sixteen`. */
	pcm: readonly number[];
	sixteen?: boolean;
	stereo?: boolean;
	unsigned?: boolean;
	c5Speed?: number;
	volume?: number;
	globalVolume?: number;
	/** 0-64. */
	pan?: number;
	loopStart?: number;
	/** Frames; 0 or absent plays once. */
	loopLength?: number;
	pingPong?: boolean;
	/** The loop is a sustain loop. */
	sustain?: boolean;
	autoVibrato?: { speed: number; depth: number; rate?: number; waveform?: number };
	/** Already-compressed data to store in place of `pcm` (IT 2.14), its frame count in `pcm.length`. */
	compressed?: Uint8Array[];
	/** IT 2.15: the decompressed values are deltas again. */
	delta?: boolean;
}

export interface EnvelopeSpec {
	points: [number, number][];
	loop?: [number, number];
	sustain?: [number, number];
}

export interface InstrumentSpec {
	name?: string;
	/** For each note 0-119, the sample; all `sample` unless given. */
	keymap?: { note: number; sample: number }[];
	sample?: number;
	newNoteAction?: number;
	fadeout?: number;
	globalVolume?: number;
	pan?: number;
	volumeEnvelope?: EnvelopeSpec;
	panEnvelope?: EnvelopeSpec;
	pitchEnvelope?: EnvelopeSpec;
}

export interface ItSpec {
	title?: string;
	linear?: boolean;
	oldEffects?: boolean;
	compatibleGxx?: boolean;
	stereo?: boolean;
	globalVolume?: number;
	speed?: number;
	tempo?: number;
	separation?: number;
	/** 0-64, 100 surround, +128 to disable. */
	channelPans?: number[];
	channelVolumes?: number[];
	samples: SampleSpec[];
	/** Instrument mode where given. */
	instruments?: InstrumentSpec[];
	/** The format before 2.00, which instruments are refused in. */
	compatible?: number;
	orders: number[];
	/** Pattern, then row, then channel; missing rows and cells are empty. */
	patterns: Cell[][][];
	rows?: number[];
}

const SEMITONES: Record<string, number> = {
	"C-": 0,
	"C#": 1,
	"D-": 2,
	"D#": 3,
	"E-": 4,
	"F-": 5,
	"F#": 6,
	"G-": 7,
	"G#": 8,
	"A-": 9,
	"A#": 10,
	"B-": 11,
};

/** An IT note for `C-5`, `F#4` and so on: 60 is C-5. */
export function note(name: string): number {
	if (name === "^^^") {
		return 254;
	}

	if (name === "===") {
		return 255;
	}

	return Number(name[2]) * 12 + SEMITONES[name.slice(0, 2)];
}

/** A looping square wave, `length` frames to a cycle. */
export function square(length: number, cycles = 1): number[] {
	return Array.from({ length: length * cycles }, (_, i) => (i % length < length / 2 ? 80 : -80));
}

/** A one-shot decaying sine. */
export function pluck(frames: number, cycle = 32): number[] {
	return Array.from({ length: frames }, (_, i) =>
		Math.round(100 * Math.exp(-i / (frames / 3)) * Math.sin((2 * Math.PI * i) / cycle)),
	);
}

/** Values packed into a stream `width` bits at a time, least significant first, as IT 2.14 reads them. */
export function bitStream(fields: readonly [value: number, width: number][]): Uint8Array {
	const bits: number[] = [];
	for (const [value, width] of fields) {
		for (let i = 0; i < width; i++) {
			bits.push(Math.floor(value / 2 ** i) & 1);
		}
	}

	const out = new Uint8Array(Math.ceil(bits.length / 8) + 4);
	bits.forEach((b, i) => {
		out[i >> 3] |= b << (i & 7);
	});
	return out;
}

const text = (s: string, length: number): number[] =>
	[...s.padEnd(length, "\0").slice(0, length)].map((c) => c.charCodeAt(0));
const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

function envelopeBytes(env: EnvelopeSpec | undefined): number[] {
	const flags = env ? 1 | (env.loop ? 2 : 0) | (env.sustain ? 4 : 0) : 0;
	const nodes = new Array<number>(75).fill(0);
	(env?.points ?? []).forEach(([tick, value], i) => nodes.splice(i * 3, 3, value & 0xff, ...u16(tick)));
	return [
		flags,
		env?.points.length ?? 0,
		env?.loop?.[0] ?? 0,
		env?.loop?.[1] ?? 0,
		env?.sustain?.[0] ?? 0,
		env?.sustain?.[1] ?? 0,
		...nodes,
		0,
	];
}

export function itBytes(spec: ItSpec): Uint8Array {
	const instruments = spec.instruments ?? [];
	const patternCount = Math.max(...spec.orders.filter((o) => o < 200)) + 1;
	const flags =
		((spec.stereo ?? true) ? 1 : 0) |
		(instruments.length ? 4 : 0) |
		((spec.linear ?? true) ? 8 : 0) |
		(spec.oldEffects ? 16 : 0) |
		(spec.compatibleGxx ? 32 : 0);
	const head = [
		...text("IMPM", 4),
		...text(spec.title ?? "TEST", 26),
		0,
		0,
		...u16(spec.orders.length),
		...u16(instruments.length),
		...u16(spec.samples.length),
		...u16(patternCount),
		...u16(0x0214),
		...u16(spec.compatible ?? 0x0214),
		...u16(flags),
		...u16(0),
		spec.globalVolume ?? 128,
		48,
		spec.speed ?? 6,
		spec.tempo ?? 125,
		spec.separation ?? 128,
		0,
		...u16(0),
		...u32(0),
		...u32(0),
		...Array.from({ length: 64 }, (_, i) => spec.channelPans?.[i] ?? 32),
		...Array.from({ length: 64 }, (_, i) => spec.channelVolumes?.[i] ?? 64),
	];
	const out = [...head, ...spec.orders];
	const pointerAt = out.length;
	out.push(...new Array<number>((instruments.length + spec.samples.length + patternCount) * 4).fill(0));
	const setPointer = (slot: number, at: number): void => {
		out.splice(pointerAt + slot * 4, 4, ...u32(at));
	};

	instruments.forEach((ins, i) => {
		setPointer(i, out.length);
		const keymap = Array.from({ length: 120 }, (_, n) => ins.keymap?.[n] ?? { note: n, sample: ins.sample ?? 1 });
		out.push(
			...text("IMPI", 4),
			...text("", 12),
			0,
			ins.newNoteAction ?? 0,
			0,
			0,
			...u16(ins.fadeout ?? 0),
			0,
			60,
			ins.globalVolume ?? 128,
			ins.pan ?? 32 | 0x80,
			0,
			0,
			...u16(0x0214),
			1,
			0,
			...text(ins.name ?? "", 26),
			0,
			0,
			0,
			0,
			...u16(0),
			...keymap.flatMap((k) => [k.note, k.sample]),
			...envelopeBytes(ins.volumeEnvelope),
			...envelopeBytes(ins.panEnvelope),
			...envelopeBytes(ins.pitchEnvelope),
			0,
			0,
			0,
			0,
		);
	});

	const sampleHeaders: number[] = [];
	spec.samples.forEach((s, i) => {
		setPointer(instruments.length + i, out.length);
		sampleHeaders.push(out.length);
		const loops = (s.loopLength ?? 0) > 0;
		const sampleFlags =
			1 |
			(s.sixteen ? 2 : 0) |
			(s.stereo ? 4 : 0) |
			(s.compressed ? 8 : 0) |
			(loops && !s.sustain ? 16 : 0) |
			(loops && s.sustain ? 32 : 0) |
			(loops && !s.sustain && s.pingPong ? 64 : 0) |
			(loops && s.sustain && s.pingPong ? 128 : 0);
		const frames = s.pcm.length / (s.stereo ? 2 : 1);
		const loopStart = s.loopStart ?? 0;
		const loopEnd = loopStart + (s.loopLength ?? 0);
		out.push(
			...text("IMPS", 4),
			...text("", 12),
			0,
			s.globalVolume ?? 64,
			sampleFlags,
			s.volume ?? 64,
			...text(s.name ?? "", 26),
			(s.unsigned ? 0 : 1) | (s.delta ? 4 : 0),
			s.pan === undefined ? 32 : s.pan | 0x80,
			...u32(frames),
			...u32(s.sustain ? 0 : loopStart),
			...u32(s.sustain ? 0 : loopEnd),
			...u32(s.c5Speed ?? 8363),
			...u32(s.sustain ? loopStart : 0),
			...u32(s.sustain ? loopEnd : 0),
			...u32(0),
			s.autoVibrato?.speed ?? 0,
			s.autoVibrato?.depth ?? 0,
			s.autoVibrato?.rate ?? 0,
			s.autoVibrato?.waveform ?? 0,
		);
	});

	spec.samples.forEach((s, i) => {
		out.splice(sampleHeaders[i] + 0x48, 4, ...u32(out.length));
		if (s.compressed) {
			for (const block of s.compressed) {
				out.push(...u16(block.length), ...block);
			}

			return;
		}

		for (const v of s.pcm) {
			if (s.sixteen) {
				out.push(...u16((s.unsigned ? v + 0x8000 : v) & 0xffff));
			} else {
				out.push((s.unsigned ? v + 0x80 : v) & 0xff);
			}
		}
	});

	for (let p = 0; p < patternCount; p++) {
		setPointer(instruments.length + spec.samples.length + p, out.length);
		const rows = spec.rows?.[p] ?? 64;
		const data: number[] = [];
		for (let row = 0; row < rows; row++) {
			(spec.patterns[p]?.[row] ?? []).forEach((cell, c) => {
				if (!cell || Object.keys(cell).length === 0) {
					return;
				}

				let mask = 0;
				const bytes: number[] = [];
				if (cell.note !== undefined) {
					mask |= 1;
					bytes.push(typeof cell.note === "string" ? note(cell.note) : cell.note);
				}

				if (cell.instrument !== undefined) {
					mask |= 2;
					bytes.push(cell.instrument);
				}

				if (cell.volume !== undefined) {
					mask |= 4;
					bytes.push(cell.volume);
				}

				if (cell.command !== undefined) {
					mask |= 8;
					bytes.push(cell.command.charCodeAt(0) - 64, cell.param ?? 0);
				}

				data.push((c + 1) | 0x80, mask, ...bytes);
			});
			data.push(0);
		}

		out.push(...u16(data.length), ...u16(rows), 0, 0, 0, 0, ...data);
	}

	return new Uint8Array(out);
}

/** A pattern of 64 rows with `cells` placed at `[row, channel]`. */
export function pattern(cells: [row: number, channel: number, cell: Cell][]): Cell[][] {
	const rows: Cell[][] = Array.from({ length: 64 }, () => []);
	for (const [row, channel, cell] of cells) {
		rows[row][channel] = cell;
	}

	return rows;
}

// --- Importing, and reading the result back -----------------------------------------

export interface Imported {
	it: ItImport;
	written: WrittenTrackerSong;
	brrs: BrrSample[];
	song: Song;
}

/** Reads `bytes`, writes every suggested channel with every sample at factor 1 (or as `options` says), and builds the song. */
export function imported(bytes: Uint8Array, options: Partial<TrackerSongOptions> = {}): Imported {
	const it = readIt(bytes);
	const written = writeTracker(it, {
		keep: it.suggested,
		factors: new Map(),
		separation: 1,
		loop: "jump",
		sampleName: (index) => `IT ${String(index).padStart(2, "0")}.brr`,
		fallbackTitle: null,
		...options,
	});
	const brrs = encoded(it, written);
	return { it, written, brrs, song: song(written.text, brrs) };
}

/** How far, in cents, a walked note plays from the semitone the IT plays it nearest to on the same sample. */
export function centsOff(imp: Imported, walked: WalkNote, channel: number, tick: number): number {
	const sample = imp.written.samples.find((s) => s.instrument === walked.state.instrument);
	if (!sample || walked.key === null) {
		return Infinity;
	}

	const register = setPitchWide(walked.key * 256 + walked.state.fineTune, sample.tuning.multiplier, sample.tuning.sub);
	const heard = (register * 32_000) / 0x1000;
	const semitones = Math.round(imp.it.play.channels[channel].pitch[tick]);
	const base = imp.it.song.samples[sample.index - 1].baseHz;
	return 1200 * Math.log2(heard / (base * sample.factor * 2 ** (semitones / 12)));
}
