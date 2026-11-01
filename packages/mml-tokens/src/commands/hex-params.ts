import { EMPTY_SAMPLE_NAME } from "@amk/core/hardcoded-tables";
import { noiseHz } from "@amk/spc/adsr";
import { hex2 } from "@amk/core/hex";
import {
	DURATION,
	type EnumOption,
	type ParamDescriptor,
	type Resolver,
	TEMPO_FADE_DURATION,
	choice,
	fixed,
	raw,
	s8,
	ticks,
	u8,
} from "./param";
import { REMOTE_EVENTS } from "./remote";
import { noteName, panLabel, percentOf255, tempoLabel } from "./units";

/**
 * The highest tempo that is not a freeze.
 * Every vcmd handler is entered with the carry set (`main.asm:2659`).
 * A tempo of `$FF` stores `$00`, which stops advancing the song altogether.
 */
const MAX_TEMPO = 254;

/**
 * What each hex command's arguments mean, `$DA` through `$FE`.
 * Names follow `hex_command_reference.html` so that a reader with the readme
 * open sees the same words; where the readme is wrong or silent — `$DB`'s
 * range, `$F1`'s delay, the `$F5` coefficients' interaction — the note says what
 * the driver actually does and cites it.
 */

// ---------------------------------------------------------------------------
// Shared descriptors
// ---------------------------------------------------------------------------

/** The vibrato and tremolo rate — `$DE`'s and `$E5`'s second byte. */
const RATE = (stillAtZero: string): ParamDescriptor =>
	u8($localize`:@@inspector.param.rate:Rate`, "rate", {
		min: 1,
		describe: (value) => (value === 0 ? stillAtZero : $localize`:@@inspector.param.higher-is-faster:higher is faster`),
	});

const PAN = u8($localize`:@@inspector.param.pan:Pan`, "pan", {
	max: 20,
	describe: (value) => {
		if (value > 0x14) {
			// main.asm:3486 — `PanValues` has 21 entries, and the readme's own $13
			// ceiling is one short of the table it describes.
			return $localize`:@@inspector.param.past-the-drivers-21-entry:past the driver's 21-entry pan table, which ends at $14`;
		}

		return panLabel(value);
	},
});

const ECHO_VOLUME = (side: string): ParamDescriptor =>
	s8($localize`:@@inspector.param.echo-volume:Volume ${side}:side:`, "level", {
		describe: (value) =>
			value >= 0x80
				? $localize`:@@inspector.param.negative-so-this-side-is:negative, so this side is phase-inverted`
				: null,
	});

const SEMITONES = s8($localize`:@@inspector.param.semitones:Semitones`, "semitones", {
	describe: (value) =>
		value >= 0x80
			? $localize`:@@inspector.param.bends-downward:bends downward`
			: $localize`:@@inspector.param.bends-upward:bends upward`,
});

/** `$F4`'s sub-commands, every one the readme documents. */
const F4_SUBCOMMANDS = [
	{ value: 0x00, label: $localize`:@@inspector.param.f4.00-yoshi-drums-on-channel:$00 — Yoshi drums on channel 5` },
	{ value: 0x01, label: $localize`:@@inspector.param.f4.01-legato-toggle:$01 — legato toggle` },
	{ value: 0x02, label: $localize`:@@inspector.param.f4.02-light-staccato-toggle:$02 — light staccato toggle` },
	{ value: 0x03, label: $localize`:@@inspector.param.f4.03-echo-toggle-for-this:$03 — echo toggle for this channel` },
	{ value: 0x05, label: $localize`:@@inspector.param.f4.05-snes-sync:$05 — SNES sync` },
	{ value: 0x06, label: $localize`:@@inspector.param.f4.06-yoshi-drums-on-this:$06 — Yoshi drums on this channel` },
	{ value: 0x07, label: $localize`:@@inspector.param.f4.07-tempo-hike-off:$07 — tempo hike off` },
	{ value: 0x08, label: $localize`:@@inspector.param.f4.08-switch-velocity-table:$08 — switch velocity table` },
	{ value: 0x09, label: $localize`:@@inspector.param.f4.09-restore-instrument:$09 — restore instrument` },
] as const;

/**
 * `$FA`'s sub-commands. `$05` is an error at `#amk 2`+ (`parser.ts:parseHexCommand`).
 */
const FA_SUBCOMMANDS = [
	{ value: 0x00, label: $localize`:@@inspector.param.fa.00-pitch-modulation:$00 — pitch modulation` },
	{ value: 0x01, label: $localize`:@@inspector.param.fa.01-gain:$01 — GAIN` },
	{ value: 0x02, label: $localize`:@@inspector.param.fa.02-semitone-tune:$02 — semitone tune` },
	{ value: 0x03, label: $localize`:@@inspector.param.fa.03-amplify:$03 — amplify` },
	{ value: 0x04, label: $localize`:@@inspector.param.fa.04-echo-buffer-reserve:$04 — echo buffer reserve` },
	{ value: 0x06, label: $localize`:@@inspector.param.fa.06-velocity-table:$06 — velocity table` },
	{ value: 0x7f, label: $localize`:@@inspector.param.fa.7f-hot-patch-preset:$7F — hot patch preset` },
	{ value: 0xfe, label: $localize`:@@inspector.param.fa.fe-hot-patch-toggle-bits:$FE — hot patch toggle bits` },
] as const;

const HOT_PATCH_PRESETS = [
	{ value: 0x00, label: $localize`:@@inspector.param.hot-patch.00-addmusick-1-0-8:$00 — AddmusicK 1.0.8 and earlier` },
	{ value: 0x01, label: $localize`:@@inspector.param.hot-patch.01-addmusick-1-0-9:$01 — AddmusicK 1.0.9` },
	{ value: 0x02, label: $localize`:@@inspector.param.hot-patch.02-addmusick-beta:$02 — AddmusicK Beta` },
	{ value: 0x03, label: $localize`:@@inspector.param.hot-patch.03-romis-addmusic404:$03 — Romi's Addmusic404` },
	{ value: 0x04, label: $localize`:@@inspector.param.hot-patch.04-addmusic405:$04 — Addmusic405` },
	{ value: 0x05, label: $localize`:@@inspector.param.hot-patch.05-addmusicm:$05 — AddmusicM` },
	{ value: 0x06, label: $localize`:@@inspector.param.hot-patch.06-carols-more-bin:$06 — carol's MORE.bin` },
	{ value: 0x07, label: $localize`:@@inspector.param.hot-patch.07-vanilla-smw:$07 — Vanilla SMW` },
] as const;

/** What `#option smwvtable` and `#option nspcvtable` compile to (`Music.cpp:2343-2367`). */
const VELOCITY_TABLES = [
	{ value: 0x00, label: $localize`:@@inspector.param.velocity.00-smw-option-smwvtable:$00 — SMW (#option smwvtable)` },
	{
		value: 0x01,
		label: $localize`:@@inspector.param.velocity.01-n-spc-option-nspcvtable:$01 — N-SPC (#option nspcvtable)`,
	},
] as const;

/** The same two, at `#amk 1`, where `#option` is not available (AMK0045). */
const VELOCITY_TABLES_BARE = [
	{ value: 0x00, label: $localize`:@@inspector.param.velocity.00-smw:$00 — SMW` },
	{ value: 0x01, label: $localize`:@@inspector.param.velocity.01-n-spc:$01 — N-SPC` },
] as const;

/**
 * `$FC`'s event types, as the byte: `REMOTE_EVENTS` is the one list of them, and
 * a call's `-1` is the `$FF` written here.
 *
 * 4 installs the address, runs it and puts the old one back on the spot
 * (`Commands.asm:1281-1304`); 5 is stored and handled exactly as 2
 * (`main.asm:3220-3221`); 6 goes to the key-on slot and is consulted at key-off
 * like a 3 (`Commands.asm:1253-1254`, `main.asm:349-352`). 7, 8 and −1 are real
 * and documented only in the syntax reference (`Commands.asm:1249`, `:1323-1351`).
 */
const REMOTE_TYPES: readonly EnumOption[] = REMOTE_EVENTS.map((event) => ({
	value: event.type & 0xff,
	label: `${event.type < 0 ? `$${hex2(event.type & 0xff)}` : event.type} — ${event.name}`,
}));

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
			params: [
				choice(
					$localize`:@@inspector.param.subloop:Subloop`,
					[{ value: 0x00, label: $localize`:@@inspector.param.00-start:$00 — start` }],
					{ structural: true },
				),
			],
			note: $localize`:@@inspector.param.opens-a-subloop-the-matching:Opens a subloop. The matching $E6 with a non-zero count closes it.`,
		};
	}

	return {
		params: [
			u8($localize`:@@inspector.param.repeat-count:Repeat count`, "index", {
				min: 1,
				structural: true,
				describe: (n) =>
					$localize`:@@inspector.param.plays-the-subloop-times-the:plays the subloop ${n + 1}:count: times — the byte is one less than the count`,
			}),
		],
		note: $localize`:@@inspector.param.closes-the-subloop-opened-by:Closes the subloop opened by the nearest earlier $E6 $00.`,
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
			$localize`:@@inspector.param.hfd-form:HFD form`,
			[
				{ value: 0x80, label: $localize`:@@inspector.param.hfd.80-dsp-write:$80 — DSP write` },
				{ value: 0x81, label: $localize`:@@inspector.param.hfd.81-semitone-tune:$81 — semitone tune` },
				{ value: 0x82, label: $localize`:@@inspector.param.hfd.82-aram-upload:$82 — ARAM upload` },
				{ value: 0x83, label: $localize`:@@inspector.param.hfd.83-not-implemented:$83 — not implemented` },
			],
			{ structural: true },
		);

		if (sub === 0x80) {
			return {
				params: [
					form,
					u8($localize`:@@inspector.param.dsp-register:DSP register`, "address"),
					u8($localize`:@@inspector.param.value:Value`, "opaque"),
				],
				note: $localize`:@@inspector.param.addmusic-4-05-wrote-dsp:Addmusic 4.05 wrote DSP registers through $ED. AddmusicK compiles this to $F6.`,
			};
		}

		if (sub === 0x81) {
			return {
				params: [form, s8($localize`:@@inspector.param.semitones:Semitones`, "semitones")],
				note: $localize`:@@inspector.param.addmusic-4-05s-tune-command:Addmusic 4.05’s tune command. AddmusicK compiles this to $FA $02.`,
			};
		}

		if (sub === 0x82) {
			return {
				params: [
					form,
					u8($localize`:@@inspector.param.address-high:Address, high`, "address"),
					u8($localize`:@@inspector.param.address-low:Address, low`, "address"),
					u8($localize`:@@inspector.param.count-high:Count, high`, "index", { structural: true }),
					u8($localize`:@@inspector.param.count-low:Count, low`, "index", { structural: true }),
				],
				note: $localize`:@@inspector.param.an-aram-upload-the-two:An ARAM upload: the two count bytes decide how many of the bytes after it belong to this command.`,
				tail: $localize`:@@inspector.param.data-byte:data byte`,
			};
		}

		return {
			params: [form],
			note: $localize`:@@inspector.param.amk0163-this-form-was-never:AMK0163 — this form was never implemented.`,
		};
	}

	if (sub !== undefined && (sub & 0x80) !== 0) {
		return {
			params: [
				choice(
					$localize`:@@inspector.param.mode:Mode`,
					[{ value: 0x80, label: $localize`:@@inspector.param.80-gain:$80 — GAIN` }],
					{ structural: true },
				),
				u8("GAIN", "rate"),
			],
		};
	}

	return {
		params: [
			u8("ADSR1", "rate", {
				max: 0x7f,
				describe: (value) =>
					$localize`:@@inspector.param.decay-attack:decay ${(value >> 4) & 0x07}:decay:, attack ${value & 0x0f}:attack:`,
			}),
			u8("ADSR2", "rate", {
				describe: (value) =>
					$localize`:@@inspector.param.sustain-release:sustain ${(value >> 5) & 0x07}:sustain:, release ${value & 0x1f}:release:`,
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
				u8($localize`:@@inspector.param.sample:Sample`, "srcn", {
					min: 0x80,
					structural: true,
					describe: (value) =>
						$localize`:@@inspector.param.sample-the-high-bit-is:sample $${hex2(value - 0x80)}:sample: — the high bit is what selects this form`,
				}),
				u8($localize`:@@inspector.param.multiplication-pitch:Multiplication pitch`, "opaque"),
			],
			note: $localize`:@@inspector.param.addmusic-4-05-overloaded-e5:Addmusic 4.05 overloaded $E5: a high first byte is a sample load, and AddmusicK compiles it to $F3.`,
		};
	}

	return {
		params: [
			ticks($localize`:@@inspector.param.delay:Delay`),
			RATE($localize`:@@inspector.param.rate-zero.tremolo:a rate of 0 never advances, so the tremolo stays still`),
			u8($localize`:@@inspector.param.depth:Depth`, "level"),
		],
	};
};

/** `$FA` picks a different command per sub-byte. */
const misc: Resolver = (command) => {
	const sub = command.args[0]?.value;
	const selector = choice($localize`:@@inspector.param.sub-command:Sub-command`, FA_SUBCOMMANDS, {
		structural: true,
		// Commands.asm:667-679 — a 16-bit index into a seven-entry table with no
		// bounds check. $05's slot was emptied when remote code replaced it.
		describe: (value) => {
			if (value === 0x05) {
				return $localize`:@@inspector.param.replaced-by-remote-code-type:replaced by remote code type 3; the slot is empty and the SPC jumps to address zero`;
			}

			return value > 0x06 && value !== 0x7f && value !== 0xfe
				? $localize`:@@inspector.param.past-the-table-the-spc:past the table: the SPC jumps into whatever follows it`
				: null;
		},
	});

	switch (sub) {
		case 0x00:
			return {
				params: [
					selector,
					u8($localize`:@@inspector.param.channels:Channels`, "channelMask", {
						control: "toggles",
						describe: () =>
							$localize`:@@inspector.param.channel-0-cannot-have-pitch:channel 0 cannot have pitch modulation`,
					}),
				],
			};
		case 0x01:
			return { params: [selector, u8("GAIN", "rate")] };
		case 0x02:
			return { params: [selector, s8($localize`:@@inspector.param.semitones:Semitones`, "semitones")] };
		case 0x03:
			return {
				params: [
					selector,
					u8($localize`:@@inspector.param.multiplier:Multiplier`, "level", {
						describe: (value) =>
							$localize`:@@inspector.param.volume-1-ff-is-just:volume × ${((value + 1) / 256).toFixed(3)}:factor: + 1 — $FF is just shy of double`,
					}),
				],
			};
		case 0x04:
			return {
				params: [selector, u8($localize`:@@inspector.param.largest-delay:Largest delay`, "index", { max: 0x0f })],
				note: $localize`:@@inspector.param.inserted-by-the-compiler-at:Inserted by the compiler at the start of every song; there is rarely a reason to write it by hand.`,
			};
		case 0x06:
			return {
				params: [
					selector,
					choice(
						$localize`:@@inspector.param.table:Table`,
						// AMK0045: parseOptionDirective refuses #option at #amk 1 and
						// nowhere else, so #am4 and #amm songs — version 0 — may use it
						// and are named the directives too.
						command.target.amkVersion === 1 ? VELOCITY_TABLES_BARE : VELOCITY_TABLES,
						{
							// main.asm:2373 tests the byte against zero rather than against 1.
							describe: (value) =>
								value > 1
									? $localize`:@@inspector.param.anything-but-00-selects-the:anything but $00 selects the N-SPC table; the driver only tests for zero`
									: null,
						},
					),
				],
				note: $localize`:@@inspector.param.the-compiler-already-writes-fa:The compiler already writes $FA $06 $01 at the start of every #amk 2 and up song.`,
			};
		case 0x7f:
			return { params: [selector, choice($localize`:@@inspector.param.preset:Preset`, HOT_PATCH_PRESETS)] };
		case 0xfe: {
			const bits = [
				selector,
				u8($localize`:@@inspector.param.bits:Bits`, "opaque", {
					control: "toggles",
					structural: true,
					describe: (value) =>
						(value & 0x80) !== 0
							? $localize`:@@inspector.param.the-high-bit-defines-a:the high bit defines a further byte of bits`
							: null,
				}),
			];

			// Named only when it exists. A descriptor listing more parameters than the
			// command has does not go unnoticed — `describe.ts` gives every named one a
			// row, so an unconditional third would draw an empty "not written yet"
			// line under every ordinary `$FA $FE`.
			if (((command.args[1]?.value ?? 0) & 0x80) !== 0) {
				bits.push(u8($localize`:@@inspector.param.more-bits:More bits`, "opaque", { control: "toggles" }));
			}

			return { params: bits };
		}

		default:
			// `HEX_LENGTHS` gives `$FA` three bytes whatever the sub-command is, and
			// `parser.ts:parseHexCommand` only *rejects* an unknown one after reading both. So the
			// second byte is really there even when nothing here knows what it means,
			// and saying "Value" is more honest than letting it fall through to
			// "Argument 2".
			return { params: [selector, raw($localize`:@@inspector.param.value:Value`)] };
	}
};

/** `#amk 1`'s `$FC` is remote *gain* — two arguments, not four (`parser.ts:parseHexCommand`). */
const remote: Resolver = (command) => {
	if (command.target.amkVersion === 1) {
		return {
			params: [u8("GAIN", "rate"), ticks($localize`:@@inspector.param.delay:Delay`)],
			note: $localize`:@@inspector.param.under-amk-1-this-is:Under #amk 1 this is remote gain, which the compiler rebuilds into a five-byte remote-code event.`,
		};
	}

	return {
		params: [
			u8($localize`:@@inspector.param.address-low:Address, low`, "address", { control: "readonly" }),
			u8($localize`:@@inspector.param.address-high:Address, high`, "address", { control: "readonly" }),
			choice($localize`:@@inspector.param.event-type:Event type`, REMOTE_TYPES, {
				// Commands.asm:1260-1269 stores any other value in the normal slot
				// with that type, and nothing ever tests for it.
				describe: (value) =>
					value >= 0x09 && value <= 0xfe
						? $localize`:@@inspector.param.no-such-event-the-code:no such event: the code is stored and never run`
						: null,
			}),
			ticks($localize`:@@inspector.param.wait:Wait`, {
				describe: (value) =>
					value === 0 ? $localize`:@@inspector.param.00-is-treated-as-0100:$00 is treated as $0100` : null,
			}),
		],
		note: $localize`:@@inspector.param.the-address-is-written-by:The address is written by the compiler from a (!n) label; editing it by hand points the driver at nothing.`,
	};
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const HEX_PARAMS: Readonly<Record<number, Resolver>> = {
	0xda: fixed([
		u8($localize`:@@inspector.param.instrument:Instrument`, "index", {
			describe: (value) =>
				value === 0x13
					? // `@amk/spc`'s README.md — the driver has a real 20th slot, SRCN $0F,
						// that AddmusicK's own instrToSample marks as "Nothing". Nothing ever
						// marks $0F used, so optimizeSampleUsage (Music.cpp:3074) swaps it for
						// the zero-byte EMPTY.brr.
						$localize`:@@inspector.param.the-drivers-20th-slot-reachable:the driver’s 20th slot, reachable only this way — but its sample is dropped as unused, so it plays silence unless the song also uses @21 or @26–@29`
					: null,
		}),
	]),
	// `$DB` has a view of its own, shared with `y`: its one byte is a pan and two
	// surround bits, which no single descriptor row can be. See `pan-command/`.
	// `$DC` keeps this one — its target is a plain pan value that the driver
	// slides towards, with no surround bits in it (`Commands.asm:264`).
	0xdc: fixed([DURATION, PAN]),
	0xdd: fixed([
		// Both really are tick counts — `aram_map.html:444` calls the first "pitch
		// slide delay in music tempo ticks", and the second is the divisor
		// `CalcPortamentoDelta` (ARAM `$131B`) divides the pitch distance by, not a
		// rate like `$DE`'s second byte. The delay is counted from the *second* tick
		// of the note this rides on, which is what `bend-command` warns about.
		ticks($localize`:@@inspector.param.delay:Delay`),
		DURATION,
		u8($localize`:@@inspector.param.target-note:Target note`, "note", {
			min: 0x80,
			max: 0xc5,
			describe: (value) => noteName(value),
		}),
	]),
	0xde: fixed([
		ticks($localize`:@@inspector.param.delay:Delay`),
		RATE($localize`:@@inspector.param.rate-zero.vibrato:a rate of 0 never advances, so the vibrato stays still`),
		u8($localize`:@@inspector.param.depth:Depth`, "level"),
	]),
	0xdf: fixed([]),
	0xe0: fixed([u8($localize`:@@inspector.param.global-volume:Global volume`, "level", { describe: percentOf255 })]),
	0xe1: fixed([
		DURATION,
		u8($localize`:@@inspector.param.global-volume:Global volume`, "level", { describe: percentOf255 }),
	]),
	0xe2: fixed(
		[
			u8($localize`:@@inspector.param.tempo:Tempo`, "rate", {
				max: MAX_TEMPO,
				describe: tempoLabel,
			}),
		],
		$localize`:@@inspector.param.the-driver-stores-one-more:The driver stores one more than you write, so $FF would be tempo 0 and the song would stop advancing.`,
	),
	0xe3: fixed(
		[
			TEMPO_FADE_DURATION,
			u8($localize`:@@inspector.param.tempo:Tempo`, "rate", {
				max: MAX_TEMPO,
				describe: tempoLabel,
			}),
		],
		$localize`:@@inspector.param.its-handler-has-the-same:Its handler has the same carry-less add as $E2, so a target of $FF fades the song to a stop.`,
	),
	0xe4: fixed([SEMITONES]),
	0xe5: tremolo,
	0xe6: subloop,
	0xe7: fixed([u8($localize`:@@inspector.param.volume:Volume`, "level", { describe: percentOf255 })]),
	0xe8: fixed([DURATION, u8($localize`:@@inspector.param.volume:Volume`, "level", { describe: percentOf255 })]),
	0xe9: fixed(
		[
			u8($localize`:@@inspector.param.loop-point-low:Loop point, low`, "address", { control: "readonly" }),
			u8($localize`:@@inspector.param.loop-point-high:Loop point, high`, "address", { control: "readonly" }),
			u8($localize`:@@inspector.param.loop-count:Loop count`, "index"),
		],
		$localize`:@@inspector.param.written-by-the-compiler-from:Written by the compiler from a [ ] loop. The readme says outright: do not use manually.`,
	),
	0xea: fixed(
		[DURATION],
		$localize`:@@inspector.param.fades-to-the-amplitude-the:Fades to the amplitude the last $DE set.`,
	),
	0xeb: fixed([
		ticks($localize`:@@inspector.param.delay:Delay`),
		ticks($localize`:@@inspector.param.duration:Duration`),
		SEMITONES,
	]),
	0xec: fixed([
		ticks($localize`:@@inspector.param.delay:Delay`),
		ticks($localize`:@@inspector.param.duration:Duration`),
		SEMITONES,
	]),
	0xed: envelope,
	0xee: fixed([s8($localize`:@@inspector.param.tuning:Tuning`, "semitones")]),
	0xef: fixed([
		u8($localize`:@@inspector.param.channels:Channels`, "channelMask", { control: "toggles" }),
		ECHO_VOLUME("L"),
		ECHO_VOLUME("R"),
	]),
	0xf0: fixed([]),
	0xf1: fixed([
		u8($localize`:@@inspector.param.delay:Delay`, "index", {
			max: 0x0f,
			describe: (value) => {
				const masked = value & 0x0f;
				if (value > 0x0f) {
					// main.asm:2606 masks it, so an out-of-range value wraps in silence.
					return $localize`:@@inspector.param.is-out-of-range-the:$${hex2(value)}:byte: is out of range; the driver masks it to $${hex2(masked)}:masked:`;
				}

				return $localize`:@@inspector.param.ms-kib-of-aram-reserved:${masked * 16}:ms: ms — ${masked * 2}:kib: KiB of ARAM reserved for the buffer`;
			},
		}),
		s8($localize`:@@inspector.param.feedback:Feedback`, "level", {
			describe: (value) =>
				value === 0
					? $localize`:@@inspector.param.no-feedback-the-echo-plays:no feedback — the echo plays once`
					: $localize`:@@inspector.param.each-repeat-is-this-fraction:each repeat is this fraction of the last`,
		}),
		choice($localize`:@@inspector.param.filter:Filter`, [
			{ value: 0, label: $localize`:@@inspector.param.0-smw-low-pass:0 — SMW low-pass` },
			{ value: 1, label: $localize`:@@inspector.param.1-flat:1 — flat` },
		]),
	]),
	0xf2: fixed([DURATION, ECHO_VOLUME("L"), ECHO_VOLUME("R")]),
	// The handler at $0DBE forges a six-byte instrument entry in the channel's
	// backup table: byte 0 is the sample, byte 4 the tuning multiplier. It writes
	// neither byte 5 (the fraction) nor bytes 1-3 (the envelope), so both carry
	// over from whatever played last.
	0xf3: (_command, context) => ({
		params: [
			u8($localize`:@@inspector.param.sample:Sample`, "srcn", {
				control: "select",
				choices: context.samples.filter((option) => option.label !== EMPTY_SAMPLE_NAME),
				max: Math.max(0, context.samples.length - 1),
			}),
			u8($localize`:@@inspector.param.tuning-multiplier:Tuning multiplier`, "rate", {
				describe: (value) =>
					value === 0
						? $localize`:@@inspector.param.a-multiplier-of-0-is:a multiplier of 0 is silence`
						: $localize`:@@inspector.param.the-whole-part-only-the:×${value}:multiplier: — the whole part only; the fraction carries over from the last instrument`,
			}),
		],
		note: $localize`:@@inspector.param.changes-the-sample-and-coarse:Changes the sample and coarse pitch only: the envelope and the fractional tuning are left as the previous instrument set them. $FA $FE’s third bit makes $F3 zero the fraction instead.`,
	}),
	0xf4: fixed([
		choice($localize`:@@inspector.param.sub-command:Sub-command`, F4_SUBCOMMANDS, {
			structural: true,
			// Commands.asm:556-565 — ten entries, no bounds check, and $04's is
			// `dw $0000`. Neither value is offered above; both are reachable by hand.
			describe: (value) => {
				if (value === 0x04) {
					return $localize`:@@inspector.param.this-driver-has-no-such:this driver has no such command: the SPC jumps to address zero`;
				}

				return value >= 0x0a
					? $localize`:@@inspector.param.past-the-table-the-spc:past the table: the SPC jumps into whatever follows it`
					: null;
			},
		}),
	]),
	0xf5: fixed(
		Array.from({ length: 8 }, (_, i) =>
			s8($localize`:@@inspector.param.coefficient:Coefficient ${i + 1}:index:`, "level"),
		),
		$localize`:@@inspector.param.c7-multiplies-the-newest-sample:C7 multiplies the newest sample and C0 the oldest.`,
	),
	0xf6: fixed([
		u8($localize`:@@inspector.param.dsp-register:DSP register`, "address"),
		u8($localize`:@@inspector.param.value:Value`, "opaque"),
	]),
	0xf7: fixed(
		[
			raw($localize`:@@inspector.param.address-low:Address, low`),
			raw($localize`:@@inspector.param.address-high:Address, high`),
			raw($localize`:@@inspector.param.value:Value`),
		],
		$localize`:@@inspector.param.addmusicms-write-byte-command:AddmusicM’s write-byte command.`,
	),
	// The same clock the `n` command sets, so it reads out the same way: the
	// driver writes both to the DSP's `FLG` register and the ladder is the DSP's.
	0xf8: fixed([
		u8($localize`:@@inspector.param.noise-clock:Noise clock`, "rate", {
			max: 0x1f,
			describe: (value) =>
				value === 0
					? $localize`:@@inspector.param.silent:silent`
					: $localize`:@@inspector.param.hz:${Math.round(noiseHz(value)).toLocaleString()}:hz: Hz`,
		}),
	]),
	// The handler at $1083 writes the first argument to $0167 and the second to
	// $0166 — inverted — and the main loop pushes both to the ports every tick
	// (main.asm:248-256).
	0xf9: fixed(
		[
			u8($localize`:@@inspector.param.to-2141:To $2141`, "opaque"),
			u8($localize`:@@inspector.param.to-2140:To $2140`, "opaque"),
		],
		$localize`:@@inspector.param.the-two-bytes-land-on:The two bytes land on the SNES’s APU ports the other way round from how they are written, and stay there until another $F9 changes them. What the ROM does with them is its own business. $F4 $05 reuses the same two bytes as a tick counter, so the two commands cannot both be used.`,
	),
	0xfa: misc,
	// `$FB` has a view of its own: its length is one of its arguments, so the
	// notes are a list you add to rather than a count you type. See
	// `arpeggio-command/`.
	0xfc: remote,
	0xfd: fixed([]),
	0xfe: fixed([]),
};
