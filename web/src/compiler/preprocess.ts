/**
 * Port of `preprocess()` (globals.cpp:735), which runs before the MML scanner.
 *
 * It does three things the parser then relies on:
 *   1. resolves `#define/#undef/#ifdef/#ifndef/#if/#endif` and strips them;
 *   2. detects the target marker — `#amk N`, `#amk=1`, `#am4`, `#amm` — and
 *      removes it, returning the version out-of-band;
 *   3. strips `;` comments to end of line, EXCEPT for `#amm` songs, where `;`
 *      is legal mid-line and the scanner handles it.
 *
 * That last asymmetry is why `parseComment` in the scanner errors for anything
 * but AMM: for other targets no comment should ever reach it.
 *
 * Quoted strings pass through untouched so a `;` or `#` inside a replacement
 * definition is preserved.
 */

import type { Diagnostic } from "../core/types";

/** Version marker found in the source. */
export const TARGET_AM4 = -1;
export const TARGET_AMM = -2;
export const TARGET_NONE = 0;

export interface PreprocessResult {
	text: string;
	/** `-1` = `#am4`, `-2` = `#amm`, `0` = none, otherwise the `#amk` version. */
	version: number;
	diagnostics: Diagnostic[];
}

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f";

export function preprocess(source: string): PreprocessResult {
	const diagnostics: Diagnostic[] = [];
	const defines = new Map<string, number>();
	const okayStatus: boolean[] = [];

	let out = "";
	let pos = 0;
	let line = 1;
	let level = 0;
	let okayToAdd = true;
	let version = TARGET_NONE;

	const fail = (message: string, code = "AMK0400"): void => {
		diagnostics.push({ severity: "error", code, message, span: { start: pos, end: pos + 1, line } });
	};

	/** Port of `getArgument` (globals.cpp:691). */
	const getArgument = (endChar: string, breakOnNewLines: boolean): string => {
		let value = "";
		for (;;) {
			if (pos >= source.length) {
				fail("Unexpected end of file found.");
				return value;
			}
			if (endChar === " ") {
				if (source[pos] === " " || source[pos] === "\t") break;
			} else if (source[pos] === endChar) {
				break;
			}
			if (breakOnNewLines && (source[pos] === "\r" || source[pos] === "\n")) break;
			value += source[pos];
			pos++;
		}
		return value;
	};

	/**
	 * The preprocessor has its own `skipSpaces` (globals.cpp:727) that stops at
	 * a line end, unlike the parser's. That difference is load-bearing: it is
	 * what lets `#define NAME` with no value work, because the argument scan
	 * then finds an empty string instead of running on into the next line.
	 */
	const skipSpaces = (): void => {
		while (pos < source.length && isSpace(source[pos])) {
			if (source[pos] === "\n" || source[pos] === "\r") break;
			pos++;
		}
	};

	const parseNumber = (text: string, what: string): number => {
		const value = Number.parseInt(text, 10);
		if (!Number.isFinite(value)) {
			fail(`Could not parse integer for ${what}.`);
			return 0;
		}
		return value;
	};

	while (pos < source.length) {
		if (source[pos] === "\n") line++;

		if (source[pos] === '"') {
			// Replacement definitions are copied verbatim, quotes included.
			pos++;
			const body = getArgument('"', false);
			if (okayToAdd) out += `"${body}"`;
			pos++;
			continue;
		}

		if (source[pos] !== "#") {
			// Newlines survive even inside a false branch so line numbers hold.
			if (okayToAdd || source[pos] === "\n") out += source[pos];
			pos++;
			continue;
		}

		pos++;

		// `#amk=1` predates the spaced form and is special-cased.
		if (source.startsWith("amk=1", pos)) {
			if (version >= 0) version = 1;
			pos += 5;
			continue;
		}

		const directive = getArgument(" ", true);

		switch (directive.toLowerCase()) {
			case "define": {
				if (!okayToAdd) { level++; break; }
				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) { fail("#define was missing its argument."); break; }
				skipSpaces();
				const value = getArgument(" ", true);
				defines.set(name, value.length === 0 ? 1 : parseNumber(value, "#define"));
				break;
			}
			case "undef": {
				if (!okayToAdd) { level++; break; }
				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) { fail("#undef was missing its argument."); break; }
				defines.delete(name);
				break;
			}
			case "ifdef": {
				if (!okayToAdd) { level++; break; }
				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) { fail("#ifdef was missing its argument."); break; }
				okayStatus.push(okayToAdd);
				okayToAdd = defines.has(name);
				level++;
				break;
			}
			case "ifndef": {
				if (!okayToAdd) { level++; break; }
				skipSpaces();
				const name = getArgument(" ", true);
				okayStatus.push(okayToAdd);
				if (name.length === 0) { fail("#ifndef was missing its argument."); break; }
				okayToAdd = !defines.has(name);
				level++;
				break;
			}
			case "if": {
				if (!okayToAdd) { level++; break; }
				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) { fail("#if was missing its first argument."); break; }
				if (!defines.has(name)) { fail("First argument for #if was never defined."); break; }
				skipSpaces();
				const operator = getArgument(" ", true);
				if (operator.length === 0) { fail("#if was missing its comparison operator."); break; }
				skipSpaces();
				const rhsText = getArgument(" ", true);
				if (rhsText.length === 0) { fail("#if was missing its second argument."); break; }

				okayStatus.push(okayToAdd);
				const lhs = defines.get(name) ?? 0;
				const rhs = parseNumber(rhsText, "#if");
				switch (operator) {
					case "==": okayToAdd = lhs === rhs; break;
					case ">": okayToAdd = lhs > rhs; break;
					case "<": okayToAdd = lhs < rhs; break;
					case "!=": okayToAdd = lhs !== rhs; break;
					case ">=": okayToAdd = lhs >= rhs; break;
					case "<=": okayToAdd = lhs <= rhs; break;
					default: fail("Unknown operator for #if.");
				}
				level++;
				break;
			}
			case "endif": {
				if (level > 0) {
					level--;
					okayToAdd = okayStatus.pop() ?? true;
				} else {
					fail("There was an #endif without a matching #ifdef, #ifndef, or #if.");
				}
				break;
			}
			case "amk": {
				if (version >= 0) {
					skipSpaces();
					const value = getArgument(" ", true);
					if (value.length === 0) {
						fail("#amk must have an integer argument specifying the version.", "AMK0401");
					} else {
						version = parseNumber(value, "#amk");
						if (version === 3) {
							fail("Codec's AddmusicK Beta (#amk 3) has not been implemented.", "AMK0402");
						}
					}
				}
				break;
			}
			case "amm":
				version = TARGET_AMM;
				break;
			case "am4":
				version = TARGET_AM4;
				break;
			default:
				// Not a preprocessor directive — hand it to the scanner intact.
				if (okayToAdd) out += `#${directive}`;
		}
	}

	if (level !== 0) {
		diagnostics.push({
			severity: "error",
			code: "AMK0403",
			message: "There was an #ifdef, #ifndef, or #if without a matching #endif.",
			span: { start: source.length, end: source.length, line },
		});
	}

	// AddmusicM songs keep their semicolons; everything else has them stripped
	// here, which is why the scanner treats a stray `;` as an error.
	if (version !== TARGET_AMM) {
		out = stripComments(out);
	}

	return { text: out, version, diagnostics };
}

function stripComments(text: string): string {
	let out = "";
	let inComment = false;
	for (const character of text) {
		if (character === "\n") {
			inComment = false;
			out += character;
			continue;
		}
		if (character === ";") inComment = true;
		if (!inComment) out += character;
	}
	return out;
}
