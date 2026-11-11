/** `charttest`: the slider's track. */

import "../localize";
import {
	mirror,
	readout,
	trackBounds,
	trackFraction,
	trackImage,
	trackPosition,
	valueAt,
} from "../../web/src/app/shared/slider/slider-track";
import { check, section } from "../harness";

section("the slider's track, whose two rules fail invisibly");
{
	// A slider with `stops` is an index into that list; a plain one is its value.
	const STOPS = [0, 1, 2, 4, 8, 16];
	const overStops = trackBounds(STOPS, -128, 127);
	const plain = trackBounds(null, -128, 127);

	check("stops are indexed from 0", overStops.low === 0 && overStops.high === STOPS.length - 1);
	check("a plain track is its own range", plain.low === -128 && plain.high === 127);

	check("a value on a stop takes its index", trackPosition(4, STOPS) === 3);
	check("and one between stops takes the nearest", trackPosition(3, STOPS) === 2 && trackPosition(12, STOPS) === 4);
	check("a value past the end pins to the last stop", trackPosition(999, STOPS) === 5);
	check("a plain track passes the value through", trackPosition(-40, null) === -40);

	// The claim: `mirror` is its own inverse. AddmusicK's pan runs backwards
	// (main.asm:3486) and the roll's own `invert` relies on one function serving
	// both directions — the thumb going out, and the raw input coming back.
	let notInvolutive = "";
	for (const bounds of [plain, overStops, { low: 0, high: 0 }, { low: -7, high: 7 }]) {
		for (let n = bounds.low; n <= bounds.high; n++) {
			if (mirror(mirror(n, bounds, true), bounds, true) !== n) {
				notInvolutive += ` ${n} in ${bounds.low}..${bounds.high}`;
			}

			if (mirror(n, bounds, false) !== n) {
				notInvolutive += ` uninverted moved ${n}`;
			}
		}
	}

	check("mirroring twice is the identity", notInvolutive === "", notInvolutive);
	check("and it reflects through the middle", mirror(-128, plain, true) === 127);

	check("the fraction runs 0 to 1 across the track", trackFraction(-128, plain) === 0);
	check("  and reaches 1 at the top", trackFraction(127, plain) === 1);
	check("  with the centre at a half", trackFraction(-0.5, plain) === 0.5);
	check("a track of no width is 0 rather than NaN", trackFraction(5, { low: 5, high: 5 }) === 0);

	// The claim: the centre detent is listed *first*, which in CSS paints it over
	// the fill. The fill always reaches the centre by definition, so a detent
	// underneath it could never be seen at any value but the extremes.
	let detentBehind = "";
	for (let percent = 0; percent <= 100; percent += 5) {
		const image = trackImage(percent / 100, true);
		const detent = image.indexOf("--color-ink-muted");
		const fill = image.indexOf("--color-control");
		if (detent < 0 || fill < 0 || detent > fill) {
			detentBehind += ` ${percent}%`;
		}
	}

	check("the centre detent is drawn over the fill at every value", detentBehind === "", detentBehind);
	check("an off-centre track has no detent at all", !trackImage(0.5, false).includes("--color-ink-muted"));

	// Out of range at either end still produces a usable gradient rather than a
	// percentage CSS drops the whole declaration over.
	let unclamped = "";
	for (const fraction of [-2, -0.01, 0, 0.5, 1, 1.01, 5]) {
		for (const centred of [true, false]) {
			const image = trackImage(fraction, centred);
			// Every bare percentage in the gradient — the `calc(50% ± 1px)` detent
			// is written as a calc and is not one of these.
			const stops = [...image.matchAll(/(?<![\w(])(-?\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
			if (stops.some((stop) => stop < 0 || stop > 100)) {
				unclamped += ` ${fraction}${centred ? " centred" : ""} -> ${stops.join(",")}`;
			}
		}
	}

	check("a fraction outside 0..1 is clamped into the gradient", unclamped === "", unclamped);

	// The round trip a drag makes: a track coordinate back to a value.
	check("an inverted plain track reads back its value", valueAt(127, null, plain, true, 0) === -128);
	check("an inverted stop track reads back its stop", valueAt(0, STOPS, overStops, true, -1) === 16);
	check("an uninverted stop track reads straight through", valueAt(3, STOPS, overStops, false, -1) === 4);
	check("a coordinate off the stop list falls back", valueAt(99, STOPS, overStops, false, -1) === -1);

	check("the readout signs a positive value", readout(5, null, true) === "+5");
	check("  leaves a negative alone", readout(-5, null, true) === "-5");
	check("  and an unsigned one alone", readout(5, null, false) === "5");
	check("a caller's own label wins", readout(5, "12 ticks", true) === "12 ticks");
}
