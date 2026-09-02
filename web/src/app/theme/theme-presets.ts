/**
 * The themes the picker offers by name.
 *
 * A preset carries only what it moves off the stylesheet's own values, so the
 * default one carries nothing at all and every preset follows `styles.css` on
 * whatever it does not mention. None of them touch `--color-ch-*`: the eight are
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
    id: 'graphite',
    name: 'Graphite',
    note: 'Neutral grey, and what the app ships as',
    overrides: {},
  },
  {
    id: 'midnight',
    name: 'Midnight',
    note: 'The cooler, blue-tinted grey the editor used to open in',
    overrides: {
      surface: '#16181d',
      raised: '#1d2027',
      inset: '#12141a',
      edge: '#2c313b',
      ink: '#d8dce4',
      'ink-muted': '#838b9b',
      // The controls were the accent back then, which is the half of this
      // preset a porter is most likely to have come back for.
      control: '#6ea8fe',
      'syn-note': '#d8dce4',
      'syn-number': '#d8dce4',
      'syn-comment': '#838b9b',
      'syn-operator': '#838b9b',
      'seg-free': '#333844',
    },
  },
  {
    id: 'contrast',
    name: 'Contrast',
    note: 'Near-black, with brighter text',
    overrides: {
      surface: '#0a0a0a',
      raised: '#161616',
      inset: '#000000',
      edge: '#4a4a4a',
      ink: '#f5f5f5',
      'ink-muted': '#b0b0b0',
      control: '#c8c8c8',
      accent: '#8cbcff',
      'syn-note': '#f5f5f5',
      'syn-number': '#f5f5f5',
      'syn-comment': '#b0b0b0',
      'syn-operator': '#b0b0b0',
      'syn-hex': '#8cbcff',
      'syn-directive': '#8cbcff',
      'syn-channel': '#8cbcff',
      'seg-free': '#3d3d3d',
    },
  },
  {
    id: 'warm',
    name: 'Warm grey',
    note: 'The same greys, turned a little towards brown',
    overrides: {
      surface: '#1a1918',
      raised: '#232120',
      inset: '#141312',
      edge: '#37342f',
      ink: '#e6e3dd',
      'ink-muted': '#968f86',
      control: '#a8a29a',
      'syn-note': '#e6e3dd',
      'syn-number': '#e6e3dd',
      'syn-comment': '#968f86',
      'syn-operator': '#968f86',
      'seg-free': '#37342f',
    },
  },
];
