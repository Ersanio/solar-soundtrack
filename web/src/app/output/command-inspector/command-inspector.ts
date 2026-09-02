import { Component, computed, inject } from '@angular/core';

import { loopAt } from '@amk/tokens/commands/loops';
import { Section } from '../../shared/section/section';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import { hex2 } from '../../util/format';
import { LoopInspector } from '../loop-inspector/loop-inspector';
import { AdsrCommand } from './adsr-command/adsr-command';
import { ArpeggioCommand } from './arpeggio-command/arpeggio-command';
import { BendCommand } from './bend-command/bend-command';
import { EchoInspector } from './echo-inspector/echo-inspector';
import { FirDesigner } from './fir-designer/fir-designer';
import { InstrumentEntryEditor } from './instrument-entry/instrument-entry';
import { InstrumentInspector } from './instrument-inspector/instrument-inspector';
import { NoteCommand } from './note-command/note-command';
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
 * Only `@`, `p` and `q`. Every other letter's reading — tempo in BPM, pan as a
 * position, noise in hertz — lives in `@amk/tokens/commands/letter-params.ts`,
 * where the parameter table both states it *and* lets it be edited; a second
 * implementation of the same sentence would only drift.
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
    LoopInspector,
    NoteCommand,
    PanCommand,
    ParamTable,
    QuantizationCommand,
    BendCommand,
    Section,
    VibratoCommand,
  ],
  templateUrl: './command-inspector.html',
  host: { class: 'block' },
})
export class CommandInspector {
  protected readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  /**
   * Whether the roll has let go of what this was answering about — see
   * {@link EditorRequests.dismissed}. It is one caret's worth of silence, not a
   * mode: the next move of the caret is the next question.
   */
  private readonly dismissed = computed(() => this.requests.dismissed() === this.store.caret());

  protected readonly command = computed(() =>
    this.dismissed() ? null : this.store.commandAtCaret(),
  );

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
  protected readonly entry = computed(() =>
    this.dismissed() ? null : this.store.instrumentAtCaret(),
  );

  /**
   * The loop construct the caret's own text belongs to, if any.
   *
   * The token question rather than the panel one: `amk-loop-inspector` owns what
   * a loop *says*, and this only needs to know whether the subject at the caret
   * is one — so it asks `loopAt` and not `loopFocus`.
   */
  protected readonly loop = computed(() =>
    this.dismissed() ? null : loopAt(this.store.loops(), this.store.caret()),
  );

  /**
   * The command the parameter table answers for.
   *
   * `null` where a loop has the caret's own text, because the loop inspector
   * draws that count and draws it better: the table would show the empty
   * `Repeats` of a `]]4`'s *first* bracket, or a `$E6`'s byte, which is one less
   * than the count it means. And it is the command rather than the header that
   * stands down — `commandAt` is end-inclusive, so the caret on the `]` of
   * `c4]2` finds the note in front of it, and a heading naming that note over
   * parameters nothing draws would be worse than no heading at all.
   */
  protected readonly params = computed(() => (this.loop() ? null : this.command()));

  /** Nothing at the caret at all, which is the one state with a sentence of its own. */
  protected readonly empty = computed(() => !this.entry() && !this.params() && !this.loop());

  /** Which view to render; `null` falls through to the parameter table. */
  protected readonly view = computed(() => {
    if (this.entry()) {
      return 'entry';
    }

    const command = this.params();
    if (!command) {
      return null;
    }

    // Nine note letters, `r` and `^` are one command in eleven spellings, and
    // `gather` gives that command — and only that one — its length segments. One
    // test rather than eleven rows in the table below.
    if (command.noteLength !== undefined) {
      return 'note';
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
    const command = this.params();
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
  protected readonly replacement = computed(() => this.params()?.replacement ?? null);

  /** Shown beside the section's heading, so the subject reads at a glance. */
  protected readonly summary = computed(() => {
    const entry = this.entry();
    if (entry) {
      return `@${entry.number} instrument definition`;
    }

    const command = this.params();
    if (!command) {
      return this.loop() ? 'a loop' : 'nothing at the caret';
    }

    const via = this.replacement();
    return `${this.label()} ${command.name}${via ? ` via ${via}` : ''}`;
  });

  /**
   * A half-written command is worth saying so about rather than rendering as
   * though its missing arguments were zero.
   */
  protected readonly incomplete = computed(() => this.params()?.complete === false);
}
