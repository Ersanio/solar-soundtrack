/**
 * Assembles a playable .spc file from compiled song data plus the prebuilt driver
 * bundle.
 *
 * Direct port of `generateSPCs` (AddmusicK.cpp:1445). The file is a fixed 0x10200
 * bytes; README.md has the map.
 */

import { hex4 as hex } from "@amk/core/hex";
import type { SongTags } from "@amk/core/types";
import type { BrrSample } from "./brr";
import type { DriverBundle } from "./driver";
import { ARAM_SIZE, type SpcLayout, computeSpcLayout } from "./layout";

export type { SpcLayout } from "./layout";

const SPC_SIZE = 0x10200;
const ARAM_BASE = 0x100;
const DSP_BASE = 0x10100;

/** SPC header field offsets (ID666, text format). */
const HEADER = {
	pc: 0x25,
	title: 0x2e,
	game: 0x4e,
	dumper: 0x6e,
	comment: 0x7e,
	date: 0x9e,
	lengthSeconds: 0xa9,
	fade: 0xac,
	artist: 0xb1,
} as const;

/** ARAM addresses the SPC dump has to prime by hand. */
const ARAM = {
	/** FLG DSP register mirror; 0x20 disables echo writes on load. */
	flgMirror: 0x5f,
	/** CPUIO ports. $F5 selects the Yoshi drum variant, $F6 the song. */
	port1: 0xf5,
	port2: 0xf6,
} as const;

/** DSP register index for the sample directory page. */
const DSP_DIR = 0x5d;

export interface SpcExportRequest {
	/** Compiled song data, relocated for the driver manifest's `localPos`. */
	songData: Uint8Array;
	driver: DriverBundle;
	/** The sample set, in SRCN order — index 0 becomes directory entry 0. */
	samples: BrrSample[];
	tags?: SongTags;
	/** Estimated play length. Falls back to the `#length` tag, then 0. */
	seconds?: number | null;
	/** Fade length written to the ID666 tag. AddmusicK always writes 10000. */
	fadeMs?: number;
	/** Echo buffer size in 2 KiB units, from the compiler's stats. */
	echoBufferSize?: number;
	/**
	 * Emit the Yoshi drums variant ($F5 = 2).
	 *
	 * No caller passes it yet. The compiler does the detecting — `$F4 $00` and
	 * `$F4 $06` set `ParseOutput.hasYoshiDrums` (`parser.ts:3428`) — and nothing
	 * carries that as far as here, so the two halves of the feature exist and
	 * are not joined. Kept because deleting this one leaves the other saying
	 * something nothing can act on.
	 */
	yoshiDrums?: boolean;
	/** Overridable for reproducible output in tests. */
	date?: Date;
}

export interface SpcExportResult {
	spc: Uint8Array;
	layout: SpcLayout;
}

export class SpcExportError extends Error {}

export function buildSpc(request: SpcExportRequest): SpcExportResult {
	const { songData, driver, samples, tags = {}, yoshiDrums = false } = request;
	const { programPos, mainLoopPos, localPos, songIndex } = driver.manifest;
	const layout = computeSpcLayout(driver, samples, songData.length, request.echoBufferSize ?? 0);

	const spc = new Uint8Array(SPC_SIZE);
	spc.set(driver.spcBase.subarray(0, Math.min(driver.spcBase.length, SPC_SIZE)), 0);

	// --- ID666 tags ---------------------------------------------------------
	writeText(spc, HEADER.title, 32, tags.title ?? "");
	writeText(spc, HEADER.game, 32, tags.game ?? "Super Mario World (custom)");
	writeText(spc, HEADER.comment, 32, tags.comment ?? "");
	writeText(spc, HEADER.artist, 32, tags.author ?? "");
	writeText(spc, HEADER.dumper, 16, "Solar Soundtrack");
	writeText(spc, HEADER.date, 11, formatDate(request.date ?? new Date()));

	const seconds = resolveSeconds(request.seconds, tags.length);
	writeDigits(spc, HEADER.lengthSeconds, 3, seconds);
	writeDigits(spc, HEADER.fade, 5, request.fadeMs ?? 10000);

	// PC starts at the driver's main loop; the dump represents post-init state.
	spc[HEADER.pc] = mainLoopPos & 0xff;
	spc[HEADER.pc + 1] = (mainLoopPos >> 8) & 0xff;

	// --- ARAM ---------------------------------------------------------------
	const aram = spc.subarray(ARAM_BASE, ARAM_BASE + ARAM_SIZE);

	aram.set(driver.programData, programPos);
	aram.set(songData, localPos);

	const tablePos = layout.sampleTablePos;
	let samplePos = layout.sampleDataPos;

	// Deduplicate identical samples: reuse the earlier entry's pointers rather
	// than embedding the data twice (AddmusicK.cpp:1581).
	const writtenAt = new Map<BrrSample, number>();

	for (let index = 0; index < samples.length; index++) {
		const sample = samples[index];
		const entry = tablePos + index * 4;
		const existing = writtenAt.get(sample);

		if (existing !== undefined) {
			aram.copyWithin(entry, existing, existing + 4);
			continue;
		}

		const end = samplePos + sample.data.length;
		if (end > ARAM_SIZE) {
			throw new SpcExportError(
				`Sample data overflows ARAM by ${end - ARAM_SIZE} bytes. ` +
					`Song is 0x${hex(songData.length)} bytes; samples need 0x${hex(totalSampleBytes(samples))}.`,
			);
		}

		const loop = samplePos + sample.loopOffset;
		aram[entry] = samplePos & 0xff;
		aram[entry + 1] = (samplePos >> 8) & 0xff;
		aram[entry + 2] = loop & 0xff;
		aram[entry + 3] = (loop >> 8) & 0xff;

		aram.set(sample.data, samplePos);
		writtenAt.set(sample, entry);
		samplePos = end;
	}

	// --- DSP and driver handshake -------------------------------------------
	spc.set(driver.dspBase.subarray(0, SPC_SIZE - DSP_BASE), DSP_BASE);
	spc[DSP_BASE + DSP_DIR] = (tablePos >> 8) & 0xff;

	aram[ARAM.flgMirror] = 0x20;
	if (yoshiDrums) {
		aram[ARAM.port1] = 2;
	}

	aram[ARAM.port2] = songIndex;

	if (samplePos > layout.echoStart) {
		throw new SpcExportError(
			`Sample data runs into the echo buffer (ends at $${hex(samplePos)}, buffer starts at $${hex(layout.echoStart)}).`,
		);
	}

	return { spc, layout };
}

/** Suggested filename for a compiled song. */
export function spcFilename(tags: SongTags): string {
	const base = (tags.title ?? "song").trim() || "song";
	return `${base.replace(/[^\w.\- ]+/g, "_")}.spc`;
}

// ---------------------------------------------------------------------------

function totalSampleBytes(samples: BrrSample[]): number {
	let total = 0;
	for (const sample of samples) {
		total += sample.data.length + 4;
	}

	return total;
}

/** Latin-1, NUL-padded, hard-truncated — matching AddmusicK's byte copy. */
function writeText(spc: Uint8Array, offset: number, length: number, value: string): void {
	for (let index = 0; index < length; index++) {
		const code = index < value.length ? value.charCodeAt(index) : 0;
		spc[offset + index] = code < 0x100 ? code : 0x3f; // '?' for non-Latin-1
	}
}

/**
 * ID666 stores length and fade as ASCII digits, not integers
 * ("Why on Earth is the value stored as plain text...?" — AddmusicK.cpp:1614).
 */
function writeDigits(spc: Uint8Array, offset: number, length: number, value: number): void {
	const clamped = Math.max(0, Math.min(value, 10 ** length - 1));
	const text = String(Math.floor(clamped)).padStart(length, "0");
	for (let index = 0; index < length; index++) {
		spc[offset + index] = text.charCodeAt(index);
	}
}

function formatDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${month}/${day}/${date.getFullYear()}`;
}

/** Prefer the compiler's estimate; fall back to parsing a `#length "m:ss"` tag. */
function resolveSeconds(estimated: number | null | undefined, tag: string | undefined): number {
	if (typeof estimated === "number" && Number.isFinite(estimated)) {
		return estimated;
	}

	if (tag) {
		const match = /^\s*(?:(\d+):)?(\d+)\s*$/.exec(tag);
		if (match) {
			return Number(match[1] ?? 0) * 60 + Number(match[2]);
		}
	}

	return 0;
}
