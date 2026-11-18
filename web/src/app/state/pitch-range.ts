/**
 * `SST0513` and `SST0514` — a note pitched past what its instrument can play, and a vibrato that
 * swings one there.
 *
 * From `$4000` the DSP's pitch register wraps round low, and past o7 b or below o1 c the driver's
 * own arithmetic gives it nothing (`@amk/spc/pitch`). Which notes get there turns on the
 * instrument's multiplier and the transposition and fine tune the walk reports. A note whose tuning
 * the walk cannot vouch for is left alone: under a `$F3`, an arpeggio, a remote body that moves the
 * pitch, noise, or an instrument no table holds.
 */

import { SST } from '@amk/core/messages/sst';
import type { CompileResult, Diagnostic, Span } from '@amk/core/types';
import {
  FIRST_CUSTOM_INSTRUMENT,
  FIRST_PERCUSSION_INSTRUMENT,
  type InstrumentTables,
  MELODIC_SLOTS,
  NOISE_FLAG,
  PERCUSSION_SLOTS,
} from '@amk/spc/instruments';
import {
  type PitchFate,
  SEMITONE,
  SILENT_FROM,
  heardPitch,
  highestTrue,
  pitchFate,
  vibratoReach,
} from '@amk/spc/pitch';
import type { SongTimeline, WalkNote } from '@amk/spc/song-walk';
import { keyName } from '../editor/views/piano-roll/roll-layout';

/** `$80`, the byte that is o1 c and so key 0. */
const KEY_ZERO = 0x80;

interface Tuning {
  srcn: number;
  multiplier: number;
  sub: number;
}

/** Bytes 0, 4 and 5 of the instrument in force (`Commands.asm:103-125, 211-216`), or `null` where no table holds it. */
function tuningOf(
  instrument: number | null,
  tables: InstrumentTables,
  custom: readonly (readonly number[])[],
): Tuning | null {
  if (instrument === null) {
    return null;
  }

  const entry =
    instrument < MELODIC_SLOTS
      ? tables.melodic[instrument]
      : instrument >= FIRST_PERCUSSION_INSTRUMENT &&
          instrument < FIRST_PERCUSSION_INSTRUMENT + PERCUSSION_SLOTS
        ? tables.percussion[instrument - FIRST_PERCUSSION_INSTRUMENT]
        : undefined;
  if (entry !== undefined) {
    return { srcn: entry.srcn, multiplier: entry.tuning, sub: entry.subTuning };
  }

  const bytes =
    instrument >= FIRST_CUSTOM_INSTRUMENT
      ? custom[instrument - FIRST_CUSTOM_INSTRUMENT]
      : undefined;
  return bytes === undefined ? null : { srcn: bytes[0], multiplier: bytes[4], sub: bytes[5] };
}

/** The note number a key-on puts in `$11`, before the eight bits wrap it (`main.asm:434-452`); `null` for a `$D9`. */
function driverKey(note: WalkNote, tables: InstrumentTables): number | null {
  // A drum plays at its own entry's note byte, which `ApplyInstrument` hands back (`Commands.asm:219-221`).
  const key =
    note.key ??
    (note.percussion === null ? null : (tables.percussion[note.percussion]?.note ?? 0) & 0x7f);
  return key === null ? null : key + note.state.transpose + note.state.tune;
}

/**
 * The two findings over every note of the pass, each on the note written, once for its own pitch
 * and once for each way its vibrato swings it out. Names are in the frame the note is written in,
 * which is the row the roll draws it on, so `$FA $02 $05 @0 o6 c` is said to be above o5 b.
 */
export function pitchRange(
  timeline: SongTimeline,
  result: CompileResult,
  tables: InstrumentTables,
): Diagnostic[] {
  const notes = new Map((result.noteMap ?? []).map((entry) => [entry.address, entry]));
  const found: Diagnostic[] = [];
  const seen = new Set<string>();
  const report = (key: string, code: string, message: string, span: Span): void => {
    if (!seen.has(key)) {
      seen.add(key);
      found.push({ severity: 'severe', code, message, span });
    }
  };

  for (const note of timeline.notes) {
    const { state } = note;
    const mapped = notes.get(note.address);
    const tuning = tuningOf(state.instrument, tables, timeline.customInstruments);
    const key = driverKey(note, tables);
    if (
      mapped === undefined ||
      tuning === null ||
      key === null ||
      (tuning.srcn & NOISE_FLAG) !== 0 ||
      state.noise !== null ||
      state.sampleLoaded ||
      state.arpeggio ||
      state.remotePitch
    ) {
      continue;
    }

    const { multiplier, sub } = tuning;
    const shift = (note.key === null ? key : mapped.written - KEY_ZERO) - key;
    const name = (driver: number) => keyName(driver + shift);
    const heard = (register: number) =>
      name(Math.round(heardPitch(register, multiplier, sub) / SEMITONE));
    const instrument = `@${state.instrument}`;
    const pitch = key * SEMITONE + state.fineTune;
    const own = pitchFate(pitch, multiplier, sub);
    const highest = highestTrue(multiplier, sub, state.fineTune);
    const at = `note:${mapped.span.start}`;

    if (own.fate === 'silent') {
      report(
        at,
        'SST0513',
        pitch < 0
          ? SST['0513.silent-low'](name(0))
          : SST['0513.silent-high'](name(SILENT_FROM - 1)),
        mapped.span,
      );
      continue;
    }

    if (own.fate === 'misplaced' && pitch < 0) {
      report(at, 'SST0513', SST['0513.low'](name(0), heard(own.register)), mapped.span);
    } else if (own.fate !== 'true') {
      report(
        at,
        'SST0513',
        highest < 0
          ? SST['0513.no-true-pitch'](instrument, heard(own.register))
          : SST['0513.high'](name(highest), instrument, heard(own.register)),
        mapped.span,
      );
    }

    // A fade ramps the depth in from nothing on every note, which `vibratoReach` does not follow.
    const vibrato = state.vibrato;
    if (vibrato?.fade !== 0 || vibrato.rate === 0 || note.vibratoTicks === 0) {
      continue;
    }

    const reach = vibratoReach(vibrato, note.vibratoTicks);
    const top = pitch + reach.up;
    const bottom = pitch - reach.down;
    const fate = (value: number): PitchFate => pitchFate(value, multiplier, sub).fate;
    if (fate(top) === 'silent') {
      report(`up:${at}`, 'SST0514', SST['0514.silent-high'](name(SILENT_FROM - 1)), mapped.span);
    } else if (own.fate === 'true' && fate(top) === 'wraps') {
      report(`up:${at}`, 'SST0514', SST['0514.wraps'](name(highest), instrument), mapped.span);
    }

    if (fate(bottom) === 'silent') {
      report(`down:${at}`, 'SST0514', SST['0514.silent-low'](name(0)), mapped.span);
    }
  }

  return found;
}
