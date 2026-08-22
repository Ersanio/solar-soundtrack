import { NOTE_MAX, NOTE_MIN } from '@amk/core/hardcoded-tables';
import {
  octaveFor,
  parseWrittenPitch,
  spellDuration,
  spellNote,
  spellOctave,
  spellQ,
} from '@amk/core/mml-text';
import type { Span } from '@amk/core/types';
import { type Edit, insertAt, spliceRange } from '@amk/tokens/edits';
import type { ChannelTail, Strip, StripItem } from './roll-strip';

/**
 * What a gesture on the roll does to a channel, and what that is as text.
 *
 * Two halves, and keeping them apart is what makes either testable.
 * {@link planGesture} is arithmetic over ticks: where every note ends up, which
 * ones a push moved, and where two would sound at once. It is what the roll
 * draws while the pointer is still down, and it decides everything.
 * {@link planEdits} turns an accepted plan into splices. It decides nothing
 * about the **music** — which notes there are, on which tick, at which pitch,
 * are all settled before it is called, and a plan that is refused never reaches
 * it — and everything about the **spelling**, down to whether a note is
 * rewritten where it stands or lifted out and written again on the far side of
 * one it was carried past. It can also refuse a spelling it cannot produce.
 *
 * Neither knows about Angular, the DOM or pixels, so `rolltest` drives both
 * against a real compile and checks the result by walking it.
 */

/** One note as the plan wants it. */
export interface PlacedNote {
  /** Index into `strip.items`, or -1 for a note being created. */
  from: number;
  startTick: number;
  ticks: number;
  /** The byte the letter and octave alone name. */
  written: number;
  /** `21`-`29` when this is a drum, whose lane is its instrument rather than its pitch. */
  drum: number | null;
}

/** Ticks where two notes on one channel would sound at once. */
export interface Clash {
  from: number;
  to: number;
}

/**
 * Ticks a note gives up to one the gesture is placing over it.
 *
 * A run of ticks like a {@link Clash}, but it belongs to a note rather than to
 * the channel, so it carries the row to draw it on: a clash names two notes and
 * is washed down the whole stack, where this names one and is hatched over that
 * note's own bar.
 */
export interface Erased {
  from: number;
  to: number;
  /** The byte the letter and octave alone name, for the row. */
  written: number;
  /** `21`-`29` when the note giving them up is a drum, whose lane is its instrument. */
  drum: number | null;
}

export interface Plan {
  /** Every note the channel would hold, in tick order. */
  notes: readonly PlacedNote[];
  /** The notes the gesture moved itself, drawn as the live bar. */
  touched: readonly PlacedNote[];
  /** The notes a push moved out of the way, or a carve cut down, drawn as striped bars. */
  pushed: readonly PlacedNote[];
  /** Drawn as a red wash on both notes. Empty for a plan that can be committed. */
  clashes: readonly Clash[];
  /** Ticks the notes already there give up, drawn hatched on their own rows. */
  erased: readonly Erased[];
  /** Why nothing will be committed, or `null`. */
  refused: string | null;
}

export type Gesture =
  | { kind: 'spawn'; startTick: number; ticks: number; written: number; drum: number | null }
  | { kind: 'move'; items: readonly number[]; deltaTicks: number; deltaKeys: number; copy: boolean }
  | { kind: 'stretch'; items: readonly number[]; edge: 'start' | 'end'; deltaTicks: number }
  | { kind: 'delete'; items: readonly number[] }
  | { kind: 'quantize'; items: readonly number[]; snap: number }
  | { kind: 'legato'; items: readonly number[] }
  | { kind: 'glue'; items: readonly number[] };

/**
 * What the roll does when a gesture would make two notes sound at once:
 * `overwrite` takes the ticks off the notes already there, `insert` shifts them
 * aside, `strict` refuses the edit.
 *
 * The porter's setting rather than the gesture's, so a drag and a stretch answer
 * an overlap the same way.
 *
 * The order is the mechanism rather than presentation: the toolbar's `<select>`
 * lists the table itself, and `readSettings` takes its default and its fallback
 * for an unreadable stored value from the first entry.
 */
export const EDIT_MODES = ['overwrite', 'insert', 'strict'] as const;
export type EditMode = (typeof EDIT_MODES)[number];

export interface EditContext {
  source: string;
  strip: Strip;
  /** `CompileStats.targetAMKVersion` — what the target is able to spell. */
  targetAMKVersion: number;
  /** `CompileStats.songTargetProgram` — 0 AddmusicK, 1 Addmusic 4.05, 2 AddmusicM. */
  songTargetProgram: number;
  /**
   * How long the song plays, in ticks: its shortest channel that has any.
   *
   * `stats.introTicks + stats.loopTicks`, which is the figure `Playback` builds
   * the transport on. Not `SongTimeline.ticks`, which is the same number until a
   * channel emits bytes without occupying a tick — the walk counts that one as
   * used and answers 0, where `Music.cpp:3209` passes over it.
   *
   * A gesture reaching past it is what lengthens the song (see
   * {@link padChannels}), so it is the line the edit is measured against rather
   * than a limit on where a note may go.
   */
  playableTicks: number;
  /**
   * The tick the song loops back to, or `null` where it has no `/` at all.
   *
   * `stats.introTicks`, which is the **first** `/` in the file — the boundary
   * every other reading of the song's length is split at (`parser.ts:parseIntro`).
   * A channel being opened takes its own `/` from this, so that it re-enters
   * where the rest of the song does.
   */
  introTicks: number | null;
  /**
   * Every channel as somewhere rests can be appended, indexed by channel.
   *
   * `channelTails`, off `stats.channelTicks` — so {@link playableTicks} is the
   * smallest non-zero `ticks` in here, and the two are two readings of one
   * array rather than two arrays. What {@link padChannels} writes to.
   */
  channels: readonly ChannelTail[];
}

export const REFUSE_RANGE = 'the driver cannot play a note that high or low';
export const REFUSE_ROOM = 'there is no room to push the notes out of the way';
export const REFUSE_SPELL = 'that length cannot be written on this AddmusicK target';
export const REFUSE_CROWDED = 'there is something written where that note would go';
export const REFUSE_RAMP = 'that note is too short to keep the command written inside it';

// --- planning ---------------------------------------------------------------

/** The strip's notes as the plan's own objects, tagged with their place in `items`. */
function placedNotes(strip: Strip): PlacedNote[] {
  const notes: PlacedNote[] = [];
  strip.items.forEach((item, index) => {
    if (item.kind === 'note') {
      notes.push({
        from: index,
        startTick: item.startTick,
        ticks: item.ticks,
        written: item.written,
        drum: item.drum?.args[0]?.value ?? null,
      });
    }
  });

  return notes;
}

function byTick(a: PlacedNote, b: PlacedNote): number {
  return a.startTick - b.startTick || a.from - b.from;
}

/** Where two notes would sound at once, which MML has no way to say. */
function clashesIn(notes: readonly PlacedNote[]): Clash[] {
  const sorted = [...notes].sort(byTick);
  const clashes: Clash[] = [];
  for (let at = 1; at < sorted.length; at++) {
    const previous = sorted[at - 1];
    const overlap = previous.startTick + previous.ticks - sorted[at].startTick;
    if (overlap > 0) {
      clashes.push({ from: sorted[at].startTick, to: sorted[at].startTick + overlap });
    }
  }

  return clashes;
}

/** A pitched note has to land where the driver can play it. */
function inRange(written: number): boolean {
  return written >= NOTE_MIN && written < NOTE_MAX;
}

/**
 * Shoves the notes after `anchor` out of its way, all in one direction.
 *
 * The direction is the caller's and never changes inside the cascade. Deciding
 * it per neighbour — by which half of each one the overlap lands on — does not
 * terminate: A shoves B right, B shoves C right, C shoves B left, and round it
 * goes. Fixed, every shove moves a note strictly away from the anchor over a
 * finite ordered set, so each is touched at most once and the cascade is at most
 * one pass. Each gesture names its own: a stretch pushes the way its edge is
 * being pulled, a move the way it is being dragged, and a note drawn or
 * quantized pushes right, since the room is there and tick 0 is not far off.
 *
 * `null` when a leftward cascade runs out of room before tick 0: there is
 * nothing there to give, and compressing somebody else's note is not what the
 * gesture asked for.
 *
 * A note in `fixed` is one the gesture is placing itself. The cascade stops at
 * it rather than shoving it back, and `clashesIn` reports the overlap that is
 * left — a push with no way through refuses rather than fighting the drag.
 */
function push(
  notes: readonly PlacedNote[],
  anchor: PlacedNote,
  direction: 1 | -1,
  fixed?: ReadonlySet<PlacedNote>,
): { notes: PlacedNote[]; pushed: PlacedNote[] } | null {
  const order = [...notes].sort(byTick);
  const at = order.indexOf(anchor);
  const pushed: PlacedNote[] = [];
  if (at < 0) {
    return { notes: order, pushed };
  }

  if (direction === 1) {
    let edge = anchor.startTick + anchor.ticks;
    for (let i = at + 1; i < order.length; i++) {
      if (order[i].startTick >= edge || fixed?.has(order[i])) {
        break;
      }

      order[i] = { ...order[i], startTick: edge };
      pushed.push(order[i]);
      edge = order[i].startTick + order[i].ticks;
    }
  } else {
    let edge = anchor.startTick;
    for (let i = at - 1; i >= 0; i--) {
      if (order[i].startTick + order[i].ticks <= edge || fixed?.has(order[i])) {
        break;
      }

      const startTick = edge - order[i].ticks;
      if (startTick < 0) {
        return null;
      }

      order[i] = { ...order[i], startTick };
      pushed.push(order[i]);
      edge = startTick;
    }
  }

  return { notes: order, pushed };
}

/**
 * Every anchor's cascade, one after another.
 *
 * The anchors are taken in the cascade's own direction — furthest along it
 * first — so a later one cannot re-disturb what an earlier one settled. They are
 * their own `fixed` set at every call site, which is what keeps a selection from
 * shoving itself: one note of it would otherwise move the next.
 *
 * A note shoved twice is reported once, at where it finished, since the striped
 * bars are drawn from this and two rects for one note would sit at both
 * positions.
 */
function pushFrom(
  notes: readonly PlacedNote[],
  anchors: readonly PlacedNote[],
  direction: 1 | -1,
  fixed: ReadonlySet<PlacedNote>,
): { notes: PlacedNote[]; pushed: PlacedNote[] } | null {
  const order = [...anchors].sort((a, b) =>
    direction === 1 ? b.startTick - a.startTick : a.startTick - b.startTick,
  );

  let held: readonly PlacedNote[] = notes;
  const pushed = new Map<number, PlacedNote>();
  for (const anchor of order) {
    const shoved = push(held, anchor, direction, fixed);
    if (!shoved) {
      return null;
    }

    held = shoved.notes;
    for (const note of shoved.pushed) {
      pushed.set(note.from, note);
    }
  }

  return { notes: [...held], pushed: [...pushed.values()] };
}

/**
 * The ticks a placed note covers, taken out of the notes already there.
 *
 * The overwrite answer to an overlap, and the mirror of {@link push}: where a
 * push moves what is in the way and needs somewhere to move it to, this takes
 * the overlapping ticks off it and leaves everything else exactly where it was
 * written. It cannot run out of room, so it has no refusal of its own.
 *
 * A note the gesture is placing itself is in `placed` and is never carved, which
 * is {@link push}'s `fixed` set by another name: a selection cannot eat its own
 * notes, and two placed notes overlapping each other is left for `clashesIn` to
 * report rather than becoming a third outcome.
 *
 * A note comes out of it in none, one or more pieces. **The first piece keeps
 * `from`**, so it starts where the note started and {@link rewriteNote} shortens
 * that unit in place; the rest are born notes at the same pitch. That is what
 * makes a note the gesture landed inside survive as a head *and* a tail rather
 * than losing everything past the cut.
 *
 * Pitch has no say in it. A channel plays one note at a time, so a note in the
 * way is in the way whatever row it is drawn on.
 */
function carve(
  notes: readonly PlacedNote[],
  placed: ReadonlySet<PlacedNote>,
): { notes: PlacedNote[]; pushed: PlacedNote[]; erased: Erased[] } {
  const cuts = [...placed]
    .map((note) => ({ from: note.startTick, to: note.startTick + note.ticks }))
    .sort((a, b) => a.from - b.from);

  const kept: PlacedNote[] = [];
  const pushed: PlacedNote[] = [];
  const erased: Erased[] = [];

  for (const note of notes) {
    if (placed.has(note)) {
      kept.push(note);
      continue;
    }

    const end = note.startTick + note.ticks;
    const pieces: PlacedNote[] = [];
    let at = note.startTick;
    for (const cut of cuts) {
      if (cut.to <= at || cut.from >= end) {
        continue;
      }

      if (cut.from > at) {
        pieces.push({ ...note, from: -1, startTick: at, ticks: cut.from - at });
      }

      erased.push({
        from: Math.max(at, cut.from),
        to: Math.min(end, cut.to),
        written: note.written,
        drum: note.drum,
      });
      at = Math.max(at, cut.to);
    }

    if (at === note.startTick) {
      kept.push(note); // Nothing reached it.
      continue;
    }

    if (at < end) {
      pieces.push({ ...note, from: -1, startTick: at, ticks: end - at });
    }

    if (pieces.length > 0) {
      pieces[0] = { ...pieces[0], from: note.from };
    }

    kept.push(...pieces);
    pushed.push(...pieces);
  }

  return { notes: kept, pushed, erased };
}

/**
 * A plan with nothing on screen, for the refusals that have nothing to put there.
 *
 * A refusal that still knows where its notes were going keeps them in `touched`,
 * so the bar stays under the pointer until it is let go. This is for the ones
 * that cannot: a pitch off the driver's range has no lane, so `rowOfPlaced`
 * answers -1 and there is nowhere to draw it.
 */
const NOTHING: Omit<Plan, 'refused'> = {
  notes: [],
  touched: [],
  pushed: [],
  clashes: [],
  erased: [],
};

/**
 * A gesture whose notes are where it wants them, answered under one mode.
 *
 * The one place the three modes are told apart, so drawing, dragging,
 * quantizing and stretching cannot drift into answering an overlap differently
 * — which is the promise the setting makes. A gesture brings what it alone
 * knows: which way a push should send what is in the way, and which notes are
 * its own selection, whose shoving is the gesture moving itself rather than a
 * neighbour being moved aside.
 *
 * `direction` is read by `insert` alone. Neither of the others has one: strict
 * moves nothing, and a carve takes the ticks wherever the placed note landed on
 * them.
 */
function resolved(
  notes: readonly PlacedNote[],
  touched: readonly PlacedNote[],
  mode: EditMode,
  direction: 1 | -1,
  chosen: ReadonlySet<number>,
): Plan {
  const placed = new Set(touched);
  switch (mode) {
    case 'strict': {
      const sorted = [...notes].sort(byTick);
      return {
        notes: sorted,
        touched,
        pushed: [],
        clashes: clashesIn(sorted),
        erased: [],
        refused: null,
      };
    }

    case 'overwrite': {
      const carved = carve(notes, placed);
      const settled = carved.notes.sort(byTick);
      return {
        notes: settled,
        touched,
        pushed: carved.pushed,
        clashes: clashesIn(settled),
        erased: carved.erased,
        refused: null,
      };
    }

    case 'insert': {
      const sorted = [...notes].sort(byTick);
      const shoved = pushFrom(sorted, touched, direction, placed);
      if (!shoved) {
        return {
          notes: sorted,
          touched,
          pushed: [],
          clashes: clashesIn(sorted),
          erased: [],
          refused: REFUSE_ROOM,
        };
      }

      const settled = shoved.notes.sort(byTick);
      return {
        notes: settled,
        touched,
        // A note of the selection shoved by another of it is the gesture moving
        // itself, and is already drawn as a live bar.
        pushed: shoved.pushed.filter((each) => !chosen.has(each.from)),
        clashes: clashesIn(settled),
        erased: [],
        refused: null,
      };
    }
  }
}

export function planGesture(strip: Strip, gesture: Gesture, mode: EditMode): Plan {
  switch (gesture.kind) {
    case 'spawn': {
      if (gesture.drum === null && !inRange(gesture.written)) {
        return { ...NOTHING, refused: REFUSE_RANGE };
      }

      const born: PlacedNote = {
        from: -1,
        startTick: gesture.startTick,
        ticks: gesture.ticks,
        written: gesture.written,
        drum: gesture.drum,
      };
      const notes = [...placedNotes(strip), born].sort(byTick);
      // A drawn note is put where the pointer is, so whatever was already there
      // moves later rather than earlier.
      return resolved(notes, [born], mode, 1, new Set());
    }

    case 'move': {
      const chosen = new Set(gesture.items);
      const notes: PlacedNote[] = [];
      const touched: PlacedNote[] = [];

      for (const note of placedNotes(strip)) {
        if (!chosen.has(note.from)) {
          notes.push(note);
          continue;
        }

        // A drum's lane is its instrument, so a vertical drag moves it between
        // lanes rather than repitching it — the letter has no say in the byte.
        const written = note.drum === null ? note.written + gesture.deltaKeys : note.written;
        if (note.drum === null && !inRange(written)) {
          return { ...NOTHING, notes: placedNotes(strip), refused: REFUSE_RANGE };
        }

        const moved: PlacedNote = {
          from: gesture.copy ? -1 : note.from,
          startTick: Math.max(0, note.startTick + gesture.deltaTicks),
          ticks: note.ticks,
          written,
          drum: note.drum,
        };

        touched.push(moved);
        notes.push(moved);
        if (gesture.copy) {
          notes.push(note);
        }
      }

      // The way the porter is dragging: a note shoved aside carries on in the
      // same direction, and a drag straight up or down has no other way to send
      // it. A copy dropped on its own original pushes that original, which is
      // the same rule seen from the other side — and under a carve, eats it.
      const direction = gesture.deltaTicks < 0 ? -1 : 1;
      return resolved(notes.sort(byTick), touched, mode, direction, chosen);
    }

    case 'stretch': {
      const chosen = new Set(gesture.items);
      let notes = placedNotes(strip);
      const touched: PlacedNote[] = [];
      const pushed: PlacedNote[] = [];
      const direction = gesture.edge === 'end' ? 1 : -1;

      for (const index of gesture.items) {
        const note = notes.find((each) => each.from === index);
        if (!note) {
          continue;
        }

        const start =
          gesture.edge === 'start' ? note.startTick + gesture.deltaTicks : note.startTick;
        const end =
          gesture.edge === 'end'
            ? note.startTick + note.ticks + gesture.deltaTicks
            : note.startTick + note.ticks;
        if (start < 0 || end - start < 1) {
          return {
            ...NOTHING,
            notes,
            clashes: [{ from: Math.max(0, start), to: end }],
            erased: [],
            refused: null,
          };
        }

        const stretched: PlacedNote = { ...note, startTick: start, ticks: end - start };
        notes = notes.map((each) => (each === note ? stretched : each));
        touched.push(stretched);

        // Only the push happens per edge. A carve waits until every edge in the
        // selection has been pulled, or the first note stretched would eat one
        // this same gesture is about to move — it is not in `touched` yet, so
        // nothing would hold it back.
        if (mode !== 'insert') {
          continue;
        }

        const shoved = push(notes, stretched, direction);
        if (!shoved) {
          return {
            notes,
            touched,
            pushed: [],
            clashes: clashesIn(notes),
            erased: [],
            refused: REFUSE_ROOM,
          };
        }

        notes = shoved.notes;
        pushed.push(...shoved.pushed.filter((each) => !chosen.has(each.from)));
      }

      // Insert has already pushed, once per edge, and carries the notes it
      // moved; asking again would find nothing left to shove and lose them.
      if (mode === 'insert') {
        const sorted = [...notes].sort(byTick);
        return {
          notes: sorted,
          touched,
          pushed,
          clashes: clashesIn(sorted),
          erased: [],
          refused: null,
        };
      }

      return resolved(notes, touched, mode, direction, chosen);
    }

    case 'delete': {
      const gone = new Set(gesture.items);
      const notes = placedNotes(strip).filter((note) => !gone.has(note.from));
      return { notes, touched: [], pushed: [], clashes: [], erased: [], refused: null };
    }

    case 'quantize': {
      const chosen = new Set(gesture.items);
      const snap = Math.max(1, gesture.snap);
      const notes = placedNotes(strip)
        .map((note) =>
          chosen.has(note.from)
            ? { ...note, startTick: Math.round(note.startTick / snap) * snap }
            : note,
        )
        .sort(byTick);
      const touched = notes.filter((note) => chosen.has(note.from));
      // Rightwards whichever way a note was pulled. A tidy-up that shoved its
      // neighbours toward tick 0 would run out of room in the first bar, and the
      // direction has to be one for the whole cascade either way.
      return resolved(notes, touched, mode, 1, chosen);
    }

    case 'legato': {
      const chosen = new Set(gesture.items);
      const sorted = placedNotes(strip).sort(byTick);
      const notes = sorted.map((note, at) => {
        const next = sorted[at + 1];
        return chosen.has(note.from) && next && next.startTick > note.startTick
          ? { ...note, ticks: next.startTick - note.startTick }
          : note;
      });
      return {
        notes,
        touched: notes.filter((note) => chosen.has(note.from)),
        pushed: [],
        clashes: clashesIn(notes),
        erased: [],
        refused: null,
      };
    }

    case 'glue': {
      const chosen = new Set(gesture.items);
      const notes: PlacedNote[] = [];
      const touched: PlacedNote[] = [];
      for (const note of placedNotes(strip).sort(byTick)) {
        const held = notes[notes.length - 1];
        if (
          held &&
          chosen.has(note.from) &&
          chosen.has(held.from) &&
          held.startTick + held.ticks === note.startTick
        ) {
          const grown = { ...held, ticks: note.startTick + note.ticks - held.startTick };
          notes[notes.length - 1] = grown;
          touched[touched.length - 1] = grown;
          continue;
        }

        notes.push(note);
        if (chosen.has(note.from)) {
          touched.push(note);
        }
      }

      return { notes, touched, pushed: [], clashes: [], erased: [], refused: null };
    }
  }
}

/** A plan is committable when nothing is refused and nothing would sound at once. */
export function committable(plan: Plan): boolean {
  return plan.refused === null && plan.clashes.length === 0;
}

// --- writing ----------------------------------------------------------------

/** The document's own line ending, so a block written into it matches the rest. */
function eol(source: string): string {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

/** The octave {@link channelOpening} writes, and so the one it leaves in force. */
const OPENING_OCTAVE = 4;

/** Everything that can move the octave, as text — see {@link spawnInto}. */
const MOVES_OCTAVE = /[o<>]/;

/** `q[channel]` before anything sets it (`parser.ts:200`). */
const OPENING_Q = 0x7f;

/**
 * A channel the song has not declared, written out: its `#N` and the state a
 * fresh channel runs under, so that nothing it plays depends on what the block
 * above it happened to leave standing.
 *
 * `octave` and `defaultNoteLength` are one variable each and leak past a `#N`,
 * which resets neither (`parser.ts:parseHash`), so `o4` and `l8` are what a
 * channel runs at only while nothing has moved them (`parser.ts:193`, `:195`).
 * `q` and `@` are per channel and start at `$7F` and 0 (`parser.ts:200`,
 * `:199`). `v` and `y` are not parse-time state at all: the driver boots every
 * voice at `$FF` volume and `$0A` pan, dead centre of `y`'s 0 to 20
 * (`main.asm:2134-2138`). The octave and the length are literal because each has
 * one spelling on every target — 24 ticks is `l8` wherever `192 / 24` is — and
 * `q` goes through {@link spellQ}, whose two digits are upper case.
 *
 * No `@` on Addmusic 4.05 or AddmusicM, where an `@` switches instrument tuning
 * on and resets `h` instead of saying what is already true; that is the gate
 * `normalize.ts:writeDefaults` takes. No `t`, which reaches all eight channels
 * and is not what drawing one note asked for, and no `h`, which replaces an
 * instrument's tuning rather than adding to it, so `h0` is not "no transposition".
 */
function channelOpening(channel: number, songTargetProgram: number): string {
  const parts = [`o${OPENING_OCTAVE}`, 'l8', spellQ(OPENING_Q)];
  if (songTargetProgram === 0) {
    parts.push('@0');
  }

  parts.push('v255', 'y10');
  return `#${channel} ${parts.join(' ')}`;
}

/** How many characters of an item's head are the note itself rather than its length. */
function headLength(source: string, item: StripItem): number {
  if (item.kind === 'rest') {
    return 1;
  }

  const head = source.slice(item.segments[0].span.start, item.segments[0].span.end);
  return parseWrittenPitch(head)?.length ?? 1;
}

/** The length text of an item as written, so a pitch edit never spells one in. */
function writtenLength(source: string, item: StripItem): string {
  const head = item.segments[0].span;
  return source.slice(head.start + headLength(source, item), head.end);
}

/**
 * A note written out: the octave in front of it, the note, its length, and the
 * octave put back after it where one is needed.
 */
function noteText(
  note: PlacedNote,
  lengthText: string | null,
  exitOctave: number | null,
  version: number,
  running: number | null,
): string | null {
  const length = lengthText ?? spellDuration(note.ticks, version);
  if (length === null) {
    return null;
  }

  // A drum's lane is its instrument. The letter it is written at has no say in
  // the byte (`parser.ts:2911-2916`), so the `@` is the whole edit and no octave
  // is needed either way.
  if (note.drum !== null) {
    return `@${note.drum} c${length}`;
  }

  const octave = octaveFor(note.written);
  const head = octave === null ? null : spellNote(note.written, octave);
  if (octave === null || head === null) {
    return null;
  }

  // The octave is written only where the one already in force is not the one
  // this note needs. `running` is what the *edited* text leaves in force, so a
  // run of notes moved together writes `o5` once rather than in front of each.
  const wantsOctave = running === null || running !== octave;
  const lead = wantsOctave ? spellOctave(octave) : '';
  const exit = exitText(note, exitOctave);
  if (lead === null || exit === null) {
    return null;
  }

  return `${lead ? `${lead} ` : ''}${head}${length}${exit}`;
}

/** The index of the next note on the channel at or after `from`, or -1 for none. */
function noteFrom(strip: Strip, from: number): number {
  for (let at = from; at < strip.items.length; at++) {
    if (strip.items[at].kind === 'note') {
      return at;
    }
  }

  return -1;
}

/**
 * Whether a note sets its own absolute octave, so an octave put back in front of
 * it would be saying the same thing twice.
 *
 * Including a note this same plan is moving: transposing a run of four would
 * otherwise write `o5 c o4 o5 d o4 o5 e o4 o5 f`, where every restore is undone
 * by the octave immediately after it.
 */
function writesItsOwnOctave(
  strip: Strip,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
): boolean {
  const note = strip.items[index];
  const planned = survivors.get(index);
  return (
    note.hasLeadingOctave || (planned?.drum === null && octaveFor(planned.written) !== note.octave)
  );
}

/**
 * The octave a run spawned in the region ending at `index` leaves standing.
 *
 * Two readers, and one answer serves both. A note bounding the region reads it:
 * {@link spawnInto} answers for that note either way — it writes the octave at
 * the note's head, or it has proved the run already leaves the right one — so a
 * number here means `planEdits` has nothing to add at that head. The block below
 * a `#N` reads it too, where the region is the tail and nothing on the channel
 * survived, since `octave` is global parser state.
 *
 * `null` where no run was spawned there, and where the one that was ends on a
 * drum: that writes no octave at all and leaves whatever stood, which is
 * `leaves` being null in {@link spawnInto} and is the one case neither reader
 * can be answered for.
 */
function spawnLeaves(regions: readonly Region[], index: number): number | null {
  const gap = regions.find((each) => each.before === index && each.born.length > 0);
  if (gap === undefined) {
    return null;
  }

  // The last note in tick order is the one whose octave the run leaves, which
  // is what `spawnInto` takes for its own `born`. On the tick alone rather than
  // through `byTick`, which breaks ties on `from`: two notes on one tick sound
  // at once, and `committable` has already turned that plan away.
  const last = gap.born.reduce((furthest, note) =>
    note.startTick >= furthest.startTick ? note : furthest,
  );
  return last.drum === null ? octaveFor(last.written) : null;
}

/**
 * The octave to put back after a note whose own has been rewritten.
 *
 * The octave in force after the unit as it was written — unless the next note on
 * the channel sets its own. The last note of a channel always restores, because
 * `octave` is global parser state and leaks past a `#N` into whatever block comes
 * after it.
 */
function exitOctaveFor(
  strip: Strip,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
): number | null {
  const item = strip.items[index];
  const exit = item.exitOctave ?? item.octave;
  const next = noteFrom(strip, index + 1);
  return next >= 0 && writesItsOwnOctave(strip, next, survivors) ? null : exit;
}

/**
 * The octave put back after a note, as the text that follows it.
 *
 * `''` where nothing is needed — a drum writes no octave to put back, and an
 * exit the note is already at is written by the note itself. `null` where `o`
 * cannot reach the octave asked for, which `<` and `>` can (`spellOctave`).
 */
function exitText(note: PlacedNote, exitOctave: number | null): string | null {
  if (exitOctave === null || note.drum !== null || exitOctave === octaveFor(note.written)) {
    return '';
  }

  const spelled = spellOctave(exitOctave);
  return spelled === null ? null : ` ${spelled}`;
}

/** The unit and the whitespace in front of it, so a deletion leaves no double space. */
function removeItem(source: string, item: StripItem): Edit[] {
  let start = item.unitSpan.start;
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) {
    start--;
  }

  const edit = spliceRange(source, { ...item.unitSpan, start }, '');
  return edit ? [edit] : [];
}

/** What one surviving note needs written, which is usually nothing at all. */
function rewriteNote(
  context: EditContext,
  index: number,
  note: PlacedNote,
  survivors: ReadonlyMap<number, PlacedNote>,
  running: number | null,
): Edit[] | null {
  const { source, strip, targetAMKVersion } = context;
  const item = strip.items[index];
  const samePitch =
    note.written === item.written && note.drum === (item.drum?.args[0]?.value ?? null);
  const sameLength = note.ticks === item.ticks;
  if (samePitch && sameLength) {
    return [];
  }

  const exit = exitOctaveFor(strip, index, survivors);

  // One segment is one token, so the whole unit is rewritten together.
  if (item.segments.length === 1) {
    const length = sameLength ? writtenLength(source, item) : null;
    const text = noteText(note, length, exit, targetAMKVersion, running);
    if (text === null) {
      return null;
    }

    const edit = spliceRange(source, item.unitSpan, text);
    return edit ? [edit] : [];
  }

  // The command inside the note stands a number of ticks into it, and only the
  // last continuation is rewritten, so a change that moves the note's **start**
  // carries the command along with it: the note keeps the ticks it kept, and the
  // ramp written inside them fires later than it was written to. Which ticks the
  // porter meant to keep is not something the gesture says, so it is refused.
  if (note.startTick !== item.startTick) {
    return null;
  }

  // More than one segment means a command sits inside the note — a mid-note
  // volume ramp is the usual one. Only the head and the last continuation are
  // rewritten, so the command keeps its place; a length below what the earlier
  // segments already hold has nowhere to go.
  const earlier = item.segments.slice(0, -1).reduce((sum, segment) => sum + segment.ticks, 0);
  const remaining = note.ticks - earlier;
  if (remaining < 1) {
    return null;
  }

  const edits: Edit[] = [];
  const headSpan: Span = { ...item.unitSpan, end: item.segments[0].span.end };
  const headText = noteText(note, writtenLength(source, item), null, targetAMKVersion, running);
  if (headText === null) {
    return null;
  }

  const headEdit = spliceRange(source, headSpan, headText);
  if (headEdit) {
    edits.push(headEdit);
  }

  const tail = item.segments[item.segments.length - 1];
  const length = spellDuration(remaining, targetAMKVersion);
  if (length === null) {
    return null;
  }

  const put = exitText(note, exit);
  if (put === null) {
    return null;
  }

  const tailEdit = spliceRange(
    source,
    { start: tail.span.start, end: item.unitSpan.end, line: tail.span.line },
    `^${length}${put}`,
  );
  if (tailEdit) {
    edits.push(tailEdit);
  }

  return edits;
}

/** One stretch of text between two surviving notes, and what has to go in it. */
interface Region {
  /** Index of the note before it, or -1 for the head of the channel. */
  after: number;
  /** Index of the note after it, or `items.length` for the tail. */
  before: number;
  /** The rests written in it now. */
  rests: StripItem[];
  /** How many items of any kind are in it, so a spawn can tell a plain rest from a crowd. */
  between: number;
  /** Ticks it has to come to, or -1 for the tail, which may be any length. */
  ticks: number;
  /**
   * The stretch after the last note, which a channel may end wherever it likes.
   *
   * Carried rather than read off {@link Region.ticks} being negative: a gap
   * between two notes can come out negative too, when a plan asks for them in an
   * order the text does not have them in, and reading that as "the tail, so any
   * length will do" is how such a plan used to be written out as a channel with
   * every note after the crossing slid along. One is a fact about where the
   * region is; the other was a guess from a number that had two meanings.
   */
  tail: boolean;
  /** Notes being created in it, in tick order. */
  born: PlacedNote[];
  /** Where it starts, in ticks. */
  startTick: number;
}

/** A stretch of rests that will be written as the one rest they are — see {@link restRuns}. */
interface RestRun {
  /** In order. The first is the one the whole run is written into. */
  rests: StripItem[];
  /** Whether a unit this plan removes is what joined two of them. */
  joined: boolean;
}

/**
 * A region's rests, grouped into the stretches that will end up touching.
 *
 * Two rests are one run when everything between them is whitespace or a unit
 * this plan removes — and every non-rest item strictly inside a region is a
 * note being deleted, by construction of {@link regionsOf}, so a deleted note
 * between two rests joins them. Two rests written touching already are one run
 * too, since the text says so.
 *
 * A `v200`, a `y`, a `$ED` or the intro `/` between them is not whitespace, and
 * the run stops there: those carry a position, and a run is written over as one
 * piece. Spans are {@link StripItem.unitSpan} rather than `prefixSpan` because a
 * deleted note's unit swallows the `o` written beside it (`roll-strip.ts`,
 * `growUnits`) and {@link removeItem} takes the whole unit with it.
 */
function restRuns(context: EditContext, gap: Region): RestRun[] {
  const { source, strip } = context;
  const runs: RestRun[] = [];
  let open: RestRun | null = null;
  /** Whether nothing but whitespace and removed units has been passed since the last rest. */
  let clean = false;
  /** And whether one of those removed units is what stands between them. */
  let removed = false;

  for (let index = gap.after + 1; index < gap.before; index++) {
    const item = strip.items[index];
    const touches =
      index > gap.after + 1 &&
      source.slice(strip.items[index - 1].unitSpan.end, item.unitSpan.start).trim() === '';

    if (item.kind !== 'rest') {
      clean = clean && touches;
      removed = true;
      continue;
    }

    if (open !== null && clean && touches) {
      open.rests.push(item);
      open.joined ||= removed;
    } else {
      open = { rests: [item], joined: false };
      runs.push(open);
    }

    clean = true;
    removed = false;
  }

  return runs;
}

/**
 * Trailing rests a deletion left touching, written as the one rest they are.
 *
 * Nothing rewrites the tail's length — the channel ends where its music ends —
 * so the only runs collapsed here are the ones this gesture is what joined. A
 * run the porter wrote touching has had nothing done to it and is left as
 * written, which is the same line {@link realiseRegion} takes when a gap's ticks
 * do not change.
 *
 * The total is preserved, so the channel is exactly as long afterwards.
 */
function joinTail(context: EditContext, gap: Region): Edit[] | null {
  const edits: Edit[] = [];
  for (const run of restRuns(context, gap)) {
    if (!run.joined) {
      continue;
    }

    const written = collapse(context, run, rested(run.rests, 0));
    if (written === null) {
      return null;
    }

    edits.push(...written);
  }

  return edits;
}

/**
 * A run written as one rest of `want` ticks, or removed outright where it is
 * asked for none.
 *
 * The rests it leaves behind go one edit each rather than the whole run going as
 * a single splice, and that is load-bearing: `planEdits` puts a deleted note's
 * octave restore back at that note's own `unitSpan.end`, which a splice over the
 * run would enclose — and CodeMirror merges overlapping ranges rather than
 * refusing them, so `planEdits` refuses the gesture instead. Abutting edits are
 * what {@link coalesce} joins, in the order they are read.
 */
function collapse(context: EditContext, run: RestRun, want: number): Edit[] | null {
  const { source, targetAMKVersion } = context;
  const edits: Edit[] = [];
  for (const gone of run.rests.slice(1)) {
    edits.push(...removeItem(source, gone));
  }

  if (want <= 0) {
    edits.push(...removeItem(source, run.rests[0]));
    return edits;
  }

  const text = spellDuration(want, targetAMKVersion);
  if (text === null) {
    return null;
  }

  const edit = spliceRange(source, run.rests[0].unitSpan, `r${text}`);
  if (edit) {
    edits.push(edit);
  }

  return edits;
}

/** What a stretch of runs holds now, from `from` on. */
function heldBy(runs: readonly RestRun[], from: number): number {
  return runs.slice(from).reduce((sum, run) => sum + rested(run.rests, 0), 0);
}

/**
 * The rests between the notes, made to come to the ticks the plan asks for.
 *
 * Every change is taken from the rest **nearest the note before it**, so
 * anything written later in the gap keeps its distance from the note it was
 * written for: a `v200` two beats ahead of a note stays two beats ahead of it. A
 * shrink that exhausts one rest deletes it and carries on into the next; a gap
 * with no rest at all has one written in straight after the note before it.
 *
 * What the change is taken from is a **run** of rests rather than one rest
 * (`restRuns`): a note deleted from between two of them leaves them touching,
 * and two touching rests are one rest. A run whose ticks are what they already
 * were is left exactly as written, so rests the porter wrote touching are only
 * ever joined by a gesture that had to move them anyway.
 */
function realiseRegion(
  context: EditContext,
  gap: Region,
  survivors: ReadonlyMap<number, PlacedNote>,
): Edit[] | null {
  const { targetAMKVersion } = context;
  const edits: Edit[] = [];

  // The tail is free: a channel may end wherever the music ends. What it is not
  // free to leave is two rests where a deleted note stood between them.
  if (gap.tail && gap.born.length === 0) {
    return joinTail(context, gap);
  }

  // A gap between two notes that has to come to less than nothing is a plan
  // asking for them in an order the text does not have them in, which
  // `crossings` takes out before the regions are built. Refused rather than
  // written: there is no run of rests that realises it, and the answer that
  // looks plausible — leave the text alone — is a channel slid along.
  if (!gap.tail && gap.ticks < 0) {
    return null;
  }

  if (gap.born.length > 0) {
    return spawnInto(context, gap, survivors);
  }

  const runs = restRuns(context, gap);
  let left = gap.ticks;
  for (let at = 0; at < runs.length; at++) {
    const run = runs[at];
    const held = rested(run.rests, 0);
    const last = at === runs.length - 1;
    const want = last ? left : at === 0 ? Math.max(0, left - heldBy(runs, 1)) : held;
    if (want !== held) {
      const written = collapse(context, run, want);
      if (written === null) {
        return null;
      }

      edits.push(...written);
    }

    if (want <= 0) {
      continue;
    }

    left -= want;
  }

  if (left === 0) {
    return edits;
  }

  if (left < 0) {
    return null; // The rests could not give up enough; a command would have to move.
  }

  const text = spellDuration(left, targetAMKVersion);
  if (text === null) {
    return null;
  }

  const edit = writeInto(context, gap, `r${text}`);
  return edit ? [...edits, edit] : null;
}

/**
 * Where text written into a gap goes, and which side its space goes on.
 *
 * After the note before the gap where there is one. Where there is not, at the
 * head of the **next surviving** note rather than of the channel's first item —
 * the first item may be a note this same plan is deleting, and an insertion
 * inside a range being removed is two edits over one run of text, which
 * CodeMirror merges rather than refuses.
 *
 * A channel with neither note nor rest has no item to anchor to at all, and
 * takes {@link Strip.home}: the end of its own block, or the end of the document
 * with a whole `#N` written in front of it (see {@link channelOpening}). The run
 * goes on a line of its own either way, so a `;` comment ending the block above
 * cannot swallow it, and a new block is set off by a blank line unless it is
 * opening an empty document.
 */
function writeInto(context: EditContext, gap: Region, run: string): Edit | null {
  const { source, strip } = context;
  if (gap.after >= 0) {
    // After the last thing written in the region, which for a region holding
    // nothing is the note before it. A `/` or a command written between that
    // note and the region's own items stands on the boundary the two meet at,
    // and the run belongs after it: put in front, a marker would come out a
    // whole region late, and every channel resumes from its own on each pass.
    return insertAt(strip.items[gap.before - 1].unitSpan.end, ` ${run}`, 1);
  }

  const next = strip.items[gap.before];
  if (next) {
    return insertAt(next.unitSpan.start, `${run} `, 1);
  }

  // No note after it either, so the region is the whole channel and the run goes
  // where its items were: after the last of them, as the branch above puts it
  // after the note before the gap. Not at the head of the first — every item in
  // here is a unit `planEdits` removes, `removeItem` takes the whitespace in
  // front of the unit with it, and an insertion at a head therefore lands
  // strictly inside a range being deleted, which `planEdits` refuses. The end of
  // the last only abuts one.
  const last = strip.items[gap.before - 1];
  if (last) {
    return insertAt(last.unitSpan.end, ` ${run}`, 1);
  }

  const line = eol(source);
  if (strip.home.declared) {
    return insertAt(strip.home.at, `${line}${run}`, 1);
  }

  const gapAbove = strip.home.at === 0 ? '' : `${line}${line}`;
  const opening = channelOpening(strip.channel, context.songTargetProgram);
  return insertAt(strip.home.at, `${gapAbove}${opening}${line}${run}`, 1);
}

/**
 * A rest on the end of every other channel that would stop the song before `to`.
 *
 * The driver reloads all eight track pointers the moment one voice reads its
 * `$00` (`main.asm:L_0C01`, `Music.cpp:3209`), so the song is as long as its
 * shortest channel and a note past that point is written, compiled and never
 * heard. Making it heard means making every other channel reach it.
 *
 * A rest is appended rather than a channel rewritten, and that is what makes
 * this possible on a real song: it takes no note map, no agreement with the
 * walk and no {@link Strip}, so a channel full of `[ ]` loops — which
 * `channelStrip` refuses outright — is padded like any other. The run goes on a
 * line of its own for the reason {@link writeInto} does it: a `;` comment ending
 * the block would otherwise swallow it.
 *
 * A channel at 0 ticks is left alone. It is holding nothing back, and giving it
 * ticks it never had is not what drawing a note asked for. So is the channel
 * being edited, which the gesture's own splices already carry out to the note.
 */
function padChannels(context: EditContext, to: number): Edit[] | null {
  const { source, strip, targetAMKVersion } = context;
  const line = eol(source);
  const edits: Edit[] = [];

  for (const [channel, tail] of context.channels.entries()) {
    if (channel === strip.channel || tail.ticks <= 0 || tail.ticks >= to) {
      continue;
    }

    const text = spellDuration(to - tail.ticks, targetAMKVersion);
    if (text === null) {
      return null;
    }

    const edit = insertAt(tail.at, `${line}r${text}`, 1);
    if (edit) {
      edits.push(edit);
    }
  }

  return edits;
}

function rested(rests: readonly StripItem[], from: number): number {
  return rests.slice(from).reduce((sum, rest) => sum + rest.ticks, 0);
}

/**
 * The note and the rests either side of it, as one run of text, with the song's
 * intro marker written into it where one is asked for.
 *
 * A `/` puts the channel's loop re-entry at the byte it stands on
 * (`parser.ts:parseIntro`) and every channel resumes from its own on each pass
 * round the loop, so a marker on the wrong tick leaves the channel playing
 * against the rest of the song. `introAt` is therefore a tick rather than a
 * place in the run, and where it does not fall on a boundary the piece it lands
 * inside is written as two: a rest as two rests, and the note as a head and a
 * `^` continuation, which is still one note — a tie emits `$C6` and the driver
 * carries the note through it.
 *
 * `exitOctave` is the octave the run leaves standing, for a channel with no note
 * left to be handed it (see {@link spawnInto}).
 *
 * `null` where a length in the run has no spelling on this target.
 */
function spawnRun(
  context: EditContext,
  born: readonly PlacedNote[],
  gaps: readonly number[],
  running: number | null,
  introAt: number | null,
  exitOctave: number | null,
): string | null {
  const { targetAMKVersion } = context;
  const parts: string[] = [];
  let at = 0;
  let marked = introAt === null;
  /**
   * The octave the run has left standing so far.
   *
   * Carried from note to note for the reason {@link noteText} takes it at all:
   * a run that writes two notes an octave apart spells the second's `o` and a
   * run that writes two in one octave spells it once.
   */
  let inForce = running;

  /** The marker where the tick falls between two pieces rather than inside one. */
  const mark = (): void => {
    if (!marked && introAt === at) {
      parts.push('/');
      marked = true;
    }
  };

  /** The tick, where it falls strictly inside the piece of `ticks` starting here. */
  const splitAt = (ticks: number): number | null =>
    !marked && introAt !== null && introAt > at && introAt < at + ticks ? introAt : null;

  const rest = (ticks: number): boolean => {
    if (ticks === 0) {
      return true;
    }

    const split = splitAt(ticks);
    if (split !== null) {
      const first = spellDuration(split - at, targetAMKVersion);
      const second = spellDuration(at + ticks - split, targetAMKVersion);
      if (first === null || second === null) {
        return false;
      }

      parts.push(`r${first}`, '/', `r${second}`);
      marked = true;
    } else {
      const whole = spellDuration(ticks, targetAMKVersion);
      if (whole === null) {
        return false;
      }

      parts.push(`r${whole}`);
    }

    at += ticks;
    return true;
  };

  /** The octave a note leaves standing: its own, or what it was handed if a drum. */
  const leftBy = (each: PlacedNote, exit: number | null): number | null =>
    each.drum === null ? (exit ?? octaveFor(each.written)) : inForce;

  // Only the last note in the run puts an octave back, since only the last one
  // is what the text after the run reads.
  const note = (each: PlacedNote, last: boolean): boolean => {
    const exit = last ? exitOctave : null;
    const split = splitAt(each.ticks);
    if (split !== null) {
      const first = spellDuration(split - at, targetAMKVersion);
      const second = spellDuration(at + each.ticks - split, targetAMKVersion);
      const head = first === null ? null : noteText(each, first, null, targetAMKVersion, inForce);
      // The `^` is where the note ends, so the octave goes after it rather than
      // between the two halves.
      const put = exitText(each, exit);
      if (head === null || second === null || put === null) {
        return false;
      }

      parts.push(head, '/', `^${second}${put}`);
      marked = true;
    } else {
      const whole = noteText(each, null, exit, targetAMKVersion, inForce);
      if (whole === null) {
        return false;
      }

      parts.push(whole);
    }

    at += each.ticks;
    inForce = leftBy(each, exit);
    return true;
  };

  mark();
  for (let index = 0; index < born.length; index++) {
    if (!rest(gaps[index])) {
      return null;
    }

    mark();
    if (!note(born[index], index === born.length - 1)) {
      return null;
    }

    mark();
  }

  if (!rest(gaps[born.length])) {
    return null;
  }

  mark();
  return parts.join(' ');
}

/**
 * The rest a note being drawn is written over, out of the ones its region holds.
 *
 * Usually a region is one rest and this is that rest. It is more than one where
 * something the note map does not carry has been written between them — a `/`,
 * or a command — and then the note belongs to whichever rest its own start falls
 * in. Rewriting that one alone is what keeps everything between them where it
 * was written, so there is nothing to guess at.
 *
 * A note starting at or past where the tail's music stopped takes the last rest
 * there, and the run written over it reaches out to the note — which is how a
 * note drawn past the end of a channel extends it.
 *
 * `null` where the region holds no rest at all, and where a note starts in one
 * rest and ends in another: the run written between them would have to move,
 * and only the porter knows which side of the note it belongs on.
 */
function restFor(gap: Region, born: PlacedNote): StripItem | null {
  for (const rest of gap.rests) {
    if (born.startTick >= rest.startTick && born.startTick < rest.startTick + rest.ticks) {
      return born.startTick + born.ticks <= rest.startTick + rest.ticks ? rest : null;
    }
  }

  const last = gap.rests[gap.rests.length - 1];
  return gap.tail && last !== undefined && born.startTick >= last.startTick + last.ticks
    ? last
    : null;
}

/**
 * Whether the region's items are written one after another with nothing but
 * whitespace between them.
 *
 * A `v`, a `y`, a `$ED` or the intro `/` carries no ticks of its own but does
 * carry a **position**: the tick of the item boundary it stands at. A run laid
 * over the whole region moves every boundary strictly inside it, so one written
 * between two items would come out on a different tick, and only the porter
 * knows which of the two it belongs with. One written before the first item or
 * after the last stands on a boundary the region does not move — where it meets
 * the surviving note either side — and stays exactly where it is, which is why
 * only the interior is read.
 */
function itemsRunTogether(context: EditContext, gap: Region): boolean {
  const { source, strip } = context;
  for (let index = gap.after + 2; index < gap.before; index++) {
    const between = source.slice(
      strip.items[index - 1].unitSpan.end,
      strip.items[index].unitSpan.start,
    );
    if (between.trim() !== '') {
      return false;
    }
  }

  return true;
}

/**
 * A note being created, written into the gap it lands in.
 *
 * Two roads, and which one is taken is what decides whether anything written in
 * the region may move.
 *
 * **In place.** The note goes over the one rest it falls inside
 * (see {@link restFor}), and everything else in the region stays exactly where
 * it was written. This is the road for a region holding several rests with
 * something positional between them, and it takes one note at a time.
 *
 * **Laid out afresh.** Where the region's items run together
 * ({@link itemsRunTogether}) there is nothing inside it carrying a position, so
 * the whole stretch is written as one run of rests and notes. That is what lets
 * a region hold more than one note being created — a carve's split leaves a
 * tail beside the note that split it — and notes this same plan is removing,
 * whose units `planEdits` deletes on its own and whose spans only ever abut this
 * run rather than overlap it.
 *
 * A builder answering `null` is refused too, rather than passed on as no edits:
 * `planEdits` pushes what each region returns and goes on to the next, so a note
 * that quietly wrote nothing would leave the rest of the gesture committed.
 */
function spawnInto(
  context: EditContext,
  gap: Region,
  survivors: ReadonlyMap<number, PlacedNote>,
): Edit[] | null {
  const { source, strip } = context;
  if (gap.born.length === 0) {
    return null;
  }

  const order = [...gap.born].sort((a, b) => a.startTick - b.startTick);
  const born = order[order.length - 1];
  const empty = strip.items.length === 0;
  // A channel being written from nothing has just had its own `o4` put in front
  // of it, so a note in that octave has nothing to add (`channelOpening`).
  const opening = empty && !strip.home.declared;

  const end = born.startTick + born.ticks;
  /**
   * Where the channel ends now, which a note drawn into its last rest must not
   * move: the tail region carries `ticks: -1` for "may be any length", not "has
   * none", and reading that as nothing to fill silently eats the rest the note
   * landed in. A channel with nothing on it ends where the song does, so that
   * its first note does not make it the shortest and cut every other channel
   * short — the driver reloads all eight track pointers the moment one voice
   * reads its `$00` (`main.asm:L_0C01`, `Music.cpp:3209`).
   *
   * A note drawn past the end extends the channel rather than being refused, in
   * either case, and {@link padChannels} brings the rest of the song out to meet
   * it — so the channel does not become the long one and the note is heard.
   */
  const channelEnd = empty ? context.playableTicks : strip.ticks;

  /**
   * The rest being written over, and the ticks the run written there has to come
   * to.
   *
   * One rest spans its whole region, so the run answers to the **region**: the
   * note may reach past where that rest ended, because the notes after it are
   * being pushed along to make room for it. Several rests means something
   * carrying no ticks of its own was written between them — the `/` a channel is
   * opened with, or a command — and then only the rest the note falls inside is
   * rewritten, so the run answers to **that rest** and everything between them
   * stays where it was written. A push cannot be served that way, so a region
   * whose ticks no longer come to the rests it holds is refused instead.
   */
  const single = gap.rests.length === 1 && gap.between === 1;
  const settled = gap.tail || gap.ticks === rested(gap.rests, 0);
  const inPlace = order.length === 1 && gap.between === gap.rests.length && settled;

  /** Whether the run answers to the whole region rather than to one rest inside it. */
  let laidOut = true;
  let over: StripItem | null;
  if (single) {
    over = gap.rests[0];
  } else if (inPlace) {
    over = restFor(gap, born);
    laidOut = false;
    // With no rest in it there is nothing for the run to be laid over, and so no
    // boundary of anything that survives for it to move: the run is inserted at
    // one offset and every item in the region is a note `planEdits` removes
    // outright. A command written between two of them keeps its place in the
    // text and changes tick for the reason deleting those notes changes it —
    // what it stood against has gone. Which is the commonest region a carve
    // leaves, since a note drawn over a run of notes swallows all of them.
  } else if (gap.rests.length === 0 || itemsRunTogether(context, gap)) {
    over = gap.rests[0] ?? null;
  } else {
    return null;
  }

  if (over === null && gap.rests.length > 0) {
    return null;
  }

  // Only the last of the tail's rests may grow, and that is what lets a note be
  // drawn past the end of a channel at all.
  const grows = gap.tail && (over === null || over === gap.rests[gap.rests.length - 1]);

  const runFrom = laidOut || over === null ? gap.startTick : over.startTick;
  const runTo = grows
    ? Math.max(end, channelEnd)
    : laidOut || over === null
      ? gap.startTick + gap.ticks
      : over.startTick + over.ticks;

  /** One rest before each note, and one more after the last — `order.length + 1`. */
  const gaps: number[] = [];
  let at = runFrom;
  for (const each of order) {
    if (each.startTick < at) {
      return null;
    }

    gaps.push(each.startTick - at);
    at = each.startTick + each.ticks;
  }

  if (runTo < at) {
    return null;
  }

  gaps.push(runTo - at);

  // The tick the song loops back to, where this channel is being opened and the
  // run is long enough to reach it. `gap.startTick` is 0 for an empty channel —
  // it has one region and it begins at the top — so the run's own ticks and the
  // channel's are the same count.
  const total = runTo - runFrom;
  const introAt =
    empty && context.introTicks !== null && context.introTicks >= 0 && context.introTicks <= total
      ? context.introTicks
      : null;

  /**
   * The octave the run leaves standing, which is the note's own: a spawn writes
   * an absolute `o` in front of itself wherever one is in doubt, and a drum
   * writes none at all and so leaves whatever stood.
   */
  const leaves = born.drum === null ? octaveFor(born.written) : null;
  // The next *surviving* note, which is what bounds the region — `noteFrom`
  // would find the first note item, and that may be one this plan is removing:
  // an octave inserted at its head is an edit inside a range being deleted, and
  // two edits over one run of text is what `planEdits` refuses.
  const reader = gap.before < strip.items.length ? gap.before : -1;

  /**
   * The note that reads the octave the run leaves, and so has to be given the
   * one it was written under.
   *
   * Its own head, rather than the end of the run: `<` and `>` are not commands
   * to the scanner at all, so nothing here can say which side of the run one
   * written in this gap sits on, and a note's head is past every one of them. It
   * is also where the text settles — an `o` written there is that note's leading
   * octave on the next pass (`roll-strip.ts:growUnits`), where one left between
   * two rests is claimed by no unit and is what makes a later edit unreadable.
   */
  const owed =
    leaves !== null && reader >= 0 && !writesItsOwnOctave(strip, reader, survivors)
      ? strip.items[reader].octave
      : null;

  // Nothing left on the channel to hand it to, so the run carries it: `octave`
  // is global parser state and leaks past a `#N` into the block below.
  const previous = gap.after >= 0 ? strip.items[gap.after] : null;
  const standing = previous ? (previous.exitOctave ?? previous.octave) : null;
  const trailing = reader < 0 ? standing : null;

  /**
   * The octave in force where the run goes, or `null` for not known — a note
   * drawn at the octave already standing writes no `o` in front of itself.
   *
   * The note before the gap gives it, out of its own byte, so a `<` or a `>`
   * written above that note is already in it. What is left is the text between
   * that note and where the run lands, which has to move the octave nowhere:
   * only `o`, `<` and `>` can, and a channel the strip built holds no `[ ]`,
   * `(n)` or `"x=y"` to hide one inside (`roll-strip.ts:forbiddenConstruct`), so
   * reading the three characters off the text is exact. It over-matches one
   * written in a comment, which costs the note an `o` it did not need and
   * nothing else.
   */
  const runAt = over ? over.unitSpan.start : (previous?.unitSpan.end ?? 0);
  const inForce =
    previous !== null && !MOVES_OCTAVE.test(source.slice(previous.unitSpan.end, runAt))
      ? standing
      : null;

  /** The head the octave would be put back at, which is where the reader begins. */
  const readAt = reader >= 0 ? strip.items[reader].unitSpan.start : 0;
  /**
   * Where the run's text ends, which is where the splice over `over` and
   * {@link writeInto} put it: the rest it was written over, the last item in
   * the region, or the reader's own head for a region at the top of the channel.
   */
  const runEnd = over
    ? over.unitSpan.end
    : gap.after >= 0
      ? strip.items[gap.before - 1].unitSpan.end
      : readAt;

  /**
   * Whether the note after the gap can be left as it is.
   *
   * The run leaves {@link leaves} standing, so that note reads what it was
   * written under exactly when the two are the same octave and nothing between
   * the run and its head moves the octave again. What can is the three
   * characters the scan above reads, on the other side of the run, and for the
   * same reason: `o`, `<` and `>` are all that move it, and a channel the strip
   * built holds no `[ ]`, `(n)` or `"x=y"` to hide one inside. It over-matches
   * one written in a comment and one inside a unit this plan is deleting, which
   * costs the note an `o` it did not need and nothing else.
   */
  const untouched = owed === leaves && !MOVES_OCTAVE.test(source.slice(runEnd, readAt));

  const run = spawnRun(context, order, gaps, opening ? OPENING_OCTAVE : inForce, introAt, trailing);
  if (run === null) {
    return null;
  }

  let restore: Edit | null = null;
  if (owed !== null && !untouched) {
    const spelled = spellOctave(owed);
    if (spelled === null) {
      return null;
    }

    restore = insertAt(strip.items[reader].unitSpan.start, `${spelled} `, 1);
  }

  // No rest to write over — the region holds nothing, or nothing but notes this
  // plan is removing — so the run is inserted rather than written over anything.
  const edit = over ? spliceRange(source, over.unitSpan, run) : writeInto(context, gap, run);
  if (edit === null) {
    return null;
  }

  // A run laid out afresh is the whole region's ticks, so the rests it did not
  // go over are gone: what they held is in the run now. Each goes as its own
  // edit rather than the whole stretch going as one splice, since anything
  // between them is a unit `planEdits` is removing and two edits over one run of
  // text is what it refuses.
  const gone = laidOut
    ? gap.rests.filter((rest) => rest !== over).flatMap((rest) => removeItem(source, rest))
    : [];

  // The run first where the two land on the same offset — a run inserted at the
  // head of the note it is being written in front of — so `coalesce` joins them
  // in the order they are read.
  return restore ? [edit, ...gone, restore] : [edit, ...gone];
}

export function planEdits(context: EditContext, plan: Plan): Edit[] | null {
  if (!committable(plan)) {
    return null;
  }

  const { source, strip } = context;
  const edits: Edit[] = [];
  const survivors = new Map<number, PlacedNote>();
  const born: PlacedNote[] = [];
  for (const note of plan.notes) {
    if (note.from >= 0) {
      survivors.set(note.from, note);
    } else {
      born.push(note);
    }
  }

  // A note carried *past* another cannot be rewritten where it stands. The text
  // is a sequence and a channel's positions are the running sum of its
  // durations, so a note whose new tick puts it on the other side of one of its
  // neighbours has to come out of the text and go back in over there. It is
  // moved out of `survivors`, which is all it takes: the loop below removes the
  // unit of anything it does not find there, and `regionsOf` hands a born note
  // to the region its new tick lands in.
  for (const index of crossings(strip, survivors)) {
    const note = survivors.get(index);
    if (!note) {
      continue;
    }

    // A command written inside the note stands between two of its segments and
    // so inside the unit that is about to be taken out — `removeItem` splices
    // the whole span, and the run written on the far side is the note alone.
    // Moving one is not permission to throw a `v200` away, and which side of the
    // note the porter meant it to follow is not something a drag can say. This
    // is the same ground as `rewriteNote` refusing to move such a note's start.
    if (strip.items[index].segments.length > 1) {
      return null;
    }

    survivors.delete(index);
    born.push({ ...note, from: -1 });
  }

  // Built here rather than at the pass below that realises them: an octave put
  // back at a note's head has to agree with what the run in front of it leaves,
  // and `survivors` and `born` are both settled once the crossings are out.
  const regions = regionsOf(strip, survivors, born);

  // The octave the edited text leaves in force, carried down the channel so a
  // note only writes one where the one already standing is not the one it needs.
  // `null` is "not known": before the first note, and after anything between two
  // notes that moved the octave itself — which is what the comparison against the
  // previous note's own exit detects, since the compiler gave both of them.
  let running: number | null = null;
  let previous: StripItem | null = null;
  /** Whether a unit has been removed since the last surviving note. */
  let dropped = false;
  /**
   * The octaves put back in front of the notes that read them, held apart so
   * they are written after the regions.
   *
   * A rest realised into the gap a deleted first note left goes in at the next
   * surviving note's head as well (`writeInto`), and `coalesce` joins two empty
   * ranges at one offset in the order this array holds them. The rest has to be
   * read first: an `o` behind it is claimed by no unit on the next strip build.
   */
  const restores: Edit[] = [];

  for (let index = 0; index < strip.items.length; index++) {
    const item = strip.items[index];
    if (item.kind !== 'note') {
      continue;
    }

    if (previous !== null && (previous.exitOctave ?? previous.octave) !== item.octave) {
      // Something between the two notes moved the octave — a `<`, a `>`, or an
      // `o` no unit claimed. What we were carrying is not what enters this one.
      running = null;
    }

    // Nothing has diverged from the original here yet, so the octave in force is
    // the one the note was written under — which the compiler gave us. Without
    // this seed the first note edited in a channel always gains an `o` saying
    // what was already true. A unit carrying its own leading `o` stays unknown,
    // since that `o` is about to be rewritten along with the note. So does a
    // note standing after a unit that has gone: what the compiler gave us is
    // what the text said before the `o` inside that unit was deleted.
    if (running === null && !item.hasLeadingOctave && !dropped) {
      running = item.octave;
    }

    const note = survivors.get(index);
    if (!note) {
      // The unit takes the `o` written beside it with it (`roll-strip.ts`,
      // `growUnits`), and what stood in force for the notes after it goes too.
      // `running` is left alone: what stands after a removed unit is what stood
      // before it, which is what it already holds.
      edits.push(...removeItem(source, item));
      dropped = true;
      previous = item;
      continue;
    }

    // A unit removed since the last surviving note took the octave this one was
    // written under with it, so it is given one of its own — at its head, where
    // the text settles: an `o` written there is this note's leading octave on
    // the next pass, where one left between two rests is claimed by no unit and
    // is what makes a later edit there unreadable. Once, however many notes
    // went, because it is the note that reads the octave that asks for it rather
    // than each note that dropped one — and not at all where a run spawned into
    // the region in front of it has already answered for the same head.
    if (
      dropped &&
      !writesItsOwnOctave(strip, index, survivors) &&
      spawnLeaves(regions, index) === null &&
      item.octave !== running
    ) {
      const spelled = item.octave === null ? null : spellOctave(item.octave);
      if (spelled === null) {
        return null;
      }

      const restore = insertAt(item.unitSpan.start, `${spelled} `, item.unitSpan.line);
      if (restore) {
        restores.push(restore);
      }

      running = item.octave;
    }

    dropped = false;

    const written = rewriteNote(context, index, note, survivors, running);
    if (written === null) {
      return null;
    }

    edits.push(...written);
    const exit = exitOctaveFor(strip, index, survivors);
    // A drum writes no octave, so it leaves whatever was standing.
    const own: number | null = note.drum === null ? octaveFor(note.written) : running;
    running = exit ?? own;
    previous = item;
  }

  // Nothing left on the channel to hand it to, so the octave the last unit put
  // in force stays where that unit was: `octave` is global parser state and
  // leaks past a `#N` into the block below. `coalesce` joins it to the unit's
  // own removal, and the note before it claims it as a trailing `o` on the next
  // pass. Only the last note deleted off the tail leaves `dropped` set, so a run
  // of them writes one.
  if (dropped && previous !== null) {
    const standing = previous.exitOctave ?? previous.octave;
    // A run spawned into the tail spells its own last note's octave, so that is
    // what the block below reads and there is nothing here to say.
    const left = spawnLeaves(regions, strip.items.length) ?? running;
    if (standing !== null && standing !== left) {
      const spelled = spellOctave(standing);
      if (spelled === null) {
        return null;
      }

      const restore = insertAt(previous.unitSpan.end, ` ${spelled}`, previous.unitSpan.line);
      if (restore) {
        restores.push(restore);
      }
    }
  }

  /**
   * How far past the song this gesture reaches, over the notes it is answerable
   * for: the ones it placed itself, and the ones its push cascade shoved out of
   * the way. Not every note in the plan — a channel already running past the cut
   * is an ordinary shape, and reading its tail as "reach" would have a deletion
   * lengthen the song.
   *
   * A carve fills `pushed` too, and its pieces are left out for that same
   * reason: it only ever makes a note shorter, so every piece it leaves sits at
   * a tick the channel had already reached, and a carve out in a channel's tail
   * would otherwise pad every other channel out to meet a note nothing moved.
   * `erased` is what says a carve is what filled it — the two resolvers never
   * both run, since the mode picks one.
   */
  const moved = plan.erased.length > 0 ? plan.touched : [...plan.touched, ...plan.pushed];
  const reach = moved.reduce(
    (furthest, note) => Math.max(furthest, note.startTick + note.ticks),
    0,
  );

  // Before the regions, and that is load-bearing rather than tidiness: a channel
  // being opened writes its `#N` at `strip.home.at`, which for an undeclared one
  // is the wound-back end of the document — the same offset as the tail of
  // whichever channel is written last. Both are empty ranges, `coalesce` joins
  // them into one, and the joined text is in this array's order. The other way
  // round, the rest lands inside the block just opened.
  if (reach > context.playableTicks) {
    const padded = padChannels(context, reach);
    if (padded === null) {
      return null;
    }

    edits.push(...padded);
  }

  for (const region of regions) {
    const written = realiseRegion(context, region, survivors);
    if (written === null) {
      return null;
    }

    edits.push(...written);
  }

  // After the regions, and load-bearing for the reason they are put off at all:
  // a rest realised at a reader's head has to be read before the octave written
  // there.
  edits.push(...restores);

  // Shortest first at a shared offset, so an insertion sits ahead of the
  // replacement it abuts and `coalesce` can join the two into one.
  const sorted = coalesce(
    edits.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end),
  );
  for (let at = 1; at < sorted.length; at++) {
    // CodeMirror merges overlapping ranges instead of refusing them, so this is
    // the roll's own invariant to hold rather than something it can be told.
    if (sorted[at].span.start < sorted[at - 1].span.end) {
      return null;
    }
  }

  return sorted;
}

/**
 * Joins edits that touch into one.
 *
 * Deleting a note and writing the rest that takes its place meet at a single
 * offset, and two edits sharing an offset are two ways of saying one thing:
 * which of them lands first decides the result, and nothing in the pair says
 * which should. One edit over the joined run has one answer.
 */
function coalesce(sorted: readonly Edit[]): Edit[] {
  const joined: Edit[] = [];
  for (const edit of sorted) {
    const held = joined[joined.length - 1];
    if (held?.span.end === edit.span.start) {
      joined[joined.length - 1] = {
        span: { ...held.span, end: edit.span.end },
        text: held.text + edit.text,
        expect: held.expect + edit.expect,
      };
      continue;
    }

    joined.push(edit);
  }

  return joined;
}

/**
 * The notes whose place in the text is no longer their place in the music.
 *
 * {@link regionsOf} walks the channel in the order it is **written** and sizes
 * each gap as the distance from the note before it, so it holds only while tick
 * order and text order are the same thing. A gesture that carries a note past
 * one of its neighbours breaks that, and the note has to be written again on the
 * far side rather than rewritten where it stands.
 *
 * Only a note that ended up somewhere other than where it is written can break
 * it, which is the test rather than membership of {@link Plan.touched}: a push
 * moves notes the gesture never named, and a carve trims a head, so "the gesture
 * moved it" is not the same question. The ones still on their own tick are in
 * text order by construction — a channel's ticks are the running sum of its
 * durations — so taking the movers out is enough to put the rest back in
 * agreement rather than the first step of a search.
 *
 * A note that moved cannot always cross, and this asks anyway: a push settles a
 * note against the edge that displaced it, so getting past a neighbour would
 * mean lying across it, and an overlap no push resolved is a clash `committable`
 * has already turned the plan away for.
 */
function crossings(strip: Strip, survivors: ReadonlyMap<number, PlacedNote>): number[] {
  const crossed: number[] = [];
  for (const [at, note] of survivors) {
    if (note.startTick === strip.items[at].startTick) {
      continue; // Where it is written, so nothing can have got past it.
    }

    for (const [index, other] of survivors) {
      // Written after it but played before it, or the other way about.
      if (index !== at && index > at !== other.startTick > note.startTick) {
        crossed.push(at);
        break;
      }
    }
  }

  return crossed;
}

/** The stretches of text between the surviving notes, with what belongs in each. */
function regionsOf(
  strip: Strip,
  survivors: ReadonlyMap<number, PlacedNote>,
  born: readonly PlacedNote[],
): Region[] {
  const anchors: { index: number; note: PlacedNote }[] = [];
  for (let index = 0; index < strip.items.length; index++) {
    const note = survivors.get(index);
    if (note) {
      anchors.push({ index, note });
    }
  }

  const regions: Region[] = [];
  let after = -1;
  let startTick = 0;
  for (const anchor of anchors) {
    regions.push(
      makeRegion(strip, after, anchor.index, startTick, anchor.note.startTick - startTick),
    );
    after = anchor.index;
    startTick = anchor.note.startTick + anchor.note.ticks;
  }

  regions.push(makeRegion(strip, after, strip.items.length, startTick, -1, true));

  for (const note of [...born].sort((a, b) => a.startTick - b.startTick)) {
    const home =
      regions.find(
        (each) =>
          each.ticks >= 0 &&
          note.startTick >= each.startTick &&
          note.startTick + note.ticks <= each.startTick + each.ticks,
      ) ?? regions[regions.length - 1];
    home.born.push(note);
  }

  return regions;
}

function makeRegion(
  strip: Strip,
  after: number,
  before: number,
  startTick: number,
  ticks: number,
  tail = false,
): Region {
  const rests: StripItem[] = [];
  let between = 0;
  for (let index = after + 1; index < before; index++) {
    between++;
    if (strip.items[index].kind === 'rest') {
      rests.push(strip.items[index]);
    }
  }

  return { after, before, rests, ticks, tail, born: [], startTick, between };
}
