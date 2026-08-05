import { Component, computed, inject, input } from '@angular/core';

import { spliceArg } from '@compiler/edits';
import type { Command } from '@compiler/tokens';
import { BitToggles } from '../../../shared/bit-toggles/bit-toggles';
import { EnumSelect } from '../../../shared/enum-select/enum-select';
import { NumberField } from '../../../shared/number-field/number-field';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { type ParamRow, resolveCommand } from '../commands/describe';
import { fromSigned } from '../commands/param';

/** LSB first, because every mask in the language is documented that way. */
const VOICE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7'];

/**
 * Every command's arguments, named and editable.
 *
 * The default arm of the inspector, and the reason "an inspector for every
 * command" is a table rather than sixty components: a descriptor says what an
 * argument *means*, this renders the control that fits it, and a command nobody
 * has described yet still gets one editable row per argument instead of the
 * hex/decimal/binary dump that used to stand here.
 *
 * Every edit goes through `spliceArg`, so it rewrites one token and leaves the
 * author's spacing — and any argument that came out of a macro alone.
 */
@Component({
  selector: 'amk-param-table',
  imports: [BitToggles, EnumSelect, NumberField, Slider],
  templateUrl: './param-table.html',
  host: { class: 'block' },
})
export class ParamTable {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly VOICE_LABELS = VOICE_LABELS;

  protected readonly resolved = computed(() => resolveCommand(this.command()));

  /** `$00`, so a mask's readout says what is in the source as well as which bits are on. */
  protected hexLabel(row: ParamRow): string {
    return row.byte === null ? '—' : `$${hex2(row.byte)}`;
  }

  /**
   * Writes one argument back.
   *
   * The value arrives in the control's units, so a signed descriptor converts on
   * the way out; the radix follows the command, since a hex command's arguments
   * are written `$XX` and a letter command's are decimal.
   */
  protected commit(row: ParamRow, value: number): void {
    const command = this.command();
    const byte = row.descriptor.codec === 's8' ? fromSigned(value) : value;
    const text = command.vcmd !== undefined ? `$${hex2(byte & 0xff)}` : String(byte);
    this.store.apply(spliceArg(this.store.source(), command, row.index, text));
  }
}
