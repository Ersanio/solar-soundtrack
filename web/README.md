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

- `reveal` — select a span, set when a diagnostic or a piano roll bar is clicked.
- `replace` — apply a splice, set when a panel edits a command in place.
- `insertion` — type a snippet in at the caret, set when a palette button is clicked.

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
`EditorStore` asks **a second after typing stops** rather than on every compile — a typing burst
would throw every answer away, and a second of quiet is far less than it takes to reach for the
transport. The predicted clock stands in the meantime and stands for good if the measurement fails,
which is why it is still worth having.

`AMK0503` is the same finding pointed at the porter: past 10% the song is not playing at the tempo it
was written at, and a SNES drops the same ticks, so it is a fact about the song rather than about
this editor. `severe`, beside the echo hazards and `AMK0502` — it compiles cleanly and then
misbehaves on playback. The comparison starts at the first tick: the driver's boot, and the echo
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
that note; a double click goes to it in the source, which is what a click alone used to do. Clicking
a glyph targets its command instead. What fits is measured (`fitBarContent`): the name has priority
and the glyphs drop from the end, because a bar that says `C6` and nothing else is still saying
something. Anything dropped is in the hover and in the inspector, so nothing is only on a bar. A
muted channel is drawn dimmed, behind the others, and takes no pointer at all, so where a live note
overlaps it the live one is what a hover or a click reaches.

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
is asked about that note. `state/commands-in-force.ts` is the join, kept out of the store so
`walktest` can pin all three halves on the songs that need each.

The song's own settings and the shape of the music get no glyph — `t`, `w`, `$E4` and the echo unit
reach every note alike, and `o`, `<`, `>` and `l` are what the bar's row and width already are.
`commandScope` is the one statement of that.

Written pitch is not held to the driver's o1 c–o6 a — `o0` is legal MML and `h12 o0 c` is a note the
driver plays — so `roll-layout.ts` grows the keyboard to take such a note in, above or below.

**The grid behind the notes is the porter's, since MML has not got one.** The toolbar's `x/y` is
beats in a bar over the note value that gets the beat, and that lower number is an MML note length —
6/8 is six `l8`s, and a 4/4 bar is one whole note, 192 ticks. `gridLines` counts beats from tick 0
and takes the bar from the count rather than testing a tick against a bar's length: the mark window
snaps outward to a whole note, a 7/8 bar is 168 ticks, and the two therefore line up only by
coincidence, so a bar line has to be a bar's own first beat by construction. Zero beats in a bar is
the grid switched off, which is why there is no separate switch for it.

**The scrub bar** across the top is the whole song at once, and the only way to seek from the roll.
Its width is one song — tick 0 on the left edge, the last tick on the right, at every zoom — so it is
the song rather than a view of it, and `scrubOffset`/`scrubTick` are that mapping and its exact
inverse: a drag commits to the tick under the pointer. It sits outside the roll's own scroller,
because a scrubber that scrolled out of view would be gone exactly when a tall song most needs it.

Its bars ask `rowOf` — the same function the roll's marks ask — so the percussion toggles land on
both pictures at once, and an instrument taken off the drum lanes moves to the keyboard in the
minimap and the roll together. Answering that question twice is how the two would drift. The bars are
deduped by pixel and row, keeping the wider of a pair: every bar is one colour, so two notes sharing a
pixel of a row are the same picture, and a dense song still fits in the DOM. The list is built from
the song, the lane stack and the pane's width and never from the playhead, so it rebuilds on a
recompile and not on a frame; the playhead line and the box showing what the roll is displaying are
their own `computed`s over the frame clock.

Two clocks drive it and keeping them apart is the whole trick. The mark list is a `computed` over
the transport's 10 Hz anchor, snapped outward to a whole note, so the DOM rebuilds about twice per
screen; the scroll is a `computed` over `shared/chart/frame-clock.ts` and is one `transform` that
nothing beneath reads. That is why the roll can run at 240 Hz without the note list knowing.

**Which of the two moves is a view option**, "Scroll the notes" on the roll's own toolbar. Ticked,
it pins the playhead a fifth across the pane and slides the music under it; unticked — the default —
the roll pages: the music holds still and the playhead crosses it,
turning the roll over by 80% of a pane once the line reaches 90% of it — so it lands a tenth in with
the bar it has just played still on screen. **Every page opens on that tenth, the first one
included**: page zero starts before tick 0, so a song is drawn with the margin it keeps for the rest
of its length rather than against the key column. Opening on tick 0 instead would put the margin
only on later pages, so it appeared at the first turn and a scroll back to the beginning showed a
space that vanished again on the way back to the song. Both are the same arithmetic: `lead` is how far across
the roll the playhead sits, and the camera and the line are both derived from it, so a pinned
playhead is simply the value that number holds still at. `pageStart` is a closed form and not a counter, so given its
anchor the page is a function of the tick and a loop wrap or a resize lands on the right page with
nothing to reset. **The anchor is what a scroll moves**: measured from the song's own start always, a
seek would drop the playhead wherever its place in that fixed grid happened to fall, and the notes
would jump back the moment the drag ended — by exactly as far as the scrub had just moved them.
A scrub re-anchors the grid on the view it leaves behind, so the roll carries on from what is on
screen and turns a page a full pane later. A stop puts the anchor back on tick 0, since a stop is
back to the beginning. The mark window is unchanged and does not need to be told: it already carries a
screen of margin either side of a playhead at a fifth, and every page a sweep can produce falls
inside that — `charttest` pins the coupling, because a roll drawing the wrong span scrolls perfectly
smoothly over blank music.

The playhead **carries its position across frames** rather than deriving it from the newest anchor,
and `advanceTick` in `roll-layout.ts` is where that lives. It matters: every anchor arrives with
about the same small lag — mostly the time the message spent getting here — so a clock that
re-derived its position each frame would reproduce that lag ten times a second and jerk to close
it. Running at the driver's rate and easing the gap shut turns a periodic jolt into a constant
offset nobody can see. `charttest` pins it.

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

The `ticks/s` in the roll's readout says the same thing: it shows `231.9 of 498.0 ticks/s` when the
two part company by more than a twentieth, and the plain figure when they agree.

Only what the song uses gets a row: the pitched range is fitted and rounded out to whole octaves,
and a drum or noise lane appears only when something plays it. Rows then stretch to fill the pane,
because two octaves stranded at the top of an empty box is the worse picture.

**A row is chosen by the instrument, not by the note byte.** Everything played while a drum is
loaded is that drum being hit, so `@29 c d e` is three marks on one lane rather than one drum and
two notes scattered up the keyboard — the pitched ones only look melodic because `parser.ts:2681`
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
lanes and the fitted range are both built from it, so they cannot disagree. `song-walk.ts` has no
opinion on any of this by design.

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
