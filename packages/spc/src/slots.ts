/** The slots of driver state a VCMD writes or clears, which is how the song walk names the command a note sounds under. */

import { VCMD } from "@amk/core/hardcoded-tables";

/**
 * The channel or song state a VCMD writes. Two commands sharing a slot
 * supersede each other, so a slot holds at most one command at a time.
 *
 * A driver fact and not a presentation one: it says what `main.asm` keeps where,
 * which is the same question {@link NoteState} answers with values. A reader that
 * wants only some of these filters them itself, the way the percussion set is the
 * roll's business and not this module's.
 *
 * Only VCMDs are here, because only a VCMD has an address for {@link WalkNote.origins}
 * to name it by. `q` folds into each note's duration byte, `h` and `@21`-`@29`
 * into the note byte, and `o`/`l` into neither — those have no slot and no origin,
 * and the source is where they are answered.
 *
 * `$DD` is a VCMD and is still not here: a slide runs once on the note that read
 * it and leaves nothing standing for a later note to sound under, so it occupies
 * no slot at all. {@link WalkNote.bendFrom} is where it is named.
 */
export type StateSlot =
	/** `$DA`. `@21`-`@29` reach {@link NoteState.instrument} without one. */
	| "instrument"
	/** `$F3`. */
	| "sample"
	/** `$ED`, ADSR or GAIN. */
	| "envelope"
	/** `$E7`/`$E8`. */
	| "volume"
	/** `$DB`/`$DC`. */
	| "pan"
	/** `$EE`, the pitch modifier. */
	| "tune"
	/** `$FA $02`, `!HTuneValues` — a different register from `$EE`. */
	| "htune"
	/** `$F8`, cleared by `$DA` as the driver clears it. */
	| "noise"
	/** `$DE`/`$EA`, cleared by `$DF`. */
	| "vibrato"
	/** `$E5`, cleared by `$FD`. */
	| "tremolo"
	/** `$EB`/`$EC`, cleared by `$FE`. */
	| "pitchEnvelope"
	/** `$FB`. */
	| "arpeggio"
	/** `$F4`'s nine switches, as one slot: they draw the same and read the same. */
	| "toggles"
	/** `$FA`'s other sub-commands, likewise. */
	| "settings"
	/** `$FC`. */
	| "remote"
	/** `$E2`/`$E3`. Song-wide. */
	| "tempo"
	/** `$E0`/`$E1`. Song-wide. */
	| "globalVolume"
	/** `$E4`. Song-wide. */
	| "transpose"
	/** `$EF`/`$F1`/`$F2`, cleared by `$F0`. One DSP, so song-wide. */
	| "echo"
	/** `$F5`. Song-wide, for the same reason. */
	| "fir";

/** Every slot, in the order {@link WalkNote.origins} is indexed by. */
export const SLOTS: readonly StateSlot[] = [
	"instrument",
	"sample",
	"envelope",
	"volume",
	"pan",
	"tune",
	"htune",
	"noise",
	"vibrato",
	"tremolo",
	"pitchEnvelope",
	"arpeggio",
	"toggles",
	"settings",
	"remote",
	"tempo",
	"globalVolume",
	"transpose",
	"echo",
	"fir",
];

/**
 * How many of {@link SLOTS} a channel owns. The song-wide ones are the tail, so
 * one number splits them and a channel's array need only be this long.
 *
 * Taken from where `"tempo"` sits rather than written as a count, so adding a
 * slot to either half moves the boundary with it. `walktest` checks the tail is
 * what this claims, since a per-channel slot filed as song-wide would have one
 * channel's command reported by all eight.
 */
export const CHANNEL_SLOTS = SLOTS.indexOf("tempo");

export const slotAt = (slot: StateSlot): number => SLOTS.indexOf(slot);

export const INSTRUMENT_SLOT = slotAt("instrument");

/**
 * The slot a command writes, and the one it clears instead.
 *
 * A function rather than a table because `$FA` is eight commands under one byte
 * and only `$02` writes a slot of its own, and because the four `off` commands
 * take a slot away rather than occupying one: after `$DF` there is no vibrato,
 * so reporting the `$DF` as the vibrato in force would be a plain lie.
 */
export function slotsOf(vcmd: number, sub: number): { writes: StateSlot | null; clears: StateSlot | null } {
	switch (vcmd) {
		case VCMD.Instrument:
			// `SetInstrument` writes `$C1+x` and clears the noise bit with it
			// (`main.asm:2554` ModifyNoise), which is why this takes noise away.
			return { writes: "instrument", clears: "noise" };
		case VCMD.Pan:
		case VCMD.PanFade:
			return { writes: "pan", clears: null };
		case VCMD.Vibrato:
		case VCMD.VibratoFade:
			return { writes: "vibrato", clears: null };
		case VCMD.VibratoOff:
			return { writes: null, clears: "vibrato" };
		case VCMD.GlobalVolume:
		case VCMD.GlobalVolumeFade:
			return { writes: "globalVolume", clears: null };
		case VCMD.Tempo:
		case VCMD.TempoFade:
			return { writes: "tempo", clears: null };
		case VCMD.GlobalTranspose:
			return { writes: "transpose", clears: null };
		case VCMD.Tremolo:
			return { writes: "tremolo", clears: null };
		case VCMD.Volume:
		case VCMD.VolumeFade:
			return { writes: "volume", clears: null };
		case VCMD.PitchEnvelopeRelease:
		case VCMD.PitchEnvelopeAttack:
			return { writes: "pitchEnvelope", clears: null };
		case VCMD.Adsr:
			return { writes: "envelope", clears: null };
		case VCMD.FineTune:
			return { writes: "tune", clears: null };
		case VCMD.EchoVolume:
		case VCMD.EchoDelay:
		case VCMD.EchoFade:
			return { writes: "echo", clears: null };
		case VCMD.EchoOff:
			return { writes: null, clears: "echo" };
		case VCMD.SampleLoad:
			return { writes: "sample", clears: null };
		case VCMD.Toggles:
			return { writes: "toggles", clears: null };
		case VCMD.Fir:
			return { writes: "fir", clears: null };
		case VCMD.Noise:
			return { writes: "noise", clears: null };
		case VCMD.Settings:
			return { writes: sub === 0x02 ? "htune" : "settings", clears: null };
		case VCMD.Arpeggio:
			return { writes: "arpeggio", clears: null };
		case VCMD.RemoteCode:
			return { writes: "remote", clears: null };
		case VCMD.TremoloOff:
			return { writes: null, clears: "tremolo" };
		case VCMD.PitchEnvelopeOff:
			return { writes: null, clears: "pitchEnvelope" };
		default:
			// `$E6`/`$E9` are structure, and `$F6`/`$F7`/`$F9` write a register or a
			// byte once rather than setting anything a later note reads. So does
			// `$DD`, which runs on the note that read it and is gone: the arm in
			// `runCommand` raises its entry and names it on that note instead.
			return { writes: null, clears: null };
	}
}

/**
 * Whether the next command into this one's slot undoes everything it did, so
 * that a note playing without it in {@link WalkNote.origins} is proof it reaches
 * nothing more.
 *
 * Not a command that only clears a slot — after `$DF` there is no vibrato to be
 * in force, so no note ever names it — nor `$F4`'s switches or `$FA`'s settings,
 * which share a slot without replacing one another (two `$F4 $01`s cancel, and
 * `$F4 $03` leaves `$F4 $01` standing), nor one that fills no slot at all.
 */
export function replacedByNextInSlot(vcmd: number, sub: number): boolean {
	const { writes } = slotsOf(vcmd, sub);
	return writes !== null && writes !== "toggles" && writes !== "settings";
}
