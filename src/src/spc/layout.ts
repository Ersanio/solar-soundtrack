/**
 * ARAM layout and budgeting.
 *
 * Everything AddmusicK occupies before your song — the driver, its sound
 * effects, the song pointer table and every global song — lives inside
 * `main.bin`. So the budget needs no modelling: load the driver from the install
 * you are targeting and the numbers are exact by construction.
 *
 * The bundled driver is a second-pass build with no song table, so for that one
 * we append a single-slot table. Load your own `asm/SNES/bin/main.bin` to see
 * the real figures.
 */

import type { BrrSample, DriverBundle } from "./driver";

export const ARAM_SIZE = 0x10000;

export interface AramPlan {
	/** Driver image, plus a song pointer table if the build lacked one. */
	programImage: Uint8Array;
	/** ARAM address the song is compiled and loaded at. */
	localPos: number;
	/** Value for CPUIO $F6. */
	songIndex: number;
	/** Bytes of song pointer table we appended; 0 when the driver had its own. */
	appendedTableBytes: number;
	/** True when main.bin already carried its own table and global songs. */
	fromEmbeddedTable: boolean;
}

/**
 * Works out where the song goes.
 *
 * With a driver that already has a song table we simply use it — the local song
 * slot is whatever AddmusicK reserved, and everything before it is real data.
 * Otherwise `SongPointers:` is the last label in `main.asm`, so the table begins
 * exactly where the image ends; we append one slot pointing just past itself.
 */
export function planAram(driver: DriverBundle): AramPlan {
	const { programData, embedded } = driver;

	if (embedded) {
		return {
			programImage: programData,
			localPos: embedded.localPos,
			songIndex: embedded.songIndex,
			appendedTableBytes: 0,
			fromEmbeddedTable: true,
		};
	}

	const localPos = driver.songPointers + 2;
	const programImage = new Uint8Array(programData.length + 2);
	programImage.set(programData, 0);
	programImage[programData.length] = localPos & 0xff;
	programImage[programData.length + 1] = (localPos >> 8) & 0xff;

	// Song numbers are 1-based, so the slot we just wrote is song 1.
	return { programImage, localPos, songIndex: 1, appendedTableBytes: 2, fromEmbeddedTable: false };
}

// ---------------------------------------------------------------------------
// Address layout
// ---------------------------------------------------------------------------

export interface SpcLayout {
	programPos: number;
	programEnd: number;
	songPos: number;
	songEnd: number;
	sampleTablePos: number;
	sampleTableEnd: number;
	sampleDataPos: number;
	sampleDataEnd: number;
	echoStart: number;
	echoEnd: number;
	/** Bytes between the end of sample data and the echo buffer. Negative = overflow. */
	freeBytes: number;
}

/**
 * Where everything lands in ARAM. Shared by the SPC writer and the budget panel
 * so the two can never disagree.
 */
export function computeSpcLayout(
	plan: AramPlan,
	programPos: number,
	samples: BrrSample[],
	songBytes: number,
	echoBufferSize: number,
): SpcLayout {
	const songPos = plan.localPos;
	const songEnd = songPos + songBytes;

	// The sample directory must start on a page boundary — the DSP's DIR register
	// only stores the high byte.
	let sampleTablePos = songEnd;
	if ((sampleTablePos & 0xff) !== 0) sampleTablePos = (sampleTablePos & 0xff00) + 0x100;

	const sampleTableEnd = sampleTablePos + samples.length * 4;

	let sampleDataEnd = sampleTableEnd;
	const seen = new Set<BrrSample>();
	for (const sample of samples) {
		if (seen.has(sample)) continue;
		seen.add(sample);
		sampleDataEnd += sample.data.length;
	}

	// AddmusicK.cpp:1345 — the echo buffer sits at the top of ARAM, or occupies a
	// token $FF00-$FF03 when the song uses no echo.
	const echoSize = echoBufferSize << 11;
	const echoStart = echoSize > 0 ? ARAM_SIZE - echoSize : 0xff00;
	const echoEnd = echoSize > 0 ? ARAM_SIZE : 0xff04;

	return {
		programPos,
		programEnd: programPos + plan.programImage.length,
		songPos,
		songEnd,
		sampleTablePos,
		sampleTableEnd,
		sampleDataPos: sampleTableEnd,
		sampleDataEnd,
		echoStart,
		echoEnd,
		freeBytes: echoStart - sampleDataEnd,
	};
}

// ---------------------------------------------------------------------------
// Budget breakdown
// ---------------------------------------------------------------------------

export type BudgetKey =
	| "variables"
	| "driver"
	| "song"
	| "align"
	| "sampleTable"
	| "samples"
	| "free"
	| "echo";

export interface BudgetRow {
	key: BudgetKey;
	label: string;
	start: number;
	bytes: number;
	/** Which stacked-bar segment this row rolls up into. */
	group: "driver" | "song" | "samples" | "free" | "echo";
	/** Extra context shown beside the label. */
	detail?: string;
}

export interface AramBudget {
	rows: BudgetRow[];
	layout: SpcLayout;
	usedBytes: number;
	freeBytes: number;
	/** Bytes over budget; 0 when everything fits. */
	overflowBytes: number;
}

/**
 * `samples` is required rather than taken from `driver`, for the same reason
 * `buildSpc` requires it: a song can name its own set with `#samples`, and a
 * budget computed against the driver's default would quietly disagree with the
 * SPC that actually gets written. See `SpcExportRequest.samples`.
 */
export function computeBudget(
	driver: DriverBundle,
	samples: BrrSample[],
	plan: AramPlan,
	songBytes: number,
	echoBufferSize: number,
): AramBudget {
	const layout = computeSpcLayout(plan, driver.programPos, samples, songBytes, echoBufferSize);

	/** Directory entries that actually carry data, i.e. were not emptied. */
	const loaded = samples.reduce((count, sample) => (sample.data.length > 0 ? count + 1 : count), 0);

	// Everything below the song is one line item, because it is one file. The
	// detail names only what we can actually verify from the bytes — whether the
	// image carries its own song table and global songs — since that is what
	// decides whether this figure matches a real install. Sound effects are in
	// there too, but nothing here confirms it (a !noSFX build has none).
	const driverDetail = driver.embedded
		? `song table + ${driver.embedded.globalSongCount} global song(s) included`
		: "song table appended; no global songs";

	const rows: BudgetRow[] = [
		{ key: "variables", label: "driver variables", start: 0, bytes: driver.programPos, group: "driver" },
		{
			key: "driver",
			label: "driver",
			detail: driverDetail,
			start: driver.programPos,
			bytes: plan.programImage.length,
			group: "driver",
		},
	];

	rows.push(
		{ key: "song", label: "your song", start: layout.songPos, bytes: songBytes, group: "song" },
		{
			// The sample directory has to start on a page boundary, so whatever is
			// left of the page after the song is unusable. Up to 255 bytes.
			key: "align",
			label: "page alignment",
			start: layout.songEnd,
			bytes: layout.sampleTablePos - layout.songEnd,
			group: "samples",
		},
		{
			key: "sampleTable",
			label: "sample directory",
			start: layout.sampleTablePos,
			bytes: layout.sampleTableEnd - layout.sampleTablePos,
			group: "samples",
		},
		{
			key: "samples",
			// Directory entries and actual samples are not the same number once
			// optimisation has emptied the unplayed ones. Reporting only the
			// entry count reads as "the whole default set is loaded" no matter what
			// was really uploaded, so say both when they differ.
			label: loaded === samples.length ? `samples (${samples.length})` : `samples (${loaded} of ${samples.length})`,
			start: layout.sampleDataPos,
			bytes: layout.sampleDataEnd - layout.sampleDataPos,
			group: "samples",
		},
		{ key: "free", label: "free", start: layout.sampleDataEnd, bytes: Math.max(0, layout.freeBytes), group: "free" },
		{
			// Everything from echoStart up is off limits. With no echo that is still
			// a whole page: AddmusicK parks a 4-byte stub at $FF00 and nothing may
			// be allocated above it.
			key: "echo",
			label: echoBufferSize > 0 ? "echo buffer" : "echo buffer (reserved)",
			start: layout.echoStart,
			bytes: ARAM_SIZE - layout.echoStart,
			group: "echo",
		},
	);

	const usedBytes = ARAM_SIZE - Math.max(0, layout.freeBytes);

	return {
		rows,
		layout,
		usedBytes,
		freeBytes: layout.freeBytes,
		overflowBytes: layout.freeBytes < 0 ? -layout.freeBytes : 0,
	};
}
