/**
 * `HandleArpeggio` over the whole song: the pitch offsets each `$FB` steps a note through, tick by tick.
 *
 * Under an arpeggio a key-on only restarts the timer (`main.asm:2417-2423`); each step replays the
 * last pitched note at the next offset (`Commands.asm:1177-1237`), so the steps are the pitches
 * heard. The timer runs on every tick of every frame, rests and ties included (`main.asm:2454`), and
 * is held on a frame's last ticks by an opcode every voice's read-ahead rewrites
 * (`main.asm:3231, 3241`), so the voices are run together in the driver's own order.
 */

/** The byte that marks a loop point in a sequence (`Commands.asm:1212-1213`). */
const LOOP_POINT = 0x80;

const NOTE_TIE = 0xc6;
const REST = 0xc7;
const FIRST_DRUM = 0xd0;

/** The hot-patch bits an arpeggio's timing turns on, all clear as a song starts. */
export interface HotPatches {
	/** Byte 0 bit 6: a glissando ends after one base note rather than two (`Commands.asm:902-908`). */
	glissandoOneNote: boolean;
	/** Byte 0 bit 0: an arpeggio's steps are silent through a rest (`Commands.asm:836-845`). */
	quietRests: boolean;
	/** Byte 0 bit 2: the read-ahead follows loops, calls and their ends (`Commands.asm:860-874`). */
	readaheadInLoops: boolean;
	/** Byte 1 bit 0: a rest keys off only where the read-ahead finds it (`Commands.asm:920-926`). */
	restsInReadahead: boolean;
}

export const NO_HOT_PATCHES: HotPatches = {
	glissandoOneNote: false,
	quietRests: false,
	readaheadInLoops: false,
	restsInReadahead: false,
};

/** `HotPatchPresetTable`'s two bytes for each preset (`Commands.asm:1044-1064`). */
const PRESETS: readonly (readonly [number, number])[] = [
	[0x80, 0x00],
	[0xff, 0x00],
	[0x80, 0x00],
	[0x80, 0x01],
	[0x80, 0x01],
	[0x88, 0x00],
	[0x80, 0x01],
	[0x80, 0x01],
];

/**
 * The bits `$FA $7F` (a preset) or `$FA $FE` (the bits themselves) leaves, from the operands after
 * the sub-command; every bit is written each time. `null` for a preset past the table, whose bytes
 * the driver still reads (`Commands.asm:691-693`) but which say nothing.
 */
export function hotPatchesAfter(sub: number, operands: readonly number[]): HotPatches | null {
	const first = operands[0] ?? 0;
	const bytes = sub === 0xfe ? [first, first & 0x80 ? (operands[1] ?? 0) : 0] : PRESETS[first & 0x7f];
	if (bytes === undefined) {
		return null;
	}

	return {
		glissandoOneNote: (bytes[0] & 0x40) !== 0,
		quietRests: (bytes[0] & 0x01) !== 0,
		readaheadInLoops: (bytes[0] & 0x04) !== 0,
		restsInReadahead: (bytes[1] & 0x01) !== 0,
	};
}

/** The arpeggio state the driver keeps for one channel (`main.asm:110-117`). */
export interface ArpeggioRun {
	/** `!ArpNoteCount`: the sequence's length, or the glissando's base notes left; 0 is off. */
	count: number;
	/** `!ArpType`: 0 a sequence, 1 a trill, 2 a glissando that ends itself, 3 and up one that never does. */
	type: number;
	/** `!ArpLength`: ticks between steps. */
	length: number;
	/** `!ArpTimeLeft`. */
	timeLeft: number;
	/** `!ArpNoteIndex`. */
	index: number;
	/** `!ArpCurrentDelta`, the offset of the step sounding now, as the unsigned byte it is held in. */
	delta: number;
	/** `!ArpSpecial`: the sequence's loop point, or the trill's or glissando's step. */
	special: number;
	/** The bytes `!ArpNotePtrs` points at. */
	sequence: readonly number[];
	/** False once the driver's next step cannot be known: a sequence read past its end, or a glissando's note count. */
	vouched: boolean;
}

/** A channel at the start of a song, which zeroes the count, the index and the delta (`main.asm:2149-2151`). */
export function startRun(): ArpeggioRun {
	return { count: 0, type: 0, length: 0, timeLeft: 0, index: 0, delta: 0, special: 0, sequence: [], vouched: true };
}

/** `cmdFB` (`Commands.asm:1094-1150`), under the hot patches in force; `null` where they are not known. */
export function setArpeggio(run: ArpeggioRun, operands: readonly number[], patches: HotPatches | null): void {
	const [count = 0, length = 0, ...rest] = operands;
	run.length = length;
	run.timeLeft = length;
	run.delta = 0;
	run.vouched = true;
	if (count < 0x80) {
		run.count = count;
		run.type = 0;
		run.index = 0;
		run.special = 0;
		run.sequence = rest.slice(0, count);
		return;
	}

	run.type = (count & 0x7f) + 1;
	run.special = rest[0] ?? 0;
	// The count is only a flag for every type but 2, which counts base notes down with it.
	run.count = patches?.glissandoOneNote ? 1 : 2;
	run.vouched = patches !== null || run.type !== 2;
}

/**
 * A pitched note keying on (`main.asm:2417-2433`): the timer is set to step on this tick, and a
 * glissando of type 2 counts the note off. Returns whether the arpeggio plays the note; one that
 * does not plays it plainly, with the delta cleared.
 */
export function keyOn(run: ArpeggioRun): boolean {
	if (run.count === 0) {
		return false;
	}

	run.timeLeft = 1;
	run.index = 0xff;
	if (run.type === 2) {
		run.count--;
		if (run.count === 0) {
			run.delta = 0;
			return false;
		}
	}

	return true;
}

/** One frame of a channel, as the arpeggio's timer and the read-ahead see it. */
export interface ArpeggioFrame {
	kind: "frame";
	/** The tick it is fetched on. */
	tick: number;
	/** `$0200+x`. */
	ticks: number;
	/** `$0100+x`, the gate counter the fetch sets (`main.asm:2440-2449`). */
	gateCounter: number;
	/** The frame's byte: a note, a tie, a rest or a drum. */
	byte: number;
	/** The `WalkNote` it sounds or extends, or -1 for a rest. */
	note: number;
	/** The note, tie, rest or drum byte the read-ahead stops at, or 0 for the `$00` it keys off at. */
	next: number;
	/** Whether the read-ahead passed a loop, a call or a `$00` to get there. */
	crossed: boolean;
}

/** What a channel runs, in its own order: its frames, and the commands that bear on an arpeggio. */
export type ArpeggioEvent =
	| ArpeggioFrame
	| { kind: "set"; operands: readonly number[] }
	| { kind: "legato" }
	| { kind: "wait" }
	| { kind: "patches"; patches: HotPatches | null }
	| { kind: "remote"; type: number; time: number };

/** One voice while {@link stepArpeggios} runs. */
interface Voice {
	events: readonly ArpeggioEvent[];
	at: number;
	frame: ArpeggioFrame | null;
	/** Ticks into {@link frame}. */
	into: number;
	run: ArpeggioRun;
	/** The note collecting this voice's steps, or -1. */
	collecting: number;
	/** `$0161`'s bit, legato switched on. */
	legato: boolean;
	/** `$0162`'s bit: keyed on since the last rest, which is when legato holds (`main.asm:3188-3197`). */
	keyed: boolean;
	/** In `$47` this tick, which `$0162` takes at the tick's end (`main.asm:2520-2525`). */
	keying: boolean;
	/** Keyed off since the last key-on. */
	off: boolean;
	/** `!InRest`, set by a rest (`main.asm:365-367`) and cleared by the next note played (`main.asm:393-394`). */
	inRest: boolean;
	/** `!PreviousNote` is a rest, which only {@link HotPatches.quietRests} saves. */
	afterRest: boolean;
	/** `!remoteCodeType`, `!remoteCodeTimeValue` and `!remoteCodeType2` (`Commands.asm:1242-1279`). */
	remote: number;
	remoteTime: number;
	remoteKeyOn: number;
}

/**
 * Runs every channel's arpeggio for `ticks` ticks, voice by voice within each tick as the driver
 * does (`main.asm:2328-2459`), and returns each note's steps: the offset of each, in semitones,
 * read as the signed byte the driver adds to the note (`main.asm:443-444`).
 *
 * A note's entry is `null` with no arpeggio playing it, on a drum, or where the steps cannot be
 * known, and empty where the timer is held on every one of its ticks, so it is never keyed on;
 * one whose silence turns on a read-ahead the walk cannot vouch for is `null` instead.
 */
export function stepArpeggios(
	channels: readonly (readonly ArpeggioEvent[])[],
	ticks: number,
	notes: number,
): (number[] | null)[] {
	const steps = new Array<number[] | null>(notes).fill(null);
	const unsure = new Set<number>();
	let patches: HotPatches | null = NO_HOT_PATCHES;
	let waitTime = 2;
	// The shared opcode as `main.asm:1156` assembles it: the `beq` that holds the timer.
	let holding = true;
	let certain = true;
	const voices: Voice[] = channels.map((events) => ({
		events,
		at: 0,
		frame: null,
		into: 0,
		run: startRun(),
		collecting: -1,
		legato: false,
		keyed: false,
		keying: false,
		off: true,
		inRest: false,
		afterRest: false,
		remote: 0,
		remoteTime: 0,
		remoteKeyOn: 0,
	}));

	const stop = (voice: Voice): void => {
		if (voice.collecting >= 0) {
			steps[voice.collecting] = null;
			voice.collecting = -1;
		}
	};

	/** `ShouldSkipKeyOff` (`main.asm:2949-3161`): whether the read-ahead leaves the voice keyed on. */
	const skipsKeyOff = (voice: Voice, frame: ArpeggioFrame, left: number): { skip: boolean; certain: boolean } => {
		if (patches === null || (patches.readaheadInLoops && frame.crossed)) {
			return { skip: false, certain: false };
		}

		if (frame.next === NOTE_TIE) {
			return { skip: true, certain: true };
		}

		if (voice.legato && voice.keyed) {
			return { skip: true, certain: true };
		}

		if (!voice.inRest && (voice.remoteKeyOn === 6 || voice.remote === 3)) {
			// Remote code that runs at the key-off instead takes it, ahead of a rest or before `!WaitTime`.
			return { skip: frame.next === REST || left !== waitTime, certain: true };
		}

		return { skip: false, certain: true };
	};

	const fetch = (voice: Voice, tick: number): void => {
		voice.frame = null;
		for (; voice.at < voice.events.length; voice.at++) {
			const event = voice.events[voice.at];
			switch (event.kind) {
				case "set":
					setArpeggio(voice.run, event.operands, patches);
					break;
				case "legato":
					// `SubC_1` (`Commands.asm:588-593`).
					voice.legato = !voice.legato;
					voice.keyed = false;
					break;
				case "wait":
					waitTime ^= 3;
					break;
				case "patches":
					patches = event.patches;
					break;
				case "remote":
					if (event.type === 0) {
						voice.remote = 0;
						voice.remoteKeyOn = 0;
					} else if (event.type === 7) {
						voice.remote = 0;
					} else if (event.type === 8) {
						voice.remoteKeyOn = 0;
					} else if (event.type === 6 || event.type === 0xff) {
						voice.remoteKeyOn = event.type;
					} else if (event.type !== 4) {
						voice.remote = event.type;
						voice.remoteTime = event.time;
					}

					break;
				case "frame":
					if (event.tick === tick) {
						voice.at++;
						start(voice, event);
					}

					return;
			}
		}
	};

	/** `HandleArpeggioInterrupt` and `NoteVCMD` on the frame's own byte (`main.asm:355-388, 2403-2438`). */
	const start = (voice: Voice, frame: ArpeggioFrame): void => {
		voice.frame = frame;
		voice.into = 0;
		const { byte } = frame;
		if (byte === NOTE_TIE) {
			if (voice.collecting !== frame.note) {
				voice.collecting = -1;
			}

			return;
		}

		voice.collecting = -1;
		if (byte >= FIRST_DRUM) {
			played(voice);
			return;
		}

		if (byte >= REST) {
			voice.inRest = true;
			voice.afterRest = patches?.quietRests === true && byte === REST;
			if (!patches?.restsInReadahead && voice.remote !== 3 && voice.remoteKeyOn !== 6) {
				voice.keyed = false;
				voice.off = true;
			}

			return;
		}

		voice.afterRest = false;
		if (!keyOn(voice.run)) {
			played(voice);
		} else if (voice.run.vouched && patches !== null) {
			steps[frame.note] = [];
			voice.collecting = frame.note;
			if (!voice.off) {
				unsure.add(frame.note);
			}
		}
	};

	/** `NormalNote` keying the voice on (`main.asm:393-394, 460`). */
	const played = (voice: Voice): void => {
		voice.inRest = false;
		voice.keying = true;
	};

	/** The read-ahead's key-off checks (`main.asm:3212-3243`), on a tick that fetches nothing. */
	const readAhead = (voice: Voice, frame: ArpeggioFrame): void => {
		const left = frame.ticks - voice.into;
		const gate = (frame.gateCounter - voice.into) & 0xff;
		// Remote code timed before the key-off asks the same question first (`main.asm:3217-3232`).
		const timed = (voice.remote === 2 || voice.remote === 5) && gate !== 0 && gate === voice.remoteTime;
		const keyOff = gate === 0 || left === waitTime;
		if (keyOff || timed) {
			const answer = skipsKeyOff(voice, frame, left);
			holding = !answer.skip;
			certain = answer.certain;
			if (keyOff && !answer.skip) {
				voice.off = true;
			}
		}
	};

	/** `HandleArpeggio` (`Commands.asm:1152-1239`). */
	const handle = (voice: Voice, frame: ArpeggioFrame): void => {
		const { run } = voice;
		if (run.count === 0) {
			return;
		}

		if (!run.vouched || patches === null) {
			stop(voice);
			return;
		}

		const left = frame.ticks - voice.into;
		if (holding && waitTime < run.length && waitTime >= left) {
			if (!certain && voice.collecting >= 0) {
				unsure.add(voice.collecting);
			}

			return;
		}

		run.timeLeft = (run.timeLeft - 1) & 0xff;
		if (run.timeLeft === waitTime && !(voice.legato && voice.keyed)) {
			voice.off = true;
		}

		if (run.timeLeft !== 0) {
			return;
		}

		const offset = takeStep(run);
		if (offset === null) {
			stop(voice);
			return;
		}

		if (!(patches.quietRests && voice.afterRest)) {
			played(voice);
		}

		if (voice.collecting >= 0) {
			steps[voice.collecting]?.push(offset);
		}
	};

	for (let tick = 0; tick < ticks; tick++) {
		for (const voice of voices) {
			if (voice.frame === null || voice.into >= voice.frame.ticks) {
				fetch(voice, tick);
			} else {
				readAhead(voice, voice.frame);
			}

			if (voice.frame !== null) {
				handle(voice, voice.frame);
				voice.into++;
			}
		}

		for (const voice of voices) {
			if (voice.keying) {
				voice.keyed = true;
				voice.off = false;
				voice.keying = false;
			}
		}
	}

	for (const note of unsure) {
		if (steps[note]?.length === 0) {
			steps[note] = null;
		}
	}

	return steps;
}

/** `HandleArpeggio_doStuff` (`Commands.asm:1177-1224`); `null` once a sequence reads past its end. */
function takeStep(run: ArpeggioRun): number | null {
	if (run.type === 0) {
		for (;;) {
			let index = (run.index + 1) & 0xff;
			if (index === run.count) {
				index = run.special;
			}

			run.index = index;
			const byte = run.sequence[index];
			if (byte === undefined) {
				// A trailing `$80` sends the index to the count, and the driver reads on into the song.
				run.vouched = false;
				return null;
			}

			if (byte !== LOOP_POINT) {
				run.delta = byte;
				break;
			}

			run.special = (index + 1) & 0xff;
		}
	} else if (run.type === 1) {
		run.delta ^= run.special;
	} else {
		run.delta = (run.delta + run.special) & 0xff;
	}

	run.timeLeft = run.length;
	return (run.delta << 24) >> 24;
}
