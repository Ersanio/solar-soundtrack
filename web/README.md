# The editor

The Angular application. Everything it compiles, assembles and plays lives in `../packages`; what is
here is the UI, the four state services, and the adapters that join CodeMirror and Web Audio to
framework-free code.

Run everything from the repository root, not from here. `npm start`, `npm run build` and
`npm run watch` each have a pre-hook that bundles the worklet, mirrors the SPC package's assets into
`public/`, and writes the commit SHA — none of the three is checked in, and `ng serve` skips all of
them.

## Layout

| Path                    | What it is                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `src/app/state/`        | Four `@Service()` singletons in dependency order, and the transport's clock          |
| `src/app/editor/`       | The left pane and its chrome: top bar, transport, mixer, palette, CodeMirror adapter |
| `src/app/editor/views/` | What the pane's tabs switch between: source, sample library, piano roll              |
| `src/app/output/`       | Diagnostics, stats, the ARAM bar, the command inspector                              |
| `src/app/shared/`       | Form controls, panels, icons, chart helpers                                          |
| `src/app/util/`         | Formatting, IndexedDB, `clamp`                                                       |

State flows one way: `DriverStore` → `SampleStore` → `EditorStore` → `Playback`.

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
under `editor/views/`, an entry in its `VIEWS` const and a `@case` in its template.

**A view brings its own controls.** The panel header is the tab strip and only that; anything that is
a setting on one view goes in an `<amk-toolbar>` as that view's first child. This is the point of the
arrangement — word wrap is meaningless in the sample library, and a piano roll's zoom and snap will be
meaningless in the source, so there is no honest way for one shared header to serve all of them. Host
class is `flex min-h-0 min-w-0 flex-col`, as the panes' own is.

**The source view is the one that is hidden rather than destroyed**, because CodeMirror holds undo
history, scroll position and selection that nothing could restore. So it is alive while another tab is
showing, and its effects still run: a diagnostic clicked from the Samples tab has to bring the source
back. It asks for that with an `activate` output rather than reaching for the tab itself, and it is
told whether it is showing with an `active` input, because measuring or focusing a `display: none`
view is a no-op and the render barrier has to be taken first. Any later view with state worth keeping
does the same; the rest are `@case`d and rebuilt.

## Preview and commit

Everything that edits MML writes back through `EditorStore.replace`, which recompiles. So a control
that committed on every `input` event would push a recompile through the typing debounce once per
frame of a drag, and the commit's own recompile would feed a new value back down and yank the thumb
out from under the pointer.

`amk-slider` is where that contract lives:

- `preview` fires continuously, for anything cheap and local — a graph redrawing, a readout counting.
- `commit` fires once, when the gesture ends.
- `pending` holds the dragged value in front of the bound one until it does.

`value` is an `input`, not a `model`: a commit is a gesture, not a change, and a two-way binding
cannot express "the source of truth updates when I let go". Readouts are computed from the
_previewed_ value — a label derived from the document would sit there describing the number you are
dragging away from.

## Reaching into the editor

`editor/views/source-view/` owns the CodeMirror view, so nothing else may touch it — not even the
pane it sits in. Three signals on `EditorStore` are how a sibling panel asks:

- `reveal` — select and scroll to a span, set when a diagnostic is clicked.
- `replace` — apply a splice, set when a panel edits a command in place.
- `insertion` — type a snippet in at the caret, set when a palette button is clicked.

`insertion` is the one with no span of its own: where it lands is the view's own selection, which
only the editor knows, so there is nothing for an `expect` to guard and the spacing has to be
decided at dispatch time. It never deletes and never lands mid-command — a palette click means "add
this", and the click before it left an argument selected for typing over.

`replace` carries `expect`, the text the splice believes occupies the span. Panels read the
_undebounced_ scan, so their spans agree with the document — but only up to the microtask that
carries the edit across, and a control that fires on `pointerup` is one gesture away from a document
that has moved. The editor compares before it dispatches, which turns that whole class of race from
silent corruption into an edit that simply does not take.

`EditorStore.apply` ignores the `null` the splice builders return when nothing would change. A
slider fires per frame of a drag, and "that is the text already there" is what keeps a drag from
pushing dozens of identical recompiles through the debounce.

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

`SpcPlayer` owns one for song playback. `Playback` owns a second for one-shot sample audition. They
are separate on purpose: auditioning a sample must not interrupt or be interrupted by the song.

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
that needs either file, and `stack.ts` is the only chart code with a harness — `npm run charttest`.

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
(`Music.cpp:809`), and this port reproduces that faithfully. What used to follow was that
`stats.playback` was `null`, `Playback.duration` was 0, and `canSeek` — the single gate on seeking
and on scrubbing the roll — was false. Those songs could be played and nothing else.

So `duration`, `secondsAt` and `ticksAt` read the clock and fall back to `stats.playback` only when
there is no walk to read. The two agree exactly on any song that sets its own `t`; a song that sets
none reads **55/54 longer**, because `estimateSeconds` treats `0x36` as a written byte where
`main.asm:177` puts it straight into `$51`. That is the same ruling as "assume t53 for songs that
don't have a tempo command", and `walktest` pins the ratio so it cannot drift.

The seek bar stays denominated in **seconds**, which is the one place in the app that is not ticks.
It prints m:ss and a constant time-per-pixel is what a seek bar is for — on a song fading from t53 to
t254 a tick-denominated thumb would move four times as fast at the end as at the start. Everything
downstream of it is ticks: `ticksAt` converts once, and `player.seek` and the worklet take the tick
itself, so the emulator lands on the tick it was given rather than on a prediction that runs early
the further in it reaches.

## The piano roll

`editor/views/piano-roll/` draws whatever `@amk/spc/song-walk` says, and nothing else — the
compiler's `noteMap` records an address, a channel and a span, and no pitch, duration or tick, so
the roll is a view of a walk over the emitted bytes rather than of the compile. Rows are the
**emitted note byte**: `@2 o5 g` draws on o5 d, because `@2` carries a default transposition of five
semitones, and the roll shows what the driver plays rather than what the letter said.

Two clocks drive it and keeping them apart is the whole trick. The mark list is a `computed` over
the transport's 10 Hz anchor, snapped outward to a whole note, so the DOM rebuilds about twice per
screen; the scroll is a `computed` over `shared/chart/frame-clock.ts` and is one `transform` that
nothing beneath reads. That is why the roll can run at 240 Hz without the note list knowing.

The playhead **carries its position across frames** rather than deriving it from the newest anchor,
and `advanceTick` in `roll-layout.ts` is where that lives. It matters: every anchor arrives with
about the same small lag — mostly the time the message spent getting here — so a clock that
re-derived its position each frame reproduced that lag ten times a second and jerked to close it.
Measured on a `t48` song, one frame in ten ran at 2.4× speed or stalled outright, spaced exactly
100 ms apart, and the roll visibly stuttered. Running at the driver's rate and easing the gap shut
turns a periodic jolt into a constant offset nobody can see. `charttest` pins it.

Interpolating over tempo is what the root `CLAUDE.md` warns against, so read the comment before
"fixing" it. The rule forbids a playhead _built on_ the formula, because the driver drops ticks and a
formula compounds them; here the driver's own count steers the clock on every anchor, so the formula
sets the velocity between readings and never the position. Raising the worklet's post rate instead
would cost sixty structured clones a second from the audio thread and still not match a 144 Hz
display.

Only what the song uses gets a row: the pitched range is fitted and rounded out to whole octaves,
and a drum or noise lane appears only when something plays it. Rows then stretch to fill the pane,
because two octaves stranded at the top of an empty box is the worse picture.

**A row is chosen by the instrument, not by the note byte.** Everything played while a drum is
loaded is that drum being hit, so `@29 c d e` is three marks on one lane rather than one drum and
two notes scattered up the keyboard — the pitched ones only look melodic because `parser.ts:2676`
stops remapping after the first. The pitch they were written at is still true and still in the
tooltip; it just does not decide where the mark goes.

**Which instruments are percussion is the porter's to say**, from the toolbar's `▸ Percussion`
strip. `percussion.ts` holds the default — `@21`-`@29` plus `@10` — and the whole of the reasoning,
including why nothing is derived: the obvious rule is to look at the sample an instrument resolves
to and ask whether the driver's drums play it, and that says no the moment a porter swaps one drum
sample for another. Nothing in the data answers "is this a drum", so the question goes to the person
who knows. Anything on the list can be taken off, `@21`-`@29` included; a bare `$D0`-`$D8` then
falls back to the pitch the driver's own percussion table gives that drum, so it keeps a row rather
than vanishing.

`placeOf` is the one statement of the precedence — percussion, then noise, then the keyboard. The
lanes and the fitted range are both built from it because they used to be two implementations of it
and had to agree. `song-walk.ts` has no opinion on any of this by design.

A channel longer than the song is **not** the roll's business, even though the walk is what notices
it — that goes to the diagnostics list as `AMK0502` and to the editor as a wavy underline on the
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
