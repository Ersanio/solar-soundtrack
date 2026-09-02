import { Component, computed, effect, inject, signal } from '@angular/core';

import { channelsBeginAt, hasDialectMarker, songTarget } from '@amk/tokens/dialect';
import { Toggle } from '../../shared/toggle/toggle';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import {
  CATEGORIES,
  type CaretPlace,
  type Category,
  ENTRIES,
  type ResolvedEntry,
  resolveEntry,
} from './catalog';
import { CommandIcon } from './command-icon';
import {
  callEdits,
  callSelection,
  callVerdict,
  isCall,
  isWrap,
  wrapEdits,
  wrapSelection,
  wrapVerdict,
} from './loop-wrap';
import { readStored, writeStored } from '../../util/storage';

type Filter = Category | 'all';

const FILTER_KEY = 'solar-soundtrack.palette-filter';

/** Every value {@link Filter} can take, for reading one back out of storage. */
const FILTERS: readonly Filter[] = ['all', ...CATEGORIES.map((category) => category.id)];

/** The stored category, or the one the palette opens on when there is none. */
function readFilter(): Filter {
  const stored = readStored(FILTER_KEY);
  return FILTERS.find((filter) => filter === stored) ?? 'notes';
}

/**
 * A bordered button with a glyph beside the name: the `sm` height, radius and
 * transition of an `amk-toggle` in its off state, and the `ok` state's colours
 * are that toggle's. Not the component itself, because `caution` and a `caveat`
 * wear a colour of their own that a toggle has no state for. Bordered on
 * purpose, where the category segments above it are not: each of these acts on
 * the song, and the segments only choose which of them are shown.
 *
 * `caution` keeps the button live: AddmusicK compiles those, and a control that
 * refused what the real tool accepts would be the compiler being permissive in
 * the other direction. A `caveat` wears the same colour for the same reason —
 * it is worth reading first and it is not a refusal.
 */
export function entryClass(entry: ResolvedEntry): string {
  const base =
    'border-edge inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  if (entryBlocked(entry)) {
    return `${base} text-ink-muted`;
  }

  return entry.availability.state === 'caution' || entry.caveat !== undefined
    ? `${base} text-warn border-warn/40 hover:border-warn`
    : `${base} text-ink-muted hover:text-ink hover:border-control`;
}

/**
 * Whether the button is dead, from either of the two conditions that kill it.
 *
 * `availability` is AddmusicK's opinion of the command; `wrap` and `call` are
 * the palette's own — there is nothing selected for the brackets to go round,
 * the two levels are already spent, or no loop is written above the caret to
 * play again. All of them grey the button and none speaks for the others, so the
 * test is here rather than in `resolveEntry`.
 */
export function entryBlocked(entry: ResolvedEntry): boolean {
  if (entry.availability.state === 'blocked') {
    return true;
  }

  if (entry.wraps !== undefined && (entry.wrap === undefined || !isWrap(entry.wrap))) {
    return true;
  }

  return entry.calls !== undefined && (entry.call === undefined || !isCall(entry.call));
}

/**
 * The line under the strip: what a command is called, and what it does — or, for
 * a button that is dead, why.
 *
 * Shared with the note palette rather than written twice: the two strips differ
 * in where a click writes and in nothing else a reader can see.
 */
export function entryReadout(
  entry: ResolvedEntry | null,
): { label: string; text: string; muted: boolean } | null {
  if (!entry) {
    return null;
  }

  const refused =
    entry.wrap !== undefined && !isWrap(entry.wrap)
      ? entry.wrap.refused
      : entry.call !== undefined && !isCall(entry.call)
        ? entry.call.refused
        : null;
  // The reason a button is greyed out matters more than what it would have
  // done, so it replaces the blurb rather than following it. A caveat is the
  // other way round: the command still does what the blurb says.
  const said = entry.availability.reason ?? refused ?? entry.blurb;
  return {
    label: entry.label,
    text: entry.caveat ? `${said} ${entry.caveat}` : said,
    muted: entry.availability.state === 'ok' && entry.caveat === undefined && refused === null,
  };
}

/**
 * The command palette: every hex and letter command, one click from the caret.
 *
 * It sits above the editor rather than beside it because what it writes lands at
 * the caret. Three things decide what it offers there: the song's dialect, which
 * is the whole file's; whether the caret is above the first channel, which only
 * the two remote forms care about; and what the selection covers, which only the
 * two bracket forms do — they go round a run of music rather than landing at a
 * point, so a bare caret leaves them greyed. See `loop-wrap.ts`.
 *
 * Inserting is deliberately only half the job. The defaults are chosen to be
 * sane, not right, and the command inspector in the output pane picks the new
 * command up the moment it lands — which is why the first argument is left
 * selected, and why nothing here tries to grow controls of its own.
 */
@Component({
  selector: 'amk-command-palette',
  imports: [CommandIcon, Toggle],
  templateUrl: './command-palette.html',
  host: { class: 'border-edge bg-raised flex shrink-0 flex-col gap-2 border-b px-2 py-1.5' },
})
export class CommandPalette {
  private readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  protected readonly CATEGORIES = CATEGORIES;

  /**
   * One category rather than all 59 buttons: the whole catalogue is eight rows
   * tall, which is a third of the editor on a laptop, and "All" is one click
   * away for the times that is what you want.
   */
  protected readonly filter = signal<Filter>(readFilter());

  /**
   * The dialect the song compiles as, off the undebounced scan, so editing the
   * `#amk` line re-reads the palette on the keystroke rather than a compile
   * later.
   *
   * The whole file, not the text above the caret: `preprocess.ts` resolves the
   * markers before the parser runs, so a `#amk 2` on the last line governs a
   * command written on the first, and a palette that answered for the caret
   * would offer `#amk 4`'s forms to a song that is not one.
   *
   * The custom `equal` is what keeps that cheap: `songTarget` returns a fresh
   * object per scan and the scan is rebuilt on every keystroke, so without it
   * every character retyped the whole button list for a dialect that had not
   * moved.
   */
  protected readonly target = computed(() => songTarget(this.store.tokens()), {
    equal: (a, b) => a.program === b.program && a.amkVersion === b.amkVersion,
  });

  /**
   * What the two bracket forms would put round the text that is selected now.
   *
   * The document's own selection is what a porter picks notes out with here, and
   * a bare caret covers none — so the buttons are dead until there is a run,
   * which is the same rule the roll's palette follows.
   */
  private readonly wrap = computed(() => {
    const source = this.store.source();
    const index = this.store.tokens();
    const reading = this.store.loops();
    const run = this.store.selection();
    const ask = (want: 'loop' | 'subloop') =>
      wrapVerdict({ source, index, reading, run: run.end > run.start ? run : null, want });

    return { loop: ask('loop'), subloop: ask('subloop') };
  });

  /** What a call written at the caret would play, or why there is nothing to. */
  private readonly call = computed(() =>
    callVerdict({
      source: this.store.source(),
      index: this.store.tokens(),
      reading: this.store.loops(),
      caret: this.store.caret(),
    }),
  );

  /** Whether the caret is above the first `#0`-`#7`, which two entries turn on. */
  private readonly place = computed<CaretPlace>(() => {
    const first = channelsBeginAt(this.store.tokens());
    return {
      beforeChannels: first === null || this.store.caret() <= first,
      wrap: this.wrap(),
      call: this.call(),
    };
  });

  /** `#amk 4`, `#am4`, `#amm` — what the gating below is answering for. */
  protected readonly dialect = computed(() => {
    const target = this.target();
    if (target.program === 1) {
      return '#am4';
    }

    return target.program === 2 ? '#amm' : `#amk ${target.amkVersion}`;
  });

  /**
   * Whether that dialect was declared or assumed. A song with no marker at all
   * is an error in AddmusicK (AMK0002) but scans as `#amk 4`, so saying which
   * of the two this is keeps the chip from looking like a fact.
   */
  protected readonly assumed = computed(
    () => !hasDialectMarker(this.store.tokens(), this.store.source()),
  );

  /**
   * The entry the pointer or keyboard focus is on, which the line under the
   * strip reads out.
   *
   * The button says what a command is called; the line says what it does. A
   * native `title` could carry the sentence instead, but it takes about a second
   * to appear, and a palette read by waiting is a palette nobody reads.
   */
  protected readonly hovered = signal<ResolvedEntry | null>(null);

  /** What the line under the strip says right now. */
  protected readonly readout = computed(() => entryReadout(this.hovered()));

  /**
   * The buttons, with their class resolved.
   *
   * A view model rather than `entryClass(entry)` in the template: that runs once
   * per button on every change-detection pass, and the palette draws the whole
   * catalogue when its filter is `all`.
   */
  protected readonly entries = computed(() => {
    const target = this.target();
    const place = this.place();
    const filter = this.filter();

    return ENTRIES.filter((entry) => filter === 'all' || entry.category === filter).map((entry) => {
      const resolved = resolveEntry(entry, target, place);
      return { ...resolved, class: entryClass(resolved), disabled: entryBlocked(resolved) };
    });
  });

  /** The category chips, likewise — `All` is one of them rather than a special case. */
  protected readonly chips = computed<{ id: Filter; label: string; selected: boolean }[]>(() => {
    const filter = this.filter();
    return [
      { id: 'all', label: 'All', selected: filter === 'all' },
      ...CATEGORIES.map((category) => ({
        id: category.id,
        label: category.label,
        selected: filter === category.id,
      })),
    ];
  });

  constructor() {
    // Sanctioned effect: mirroring a view preference into localStorage.
    effect(() => writeStored(FILTER_KEY, this.filter()));
  }

  /**
   * A bracket form goes round the selection as one splice at each end, so
   * everything between them survives as written and the pair is one undo step;
   * everything else lands at the caret.
   *
   * A call lands at the caret too, but it is not a snippet: the label it names
   * is read off the song, so it goes through `applyAll` at a known offset rather
   * than through `insert`, which lands wherever the view says the caret is.
   */
  protected insert(entry: ResolvedEntry): void {
    if (entry.wrap !== undefined && isWrap(entry.wrap)) {
      this.requests.applyAll(wrapEdits(entry.wrap), wrapSelection(entry.wrap));
      return;
    }

    if (entry.call !== undefined && isCall(entry.call)) {
      const caret = this.store.caret();
      this.requests.applyAll(callEdits(entry.call, caret), callSelection(entry.call, caret));
      return;
    }

    this.requests.insert(entry.text, entry.select);
  }
}
