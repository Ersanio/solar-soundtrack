/**
 * What a MIDI file plays: each channel's notes and controller curves, the tempo and metre maps,
 * the loop markers and the song's names, with every track merged onto one time line.
 *
 * Times stay in the file's own ticks. A channel's state is the GM one: program and bank select,
 * volume (CC7) and expression (CC11), pan (CC10), modulation (CC1), reverb send (CC91), sustain
 * (CC64), RPN 0 pitch-bend range and RPN 2 coarse tuning through CC101/100/6/38, pitch bend,
 * reset all controllers (CC121) and all notes off (CC120/123). Channel 10 is the drum kit unless a
 * GS sysex says otherwise; a GS rhythm-part sysex or XG's drum bank (MSB 127) makes any other
 * channel one too.
 */

import { type Division, type Smf, SmfError, type SmfEvent } from "./smf";

/** A note, from its key-on to its key-off (or the pedal's release), in file ticks. */
export interface MidiNote {
	start: number;
	end: number;
	key: number;
	velocity: number;
	/** The program in force at the key-on. */
	program: number;
	/** The track holding the key-on, which names the part. */
	track: number;
}

/** A controller's value from `tick` until the next point. */
export interface Point {
	tick: number;
	value: number;
}

export interface ChannelPerformance {
	/** 0-15; channel 10 is 9. */
	channel: number;
	drums: boolean;
	notes: MidiNote[];
	/** CC7, 0-127. Starts at GM's default of 100. */
	volume: Point[];
	/** CC11, 0-127. Starts at 127. */
	expression: Point[];
	/** CC10, 0 left to 127 right. Starts at 64. */
	pan: Point[];
	/** CC1, 0-127. Starts at 0. */
	modulation: Point[];
	/** CC91, 0-127. Starts at 0: only a file that asks for reverb gets echo. */
	reverb: Point[];
	/** The pitch bend in semitones, already scaled by the bend range in force. Starts at 0. */
	bend: Point[];
	/** A track or instrument name for the channel, when the file gives one. */
	name: string | null;
}

export interface TempoChange {
	tick: number;
	/** Microseconds per quarter note, as meta event `51` states it. */
	microsPerQuarter: number;
}

export interface MeterChange {
	tick: number;
	numerator: number;
	/** The note value of a beat: 4 for a quarter. */
	denominator: number;
}

export interface Performance {
	division: Division;
	format: 0 | 1;
	tracks: number;
	truncated: readonly number[];
	/** Only the channels that play a note, in channel order. */
	channels: ChannelPerformance[];
	/** Always starts at tick 0. */
	tempos: TempoChange[];
	/** Always starts at tick 0. */
	meters: MeterChange[];
	/** A loop the file marks: CC111, or a `loopStart`/`loopEnd` marker. `end` is `null` when only the start is marked. */
	loop: { start: number; end: number | null } | null;
	title: string | null;
	author: string | null;
	/** The last key-off. */
	endTick: number;
}

const GM_DRUM_CHANNEL = 9;
const DEFAULT_TEMPO = 500_000;
const DEFAULT_BEND_RANGE = 2;
const NO_RPN = 0x7f;

/** Printable ASCII from a meta event's text, trimmed; `null` when nothing is left. */
function text(data: Uint8Array): string | null {
	let out = "";
	for (const byte of data) {
		out += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : " ";
	}

	const trimmed = out.replace(/\s+/g, " ").trim();
	return trimmed === "" ? null : trimmed;
}

/** The MIDI channel a GS part address (`40 1x`) is about: part 10 is `x = 0`, parts 1-9 then 11-16 follow. */
function gsPartChannel(nybble: number): number {
	if (nybble === 0) {
		return 9;
	}

	return nybble <= 9 ? nybble - 1 : nybble;
}

interface Open {
	note: MidiNote;
	/** Released while the pedal was down. */
	held: boolean;
}

class ChannelState {
	readonly perf: ChannelPerformance;
	program = 0;
	bankMsb = 0;
	sustain = false;
	rpnMsb = NO_RPN;
	rpnLsb = NO_RPN;
	bendRange = DEFAULT_BEND_RANGE;
	bendRaw = 0x2000;
	coarseTune = 0;
	/** Per key, the notes still sounding in the order they started. */
	readonly open = new Map<number, Open[]>();
	/** Notes per track, to name the channel after the track that holds most of it. */
	readonly perTrack = new Map<number, number>();
	gsDrums: boolean | null = null;
	xgDrums = false;

	constructor(channel: number) {
		this.perf = {
			channel,
			drums: false,
			notes: [],
			volume: [{ tick: 0, value: 100 }],
			expression: [{ tick: 0, value: 127 }],
			pan: [{ tick: 0, value: 64 }],
			modulation: [{ tick: 0, value: 0 }],
			reverb: [{ tick: 0, value: 0 }],
			bend: [{ tick: 0, value: 0 }],
			name: null,
		};
	}

	get drums(): boolean {
		return this.gsDrums ?? (this.perf.channel === GM_DRUM_CHANNEL || this.xgDrums);
	}

	set(curve: Point[], tick: number, value: number): void {
		const last = curve[curve.length - 1];
		if (last.tick === tick) {
			last.value = value;
		} else if (last.value !== value) {
			curve.push({ tick, value });
		}
	}

	bendSemitones(): number {
		return ((this.bendRaw - 0x2000) / 0x2000) * this.bendRange;
	}

	finish(open: Open, tick: number): void {
		open.note.end = Math.max(tick, open.note.start);
	}

	keyOff(key: number, tick: number): void {
		const sounding = this.open.get(key);
		const first = sounding?.find((entry) => !entry.held);
		if (!sounding || !first) {
			return;
		}

		if (this.sustain) {
			first.held = true;
			return;
		}

		this.finish(first, tick);
		sounding.splice(sounding.indexOf(first), 1);
	}

	keyOn(key: number, velocity: number, tick: number, track: number): void {
		const sounding = this.open.get(key) ?? [];
		// A key struck again while it still sounds ends the note before it.
		for (const entry of sounding) {
			this.finish(entry, tick);
		}

		const note: MidiNote = {
			start: tick,
			end: tick,
			key: this.drums ? key : key + this.coarseTune,
			velocity,
			program: this.program,
			track,
		};
		this.perf.notes.push(note);
		this.perTrack.set(track, (this.perTrack.get(track) ?? 0) + 1);
		this.open.set(key, [{ note, held: false }]);
	}

	releasePedal(tick: number): void {
		for (const [key, sounding] of this.open) {
			const kept = sounding.filter((entry) => {
				if (entry.held) {
					this.finish(entry, tick);
				}

				return !entry.held;
			});
			this.open.set(key, kept);
		}
	}

	allOff(tick: number): void {
		for (const sounding of this.open.values()) {
			for (const entry of sounding) {
				this.finish(entry, tick);
			}
		}

		this.open.clear();
	}
}

/** Every track's events on one time line, a track's own order kept within a tick. */
function merged(smf: Smf): { event: SmfEvent; track: number }[] {
	const all: { event: SmfEvent; track: number; order: number }[] = [];
	smf.tracks.forEach((events, track) => {
		events.forEach((event, order) => all.push({ event, track, order }));
	});

	all.sort((a, b) => a.event.tick - b.event.tick || a.track - b.track || a.order - b.order);
	return all;
}

function loopMarker(label: string): "start" | "end" | null {
	const word = label.toLowerCase().replace(/[\s_-]/g, "");
	if (word === "loopstart" || word === "[") {
		return "start";
	}

	if (word === "loopend" || word === "]") {
		return "end";
	}

	return null;
}

/** Plays the file's events through each channel's GM state, and gathers what the song sounds like. */
export function perform(smf: Smf): Performance {
	const channels = Array.from({ length: 16 }, (_, channel) => new ChannelState(channel));
	const tempos: TempoChange[] = [];
	const meters: MeterChange[] = [];
	const trackNames = new Map<number, string>();
	const channelNames = new Map<number, string>();
	const prefix = new Map<number, number>();
	let author: string | null = null;
	let loopStart: number | null = null;
	let loopEnd: number | null = null;
	let lastTick = 0;

	for (const { event, track } of merged(smf)) {
		lastTick = Math.max(lastTick, event.tick);
		if (event.type === "meta") {
			switch (event.meta) {
				case 0x02:
					author ??= text(event.data);
					break;
				case 0x03:
				case 0x04: {
					const name = text(event.data);
					const channel = prefix.get(track);
					if (name !== null && channel !== undefined) {
						channelNames.set(channel, name);
					} else if (name !== null && event.meta === 0x03 && !trackNames.has(track)) {
						trackNames.set(track, name);
					}
					break;
				}
				case 0x06:
				case 0x07: {
					const label = text(event.data);
					const kind = label === null ? null : loopMarker(label);
					if (kind === "start" && loopStart === null) {
						loopStart = event.tick;
					} else if (kind === "end" && loopEnd === null) {
						loopEnd = event.tick;
					}
					break;
				}
				case 0x20:
					if (event.data.length >= 1) {
						prefix.set(track, event.data[0] & 0x0f);
					}
					break;
				case 0x51:
					if (event.data.length >= 3) {
						const micros = (event.data[0] << 16) | (event.data[1] << 8) | event.data[2];
						if (micros > 0) {
							tempos.push({ tick: event.tick, microsPerQuarter: micros });
						}
					}
					break;
				case 0x58:
					if (event.data.length >= 2 && event.data[0] > 0 && event.data[1] < 8) {
						meters.push({ tick: event.tick, numerator: event.data[0], denominator: 1 << event.data[1] });
					}
					break;
			}

			continue;
		}

		if (event.type === "sysex") {
			const d = event.data;
			// GS "use for rhythm part": F0 41 dev 42 12 40 1x 15 vv sum F7.
			if (d.length >= 8 && d[0] === 0x41 && d[2] === 0x42 && d[3] === 0x12 && d[4] === 0x40) {
				if ((d[5] & 0xf0) === 0x10 && d[6] === 0x15) {
					channels[gsPartChannel(d[5] & 0x0f)].gsDrums = d[7] !== 0;
				}
			}

			continue;
		}

		const state = channels[event.channel];
		const { tick } = event;
		switch (event.status) {
			case 0x80:
				state.keyOff(event.data1, tick);
				break;
			case 0x90:
				if (event.data2 === 0) {
					state.keyOff(event.data1, tick);
				} else {
					state.keyOn(event.data1, event.data2, tick, track);
				}
				break;
			case 0xb0:
				control(state, event.data1, event.data2, tick);
				if (event.data1 === 111 && loopStart === null) {
					loopStart = tick;
				}
				break;
			case 0xc0:
				state.program = event.data1;
				if (state.bankMsb === 127) {
					state.xgDrums = true;
				}
				break;
			case 0xe0:
				state.bendRaw = (event.data2 << 7) | event.data1;
				state.set(state.perf.bend, tick, state.bendSemitones());
				break;
		}
	}

	for (const state of channels) {
		state.allOff(lastTick);
	}

	if (tempos.length === 0 || tempos[0].tick > 0) {
		tempos.unshift({ tick: 0, microsPerQuarter: DEFAULT_TEMPO });
	}

	if (meters.length === 0 || meters[0].tick > 0) {
		meters.unshift({ tick: 0, numerator: 4, denominator: 4 });
	}

	const playing = channels.filter((state) => state.perf.notes.length > 0);
	if (playing.length === 0) {
		throw new SmfError("no-notes");
	}

	// The first track's name is the song's: format 1's conductor track, or format 0's only one.
	const title = trackNames.get(0) ?? null;
	for (const state of playing) {
		state.perf.drums = state.drums;
		const busiest = [...state.perTrack].sort((a, b) => b[1] - a[1])[0]?.[0];
		state.perf.name =
			channelNames.get(state.perf.channel) ??
			(busiest !== undefined && busiest !== 0 ? (trackNames.get(busiest) ?? null) : null);
		state.perf.notes.sort((a, b) => a.start - b.start || b.key - a.key);
	}

	const endTick = playing.reduce((end, state) => state.perf.notes.reduce((e, note) => Math.max(e, note.end), end), 0);
	const start = loopStart;
	const loop =
		start !== null && start < endTick ? { start, end: loopEnd !== null && loopEnd > start ? loopEnd : null } : null;

	return {
		division: smf.division,
		format: smf.format,
		tracks: smf.tracks.length,
		truncated: smf.truncated,
		channels: playing.map((state) => state.perf),
		tempos: dedupe(tempos),
		meters: dedupe(meters),
		loop,
		title,
		author,
		endTick,
	};
}

/** The last of several changes on one tick is the one in force. */
function dedupe<T extends { tick: number }>(changes: T[]): T[] {
	const out: T[] = [];
	for (const change of changes) {
		if (out.length > 0 && out[out.length - 1].tick === change.tick) {
			out[out.length - 1] = change;
		} else {
			out.push(change);
		}
	}

	return out;
}

function control(state: ChannelState, controller: number, value: number, tick: number): void {
	const perf = state.perf;
	switch (controller) {
		case 0:
			state.bankMsb = value;
			break;
		case 1:
			state.set(perf.modulation, tick, value);
			break;
		case 6:
			if (state.rpnMsb === 0 && state.rpnLsb === 0) {
				state.bendRange = value + (state.bendRange % 1);
			} else if (state.rpnMsb === 0 && state.rpnLsb === 2) {
				state.coarseTune = value - 64;
			}
			break;
		case 7:
			state.set(perf.volume, tick, value);
			break;
		case 10:
			state.set(perf.pan, tick, value);
			break;
		case 11:
			state.set(perf.expression, tick, value);
			break;
		case 38:
			if (state.rpnMsb === 0 && state.rpnLsb === 0) {
				state.bendRange = Math.floor(state.bendRange) + value / 100;
			}
			break;
		case 64:
			state.sustain = value >= 64;
			if (!state.sustain) {
				state.releasePedal(tick);
			}
			break;
		case 91:
			state.set(perf.reverb, tick, value);
			break;
		case 98:
		case 99:
			state.rpnMsb = NO_RPN;
			state.rpnLsb = NO_RPN;
			break;
		case 100:
			state.rpnLsb = value;
			break;
		case 101:
			state.rpnMsb = value;
			break;
		case 120:
		case 123:
			state.allOff(tick);
			break;
		case 121:
			state.set(perf.expression, tick, 127);
			state.set(perf.modulation, tick, 0);
			state.bendRaw = 0x2000;
			state.set(perf.bend, tick, 0);
			state.sustain = false;
			state.releasePedal(tick);
			state.rpnMsb = NO_RPN;
			state.rpnLsb = NO_RPN;
			break;
	}
}

/**
 * The quarter note in file ticks. An SMPTE file counts real time, so its quarter is taken at 120 BPM,
 * the tempo the writer plays it at.
 */
export function quarterTicks(performance: Pick<Performance, "division">): number {
	const division = performance.division;
	return division.kind === "ppq" ? division.ppq : (division.fps * division.ticksPerFrame) / 2;
}

/** The value a curve holds at `tick`. */
export function valueAt(curve: readonly Point[], tick: number): number {
	let lo = 0;
	let hi = curve.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (curve[mid].tick <= tick) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}

	return curve[lo].value;
}
