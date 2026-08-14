/**
 * Turns the parser's per-channel byte vectors into the final relocated blob.
 *
 * Ports two AddmusicK functions:
 *   - `Music::pointersFirstPass`  (Music.cpp:2982) — builds the header
 *   - `fixMusicPointers`          (AddmusicK.cpp:1138) — resolves the sentinels
 *
 * The header is built with placeholder words `0xFFFB`-`0xFFFF`, which the
 * relocation pass then swaps for real addresses.
 */

import { hex, hex4 } from "@amk/core/hex";
import type { Diagnostic, NoteAddress } from "@amk/core/types";
import type { NoteEvent, ParseOutput } from "./parser";

export interface LinkResult {
	data: Uint8Array;
	headerSize: number;
	channelSizes: number[];
	loopDataSize: number;
	/** The parser's note events with their offsets relocated to ARAM addresses, sorted by address. */
	noteMap: NoteAddress[];
	diagnostics: Diagnostic[];
}

/** Sentinel values written by the header builder, resolved during relocation. */
const SENTINEL_NO_LOOP = 0xffff; // Will be re-evaluated to 0000
const SENTINEL_LOOP_MARKER = 0xfffe; // Will be re-evaluated to FF00
const SENTINEL_LOOP_TARGET_INTRO = 0xfffd; // Will be re-evaluated to 0002 + ARAMPos
const SENTINEL_LOOP_TARGET_NO_INTRO = 0xfffc; // Will be re-evaluated to ARAMPos
const SENTINEL_UNUSED_CHANNEL_SLOTS = 0xfffb; // -> 0x0000

export function link(parsed: ParseOutput, aramAddress: number): LinkResult {
	const diagnostics: Diagnostic[] = [];
	const data = parsed.data.map((channel) => [...channel]);
	const loopLocations = parsed.loopLocations.map((locations) => [...locations]);
	const phrasePointers = parsed.phrasePointers.map((pair) => [...pair]);
	const noteEvents = parsed.noteEvents.map((event) => ({ ...event }));

	prependBlobPrefix(parsed, data, loopLocations, phrasePointers, noteEvents);

	// Lay the channels out end to end and record where each one starts.
	let offset = 0;
	for (let channel = 0; channel < 8; channel++) {
		if (data[channel].length) {
			phrasePointers[channel][0] = offset;
		}

		offset += data[channel].length;
	}

	for (let channel = 0; channel < 8; channel++) {
		phrasePointers[channel][1] += phrasePointers[channel][0];
	}

	const header = buildHeader(parsed, phrasePointers, data);
	relocate(header, parsed, aramAddress);
	relocateLoopPointers(data, loopLocations, header.length, aramAddress);

	const blob: number[] = [...header];
	for (let channel = 0; channel < 9; channel++) {
		blob.push(...data[channel]);
	}

	// Where each channel starts within the data area, off the *final* channel
	// lengths — `phrasePointers[ch][0]` is only written for non-empty channels.
	// The loop block is channel 8 and sits after the eight music channels, so
	// one cumulative pass covers it too, matching `relocateLoopPointers`.
	const channelStart: number[] = [];
	{
		let start = 0;
		for (let channel = 0; channel < 9; channel++) {
			channelStart[channel] = start;
			start += data[channel].length;
		}
	}

	const noteMap: NoteAddress[] = noteEvents
		.map((event) => ({
			channel: event.channel,
			address: aramAddress + header.length + channelStart[event.channel] + event.offset,
			note: event.note,
			ticks: event.ticks,
			span: event.span,
		}))
		.sort((a, b) => a.address - b.address);

	const end = aramAddress + blob.length;
	if (end > 0x10000) {
		diagnostics.push({
			severity: "error",
			code: "AMK0300",
			message: `Song data runs past the end of ARAM (0x${hex4(aramAddress)} + 0x${hex4(blob.length)} = 0x${hex(end)}).`,
			span: { start: 0, end: 0, line: 1 },
		});
	}

	return {
		data: Uint8Array.from(blob),
		headerSize: header.length,
		channelSizes: data.slice(0, 8).map((channel) => channel.length),
		loopDataSize: data[8].length,
		noteMap,
		diagnostics,
	};
}

/**
 * AddmusicK prepends `$FA $04 <echo size>` and `$FA $06 $01` to the lowest
 * channel that appears in the file, then shifts every pointer already recorded
 * for that channel. Music.cpp:2989-3050.
 */
function prependBlobPrefix(
	parsed: ParseOutput,
	data: number[][],
	loopLocations: number[][],
	phrasePointers: number[][],
	noteEvents: NoteEvent[],
): void {
	const channel = parsed.resizedChannel;
	if (channel === -1) {
		return;
	}

	let shift = 0;

	// Music.cpp:2989 — one 3-byte prefix selects the playback mode the song was
	// written for. #amk 2+ gets the N-SPC velocity table; the older targets each
	// get their own compatibility mode via $FA $7F.
	if (parsed.targetAMKVersion > 1) {
		data[channel].unshift(0xfa, 0x06, 0x01);
		shift += 3;
	}

	if (parsed.targetAMKVersion === 1) {
		data[channel].unshift(0xfa, 0x7f, 0x02);
		shift += 3;
	} else if (parsed.songTargetProgram === 1) {
		data[channel].unshift(0xfa, 0x7f, 0x04); // Addmusic 4.05
		shift += 3;
	} else if (parsed.songTargetProgram === 2) {
		data[channel].unshift(0xfa, 0x7f, 0x05); // AddmusicM
		shift += 3;
	}

	const echoInline = parsed.echoBufferSize > 0 || !parsed.echoBufferAllocVCMDIsSet || parsed.hasEchoBufferCommand;

	let spliceTarget = -1;
	let spliceAt = 0;

	if (echoInline) {
		data[channel].unshift(0xfa, 0x04, parsed.echoBufferSize);
		shift += 3;
	} else {
		// #option amk109hotpatch: place the allocation after the hot-patch VCMD
		// rather than at the very start.
		const target = parsed.echoBufferAllocVCMDChannel;
		const at = parsed.echoBufferAllocVCMDLoc + 3;
		data[target].splice(at, 0, 0xfa, 0x04, parsed.echoBufferSize);
		spliceTarget = target;
		spliceAt = at;
		for (let n = 0; n < loopLocations[target].length; n++) {
			loopLocations[target][n] += 3;
		}

		phrasePointers[target][0] += 3;
		phrasePointers[target][1] += 3;
	}

	for (let n = 0; n < loopLocations[channel].length; n++) {
		loopLocations[channel][n] += shift;
	}

	phrasePointers[channel][0] += shift;
	phrasePointers[channel][1] += shift;

	for (const event of noteEvents) {
		if (event.channel === channel) {
			event.offset += shift;
		}

		if (event.channel === spliceTarget && event.offset >= spliceAt) {
			event.offset += 3;
		}
	}
}

/** Music.cpp:3110-3200. */
function buildHeader(parsed: ParseOutput, phrasePointers: number[][], data: number[][]): number[] {
	const instrLen = parsed.instrumentData.length;

	let size = 20;
	if (parsed.hasIntro) {
		size += 18;
	}

	if (!parsed.doesntLoop) {
		size += 2;
	}

	size += instrLen;

	const header = new Array<number>(size).fill(0);
	const writeWord = (at: number, value: number): void => {
		header[at] = value & 0xff;
		header[at + 1] = (value >> 8) & 0xff;
	};

	let add = (parsed.hasIntro ? 2 : 0) + (parsed.doesntLoop ? 0 : 2) + 4;

	for (let n = 0; n < instrLen; n++) {
		header[n + add] = parsed.instrumentData[n];
	}

	writeWord(0, add + instrLen);

	if (parsed.doesntLoop) {
		writeWord(add - 2, SENTINEL_NO_LOOP);
	} else {
		writeWord(add - 4, SENTINEL_LOOP_MARKER);
		writeWord(add - 2, parsed.hasIntro ? SENTINEL_LOOP_TARGET_INTRO : SENTINEL_LOOP_TARGET_NO_INTRO);
	}

	if (parsed.hasIntro) {
		writeWord(2, add + instrLen + 16);
	}

	add += instrLen;

	for (let channel = 0; channel < 8; channel++) {
		const used = data[channel].length !== 0;
		writeWord(add + channel * 2, used ? phrasePointers[channel][0] + size : SENTINEL_UNUSED_CHANNEL_SLOTS);
	}

	if (parsed.hasIntro) {
		for (let channel = 0; channel < 8; channel++) {
			const used = data[channel].length !== 0;
			writeWord(add + 16 + channel * 2, used ? phrasePointers[channel][1] + size : SENTINEL_UNUSED_CHANNEL_SLOTS);
		}
	}

	return header;
}

/** Walk the header and replace sentinels with real addresses. AddmusicK.cpp:1170-1216. */
function relocate(header: number[], parsed: ParseOutput, aramAddress: number): void {
	const instrLen = parsed.instrumentData.length;
	let untilJump = -1;

	for (let j = 0; j < header.length; j += 2) {
		if (untilJump === 0) {
			j += instrLen;
			untilJump = -1;
			if (j >= header.length) {
				break;
			}
		}

		const word = header[j] | (header[j + 1] << 8);
		const writeWord = (value: number): void => {
			header[j] = value & 0xff;
			header[j + 1] = (value >> 8) & 0xff;
		};

		switch (word) {
			case SENTINEL_NO_LOOP:
				writeWord(0x0000);
				untilJump = 1;
				break;
			case SENTINEL_LOOP_MARKER:
				writeWord(0x00ff);
				untilJump = 2;
				break;
			case SENTINEL_LOOP_TARGET_INTRO:
				writeWord(aramAddress + 2);
				break;
			case SENTINEL_LOOP_TARGET_NO_INTRO:
				writeWord(aramAddress);
				break;
			case SENTINEL_UNUSED_CHANNEL_SLOTS:
				writeWord(0x0000);
				break;
			default:
				writeWord(word + aramAddress);
		}

		untilJump--;
	}
}

/**
 * Loop-call pointers hold an offset into the loop block, which lands after the
 * header and all eight channels. AddmusicK.cpp:1218-1228.
 */
function relocateLoopPointers(
	data: number[][],
	loopLocations: number[][],
	headerSize: number,
	aramAddress: number,
): void {
	let normalChannelsSize = 0;
	for (let channel = 0; channel < 8; channel++) {
		normalChannelsSize += data[channel].length;
	}

	const base = aramAddress + normalChannelsSize + headerSize;

	for (let channel = 0; channel < 9; channel++) {
		for (const at of loopLocations[channel]) {
			const word = (data[channel][at] & 0xff) | (data[channel][at + 1] << 8);
			const value = word + base;
			data[channel][at] = value & 0xff;
			data[channel][at + 1] = (value >> 8) & 0xff;
		}
	}
}
