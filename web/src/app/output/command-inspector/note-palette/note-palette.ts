import { Component, computed, effect, inject, input, signal } from '@angular/core';

import type { Command } from '@amk/tokens';
import { channelsBeginAt, songTarget } from '@amk/tokens/dialect';
import { insertAt } from '@amk/tokens/edits';
import {
  CATEGORIES,
  type CaretPlace,
  type Category,
  ENTRIES,
  type ResolvedEntry,
  resolveEntry,
} from '../../../editor/command-palette/catalog';
import {
  chipClass,
  entryBlocked,
  entryClass,
  entryReadout,
} from '../../../editor/command-palette/command-palette';
import { CommandIcon } from '../../../editor/command-palette/command-icon';
import {
  callEdits,
  callSelection,
  callVerdict,
  isCall,
  isWrap,
  wrapEdits,
  wrapSelection,
  wrapVerdict,
} from '../../../editor/command-palette/loop-wrap';
import { unitStartBefore } from '../../../editor/views/piano-roll/roll-strip';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { readStored, writeStored } from '../../../util/storage';

const OPEN_KEY = 'solar-soundtrack.note-palette';

const FILTER_KEY = 'solar-soundtrack.note-palette-filter';

/** The stored category, or the one the palette opens on when there is none. */
function readFilter(): Category {
  const stored = readStored(FILTER_KEY);
  return CATEGORIES.find((category) => category.id === stored)?.id ?? 'volume';
}

/**
 * What the note this palette writes for already carries, computed by
 * `NoteCommand` from the pass it is describing.
 */
export interface NotePaletteModel {
  /** `ResolvedEntry.key` of every command the pass defines itself. */
  definedKeys: ReadonlySet<string>;
  /**
   * Whether the pass plays a pitch slide. Hides the `$DD` button by the walk's
   * own reading rather than by key, because a legacy `&` slide's emitted `$DD`
   * maps back to a note letter no catalogue entry names.
   */
  hasBend: boolean;
}

/**
 * A `$F4` or `$FA` written on the note hides nothing: their sub-commands are
 * nine switches through one byte, so a second one is a different effect rather
 * than a duplicate — the walk files them all in one slot for the same reason.
 */
const MANY_EFFECTS = new Set([0xf4, 0xfa]);

type Button = ResolvedEntry & { class: string; disabled: boolean; after: boolean };

/**
 * The command palette, aimed at a note instead of the caret.
 *
 * The catalogue and the chips are the source view's palette's; what differs is
 * where a click writes. Text lands in front of the note's unit — before its own
 * leading `o` and drum `@` — through `applyAll`, so the roll never loses its
 * tab and the insert is one undo step; `$DD` alone goes *after* the note, whose
 * read-ahead is what arms it. Buttons for commands the note already defines are
 * hidden rather than disabled: those are the chips above, and a second copy in
 * front of the same note is the duplicate this palette exists to refuse.
 *
 * The two bracket forms are the exception to all of that: they go round the run
 * the roll's selection covers rather than landing beside one note, and with
 * nothing selected they are greyed. See `loop-wrap.ts`.
 *
 * No `All` chip. One category is a row or two; the whole catalogue would be
 * most of the pane.
 */
@Component({
  selector: 'amk-note-palette',
  imports: [CommandIcon],
  templateUrl: './note-palette.html',
  host: { class: 'contents' },
})
export class NotePalette {
  private readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  readonly note = input.required<Command>();

  readonly model = input.required<NotePaletteModel>();

  /** Closed by default: the inspector's chips are the more asked-for half. */
  protected readonly open = signal(readStored(OPEN_KEY) === 'open');

  protected readonly filter = signal<Category>(readFilter());

  /** The dialect the song compiles as, with the palette's own cheap `equal`. */
  private readonly target = computed(() => songTarget(this.store.tokens()), {
    equal: (a, b) => a.program === b.program && a.amkVersion === b.amkVersion,
  });

  /**
   * What the two bracket forms would put round the notes the porter has picked
   * out.
   *
   * The roll's own selection where there is one — it is the run of text a whole
   * group of bars covers, which the document's caret cannot say — and the
   * document's selection otherwise, which is what this panel answers to when it
   * is open beside the MML rather than beside the roll.
   */
  private readonly wrap = computed(() => {
    const source = this.store.source();
    const index = this.store.tokens();
    const reading = this.store.loops();
    const picked = this.requests.selectedRun() ?? this.store.selection();
    const run = picked.end > picked.start ? picked : null;
    const ask = (want: 'loop' | 'subloop') => wrapVerdict({ source, index, reading, run, want });

    return { loop: ask('loop'), subloop: ask('subloop') };
  });

  /**
   * What a call written here would play.
   *
   * Asked about the note's own start rather than the document's caret: this
   * palette writes in front of the note it is aimed at, and which loops are
   * declared above that point is what decides the answer.
   */
  private readonly call = computed(() =>
    callVerdict({
      source: this.store.source(),
      index: this.store.tokens(),
      reading: this.store.loops(),
      caret: this.note().span.start,
    }),
  );

  /** Whether the note sits above the first `#0`-`#7`, which two entries turn on. */
  private readonly place = computed<CaretPlace>(() => {
    const first = channelsBeginAt(this.store.tokens());
    return {
      beforeChannels: first === null || this.note().span.start <= first,
      wrap: this.wrap(),
      call: this.call(),
    };
  });

  protected readonly hovered = signal<ResolvedEntry | null>(null);

  /** What the line under the buttons says right now — the palette's readout. */
  protected readonly readout = computed(() => entryReadout(this.hovered()));

  protected readonly chips = computed(() => {
    const filter = this.filter();
    return CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      class: chipClass(filter === category.id),
    }));
  });

  /** The buttons, minus what would duplicate the note's own commands. */
  protected readonly buttons = computed<readonly Button[]>(() => {
    const target = this.target();
    const place = this.place();
    const filter = this.filter();
    const model = this.model();

    return ENTRIES.filter((entry) => entry.category === filter).flatMap((entry) => {
      const resolved = resolveEntry(entry, target, place);
      const hidden =
        resolved.vcmd === 0xdd
          ? model.hasBend
          : !(resolved.vcmd !== undefined && MANY_EFFECTS.has(resolved.vcmd)) &&
            model.definedKeys.has(resolved.key);

      return hidden
        ? []
        : [
            {
              ...resolved,
              class: entryClass(resolved),
              disabled: entryBlocked(resolved),
              after: resolved.vcmd === 0xdd,
            },
          ];
    });
  });

  constructor() {
    // Sanctioned effects: mirroring view preferences into localStorage.
    effect(() => writeStored(OPEN_KEY, this.open() ? 'open' : 'closed'));
    effect(() => writeStored(FILTER_KEY, this.filter()));
  }

  /**
   * Writes the command and leaves its first argument selected, in the one
   * transaction — the caret is what retargets the inspector onto it, so the
   * value can be typed or slid at once, as the source palette leaves it.
   */
  protected insert(button: Button): void {
    if (button.wrap !== undefined && isWrap(button.wrap)) {
      this.requests.applyAll(wrapEdits(button.wrap), wrapSelection(button.wrap));
      return;
    }

    const source = this.store.source();
    const note = this.note();
    const { start: at, line } = button.after
      ? { start: note.span.end, line: note.span.line }
      : unitStartBefore(source, this.store.tokens().commands, note);

    // A call carries its own padding, having been asked about this very offset.
    if (button.call !== undefined && isCall(button.call)) {
      this.requests.applyAll(callEdits(button.call, at), callSelection(button.call, at));
      return;
    }

    // MML is whitespace-separated, so pad where the neighbouring character is
    // not — the same rule as the caret palette's.
    const before = at > 0 && !/\s/.test(source[at - 1]) ? ' ' : '';
    const after = at < source.length && !/\s/.test(source[at]) ? ' ' : '';
    const edit = insertAt(at, `${before}${button.text}${after}`, line);
    if (!edit) {
      return;
    }

    const base = at + before.length;
    this.requests.applyAll([edit], {
      anchor: base + (button.select?.start ?? button.text.length),
      head: base + (button.select?.end ?? button.text.length),
    });
  }
}
