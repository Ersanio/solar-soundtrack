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
  { id: 'chrome', label: $localize`:@@theme.token.surfaces.label:theme.token.surfaces.label` },
  { id: 'text', label: $localize`:@@theme.token.text.label:theme.token.text.label` },
  {
    id: 'status',
    label: $localize`:@@theme.token.controls-and-highlights.label:theme.token.controls-and-highlights.label`,
  },
  {
    id: 'syntax',
    label: $localize`:@@theme.token.source-colouring.label:theme.token.source-colouring.label`,
  },
  {
    id: 'aram',
    label: $localize`:@@theme.token.aram-budget-bar.label:theme.token.aram-budget-bar.label`,
  },
  {
    id: 'channels',
    label: $localize`:@@theme.token.music-channels.label:theme.token.music-channels.label`,
  },
];

/** Every token, in the order the picker lists them within their groups. */
export const THEME_TOKENS: readonly ThemeToken[] = [
  {
    name: 'surface',
    label: $localize`:@@theme.token.surface.label:theme.token.surface.label`,
    group: 'chrome',
    hint: $localize`:@@theme.token.the-page-behind-everything.hint:theme.token.the-page-behind-everything.hint`,
  },
  {
    name: 'raised',
    label: $localize`:@@theme.token.raised.label:theme.token.raised.label`,
    group: 'chrome',
    hint: $localize`:@@theme.token.toolbars-panels-and-popups.hint:theme.token.toolbars-panels-and-popups.hint`,
  },
  {
    name: 'inset',
    label: $localize`:@@theme.token.inset.label:theme.token.inset.label`,
    group: 'chrome',
    hint: $localize`:@@theme.token.wells-and-the-hex-dump.hint:theme.token.wells-and-the-hex-dump.hint`,
  },
  {
    name: 'edge',
    label: $localize`:@@theme.token.edge.label:theme.token.edge.label`,
    group: 'chrome',
    hint: $localize`:@@theme.token.borders-and-seams.hint:theme.token.borders-and-seams.hint`,
  },

  {
    name: 'ink',
    label: $localize`:@@theme.token.ink.label:theme.token.ink.label`,
    group: 'text',
    hint: $localize`:@@theme.token.body-text-and-note-letters.hint:theme.token.body-text-and-note-letters.hint`,
  },
  {
    name: 'ink-muted',
    label: $localize`:@@theme.token.muted-ink.label:theme.token.muted-ink.label`,
    group: 'text',
    hint: $localize`:@@theme.token.labels-hints-and-comments.hint:theme.token.labels-hints-and-comments.hint`,
  },

  {
    name: 'control',
    label: $localize`:@@theme.token.controls.label:theme.token.controls.label`,
    group: 'status',
    hint: $localize`:@@theme.token.buttons-checkboxes-and-sliders.hint:theme.token.buttons-checkboxes-and-sliders.hint`,
  },
  {
    name: 'accent',
    label: $localize`:@@theme.token.accent.label:theme.token.accent.label`,
    group: 'status',
    hint: $localize`:@@theme.token.focus-rings-the-caret-the.hint:theme.token.focus-rings-the-caret-the.hint`,
  },
  {
    name: 'accent-soft',
    label: $localize`:@@theme.token.soft-accent.label:theme.token.soft-accent.label`,
    group: 'status',
    hint: $localize`:@@theme.token.a-tooltips-source-line.hint:theme.token.a-tooltips-source-line.hint`,
  },
  {
    name: 'danger',
    label: $localize`:@@theme.token.error.label:theme.token.error.label`,
    group: 'status',
    hint: $localize`:@@theme.token.errors-and-text-the-compiler.hint:theme.token.errors-and-text-the-compiler.hint`,
  },
  {
    name: 'severe',
    label: $localize`:@@theme.token.severe.label:theme.token.severe.label`,
    group: 'status',
    hint: $localize`:@@theme.token.severe-warnings.hint:theme.token.severe-warnings.hint`,
  },
  {
    name: 'warn',
    label: $localize`:@@theme.token.warning.label:theme.token.warning.label`,
    group: 'status',
    hint: $localize`:@@theme.token.warnings.hint:theme.token.warnings.hint`,
  },
  {
    name: 'good',
    label: $localize`:@@theme.token.good.label:theme.token.good.label`,
    group: 'status',
    hint: $localize`:@@theme.token.success.hint:theme.token.success.hint`,
  },

  {
    name: 'syn-note',
    label: $localize`:@@theme.token.notes.label:theme.token.notes.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.a-b-c-rests-and.hint:theme.token.a-b-c-rests-and.hint`,
  },
  {
    name: 'syn-command',
    label: $localize`:@@theme.token.music-commands.label:theme.token.music-commands.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.o-l-v-t-y.hint:theme.token.o-l-v-t-y.hint`,
  },
  {
    name: 'syn-hex',
    label: $localize`:@@theme.token.hex-commands.label:theme.token.hex-commands.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.e7-and-its-kind.hint:theme.token.e7-and-its-kind.hint`,
  },
  {
    name: 'syn-hex-arg',
    label: $localize`:@@theme.token.hex-arguments.label:theme.token.hex-arguments.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.the-bytes-after-a-command.hint:theme.token.the-bytes-after-a-command.hint`,
  },
  {
    name: 'syn-number',
    label: $localize`:@@theme.token.numbers.label:theme.token.numbers.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.a-commands-own-digits.hint:theme.token.a-commands-own-digits.hint`,
  },
  {
    name: 'syn-loop',
    label: $localize`:@@theme.token.loops-and-labels.label:theme.token.loops-and-labels.label`,
    group: 'syntax',
    hint: '[ ] (1) (!1)',
  },
  {
    name: 'syn-operator',
    label: $localize`:@@theme.token.operators.label:theme.token.operators.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.and-loop-calls.hint:theme.token.and-loop-calls.hint`,
  },
  {
    name: 'syn-directive',
    label: $localize`:@@theme.token.directives.label:theme.token.directives.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.amk-spc-samples.hint:theme.token.amk-spc-samples.hint`,
  },
  {
    name: 'syn-channel',
    label: $localize`:@@theme.token.channel-markers.label:theme.token.channel-markers.label`,
    group: 'syntax',
    hint: '#0 to #7',
  },
  {
    name: 'syn-string',
    label: $localize`:@@theme.token.text.label:theme.token.text.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.quoted-text-and-replacements.hint:theme.token.quoted-text-and-replacements.hint`,
  },
  {
    name: 'syn-comment',
    label: $localize`:@@theme.token.comments.label:theme.token.comments.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.anything-after-a.hint:theme.token.anything-after-a.hint`,
  },
  {
    name: 'syn-invalid',
    label: $localize`:@@theme.token.unknown.label:theme.token.unknown.label`,
    group: 'syntax',
    hint: $localize`:@@theme.token.text-the-scanner-cannot-place.hint:theme.token.text-the-scanner-cannot-place.hint`,
  },

  {
    name: 'seg-driver',
    label: $localize`:@@theme.token.driver.label:theme.token.driver.label`,
    group: 'aram',
    hint: $localize`:@@theme.token.the-driver-in-aram.hint:theme.token.the-driver-in-aram.hint`,
  },
  {
    name: 'seg-song',
    label: $localize`:@@theme.token.song.label:theme.token.song.label`,
    group: 'aram',
    hint: $localize`:@@theme.token.song-data-in-aram.hint:theme.token.song-data-in-aram.hint`,
  },
  {
    name: 'seg-samples',
    label: $localize`:@@theme.token.samples.label:theme.token.samples.label`,
    group: 'aram',
    hint: $localize`:@@theme.token.sample-data-in-aram.hint:theme.token.sample-data-in-aram.hint`,
  },
  {
    name: 'seg-echo',
    label: $localize`:@@theme.token.echo.label:theme.token.echo.label`,
    group: 'aram',
    hint: $localize`:@@theme.token.the-echo-buffer-in-aram.hint:theme.token.the-echo-buffer-in-aram.hint`,
  },
  {
    name: 'seg-free',
    label: $localize`:@@theme.token.free.label:theme.token.free.label`,
    group: 'aram',
    hint: $localize`:@@theme.token.aram-still-unspent.hint:theme.token.aram-still-unspent.hint`,
  },

  {
    name: 'ch-0',
    label: $localize`:@@theme.token.channel.label:theme.token.channel.label`,
    group: 'channels',
    hint: '#0',
  },
  {
    name: 'ch-1',
    label: $localize`:@@theme.token.channel.label-2:theme.token.channel.label-2`,
    group: 'channels',
    hint: '#1',
  },
  {
    name: 'ch-2',
    label: $localize`:@@theme.token.channel.label-3:theme.token.channel.label-3`,
    group: 'channels',
    hint: '#2',
  },
  {
    name: 'ch-3',
    label: $localize`:@@theme.token.channel.label-4:theme.token.channel.label-4`,
    group: 'channels',
    hint: '#3',
  },
  {
    name: 'ch-4',
    label: $localize`:@@theme.token.channel.label-5:theme.token.channel.label-5`,
    group: 'channels',
    hint: '#4',
  },
  {
    name: 'ch-5',
    label: $localize`:@@theme.token.channel.label-6:theme.token.channel.label-6`,
    group: 'channels',
    hint: '#5',
  },
  {
    name: 'ch-6',
    label: $localize`:@@theme.token.channel.label-7:theme.token.channel.label-7`,
    group: 'channels',
    hint: '#6',
  },
  {
    name: 'ch-7',
    label: $localize`:@@theme.token.channel.label-8:theme.token.channel.label-8`,
    group: 'channels',
    hint: '#7',
  },
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
