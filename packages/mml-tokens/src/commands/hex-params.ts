import { EMPTY_SAMPLE_NAME } from "@amk/core/tables";
import { noiseHz } from "@amk/spc/adsr";
import { hex2 } from "@amk/core/hex";
import { type ParamDescriptor, type Resolver, choice, fixed, raw, s8, ticks, u8 } from "./param";
import { bpm, noteName, panLabel, percentOf255, ticksLabel } from "./units";

/**
 * The highest tempo that is not a freeze.
 *
 * Every vcmd handler is entered with the carry set — the dispatcher's `asl a`
 * (`main.asm:2659`) shifts out bit 7 of a byte that is always `$DA` or above,
 * and nothing clears it — and `$E2`'s handler is a carry-less
 * `adc a, $0387` / `mov $51, a`. So the driver stores one more than you write,
 * and `$FF` stores `$00`. At tempo 0 the tick accumulator (`main.asm:220-238`)
 * can never carry, so the song stops advancing altogether.
 *
 * Confirmed against the emulator: `t40` stores `$29`, `t192` stores `$C1`,
 * `t254` stores `$FF` and plays, `t255` stores `$00` and the track pointer never
 * moves again. Note the raw form accepts `$00` quite happily — it means tempo 1,
 * the slowest there is — where the letter `t0` is a compile error (AMK0079).
 */
const MAX_TEMPO = 254;

/**
 * What each hex command's arguments mean, `$DA` through `$FE`.
 *
 * Names follow `hex_command_reference.html` so that a reader with the readme
 * open sees the same words; where the readme is wrong or silent — `$DB`'s
 * range, `$F1`'s delay, the `$F5` coefficients' interaction — the note says what
 * the driver actually does and cites it.
 *
 * Nothing here states an argument *count*: `expectedArgs` owns that, and
 * `resolveCommand` pads whatever this table is short of. A resolver may therefore
 * describe only the arguments it can name, which is what makes the
 * value-dependent forms below expressible at all.
 */

// ---------------------------------------------------------------------------
// Shared descriptors
// ---------------------------------------------------------------------------

const DURATION = ticks("Over", {
	describe: (value, _command, context) =>
		value === 0 ? "instant — a duration of 0 applies the target at once" : ticksLabel(value, context.tempo),
});

/**
 * The vibrato and tremolo speed — `$DE`'s and `$E5`'s second byte.
 *
 * The readme calls this "Duration" and links it to the note-length table, which
 * is wrong in both halves. `aram_map.html` calls the byte it lands in
 * (`$0331+x`, `$0361+x`) an "offset per music tempo tick", and the driver adds
 * it to an 8-bit phase accumulator once a tick (`main.asm:3321-3324`) — so it is
 * a speed, bigger is faster, and it is not measured in ticks at all. The `p`
 * command's own entry gets it right, calling the same value "the rate (speed)".
 */
const RATE = (what: string): ParamDescriptor =>
	u8("Rate", "rate", {
		min: 1,
		describe: (value) => (value === 0 ? `a rate of 0 never advances, so the ${what} stays still` : "higher is faster"),
	});

const PAN = u8("Pan", "pan", {
	max: 20,
	describe: (value) => {
		if (value > 0x14) {
			// main.asm:3486 — `PanValues` has 21 entries, and the readme's own $13
			// ceiling is one short of the table it describes.
			return `past the driver's 21-entry pan table, which ends at $14`;
		}

		return panLabel(value);
	},
});

const ECHO_VOLUME = (side: string): ParamDescriptor =>
	s8(`Volume ${side}`, "level", {
		describe: (value) => (value >= 0x80 ? "negative, so this side is phase-inverted" : null),
	});

const SEMITONES = s8("Semitones", "semitones", {
	describe: (value) => (value >= 0x80 ? "bends downward" : "bends upward"),
});

/** `$F4`'s sub-commands, every one the readme documents. */
const F4_SUBCOMMANDS = [
	{ value: 0x00, label: "$00 — Yoshi drums on channel 5" },
	{ value: 0x01, label: "$01 — legato toggle" },
	{ value: 0x02, label: "$02 — light staccato toggle" },
	{ value: 0x03, label: "$03 — echo toggle for this channel" },
	{ value: 0x05, label: "$05 — SNES sync" },
	{ value: 0x06, label: "$06 — Yoshi drums on this channel" },
	{ value: 0x07, label: "$07 — tempo hike off" },
	{ value: 0x08, label: "$08 — switch velocity table" },
	{ value: 0x09, label: "$09 — restore instrument" },
] as const;

/** `$FA`'s sub-commands. `$05` is an error at `#amk 2`+ (`parser.ts:parseHexCommand`). */
const FA_SUBCOMMANDS = [
	{ value: 0x00, label: "$00 — pitch modulation" },
	{ value: 0x01, label: "$01 — GAIN" },
	{ value: 0x02, label: "$02 — semitone tune" },
	{ value: 0x03, label: "$03 — amplify" },
	{ value: 0x04, label: "$04 — echo buffer reserve" },
	{ value: 0x7f, label: "$7F — hot patch preset" },
	{ value: 0xfe, label: "$FE — hot patch toggle bits" },
] as const;

const HOT_PATCH_PRESETS = [
	{ value: 0x00, label: "$00 — AddmusicK 1.0.8 and earlier" },
	{ value: 0x01, label: "$01 — AddmusicK 1.0.9" },
	{ value: 0x02, label: "$02 — AddmusicK Beta" },
	{ value: 0x03, label: "$03 — Romi's Addmusic404" },
	{ value: 0x04, label: "$04 — Addmusic405" },
	{ value: 0x05, label: "$05 — AddmusicM" },
	{ value: 0x06, label: "$06 — carol's MORE.bin" },
	{ value: 0x07, label: "$07 — Vanilla SMW" },
] as const;

/** `$FC`'s event types, from the syntax reference's remote-code entry. */
const REMOTE_TYPES = [
	{ value: 0, label: "0 — cancel any remote code" },
	{ value: 1, label: "1 — run after a set time" },
	{ value: 2, label: "2 — run before a note ends" },
	{ value: 3, label: "3 — run on key-off" },
	{ value: 4, label: "4 — run on key-on" },
	{ value: 5, label: "5 — run before a note, after key-on" },
	{ value: 6, label: "6 — run on key-off, before the next note" },
] as const;

// ---------------------------------------------------------------------------
// The value-dependent forms
// ---------------------------------------------------------------------------

/**
 * `$E6` is two commands sharing a byte: `$00` opens a subloop, anything else
 * closes one and repeats it `n + 1` times (`parser.ts:parseHexCommand`).
 */
const subloop: Resolver = (command) => {
	const value = command.args[0]?.value;
	if (value === 0) {
		return {
			params: [choice("Subloop", [{ value: 0x00, label: "$00 — start" }], { structural: true })],
			note: "Opens a subloop. The matching $E6 with a non-zero count closes it.",
		};
	}

	return {
		params: [
			u8("Repeat count", "index", {
				min: 1,
				structural: true,
				describe: (n) => `plays the subloop ${n + 1} times — the byte is one less than the count`,
			}),
		],
		note: "Closes the subloop opened by the nearest earlier $E6 $00.",
	};
};

/**
 * `$ED` is ADSR, GAIN, or — under `#am4` — HFD's escape into four other
 * commands entirely (`parser.ts:parseHFDHex`).
 */
const envelope: Resolver = (command) => {
	const sub = command.args[0]?.value;

	if (command.target.program === 1 && sub !== undefined && sub >= 0x80 && sub <= 0x83) {
		const form = choice(
			"HFD form",
			[
				{ value: 0x80, label: "$80 — DSP write" },
				{ value: 0x81, label: "$81 — semitone tune" },
				{ value: 0x82, label: "$82 — ARAM upload" },
				{ value: 0x83, label: "$83 — not implemented" },
			],
			{ structural: true },
		);

		if (sub === 0x80) {
			return {
				params: [form, u8("DSP register", "address"), u8("Value", "opaque")],
				note: "Addmusic 4.05 wrote DSP registers through $ED. AddmusicK compiles this to $F6.",
			};
		}

		if (sub === 0x81) {
			return {
				params: [form, s8("Semitones", "semitones")],
				note: "Addmusic 4.05’s tune command. AddmusicK compiles this to $FA $02.",
			};
		}

		if (sub === 0x82) {
			return {
				params: [
					form,
					u8("Address, high", "address"),
					u8("Address, low", "address"),
					u8("Count, high", "index", { structural: true }),
					u8("Count, low", "index", { structural: true }),
				],
				note: "An ARAM upload: the two count bytes decide how many of the bytes after it belong to this command.",
				tail: "data byte",
			};
		}

		return { params: [form], note: "AMK0163 — this form was never implemented." };
	}

	if (sub !== undefined && (sub & 0x80) !== 0) {
		return {
			params: [choice("Mode", [{ value: 0x80, label: "$80 — GAIN" }], { structural: true }), u8("GAIN", "rate")],
		};
	}

	return {
		params: [
			u8("ADSR1", "rate", {
				max: 0x7f,
				describe: (value) => `decay ${(value >> 4) & 0x07}, attack ${value & 0x0f}`,
			}),
			u8("ADSR2", "rate", {
				describe: (value) => `sustain ${(value >> 5) & 0x07}, release ${value & 0x1f}`,
			}),
		],
	};
};

/** `#am4`'s `$E5` is tremolo, unless its first byte has the high bit — then a sample load. */
const tremolo: Resolver = (command) => {
	const first = command.args[0]?.value ?? 0;
	if (command.target.program === 1 && first >= 0x80) {
		return {
			params: [
				u8("Sample", "srcn", {
					min: 0x80,
					structural: true,
					describe: (value) => `sample $${hex2(value - 0x80)} — the high bit is what selects this form`,
				}),
				u8("Multiplication pitch", "opaque"),
			],
			note: "Addmusic 4.05 overloaded $E5: a high first byte is a sample load, and AddmusicK compiles it to $F3.",
		};
	}

	return {
		params: [ticks("Delay"), RATE("tremolo"), u8("Depth", "level")],
	};
};

/** `$FA` picks a different command per sub-byte. */
const misc: Resolver = (command) => {
	const sub = command.args[0]?.value;
	const selector = choice("Sub-command", FA_SUBCOMMANDS, { structural: true });

	switch (sub) {
		case 0x00:
			return {
				params: [
					selector,
					u8("Channels", "channelMask", {
						control: "toggles",
						describe: () => "channel 0 cannot have pitch modulation",
					}),
				],
			};
		case 0x01:
			return { params: [selector, u8("GAIN", "rate")] };
		case 0x02:
			return { params: [selector, s8("Semitones", "semitones")] };
		case 0x03:
			return {
				params: [
					selector,
					u8("Multiplier", "level", {
						describe: (value) => `volume × ${((value + 1) / 256).toFixed(3)} + 1 — $FF is just shy of double`,
					}),
				],
			};
		case 0x04:
			return {
				params: [selector, u8("Largest delay", "index", { max: 0x0f })],
				note: "Inserted by the compiler at the start of every song; there is rarely a reason to write it by hand.",
			};
		case 0x7f:
			return { params: [selector, choice("Preset", HOT_PATCH_PRESETS)] };
		case 0xfe: {
			const bits = [
				selector,
				u8("Bits", "opaque", {
					control: "toggles",
					structural: true,
					describe: (value) => ((value & 0x80) !== 0 ? "the high bit defines a further byte of bits" : null),
				}),
			];

			// Named only when it exists. A descriptor listing more parameters than the
			// command has does not go unnoticed — `describe.ts` gives every named one a
			// row, so an unconditional third would draw an empty "not written yet"
			// line under every ordinary `$FA $FE`.
			if (((command.args[1]?.value ?? 0) & 0x80) !== 0) {
				bits.push(u8("More bits", "opaque", { control: "toggles" }));
			}

			return { params: bits };
		}

		default:
			// `HEX_LENGTHS` gives `$FA` three bytes whatever the sub-command is, and
			// `parser.ts:parseHexCommand` only *rejects* an unknown one after reading both. So the
			// second byte is really there even when nothing here knows what it means,
			// and saying "Value" is more honest than letting it fall through to
			// "Argument 2".
			return { params: [selector, raw("Value")] };
	}
};

/** `#amk 1`'s `$FC` is remote *gain* — two arguments, not four (`parser.ts:parseHexCommand`). */
const remote: Resolver = (command) => {
	if (command.target.amkVersion === 1) {
		return {
			params: [u8("GAIN", "rate"), ticks("Delay")],
			note: "Under #amk 1 this is remote gain, which the compiler rebuilds into a five-byte remote-code event.",
		};
	}

	return {
		params: [
			u8("Address, low", "address", { control: "readonly" }),
			u8("Address, high", "address", { control: "readonly" }),
			choice("Event type", REMOTE_TYPES),
			ticks("Wait", { describe: (value) => (value === 0 ? "$00 is treated as $0100" : null) }),
		],
		note: "The address is written by the compiler from a (!n) label; editing it by hand points the driver at nothing.",
	};
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const HEX_PARAMS: Readonly<Record<number, Resolver>> = {
	0xda: fixed([
		u8("Instrument", "index", {
			describe: (value) =>
				value === 0x13
					? // `@amk/spc`'s README.md — the driver has a real 20th slot, SRCN $0F,
						// that AddmusicK's own instrToSample marks as "Nothing". Nothing ever
						// marks $0F used, so optimizeSampleUsage (Music.cpp:3074) swaps it for
						// the zero-byte EMPTY.brr.
						"the driver’s 20th slot, reachable only this way — but its sample is dropped as unused, so it plays silence unless the song also uses @21 or @26–@29"
					: null,
		}),
	]),
	0xdb: fixed([PAN], "Bits 6 and 7 enable surround for the right and left speaker."),
	0xdc: fixed([DURATION, PAN]),
	0xdd: fixed([
		// Both really are tick counts — `aram_map.html:444` calls the first "pitch
		// slide delay in music tempo ticks", and the second is the divisor
		// `CalcPortamentoDelta` (ARAM `$131B`) divides the pitch distance by, not a
		// rate like `$DE`'s second byte. The delay is counted from the *second* tick
		// of the note this rides on, which is what `bend-command` warns about.
		ticks("Delay"),
		DURATION,
		u8("Target note", "note", { min: 0x80, max: 0xc5, describe: (value) => noteName(value) }),
	]),
	0xde: fixed([ticks("Delay"), RATE("vibrato"), u8("Depth", "level")]),
	0xdf: fixed([]),
	0xe0: fixed([u8("Global volume", "level", { describe: percentOf255 })]),
	0xe1: fixed([DURATION, u8("Global volume", "level", { describe: percentOf255 })]),
	0xe2: fixed(
		[
			u8("Tempo", "rate", {
				max: MAX_TEMPO,
				describe: (value) => `about ${bpm(value).toFixed(1)} BPM — estimated; the driver drops ticks when it is busy`,
			}),
		],
		"The driver stores one more than you write, so $FF would be tempo 0 and the song would stop advancing.",
	),
	0xe3: fixed(
		[
			DURATION,
			u8("Tempo", "rate", {
				max: MAX_TEMPO,
				describe: (value) => `about ${bpm(value).toFixed(1)} BPM`,
			}),
		],
		"Its handler has the same carry-less add as $E2, so a target of $FF fades the song to a stop.",
	),
	0xe4: fixed([SEMITONES]),
	0xe5: tremolo,
	0xe6: subloop,
	0xe7: fixed([u8("Volume", "level", { describe: percentOf255 })]),
	0xe8: fixed([DURATION, u8("Volume", "level", { describe: percentOf255 })]),
	0xe9: fixed(
		[
			u8("Loop point, low", "address", { control: "readonly" }),
			u8("Loop point, high", "address", { control: "readonly" }),
			u8("Loop count", "index"),
		],
		"Written by the compiler from a [ ] loop. The readme says outright: do not use manually.",
	),
	0xea: fixed([DURATION], "Fades to the amplitude the last $DE set."),
	0xeb: fixed([ticks("Delay"), ticks("Duration"), SEMITONES]),
	0xec: fixed([ticks("Delay"), ticks("Duration"), SEMITONES]),
	0xed: envelope,
	0xee: fixed([s8("Tuning", "semitones")]),
	0xef: fixed([u8("Channels", "channelMask", { control: "toggles" }), ECHO_VOLUME("L"), ECHO_VOLUME("R")]),
	0xf0: fixed([]),
	0xf1: fixed([
		u8("Delay", "index", {
			max: 0x0f,
			describe: (value) => {
				const masked = value & 0x0f;
				if (value > 0x0f) {
					// main.asm:2606 masks it, so an out-of-range value wraps in silence.
					return `$${hex2(value)} is out of range; the driver masks it to $${hex2(masked)}`;
				}

				return `${masked * 16} ms — ${masked * 2} KiB of ARAM reserved for the buffer`;
			},
		}),
		s8("Feedback", "level", {
			describe: (value) =>
				value === 0 ? "no feedback — the echo plays once" : "each repeat is this fraction of the last",
		}),
		choice("Filter", [
			{ value: 0, label: "0 — SMW low-pass" },
			{ value: 1, label: "1 — flat" },
		]),
	]),
	0xf2: fixed([DURATION, ECHO_VOLUME("L"), ECHO_VOLUME("R")]),
	// The handler at $0DBE forges a six-byte instrument entry in the channel's
	// backup table: byte 0 is the sample, byte 4 the tuning multiplier. It writes
	// neither byte 5 (the fraction) nor bytes 1-3 (the envelope), so both carry
	// over from whatever played last.
	0xf3: (_command, context) => ({
		params: [
			u8("Sample", "srcn", {
				control: "select",
				// `EMPTY.brr` is the zero-byte file the compiler *substitutes* for a
				// sample nothing plays (`parser.ts:optimizeSamples`). Offering it would offer
				// silence: every slot holding one is a slot whose real sample was
				// dropped, and pointing `$F3` at one plays nothing. A song that has one
				// written already still shows it, through the picker's unknown-value
				// arm — this hides it from the list, not from the source.
				choices: context.samples.filter((option) => option.label !== EMPTY_SAMPLE_NAME),
				max: Math.max(0, context.samples.length - 1),
			}),
			u8("Tuning multiplier", "rate", {
				describe: (value) =>
					value === 0
						? "a multiplier of 0 is silence"
						: `×${value} — the whole part only; the fraction carries over from the last instrument`,
			}),
		],
		note: "Changes the sample and coarse pitch only: the envelope and the fractional tuning are left as the previous instrument set them. $FA $FE’s third bit makes $F3 zero the fraction instead.",
	}),
	0xf4: fixed([choice("Sub-command", F4_SUBCOMMANDS, { structural: true })]),
	0xf5: fixed(
		Array.from({ length: 8 }, (_, i) => s8(`Coefficient ${i + 1}`, "level")),
		"C7 multiplies the newest sample and C0 the oldest.",
	),
	0xf6: fixed([u8("DSP register", "address"), u8("Value", "opaque")]),
	0xf7: fixed([raw("Address, low"), raw("Address, high"), raw("Value")], "AddmusicM’s write-byte command."),
	// The same clock the `n` command sets, so it reads out the same way: the
	// driver writes both to the DSP's `FLG` register and the ladder is the DSP's.
	0xf8: fixed([
		u8("Noise clock", "rate", {
			max: 0x1f,
			describe: (value) => (value === 0 ? "silent" : `${Math.round(noiseHz(value)).toLocaleString()} Hz`),
		}),
	]),
	// The handler at $1083 writes the first argument to $0167 and the second to
	// $0166 — inverted — and the main loop pushes both to the ports every tick
	// (main.asm:248-256).
	0xf9: fixed(
		[u8("To $2141", "opaque"), u8("To $2140", "opaque")],
		"The two bytes land on the SNES’s APU ports the other way round from how they are written, and stay there until another $F9 changes them. What the ROM does with them is its own business. $F4 $05 reuses the same two bytes as a tick counter, so the two commands cannot both be used.",
	),
	0xfa: misc,
	// `$FB` has a view of its own: its length is one of its arguments, so the
	// notes are a list you add to rather than a count you type. See
	// `arpeggio-command/`.
	0xfc: remote,
	0xfd: fixed([]),
	0xfe: fixed([]),
};
