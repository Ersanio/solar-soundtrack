---
paths:
  - 'web/src/app/editor/views/piano-roll/**'
---

# Piano roll: architecture

How the roll is put together: what it draws from, how it lays a song out, and which module owns
which part. The editing path is in `roll-editing.md`, the view's decisions in `roll-view.md`.

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

**The folder is a parent and thirteen children**, as `output/command-inspector/` is. `piano-roll.ts`
holds the song's shape and the porter's settings and hands each child what it draws:
`roll-toolbar/`, `percussion-panel/`, `roll-overview/`, `roll-scrub/`, `roll-channels/`,
`roll-command-lane/` and `roll-tooltip/` in the ordinary namespace, `roll-lanes/`, `roll-grid/`,
`roll-loops/` — which holds two, the boxes and their labels — `roll-notes/`, `roll-edit-layer/` and
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
motion, `roll-selection.ts` for what a commit hands back, `roll-seed.ts` for the first rest a song
with no music gets, `roll-strip.ts` and `roll-edit.ts` and `roll-write/` for a gesture's three
stages, `roll-command-layout.ts` and `roll-command-move.ts` for the lane, `roll-shortcuts.ts` for
the keyboard, and `roll-settings.ts` for what is remembered.

**Six files in the folder import `@angular/core`, and each says which kind it is.**
`roll-camera.ts` is a module record — four signals that outlive a component rebuilt on every tab
switch. The other five are composables, called from `piano-roll.ts`'s field initialisers in the
order they depend on each other: `roll-view.ts` for the camera, the display clock and the two
drags over the roll; `roll-target.ts` for the channel a gesture acts on and the strip it splices;
`roll-gesture.ts` for the gesture itself; `roll-pictures.ts` for what is drawn, after the gestures
because the loop boxes follow the one in flight; and `roll-clock.ts`, which `roll-view.ts` calls.
No harness can bundle any of them, which is why the arithmetic each one leans on sits in a flat
file of its own — `roll-clock-step.ts` under `roll-clock.ts`, `roll-edit.ts` under
`roll-gesture.ts`, `roll-marks.ts` under `roll-pictures.ts`.

**The seven inside the `<svg>` are attribute components on a real `<g>`**, and their templates prefix
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
between m:ss and ticks), so the number and the line cannot disagree. The status bar says the rate at
the playhead — `t254 · 231.9 of 498.0 ticks/s` when the two part company by more than a twentieth,
the plain figure when they agree — from the measurement's shortfall over the whole pass, which is the
figure `SST0503` is raised on, applied at the playhead's tempo. Not the clock's slope at the tick:
the measurement polls once a tick in 5 ms blocks, so one segment reads 100 or 125 ticks/s on a song
that plays at 107.

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
