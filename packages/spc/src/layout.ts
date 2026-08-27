/**
 * ARAM layout and budgeting.
 *
 * Everything AddmusicK occupies before your song lives inside `main.bin`, so the
 * budget needs no modelling — the bytes that would have to be modelled are
 * physically present in the image.
 */

import type { BrrSample } from "./brr";
import type { DriverBundle } from "./driver";

export const ARAM_SIZE = 0x10000;

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
	freeBytes: number;
}

/**
 * Where everything lands in ARAM. Shared by the SPC writer and the budget panel
 * so the two can never disagree.
 */
export function computeSpcLayout(
	driver: DriverBundle,
	samples: BrrSample[],
	songBytes: number,
	echoBufferSize: number,
): SpcLayout {
	const { programPos, localPos } = driver.manifest;
	const songPos = localPos;
	const songEnd = songPos + songBytes;

	// The sample directory must start on a page boundary — the DSP's DIR register
	// only stores the high byte.
	let sampleTablePos = songEnd;
	if ((sampleTablePos & 0xff) !== 0) {
		sampleTablePos = (sampleTablePos & 0xff00) + 0x100;
	}

	const sampleTableEnd = sampleTablePos + samples.length * 4;

	let sampleDataEnd = sampleTableEnd;
	const seen = new Set<BrrSample>();
	for (const sample of samples) {
		if (seen.has(sample)) {
			continue;
		}

		seen.add(sample);
		sampleDataEnd += sample.data.length;
	}

	// AddmusicK.cpp:1351 — the echo buffer sits at the top of ARAM, or a token
	// $FF00-$FF03 when the song uses no echo. It is never absent: with EDL 0 the
	// `beq` at main.asm:2608 skips the address maths, but `eor #$FF` still runs and
	// leaves ESA at $FF, and the DSP writes four bytes per sample there regardless —
	// which is what the spin-wait at main.asm:2624 exists for.
	//
	// echoStart reserves the whole page rather than those four bytes, because ESA
	// stores a high byte only and nothing else can share the page. That is stricter
	// than AddmusicK, which reserves nothing here (AddmusicK.cpp:1341 adds a
	// zero-length buffer) and so would let samples run to $10000 and be clobbered by
	// that write. The cost is reporting 256 B less free than it does.
	const echoSize = echoBufferSize << 11;
	const echoStart = echoSize > 0 ? ARAM_SIZE - echoSize : 0xff00;
	const echoEnd = echoSize > 0 ? ARAM_SIZE : 0xff04;

	return {
		programPos,
		programEnd: programPos + driver.programData.length,
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

/** The five regions of ARAM, in memory order. */
export type BudgetKey = "driver" | "song" | "samples" | "free" | "echo";

export interface BudgetRow {
	key: BudgetKey;
	label: string;
	start: number;
	bytes: number;
	detail?: string;
}

export interface AramBudget {
	rows: BudgetRow[];
	layout: SpcLayout;
	freeBytes: number;
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
	songBytes: number,
	echoBufferSize: number,
): AramBudget {
	const layout = computeSpcLayout(driver, samples, songBytes, echoBufferSize);

	/** Directory entries that actually carry data, i.e. were not emptied. */
	const loaded = samples.reduce((count, sample) => (sample.data.length > 0 ? count + 1 : count), 0);

	// Directory entries and actual samples are not the same number once
	// optimisation has emptied the unplayed ones. Reporting only the entry count
	// reads as "the whole default set is loaded" no matter what was really
	// uploaded, so say both when they differ.
	const sampleDetail =
		loaded === samples.length
			? `${samples.length} ${samples.length === 1 ? "sample" : "samples"}`
			: `${loaded} of ${samples.length} loaded`;

	const rows: BudgetRow[] = [
		{
			// Everything below the song is one line item, because it is one file —
			// the driver, its zero-page variables, its sound effects, the song
			// pointer table and every global song.
			//
			// Up to the song, not to the end of the image. The local song's slot is
			// *inside* the image — AddmusicK leaves the last song it compiled
			// sitting there — so `programEnd` runs past `songPos` and the two rows
			// would double-count the difference. Everything from `localPos` up
			// belongs to the song, whatever is currently in it.
			key: "driver",
			label: "SPC-700 engine",
			start: 0,
			bytes: layout.songPos,
		},
		{ key: "song", label: "your song", start: layout.songPos, bytes: songBytes },
		{
			// Song end rather than sampleDataPos: the directory must start on a page
			// boundary, so up to 255 bytes of the song's last page are unusable, and
			// the directory itself is four bytes per entry. Both exist only to carry
			// samples, so both are counted as sample data.
			key: "samples",
			label: "sample data",
			detail: sampleDetail,
			start: layout.songEnd,
			bytes: layout.sampleDataEnd - layout.songEnd,
		},
		{ key: "free", label: "free", start: layout.sampleDataEnd, bytes: Math.max(0, layout.freeBytes) },
		{
			// Everything from echoStart up is off limits — a whole page even with no
			// echo, for the reason computeSpcLayout gives.
			key: "echo",
			label: echoBufferSize > 0 ? "echo buffer" : "echo buffer (reserved)",
			start: layout.echoStart,
			bytes: ARAM_SIZE - layout.echoStart,
		},
	];

	return {
		rows,
		layout,
		freeBytes: layout.freeBytes,
		overflowBytes: layout.freeBytes < 0 ? -layout.freeBytes : 0,
	};
}
