/**
 * The channel settings a looping song can carry from the end of one pass into
 * the next.
 *
 * `PlaySong` (`main.asm:2082-2206`) sets each of these when a song starts, and
 * the phrase change that loops the song (`L_0C01`, `main.asm:2283-2326`) sets
 * none of them, so a pass hands its repeat whatever it ended on. Each is a small
 * model of what the driver keeps: its value at the start of a song, and what a
 * command, a frame's `q` byte or a note does to it.
 *
 * The tempo is the one such setting kept apart, as `SongTimeline.tempoAtEnd`.
 *
 * Deliberately not here:
 *   - `$DD`, which runs once on the note that reads it, and `$E6`/`$E9`, which
 *     are the shape of the music rather than a setting.
 *   - `l`, `o` and `h`, which the compiler resolves into note bytes; it writes a
 *     length byte on the first note after `/` (`parser.ts:1761`).
 *   - `$F4 $05`, `$F4 $07` and `$F9`, which talk to the game, not the speakers.
 *   - `$F6`, a raw DSP write that the driver's own copies overwrite, so nothing
 *     says what it leaves behind.
 *   - `$FA $04`, which AddmusicK writes ahead of the song itself.
 *   - Hot-patch bit 6's one-note glissando and bit 4's `$F3` sub-multiplier.
 *   - Anything inside a `$FC` body, which the walk does not follow.
 */

/** Settings the driver keeps per channel. */
export const CHANNEL_SETTINGS = [
	"instrument",
	"volume",
	"pan",
	"vibrato",
	"tremolo",
	"fineTune",
	"semitoneTune",
	"pitchEnvelope",
	"volumeMultiplier",
	"quantization",
	"noise",
	"arpeggio",
	"legato",
	"remote",
] as const;

export type ChannelSetting = (typeof CHANNEL_SETTINGS)[number];

/** What changed a setting: a command, or a `q` byte or note that a note's frame carries. */
export interface SettingCommand {
	/** ARAM address of the command byte, or of the note's frame — a key into `commandMap` or `noteMap`. */
	address: number;
	/** What the driver read: the command and its operands, a `q` byte, or a note byte. */
	bytes: readonly number[];
	/** A `q` byte or a note, which `noteMap` addresses rather than `commandMap`. */
	onNote: boolean;
	/** It flips the setting rather than setting it, so running it again undoes it. */
	toggle: boolean;
}

/** One setting as it stands: the values the driver keeps, and the command that last changed them. */
export interface SettingState {
	values: readonly number[];
	by: SettingCommand | null;
}

/** What one command does to one setting. */
export interface SettingChange {
	setting: ChannelSetting;
	toggle: boolean;
	/** The values after it. Returns its argument unchanged where the command leaves the setting alone. */
	apply: (values: readonly number[]) => readonly number[];
}

/** A setting the repeat starts its loop under differently from the first pass. */
export interface SettingCarry {
	setting: ChannelSetting;
	/** 0-7. */
	channel: number;
	/** The command in force where the first pass starts the loop, or `null` for the song's start value. */
	first: SettingCommand | null;
	/** The command the pass ended on, which carries over. */
	repeat: SettingCommand;
}

/** A value the driver does not reset, or a slot nothing has written. */
const UNSET = -1;

/** `$ED`'s GAIN mode laid over the instrument's own ADSR1, which the walk does not know. */
const INSTRUMENT_ADSR1_GAIN = -2;

/** A drum's instrument id, kept clear of `$DA`'s 0-255. */
const DRUM = 0x1000;

/** Instrument record slots, as `ApplyInstrument` lays them out (`Commands.asm:224-232`). */
const SRCN = 1;
const ADSR1 = 2;
const ADSR2 = 3;
const GAIN = 4;
const MULTIPLIER = 5;

const NO_RECORD = [UNSET, UNSET, UNSET, UNSET, UNSET, UNSET] as const;

/** Each setting as a song starts it. */
const START: Readonly<Record<ChannelSetting, readonly number[]>> = {
	// `$C1+x` is zeroed (`main.asm:2193`) and the first phrase gives `@0` to a
	// channel still at zero (`main.asm:2319-2321`); `UNSET` is that. It also sets
	// `$C1+x` (`Commands.asm:107-109`), so the phrase change that loops the song
	// finds no channel at zero and resets nothing.
	instrument: [UNSET, ...NO_RECORD],
	volume: [0xff], // main.asm:2138
	pan: [0x0a, 0], // main.asm:2135, 2140
	vibrato: [0, 0, 0, 0], // delay, rate, extent (main.asm:2145), fade
	tremolo: [0, 0, 0], // delay, rate, depth (main.asm:2146)
	fineTune: [0], // main.asm:2142
	semitoneTune: [0], // main.asm:2147
	pitchEnvelope: [0, 0, 0, 0], // sign, delay, length ($0300+x, main.asm:2200), semitones
	volumeMultiplier: [0], // main.asm:2196
	// Not reset, and never needed: the compiler writes one at every channel's
	// first note, since `updateQ` starts true (`parser.ts:216`).
	quantization: [UNSET],
	noise: [0, 0], // on (main.asm:2172), clock
	arpeggio: [0], // count (main.asm:2149-2151, 2196-2199), type, length, notes
	legato: [0], // $0161 (main.asm:2201)
	remote: [UNSET, UNSET, UNSET, UNSET, UNSET, UNSET, UNSET], // both slots (main.asm:2136)
};

/** Every channel setting as a song starts it. */
export function channelStart(): Record<ChannelSetting, SettingState> {
	return Object.fromEntries(
		CHANNEL_SETTINGS.map((setting) => [setting, { values: START[setting], by: null }]),
	) as Record<ChannelSetting, SettingState>;
}

/**
 * Where a zero means the effect is off, whatever else is held: a vibrato's
 * extent, a tremolo's depth and a pitch envelope's length (`main.asm:3291`,
 * `:3366`, `:465-467`), and the noise and arpeggio's own on and count.
 */
const OFF_WHEN_ZERO: Partial<Record<ChannelSetting, number>> = {
	vibrato: 2,
	tremolo: 2,
	pitchEnvelope: 2,
	noise: 0,
	arpeggio: 0,
};

/** Two states that sound alike compare alike: off is off whatever the rate. */
function keyOf(setting: ChannelSetting, values: readonly number[]): string {
	if (setting === "instrument") {
		// A channel that never set one plays `@0`.
		return [Math.max(values[0], 0), ...values.slice(1)].join(",");
	}

	const off = OFF_WHEN_ZERO[setting];
	return off !== undefined && values[off] === 0 ? "off" : values.join(",");
}

const change = (
	setting: ChannelSetting,
	apply: (values: readonly number[]) => readonly number[],
	toggle = false,
): SettingChange => ({ setting, toggle, apply });

const to = (setting: ChannelSetting, values: readonly number[]): SettingChange => change(setting, () => values);

const withAt = (values: readonly number[], at: number, value: number): readonly number[] =>
	values.map((each, index) => (index === at ? value : each));

/** `HandleArpeggio`'s glissando ends itself after its notes (`main.asm:2425-2432`). */
const glissandoNote = change("arpeggio", (values) => {
	if (values[0] === 0 || values[1] < 2) {
		return values;
	}

	return values[0] === 1 ? [0] : [values[0] - 1, ...values.slice(1)];
});

/**
 * What the bytes the driver just read do to the channel's settings.
 *
 * `bytes` is a command and its operands, a frame's `q` byte (below `$80`), or a
 * note byte.
 */
export function settingChanges(bytes: readonly number[]): SettingChange[] {
	const [lead, ...operands] = bytes;
	const arg = (n: number): number => operands[n] ?? 0;
	if (lead === undefined) {
		return [];
	}

	if (lead < 0x80) {
		return [to("quantization", [lead])];
	}

	if (lead < 0xc6) {
		return [glissandoNote];
	}

	if (lead < 0xd0) {
		return []; // a tie or a rest
	}

	if (lead < 0xda) {
		// `PercNote` loads the drum's whole record (`main.asm:382-387`).
		return [to("instrument", [DRUM + lead, ...NO_RECORD]), glissandoNote];
	}

	switch (lead) {
		case 0xda:
			// `cmdDA` clears the channel's noise bit before `SetInstrument` (`Commands.asm:94-98`).
			return [to("instrument", [arg(0), ...NO_RECORD]), change("noise", (v) => [0, v[1]])];
		case 0xdb:
			return [to("pan", [arg(0) & 0x1f, arg(0) & 0xc0])];
		case 0xdc:
			return [change("pan", (v) => [arg(1), v[1]])];
		case 0xde:
			// `$0341+x`, the fade, is zeroed with it (`Commands.asm:274-288`).
			return [to("vibrato", [arg(0), arg(1), arg(2), 0])];
		case 0xdf:
			return [change("vibrato", (v) => withAt(v, 2, 0))];
		case 0xea:
			return [change("vibrato", (v) => withAt(v, 3, arg(0)))];
		case 0xe5:
			return [to("tremolo", [arg(0), arg(1), arg(2)])];
		case 0xfd:
			// `$E5`'s tail, entered with a zero depth (`Commands.asm:353`).
			return [change("tremolo", (v) => withAt(v, 2, 0))];
		case 0xe7:
			return [to("volume", [arg(0)])];
		case 0xe8:
			return [to("volume", [arg(1)])];
		case 0xeb:
		case 0xec:
			// `$0320+x` is 1 for `$EB` (`Commands.asm:434-452`).
			return [to("pitchEnvelope", [lead === 0xeb ? 1 : 0, arg(0), arg(1), arg(2)])];
		case 0xfe:
			return [change("pitchEnvelope", (v) => withAt(v, 2, 0))];
		case 0xed:
			// `backup[1] = XX ^ $80`, and YY is ADSR2 or GAIN by the result's bit 7
			// (`Commands.asm:40-55`).
			return [
				change("instrument", (v) => withAt(withAt(v, ADSR1, arg(0) ^ 0x80), arg(0) < 0x80 ? ADSR2 : GAIN, arg(1))),
			];
		case 0xee:
			return [to("fineTune", [arg(0)])];
		case 0xf3:
			return [change("instrument", (v) => withAt(withAt(v, SRCN, arg(0)), MULTIPLIER, arg(1)))];
		case 0xf4:
			return toggles(arg(0));
		case 0xf8:
			return [to("noise", [1, arg(0) & 0x1f])];
		case 0xfa:
			return settings(arg(0), arg(1));
		case 0xfb:
			return [to("arpeggio", arpeggio(operands))];
		case 0xfc:
			return remote(operands);
		default:
			return [];
	}
}

/** `$F4`'s sub-commands (`Commands.asm:554-614`). */
function toggles(sub: number): SettingChange[] {
	switch (sub) {
		case 0x01:
			return [change("legato", (v) => [v[0] ^ 1], true)];
		case 0x09:
			// Back to the `@`'s own record (`main.asm:839-842`).
			return [change("instrument", (v) => [v[0], ...NO_RECORD])];
		default:
			return [];
	}
}

/** `$FA`'s sub-commands (`Commands.asm:659-682`). */
function settings(sub: number, value: number): SettingChange[] {
	switch (sub) {
		case 0x01:
			// GAIN, with ADSR1's enable bit cleared (`Commands.asm:76-84`).
			return [
				change("instrument", (v) =>
					withAt(withAt(v, GAIN, value), ADSR1, v[ADSR1] >= 0 ? v[ADSR1] & 0x7f : INSTRUMENT_ADSR1_GAIN),
				),
			];
		case 0x02:
			return [to("semitoneTune", [value])];
		case 0x03:
			return [to("volumeMultiplier", [value])];
		default:
			return [];
	}
}

/** `$FB`: count, type, step length, then the notes or the trill/glissando delta (`Commands.asm:1094-1240`). */
function arpeggio(operands: readonly number[]): readonly number[] {
	const [count = 0, length = 0, ...rest] = operands;
	if (count === 0) {
		return [0];
	}

	// A count below `$80` is a list of notes; at `$80` and up, a trill (type 1)
	// or a glissando (2 and up), forced to two notes.
	return count < 0x80 ? [count, 0, length, ...rest.slice(0, count)] : [2, (count & 0x7f) + 1, length, rest[0] ?? 0];
}

/** `$FC`'s two slots, normal and key-on (`Commands.asm:1242-1352`). */
function remote(operands: readonly number[]): SettingChange[] {
	const [low = 0, high = 0, type = 0, time = 0] = operands;
	switch (type) {
		case 0x00:
			return [to("remote", START.remote)];
		case 0x04:
			return []; // runs once and keeps nothing
		case 0x07:
			return [change("remote", (v) => [UNSET, UNSET, UNSET, UNSET, v[4], v[5], v[6]])];
		case 0x08:
			return [change("remote", (v) => [v[0], v[1], v[2], v[3], UNSET, UNSET, UNSET])];
		case 0x06:
		case 0xff:
			return [change("remote", (v) => [v[0], v[1], v[2], v[3], type, low, high])];
		default:
			return [change("remote", (v) => [type, low, high, time, v[4], v[5], v[6]])];
	}
}

/**
 * The channel settings that differ where the loop starts.
 *
 * `atLoop` is the channel at its first note or rest after the loop point, and
 * `loopHead` what ran between the loop point and there. The repeat replays that
 * onto what the pass ended on, which is what makes a toggle right: one written
 * at the loop start flips both passes and fixes nothing.
 */
export function channelCarries(
	channel: number,
	atLoop: Readonly<Record<ChannelSetting, SettingState>>,
	loopHead: readonly SettingChange[],
	atEnd: Readonly<Record<ChannelSetting, SettingState>>,
): SettingCarry[] {
	return CHANNEL_SETTINGS.flatMap((setting): SettingCarry[] => {
		const first = atLoop[setting];
		const carried = atEnd[setting];
		let again = carried.values;
		for (const each of loopHead) {
			if (each.setting === setting) {
				again = each.apply(again);
			}
		}

		return carried.by === null || keyOf(setting, first.values) === keyOf(setting, again)
			? []
			: [{ setting, channel, first: first.by, repeat: carried.by }];
	});
}
