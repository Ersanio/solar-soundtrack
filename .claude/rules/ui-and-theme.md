---
paths:
  - 'web/src/styles.css'
  - 'web/src/index.html'
  - 'web/src/app/theme/**'
  - 'web/src/app/shared/**'
  - 'web/src/app/status-bar/**'
  - 'web/src/app/state/theme-store.ts'
  - 'web/src/app/util/channel-palette.ts'
---

# UI and theme

Read before changing `styles.css` colours, `ThemeStore` and its presets, the panes, sidebar, tabs
or shared controls.

## Colour sets

Styling is Tailwind v4, with the entire theme as CSS variables in `web/src/styles.css` (v4 has no
`tailwind.config.js`). Dark-only on purpose. Two **validated categorical sets** live there —
`--color-seg-*` for the ARAM bar and `--color-ch-*` for the eight music channels — and neither may be
reordered or re-hued **in that file** without re-validating, since adjacent-pair CVD separation and
contrast against `--color-surface` are the properties being preserved. The order is the mechanism,
not decoration: it is what the adjacent-pair check runs against. The ground is part of the
validation too: both sets are validated against `--color-surface` at `#1e272e`, every check passing
and the worst contrast at ch-5 (3.07:1), and the eight drop below 3:1 above `#1f282f`, so the
default surface may not be lighter than that without re-validating. `--color-ch-*` does not clear
the all-pairs gate and no set of eight can, so nothing may leave channel identity to colour alone;
`styles.css` says what carries it instead.

Those values are **defaults**, and `ThemeStore` lets a porter override any of them — the eight
channels included — from the top bar's picker. That is not a hole in the paragraph above, it is what
the paragraph's last sentence buys: the app never said anything with a channel's colour that it was
not also saying with a number, a tooltip or a strike-through, so a porter putting two channels on
one hue loses a convenience and breaks no claim. What still has to be re-validated is a change to
the defaults themselves, which is the set every porter starts from. A preset in
`theme-presets.ts` is held to the same bar and none of the shipped five touch the eight.

## The theme is one file, and the porter may change it

Every colour the app draws in is a `--color-*` custom property in `src/styles.css`, and every
consumer reaches it through `var()` — the Tailwind utilities, `codemirror/mml-theme.ts`,
`shared/slider/slider-track.ts`, and the roll's SVG through the class-name arrays in
`util/channel-palette.ts`. Nothing anywhere holds a hex literal.

That is what makes the theme changeable at runtime for free. `state/theme-store.ts` puts the
porter's chosen colours on `document.documentElement` as inline custom properties, which outrank the
`:root` rule Tailwind emits, so one write re-tints the whole app including the piano roll. The
picker in the top bar (`theme/theme-picker/`, on the `shared/popover/` the changelog shares) offers
the presets in `theme/theme-presets.ts` and a `shared/color-field/` per token;
`theme/theme-tokens.ts` is the list, and the property name is derived from each token's name rather
than spelled twice. **Studio** is the default and carries no overrides at all — it is the
stylesheet's own values, a blue-grey chrome with an orange accent — and **Graphite** is the neutral
grey; every other preset names its accent explicitly, so it renders the same whatever the
stylesheet's accent is.

Two families of token are deliberately not shared. The controls have three of their own:
`--color-control`, FL's pale blue-grey display face, for emphasis short of being on — a primary
button's tint, a slider's fill, the open tab's rule; `--color-lit`, FL Studio's amber, which a
toggle that is on glows in; and `--color-led`, FL's lime, for the small
lights — the mixer's channel lights and a kept sample's lock. None of them is `--color-accent`,
which means _this is where the music is_: the playhead, a lit key, the caret, the focus ring, and
the transport's pause glyph while the song runs. One token for both would make a neutral chrome
cost a neutral playhead. By default the accent and `--color-lit` are both warm, so orange alone no
longer says "the music": a lit control is a whole plate and the accent never is, and a porter who
wants them apart moves either one. And `--color-syn-*` is the source view's colouring, one token per tag in
`TOKEN_TAGS`, shared with nothing at all — `codemirror/mml-theme.ts`'s highlight table reads only
those, while its structure block (gutters, tooltips, diagnostic underlines) stays on the app's
palette, being chrome rather than MML.

Three things are worth knowing before changing any of it. The defaults are read _off the document_
rather than copied into TypeScript, so `styles.css` stays the only place they are written, and
resetting a token removes the inline property rather than writing a default back. Only the tokens
actually changed are stored, so a porter who moved one colour still follows the app on the rest. And
a colour input reports a drag continuously, so `preview` and `commit` are split the way
`shared/slider/`'s are — only the second is written down. The hex field beside each swatch keeps
the same split: six digits preview as they are typed, Enter or leaving the field commits, three
digits are taken on commit, and text that is not a colour is put back, as is a preview Escape
gives up.

The one thing outside CSS is `<meta name="theme-color">` in `index.html`, which the store keeps in
step; the manifest's copy is baked into an installed app and cannot follow.

## The controls' material

Every button and toggle is drawn from `@utility` blocks in `styles.css`, in the mould of FL
Studio's, and nowhere else. **A button is raised and a toggle is sunk**, and that shape is what
tells an action from a state:

- `plate` is a button. It is a shaded face mixed from `--color-raised` toward `--color-ink`, with
  an `--color-inset` rim and a lit top edge. Hover lightens it a step and a press sinks it. A
  primary or danger button tints the face through `--plate-face`.
- `recess` is a toggle. It is set into the chrome, with a shadow inside its rim and a light
  catch on its lower lip.
- `recess-lit` turns the recess on, as FL lights a mode: an amber floor, a pale yellow core, a
  deeper orange toward an orange rim, and a burnt-orange label, so a toggle that is on still
  reads as set in. Every part is derived from one tone, `--lit-tone` (default `--color-lit`),
  which is how an armed Record lights red; `--lit-warmth: 0` keeps a tone's own hue in the core.
  The floor, the shadows and `--recess-glow`, the core's registered colour, all fade, so
  switching is seen rather than jumping. `Toggle` lists them in its transition, which is why it
  builds on `CONTROL_BASE` rather than on a button's `transition-colors`.
- **A toggle never changes width.** A lit label, and a selected segment's, is drawn heavier with
  a text stroke (`HEAVY` in `toggle.ts`) rather than set in a heavier font, which would widen it
  and push the rest of the toolbar along.
- `well` is the recessed ground of a segment track and of the transport's clock.
- `led` and `led-on` are the round light.

Every colour in them is mixed from tokens, so a preset or a porter's override re-tints the controls
with everything else. Only the shadows are black, being darkness rather than a colour.

- **Who wears what.** `shared/button/` and `shared/toggle/` say which variant wears which.
  `buttonClass()` lends a button's classes to an element that cannot be one: the Add samples
  `<label>`, and the palettes' entries through `ENTRY_CLASS`. `amk-button-group` joins plates into
  one housing — the transport's Play and Stop, Undo and Redo, the roll's zoom pairs. The
  transport's is FL's: a `pill` group of `dark` plates, the inset's grey rimmed through
  `--plate-rim` in the seam colour. The top bar's two exports are `dark` plates too.
- **Toggles.** A toggle that is on is a lit recess, and so is the one of several that is selected:
  ADSR or GAIN, a preset, an echo filter, the channel bits of a mask. The exception is the
  palettes' category segments, which are raised in a well and never lit, because a filter that
  picks which buttons are shown must not look like the buttons it shows.
- **The small lights.** A sample's keep is a bare lock, the toggle's `indicator` variant. The
  mixer's mute is a light, lit while the channel is heard. FL Studio draws both that way.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/ui-and-theme.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **Template method calls per row** — `computed`, `eslint.config.js`
- **The channel mixer and the roll's picker naming their channels without tinting them** —
  `CHANNEL_FILL`, `--color-ch-0`, `--color-ch-6`
- **The palette's class names living in `piano-roll/roll-metrics.ts`** — `util/channel-palette.ts`,
  `roll-metrics.ts`
- **The theme's default colours written a second time in TypeScript** — `readDefaults`,
  `getComputedStyle`, `styles.css`, `removeProperty`
- **Storing the whole palette rather than only what was changed** — `ThemeStore.overrides`,
  `styles.css`
- **Re-hueing the eight channels for a preset's chrome** — `--color-surface`
- **The controls painted in `--color-accent`** — `--color-control`, `primary`, `default`, `danger`
- **The source view's colouring drawn from the app's palette** — `TOKEN_TAGS`
- **A preview folded into the stored overrides** — `input`, `localStorage`, `ThemeStore.previewing`,
  `preview`, `commit`, `Slider`, `NumberField`
- **The view tabs in the editor panel's header, with the development notice beside them** —
  `TabDef`, `aside`
- **Hot Reload, Loop and Follow playback as checkboxes**
- **The compile status in the output panel's header** — `status-bar/`
- **The sidebar ordered stats, ARAM, diagnostics, inspector, hex dump**
- **The sidebar's sections as native `<details>`** — `EditorRequests.revealSection`
- **The two panes stacked below `lg` with no seam between them**
- **`--color-control` a neutral grey** — `--color-accent`
- **The default surface at `#191919`**
- **The mixer's solo `S` lit on `bg-control/25`** — `--color-ch-0`, `--color-ch-6`
- **The theme picker and the changelog each carrying a trigger, a panel, `Escape` and the
  outside-press close of their own**
- **Buttons as flat bordered rectangles told apart by a `--color-control` tint** — `plate`,
  `buttonClass`, `primary`
- **A toggle that is on tinted `bg-control/20`** — `--color-lit`, `recess-lit`, `--color-accent`
- **The one of several that is selected drawn by swapping a button's variant** — `amk-toggle`,
  `envelope-tuner`, `fir-designer`, `echo-config`
- **Checkboxes for a sample's keep, Optimize samples and the channel bits** — `amk-checkbox`,
  `indicator`, `bit-toggles`
- **The mixer's M lit in `--color-danger` while muted** — `--color-led`, `led`
- **An armed Record shown by its dot alone** — `tone`, `--lit-tone`
- **Hand-written copies of a button's classes** — `entryClass`, `ENTRY_CLASS`, `command-chip`,
  `audition-button`, `buttonClass`
- **Toggles on the same raised plate as buttons** — `recess`, `plate`, `plate-lit`
- **A lit toggle as a flat `--color-lit` floor labelled in `--color-inset`** — `recess-lit`,
  `--recess-glow`, `--lit-warmth`, `CONTROL_BASE`
- **A toggle's label set in `font-medium` when on** — `HEAVY`, `SEGMENT_ON`
- **Play and Stop as chrome-grey plates with small corners** — `dark`, `pill`, `--plate-rim`
- **The transport in a darker box of its own inside the top bar** — `amk-transport-controls`,
  `amk-top-bar`
