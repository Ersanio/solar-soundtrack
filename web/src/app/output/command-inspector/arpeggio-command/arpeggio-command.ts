import { Component, computed, inject, input } from '@angular/core';

import { argsRewritable, commandRewritable, spliceArg, spliceCommand } from '@compiler/edits';
import type { Command } from '@compiler/tokens';
import { Button } from '../../../shared/button/button';
import { type EnumOption, EnumSelect } from '../../../shared/enum-select/enum-select';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { toSigned } from '../commands/param';

const MODES: readonly EnumOption[] = [
  { value: 0x00, label: 'off' },
  { value: 0x01, label: 'a sequence of notes' },
  { value: 0x80, label: 'trill — two notes' },
  { value: 0x81, label: 'glissando' },
];

/** The most notes worth drawing a row each for. `$FB $7F` carries 127. */
const MAX_ROWS = 24;

/**
 * `$FB` — arpeggio, and the one command whose *length* you edit.
 *
 * Its first byte is a count, and `count` note bytes follow the duration. So the
 * count is not typed: it is derived from how many note rows there are, and Add
 * and Remove are what change it. Typing a count and then having to write exactly
 * that many bytes by hand is the mistake this panel exists to prevent — and a
 * count that disagrees with what follows silently reinterprets the music after
 * it as note data.
 *
 * `$80` and `$81` are not counts at all but the trill and glissando forms, which
 * take a fixed two arguments; the mode select is what moves between the three
 * shapes.
 */
@Component({
  selector: 'amk-arpeggio-command',
  imports: [Button, EnumSelect, Slider],
  templateUrl: './arpeggio-command.html',
  host: { class: 'flex flex-col gap-3' },
})
export class ArpeggioCommand {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly MODES = MODES;

  protected readonly args = computed(() => this.command().args.map((a) => a.value));
  protected readonly count = computed(() => this.args()[0] ?? 0);

  /** `$00`/`$80`/`$81` are themselves; any other count is "a sequence". */
  protected readonly mode = computed(() => {
    const count = this.count();
    return count === 0x00 || count === 0x80 || count === 0x81 ? count : 0x01;
  });

  protected readonly isSequence = computed(() => this.mode() === 0x01);
  protected readonly isOff = computed(() => this.mode() === 0x00);

  protected readonly duration = computed(() => this.args()[1] ?? 0);

  /** One row per note actually written, capped so a huge sequence stays readable. */
  protected readonly notes = computed(() =>
    this.args()
      .slice(2, 2 + MAX_ROWS)
      .map((value, index) => ({ index, value: toSigned(value), hex: `$${hex2(value)}` })),
  );

  protected readonly omitted = computed(() => Math.max(0, this.args().length - 2 - MAX_ROWS));

  protected readonly countNote = computed(() => {
    const written = this.count();
    const actual = this.args().length - 2;
    if (this.isSequence() && written !== actual) {
      return `the count says ${written} but ${actual} follow — the driver will read past this command`;
    }

    return null;
  });

  /** The single argument the trill and glissando forms take past the duration. */
  protected readonly extra = computed(() => toSigned(this.args()[2] ?? 0));

  protected readonly extraLabel = computed(() =>
    this.mode() === 0x80 ? 'Pitch change' : 'Semitones per step',
  );

  protected readonly editable = computed(() => argsRewritable(this.command()));

  /** Add and Remove change the command's *shape*, which needs the whole run literal. */
  protected readonly canResize = computed(() => commandRewritable(this.command()));

  protected readonly lockedBecause = computed(() =>
    this.editable()
      ? null
      : `These bytes come from the "${this.command().replacement}" replacement, so they cannot be set here.`,
  );

  // --- editing ---------------------------------------------------------------

  protected setDuration(value: number): void {
    this.store.apply(spliceArg(this.store.source(), this.command(), 1, `$${hex2(value)}`));
  }

  protected setNote(index: number, value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.store.apply(
      spliceArg(this.store.source(), this.command(), index + 2, `$${hex2(byte & 0xff)}`),
    );
  }

  protected setExtra(value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.store.apply(spliceArg(this.store.source(), this.command(), 2, `$${hex2(byte & 0xff)}`));
  }

  protected setMode(mode: number): void {
    if (mode === this.mode()) {
      return;
    }

    const duration = this.duration() || 0x18;
    switch (mode) {
      case 0x00:
        // `$FB $00` turns arpeggio off and takes nothing further.
        this.rewrite([0x00]);
        break;
      case 0x01:
        this.rewrite([2, duration, 0x04, 0x07]);
        break;
      default:
        this.rewrite([mode, duration, this.args()[2] ?? 0x04]);
    }
  }

  protected addNote(): void {
    const notes = this.args().slice(2);
    this.rewrite([notes.length + 1, this.duration(), ...notes, 0x00]);
  }

  protected removeNote(index: number): void {
    const notes = this.args().slice(2);
    notes.splice(index, 1);
    this.rewrite([notes.length, this.duration(), ...notes]);
  }

  /**
   * Rewrites the whole run, which adding or removing a note necessarily does:
   * the argument list grows or shrinks, so there is no per-token splice that
   * expresses it. The one place in the inspector where the author's spacing
   * inside a command cannot be preserved, and it is a shape change, not a value.
   */
  private rewrite(values: number[]): void {
    const text = `$FB ${values.map((value) => `$${hex2(value & 0xff)}`).join(' ')}`;
    this.store.apply(spliceCommand(this.store.source(), this.command(), text));
  }
}
