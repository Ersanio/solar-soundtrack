/** What the Import dialog says: why a file could not be read, what the writer changed to fit it, and what each part is called. */

import type { GmFamily, DrumFamily } from '@amk/import/midi/gm';
import type { ImportWarning, Part, SmfErrorCode } from '@amk/import/midi';

export const REFUSALS: Readonly<Record<SmfErrorCode, string>> = {
  'not-midi': $localize`:@@import.refuse.not-midi:import.refuse.not-midi`,
  'bad-header': $localize`:@@import.refuse.bad-header:import.refuse.bad-header`,
  'format-2': $localize`:@@import.refuse.format-2:import.refuse.format-2`,
  'no-tracks': $localize`:@@import.refuse.no-tracks:import.refuse.no-tracks`,
  'no-notes': $localize`:@@import.refuse.no-notes:import.refuse.no-notes`,
};

const KIT: Readonly<Record<DrumFamily, string>> = {
  'kick-snare': $localize`:@@import.kit.kick-snare:import.kit.kick-snare`,
  cymbals: $localize`:@@import.kit.cymbals:import.kit.cymbals`,
  percussion: $localize`:@@import.kit.percussion:import.kit.percussion`,
};

const FAMILY: Readonly<Record<GmFamily, string>> = {
  piano: $localize`:@@import.family.piano:import.family.piano`,
  'chromatic-percussion': $localize`:@@import.family.chromatic-percussion:import.family.chromatic-percussion`,
  organ: $localize`:@@import.family.organ:import.family.organ`,
  guitar: $localize`:@@import.family.guitar:import.family.guitar`,
  bass: $localize`:@@import.family.bass:import.family.bass`,
  strings: $localize`:@@import.family.strings:import.family.strings`,
  ensemble: $localize`:@@import.family.ensemble:import.family.ensemble`,
  brass: $localize`:@@import.family.brass:import.family.brass`,
  reed: $localize`:@@import.family.reed:import.family.reed`,
  pipe: $localize`:@@import.family.pipe:import.family.pipe`,
  'synth-lead': $localize`:@@import.family.synth-lead:import.family.synth-lead`,
  'synth-pad': $localize`:@@import.family.synth-pad:import.family.synth-pad`,
  'synth-effects': $localize`:@@import.family.synth-effects:import.family.synth-effects`,
  ethnic: $localize`:@@import.family.ethnic:import.family.ethnic`,
  percussive: $localize`:@@import.family.percussive:import.family.percussive`,
  'sound-effects': $localize`:@@import.family.sound-effects:import.family.sound-effects`,
};

/** The family a part's program belongs to, or the kit piece it plays. */
export function kindOf(part: Part, family: GmFamily): string {
  return part.family ? KIT[part.family] : FAMILY[family];
}

/** Where the part came from: its channel, and which of the channel's voices it is. */
export function sourceOf(part: Part): string {
  const channel = part.channel + 1;
  const voice = part.voice + 1;
  return part.voices > 1
    ? $localize`:@@import.part.voice:import.part.voice ${channel}:channel: ${voice}:voice: ${part.voices}:voices:`
    : $localize`:@@import.part.channel:import.part.channel ${channel}:channel:`;
}

/** A warning in words, naming the part it is about by `label`. */
export function warningText(warning: ImportWarning, label: (id: string) => string): string {
  switch (warning.code) {
    case 'truncated': {
      const track = warning.track + 1;
      return $localize`:@@import.warn.truncated:import.warn.truncated ${track}:track:`;
    }

    case 'tempo-clamped':
      return $localize`:@@import.warn.tempo-clamped:import.warn.tempo-clamped ${warning.bpm}:bpm: ${warning.tempo}:tempo:`;
    case 'shifted': {
      const part = label(warning.part);
      const octaves = Math.abs(warning.octaves);
      if (warning.octaves > 0) {
        return octaves === 1
          ? $localize`:@@import.warn.shifted-up.one:import.warn.shifted-up.one ${part}:part:`
          : $localize`:@@import.warn.shifted-up.other:import.warn.shifted-up.other ${part}:part: ${octaves}:octaves:`;
      }

      return octaves === 1
        ? $localize`:@@import.warn.shifted-down.one:import.warn.shifted-down.one ${part}:part:`
        : $localize`:@@import.warn.shifted-down.other:import.warn.shifted-down.other ${part}:part: ${octaves}:octaves:`;
    }

    case 'folded': {
      const part = label(warning.part);
      return warning.count === 1
        ? $localize`:@@import.warn.folded.one:import.warn.folded.one ${part}:part:`
        : $localize`:@@import.warn.folded.other:import.warn.folded.other ${warning.count}:count: ${part}:part:`;
    }

    case 'merged': {
      const part = label(warning.part);
      return warning.count === 1
        ? $localize`:@@import.warn.merged.one:import.warn.merged.one ${part}:part:`
        : $localize`:@@import.warn.merged.other:import.warn.merged.other ${warning.count}:count: ${part}:part:`;
    }

    case 'unmapped-drums':
      return warning.count === 1
        ? $localize`:@@import.warn.unmapped-drums.one:import.warn.unmapped-drums.one`
        : $localize`:@@import.warn.unmapped-drums.other:import.warn.unmapped-drums.other ${warning.count}:count:`;
    case 'smpte':
      return $localize`:@@import.warn.smpte:import.warn.smpte`;
  }
}
