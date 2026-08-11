import { Component, computed, inject } from '@angular/core';

import { EditorStore } from '../../state/editor-store';
import { hex2 } from '../../util/format';
import { AdsrCommand } from './adsr-command/adsr-command';
import { ArpeggioCommand } from './arpeggio-command/arpeggio-command';
import { BendCommand } from './bend-command/bend-command';
import { EchoInspector } from './echo-inspector/echo-inspector';
import { FirDesigner } from './fir-designer/fir-designer';
import { InstrumentEntryEditor } from './instrument-entry/instrument-entry';
import { InstrumentInspector } from './instrument-inspector/instrument-inspector';
import { PanCommand } from './pan-command/pan-command';
import { ParamTable } from './param-table/param-table';
import { QuantizationCommand } from './quantization-command/quantization-command';
import { VibratoCommand } from './vibrato-command/vibrato-command';

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
  0xdb: 'pan',
  // A delay, a speed and a depth that only make sense together.
  0xdd: 'bend',
  0xde: 'vibrato',
  0xe5: 'vibrato',
  0xeb: 'bend',
  0xec: 'bend',
  0xed: 'adsr',
  0xef: 'echo',
  0xf0: 'echo',
  0xf1: 'echo',
  0xf2: 'echo',
  0xf5: 'fir',
  0xfb: 'arpeggio',
};

/**
 * Letter commands with a view of their own.
 *
 * Only `@`, `p` and `q` are left. The rest used to have a read-only readout each
 * — tempo in BPM, pan as a position, noise in hertz — and every one of those
 * readings now lives in `@amk/tokens/commands/letter-params.ts`, where the
 * parameter table both states it *and* lets it be edited. Two implementations of
 * the same sentence would only drift.
 */
const LETTER_VIEWS: Readonly<Record<string, string>> = {
  '@': 'instrument',
  p: 'vibrato',
  y: 'pan',
  q: 'quantization',
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
    ArpeggioCommand,
    EchoInspector,
    FirDesigner,
    InstrumentEntryEditor,
    InstrumentInspector,
    PanCommand,
    ParamTable,
    QuantizationCommand,
    BendCommand,
    VibratoCommand,
  ],
  templateUrl: './command-inspector.html',
  host: { class: 'block' },
})
export class CommandInspector {
  protected readonly store = inject(EditorStore);

  protected readonly command = this.store.commandAtCaret;

  /**
   * The `#instruments` entry the caret is in, which wins over everything else.
   *
   * Two reasons it is asked first. A definition and a use are written
   * identically — `@5` and `n1F` mean one thing in a channel and quite another
   * in the block — so the entry has to beat the letter the command starts with.
   * And most of an entry is not a command at all: `"kick.brr" $FF $E0 …` is a
   * string and five hex arguments, none of which `gather` turns into one, so
   * without this the editor would be reachable only from the two sample forms
   * that happen to scan as commands.
   */
  protected readonly entry = this.store.instrumentAtCaret;

  /** Which view to render; `null` falls through to the parameter table. */
  protected readonly view = computed(() => {
    if (this.entry()) {
      return 'entry';
    }

    const command = this.command();
    if (!command) {
      return null;
    }

    if (command.vcmd !== undefined) {
      // parser.ts's parseHFDHex — under #am4, $ED is HFD's escape: only the plain-ADSR
      // shape earns the envelope view, and $80-$83 fall to the generic
      // readout. A bare $ED keeps the view, as an incomplete one always has.
      if (command.vcmd === 0xed && command.target.program === 1) {
        const sub = command.args[0]?.value;
        return sub !== undefined && sub >= 0x80 && sub <= 0x83 ? null : 'adsr';
      }

      // parser.ts's parseHexCommand — the other #am4 overload: a high first byte turns $E5
      // from tremolo into a sample load, which has no shape to draw.
      if (command.vcmd === 0xe5 && command.target.program === 1) {
        return (command.args[0]?.value ?? 0) >= 0x80 ? null : 'vibrato';
      }

      return VIEWS[command.vcmd] ?? null;
    }

    return LETTER_VIEWS[command.kind.toLowerCase()] ?? null;
  });

  /** `$F5` and the like; a letter command has no VCMD byte. */
  protected readonly label = computed(() => {
    const command = this.command();
    if (!command) {
      return '';
    }

    return command.vcmd === undefined ? command.kind : `$${hex2(command.vcmd)}`;
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
    const entry = this.entry();
    if (entry) {
      return `@${entry.number} instrument definition`;
    }

    const command = this.command();
    if (!command) {
      return 'nothing at the caret';
    }

    const via = this.replacement();
    return `${this.label()} ${command.name}${via ? ` via ${via}` : ''}`;
  });

  /**
   * A half-written command is worth saying so about rather than rendering as
   * though its missing arguments were zero.
   */
  protected readonly incomplete = computed(() => this.command()?.complete === false);
}
