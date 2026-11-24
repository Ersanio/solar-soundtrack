/** What every `modtest` section shares: a MOD file built in memory, imported, its samples encoded, and the song compiled, walked, diagnosed and assembled as the editor does. */

import "../localize";
import { compiler } from "@amk/compiler";
import type { CompileResult, Diagnostic } from "@amk/core/types";
import {
	type ModImport,
	type ModSongOptions,
	type WrittenModSong,
	planSample,
	readMod,
	writeMod,
} from "@amk/import/mod";
import { type BrrSample, emptySample, parseBrr } from "@amk/spc/brr";
import { encodeBrr } from "@amk/spc/brr-encode";
import { loadDriver } from "@amk/spc/driver";
import { buildSpc } from "@amk/spc/export";
import { readInstrumentTables } from "@amk/spc/instruments";
import { computeSpcLayout } from "@amk/spc/layout";
import { setPitchWide } from "@amk/spc/pitch";
import { type SongTimeline, type WalkNote, unreachableChannels, walkSong } from "@amk/spc/song-walk";
import { tokenize } from "@amk/tokens";
import { commandHazards } from "@amk/tokens/command-hazards";
import { echoHazards } from "@amk/tokens/echo-hazards";
import { pitchRange } from "../../web/src/app/state/pitch-range";
import { repeatSettings, repeatTempo } from "../../web/src/app/state/repeat-carry";
import { stubFetch } from "../harness";

stubFetch();

export const driver = await loadDriver();
export const ARAM = driver.manifest.localPos;
const TABLES = readInstrumentTables(driver.programData, driver.manifest.programPos);

// --- A MOD writer --------------------------------------------------------------

/** A cell: a period (0 for none), a sample (0 for none), an effect and its parameter. */
export interface Cell {
	period?: number;
	sample?: number;
	effect?: number;
	param?: number;
}

export interface SampleSpec {
	name?: string;
	pcm: Int8Array;
	finetune?: number;
	volume?: number;
	/** In frames; a length of 0 plays once. */
	loopStart?: number;
	loopLength?: number;
}

export interface ModSpec {
	title?: string;
	tag?: string;
	channels?: number;
	samples: SampleSpec[];
	orders: number[];
	/** Pattern, then row, then channel; missing rows and cells are empty. */
	patterns: Cell[][][];
	restart?: number;
	/** Write the patterns this many channels wide, as FLT8 stores eight as two fours. */
	storedChannels?: number;
	/** Bytes the file is cut to. */
	cut?: number;
	/** Raw sample-header loop fields in words, overriding `loopStart`/`loopLength`. */
	rawLoop?: { start: number; length: number }[];
}

/** ProTracker's finetune-0 periods, C-1 to B-3. */
export const PERIODS = [
	856, 808, 762, 720, 678, 640, 604, 570, 538, 508, 480, 453, 428, 404, 381, 360, 339, 320, 302, 285, 269, 254, 240,
	226, 214, 202, 190, 180, 170, 160, 151, 143, 135, 127, 120, 113,
];

/** C-2's period, the note a sample plays at its own rate. */
export const C2 = 428;

/** A period for a note `semitones` above C-1 (0 is C-1, 12 is C-2). */
export const period = (semitones: number): number => PERIODS[semitones];

/** A looping square wave, `length` frames to a cycle. */
export function square(length: number, cycles = 1): Int8Array {
	return new Int8Array(length * cycles).map((_, i) => (i % length < length / 2 ? 80 : -80));
}

/** A one-shot decaying sine. */
export function pluck(frames: number, cycle = 32): Int8Array {
	return new Int8Array(frames).map((_, i) =>
		Math.round(100 * Math.exp(-i / (frames / 3)) * Math.sin((2 * Math.PI * i) / cycle)),
	);
}

export function modBytes(spec: ModSpec): Uint8Array {
	const channels = spec.channels ?? 4;
	const stored = spec.storedChannels ?? channels;
	const tag = spec.tag ?? (channels === 4 ? "M.K." : `${channels}CHN`);
	const out: number[] = [];
	const title = (spec.title ?? "TEST").padEnd(20, "\0").slice(0, 20);
	out.push(...[...title].map((c) => c.charCodeAt(0)));
	for (let i = 0; i < 31; i++) {
		const sample = spec.samples[i];
		const name = (sample?.name ?? "").padEnd(22, "\0").slice(0, 22);
		out.push(...[...name].map((c) => c.charCodeAt(0)));
		const words = sample ? sample.pcm.length >> 1 : 0;
		const raw = spec.rawLoop?.[i];
		const loopStart = raw ? raw.start : sample?.loopLength ? (sample.loopStart ?? 0) >> 1 : 0;
		const loopLength = raw ? raw.length : sample?.loopLength ? sample.loopLength >> 1 : 1;
		out.push(words >> 8, words & 0xff, (sample?.finetune ?? 0) & 0x0f, sample?.volume ?? 64);
		out.push(loopStart >> 8, loopStart & 0xff, loopLength >> 8, loopLength & 0xff);
	}

	const orders = [...spec.orders];
	out.push(orders.length, spec.restart ?? 0x7f, ...orders, ...new Array<number>(128 - orders.length).fill(0));
	out.push(...[...tag].map((c) => c.charCodeAt(0)));
	// FLT8 stores each pattern as two, so its last one has a second half.
	const storedPatterns = Math.max(...orders) + (stored === channels ? 1 : 2);
	for (let p = 0; p < storedPatterns; p++) {
		for (let row = 0; row < 64; row++) {
			for (let c = 0; c < stored; c++) {
				const cell = spec.patterns[p]?.[row]?.[c] ?? {};
				const per = cell.period ?? 0;
				const s = cell.sample ?? 0;
				out.push(
					(s & 0xf0) | ((per >> 8) & 0x0f),
					per & 0xff,
					((s & 0x0f) << 4) | ((cell.effect ?? 0) & 0x0f),
					cell.param ?? 0,
				);
			}
		}
	}

	for (const sample of spec.samples) {
		out.push(...[...sample.pcm].map((v) => v & 0xff));
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

export interface Song {
	text: string;
	result: CompileResult;
	timeline: SongTimeline | null;
	/** What the editor's Problems list would hold. */
	diagnostics: Diagnostic[];
	/** The assembled `.spc`, or why it could not be. */
	spc: Uint8Array | string;
	/** ARAM left free. */
	freeBytes: number;
}

export interface Imported {
	mod: ModImport;
	written: WrittenModSong;
	brrs: BrrSample[];
	song: Song;
}

/** Each kept sample planned at its factor and encoded, as the dialog does. */
export function encoded(mod: ModImport, written: WrittenModSong): BrrSample[] {
	return written.samples.map((s) => {
		const plan = planSample(mod.file.samples[s.index - 1], s.factor);
		return parseBrr(s.name, encodeBrr(plan.pcm, plan.loopStart));
	});
}

/** `text` compiled with `extra` beside the stock samples, walked, diagnosed and assembled. */
export function song(text: string, extra: readonly BrrSample[]): Song {
	const result = compiler.compile({
		source: text,
		aramAddress: ARAM,
		options: {
			sampleNames: [...driver.samples.map((s) => s.sampleName), ...extra.map((s) => s.sampleName)],
			sampleGroups: driver.manifest.sampleGroups,
			importantSamples: driver.manifest.importantSamples,
			optimizeSampleUsage: true,
		},
	});
	const index = tokenize(text);
	const timeline = result.data ? walkSong(result.data, ARAM) : null;
	const byName = new Map([...driver.samples, ...extra].map((s) => [s.sampleName, s]));
	const optimized = new Map(driver.optimizedSamples.map((s) => [s.sampleName, s]));
	// As `SampleStore.resolve` does: an entry from `#optimized` takes that group's copy.
	const groups = result.stats?.sampleGroups ?? [];
	const samples = (result.sampleList ?? []).map(
		(name, srcn) =>
			(groups[srcn] === "optimized" ? optimized.get(name) : undefined) ?? byName.get(name) ?? emptySample(name),
	);
	let spc: Uint8Array | string = "no song data";
	let freeBytes = 0;
	if (result.data) {
		freeBytes = computeSpcLayout(driver, samples, result.data.length, result.stats?.echoBufferSize ?? 0).freeBytes;
		try {
			spc = buildSpc({
				songData: result.data,
				driver,
				samples,
				tags: result.stats?.tags,
				seconds: result.stats?.tagSeconds,
				echoBufferSize: result.stats?.echoBufferSize,
			}).spc;
		} catch (error) {
			spc = String(error);
		}
	}

	return {
		text,
		result,
		timeline,
		spc,
		freeBytes,
		diagnostics: [
			...result.diagnostics,
			...echoHazards(index.commands),
			...commandHazards(index),
			...(timeline ? unreachableChannels(timeline, result.noteMap ?? []) : []),
			...(timeline ? repeatTempo(timeline, result.commandMap ?? []) : []),
			...(timeline ? repeatSettings(timeline, { result, text }) : []),
			...(timeline ? pitchRange(timeline, result, TABLES) : []),
		],
	};
}

/** Reads `bytes`, writes every suggested channel with every sample at factor 1 (or as `options` says), and builds the song. */
export function imported(bytes: Uint8Array, options: Partial<ModSongOptions> = {}): Imported {
	const mod = readMod(bytes);
	const written = writeMod(mod, {
		keep: mod.suggested,
		factors: new Map(),
		separation: 0.5,
		loop: "jump",
		sampleName: (index) => `MOD ${String(index).padStart(2, "0")}.brr`,
		fallbackTitle: null,
		...options,
	});
	const brrs = encoded(mod, written);
	return { mod, written, brrs, song: song(written.text, brrs) };
}

/** Errors and warnings, not notes: what a clean import must not raise. */
export function problems(built: Song): string[] {
	return built.diagnostics.filter((d) => d.severity !== "info").map((d) => `${d.code} ${d.message}`);
}

/** The walk's notes on one channel. */
export function played(built: Song, channel: number): WalkNote[] {
	return (built.timeline?.notes ?? []).filter((n) => n.channel === channel);
}

/**
 * How far, in cents, a walked note plays from the semitone the MOD plays `modPeriod` nearest to, on the
 * same sample: the semitone a letter can be written at, at the sample's C-2 rate and finetune. A period
 * between semitones is written at the nearer, so what is left is the tuning's own error.
 */
export function centsOff(imp: Imported, walked: WalkNote, modPeriod: number): number {
	const sample = imp.written.samples.find((s) => s.instrument === walked.state.instrument);
	if (!sample || walked.key === null) {
		return Infinity;
	}

	const register = setPitchWide(walked.key * 256 + walked.state.fineTune, sample.tuning.multiplier, sample.tuning.sub);
	const heard = (register * 32_000) / 0x1000;
	const finetune = imp.mod.file.samples[sample.index - 1].finetune;
	const semitones = Math.round(12 * Math.log2(C2 / modPeriod));
	const wanted = (3_546_895 / C2) * sample.factor * 2 ** (finetune / 96) * 2 ** (semitones / 12);
	return 1200 * Math.log2(heard / wanted);
}
