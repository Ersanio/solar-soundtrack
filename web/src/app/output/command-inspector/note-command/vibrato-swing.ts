/** The notes a vibrato peaks and dips at, which the note inspector reads out under the `q`. */

import { SEMITONE, vibratoSwing } from '@amk/spc/pitch';
import type { WalkNote } from '@amk/spc/song-walk';
import { keyName } from '../../../editor/views/piano-roll/roll-layout';

/** `$80`, the byte that is o1 c and so key 0. */
const KEY_ZERO = 0x80;

/** The pitch `offset` 256ths of a semitone from `key`: the nearest note, a half rounding toward `key`, and the cents it is off. */
export function pitchAt(key: number, offset: number): string {
  const steps = Math.sign(offset) * Math.floor((Math.abs(offset) + SEMITONE / 2 - 1) / SEMITONE);
  const cents = Math.round(((offset - steps * SEMITONE) * 100) / SEMITONE);
  const pitch = keyName(key + steps);
  if (cents === 0) {
    return pitch;
  }

  const signed = cents > 0 ? `+${cents}` : `−${-cents}`;
  return $localize`:@@inspector.note-vibrato.pitch-and-cents:inspector.note-vibrato.pitch-and-cents ${pitch}:pitch: ${signed}:cents:`;
}

/**
 * What the vibrato in force does to one pass of a note, said under its `q`.
 *
 * Measured from the pitch the note is written at, which is the row the roll draws it on; a note the
 * map does not know keeps its byte, as the roll does. `null` for no vibrato, a drum and noise,
 * whose pitch is not the note's.
 */
export function vibratoLine(note: WalkNote, written: number | undefined): string | null {
  const vibrato = note.state.vibrato;
  if (vibrato === null || note.key === null || note.state.noise !== null) {
    return null;
  }

  if (vibrato.rate === 0) {
    return $localize`:@@inspector.note-vibrato.rate-of-zero:inspector.note-vibrato.rate-of-zero`;
  }

  if (note.vibratoTicks === 0) {
    return vibrato.delay === 0
      ? $localize`:@@inspector.note-vibrato.keys-off-before-it-starts:inspector.note-vibrato.keys-off-before-it-starts`
      : $localize`:@@inspector.note-vibrato.keys-off-before-the-delay:inspector.note-vibrato.keys-off-before-the-delay ${vibrato.delay}:delay:`;
  }

  const key = (written ?? note.note) - KEY_ZERO;
  const swing = vibratoSwing(vibrato.depth);
  return $localize`:@@inspector.note-vibrato.peaks-and-dips:inspector.note-vibrato.peaks-and-dips ${pitchAt(key, swing)}:peak: ${pitchAt(key, -swing)}:dip:`;
}
