/** `audiotest`: the DSP plays the pitch the driver's arithmetic says it will, the wrapped and the silent ones included. */

import "../localize";
import { readInstrumentTables } from "@amk/spc/instruments";
import { SEMITONE, highestTrue, pitchFate } from "@amk/spc/pitch";
import { check, section } from "../harness";
import { compileToSpc, crossingRate, driver, emu } from "./support";

// ---------------------------------------------------------------------------
section("the DSP plays the pitch the driver's arithmetic says it will");
// ---------------------------------------------------------------------------
{
	const tables = readInstrumentTables(driver.programData, driver.manifest.programPos);

	/** A whole note held under `head`, measured past its attack. */
	const heard = (head: string, note: string, preamble = ""): number => {
		emu.loadSpc(compileToSpc(`#amk 2\n${preamble}#0 t60 v200 ${head} ${note}1\n`));
		emu.render(12000);
		return crossingRate(emu.render(16000), 0, 0.5);
	};

	/** What `pitch.ts` gives the DSP for a key from o1 c under instrument `n`, `transpose` semitones up. */
	const register = (n: number, key: number, transpose = 0): ReturnType<typeof pitchFate> => {
		const { tuning, subTuning } = tables.melodic[n];
		return pitchFate((key + transpose) * SEMITONE, tuning, subTuning);
	};

	// `@0` multiplies by 6, so o6 f and above pass the DSP's fourteen bits and wrap round low. Each
	// is measured against an in-range note on the same sample, since only the ratio is a pitch.
	const ref = heard("@0", "o5 a");
	const cases: [string, string, string, ReturnType<typeof pitchFate>][] = [
		["o6 e plays true", "@0", "o6 e", register(0, 64)],
		["o6 f wraps", "@0", "o6 f", register(0, 65)],
		["o6 a wraps", "@0", "o6 a", register(0, 69)],
		["note 83, o6 a under $FA $02 $0E, wraps", "@0 $FA $02 $0E", "o6 a", register(0, 69, 14)],
	];
	const reference = register(0, 57).register;
	for (const [name, head, note, predicted] of cases) {
		const ratio = heard(head, note) / ref;
		const want = predicted.register / reference;
		check(
			`${name}: heard at the register's ratio`,
			Math.abs(ratio / want - 1) < 0.02,
			`heard x${ratio.toFixed(3)}, predicted x${want.toFixed(3)} (${predicted.fate})`,
		);
	}

	check(
		"and their fates are the ones measured",
		cases.map(([, , , predicted]) => predicted.fate).join(",") === "true,wraps,wraps,wraps",
		cases.map(([, , , predicted]) => predicted.fate).join(","),
	);
	check("@0's highest true note is o6 e", highestTrue(6, 0, 0) === 64, `${highestTrue(6, 0, 0)}`);

	// `@8` multiplies by 30, which wraps from o4 c+.
	const ref8 = heard("@8", "o3 c");
	const wraps8 = heard("@8", "o4 c+") / ref8;
	const want8 = register(8, 37).register / register(8, 24).register;
	check(
		"@8 wraps from o4 c+",
		register(8, 36).fate === "true" && register(8, 37).fate === "wraps" && Math.abs(wraps8 / want8 - 1) < 0.02,
		`heard x${wraps8.toFixed(3)}, predicted x${want8.toFixed(3)}`,
	);

	// Every stock entry's sub-multiplier is 0, so a song's own instrument is what reaches the rest of
	// the product: at x3.5 o7 c+ plays true and o7 d wraps, where at x3 both would play true.
	const custom = "#instruments { @0 $FF $E0 $B8 $03 $80 }\n";
	const at = (transpose: number) => pitchFate((69 + transpose) * SEMITONE, 3, 0x80);
	const base = pitchFate(57 * SEMITONE, 3, 0x80).register;
	const refC = heard("@30", "o5 a", custom);
	const trueC = heard("@30 $FA $02 $04", "o6 a", custom) / refC;
	const wrapC = heard("@30 $FA $02 $05", "o6 a", custom) / refC;
	check(
		"a custom x3.5 plays o7 c+ true and wraps from o7 d",
		highestTrue(3, 0x80, 0) === 73 &&
			at(4).fate === "true" &&
			at(5).fate === "wraps" &&
			Math.abs(trueC / (at(4).register / base) - 1) < 0.02 &&
			Math.abs(wrapC / (at(5).register / base) - 1) < 0.02,
		`o7 c+ heard x${trueC.toFixed(3)} predicted x${(at(4).register / base).toFixed(3)}, ` +
			`o7 d heard x${wrapC.toFixed(3)} predicted x${(at(5).register / base).toFixed(3)}`,
	);

	// Past o7 b the octave counter goes round and shifts the pitch to nothing; below o1 c the note
	// number wraps to the same region.
	check(
		"note 84, o6 a under $FA $02 $0F, is silent",
		register(0, 69, 15).fate === "silent" && heard("@0 $FA $02 $0F", "o6 a") === 0,
	);
	check(
		"note -12, o1 c under $FA $02 $F4, is silent",
		register(0, 0, -12).fate === "silent" && heard("@0 $FA $02 $F4", "o1 c") === 0,
	);
}
