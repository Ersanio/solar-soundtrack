/** The `$F1`/`$F5` override, looked at from either end. */

import { VCMD } from "@amk/core/hardcoded-tables";
import type { Command } from "./tokens";
export function firOverriddenBy(fir: Command, commands: Command[]): Command | null {
	return (
		commands.find(
			(other) => other.vcmd === VCMD.EchoDelay && other.channel === fir.channel && other.span.start > fir.span.start,
		) ?? null
	);
}

/** The `$F5` this `$F1` discards, if there is one before it in the channel. */
export function firOverriddenBefore(echo: Command, commands: Command[]): Command | null {
	let found: Command | null = null;
	for (const other of commands) {
		if (other.span.start >= echo.span.start) {
			break;
		}

		if (other.vcmd === VCMD.Fir && other.channel === echo.channel) {
			found = other;
		}
	}

	return found;
}

/** `0` or `1` — which built-in table, for naming it in the warning. */
export function builtInFilterName(which: number): string {
	if (which === 0) {
		return "filter 0, the SMW low-pass";
	}

	if (which === 1) {
		return "filter 1, flat";
	}

	return `filter ${which}, which is out of range`;
}
