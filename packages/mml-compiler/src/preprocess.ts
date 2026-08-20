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

import type { Diagnostic } from "@amk/core/types";

/** Version marker found in the source. */
export const TARGET_AM4 = -1;
export const TARGET_AMM = -2;
export const TARGET_NONE = 0;

/**
 * A run of the source this pass did not pass on, and why.
 *
 * `directive` is a `#define`-family line, `marker` the target marker, and
 * `untaken` the text inside a false branch. The newlines inside a false branch
 * are not removed, so line numbers hold, and are not listed here.
 */
export interface RemovedRange {
	start: number;
	end: number;
	reason: "directive" | "marker" | "untaken";
}

export interface PreprocessResult {
	text: string;
	/**
	 * Where each character of `text` came from in the original source.
	 *
	 * `origins[i]` is the offset in `source` that produced `text[i]`, so a
	 * position in the preprocessed text can be turned back into a position the
	 * editor can select. Without it every span the parser produces is short by
	 * however much this pass deleted — which for a song opening `#amk 4` is
	 * every span in the file.
	 *
	 * Always the same length as `text`.
	 */
	origins: number[];
	/** `-1` = `#am4`, `-2` = `#amm`, `0` = none, otherwise the `#amk` version. */
	version: number;
	/**
	 * What was taken out, by source offset, in order. The complement of
	 * `origins` for everything but comments, which `stripComments` removes
	 * after the fact, and the newlines of a false branch, which stay.
	 */
	removed: RemovedRange[];
	diagnostics: Diagnostic[];
}

const PREPROCESSOR_DIRECTIVES = new Set(["define", "undef", "ifdef", "ifndef", "if", "endif"]);

const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f";

export function preprocess(source: string): PreprocessResult {
	const diagnostics: Diagnostic[] = [];
	const defines = new Map<string, number>();
	const okayStatus: boolean[] = [];

	let out = "";
	const origins: number[] = [];
	const removed: RemovedRange[] = [];
	let pos = 0;
	let line = 1;
	let level = 0;
	let okayToAdd = true;
	let version = TARGET_NONE;

	/** Records a run that was not passed on, joining it to the previous run when they touch. */
	const drop = (start: number, end: number, reason: RemovedRange["reason"]): void => {
		if (end <= start) {
			return;
		}

		const last = removed[removed.length - 1];
		if (last && last.end === start && last.reason === reason) {
			last.end = end;
			return;
		}

		removed.push({ start, end, reason });
	};

	/**
	 * Appends to the output, recording where it came from.
	 *
	 * Every chunk emitted here is a consecutive run of `source` starting at
	 * `at`, so the origins follow by counting. The clamp only matters for the
	 * closing quote of an unterminated string, which is synthesised rather than
	 * copied and would otherwise point past the end.
	 */
	const emit = (chunk: string, at: number): void => {
		out += chunk;
		for (let i = 0; i < chunk.length; i++) {
			origins.push(Math.min(at + i, source.length));
		}
	};

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
				if (source[pos] === " " || source[pos] === "\t") {
					break;
				}
			} else if (source[pos] === endChar) {
				break;
			}

			if (breakOnNewLines && (source[pos] === "\r" || source[pos] === "\n")) {
				break;
			}

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
			if (source[pos] === "\n" || source[pos] === "\r") {
				break;
			}

			pos++;
		}
	};

	/**
	 * `strToInt`, globals.cpp:716-726.
	 *
	 * It reads through a `stringstream` into an `int` and throws when the stream
	 * fails, which it does on a value too large to fit — so the 32-bit range is
	 * part of the check, not an implementation detail. `Number.parseInt` would
	 * carry a `#define FOO 99999999999` straight through into an `#if`.
	 */
	const parseNumber = (text: string, what: string): number => {
		const value = Number.parseInt(text, 10);
		if (!Number.isFinite(value) || value < -0x80000000 || value > 0x7fffffff) {
			fail(`Could not parse integer for ${what}.`);
			return 0;
		}

		return value;
	};

	while (pos < source.length) {
		if (source[pos] === "\n") {
			line++;
		}

		if (source[pos] === '"') {
			// Replacement definitions are copied verbatim, quotes included.
			const quoteAt = pos;
			pos++;
			const body = getArgument('"', false);
			if (okayToAdd) {
				emit(`"${body}"`, quoteAt);
			}

			pos++;
			if (!okayToAdd) {
				drop(quoteAt, Math.min(pos, source.length), "untaken");
			}

			continue;
		}

		if (source[pos] !== "#") {
			// Newlines survive even inside a false branch so line numbers hold.
			if (okayToAdd || source[pos] === "\n") {
				emit(source[pos], pos);
			} else {
				drop(pos, pos + 1, "untaken");
			}

			pos++;
			continue;
		}

		const hashAt = pos;
		const wasOkayToAdd = okayToAdd;
		pos++;

		// `#amk=1` predates the spaced form and is special-cased.
		if (source.startsWith("amk=1", pos)) {
			if (version >= 0) {
				version = 1;
			}

			pos += 5;
			drop(hashAt, pos, wasOkayToAdd ? "marker" : "untaken");
			continue;
		}

		const directive = getArgument(" ", true);

		// globals.cpp:788-956 compares this against lowercase literals with `==`,
		// so `#AMK` and `#Define` are not directives at all there — they fall
		// through to the parser, which has its own opinion. Matching them
		// case-insensitively would compile a song AddmusicK refuses.
		switch (directive) {
			case "define": {
				if (!okayToAdd) {
					level++;
					break;
				}

				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) {
					fail("#define was missing its argument.");
					break;
				}

				skipSpaces();
				const value = getArgument(" ", true);
				defines.set(name, value.length === 0 ? 1 : parseNumber(value, "#define"));
				break;
			}

			case "undef": {
				if (!okayToAdd) {
					level++;
					break;
				}

				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) {
					fail("#undef was missing its argument.");
					break;
				}

				defines.delete(name);
				break;
			}

			case "ifdef": {
				if (!okayToAdd) {
					level++;
					break;
				}

				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) {
					fail("#ifdef was missing its argument.");
					break;
				}

				okayStatus.push(okayToAdd);
				okayToAdd = defines.has(name);
				level++;
				break;
			}

			case "ifndef": {
				if (!okayToAdd) {
					level++;
					break;
				}

				skipSpaces();
				const name = getArgument(" ", true);
				okayStatus.push(okayToAdd);
				if (name.length === 0) {
					fail("#ifndef was missing its argument.");
					break;
				}

				okayToAdd = !defines.has(name);
				level++;
				break;
			}

			case "if": {
				if (!okayToAdd) {
					level++;
					break;
				}

				skipSpaces();
				const name = getArgument(" ", true);
				if (name.length === 0) {
					fail("#if was missing its first argument.");
					break;
				}

				if (!defines.has(name)) {
					fail("First argument for #if was never defined.");
					break;
				}

				skipSpaces();
				const operator = getArgument(" ", true);
				if (operator.length === 0) {
					fail("#if was missing its comparison operator.");
					break;
				}

				skipSpaces();
				const rhsText = getArgument(" ", true);
				if (rhsText.length === 0) {
					fail("#if was missing its second argument.");
					break;
				}

				okayStatus.push(okayToAdd);
				const lhs = defines.get(name) ?? 0;
				const rhs = parseNumber(rhsText, "#if");
				switch (operator) {
					case "==":
						okayToAdd = lhs === rhs;
						break;
					case ">":
						okayToAdd = lhs > rhs;
						break;
					case "<":
						okayToAdd = lhs < rhs;
						break;
					case "!=":
						okayToAdd = lhs !== rhs;
						break;
					case ">=":
						okayToAdd = lhs >= rhs;
						break;
					case "<=":
						okayToAdd = lhs <= rhs;
						break;
					default:
						fail("Unknown operator for #if.");
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
				if (okayToAdd) {
					emit(`#${directive}`, hashAt);
				}
		}

		// Whatever the branch consumed, from the `#` to where it stopped, is gone
		// from the output — bar the unknown directive just handed on.
		if (!wasOkayToAdd) {
			drop(hashAt, pos, "untaken");
		} else if (PREPROCESSOR_DIRECTIVES.has(directive)) {
			drop(hashAt, pos, "directive");
		} else if (directive === "amk" || directive === "amm" || directive === "am4") {
			drop(hashAt, pos, "marker");
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
		return { ...stripComments(out, origins), version, removed, diagnostics };
	}

	return { text: out, origins, version, removed, diagnostics };
}

function stripComments(text: string, origins: number[]): { text: string; origins: number[] } {
	let out = "";
	const kept: number[] = [];
	let inComment = false;
	for (let i = 0; i < text.length; i++) {
		const character = text[i];
		if (character === "\n") {
			inComment = false;
			out += character;
			kept.push(origins[i]);
			continue;
		}

		if (character === ";") {
			inComment = true;
		}

		if (!inComment) {
			out += character;
			kept.push(origins[i]);
		}
	}

	return { text: out, origins: kept };
}
