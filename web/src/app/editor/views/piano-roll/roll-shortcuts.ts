import { TICKS_PER_WHOLE } from '@amk/core/hardcoded-tables';
import type { Command } from '@amk/tokens';
import type { Edit } from '@amk/tokens/edits';
import type { Gesture } from './roll-edit';
import { eraseCommand } from './roll-command-move';

/**
 * Everything a keypress can reach, as plain callbacks.
 *
 * A bag rather than the component, so this file needs no Angular and `rolltest`
 * can drive the shortcuts the way it drives a gesture — the `Ctrl+B` bar
 * arithmetic and the precedence between a selected command and a selected note
 * are decisions with no other test.
 */
export interface ShortcutTarget {
  /** The transport, which `Space` drives. */
  playing(): boolean;
  previewing(): boolean;
  canCompile(): boolean;
  toggleTransport(): void;
  stopSound(): void;

  /** The document, and whether the compile the roll is drawing is of it. */
  source(): string;
  inSync(): boolean;
  caret(): number;

  /** The command the inspector is answering about, and how a splice is applied. */
  inspectedCommand(): Command | null;
  applyEdit(edit: Edit | null): void;

  /** Letting go, one level at a time. */
  dismiss(caret: number): void;
  stopInspecting(): void;
  clearEditChannel(): void;

  /** The undo history, which lives in the CodeMirror view. */
  history(command: 'undo' | 'redo'): void;

  /** The selection, and the one way every edit is made. */
  selection(): ReadonlySet<number>;
  clearSelection(): void;
  selectAll(): void;
  run(gesture: Gesture): void;

  /** What a gesture would land on. */
  editChannel(): number | null;
  hasStrip(): boolean;
  snapTicks(): number;
  beatsPerBar(): number;
  beatUnit(): number;
}

/**
 * The roll's shortcuts, while a channel is being edited.
 *
 * Ignored while the text or a modal has focus, so `Ctrl+A` in the source still
 * selects the source and a dialog keeps its own Escape. Everything
 * that edits goes through the same {@link Gesture} the pointer uses, so a
 * nudge and a drag commit the same way.
 *
 * A channel really picked, rather than the roll's `editing`: a key has no
 * pointer to name a channel with, so `Ctrl+A` under one merely hovered would
 * select notes in a channel the toolbar says is not being edited.
 *
 * Space needs no channel, being the transport rather than an edit, and nor do
 * the keys a selected command takes: a lane glyph names a command of the song.
 */
export function rollShortcut(event: KeyboardEvent, roll: ShortcutTarget): void {
  const target = event.target as HTMLElement | null;
  if (
    target?.closest('input, textarea, select, dialog, .cm-editor') !== null ||
    event.isComposing
  ) {
    return;
  }

  // Space is the transport: it starts the song from wherever the playhead
  // stands and stops it back at the beginning — and stops a note or a
  // selection being previewed, as the Stop button does, since a stop that left
  // one sounding would start the song over it. It takes the keypress outright,
  // since the browser would otherwise scroll the page with it or press
  // whichever button was last clicked — so it means the same thing wherever
  // the pointer has been. Bare, because `Ctrl+Space` toggles an IME and
  // `Alt+Space` opens the window menu; and only the first press of a held bar
  // acts, a song started and stopped thirty times a second being no use.
  if (event.key === ' ' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    if (event.repeat) {
      return;
    }

    if (roll.playing() || roll.previewing()) {
      roll.stopSound();
    } else if (roll.canCompile()) {
      // What the Play button's `disabled` says: with no driver loaded there is
      // nothing to play, and `toggle` would report an error about the song.
      roll.toggleTransport();
    }

    return;
  }

  // A selected command owns Delete, whichever route picked it — a glyph in the
  // lane, a chip on a bar, or a button in the note inspector — since all three
  // are the caret. No note is touched, however many are outlined: a chip or a
  // lane glyph lets go of them as it picks, and the splice keeps the rest where
  // they are. The key goes back to the notes the moment a click on a bar's body
  // moves the caret off the command — onto the note, which is a `Command` too,
  // and which `inspectedCommand` therefore does not answer.
  //
  // Ahead of the channel guard, because a lane glyph names a command of the
  // song rather than a note of a channel and picks none: "this holds all
  // eight, and a `t` belongs to none of them". It needs no strip either — the
  // splice is the command's own span, and no note moves.
  //
  // The key is taken whether or not the command can go, so a `"name=value"`
  // one does nothing rather than falling through and deleting the notes. And
  // only the first press of a held key acts: the caret lands where the command
  // was and `commandAt` is end-inclusive, so a repeat would take the
  // neighbouring command, which nobody selected.
  const inspected = roll.inspectedCommand();
  if (inspected !== null && (event.key === 'Delete' || event.key === 'Backspace')) {
    event.preventDefault();
    if (event.repeat || !roll.inSync()) {
      return;
    }

    // Keeps the notes, as a panel's own commit does: taking a command out
    // adds and removes none, so the selection still names the notes it named.
    roll.applyEdit(eraseCommand(roll.source(), inspected));
    return;
  }

  // Escape steps back out, one level per press: the command, then the
  // selection, then the channel itself. Ahead of the channel guard because a
  // lane glyph picks no channel and its ring still has to go; ahead of the
  // strip, and needing none — a channel the roll has refused is exactly the
  // one the porter wants to leave.
  if (event.key === 'Escape') {
    if (inspected !== null) {
      // Letting the command go is letting the inspector go: the ring stands
      // for that panel, and `inspectedCommand` reads the same `dismissed`.
      roll.dismiss(roll.caret());
    } else if (roll.selection().size > 0) {
      roll.clearSelection();
      // Letting the note go lets go of the question asked about it: the
      // inspector is answering from the caret a click on that bar moved, and
      // nothing else would retire it.
      roll.stopInspecting();
      roll.dismiss(roll.caret());
    } else if (roll.editChannel() !== null) {
      roll.clearEditChannel();
    }

    return;
  }

  if (roll.editChannel() === null) {
    return;
  }

  // Undo and redo, on the same history the two toolbars' buttons drive and the
  // MML editor's own keymap walks. Bound here because that keymap only fires
  // while the editor has focus, and the roll never gives it any. Ahead of the
  // strip and the selection, neither of which an undo needs.
  const control = event.ctrlKey || event.metaKey;
  const pressed = event.key.toLowerCase();
  if (control && (pressed === 'z' || pressed === 'y')) {
    event.preventDefault();
    roll.history(pressed === 'y' || event.shiftKey ? 'redo' : 'undo');
    return;
  }

  if (!roll.hasStrip()) {
    return;
  }

  const chosen = [...roll.selection()];
  const run = (gesture: Gesture): void => {
    event.preventDefault();
    roll.run(gesture);
  };

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    roll.selectAll();
    return;
  }

  if (chosen.length === 0) {
    return;
  }

  switch (event.key) {
    case 'Delete':
    case 'Backspace':
      run({ kind: 'delete', items: chosen });
      return;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const step = Math.max(1, roll.snapTicks()) * (event.key === 'ArrowRight' ? 1 : -1);
      run({ kind: 'move', items: chosen, deltaTicks: step, deltaKeys: 0, copy: false });
      return;
    }

    case 'ArrowUp':
    case 'ArrowDown': {
      const semitones = (event.shiftKey ? 12 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      run({ kind: 'move', items: chosen, deltaTicks: 0, deltaKeys: semitones, copy: false });
      return;
    }

    default:
      break;
  }

  const key = event.key.toLowerCase();
  if (event.altKey && key === 'q') {
    run({ kind: 'quantize', items: chosen, snap: Math.max(1, roll.snapTicks()) });
  } else if (event.altKey && key === 'l') {
    run({ kind: 'legato', items: chosen });
  } else if ((event.ctrlKey || event.metaKey) && key === 'j') {
    run({ kind: 'glue', items: chosen });
  } else if ((event.ctrlKey || event.metaKey) && key === 'b') {
    // The grid's own bar rather than the snap step's, or the copy lands a
    // different distance away every time Snap is changed.
    const beat = TICKS_PER_WHOLE / roll.beatUnit();
    const bar = Math.max(1, beat * Math.max(1, roll.beatsPerBar()));
    run({ kind: 'move', items: chosen, deltaTicks: bar, deltaKeys: 0, copy: true });
  }
}
