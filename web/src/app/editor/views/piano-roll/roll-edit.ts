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
import type { Strip, StripItem } from './roll-strip';

/**
 * What a gesture on the roll does to a channel, and what that is as text.
 *
 * Two halves, and keeping them apart is what makes either testable.
 * {@link planGesture} is arithmetic over ticks: where every note ends up, which
 * ones a push moved, and where two would sound at once. It is what the roll
 * draws while the pointer is still down, and it decides everything.
 * {@link planEdits} turns an accepted plan into splices and decides nothing —
 * a plan that is refused never reaches it.
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

export interface Plan {
  /** Every note the channel would hold, in tick order. */
  notes: readonly PlacedNote[];
  /** The notes the gesture moved itself, drawn as the live bar. */
  touched: readonly PlacedNote[];
  /** The notes a push moved out of the way, drawn as striped ghosts. */
  pushed: readonly PlacedNote[];
  /** Drawn as a red wash on both notes. Empty for a plan that can be committed. */
  clashes: readonly Clash[];
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
 * `strict` refuses it, `flexible` shifts the notes in the way aside.
 *
 * The porter's setting rather than the gesture's, so a drag and a stretch answer
 * an overlap the same way.
 */
export const EDIT_MODES = ['flexible', 'strict'] as const;
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
 * A note shoved twice is reported once, at where it finished, since the ghosts
 * are drawn from this and two rects for one note would sit at both positions.
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

const NOTHING: Omit<Plan, 'refused'> = { notes: [], touched: [], pushed: [], clashes: [] };

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
      if (mode === 'strict') {
        return { notes, touched: [born], pushed: [], clashes: clashesIn(notes), refused: null };
      }

      // A drawn note is put where the pointer is, so whatever was already there
      // moves later rather than earlier.
      const shoved = pushFrom(notes, [born], 1, new Set([born]));
      if (!shoved) {
        return { ...NOTHING, notes, clashes: clashesIn(notes), refused: REFUSE_ROOM };
      }

      const sorted = shoved.notes.sort(byTick);
      return {
        notes: sorted,
        touched: [born],
        pushed: shoved.pushed,
        clashes: clashesIn(sorted),
        refused: null,
      };
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

      const sorted = notes.sort(byTick);
      if (mode === 'strict') {
        return { notes: sorted, touched, pushed: [], clashes: clashesIn(sorted), refused: null };
      }

      // The way the porter is dragging: a note shoved aside carries on in the
      // same direction, and a drag straight up or down has no other way to send
      // it. A copy dropped on its own original pushes that original, which is
      // the same rule seen from the other side.
      const direction = gesture.deltaTicks < 0 ? -1 : 1;
      const shoved = pushFrom(sorted, touched, direction, new Set(touched));
      if (!shoved) {
        return { ...NOTHING, notes: sorted, clashes: clashesIn(sorted), refused: REFUSE_ROOM };
      }

      const settled = shoved.notes.sort(byTick);
      return {
        notes: settled,
        touched,
        pushed: shoved.pushed.filter((each) => !chosen.has(each.from)),
        clashes: clashesIn(settled),
        refused: null,
      };
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
            refused: null,
          };
        }

        const stretched: PlacedNote = { ...note, startTick: start, ticks: end - start };
        notes = notes.map((each) => (each === note ? stretched : each));
        touched.push(stretched);

        if (mode === 'strict') {
          continue;
        }

        const shoved = push(notes, stretched, direction);
        if (!shoved) {
          return { ...NOTHING, notes, clashes: clashesIn(notes), refused: REFUSE_ROOM };
        }

        notes = shoved.notes;
        pushed.push(...shoved.pushed.filter((each) => !chosen.has(each.from)));
      }

      const sorted = [...notes].sort(byTick);
      return { notes: sorted, touched, pushed, clashes: clashesIn(sorted), refused: null };
    }

    case 'delete': {
      const gone = new Set(gesture.items);
      const notes = placedNotes(strip).filter((note) => !gone.has(note.from));
      return { notes, touched: [], pushed: [], clashes: [], refused: null };
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
      if (mode === 'strict') {
        return { notes, touched, pushed: [], clashes: clashesIn(notes), refused: null };
      }

      // Rightwards whichever way a note was pulled. A tidy-up that shoved its
      // neighbours toward tick 0 would run out of room in the first bar, and
      // the direction has to be one for the whole cascade either way.
      const shoved = pushFrom(notes, touched, 1, new Set(touched));
      if (!shoved) {
        return { ...NOTHING, notes, clashes: clashesIn(notes), refused: REFUSE_ROOM };
      }

      const settled = shoved.notes.sort(byTick);
      return {
        notes: settled,
        touched,
        pushed: shoved.pushed.filter((each) => !chosen.has(each.from)),
        clashes: clashesIn(settled),
        refused: null,
      };
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

      return { notes, touched, pushed: [], clashes: [], refused: null };
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
  const exit = exitOctave === null || exitOctave === octave ? '' : spellOctave(exitOctave);
  if (lead === null || exit === null) {
    return null;
  }

  return `${lead ? `${lead} ` : ''}${head}${length}${exit ? ` ${exit}` : ''}`;
}

/**
 * The octave to put back after a note whose own has been rewritten.
 *
 * The octave in force after the unit as it was written — unless the next note on
 * the channel sets its own, in which case saying it twice is noise. The last
 * note of a channel always restores, because `octave` is global parser state and
 * leaks past a `#N` into whatever block comes after it.
 */
function exitOctaveFor(
  strip: Strip,
  index: number,
  survivors: ReadonlyMap<number, PlacedNote>,
): number | null {
  const item = strip.items[index];
  const exit = item.exitOctave ?? item.octave;
  for (let at = index + 1; at < strip.items.length; at++) {
    const next = strip.items[at];
    if (next.kind !== 'note') {
      continue;
    }

    // Including a next note this same plan is moving: transposing a run of four
    // would otherwise write `o5 c o4 o5 d o4 o5 e o4 o5 f`, where every restore
    // is undone by the octave immediately after it.
    const planned = survivors.get(at);
    const writesItsOwn =
      next.hasLeadingOctave ||
      (planned?.drum === null && octaveFor(planned.written) !== next.octave);
    return writesItsOwn ? null : exit;
  }

  return exit;
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

  const octave = octaveFor(note.written);
  const exitText = exit === null || exit === octave ? '' : ` ${spellOctave(exit) ?? ''}`;
  const tailEdit = spliceRange(
    source,
    { start: tail.span.start, end: item.unitSpan.end, line: tail.span.line },
    `^${length}${exitText}`,
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
  /** Notes being created in it, in tick order. */
  born: PlacedNote[];
  /** Where it starts, in ticks. */
  startTick: number;
}

/**
 * The rests between the notes, made to come to the ticks the plan asks for.
 *
 * Every change is taken from the rest **nearest the note before it**, so
 * anything written later in the gap keeps its distance from the note it was
 * written for: a `v200` two beats ahead of a note stays two beats ahead of it. A
 * shrink that exhausts one rest deletes it and carries on into the next; a gap
 * with no rest at all has one written in straight after the note before it.
 */
function realiseRegion(context: EditContext, gap: Region): Edit[] | null {
  const { source, targetAMKVersion } = context;
  const edits: Edit[] = [];

  // The tail is free: a channel may end wherever the music ends.
  if (gap.ticks < 0 && gap.born.length === 0) {
    return edits;
  }

  if (gap.born.length > 0) {
    return spawnInto(context, gap);
  }

  let left = gap.ticks;
  for (let at = 0; at < gap.rests.length; at++) {
    const rest = gap.rests[at];
    const last = at === gap.rests.length - 1;
    const want = last ? left : at === 0 ? Math.max(0, left - rested(gap.rests, 1)) : rest.ticks;
    if (want <= 0) {
      edits.push(...removeItem(source, rest));
      left -= 0;
      continue;
    }

    if (want !== rest.ticks) {
      const text = spellDuration(want, targetAMKVersion);
      if (text === null) {
        return null;
      }

      const edit = spliceRange(source, rest.unitSpan, `r${text}`);
      if (edit) {
        edits.push(edit);
      }
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
    return insertAt(strip.items[gap.after].unitSpan.end, ` ${run}`, 1);
  }

  const next = strip.items[gap.before] ?? strip.items[0];
  if (next) {
    return insertAt(next.unitSpan.start, `${run} `, 1);
  }

  const line = eol(source);
  if (strip.home.declared) {
    return insertAt(strip.home.at, `${line}${run}`, 1);
  }

  const gapAbove = strip.home.at === 0 ? '' : `${line}${line}`;
  const opening = channelOpening(strip.channel, context.songTargetProgram);
  return insertAt(strip.home.at, `${gapAbove}${opening}${line}${run}`, 1);
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
 * `null` where a length in the run has no spelling on this target.
 */
function spawnRun(
  context: EditContext,
  born: PlacedNote,
  before: number,
  after: number,
  running: number | null,
  introAt: number | null,
): string | null {
  const { targetAMKVersion } = context;
  const parts: string[] = [];
  let at = 0;
  let marked = introAt === null;

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

  const note = (): boolean => {
    const split = splitAt(born.ticks);
    if (split !== null) {
      const first = spellDuration(split - at, targetAMKVersion);
      const second = spellDuration(at + born.ticks - split, targetAMKVersion);
      const head = first === null ? null : noteText(born, first, null, targetAMKVersion, running);
      if (head === null || second === null) {
        return false;
      }

      parts.push(head, '/', `^${second}`);
      marked = true;
    } else {
      const whole = noteText(born, null, null, targetAMKVersion, running);
      if (whole === null) {
        return false;
      }

      parts.push(whole);
    }

    at += born.ticks;
    return true;
  };

  mark();
  if (!rest(before)) {
    return null;
  }

  mark();
  if (!note()) {
    return null;
  }

  mark();
  if (!rest(after)) {
    return null;
  }

  mark();
  return parts.join(' ');
}

/**
 * A note being created, written into the gap it lands in.
 *
 * The gap has to be a single rest with nothing else in it, or empty text at the
 * end of the channel, or a channel with nothing written on it at all. Anything
 * else — a command between two rests where the note would go — is refused rather
 * than guessed at, because splitting a run around a command means deciding which
 * side of the new note the command belongs on, and only the porter knows.
 *
 * A builder answering `null` is refused too, rather than passed on as no edits:
 * `planEdits` pushes what each region returns and goes on to the next, so a note
 * that quietly wrote nothing would leave the rest of the gesture committed.
 */
function spawnInto(context: EditContext, gap: Region): Edit[] | null {
  const { source, strip } = context;
  if (gap.born.length !== 1) {
    return null;
  }

  const born = gap.born[0];
  const empty = strip.items.length === 0;
  // A channel being written from nothing has just had its own `o4` put in front
  // of it, so a note in that octave has nothing to add (`channelOpening`).
  const opening = empty && !strip.home.declared;

  const before = born.startTick - gap.startTick;
  const end = born.startTick + born.ticks;
  // A channel with nothing on it runs out to the song's own length, so that its
  // first note does not become the shortest channel and cut every other one
  // short: the driver reloads all eight track pointers the moment one voice
  // reads its `$00` (`main.asm:L_0C01`, `Music.cpp:3209`). A note drawn past
  // that length pads by nothing rather than refusing — the channel is then the
  // long one, which is the ordinary shape `AMK0502` already reports.
  const after = empty
    ? Math.max(0, context.playableTicks - end)
    : gap.ticks < 0
      ? 0
      : gap.startTick + gap.ticks - end;
  if (before < 0 || after < 0) {
    return null;
  }

  // The tick the song loops back to, where this channel is being opened and the
  // run is long enough to reach it. `gap.startTick` is 0 for an empty channel —
  // it has one region and it begins at the top — so the run's own ticks and the
  // channel's are the same count.
  const total = before + born.ticks + after;
  const introAt =
    empty && context.introTicks !== null && context.introTicks >= 0 && context.introTicks <= total
      ? context.introTicks
      : null;

  const run = spawnRun(context, born, before, after, opening ? OPENING_OCTAVE : null, introAt);
  if (run === null) {
    return null;
  }

  // One rest to write over: the common case, and the only one that keeps every
  // command in the region exactly where it was.
  if (gap.rests.length === 1 && gap.between === 1) {
    const edit = spliceRange(source, gap.rests[0].unitSpan, run);
    return edit ? [edit] : null;
  }

  if (gap.rests.length === 0 && gap.between === 0) {
    const edit = writeInto(context, gap, run);
    return edit ? [edit] : null;
  }

  return null;
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

  // The octave the edited text leaves in force, carried down the channel so a
  // note only writes one where the one already standing is not the one it needs.
  // `null` is "not known": before the first note, and after anything between two
  // notes that moved the octave itself — which is what the comparison against the
  // previous note's own exit detects, since the compiler gave both of them.
  let running: number | null = null;
  let previous: StripItem | null = null;

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
    // since that `o` is about to be rewritten along with the note.
    if (running === null && !item.hasLeadingOctave) {
      running = item.octave;
    }

    const note = survivors.get(index);
    if (!note) {
      edits.push(...removeItem(source, item));
      // A note that is going still leaves its octave behind: it is written text
      // either side of the run being deleted that decides what follows.
      previous = item;
      running = null;
      continue;
    }

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

  for (const region of regionsOf(strip, survivors, born)) {
    const written = realiseRegion(context, region);
    if (written === null) {
      return null;
    }

    edits.push(...written);
  }

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

  regions.push(makeRegion(strip, after, strip.items.length, startTick, -1));

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
): Region {
  const rests: StripItem[] = [];
  let between = 0;
  for (let index = after + 1; index < before; index++) {
    between++;
    if (strip.items[index].kind === 'rest') {
      rests.push(strip.items[index]);
    }
  }

  return { after, before, rests, ticks, born: [], startTick, between };
}
