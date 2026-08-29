import { NOTE_MAX, NOTE_MIN } from '@amk/core/hardcoded-tables';
import type { Command } from '@amk/tokens';
import type { Edit } from '@amk/tokens/edits';
import type { ChannelTail, Strip } from './roll-strip';

/**
 * What a gesture on the roll does to a channel: where every note ends up, which
 * ones a push moved, and where two would sound at once.
 *
 * Arithmetic over ticks, and what the roll draws while the pointer is still
 * down. It decides everything about the **music** — which notes there are, on
 * which tick, at which pitch. Turning an accepted plan into splices is
 * `roll-write.ts`, which decides none of that and everything about the
 * spelling; the two are apart because that is what makes either testable.
 *
 * Nothing here knows about Angular, the DOM or pixels, so `rolltest` drives it
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
   * `padChannels`), so it is the line the edit is measured against rather
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
   * array rather than two arrays. What `padChannels` writes to.
   */
  channels: readonly ChannelTail[];
  /**
   * The `'note-state'` commands the walk had in force at a note, by the address
   * of its head — `StripItem.address`, which is how the walk names a note.
   * `null` for a note the pass never reached, where nothing can be said.
   *
   * What `reachesSomething` reads, and the reason no slot table is
   * restated here: the walk has already resolved which command occupies which
   * slot, through one run of bytes however many times the text plays it.
   *
   * Compared by **identity** against `Strip.commands`, so both must come from
   * one scan of one text. Two scans hold the same commands as different objects,
   * every membership test is then false, and the rule silently keeps everything.
   */
  inForce: (address: number) => readonly Command[] | null;
}

export const REFUSE_RANGE = 'the driver cannot play a note that high or low';
export const REFUSE_ROOM = 'there is no room to push the notes out of the way';
export const REFUSE_SPELL = 'that length cannot be written on this AddmusicK target';
export const REFUSE_CROWDED = 'there is something written where that note would go';
export const REFUSE_RAMP = 'that note is too short to keep the command written inside it';
export const REFUSE_INSIDE = 'there is a command written inside that note';
export const REFUSE_CLASH = 'two notes would sound at once, which MML cannot say';
export const REFUSE_BEND_RIDER =
  'a `$DD` pitch slide is written after that note, and it reads the note in front of it';

/**
 * Why a plan cannot be written out, in the words the roll shows.
 *
 * {@link planGesture} refuses in the plan itself, where the roll can draw the
 * refusal as it happens; `planEdits` has no plan to put one in, and a
 * gesture that fails there is undone with nothing on screen to say why. So it
 * answers this instead — the shape `Strip | StripRefusal` already has, for the
 * same reason.
 */
export interface EditRefusal {
  refused: string;
}

export function isEdits(outcome: Edit[] | EditRefusal): outcome is Edit[] {
  return (outcome as EditRefusal).refused === undefined;
}

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
 * `from`**, so it starts where the note started and `rewriteNote` shortens
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
