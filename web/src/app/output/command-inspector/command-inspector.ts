import { Component, computed, inject } from '@angular/core';

import { EditorStore } from '../../state/editor-store';
import { EchoInspector } from './echo-inspector/echo-inspector';
import { FirDesigner } from './fir-designer/fir-designer';
import { GenericCommand } from './generic-command/generic-command';
import { LetterCommand } from './letter-command/letter-command';

/**
 * Which view a hex command gets.
 *
 * A lookup rather than a chain of conditions, so adding `$ED`'s ADSR editor is
 * an entry here and a component, not a change to the dispatcher.
 */
const VIEWS: Readonly<Record<number, string>> = {
  0xef: 'echo',
  0xf0: 'echo',
  0xf1: 'echo',
  0xf2: 'echo',
  0xf5: 'fir',
};

/** Letter commands worth spelling out; the rest fall through to the generic view. */
const LETTER_VIEWS = new Set(['t', 'v', 'w', 'y', 'o', 'l', 'h', 'q', '@', '*', '[']);

/**
 * What the caret is sitting on.
 *
 * A dispatcher, not a viewer: it works out which view a command deserves and
 * renders that. FIR is the first with a view of its own because eight signed
 * bytes are the least readable thing in the language, but the shape is general
 * and `$ED`'s ADSR is meant to slot in beside it.
 *
 * It reads `EditorStore.commandAtCaret`, which scans the *undebounced* source,
 * so the panel keeps up with the caret rather than with the compiler.
 */
@Component({
  selector: 'amk-command-inspector',
  imports: [EchoInspector, FirDesigner, GenericCommand, LetterCommand],
  templateUrl: './command-inspector.html',
  host: { class: 'block' },
})
export class CommandInspector {
  protected readonly store = inject(EditorStore);

  protected readonly command = this.store.commandAtCaret;

  /** Which view to render; `null` leaves the generic readout standing. */
  protected readonly view = computed(() => {
    const command = this.command();
    if (!command) return null;
    if (command.vcmd !== undefined) return VIEWS[command.vcmd] ?? null;
    return LETTER_VIEWS.has(command.kind.toLowerCase()) ? 'letter' : null;
  });

  /** `$F5` and the like; a letter command has no VCMD byte. */
  protected readonly label = computed(() => {
    const command = this.command();
    if (!command) return '';
    return command.vcmd === undefined
      ? command.kind
      : `$${command.vcmd.toString(16).toUpperCase().padStart(2, '0')}`;
  });

  /**
   * The replacement the command was written as, when it was written as one.
   *
   * Worth saying out loud: the caret is on a name like `echo1`, and without
   * this the panel would claim a `$EF` is under a cursor that is plainly not
   * sitting on one.
   */
  protected readonly replacement = computed(() => this.command()?.replacement ?? null);

  /** Shown in the summary row, so the section reads without being opened. */
  protected readonly summary = computed(() => {
    const command = this.command();
    if (!command) return 'nothing at the caret';
    const via = this.replacement();
    return `${this.label()} ${command.name}${via ? ` via ${via}` : ''}`;
  });

  /**
   * A half-written command is worth saying so about rather than rendering as
   * though its missing arguments were zero.
   */
  protected readonly incomplete = computed(() => this.command()?.complete === false);
}
