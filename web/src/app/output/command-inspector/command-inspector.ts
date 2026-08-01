import { Component, computed, inject } from '@angular/core';

import { EditorStore } from '../../state/editor-store';
import { AdsrCommand } from './adsr-command/adsr-command';
import { EchoInspector } from './echo-inspector/echo-inspector';
import { FirDesigner } from './fir-designer/fir-designer';
import { GenericCommand } from './generic-command/generic-command';
import { InstrumentInspector } from './instrument-inspector/instrument-inspector';
import { LetterCommand } from './letter-command/letter-command';

/**
 * Which view a hex command gets.
 *
 * A lookup rather than a chain of conditions, so adding a view is an entry here
 * and a component, not a change to the dispatcher.
 */
const VIEWS: Readonly<Record<number, string>> = {
  // `$DA` is the hex form of `@`, and the only way to reach the driver's own
  // instrument table entry 19 — so it gets the same view.
  0xda: 'instrument',
  0xed: 'adsr',
  0xef: 'echo',
  0xf0: 'echo',
  0xf1: 'echo',
  0xf2: 'echo',
  0xf5: 'fir',
};

/**
 * Letter commands worth spelling out; the rest fall through to the generic view.
 *
 * A map rather than a set now that `@` earns a view of its own.
 */
const LETTER_VIEWS: Readonly<Record<string, string>> = {
  t: 'letter',
  v: 'letter',
  w: 'letter',
  y: 'letter',
  o: 'letter',
  l: 'letter',
  h: 'letter',
  q: 'letter',
  n: 'letter',
  '*': 'letter',
  '[': 'letter',
  '@': 'instrument',
};

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
  imports: [
    AdsrCommand,
    EchoInspector,
    FirDesigner,
    GenericCommand,
    InstrumentInspector,
    LetterCommand,
  ],
  templateUrl: './command-inspector.html',
  host: { class: 'block' },
})
export class CommandInspector {
  protected readonly store = inject(EditorStore);

  protected readonly command = this.store.commandAtCaret;

  /**
   * Whether the caret is inside an `#instruments` entry.
   *
   * A definition and a use are written identically — `@5` and `n1F` mean one
   * thing in a channel and quite another in the block — so this has to win over
   * the letter the command starts with, and it is decided here rather than in
   * each view that could be fooled by it.
   */
  private readonly defining = computed(() => {
    const command = this.command();
    if (!command) return false;
    const at = command.span.start;
    return this.store.tokens().instruments.some((d) => at >= d.span.start && at < d.span.end);
  });

  /** Which view to render; `null` leaves the generic readout standing. */
  protected readonly view = computed(() => {
    const command = this.command();
    if (!command) return null;
    if (this.defining()) return 'instrument';
    if (command.vcmd !== undefined) return VIEWS[command.vcmd] ?? null;
    return LETTER_VIEWS[command.kind.toLowerCase()] ?? null;
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
