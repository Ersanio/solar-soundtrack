import { Component, computed, inject, input } from '@angular/core';

import type { Span } from '@amk/core/types';
import type { WalkNote } from '@amk/spc/song-walk';
import type { Command } from '@amk/tokens';
import { type CommandGlyph, CommandIcon } from '../../../editor/command-palette/command-icon';
import { glyphOf } from '../../../editor/command-palette/glyph-of';
import { EditorStore } from '../../../state/editor-store';
import { ParamTable } from '../param-table/param-table';

/** One command acting on the note, drawn as the palette draws it. */
interface Acting {
  key: string;
  icon: CommandGlyph;
  label: string;
  blurb: string;
  span: Span;
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

    const asked = this.store.inspecting();
    const found =
      asked === null
        ? undefined
        : passes.find((note) => note.address === asked.address && note.tick === asked.tick);

    return found ?? passes[0];
  });

  protected readonly acting = computed<readonly Acting[]>(() => {
    const note = this.pass();
    if (note === null) {
      return [];
    }

    return this.store
      .commandsInForce()(note)
      .flatMap((command) => {
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
              },
            ];
      });
  });

  /** Said only when it matters: a note played once needs no explaining. */
  protected readonly whichPass = computed(() => {
    const passes = this.passes();
    const note = this.pass();
    if (note === null || passes.length < 2) {
      return null;
    }

    return `plays ${passes.length} times — showing pass ${passes.indexOf(note) + 1}, at tick ${note.tick}`;
  });

  /** Why the list is empty, when it is empty for a reason worth stating. */
  protected readonly unavailable = computed(() =>
    this.pass() === null
      ? 'The commands acting on a note are read off the compiled song, so they appear once it compiles.'
      : null,
  );

  /** Jumping to a command is a jump: the source comes forward and selects it. */
  protected reveal(acting: Acting): void {
    this.store.reveal.set({ span: { ...acting.span }, show: true });
  }
}
