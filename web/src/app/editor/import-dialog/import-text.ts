/** What the Import dialogs say: why a file could not be read, what the writer changed to fit it, and what each part is called. */

import type { GmFamily, DrumFamily } from '@amk/import/midi/gm';
import type { ImportWarning, Part, SmfErrorCode } from '@amk/import/midi';
import type { ModErrorCode, ModImportWarning } from '@amk/import/mod';

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

/** The GM name of each drum key a stock drum stands in for. */
export const DRUM_NAMES: Readonly<Record<number, string>> = {
  27: $localize`:@@import.drum.high-q:import.drum.high-q`,
  28: $localize`:@@import.drum.slap:import.drum.slap`,
  31: $localize`:@@import.drum.sticks:import.drum.sticks`,
  32: $localize`:@@import.drum.square-click:import.drum.square-click`,
  33: $localize`:@@import.drum.metronome-click:import.drum.metronome-click`,
  34: $localize`:@@import.drum.metronome-bell:import.drum.metronome-bell`,
  35: $localize`:@@import.drum.acoustic-bass-drum:import.drum.acoustic-bass-drum`,
  36: $localize`:@@import.drum.bass-drum-1:import.drum.bass-drum-1`,
  37: $localize`:@@import.drum.side-stick:import.drum.side-stick`,
  38: $localize`:@@import.drum.acoustic-snare:import.drum.acoustic-snare`,
  39: $localize`:@@import.drum.hand-clap:import.drum.hand-clap`,
  40: $localize`:@@import.drum.electric-snare:import.drum.electric-snare`,
  41: $localize`:@@import.drum.low-floor-tom:import.drum.low-floor-tom`,
  42: $localize`:@@import.drum.closed-hi-hat:import.drum.closed-hi-hat`,
  43: $localize`:@@import.drum.high-floor-tom:import.drum.high-floor-tom`,
  44: $localize`:@@import.drum.pedal-hi-hat:import.drum.pedal-hi-hat`,
  45: $localize`:@@import.drum.low-tom:import.drum.low-tom`,
  46: $localize`:@@import.drum.open-hi-hat:import.drum.open-hi-hat`,
  47: $localize`:@@import.drum.low-mid-tom:import.drum.low-mid-tom`,
  48: $localize`:@@import.drum.hi-mid-tom:import.drum.hi-mid-tom`,
  49: $localize`:@@import.drum.crash-cymbal-1:import.drum.crash-cymbal-1`,
  50: $localize`:@@import.drum.high-tom:import.drum.high-tom`,
  51: $localize`:@@import.drum.ride-cymbal-1:import.drum.ride-cymbal-1`,
  52: $localize`:@@import.drum.chinese-cymbal:import.drum.chinese-cymbal`,
  53: $localize`:@@import.drum.ride-bell:import.drum.ride-bell`,
  54: $localize`:@@import.drum.tambourine:import.drum.tambourine`,
  55: $localize`:@@import.drum.splash-cymbal:import.drum.splash-cymbal`,
  56: $localize`:@@import.drum.cowbell:import.drum.cowbell`,
  57: $localize`:@@import.drum.crash-cymbal-2:import.drum.crash-cymbal-2`,
  58: $localize`:@@import.drum.vibraslap:import.drum.vibraslap`,
  59: $localize`:@@import.drum.ride-cymbal-2:import.drum.ride-cymbal-2`,
  60: $localize`:@@import.drum.high-bongo:import.drum.high-bongo`,
  61: $localize`:@@import.drum.low-bongo:import.drum.low-bongo`,
  62: $localize`:@@import.drum.mute-high-conga:import.drum.mute-high-conga`,
  63: $localize`:@@import.drum.open-high-conga:import.drum.open-high-conga`,
  64: $localize`:@@import.drum.low-conga:import.drum.low-conga`,
  65: $localize`:@@import.drum.high-timbale:import.drum.high-timbale`,
  66: $localize`:@@import.drum.low-timbale:import.drum.low-timbale`,
  67: $localize`:@@import.drum.high-agogo:import.drum.high-agogo`,
  68: $localize`:@@import.drum.low-agogo:import.drum.low-agogo`,
  69: $localize`:@@import.drum.cabasa:import.drum.cabasa`,
  70: $localize`:@@import.drum.maracas:import.drum.maracas`,
  73: $localize`:@@import.drum.short-guiro:import.drum.short-guiro`,
  74: $localize`:@@import.drum.long-guiro:import.drum.long-guiro`,
  75: $localize`:@@import.drum.claves:import.drum.claves`,
  76: $localize`:@@import.drum.high-wood-block:import.drum.high-wood-block`,
  77: $localize`:@@import.drum.low-wood-block:import.drum.low-wood-block`,
  78: $localize`:@@import.drum.mute-cuica:import.drum.mute-cuica`,
  79: $localize`:@@import.drum.open-cuica:import.drum.open-cuica`,
  80: $localize`:@@import.drum.mute-triangle:import.drum.mute-triangle`,
  81: $localize`:@@import.drum.open-triangle:import.drum.open-triangle`,
  82: $localize`:@@import.drum.shaker:import.drum.shaker`,
  83: $localize`:@@import.drum.jingle-bell:import.drum.jingle-bell`,
  85: $localize`:@@import.drum.castanets:import.drum.castanets`,
  86: $localize`:@@import.drum.mute-surdo:import.drum.mute-surdo`,
  87: $localize`:@@import.drum.open-surdo:import.drum.open-surdo`,
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

export const MOD_REFUSALS: Readonly<Record<ModErrorCode, string>> = {
  'not-mod': $localize`:@@import.refuse.not-mod:import.refuse.not-mod`,
};

/** A MOD import's warning in words, naming the sample it is about by `label`. */
export function modWarningText(
  warning: ModImportWarning,
  label: (index: number) => string,
): string {
  switch (warning.code) {
    case 'offsets':
      return warning.count === 1
        ? $localize`:@@import.mod.warn.offsets.one:import.mod.warn.offsets.one`
        : $localize`:@@import.mod.warn.offsets.other:import.mod.warn.offsets.other ${warning.count}:count:`;
    case 'arpeggio':
      return warning.count === 1
        ? $localize`:@@import.mod.warn.arpeggio.one:import.mod.warn.arpeggio.one`
        : $localize`:@@import.mod.warn.arpeggio.other:import.mod.warn.arpeggio.other ${warning.count}:count:`;
    case 'tremolo':
      return warning.count === 1
        ? $localize`:@@import.mod.warn.tremolo.one:import.mod.warn.tremolo.one`
        : $localize`:@@import.mod.warn.tremolo.other:import.mod.warn.tremolo.other ${warning.count}:count:`;
    case 'unsupported':
      return warning.count === 1
        ? $localize`:@@import.mod.warn.unsupported.one:import.mod.warn.unsupported.one`
        : $localize`:@@import.mod.warn.unsupported.other:import.mod.warn.unsupported.other ${warning.count}:count:`;
    case 'mod-truncated':
      return $localize`:@@import.mod.warn.truncated:import.mod.warn.truncated`;
    case 'too-long':
      return $localize`:@@import.mod.warn.too-long:import.mod.warn.too-long`;
    case 'dropped-notes': {
      const sample = label(warning.sample);
      return warning.count === 1
        ? $localize`:@@import.mod.warn.dropped.one:import.mod.warn.dropped.one ${sample}:sample:`
        : $localize`:@@import.mod.warn.dropped.other:import.mod.warn.dropped.other ${warning.count}:count: ${sample}:sample:`;
    }

    case 'mod-folded': {
      const sample = label(warning.sample);
      return warning.count === 1
        ? $localize`:@@import.mod.warn.folded.one:import.mod.warn.folded.one ${sample}:sample:`
        : $localize`:@@import.mod.warn.folded.other:import.mod.warn.folded.other ${warning.count}:count: ${sample}:sample:`;
    }

    case 'mod-tempo-clamped':
      return $localize`:@@import.warn.tempo-clamped:import.warn.tempo-clamped ${warning.bpm}:bpm: ${warning.tempo}:tempo:`;
  }
}
