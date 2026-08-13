import { Component, computed, effect, inject, signal } from '@angular/core';

import { channelsBeginAt, hasDialectMarker, targetAt } from '@amk/tokens/dialect';
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

type Filter = Category | 'all';

const FILTER_KEY = 'solar-soundtrack.palette-filter';

/** Every value {@link Filter} can take, for reading one back out of storage. */
const FILTERS: readonly Filter[] = ['all', ...CATEGORIES.map((category) => category.id)];

/** The stored category, or the one the palette opens on when there is none. */
function readFilter(): Filter {
  const stored = localStorage.getItem(FILTER_KEY);
  return FILTERS.find((filter) => filter === stored) ?? 'notes';
}

/**
 * The command palette: every hex and letter command, one click from the caret.
 *
 * It sits above the editor rather than beside it because what it writes lands at
 * the caret, and it reads the dialect at the caret rather than the file's, so the
 * buttons answer for the place the text is actually going.
 *
 * Inserting is deliberately only half the job. The defaults are chosen to be
 * sane, not right, and the command inspector in the output pane picks the new
 * command up the moment it lands — which is why the first argument is left
 * selected, and why nothing here tries to grow controls of its own.
 */
@Component({
  selector: 'amk-command-palette',
  imports: [CommandIcon],
  templateUrl: './command-palette.html',
  host: { class: 'border-edge bg-raised flex shrink-0 flex-col gap-2 border-b px-3 py-2' },
})
export class CommandPalette {
  private readonly store = inject(EditorStore);

  protected readonly CATEGORIES = CATEGORIES;

  /**
   * One category rather than all 59 buttons: the whole catalogue is eight rows
   * tall, which is a third of the editor on a laptop, and "All" is one click
   * away for the times that is what you want.
   */
  protected readonly filter = signal<Filter>(readFilter());

  /**
   * The dialect where the caret is, off the undebounced scan, so editing the
   * `#amk` line re-reads the palette on the keystroke rather than a compile
   * later.
   *
   * The custom `equal` is what keeps that cheap: `targetAt` returns a fresh
   * object per scan and the scan is rebuilt on every keystroke, so without it
   * every character retyped the whole button list for a dialect that had not
   * moved.
   */
  protected readonly target = computed(() => targetAt(this.store.tokens(), this.store.caret()), {
    equal: (a, b) => a.program === b.program && a.amkVersion === b.amkVersion,
  });

  /** Whether the caret is above the first `#0`-`#7`, which two entries turn on. */
  private readonly place = computed<CaretPlace>(() => {
    const first = channelsBeginAt(this.store.tokens());
    return { beforeChannels: first === null || this.store.caret() <= first };
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
    () => !hasDialectMarker(this.store.tokens(), this.store.source(), this.store.caret()),
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
  protected readonly readout = computed(() => {
    const entry = this.hovered();
    if (!entry) {
      return null;
    }

    return {
      label: entry.label,
      // The reason a button is greyed out matters more than what it would have
      // done, so it replaces the blurb rather than following it.
      text: entry.availability.reason ?? entry.blurb,
      muted: entry.availability.state === 'ok',
    };
  });

  protected readonly entries = computed<ResolvedEntry[]>(() => {
    const target = this.target();
    const place = this.place();
    const filter = this.filter();

    return ENTRIES.filter((entry) => filter === 'all' || entry.category === filter).map((entry) =>
      resolveEntry(entry, target, place),
    );
  });

  constructor() {
    // Sanctioned effect: mirroring a view preference into localStorage.
    effect(() => localStorage.setItem(FILTER_KEY, this.filter()));
  }

  protected chipClass(selected: boolean): string {
    return `cursor-pointer rounded px-2 py-0.5 text-xs transition-colors ${
      selected ? 'bg-accent/20 text-accent font-semibold' : 'text-ink-muted hover:text-ink'
    }`;
  }

  /**
   * The editor's word-wrap toggle with a name beside the glyph.
   *
   * Same border, same radius, same transition, and the `ok` state's colours are
   * that button's off state — an icon control in this app looks like this one.
   * `inline-flex` and the horizontal padding are the only departures, and they
   * are what the label costs.
   *
   * `caution` keeps the button live: AddmusicK compiles those, and a control
   * that refused what the real tool accepts would be the compiler being
   * permissive in the other direction.
   */
  protected entryClass(entry: ResolvedEntry): string {
    const base =
      'border-edge inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40';
    if (entry.availability.state === 'blocked') {
      return `${base} text-ink-muted`;
    }

    return entry.availability.state === 'caution'
      ? `${base} text-warn border-warn/40 hover:border-warn`
      : `${base} text-ink-muted hover:text-ink hover:border-accent`;
  }

  protected insert(entry: ResolvedEntry): void {
    this.store.insert(entry.text, entry.select);
  }
}
