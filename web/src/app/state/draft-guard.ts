/**
 * The saved draft, and holding it back when the page froze on it, so a song that hangs the editor cannot lock its porter out.
 *
 * Every parse of the document runs on the main thread, so a song that hangs one
 * hangs the tab, and the saved draft would hang every reload after it. A mark is
 * stored before anything parses a text and cleared once the page has caught up
 * with it; a frozen page never clears it, so the next load finds the mark, opens
 * the example song and keeps the draft aside for the porter to decide about.
 */

import { readStored, removeStored, writeStored } from '../util/storage';

const DRAFT_KEY = 'solar-soundtrack.draft';
const UNSETTLED_KEY = 'solar-soundtrack.draft-unsettled';
const HELD_KEY = 'solar-soundtrack.draft-held';

/** How long the page must stay free after a compile lands before its text counts as safe. */
const SETTLE_MS = 1000;

/** Whether the mark is meant to be on disk. */
let marked = false;
/** Bumped by every mark, so a settle timer set for an older text does nothing. */
let generation = 0;
/** Parses begun and not finished. */
let depth = 0;

export interface OpenedDraft {
  /** The draft to open, or `null` for the example song. */
  text: string | null;
  /** A draft held back because the page froze on it, until the porter opens or discards it. */
  held: string | null;
}

/** Reads the draft at startup, holding it back if the last page froze on it. */
export function openDraft(): OpenedDraft {
  const draft = readStored(DRAFT_KEY);
  const froze = readStored(UNSETTLED_KEY) !== null;

  // A page that gets to `pagehide` is not frozen. The depth test keeps the mark
  // when the browser stopped a parse and left the page running.
  window.addEventListener('pagehide', () => {
    if (depth === 0) {
      removeStored(UNSETTLED_KEY);
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && marked) {
      writeStored(UNSETTLED_KEY, '1');
    }
  });

  if (froze && draft !== null) {
    writeStored(HELD_KEY, draft);
    mark();
    return { text: null, held: draft };
  }

  mark();
  return { text: draft, held: readStored(HELD_KEY) };
}

/** Saves the document, marked as not yet parsed. Called before anything parses it. */
export function keepDraft(text: string): void {
  writeStored(DRAFT_KEY, text);
  mark();
}

/** Clears the mark once the page has stayed free for {@link SETTLE_MS}, unless the text changes first. */
export function settleDraft(): void {
  const at = generation;
  setTimeout(() => {
    if (at === generation) {
      marked = false;
      removeStored(UNSETTLED_KEY);
    }
  }, SETTLE_MS);
}

/**
 * Runs a parse of the document, counted for `pagehide`.
 *
 * No `finally`: a parse the browser stopped, or one that threw, leaves the count
 * up, and a page in that state is not one to vouch for.
 */
export function parsing<T>(work: () => T): T {
  depth++;
  const value = work();
  depth--;
  return value;
}

/** Forgets the held-back draft. */
export function dropHeld(): void {
  removeStored(HELD_KEY);
}

function mark(): void {
  generation++;
  if (!marked) {
    marked = true;
    writeStored(UNSETTLED_KEY, '1');
  }
}
