/** What every `xmtest` section shares: an XM file built in memory, imported, its samples encoded, and the song compiled, walked, diagnosed and assembled as the editor does. */

import "../localize";
import { type TrackerSongOptions, type WrittenTrackerSong, writeTracker } from "@amk/import/tracker";
import { type XmImport, readXm } from "@amk/import/xm";
import type { BrrSample } from "@amk/spc/brr";
import { setPitchWide } from "@amk/spc/pitch";
import type { WalkNote } from "@amk/spc/song-walk";
import { type Song, encoded, song } from "../modtest/support";

export { played, problems } from "../modtest/support";

// --- An XM writer --------------------------------------------------------------

/** A cell: a note (1 is C-0, 97 key off, or a name such as `C-4`), an instrument, a volume column byte, an effect and its parameter. */
export interface Cell {
	note?: number | string;
	instrument?: number;
	volume?: number;
	/** 0-35, or a letter for 10 up (`A` is 10). */
	effect?: number | string;
	param?: number;
}

export interface SampleSpec {
	name?: string;
	/** 8-bit values (-128..127) unless `sixteen`. */
	pcm: readonly number[];
	sixteen?: boolean;
	loopStart?: number;
	/** Frames; 0 or absent plays once. */
	loopLength?: number;
	pingPong?: boolean;
	volume?: number;
	finetune?: number;
	panning?: number;
	relativeNote?: number;
}

export interface EnvelopeSpec {
	points: [number, number][];
	sustain?: number;
	loop?: [number, number];
}

export interface InstrumentSpec {
	name?: string;
	samples: SampleSpec[];
	/** For each note 1-96, the sample it plays; all the first by default. */
	keymap?: number[];
	volumeEnvelope?: EnvelopeSpec;
	panEnvelope?: EnvelopeSpec;
	fadeout?: number;
	autoVibrato?: { type?: number; sweep?: number; depth: number; rate: number };
}

export interface XmSpec {
	title?: string;
	channels?: number;
	linear?: boolean;
	speed?: number;
	bpm?: number;
	restart?: number;
	instruments: InstrumentSpec[];
	orders: number[];
	/** Pattern, then row, then channel; missing rows and cells are empty. */
	patterns: Cell[][][];
	/** Rows in each pattern; 64 unless given. */
	rows?: number[];
	/** Bytes the file is cut to. */
	cut?: number;
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

/** An XM note for `C-4`, `F#5` and so on: 1 is C-0. */
export const note = (name: string): number => Number(name[2]) * 12 + SEMITONES[name.slice(0, 2)] + 1;

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

const text = (s: string, length: number): number[] =>
	[...s.padEnd(length, "\0").slice(0, length)].map((c) => c.charCodeAt(0));
const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];
const effectOf = (e: number | string | undefined): number =>
	typeof e === "string" ? (e >= "0" && e <= "9" ? Number(e) : e.charCodeAt(0) - 55) : (e ?? 0);

function envelopeBytes(env: EnvelopeSpec | undefined): { points: number[]; fields: number[] } {
	const points = new Array<number>(48).fill(0);
	(env?.points ?? []).forEach(([x, y], i) => points.splice(i * 4, 4, ...u16(x), ...u16(y)));
	return {
		points,
		// length, sustain, loop start, loop end, flags
		fields: [
			env?.points.length ?? 0,
			env?.sustain ?? 0,
			env?.loop?.[0] ?? 0,
			env?.loop?.[1] ?? 0,
			env ? 1 | (env.sustain !== undefined ? 2 : 0) | (env.loop ? 4 : 0) : 0,
		],
	};
}

export function xmBytes(spec: XmSpec): Uint8Array {
	const channels = spec.channels ?? 4;
	const patternCount = Math.max(...spec.orders) + 1;
	const out = [
		...text("Extended Module: ", 17),
		...text(spec.title ?? "TEST", 20),
		0x1a,
		...text("xmtest", 20),
		...u16(0x0104),
		...u32(276),
		...u16(spec.orders.length),
		...u16(spec.restart ?? 0),
		...u16(channels),
		...u16(patternCount),
		...u16(spec.instruments.length),
		...u16(spec.linear === false ? 0 : 1),
		...u16(spec.speed ?? 6),
		...u16(spec.bpm ?? 125),
		...Array.from({ length: 256 }, (_, i) => spec.orders[i] ?? 0),
	];
	for (let p = 0; p < patternCount; p++) {
		const rows = spec.rows?.[p] ?? 64;
		const data: number[] = [];
		for (let row = 0; row < rows; row++) {
			for (let c = 0; c < channels; c++) {
				const cell = spec.patterns[p]?.[row]?.[c] ?? {};
				const n = typeof cell.note === "string" ? note(cell.note) : (cell.note ?? 0);
				const fields = [n, cell.instrument ?? 0, cell.volume ?? 0, effectOf(cell.effect), cell.param ?? 0];
				let mask = 0x80;
				const present: number[] = [];
				fields.forEach((v, i) => {
					if (v !== 0) {
						mask |= 1 << i;
						present.push(v);
					}
				});
				data.push(mask, ...present);
			}
		}

		out.push(...u32(9), 0, ...u16(rows), ...u16(data.length), ...data);
	}

	for (const ins of spec.instruments) {
		const vol = envelopeBytes(ins.volumeEnvelope);
		const pan = envelopeBytes(ins.panEnvelope);
		const vib = ins.autoVibrato;
		out.push(
			...u32(263),
			...text(ins.name ?? "", 22),
			0,
			...u16(ins.samples.length),
			...u32(40),
			...Array.from({ length: 96 }, (_, i) => ins.keymap?.[i] ?? 0),
			...vol.points,
			...pan.points,
			vol.fields[0],
			pan.fields[0],
			vol.fields[1],
			vol.fields[2],
			vol.fields[3],
			pan.fields[1],
			pan.fields[2],
			pan.fields[3],
			vol.fields[4],
			pan.fields[4],
			vib?.type ?? 0,
			vib?.sweep ?? 0,
			vib?.depth ?? 0,
			vib?.rate ?? 0,
			...u16(ins.fadeout ?? 0),
			...new Array<number>(22).fill(0),
		);
		for (const s of ins.samples) {
			const width = s.sixteen ? 2 : 1;
			const loops = (s.loopLength ?? 0) > 0;
			out.push(
				...u32(s.pcm.length * width),
				...u32((s.loopStart ?? 0) * width),
				...u32((s.loopLength ?? 0) * width),
				s.volume ?? 64,
				(s.finetune ?? 0) & 0xff,
				(loops ? (s.pingPong ? 2 : 1) : 0) | (s.sixteen ? 16 : 0),
				s.panning ?? 128,
				(s.relativeNote ?? 0) & 0xff,
				0,
				...text(s.name ?? "", 22),
			);
		}

		for (const s of ins.samples) {
			let old = 0;
			for (const v of s.pcm) {
				const delta = v - old;
				old = v;
				out.push(...(s.sixteen ? u16(delta & 0xffff) : [delta & 0xff]));
			}
		}
	}

	const bytes = new Uint8Array(out);
	return spec.cut === undefined ? bytes : bytes.subarray(0, spec.cut);
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
	xm: XmImport;
	written: WrittenTrackerSong;
	brrs: BrrSample[];
	song: Song;
}

/** Reads `bytes`, writes every suggested channel with every sample at factor 1 (or as `options` says), and builds the song. */
export function imported(bytes: Uint8Array, options: Partial<TrackerSongOptions> = {}): Imported {
	const xm = readXm(bytes);
	const written = writeTracker(xm, {
		keep: xm.suggested,
		factors: new Map(),
		separation: 1,
		loop: "jump",
		sampleName: (index) => `XM ${String(index).padStart(2, "0")}.brr`,
		fallbackTitle: null,
		...options,
	});
	const brrs = encoded(xm, written);
	return { xm, written, brrs, song: song(written.text, brrs) };
}

/** How far, in cents, a walked note plays from the semitone the XM plays it nearest to on the same sample. */
export function centsOff(imp: Imported, walked: WalkNote, channel: number, tick: number): number {
	const sample = imp.written.samples.find((s) => s.instrument === walked.state.instrument);
	if (!sample || walked.key === null) {
		return Infinity;
	}

	const register = setPitchWide(walked.key * 256 + walked.state.fineTune, sample.tuning.multiplier, sample.tuning.sub);
	const heard = (register * 32_000) / 0x1000;
	const semitones = Math.round(imp.xm.play.channels[channel].pitch[tick]);
	const base = imp.xm.song.samples[sample.index - 1].baseHz;
	return 1200 * Math.log2(heard / (base * sample.factor * 2 ** (semitones / 12)));
}
