# Decisions already made: `.claude/rules/ui-and-theme.md`

The ledger of `.claude/rules/ui-and-theme.md`: each entry is a design that was built or considered
there and moved away from, with the reason. The rule carries one index line per entry.

- **Template method calls per row** — the sample browser decoded 64 BRR samples on every
  change-detection pass, ten times a second while playing. Panels build one `computed` view model;
  the `no-call-expression` note in `eslint.config.js` says why lint cannot catch it.
- **The channel mixer and the roll's picker naming their channels without tinting them**, so that
  `--color-ch-*` lived in the roll's marks and the minimap alone — it made the two controls that
  name a channel the two pictures that would not show its colour, and matching a note seen in the
  roll to the chip that edits it or the buttons that silence it meant reading a digit off eight
  identical grey plates. Both wear the channel's own colour now, from the literal `bg-ch-*` names
  spelled out for the reason `CHANNEL_FILL` gives, with `--on-ch` over it because that is what the
  roll's own bars label themselves in on those same eight grounds. The rule the old shape was
  protecting is untouched: the number stays, a silenced channel is still struck through, and the
  eight still do not clear the all-pairs separation gate. What the fill can no longer say is which
  chip is being **edited**, and that is a heavy ring in the chip's ink rather than a dimming of the
  other seven: dimming is what a silenced channel already means, and it would have said a channel
  was inaudible for not being edited. The solo's own ring is not a hue either — a hue vanishes into
  whichever channel sits nearest it — so it is a hairline in the same ink, told from the edited
  one's heavy ring by weight. It yields to the edited chip where one is both — an element has
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
  default `--color-surface` `#31393e`, and every shipped preset's surface is darker than that
  (Slate `#1e272e`, Graphite `#191919`, Midnight `#16181d`, Contrast `#0a0a0a`, Warm grey
  `#1a1918`), so under each of them every channel's contrast only rises. The one direction that
  would need re-validating is a **lighter** default.
- **The controls painted in `--color-accent`** — a primary button's plate, a checked box, a slider's
  fill and every toggle were the same token as the playhead, the lit keys, the caret and a syntax
  keyword, so there was no way to recolour the chrome without taking the roll's own markers with it.
  `--color-control` is its own token, and `primary` is told from `default` by weight and a tint of
  it in the plate's face rather than by a hue of its own; a toggle that is on lights in a third,
  `--color-lit`. `danger` keeps its hue, saying something the shape of a button cannot. The focus ring stays on the
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
  grey. It is FL Studio's pale blue-grey (`#bfced5`), the face of its tempo display, so a button
  reads as the toolbar's own material; the accent is the orange (`#ffa947`) and still means one
  thing, _this is where the music is_ — the playhead, the lit keys, the caret and the focus ring.
- **The default surface at `#191919`** — a neutral grey ground and the four greys around it. The
  default is Studio, the chrome of the DAW the editor's interactions are drawn from, and the eight
  channels are validated against its surface, so the default may not change without re-validating
  the set. The grey is the Graphite preset, a snapshot of the fourteen tokens it moves.
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
- **Buttons as flat bordered rectangles told apart by a `--color-control` tint.** A `default`
  button was an `--color-inset` well with a 1px `--color-edge` border that turned `--color-control`
  under the pointer, and a `primary` one the same rectangle at `bg-control/15`. That is a form
  field's look, and the porters this is for know FL Studio, whose buttons are shaded plates with a
  dark rim and a lit top edge, which sink when pressed. `plate` in `styles.css` is that material,
  mixed from the theme's tokens so every preset still re-tints it. `primary` is the same plate
  tinted through `--plate-face`, and `buttonClass()` is the one statement of a button's classes.
- **A toggle that is on tinted `bg-control/20`.** A fifth of a mid blue over the chrome, beside an
  off toggle that differed from it in border and weight, so a mode's state took a second look to
  read — and the plate is the whole of what says it. FL Studio lights the whole of a mode that is
  on, in amber, and its glyph goes dark. `recess-lit` does that in `--color-lit`, a token of its
  own, so the reason `--color-control` is not `--color-accent` still holds: a porter can move the
  lit colour without the playhead. The cost is that by default orange is no longer the music's
  alone, and that was accepted. A lit control is a whole recess and the accent never is, and either
  one can be moved.
- **The one of several that is selected drawn by swapping a button's variant.** ADSR or GAIN, the
  envelope and FIR presets, the echo filter, and Presets or Draw were `amk-button`s whose
  `[variant]` flipped between `primary` and `default` or `ghost`. Presets and Draw instead laid
  `[class.text-accent]` over a ghost, whose winner depended on the order Tailwind emitted the two
  in. Selection is exactly a toggle's `pressed`, so all of them are `amk-toggle`s and light as a
  mode does.
- **Checkboxes for a sample's keep, Optimize samples and the channel bits.** `amk-checkbox` was a
  native box tinted `accent-control`, and a byte's bits were eight more of them. A checkbox is a
  form field, a value waiting to be submitted, which is the reason Loop and Hot Reload stopped
  being ones. Optimize samples is a mode, so it is an `amk-toggle`. A channel bit is a numbered lit
  plate in fours, as FL Studio's steps are. A sample's keep is a bare padlock, the toggle's
  `indicator` variant, lit `--color-led` while kept, as FL's channel-rack lock is. The component
  had no users left and is gone.
- **The mixer's M lit in `--color-danger` while muted.** A red tint on the cell said which channels
  were off, and FL Studio, which porters know, says which are on: a lime LED lit while a channel is
  heard. Each strip's mute is that light (`led`, `led-on`, `--color-led`), lit from
  `ChannelState.audible`, so a solo puts out every light but its own as FL's does. The state is
  not left to colour alone: lit and dark differ in lightness, and the silenced plate's
  strike-through stays.
- **An armed Record shown by its dot alone.** Record was an ordinary toggle whose icon turned
  `text-danger` while armed, so it lit amber like every other mode, with a red dot inside the amber.
  FL Studio's record button fills red. `tone="danger"` sets `--lit-tone` for the lit recess, so
  the control itself says it.
- **Hand-written copies of a button's classes.** The palettes' entries (`entryClass`), the
  inspector's command chip, the sample browser's audition button and its Add samples `<label>`
  each spelled out a button's border, ground and hover by hand, and a restyle of the shared
  controls passed all four by. The chip and the audition button are `amk-button`s. The label takes
  `buttonClass()`. The entries are `ENTRY_CLASS`, a toggle's off plate built from the toggle's own
  constants, because a disabled plate is not one of a toggle's states.
- **The ARAM segments inside the dark lightness band, validated on `--color-surface` alone.** They
  were `#3987e5`, `#199e70`, `#c98500` and `#d55181`, at OKLCH L 0.62–0.67, which passed every
  check against the sidebar's ground. But the top bar's meter draws them on `--color-raised`,
  where the echo pink was 2.87:1 and the rest barely cleared 3:1, and in use they sank into the
  chrome. They are now the same hues lifted well clear of the chrome, validated on both grounds;
  `styles.css` has the figures. That passes every gate but the band, which the validator's 0.67
  ceiling makes impossible for anything lighter. A true pastel was tried and refused: at 70%
  chroma the green reads grey and samples and echo fall under the normal-vision floor (ΔE 13),
  too alike even for full colour vision.
- **Toggles on the same raised plate as buttons.** An off toggle was `plate` with a muted label
  and an on one `plate-lit`, a raised plate filled amber, so an off toggle and a button were the
  same shape, and nothing but a pressed toggle told a state from an action. FL Studio sets its
  toggles into the chrome, and a mode that comes on lights the floor of the recess. A toggle is
  `recess` now, a sunk ground with a shadow inside its rim, and on it is `recess-lit`, which
  lights inside the rim and fades in as it does. `plate-lit` went with it. `danger`, its only other
  wearer, is a raised plate tinted red through `--plate-face`, as `primary` is tinted blue.
- **The eight channels as a validated mid-tone set, labelled in `text-ink`.** They were `#3987e5`,
  `#d95926`, `#199e70`, `#c98500`, `#d55181`, `#008300`, `#9085e9` and `#e66767`, passing every
  check against `#1e272e`. Everything drawn on them was near-white (`text-ink` names and glyphs,
  near-white defining plates, a near-white edited ring) or dark (`--color-surface` icons on the
  plates, a dark solo ring).
  - **Why pastels.** Porters know FL Studio's pastel channel colours, so the eight are now those
    hues at FL's brightness and saturation.
  - **Each keeps its old lightness offset** around FL's 0.80. At a single lightness, the two pairs
    of near hues collapse: 1 and 7 meet at ΔE 2.8.
  - **The light ink had to go.** It is 1.3:1 on a pastel, so whatever sits on a channel now wears
    `--on-ch`, which `channel-<n>` derives from the channel's lightness. That is 6.3–10.1:1 on the
    pastels, still above 4:1 on the old set, and right for any colour a porter picks. A defining
    glyph is a plate of that ink with the icon in `--ch`.
  - **The picker's two rings moved from lightness to weight**, heavy for edited and a hairline for
    solo, since only a dark ring shows on a pastel chip.
- **FL Studio's own pastel channel colours as the default eight.** They were tried first, as FL's
  1–8 and then as eight of its sixteen interleaved (1, 9, 5, 13, 3, 11, 7, 15) to push neighbours
  apart. FL's colours are one step apart on its hue wheel, all at one lightness and with less
  chroma than the editor's: in FL's own order, neighbours were ΔE 2.8 apart to normal vision and
  0.8 under protanopia, and interleaving lifted that only to 8.3 and 2.0. The editor's own hues at
  FL's brightness separate further, and they are the colours its porters have already learnt.
- **The Studio theme as a dark blue-grey of its own.** Studio was `surface #1e272e`,
  `raised #2f3c45`, `inset #171f25`, `edge #42525c`, ink `#dbe3e8` and `#9aaab5`: FL Studio's
  manner in colours that were not its own, much darker than FL's chrome, so a porter who knows FL
  read the editor as a different program. Studio is now FL's greys, sampled from its screen — the
  toolbar, the window frame, a drop-down's field, the seam between panels, and the plate labels.
  The dark blue-grey is the Slate preset. FL's greys are mid-tones, so everything read as text on
  them was lifted to 4.5:1 on `surface`: the danger red to `#ffa49b` from `#ff7b72`, the severe
  orange, the syntax blue and the accent with it. A red at 4.5:1 on that grey is a salmon, because
  the sRGB gamut holds no more red chroma at that lightness, and that was accepted. The eight
  channels were re-validated on the new ground and still clear 3:1.
- **A lit toggle as a flat `--color-lit` floor labelled in `--color-inset`.** One flat amber
  read as a sticker beside FL Studio's lit mode, which is a lamp: an amber floor, a pale yellow
  core, a deeper orange toward an orange rim, and a burnt-orange label. `recess-lit` draws that,
  every part derived from the one tone through relative colour, so a porter's `--color-lit` and
  Record's red light the same way. The core is a radial gradient whose colour stop is
  `--recess-glow`, a registered property, because a gradient swapped for another cannot fade and
  one whose stop is registered fades with it. `--lit-warmth` turns the core yellower; Record sets
  it to 0 so its lamp stays red.
- **The ARAM segments at one lightness.** Lifted to clear 3:1 on FL's mid-grey chrome, all four at
  OKLCH L 0.80 put the echo pink and the song green within ΔE 1.3 of each other under
  deuteranopia, over all pairs. The song green is the lightest and the echo pink the darkest, and
  apart they are ΔE 9.5.
- **The piano roll's rows on the chrome's `surface` and `inset`.** The roll's lanes were the page's
  own two greys, with `--color-edge` rules only where an octave turned over, so the music sat on
  the same ground as the controls round it. FL Studio's roll is a blue of its own, `#34444e` and
  `#2e3e48`, with a near-black rule under every row and down every beat, heaviest at the bar.
  `--color-lane`, `--color-lane-sharp` and `--color-lane-rule` are those, drawn at strengths in
  `roll-lanes` and `roll-grid`; each preset but Studio sets them to its own surface, inset and
  edge, so its roll looks as it did.
- **A toggle's label set in `font-medium` when on.** A heavier font is a wider one, so pressing a
  toggle widened it by a few pixels and pushed everything after it along the toolbar. Reserving
  the bold width was considered: it needs the label twice, and `<ng-content />` projects once, or
  a measurement per toggle, which a toggle in a hidden pane gets wrong. `HEAVY` strokes the glyphs
  in their own colour instead, which adds weight and leaves every advance where it was.
- **Play and Stop as chrome-grey plates with small corners.** They were the `default` plate, the
  toolbar's own grey, joined by a group with the small radius every control has. FL Studio's
  transport is darker than the toolbar it sits on and round at both ends, which is what makes it
  read as the one place the song is started. They are `dark` plates, the inset's grey rimmed in
  the seam colour through `--plate-rim`, in a `pill` group.
- **The transport in a darker box of its own inside the top bar.** `amk-transport-controls` was a
  rounded, bordered box at `bg-inset/50` on a `--color-raised` bar, which drew a frame round half
  the row and none round the rest. The box is gone and the whole top bar takes its colour, the
  inset mixed half into the raised grey, so the row the song is played from is one strip a step
  darker than the toolbars below it.
- **Studio's grounds at FL Studio's sampled values.** The chrome was FL's own greys as sampled
  (`#434c51` surface, `#596267` raised, `#333a3f` inset, `#1f282d` edge) and the roll FL's blue
  (`#34444e`, `#2e3e48`, rule `#0a1a24`), and the author wanted Studio darker. Every
  ground, `--color-seg-free` included, is taken 0.07 down in OKLCH lightness at its own hue and
  chroma, so the steps between them are FL's and everything drawn on them only gains contrast.
  Re-sampling FL's screen would undo it.
