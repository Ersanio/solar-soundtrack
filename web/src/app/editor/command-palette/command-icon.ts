import { Component, input } from '@angular/core';

/**
 * Every glyph the palette can draw.
 *
 * A list rather than a bare union because `palettetest` reads it back: the type
 * stops an entry naming a glyph that does not exist, but nothing in TypeScript
 * can see whether the *template* has a `@case` for one — and a glyph the type
 * knows and the template does not falls through to `@default` and ships as a
 * dashed square. The harness matches this list against the template text.
 */
export const GLYPH_NAMES = [
  // Notes and timing
  'note',
  'noteTicks',
  'octave',
  'octaveDown',
  'octaveUp',
  'staccato',
  'metronome',
  'metronomeFade',
  // Volume and pan
  'speaker',
  'hairpin',
  'speakerMaster',
  'hairpinMaster',
  'pan',
  'panFade',
  'tremolo',
  'tremoloOff',
  // Pitch
  'sharp',
  'sharpMaster',
  'wave',
  'waveOff',
  'waveFade',
  'slide',
  'envelopeDown',
  'envelopeUp',
  'envelopeOff',
  'tuningFork',
  'arpeggio',
  // Instrument
  'keys',
  'noise',
  'adsr',
  'gain',
  'sample',
  // Echo
  'echo',
  'echoOff',
  'echoDelay',
  'echoFade',
  'filter',
  // Loops
  'repeatStart',
  'repeatEnd',
  'repeatNested',
  'replay',
  'triggerDefine',
  'trigger',
  'triggerOff',
  // Misc
  'toggle',
  'sliders',
  'chip',
  'chipWrite',
  'chipSend',
] as const;

export type CommandGlyph = (typeof GLYPH_NAMES)[number];

/**
 * One glyph out of the command set.
 *
 * A single component with a `@switch` rather than `shared/icons/`'s one file
 * pair per glyph: that convention is right for four pieces of app chrome picked
 * by name in a template, and wrong for a set this size chosen by data — it would
 * be ninety-odd files and `NgComponentOutlet` to select one. The drawing
 * convention is kept exactly, so a glyph could be lifted out into that folder
 * unchanged if one of these ever becomes app furniture.
 *
 * **An attribute on a real `<svg>`, not an element of its own**, because the
 * piano roll draws these inside its own inline SVG and a component element there
 * is an unknown SVG element — no layout box, nothing rendered, and no error to
 * say so. An attribute selector is matched after the namespace is split off, so
 * one drawing serves a palette button and a bar alike. Width and height are the
 * call site's for the same reason: a bar sizes its glyphs to its row.
 *
 * Three motifs run through the set, and they are what make it legible at 14px
 * rather than forty unrelated pictures: a **slash** across a glyph means the
 * command turns that effect *off*, a **rising arrow** means it happens *over
 * time*, and a **bar under the glyph** means it applies to the whole song
 * rather than this channel.
 *
 * ```html
 * <svg amk-glyph name="metronome" width="14" height="14"></svg>
 * ```
 */
@Component({
  selector: 'svg[amk-glyph]',
  templateUrl: './command-icon.html',
  host: { viewBox: '0 0 16 16', fill: 'none' },
})
export class CommandIcon {
  readonly name = input.required<CommandGlyph>();
}
