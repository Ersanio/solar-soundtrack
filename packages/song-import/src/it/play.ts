/**
 * An IT played tick by tick, the way Impulse Tracker 2 plays it: what each channel sounds on every
 * tick, and where the song loops.
 *
 * The rules follow 8bitbubsy's `it2play` (`it_music.c`, `it_m_eff.c`): tick 0 reads the row's notes
 * and runs each command's init, the later ticks the commands that run on; D, K and L share one
 * memory, E, F and G another (G its own with the compatible-Gxx flag). Frequencies are Hz, a note
 * playing at `C5Speed × 2^((note - 60) / 12)`, and slide by 768ths of an octave with linear slides or
 * as an Amiga period would (`1712 × 8363 / Hz`) without. The note's volume, the channel volume, the
 * sample's and instrument's global volumes, the volume envelope, the fadeout and the global volume
 * are folded into what is recorded, as `UpdateSamples` and `UpdateInstruments` fold them, the pan
 * envelope and the separation into the pan, and the pitch envelope into the pitch. One voice plays
 * on a channel: a New Note Action that would keep the old note sounding is counted, as are
 * panbrello, the envelope switches and a note delay past its row.
 */

import { type ChannelTicks, type Ignored, type Segment, type TrackerPlay, channelTicks } from "../tracker/model";
import type { ItCell, ItEnvelope, ItFile, ItInstrument, ItSample } from "./file";

/** About an hour at 125 BPM: a song still running here is taken to never end. */
const TICK_LIMIT = 180_000;
const PERIOD_BASE = 1712 * 8363;
/** The volume column's G: the slide each value 1-9 gives (`SlideTable`). */
const SLIDE_TABLE = [1, 4, 8, 16, 32, 64, 96, 128, 255];
const SURROUND = 100;

const letter = (c: string): number => c.charCodeAt(0) - 64;
const [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y] = [
	..."ABCDEFGHIJKLMNOPQRSTUVWXY",
].map(letter);

/** The rate a note plays a sample at (`PitchTable`). */
export function itHz(c5Speed: number, note: number): number {
	return c5Speed * 2 ** ((note - 60) / 12);
}

interface EnvelopeState {
	tick: number;
	nextTick: number;
	node: number;
	/** In 65536ths. */
	value: number;
	delta: number;
	ended: boolean;
}

const freshEnvelope = (env: ItEnvelope | null): EnvelopeState => {
	const first = env?.points[0]?.[0] ?? 0;
	return { tick: first, nextTick: first, node: 0, value: (env?.points[0]?.[1] ?? 0) * 65536, delta: 0, ended: false };
};

/** One tick of an envelope (`UpdateEnvelope`): `true` once it has run past its last node. */
function stepEnvelope(state: EnvelopeState, env: ItEnvelope, released: boolean): boolean {
	if (state.ended) {
		return true;
	}

	if (state.tick < state.nextTick) {
		state.tick++;
		state.value += state.delta;
		return false;
	}

	const points = env.points;
	state.value = points[state.node][1] * 65536;
	const next = state.node + 1;
	let range = env.loop;
	if (env.sustain && !released) {
		range = env.sustain;
	}

	if (range && next > range.end) {
		state.node = range.start;
		state.tick = state.nextTick = points[state.node][0];
		return false;
	}

	if (next >= points.length) {
		state.ended = true;
		return true;
	}

	state.nextTick = points[next][0];
	state.tick = points[state.node][0] + 1;
	const span = state.nextTick - points[state.node][0] || 1;
	state.delta = Math.trunc(((points[next][1] - points[state.node][1]) * 65536) / span);
	state.node = next;
	return false;
}

interface Channel {
	/** The last instrument column, a sample number in sample mode. */
	instrument: number;
	sample: ItSample | null;
	inst: ItInstrument | null;
	sounding: boolean;
	left: number;
	frequency: number;
	portaFrequency: number;
	note: number;
	volume: number;
	channelVolume: number;
	sampleVolume: number;
	pan: number;
	channelPan: number;
	keyOff: boolean;
	fading: boolean;
	fadeout: number;
	volumeEnvelope: EnvelopeState;
	panEnvelope: EnvelopeState;
	pitchEnvelope: EnvelopeState;
	memory: Map<string, number>;
	vibratoSpeed: number;
	vibratoDepth: number;
	tremoloSpeed: number;
	tremoloDepth: number;
	tremorCount: number;
	tremorOn: boolean;
	retrigCount: number;
	cut: number;
	delay: number;
	delayed: ItCell | null;
	loopStartRow: number;
	loopCount: number;
	/** The volume column's per-tick work this row, or 0. */
	volumeCommand: number;
	volumeValue: number;
}

/** Plays the song once through from order `start`, to its end or to the first row it comes back to. */
export function playIt(it: ItFile, start = 0): TrackerPlay {
	const out: ChannelTicks[] = Array.from({ length: it.channels }, channelTicks);
	const channels: Channel[] = Array.from({ length: it.channels }, (_, i) => {
		const pan = it.channelPans[i] & 0x7f;
		return {
			instrument: 0,
			sample: null,
			inst: null,
			sounding: false,
			left: 0,
			frequency: 0,
			portaFrequency: 0,
			note: 60,
			volume: 0,
			channelVolume: it.channelVolumes[i],
			sampleVolume: 128,
			pan: pan > 64 && pan !== SURROUND ? 32 : pan,
			channelPan: pan > 64 && pan !== SURROUND ? 32 : pan,
			keyOff: false,
			fading: false,
			fadeout: 1024,
			volumeEnvelope: freshEnvelope(null),
			panEnvelope: freshEnvelope(null),
			pitchEnvelope: freshEnvelope(null),
			memory: new Map(),
			vibratoSpeed: 0,
			vibratoDepth: 0,
			tremoloSpeed: 0,
			tremoloDepth: 0,
			tremorCount: 0,
			tremorOn: false,
			retrigCount: 0,
			cut: 0,
			delay: 0,
			delayed: null,
			loopStartRow: 0,
			loopCount: 0,
			volumeCommand: 0,
			volumeValue: 0,
		};
	});
	const disabled = it.channelPans.map((p) => (p & 0x80) !== 0);
	const ignored: Ignored = { offsets: 0, unsupported: 0 };
	const tempos: { tick: number; bpm: number }[] = [{ tick: 0, bpm: it.tempo }];
	const segments: Segment[] = [];
	const rowStarts: number[] = [];
	const visited = new Map<string, number>();
	const sampleOf = (n: number): ItSample | null => it.samples[n - 1] ?? null;

	let speed = it.speed;
	let tempo = it.tempo;
	let globalVolume = it.globalVolume;
	let tick = 0;
	let order = start;
	let row = 0;
	let loopTick: number;
	let tooLong = false;
	let segmentOrder = -1;

	const remember = (ch: Channel, slot: string, value: number): number => {
		if (value !== 0) {
			ch.memory.set(slot, value);
		}

		return ch.memory.get(slot) ?? 0;
	};

	/** `PitchSlideUp` by `value` (negative is down), linear or Amiga. */
	const slide = (ch: Channel, value: number): void => {
		if (ch.frequency <= 0 || value === 0) {
			return;
		}

		if (it.linear) {
			ch.frequency *= 2 ** (value / 768);
		} else {
			const divisor = PERIOD_BASE - ch.frequency * value;
			ch.frequency = divisor <= 0 ? 0 : (PERIOD_BASE * ch.frequency) / divisor;
		}

		if (ch.frequency >= 0x7fffffff || ch.frequency <= 0) {
			ch.frequency = 0;
			ch.sounding = false;
		}
	};

	const towardPorta = (ch: Channel, amount: number): void => {
		if (ch.portaFrequency <= 0 || ch.frequency <= 0 || amount === 0) {
			return;
		}

		if (ch.frequency < ch.portaFrequency) {
			slide(ch, amount);
			if (ch.frequency >= ch.portaFrequency || ch.frequency === 0) {
				ch.frequency = ch.portaFrequency;
			}
		} else if (ch.frequency > ch.portaFrequency) {
			slide(ch, -amount);
			if (ch.frequency <= ch.portaFrequency) {
				ch.frequency = ch.portaFrequency;
			}
		}
	};

	const portaAmount = (ch: Channel): number =>
		(it.compatibleGxx ? (ch.memory.get("G") ?? 0) : (ch.memory.get("EFG") ?? 0)) << 2;

	/** The sample and note a note plays: the keymap's in instrument mode, the instrument column's sample in sample mode. */
	const lookup = (ch: Channel, note: number): { sample: ItSample | null; note: number; inst: ItInstrument | null } => {
		if (it.instrumentMode) {
			const inst = it.instruments[ch.instrument - 1] ?? null;
			const key = inst?.keymap[note];
			return { sample: key ? sampleOf(key.sample) : null, note: key?.note ?? note, inst };
		}

		return { sample: sampleOf(ch.instrument), note, inst: null };
	};

	/** The row's note, instrument and volume column on a channel. Returns whether a note was struck. */
	const readNote = (ch: Channel, cell: ItCell): boolean => {
		let struck = false;
		const porta = cell.command === G || cell.command === L || (cell.volume >= 193 && cell.volume <= 202);
		if (cell.instrument > 0) {
			ch.instrument = cell.instrument;
		}

		if (cell.note >= 0 && cell.note < 120) {
			const played = lookup(ch, cell.note);
			if (porta && ch.sounding && ch.sample) {
				ch.portaFrequency = itHz((played.sample ?? ch.sample).c5Speed, played.note);
			} else if (played.sample && played.sample.pcm.length > 0) {
				if (it.instrumentMode && ch.sounding && ch.inst && ch.inst.newNoteAction !== 0) {
					ignored.unsupported++;
				}

				const sample = played.sample;
				const inst = played.inst;
				ch.sample = sample;
				ch.inst = inst;
				ch.note = cell.note;
				ch.frequency = itHz(sample.c5Speed, played.note);
				ch.portaFrequency = ch.frequency;
				ch.volume = sample.volume;
				ch.sampleVolume = inst ? (sample.globalVolume * inst.globalVolume) >> 6 : sample.globalVolume * 2;
				let pan = inst?.pan ?? ch.channelPan;
				if (sample.pan !== null) {
					pan = sample.pan;
					if (!inst) {
						ch.channelPan = pan;
					}
				}

				if (inst && pan !== SURROUND) {
					pan = Math.max(0, Math.min(64, pan + (((cell.note - inst.pitchPanCenter) * inst.pitchPanSeparation) >> 3)));
				}

				ch.pan = pan;
				ch.keyOff = false;
				ch.fading = false;
				ch.fadeout = 1024;
				ch.volumeEnvelope = freshEnvelope(inst?.volumeEnvelope ?? null);
				ch.panEnvelope = freshEnvelope(inst?.panEnvelope ?? null);
				ch.pitchEnvelope = freshEnvelope(inst?.pitchEnvelope ?? null);
				ch.sounding = true;
				ch.left = sample.loopLength > 0 ? Infinity : sample.pcm.length;
				struck = true;
				if (cell.command === O && remember(ch, "O", cell.param) > 0) {
					ignored.offsets++;
				}
			} else {
				ch.sounding = false;
			}
		} else if (cell.note === 254) {
			ch.sounding = false;
		} else if (cell.note === 255) {
			ch.keyOff = true;
			if (!it.instrumentMode) {
				// Sample mode: the note stops, unless it is held in a sustain loop it now leaves.
				if (!ch.sample?.sustain) {
					ch.sounding = false;
				}
			} else if (!ch.inst?.volumeEnvelope || ch.inst.volumeEnvelope.loop) {
				ch.fading = true;
			}
		} else if (cell.note >= 120) {
			ch.fading = it.instrumentMode;
		} else if (cell.instrument > 0 && ch.sample) {
			// An instrument alone sets its sample's volume again.
			const played = lookup(ch, ch.note);
			ch.volume = (played.sample ?? ch.sample).volume;
		}

		// The volume column.
		const v = cell.volume;
		ch.volumeCommand = 0;
		if (v >= 0 && v <= 64) {
			ch.volume = v;
		} else if (v >= 128 && v <= 192) {
			ch.pan = ch.channelPan = v - 128;
		} else if (v >= 65) {
			const command = Math.floor((v - 65) / 10);
			const value = (v - 65) % 10;
			if (command < 4) {
				const amount = remember(ch, "volumeColumn", value);
				if (command === 0) ch.volume = Math.min(64, ch.volume + amount);
				else if (command === 1) ch.volume = Math.max(0, ch.volume - amount);
				else ch.volumeCommand = command === 2 ? 1 : -1;
				ch.volumeValue = amount;
			} else if (command < 6 && v <= 124) {
				const amount = value > 0 ? value << 2 : 0;
				if (amount) ch.memory.set("EFG", amount);
				ch.volumeCommand = command === 4 ? 2 : 3;
			} else if (v >= 193 && v <= 202) {
				if (v > 193) ch.memory.set(it.compatibleGxx ? "G" : "EFG", SLIDE_TABLE[v - 194]);
				ch.volumeCommand = 4;
			} else if (v >= 203 && v <= 212) {
				if (v > 203) ch.vibratoDepth = ((v - 203) << 2) * (it.oldEffects ? 2 : 1);
				ch.volumeCommand = 5;
			}
		}

		return struck;
	};

	const tremor = (ch: Channel): void => {
		const info = ch.memory.get("I") ?? 0;
		const extra = it.oldEffects ? 1 : 0;
		ch.tremorCount--;
		if (ch.tremorCount <= 0) {
			ch.tremorOn = !ch.tremorOn;
			ch.tremorCount = ch.tremorOn ? (info >> 4) + extra : (info & 0x0f) + extra;
		}
	};

	const retrigger = (ch: Channel): boolean => {
		ch.retrigCount--;
		if (ch.retrigCount > 0) {
			return false;
		}

		const info = ch.memory.get("Q") ?? 0;
		ch.retrigCount = info & 0x0f;
		let v = ch.volume;
		switch (info >> 4) {
			case 0x1:
				v -= 1;
				break;
			case 0x2:
				v -= 2;
				break;
			case 0x3:
				v -= 4;
				break;
			case 0x4:
				v -= 8;
				break;
			case 0x5:
				v -= 16;
				break;
			case 0x6:
				v = Math.floor((v << 1) / 3);
				break;
			case 0x7:
				v >>= 1;
				break;
			case 0x9:
				v += 1;
				break;
			case 0xa:
				v += 2;
				break;
			case 0xb:
				v += 4;
				break;
			case 0xc:
				v += 8;
				break;
			case 0xd:
				v += 16;
				break;
			case 0xe:
				v = (v * 3) >> 1;
				break;
			case 0xf:
				v <<= 1;
				break;
		}

		ch.volume = Math.max(0, Math.min(64, v));
		if (ch.sample && ch.frequency > 0) {
			ch.sounding = true;
			ch.left = ch.sample.loopLength > 0 ? Infinity : ch.sample.pcm.length;
			return true;
		}

		return false;
	};

	/** A volume, channel-volume, pan or global-volume slide's init: fine ones done now, the rest each later tick. */
	const slideInit = (info: number, apply: (delta: number) => void, now = false): number => {
		const hi = info >> 4;
		const lo = info & 0x0f;
		if (lo === 0) {
			// `InitCommandD7`: D's slide by 15 also runs at once.
			if (now && hi === 15) apply(15);
			return hi;
		}

		if (hi === 0) {
			if (now && lo === 15) apply(-15);
			return -lo;
		}

		if (lo === 0x0f) {
			apply(hi);
		} else if (hi === 0x0f) {
			apply(-lo);
		}

		return 0;
	};

	for (;;) {
		while (order < it.orders.length && it.orders[order] === 254) {
			order++;
		}

		if (order >= it.orders.length || it.orders[order] >= 200) {
			// The song loops to its own start, so a song after a `---` stays itself.
			let first = start;
			while (first < it.orders.length && it.orders[first] === 254) {
				first++;
			}

			loopTick = visited.get(`${first}:0`) ?? 0;
			break;
		}

		const key = `${order}:${row}`;
		const looping = channels.some((ch) => ch.loopCount > 0);
		const seen = visited.get(key);
		if (seen !== undefined && !looping) {
			loopTick = seen;
			break;
		}

		if (tick >= TICK_LIMIT) {
			tooLong = true;
			loopTick = 0;
			break;
		}

		if (seen === undefined) {
			visited.set(key, tick);
		}

		if (order !== segmentOrder) {
			segments.push({ tick, order, row });
			segmentOrder = order;
		}

		rowStarts.push(tick);
		const pattern = it.patterns[it.orders[order]];
		const rows = pattern?.length ?? 64;
		const cells = (pattern?.[row] ?? []).map((cell, i) => (disabled[i] ? null : cell));
		let jumpOrder: number | null = null;
		let breakRow: number | null = null;
		let loopJump: number | null = null;
		let patternLooping = false;
		let repeats = 0;
		let extraTicks = 0;
		const struck = channels.map(() => false);
		/** Each channel's slide this row, per later tick: volume, channel volume, pan, global volume. */
		const slides = channels.map(() => ({ volume: 0, channel: 0, pan: 0, global: 0, tempo: 0 }));

		/** Each command's init on tick 0, and again on each repeat SEx makes of the row. */
		const init = (pass: number): void => {
			cells.forEach((cell, index) => {
				const ch = channels[index];
				if (!cell) {
					return;
				}

				const s = slides[index];
				const param = cell.param;
				switch (cell.command) {
					case A:
						if (param > 0) speed = param;
						break;
					case B:
						jumpOrder = param;
						breakRow ??= 0;
						break;
					case C:
						if (!patternLooping) {
							breakRow = param;
							jumpOrder ??= order + 1;
						}

						break;
					case D:
						s.volume = slideInit(
							remember(ch, "DKL", param),
							(d) => {
								ch.volume = Math.max(0, Math.min(64, ch.volume + d));
							},
							true,
						);
						break;
					case E:
					case F: {
						const info = remember(ch, "EFG", param);
						const sign = cell.command === E ? -1 : 1;
						if ((info & 0xf0) >= 0xe0) {
							const amount = info & 0x0f;
							slide(ch, sign * ((info & 0xf0) === 0xe0 ? amount : amount << 2));
						}

						break;
					}

					case G:
						if (param > 0) ch.memory.set(it.compatibleGxx ? "G" : "EFG", param);
						break;
					case H:
					case U: {
						const speed4 = (param >> 4) << 2;
						const depth = cell.command === H ? (param & 0x0f) << 2 : param & 0x0f;
						if (speed4 > 0) ch.vibratoSpeed = speed4;
						if (depth > 0) ch.vibratoDepth = depth * (it.oldEffects ? 2 : 1);
						break;
					}

					case I:
						remember(ch, "I", param);
						tremor(ch);
						break;
					case J:
						remember(ch, "J", param);
						break;
					case K:
					case L:
						if (param > 0) ch.memory.set("DKL", param);
						s.volume = slideInit(
							ch.memory.get("DKL") ?? 0,
							(d) => {
								ch.volume = Math.max(0, Math.min(64, ch.volume + d));
							},
							true,
						);
						break;
					case M:
						if (param <= 0x40) ch.channelVolume = param;
						break;
					case N:
						s.channel = slideInit(remember(ch, "N", param), (d) => {
							ch.channelVolume = Math.max(0, Math.min(64, ch.channelVolume + d));
						});
						break;
					case O:
						remember(ch, "O", param);
						break;
					case P:
						// P's high nibble slides left, its low one right.
						s.pan = -slideInit(remember(ch, "P", param), (d) => {
							if (ch.pan !== SURROUND) ch.pan = ch.channelPan = Math.max(0, Math.min(64, ch.pan - d));
						});
						break;
					case Q:
						remember(ch, "Q", param);
						if (pass === 0 && cell.note >= 0) {
							ch.retrigCount = (ch.memory.get("Q") ?? 0) & 0x0f;
						} else if (retrigger(ch)) {
							struck[index] = true;
						}

						break;
					case R: {
						const speed4 = (param >> 4) << 2;
						const depth = (param & 0x0f) << 1;
						if (speed4 > 0) ch.tremoloSpeed = speed4;
						if (depth > 0) ch.tremoloDepth = depth;
						break;
					}

					case S: {
						const info = remember(ch, "S", param);
						const x = info >> 4;
						const y = info & 0x0f;
						switch (x) {
							case 0x6:
								if (pass === 0) extraTicks += y;
								break;
							case 0x7:
								if (y >= 3) ignored.unsupported++;
								break;
							case 0x8:
								ch.pan = ch.channelPan = (((y << 4) | y) + 2) >> 2;
								break;
							case 0x9:
								if (y === 1) ch.pan = ch.channelPan = SURROUND;
								break;
							case 0xb:
								if (pass > 0) break;
								if (y === 0) {
									ch.loopStartRow = row;
								} else if (ch.loopCount === 0) {
									ch.loopCount = y;
									loopJump = ch.loopStartRow;
									patternLooping = true;
								} else if (--ch.loopCount !== 0) {
									loopJump = ch.loopStartRow;
									patternLooping = true;
								} else {
									ch.loopStartRow = row + 1;
								}

								break;
							case 0xc:
								ch.cut = y;
								break;
							case 0xe:
								if (pass === 0 && repeats === 0) repeats = y;
								break;
						}

						break;
					}

					case T:
						if (param >= 0x20) {
							if (param !== tempo) {
								tempo = param;
								tempos.push({ tick, bpm: tempo });
							}
						} else {
							const info = remember(ch, "T", param);
							s.tempo = info & 0xf0 ? info - 16 : -info;
						}

						break;
					case V:
						if (param <= 0x80) globalVolume = param;
						break;
					case W:
						s.global = slideInit(remember(ch, "W", param), (d) => {
							globalVolume = Math.max(0, Math.min(128, globalVolume + d));
						});
						break;
					case X:
						ch.pan = ch.channelPan = (param + 2) >> 2;
						break;
					case Y:
						if (pass === 0) ignored.unsupported++;
						break;
				}
			});
		};

		/** The ticks after the first. */
		const later = (): void => {
			cells.forEach((cell, index) => {
				const ch = channels[index];
				if (!cell) {
					return;
				}

				const s = slides[index];
				if (s.volume) ch.volume = Math.max(0, Math.min(64, ch.volume + s.volume));
				if (s.channel) ch.channelVolume = Math.max(0, Math.min(64, ch.channelVolume + s.channel));
				if (s.pan && ch.pan !== SURROUND) ch.pan = ch.channelPan = Math.max(0, Math.min(64, ch.pan + s.pan));
				if (s.global) globalVolume = Math.max(0, Math.min(128, globalVolume + s.global));
				if (s.tempo) {
					const next = Math.max(32, Math.min(255, tempo + s.tempo));
					if (next !== tempo) {
						tempo = next;
						tempos.push({ tick, bpm: tempo });
					}
				}

				switch (ch.volumeCommand) {
					case 1:
						ch.volume = Math.min(64, ch.volume + ch.volumeValue);
						break;
					case -1:
						ch.volume = Math.max(0, ch.volume - ch.volumeValue);
						break;
					case 2:
						slide(ch, -((ch.memory.get("EFG") ?? 0) << 2));
						break;
					case 3:
						slide(ch, (ch.memory.get("EFG") ?? 0) << 2);
						break;
					case 4:
						towardPorta(ch, portaAmount(ch));
						break;
				}

				const param = cell.param;
				switch (cell.command) {
					case E:
					case F: {
						const info = ch.memory.get("EFG") ?? 0;
						if ((info & 0xf0) < 0xe0) {
							slide(ch, (cell.command === E ? -1 : 1) * (info << 2));
						}

						break;
					}

					case G:
					case L:
						towardPorta(ch, portaAmount(ch));
						break;
					case I:
						tremor(ch);
						break;
					case Q:
						if (retrigger(ch)) struck[index] = true;
						break;
					case S: {
						const info = ch.memory.get("S") ?? param;
						if (info >> 4 === 0xc && ch.cut > 0) {
							ch.cut--;
							if (ch.cut === 0) ch.sounding = false;
						}

						if (info >> 4 === 0xd && ch.delayed) {
							ch.delay--;
							if (ch.delay <= 0) {
								struck[index] = readNote(ch, ch.delayed);
								ch.delayed = null;
							}
						}

						break;
					}
				}
			});
		};

		/** Each channel's envelopes, fadeout and the values recorded for this tick. */
		const record = (index: number, ch: Channel, cell: ItCell | null): void => {
			const o = out[index];
			const inst = ch.inst;
			let envelope = 64;
			let panEnvelope = 0;
			let pitchEnvelope = 0;
			if (inst && it.instrumentMode) {
				if (inst.volumeEnvelope) {
					const ended = stepEnvelope(ch.volumeEnvelope, inst.volumeEnvelope, ch.keyOff);
					envelope = Math.max(0, Math.min(64, ch.volumeEnvelope.value / 65536));
					if (ended) {
						if (envelope === 0) ch.sounding = false;
						else ch.fading = true;
					}
				}

				if (inst.panEnvelope) {
					stepEnvelope(ch.panEnvelope, inst.panEnvelope, ch.keyOff);
					panEnvelope = ch.panEnvelope.value / 65536;
				}

				if (inst.pitchEnvelope && !inst.pitchEnvelope.filter) {
					stepEnvelope(ch.pitchEnvelope, inst.pitchEnvelope, ch.keyOff);
					pitchEnvelope = ch.pitchEnvelope.value / 65536;
				}

				if (ch.fading) {
					ch.fadeout -= inst.fadeout;
					if (ch.fadeout <= 0) {
						ch.fadeout = 0;
						ch.sounding = false;
					}
				}
			}

			const sample = ch.sample;
			const sounding = ch.sounding && ch.frequency > 0 && sample !== null;
			const command = cell?.command ?? 0;
			const tremorOff = command === I && !ch.tremorOn;
			const fade = it.instrumentMode && inst ? ch.fadeout / 1024 : 1;
			const level =
				(tremorOff ? 0 : ch.volume) *
				(ch.channelVolume / 64) *
				(ch.sampleVolume / 128) *
				fade *
				(envelope / 64) *
				(globalVolume / 128);
			let pan = ch.pan === SURROUND ? 32 : ch.pan;
			if (panEnvelope !== 0) {
				pan = Math.max(0, Math.min(64, pan + ((32 - Math.abs(pan - 32)) * panEnvelope) / 32));
			}

			pan = it.stereo ? ((pan - 32) * it.separation) / 128 + 32 : 32;
			o.sample.push(sounding ? sample.index : 0);
			o.pitch.push(sounding ? 12 * Math.log2(ch.frequency / sample.c5Speed) + pitchEnvelope / 2 : 0);
			o.volume.push(level);
			o.pan.push(Math.max(0, Math.min(255, Math.round(pan * 4))));
			o.keyOn.push(struck[index] && sounding ? 1 : 0);
			// The frequency moves by `((sine × depth) << 2 + 128) >> 8` slide steps, the phase by the speed of 256 a tick.
			const swingSemitones = (steps: number): number => {
				if (it.linear) {
					return steps / 64;
				}

				const period = PERIOD_BASE / Math.max(1, ch.frequency);
				return (12 * Math.log2((period + steps) / Math.max(1, period - steps))) / 2;
			};

			let vibratoRate = 0;
			let vibratoDepth = 0;
			if (command === H || command === U || command === K || ch.volumeCommand === 5) {
				vibratoRate = ch.vibratoSpeed;
				vibratoDepth = swingSemitones((64 * ch.vibratoDepth * 4 + 128) >> 8);
			} else if (sample && sample.autoVibrato.depth > 0 && sample.autoVibrato.speed > 0) {
				// The sample's auto-vibrato at its full depth, always a linear slide, its sweep not followed.
				vibratoRate = sample.autoVibrato.speed;
				vibratoDepth = sample.autoVibrato.depth / 64;
			}

			o.vibratoRate.push(vibratoRate);
			o.vibratoDepth.push(vibratoDepth);
			const tremolo = command === R;
			o.tremoloRate.push(tremolo ? ch.tremoloSpeed : 0);
			o.tremoloDepth.push(tremolo ? (64 * ch.tremoloDepth * 4 + 128) >> 8 : 0);
			o.arpeggio.push(command === J ? (ch.memory.get("J") ?? 0) : 0);
			if (sounding && ch.left !== Infinity) {
				ch.left -= ch.frequency / (tempo * 0.4);
				if (ch.left <= 0) {
					ch.sounding = false;
				}
			}
		};

		// Tick 0: the notes, each held back where SDx delays it, then the commands' init.
		cells.forEach((cell, index) => {
			const ch = channels[index];
			if (!cell) {
				return;
			}

			const sInfo = cell.command === S ? cell.param || (ch.memory.get("S") ?? 0) : 0;
			if (cell.command === S && sInfo >> 4 === 0xd && (sInfo & 0x0f) > 0) {
				ch.delayed = cell;
				ch.delay = sInfo & 0x0f;
				if (ch.delay >= speed) {
					ignored.unsupported++;
				}

				return;
			}

			ch.delayed = null;
			struck[index] = readNote(ch, cell);
		});

		for (let pass = 0; pass <= repeats; pass++) {
			for (let t = 0; ; t++) {
				if (t === 0) {
					init(pass);
				} else {
					later();
				}

				channels.forEach((ch, index) => {
					record(index, ch, cells[index] ?? null);
					struck[index] = false;
				});
				tick++;
				// S6x lengthens the row's first pass by its ticks.
				if (t + 1 >= speed + (pass === 0 ? extraTicks : 0)) {
					break;
				}
			}
		}

		if (loopJump !== null) {
			row = loopJump;
		} else if (jumpOrder !== null) {
			order = jumpOrder;
			row = breakRow ?? 0;
			segmentOrder = -1;
			const next = it.patterns[it.orders[order] ?? 0]?.length ?? 64;
			if (row >= next) {
				row = 0;
			}
		} else if (++row >= rows) {
			row = 0;
			order++;
		}
	}

	return { ticks: tick, loopTick, tempos, segments, rowStarts, channels: out, ignored, tooLong };
}
