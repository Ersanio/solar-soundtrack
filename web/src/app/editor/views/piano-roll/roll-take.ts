/**
 * A take played in on a MIDI keyboard: which channel each key lands on, where
 * its note starts and ends, and the notes that come out of it.
 *
 * Arithmetic over ticks, Angular-free so `pianorolltest` drives it. The pointer
 * that says what tick a key was pressed on is `roll-record.ts`'s; turning the
 * notes into text is `roll-write/take-edits.ts`'s.
 */

import { NOTE_MAX, NOTE_MIN } from '@amk/core/hardcoded-tables';
import { DEFAULT_TEMPO, ticksPerSecond } from '@amk/tokens/commands/units';
import { type SongClock, ticksPerSecondAt } from '../../../state/song-clock';
import type { TakeNote } from './roll-edit';
import type { Strip } from './roll-strip';

/** MIDI's note number for `o1 c`, the lowest key the driver plays: MIDI 60 is `o4 c`. */
const MIDI_O1_C = 24;

/** The byte a MIDI key names, or `null` for a key outside the driver's range. */
export function writtenOfKey(key: number): number | null {
  const written = NOTE_MIN + key - MIDI_O1_C;
  return written >= NOTE_MIN && written < NOTE_MAX ? written : null;
}

/** A key that is down, and the channel it took. */
export interface HeldKey {
  key: number;
  channel: number;
  written: number;
  /** The tick it went down on, as played. */
  startTick: number;
}

/** A key that has come back up. */
export interface PlayedNote {
  channel: number;
  written: number;
  /** As played: {@link takeNotes} is what snaps them. */
  startTick: number;
  endTick: number;
}

export interface Take {
  /** The channels being recorded, ascending. */
  channels: readonly number[];
  held: readonly HeldKey[];
  played: readonly PlayedNote[];
}

export function emptyTake(channels: readonly number[]): Take {
  return { channels: [...new Set(channels)].sort((a, b) => a - b), held: [], played: [] };
}

/**
 * A key going down: it takes the lowest-numbered channel no held key has.
 *
 * `null` for a key that takes none — every channel is busy, the key is outside
 * the driver's range, or it is already down — and the take is unchanged.
 */
export function keyDown(
  take: Take,
  key: number,
  tick: number,
): { take: Take; held: HeldKey } | null {
  const written = writtenOfKey(key);
  const busy = new Set(take.held.map((each) => each.channel));
  const channel = take.channels.find((each) => !busy.has(each));
  if (written === null || channel === undefined || take.held.some((each) => each.key === key)) {
    return null;
  }

  const held: HeldKey = { key, channel, written, startTick: tick };
  return { take: { ...take, held: [...take.held, held] }, held };
}

/** A key coming up: its note is played, and its channel is free again. */
export function keyUp(take: Take, key: number, tick: number): Take {
  const held = take.held.find((each) => each.key === key);
  if (!held) {
    return take;
  }

  return {
    ...take,
    held: take.held.filter((each) => each !== held),
    played: [
      ...take.played,
      {
        channel: held.channel,
        written: held.written,
        startTick: held.startTick,
        endTick: Math.max(held.startTick, tick),
      },
    ],
  };
}

/** Every key still down let go at `tick`, which is what stopping a recording does. */
export function releaseAll(take: Take, tick: number): Take {
  return take.held.reduce((now, held) => keyUp(now, held.key, tick), take);
}

/** A tick on the snap grid, or the whole tick it is nearest where there is no grid. */
export function snappedTick(tick: number, snap: number): number {
  return Math.max(0, snap > 0 ? Math.round(tick / snap) * snap : Math.round(tick));
}

/** Where a played note ends once snapped: at least one step, or one tick, past its start. */
function snappedEnd(start: number, end: number, snap: number): number {
  return Math.max(start + Math.max(1, snap), snappedTick(end, snap));
}

/**
 * One channel's notes as they will be written: snapped, in tick order, and
 * never two at once.
 *
 * Snapping can push two notes played one after the other onto each other, and
 * a channel plays one note at a time. The later note keeps its start and the
 * earlier one is cut there; one left with no ticks is dropped.
 */
export function takeNotes(take: Take, channel: number, snap: number): TakeNote[] {
  const notes = take.played
    .filter((note) => note.channel === channel)
    .map((note) => {
      const startTick = snappedTick(note.startTick, snap);
      return {
        startTick,
        ticks: snappedEnd(startTick, note.endTick, snap) - startTick,
        written: note.written,
      };
    })
    .sort((a, b) => a.startTick - b.startTick);

  const kept: TakeNote[] = [];
  for (const [at, note] of notes.entries()) {
    const next = notes[at + 1];
    const ticks = next ? Math.min(note.ticks, next.startTick - note.startTick) : note.ticks;
    if (ticks > 0) {
      kept.push({ ...note, ticks });
    }
  }

  return kept;
}

/** A stretch of ticks a recorded note may not land on. */
export interface Wall {
  from: number;
  to: number;
}

/**
 * The ticks a channel's loops play over, where a take writes nothing: a loop is
 * a wall no gesture enters (`REFUSE_LOOP_WALL`), and one note on it would refuse
 * the whole take.
 */
export function loopWalls(strip: Strip): Wall[] {
  const root = strip.frames[0];
  const walls: Wall[] = [];
  for (let index = root.from; index < root.to; index++) {
    const item = strip.items[index];
    if (item.kind === 'construct') {
      walls.push({ from: item.startTick, to: item.startTick + item.ticks });
    }
  }

  return walls;
}

export function onWall(
  note: { startTick: number; ticks: number },
  walls: readonly Wall[],
): boolean {
  return walls.some((wall) => note.startTick < wall.to && note.startTick + note.ticks > wall.from);
}

/**
 * The record pointer one frame on: `seconds` of wall clock at the song's own
 * rate there.
 *
 * Forward only, and off the clock's slope rather than the tempo byte, as the
 * playhead's own velocity is (`roll-clock.ts`). Past the end of the song the
 * clock's last rate stands, since `ticksPerSecondAt` clamps.
 */
export function recordTickStep(tick: number, seconds: number, clock: SongClock | null): number {
  const rate = clock ? ticksPerSecondAt(clock, tick) : ticksPerSecond(DEFAULT_TEMPO);
  return tick + Math.max(0, seconds) * rate;
}
