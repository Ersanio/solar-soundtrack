/**
 * Stacked-bar geometry.
 *
 * The ARAM bar spans all 64 KiB, so real regions are routinely a fraction of a
 * percent of it and land on sub-pixel widths. That arithmetic has already gone
 * wrong once — subtracting the inter-segment gap from each segment silently
 * zeroed anything narrower than the gap, so a small song vanished from the bar
 * entirely — and it is awkward to eyeball in a browser. So it lives in a pure
 * function and is checked here.
 *
 *   npm run charttest
 */

import { stackSegments } from "../src/app/shared/chart/stack";

let failures = 0;
function check(name: string, condition: boolean, detail = ""): void {
	if (condition) console.log(`  ok    ${name}`);
	else {
		failures++;
		console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
	}
}

const OPTS = { width: 600, gap: 2, minWidth: 3 };
const EPSILON = 1e-6;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const place = (values: number[], options = OPTS) =>
	stackSegments(
		values.map((value) => ({ value })),
		options,
	);

/** driver, song, samples, free, echo — the shape the ARAM budget produces. */
const REALISTIC = [9069, 700, 21000, 30731, 4096];

console.log("\nevery region that exists stays visible");
{
	for (const songBytes of [1, 120, 218, 700]) {
		const placed = place([9069, songBytes, 21000, 31431 - songBytes, 4096]);
		check(
			`a ${songBytes} byte song is at least ${OPTS.minWidth}px`,
			placed[1].width >= OPTS.minWidth - EPSILON,
			`${placed[1].width.toFixed(2)}px`,
		);
	}
	check(
		"no segment is ever wider than the bar",
		place(REALISTIC).every((p) => p.width <= OPTS.width),
	);
}

console.log("\nthe floor is paid for by donors, not by the total");
{
	const placed = place(REALISTIC);
	const last = placed[placed.length - 1];
	check(
		"the bar ends flush with its container",
		Math.abs(last.x + last.width - OPTS.width) < EPSILON,
		`${(last.x + last.width).toFixed(4)} vs ${OPTS.width}`,
	);
	check(
		"widths plus gaps exactly fill the width",
		Math.abs(sum(placed.map((p) => p.width)) + OPTS.gap * (REALISTIC.length - 1) - OPTS.width) < EPSILON,
	);
	check(
		"segments never overlap",
		placed.every((p, i) => i === 0 || p.x >= placed[i - 1].x + placed[i - 1].width + OPTS.gap - EPSILON),
	);
}

console.log("\nproportions survive where no floor is needed");
{
	const placed = place([1, 1, 2]);
	check("equal values get equal widths", Math.abs(placed[0].width - placed[1].width) < EPSILON);
	check("a doubled value gets double the width", Math.abs(placed[2].width - placed[0].width * 2) < EPSILON);
}

console.log("\ndegenerate input produces no geometry rather than bad geometry");
{
	check("no segments", place([]).length === 0);
	check("all values zero", place([0, 0]).length === 0);
	check("zero width", place([5], { ...OPTS, width: 0 }).length === 0);
	check("negative width", place([5], { ...OPTS, width: -10 }).length === 0);

	// Narrower than minWidth * count + gaps: the floor cannot be honoured.
	const cramped = place([1, 1, 1, 1, 1], { ...OPTS, width: 20 });
	check(
		"a cramped bar has no negative widths",
		cramped.every((p) => p.width >= 0),
	);
	const end = cramped[cramped.length - 1];
	check("a cramped bar does not overflow", end.x + end.width <= 20 + EPSILON, `${(end.x + end.width).toFixed(2)}`);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} check(s) failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
