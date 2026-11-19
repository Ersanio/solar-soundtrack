# The editor

The Angular application. Everything it compiles, assembles and plays lives in `../packages`; what is
here is the UI, the twelve state services, and the adapters that join CodeMirror and Web Audio to
framework-free code.

Run everything from the repository root, not from here. `npm start`, `npm run build` and
`npm run watch` each have a pre-hook that bundles the worklet, mirrors the SPC package's assets into
`public/`, and writes the commit SHA — none of the three is checked in, and `ng serve` skips all of
them.

## Angular specifics

Angular 22, zoneless (scaffolded `--zoneless`, so zone.js is not a dependency and there is nothing
to opt into), no router, no NgModules. Signals throughout: `signal`/`computed` for state, `effect`
reserved for mirroring into imperative sinks (localStorage, the player, the DSP). State lives in the
`@Service()` singletons in `src/app/state/`; the spine they form is under Layout below.

Selector prefix is `amk` — `amk-root`, `amk-editor-pane` for components, camelCase `amk*` for
directives. ESLint enforces both.

Styling is Tailwind v4, with the entire theme as CSS variables in `src/styles.css` (v4 has no
`tailwind.config.js`). The defaults are dark, and a light theme is a preset carrying its own
validated sets. `--color-seg-*` and `--color-ch-*` are categorical
sets: never reorder or re-hue their defaults, and never change the default `--color-surface`,
without re-validating them — and never leave channel identity to colour alone, nor draw on a
channel's colour in anything but its `--on-ch` ink (`.claude/rules/ui-and-theme.md`).

Framework-generic Angular 22 conventions (signal APIs, `@Service()`, host bindings, control flow)
live in `web/.claude/CLAUDE.md`, which the Angular CLI generated via `--ai-config=claude` and can
regenerate, so it is kept byte-identical to what the CLI emits. Where it disagrees with this file —
its "Accessibility Requirements" section, lazy-loaded routes, the `async` pipe — this repository
wins; the root `CLAUDE.md` says so. Adding a component is the `add-component` skill, and what must
stay true of `EditorStore` and the write-back path is `.claude/rules/state-and-editor.md`.

## Layout

| Path                    | What it is                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `src/app/state/`        | Twelve `@Service()` singletons in dependency order, and the transport's clock                      |
| `src/app/editor/`       | The editor pane and its chrome: top bar, transport, ARAM meter, mixer, palette, CodeMirror adapter |
| `src/app/editor/views/` | What the pane's tabs switch between: source, sample library, piano roll                            |
| `src/app/output/`       | The sidebar: the command and loop inspectors, stats, the ARAM budget, the hex dump, diagnostics    |
| `src/app/status-bar/`   | The status bar: compile status, the problems count, the development notice, the credit             |
| `src/app/shared/`       | Form controls, toggles, sections, popovers, tabs, icons, chart helpers                             |
| `src/app/util/`         | Formatting, IndexedDB, `clamp`                                                                     |

State flows one way: `DriverStore` → `SampleStore` → `EditorStore` → `Playback`. Eight more sit off
that spine: `ClockMeasurer`, which `EditorStore` owns and which drives the clock measurement in
`.claude/rules/transport-and-clock.md`; `Audition`, which hangs off `EditorStore` beside `Playback` and owns the second
`AudioContext`; `Mixer`, which holds the per-channel mutes, the solo and the output level and is
read by `Playback`, by `Audition` and by the roll — three readers and no owner is why it is not a
member of any of them, and the level is there for the same reason the mask is: both audio paths
apply it, the transport to the player's gain and the previewer to a `GainNode` of its own;
`EditorRequests`, which injects nothing at all, because a mailbox between the panels and the
source view has nothing to read; `ThemeStore`, which injects nothing either and which nothing
injects, because what it writes is CSS custom properties and `color-scheme` on `<html>` and every
reader of those is a stylesheet; `CommitAudition`, the command inspector's write path, which
forwards a panel's commit to `EditorRequests` and replays the selected note through `Audition`
once the compile that includes it lands; `Suppressions`, which injects nothing and holds the
diagnostic codes the porter has suppressed, which `EditorStore.diagnostics` leaves out of
everything it feeds (`.claude/rules/problems.md`); and `MidiInput`, which injects nothing and holds the Web
MIDI connection the top bar's MIDI switch asks for — every input plugged in, as one stream of
keys with one listener slot, which the piano roll takes while it is open
(`.claude/rules/piano-roll-architecture.md`, Recording from a MIDI keyboard).

`DriverStore` loads `packages/spc/assets/driver/`. The song's ARAM load address is the slot the
driver's own song pointer table reserves, stated in the bundle's `manifest.json` and checked against
the image by `spctest`. **There is no fallback address** — until the driver loads, compilation is
blocked rather than run against a guess.

`EditorStore` debounces typing (150 ms) into a `committed` signal that a `computed` compiles.
Diagnostics, stats, the ARAM budget and the hex dump are all `computed` off that one result.
`assembleSpc()` is a method rather than a `computed` because it copies 64 KiB of ARAM plus every
sample — wasted work on each keystroke.

## Adding a view

`editor-pane.ts` is a shell. It owns which tab is selected and nothing else, so a view is a folder
under `editor/views/`, an entry in its `VIEWS` const and a `@case` in its template. The tab row is
built from that const: each entry is a `TabDef`, which carries the view's icon and whether it sits
on the right of the row (`aside`) — Samples stands apart from Source and Piano roll that way, being
a library rather than a view of the song.

**A view brings its own controls.** The tab row is the tab row and only that; anything that is a
setting on one view goes in an `<amk-toolbar>` as that view's first child, grouped with dividers,
and a mode — Follow playback, Scroll the notes, All octaves, word wrap — is an
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

One pair runs between the roll and the transport: `recording`, which the roll holds true while a
keyboard recording is armed or in flight, and `stopRecording()`, which the transport's Stop button
calls. The roll owns the take and stopping one is writing it, so the button asks rather than acts.

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
`EditorStore` from it would turn the spine round. And it carries `show`, which brings the source
forward focused on the change as a shown `reveal` does: a fix from the Problems list asks for it, so
the keyboard's Ctrl+Z undoes the fix at once.

The whole write-back path rests on one fact: the source view is hidden, never destroyed, when another
tab is showing, so its effects are live while the roll is in front. If that `[class.hidden]` in
`editor-pane.html` ever became an `@if`, every roll edit would vanish silently.

## The CodeMirror adapter

`editor/codemirror/` is the only place that knows CodeMirror exists. `mml-language.ts` is 44 lines:
`@amk/tokens` exposes `step` / `startState` / `copyState` in exactly the shape `StreamLanguage`
wants, and `TOKEN_TAGS` holds `@lezer/highlight` tag _names_ as strings so the package itself stays
CodeMirror-free. This is the one place those names resolve to `Tag` values, and `tokentest` asserts
every one of them is real, so the cast is a checked one.

## Persistence is optional

The MML draft goes to `localStorage`; the sample library to IndexedDB via `util/idb.ts`, which
resolves rather than rejects on every path. Storage is genuinely optional — private browsing, an
exhausted quota — and must never stop someone compiling a song.

## Charts

Every chart here is Angular-templated SVG; nothing draws with a charting library. The four inspector
graphs work in a fixed viewBox from `shared/chart/plot.ts`, stretched to their container, so stroke
widths and offsets are in viewBox units rather than pixels.

`aram-bar` is the one that does not. It is measured with `element-size.ts` and laid out in real
pixels by `stack.ts`, because the surface gap between its fills and the floor under a small region
are pixel sizes, not fractions of the bar that would vanish as it narrows. It is the only component
that needs either file. `npm run charttest` pins both `stack.ts` and `plot.ts`, along with the roll's
layout maths and the transport's clock — anything here that is arithmetic rather than markup.

## Panels build view models, not methods

A `computed` of rows with everything resolved, rather than a method called per row in the template —
see `sample-browser.ts`, `aram-budget.ts` and `stats-grid.ts`. `@angular-eslint`'s
`template/no-call-expression` is the rule that would enforce this, and it cannot be used in a signals
codebase where every read is a call; the structure is what keeps the bug out instead.

## Text

Every string a porter reads is written by a grouped ID for Angular's i18n — `i18n="@@id"` in the
templates with the ID as the text, `$localize` in TypeScript — and `src/locale/messages.en.json`
holds the English, which the build swaps in. Wording is changed there; `npm run start:ids` shows
each message's ID where its English would be. A ternary between two strings in a binding becomes a
`text` object of messages on the component. The rules: `.claude/rules/i18n.md`.
