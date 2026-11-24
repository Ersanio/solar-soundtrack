/**
 * A MOD played tick by tick, the way ProTracker's replayer plays it: what each channel sounds on
 * every tick, and where the song loops.
 *
 * The effects follow 8bitbubsy's `pt2_replayer.c`: tick 0 reads the row and runs 9, B, C, D, F and
 * the E commands; the ticks after it run the slides (1, 2, 3, 5, A), the vibrato, the tremolo and
 * the arpeggio. The periods are the file's own, and slide in period units; each tick is recorded in
 * the tracker model's units, the period as semitones from the sample's C-2. What a writer needs of the
 * vibrato, the tremolo and the arpeggio is their rate and swing on each tick rather than what they do
 * to the period and the volume, since `$DE`, `$E5` and `$FB` make their own. Times are MOD ticks: one
 * is 2500/BPM ms.
 */

import { type ChannelTicks, type Ignored, type Segment, type TrackerPlay, channelTicks } from "../tracker/model";
import type { ModFile } from "./file";

/** PAL Paula's clock over two: a period of P plays `PAULA_HZ / P` frames a second. */
export const PAULA_HZ = 3_546_895;

/** The period ProTracker's C-2 has at finetune 0: a sample's default note. */
export const C2_PERIOD = 428;

const ROWS = 64;
/** About an hour at 125 BPM: a song still running here is taken to never end. */
const TICK_LIMIT = 180_000;

interface Channel {
	sample: number;
	playing: number;
	period: number;
	finetune: number;
	volume: number;
	pan: number;
	sounding: boolean;
	/** Frames left of a one-shot sample, `Infinity` for a looped one. */
	left: number;
	portaTarget: number;
	portaSpeed: number;
	vibratoSpeed: number;
	vibratoDepth: number;
	tremoloSpeed: number;
	tremoloDepth: number;
	loopRow: number;
	loopCount: number;
}

/** The period a cell's note plays at under a finetune: ProTracker's finetuned tables, as a ratio. */
function finetuned(period: number, finetune: number): number {
	return finetune === 0 ? period : Math.round(period * 2 ** (-finetune / 96));
}

/** Plays the song once through, to its end or to the first row it comes back to. */
export function playMod(mod: ModFile): TrackerPlay {
	const out: ChannelTicks[] = Array.from({ length: mod.channels }, channelTicks);
	// Amiga hard panning, L R R L, repeated across the channels.
	const channels: Channel[] = Array.from({ length: mod.channels }, (_, i) => ({
		sample: 0,
		playing: 0,
		period: 0,
		finetune: 0,
		volume: 0,
		pan: (i & 3) === 0 || (i & 3) === 3 ? 0 : 255,
		sounding: false,
		left: 0,
		portaTarget: 0,
		portaSpeed: 0,
		vibratoSpeed: 0,
		vibratoDepth: 0,
		tremoloSpeed: 0,
		tremoloDepth: 0,
		loopRow: 0,
		loopCount: 0,
	}));
	const ignored: Ignored = { offsets: 0, unsupported: 0 };
	const minPeriod = mod.amiga ? 113 : 14;
	const maxPeriod = mod.amiga ? 856 : 6848;
	const tempos: { tick: number; bpm: number }[] = [{ tick: 0, bpm: 125 }];
	const segments: Segment[] = [];
	const rowStarts: number[] = [];
	const visited = new Map<string, number>();

	let speed = 6;
	let bpm = 125;
	let tick = 0;
	let order = 0;
	let row = 0;
	let loopTick: number;
	let tooLong = false;
	let segmentOrder = -1;

	const strike = (ch: Channel, period: number): void => {
		const sample = mod.samples[ch.sample - 1];
		ch.playing = ch.sample;
		ch.period = finetuned(period, ch.finetune);
		ch.sounding = sample !== undefined && sample.pcm.length > 0;
		ch.left = sample && sample.loopLength > 0 ? Infinity : (sample?.pcm.length ?? 0);
	};

	const record = (
		index: number,
		ch: Channel,
		struck: boolean,
		vibrato: number,
		tremolo: number,
		arpeggio: number,
	): void => {
		const o = out[index];
		const sounding = ch.sounding && ch.period > 0;
		const finetune = mod.samples[ch.playing - 1]?.finetune ?? 0;
		o.sample.push(sounding ? ch.playing : 0);
		o.pitch.push(sounding ? 12 * Math.log2(C2_PERIOD / ch.period) - finetune / 8 : 0);
		o.volume.push(ch.volume);
		o.pan.push(ch.pan);
		o.keyOn.push(struck && sounding ? 1 : 0);
		// The phase steps 4 × speed of 256 a tick; the period swings by up to `255 × depth >> 7` either way,
		// the volume by `255 × depth >> 6` (`pt2_replayer.c`).
		const vibratoDepth = vibrato & 0x0f;
		const swing = (255 * vibratoDepth) >> 7;
		o.vibratoRate.push(4 * (vibrato >> 4));
		o.vibratoDepth.push(
			vibratoDepth > 0 && ch.period > 0
				? (12 * Math.log2((ch.period + swing) / Math.max(1, ch.period - swing))) / 2
				: 0,
		);
		o.tremoloRate.push(4 * (tremolo >> 4));
		o.tremoloDepth.push((255 * (tremolo & 0x0f)) >> 6);
		o.arpeggio.push(arpeggio);
		// A one-shot runs out as it plays: the frames this tick takes at this period and tempo.
		if (sounding && ch.left !== Infinity) {
			ch.left -= PAULA_HZ / ch.period / (bpm * 0.4);
			if (ch.left <= 0) {
				ch.sounding = false;
			}
		}
	};

	for (;;) {
		if (order >= mod.orders.length) {
			loopTick = visited.get(`${mod.restart}:0`) ?? 0;
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
		const cells = mod.patterns[mod.orders[order]][row];
		let jumpOrder: number | null = null;
		let breakRow: number | null = null;
		let loopJump: number | null = null;
		let repeats = 0;
		let stop = false;
		const delays: (number | null)[] = cells.map(() => null);

		// Tick 0: the row's notes and its once-a-row effects, channel by channel.
		cells.forEach((cell, index) => {
			const ch = channels[index];
			const x = cell.param >> 4;
			const y = cell.param & 0x0f;
			const extended = cell.effect === 0x0e ? x : -1;
			if (cell.sample > 0) {
				ch.sample = cell.sample;
				const sample = mod.samples[cell.sample - 1];
				ch.volume = sample?.volume ?? 0;
				ch.finetune = sample?.finetune ?? 0;
			}

			if (extended === 0x5) {
				ch.finetune = y >= 8 ? y - 16 : y;
			}

			if (cell.period > 0) {
				if (cell.effect === 0x3 || cell.effect === 0x5) {
					ch.portaTarget = finetuned(cell.period, ch.finetune);
				} else if (extended === 0xd && y > 0) {
					if (y < speed) {
						delays[index] = cell.period;
					} else {
						ignored.unsupported++;
					}
				} else {
					strike(ch, cell.period);
					if (cell.effect === 0x9) {
						ignored.offsets++;
					}
				}
			}

			switch (cell.effect) {
				case 0x3:
					if (cell.param > 0) {
						ch.portaSpeed = cell.param;
					}

					break;
				case 0x4:
					ch.vibratoSpeed = x || ch.vibratoSpeed;
					ch.vibratoDepth = y || ch.vibratoDepth;
					break;
				case 0x7:
					ch.tremoloSpeed = x || ch.tremoloSpeed;
					ch.tremoloDepth = y || ch.tremoloDepth;
					break;
				case 0x8:
					ch.pan = cell.param;
					break;
				case 0xb:
					jumpOrder = cell.param;
					breakRow = 0;
					break;
				case 0xc:
					ch.volume = Math.min(64, cell.param);
					break;
				case 0xd:
					breakRow = x * 10 + y;
					if (breakRow > 63) {
						breakRow = 0;
					}

					jumpOrder ??= order + 1;
					break;
				case 0xf:
					if (cell.param === 0) {
						stop = true;
					} else if (cell.param < 0x20) {
						speed = cell.param;
					} else if (cell.param !== bpm) {
						bpm = cell.param;
						tempos.push({ tick, bpm });
					}

					break;
				case 0xe:
					switch (x) {
						case 0x1:
							ch.period = Math.max(minPeriod, ch.period - y);
							break;
						case 0x2:
							ch.period = Math.min(maxPeriod, ch.period + y);
							break;
						case 0x3:
						case 0xf:
							if (y > 0) {
								ignored.unsupported++;
							}

							break;
						case 0x6:
							if (y === 0) {
								ch.loopRow = row;
							} else if (ch.loopCount === 0) {
								ch.loopCount = y;
								loopJump = ch.loopRow;
							} else if (--ch.loopCount > 0) {
								loopJump = ch.loopRow;
							}

							break;
						case 0x8:
							ch.pan = y * 17;
							break;
						case 0xa:
							ch.volume = Math.min(64, ch.volume + y);
							break;
						case 0xb:
							ch.volume = Math.max(0, ch.volume - y);
							break;
						case 0xc:
							if (y === 0) {
								ch.volume = 0;
							}

							break;
						case 0xe:
							repeats = y;
							break;
					}

					break;
			}
		});

		// Every tick of the row, the first included, and of its repeats under EEx.
		for (let pass = 0; pass <= repeats; pass++) {
			for (let t = 0; t < speed; t++) {
				const later = pass > 0 || t > 0;
				cells.forEach((cell, index) => {
					const ch = channels[index];
					const x = cell.param >> 4;
					const y = cell.param & 0x0f;
					const extended = cell.effect === 0x0e ? x : -1;
					let struck =
						!later && cell.period > 0 && cell.effect !== 0x3 && cell.effect !== 0x5 && delays[index] === null;
					struck = struck && !(extended === 0xd && y > 0);

					if (later) {
						if (pass > 0 && t === 0) {
							// A repeat of the row runs its fine slides again.
							if (extended === 0x1) ch.period = Math.max(minPeriod, ch.period - y);
							if (extended === 0x2) ch.period = Math.min(maxPeriod, ch.period + y);
							if (extended === 0xa) ch.volume = Math.min(64, ch.volume + y);
							if (extended === 0xb) ch.volume = Math.max(0, ch.volume - y);
						}

						switch (cell.effect) {
							case 0x1:
								ch.period = Math.max(minPeriod, ch.period - cell.param);
								break;
							case 0x2:
								ch.period = Math.min(maxPeriod, ch.period + cell.param);
								break;
							case 0x3:
							case 0x5:
								if (ch.portaTarget > 0 && ch.period > 0) {
									ch.period =
										ch.period < ch.portaTarget
											? Math.min(ch.portaTarget, ch.period + ch.portaSpeed)
											: Math.max(ch.portaTarget, ch.period - ch.portaSpeed);
								}

								break;
						}

						if (cell.effect === 0x5 || cell.effect === 0x6 || cell.effect === 0xa) {
							ch.volume = x > 0 ? Math.min(64, ch.volume + x) : Math.max(0, ch.volume - y);
						}
					}

					if (extended === 0xc && y > 0 && pass === 0 && t === y) {
						ch.volume = 0;
					}

					if (extended === 0xd && pass === 0 && t === y && delays[index] !== null) {
						strike(ch, delays[index]);
						struck = true;
					}

					if (extended === 0x9 && y > 0 && t % y === 0 && (later || cell.period === 0) && ch.playing > 0) {
						strike(ch, ch.period);
						struck = true;
					}

					const vibrato = cell.effect === 0x4 || cell.effect === 0x6 ? (ch.vibratoSpeed << 4) | ch.vibratoDepth : 0;
					const tremolo = cell.effect === 0x7 ? (ch.tremoloSpeed << 4) | ch.tremoloDepth : 0;
					const arpeggio = cell.effect === 0x0 ? cell.param : 0;
					record(index, ch, struck, vibrato, tremolo, arpeggio);
				});
				tick++;
			}
		}

		if (stop) {
			loopTick = 0;
			break;
		}

		if (jumpOrder !== null) {
			// A jump or a break leaves any pattern loop behind it.
			order = jumpOrder;
			row = breakRow ?? 0;
			segmentOrder = -1;
		} else if (loopJump !== null) {
			row = loopJump;
		} else if (++row >= ROWS) {
			row = 0;
			order++;
		}
	}

	return { ticks: tick, loopTick, tempos, segments, rowStarts, channels: out, ignored, tooLong };
}
