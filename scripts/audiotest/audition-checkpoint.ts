/**
 * `audiotest`: a note auditioned from a checkpoint is the note auditioned from
 * the top of the song, byte for byte.
 */

import "../localize";
import { auditionNote, prepareCheckpoint } from "@amk/spc/note-audition";
import { check, section } from "../harness";
import { driver, compileToSpc, emu, firstDifference } from "./support";

section("a note auditioned from a checkpoint");
{
	const scratchAt = driver.manifest.localPos;
	const NOTE = 0xa4;

	// Four channels, so the hand-over waits on a different voice's fetch per
	// channel and the checkpoint has to serve all of them.
	const SONG = `#amk 4
#0 t40 o5 v200 q7F @0 l8 c d e f @8 g a b > c < c d e f g a b > c
#1 t40 o3 v220 q7F @8 l2 c e g e
#2 t40 o3 v220 q7F @8 l2 e g b g
#3 t40 o4 v180 q7F @0 l4 g g g g a a a a
`;

	const spc = compileToSpc(SONG);
	const pristine = spc.slice();
	const where = (index: number) => (index < 0 ? "identical" : `first differs at frame ${index}`);

	for (const [channel, silenced] of [
		[0, 0],
		[3, 0],
		[1, 0b0100],
	] as const) {
		const asked = { atTicks: 200, channel, note: NOTE, ticks: 48, scratchAt, silenced };
		const fromTop = auditionNote(emu, spc, asked);
		const checkpoint = prepareCheckpoint(emu, spc, { atTicks: 168, silenced });
		const resumed = auditionNote(emu, spc, asked, checkpoint);
		const differs = firstDifference(fromTop.pcm, resumed.pcm);

		check(
			`channel ${channel} under mask ${silenced}: the checkpoint reached its tick`,
			checkpoint.ticks === 168,
			`${checkpoint.ticks}`,
		);
		check(`channel ${channel} under mask ${silenced}: the same PCM`, differs < 0, where(differs));
		check(
			`channel ${channel} under mask ${silenced}: the same ticks reached and held`,
			fromTop.reachedTicks === resumed.reachedTicks && fromTop.heldTicks === resumed.heldTicks,
			`${fromTop.reachedTicks}/${fromTop.heldTicks} against ${resumed.reachedTicks}/${resumed.heldTicks}`,
		);

		// One checkpoint serves any number of notes: the restore leaves it as it was.
		const again = auditionNote(emu, spc, asked, checkpoint);
		check(
			`channel ${channel} under mask ${silenced}: and again off the same checkpoint`,
			firstDifference(fromTop.pcm, again.pcm) < 0,
		);
	}

	// A checkpoint run on from an earlier one is the checkpoint a run from the top
	// leaves, which is what following a moving position costs a cell at a time.
	const asked = { atTicks: 200, channel: 0, note: NOTE, ticks: 48, scratchAt };
	const fromTop = auditionNote(emu, spc, asked);
	const first = prepareCheckpoint(emu, spc, { atTicks: 96 });
	const second = prepareCheckpoint(emu, spc, { atTicks: 192 }, first);
	check("a checkpoint run on from another reaches its own tick", second.ticks === 192, `${second.ticks}`);
	check(
		"and a note from it is still the note from the top",
		firstDifference(fromTop.pcm, auditionNote(emu, spc, asked, second).pcm) < 0,
	);

	// The three a checkpoint must not be used for: one standing on the note's own
	// tick, one past it, and one taken under another mask. Each falls back to the
	// run from the top rather than answering from the wrong place.
	const onTheTick = prepareCheckpoint(emu, spc, { atTicks: 200 });
	check(
		"a checkpoint on the note's own tick is not resumed from",
		firstDifference(fromTop.pcm, auditionNote(emu, spc, asked, onTheTick).pcm) < 0,
	);

	const past = prepareCheckpoint(emu, spc, { atTicks: 240 });
	check("nor is one past it", firstDifference(fromTop.pcm, auditionNote(emu, spc, asked, past).pcm) < 0);

	const masked = prepareCheckpoint(emu, spc, { atTicks: 168, silenced: 0b0010 });
	check(
		"nor one taken under another mask",
		firstDifference(fromTop.pcm, auditionNote(emu, spc, asked, masked).pcm) < 0,
	);

	check(
		"the caller's SPC image is unwritten",
		spc.every((byte, index) => byte === pristine[index]),
	);
}
