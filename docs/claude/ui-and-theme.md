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

## Decisions already made

- **Template method calls per row** — the sample browser decoded 64 BRR samples on every
  change-detection pass, ten times a second while playing. Panels build one `computed` view model;
  the `no-call-expression` note in `eslint.config.js` says why lint cannot catch it.
- **The channel mixer and the roll's picker naming their channels without tinting them**, so that
  `--color-ch-*` lived in the roll's marks and the minimap alone — it made the two controls that
  name a channel the two pictures that would not show its colour, and matching a note seen in the
  roll to the chip that edits it or the buttons that silence it meant reading a digit off eight
  identical grey plates. Both wear the channel's own colour now, from the literal `bg-ch-*` names
  spelled out for the reason `CHANNEL_FILL` gives, with `text-ink` over it because that is what the
  roll's own bars label themselves in on those same eight grounds. The rule the old shape was
  protecting is untouched: the number stays, a silenced channel is still struck through, and the
  eight still do not clear the all-pairs separation gate. What the fill can no longer say is which
  chip is being **edited**, and that is a near-white ring rather than a dimming of the other seven:
  dimming is what a silenced channel already means, and it would have said a channel was inaudible
  for not being edited. The solo's own ring is not a blue either — a mid blue disappears into
  `--color-ch-0` and `--color-ch-6` — so it is a dark ring against the
  edited one's light, which is the lightness axis the eight leave free and the same one the roll's
  glyph plates are told apart on. It yields to the edited chip where one is both — an element has
  one ring, and a solo says itself anyway, being the channel the strike-through has left alone.
- **The palette's class names living in `piano-roll/roll-metrics.ts`** — the mixer is not part of
  the roll, so it would have had to reach into it or keep a second copy of `bg-ch-*` under the same
  name, and a chip that disagreed with a bar about which blue channel 0 is would be worse than no
  colour at all. `util/channel-palette.ts` is the one home for all five arrays; `roll-metrics.ts`
  keeps the geometry and the two muted opacities, which are the roll's own.
- **The theme's default colours written a second time in TypeScript**, beside the `@theme` block
  they came from — two sources of truth for one set of colours, and the first edit to either would
  have moved them apart with nothing to notice. `readDefaults` reads them off the document with
  `getComputedStyle` at construction, before the store's own effect has written anything: a
  stylesheet is render-blocking, so it is parsed before Angular bootstraps, and an unregistered
  custom property comes back as it was authored rather than computed. `styles.css` stays the one
  definition, and `@theme static` is what guarantees all of them reach `:root` — Tailwind emits a
  theme variable only where something uses it, and a reset is `removeProperty`, so a token no
  utility happens to name still needs its default sitting there to fall back to.
- **Storing the whole palette rather than only what was changed** — it reads as the simpler shape
  and it freezes a porter on the defaults of the day they first opened the picker: change one
  colour, and the other thirty-seven stop following the app for good. `ThemeStore.overrides` holds
  only the tokens moved off a default, which is also what makes a per-token reset exact rather than
  approximate — the property is removed and whatever `styles.css` now says shows through.
- **Re-hueing the eight channels for a preset's chrome** — the set is validated once, against the
  default `--color-surface` `#1e272e`, and every shipped preset's surface is darker than that
  (Graphite `#191919`, Midnight `#16181d`, Contrast `#0a0a0a`, Warm grey `#1a1918`), so under each
  of them every channel's contrast only rises and the worst pair stays above 3:1. The one direction
  that would need re-validating is a **lighter** default, and `#1f282f` is where ch-5 crosses 3:1.
- **The controls painted in `--color-accent`** — a primary button's plate, a checked box, a slider's
  fill and every toggle were the same token as the playhead, the lit keys, the caret and a syntax
  keyword, so there was no way to recolour the chrome without taking the roll's own markers with it.
  `--color-control` is its own token, and `primary` is told from `default` by weight and a tint of
  it — `bg-control/15`, a `border-control/60`, a medium label — rather than by a hue of its own.
  `danger` keeps its hue, saying something the shape of a button cannot. The focus ring stays on the
  accent: it is an affordance rather than a decoration, and it is the one place the music's colour
  reaches the chrome.
- **The source view's colouring drawn from the app's palette** — twelve tags in `TOKEN_TAGS` sharing
  eight shared tokens, so re-colouring the notes moved the body text with them and re-colouring the
  loop brackets moved every severe warning, and the one surface a porter looks at for hours could
  not be touched without disturbing the chrome. `--color-syn-*` is one token per tag, shared with
  nothing, defaulting to what the shared tokens used to give so the source reads as it did. The
  editor's _structure_ stays on the app's palette on purpose — a gutter, a tooltip, the caret and a
  diagnostic's underline are chrome and findings rather than MML, and a porter re-colouring their
  notes is not asking for a different error underline.
- **A preview folded into the stored overrides** — `<input type="color">` reports every step of a
  drag through the operating system's picker on `input`, so that is a synchronous `localStorage`
  write per frame of a drag. `ThemeStore.previewing` is a transient signal laid over the stored one,
  which is the `preview`/`commit` split `Slider` and `NumberField` already make.
- **The view tabs in the editor panel's header, with the development notice beside them** — a
  header that is a tab strip and a warning at once says two things in one row, and the notice was
  the one thing on it that no view owned. The pane opens with a tab row of its own (`amk-tabs`, each
  `TabDef` carrying its icon and whether it sits `aside`), Samples set apart on the right because it
  is a library and not a view of the song, and the notice is the status bar's, beside the compile
  status it belongs with.
- **Hot Reload, Loop and Follow playback as checkboxes** — a checkbox is a form field, a value
  waiting to be submitted, and each of these is a mode the transport or the roll is in. They are
  `amk-toggle`s, a button whose lit plate is the state, as Scroll the notes, All octaves, word wrap
  and Percussion are, and the plate is the whole of what says which state a toggle is in.
- **The compile status in the output panel's header** — it took the one line that could name what
  the pane holds, so the sidebar could not say it was the Inspector. The status bar holds it
  (`status-bar/`), with the problems count beside it, and the sidebar's headers name their sections.
- **The sidebar ordered stats, ARAM, diagnostics, inspector, hex dump** — the inspector is what a
  porter edits with, and it sat under three sections read once a session, so on a short pane it was
  off the bottom on every click in the source. It is the **Inspector** section first, the command
  inspector with the loop inspector under it; **Build** — stats, the ARAM budget, the hex dump — is
  collapsible under that; and **Problems** is pinned below the scroll column with a count badge,
  because a diagnostic has to stay in view whatever height the inspector takes.
- **The sidebar's sections as native `<details>`** — an element that opens on its own click and
  tells nothing about it, so the ARAM meter in the top bar and the problems count in the status bar
  had no way to open the section they point at. `amk-section` carries `open` as a model, persisted
  per section (`solar-soundtrack.build`, `solar-soundtrack.problems`), and
  `EditorRequests.revealSection` is the request: the pane opens the section, unfolds the drawer,
  scrolls to it and puts the signal back to `null`, so the same section can be asked for twice.
- **The two panes stacked below `lg` with no seam between them** — a sidebar at its content height
  under the editor pushed the editor off a tablet's screen, and nothing on it could be made shorter.
  Below `lg` the sidebar is a drawer (`solar-soundtrack.drawer`, `solar-soundtrack.drawer-collapsed`):
  a row-resize seam over it in the column splitter's mould, and a fold that takes it down to its
  header, so the editor keeps the screen and the sidebar is a pull away.
- **`--color-control` a neutral grey** — a chrome with no hue at all reads as unfinished rather
  than as calm, and the reason the token is separate from `--color-accent` never needed it to be
  grey. It is a steel blue a step lighter than the chrome (`#7ea6c4`), so a button reads as the
  toolbar's own material; the accent is the orange (`#ffa53a`) and still means one thing, _this is
  where the music is_ — the playhead, the lit keys, the caret and the focus ring.
- **The default surface at `#191919`** — a neutral grey ground and the four greys around it. The
  default is the Studio blue-grey, in the mould of the DAW the editor's interactions are drawn from —
  `surface #1e272e`, `raised #2f3c45`, `inset #171f25`, `edge #42525c` — and it carries a ceiling:
  the eight channels are validated against `#1e272e`, ch-5 crosses 3:1 above `#1f282f`, and the
  default may not be lighter than that without re-validating the set. The grey is the Graphite
  preset, a snapshot of the fourteen tokens it moves.
- **The mixer's solo `S` lit on `bg-control/25`** — considered and refused for the reason the
  picker's solo ring is not a blue: the control blue is a mid blue, and a mid blue vanishes on
  `--color-ch-0` and `--color-ch-6`. A lit `S` takes the channel's own colour, the one ground it is
  certain to be seen against, and the strip's number is what names the channel either way.
- **The theme picker and the changelog each carrying a trigger, a panel, `Escape` and the
  outside-press close of their own** — two copies of one drop-down, and the second edit to either
  would have moved them apart. `shared/popover/` is the one: a ghost icon trigger, a heading, a
  scrolling body and a footer row that hides itself when nothing is projected into it. The two
  components project their icon and their content and keep only what is theirs — the picker its
  rows and its import, the changelog its entries.
