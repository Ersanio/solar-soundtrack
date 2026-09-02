/**
 * The colours the porter may change, and how the picker groups them.
 *
 * Every token here is one `--color-*` custom property in `styles.css`, which
 * holds the value; this file holds the name, the label and the group, and the
 * property is derived from the name rather than spelled a second time. Adding a
 * colour to the theme means adding it in both places, and nothing else — the
 * picker builds its rows from this list.
 */

export type ThemeTokenName =
  | 'surface'
  | 'raised'
  | 'inset'
  | 'edge'
  | 'ink'
  | 'ink-muted'
  | 'control'
  | 'accent'
  | 'accent-soft'
  | 'danger'
  | 'severe'
  | 'warn'
  | 'good'
  | 'syn-comment'
  | 'syn-directive'
  | 'syn-channel'
  | 'syn-note'
  | 'syn-command'
  | 'syn-loop'
  | 'syn-operator'
  | 'syn-string'
  | 'syn-hex'
  | 'syn-hex-arg'
  | 'syn-number'
  | 'syn-invalid'
  | 'seg-driver'
  | 'seg-song'
  | 'seg-samples'
  | 'seg-echo'
  | 'seg-free'
  | 'ch-0'
  | 'ch-1'
  | 'ch-2'
  | 'ch-3'
  | 'ch-4'
  | 'ch-5'
  | 'ch-6'
  | 'ch-7';

export type ThemeGroup = 'chrome' | 'text' | 'status' | 'syntax' | 'aram' | 'channels';

export interface ThemeToken {
  readonly name: ThemeTokenName;
  /** What the picker calls it. */
  readonly label: string;
  readonly group: ThemeGroup;
  /** One line saying where in the app it shows. */
  readonly hint: string;
}

export interface ThemeGroupDef {
  readonly id: ThemeGroup;
  readonly label: string;
}

/** The picker's sections, in the order it draws them. */
export const THEME_GROUPS: readonly ThemeGroupDef[] = [
  { id: 'chrome', label: 'Surfaces' },
  { id: 'text', label: 'Text' },
  { id: 'status', label: 'Controls and highlights' },
  { id: 'syntax', label: 'Source colouring' },
  { id: 'aram', label: 'ARAM budget bar' },
  { id: 'channels', label: 'Music channels' },
];

/** Every token, in the order the picker lists them within their groups. */
export const THEME_TOKENS: readonly ThemeToken[] = [
  { name: 'surface', label: 'Surface', group: 'chrome', hint: 'The page behind everything' },
  { name: 'raised', label: 'Raised', group: 'chrome', hint: 'Toolbars, panels and popups' },
  { name: 'inset', label: 'Inset', group: 'chrome', hint: 'Wells and the hex dump' },
  { name: 'edge', label: 'Edge', group: 'chrome', hint: 'Borders and seams' },

  { name: 'ink', label: 'Ink', group: 'text', hint: 'Body text and note letters' },
  { name: 'ink-muted', label: 'Muted ink', group: 'text', hint: 'Labels, hints and comments' },

  { name: 'control', label: 'Controls', group: 'status', hint: 'Buttons, checkboxes and sliders' },
  {
    name: 'accent',
    label: 'Accent',
    group: 'status',
    hint: 'Focus rings, the caret, the playhead',
  },
  { name: 'accent-soft', label: 'Soft accent', group: 'status', hint: 'A tooltip’s source line' },
  {
    name: 'danger',
    label: 'Error',
    group: 'status',
    hint: 'Errors, and text the compiler refuses',
  },
  { name: 'severe', label: 'Severe', group: 'status', hint: 'Severe warnings' },
  { name: 'warn', label: 'Warning', group: 'status', hint: 'Warnings' },
  { name: 'good', label: 'Good', group: 'status', hint: 'Success' },

  { name: 'syn-note', label: 'Notes', group: 'syntax', hint: 'a b c, rests and ties' },
  {
    name: 'syn-command',
    label: 'Music commands',
    group: 'syntax',
    hint: 'o l v t y q @ and the rest',
  },
  { name: 'syn-hex', label: 'Hex commands', group: 'syntax', hint: '$E7 and its kind' },
  {
    name: 'syn-hex-arg',
    label: 'Hex arguments',
    group: 'syntax',
    hint: 'The bytes after a $ command',
  },
  { name: 'syn-number', label: 'Numbers', group: 'syntax', hint: 'A command’s own digits' },
  { name: 'syn-loop', label: 'Loops and labels', group: 'syntax', hint: '[ ] (1) (!1)' },
  { name: 'syn-operator', label: 'Operators', group: 'syntax', hint: '* / | and loop calls' },
  { name: 'syn-directive', label: 'Directives', group: 'syntax', hint: '#amk, #spc, #samples' },
  { name: 'syn-channel', label: 'Channel markers', group: 'syntax', hint: '#0 to #7' },
  { name: 'syn-string', label: 'Text', group: 'syntax', hint: 'Quoted text and replacements' },
  { name: 'syn-comment', label: 'Comments', group: 'syntax', hint: 'Anything after a ;' },
  { name: 'syn-invalid', label: 'Unknown', group: 'syntax', hint: 'Text the scanner cannot place' },

  { name: 'seg-driver', label: 'Driver', group: 'aram', hint: 'The driver in ARAM' },
  { name: 'seg-song', label: 'Song', group: 'aram', hint: 'Song data in ARAM' },
  { name: 'seg-samples', label: 'Samples', group: 'aram', hint: 'Sample data in ARAM' },
  { name: 'seg-echo', label: 'Echo', group: 'aram', hint: 'The echo buffer in ARAM' },
  { name: 'seg-free', label: 'Free', group: 'aram', hint: 'ARAM still unspent' },

  { name: 'ch-0', label: 'Channel 0', group: 'channels', hint: '#0' },
  { name: 'ch-1', label: 'Channel 1', group: 'channels', hint: '#1' },
  { name: 'ch-2', label: 'Channel 2', group: 'channels', hint: '#2' },
  { name: 'ch-3', label: 'Channel 3', group: 'channels', hint: '#3' },
  { name: 'ch-4', label: 'Channel 4', group: 'channels', hint: '#4' },
  { name: 'ch-5', label: 'Channel 5', group: 'channels', hint: '#5' },
  { name: 'ch-6', label: 'Channel 6', group: 'channels', hint: '#6' },
  { name: 'ch-7', label: 'Channel 7', group: 'channels', hint: '#7' },
];

/** Every colour the app is drawn in. */
export type Palette = Readonly<Record<ThemeTokenName, string>>;

/** Only what the porter has moved off the stylesheet's own value. */
export type Overrides = Readonly<Partial<Record<ThemeTokenName, string>>>;

const TOKEN_NAMES: ReadonlySet<string> = new Set(THEME_TOKENS.map((token) => token.name));

/** The custom property a token stands for. Derived, so the name is written once. */
export function propertyOf(name: ThemeTokenName): string {
  return `--color-${name}`;
}

export function isTokenName(value: unknown): value is ThemeTokenName {
  return typeof value === 'string' && TOKEN_NAMES.has(value);
}

/**
 * `#rgb` and `#rrggbb`, which is all `<input type="color">` will ever produce.
 *
 * Narrow on purpose. What comes back from storage was typed by hand as often as
 * not, and a custom property takes any text at all — an unparseable value would
 * be installed silently and simply not paint, which looks like the theme being
 * broken rather than like a setting being wrong.
 */
export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}
