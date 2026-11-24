/** `miditest`: the SMF reader — variable-length quantities, running status, a velocity-0 key-off, RMID, unknown chunks, a file cut short, and the files it refuses. */

import { detectFormat } from "@amk/import/format";
import { SmfError, readMidi } from "@amk/import/midi";
import { readSmf } from "@amk/import/midi/smf";
import { check, section } from "../harness";
import { chunk, note, smf, vlq } from "./support";

const header = (tracks: number, format = 1, division = 96): number[] =>
	chunk("MThd", [0, format, 0, tracks, division >> 8, division & 0xff]);

const word = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
const le32 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, value >>> 24];

function refusal(bytes: Uint8Array): string | null {
	try {
		readMidi(bytes);
		return null;
	} catch (error) {
		return error instanceof SmfError ? error.code : String(error);
	}
}

section("parser: variable-length quantities");

for (const delta of [0, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x0fffffff]) {
	const body = [...vlq(delta), 0x90, 60, 100, 0, 0x80, 60, 0, 0, 0xff, 0x2f, 0];
	const parsed = readSmf(new Uint8Array([...header(1), ...chunk("MTrk", body)]));
	check(
		`a delta of ${delta} lands on its tick`,
		parsed.tracks[0][0]?.tick === delta,
		JSON.stringify(parsed.tracks[0][0]),
	);
}

section("parser: running status");

{
	// A key-on, then two more key-ons and two velocity-0 key-offs with the status left out.
	const body = [0, 0x90, 60, 100, 48, 62, 100, 48, 60, 0, 48, 62, 0, 0, 0xff, 0x2f, 0];
	const bytes = new Uint8Array([...header(1), ...chunk("MTrk", body)]);
	const events = readSmf(bytes).tracks[0];
	check(
		"running status carries the key-on across delta times",
		events.length === 4 && events.every((e) => e.type === "channel" && e.status === 0x90),
		JSON.stringify(events),
	);
	const notes = readMidi(bytes).performance.channels[0].notes;
	check(
		"a velocity-0 key-on is a key-off",
		notes.length === 2 && notes[0].end === 96 && notes[1].start === 48 && notes[1].end === 144,
		JSON.stringify(notes),
	);
}

{
	// A meta event cancels running status, so a data byte after it starts no event.
	const body = [0, 0x90, 60, 100, 0, 0xff, 0x01, 1, 0x41, 48, 60, 0];
	const parsed = readSmf(new Uint8Array([...header(1), ...chunk("MTrk", body)]));
	check(
		"a meta event cancels running status",
		parsed.truncated.includes(0) && parsed.tracks[0].length === 2,
		JSON.stringify(parsed.tracks[0]),
	);
}

section("parser: containers and chunks");

{
	const plain = smf([note(0, 0, 60, 96)]);
	const riff = new Uint8Array([
		...word("RIFF"),
		...le32(plain.length + 12),
		...word("RMID"),
		...word("data"),
		...le32(plain.length),
		...plain,
	]);
	check(
		"an RMID file is read through its data chunk",
		detectFormat(riff) === "midi" && readMidi(riff).parts.length === 1,
	);
	check("a plain file is MIDI", detectFormat(plain) === "midi");
	check("anything else is no format", detectFormat(new TextEncoder().encode("#amk 4\n#0 c4")) === null);

	const tracks = [...plain].slice(14);
	const withJunk = new Uint8Array([
		...header(2),
		...chunk("XFIH", [1, 2, 3, 4, 5]),
		...tracks,
		...chunk("MTrk", [0, 0xff, 0x2f, 0]),
	]);
	const read = readSmf(withJunk);
	check(
		"an unknown chunk is skipped whole",
		read.tracks.length === 2 && read.truncated.length === 0,
		JSON.stringify(read.truncated),
	);
}

{
	const full = [...smf([[...note(0, 0, 60, 96), ...note(96, 0, 62, 96), ...note(192, 0, 64, 96)]])];
	const midi = readMidi(new Uint8Array(full.slice(0, full.length - 9)));
	check(
		"a file cut short keeps the notes before the cut",
		midi.performance.channels[0].notes.length >= 2,
		JSON.stringify(midi.performance.channels[0].notes),
	);
	check("and says the track was cut", midi.performance.truncated.includes(0));
}

section("parser: refusals");

check("not MIDI", refusal(new Uint8Array(14)) === "not-midi");
check("a short header", refusal(new Uint8Array(chunk("MThd", [0, 1, 0]))) === "bad-header");
check("format 2", refusal(new Uint8Array([...header(1, 2), ...chunk("MTrk", [0, 0xff, 0x2f, 0])])) === "format-2");
check("no tracks", refusal(new Uint8Array(header(0))) === "no-tracks");
check("no notes", refusal(new Uint8Array([...header(1), ...chunk("MTrk", [0, 0xff, 0x2f, 0])])) === "no-notes");
check(
	"a zero division",
	refusal(new Uint8Array([...header(1, 1, 0), ...chunk("MTrk", [0, 0xff, 0x2f, 0])])) === "bad-header",
);
