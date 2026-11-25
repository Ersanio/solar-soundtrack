/** Rewriting a song to compile smaller and play exactly as it did: planned, written, compiled, and proven against the original's walk, a move that fails barred and the rest tried again. */

import type { CompileResult, Diagnostic } from "@amk/core/types";
import { compareSongs } from "./equivalence";
import { type Node, type Plan, alike, plan } from "./plan";
import { type SongItems, readSong } from "./read";
import { unrollLoops } from "./unroll";
import { type Written, signatureOf, writePlan } from "./write";

export type OptimizeMode = "import" | "finalize";

/** A song's own loops: kept as written, or played out and looped again. */
export type ExistingLoops = "keep" | "redo";

export interface OptimizeOptions {
	/** `import` keeps silences drawable; `finalize` loops long rests too. */
	mode: OptimizeMode;
	existingLoops?: ExistingLoops;
	/** Where the song loads, which its pointers are relative to. */
	aramAddress: number;
	/** The caller's compile, with the sample names and groups the song is compiled against, to load at `aram`. */
	compile: (text: string, aram: number) => CompileResult;
	/** Told why each move that failed was barred. */
	trace?: (why: string) => void;
}

/** What the optimizer did. */
export interface OptimizeMoves {
	labels: number;
	calls: number;
	transposed: number;
	superloops: number;
	restLoops: number;
}

export interface OptimizeResult {
	text: string;
	/** Song bytes before and after. */
	before: number;
	after: number;
	moves: OptimizeMoves;
	/** Moves taken out because they would not have played alike, or would have warned. */
	barred: number;
}

const ATTEMPTS = 12;

const NO_MOVES: OptimizeMoves = { labels: 0, calls: 0, transposed: 0, superloops: 0, restLoops: 0 };

function unchanged(text: string, result: CompileResult | null, barred = 0): OptimizeResult {
	const size = result?.data?.length ?? 0;
	return { text, before: size, after: size, moves: NO_MOVES, barred };
}

function countMoves(p: Plan): OptimizeMoves {
	const moves = { ...NO_MOVES, labels: p.labels.length };
	const visit = (nodes: readonly Node[]) => {
		for (const n of nodes) {
			if (n.kind === "use") {
				moves.calls++;
				if (n.shift !== 0) {
					moves.transposed++;
				}
			} else if (n.kind === "super") {
				moves.superloops++;
				visit(n.body);
			} else if (n.kind === "rest") {
				moves.restLoops++;
			}
		}
	};

	p.channels.forEach(visit);
	p.labels.forEach((l) => visit(l.body));
	moves.calls -= p.labels.length;
	return moves;
}

/**
 * The move after which a note would compile through another instrument than it did: a body
 * compiles on channel 8, and a superloop once, so an `@` in either stops reaching the text after.
 */
function instrumentBlame(song: SongItems, p: Plan): string | null {
	const defined = new Set<unknown>();
	for (let c = 0; c < p.channels.length; c++) {
		const items = song.channels[c].items;
		let last = "";

		/** Compiles `nodes` from `start`: the instrument held after them, or the move to blame. */
		const compile = (
			nodes: readonly Node[],
			within: string | null,
			start: string,
		): { held: string } | { blame: string } => {
			let held = start;
			for (const n of nodes) {
				if (n.kind === "item") {
					const it = n.item;
					const same = alike(song, held, it.instrumentBefore);
					if (it.tuned && !same) {
						return { blame: within ?? last };
					}
					if (it.setsInstrument || same) {
						held = it.instrumentAfter;
					}
				} else if (n.kind === "use") {
					if (!defined.has(n.label)) {
						defined.add(n.label);
						const inner = compile(n.label.body, n.label.signature, held);
						if ("blame" in inner) {
							return inner;
						}
					}
					last = n.label.signature;
				} else if (n.kind === "super") {
					const inner = compile(n.body, within ?? n.signature, held);
					if ("blame" in inner) {
						return inner;
					}
					held = inner.held;
					last = n.signature;
				}
			}
			return { held };
		};

		const outcome = compile(p.channels[c], null, items.length > 0 ? items[0].instrumentBefore : "init");
		if ("blame" in outcome) {
			return outcome.blame;
		}
	}

	return null;
}

/** The move written at or before `offset` in `written`, within the channel `offset` is in. */
function markAt(written: Written, offset: number): string | null {
	let channelStart = 0;
	for (const start of written.channelStarts) {
		if (start <= offset) {
			channelStart = start;
		}
	}

	let best: { start: number; signature: string } | null = null;
	for (const mark of written.marks) {
		if (mark.start <= offset && mark.end > offset) {
			// The innermost one that holds it.
			if (!best || mark.start >= best.start) {
				best = mark;
			}
		}
	}

	if (best) {
		return best.signature;
	}

	for (const mark of written.marks) {
		if (mark.start >= channelStart && mark.end <= offset && (!best || mark.start > best.start)) {
			best = mark;
		}
	}

	return best?.signature ?? null;
}

function offsetOfAddress(result: CompileResult, address: number): number | null {
	const entry =
		result.noteMap?.find((n) => n.address === address) ?? result.commandMap?.find((c) => c.address === address);
	return entry?.span.start ?? null;
}

/** The first note written that does not name the byte it did, by where it starts. */
function misreadNote(written: Written, result: CompileResult): number | null {
	const named = new Map<number, number>();
	for (const n of result.noteMap ?? []) {
		named.set(n.span.start, n.written);
	}

	for (const n of written.notes) {
		const got = named.get(n.offset);
		if (got !== undefined && got !== n.written) {
			return n.offset;
		}
	}

	return null;
}

function counts(diagnostics: readonly Diagnostic[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const d of diagnostics) {
		map.set(d.code, (map.get(d.code) ?? 0) + 1);
	}
	return map;
}

/** A diagnostic the rewrite raises that the original did not, or raises more often. */
function newDiagnostic(before: CompileResult, after: CompileResult): Diagnostic | null {
	const had = counts(before.diagnostics);
	const seen = new Map<string, number>();
	for (const d of after.diagnostics) {
		const n = (seen.get(d.code) ?? 0) + 1;
		seen.set(d.code, n);
		if (n > (had.get(d.code) ?? 0)) {
			return d;
		}
	}
	return null;
}

/** Where a song too long to load where it goes is compiled instead, so that it can still be read and shortened. */
const LOW_ARAM = 0x0100;

/** The song as it stands, at its own address or, when it is too long to fit there and that is all that is wrong, at {@link LOW_ARAM}. */
function compileOriginal(text: string, options: OptimizeOptions): CompileResult & { aram: number } {
	const result = options.compile(text, options.aramAddress);
	const errors = result.diagnostics.filter((d) => d.severity === "error");
	if (!result.ok && errors.length > 0 && errors.every((d) => d.code === "AMK0300")) {
		return { ...options.compile(text, LOW_ARAM), aram: LOW_ARAM };
	}

	return { ...result, aram: options.aramAddress };
}

/** `text` rewritten to compile smaller and play the same, or `text` itself when it cannot be. */
export function optimizeSong(text: string, options: OptimizeOptions): OptimizeResult {
	const original = compileOriginal(text, options);
	if (!original.ok || !original.data) {
		return unchanged(text, original);
	}

	// Redone loops start from the song played out pass by pass, taken only where it plays alike.
	let source = text;
	let read = original;
	if (options.existingLoops === "redo") {
		const flat = unrollLoops(text);
		if (flat !== null && flat !== text) {
			const compiled = compileOriginal(flat, options);
			const divergence = compiled.data
				? compareSongs(original.data, original.aram, compiled.data, compiled.aram)
				: { what: "compile", detail: compiled.diagnostics.find((d) => d.severity === "error")?.message };
			if (divergence === null) {
				source = flat;
				read = compiled;
			} else {
				options.trace?.(`unrolled loops do not play alike (${divergence.what}): kept\n${divergence.detail ?? ""}`);
			}
		}
	}

	const song = readSong(source, read, read.aram);
	if (!song) {
		return unchanged(text, original);
	}

	const barred = new Set<string>();
	for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
		const p = plan(song, {
			restLoops: options.mode === "finalize",
			transpose: true,
			barred,
			firstLabel: 1,
		});

		if (p.labels.length === 0 && !p.channels.some((nodes) => nodes.some((n) => signatureOf(n) !== null))) {
			return unchanged(text, original, barred.size);
		}

		const instrument = instrumentBlame(song, p);
		if (instrument !== null) {
			if (instrument === "" || barred.has(instrument)) {
				return unchanged(text, original, barred.size);
			}
			options.trace?.(`instrument: ${instrument}`);
			barred.add(instrument);
			continue;
		}

		const written = writePlan(song, p);
		const result = options.compile(written.text, options.aramAddress);
		let blame: string | null;
		const misread = misreadNote(written, result);
		if (misread !== null) {
			blame = markAt(written, misread);
			options.trace?.(`octave at ${JSON.stringify(written.text.slice(Math.max(0, misread - 120), misread + 20))}`);
		} else if (!result.ok || !result.data) {
			const error = result.diagnostics.find((d) => d.severity === "error");
			if (error?.code === "AMK0300") {
				// Still too long to load where it goes, which no single move is to blame for.
				return unchanged(text, original, barred.size);
			}

			blame = error ? markAt(written, error.span.start) : null;
			options.trace?.(
				`error ${error?.code} ${error?.message} at ${JSON.stringify(written.text.slice(error?.span.start ?? 0, (error?.span.start ?? 0) + 60))}`,
			);
		} else {
			const extra = newDiagnostic(original, result);
			if (extra) {
				blame = markAt(written, extra.span.start);
				options.trace?.(
					`diagnostic ${extra.code} ${extra.message} at ${JSON.stringify(written.text.slice(Math.max(0, extra.span.start - 80), extra.span.start + 30))}`,
				);
			} else {
				const divergence = compareSongs(original.data, original.aram, result.data, options.aramAddress);
				if (divergence === null) {
					if (result.data.length >= original.data.length) {
						return unchanged(text, original, barred.size);
					}

					return {
						text: written.text,
						before: original.data.length,
						after: result.data.length,
						moves: countMoves(p),
						barred: barred.size,
					};
				}

				const offset = divergence.address === null ? null : offsetOfAddress(result, divergence.address);
				blame = offset === null ? null : markAt(written, offset);
				options.trace?.(`walk ${divergence.what} channel ${divergence.channel} at ${offset === null ? "?" : JSON.stringify(written.text.slice(Math.max(0, offset - 80), offset + 40))}
${divergence.detail ?? ""}`);
			}
		}

		options.trace?.(`blame ${blame?.slice(0, 120)}`);
		if (blame === null || barred.has(blame)) {
			return unchanged(text, original, barred.size);
		}
		barred.add(blame);
	}

	return unchanged(text, original, barred.size);
}
