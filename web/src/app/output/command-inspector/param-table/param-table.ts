import { Component, computed, inject, input } from '@angular/core';

import { argumentText, spliceArg } from '@amk/tokens/edits';
import type { Command } from '@amk/tokens';
import { BitToggles } from '../../../shared/bit-toggles/bit-toggles';
import { EnumSelect } from '../../../shared/enum-select/enum-select';
import { NumberField } from '../../../shared/number-field/number-field';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { SampleStore } from '../../../state/sample-store';
import { hex2 } from '../../../util/format';
import { paramContext } from '../commands/context';
import { type ParamRow, resolveCommand } from '@amk/tokens/commands/describe';
import { fromSigned } from '@amk/tokens/commands/param';
import { dragPreview } from '../commands/preview';

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
  private readonly library = inject(SampleStore);

  readonly command = input.required<Command>();

  protected readonly VOICE_LABELS = VOICE_LABELS;

  /**
   * Its own `computed` rather than part of {@link resolved}, because the rows
   * below re-derive per frame of a drag and this must not: building it walks
   * every command in the song to find the tempo in force.
   */
  private readonly context = computed(() => paramContext(this.command(), this.store, this.library));

  protected readonly resolved = computed(() => resolveCommand(this.command(), this.context()));

  private readonly drag = dragPreview(this.command);

  /**
   * The resolved rows with each readout re-read from whatever its control is
   * showing, so a sentence about a value follows the value.
   *
   * Only `raw` and `note` are re-derived. Everything else — `value`, `min`,
   * `max`, `stops`, `control` — stays as the document resolved it, and that is
   * deliberate twice over. `amk-slider` decides a gesture changed something by
   * comparing against the value bound to it, so a previewed `value` would make
   * every drag read as a no-op and nothing would ever be written. And the *row
   * set* has to stay put: every descriptor that forks on an argument's value is
   * `structural`, which `describe.ts` draws as a number field, so re-resolving
   * against a half-typed count would delete and rebuild the rows under the
   * pointer. Resolving from the document and re-describing from the preview
   * gets the live reading without either.
   */
  protected readonly rows = computed(() => {
    const command = this.command();
    const context = this.context();

    return this.resolved().rows.map((row) => {
      const shown = this.drag.at(row.index, row.value);
      if (shown === row.value) {
        return row;
      }

      // `describe` and the raw form both want the byte; an `s8` control hands
      // out the signed reading of it.
      const byte = row.descriptor.codec === 's8' ? fromSigned(shown) : shown;
      return {
        ...row,
        raw: command.vcmd !== undefined ? `$${hex2(byte)}` : String(byte),
        note: row.descriptor.describe?.(byte, command, context) ?? null,
      };
    });
  });

  /** Bound to every control that has a live channel; the rest commit outright. */
  protected preview(row: ParamRow, value: number): void {
    this.drag.set(row.index, value);
  }

  /** `$00`, so a mask's readout says what is in the source as well as which bits are on. */
  protected hexLabel(row: ParamRow): string {
    return row.byte === null ? '—' : `$${hex2(row.byte)}`;
  }

  /**
   * Writes one argument back.
   *
   * The value arrives in the control's units, so a signed descriptor converts on
   * the way out; `argumentText` picks the radix, which is a per-command fact and
   * not the two-way one this used to assume.
   */
  protected commit(row: ParamRow, value: number): void {
    const command = this.command();
    const byte = row.descriptor.codec === 's8' ? fromSigned(value) : value;
    this.store.apply(
      spliceArg(this.store.source(), command, row.index, argumentText(command, byte)),
    );
  }
}
