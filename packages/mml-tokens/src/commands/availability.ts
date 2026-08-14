/**
 * Whether the dialect a song declares will take a given command, and what it
 * says about it if not.
 *
 * A port of the conditions `parser.ts` tests, in the one place a palette can ask
 * them *before* the text exists — every rule here is a condition the compiler
 * already enforces on text that has been written, restated as a question about
 * text that has not. `palettetest` compiles every form at every dialect and
 * checks the two answers agree, which is what keeps this from drifting.
 *
 * Nothing here states how many arguments a command takes; that is `expectedArgs`
 * and `scanHex`, and a third statement would be invisible to every harness.
 */

import { hex2 } from "@amk/core/hex";
import type { CommandTarget } from "../tokens";

/** A thing the palette can offer: a hex command, a letter command, or a spelling. */
export type PaletteForm =
	{ kind: "hex"; vcmd: number } | { kind: "letter"; letter: string } | { kind: "syntax"; id: SyntaxForm };

/** The spellings whose availability is a version rule rather than a byte. */
export type SyntaxForm = "fade" | "exactLength" | "remoteLoop" | "remoteReset";

/**
 * `ok` — compiles clean. `caution` — compiles, with a warning worth reading
 * first. `blocked` — the dialect rejects it outright.
 */
export type AvailabilityState = "ok" | "caution" | "blocked";

export interface Availability {
	state: AvailabilityState;
	/** Why, for the tooltip. `null` when `ok`. */
	reason: string | null;
}

const OK: Availability = { state: "ok", reason: null };

const blocked = (reason: string): Availability => ({ state: "blocked", reason });
const caution = (reason: string): Availability => ({ state: "caution", reason });

/**
 * What the version rules read as in a sentence. `#am4` and `#amm` carry
 * `amkVersion` 0 (`parser.ts:applyTarget`), so a plain "needs #amk N" would be
 * true but unhelpful on a song that is not an AddmusicK song at all.
 */
function dialectName(target: CommandTarget): string {
	if (target.program === 1) {
		return "#am4";
	}

	if (target.program === 2) {
		return "#amm";
	}

	return `#amk ${target.amkVersion}`;
}

/**
 * The `#amk` numbers a marker may legally carry.
 *
 * 3 is missing because `preprocess.ts:parseDirective` rejects it outright
 * (AMK0402, Codec's beta): its features are reached through 4. So a rule of
 * "3 and above" has to *advise* 4 — naming a marker the compiler refuses is
 * advice that cannot be taken.
 */
const LEGAL_VERSIONS = [1, 2, 4];

/**
 * `blocked` below `least`, advising the lowest legal marker that satisfies it.
 *
 * `instead` says what the dialect makes of the text when it does not error on
 * it, which matters more than the rule: `parseTempo` below `#amk 3` simply does
 * not look for the comma, so `t18,144` is read as `t18` with the rest warned
 * over character by character (AMK0100) and the song still builds. A form that
 * quietly means something else is exactly the one worth refusing to write.
 */
function needsVersion(target: CommandTarget, least: number, what: string, instead?: string): Availability | null {
	if (target.program === 0 && target.amkVersion >= least) {
		return null;
	}

	const advise = LEGAL_VERSIONS.find((version) => version >= least) ?? least;
	const rule = `${what} needs #amk ${advise}; this song is ${dialectName(target)}.`;
	return blocked(instead ? `${rule} ${instead}` : rule);
}

export function formAvailability(form: PaletteForm, target: CommandTarget): Availability {
	if (form.kind === "syntax") {
		switch (form.id) {
			// `parseFadeableValue` (`parser.ts:1520`) and `parseTempo` (`:1664`) both
			// only look for the comma at `#amk 3` and above.
			case "fade":
				return (
					needsVersion(
						target,
						3,
						"The comma fade form",
						"Here the comma is not looked for at all, so only the first number would take effect.",
					) ?? OK
				);
			// `parseDefaultLength` (`parser.ts:1453`).
			case "exactLength":
				return needsVersion(target, 4, "An exact tick length (l=NN)") ?? OK;
			// `parseOpenParen` (`parser.ts:2097`) — AMK0117, "Unrecognized character '!'".
			case "remoteLoop":
				return needsVersion(target, 2, "Remote code") ?? OK;
			// `parseRemoteCall` (`parser.ts:2222`).
			case "remoteReset":
				return needsVersion(target, 3, "The remote code reset form (!!n)") ?? OK;
		}
	}

	if (form.kind === "letter") {
		// Every letter in `LETTER_NAMES` parses in every dialect; only their comma
		// and `=` forms are gated, and those are `syntax` forms of their own.
		return OK;
	}

	// `parser.ts:2933` — AMK0156, raised on `$FA`'s *second* byte. A hard error,
	// not the AMK0207 warning the neighbouring bytes get, so it goes first.
	if (form.vcmd === 0xfa && target.program === 2) {
		return blocked("AddmusicM's $FA is not implemented in AddmusicK (AMK0156).");
	}

	// `parseHexCommand` (`parser.ts:2836`, `:2844`) warns once per song for a byte
	// the legacy program never had. It is a warning either way, not an error.
	if (target.program === 1 && form.vcmd > 0xf2) {
		return caution(`$${hex2(form.vcmd)} is not native to Addmusic 4.05; AddmusicK warns (AMK0207).`);
	}

	if (target.program === 2 && form.vcmd > 0xfa) {
		return caution(`$${hex2(form.vcmd)} is not native to AddmusicM; AddmusicK warns (AMK0207).`);
	}

	// Written by the compiler from a `[ ]` loop, and `hex-params.ts:$E9` already
	// passes on the readme's own "do not use manually".
	if (form.vcmd === 0xe9) {
		return caution("Written by the compiler from a [ ] loop. The readme says outright: do not use manually.");
	}

	if (form.vcmd === 0xfc && target.amkVersion > 1) {
		// `parser.ts:2923` — AMK0211, for the two versions between the spellings.
		// Not raised at `#amk 1`, where writing `$FC` by hand *is* remote gain and
		// there is no `(!n)` to prefer over it (`parser.ts:2910`).
		return target.amkVersion < 4
			? caution("$FC errors on AddmusicK 1.0.8 and lower, which replaced it with remote code in #amk 2 (AMK0211).")
			: caution("Written by the compiler from a (!n) remote call. Prefer (!n) unless you mean the raw bytes.");
	}

	return OK;
}
