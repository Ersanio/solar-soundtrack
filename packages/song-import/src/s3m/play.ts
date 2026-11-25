/**
 * An S3M played tick by tick, the way Scream Tracker 3.21 plays it: what each channel sounds on every
 * tick, and where the song loops.
 *
 * The rules follow 8bitbubsy's `st3play` (`digread.c`, `digamg.c`, `digcmd.c`): tick 0 reads the row's
 * notes (`doamiga`) and runs the once-a-row commands (`docmd1`), the later ticks the rest (`docmd2`).
 * Most commands share one remembered info byte per channel (`alastnfo`), H and U share another, G and
 * L a third. A period is `notespd >> octave × 8363 / C2SPD`, and plays at 14317056 / period Hz.
 * Panning (S8x, and Xxx, which ST3 ignores) follows OpenMPT, as the reader's does. The vibrato, the
 * tremolo and the arpeggio are recorded as rate and swing rather than played, and slides as the
 * period they leave (`aorgspd`).
 */

import { type ChannelTicks, type Ignored, type Segment, type TrackerPlay, channelTicks } from "../tracker/model";
import type { S3mCell, S3mFile } from "./file";

/** ST3's clock: a period of P plays `ST3_HZ / P` frames a second (`dig.c`, `setspd`). */
export const ST3_HZ = 14_317_056;

const ROWS = 64;
/** About an hour at 125 BPM: a song still running here is taken to never end. */
const TICK_LIMIT = 180_000;

/** `notespd` and `octavediv` (`digdata.c`), with the bytes ST3.21 reads past their ends. */
const NOTE_PERIODS = [
	27392, 25856, 24384, 23040, 21696, 20480, 19328, 18240, 17216, 16256, 15360, 14512, 13696, 0x0100, 0x0802, 0x0a09,
];
const OCTAVE_SHIFT = [0, 1, 2, 3, 4, 5, 6, 7, 0, 5, 11, 17, 27, 32, 42, 47];
/** S2x's C2SPDs (`xfinetune_amiga`). */
const FINETUNES = [8363, 8413, 8463, 8529, 8581, 8651, 8723, 8757, 7895, 7941, 7985, 8046, 8107, 8169, 8232, 8280];
/** Qxy's volume change: an add, or where the second half is non-zero a multiply by it over 16 (`retrigvoladd`). */
const RETRIGGER = [
	0, -1, -2, -4, -8, -16, 0, 0, 0, 1, 2, 4, 8, 16, 0, 0, 0, 0, 0, 0, 0, 0, 10, 8, 0, 0, 0, 0, 0, 0, 24, 32,
];

const letter = (c: string): number => c.charCodeAt(0) - 64;
const A = letter("A");
const B = letter("B");
const C = letter("C");
const D = letter("D");
const E = letter("E");
const F = letter("F");
const G = letter("G");
const H = letter("H");
const I = letter("I");
const J = letter("J");
const K = letter("K");
const L = letter("L");
const O = letter("O");
const Q = letter("Q");
const R = letter("R");
const S = letter("S");
const T = letter("T");
const U = letter("U");
const V = letter("V");
const X = letter("X");

/** The period a note byte plays at under a C2SPD (`stnote2herz`, then `scalec2spd`). */
export function notePeriod(note: number, c2spd: number): number {
	const base = NOTE_PERIODS[note & 0x0f] >> (OCTAVE_SHIFT[note >> 4] & 0x1f);
	const scaled = base * 8363;
	if (scaled / 65536 >= c2spd) {
		return 32767;
	}

	return Math.min(32767, Math.floor(scaled / c2spd));
}

interface Channel {
	/** The last instrument named. */
	instrument: number;
	/** The sample sounding. */
	playing: number;
	sounding: boolean;
	/** Frames left of a one-shot sample, `Infinity` for a looped one. */
	left: number;
	c2spd: number;
	/** The period, slides included and vibrato and arpeggio left out (`aorgspd`). */
	period: number;
	/** Where a tone portamento heads (`asldspd`). */
	target: number;
	lastNote: number;
	volume: number;
	/** The volume a tremor turns back on to (`aorgvol`). */
	baseVolume: number;
	pan: number;
	/** `alastnfo`, `alasteff` (H, U), `alasteff1` (G, L). */
	lastInfo: number;
	lastVibrato: number;
	lastPorta: number;
	offset00: number;
	retrigger: number;
	cut: number;
	delay: number;
	delayed: S3mCell | null;
	tremor: number;
	tremorOn: boolean;
}

/** Plays the song once through from order `start`, to its end or to the first row it comes back to. */
export function playS3m(s3m: S3mFile, start = 0): TrackerPlay {
	const out: ChannelTicks[] = Array.from({ length: s3m.channels }, channelTicks);
	const channels: Channel[] = s3m.pans.map((pan) => ({
		instrument: 0,
		playing: 0,
		sounding: false,
		left: 0,
		c2spd: 8363,
		period: 0,
		target: 0,
		lastNote: 0,
		volume: 0,
		baseVolume: 0,
		pan,
		lastInfo: 0,
		lastVibrato: 0,
		lastPorta: 0,
		offset00: 0,
		retrigger: 0,
		cut: 0,
		delay: 0,
		delayed: null,
		tremor: 0,
		tremorOn: false,
	}));
	const ignored: Ignored = { offsets: 0, unsupported: 0 };
	const minPeriod = s3m.amigaLimits ? 453 : 64;
	const maxPeriod = s3m.amigaLimits ? 3424 : 32767;
	const tempos: { tick: number; bpm: number }[] = [{ tick: 0, bpm: s3m.tempo }];
	const segments: Segment[] = [];
	const rowStarts: number[] = [];
	const visited = new Map<string, number>();
	const sampleOf = (index: number) => s3m.samples[index - 1];

	let speed = s3m.speed;
	let bpm = s3m.tempo;
	let globalVolume = s3m.globalVolume;
	let tick = 0;
	let order = start;
	let row = 0;
	let loopTick: number;
	let tooLong = false;
	let segmentOrder = -1;
	let loopStart = -1;
	let loopCount = 0;

	const strike = (ch: Channel): void => {
		const sample = sampleOf(ch.instrument);
		ch.playing = ch.instrument;
		ch.sounding = sample !== undefined && sample.pcm.length > 0;
		ch.left = sample && sample.loopLength > 0 ? Infinity : (sample?.pcm.length ?? 0);
	};

	/** `doamiga`: a row's instrument, note and volume on a channel. Returns whether a note was struck. */
	const readNote = (ch: Channel, cell: S3mCell): boolean => {
		let struck = false;
		if (cell.instrument > 0 && cell.instrument <= 99) {
			ch.instrument = cell.instrument;
			const sample = sampleOf(cell.instrument);
			if (sample) {
				ch.c2spd = sample.c2spd;
				ch.volume = sample.volume;
				ch.baseVolume = sample.volume;
			}
		}

		let offset = 0;
		if (cell.command === O) {
			offset = cell.info === 0 ? ch.offset00 : cell.info << 8;
			ch.offset00 = offset;
		}

		if (cell.note === 254) {
			ch.sounding = false;
			ch.period = 0;
			ch.volume = 0;
			ch.target = 65535;
		} else if (cell.note !== 255 && ch.instrument > 0) {
			ch.lastNote = cell.note;
			const period = notePeriod(cell.note, ch.c2spd);
			const porta = cell.command === G || cell.command === L;
			if (!porta) {
				strike(ch);
				struck = ch.sounding;
				if (sampleOf(ch.instrument)?.adlib) {
					ignored.unsupported++;
				}

				if (struck && offset > 0) {
					ignored.offsets++;
				}
			}

			if (ch.period === 0 || !porta) {
				ch.period = period;
			}

			ch.target = period;
		}

		if (cell.volume !== 255) {
			ch.volume = Math.min(63, cell.volume);
			ch.baseVolume = ch.volume;
		}

		return struck;
	};

	/** `s_tremor`: Ixy turns the volume off and back on. */
	const tremor = (ch: Channel, info: number): void => {
		if (ch.tremor > 0) {
			ch.tremor--;
			return;
		}

		if (ch.tremorOn) {
			ch.tremorOn = false;
			ch.volume = 0;
			ch.tremor = info & 0x0f;
		} else {
			ch.tremorOn = true;
			ch.volume = ch.baseVolume;
			ch.tremor = info >> 4;
		}
	};

	/** `s_volslide`: Dxy on tick 0 or a later one. */
	const volumeSlide = (ch: Channel, info: number, first: boolean): void => {
		const x = info >> 4;
		const y = info & 0x0f;
		if (y === 0x0f) {
			if (x === 0) {
				ch.volume -= 15;
			} else if (first) {
				ch.volume += x;
			}
		} else if (x === 0x0f) {
			if (y === 0) {
				ch.volume += 15;
			} else if (first) {
				ch.volume -= y;
			}
		} else if (s3m.fastSlides || !first) {
			ch.volume += y === 0 ? x : -y;
		} else {
			return;
		}

		ch.volume = Math.max(0, Math.min(63, ch.volume));
	};

	/** `s_slidedown` (sign 1) and `s_slideup` (-1): the period moved in ST3's units. */
	const slide = (ch: Channel, info: number, first: boolean, sign: number): void => {
		if (ch.period === 0) {
			return;
		}

		let step: number;
		if (!first) {
			if (info >= 0xe0) {
				return;
			}

			step = info << 2;
		} else {
			if (info <= 0xe0) {
				return;
			}

			step = info <= 0xf0 ? info & 0x0f : (info & 0x0f) << 2;
		}

		ch.period = Math.max(0, Math.min(32767, ch.period + sign * step));
	};

	const retrigger = (ch: Channel, info: number): boolean => {
		const y = info & 0x0f;
		if (y === 0 || y > ch.retrigger) {
			ch.retrigger++;
			return false;
		}

		ch.retrigger = 1;
		const x = info >> 4;
		ch.volume = RETRIGGER[x + 16] === 0 ? ch.volume + RETRIGGER[x] : (ch.volume * RETRIGGER[x + 16]) >> 4;
		ch.volume = Math.max(0, Math.min(63, ch.volume));
		if (ch.playing > 0 && ch.period > 0) {
			strike(ch);
			return ch.sounding;
		}

		return false;
	};

	/** The cell's info with the channel's memory filled in, as `docmd1` and each command read it. */
	const resolved = (ch: Channel, cell: S3mCell): number => {
		switch (cell.command) {
			case H:
			case U:
			case K: {
				let info = cell.command === K ? 0 : cell.info;
				if (info === 0) {
					info = ch.lastVibrato;
				}

				if ((info & 0xf0) === 0) {
					info = (ch.lastVibrato & 0xf0) | (info & 0x0f);
				}

				return info;
			}

			case G:
			case L:
				return cell.command === G && cell.info !== 0 ? cell.info : ch.lastPorta;
			case R:
				return (cell.info & 0xf0) === 0 ? (ch.lastInfo & 0xf0) | (cell.info & 0x0f) : cell.info;
			default:
				return cell.info === 0 ? ch.lastInfo : cell.info;
		}
	};

	const record = (index: number, ch: Channel, struck: boolean, cell: S3mCell | null): void => {
		const o = out[index];
		const period = Math.max(minPeriod, Math.min(maxPeriod, ch.period));
		const sounding = ch.sounding && ch.period > 0;
		const sample = sampleOf(ch.playing);
		const hz = ST3_HZ / period;
		o.sample.push(sounding ? ch.playing : 0);
		o.pitch.push(sounding && sample ? 12 * Math.log2(hz / sample.c2spd) : 0);
		// `setvol`: the channel's volume of 63 under the global volume's 256ths.
		o.volume.push((ch.volume * (globalVolume << 2)) >> 8);
		o.pan.push(ch.pan);
		o.keyOn.push(struck && sounding ? 1 : 0);
		const command = cell?.command ?? 0;
		let vibratoRate = 0;
		let vibratoDepth = 0;
		if (command === H || command === U || command === K) {
			const info = ch.lastVibrato;
			const fine = command === U;
			// The period moves by `sine × depth >> 5` (>> 7 for U, one less for ST2's vibrato) and the
			// phase by twice the speed of 128 a tick (`s_vibrato`, `s_finevibrato`).
			const shift = (fine ? 7 : 5) - (s3m.oldVibrato ? 1 : 0);
			const swing = (255 * (info & 0x0f)) >> shift;
			vibratoRate = 4 * (info >> 4);
			vibratoDepth = swing > 0 && period > 0 ? (12 * Math.log2((period + swing) / Math.max(1, period - swing))) / 2 : 0;
		}

		o.vibratoRate.push(vibratoRate);
		o.vibratoDepth.push(vibratoDepth);
		// `s_tremolo`: the volume moves by `sine × depth >> 7`, the phase as the vibrato's.
		const tremolo = command === R ? ch.lastInfo : 0;
		o.tremoloRate.push(4 * (tremolo >> 4));
		o.tremoloDepth.push((255 * (tremolo & 0x0f)) >> 7);
		o.arpeggio.push(command === J ? ch.lastInfo : 0);
		if (sounding && ch.left !== Infinity) {
			ch.left -= hz / (bpm * 0.4);
			if (ch.left <= 0) {
				ch.sounding = false;
			}
		}
	};

	for (;;) {
		while (order < s3m.orders.length && s3m.orders[order] === 254) {
			order++;
		}

		const pattern = s3m.orders[order];
		if (order >= s3m.orders.length || pattern === 255 || pattern === undefined) {
			// The song loops to its own start, so a song after a `---` stays itself.
			let first = start;
			while (first < s3m.orders.length && s3m.orders[first] === 254) {
				first++;
			}

			loopTick = visited.get(`${first}:0`) ?? 0;
			break;
		}

		const key = `${order}:${row}`;
		const seen = visited.get(key);
		if (seen !== undefined && loopCount === 0) {
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
		const cells = s3m.patterns[pattern]?.[row] ?? new Array<S3mCell | null>(s3m.channels).fill(null);
		let jumpOrder: number | null = null;
		let breakRow: number | null = null;
		let loopJump: number | null = null;
		let repeats = 0;
		const struck = channels.map(() => false);

		// Tick 0: `donotes`, each channel's note held back where SDx delays it.
		cells.forEach((cell, index) => {
			const ch = channels[index];
			if (!cell) {
				return;
			}

			if (cell.command === S && (cell.info & 0xf0) === 0xd0) {
				ch.delayed = cell;
				return;
			}

			ch.delayed = null;
			struck[index] = readNote(ch, cell);
		});

		// `docmd1`, on tick 0 and again on each repeat SEx makes of the row.
		const once = (pass: number): void => {
			cells.forEach((cell, index) => {
				const ch = channels[index];
				if (!cell) {
					return;
				}

				if (cell.info > 0 && pass === 0) {
					ch.lastInfo = cell.info;
				}

				if (cell.command === 0) {
					ch.retrigger = 0;
					return;
				}

				const info = resolved(ch, cell);
				const x = info >> 4;
				const y = info & 0x0f;
				switch (cell.command) {
					case A:
						if (cell.info > 0) {
							speed = cell.info;
						}

						break;
					case B:
						jumpOrder = cell.info;
						breakRow ??= 0;
						break;
					case C:
						if (cell.info >> 4 <= 9 && (cell.info & 0x0f) <= 9) {
							breakRow = (cell.info >> 4) * 10 + (cell.info & 0x0f);
							if (breakRow >= ROWS) {
								breakRow = 0;
							}

							jumpOrder ??= order + 1;
						}

						break;
					case D:
						volumeSlide(ch, info, true);
						break;
					case E:
						slide(ch, info, true, 1);
						break;
					case F:
						slide(ch, info, true, -1);
						break;
					case G:
					case L:
						if (cell.command === G) {
							ch.lastPorta = info;
						}

						break;
					case H:
					case U:
						ch.lastVibrato = info;
						break;
					case I:
						tremor(ch, info);
						break;
					case Q:
						if (retrigger(ch, info)) {
							struck[index] = true;
						}

						break;
					case R:
						// `s_tremolo` keeps the speed it filled in from memory.
						ch.lastInfo = info;
						break;
					case S:
						switch (x) {
							case 0x1:
								if (y > 0) {
									ignored.unsupported++;
								}

								break;
							case 0x2:
								ch.c2spd = FINETUNES[y];
								break;
							case 0x8:
								ch.pan = y * 17;
								break;
							case 0xb:
								if (pass > 0) {
									break;
								}

								if (y === 0) {
									loopStart = row;
								} else {
									if (loopCount === 0) {
										loopCount = y + 1;
										if (loopStart === -1) {
											loopStart = 0;
										}
									}

									if (loopCount > 1) {
										loopCount--;
										loopJump = loopStart;
									} else {
										loopCount = 0;
										loopStart = row + 1;
									}
								}

								break;
							case 0xc:
								ch.cut = y;
								break;
							case 0xd:
								if (pass === 0) {
									ch.delay = y;
									if (y === 0 || y >= speed) {
										ignored.unsupported++;
									}
								}

								break;
							case 0xe:
								if (pass === 0 && repeats === 0) {
									repeats = y;
								}

								break;
						}

						break;
					case T:
						if (cell.info > 0x20 && cell.info !== bpm) {
							bpm = cell.info;
							tempos.push({ tick, bpm });
						}

						break;
					case X:
						if (cell.info <= 0x80) {
							ch.pan = Math.min(255, Math.round((cell.info * 255) / 128));
						}

						break;
				}
			});
		};

		// `docmd2`: the ticks after the first.
		const often = (): void => {
			cells.forEach((cell, index) => {
				const ch = channels[index];
				if (!cell || cell.command === 0) {
					return;
				}

				const info = resolved(ch, cell);
				switch (cell.command) {
					case D:
						volumeSlide(ch, info, false);
						break;
					case E:
						slide(ch, info, false, 1);
						break;
					case F:
						slide(ch, info, false, -1);
						break;
					case G:
					case L:
						if (cell.command === L) {
							volumeSlide(ch, ch.lastInfo, false);
						}

						if (ch.period !== ch.target && ch.target !== 65535) {
							const step = info << 2;
							ch.period =
								ch.period < ch.target ? Math.min(ch.target, ch.period + step) : Math.max(ch.target, ch.period - step);
						}

						break;
					case K:
						volumeSlide(ch, ch.lastInfo, false);
						break;
					case I:
						tremor(ch, info);
						break;
					case Q:
						if (retrigger(ch, info)) {
							struck[index] = true;
						}

						break;
					case S:
						if (info >> 4 === 0xc && ch.cut > 0) {
							ch.cut--;
							if (ch.cut === 0) {
								ch.sounding = false;
							}
						}

						if (info >> 4 === 0xd && ch.delay > 0 && ch.delayed) {
							ch.delay--;
							if (ch.delay === 0) {
								struck[index] = readNote(ch, ch.delayed);
								ch.delayed = null;
							}
						}

						break;
					case V:
						if (cell.info <= 64) {
							globalVolume = cell.info;
						}

						break;
				}
			});
		};

		for (let pass = 0; pass <= repeats; pass++) {
			for (let t = 0; t < speed; t++) {
				if (t === 0) {
					once(pass);
				} else {
					often();
				}

				cells.forEach((cell, index) => {
					record(index, channels[index], struck[index], cell);
					struck[index] = false;
				});
				tick++;
			}
		}

		if (loopJump !== null) {
			row = loopJump;
		} else if (jumpOrder !== null && loopCount === 0) {
			// A jump or a break leaves any pattern loop behind it.
			order = jumpOrder;
			row = breakRow ?? 0;
			segmentOrder = -1;
			loopStart = -1;
		} else if (++row >= ROWS) {
			row = 0;
			order++;
			loopStart = -1;
		}
	}

	return { ticks: tick, loopTick, tempos, segments, rowStarts, channels: out, ignored, tooLong };
}
