/** What every `miditest` section shares: a MIDI file built in memory, imported, compiled, walked and diagnosed as the editor does. */

import "../localize";
import { compiler } from "@amk/compiler";
import { DEFAULT_TRANSPOSE } from "@amk/core/hardcoded-tables";
import type { CompileResult, Diagnostic } from "@amk/core/types";
import { type MidiImport, type SongOptions, type WrittenSong, readMidi, writeMidi } from "@amk/import/midi";
import { loadDriver } from "@amk/spc/driver";
import { readInstrumentTables } from "@amk/spc/instruments";
import { type SongTimeline, type WalkNote, unreachableChannels, walkSong } from "@amk/spc/song-walk";
import { tokenize } from "@amk/tokens";
import { commandHazards } from "@amk/tokens/command-hazards";
import { echoHazards } from "@amk/tokens/echo-hazards";
import { pitchRange } from "../../web/src/app/state/pitch-range";
import { repeatSettings, repeatTempo } from "../../web/src/app/state/repeat-carry";
import { stubFetch } from "../harness";

stubFetch();

const driver = await loadDriver();
export const ARAM = driver.manifest.localPos;
export const TABLES = readInstrumentTables(driver.programData, driver.manifest.programPos);
const OPTIONS = {
	sampleNames: driver.samples.map((sample) => sample.sampleName),
	sampleGroups: driver.manifest.sampleGroups,
};

// --- An SMF writer ----------------------------------------------------------

/** One event at an absolute tick, as the bytes a track holds after its delta time. */
export interface Ev {
	tick: number;
	bytes: number[];
}

export function vlq(value: number): number[] {
	const out = [value & 0x7f];
	let rest = value >>> 7;
	while (rest > 0) {
		out.unshift((rest & 0x7f) | 0x80);
		rest >>>= 7;
	}

	return out;
}

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

export const on = (tick: number, channel: number, key: number, velocity = 100): Ev => ({
	tick,
	bytes: [0x90 | channel, key, velocity],
});
export const off = (tick: number, channel: number, key: number): Ev => ({ tick, bytes: [0x80 | channel, key, 0] });
export const cc = (tick: number, channel: number, controller: number, value: number): Ev => ({
	tick,
	bytes: [0xb0 | channel, controller, value],
});
export const program = (tick: number, channel: number, value: number): Ev => ({ tick, bytes: [0xc0 | channel, value] });
/** A pitch bend, 0-16383 with 8192 centred. */
export const bend = (tick: number, channel: number, value: number): Ev => ({
	tick,
	bytes: [0xe0 | channel, value & 0x7f, (value >> 7) & 0x7f],
});
export const meta = (tick: number, type: number, data: number[]): Ev => ({
	tick,
	bytes: [0xff, type, ...vlq(data.length), ...data],
});
export const tempo = (tick: number, bpm: number): Ev => {
	const micros = Math.round(60_000_000 / bpm);
	return meta(tick, 0x51, [(micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff]);
};

export const meter = (tick: number, numerator: number, denominator: number): Ev =>
	meta(tick, 0x58, [numerator, Math.log2(denominator), 24, 8]);
export const marker = (tick: number, text: string): Ev => meta(tick, 0x06, ascii(text));
export const trackName = (tick: number, text: string): Ev => meta(tick, 0x03, ascii(text));
export const sysex = (tick: number, data: number[]): Ev => ({ tick, bytes: [0xf0, ...vlq(data.length), ...data] });

/** A note's key-on and key-off. */
export function note(tick: number, channel: number, key: number, length: number, velocity = 100): Ev[] {
	return [on(tick, channel, key, velocity), off(tick + length, channel, key)];
}

/** A track body: events in tick order, key-offs before key-ons on a tick, ending in an end-of-track. */
export function trackBytes(events: readonly Ev[]): number[] {
	const sorted = events
		.map((event, order) => ({ event, order }))
		.sort((a, b) => {
			const offFirst = (e: Ev): number => ((e.bytes[0] & 0xf0) === 0x80 ? 0 : 1);
			return a.event.tick - b.event.tick || offFirst(a.event) - offFirst(b.event) || a.order - b.order;
		});
	const out: number[] = [];
	let at = 0;
	for (const { event } of sorted) {
		out.push(...vlq(event.tick - at), ...event.bytes);
		at = event.tick;
	}

	out.push(0, 0xff, 0x2f, 0);
	return out;
}

function u32(value: number): number[] {
	return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

export function chunk(id: string, body: readonly number[]): number[] {
	return [...ascii(id), ...u32(body.length), ...body];
}

/** A whole file: the header, then a track chunk per list of events. `division` is a raw header word. */
export function smf(tracks: readonly (readonly Ev[])[], format = 1, division = 96): Uint8Array {
	const header = chunk("MThd", [
		0,
		format,
		(tracks.length >> 8) & 0xff,
		tracks.length & 0xff,
		division >> 8,
		division & 0xff,
	]);
	return new Uint8Array([...header, ...tracks.flatMap((events) => chunk("MTrk", trackBytes(events)))]);
}

// --- Importing and reading the result back --------------------------------------

export interface Song {
	text: string;
	result: CompileResult;
	timeline: SongTimeline | null;
	/** What the editor's Problems list would hold. */
	diagnostics: Diagnostic[];
}

/** `text` compiled, walked and diagnosed as the editor holds it. */
export function song(text: string): Song {
	const result = compiler.compile({ source: text, aramAddress: ARAM, options: OPTIONS });
	const index = tokenize(text);
	const timeline = result.data ? walkSong(result.data, ARAM) : null;
	return {
		text,
		result,
		timeline,
		diagnostics: [
			...result.diagnostics,
			...echoHazards(index.commands),
			...commandHazards(index),
			...(timeline ? unreachableChannels(timeline, result.noteMap ?? []) : []),
			...(timeline ? repeatTempo(timeline, result.commandMap ?? []) : []),
			...(timeline ? repeatSettings(timeline, { result, text }) : []),
			...(timeline ? pitchRange(timeline, result, TABLES) : []),
		],
	};
}

export interface Imported {
	midi: MidiImport;
	written: WrittenSong;
	song: Song;
}

/** Reads `bytes`, writes the suggested parts at a 1/64 grid (or as `options` says), and compiles the song. */
export function imported(bytes: Uint8Array, options: Partial<SongOptions> = {}): Imported {
	const midi = readMidi(bytes);
	const written = writeMidi(
		midi,
		{
			grid: 3,
			keep: midi.suggested,
			instruments: new Map(),
			echo: true,
			loop: "markers",
			fallbackTitle: null,
			...options,
		},
		TABLES,
	);
	return { midi, written, song: song(written.text) };
}

export function codes(built: Song): string[] {
	return built.diagnostics.map((diagnostic) => diagnostic.code);
}

/** Codes that are errors or warnings, not notes: what a clean import must not raise. */
export function problems(built: Song): string[] {
	return built.diagnostics.filter((d) => d.severity !== "info").map((d) => `${d.code} ${d.message}`);
}

/** The walk's notes on one channel. */
export function played(built: Song, channel: number): WalkNote[] {
	return (built.timeline?.notes ?? []).filter((n) => n.channel === channel);
}

/** The MIDI key a pitched walked note sounds: its emitted key put back through the instrument's transposition. */
export function midiKey(walked: WalkNote): number | null {
	if (walked.key === null) {
		return null;
	}

	return walked.key + 24 + (DEFAULT_TRANSPOSE[walked.state.instrument ?? 0] ?? 0);
}
