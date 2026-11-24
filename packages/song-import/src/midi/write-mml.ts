/**
 * A MIDI performance written out as an `#amk 4` song on the stock instruments, each kept part on a
 * channel of its own or, where the porter lets them, sharing one with parts it never overlaps.
 *
 * Time is the file's quarter note made AddmusicK's 48 ticks, snapped to the porter's grid. Every
 * channel is padded with rests to one bar-rounded end, so none of them drifts against the others
 * when the song repeats. What a MIDI does to a note is written as the command the driver has for it:
 *
 * - velocity as `q7X`, X the nearest of the N-SPC velocity table;
 * - CC7 × CC11 as `v`, with `vD,N` where it moves under a held note;
 * - CC10 as `y` (reversed: AddmusicK's 0 is hard right), with `$DC` under a held note;
 * - the bend in force at the key-on folded into the written pitch, and the bend within the note as
 *   `$DD` slides, each directly after a tied piece of the note that it plays within;
 * - CC1 as `$DE` vibrato at about 5.5 Hz, `$DF` when it returns to 0;
 * - CC91 as one `$EF`/`$F1` echo on the channels that send reverb;
 * - tempo as `t`, on the first channel, at its tick; a loop marker as `/` in every channel.
 */

import {
	DEFAULT_TRANSPOSE,
	FIRST_CUSTOM_INSTRUMENT,
	FIRST_PERCUSSION_INSTRUMENT,
	NOTE_MIN,
	NSPC_VELOCITY_OFFSET,
	TICKS_PER_WHOLE,
	VELOCITY_VALUES,
} from "@amk/core/hardcoded-tables";
import { hex2 } from "@amk/core/hex";
import { octaveFor, spellNote } from "@amk/core/mml-text";
import type { InstrumentTables } from "@amk/spc/instruments";
import { highestTrue } from "@amk/spc/pitch";
import { type DrumSound, GM_PROGRAMS } from "./gm";
import { type Clashes, packChannels } from "./channels";
import type { Part, PartNote } from "./parts";
import { type ChannelPerformance, type Performance, type Point, quarterTicks, valueAt } from "./performance";

/** What the writer was asked for. */
export interface SongOptions {
	/** The snap grid, in driver ticks: 1 (exact) to 12 (a sixteenth). */
	grid: number;
	/** The parts to write, on at most eight channels, in part order. */
	keep: readonly string[];
	/** Let parts that never sound at once share a channel; otherwise each part has one. */
	share: boolean;
	/** A stock instrument chosen for a melodic part in place of its program's. */
	instruments: ReadonlyMap<string, number>;
	/** The sound the porter chose for a GM drum key in place of `GM_DRUMS`'; the kit's families stay GM's. */
	drums: ReadonlyMap<number, DrumSound>;
	/** Write the reverb send as echo. */
	echo: boolean;
	/** Loop from the file's loop markers, or the whole song. */
	loop: "markers" | "song";
	/** The title when the file has none: the file's own name. */
	fallbackTitle: string | null;
}

/** Something the writer changed to make the song fit, for the porter to read. */
export type ImportWarning =
	| { code: "truncated"; track: number }
	| { code: "tempo-clamped"; bpm: number; tempo: number }
	| { code: "shifted"; part: string; octaves: number }
	| { code: "folded"; part: string; count: number }
	| { code: "merged"; part: string; count: number }
	| { code: "unmapped-drums"; count: number }
	| { code: "smpte" };

export interface WrittenSong {
	text: string;
	warnings: ImportWarning[];
	/** The parts written to each channel, in channel order. */
	channels: readonly (readonly string[])[];
}

/** AddmusicK's channels. */
export const CHANNEL_LIMIT = 8;

const QUARTER = TICKS_PER_WHOLE / 4;
/** Ticks one written token can hold before the compiler splits it into frames (`noteFrames`). */
const ONE_FRAME = 0x7f;
const MIN_KEY = 24;
const MAX_KEY = 93;
const VIBRATO_HZ = 5.5;
const VIBRATO_DEPTH = 0x60;
const ECHO = "$F1 $02 $30 $00";
const ECHO_SEND = 16;
const TAG_LIMIT = 32;

const isDrum = (instrument: number): boolean =>
	instrument >= FIRST_PERCUSSION_INSTRUMENT && instrument < FIRST_CUSTOM_INSTRUMENT;

/** `t` for a tempo in microseconds per quarter: BPM × 0.4096 − 1 (`units.ts`, `bpm`). */
export function tempoFor(microsPerQuarter: number): { tempo: number; bpm: number; clamped: boolean } {
	const bpm = 60_000_000 / microsPerQuarter;
	const exact = Math.round(bpm * 0.4096) - 1;
	const tempo = Math.min(254, Math.max(1, exact));
	return { tempo, bpm, clamped: tempo !== exact };
}

/** The nearest `q` velocity nybble for a MIDI velocity, against the N-SPC table `#amk 4` uses. */
export function velocityNybble(velocity: number): number {
	let best = 0;
	for (let x = 0; x < 16; x++) {
		const err = Math.abs(VELOCITY_VALUES[NSPC_VELOCITY_OFFSET + x] / 255 - velocity / 127);
		if (err < Math.abs(VELOCITY_VALUES[NSPC_VELOCITY_OFFSET + best] / 255 - velocity / 127)) {
			best = x;
		}
	}

	return best;
}

/** The MIDI keys a stock instrument plays true: the written range, less its transposition and its pitch ceiling. */
export function keyRange(instrument: number, tables: InstrumentTables | null): { low: number; high: number } {
	const transpose = DEFAULT_TRANSPOSE[instrument] ?? 0;
	const entry = tables?.melodic[instrument];
	const ceiling = entry ? highestTrue(entry.tuning, entry.subTuning, 0) : MAX_KEY - MIN_KEY;
	return {
		low: Math.max(MIN_KEY, MIN_KEY + transpose),
		high: Math.min(MAX_KEY, MIN_KEY + transpose + Math.min(ceiling, MAX_KEY - MIN_KEY)),
	};
}

/** The byte a written key is emitted as under an instrument. */
function emitted(key: number, instrument: number): number {
	return NOTE_MIN + key - MIN_KEY - (DEFAULT_TRANSPOSE[instrument] ?? 0);
}

function tagText(value: string | null): string | null {
	if (value === null) {
		return null;
	}

	const clean = value
		.replace(/["\\]/g, "")
		.replace(/[^\x20-\x7e]/g, "")
		.trim();
	return clean === "" ? null : clean.slice(0, TAG_LIMIT).trim();
}

/** Points of a curve within `(from, to)`, and the value at `from` first. */
function within(curve: readonly Point[], from: number, to: number): Point[] {
	const out: Point[] = [{ tick: from, value: valueAt(curve, from) }];
	for (const point of curve) {
		if (point.tick > from && point.tick < to) {
			out.push(point);
		}
	}

	return out;
}

/** Ramer–Douglas–Peucker over a polyline. */
function simplify(points: readonly Point[], tolerance: number): Point[] {
	if (points.length <= 2) {
		return [...points];
	}

	const first = points[0];
	const last = points[points.length - 1];
	let worst = 0;
	let at = 0;
	for (let i = 1; i < points.length - 1; i++) {
		const span = last.tick - first.tick;
		const expected =
			span === 0 ? first.value : first.value + ((points[i].tick - first.tick) / span) * (last.value - first.value);
		const off = Math.abs(points[i].value - expected);
		if (off > worst) {
			worst = off;
			at = i;
		}
	}

	if (worst <= tolerance) {
		return [first, last];
	}

	const left = simplify(points.slice(0, at + 1), tolerance);
	return [...left.slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/**
 * A length of any size, as whole notes tied to what is left. The remainder is `N`, `N.` or `N..` only
 * where the dots halve it exactly, and `=ticks` otherwise: a dot that halves an odd count is AMK0200.
 */
export function spellTicks(ticks: number): string {
	const parts: string[] = [];
	let left = ticks;
	while (left > TICKS_PER_WHOLE) {
		parts.push("1");
		left -= TICKS_PER_WHOLE;
	}

	parts.push(oneLength(left));
	return parts.join("^");
}

/** The lengths a rest is tied from, each one a plain or dotted length that halves exactly. */
const REST_PIECES = [192, 144, 96, 72, 48, 36, 24, 18, 12, 9, 6, 3];

/** {@link spellTicks} for a rest, which reads better as up to three common lengths tied: 60 ticks is `4^16`. */
export function spellRestTicks(ticks: number): string {
	const parts: string[] = [];
	let left = ticks;
	while (left > TICKS_PER_WHOLE) {
		parts.push("1");
		left -= TICKS_PER_WHOLE;
	}

	const tied: number[] = [];
	for (const piece of REST_PIECES) {
		while (left >= piece && tied.length < 3) {
			tied.push(piece);
			left -= piece;
		}
	}

	if (left !== 0) {
		return spellTicks(ticks);
	}

	return [...parts, ...tied.map(oneLength)].join("^");
}

function oneLength(ticks: number): string {
	if (TICKS_PER_WHOLE % ticks === 0) {
		return String(TICKS_PER_WHOLE / ticks);
	}

	for (let divisor = 1; divisor <= TICKS_PER_WHOLE; divisor++) {
		const base = TICKS_PER_WHOLE / divisor;
		if (!Number.isInteger(base)) {
			continue;
		}

		if (base % 2 === 0 && (base * 3) / 2 === ticks) {
			return `${divisor}.`;
		}

		if (base % 4 === 0 && (base * 7) / 4 === ticks) {
			return `${divisor}..`;
		}
	}

	return `=${ticks}`;
}

/** A stretch of a note as one written token: the key-on, or a tie, and the slide that follows it. */
interface Piece {
	start: number;
	length: number;
	slide: { duration: number; target: number } | null;
}

/** One note as the channel will write it. */
interface Written {
	start: number;
	end: number;
	instrument: number;
	/** The written key; a stock drum's is unused. */
	key: number;
	pieces: Piece[];
	q: number;
	volume: number;
	volumeEnd: number;
	pan: number;
	panEnd: number;
	vibrato: number;
}

/** A command every channel or the first one writes at a tick: a tempo, or the loop point. */
interface Stop {
	tick: number;
	text: string;
	channel: "first" | "all";
}

interface Timebase {
	amk: (tick: number) => number;
	snap: (ticks: number) => number;
}

function timebase(performance: Performance, grid: number): Timebase {
	const scale = QUARTER / quarterTicks(performance);
	return {
		amk: (tick) => tick * scale,
		snap: (ticks) => Math.round(ticks / grid) * grid,
	};
}

/** Bar starts in driver ticks, through `end` and one bar past it. */
function barStarts(performance: Performance, time: Timebase, end: number): number[] {
	const meters = performance.meters.map((m) => ({
		at: Math.round(time.amk(m.tick)),
		bar: Math.max(1, Math.round((m.numerator * TICKS_PER_WHOLE) / m.denominator)),
	}));
	const out: number[] = [];
	let at = 0;
	let index = 0;
	while (at <= end) {
		out.push(at);
		while (index + 1 < meters.length && meters[index + 1].at <= at) {
			index++;
		}

		const next = at + meters[index].bar;
		const change = meters[index + 1]?.at;
		at = change !== undefined && change > at && change < next ? change : next;
	}

	out.push(at);
	return out;
}

interface PartPlan {
	part: Part;
	notes: Written[];
	reverb: boolean;
}

/** A channel: the parts it holds, and their notes as one stream. */
interface ChannelPlan {
	parts: readonly Part[];
	notes: Written[];
	reverb: boolean;
}

function planPart(
	part: Part,
	channel: ChannelPerformance,
	options: SongOptions,
	time: Timebase,
	tables: InstrumentTables | null,
	songEnd: number,
	loopAt: number | null,
	tempoAt: (tick: number) => number,
	warnings: ImportWarning[],
): PartPlan {
	const override = options.instruments.get(part.id);
	const soundOf = (note: PartNote): DrumSound | null => (note.drum ? (options.drums.get(note.key) ?? note.drum) : null);
	const instrumentOf = (note: PartNote): number =>
		soundOf(note)?.instrument ?? override ?? GM_PROGRAMS[note.program] ?? 0;

	// Snap, then let no two notes start together and none run into the next.
	interface Snapped {
		note: PartNote;
		start: number;
		end: number;
	}
	const snapped: Snapped[] = [];
	let merged = 0;
	for (const note of part.notes) {
		const start = time.snap(time.amk(note.start));
		const end = Math.max(start + options.grid, time.snap(time.amk(note.end)));
		if (start >= songEnd) {
			continue;
		}

		if (snapped.length > 0 && snapped[snapped.length - 1].start === start) {
			merged++;
			continue;
		}

		snapped.push({ note, start, end: Math.min(end, songEnd) });
	}

	for (let i = 0; i < snapped.length; i++) {
		const next = snapped[i + 1]?.start ?? songEnd;
		const current = snapped[i];
		current.end = part.drums ? Math.min(next, current.start + 2 * QUARTER) : Math.min(current.end, next);
	}

	if (merged > 0) {
		warnings.push({ code: "merged", part: part.id, count: merged });
	}

	// A note across the loop point is struck again there, so the repeat starts on a key-on.
	if (loopAt !== null) {
		for (let i = 0; i < snapped.length; i++) {
			const s = snapped[i];
			if (s.start < loopAt && s.end > loopAt) {
				snapped.splice(i + 1, 0, { note: s.note, start: loopAt, end: s.end });
				s.end = loopAt;
			}
		}
	}

	// The octave shift that leaves fewest notes outside their instrument's range, and folds the rest.
	const pitched = snapped.filter((s) => !isDrum(instrumentOf(s.note)));
	const bendAt = (tick: number): number => Math.round(valueAt(channel.bend, tick));
	const baseKey = (s: Snapped): number =>
		s.note.drum ? (soundOf(s.note)?.key ?? s.note.key) : s.note.key + bendAt(s.note.start);
	const outside = (octaves: number): number =>
		pitched.filter((s) => {
			const range = keyRange(instrumentOf(s.note), tables);
			const key = baseKey(s) + octaves * 12;
			return key < range.low || key > range.high;
		}).length;
	let shift = 0;
	if (!part.drums) {
		for (const octaves of [0, -1, 1, -2, 2, -3, 3]) {
			if (outside(octaves) < outside(shift)) {
				shift = octaves;
			}
		}
	}

	if (shift !== 0) {
		warnings.push({ code: "shifted", part: part.id, octaves: shift });
	}

	let folded = 0;
	const notes: Written[] = [];
	for (const s of snapped) {
		const instrument = instrumentOf(s.note);
		const length = s.end - s.start;
		if (length <= 0) {
			continue;
		}

		let key = baseKey(s) + shift * 12;
		let pieces: Piece[] = [{ start: 0, length, slide: null }];
		if (!isDrum(instrument)) {
			const range = keyRange(instrument, tables);
			const before = key;
			while (key < range.low) {
				key += 12;
			}

			while (key > range.high && key - 12 >= range.low) {
				key -= 12;
			}

			if (key !== before) {
				folded++;
			}

			if (!s.note.drum) {
				pieces = slidePieces(s, length, key, instrument, channel, time, tables);
			}
		}

		const startTick = s.note.start;
		const endTick = Math.max(startTick, s.note.end - 1);
		const volumeOf = (tick: number): number =>
			Math.round((255 * valueAt(channel.volume, tick) * valueAt(channel.expression, tick)) / (127 * 127));
		const panOf = (tick: number): number => Math.round(((127 - valueAt(channel.pan, tick)) * 20) / 127);
		// A vibrato swings either side of the note, so one at the edge of the range would leave it.
		const bytes = [emitted(key, instrument), ...pieces.flatMap((piece) => (piece.slide ? [piece.slide.target] : []))];
		const range = isDrum(instrument) ? null : keyRange(instrument, tables);
		const edge =
			range !== null &&
			bytes.some((byte) => byte <= emitted(range.low, instrument) || byte >= emitted(range.high, instrument));
		const modulation = edge ? 0 : valueAt(channel.modulation, startTick);
		notes.push({
			start: s.start,
			end: s.end,
			instrument,
			key,
			pieces,
			q: velocityNybble(s.note.velocity),
			volume: volumeOf(startTick),
			volumeEnd: volumeOf(endTick),
			pan: panOf(startTick),
			panEnd: panOf(endTick),
			vibrato: modulation === 0 ? 0 : vibratoBytes(modulation, tempoAt(s.start)),
		});
	}

	if (folded > 0) {
		warnings.push({ code: "folded", part: part.id, count: folded });
	}

	const reverb = part.notes.some((note) => valueAt(channel.reverb, note.start) >= ECHO_SEND);
	return { part, notes, reverb };
}

/** `$DE`'s rate and depth for a modulation wheel value, packed as `rate << 8 | depth`. */
function vibratoBytes(modulation: number, tempo: number): number {
	const ticksPerSecond = (500 * (tempo + 1)) / 256;
	const rate = Math.min(255, Math.max(1, Math.round((256 * VIBRATO_HZ) / ticksPerSecond)));
	const depth = Math.max(1, Math.round((modulation / 127) * VIBRATO_DEPTH));
	return (rate << 8) | depth;
}

/**
 * The note cut into tied pieces where the bend moves, each moving piece followed by its `$DD`.
 *
 * The driver picks a `$DD` up only while the note or tie in front of it plays a frame of two ticks
 * or more, and only once the slide before has finished (COMMANDS.html, the `$DD` card). So a moving
 * piece is one frame long (under `$80` ticks), at least three ticks, and its slide two ticks shorter
 * than it; a slide that cannot fit, or whose target the instrument cannot reach, is left out.
 */
function slidePieces(
	s: { note: PartNote; start: number },
	length: number,
	key: number,
	instrument: number,
	channel: ChannelPerformance,
	time: Timebase,
	tables: InstrumentTables | null,
): Piece[] {
	const from = s.note.start;
	const to = s.note.end;
	const curve = within(channel.bend, from, to);
	if (curve.length < 2) {
		return [{ start: 0, length, slide: null }];
	}

	// A held value then a jump is a step, not a ramp: the point before the jump keeps it sharp.
	const line: Point[] = [];
	for (let i = 0; i < curve.length; i++) {
		const tick = Math.max(0, time.amk(curve[i].tick) - time.amk(from));
		if (i > 0 && tick - line[line.length - 1].tick > 2) {
			line.push({ tick: tick - 1, value: curve[i - 1].value });
		}

		line.push({ tick, value: curve[i].value });
	}

	line.push({ tick: length, value: curve[curve.length - 1].value });
	const base = Math.round(curve[0].value);
	const range = keyRange(instrument, tables);
	const top = emitted(range.high, instrument);
	const breaks = simplify(line, 0.5);

	const slides: { at: number; duration: number; target: number }[] = [];
	for (let i = 0; i + 1 < breaks.length && slides.length < 16; i++) {
		const a = breaks[i];
		const b = breaks[i + 1];
		const semis = Math.round(b.value) - base;
		const was = slides.length > 0 ? slides[slides.length - 1].target : emitted(key, instrument);
		const target = emitted(key + semis, instrument);
		if (target === was || Math.round(b.value) === Math.round(a.value)) {
			continue;
		}

		if (target < NOTE_MIN || target > top) {
			continue;
		}

		slides.push({ at: Math.round(a.tick), duration: Math.max(1, Math.round(b.tick - a.tick)), target });
	}

	const pieces: Piece[] = [];
	let pos = 0;
	for (let i = 0; i < slides.length; i++) {
		const slide = slides[i];
		const at = Math.max(pos, slide.at);
		const room = Math.min(slides[i + 1]?.at ?? length, length) - at;
		const piece = Math.min(room, ONE_FRAME);
		if (piece < 3 || at >= length) {
			continue;
		}

		if (at > pos) {
			pieces.push({ start: pos, length: at - pos, slide: null });
		}

		pieces.push({
			start: at,
			length: piece,
			slide: { duration: Math.min(slide.duration, piece - 2, 255), target: slide.target },
		});
		pos = at + piece;
	}

	if (pos < length) {
		pieces.push({ start: pos, length: length - pos, slide: null });
	}

	return pieces;
}

/** Writes one channel's text: its notes, the rests between them, and the commands each one needs. */
class ChannelText {
	private readonly lines: string[][] = [[]];
	private cursor = 0;
	private bar = 0;
	private stop = 0;
	private instrument: number | null = null;
	private octave: number | null = null;
	private volume: number | null = null;
	private pan: number | null = null;
	private q: number | null = null;
	private vibrato = 0;
	/** The next note to write, whose settings a rest at the start or after the loop point states first. */
	private next = 0;

	constructor(
		private readonly bars: readonly number[],
		private readonly stops: readonly Stop[],
		private readonly notes: readonly Written[],
	) {}

	/** The channel's text: its notes, then rests to `end`. */
	write(end: number): string {
		// A channel that ever turns vibrato on states it at the start, so the repeat does not inherit it.
		this.vibrato = this.notes.some((note) => note.vibrato !== 0) ? -1 : 0;
		this.settings();
		for (const note of this.notes) {
			this.note(note);
			this.next++;
		}

		this.rest(end);
		return this.lines
			.filter((line) => line.length > 0)
			.map((line) => line.join(" "))
			.join("\n");
	}

	/**
	 * The next note's instrument, volume, pan and vibrato, written ahead of the rest in front of it, so
	 * the start of the song and of its repeat are not left under what the end of the pass set (`SST0511`).
	 */
	private settings(): void {
		const note = this.notes[this.next];
		if (!note) {
			return;
		}

		// `@21`-`@29` emit no byte, so in front of a rest a drum channel states `@0`, which does.
		if (isDrum(note.instrument) && note.start > this.cursor) {
			this.push("@0");
			this.instrument = 0;
		} else {
			this.instrumentFor(note);
		}

		this.volumeFor(note);
		this.panFor(note);
		this.vibratoFor(note);
		// A rest takes the `q` folded into its length byte, so the one in front of the note states it.
		this.qFor(note);
	}

	private qFor(note: Written): void {
		if (this.q !== note.q) {
			this.push(`q7${note.q.toString(16).toUpperCase()}`);
			this.q = note.q;
		}
	}

	private instrumentFor(note: Written): void {
		// A drum is written before every hit: on #0-#5 the compiler forgets it after one (COMMANDS.html §2.3).
		if (isDrum(note.instrument) || this.instrument !== note.instrument) {
			this.push(`@${note.instrument}`);
			this.instrument = note.instrument;
		}
	}

	private volumeFor(note: Written): void {
		if (this.volume !== note.volume) {
			this.push(`v${note.volume}`);
			this.volume = note.volume;
		}
	}

	private panFor(note: Written): void {
		if (this.pan !== note.pan) {
			this.push(`y${note.pan}`);
			this.pan = note.pan;
		}
	}

	private vibratoFor(note: Written): void {
		if (this.vibrato !== note.vibrato) {
			this.push(note.vibrato === 0 ? "$DF" : `$DE $00 $${hex2(note.vibrato >> 8)} $${hex2(note.vibrato & 0xff)}`);
			this.vibrato = note.vibrato;
		}
	}

	private push(token: string): void {
		this.lines[this.lines.length - 1].push(token);
	}

	/** A new line for each bar that starts at or before `tick`. */
	private reach(tick: number): void {
		let crossed = false;
		while (this.bar < this.bars.length && this.bars[this.bar] <= tick) {
			crossed = crossed || this.bars[this.bar] > 0;
			this.bar++;
		}

		if (crossed && this.lines[this.lines.length - 1].length > 0) {
			this.lines.push([]);
		}
	}

	/** The commands due at or before `tick`; the loop point forgets what was in force, so the repeat restates it. */
	private flush(tick: number): void {
		while (this.stop < this.stops.length && this.stops[this.stop].tick <= tick) {
			const stop = this.stops[this.stop++];
			this.push(stop.text);
			if (stop.text.startsWith("/")) {
				this.instrument = this.octave = this.volume = this.pan = this.q = null;
				this.vibrato = -1;
				this.settings();
			}
		}
	}

	private nextBoundary(after: number, limit: number): number {
		const bar = this.bars.find((b) => b > after) ?? limit;
		const stop = this.stops.find((s) => s.tick > after)?.tick ?? limit;
		return Math.min(limit, bar, stop);
	}

	rest(until: number): void {
		this.flush(this.cursor);
		while (this.cursor < until) {
			const next = this.nextBoundary(this.cursor, until);
			this.reach(this.cursor);
			this.push(`r${spellRestTicks(next - this.cursor)}`);
			this.cursor = next;
			this.flush(this.cursor);
		}

		this.reach(this.cursor);
	}

	opening(tokens: readonly string[]): void {
		for (const token of tokens) {
			this.push(token);
		}
	}

	private setOctave(octave: number): void {
		if (this.octave === octave) {
			return;
		}

		if (this.octave !== null && Math.abs(this.octave - octave) === 1) {
			this.push(octave > this.octave ? ">" : "<");
		} else {
			this.push(`o${octave}`);
		}

		this.octave = octave;
	}

	private note(note: Written): void {
		this.rest(note.start);
		const drum = isDrum(note.instrument);
		this.instrumentFor(note);
		this.volumeFor(note);

		const length = note.end - note.start;
		if (Math.abs(note.volumeEnd - note.volume) >= 12 && length >= 4) {
			this.push(`v${Math.min(255, length)},${note.volumeEnd}`);
			this.volume = note.volumeEnd;
		}

		this.panFor(note);
		if (Math.abs(note.panEnd - note.pan) >= 2 && length >= 4) {
			this.push(`$DC $${hex2(Math.min(255, length))} $${hex2(note.panEnd)}`);
			this.pan = note.panEnd;
		}

		this.vibratoFor(note);
		this.qFor(note);

		// A stock drum plays its own pitch, so it is written as a `c` in whatever octave is in force.
		const written = drum ? NOTE_MIN + 12 * ((this.octave ?? 4) - 1) : NOTE_MIN + note.key - MIN_KEY;
		const octave = drum ? (this.octave ?? 4) : (octaveFor(written) ?? 4);
		this.setOctave(octave);
		const letter = drum ? "c" : (spellNote(written, octave) ?? "c");

		note.pieces.forEach((piece, index) => {
			const at = note.start + piece.start;
			if (index > 0) {
				this.flush(at);
			}

			// A tempo inside a still piece splits it with a tie; inside a moving one it waits for the slide.
			const cuts = piece.slide
				? []
				: this.stops
						.slice(this.stop)
						.filter((s) => s.tick > at && s.tick < at + piece.length)
						.map((s) => s.tick);
			let from = at;
			for (const cut of [...cuts, at + piece.length]) {
				const head = from === note.start ? letter : "^";
				this.push(`${head}${spellTicks(cut - from)}`);
				if (cut < at + piece.length) {
					this.flush(cut);
				}

				from = cut;
			}

			if (piece.slide) {
				this.push(`$DD $00 $${hex2(piece.slide.duration)} $${hex2(piece.slide.target)}`);
			}
		});

		this.cursor = note.end;
	}
}

/**
 * The parts sharing a channel as one stream of notes, in order of start. Where one part hands over
 * to another, the earlier note is trimmed to meet the later; two struck together keep the first, and
 * the other is counted with its part's merged notes.
 */
function mergePlans(plans: readonly PartPlan[], warnings: ImportWarning[]): ChannelPlan {
	const tagged = plans.flatMap((plan) => plan.notes.map((note) => ({ note, part: plan.part.id })));
	tagged.sort((a, b) => a.note.start - b.note.start);
	const notes: Written[] = [];
	const dropped = new Map<string, number>();
	for (const { note, part } of tagged) {
		const last = notes.at(-1);
		if (last?.start === note.start) {
			dropped.set(part, (dropped.get(part) ?? 0) + 1);
			continue;
		}

		if (last && last.end > note.start) {
			trimTo(last, note.start);
		}

		notes.push(note);
	}

	for (const [part, count] of dropped) {
		warnings.push({ code: "merged", part, count });
	}

	return { parts: plans.map((plan) => plan.part), notes, reverb: plans.some((plan) => plan.reverb) };
}

/**
 * A note cut to end at `end`: its pieces cut with it, and a slide kept only where its piece still
 * has room for it (`slidePieces`).
 */
function trimTo(note: Written, end: number): void {
	const length = end - note.start;
	note.end = end;
	const kept: Piece[] = [];
	for (const piece of note.pieces) {
		if (piece.start >= length) {
			break;
		}

		const room = Math.min(piece.length, length - piece.start);
		const slide =
			piece.slide && room >= 3 ? { ...piece.slide, duration: Math.min(piece.slide.duration, room - 2) } : null;
		kept.push({ start: piece.start, length: room, slide });
	}

	note.pieces = kept;
}

/** The part's line in the song's comments. */
function describe(part: Part): string {
	const voice = `${part.voice + 1}/${part.voices}`;
	const where = part.family
		? `MIDI ch ${part.channel + 1}, ${part.family} ${voice}`
		: `MIDI ch ${part.channel + 1}, voice ${voice}, program ${part.program + 1}`;
	const name = tagText(part.name);
	return name ? `; ${where}: ${name}` : `; ${where}`;
}

/** Writes the kept parts as a song. */
export function writeSong(
	performance: Performance,
	parts: readonly Part[],
	clash: Clashes,
	unmappedDrums: number,
	options: SongOptions,
	tables: InstrumentTables | null,
): WrittenSong {
	const warnings: ImportWarning[] = performance.truncated.map((track) => ({ code: "truncated" as const, track }));
	if (unmappedDrums > 0) {
		warnings.push({ code: "unmapped-drums", count: unmappedDrums });
	}

	if (performance.division.kind === "smpte") {
		warnings.push({ code: "smpte" });
	}

	const time = timebase(performance, options.grid);
	const keep = new Set(options.keep);
	const ordered = parts.filter((p) => keep.has(p.id)).map((p) => p.id);
	const layout = (options.share ? packChannels(parts, ordered, clash) : ordered.map((id) => [id])).slice(
		0,
		CHANNEL_LIMIT,
	);
	const byId = new Map(parts.map((p) => [p.id, p]));
	const grouped = layout.map((ids) => ids.map((id) => byId.get(id)).filter((p): p is Part => p !== undefined));
	const kept = grouped.flat();

	// The tempo map in driver ticks; an SMPTE file is played at 120 BPM throughout.
	const tempos =
		performance.division.kind === "smpte"
			? [{ tick: 0, ...tempoFor(500_000) }]
			: performance.tempos.map((t) => ({ tick: time.snap(time.amk(t.tick)), ...tempoFor(t.microsPerQuarter) }));
	for (const t of tempos) {
		if (t.clamped) {
			warnings.push({ code: "tempo-clamped", bpm: Math.round(t.bpm), tempo: t.tempo });
		}
	}

	const tempoAt = (tick: number): number => {
		let tempo = tempos[0].tempo;
		for (const t of tempos) {
			if (t.tick <= tick) {
				tempo = t.tempo;
			}
		}

		return tempo;
	};

	const markers = options.loop === "markers" ? performance.loop : null;
	let rawEnd = options.grid;
	for (const part of kept) {
		for (const n of part.notes) {
			const start = time.snap(time.amk(n.start));
			rawEnd = Math.max(rawEnd, start + options.grid, time.snap(time.amk(n.end)));
		}
	}

	const bars = barStarts(performance, time, rawEnd);
	let songEnd = bars.find((b) => b >= rawEnd) ?? rawEnd;
	if (markers?.end != null) {
		songEnd = Math.max(options.grid, time.snap(time.amk(markers.end)));
	}

	const loopTick = markers ? time.snap(time.amk(markers.start)) : null;
	const loopAt = loopTick !== null && loopTick > 0 && loopTick < songEnd ? loopTick : null;

	const plans = grouped.map((group) =>
		mergePlans(
			group.map((part) => {
				const channel = performance.channels.find((c) => c.channel === part.channel);
				if (!channel) {
					throw new Error(`part ${part.id} has no channel`);
				}

				return planPart(part, channel, options, time, tables, songEnd, loopAt, tempoAt, warnings);
			}),
			warnings,
		),
	);

	const echoMask = options.echo
		? plans.reduce((mask, plan, index) => (plan.reverb ? mask | (1 << index) : mask), 0)
		: 0;

	const stops: Stop[] = [];
	for (const t of tempos.slice(1)) {
		if (t.tick < songEnd) {
			stops.push({ tick: t.tick, text: `t${t.tempo}`, channel: "first" });
		}
	}

	if (loopAt !== null) {
		stops.push({ tick: loopAt, text: "/", channel: "all" });
		stops.push({ tick: loopAt, text: `t${tempoAt(loopAt)}`, channel: "first" });
	}

	stops.sort((a, b) => a.tick - b.tick || (a.text === "/" ? -1 : b.text === "/" ? 1 : 0));

	const body = plans.map((plan, index) => {
		const writer = new ChannelText(
			bars.filter((b) => b <= songEnd),
			stops.filter((s) => s.channel === "all" || index === 0),
			plan.notes,
		);
		if (index === 0) {
			writer.opening([
				"w255",
				`t${tempos[0].tempo}`,
				...(echoMask !== 0 ? [`$EF $${hex2(echoMask)} $28 $28`, ECHO] : []),
			]);
		}

		return `#${index} ${plan.parts.map(describe).join("\n")}\n${writer.write(songEnd)}`;
	});

	const title = tagText(performance.title) ?? tagText(options.fallbackTitle);
	const author = tagText(performance.author);
	const spc = [
		"#spc",
		"{",
		...(title ? [`\t#title "${title}"`] : []),
		...(author ? [`\t#author "${author}"`] : []),
		`\t#comment "Imported from MIDI"`,
		"}",
	];

	const text = ["#amk 4", "", ...spc, "", body.join("\n\n"), ""].join("\n");
	return { text, warnings, channels: plans.map((plan) => plan.parts.map((part) => part.id)) };
}
