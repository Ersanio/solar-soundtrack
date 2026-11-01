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
	u8($localize`:@@inspector.param.rate:inspector.param.rate`, "rate", {
		min: 1,
		describe: (value) =>
			value === 0 ? stillAtZero : $localize`:@@inspector.param.higher-is-faster:inspector.param.higher-is-faster`,
	});

const PAN = u8($localize`:@@inspector.param.pan:inspector.param.pan`, "pan", {
	max: 20,
	describe: (value) => {
		if (value > 0x14) {
			// main.asm:3486 — `PanValues` has 21 entries, and the readme's own $13
			// ceiling is one short of the table it describes.
			return $localize`:@@inspector.param.past-the-drivers-21-entry:inspector.param.past-the-drivers-21-entry`;
		}

		return panLabel(value);
	},
});

const ECHO_VOLUME = (side: string): ParamDescriptor =>
	s8($localize`:@@inspector.param.echo-volume:inspector.param.echo-volume ${side}:side:`, "level", {
		describe: (value) =>
			value >= 0x80
				? $localize`:@@inspector.param.negative-so-this-side-is:inspector.param.negative-so-this-side-is`
				: null,
	});

const SEMITONES = s8($localize`:@@inspector.param.semitones:inspector.param.semitones`, "semitones", {
	describe: (value) =>
		value >= 0x80
			? $localize`:@@inspector.param.bends-downward:inspector.param.bends-downward`
			: $localize`:@@inspector.param.bends-upward:inspector.param.bends-upward`,
});

/** `$F4`'s sub-commands, every one the readme documents. */
const F4_SUBCOMMANDS = [
	{
		value: 0x00,
		label: $localize`:@@inspector.param.f4.00-yoshi-drums-on-channel:inspector.param.f4.00-yoshi-drums-on-channel`,
	},
	{ value: 0x01, label: $localize`:@@inspector.param.f4.01-legato-toggle:inspector.param.f4.01-legato-toggle` },
	{
		value: 0x02,
		label: $localize`:@@inspector.param.f4.02-light-staccato-toggle:inspector.param.f4.02-light-staccato-toggle`,
	},
	{
		value: 0x03,
		label: $localize`:@@inspector.param.f4.03-echo-toggle-for-this:inspector.param.f4.03-echo-toggle-for-this`,
	},
	{ value: 0x05, label: $localize`:@@inspector.param.f4.05-snes-sync:inspector.param.f4.05-snes-sync` },
	{
		value: 0x06,
		label: $localize`:@@inspector.param.f4.06-yoshi-drums-on-this:inspector.param.f4.06-yoshi-drums-on-this`,
	},
	{ value: 0x07, label: $localize`:@@inspector.param.f4.07-tempo-hike-off:inspector.param.f4.07-tempo-hike-off` },
	{
		value: 0x08,
		label: $localize`:@@inspector.param.f4.08-switch-velocity-table:inspector.param.f4.08-switch-velocity-table`,
	},
	{
		value: 0x09,
		label: $localize`:@@inspector.param.f4.09-restore-instrument:inspector.param.f4.09-restore-instrument`,
	},
] as const;

/**
 * `$FA`'s sub-commands. `$05` is an error at `#amk 2`+ (`parser.ts:parseHexCommand`).
 */
const FA_SUBCOMMANDS = [
	{ value: 0x00, label: $localize`:@@inspector.param.fa.00-pitch-modulation:inspector.param.fa.00-pitch-modulation` },
	{ value: 0x01, label: $localize`:@@inspector.param.fa.01-gain:inspector.param.fa.01-gain` },
	{ value: 0x02, label: $localize`:@@inspector.param.fa.02-semitone-tune:inspector.param.fa.02-semitone-tune` },
	{ value: 0x03, label: $localize`:@@inspector.param.fa.03-amplify:inspector.param.fa.03-amplify` },
	{
		value: 0x04,
		label: $localize`:@@inspector.param.fa.04-echo-buffer-reserve:inspector.param.fa.04-echo-buffer-reserve`,
	},
	{ value: 0x06, label: $localize`:@@inspector.param.fa.06-velocity-table:inspector.param.fa.06-velocity-table` },
	{ value: 0x7f, label: $localize`:@@inspector.param.fa.7f-hot-patch-preset:inspector.param.fa.7f-hot-patch-preset` },
	{
		value: 0xfe,
		label: $localize`:@@inspector.param.fa.fe-hot-patch-toggle-bits:inspector.param.fa.fe-hot-patch-toggle-bits`,
	},
] as const;

const HOT_PATCH_PRESETS = [
	{
		value: 0x00,
		label: $localize`:@@inspector.param.hot-patch.00-addmusick-1-0-8:inspector.param.hot-patch.00-addmusick-1-0-8`,
	},
	{
		value: 0x01,
		label: $localize`:@@inspector.param.hot-patch.01-addmusick-1-0-9:inspector.param.hot-patch.01-addmusick-1-0-9`,
	},
	{
		value: 0x02,
		label: $localize`:@@inspector.param.hot-patch.02-addmusick-beta:inspector.param.hot-patch.02-addmusick-beta`,
	},
	{
		value: 0x03,
		label: $localize`:@@inspector.param.hot-patch.03-romis-addmusic404:inspector.param.hot-patch.03-romis-addmusic404`,
	},
	{
		value: 0x04,
		label: $localize`:@@inspector.param.hot-patch.04-addmusic405:inspector.param.hot-patch.04-addmusic405`,
	},
	{ value: 0x05, label: $localize`:@@inspector.param.hot-patch.05-addmusicm:inspector.param.hot-patch.05-addmusicm` },
	{
		value: 0x06,
		label: $localize`:@@inspector.param.hot-patch.06-carols-more-bin:inspector.param.hot-patch.06-carols-more-bin`,
	},
	{
		value: 0x07,
		label: $localize`:@@inspector.param.hot-patch.07-vanilla-smw:inspector.param.hot-patch.07-vanilla-smw`,
	},
] as const;

/** What `#option smwvtable` and `#option nspcvtable` compile to (`Music.cpp:2343-2367`). */
const VELOCITY_TABLES = [
	{
		value: 0x00,
		label: $localize`:@@inspector.param.velocity.00-smw-option-smwvtable:inspector.param.velocity.00-smw-option-smwvtable`,
	},
	{
		value: 0x01,
		label: $localize`:@@inspector.param.velocity.01-n-spc-option-nspcvtable:inspector.param.velocity.01-n-spc-option-nspcvtable`,
	},
] as const;

/** The same two, at `#amk 1`, where `#option` is not available (AMK0045). */
const VELOCITY_TABLES_BARE = [
	{ value: 0x00, label: $localize`:@@inspector.param.velocity.00-smw:inspector.param.velocity.00-smw` },
	{ value: 0x01, label: $localize`:@@inspector.param.velocity.01-n-spc:inspector.param.velocity.01-n-spc` },
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
					$localize`:@@inspector.param.subloop:inspector.param.subloop`,
					[{ value: 0x00, label: $localize`:@@inspector.param.00-start:inspector.param.00-start` }],
					{ structural: true },
				),
			],
			note: $localize`:@@inspector.param.opens-a-subloop-the-matching:inspector.param.opens-a-subloop-the-matching`,
		};
	}

	return {
		params: [
			u8($localize`:@@inspector.param.repeat-count:inspector.param.repeat-count`, "index", {
				min: 1,
				structural: true,
				describe: (n) =>
					$localize`:@@inspector.param.plays-the-subloop-times-the:inspector.param.plays-the-subloop-times-the ${n + 1}:count:`,
			}),
		],
		note: $localize`:@@inspector.param.closes-the-subloop-opened-by:inspector.param.closes-the-subloop-opened-by`,
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
			$localize`:@@inspector.param.hfd-form:inspector.param.hfd-form`,
			[
				{ value: 0x80, label: $localize`:@@inspector.param.hfd.80-dsp-write:inspector.param.hfd.80-dsp-write` },
				{ value: 0x81, label: $localize`:@@inspector.param.hfd.81-semitone-tune:inspector.param.hfd.81-semitone-tune` },
				{ value: 0x82, label: $localize`:@@inspector.param.hfd.82-aram-upload:inspector.param.hfd.82-aram-upload` },
				{
					value: 0x83,
					label: $localize`:@@inspector.param.hfd.83-not-implemented:inspector.param.hfd.83-not-implemented`,
				},
			],
			{ structural: true },
		);

		if (sub === 0x80) {
			return {
				params: [
					form,
					u8($localize`:@@inspector.param.dsp-register:inspector.param.dsp-register`, "address"),
					u8($localize`:@@inspector.param.value:inspector.param.value`, "opaque"),
				],
				note: $localize`:@@inspector.param.addmusic-4-05-wrote-dsp:inspector.param.addmusic-4-05-wrote-dsp`,
			};
		}

		if (sub === 0x81) {
			return {
				params: [form, s8($localize`:@@inspector.param.semitones:inspector.param.semitones`, "semitones")],
				note: $localize`:@@inspector.param.addmusic-4-05s-tune-command:inspector.param.addmusic-4-05s-tune-command`,
			};
		}

		if (sub === 0x82) {
			return {
				params: [
					form,
					u8($localize`:@@inspector.param.address-high:inspector.param.address-high`, "address"),
					u8($localize`:@@inspector.param.address-low:inspector.param.address-low`, "address"),
					u8($localize`:@@inspector.param.count-high:inspector.param.count-high`, "index", { structural: true }),
					u8($localize`:@@inspector.param.count-low:inspector.param.count-low`, "index", { structural: true }),
				],
				note: $localize`:@@inspector.param.an-aram-upload-the-two:inspector.param.an-aram-upload-the-two`,
				tail: $localize`:@@inspector.param.data-byte:inspector.param.data-byte`,
			};
		}

		return {
			params: [form],
			note: $localize`:@@inspector.param.amk0163-this-form-was-never:inspector.param.amk0163-this-form-was-never`,
		};
	}

	if (sub !== undefined && (sub & 0x80) !== 0) {
		return {
			params: [
				choice(
					$localize`:@@inspector.param.mode:inspector.param.mode`,
					[{ value: 0x80, label: $localize`:@@inspector.param.80-gain:inspector.param.80-gain` }],
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
					$localize`:@@inspector.param.decay-attack:inspector.param.decay-attack ${(value >> 4) & 0x07}:decay: ${value & 0x0f}:attack:`,
			}),
			u8("ADSR2", "rate", {
				describe: (value) =>
					$localize`:@@inspector.param.sustain-release:inspector.param.sustain-release ${(value >> 5) & 0x07}:sustain: ${value & 0x1f}:release:`,
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
				u8($localize`:@@inspector.param.sample:inspector.param.sample`, "srcn", {
					min: 0x80,
					structural: true,
					describe: (value) =>
						$localize`:@@inspector.param.sample-the-high-bit-is:inspector.param.sample-the-high-bit-is ${hex2(value - 0x80)}:sample:`,
				}),
				u8($localize`:@@inspector.param.multiplication-pitch:inspector.param.multiplication-pitch`, "opaque"),
			],
			note: $localize`:@@inspector.param.addmusic-4-05-overloaded-e5:inspector.param.addmusic-4-05-overloaded-e5`,
		};
	}

	return {
		params: [
			ticks($localize`:@@inspector.param.delay:inspector.param.delay`),
			RATE($localize`:@@inspector.param.rate-zero.tremolo:inspector.param.rate-zero.tremolo`),
			u8($localize`:@@inspector.param.depth:inspector.param.depth`, "level"),
		],
	};
};

/** `$FA` picks a different command per sub-byte. */
const misc: Resolver = (command) => {
	const sub = command.args[0]?.value;
	const selector = choice($localize`:@@inspector.param.sub-command:inspector.param.sub-command`, FA_SUBCOMMANDS, {
		structural: true,
		// Commands.asm:667-679 — a 16-bit index into a seven-entry table with no
		// bounds check. $05's slot was emptied when remote code replaced it.
		describe: (value) => {
			if (value === 0x05) {
				return $localize`:@@inspector.param.replaced-by-remote-code-type:inspector.param.replaced-by-remote-code-type`;
			}

			return value > 0x06 && value !== 0x7f && value !== 0xfe
				? $localize`:@@inspector.param.past-the-table-the-spc:inspector.param.past-the-table-the-spc`
				: null;
		},
	});

	switch (sub) {
		case 0x00:
			return {
				params: [
					selector,
					u8($localize`:@@inspector.param.channels:inspector.param.channels`, "channelMask", {
						control: "toggles",
						describe: () =>
							$localize`:@@inspector.param.channel-0-cannot-have-pitch:inspector.param.channel-0-cannot-have-pitch`,
					}),
				],
			};
		case 0x01:
			return { params: [selector, u8("GAIN", "rate")] };
		case 0x02:
			return { params: [selector, s8($localize`:@@inspector.param.semitones:inspector.param.semitones`, "semitones")] };
		case 0x03:
			return {
				params: [
					selector,
					u8($localize`:@@inspector.param.multiplier:inspector.param.multiplier`, "level", {
						describe: (value) =>
							$localize`:@@inspector.param.volume-1-ff-is-just:inspector.param.volume-1-ff-is-just ${((value + 1) / 256).toFixed(3)}:factor:`,
					}),
				],
			};
		case 0x04:
			return {
				params: [
					selector,
					u8($localize`:@@inspector.param.largest-delay:inspector.param.largest-delay`, "index", { max: 0x0f }),
				],
				note: $localize`:@@inspector.param.inserted-by-the-compiler-at:inspector.param.inserted-by-the-compiler-at`,
			};
		case 0x06:
			return {
				params: [
					selector,
					choice(
						$localize`:@@inspector.param.table:inspector.param.table`,
						// AMK0045: parseOptionDirective refuses #option at #amk 1 and
						// nowhere else, so #am4 and #amm songs — version 0 — may use it
						// and are named the directives too.
						command.target.amkVersion === 1 ? VELOCITY_TABLES_BARE : VELOCITY_TABLES,
						{
							// main.asm:2373 tests the byte against zero rather than against 1.
							describe: (value) =>
								value > 1
									? $localize`:@@inspector.param.anything-but-00-selects-the:inspector.param.anything-but-00-selects-the`
									: null,
						},
					),
				],
				note: $localize`:@@inspector.param.the-compiler-already-writes-fa:inspector.param.the-compiler-already-writes-fa`,
			};
		case 0x7f:
			return {
				params: [selector, choice($localize`:@@inspector.param.preset:inspector.param.preset`, HOT_PATCH_PRESETS)],
			};
		case 0xfe: {
			const bits = [
				selector,
				u8($localize`:@@inspector.param.bits:inspector.param.bits`, "opaque", {
					control: "toggles",
					structural: true,
					describe: (value) =>
						(value & 0x80) !== 0
							? $localize`:@@inspector.param.the-high-bit-defines-a:inspector.param.the-high-bit-defines-a`
							: null,
				}),
			];

			// Named only when it exists. A descriptor listing more parameters than the
			// command has does not go unnoticed — `describe.ts` gives every named one a
			// row, so an unconditional third would draw an empty "not written yet"
			// line under every ordinary `$FA $FE`.
			if (((command.args[1]?.value ?? 0) & 0x80) !== 0) {
				bits.push(
					u8($localize`:@@inspector.param.more-bits:inspector.param.more-bits`, "opaque", { control: "toggles" }),
				);
			}

			return { params: bits };
		}

		default:
			// `HEX_LENGTHS` gives `$FA` three bytes whatever the sub-command is, and
			// `parser.ts:parseHexCommand` only *rejects* an unknown one after reading both. So the
			// second byte is really there even when nothing here knows what it means,
			// and saying "Value" is more honest than letting it fall through to
			// "Argument 2".
			return { params: [selector, raw($localize`:@@inspector.param.value:inspector.param.value`)] };
	}
};

/** `#amk 1`'s `$FC` is remote *gain* — two arguments, not four (`parser.ts:parseHexCommand`). */
const remote: Resolver = (command) => {
	if (command.target.amkVersion === 1) {
		return {
			params: [u8("GAIN", "rate"), ticks($localize`:@@inspector.param.delay:inspector.param.delay`)],
			note: $localize`:@@inspector.param.under-amk-1-this-is:inspector.param.under-amk-1-this-is`,
		};
	}

	return {
		params: [
			u8($localize`:@@inspector.param.address-low:inspector.param.address-low`, "address", { control: "readonly" }),
			u8($localize`:@@inspector.param.address-high:inspector.param.address-high`, "address", { control: "readonly" }),
			choice($localize`:@@inspector.param.event-type:inspector.param.event-type`, REMOTE_TYPES, {
				// Commands.asm:1260-1269 stores any other value in the normal slot
				// with that type, and nothing ever tests for it.
				describe: (value) =>
					value >= 0x09 && value <= 0xfe
						? $localize`:@@inspector.param.no-such-event-the-code:inspector.param.no-such-event-the-code`
						: null,
			}),
			ticks($localize`:@@inspector.param.wait:inspector.param.wait`, {
				describe: (value) =>
					value === 0
						? $localize`:@@inspector.param.00-is-treated-as-0100:inspector.param.00-is-treated-as-0100`
						: null,
			}),
		],
		note: $localize`:@@inspector.param.the-address-is-written-by:inspector.param.the-address-is-written-by`,
	};
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const HEX_PARAMS: Readonly<Record<number, Resolver>> = {
	0xda: fixed([
		u8($localize`:@@inspector.param.instrument:inspector.param.instrument`, "index", {
			describe: (value) =>
				value === 0x13
					? // `@amk/spc`'s README.md — the driver has a real 20th slot, SRCN $0F,
						// that AddmusicK's own instrToSample marks as "Nothing". Nothing ever
						// marks $0F used, so optimizeSampleUsage (Music.cpp:3074) swaps it for
						// the zero-byte EMPTY.brr.
						$localize`:@@inspector.param.the-drivers-20th-slot-reachable:inspector.param.the-drivers-20th-slot-reachable`
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
		ticks($localize`:@@inspector.param.delay:inspector.param.delay`),
		DURATION,
		u8($localize`:@@inspector.param.target-note:inspector.param.target-note`, "note", {
			min: 0x80,
			max: 0xc5,
			describe: (value) => noteName(value),
		}),
	]),
	0xde: fixed([
		ticks($localize`:@@inspector.param.delay:inspector.param.delay`),
		RATE($localize`:@@inspector.param.rate-zero.vibrato:inspector.param.rate-zero.vibrato`),
		u8($localize`:@@inspector.param.depth:inspector.param.depth`, "level"),
	]),
	0xdf: fixed([]),
	0xe0: fixed([
		u8($localize`:@@inspector.param.global-volume:inspector.param.global-volume`, "level", { describe: percentOf255 }),
	]),
	0xe1: fixed([
		DURATION,
		u8($localize`:@@inspector.param.global-volume:inspector.param.global-volume`, "level", { describe: percentOf255 }),
	]),
	0xe2: fixed(
		[
			u8($localize`:@@inspector.param.tempo:inspector.param.tempo`, "rate", {
				max: MAX_TEMPO,
				describe: tempoLabel,
			}),
		],
		$localize`:@@inspector.param.the-driver-stores-one-more:inspector.param.the-driver-stores-one-more`,
	),
	0xe3: fixed(
		[
			TEMPO_FADE_DURATION,
			u8($localize`:@@inspector.param.tempo:inspector.param.tempo`, "rate", {
				max: MAX_TEMPO,
				describe: tempoLabel,
			}),
		],
		$localize`:@@inspector.param.its-handler-has-the-same:inspector.param.its-handler-has-the-same`,
	),
	0xe4: fixed([SEMITONES]),
	0xe5: tremolo,
	0xe6: subloop,
	0xe7: fixed([u8($localize`:@@inspector.param.volume:inspector.param.volume`, "level", { describe: percentOf255 })]),
	0xe8: fixed([
		DURATION,
		u8($localize`:@@inspector.param.volume:inspector.param.volume`, "level", { describe: percentOf255 }),
	]),
	0xe9: fixed(
		[
			u8($localize`:@@inspector.param.loop-point-low:inspector.param.loop-point-low`, "address", {
				control: "readonly",
			}),
			u8($localize`:@@inspector.param.loop-point-high:inspector.param.loop-point-high`, "address", {
				control: "readonly",
			}),
			u8($localize`:@@inspector.param.loop-count:inspector.param.loop-count`, "index"),
		],
		$localize`:@@inspector.param.written-by-the-compiler-from:inspector.param.written-by-the-compiler-from`,
	),
	0xea: fixed(
		[DURATION],
		$localize`:@@inspector.param.fades-to-the-amplitude-the:inspector.param.fades-to-the-amplitude-the`,
	),
	0xeb: fixed([
		ticks($localize`:@@inspector.param.delay:inspector.param.delay`),
		ticks($localize`:@@inspector.param.duration:inspector.param.duration`),
		SEMITONES,
	]),
	0xec: fixed([
		ticks($localize`:@@inspector.param.delay:inspector.param.delay`),
		ticks($localize`:@@inspector.param.duration:inspector.param.duration`),
		SEMITONES,
	]),
	0xed: envelope,
	0xee: fixed([s8($localize`:@@inspector.param.tuning:inspector.param.tuning`, "semitones")]),
	0xef: fixed([
		u8($localize`:@@inspector.param.channels:inspector.param.channels`, "channelMask", { control: "toggles" }),
		ECHO_VOLUME("L"),
		ECHO_VOLUME("R"),
	]),
	0xf0: fixed([]),
	0xf1: fixed([
		u8($localize`:@@inspector.param.delay:inspector.param.delay`, "index", {
			max: 0x0f,
			describe: (value) => {
				const masked = value & 0x0f;
				if (value > 0x0f) {
					// main.asm:2606 masks it, so an out-of-range value wraps in silence.
					return $localize`:@@inspector.param.is-out-of-range-the:inspector.param.is-out-of-range-the ${hex2(value)}:byte: ${hex2(masked)}:masked:`;
				}

				return $localize`:@@inspector.param.ms-kib-of-aram-reserved:inspector.param.ms-kib-of-aram-reserved ${masked * 16}:ms: ${masked * 2}:kib:`;
			},
		}),
		s8($localize`:@@inspector.param.feedback:inspector.param.feedback`, "level", {
			describe: (value) =>
				value === 0
					? $localize`:@@inspector.param.no-feedback-the-echo-plays:inspector.param.no-feedback-the-echo-plays`
					: $localize`:@@inspector.param.each-repeat-is-this-fraction:inspector.param.each-repeat-is-this-fraction`,
		}),
		choice($localize`:@@inspector.param.filter:inspector.param.filter`, [
			{ value: 0, label: $localize`:@@inspector.param.0-smw-low-pass:inspector.param.0-smw-low-pass` },
			{ value: 1, label: $localize`:@@inspector.param.1-flat:inspector.param.1-flat` },
		]),
	]),
	0xf2: fixed([DURATION, ECHO_VOLUME("L"), ECHO_VOLUME("R")]),
	// The handler at $0DBE forges a six-byte instrument entry in the channel's
	// backup table: byte 0 is the sample, byte 4 the tuning multiplier. It writes
	// neither byte 5 (the fraction) nor bytes 1-3 (the envelope), so both carry
	// over from whatever played last.
	0xf3: (_command, context) => ({
		params: [
			u8($localize`:@@inspector.param.sample:inspector.param.sample`, "srcn", {
				control: "select",
				choices: context.samples.filter((option) => option.label !== EMPTY_SAMPLE_NAME),
				max: Math.max(0, context.samples.length - 1),
			}),
			u8($localize`:@@inspector.param.tuning-multiplier:inspector.param.tuning-multiplier`, "rate", {
				describe: (value) =>
					value === 0
						? $localize`:@@inspector.param.a-multiplier-of-0-is:inspector.param.a-multiplier-of-0-is`
						: $localize`:@@inspector.param.the-whole-part-only-the:inspector.param.the-whole-part-only-the ${value}:multiplier:`,
			}),
		],
		note: $localize`:@@inspector.param.changes-the-sample-and-coarse:inspector.param.changes-the-sample-and-coarse`,
	}),
	0xf4: fixed([
		choice($localize`:@@inspector.param.sub-command:inspector.param.sub-command`, F4_SUBCOMMANDS, {
			structural: true,
			// Commands.asm:556-565 — ten entries, no bounds check, and $04's is
			// `dw $0000`. Neither value is offered above; both are reachable by hand.
			describe: (value) => {
				if (value === 0x04) {
					return $localize`:@@inspector.param.this-driver-has-no-such:inspector.param.this-driver-has-no-such`;
				}

				return value >= 0x0a
					? $localize`:@@inspector.param.past-the-table-the-spc:inspector.param.past-the-table-the-spc`
					: null;
			},
		}),
	]),
	0xf5: fixed(
		Array.from({ length: 8 }, (_, i) =>
			s8($localize`:@@inspector.param.coefficient:inspector.param.coefficient ${i + 1}:index:`, "level"),
		),
		$localize`:@@inspector.param.c7-multiplies-the-newest-sample:inspector.param.c7-multiplies-the-newest-sample`,
	),
	0xf6: fixed([
		u8($localize`:@@inspector.param.dsp-register:inspector.param.dsp-register`, "address"),
		u8($localize`:@@inspector.param.value:inspector.param.value`, "opaque"),
	]),
	0xf7: fixed(
		[
			raw($localize`:@@inspector.param.address-low:inspector.param.address-low`),
			raw($localize`:@@inspector.param.address-high:inspector.param.address-high`),
			raw($localize`:@@inspector.param.value:inspector.param.value`),
		],
		$localize`:@@inspector.param.addmusicms-write-byte-command:inspector.param.addmusicms-write-byte-command`,
	),
	// The same clock the `n` command sets, so it reads out the same way: the
	// driver writes both to the DSP's `FLG` register and the ladder is the DSP's.
	0xf8: fixed([
		u8($localize`:@@inspector.param.noise-clock:inspector.param.noise-clock`, "rate", {
			max: 0x1f,
			describe: (value) =>
				value === 0
					? $localize`:@@inspector.param.silent:inspector.param.silent`
					: $localize`:@@inspector.param.hz:inspector.param.hz ${Math.round(noiseHz(value)).toLocaleString()}:hz:`,
		}),
	]),
	// The handler at $1083 writes the first argument to $0167 and the second to
	// $0166 — inverted — and the main loop pushes both to the ports every tick
	// (main.asm:248-256).
	0xf9: fixed(
		[
			u8($localize`:@@inspector.param.to-2141:inspector.param.to-2141`, "opaque"),
			u8($localize`:@@inspector.param.to-2140:inspector.param.to-2140`, "opaque"),
		],
		$localize`:@@inspector.param.the-two-bytes-land-on:inspector.param.the-two-bytes-land-on`,
	),
	0xfa: misc,
	// `$FB` has a view of its own: its length is one of its arguments, so the
	// notes are a list you add to rather than a count you type. See
	// `arpeggio-command/`.
	0xfc: remote,
	0xfd: fixed([]),
	0xfe: fixed([]),
};
