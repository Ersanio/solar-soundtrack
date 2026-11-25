/** A compiled song read into per-channel items: each note, rest, tie and command with the bytes it compiled to, and everything else kept as fixed text. */

import type { CompileResult } from "@amk/core/types";
import { vcmdLength } from "@amk/spc/song-walk";
import { type Command, type NoteLengthSegment, type Token, type TieRun, tokenize } from "@amk/tokens";

/**
 * - `note`, `rest`, `tie`, `command`, `state` (a `q`, which emits nothing), `drum` (`@21`-`@29`): music the passes may loop.
 * - `call`: an existing `(n)m` or `*`, which a superloop may hold.
 * - `fixed`: text kept as written, never inside a new loop.
 * - `barrier`: `/`.
 */
export type ItemKind = "note" | "rest" | "tie" | "command" | "state" | "drum" | "call" | "fixed" | "barrier";

export interface Item {
	kind: ItemKind;
	/** What to write, octave aside: a note's letter and lengths, a command as written. */
	text: string;
	/** Equal keys compile to equal bytes, in place or as a loop body. */
	key: string;
	/** The key with a pitched note's pitch replaced by its distance from the previous pitched note. */
	relKey: string;
	/** Bytes compiled in place, length and q bytes included. */
	bytes: number;
	ticks: number;
	/** Cannot be parted from the item before it: a tie, a rest the compiler merges, a `$DD`, a drum's note. */
	glued: boolean;
	/** A pitched note's octave and written byte, which a transposed call moves. */
	octave?: number;
	written?: number;
	/** A note the driver plays at a pitch, not a drum. */
	pitched?: boolean;
	/** The note byte, after the instrument's tuning. */
	emitted?: number;
	/** Compiles through the instrument in force: a pitched or drum note, or a `$DD` naming a note. */
	tuned: boolean;
	/** Holds what a transposed call cannot move: a drum, a `$DD`, `$FA $02`, `$E4`. */
	untransposable: boolean;
	/** The instrument the compiler holds before and after this item. */
	instrumentBefore: string;
	instrumentAfter: string;
	/** An `@` or a drum, which sets the instrument the notes after it compile through. */
	setsInstrument: boolean;
	/** For a `fixed` item that reads the octave or default length: what they were before it. */
	restore?: { octave: number | null; length: string | null };
	/** For a `fixed` item: the octave and default length the compiler holds after it. */
	leaves?: { octave: number | null; length: string | null };
	/** A `$DD` written with a note: the octave its note is read in. */
	targetOctave?: number | null;
}

export interface ChannelItems {
	/** The `#N` line, written as it was. */
	header: string;
	channel: number;
	items: Item[];
}

export interface SongItems {
	/** Everything above the first channel. */
	head: string;
	channels: ChannelItems[];
	/** Label numbers the song already uses, and remote slots, which collide with label `n - 1`. */
	labels: Set<number>;
	/** Each instrument's tuning shift learned from its notes, `NaN` where they disagree. */
	shifts: Map<string, number>;
	/** A channel writes `$FA $02` itself, so a transposed call there would fight it. */
	tunedChannels: Set<number>;
}

const OCTAVE_TOKENS = new Set(["octave", "octaveShift"]);
const LETTER_COMMANDS = new Set(["volume", "globalVolume", "pan", "tempo", "vibrato", "noise"]);
const READS = new Set(["note", "rest", "tie", "replacement", "octave", "octaveShift", "defaultLength"]);
const STICKY_OPERATORS = new Set(["&", "{", "}"]);
const DRUMS = { first: 21, last: 29 };

/** Lengths spelled as `l`-free text: `8`, `8.` or `=N`. */
export function spellTicks(ticks: number): string {
	if (ticks > 0 && 192 % ticks === 0) {
		return String(192 / ticks);
	}

	if ((ticks * 2) % 3 === 0) {
		const base = (ticks * 2) / 3;
		if (192 % base === 0 && base % 2 === 0) {
			return `${192 / base}.`;
		}
	}

	return `=${ticks}`;
}

function segmentText(segment: NoteLengthSegment): string {
	if (segment.implicit) {
		return spellTicks(segment.ticks);
	}

	return (segment.exact ? "=" : "") + segment.written + ".".repeat(segment.dots);
}

function lengthText(segments: readonly NoteLengthSegment[]): string {
	return segments.map((s, i) => (i === 0 ? "" : "^") + segmentText(s)).join("");
}

const PITCH_TABLE = [9, 11, 0, 2, 4, 5, 7];

/** The octave a letter must be written in to name `written`, or null when no octave does. */
function octaveFor(letter: string, written: number): number | null {
	const base = PITCH_TABLE[letter.toLowerCase().charCodeAt(0) - 0x61];
	const accidental = letter.endsWith("+") ? 1 : letter.endsWith("-") ? -1 : 0;
	const octave = (written - 0x80 - base - accidental) / 12 + 1;
	return Number.isInteger(octave) && octave >= 1 && octave <= 6 ? octave : null;
}

function pushTo(map: Map<number, number[]>, key: number, value: number): void {
	const list = map.get(key);
	if (list) {
		list.push(value);
	} else {
		map.set(key, [value]);
	}
}

interface Emitted {
	address: number;
	bytes: number;
	note?: number;
	written?: number;
}

/**
 * Reads `text`, which `result` is the compile of, into items, or null when it is a song this cannot
 * rewrite faithfully: not AddmusicK's own dialect, a tempo ratio, or no song data.
 */
export function readSong(text: string, result: CompileResult, aramAddress: number): SongItems | null {
	const stats = result.stats;
	if (!result.ok || !result.data || !result.noteMap || !result.commandMap || !stats) {
		return null;
	}

	if (stats.tempoRatio !== 1 || stats.songTargetProgram !== 0) {
		return null;
	}

	const data = result.data;
	const index = tokenize(text);
	const tokens = index.tokens;
	const channelTokens = tokens.filter((t) => t.kind === "channel");
	if (channelTokens.length === 0) {
		return null;
	}

	// What each source position compiled to, on the channel it was written under.
	const emitted = new Map<string, Emitted>();
	const streams = new Map<number, number[]>();
	for (const n of result.noteMap) {
		if (n.channel < 8) {
			emitted.set(`${n.channel}:${n.span.start}`, {
				address: n.address,
				bytes: 0,
				note: n.note,
				written: n.written,
			});
			pushTo(streams, n.channel, n.address);
		}
	}

	for (const c of result.commandMap) {
		if (c.channel < 8) {
			emitted.set(`${c.channel}:${c.span.start}`, {
				address: c.address,
				bytes: vcmdLength(data, c.address - aramAddress),
			});
			pushTo(streams, c.channel, c.address);
		}
	}

	const nextAddress = new Map<string, number>();
	for (const [channel, addresses] of streams) {
		addresses.sort((a, b) => a - b);
		for (let i = 0; i + 1 < addresses.length; i++) {
			nextAddress.set(`${channel}:${addresses[i]}`, addresses[i + 1]);
		}
	}

	const commandsAt = new Map<number, Command>();
	for (const c of index.commands) {
		if (!commandsAt.has(c.span.start)) {
			commandsAt.set(c.span.start, c);
		}
	}

	const tiesAt = new Map<number, TieRun>(index.ties.map((t) => [t.span.start, t]));

	const labels = new Set<number>();
	const shifts = new Map<string, number>();
	const tunedChannels = new Set<number>();
	// A hot patch changes how the read-ahead treats loops and rests (COMMANDS.html section 6).
	let hotPatched = /#option\s+amk109hotpatch/i.test(text);
	const channels: ChannelItems[] = [];

	// The compiler's text-order state, which carries from one channel into the next.
	let octave: number | null = 4;
	let length: string | null = null;
	const instrument = new Map<number, string>();
	const quantize = new Map<number, string>();
	let unknowns = 0;

	const trackOctave = (t: Token) => {
		if (t.kind === "octave") {
			const command = commandsAt.get(t.start);
			octave = command && !command.replacement ? (command.args[0]?.value ?? null) : null;
		} else if (t.kind === "octaveShift") {
			if (octave !== null) {
				octave += text[t.start] === ">" ? 1 : -1;
			}
		} else if (t.kind === "defaultLength") {
			const command = commandsAt.get(t.start);
			length = command && !command.replacement ? text.slice(command.span.start, command.span.end) : null;
		} else if (t.kind === "replacement") {
			octave = null;
			length = null;
		}
	};

	for (const t of tokens) {
		if (t.start >= channelTokens[0].start) {
			break;
		}
		trackOctave(t);
	}

	const learnShift = (inst: string, shift: number) => {
		const known = shifts.get(inst);
		if (known === undefined) {
			shifts.set(inst, shift);
		} else if (known !== shift) {
			shifts.set(inst, Number.NaN);
		}
	};

	for (let c = 0; c < channelTokens.length; c++) {
		const opener = channelTokens[c];
		const channel = Number(text.slice(opener.start + 1, opener.end));
		const end = c + 1 < channelTokens.length ? channelTokens[c + 1].start : text.length;
		let at = tokens.indexOf(opener) + 1;
		let headerEnd = opener.end;
		// A comment on the `#N` line stays with it.
		while (at < tokens.length && tokens[at].kind === "comment" && tokens[at].line === opener.line) {
			headerEnd = tokens[at].end;
			at++;
		}

		const items: Item[] = [];
		let sticky = false;
		let afterDrum = false;
		let lastPitch: number | null = null;
		let prevKind: ItemKind | null = null;

		const ci = () => instrument.get(channel) ?? "init";
		const q = () => quantize.get(channel) ?? "init";

		const startInstrument = ci();
		const before = () => (items.length > 0 ? items[items.length - 1].instrumentAfter : startInstrument);

		const push = (
			item: Omit<Item, "glued" | "instrumentBefore" | "instrumentAfter" | "setsInstrument"> & {
				glued?: boolean;
				setsInstrument?: boolean;
				instrumentBefore?: string;
			},
		) => {
			const glued = (item.glued ?? false) || sticky;
			sticky = false;
			items.push({
				...item,
				glued,
				setsInstrument: item.setsInstrument ?? false,
				instrumentBefore: item.instrumentBefore ?? before(),
				instrumentAfter: ci(),
			});
			prevKind = item.kind;
		};

		const fixed = (start: number, stop: number, opts: { sticky?: boolean; reads?: boolean; call?: boolean }) => {
			const raw = text.slice(start, stop);
			const item: Item = {
				kind: opts.call ? "call" : "fixed",
				text: raw,
				key: opts.call ? `call|${raw.replace(/\s+/g, "")}` : `fixed|${start}`,
				relKey: "",
				bytes: opts.call ? 4 : 0,
				ticks: 0,
				glued: opts.sticky === true || sticky,
				tuned: false,
				untransposable: true,
				instrumentBefore: before(),
				instrumentAfter: "",
				setsInstrument: false,
			};
			item.relKey = item.key;
			if (opts.reads) {
				item.restore = { octave, length };
			}

			sticky = opts.sticky === true;
			item.leaves = { octave, length };
			items.push(item);
			prevKind = item.kind;
			item.instrumentAfter = ci();
			if (opts.reads) {
				item.tuned = true;
			}
		};

		/** Whether the tokens in `[from, to)` hold anything that reads or moves the octave or default length. */
		const reads = (from: number, to: number) => {
			for (let i = from; i < to; i++) {
				if (READS.has(tokens[i].kind)) {
					return true;
				}
			}
			return false;
		};

		/** The state a fixed run of tokens leaves behind, read as the compiler would. */
		const passOver = (from: number, to: number) => {
			for (let i = from; i < to; i++) {
				const t = tokens[i];
				if (t.kind === "replacement") {
					octave = null;
					length = null;
					instrument.set(channel, `?${unknowns++}`);
					quantize.set(channel, `?${unknowns++}`);
				} else if (t.kind === "instrument") {
					instrument.set(channel, `?${unknowns++}`);
				} else if (t.kind === "quantize") {
					quantize.set(channel, `?${unknowns++}`);
				} else if (t.kind === "transpose" || t.kind === "note") {
					// `h`, and a drum or tuning the body leaves the channel holding.
					instrument.set(channel, `?${unknowns++}`);
				} else {
					trackOctave(t);
				}
			}

			if (items.length > 0) {
				items[items.length - 1].instrumentAfter = ci();
				items[items.length - 1].leaves = { octave, length };
			}
		};

		/** The first token index at or after source offset `offset`. */
		const tokenAfter = (from: number, offset: number) => {
			let i = from;
			while (i < tokens.length && tokens[i].start < offset) {
				i++;
			}
			return i;
		};

		/** Where the bracket run opened at token `i` ends, count included, as a token index. */
		const bracketEnd = (i: number) => {
			let depth = 0;
			let j = i;
			for (; j < tokens.length && tokens[j].start < end; j++) {
				if (tokens[j].kind === "loopStart") {
					depth++;
				} else if (tokens[j].kind === "loopEnd") {
					depth--;
					if (depth === 0) {
						break;
					}
				}
			}

			// `]]` closes with two tokens.
			if (j + 1 < tokens.length && tokens[j + 1].kind === "loopEnd" && tokens[j + 1].start === tokens[j].end) {
				j++;
			}

			if (j + 1 < tokens.length && tokens[j + 1].kind === "number" && tokens[j + 1].start === tokens[j].end) {
				j++;
			}

			return Math.min(j + 1, tokens.length);
		};

		while (at < tokens.length && tokens[at].start < end) {
			const t = tokens[at];
			const command = commandsAt.get(t.start);
			const place = emitted.get(`${channel}:${t.start}`);
			const size = (e: Emitted | undefined) =>
				e
					? nextAddress.has(`${channel}:${e.address}`)
						? nextAddress.get(`${channel}:${e.address}`)! - e.address
						: 2
					: 0;

			if (t.kind === "comment") {
				fixed(t.start, t.end, {});
				at++;
				continue;
			}

			if (OCTAVE_TOKENS.has(t.kind) || t.kind === "defaultLength") {
				if (octave === null && t.kind === "octaveShift") {
					// Relative to an octave this cannot see: kept as written.
					fixed(t.start, t.end, { reads: true });
				}
				trackOctave(t);

				at = command ? tokenAfter(at, command.span.end) : at + 1;
				continue;
			}

			if ((t.kind === "note" || t.kind === "rest") && command && !command.replacement && command.noteLength) {
				const triplet = command.noteLength.some((s) => s.triplet || s.replacement !== undefined);
				const stop = command.span.end;
				if (triplet || (t.kind === "note" && !place)) {
					fixed(t.start, stop, { sticky: true, reads: true });
					passOver(at, tokenAfter(at, stop));
					at = tokenAfter(at, stop);
					continue;
				}

				const ticks = command.noteLength.reduce((sum, s) => sum + s.ticks, 0);
				const letter = text.slice(t.start, t.end);
				const lengths = lengthText(command.noteLength);
				if (t.kind === "rest") {
					// A rest straight after a rest or a tie is merged into it by the compiler.
					const merged = !place;
					push({
						kind: "rest",
						text: "r" + lengths,
						key: `r|${ticks}|${merged ? 1 : 0}`,
						relKey: `r|${ticks}|${merged ? 1 : 0}`,
						bytes: size(place),
						ticks,
						glued: merged,
						tuned: false,
						untransposable: false,
					});
				} else {
					const note = place!.note!;
					const written = place!.written!;
					const drum = note >= 0xd0;
					const inst = ci();
					if (!drum) {
						learnShift(inst, written - note);
					}

					const pitched = !drum && note < 0xc6;
					const noteOctave = note < 0xc6 || drum ? octaveFor(letter, written) : null;
					if (noteOctave === null) {
						fixed(t.start, stop, { reads: true });
						at = tokenAfter(at, stop);
						continue;
					}

					const base = `${ticks}|${q()}|${pitched ? `${written - note}` : ""}`;
					const interval = pitched && lastPitch !== null ? note - lastPitch : "x";
					push({
						kind: "note",
						text: (pitched ? letter : letter) + lengths,
						key: `n|${note}|${base}`,
						relKey: drum ? `n|${note}|${base}` : `p|${interval}|${base}`,
						bytes: size(place),
						ticks,
						glued: afterDrum,
						octave: noteOctave,
						pitched,
						written,
						emitted: note,
						tuned: true,
						untransposable: drum,
					});
					octave = noteOctave;
					if (pitched) {
						lastPitch = note;
					}

					if (drum && channel !== 6 && channel !== 7) {
						instrument.set(channel, "255");
						items[items.length - 1].instrumentAfter = "255";
					}
				}

				afterDrum = false;
				at = tokenAfter(at, stop);
				continue;
			}

			if (t.kind === "tie") {
				const run = tiesAt.get(t.start);
				if (run?.segments.every((s) => !s.triplet && s.replacement === undefined)) {
					const ticks = run.segments.reduce((sum, s) => sum + s.ticks, 0);
					push({
						kind: "tie",
						text: "^" + lengthText(run.segments),
						key: `t|${ticks}`,
						relKey: `t|${ticks}`,
						bytes: size(place),
						ticks,
						glued: true,
						tuned: false,
						untransposable: false,
					});
					at = tokenAfter(at, run.span.end);
					continue;
				}
			}

			if (t.kind === "quantize" && command && !command.replacement) {
				const value = text.slice(command.span.start, command.span.end).replace(/\s+/g, "");
				quantize.set(channel, value);
				push({
					kind: "state",
					text: value,
					key: `q|${value}`,
					relKey: `q|${value}`,
					bytes: 0,
					ticks: 0,
					tuned: false,
					untransposable: false,
				});
				at = tokenAfter(at, command.span.end);
				continue;
			}

			if (t.kind === "instrument" && command && !command.replacement) {
				const value = command.args[0]?.value;
				const raw = text.slice(command.span.start, command.span.end).replace(/\s+/g, "");
				if (value !== undefined && !command.direct && value >= DRUMS.first && value <= DRUMS.last) {
					instrument.set(channel, String(value));
					push({
						kind: "drum",
						text: raw,
						key: `d|${raw}`,
						relKey: `d|${raw}`,
						bytes: 0,
						ticks: 0,
						tuned: false,
						untransposable: true,
						setsInstrument: true,
					});
					afterDrum = true;
				} else if (value !== undefined) {
					instrument.set(channel, command.direct ? `@${value}` : String(value));
					const bytes = place ? place.bytes : 0;
					push({
						kind: "command",
						text: raw,
						key: `c|${raw}|${bytes}`,
						relKey: `c|${raw}|${bytes}`,
						bytes,
						ticks: 0,
						tuned: false,
						untransposable: false,
						setsInstrument: true,
					});
				} else {
					instrument.set(channel, `?${unknowns++}`);
					fixed(t.start, command.span.end, { sticky: true });
				}

				at = tokenAfter(at, command.span.end);
				continue;
			}

			const hex = t.kind === "hex" && command && !command.replacement && !command.headReplacement && command.complete;
			const letterCommand = LETTER_COMMANDS.has(t.kind) && command && !command.replacement;
			if ((hex || letterCommand) && command && place) {
				const vcmd = data[place.address - aramAddress];
				const structural = vcmd === 0xe6 || vcmd === 0xe9 || vcmd === 0xfc;
				if (!structural) {
					const bytes = Array.from(
						data.subarray(place.address - aramAddress, place.address - aramAddress + place.bytes),
					);
					const hexKey = bytes.map((b) => b.toString(16)).join(" ");
					const slide = vcmd === 0xdd;
					const tune = vcmd === 0xfa && bytes[1] === 0x02;
					hotPatched ||= vcmd === 0xfa && (bytes[1] === 0x7f || bytes[1] === 0xfe);
					if (tune) {
						tunedChannels.add(channel);
					}

					push({
						kind: "command",
						text: text.slice(command.span.start, command.span.end).replace(/\s+/g, " "),
						key: `c|${hexKey}`,
						relKey: `c|${hexKey}`,
						bytes: place.bytes,
						ticks: 0,
						glued: slide,
						tuned: command.noteTarget !== undefined,
						untransposable: slide || tune || vcmd === 0xe4 || vcmd === 0xf3,
						targetOctave: command.noteTarget !== undefined ? octave : undefined,
					});
					at = tokenAfter(at, command.span.end);
					continue;
				}
			}

			if (t.kind === "operator" && text.slice(t.start, t.end) === "/") {
				push({
					kind: "barrier",
					text: "/",
					key: `/|${t.start}`,
					relKey: `/|${t.start}`,
					bytes: 0,
					ticks: 0,
					tuned: false,
					untransposable: true,
				});
				at++;
				continue;
			}

			if (t.kind === "label" && text[t.start] === "(") {
				const close = text.indexOf(")", t.start);
				const inner = text.slice(t.start + 1, close);
				const remote = inner.startsWith("!");
				const number = Number(inner.replace(/^!+/, "").split(",")[0].trim());
				if (Number.isInteger(number)) {
					labels.add(remote ? number - 1 : number);
				}

				let stop = tokenAfter(at, close + 1);
				if (!remote && stop < tokens.length && tokens[stop].kind === "loopStart" && tokens[stop].start === close + 1) {
					stop = bracketEnd(stop);
					const last = tokens[stop - 1];
					fixed(t.start, last.end, { reads: reads(at, stop) });
					passOver(at, stop);
				} else {
					if (stop < tokens.length && tokens[stop].kind === "number" && tokens[stop].start === close + 1) {
						stop++;
					}

					const last = tokens[stop - 1];
					fixed(t.start, Math.max(last.end, close + 1), { call: !remote, sticky: remote });
				}

				at = stop;
				continue;
			}

			if (t.kind === "loopStart") {
				const stop = bracketEnd(at);
				fixed(t.start, tokens[stop - 1].end, { reads: reads(at, stop) });
				passOver(at, stop);
				at = stop;
				continue;
			}

			if (t.kind === "loopCall") {
				let stop = at + 1;
				if (stop < tokens.length && tokens[stop].kind === "number" && tokens[stop].start === t.end) {
					stop++;
				}

				fixed(t.start, tokens[stop - 1].end, { call: true });
				at = stop;
				continue;
			}

			// Anything else is kept as written and, since it may be part of what is beside it, stuck to both.
			let stop = command && command.span.end > t.end ? tokenAfter(at, command.span.end) : at + 1;
			// Whatever touches it in the source goes with it: `^8` is one thing, `^ 8` another.
			while (stop < tokens.length && tokens[stop].start < end && tokens[stop].start === tokens[stop - 1].end) {
				stop++;
			}
			const last = tokens[stop - 1];
			const operator = t.kind === "operator" ? text.slice(t.start, t.end) : "";
			fixed(t.start, last.end, {
				sticky: t.kind !== "directive" || STICKY_OPERATORS.has(operator),
				reads: reads(at, stop) || t.kind === "replacement",
			});
			passOver(at, stop);
			at = stop;
		}

		void prevKind;
		channels.push({ header: text.slice(opener.start, headerEnd), channel, items });
	}

	if (hotPatched) {
		return null;
	}

	return {
		head: text.slice(0, channelTokens[0].start),
		channels,
		labels,
		shifts,
		tunedChannels,
	};
}
