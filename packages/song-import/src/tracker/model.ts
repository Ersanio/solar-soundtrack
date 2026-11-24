/**
 * What a tracker module's reader and player hand the writer, in units no one format owns: a sample's
 * PCM and the rate it plays at on its reference note, and every channel's pitch in semitones from that
 * note, tick by tick.
 *
 * Each format (MOD, S3M, XM, IT) reads its own file and plays it with its own replayer's rules, then
 * records what each channel sounds here, so the sample planner and the writer serve them all alike.
 * Times are tracker ticks, one of which is 2500/BPM ms in every format.
 */

/** A sample, as every format's reader leaves it. `pcm` is empty for an unused slot. */
export interface TrackerSample {
	/** From 1, as the song names it. */
	index: number;
	name: string;
	/** 16-bit; an 8-bit sample is scaled by 256. */
	pcm: Int16Array;
	/** Frames a second at the format's reference note (MOD C-2, S3M C-4, XM C-4, IT C-5): pitch 0. */
	baseHz: number;
	/** In frames; `loopLength` 0 means the sample plays once. */
	loopStart: number;
	loopLength: number;
}

export interface TrackerSong {
	/** The format's name, for the song's comments and the dialog: `MOD`, `S3M`, `XM` or `IT`. */
	format: string;
	title: string;
	/** What the dialog's summary names the file as: a MOD's signature, otherwise the format. */
	tag: string;
	channels: number;
	/** How many orders the song lists. */
	orders: number;
	/** Every slot, in index order, `samples[i - 1]` being sample `i`. */
	samples: TrackerSample[];
	/** The sample data ran past the end of the file; what was there is kept. */
	truncated: boolean;
}

/** What one channel sounds on every tick of the song. */
export interface ChannelTicks {
	/** The sample sounding, from 1, or 0 where nothing does. */
	sample: number[];
	/** Semitones from the sample's reference note, fractional through a slide; vibrato and arpeggio not folded in. */
	pitch: number[];
	/** 0-64, tremolo not folded in. */
	volume: number[];
	/** 0 (left) to 255 (right). */
	pan: number[];
	/** 1 on a tick a note is struck. */
	keyOn: number[];
	/** A vibrato's phase step, in 256ths of a cycle a tick, on the ticks one runs, else 0. */
	vibratoRate: number[];
	/** Its swing either way, in semitones. */
	vibratoDepth: number[];
	/** A tremolo's phase step, in 256ths of a cycle a tick, on the ticks one runs, else 0. */
	tremoloRate: number[];
	/** Its swing either way, in volume units of 64. */
	tremoloDepth: number[];
	/** `x << 4 | y`, the semitones of an arpeggio's two upper steps, on the ticks one runs, else 0. */
	arpeggio: number[];
}

/** Where a pass through an order starts: the writer's unit of text, and the place a loop can return to. */
export interface Segment {
	tick: number;
	order: number;
	row: number;
}

/** Effects the conversion leaves out, counted for the porter. */
export interface Ignored {
	/** A sample offset on a struck note: AddmusicK plays a sample from its start. */
	offsets: number;
	/** Effects with no AddmusicK equivalent, each counted where it is used. */
	unsupported: number;
}

export interface TrackerPlay {
	/** The song's length in ticks, to its end or its jump back. */
	ticks: number;
	/** The tick the song loops back to. */
	loopTick: number;
	/** The tempo, from tick 0, at each change. */
	tempos: { tick: number; bpm: number }[];
	segments: Segment[];
	/** The tick each row starts on. */
	rowStarts: number[];
	channels: ChannelTicks[];
	ignored: Ignored;
	/** The song ran past the player's limit without coming back round. */
	tooLong: boolean;
}

/** An empty record of one channel. */
export function channelTicks(): ChannelTicks {
	return {
		sample: [],
		pitch: [],
		volume: [],
		pan: [],
		keyOn: [],
		vibratoRate: [],
		vibratoDepth: [],
		tremoloRate: [],
		tremoloDepth: [],
		arpeggio: [],
	};
}
