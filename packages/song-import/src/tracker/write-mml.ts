/**
 * A played tracker module written out as an `#amk 4` song: each kept channel on one of AddmusicK's,
 * each sample a custom instrument after `#default` (or `#optimized`).
 *
 * Two driver ticks make one tracker tick, which makes the module's BPM the song's quarter-note BPM
 * (`t` is BPM × 0.4096 − 1) and a row at speed 6 a sixteenth. What the module does to a note is
 * written as the command the driver has for it (the effects named here are MOD's):
 *
 * - volume as `v`, through a square root since the driver squares it (`main.asm`, `L_124D`), with
 *   `vD,N` where it slides;
 * - panning as `y`, the Amiga's hard left and right narrowed by the stereo separation;
 * - a slide in pitch (1xx, 2xx, 3xx, 5xy, the fine slides) as `$DD` ramps, each directly after a tied
 *   piece of the note that it plays within;
 * - vibrato (4xy, 6xy) as `$DE`, its rate the player's phase step over the driver ticks to a tracker
 *   tick and its extent the swing the player recorded, and `$DF` where it stops;
 * - tremolo (7xy) as `$E5` in front of the key-on, the only place its read-ahead is safe, and `$FD`
 *   in front of a note with none;
 * - arpeggio (0xy) as `$FB` under legato, so its steps move the pitch without striking the sample
 *   again (`main.asm:2517-2530`), legato and the arpeggio turned off a tracker tick before the note ends
 *   so that it keys off as any note does;
 * - and on each channel the `$EE` fine tune that brings its notes nearest their pitch.
 *
 * The text is cut at every pass through an order. A cut that comes round again in the same state is
 * written once as a label loop and called after that, which is where a module's repeats save the ARAM
 * its samples need.
 */

import { NOTE_MIN } from "@amk/core/hardcoded-tables";
import { hex2 } from "@amk/core/hex";
import { octaveFor, spellNote } from "@amk/core/mml-text";
import { spellRestTicks, spellTicks } from "../mml/lengths";
import { simplify, tagText, tempoForBpm } from "../mml/song-text";
import { SEMITONE, setPitchWide } from "@amk/spc/pitch";
import type { ChannelTicks, TrackerPlay, TrackerSong } from "./model";
import { HIGHEST_KEY, type Tuning, baseRegister, playsTrue, plannedFrames, tuningFor } from "./samples";

/** AddmusicK's channels. */
export const TRACKER_CHANNEL_LIMIT = 8;
/** Driver ticks to a tracker tick. */
export const DRIVER_TICKS = 2;
const FIRST_CUSTOM = 30;
/** The longest piece a `$DD` can follow: one frame. */
const ONE_FRAME = 0x7f;
/** Full gate and velocity: a tracker note sounds until the next one. */
const Q = "q7F";
/** Rows to a line of text. */
const ROWS_A_LINE = 16;
/** How far, in `v` units, a run of fades may stray from the slide it stands for: wide enough that a slide over many rows is one fade. */
const VOLUME_TOLERANCE = 6;
/** How far, in semitones, a run of `$DD` ramps may stray from the slide it stands for. */
const PITCH_TOLERANCE = 0.3;
/** The `$EE` values tried: a quarter of a semitone, the reach `tuningFor` counts on (`FINE_TUNE_CENTS`). */
const FINE_TUNE_REACH = 64;

/** What the writer was asked for. */
export interface TrackerSongOptions {
	/** The module's channels to write, at most eight, in the order they take AddmusicK's. */
	keep: readonly number[];
	/** Each sample's resampling factor, or `drop` to leave its notes out. A sample not named is at 1. */
	factors: ReadonlyMap<number, number | "drop">;
	/** 1 is the module's own panning, 0 is mono. */
	separation: number;
	/** Loop where the song jumps back, or the whole song from the start. */
	loop: "jump" | "song";
	/** The file name of sample `index`'s BRR. */
	sampleName: (index: number) => string;
	/** The title when the file has none: the file's own name. */
	fallbackTitle: string | null;
	/** Open `#samples` with `#optimized`, AddmusicK's smaller copies of the stock set, rather than `#default`. */
	optimized?: boolean;
}

/** Something the writer changed to make the song fit, for the porter to read. */
export type TrackerImportWarning =
	| { code: "offsets"; count: number }
	| { code: "arpeggio"; count: number }
	| { code: "unsupported"; count: number }
	| { code: "mod-truncated" }
	| { code: "too-long" }
	| { code: "dropped-notes"; sample: number; count: number }
	| { code: "mod-folded"; sample: number; count: number }
	| { code: "mod-tempo-clamped"; bpm: number; tempo: number };

/** A sample the song plays, as `#instruments` lists it. */
export interface SongSample {
	index: number;
	name: string;
	/** The factor its PCM must be planned at, which the loop's rounding may have moved off the one asked for. */
	factor: number;
	instrument: number;
	tuning: Tuning;
}

export interface WrittenTrackerSong {
	text: string;
	samples: SongSample[];
	warnings: TrackerImportWarning[];
}

/** A note as the channel sounds it, in tracker ticks. */
interface Note {
	start: number;
	end: number;
	sample: number;
}

/** The notes on a channel: each key-on until the next, the sample's end or a lasting silence, struck again at `split`. */
function notesOf(ch: ChannelTicks, end: number, split: number | null, playable: (sample: number) => boolean): Note[] {
	const notes: Note[] = [];
	let current: Note | null = null;
	const close = (at: number): void => {
		if (current) {
			// A volume of 0 to the end of the note is a cut: the note ends where the silence starts.
			let last = at;
			while (last > current.start + 1 && ch.volume[last - 1] === 0) {
				last--;
			}

			current.end = last;
			if (current.end > current.start) {
				notes.push(current);
			}

			current = null;
		}
	};

	for (let t = 0; t < end; t++) {
		const sounding = ch.sample[t] > 0;
		if (ch.keyOn[t] || (t === split && sounding && current)) {
			close(t);
			if (sounding && playable(ch.sample[t])) {
				current = { start: t, end: t + 1, sample: ch.sample[t] };
			}
		} else if (!sounding) {
			close(t);
		}
	}

	close(end);
	return notes;
}

/** `v` for a tracker volume of 64: the driver squares the volume it is given, so the root of the module's linear one. */
function volumeOf(volume: number): number {
	return Math.round(255 * Math.sqrt(volume / 64));
}

/** `y` for a tracker pan of 0 (left) to 255 (right): AddmusicK's 20 is hard left. */
function panOf(pan: number, separation: number): number {
	return Math.round(10 - ((pan - 127.5) / 127.5) * 10 * separation);
}

/** The driver's phase step, of 256 a driver tick, for a tracker's of 256 a tracker tick. */
function rateOf(phase: number): number {
	return Math.max(1, Math.min(255, Math.round(phase / DRIVER_TICKS)));
}

/** `$DE`'s rate and extent for a vibrato's phase step and swing in semitones, packed `rate << 8 | extent`. */
function vibratoOf(phase: number, semitones: number): number {
	if (phase === 0 || semitones === 0) {
		return 0;
	}

	const rate = rateOf(phase);
	const fine = Math.round(semitones * 256);
	const extent = fine < 0xf1 ? Math.max(1, fine) : 0xf0 | Math.min(15, Math.round(semitones));
	return (rate << 8) | extent;
}

/**
 * `$E5`'s rate and amplitude for a tremolo's phase step and swing at a volume, packed
 * `rate << 8 | amplitude`, and how far the volume is raised to centre the swing.
 */
function tremoloOf(phase: number, swing: number, volume: number): { command: number; swing: number } | null {
	if (phase === 0 || swing === 0 || volume === 0) {
		return null;
	}

	// The driver's tremolo only takes away, from the velocity it then squares (`L_122D`, `L_124D`),
	// so the note is raised to the top of the swing and the amplitude carries it down to the bottom.
	const top = Math.min(64, volume + swing);
	const bottom = Math.max(0, volume - swing);
	const amplitude = Math.round(256 * (1 - Math.sqrt(bottom / top)));
	// Above `$C5` the read-ahead would take the amplitude for a tie or a command (COMMANDS.html, `$E5`).
	const rate = rateOf(phase);
	return { command: (rate << 8) | Math.max(1, Math.min(0xc5, amplitude)), swing: top - volume };
}

/** `$FB`'s steps for an arpeggio: the note, `x` above it and `y` above it, each a tracker tick. */
function arpeggioText(param: number): string {
	return `$FB $03 $${hex2(DRIVER_TICKS)} $00 $${hex2(param >> 4)} $${hex2(param & 0x0f)}`;
}

/** An arpeggio of the note alone: the pitch returns to it and holds while legato lasts. */
const HOLD = -1;

interface ChannelState {
	instrument: number | null;
	volume: number | null;
	pan: number | null;
	vibrato: number | null;
	tremolo: number | null;
	/** The `$FB` in force: an arpeggio's `xy`, {@link HOLD}, or 0 for none. */
	arpeggio: number;
	legato: boolean;
	fineTune: number | null;
	q: boolean;
}

const FORGOTTEN: ChannelState = {
	instrument: null,
	volume: null,
	pan: null,
	vibrato: null,
	tremolo: null,
	arpeggio: 0,
	legato: false,
	fineTune: null,
	q: false,
};

/** What a channel of the song is made of, ready to be written cut by cut. */
interface Context {
	ticks: ChannelTicks;
	notes: Note[];
	samples: ReadonlyMap<number, SongSample>;
	baseHzOf: (sample: number) => number;
	separation: number;
	/** The tempo token due at a tick on this channel: the first channel's changes, none on the others. */
	tempoAt: (tick: number) => string | null;
	rowStarts: readonly number[];
	folded: Map<number, number>;
	/** Notes whose arpeggio is not played: one tracker tick long, or stepping past what the sample plays. */
	unplayedArpeggios: { count: number };
}

/** One cut of a channel's text. */
interface Cut {
	body: string;
	/** The state it was written under: two cuts alike in this and the body play alike. */
	key: string;
	/** The cut opens on a tie, which a loop's body cannot. */
	opensOnTie: boolean;
	/** The cut states its next note's settings ahead of everything, as the song's start and its loop point do. */
	restates: boolean;
}

/** Writes one channel's text, one cut at a time, keeping the driver state each cut leaves behind. */
class ChannelWriter {
	private state: ChannelState = { ...FORGOTTEN };
	private octave: number | null = null;
	private tokens: { tick: number; text: string }[] = [];
	private next = 0;
	private tempoWritten = -1;
	/** Each note's key at its key-on, from o1 c, folded by octaves into what the instrument plays. */
	private readonly keys = new Map<Note, number>();
	/** The notes that play an arpeggio, under legato from their key-on to a tracker tick before their end. */
	private readonly arpeggios = new Set<Note>();
	/** Each note's tremolo: the first a row of it runs, from the key-on, since `$E5` is safe nowhere later. */
	private readonly tremolos = new Map<Note, { command: number; swing: number }>();
	/** Whether any note has a tremolo, so a channel without one never writes `$FD`. */
	private readonly usesTremolo: boolean;
	/** The channel's `$EE`, in 256ths of a semitone. */
	readonly fineTune: number;

	constructor(private readonly ctx: Context) {
		for (const note of ctx.notes) {
			const sample = ctx.samples.get(note.sample);
			if (!sample) {
				continue;
			}

			const written = sample.tuning.baseKey + Math.round(this.ctx.ticks.pitch[note.start]);
			let key = written;
			while (key < 0) {
				key += 12;
			}

			while (key - 12 >= 0 && (key > HIGHEST_KEY || !playsTrue(sample.tuning, key))) {
				key -= 12;
			}

			if (key !== written) {
				ctx.folded.set(note.sample, (ctx.folded.get(note.sample) ?? 0) + 1);
			}

			this.keys.set(note, key);
			const tuning = sample.tuning;
			let reach = -1;
			for (let t = note.start; t < note.end; t++) {
				const param = ctx.ticks.arpeggio[t];
				if (param !== 0) {
					reach = Math.max(reach, param >> 4, param & 0x0f);
				}
			}

			if (reach >= 0) {
				const fits = key + reach <= HIGHEST_KEY && playsTrue(tuning, key + reach);
				if (note.end - note.start >= 2 && fits) {
					this.arpeggios.add(note);
				} else {
					ctx.unplayedArpeggios.count++;
				}
			}

			for (let t = note.start; t < note.end; t++) {
				if (ctx.ticks.tremoloRate[t] !== 0 || ctx.ticks.tremoloDepth[t] !== 0) {
					const tremolo = tremoloOf(ctx.ticks.tremoloRate[t], ctx.ticks.tremoloDepth[t], ctx.ticks.volume[note.start]);
					if (tremolo) {
						this.tremolos.set(note, tremolo);
					}

					break;
				}
			}
		}

		this.usesTremolo = this.tremolos.size > 0;
		this.fineTune = this.bestFineTune();
	}

	/**
	 * The `$EE` that brings the channel's notes nearest their pitch on the whole. `SetPitch` keeps fewer
	 * bits of a low key and a small multiplier is coarse, so the tuning leaves each note a few cents
	 * out; `$EE` puts 256ths of a semitone under every note (`main.asm:434-435`), and only upward.
	 */
	private bestFineTune(): number {
		const notes = [...this.keys].flatMap(([note, key]) => {
			const sample = this.ctx.samples.get(note.sample);
			if (!sample) {
				return [];
			}

			const wanted =
				baseRegister(sample.factor, this.ctx.baseHzOf(note.sample)) * 2 ** ((key - sample.tuning.baseKey) / 12);
			return [{ key, tuning: sample.tuning, wanted }];
		});
		let best = 0;
		let bestError = Infinity;
		for (let fine = 0; fine < FINE_TUNE_REACH; fine++) {
			let error = 0;
			for (const n of notes) {
				const register = setPitchWide(n.key * SEMITONE + fine, n.tuning.multiplier, n.tuning.sub);
				error += Math.abs(Math.log2(register / n.wanted));
			}

			if (error < bestError) {
				best = fine;
				bestError = error;
			}
		}

		return best;
	}

	/** Forgets what the channel plays under, as at the loop point: the repeat restates it. */
	forget(): void {
		this.state = { ...FORGOTTEN };
	}

	private push(tick: number, text: string): void {
		this.tokens.push({ tick, text });
	}

	/** The key a note sounds at on tick `t`, fractional through a slide. */
	private pitchAt(note: Note, t: number): number {
		const key = this.keys.get(note) ?? 0;
		const pitch = this.ctx.ticks.pitch;
		return key + pitch[t] - Math.round(pitch[note.start]);
	}

	/** `v` for a note on tick `t`: raised by the tremolo's swing, which `$E5` takes back down. */
	private volumeIn(note: Note, t: number): number {
		return volumeOf(Math.min(64, this.ctx.ticks.volume[t] + (this.tremolos.get(note)?.swing ?? 0)));
	}

	private noteSettings(at: number, note: Note, t: number): void {
		const sample = this.ctx.samples.get(note.sample);
		if (sample && this.state.instrument !== sample.instrument) {
			this.push(at, `@${sample.instrument}`);
			this.state.instrument = sample.instrument;
		}

		this.setVolume(at, this.volumeIn(note, t));
		this.setPan(at, panOf(this.ctx.ticks.pan[t], this.ctx.separation));
		this.setVibrato(at, vibratoOf(this.ctx.ticks.vibratoRate[t], this.ctx.ticks.vibratoDepth[t]));
		this.setTremolo(at, this.tremolos.get(note)?.command ?? 0);
		if (this.fineTune > 0 && this.state.fineTune !== this.fineTune) {
			this.push(at, `$EE $${hex2(this.fineTune)}`);
			this.state.fineTune = this.fineTune;
		}

		if (!this.state.q) {
			this.push(at, Q);
			this.state.q = true;
		}
	}

	/** `$E5`, or `$FD` for none; written only in front of a key-on or a rest, where its read-ahead is safe. */
	private setTremolo(at: number, tremolo: number): void {
		if (!this.usesTremolo || this.state.tremolo === tremolo) {
			return;
		}

		this.push(at, tremolo === 0 ? "$FD" : `$E5 $00 $${hex2(tremolo >> 8)} $${hex2(tremolo & 0xff)}`);
		this.state.tremolo = tremolo;
	}

	private setArpeggio(at: number, arpeggio: number): void {
		if (this.state.arpeggio === arpeggio) {
			return;
		}

		this.push(
			at,
			arpeggio === 0
				? "$FB $00 $00"
				: arpeggio === HOLD
					? `$FB $01 $${hex2(DRIVER_TICKS)} $00`
					: arpeggioText(arpeggio),
		);
		this.state.arpeggio = arpeggio;
	}

	private setVolume(at: number, volume: number): void {
		if (this.state.volume !== volume) {
			this.push(at, `v${volume}`);
			this.state.volume = volume;
		}
	}

	private setPan(at: number, pan: number): void {
		if (this.state.pan !== pan) {
			this.push(at, `y${pan}`);
			this.state.pan = pan;
		}
	}

	private setVibrato(at: number, vibrato: number): void {
		if (this.state.vibrato !== vibrato) {
			this.push(at, vibrato === 0 ? "$DF" : `$DE $00 $${hex2(vibrato >> 8)} $${hex2(vibrato & 0xff)}`);
			this.state.vibrato = vibrato;
		}
	}

	private setOctave(at: number, octave: number): void {
		if (this.octave === octave) {
			return;
		}

		if (this.octave !== null && Math.abs(this.octave - octave) === 1) {
			this.push(at, octave > this.octave ? ">" : "<");
		} else {
			this.push(at, `o${octave}`);
		}

		this.octave = octave;
	}

	/** The tempo due at `at`, written once however many stops meet there. */
	private tempo(at: number): void {
		const token = this.ctx.tempoAt(at);
		if (token && at !== this.tempoWritten) {
			this.push(at, token);
			this.tempoWritten = at;
		}
	}

	/**
	 * Writes the cut `[from, to)`, in tracker ticks. The octave is stated afresh in every cut, so a cut's
	 * text depends on nothing before it but the driver state it starts under.
	 */
	cut(from: number, to: number, opening: readonly string[], restates: boolean): Cut {
		this.tokens = [];
		this.octave = null;
		const key = JSON.stringify(this.state);
		for (const token of opening) {
			this.push(from, token);
		}

		if (restates) {
			const note = this.ctx.notes.find((n) => n.end > from);
			if (note) {
				this.noteSettings(from, note, Math.max(from, note.start));
			}
		}

		this.tempo(from);
		while (this.next < this.ctx.notes.length && this.ctx.notes[this.next].end <= from) {
			this.next++;
		}

		let cursor = from;
		let opensOnTie = false;
		for (let i = this.next; i < this.ctx.notes.length && this.ctx.notes[i].start < to; i++) {
			const note = this.ctx.notes[i];
			const s = Math.max(from, note.start);
			const e = Math.min(to, note.end);
			if (s > cursor) {
				this.rest(cursor, s);
			}

			if (note.start < from && s === from) {
				opensOnTie = true;
			}

			this.notePart(note, s, e);
			cursor = e;
		}

		if (cursor < to) {
			this.rest(cursor, to);
		}

		return { body: this.lines(from, to), key, opensOnTie, restates };
	}

	/** A rest from `from` to `to`, split where a tempo changes inside it. */
	private rest(from: number, to: number): void {
		let at = from;
		for (let t = from + 1; t <= to; t++) {
			if (t === to || this.ctx.tempoAt(t)) {
				this.push(at, `r${spellRestTicks((t - at) * DRIVER_TICKS)}`);
				if (t < to) {
					this.tempo(t);
				}

				at = t;
			}
		}
	}

	/** A note's stretch `[s, e)` inside the cut, struck at its start or tied in, with what changes under it. */
	private notePart(note: Note, s: number, e: number): void {
		const ticks = this.ctx.ticks;
		const struck = s === note.start;
		const arpeggio = this.arpeggios.has(note);
		if (struck) {
			this.noteSettings(s, note, s);
			if (arpeggio) {
				// Toggling legato on lets this key-on through and holds back every one after it, so the
				// arpeggio's steps move the pitch and leave the sample playing.
				this.push(s, "$F4 $01");
				this.state.legato = true;
				this.setArpeggio(s, ticks.arpeggio[s]);
			}
		}

		// The pitch simplified to ramps: each a `$DD` after the piece it starts in. An arpeggio sets the
		// pitch at every step, so a note playing one slides nowhere.
		const pitch = [];
		for (let t = s; t < e; t++) {
			pitch.push({ tick: t, value: this.pitchAt(note, t) });
		}

		pitch.push({ tick: e, value: pitch[pitch.length - 1].value });
		const slides = new Map<number, { duration: number; target: number }>();
		const ramps = simplify(pitch, PITCH_TOLERANCE);
		let was = Math.round(ramps[0].value);
		for (let i = 0; i + 1 < ramps.length; i++) {
			const target = Math.round(ramps[i + 1].value);
			if (!arpeggio && target !== was && target >= 0 && target <= HIGHEST_KEY) {
				slides.set(ramps[i].tick, { duration: (ramps[i + 1].tick - ramps[i].tick) * DRIVER_TICKS, target });
				was = target;
			}
		}

		// The volume simplified to steps and fades, each written at the tick it starts on.
		const volume = [];
		for (let t = s; t < e; t++) {
			volume.push({ tick: t, value: this.volumeIn(note, t) });
		}

		const levels = simplify(volume, VOLUME_TOLERANCE);
		const fades = new Map<number, { text: string; volume: number }[]>();
		const fade = (tick: number, text: string, value: number): void => {
			fades.set(tick, [...(fades.get(tick) ?? []), { text, volume: value }]);
		};
		for (let i = 0; i + 1 < levels.length; i++) {
			const a = levels[i];
			const b = levels[i + 1];
			if (a.value === b.value) {
				continue;
			}

			if (b.tick - a.tick <= 1) {
				fade(b.tick, `v${b.value}`, b.value);
			} else {
				fade(a.tick, `v${Math.min(255, (b.tick - a.tick) * DRIVER_TICKS)},${b.value}`, b.value);
			}
		}

		const stops = new Set<number>([...slides.keys(), ...fades.keys()]);
		for (let t = s + 1; t < e; t++) {
			const vibratoMoves =
				ticks.vibratoRate[t] !== ticks.vibratoRate[t - 1] || ticks.vibratoDepth[t] !== ticks.vibratoDepth[t - 1];
			if (ticks.pan[t] !== ticks.pan[t - 1] || vibratoMoves || this.ctx.tempoAt(t)) {
				stops.add(t);
			}

			if (arpeggio && ticks.arpeggio[t] !== ticks.arpeggio[t - 1]) {
				stops.add(t);
			}
		}

		// A tracker tick before the end the arpeggio and legato stop, so the note keys off as any does.
		if (arpeggio) {
			stops.add(note.end - 1);
		}

		const key = this.keys.get(note) ?? 0;
		const written = NOTE_MIN + key;
		const octave = octaveFor(written) ?? 4;
		const points = [...stops].filter((t) => t > s && t < e).sort((a, b) => a - b);
		let at = s;
		for (const until of [...points, e]) {
			this.tempo(at);
			if (at > s || !struck) {
				this.setPan(at, panOf(ticks.pan[at], this.ctx.separation));
				this.setVibrato(at, vibratoOf(ticks.vibratoRate[at], ticks.vibratoDepth[at]));
				if (arpeggio && at === note.end - 1) {
					this.setArpeggio(at, 0);
					this.push(at, "$F4 $01");
					this.state.legato = false;
				} else if (arpeggio) {
					// Where the module's arpeggio stops, the note is held as an arpeggio of itself, which brings
					// the pitch back from the step it was on.
					const param = ticks.arpeggio[at];
					this.setArpeggio(at, param !== 0 ? param : this.state.arpeggio !== 0 ? HOLD : 0);
				}
			}

			for (const step of fades.get(at) ?? []) {
				this.push(at, step.text);
				this.state.volume = step.volume;
			}

			if (at === s && struck) {
				this.setOctave(s, octave);
			}

			const head = at === s && struck ? (spellNote(written, octave) ?? "c") : "^";
			const length = (until - at) * DRIVER_TICKS;
			const slide = slides.get(at);
			// A piece a `$DD` follows is one frame long enough to hold the slide and two ticks more.
			if (slide && length >= 3) {
				const piece = Math.min(ONE_FRAME, length);
				this.push(at, `${head}${spellTicks(piece)}`);
				const duration = Math.max(1, Math.min(slide.duration, piece - 2, 255));
				this.push(at, `$DD $00 $${hex2(duration)} $${hex2(NOTE_MIN + slide.target)}`);
				if (piece < length) {
					this.push(at, `^${spellTicks(length - piece)}`);
				}
			} else {
				this.push(at, `${head}${spellTicks(length)}`);
			}

			at = until;
		}
	}

	/** The cut's tokens, a line to every sixteen of its rows. */
	private lines(from: number, to: number): string {
		const breaks = this.ctx.rowStarts
			.filter((t) => t >= from && t < to)
			.filter((_, i) => i > 0 && i % ROWS_A_LINE === 0);
		const lines: string[][] = [[]];
		let b = 0;
		for (const token of this.tokens) {
			while (b < breaks.length && token.tick >= breaks[b]) {
				b++;
				if (lines[lines.length - 1].length > 0) {
					lines.push([]);
				}
			}

			lines[lines.length - 1].push(token.text);
		}

		return lines
			.filter((line) => line.length > 0)
			.map((line) => line.join(" "))
			.join("\n");
	}
}

/** Writes the kept channels as a song. */
export function writeTrackerSong(
	song: TrackerSong,
	play: TrackerPlay,
	options: TrackerSongOptions,
): WrittenTrackerSong {
	const warnings: TrackerImportWarning[] = [];
	if (play.ignored.offsets > 0) {
		warnings.push({ code: "offsets", count: play.ignored.offsets });
	}

	if (play.ignored.unsupported > 0) {
		warnings.push({ code: "unsupported", count: play.ignored.unsupported });
	}

	if (song.truncated) {
		warnings.push({ code: "mod-truncated" });
	}

	if (play.tooLong) {
		warnings.push({ code: "too-long" });
	}

	const keep = options.keep.filter((c) => c >= 0 && c < song.channels).slice(0, TRACKER_CHANNEL_LIMIT);
	const end = play.ticks;
	const loopAt = options.loop === "jump" && play.loopTick > 0 && play.loopTick < end ? play.loopTick : null;
	const factorOf = (index: number): number | "drop" => options.factors.get(index) ?? 1;
	const playable = (index: number): boolean =>
		factorOf(index) !== "drop" && (song.samples[index - 1]?.pcm.length ?? 0) > 0;

	// The notes each kept channel plays, and the range each sample is played over, for its tuning.
	const dropped = new Map<number, number>();
	const channelNotes = keep.map((c) => {
		const ticks = play.channels[c];
		for (let t = 0; t < end; t++) {
			if (ticks.keyOn[t] && !playable(ticks.sample[t]) && ticks.sample[t] > 0) {
				dropped.set(ticks.sample[t], (dropped.get(ticks.sample[t]) ?? 0) + 1);
			}
		}

		return notesOf(ticks, end, loopAt, playable);
	});

	for (const [sample, count] of dropped) {
		warnings.push({ code: "dropped-notes", sample, count });
	}

	const ranges = new Map<number, { low: number; high: number }>();
	keep.forEach((c, i) => {
		const ticks = play.channels[c];
		for (const note of channelNotes[i]) {
			const range = ranges.get(note.sample) ?? { low: Infinity, high: -Infinity };
			for (let t = note.start; t < note.end; t++) {
				const semis = Math.round(ticks.pitch[t]);
				range.low = Math.min(range.low, semis);
				range.high = Math.max(range.high, semis);
			}

			ranges.set(note.sample, range);
		}
	});

	const used = [...ranges.keys()].sort((a, b) => a - b);
	const samples = new Map<number, SongSample>();
	used.forEach((index, i) => {
		const sample = song.samples[index - 1];
		const asked = factorOf(index);
		const factor = plannedFrames(sample, asked === "drop" ? 1 : asked).factor;
		const range = ranges.get(index) ?? { low: 0, high: 0 };
		samples.set(index, {
			index,
			name: options.sampleName(index),
			factor,
			instrument: FIRST_CUSTOM + i,
			tuning: tuningFor(factor, sample.baseHz, range.low, range.high),
		});
	});

	const tempos = play.tempos.map((t) => ({ tick: t.tick, ...tempoForBpm(t.bpm) }));
	for (const t of tempos) {
		if (t.clamped) {
			warnings.push({ code: "mod-tempo-clamped", bpm: t.bpm, tempo: t.tempo });
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

	const changes = new Map(tempos.slice(1).map((t) => [t.tick, `t${t.tempo}`]));
	const cuts = play.segments.map((segment, i) => ({
		from: segment.tick,
		to: play.segments[i + 1]?.tick ?? end,
	}));
	const folded = new Map<number, number>();
	const unplayedArpeggios = { count: 0 };
	const master = Math.round(255 * Math.sqrt(Math.min(1, 4 / Math.max(1, keep.length))));

	// Each channel's cuts, written in order, then each cut that comes round again in the same state
	// made a label loop.
	const written = keep.map((c, i) => {
		const writer = new ChannelWriter({
			ticks: play.channels[c],
			notes: channelNotes[i],
			samples,
			baseHzOf: (sample) => song.samples[sample - 1]?.baseHz ?? 0,
			separation: options.separation,
			tempoAt: (tick) => (i === 0 ? (changes.get(tick) ?? null) : null),
			rowStarts: play.rowStarts,
			folded,
			unplayedArpeggios,
		});
		return cuts.map((cut, n) => {
			const opening = n === 0 && i === 0 ? ["w" + String(master), `t${tempos[0].tempo}`] : [];
			const looping = loopAt !== null && cut.from === loopAt;
			if (looping) {
				writer.forget();
			}

			const prefix = looping ? (i === 0 ? ["/", `t${tempoAt(loopAt)}`] : ["/"]) : [];
			return { ...writer.cut(cut.from, cut.to, [...opening], n === 0 || looping), prefix };
		});
	});

	for (const [sample, count] of folded) {
		warnings.push({ code: "mod-folded", sample, count });
	}

	if (unplayedArpeggios.count > 0) {
		warnings.push({ code: "arpeggio", count: unplayedArpeggios.count });
	}

	const counts = new Map<string, number>();
	const loopable = (cutsOf: (typeof written)[number], n: number): boolean =>
		!cutsOf[n].opensOnTie &&
		!(cutsOf[n + 1]?.opensOnTie ?? false) &&
		cutsOf[n].prefix.length === 0 &&
		!cutsOf[n].restates &&
		cutsOf[n].body.length > 0;
	for (const cutsOf of written) {
		cutsOf.forEach((cut, n) => {
			if (loopable(cutsOf, n)) {
				const id = `${cut.key}\n${cut.body}`;
				counts.set(id, (counts.get(id) ?? 0) + 1);
			}
		});
	}

	const labels = new Map<string, number>();
	const body = written.map((cutsOf, i) => {
		const parts: string[] = [];
		// The label being played, its body when this is where it is defined, and how many times in a row.
		let lastCall: { label: number; body: string | null; count: number } | null = null;
		const flush = (): void => {
			if (lastCall) {
				const head = lastCall.body === null ? `(${lastCall.label})` : `(${lastCall.label})[${lastCall.body}]`;
				parts.push(lastCall.count > 1 ? `${head}${lastCall.count}` : head);
				lastCall = null;
			}
		};

		cutsOf.forEach((cut, n) => {
			const id = `${cut.key}\n${cut.body}`;
			if (cut.prefix.length > 0) {
				flush();
				parts.push(cut.prefix.join(" "));
			}

			if (!loopable(cutsOf, n) || (counts.get(id) ?? 0) < 2) {
				flush();
				parts.push(cut.body);
				return;
			}

			const label = labels.get(id);
			if (label === undefined) {
				flush();
				const fresh = labels.size + 1;
				labels.set(id, fresh);
				lastCall = { label: fresh, body: cut.body, count: 1 };
				return;
			}

			if (lastCall?.label === label) {
				lastCall.count++;
			} else {
				flush();
				lastCall = { label, body: null, count: 1 };
			}
		});
		flush();
		return `#${i} ; ${song.format} channel ${keep[i] + 1}\n${parts.filter((p) => p.length > 0).join("\n")}`;
	});

	const sampleList = [...samples.values()];
	const header = [
		"#amk 4",
		"",
		"#samples",
		"{",
		options.optimized ? "\t#optimized" : "\t#default",
		...sampleList.map((s) => `\t"${s.name}"`),
		"}",
		"",
		"#instruments",
		"{",
		...sampleList.map(
			(s) =>
				`\t"${s.name}" $FF $E0 $7F $${hex2(s.tuning.multiplier)} $${hex2(s.tuning.sub)} ; @${s.instrument}, sample ${s.index}`,
		),
		"}",
	];
	const title = tagText(song.title) ?? tagText(options.fallbackTitle);
	const spc = [
		"#spc",
		"{",
		...(title ? [`\t#title "${title}"`] : []),
		`\t#comment "Imported from ${song.format}"`,
		"}",
	];
	const text = [...header, "", ...spc, "", body.join("\n\n"), ""].join("\n");
	return { text, samples: sampleList, warnings };
}
