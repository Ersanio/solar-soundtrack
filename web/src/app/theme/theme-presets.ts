/**
 * The themes the picker offers by name.
 *
 * A preset carries only what it moves off the stylesheet's own values, so the
 * default one, Studio, carries nothing at all. Every other preset names every
 * token it needs, the accent included, so it renders the same whatever the
 * stylesheet's own accent is. None of them touch `--color-ch-*`: the eight are
 * a set that was validated together, and repainting one channel is what the
 * per-colour rows are for.
 */

import type { Overrides } from './theme-tokens';

export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  /** One line for the picker, saying what the preset is for. */
  readonly note: string;
  readonly overrides: Overrides;
}

export const PRESETS: readonly ThemePreset[] = [
  {
    id: 'studio',
    name: $localize`:@@theme.studio:theme.studio`,
    note: $localize`:@@theme.fl-studio-s-own-greys:theme.fl-studio-s-own-greys`,
    overrides: {},
  },
  {
    id: 'slate',
    name: $localize`:@@theme.slate:theme.slate`,
    note: $localize`:@@theme.the-darker-blue-grey-the:theme.the-darker-blue-grey-the`,
    overrides: {
      surface: '#1e272e',
      raised: '#2f3c45',
      inset: '#171f25',
      edge: '#42525c',
      ink: '#dbe3e8',
      'ink-muted': '#9aaab5',
      control: '#7ea6c4',
      accent: '#ffa53a',
      'accent-soft': '#ffd08a',
      'syn-note': '#dbe3e8',
      'syn-number': '#dbe3e8',
      'syn-comment': '#9aaab5',
      'syn-operator': '#9aaab5',
      'seg-free': '#3a4852',
      lane: '#1e272e',
      'lane-sharp': '#171f25',
      'lane-rule': '#42525c',
    },
  },
  {
    id: 'graphite',
    name: $localize`:@@theme.graphite:theme.graphite`,
    note: $localize`:@@theme.neutral-grey:theme.neutral-grey`,
    overrides: {
      surface: '#191919',
      raised: '#212121',
      inset: '#141414',
      edge: '#333333',
      ink: '#e3e3e3',
      'ink-muted': '#909090',
      control: '#a8a8a8',
      accent: '#6ea8fe',
      'accent-soft': '#a7c4e8',
      'syn-note': '#e3e3e3',
      'syn-number': '#e3e3e3',
      'syn-comment': '#909090',
      'syn-operator': '#909090',
      'seg-free': '#383838',
      lane: '#191919',
      'lane-sharp': '#141414',
      'lane-rule': '#333333',
    },
  },
  {
    id: 'midnight',
    name: $localize`:@@theme.midnight:theme.midnight`,
    note: $localize`:@@theme.the-cooler-blue-tinted-grey:theme.the-cooler-blue-tinted-grey`,
    overrides: {
      surface: '#16181d',
      raised: '#1d2027',
      inset: '#12141a',
      edge: '#2c313b',
      ink: '#d8dce4',
      'ink-muted': '#838b9b',
      // The controls take the accent blue here, which is the half of this
      // preset a porter is most likely to want.
      control: '#6ea8fe',
      accent: '#6ea8fe',
      'accent-soft': '#a7c4e8',
      'syn-note': '#d8dce4',
      'syn-number': '#d8dce4',
      'syn-comment': '#838b9b',
      'syn-operator': '#838b9b',
      'seg-free': '#333844',
      lane: '#16181d',
      'lane-sharp': '#12141a',
      'lane-rule': '#2c313b',
    },
  },
  {
    id: 'contrast',
    name: $localize`:@@theme.contrast:theme.contrast`,
    note: $localize`:@@theme.near-black-with-brighter-text:theme.near-black-with-brighter-text`,
    overrides: {
      surface: '#0a0a0a',
      raised: '#161616',
      inset: '#000000',
      edge: '#4a4a4a',
      ink: '#f5f5f5',
      'ink-muted': '#b0b0b0',
      control: '#c8c8c8',
      accent: '#8cbcff',
      'accent-soft': '#a7c4e8',
      'syn-note': '#f5f5f5',
      'syn-number': '#f5f5f5',
      'syn-comment': '#b0b0b0',
      'syn-operator': '#b0b0b0',
      'syn-hex': '#8cbcff',
      'syn-directive': '#8cbcff',
      'syn-channel': '#8cbcff',
      'seg-free': '#3d3d3d',
      lane: '#0a0a0a',
      'lane-sharp': '#000000',
      'lane-rule': '#4a4a4a',
    },
  },
  {
    id: 'warm',
    name: $localize`:@@theme.warm-grey:theme.warm-grey`,
    note: $localize`:@@theme.the-same-greys-turned-a:theme.the-same-greys-turned-a`,
    overrides: {
      surface: '#1a1918',
      raised: '#232120',
      inset: '#141312',
      edge: '#37342f',
      ink: '#e6e3dd',
      'ink-muted': '#968f86',
      control: '#a8a29a',
      accent: '#6ea8fe',
      'accent-soft': '#a7c4e8',
      'syn-note': '#e6e3dd',
      'syn-number': '#e6e3dd',
      'syn-comment': '#968f86',
      'syn-operator': '#968f86',
      'seg-free': '#37342f',
      lane: '#1a1918',
      'lane-sharp': '#141312',
      'lane-rule': '#37342f',
    },
  },
];
