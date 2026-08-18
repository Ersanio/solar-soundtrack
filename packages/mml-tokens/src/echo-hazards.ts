import type { Command } from "./tokens";
import type { Diagnostic } from "@amk/core/types";
import { FIR_PRESETS, FIR_TAPS, type FirTaps, echoStability, toSigned } from "@amk/spc/fir";
import { hex2 } from "@amk/core/hex";

/**
 * Diagnostics for an echo that compounds instead of decaying.
 *
 * The FIR sits inside the feedback loop, so repeat *k* comes back at
 * `(EFB/128 · |H(f)|)^k` — and once that reaches 1 the echo builds on itself.
 */

/** Runaway echo through custom `$F5` coefficients. */
const CODE_FIR = "AMK0500";

/** Runaway echo through one of `$F1`'s two built-in tables. */
const CODE_BUILT_IN = "AMK0501";

/**
 * The coefficients `$F1`'s third argument loads, or `null` for anything else.
 * `main.asm:3507` — filter 0 is Super Mario World's low-pass, filter 1 is flat.
 */
export function builtInTaps(which: number): FirTaps | null {
	if (which !== 0 && which !== 1) {
		return null;
	}

	return FIR_PRESETS.find((preset) => preset.name === (which === 0 ? "Classic" : "Flat"))?.taps ?? null;
}

/**
 * The echo feedback in effect where `command` sits — the nearest preceding `$F1`'s second argument.
 *
 * `0` when there is none, which is also the answer that disables every runaway check below: no
 * feedback, no loop, nothing to compound. Same channel only, for the reason given on
 * {@link echoHazards}.
 */
export function feedbackBefore(command: Command, commands: readonly Command[]): number {
	let found = 0;
	for (const other of commands) {
		if (other.span.start >= command.span.start) {
			break;
		}

		if (other.channel !== command.channel) {
			continue;
		}

		if (other.vcmd === 0xf1 && other.args.length >= 2) {
			found = other.args[1].value;
		}
	}

	return found;
}

/** What the echo is running on at some point in a channel. */
interface EchoState {
	taps: FirTaps | null;
	feedback: number;
}

/** Every runaway echo in the document, one diagnostic per command that causes one. */
export function echoHazards(commands: readonly Command[]): Diagnostic[] {
	const diagnostics: Diagnostic[] = [];
	const states = new Map<number, EchoState>();

	for (const command of commands) {
		// Half-typed is not yet wrong: judging a `$F5` on the three bytes written so far would flash a
		// warning through the middle of writing a perfectly good one.
		if (!command.complete) {
			continue;
		}

		if (command.vcmd !== 0xf1 && command.vcmd !== 0xf5) {
			continue;
		}

		const key = command.channel;
		const state = states.get(key) ?? { taps: null, feedback: 0 };
		states.set(key, state);

		if (command.vcmd === 0xf1) {
			state.feedback = command.args[1].value;
			state.taps = builtInTaps(command.args[2].value);
		} else {
			state.taps = Array.from({ length: FIR_TAPS }, (_, i) => toSigned(command.args[i].value));
		}

		if (!state.taps || !echoStability(state.taps, state.feedback).runaway) {
			continue;
		}

		diagnostics.push({
			severity: "severe",
			code: command.vcmd === 0xf1 ? CODE_BUILT_IN : CODE_FIR,
			message: describe(command, state.feedback),
			span: { ...command.span },
		});
	}

	return diagnostics;
}

/** Cause, effect, and the way out, in one line. Says what the song will do and nothing more. */
function describe(command: Command, feedback: number): string {
	const effect = `make the echo grow instead of fade, so the song will get loud and distorted.`;

	if (command.vcmd === 0xf1) {
		const which = command.args[2].value;
		// Filter 1 is flat and peaks below unity, so it cannot be the one at fault; only filter 0 ever
		// reaches here, and swapping to the other one is a fix on its own.
		const fix = which === 0 ? " Lower the feedback, or select filter 1." : " Lower the feedback.";
		return `The echo feedback at $${hex2(feedback)} and filter ${which} ${effect}${fix}`;
	}

	return (
		`The echo feedback at $${hex2(feedback)} and this filter ${effect}` + ` Lower the feedback, or this filter's gain.`
	);
}
