/** What every `s3mtest` section shares: an S3M file built in memory, imported, its samples encoded, and the song compiled, walked, diagnosed and assembled as the editor does. */

import "../localize";
import { type S3mImport, readS3m } from "@amk/import/s3m";
import { type TrackerSongOptions, type WrittenTrackerSong, writeTracker } from "@amk/import/tracker";
import type { BrrSample } from "@amk/spc/brr";
import { setPitchWide } from "@amk/spc/pitch";
import type { WalkNote } from "@amk/spc/song-walk";
import { type Song, encoded, song } from "../modtest/support";

export { played, problems } from "../modtest/support";

// --- An S3M writer --------------------------------------------------------------

/** A cell: a note byte (or a name such as `C-4`, or `^^` for a cut), an instrument, a volume, a command letter and its info. */
export interface Cell {
	note?: number | string;
	instrument?: number;
	volume?: number;
	command?: string;
	info?: number;
}

export interface SampleSpec {
	name?: string;
	/** 8-bit values (-128..127) unless `sixteen`. */
	pcm: readonly number[] | Int16Array | Int8Array;
	sixteen?: boolean;
	stereo?: boolean;
	c2spd?: number;
	volume?: number;
	loopStart?: number;
	/** Frames; 0 or absent plays once. */
	loopLength?: number;
	adlib?: boolean;
}

export interface S3mSpec {
	title?: string;
	/** Channel settings, 32 at most; by default `channels` PCM channels alternating left and right. */
	settings?: number[];
	channels?: number;
	/** The pan table, written with byte 53 at 252: an entry per channel, `0x20 | pan` to set one. */
	pans?: number[];
	/** Master volume's stereo bit; a mono song centres every channel. */
	stereo?: boolean;
	flags?: number;
	tracker?: number;
	/** 1 for signed samples, 2 for unsigned (the default, as ST3 writes them). */
	ffi?: number;
	globalVolume?: number;
	speed?: number;
	tempo?: number;
	samples: SampleSpec[];
	orders: number[];
	/** Pattern, then row, then channel; missing rows and cells are empty. */
	patterns: Cell[][][];
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

/** A note byte for `C-4`, `F#5` and so on, 254 for `^^`. */
export function note(name: string): number {
	if (name === "^^") {
		return 254;
	}

	return (Number(name[2]) << 4) | SEMITONES[name.slice(0, 2)];
}

/** The note byte `semitones` above C-0. */
export const noteAt = (semitones: number): number => (Math.floor(semitones / 12) << 4) | (semitones % 12);

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

const align = (out: number[]): void => {
	while (out.length % 16 !== 0) {
		out.push(0);
	}
};

const text = (s: string, length: number): number[] =>
	[...s.padEnd(length, "\0").slice(0, length)].map((c) => c.charCodeAt(0));
const u16 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

export function s3mBytes(spec: S3mSpec): Uint8Array {
	const channels = spec.channels ?? 4;
	const settings =
		spec.settings ?? Array.from({ length: 32 }, (_, i) => (i < channels ? (i % 2 === 0 ? i >> 1 : 8 + (i >> 1)) : 255));
	const ffi = spec.ffi ?? 2;
	const patternCount = Math.max(0, ...spec.orders.filter((o) => o < 254)) + 1;
	const header = [
		...text(spec.title ?? "TEST", 28),
		0x1a,
		16,
		0,
		0,
		...u16(spec.orders.length),
		...u16(spec.samples.length),
		...u16(patternCount),
		...u16(spec.flags ?? 0),
		...u16(spec.tracker ?? 0x1320),
		...u16(ffi),
		...text("SCRM", 4),
		spec.globalVolume ?? 64,
		spec.speed ?? 6,
		spec.tempo ?? 125,
		(spec.stereo ?? true) ? 0xb0 : 0x30,
		0,
		spec.pans ? 252 : 0,
		...new Array<number>(10).fill(0),
		...Array.from({ length: 32 }, (_, i) => settings[i] ?? 255),
	];
	const out = [...header, ...spec.orders];
	const instrumentPointers = out.length;
	out.push(...new Array<number>(spec.samples.length * 2).fill(0));
	const patternPointers = out.length;
	out.push(...new Array<number>(patternCount * 2).fill(0));
	if (spec.pans) {
		out.push(...Array.from({ length: 32 }, (_, i) => spec.pans?.[i] ?? 0));
	}

	align(out);
	const headerAt: number[] = [];
	for (let i = 0; i < spec.samples.length; i++) {
		headerAt.push(out.length);
		out.splice(instrumentPointers + i * 2, 2, ...u16(out.length >> 4));
		out.push(...new Array<number>(0x50).fill(0));
	}

	for (let p = 0; p < patternCount; p++) {
		align(out);
		out.splice(patternPointers + p * 2, 2, ...u16(out.length >> 4));
		const packed: number[] = [];
		for (let row = 0; row < 64; row++) {
			const cells = spec.patterns[p]?.[row] ?? [];
			cells.forEach((cell, channel) => {
				if (!cell || Object.keys(cell).length === 0) {
					return;
				}

				let what = channel;
				const bytes: number[] = [];
				if (cell.note !== undefined || cell.instrument !== undefined) {
					what |= 32;
					const n = typeof cell.note === "string" ? note(cell.note) : (cell.note ?? 255);
					bytes.push(n, cell.instrument ?? 0);
				}

				if (cell.volume !== undefined) {
					what |= 64;
					bytes.push(cell.volume);
				}

				if (cell.command !== undefined || cell.info !== undefined) {
					what |= 128;
					bytes.push(cell.command ? cell.command.charCodeAt(0) - 64 : 0, cell.info ?? 0);
				}

				packed.push(what, ...bytes);
			});
			packed.push(0);
		}

		out.push(...u16(packed.length + 2), ...packed);
	}

	spec.samples.forEach((sample, i) => {
		align(out);
		const at = headerAt[i];
		const frames = sample.pcm.length / (sample.stereo ? 2 : 1);
		const memseg = out.length >> 4;
		const loops = (sample.loopLength ?? 0) > 0;
		const loopStart = sample.loopStart ?? 0;
		const fields = [
			sample.adlib ? 2 : 1,
			...text("", 12),
			(memseg >> 16) & 0xff,
			...u16(memseg & 0xffff),
			...u32(frames),
			...u32(loopStart),
			...u32(loops ? loopStart + (sample.loopLength ?? 0) : 0),
			sample.volume ?? 64,
			0,
			0,
			(loops ? 1 : 0) | (sample.stereo ? 2 : 0) | (sample.sixteen ? 4 : 0),
			...u32(sample.c2spd ?? 8363),
			...new Array<number>(12).fill(0),
			...text(sample.name ?? "", 28),
			...text("SCRS", 4),
		];
		out.splice(at, fields.length, ...fields);
		for (const v of sample.pcm) {
			if (sample.sixteen) {
				out.push(...u16(ffi === 1 ? v & 0xffff : (v + 0x8000) & 0xffff));
			} else {
				out.push(ffi === 1 ? v & 0xff : (v + 0x80) & 0xff);
			}
		}
	});

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
	s3m: S3mImport;
	written: WrittenTrackerSong;
	brrs: BrrSample[];
	song: Song;
}

/** Reads `bytes`, writes every suggested channel with every sample at factor 1 (or as `options` says), and builds the song. */
export function imported(bytes: Uint8Array, options: Partial<TrackerSongOptions> = {}): Imported {
	const s3m = readS3m(bytes);
	const written = writeTracker(s3m, {
		keep: s3m.suggested,
		factors: new Map(),
		separation: 1,
		loop: "jump",
		sampleName: (index) => `S3M ${String(index).padStart(2, "0")}.brr`,
		fallbackTitle: null,
		...options,
	});
	const brrs = encoded(s3m, written);
	return { s3m, written, brrs, song: song(written.text, brrs) };
}

/**
 * How far, in cents, a walked note plays from the semitone the S3M plays it nearest to on the same
 * sample, as `modtest`'s `centsOff` measures a MOD's: what is left is the tuning's own error.
 */
export function centsOff(imp: Imported, walked: WalkNote, channel: number, tick: number): number {
	const sample = imp.written.samples.find((s) => s.instrument === walked.state.instrument);
	if (!sample || walked.key === null) {
		return Infinity;
	}

	const register = setPitchWide(walked.key * 256 + walked.state.fineTune, sample.tuning.multiplier, sample.tuning.sub);
	const heard = (register * 32_000) / 0x1000;
	const semitones = Math.round(imp.s3m.play.channels[channel].pitch[tick]);
	const base = imp.s3m.song.samples[sample.index - 1].baseHz;
	return 1200 * Math.log2(heard / (base * sample.factor * 2 ** (semitones / 12)));
}
