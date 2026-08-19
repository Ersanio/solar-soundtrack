import { Component, computed, inject, input } from '@angular/core';

import type { WalkNote } from '@amk/spc/song-walk';
import { noiseHz } from '@amk/spc/adsr';
import { FIRST_CUSTOM_INSTRUMENT, FIRST_PERCUSSION_INSTRUMENT } from '@amk/spc/instruments';
import { ticksPerSecond } from '@amk/tokens/commands/units';
import { glyphOf } from '../../../command-palette/glyph-of';
import { DriverStore } from '../../../../state/driver-store';
import { EditorStore } from '../../../../state/editor-store';
import { type PlaceContext, keyOf, placeOf } from '../percussion';
import type { Mark } from '../roll-marks';
import { headingOf } from '../roll-marks';
import { keyName } from '../roll-layout';

/** How far the tooltip sits from the pointer, so the cursor never covers it. */
const TOOLTIP_GAP = 14;

/** Where the pointer is, and how big the pane it is in. */
export interface TooltipAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What a bar is, at length, because a bar has room for a name and a few glyphs
 * and nothing else.
 *
 * It reads the stores itself: the transposition line needs the note map, the
 * sample line needs the driver's own table, and the `under …` line needs the
 * commands in force. All three are facts about the note rather than about the
 * view, so threading them down through the roll would only spread the question.
 */
@Component({
  selector: 'amk-roll-tooltip',
  templateUrl: './roll-tooltip.html',
  host: {
    class:
      'border-edge bg-raised text-ink pointer-events-none absolute z-10 max-w-64 rounded-md border px-2 py-1.5 text-xs leading-relaxed shadow-lg',
    '[style.left.px]': 'tip().left',
    '[style.right.px]': 'tip().right',
    '[style.top.px]': 'tip().top',
    '[style.bottom.px]': 'tip().bottom',
  },
})
export class RollTooltip {
  private readonly editor = inject(EditorStore);
  private readonly drivers = inject(DriverStore);

  readonly mark = input.required<Mark>();
  readonly anchor = input.required<TooltipAnchor>();
  readonly context = input.required<PlaceContext>();

  protected readonly tip = computed(() => {
    const note = this.mark().note;
    const tempo = note.state.tempo;
    const rows: string[] = [];

    const context = this.context();
    const place = placeOf(note, context);
    const instrument = note.state.instrument;

    if (instrument !== null) {
      // The driver's own table entry, stated whether or not the porter counts
      // this instrument as percussion — `@21` is the driver's drum playing its
      // sample either way, and that is a fact about the image, not a preference.
      const entry =
        instrument >= FIRST_PERCUSSION_INSTRUMENT && instrument < FIRST_CUSTOM_INSTRUMENT
          ? this.drivers.instruments()?.percussion[instrument - FIRST_PERCUSSION_INSTRUMENT]
          : undefined;
      const sample = entry ? `, sample $${(entry.srcn ?? 0).toString(16).padStart(2, '0')}` : '';

      // A drum written at a pitch of its own is the interesting case, and the
      // one its lane cannot show: `@29 c` and `@29 g` are one drum at two rates.
      const pitched = place === 'drum' && note.percussion === null;
      const at = pitched ? keyOf(note, context) : null;
      rows.push(
        `@${instrument}${at === null ? '' : ` at ${keyName(at)}`}${place === 'drum' ? ' — a drum' : ''}${sample}`,
      );
    }

    // What the driver is handed, when that is not the pitch that was written.
    // `h` and the instrument's transposition are in the byte already; `$E4` and
    // `$FA $02` are added on the way to the DSP (`main.asm:439-442`). Said here
    // rather than drawn, so the row stays the note the source has.
    if (note.key !== null) {
      const written = context.written.get(note.address);
      const transposition: [number, string][] = [
        [written === undefined ? 0 : note.note - written, 'transposed'],
        [note.state.transpose, '$E4'],
        [note.state.tune, '$FA $02'],
      ];
      const applied = transposition.filter(([by]) => by !== 0);
      if (applied.length > 0) {
        const plays = keyName(note.key + note.state.transpose + note.state.tune);
        const by = applied.map(([n, what]) => `${what} ${n > 0 ? '+' : ''}${n}`).join(', ');
        rows.push(`plays as ${plays} — ${by}`);
      }
    }

    if (note.state.noise !== null) {
      rows.push(
        `noise — clock $${note.state.noise.toString(16)}, ${Math.round(noiseHz(note.state.noise))} Hz`,
      );
    }

    if (note.state.volume !== null) {
      rows.push(`v${note.state.volume}`);
    }

    if (note.state.quantization !== null) {
      rows.push(
        `q${note.state.quantization.toString(16).toUpperCase()} — sounds ${note.gateTicks} of ${note.ticks}`,
      );
    }

    if (tempo > 0) {
      rows.push(`t${tempo} — ${ticksPerSecond(tempo).toFixed(1)} ticks per second`);
    }

    const heading = headingOf(note, context, false);

    // A bar shows as many glyphs as it has room for, so the hover is where the
    // rest of them are named. The inspector lists them with their arguments.
    const acting = this.editor
      .commandsInForce()(note)
      .map((command) => glyphOf(command)?.label)
      .filter((label) => label !== undefined);
    if (acting.length > 0) {
      rows.push(`under ${acting.join(', ').toLowerCase()}`);
    }

    const at = this.anchor();
    const leftward = at.x > at.width / 2;
    const upward = at.y > at.height / 2;

    return {
      heading: `${heading} · channel ${note.channel}`,
      length: `tick ${note.tick} · ${note.ticks} ticks`,
      rows,
      source: this.sourceOf(note),
      left: leftward ? null : at.x + TOOLTIP_GAP,
      right: leftward ? at.width - at.x + TOOLTIP_GAP : null,
      top: upward ? null : at.y + TOOLTIP_GAP,
      bottom: upward ? at.height - at.y + TOOLTIP_GAP : null,
    };
  });

  /** The MML the note came from, when the editor still shows the text that compiled. */
  private sourceOf(note: WalkNote): string | null {
    const text = this.editor.compiledText();
    if (text === null || text !== this.editor.source()) {
      return null;
    }

    const span = this.editor.notesByAddress().get(note.address)?.span;
    return span ? text.slice(span.start, span.end) : null;
  }
}
