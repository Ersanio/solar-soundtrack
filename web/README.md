# The editor

The Angular application. Everything it compiles, assembles and plays lives in `../packages`; what is
here is the UI, the ten state services, and the adapters that join CodeMirror and Web Audio to
framework-free code.

Run everything from the repository root, not from here. `npm start`, `npm run build` and
`npm run watch` each have a pre-hook that bundles the worklet, mirrors the SPC package's assets into
`public/`, and writes the commit SHA — none of the three is checked in, and `ng serve` skips all of
them.

## Layout

| Path                    | What it is                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `src/app/state/`        | Ten `@Service()` singletons in dependency order, and the transport's clock                         |
| `src/app/editor/`       | The editor pane and its chrome: top bar, transport, ARAM meter, mixer, palette, CodeMirror adapter |
| `src/app/editor/views/` | What the pane's tabs switch between: source, sample library, piano roll                            |
| `src/app/output/`       | The sidebar: the command and loop inspectors, stats, the ARAM budget, the hex dump, diagnostics    |
| `src/app/status-bar/`   | The status bar: compile status, the problems count, the development notice, the credit             |
| `src/app/shared/`       | Form controls, toggles, sections, popovers, tabs, icons, chart helpers                             |
| `src/app/util/`         | Formatting, IndexedDB, `clamp`                                                                     |

State flows one way: `DriverStore` → `SampleStore` → `EditorStore` → `Playback`. Six more sit off
that spine: `ClockMeasurer`, which `EditorStore` owns and which drives the measurement described
below; `Audition`, which hangs off `EditorStore` beside `Playback` and owns the second
`AudioContext`; `Mixer`, which holds the per-channel mutes, the solo and the output level and is
read by `Playback`, by `Audition` and by the roll — three readers and no owner is why it is not a
member of any of them, and the level is there for the same reason the mask is: both audio paths
apply it, the transport to the player's gain and the previewer to a `GainNode` of its own;
`EditorRequests`, which injects nothing at all, because a mailbox between the panels and the
source view has nothing to read; `ThemeStore`, which injects nothing either and which nothing
injects, because what it writes is CSS custom properties on `<html>` and every reader of those is
a stylesheet; and `CommitAudition`, the command inspector's write path, which
forwards a panel's commit to `EditorRequests` and replays the selected note through `Audition`
once the compile that includes it lands.

`DriverStore` loads `packages/spc/assets/driver/`. The song's ARAM load address is the slot the
driver's own song pointer table reserves, stated in the bundle's `manifest.json` and checked against
the image by `spctest`. **There is no fallback address** — until the driver loads, compilation is
blocked rather than run against a guess.

`EditorStore` debounces typing (150 ms) into a `committed` signal that a `computed` compiles.
Diagnostics, stats, the ARAM budget and the hex dump are all `computed` off that one result.
`buildSpc` is a method rather than a `computed` because it copies 64 KiB of ARAM plus every sample —
wasted work on each keystroke.

## Adding a view

`editor-pane.ts` is a shell. It owns which tab is selected and nothing else, so a view is a folder
under `editor/views/`, an entry in its `VIEWS` const and a `@case` in its template. The tab row is
built from that const: each entry is a `TabDef`, which carries the view's icon and whether it sits
on the right of the row (`aside`) — Samples stands apart from Source and Piano roll that way, being
a library rather than a view of the song.

**A view brings its own controls.** The tab row is the tab row and only that; anything that is a
setting on one view goes in an `<amk-toolbar>` as that view's first child, grouped with dividers,
and a mode — Follow playback, Scroll the notes, All octaves, word wrap, Percussion — is an
`amk-toggle` there, a button whose lit plate is the state, rather than a checkbox. This is the point
of the arrangement — word wrap is meaningless in the sample library, and a piano roll's zoom and snap
will be meaningless in the source, so there is no honest way for one shared header to serve all of
them. Host class is `flex min-h-0 min-w-0 flex-col`, as the panes' own is.

**The source view is the one that is hidden rather than destroyed**, because CodeMirror holds undo
history, scroll position and selection that nothing could restore. So it is alive while another tab is
showing, and its effects still run: a diagnostic clicked from the Samples tab has to bring the source
back. It asks for that with an `activate` output rather than reaching for the tab itself, and it is
told whether it is showing with an `active` input, because measuring or focusing a `display: none`
view is a no-op and the render barrier has to be taken first. The rest are `@case`d and rebuilt, and a
view with a position worth keeping hands it to a module that outlives it rather than joining the source
view: the piano roll's camera and the row its scroller sits at live in `roll-camera.ts`, which is four
numbers, where CodeMirror's undo history is not something anything could hand back.

## The sidebar

`output/output-pane/` is three sections, in the order a porter needs them. **Inspector** is first —
the command inspector, with the loop inspector under it — because it is what a porter edits with,
and it answers every click in the source and every click on a bar. **Build** is collapsible under
it: the stats, the ARAM budget and the hex dump, read once a session and folded away the rest of
the time. **Problems** is pinned below the scroll column with a count badge, so a diagnostic stays
in view whatever height the inspector takes. Each is an `amk-section`, and whether Build and
Problems are open is persisted (`solar-soundtrack.build`, `solar-soundtrack.problems`).

Below `lg` the pane is a drawer under the editor rather than a column beside it: a row-resize seam
over it, in the column splitter's mould, and a fold that takes it down to its header
(`solar-soundtrack.drawer`, `solar-soundtrack.drawer-collapsed`), so the editor keeps a tablet's
screen and the sidebar is a pull away.

Two things outside the pane point at a section of it — the ARAM meter in the top bar at Build, the
problems count in the status bar at Problems — and `EditorRequests.revealSection`
(`'build' | 'problems'`) is how they ask. The pane consumes it on the spot: it opens the section,
unfolds the drawer where there is one, scrolls to it and puts the signal back to `null`, so asking
for the same section twice still takes.

## Preview and commit

Everything that edits MML writes back through `EditorRequests.replace`, which recompiles. So a
control that committed on every `input` event would push a recompile through the typing debounce
once per frame of a drag, and the commit's own recompile would feed a new value back down and yank
the thumb out from under the pointer.

`amk-slider` is where that contract lives:

- `preview` fires continuously, for anything cheap and local — a graph redrawing, a readout counting.
- `commit` fires once, when the gesture ends.
- `pending` holds the dragged value in front of the bound one until it does.

`value` is an `input`, not a `model`: a commit is a gesture, not a change, and a two-way binding
cannot express "the source of truth updates when I let go". Readouts are computed from the
_previewed_ value — a label derived from the document would sit there describing the number you are
dragging away from.

The inspector's panels commit through `CommitAudition` rather than `EditorRequests` directly: same
mailbox underneath, plus a replay of the selected note once the compile that includes the commit
lands — heard, not just shown. A commit with no note selected replays nothing.

## Reaching into the editor

`editor/views/source-view/` owns the CodeMirror view, so nothing else may touch it — not even the
pane it sits in. Four signals on `EditorRequests` are how a sibling panel asks:

- `reveal` — select a span, set when a diagnostic or a piano roll bar is clicked.
- `replace` — apply a batch of splices, set when a panel edits a command in place or the roll
  commits a gesture.
- `insertion` — type a snippet in at the caret, set when a palette button is clicked.
- `history` — undo or redo, set by the two toolbars that carry the buttons, with `undoDepth` and
  `redoDepth` travelling the other way so a button can tell whether there is anything to do.
  `notesKept` travels that way too: the view counts each batch it applied that left a channel's
  notes as they were, so the roll can tell such a change from text typed.

Three more carry what only the roll knows, since the caret names text and the roll is pointing at
something the text says twice: `inspecting`, which pass of a note a bar click was about;
`selectedRun`, the stretch of music a whole group of bars covers; and `inspectingLoop`, which of a
body's constructs a press on a loop box's edge took hold of — a `(1)3`'s ghost and the `(1)[ … ]2` it
repeats leave the caret in the same place, so the press is the only thing that can tell them apart.
`inspecting` and `inspectingLoop` retire themselves as the caret moves off what they name, and
`selectedRun` follows the roll's own selection. `selectedRun` and `inspectingLoop` go back to `null`
when the roll does; `inspecting` goes back when `Escape` lets the note go, and a click in the
command lane points it at the note the command is heard on, so a value committed from the panel has
a note to replay.

`reveal` carries a `show` flag, and it is the difference between a summons and a question. A
diagnostic wants the source brought forward, scrolled to and focused. A single click on a roll bar
wants the note inspected, and the inspector is in the pane _beside_ the roll — so switching tabs
would take away the thing being asked about. The quiet form dispatches the selection and nothing
else, which is safe on a hidden view because it measures nothing. Both go through the document
rather than writing `caret`, so what the inspector is looking at has one statement.

`insertion` is the one with no span of its own: where it lands is the view's own selection, which
only the editor knows, so there is nothing for an `expect` to guard and the spacing has to be
decided at dispatch time. It never deletes and never lands mid-command — a palette click means "add
this", and the click before it left an argument selected for typing over.

`replace` carries `expect`, the text the splice believes occupies the span. Panels read the
_undebounced_ scan, so their spans agree with the document — but only up to the microtask that
carries the edit across, and a control that fires on `pointerup` is one gesture away from a document
that has moved. The editor compares before it dispatches, which turns that whole class of race from
silent corruption into an edit that simply does not take.

`EditorRequests.apply` ignores the `null` the splice builders return when nothing would change. A
slider fires per frame of a drag, and "that is the text already there" is what keeps a drag from
pushing dozens of identical recompiles through the debounce.

`applyAll` is the same mailbox for a whole gesture: every `expect` is checked against the document
before anything is dispatched, and then all the changes go in **one** transaction, which is what
makes a range-select over forty notes one undo step. Its ranges must not overlap —
`ChangeSet.of` merges overlapping ones rather than refusing them, so nothing downstream could catch
it, and `roll-edit.ts` asserts it where the edits are made. It also carries `immediate`, which asks
the editor to compile without waiting out the typing debounce: a gesture is committed once and the
roll's spans are stale until the compile lands, where a slider fires per frame and must not. The
call is the **view's**, not the mailbox's, because `EditorRequests` depends on nothing and reaching
`EditorStore` from it would turn the spine round.

The whole write-back path rests on one fact: the source view is hidden, never destroyed, when another
tab is showing, so its effects are live while the roll is in front. If that `[class.hidden]` in
`editor-pane.html` ever became an `@if`, every roll edit would vanish silently.

## Editing from the piano roll

`editor/views/piano-roll/roll-strip.ts` and `roll-edit.ts` are the two halves of a roll gesture, and
both are Angular-free so `rolltest` can drive them against a real compile.

The **strip** is one channel as a sequence the roll can splice. It is built from the compiler's
`noteMap` rather than from the walk, because `noteMap` carries **rests** — the walk drops them — and a
gap the roll can address is exactly a rest it can rewrite. A `^` is its own entry whenever anything
but whitespace separates it from its note, so `c4 v200 ^8` is two entries and one note; `foldStrip`
joins them, and a length change rewrites the **last** segment so the ramp keeps its place.

Its **gate** is five checks, and the third is the one no oracle could make: a `{ }` triplet scales
every length by two thirds and a tempo ratio divides every one of them, and in both cases the strip
and the walk agree perfectly while the text the roll would write is wrong. Reading each item's span
back and insisting it is a note catches the other invisible one — `spanAt` collapses a
replacement-sourced span to a single character, so a note written through `"x=c4"` has a span reading
`x` and an `expect` guard cannot see it, because the roll would slice the same text.

A note's **unit** is its own span grown over the `o` and the drum `@` written beside it. Growing it is
what makes a second drag rewrite the octave the first one wrote instead of adding another, and
leading wins over trailing where both could claim the same `o` — otherwise two units overlap. The
octave a note was written under is not inferred: `written` is the byte the letter and octave alone
name, so `octaveOfNote` divides it out exactly.

**`planGesture` decides and `planEdits` writes.** Everything the porter sees during a drag — the red
wash, the striped pushed bars, the length bubble — is read off the one `Plan` that pointer-up
commits, so what is drawn cannot disagree with what lands. A plan that is refused never reaches
`planEdits` at all.

Its **`EditMode`** is what an overlap does, and it is the porter's setting rather than the gesture's:
`overwrite` takes the overlapping ticks off the notes already there, `insert` shoves them aside and
`strict` refuses, for drawing, dragging, stretching and quantizing alike. `resolved` is the one place
the three are told apart, so the gestures cannot drift into answering an overlap differently, and
each brings only what it alone knows — which way a push should send what is in the way, and which
notes are its own. `EDIT_MODES`'s order is the `<select>`'s order, the default and the fallback for
an unreadable stored value, all at once.

`carve` is the mirror of `push`. A push moves what is in the way and can run out of room; a carve
takes the overlap off it, leaves everything else where it was written, and so has no refusal of its
own. A note comes out of one in none, one or more pieces, and the first keeps its `from`, so the
unit is shortened in place and a note landed inside survives as a head _and_ a tail. Neither ever
touches a note the gesture is placing itself — `push`'s `fixed` set and `carve`'s `placed` are the
same idea — so a selection cannot shove or eat itself, and an overlap it could not clear is reported
as a clash rather than as a third outcome. `Plan.erased` carries the ticks being given up, which is
what the roll hatches in red and what keeps a carve out of `reach`: its pieces sit where the channel
already reached, so padding the song out to one would lengthen it for nothing. The inspector's own
length slider is not on this path at all: it writes one argument through `spliceArg` and knows
nothing about neighbours.

The commit is `EditorRequests.applyAll`: one transaction, one undo step for a whole selection, and
the editor checks every `expect` before it dispatches anything, so a stale batch is a no-op rather
than half a gesture.

**A press is not yet a gesture.** `roll-gesture.ts` neither captures the pointer nor prevents the
default on `pointerdown`, because both stop the browser raising `click` and `dblclick` on the bar —
and those are still how a note names its channel, reaches the inspector, and is jumped to in the
source. It captures on the first move past the slop threshold, shows no preview until then, and
treats a press that never moved as a click that commits nothing. Drawing is the exception, since a
click on empty grid is the whole gesture. That is also the one gesture the wheel reaches: a press
holding a new note has no second axis left to say a length with, so `onWheel` offers the wheel to
`stepLength` before it reads its own modifiers, and takes it back when there is nothing being drawn.

## The CodeMirror adapter

`editor/codemirror/` is the only place that knows CodeMirror exists. `mml-language.ts` is 44 lines:
`@amk/tokens` exposes `step` / `startState` / `copyState` in exactly the shape `StreamLanguage`
wants, and `TOKEN_TAGS` holds `@lezer/highlight` tag _names_ as strings so the package itself stays
CodeMirror-free. This is the one place those names resolve to `Tag` values, and `tokentest` asserts
every one of them is real, so the cast is a checked one.

## Accessibility

**This app ships no ARIA attributes and no `role` or `tabindex`.** That is a deferral, not an
oversight — see the note in the root `CLAUDE.md`. The global `:focus-visible` outline in
`styles.css` is a different concern and must not be removed by components.

## Two AudioContexts

`SpcPlayer` owns one for song playback. `Audition` owns a second for one-shot audition — a sample, or
one note of the song. They are separate on purpose: auditioning must not interrupt or be interrupted
by the song, and a note is meant to be sounded _while_ the song plays.

A sample needs no emulator, and a service of its own is what keeps that path from waiting on
`player.init()` — hearing a 65-byte square wave would otherwise mean downloading and compiling the
SPC core first. A note does need one, and gets a second, on a worker: `note.worker.ts` runs the song
silently up to the tick, hands the driver the note there and renders it, so what reaches this side is
finished PCM and the context only has a buffer to play. The emulator playing the song is inside an
`AudioWorkletProcessor` and is never addressed, which is the whole of why a note can be auditioned
over a song without disturbing it.

A note of the song carries the `$DD` the walk read for it (`StripItem.slide`), so a bar that slides
in the song slides under the pointer — clicked, and on every row a drag of it crosses, the target
being absolute. Its target is also the one number on this path that must _not_ go through the
transposition `Audition` applies: that turns a written row pitch into the byte the compiler would
emit, and a slide's target already is one.

The mixer is the one thing the two paths share, and only as a number. A note on a channel the mixer
silences is refused in `Audition` before an emulator is asked for — hearing nothing does not need a
few hundred milliseconds of fast-forward to arrive at — and a deliberate key press says why, where a
drag asks quietly because it asks once per row. A note that does sound carries the mask with it, and
the mask is now what decides **which of the other channels are heard under it**: `auditionNote` parks
the other seven rather than halting them, so each plays out the note it holds at that tick and a
click on a note in a chord is that chord. The mask reaching the fast-forward as well is what keeps
the echo the note lands on the echo the transport is making. Neither is a route back to the worklet's
emulator. The mutes apply with the transport stopped too: they are a standing monitoring state, not a
property of something playing.

`playRegion` is the same path with the note taken out of it: a selection of the roll — a loop's pass
taken by its box, or a `Ctrl`+drag over the grid — is played as a **stretch of the song**, `Audition`
posting the same worker a second kind of request and `auditionRegion` recording the ticks with every
voice reading its own music. There is no refusal here, where a note on a silenced channel gets one: a
region belongs to no one channel, so the mask simply decides what is in it. The two share one token,
so pressing a note while a selection is rendering supersedes it rather than sounding over it.

That worker is separate from `clock.worker.ts` rather than another message on it. The clock
measurement fires a second after typing stops, which is exactly when someone is about to click, and
an audition queued behind a whole pass of emulation would arrive hundreds of milliseconds late. They
share `spc-core.ts`, which is the one-emulator-per-worker bootstrap both need.

## Persistence is optional

The MML draft goes to `localStorage`; the sample library to IndexedDB via `util/idb.ts`, which
resolves rather than rejects on every path. Storage is genuinely optional — private browsing, an
exhausted quota — and must never stop someone compiling a song.

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

Two families of token are deliberately not shared. `--color-control` is what a control is
emphasised in — a primary button's plate, a checked box, a slider's fill, a toggle that is on — a
steel blue a step lighter than the chrome, so a button reads as the same material as the toolbar it
sits in. It is separate from `--color-accent`, which means _this is where the music is_: the
playhead, a lit key, the caret, the focus ring. One token for both would make a neutral chrome cost
a neutral playhead. And `--color-syn-*` is the source view's colouring, one token per tag in
`TOKEN_TAGS`, shared with nothing at all — `codemirror/mml-theme.ts`'s highlight table reads only
those, while its structure block (gutters, tooltips, diagnostic underlines) stays on the app's
palette, being chrome rather than MML.

Three things are worth knowing before changing any of it. The defaults are read _off the document_
rather than copied into TypeScript, so `styles.css` stays the only place they are written, and
resetting a token removes the inline property rather than writing a default back. Only the tokens
actually changed are stored, so a porter who moved one colour still follows the app on the rest. And
a colour input reports a drag continuously, so `preview` and `commit` are split the way
`shared/slider/`'s are — only the second is written down.

The one thing outside CSS is `<meta name="theme-color">` in `index.html`, which the store keeps in
step; the manifest's copy is baked into an installed app and cannot follow.

## Charts

Every chart here is Angular-templated SVG; nothing draws with a charting library. The four inspector
graphs work in a fixed viewBox from `shared/chart/plot.ts`, stretched to their container, so stroke
widths and offsets are in viewBox units rather than pixels.

`aram-bar` is the one that does not. It is measured with `element-size.ts` and laid out in real
pixels by `stack.ts`, because the surface gap between its fills and the floor under a small region
are pixel sizes, not fractions of the bar that would vanish as it narrows. It is the only component
that needs either file. `npm run charttest` pins both `stack.ts` and `plot.ts`, along with the roll's
layout maths and the transport's clock — anything here that is arithmetic rather than markup.

## The transport's clock

`state/song-clock.ts` turns ticks into seconds, and it lives in the app because nothing else can
reach both halves of the answer. `@amk/spc`'s walk records every tempo command on the tick the driver
runs it; `@amk/tokens`' `tempoFadeSteps` is the driver's own per-tick model of a `$E3`. Neither
package may import the other (`eslint.config.js`'s `SPC_BEYOND_THE_MATHS`), so the join is here. It
is a placement the dependency graph forces, not a preference, and nothing about the module is
otherwise app-specific — `charttest` and `walktest` both drive it directly.

It exists because **the compiler will not time some perfectly ordinary songs**, and is right not to.
`estimateSeconds` is segment-wise over source text, so a `t` that runs more than once has no place in
it and a tempo fade has no segment at all; AddmusicK gives up on the song's whole length either way
(`Music.cpp:809`), and this port reproduces that faithfully, so `stats.playback` is `null` for them.

So `durationSeconds` and `secondsAt` read the clock and fall back to `stats.playback` only when there
is no walk to read. `durationTicks` needs neither: ticks are known for every song that compiles, and
that is why it, and not a length in seconds, is what the transport is built on. The two agree exactly on any song that sets its own `t`; a song that sets
none reads **55/54 longer**, because `estimateSeconds` treats `0x36` as a written byte where
`main.asm:177` puts it straight into `$51`. That is the same ruling as "assume t53 for songs that
don't have a tempo command", and `walktest` pins the ratio so it cannot drift.

## The clock is measured, not only predicted

Predicting is not enough, and the gap is not small. The driver's main loop handles at most one music
tick per pass, so a song that asks for more ticks a second than it can manage simply gets fewer.
Measured against the emulator: one channel at `t254` reaches 99.6% of the 498 ticks a second it asks
for, four channels reach 81%, eight reach 50%, and a real eight-channel `t254` song reaches **46%**.
Even eight channels at `t100` lose 8%. The `~0.8%` figure in `packages/spc/README.md` is an
ordinary-tempo one.

Every predicted seconds figure is `ticks × the tempo the song asked for`, so on such a song it is
out by the whole shortfall — a 32-second pass called 15 seconds long.

Nothing can compute the shortfall. It is a function of how much work each tick costs, which varies
with the live channels, the commands they carry and the passage being played: one song's opening
measures run at 1.86x where its whole pass is 2.15x, so even sampling the start is wrong by 13%. So
`measure-clock.ts` plays the song instead, silently, and records when each tick
actually arrived. It produces a `SongClock` — the same shape `songClock` predicts — and everything
downstream reads one through the other without knowing which it has.

That costs about 90 ms for a half-minute pass and several hundred for a long one, which is a stutter
on the main thread and a dropout on the audio thread. So `clock.worker.ts` runs it, and
`ClockMeasurer` asks **a second after typing stops** rather than on every compile — a typing burst
would throw every answer away, and a second of quiet is far less than it takes to reach for the
transport. The predicted clock stands in the meantime and stands for good if the measurement fails,
which is why it is still worth having.

`SST0503` is the same finding pointed at the porter: past 10% the song is not playing at the tempo it
was written at, and a SNES drops the same ticks, so it is a fact about the song rather than about
this editor. `severe`, beside the echo hazards and `SST0502` — it compiles cleanly and then
misbehaves on playback. What the `SST05xx` band shares is not that, but that `Music.cpp` produces
none of them: `SST0504`, for a `#path` this editor deliberately ignores, is `info` and is about the
editor rather than the song. The comparison starts at the first tick: the driver's boot, and the echo
buffer `$FA $04` zeroes in the song's first tick — some 26 ms per delay unit, a pause AddmusicK puts
at the top of every song on purpose — are one-off costs, and a short song would read them as a rate.
The pass length keeps them, since they are heard.

**Nothing that follows the music is denominated in seconds**, the seek bar included: its `min`, `max`
and `value` are driver ticks, `Playback.position` and `scrubbing` are ticks, `player.seek` and the
worklet take the tick itself, and the m:ss beside the bar is a label `secondsAt` derives from the
tick under the thumb. `Playback` holds one playhead, `songTicks`.

That is why the conversion runs one way only. `secondsAtTick` has no inverse: seconds are produced
for a label and never consumed, so no position ever has to survive a round trip through a clock that
is a prediction until the song has been measured.

Two things stay in seconds because they genuinely are wall-clock, not because they were missed: the
fade past the end of the song — the driver has stopped reading music data by then, so there are no
ticks left to count — and the frame timing inside the piano roll, which is about the display's
refresh rate and not the song's.

## The piano roll

`editor/views/piano-roll/` draws whatever `@amk/spc/song-walk` says — the compiler's `noteMap`
records the emitted byte and a note's own length but leaves it in source order, with no tick to draw
it on and no instrument, volume or tempo to draw it under, so the roll is a view of a walk over the
emitted bytes rather than of the compile. The one thing it takes from the map is the **row**: a
pitched note draws at the pitch it was **written** at (`NoteAddress.written`), so `@2 o5 g` sits on
o5 g even though the byte is o5 d. The five semitones `@2` takes off exist to cancel its sample's
tuning, and the readme calls `h` "Tune" for the same reason — so a row on the byte would be neither
what was written nor what sounds, and it is only the letter that an edit could ever go back to. What
a note plays as is the tooltip's business: `plays as o5 d — transposed -5`, and `$E4` and `$FA $02`
beside it when the driver adds them, since none of that is knowable from the source alone. A note the
map does not know — a `$8x` typed as raw hex — keeps the byte, and a bare `$D0`-`$D8` keeps the
driver's own pitch for its drum, since the letter it was written under had no say in it.

**A bar says what it is and what is acting on it.** Its own pitch on the left — `C6`, `C+6`, the
compact spelling of the key column's `o6 c` — and on the right a glyph per command in force, drawn
from the same catalogue the command palette's buttons are. A single click asks the inspector about
that note; a double click goes to it in the source. Clicking
a glyph targets its command instead. A glyph the note itself **puts** in force is drawn inverted —
a near-white plate with the icon in `--color-surface` — where one it carries in from an earlier note
is a plain light icon, so a run of notes under one `v200` says which of them the `v200` landed on. It
is a plate and not a tint because the eight channel fills are mid-tone and chromatic, and the axis
they leave free is lightness: `--color-control` is a blue of much the same lightness as
`--color-ch-0`, `--color-accent` an orange beside `--color-ch-1`, `--color-warn` sits on
`--color-ch-3`, and each would be the colour that vanished on one channel. On a plate the glyph reads against the plate, so one pair of colours does for all eight.
The glyphs a note puts in force lead, the slot order the walk gives holding within each half, so a
narrow bar keeps what starts at that note and drops what it carries in. What fits is measured
(`fitBarContent`): the name has priority and the glyphs drop from the end, because a bar that says
`C6` and nothing else is still saying something. Anything dropped is in the hover and in the
inspector, so nothing is only on a bar. The mark that stands for the dropped ones takes the plate
when any of them is one the note puts in force — it is what is left of that glyph, and a bar too
narrow to draw it would otherwise say the note inherits everything it plays under. A
muted channel is drawn dimmed, behind the others, and takes no pointer at all, so where a live note
overlaps it the live one is what a hover or a click reaches — and it cannot be edited either, the
strip refusing it in the words the note previewer refuses to sound it in (`silencedReason`), so a
channel that goes quiet drops its selection rather than keeping one nothing can act on.

**Which commands act on a note is answered exactly, and it takes two halves to be exact.** Anything
that emits a VCMD is named by the walk, at the ARAM address the driver read it from, and
`CompileResult.commandMap` turns that address back into source. That is the only way to be right
where one run of bytes plays more than once: `v255 (1)[ c ]2 v200 (1)5` sounds one written `c` under
two volumes, and no reading of the text around that `c` could say which, because the command that
decides it is not in the body at all. The rest — `q`, `h` and `@21`-`@29` — emit nothing to address,
and for them source order _is_ the answer rather than an approximation, since `parser.ts` resolved
them in one textual pass and baked them into the notes' own bytes;
`@amk/tokens/commands/in-force` does that half. The drum is both at once: `@21` is folded into one
note byte, and that byte loads a sample every note after it plays on, through a `]`, a `*` and a call
from another channel — so the walk names the note that loaded it (`WalkNote.drumFrom`) and the source
is asked about that note. A `$DD` is the same shape reversed: it fills no slot, so no `origins` names
it, and the note whose read-ahead swallowed it carries the address itself (`WalkNote.bendFrom`) — one
slide acting on one note and on nothing after it, however many notes follow.
`state/commands-in-force.ts` is the join, kept out of the store so
`walktest` can pin all three halves on the songs that need each.

**Which of them a note puts in force is that list against the note before it on its channel**
(`definedAt`), by the identity of the commands and never of the arrays holding them: a song-wide
write invalidates every channel's frozen `origins` (`recordOrigin`), so after a `t` all eight get a
fresh array holding the same addresses, and comparing arrays would report every channel's next note
as setting everything it plays under. In walk order rather than source order, for the reason above —
the glyph names whichever command the driver had in force, so a reading taken from the text would
have that `c` setting `v255` on the pass it sounds under `v200`. Every command that reaches a glyph
is channel-local, `commandScope` having dropped the song-wide slots and `remote`, so the note before
on the channel is the whole comparison. `buildMarks` gets that neighbour from the loop that draws the
bars; the inspector, reached from the caret with no such loop, looks it up with `notePreceding` and
puts the two kinds under headings of their own, having room for words where a bar has not.

The song's own settings and the shape of the music get no glyph **on a bar** — `t`, `w`, `$E4` and
the echo unit reach every note alike, and `o`, `<`, `>` and `l` are what the bar's row and width
already are. `commandScope` is the one statement of that.

**The command lane holds every command that takes effect**, on the tick the driver reads it:
`commandScope`'s `'song'`, which `commandsInForceOf` drops because those act on the song and not on
any note of it, and every `'note-state'` one, whether or not a note begins where it runs. A bar's
glyphs are the commands in force at its note, drawn on that note's own tick, so most commands are
drawn twice and the two are answering different questions — the lane the tick it runs on, the note's
chip which note plays under it. Those agree in `c4 v200 d4` and are a rest apart in `c4 v200 r4 d4`,
and the lane says the same thing in both, which is what makes it the one place the whole song's
commands can be read in the order they run. Four shapes reach no bar at all, so the lane is the only
place they appear: a command replaced before the next note sounds, one with no note after it,
`$DF`, `$F0`, `$FD` and `$FE`, which empty a slot rather than take one and so are in no
`WalkNote.origins` at any tick, and a `$DD` with no note in front of it to read it, which the driver
dispatches into the `$0000` its slot in the command table holds.
`WalkCommand.onANote` is the walk's own word for whether a note
begins on a command's tick; the lane does not filter on it, and it stands as a description of the
song rather than as anyone's rule. Left to the bars alone: `q`, `h` and `@21`-`@29`, which emit
nothing to address, so the note they fold into is their only honest tick and that note is already
drawing them.

**Its ticks are the driver's own**, which is why the walk keeps a list at all rather than the lane
re-reading `definedAt`. That is anchored on a note, and `emitNote` pushes a `WalkNote` for a note and
not for a rest, so in `c4 v200 r4 d4` the `v200` runs at tick 48 and a note-anchored reading would
place it at 96, a whole rest late. `SongTimeline.commands` is raised in `recordOrigin`, already the
one place that knows a slot has changed hands: a write of the address a slot already holds moves
nothing and raises nothing, so `[ v200 c8 ]2` is one entry and `[ v100 c8 v200 d8 ]2` is four — the
same answer `definedAt` gives, arrived at from the byte end. A command that writes no slot at all is
not there (`$F6`, `$F7`, `$F9`), nor is anything inside a `$FC` body, which the walk does not follow,
and the lane draws only what the compiler mapped, so the byte blob's own `$FA` prefix reaches no
glyph.

`$DD` is the one entry raised outside that rule, from its own arm of the walk, because it writes no
slot and so has no transition to be tested for. It is an execution: a `[ c4 $DD … ]2` runs the slide
on both notes and is two entries where `[ v200 c8 ]2` is one, and its tick is the frame the driver's
read-ahead found it in rather than the tick the read pointer reached the byte at, which is where the
note it rides on _ends_. That is also why `definedAt` never counts a `$DD` in the note before as
something this note inherited — one written slide reaching two notes ran twice.

`state/command-timeline.ts` is that rule; `roll-command-layout.ts` beside `roll-layout.ts` is the
geometry, first-fit rows over the whole song so that a glyph's row depends on the song, the zoom and
which channel is being edited, and not on where the roll has been scrolled to, with `x` always
`laneGlyphX` and never nudged sideways to make room, because where a glyph is _is_ the claim the lane
makes. That anchors a glyph's **centre** on its tick, so a command on a beat straddles that beat's
rule, and holds the box inside the song's own span at both ends — the tick-0 glyph would otherwise
put half itself behind the key column, and one on the last tick would hang past the end-of-song rule.
The bound is the song's span and not the pane's, since one against the camera would move a glyph as
the roll scrolled past it. The
**edited channel is packed first** and the rest strictly below it, as a band rather than a
preference: a shared row would put another channel's glyph among the ones the porter is working on,
which is the thing the split is for. It is `editChannel` and not the roll's `editing`, whose fallback
is the channel of the bar under the pointer — rows would be re-dealt on a hover. The one question
about the song this file answers is what the **mixer** silences, which is a fact about the moment
rather than about the compile and so cannot come from the timeline: a muted channel's `'note-state'`
commands are dropped, because they set nothing anybody can hear, and its `'song'` ones are kept and
dimmed to `LANE_MUTED_OPACITY`, because a `t` or an echo write still runs the whole song. That is a
much higher value than the roll's own `MUTED_OPACITY` and the gap is deliberate: a bar is a filled
rectangle tens of pixels wide, where a glyph is line art twelve pixels square whose strokes vanish at
a twelfth. Soloing one channel is where it tells — seven channels' song settings dimmed at once, and
they are the only record on screen of what is still being heard. Nothing in it takes a plate: everything drawn
there is a command going in force, so the inversion a bar draws would have nothing to distinguish. It
is a sibling of the roll's scroller rather than a child of it, so a song too tall for the pane does
not carry the lane off the bottom of it, and it is lifted by a transform rather than scrolled
natively — a scrollbar would eat a third of
its height and narrow its content box, putting its right edge out of step with the roll it tracks.

**The seam above it is a real element, and the lane's only top border.** It is the shell splitter's
shape (`app.ts`) turned on its side: pointer capture on the press so the drag survives leaving a
one-pixel line, `pointermove` and `pointerup` bound on the seam rather than on the document so there
is nothing to unsubscribe, a `before:-inset-y-1` grab zone, and a double click for the default. The
height is one more field of the roll's persisted `Settings` rather than a key of its own, for the
reason `editChannel` is; `clampLaneHeight` holds it between `LANE_HEIGHT` and `LANE_HEIGHT_MAX`, five
rows of glyphs and ten, and
**rounds** it, because it becomes the `viewBox` the glyphs are laid out against and a fractional user
unit would put every row's rule on a half pixel. A stored value outside the range is clamped rather
than rejected: it is a window that has been resized, not a value that means nothing.

**A glyph is dragged sideways to move its command to another tick**, which `roll-command-move.ts`
plans and `rolltest` drives. It is the only edit in the app that changes where a command runs without
touching a note: everywhere else a command's position moves, a note gesture is carrying one it could
not leave where it stood, and re-emits it on the tick it already had. Targets are the item heads of
the command's own channel — every note and rest — so the insertion always lands in an item's prefix
and no note is split into tied halves to make room, and the channel is `channelStrip`'s, whose gate
the drag borrows whole rather than restating. None past the last item: the pass ends at the shortest
channel, so a command written after a channel's last note raises no `WalkCommand`, has no tick, and
is drawn nowhere — a target out there would be one a command could be dragged to and not back from.
Let go on the tick it already runs at, it plans nothing, so the undo history is untouched by a
gesture that changed nothing. Horizontal only, rows being packing; and the press neither captures the
pointer nor prevents the default, for the reason `roll-gesture.ts` does not.

Written pitch is not held to the driver's o1 c–o6 a — `o0` is legal MML and `h12 o0 c` is a note the
driver plays — so `roll-layout.ts` grows the keyboard to take such a note in, above or below.

**The grid behind the notes is the porter's, since MML has not got one.** The toolbar's `x/y` is
beats in a bar over the note value that gets the beat, and that lower number is an MML note length —
6/8 is six `l8`s, and a 4/4 bar is one whole note, 192 ticks. `gridLines` counts beats from tick 0
and takes the bar from the count rather than testing a tick against a bar's length: the mark window
snaps outward to a whole note, a 7/8 bar is 168 ticks, and the two therefore line up only by
coincidence, so a bar line has to be a bar's own first beat by construction. Zero beats in a bar is
the grid switched off, which is why there is no separate switch for it.

**Two bars sit over the roll, one job each.** The **overview** is the whole song at once and moves
the _view_; the **scrub bar** under it is the roll's own timeline and moves the _song_. One bar
doing both jobs could do neither alone: there was no way to move the view without moving the music,
and none to move the music without moving the view.

The overview's width is one song — tick 0 on the left edge, the last tick on the right, at every
zoom — so it is the song rather than a view of it, and `overviewOffset`/`overviewTick` are that
mapping and its exact inverse. It behaves as a scrollbar over a minimap: the box on it is the pane
the roll is showing, a press inside that box grabs it and it stays under the pointer, and a press
outside it centres it there first. A drag goes through `setFollow(false)` rather than parking behind
the switch, as a `Shift`+wheel pan does, so the toolbar says where the roll is. Both bars sit
outside the roll's own scroller, because a bar that scrolled out of view would be gone exactly when
a tall song most needs it.

The scrub bar is drawn in the roll's **own** coordinates instead — the same `viewBox`, the same key
column, the same `scroll()` transform and the same `lines()` — so a tick is at the same x on it as
in the roll, and the marker is handed the playhead line's own x rather than a number that agrees
with it. Its numbers are the bars of that same grid, counted from 1 at tick 0. A drag previews
through `playback.scrubTo` and commits one `seek` at the end, as the transport's own slider does,
and the preview is deliberately kept out of the camera (`playTick` reads `songHead`, not
`headTick`): a camera that chased it would slide the music sideways under the pointer and put the
marker back at `lead` the moment it was grabbed. A drag can only ask for a tick that is on screen,
so one held within `EDGE_PULL_PX` of either end pulls the view along at `edgeUrgency`'s ramp — a
frame callback, since a pointer held off the end is not moving and is exactly when the pull is
wanted — and the offset is held inside the bar before the tick is read off it, so the marker stays
against the edge in view while the music comes to it.

**Both `<svg>`s are sized in pixels rather than `w-full`.** The pane is measured inside the vertical
scrollbar (`elementSize` reads the content box) and the bars are drawn outside it, so a `w-full` bar
stretches its `viewBox` over that gutter while the pointer maths does not — a scrub bar off by a
scrollbar's width from the roll it is a timeline for.

The overview's bars ask `rowOf` — the same function the roll's marks ask — so the percussion toggles land on
both pictures at once, and an instrument taken off the drum lanes moves to the keyboard in the
minimap and the roll together. Answering that question twice is how the two would drift. They take
their colours from the same `CHANNEL_FILL` for the same reason, and dim a channel the mixer silences
by the same `MUTED_OPACITY`, so the minimap is the roll seen from further off rather than a second
picture of it. The bars are deduped by pixel, row **and channel**, keeping the wider of a pair: one
channel's two notes through a pixel of a row are the same picture, where two channels' are two, and a
key without the channel in it takes the narrower of them out of the minimap altogether — two channels
sharing a drum lane is the commonest way that happens. A dense song still fits in the DOM either way;
the count is bounded by the song's notes and never was by the key. The muted bars come back first, so
a live one is never veiled by the wash of something that cannot be heard. The list is built from the
song, the lane stack, the pane's width and the mixer and never from the playhead, so it rebuilds on a
recompile, a mute or a resize and not on a frame; the playhead line and the box showing what the roll
is displaying are their own `computed`s over the frame clock.

Two clocks drive it and keeping them apart is the whole trick. The mark list is a `computed` over
the transport's 10 Hz anchor, snapped outward to a whole note, so the DOM rebuilds about twice per
screen; the scroll is a `computed` over `shared/chart/frame-clock.ts` and is one `transform` that
nothing beneath reads. That is why the roll can run at 240 Hz without the note list knowing.

**The folder is a parent and ten children**, as `output/command-inspector/` is. `piano-roll.ts`
holds the song's shape, the camera and the clock and hands each child what it draws:
`roll-toolbar/`, `percussion-panel/`, `roll-overview/`, `roll-scrub/`, `roll-channels/` and
`roll-tooltip/` in the ordinary namespace, `roll-lanes/`, `roll-grid/`, `roll-notes/` and
`roll-keys/` inside the roll's own `<svg>`. `roll-channels/` is the odd one: it draws nothing of the
song, and takes the corner the overview bar leaves empty above the key column to say which channel
is being edited. Its eight toggles
are not the only way in — a click on a bar or on one of its glyphs names that bar's channel, since
the roll is already pointing at the answer, and so does the first gesture of a drag, a stretch or an
erase, through `editing`: with no channel picked, the strip is built for the channel under the
pointer, so a bar can be grabbed before it has been chosen and the press names it on the way. Empty
grid offers nothing to name, which is why drawing, the marquee and the shortcuts still need a
channel. Each chip wears its channel's own colour, from the same `CHANNEL_BG` the mixer's plates
take, so the picker names the eight the notes below it are drawn in; a near-white ring is then what
says which is being edited. The chips carry the mixer's state too — struck through and dimmed where
the mask silences them, ringed dark where the solo is, which the edited chip's own ring takes
precedence over — and `Ctrl` on one isolates that channel rather than editing it. Both rings are
told apart by lightness rather than by hue, since a mid blue such as `--color-control` disappears into channels 0 and 6. Beside them sit
the flat `roll-*.ts` files, which are Angular-free so that the arithmetic stays where a harness can
import it: `roll-layout.ts` and `percussion.ts` for the lanes and the camera, `roll-metrics.ts` and
`roll-bar-text.ts` for what a bar is drawn as, `roll-lengths.ts` for what a gesture may land on,
`roll-marks.ts` and `roll-preview.ts` for the pictures, `roll-clock-step.ts` for the playhead's
motion, and `roll-settings.ts` for what is remembered. `roll-clock.ts` and `roll-gesture.ts` are the
exceptions and say so — they are composables, so they import `@angular/core` and no harness can
bundle them, which is why their arithmetic sits in files of its own.

**The four inside the `<svg>` are attribute components on a real `<g>`**, and their templates prefix
every element `svg:`. Both halves are required and neither fails loudly: a component _element_ in an
`<svg>` is an unknown SVG element with no layout box, and a child template has no namespace of its
own because Angular takes one from the parent in the same template. The glyph is the exception that
proves it — `<svg amk-glyph>` needs no prefix, `svg` being one of the three names that carry a
namespace implicitly. The `transform` binding stays in the parent, above children that take no
frame-rate input, so the frame clock reaches it and stops there.

**Which of the two moves is a view option**, "Scroll the notes" on the roll's own toolbar. On, it
pins the playhead a fifth across the pane and slides the music under it; off — the default — the
roll pages: the music holds still and the playhead crosses it,
turning the roll over by 80% of a pane once the line reaches 90% of it — so it lands a tenth in with
the bar it has just played still on screen. **Every page opens on that tenth, the first one
included**: page zero starts before tick 0, so a song is drawn with the margin it keeps for the rest
of its length rather than against the key column. Opening on tick 0 instead would put the margin
only on later pages, so it appeared at the first turn and a scroll back to the beginning showed a
space that vanished again on the way back to the song. Both are the same arithmetic: `lead` is how far across
the roll the **camera** holds the playhead, so a pinned playhead is simply the value that number
holds still at. The line itself is drawn at the song's own tick in the camera's coordinates
(`xAtTick`), which comes to the same place while the roll is on the song and does not once it is
parked: **"Follow playback" stops the view following the music, not the line**. Off, the notes
stand still and the playhead goes on crossing them and off the pane, where the clip hides it —
the honest picture, since a line held at the edge would say the song was there. `xAtTick` therefore
does not clamp, and `charttest` pins both halves. `pageStart` is a closed form and not a counter, so given its
anchor the page is a function of the tick and a loop wrap or a resize lands on the right page with
nothing to reset. **The anchor is what a scroll moves**: measured from the song's own start always, a
seek would drop the playhead wherever its place in that fixed grid happened to fall, and the notes
would jump back the moment the drag ended — by exactly as far as the scroll had just moved them.
A scroll re-anchors the grid on the view it leaves behind, so the roll carries on from what is on
screen and turns a page a full pane later. A stop puts the anchor back on tick 0, since a stop is
back to the beginning — the transition and not the state, so that a roll built while the transport is
already stopped leaves the anchor it was rebuilt from alone. The mark window is unchanged and does not need to be told: it already carries a
screen of margin either side of a playhead at a fifth, and every page a sweep can produce falls
inside that — `charttest` pins the coupling, because a roll drawing the wrong span scrolls perfectly
smoothly over blank music.

The playhead **carries its position across frames** rather than deriving it from the newest anchor,
and `advanceTick` in `roll-layout.ts` is where that lives. It matters: every anchor arrives with
about the same small lag — mostly the time the message spent getting here — so a clock that
re-derived its position each frame would reproduce that lag ten times a second and jerk to close
it. Running at the driver's rate and easing the gap shut turns a periodic jolt into a constant
offset nobody can see. `charttest` pins it.

**A wrap is spotted by the anchor moving backwards, not by the size of the jump.** The two directions
have separate bounds, and much the smaller one is backwards: the ease settles a sixth of a second of
music _behind_ the anchor and never overshoots it, so a target ahead of that is the loop coming round
or a seek. Judging both by the same second of music cannot see a wrap on a short loop at all — the
anchor is folded into one pass, so the whole jump a wrap can make is one trip round it, and
`#0 t54 aaaa` is 96 ticks against a second's 107. Eased instead of snapped, the line settles into a
cycle over the back half of the roll and reaches the beginning on no pass at all.

Interpolating over tempo is what the root `CLAUDE.md` warns against, so read the comment before
"fixing" it. The rule forbids a playhead _built on_ the formula, because the driver drops ticks and a
formula compounds them; here the driver's own count steers the clock on every anchor, so the formula
sets the velocity between readings and never the position. Raising the worklet's post rate instead
would cost sixty structured clones a second from the audio thread and still not match a 144 Hz
display.

**The velocity comes from the clock, not from the tempo byte**, and that distinction is the one the
rule was pointing at all along. `ticksPerSecond($51 - 1)` is the rate the song _asked_ for; a song the
driver cannot keep up with gets about half of it, and a playhead extrapolated at the asking rate
therefore races between anchors and settles a steady distance ahead of the notes it is drawn over —
59 ticks on the `t254` song, most of a quarter note, scrolling perfectly smoothly the whole time.
`ticksPerSecondAt` reads the measured clock's own slope instead, which is what the driver really did.
`charttest` pins both halves: that the tempo byte puts it more than a quarter note out and that the
clock's rate holds it inside a 32nd. In the browser the roll leads the transport's anchor by about
12 ticks at `t254`, which is that anchor's own staleness and nothing more.

The transport's clock runs on the same display clock when it is showing ticks (click it to switch
between m:ss and ticks), so the number and the line cannot disagree; the shortfall itself is what
`SST0503` reports.

Only what the song uses gets a row: the pitched range is fitted and rounded out to whole octaves,
and a drum or noise lane appears only when something plays it. Rows then stretch to fill the pane,
because two octaves stranded at the top of an empty box is the worse picture.

**A row is chosen by the instrument, not by the note byte.** Everything played while a drum is
loaded is that drum being hit, so `@29 c d e` is three marks on one lane rather than one drum and
two notes scattered up the keyboard — the pitched ones only look melodic because `parser.ts:2681`
stops remapping after the first. The pitch they were written at is still true and still in the
tooltip; it just does not decide where the mark goes.

**Which instruments are percussion is the porter's to say**, from the strip the toolbar's
**Percussion** toggle opens. `percussion.ts` holds the default — `@21`-`@29` plus `@10` — and the whole of the reasoning,
including why nothing is derived: the obvious rule is to look at the sample an instrument resolves
to and ask whether the driver's drums play it, and that says no the moment a porter swaps one drum
sample for another. Nothing in the data answers "is this a drum", so the question goes to the person
who knows. Anything on the list can be taken off, `@21`-`@29` included; a bare `$D0`-`$D8` then
falls back to the pitch the driver's own percussion table gives that drum, so it keeps a row rather
than vanishing.

`placeOf` is the one statement of the precedence — percussion, then noise, then the keyboard. The
lanes and the fitted range are both built from it, so they cannot disagree. `song-walk.ts` has no
opinion on any of this by design.

A channel longer than the song is **not** the roll's business, even though the walk is what notices
it — that goes to the diagnostics list as `SST0502` and to the editor as a wavy underline on the
notes that never sound (`codemirror/unreachable.ts`, the sibling of `playhead.ts`). The roll's own
warning strip is only for a walk that could not make sense of the bytes. `EditorStore.diagnostics`
is where the three sources meet, and it is the reason `timeline` is read on every compile rather
than only while the roll is open.

`fir-graph`'s frequency axis is **linear**, DC to Nyquist, which is not what an audio plot usually
does. Eight taps at 32 kHz have no authority below a couple of kHz, so a log axis would spend most
of its width on the part of the spectrum the filter cannot address, and push the nulls and ripple
that actually distinguish one filter from another into a corner. The cost is that hearing is
logarithmic and this is not.

## Panels build view models, not methods

A `computed` of rows with everything resolved, rather than a method called per row in the template —
see `sample-browser.ts`, `aram-budget.ts` and `stats-grid.ts`. `@angular-eslint`'s
`template/no-call-expression` is the rule that would enforce this, and it cannot be used in a signals
codebase where every read is a call; the structure is what keeps the bug out instead.
