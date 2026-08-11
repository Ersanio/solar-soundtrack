import { Component, computed, inject, input } from '@angular/core';

import {
  argEditable,
  argumentText,
  commandRewritable,
  spliceArg,
  spliceArgs,
  spliceCommand,
} from '@amk/tokens/edits';
import type { Command } from '@amk/tokens';
import { panLabel } from '@amk/tokens/commands/units';
import { argLockedBecause, commandLockedBecause } from '../commands/context';
import { EnumSelect } from '../../../shared/enum-select/enum-select';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { dragPreview } from '../commands/preview';

/** `y`'s second and third arguments, and the two bits they set. */
const SURROUND = [
  { value: 0, label: 'off' },
  { value: 1, label: 'on' },
] as const;

/**
 * `y` and `$DB` — one command written two ways, so one view.
 *
 * `parsePan` (`Music.cpp:698-728`) compiles `y<pan>,<left>,<right>` to a single
 * `$DB` byte: `pan | left << 7 | right << 6`. The driver takes it apart again
 * with two masks, `and a, #$1f` for the pan and `and a, #$c0` for the flags
 * (`Commands.asm:239-243`), and bit 7 negates the left output where bit 6
 * negates the right (`main.asm:2866`). The readme agrees from the other end:
 * `y`'s two extra arguments are "(left,right)" (`syntax_reference.html:101`).
 *
 * A view rather than descriptor rows because a descriptor row is bound to one
 * *argument*, and `$DB`'s three fields share one byte — the same reason `q` has
 * a view. Shared with `y` so the two spellings cannot drift, as `$DA` shares
 * `@`'s and `$DE` shares `p`'s.
 */
@Component({
  selector: 'amk-pan-command',
  imports: [EnumSelect, Slider],
  templateUrl: './pan-command.html',
  host: { class: 'flex flex-col gap-3' },
})
export class PanCommand {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly SURROUND = SURROUND;

  /** `$DB` carries all three fields in one byte; `y` spells them as arguments. */
  private readonly packed = computed(() => this.command().vcmd === 0xdb);

  protected readonly written = computed(() => this.command().args.length > 0);

  private readonly byte = computed(() => this.command().args[0]?.value ?? 0);

  protected readonly pan = computed(() => (this.packed() ? this.byte() & 0x1f : this.byte()));

  protected readonly left = computed(() =>
    this.packed() ? (this.byte() >> 7) & 1 : (this.command().args[1]?.value ?? 0),
  );

  protected readonly right = computed(() =>
    this.packed() ? (this.byte() >> 6) & 1 : (this.command().args[2]?.value ?? 0),
  );

  /** The pan slider alone is dragged; the two flags commit on the spot. */
  private readonly drag = dragPreview(this.command);

  protected readonly shownPan = computed(() => this.drag.at('pan', this.pan()));

  protected preview(value: number): void {
    this.drag.set('pan', value);
  }

  protected readonly panLabel = computed(() => panLabel(this.shownPan()));

  protected readonly panNote = computed(() =>
    // main.asm:3486 — `PanValues` holds 21 entries, and the driver indexes it
    // with all five bits it kept, so anything past $14 reads off the end.
    this.shownPan() > 0x14
      ? `past the driver's 21-entry pan table, which ends at $14`
      : `$${this.shownPan().toString(16).toUpperCase().padStart(2, '0')} of $14`,
  );

  /**
   * `Music.cpp:714` rejects only `> 2`, so `y10,2,0` compiles — and `2 << 7` is
   * `$100`, which does not fit the byte `append` writes. The flag is lost rather
   * than set, and the panel says so instead of showing an unnamed value.
   */
  protected readonly overflowed = computed(() => {
    if (this.packed()) {
      return null;
    }

    const spilled = [this.left(), this.right()].some((value) => value >= 2);
    return spilled
      ? 'AddmusicK accepts 2 here, but the bit it would set is shifted off the byte, so it reads as off.'
      : null;
  });

  /** Bit 5 is in neither of the driver's masks, so nothing reads it. */
  protected readonly unusedBit = computed(() =>
    this.packed() && (this.byte() & 0x20) !== 0
      ? 'Bit 5 is set, which the driver reads as neither pan nor surround.'
      : null,
  );

  protected readonly note = computed(() =>
    this.packed()
      ? 'One byte: the low five bits are the pan, bit 7 mirrors the left speaker and bit 6 the right. Written as y, that is y<pan>,<left>,<right>.'
      : 'Both extra arguments are written or neither. They compile to bits 7 and 6 of a $DB byte.',
  );

  // --- editing ---------------------------------------------------------------

  protected readonly panEditable = computed(() => argEditable(this.command(), 0));

  protected readonly panLocked = computed(() => argLockedBecause(this.command(), 0));

  /**
   * A packed byte holds the flags in the argument the pan is in, so they are
   * editable exactly when it is. A `y` that has not been given its extra
   * arguments has to be rewritten whole to gain them, which a command built out
   * of a replacement cannot be.
   */
  protected readonly flagsEditable = computed(() => {
    const command = this.command();
    if (this.packed()) {
      return argEditable(command, 0);
    }

    return command.args.length >= 3
      ? argEditable(command, 1) && argEditable(command, 2)
      : commandRewritable(command) && argEditable(command, 0);
  });

  protected readonly flagsLocked = computed(() => {
    const command = this.command();
    if (this.flagsEditable()) {
      return null;
    }

    return this.packed() || command.args.length >= 3
      ? (argLockedBecause(command, 1) ?? argLockedBecause(command, 0))
      : commandLockedBecause(command);
  });

  protected setPan(value: number): void {
    this.write(value, this.left(), this.right());
  }

  protected setLeft(value: number): void {
    this.write(this.pan(), value, this.right());
  }

  protected setRight(value: number): void {
    this.write(this.pan(), this.left(), value);
  }

  private write(pan: number, left: number, right: number): void {
    const command = this.command();
    const source = this.store.source();

    if (this.packed()) {
      // Bit 5 survives an edit that has nothing to do with it: the driver
      // ignores it, but silently dropping a byte the author wrote is not this
      // panel's call to make.
      const kept = this.byte() & 0x20;
      const byte = (pan & 0x1f) | (left << 7) | (right << 6) | kept;
      this.store.apply(spliceArg(source, command, 0, argumentText(command, byte)));
      return;
    }

    if (command.args.length >= 3) {
      this.store.apply(spliceArgs(source, command, [String(pan), String(left), String(right)]));
      return;
    }

    if (left === 0 && right === 0) {
      this.store.apply(spliceArg(source, command, 0, String(pan)));
      return;
    }

    // Music.cpp:718 errors on a second argument without a third, so turning one
    // flag on has to write all three.
    this.store.apply(spliceCommand(source, command, `${command.kind}${pan},${left},${right}`));
  }
}
