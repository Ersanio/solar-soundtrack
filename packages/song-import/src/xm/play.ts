/**
 * An XM played tick by tick, the way FastTracker II plays it: what each channel sounds on every tick,
 * and where the song loops.
 *
 * The rules follow 8bitbubsy's `ft2_replayer.c`: tick 0 reads the row (`getNewNote`) and runs the
 * volume column's and the effects' tick-zero work, the later ticks the rest; a pattern delay replays
 * the row with the later ticks' work only; the row moves on as `getNextPos` moves it, E6x's leftover
 * break row and all. Periods are FT2's, linear (`(1936 - index) × 4`, 64 to a semitone) or Amiga
 * (1712 at C-4), and play at `8363 × 2^((4608 - period) / 768)` or `8363 × 1712 / period` Hz. The
 * volume envelope, the fadeout after a key off, the panning envelope and the global volume are folded
 * into what is recorded; the vibrato, the tremolo, the auto-vibrato and the arpeggio are recorded as
 * rate and swing.
 */

import { type ChannelTicks, type Ignored, type Segment, type TrackerPlay, channelTicks } from "../tracker/model";
import type { XmCell, XmEnvelope, XmFile, XmInstrument, XmSample } from "./file";

/** About an hour at 125 BPM: a song still running here is taken to never end. */
const TICK_LIMIT = 180_000;
const NOTE_OFF = 97;
/** The period at FT2's note index (`(note - 1) × 16 + finetune / 8 + 16`), linear or Amiga. */
export function xmPeriod(index: number, linear: boolean): number {
	return linear ? (1936 - index) * 4 : Math.round(1712 * 2 ** (-(index - 784) / 192));
}

/** The rate a period plays at (`getSampleC4Hz`). */
export function xmHz(period: number, linear: boolean): number {
	return linear ? 8363 * 2 ** ((4608 - period) / 768) : (8363 * 1712) / period;
}

/** The rate a sample plays C-4 at: its relative note and finetune above 8363 Hz. */
export function xmBaseHz(sample: XmSample): number {
	return 8363 * 2 ** ((sample.relativeNote + sample.finetune / 128) / 12);
}

interface EnvelopeState {
	tick: number;
	pos: number;
	/** In 256ths. */
	value: number;
	delta: number;
}

const freshEnvelope = (): EnvelopeState => ({ tick: 0xffff, pos: 0, value: 0, delta: 0 });

/** One tick of an envelope, as `updateVolPanAutoVib` steps it: its value, 0 to 64. */
function stepEnvelope(state: EnvelopeState, env: XmEnvelope, keyOff: boolean): number {
	const points = env.points;
	let pos = state.pos;
	let interpolated = false;
	let value = state.value;
	state.tick = (state.tick + 1) & 0xffff;
	if (state.tick === points[pos][0]) {
		state.value = points[pos][1] << 8;
		pos++;
		if (env.loop) {
			pos--;
			if (pos === env.loop.end && (env.sustain === null || pos !== env.sustain || !keyOff)) {
				pos = env.loop.start;
				state.tick = points[pos][0];
				state.value = points[pos][1] << 8;
			}

			pos++;
		}

		if (pos < points.length) {
			let interpolate = true;
			if (env.sustain !== null && !keyOff && pos - 1 === env.sustain) {
				pos--;
				state.delta = 0;
				interpolate = false;
			}

			if (interpolate) {
				state.pos = pos;
				const dx = points[pos][0] - points[pos - 1][0];
				if (dx > 0) {
					state.delta = Math.trunc(((points[pos][1] - points[pos - 1][1]) << 8) / dx);
					value = state.value;
					interpolated = true;
				} else {
					state.delta = 0;
				}
			}
		} else {
			state.delta = 0;
		}
	}

	if (!interpolated) {
		state.value += state.delta;
		value = state.value;
		const hi = (value >> 8) & 0xff;
		if (hi > 64) {
			value = hi <= 160 ? 64 * 256 : 0;
			state.delta = 0;
		}
	}

	return Math.min(64, value / 256);
}

interface Channel {
	instrumentNumber: number;
	instrument: XmInstrument | null;
	sample: XmSample | null;
	note: number;
	relativeNote: number;
	finetune: number;
	sounding: boolean;
	/** Frames left of a one-shot sample, `Infinity` for a looped one. */
	left: number;
	period: number;
	portaTarget: number;
	portaDirection: number;
	portaSpeed: number;
	volume: number;
	outVolume: number;
	oldVolume: number;
	oldPan: number;
	pan: number;
	keyOff: boolean;
	fadeout: number;
	fadeoutSpeed: number;
	volumeEnvelope: EnvelopeState;
	panEnvelope: EnvelopeState;
	memory: Map<string, number>;
	vibratoSpeed: number;
	vibratoDepth: number;
	tremoloSpeed: number;
	tremoloDepth: number;
	retrigCounter: number;
	tremorPos: number;
	loopStartRow: number;
	loopCounter: number;
	/** The cell a note delay holds back. */
	delayed: XmCell | null;
}

/** Plays the song once through from order `start`, to its end or to the first row it comes back to. */
export function playXm(xm: XmFile, start = 0): TrackerPlay {
	const out: ChannelTicks[] = Array.from({ length: xm.channels }, channelTicks);
	const channels: Channel[] = Array.from({ length: xm.channels }, () => ({
		instrumentNumber: 0,
		instrument: null,
		sample: null,
		note: 0,
		relativeNote: 0,
		finetune: 0,
		sounding: false,
		left: 0,
		period: 0,
		portaTarget: 0,
		portaDirection: 0,
		portaSpeed: 0,
		volume: 0,
		outVolume: 0,
		oldVolume: 0,
		oldPan: 128,
		pan: 128,
		keyOff: false,
		fadeout: 32768,
		fadeoutSpeed: 0,
		volumeEnvelope: freshEnvelope(),
		panEnvelope: freshEnvelope(),
		memory: new Map(),
		vibratoSpeed: 0,
		vibratoDepth: 0,
		tremoloSpeed: 0,
		tremoloDepth: 0,
		retrigCounter: 0,
		tremorPos: 0,
		loopStartRow: 0,
		loopCounter: 0,
		delayed: null,
	}));
	const ignored: Ignored = { offsets: 0, unsupported: 0 };
	const tempos: { tick: number; bpm: number }[] = [{ tick: 0, bpm: xm.bpm }];
	const segments: Segment[] = [];
	const rowStarts: number[] = [];
	const visited = new Map<string, number>();
	const linear = xm.linear;

	let speed = xm.speed;
	let bpm = xm.bpm;
	let globalVolume = 64;
	let tick = 0;
	let order = start;
	let row = 0;
	let loopTick: number;
	let tooLong = false;
	let segmentOrder = -1;
	let breakRow = 0;
	let breakFlag = false;
	let jumpFlag = false;
	let jumpOverflow = false;
	let delay = 0;
	let stop = false;

	/** A memory slot: `value` stored when non-zero, the stored one returned. */
	const remember = (ch: Channel, slot: string, value: number): number => {
		if (value !== 0) {
			ch.memory.set(slot, value);
		}

		return ch.memory.get(slot) ?? 0;
	};

	const clampPeriod = (period: number): number => Math.max(1, Math.min(31999, period));

	const keyOff = (ch: Channel): void => {
		ch.keyOff = true;
		const env = ch.instrument?.volumeEnvelope;
		if (env) {
			const state = ch.volumeEnvelope;
			const at = env.points[state.pos]?.[0] ?? 0;
			if (state.tick >= at) {
				state.tick = (at - 1) & 0xffff;
			}
		} else {
			ch.volume = 0;
			ch.outVolume = 0;
		}
	};

	const resetVolumes = (ch: Channel): void => {
		ch.volume = ch.oldVolume;
		ch.outVolume = ch.oldVolume;
		ch.pan = ch.oldPan;
	};

	const triggerInstrument = (ch: Channel): void => {
		ch.retrigCounter = 0;
		ch.tremorPos = 0;
		ch.keyOff = false;
		ch.volumeEnvelope = freshEnvelope();
		ch.panEnvelope = freshEnvelope();
		ch.fadeoutSpeed = ch.instrument?.fadeout ?? 0;
		ch.fadeout = 32768;
	};

	/** `triggerNote`: the note's sample and period, the sample struck. Returns whether it sounds. */
	const triggerNote = (ch: Channel, note: number, effect: number, param: number): boolean => {
		if (note === NOTE_OFF) {
			keyOff(ch);
			return false;
		}

		if (note === 0) {
			note = ch.note;
			if (note === 0) {
				return false;
			}
		}

		ch.note = note;
		const instrument = xm.instruments[ch.instrumentNumber - 1] ?? null;
		ch.instrument = instrument;
		const n = Math.min(96, note);
		const sample = instrument?.samples[instrument.keymap[n - 1]] ?? null;
		ch.sample = sample;
		ch.relativeNote = sample?.relativeNote ?? 0;
		const played = n + ch.relativeNote;
		if (played >= 120 || played < 0) {
			return false;
		}

		ch.oldVolume = sample?.volume ?? 0;
		ch.oldPan = sample?.panning ?? 128;
		ch.finetune = effect === 0x0e && (param & 0xf0) === 0x50 ? (param & 0x0f) * 16 - 128 : (sample?.finetune ?? 0);
		if (played !== 0) {
			ch.period = xmPeriod((played - 1) * 16 + (ch.finetune >> 3) + 16, linear);
		}

		ch.sounding = sample !== null && sample.pcm.length > 0;
		ch.left = sample && sample.loopLength > 0 ? Infinity : (sample?.pcm.length ?? 0);
		if (effect === 9) {
			const offset = remember(ch, "offset", param);
			if (offset > 0 && ch.sounding) {
				ignored.offsets++;
			}
		}

		return ch.sounding;
	};

	const preparePortamento = (ch: Channel, cell: XmCell): void => {
		if (cell.note > 0) {
			if (cell.note === NOTE_OFF) {
				keyOff(ch);
			} else {
				const index = (cell.note - 1 + ch.relativeNote) * 16 + (ch.finetune >> 3) + 16;
				if (index >= 0 && index < 1936) {
					ch.portaTarget = xmPeriod(index, linear);
					ch.portaDirection = ch.portaTarget === ch.period ? 0 : ch.portaTarget > ch.period ? 1 : 2;
				}
			}
		}

		if (cell.instrument > 0) {
			resetVolumes(ch);
			if (cell.note !== NOTE_OFF) {
				triggerInstrument(ch);
			}
		}
	};

	const volumeSlide = (ch: Channel, param: number): void => {
		const value = remember(ch, "volume", param);
		ch.volume = value & 0xf0 ? Math.min(64, ch.volume + (value >> 4)) : Math.max(0, ch.volume - value);
		ch.outVolume = ch.volume;
	};

	const portamento = (ch: Channel): void => {
		if (ch.portaDirection === 0) {
			return;
		}

		if (ch.portaDirection > 1) {
			ch.period -= ch.portaSpeed;
			if (ch.period <= ch.portaTarget) {
				ch.portaDirection = 1;
				ch.period = ch.portaTarget;
			}
		} else {
			ch.period += ch.portaSpeed;
			if (ch.period >= ch.portaTarget) {
				ch.portaDirection = 1;
				ch.period = ch.portaTarget;
			}
		}
	};

	const retrigger = (ch: Channel): boolean => {
		const count = ch.retrigCounter + 1;
		if (count < (ch.memory.get("retrigSpeed") ?? 0)) {
			ch.retrigCounter = count;
			return false;
		}

		ch.retrigCounter = 0;
		let v = ch.volume;
		switch (ch.memory.get("retrigVolume") ?? 0) {
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
				v = (v >> 1) + (v >> 3) + (v >> 4);
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
				v = (v >> 1) + v;
				break;
			case 0xf:
				v += v;
				break;
		}

		ch.volume = Math.max(0, Math.min(64, v));
		ch.outVolume = ch.volume;
		return triggerNote(ch, 0, 0, 0);
	};

	/** `getNewNote`, then the volume column's and the effects' tick-zero work. Returns whether a note was struck. */
	const newNote = (ch: Channel, cell: XmCell): boolean => {
		let struck = false;
		const instrument = cell.instrument > 0 && cell.instrument <= 128 ? cell.instrument : 0;
		if (instrument > 0) {
			ch.instrumentNumber = instrument;
		}

		if (cell.effect === 0x0e && cell.param >= 0xd1 && cell.param <= 0xdf) {
			ch.delayed = cell;
			if ((cell.param & 0x0f) >= speed) {
				ignored.unsupported++;
			}

			return false;
		}

		ch.delayed = null;
		let handled = false;
		if (cell.effect !== 0x0e || cell.param !== 0x90) {
			if ((cell.volume & 0xf0) === 0xf0) {
				if (cell.volume & 0x0f) {
					ch.portaSpeed = (cell.volume & 0x0f) * 64;
				}

				preparePortamento(ch, cell);
				handled = true;
			} else if (cell.effect === 3 || cell.effect === 5) {
				if (cell.effect !== 5 && cell.param !== 0) {
					ch.portaSpeed = cell.param * 4;
				}

				preparePortamento(ch, cell);
				handled = true;
			} else if (cell.effect === 0x14 && cell.param === 0) {
				keyOff(ch);
				if (instrument) {
					resetVolumes(ch);
				}

				handled = true;
			} else if (cell.note === 0) {
				if (instrument > 0) {
					resetVolumes(ch);
					triggerInstrument(ch);
				}

				handled = true;
			}
		}

		if (!handled) {
			if (cell.note === NOTE_OFF) {
				keyOff(ch);
			} else {
				struck = triggerNote(ch, cell.note, cell.effect, cell.param);
			}

			if (instrument > 0) {
				resetVolumes(ch);
				if (cell.note !== NOTE_OFF) {
					triggerInstrument(ch);
				}
			}
		}

		tickZero(ch, cell);
		if (cell.effect === 27 && cell.volume === 0 && retrigger(ch)) {
			struck = true;
		}

		return struck;
	};

	/** `handleEffects_TickZero`: the volume column, then the effect. */
	const tickZero = (ch: Channel, cell: XmCell): void => {
		const v = cell.volume;
		const x = v & 0x0f;
		switch (v >> 4) {
			case 0x1:
			case 0x2:
			case 0x3:
			case 0x4:
			case 0x5:
				ch.volume = ch.outVolume = Math.min(64, v - 16);
				break;
			case 0x8:
				ch.volume = ch.outVolume = Math.max(0, ch.volume - x);
				break;
			case 0x9:
				ch.volume = ch.outVolume = Math.min(64, ch.volume + x);
				break;
			case 0xa:
				if (x > 0) {
					ch.vibratoSpeed = x * 4;
				}

				break;
			case 0xc:
				ch.pan = x << 4;
				break;
		}

		const param = cell.param;
		const px = param >> 4;
		const py = param & 0x0f;
		switch (cell.effect) {
			case 0x8:
				ch.pan = param;
				break;
			case 0xb:
				if (param - 1 < 0 || param - 1 >= xm.orders.length) {
					jumpOverflow = true;
				} else {
					order = param - 1;
				}

				breakRow = 0;
				jumpFlag = true;
				break;
			case 0xc:
				ch.volume = ch.outVolume = Math.min(64, param);
				break;
			case 0xd: {
				const target = px * 10 + py;
				breakRow = target <= 63 ? target : 0;
				jumpFlag = true;
				break;
			}

			case 0xe:
				switch (px) {
					case 0x1:
						ch.period = clampPeriod(ch.period - remember(ch, "fineUp", py) * 4);
						break;
					case 0x2:
						ch.period = clampPeriod(ch.period + remember(ch, "fineDown", py) * 4);
						break;
					case 0x3:
						if (py > 0) {
							ignored.unsupported++;
						}

						break;
					case 0x6:
						if (py === 0) {
							ch.loopStartRow = row;
						} else if (ch.loopCounter === 0) {
							ch.loopCounter = py;
							breakRow = ch.loopStartRow;
							breakFlag = true;
						} else if (--ch.loopCounter > 0) {
							breakRow = ch.loopStartRow;
							breakFlag = true;
						}

						break;
					case 0xa:
						ch.volume = ch.outVolume = Math.min(64, ch.volume + remember(ch, "fineVolumeUp", py));
						break;
					case 0xb:
						ch.volume = ch.outVolume = Math.max(0, ch.volume - remember(ch, "fineVolumeDown", py));
						break;
					case 0xc:
						if (py === 0) {
							ch.volume = ch.outVolume = 0;
						}

						break;
					case 0xe:
						if (delay === 0) {
							delay = py + 1;
						}

						break;
				}

				break;
			case 0xf:
				if (param >= 32) {
					if (param !== bpm) {
						bpm = param;
						tempos.push({ tick, bpm });
					}
				} else if (param === 0) {
					stop = true;
				} else {
					speed = param;
				}

				break;
			case 0x10:
				globalVolume = Math.min(64, param);
				break;
			case 0x15:
				ignored.unsupported++;
				break;
			case 27:
				if (py > 0) {
					ch.memory.set("retrigSpeed", py);
				}

				if (px > 0) {
					ch.memory.set("retrigVolume", px);
				}

				break;
			case 33:
				if (px === 1) {
					ch.period = clampPeriod(ch.period - remember(ch, "extraFineUp", py));
				} else if (px === 2) {
					ch.period = clampPeriod(ch.period + remember(ch, "extraFineDown", py));
				}

				break;
		}
	};

	/** `handleEffects_TickNonZero`, `t` ticks into the row. Returns whether a note was struck. */
	const tickLater = (ch: Channel, cell: XmCell, t: number): boolean => {
		let struck = false;
		const v = cell.volume;
		const x = v & 0x0f;
		switch (v >> 4) {
			case 0x6:
				ch.volume = ch.outVolume = Math.max(0, ch.volume - x);
				break;
			case 0x7:
				ch.volume = ch.outVolume = Math.min(64, ch.volume + x);
				break;
			case 0xb:
				if (x > 0) {
					ch.vibratoDepth = x;
				}

				break;
			case 0xd:
				ch.pan = Math.max(0, ch.pan - x);
				break;
			case 0xe:
				ch.pan = Math.min(255, ch.pan + x);
				break;
			case 0xf:
				portamento(ch);
				break;
		}

		const param = cell.param;
		const px = param >> 4;
		const py = param & 0x0f;
		switch (cell.effect) {
			case 0x1:
				ch.period = clampPeriod(ch.period - remember(ch, "up", param) * 4);
				break;
			case 0x2:
				ch.period = clampPeriod(ch.period + remember(ch, "down", param) * 4);
				break;
			case 0x3:
				portamento(ch);
				break;
			case 0x4:
				if (py > 0) ch.vibratoDepth = py;
				if (px > 0) ch.vibratoSpeed = px * 4;
				break;
			case 0x5:
				portamento(ch);
				volumeSlide(ch, param);
				break;
			case 0x6:
				volumeSlide(ch, param);
				break;
			case 0x7:
				if (py > 0) ch.tremoloDepth = py;
				if (px > 0) ch.tremoloSpeed = px * 4;
				break;
			case 0xa:
				volumeSlide(ch, param);
				break;
			case 0xe:
				if (px === 0x9 && py > 0 && t % py === 0) {
					struck = triggerNote(ch, 0, 0, 0);
					triggerInstrument(ch);
				} else if (px === 0xc && t === py) {
					ch.volume = ch.outVolume = 0;
				} else if (px === 0xd && t === py && ch.delayed) {
					const held = ch.delayed;
					ch.delayed = null;
					struck = triggerNote(ch, held.note, 0, 0);
					if (held.instrument > 0) {
						resetVolumes(ch);
					}

					triggerInstrument(ch);
					if (held.volume >= 0x10 && held.volume <= 0x50) {
						ch.volume = ch.outVolume = Math.min(64, held.volume - 16);
					} else if (held.volume >> 4 === 0xc) {
						ch.pan = (held.volume & 0x0f) << 4;
					}
				}

				break;
			case 0x11: {
				const value = remember(ch, "global", param);
				globalVolume = value & 0xf0 ? Math.min(64, globalVolume + (value >> 4)) : Math.max(0, globalVolume - value);
				break;
			}

			case 0x14:
				if (t === (param & 31)) {
					keyOff(ch);
				}

				break;
			case 0x19: {
				const value = remember(ch, "pan", param);
				ch.pan = value & 0xf0 ? Math.min(255, ch.pan + (value >> 4)) : Math.max(0, ch.pan - value);
				break;
			}

			case 27:
				if (retrigger(ch)) {
					struck = true;
				}

				break;
			case 29: {
				const value = remember(ch, "tremor", param);
				let sign = ch.tremorPos & 0x80;
				let data = (ch.tremorPos & 0x7f) - 1;
				if (data < 0) {
					if (sign === 0x80) {
						sign = 0;
						data = value & 0x0f;
					} else {
						sign = 0x80;
						data = value >> 4;
					}
				}

				ch.tremorPos = sign | data;
				ch.outVolume = sign === 0x80 ? ch.volume : 0;
				break;
			}
		}

		return struck;
	};

	const record = (index: number, ch: Channel, struck: boolean, cell: XmCell | null): void => {
		const o = out[index];
		const instrument = ch.instrument;
		if (ch.keyOff) {
			ch.fadeout = ch.fadeoutSpeed > ch.fadeout ? 0 : ch.fadeout - ch.fadeoutSpeed;
		}

		const envelope = instrument?.volumeEnvelope
			? stepEnvelope(ch.volumeEnvelope, instrument.volumeEnvelope, ch.keyOff)
			: 64;
		let pan = ch.pan;
		if (instrument?.panEnvelope) {
			const value = stepEnvelope(ch.panEnvelope, instrument.panEnvelope, ch.keyOff) * 256 - 32 * 256;
			const reach = (128 - Math.abs(ch.pan - 128)) << 3;
			pan = Math.max(0, Math.min(255, ch.pan + ((value * reach) >> 16)));
		}

		const sample = ch.sample;
		const sounding = ch.sounding && ch.period > 0 && sample !== null;
		const hz = xmHz(ch.period, linear);
		const effect = cell?.effect ?? -1;
		const tremolo = effect === 0x7;
		const level = (tremolo ? ch.volume : ch.outVolume) * (globalVolume / 64) * (ch.fadeout / 32768) * (envelope / 64);
		o.sample.push(sounding ? sample.index : 0);
		o.pitch.push(sounding ? 12 * Math.log2(hz / xmBaseHz(sample)) : 0);
		o.volume.push(level);
		o.pan.push(pan);
		o.keyOn.push(struck && sounding ? 1 : 0);

		// The period moves by `vibratoTab × depth >> 5`, the phase by the speed of 256 a tick (`doVibrato`).
		const swingSemitones = (periods: number): number =>
			linear ? periods / 64 : (12 * Math.log2((ch.period + periods) / Math.max(1, ch.period - periods))) / 2;
		let vibratoRate = 0;
		let vibratoDepth = 0;
		if (effect === 0x4 || effect === 0x6 || (cell?.volume ?? 0) >> 4 === 0xb) {
			if (effect === 0x4) {
				if (cell && cell.param & 0x0f) ch.vibratoDepth = cell.param & 0x0f;
				if (cell && cell.param >> 4) ch.vibratoSpeed = (cell.param >> 4) * 4;
			}

			const swing = (255 * ch.vibratoDepth) >> 5;
			vibratoRate = ch.vibratoSpeed;
			vibratoDepth = swing > 0 ? swingSemitones(swing) : 0;
		} else if (instrument && instrument.autoVibrato.depth > 0 && instrument.autoVibrato.rate > 0) {
			// The auto-vibrato at its full depth, its sweep not followed: a swing of `depth` periods.
			vibratoRate = instrument.autoVibrato.rate;
			vibratoDepth = swingSemitones(instrument.autoVibrato.depth);
		}

		o.vibratoRate.push(vibratoRate);
		o.vibratoDepth.push(vibratoDepth);
		if (tremolo && cell) {
			if (cell.param & 0x0f) ch.tremoloDepth = cell.param & 0x0f;
			if (cell.param >> 4) ch.tremoloSpeed = (cell.param >> 4) * 4;
		}

		// `tremolo`: the volume moves by `vibratoTab × depth >> 6`.
		o.tremoloRate.push(tremolo ? ch.tremoloSpeed : 0);
		o.tremoloDepth.push(tremolo ? (255 * ch.tremoloDepth) >> 6 : 0);
		// FT2 steps its arpeggio down a table indexed by the ticks left in the row (`arpeggioTab`), so
		// after the note come the y and then the x semitones above it.
		const arpeggio = effect === 0 && cell ? cell.param : 0;
		o.arpeggio.push(((arpeggio & 0x0f) << 4) | (arpeggio >> 4));
		if (sounding && ch.left !== Infinity) {
			ch.left -= hz / (bpm * 0.4);
			if (ch.left <= 0) {
				ch.sounding = false;
			}
		}
	};

	for (;;) {
		const key = `${order}:${row}`;
		const looping = channels.some((ch) => ch.loopCounter > 0);
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
		const pattern = xm.patterns[xm.orders[order]];
		const rows = pattern?.length ?? 64;
		const cells = pattern?.[row] ?? [];
		let passes = 1;
		for (let pass = 0; pass < passes; pass++) {
			for (let t = 0; t < speed; t++) {
				channels.forEach((ch, index) => {
					const cell = cells[index] ?? null;
					let struck = false;
					if (cell) {
						struck = t === 0 && pass === 0 ? newNote(ch, cell) : tickLater(ch, cell, t);
					}

					record(index, ch, struck, cell);
				});
				tick++;
				if (t === 0 && pass === 0 && delay > 0) {
					passes = delay;
				}
			}
		}

		delay = 0;
		if (stop) {
			loopTick = 0;
			break;
		}

		// `getNextPos`.
		row++;
		if (breakFlag) {
			breakFlag = false;
			row = breakRow;
		}

		if (row >= rows || jumpFlag) {
			row = breakRow;
			breakRow = 0;
			jumpFlag = false;
			// FT2 wraps to order 0 and the restart order; a song that starts past one wraps to its own start
			// instead, which is another song's ground.
			if (jumpOverflow) {
				order = start;
				jumpOverflow = false;
			} else if (++order >= xm.orders.length) {
				order = xm.restart >= start ? xm.restart : start;
			}

			const next = xm.patterns[xm.orders[order]]?.length ?? 64;
			if (row >= next) {
				row = 0;
			}

			segmentOrder = -1;
		}
	}

	return { ticks: tick, loopTick, tempos, segments, rowStarts, channels: out, ignored, tooLong };
}
