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
  { id: 'chrome', label: $localize`:@@theme.token.surfaces.label:Surfaces` },
  { id: 'text', label: $localize`:@@theme.token.text.label:Text` },
  {
    id: 'status',
    label: $localize`:@@theme.token.controls-and-highlights.label:Controls and highlights`,
  },
  { id: 'syntax', label: $localize`:@@theme.token.source-colouring.label:Source colouring` },
  { id: 'aram', label: $localize`:@@theme.token.aram-budget-bar.label:ARAM budget bar` },
  { id: 'channels', label: $localize`:@@theme.token.music-channels.label:Music channels` },
];

/** Every token, in the order the picker lists them within their groups. */
export const THEME_TOKENS: readonly ThemeToken[] = [
  {
    name: 'surface',
    label: $localize`:@@theme.token.surface.label:Surface`,
    group: 'chrome',
    hint: $localize`:@@theme.token.the-page-behind-everything.hint:The page behind everything`,
  },
  {
    name: 'raised',
    label: $localize`:@@theme.token.raised.label:Raised`,
    group: 'chrome',
    hint: $localize`:@@theme.token.toolbars-panels-and-popups.hint:Toolbars, panels and popups`,
  },
  {
    name: 'inset',
    label: $localize`:@@theme.token.inset.label:Inset`,
    group: 'chrome',
    hint: $localize`:@@theme.token.wells-and-the-hex-dump.hint:Wells and the hex dump`,
  },
  {
    name: 'edge',
    label: $localize`:@@theme.token.edge.label:Edge`,
    group: 'chrome',
    hint: $localize`:@@theme.token.borders-and-seams.hint:Borders and seams`,
  },

  {
    name: 'ink',
    label: $localize`:@@theme.token.ink.label:Ink`,
    group: 'text',
    hint: $localize`:@@theme.token.body-text-and-note-letters.hint:Body text and note letters`,
  },
  {
    name: 'ink-muted',
    label: $localize`:@@theme.token.muted-ink.label:Muted ink`,
    group: 'text',
    hint: $localize`:@@theme.token.labels-hints-and-comments.hint:Labels, hints and comments`,
  },

  {
    name: 'control',
    label: $localize`:@@theme.token.controls.label:Controls`,
    group: 'status',
    hint: $localize`:@@theme.token.buttons-checkboxes-and-sliders.hint:Buttons, checkboxes and sliders`,
  },
  {
    name: 'accent',
    label: $localize`:@@theme.token.accent.label:Accent`,
    group: 'status',
    hint: $localize`:@@theme.token.focus-rings-the-caret-the.hint:Focus rings, the caret, the playhead`,
  },
  {
    name: 'accent-soft',
    label: $localize`:@@theme.token.soft-accent.label:Soft accent`,
    group: 'status',
    hint: $localize`:@@theme.token.a-tooltips-source-line.hint:A tooltip’s source line`,
  },
  {
    name: 'danger',
    label: $localize`:@@theme.token.error.label:Error`,
    group: 'status',
    hint: $localize`:@@theme.token.errors-and-text-the-compiler.hint:Errors, and text the compiler refuses`,
  },
  {
    name: 'severe',
    label: $localize`:@@theme.token.severe.label:Severe`,
    group: 'status',
    hint: $localize`:@@theme.token.severe-warnings.hint:Severe warnings`,
  },
  {
    name: 'warn',
    label: $localize`:@@theme.token.warning.label:Warning`,
    group: 'status',
    hint: $localize`:@@theme.token.warnings.hint:Warnings`,
  },
  {
    name: 'good',
    label: $localize`:@@theme.token.good.label:Good`,
    group: 'status',
    hint: $localize`:@@theme.token.success.hint:Success`,
  },

  {
    name: 'syn-note',
    label: $localize`:@@theme.token.notes.label:Notes`,
    group: 'syntax',
    hint: $localize`:@@theme.token.a-b-c-rests-and.hint:a b c, rests and ties`,
  },
  {
    name: 'syn-command',
    label: $localize`:@@theme.token.music-commands.label:Music commands`,
    group: 'syntax',
    hint: $localize`:@@theme.token.o-l-v-t-y.hint:o l v t y q @ and the rest`,
  },
  {
    name: 'syn-hex',
    label: $localize`:@@theme.token.hex-commands.label:Hex commands`,
    group: 'syntax',
    hint: $localize`:@@theme.token.e7-and-its-kind.hint:$E7 and its kind`,
  },
  {
    name: 'syn-hex-arg',
    label: $localize`:@@theme.token.hex-arguments.label:Hex arguments`,
    group: 'syntax',
    hint: $localize`:@@theme.token.the-bytes-after-a-command.hint:The bytes after a $ command`,
  },
  {
    name: 'syn-number',
    label: $localize`:@@theme.token.numbers.label:Numbers`,
    group: 'syntax',
    hint: $localize`:@@theme.token.a-commands-own-digits.hint:A command’s own digits`,
  },
  {
    name: 'syn-loop',
    label: $localize`:@@theme.token.loops-and-labels.label:Loops and labels`,
    group: 'syntax',
    hint: '[ ] (1) (!1)',
  },
  {
    name: 'syn-operator',
    label: $localize`:@@theme.token.operators.label:Operators`,
    group: 'syntax',
    hint: $localize`:@@theme.token.and-loop-calls.hint:* / | and loop calls`,
  },
  {
    name: 'syn-directive',
    label: $localize`:@@theme.token.directives.label:Directives`,
    group: 'syntax',
    hint: $localize`:@@theme.token.amk-spc-samples.hint:#amk, #spc, #samples`,
  },
  {
    name: 'syn-channel',
    label: $localize`:@@theme.token.channel-markers.label:Channel markers`,
    group: 'syntax',
    hint: '#0 to #7',
  },
  {
    name: 'syn-string',
    label: $localize`:@@theme.token.text.label:Text`,
    group: 'syntax',
    hint: $localize`:@@theme.token.quoted-text-and-replacements.hint:Quoted text and replacements`,
  },
  {
    name: 'syn-comment',
    label: $localize`:@@theme.token.comments.label:Comments`,
    group: 'syntax',
    hint: $localize`:@@theme.token.anything-after-a.hint:Anything after a ;`,
  },
  {
    name: 'syn-invalid',
    label: $localize`:@@theme.token.unknown.label:Unknown`,
    group: 'syntax',
    hint: $localize`:@@theme.token.text-the-scanner-cannot-place.hint:Text the scanner cannot place`,
  },

  {
    name: 'seg-driver',
    label: $localize`:@@theme.token.driver.label:Driver`,
    group: 'aram',
    hint: $localize`:@@theme.token.the-driver-in-aram.hint:The driver in ARAM`,
  },
  {
    name: 'seg-song',
    label: $localize`:@@theme.token.song.label:Song`,
    group: 'aram',
    hint: $localize`:@@theme.token.song-data-in-aram.hint:Song data in ARAM`,
  },
  {
    name: 'seg-samples',
    label: $localize`:@@theme.token.samples.label:Samples`,
    group: 'aram',
    hint: $localize`:@@theme.token.sample-data-in-aram.hint:Sample data in ARAM`,
  },
  {
    name: 'seg-echo',
    label: $localize`:@@theme.token.echo.label:Echo`,
    group: 'aram',
    hint: $localize`:@@theme.token.the-echo-buffer-in-aram.hint:The echo buffer in ARAM`,
  },
  {
    name: 'seg-free',
    label: $localize`:@@theme.token.free.label:Free`,
    group: 'aram',
    hint: $localize`:@@theme.token.aram-still-unspent.hint:ARAM still unspent`,
  },

  {
    name: 'ch-0',
    label: $localize`:@@theme.token.channel.label:Channel 0`,
    group: 'channels',
    hint: '#0',
  },
  {
    name: 'ch-1',
    label: $localize`:@@theme.token.channel.label-2:Channel 1`,
    group: 'channels',
    hint: '#1',
  },
  {
    name: 'ch-2',
    label: $localize`:@@theme.token.channel.label-3:Channel 2`,
    group: 'channels',
    hint: '#2',
  },
  {
    name: 'ch-3',
    label: $localize`:@@theme.token.channel.label-4:Channel 3`,
    group: 'channels',
    hint: '#3',
  },
  {
    name: 'ch-4',
    label: $localize`:@@theme.token.channel.label-5:Channel 4`,
    group: 'channels',
    hint: '#4',
  },
  {
    name: 'ch-5',
    label: $localize`:@@theme.token.channel.label-6:Channel 5`,
    group: 'channels',
    hint: '#5',
  },
  {
    name: 'ch-6',
    label: $localize`:@@theme.token.channel.label-7:Channel 6`,
    group: 'channels',
    hint: '#6',
  },
  {
    name: 'ch-7',
    label: $localize`:@@theme.token.channel.label-8:Channel 7`,
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
