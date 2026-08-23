import { Component, computed, inject, input } from '@angular/core';

import type { Span } from '@amk/core/types';
import type { WalkNote } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import { type CommandGlyph, CommandIcon } from '../../../editor/command-palette/command-icon';
import { glyphOf } from '../../../editor/command-palette/glyph-of';
import { definedAt, notePreceding } from '../../../state/commands-in-force';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { ParamTable } from '../param-table/param-table';

/** One command acting on the note, drawn as the palette draws it. */
interface Acting {
  key: string;
  icon: CommandGlyph;
  label: string;
  blurb: string;
  span: Span;
  /** This note puts it in force, where the rest of a run inherits it. */
  defining: boolean;
}

/** One headed group of those: what the note sets, and what it plays under. */
interface Group {
  readonly key: string;
  readonly title: string;
  /** Shown in place of the chips, since which of the two is empty says something. */
  readonly nothing: string;
  /** The pass readout, carried by the first group so it sits at the top. */
  readonly pass: string | null;
  readonly chips: readonly Acting[];
}

/**
 * A note, and the commands acting on it.
 *
 * The half of the roll a bar has no room for. A bar shows as many glyphs as fit
 * between its name and its right edge, which on a 32nd note is none; this is
 * where the whole list lives, with names rather than pictures and a way through
 * to each command.
 *
 * **It describes one pass, and says which.** A note written once inside a loop
 * is played many times and the commands in force can differ between them, so
 * "the commands acting on this note" has no single answer for a piece of text.
 * A bar in the roll *is* one pass, which is why clicking one sets
 * `EditorStore.inspecting`; reached from the caret instead, where there is no
 * pass to point at, it describes the first. The pass is read only while it is
 * still an occurrence of the note the caret is on, so moving the caret is enough
 * to retire it and nothing has to clear it.
 *
 * Empty when there is no walk to read. The list is a fact about compiled bytes,
 * and offering a guess in its place would be offering something that looks the
 * same and is not.
 */
@Component({
  selector: 'amk-note-command',
  imports: [CommandIcon, ParamTable],
  templateUrl: './note-command.html',
  host: { class: 'contents' },
})
export class NoteCommand {
  private readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  readonly command = input.required<Command>();

  /** Every pass of this written note, in the order the song plays them. */
  private readonly passes = computed<readonly WalkNote[]>(() => {
    const song = this.store.timeline();
    if (!song || this.store.compiledText() !== this.store.source()) {
      return [];
    }

    const start = this.command().span.start;
    const addresses = new Set<number>();
    for (const entry of this.store.notesByAddress().values()) {
      if (entry.span.start === start) {
        addresses.add(entry.address);
      }
    }

    return addresses.size === 0 ? [] : song.notes.filter((note) => addresses.has(note.address));
  });

  /** The pass being described: the one the roll asked about, else the first. */
  private readonly pass = computed<WalkNote | null>(() => {
    const passes = this.passes();
    if (passes.length === 0) {
      return null;
    }

    const asked = this.requests.inspecting();
    const found =
      asked === null
        ? undefined
        : passes.find((note) => note.address === asked.address && note.tick === asked.tick);

    return found ?? passes[0];
  });

  private readonly acting = computed<readonly Acting[]>(() => {
    const note = this.pass();
    if (note === null) {
      return [];
    }

    // Which of them this note puts in force, against the note before it on its
    // channel. The roll's bars get that neighbour from the loop that draws them;
    // reached from the caret there is no such loop, so the pass is looked up in
    // the timeline it came out of.
    const before = notePreceding(this.store.timeline()?.notes ?? [], note);
    const inForce = this.store.commandsInForce();
    const defining = definedAt(inForce(note), before === null ? [] : inForce(before));

    return inForce(note).flatMap((command) => {
      const entry = glyphOf(command);
      return entry === null
        ? []
        : [
            {
              key: `${command.span.start}:${command.span.end}`,
              icon: entry.icon,
              label: entry.label,
              blurb: entry.blurb,
              span: command.span,
              defining: defining.has(command),
            },
          ];
    });
  });

  /** Said only when it matters: a note played once needs no explaining. */
  private readonly whichPass = computed(() => {
    const passes = this.passes();
    const note = this.pass();
    if (note === null || passes.length < 2) {
      return null;
    }

    return `plays ${passes.length} times — showing pass ${passes.indexOf(note) + 1}, at tick ${note.tick}`;
  });

  /**
   * The chips under two headings: the commands this note puts in force, and the
   * ones already in force when it plays.
   *
   * Both headings stand even when one of them has nothing under it, because
   * which of the two a command is under is the answer being given — a group
   * that vanished would leave the remaining heading to be read twice over.
   */
  protected readonly groups = computed<readonly Group[]>(() => {
    const acting = this.acting();
    const pass = this.whichPass();
    if (acting.length === 0) {
      // Nothing to tell apart, and two empty headings say less than one sentence.
      return [
        {
          key: 'acting',
          title: 'Commands acting on this note',
          nothing: 'Nothing but the note itself.',
          pass,
          chips: [],
        },
      ];
    }

    return [
      {
        key: 'defined',
        title: 'Commands defined by this note',
        nothing: 'Nothing starts here.',
        pass,
        chips: acting.filter((each) => each.defining),
      },
      {
        key: 'acting',
        title: 'Commands acting on this note',
        nothing: 'Nothing carries in from an earlier note.',
        pass: null,
        chips: acting.filter((each) => !each.defining),
      },
    ];
  });

  /** Why the list is empty, when it is empty for a reason worth stating. */
  protected readonly unavailable = computed(() =>
    this.pass() === null
      ? 'The commands acting on a note are read off the compiled song, so they appear once it compiles.'
      : null,
  );

  /** Jumping to a command is a jump: the source comes forward and selects it. */
  protected reveal(acting: Acting): void {
    this.requests.reveal.set({ span: { ...acting.span }, show: true });
  }
}
