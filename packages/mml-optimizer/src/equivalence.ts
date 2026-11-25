/** Whether two compiled songs play alike: their walks compared note by note and command by command, loops and `$FA $02` aside. */

import { type SongTimeline, type WalkNote, vcmdLength, walkSong } from "@amk/spc/song-walk";

/** Where two songs first part: the channel, and the address in the second song nearest it. */
export interface Divergence {
	channel: number | null;
	/** An address in the second song at or before where it parts from the first, or null. */
	address: number | null;
	what: string;
	/** The two entries that differ, for a trace. */
	detail?: string;
}

const STRUCTURE = new Set([0xe6, 0xe9]);

function noteKey(note: WalkNote): string {
	const { tune, ...state } = note.state;
	return JSON.stringify([
		note.tick,
		note.ticks,
		note.gateTicks,
		note.vibratoTicks,
		note.arpeggioSteps,
		note.key === null ? null : note.key + tune,
		note.percussion,
		note.bend,
		note.percussion === null ? note.note + tune : note.note,
		state,
	]);
}

interface Keyed {
	key: string;
	address: number;
}

function commands(timeline: SongTimeline, song: Uint8Array, aram: number, channel: number): Keyed[] {
	return timeline.commands
		.filter((c) => {
			if (c.channel !== channel || STRUCTURE.has(c.vcmd)) {
				return false;
			}
			return !(c.vcmd === 0xfa && song[c.address - aram + 1] === 0x02);
		})
		.map((c) => {
			const at = c.address - aram;
			const raw = Array.from(song.subarray(at, at + vcmdLength(song, at)));
			// A remote call points into the loop block, which moves with every channel's length:
			// what it runs is what has to match. A high byte of 1 is remote gain, not an address.
			const bytes = c.vcmd === 0xfc && raw[2] !== 0x01 && (raw[1] | raw[2]) !== 0 ? remoteBody(song, aram, raw) : raw;
			return { key: `${c.tick}:${bytes.join(",")}:${c.onANote}`, address: c.address };
		});
}

/** A `$FC` call with its address replaced by the bytes of the body it names, up to its `$00`. */
function remoteBody(song: Uint8Array, aram: number, call: number[]): number[] {
	const start = (call[1] | (call[2] << 8)) - aram;
	const body: number[] = [];
	for (let at = start; at >= 0 && at < song.length && body.length < 256; at++) {
		if (song[at] === 0) {
			break;
		}
		body.push(song[at]);
	}
	return [call[0], call[3], call[4], -1, ...body];
}

function firstDifference(a: Keyed[], b: Keyed[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if (a[i]?.key !== b[i]?.key) {
			return i;
		}
	}
	return -1;
}

/** Compares the songs `a` and `b`, compiled to load at `aramA` and `aramB`, or null when they play alike. */
export function compareSongs(a: Uint8Array, aramA: number, b: Uint8Array, aramB: number): Divergence | null {
	const ta = walkSong(a, aramA);
	const tb = walkSong(b, aramB);
	if (ta.truncated || tb.truncated || ta.problems.length !== tb.problems.length) {
		return { channel: null, address: null, what: "walk" };
	}

	const tempo = (t: SongTimeline) =>
		JSON.stringify([t.ticks, t.loopTick, t.tempoChanges.map((c) => [c.tick, c.tempo, c.fadeTicks, c.repeats])]);
	if (tempo(ta) !== tempo(tb)) {
		return { channel: null, address: null, what: "timing" };
	}

	for (let channel = 0; channel < 8; channel++) {
		const notes = (t: SongTimeline) =>
			t.notes.filter((n) => n.channel === channel).map((n) => ({ key: noteKey(n), address: n.address }));
		const na = notes(ta);
		const nb = notes(tb);
		const noteAt = firstDifference(na, nb);
		if (noteAt >= 0) {
			return {
				channel,
				address: nb[Math.min(noteAt, nb.length - 1)]?.address ?? null,
				what: "note",
				detail: `${na[noteAt]?.key}\n${nb[noteAt]?.key}`,
			};
		}

		const ca = commands(ta, a, aramA, channel);
		const cb = commands(tb, b, aramB, channel);
		const commandAt = firstDifference(ca, cb);
		if (commandAt >= 0) {
			return {
				channel,
				address: cb[Math.min(commandAt, cb.length - 1)]?.address ?? null,
				what: "command",
				detail: `${ca[commandAt]?.key}\n${cb[commandAt]?.key}`,
			};
		}

		if (ta.channelTicks[channel] !== tb.channelTicks[channel] || ta.used[channel] !== tb.used[channel]) {
			return { channel, address: null, what: "channel" };
		}
	}

	// `unreachable` is not compared: it counts addresses past the pass, and a body played out has more.
	return null;
}
