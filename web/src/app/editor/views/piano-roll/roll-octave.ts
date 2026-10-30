import type { Span } from '@amk/core/types';
import type { TokenIndex } from '@amk/tokens';

/**
 * The octave in force anywhere in the text, read the way the parser reads it.
 *
 * `octave` is one variable, starts at 4 (`parser.ts:193`) and is never reset by
 * a `#N`, so it runs through the whole document in source order: an `o` sets
 * it, `<` and `>` move it, and a note reads it. A loop's body is parsed once
 * where it is written, so text order is the whole of it.
 *
 * Where the text cannot say — a `"name=value"` replacement, which may hide any
 * of the three, or an `#if` the scanner does not evaluate — the answer is `null`,
 * and an `o` written after a replacement makes it known again.
 */
export interface OctaveModel {
  /** The octave in force at `offset`, every event starting before it applied. */
  at(offset: number): number | null;
  /** `octave` carried over the events in `[from, to)`, leaving out any inside `skip`. */
  carry(octave: number | null, from: number, to: number, skip?: readonly Span[]): number | null;
  /**
   * What the text does with the octave next, from `offset` on.
   *
   * `'read'` where a note or a `<`/`>` reads it before anything sets it, `'set'`
   * where an `o` comes first, `'end'` where nothing follows. Only `'read'` needs
   * an octave put back; an unknown counts as one, so the answer errs towards a
   * restore.
   */
  next(offset: number, skip?: readonly Span[]): 'read' | 'set' | 'end';
  /** {@link next} bounded to `[from, to)`: `null` where nothing in it touches the octave. */
  first(from: number, to: number, skip?: readonly Span[]): 'read' | 'set' | null;
  /** Where the event {@link next} answers about stands, or `null` where nothing follows. */
  nextAt(offset: number): number | null;
  /** Whether anything in `[from, to)`, outside `skip`, sets or moves the octave. */
  moves(from: number, to: number, skip?: readonly Span[]): boolean;
  /**
   * The offsets of the `<` and `>` in `[from, to)`, or `null` where anything else
   * there touches the octave — an `o`, a note, or text that cannot be read.
   */
  shiftsIn(from: number, to: number): number[] | null;
}

interface OctaveEvent {
  at: number;
  kind: 'set' | 'shift' | 'read' | 'unknown';
  /** The octave for a `set`, the step for a `shift`. */
  value: number;
}

/** `parser.ts:193`. */
const START_OCTAVE = 4;

const CONDITIONAL = /^#(?:if|ifdef|ifndef|elseif|else|endif)\b/;

function inside(at: number, skip: readonly Span[]): boolean {
  return skip.some((span) => at >= span.start && at < span.end);
}

function apply(octave: number | null, event: OctaveEvent): number | null {
  switch (event.kind) {
    case 'set':
      return event.value;
    case 'shift':
      return octave === null ? null : octave + event.value;
    case 'unknown':
      return null;
    case 'read':
      return octave;
  }
}

/** A model that knows nothing, for a document the text cannot be trusted to describe. */
export const BLIND_OCTAVES: OctaveModel = {
  at: () => null,
  carry: () => null,
  next: () => 'read',
  first: () => 'read',
  nextAt: () => null,
  moves: () => true,
  shiftsIn: () => null,
};

export function octaveModel(source: string, scanned: TokenIndex): OctaveModel {
  const events: OctaveEvent[] = [];
  for (const token of scanned.tokens) {
    const text = source.slice(token.start, token.end);
    if (token.kind === 'directive' && CONDITIONAL.test(text)) {
      return BLIND_OCTAVES;
    }

    if (token.kind === 'octaveShift') {
      events.push({ at: token.start, kind: 'shift', value: text === '>' ? 1 : -1 });
    } else if (token.kind === 'note' || token.kind === 'hexNote') {
      events.push({ at: token.start, kind: 'read', value: 0 });
    } else if (token.kind === 'replacement') {
      events.push({ at: token.start, kind: 'unknown', value: 0 });
    }
  }

  for (const command of scanned.commands) {
    if (command.kind.toLowerCase() !== 'o') {
      continue;
    }

    const value = command.args[0]?.value;
    const known = value !== undefined && command.replacement === undefined;
    events.push({ at: command.span.start, kind: known ? 'set' : 'unknown', value: value ?? 0 });
  }

  events.sort((a, b) => a.at - b.at);

  /** `after[i]` is the octave once the first `i` events have run. */
  const after: (number | null)[] = [START_OCTAVE];
  for (const event of events) {
    after.push(apply(after[after.length - 1], event));
  }

  /** How many events start before `offset`. */
  const before = (offset: number): number => {
    let low = 0;
    let high = events.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (events[middle].at < offset) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    return low;
  };

  const first = (from: number, to: number, skip: readonly Span[]): 'read' | 'set' | null => {
    for (let index = before(from); index < events.length && events[index].at < to; index++) {
      const event = events[index];
      if (!inside(event.at, skip)) {
        return event.kind === 'set' ? 'set' : 'read';
      }
    }

    return null;
  };

  return {
    at: (offset) => after[before(offset)],
    carry: (octave, from, to, skip = []) => {
      let held = octave;
      for (let index = before(from); index < events.length && events[index].at < to; index++) {
        if (!inside(events[index].at, skip)) {
          held = apply(held, events[index]);
        }
      }

      return held;
    },
    next: (offset, skip = []) => first(offset, Number.POSITIVE_INFINITY, skip) ?? 'end',
    first: (from, to, skip = []) => first(from, to, skip),
    nextAt: (offset) => events[before(offset)]?.at ?? null,
    moves: (from, to, skip = []) => {
      for (let index = before(from); index < events.length && events[index].at < to; index++) {
        const event = events[index];
        if (event.kind !== 'read' && !inside(event.at, skip)) {
          return true;
        }
      }

      return false;
    },
    shiftsIn: (from, to) => {
      const found: number[] = [];
      for (let index = before(from); index < events.length && events[index].at < to; index++) {
        if (events[index].kind !== 'shift') {
          return null;
        }

        found.push(events[index].at);
      }

      return found;
    },
  };
}
