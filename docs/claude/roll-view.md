# Piano roll: view and interaction

Read before changing the roll's camera, scrub and overview bars, grid, cursor, hover, pointer
handling, selection or toolbar.

## Decisions already made

- **Parking the roll in an `effect` on the follow flag** — an effect runs after the handler and
  overwrote a position set in the same gesture that came off the song. Parking happens where the
  following stops, which is `setFollow` and the pull's first frame.
- **Seeking the roll by `Shift`+wheel, committed on a 200 ms quiet timer** — nothing on screen said
  the roll could be seeked at all, and the commit fired on a guess about when the gesture had ended
  rather than on anything the porter did. The scrub bar over the roll is the affordance, and a
  pointer-up is a real end.
- **One bar over the roll doing both jobs** — a drag on the song-wide bar panned the camera and
  seeked the song at the end of the same gesture, so neither could be done alone: no way to look
  ahead without moving the music, and none to move the music without moving the view. Two bars, one
  job each — the overview scrolls (`roll-overview/`), the scrub bar seeks (`roll-scrub/`) — and a
  scrub reaches past the pane by pulling the view along rather than by being song-wide, since a
  timeline drawn in the roll's own coordinates is what puts the marker's tip on the playhead line.
  The preview stays out of the camera for the same reason it is a preview at all: `playTick` reads
  `songHead` and not `headTick`, or the music would slide sideways under the pointer and the marker
  would snap back to `lead` the moment it was grabbed.
- **`w-full` on the bars over the roll** — the pane is measured inside its vertical scrollbar
  (`elementSize` reads the content box) and the bars are drawn outside it, so the `viewBox`
  stretched over that gutter while the pointer maths did not, and the drawn window disagreed with
  the tick under the pointer by about a scrollbar's width. Both are `[style.width.px]="width()"`,
  which is the roll `<svg>`'s own width, so one user unit is one CSS px in one shared space.
- **Roll rows on the emitted note byte** — `@2 o5 g` drew on o5 d, which is neither what was written
  nor what sounds (the five semitones cancel the sample's tuning), `h` used as the readme's "Tune"
  moved every note off the letters in the source, and no edit could map a byte back to text. Rows
  are the written pitch (`NoteAddress.written`); what a note plays as is a tooltip line. No "as
  played" toggle either: an honest one is not computable, since a sample's root is not in the data.
- **A single click on a roll bar revealing the source** — it threw the author onto the Source tab
  on every glance at a note. A click asks the inspector about that note and a double click goes to
  it; `reveal` carries a `show` flag for the difference.
- **A component element inside the roll's `<svg>`** for the command glyphs — `<amk-command-icon>`
  written there is an unknown SVG element, so it has no layout box and neither it nor its children
  render, silently. The glyph is an attribute component on a real `<svg>` (`svg[amk-glyph]`), and its
  template's elements carry the `svg:` prefix because Angular takes an element's namespace from its
  parent in the same template and that template has no `<svg>` of its own. `palettetest` greps for
  both.
- **A fixed quarter-note grid in the roll, with a heavier rule every whole note and no bars** — MML
  carries no time signature, so the lines declined to claim they were bar lines and a song in 3/4 or
  7/8 got a rule that fell across the beat everywhere but where it happened to agree. The porter
  supplies the signature the format has not got: beats per bar over the note value that gets the
  beat, `0` beats for no grid at all, and `gridLines` counts beats from tick 0 so a bar line is a
  bar's first beat by construction. Not a `tick % barTicks` either — `tickWindow` snaps to a whole
  note, a 7/8 bar is 168 ticks, and the two align only by coincidence.
- **Capturing the pointer, and preventing the default, on the roll's `pointerdown`** — both stop
  the browser raising `click` and `dblclick` on the bar underneath, which took away everything a
  single click on a note used to do: naming its channel, asking the inspector about it, and going to
  it in the source on a second click. Capture is taken on the first move past the slop threshold
  instead, which is late enough to leave a click alone and early enough to follow a drag off the
  roll; a press that never moves is a click and commits nothing, drawing on empty grid excepted.
  A bar of another channel is not empty grid either — `itemAt` only knows the edited channel, so the
  press checks `event.target.closest('.mark')` before it decides it is drawing.
- **The roll's playhead line derived from `lead`** — the camera and the line were one number, so
  unticking Follow parked the line with the view and nothing in the roll said where the music had
  got to: the line, the marker on the bars and the lit keys all froze together, and the frame clock was
  switched off with them. `lead` is the camera's alone; the line is the song's tick in the camera's
  coordinates (`xAtTick`), and the clip is what hides it once the song runs off the pane. Not a
  clamp to the edge either — a line held there would say the song was there.
- **An HTML bubble for the roll's length readout**, in the volume slider's mould — the roll's
  coordinates are already the song's, so an HTML one has to undo the scroll transform and the
  scroller's own offset to land where an SVG one lands by standing still.
- **The roll's page anchor reset on the transport being idle, rather than on its going idle** — an
  effect runs once when it is created, so a roll rebuilt while the song was stopped zeroed the anchor
  it had just been given and the view shifted by up to a page on every tab switch. It follows the
  transition: what re-measures the pages is a stop. The camera outliving the component
  (`roll-camera.ts`) is what turned a harmless re-run into a lost position.
- **Keeping the roll alive behind `[class.hidden]`**, as the source view is — the symmetry is
  inviting and it does not work: `display: none` destroys the layout box, so the native vertical
  scroller comes back at row 0 regardless, and a hidden roll goes on drawing marks, a grid and a
  transform for a tab nobody is looking at. CodeMirror is hidden because its undo history is not
  something anything could hand back; a camera is four numbers that can be.
- **`cursor-pointer` on the roll's note bars**, to say a bar is clickable — an element's own
  `cursor` beats the one it inherits, so the class silenced the roll's own cursor over every painted
  part of a bar. The `ew-resize` showed in exactly one place: the `NOTE_GAP` sliver past a bar's
  drawn right edge, where nothing is painted and `itemAt` still reports the note, since it hits the
  whole slot. A bar's left end has no such gap and so had no handle at all. The `<svg>`'s
  `[style.cursor]` is the roll's only cursor, and it says which gesture a press starts;
  `hoverCursor` answers `pointer` for the bar that really is only clickable, which is another
  channel's. The glyph plates inside a bar take no cursor either — they are right-aligned, so one
  would sit on the right stretch zone and put the same bug back over the last twelve pixels.
- **Moving `editChannel` onto `Mixer`** so a press on `M` or `S` could set it at its own call site,
  the way the roll's chips do — it is one field of the roll's persisted `Settings`, and a service
  owning it either splits that `localStorage` write in two or takes the whole roll's settings with
  it. The mixer is carried into the roll by a transition-following effect instead
  (`followMixer`), through `onChange` (`util/on-change.ts`) as the page anchor's reset in
  `roll-view.ts` is: it holds the last mask and runs the body `untracked`. Following the state and
  not the transition is what does not work — the roll is
  rebuilt on every tab switch, so an effect reading `silenced()` alone would drag the edited channel
  back to a solo taken long ago each time the tab came round.
- **Refusing every gesture until a channel is picked** — the roll was already pointing at the answer
  and would not take it, so the first act on a song was always to find eight small chips in a corner.
  With none picked the strip is built for the channel of the bar under the pointer (`editing`, off
  the `hovered` mark the tooltip already tracks), which gives the cursor, the hit test and the press
  the same channel for free, and `onPointerDown`'s existing `pick` sink names it for real. Not a
  hover-wide adoption either: empty grid belongs to no channel, so drawing, the marquee and the
  shortcuts still ask for one, and `editRefusal` and `onKey` stay on `editChannel` so a channel
  merely hovered is never announced as being edited.
- **A muted channel editable but un-clickable** — its bars take no pointer, so muting the channel
  being edited left drawing and the keyboard working on notes that could not be selected or heard.
  The strip refuses a silenced channel outright, in `silencedReason`'s words, which is the same
  sentence `Audition` refuses to preview one in.
- **Setting that cursor from the pointer move that reported the position** — the roll scrolls under
  a still pointer for the whole of a followed playback, so bars arrived under a cursor that had been
  told `crosshair` and nothing said otherwise until the pointer moved. It is a `computed` over
  `Hover`, which is stored in pixels for this reason, and `drag` is read first so a gesture in
  flight keeps its own cursor. Nothing clears the hover on `pointerdown` either: `drag` is what
  stands it aside in both readers, and a press that turns out to be a click has to have somewhere
  to go back to.
- **The roll's own bars drawn without regard to the gesture in flight** — the marks come off the
  compiled song and the preview off the `Plan`, two paths that never consulted each other, so a
  dragged note was painted twice: a solid bar following the pointer and the original left behind
  with its selection ring still on it. The bars leave out what the preview has taken over
  (`moving`, by strip index, turned into addresses by `movingSpans`), and it is a set rather than a
  flag because a selection drags as a group. Still not folded into `buildMarks`, which rebuilds
  about twice a screen and would otherwise rebuild the whole song's DOM on every pointer move. A
  copy needs no case of its own: `planGesture` gives a copied note `from: -1`, so `Ctrl`+drag hides
  nothing.
- **A refused plan returning `NOTHING`** — the bar under the pointer vanished mid-drag, in the one
  state where the porter most needs to see where the note is, and `PIANOROLL.md` had long said the
  opposite. A refusal that knows where its notes were going keeps them in `touched`, so the bar
  stays, red, until it is let go and the drag snaps back by committing nothing; `blocked` reads
  `Preview.refused` beside the clash count for the colour. `NOTHING` is left to the refusals that
  have nowhere to draw — a pitch off the driver's range has no lane, so `rowOfPlaced` answers -1
  whatever `touched` holds.
- **Letting the wheel size a note that is already being dragged** — `planGesture` takes one
  `Gesture`, and a note carried _and_ resized is two, so the second one silently won and the drag
  went nowhere. The wheel speaks only while the press has not passed `SLOP_PX` (`stepLength`), and
  once it has spoken that press is a `stretch` of the note's far end and stays one however far the
  pointer wanders. The pointer is already saying which of the two it means; this is only agreeing
  with it.
- **`shownPlan` gated on `moved || kind === 'spawn'` alone** — a press the wheel had resized had a
  plan, committed it on pointer-up and drew nothing at all in between, so the length was chosen
  blind. `held.length !== null` is the third way a press becomes something worth drawing, and it is
  the same field the commit reads.
- **The middle-button pan inside `roll-gesture.ts`** — that file refuses everything before it has a
  `Strip`, so panning would have needed a channel picked, and the camera is not the editor's
  anyway. `onEditDown`/`Move`/`Up` take `button === 1` before delegating; the gesture layer's guard
  is narrowed to buttons 0 and 2 so the middle one cannot fall through to drawing. Preventing the
  default on `pointerdown` is what stops the browser's autoscroll, since the compatibility
  `mousedown` goes with it.
- **Snapping a drag's destination rather than the distance it travelled** — snapping the sum of the
  start and the movement is grid magnetism: a note written a little before the beat was pulled
  square the first time it was touched, and one nudged less than half a step moved when the porter
  had asked for nothing. `draggedTick` snaps `moved` and adds it, so the offset against the grid is preserved and
  the delta is a whole number of steps — the same thing `←` and `→` pass to `run()`, which the drag
  had silently disagreed with. `spawn` keeps the absolute snap, having no position of its own yet,
  and `quantize` is left as the one gesture that squares a note up.
- **One `Shift` flag for both of the gestures it changes** — `Shift` decides what a press on empty
  grid _is_ (a note pinned at the press with its end on the pointer) and merely _constrains_ a drag
  already under way (locked to one axis), and those settle at different times. `anchored` is read at
  the press and never again; `shift` is refreshed on every move, as `fine` is.
- **`Shift` as a row lock alone, or `Ctrl` as the tick lock beside it** — the second has no key to
  take: `Ctrl` at the press is a copy on a bar, the marquee on empty grid and the selection toggle
  on a click, and every chord with it or `Alt` breaks a combination that already means something.
  `Shift` locks the axis the drag first moved along instead — sideways is the row lock it always
  was, up or down pins the tick. The axis is latched in pixels at the slop transition, where the
  pointer is captured, and never re-derived: a near-diagonal drag re-read every move would flip its
  constraint mid-gesture. `shift` itself stays per-move, so releasing it lifts the lock and
  re-pressing it restores the same axis.
- **The overview bar's minimap in one grey, deduped by pixel and row alone** — it was the one picture
  of the song that would not say whose note a bar was, and the key made that structural rather than
  incidental: two notes colliding on it are by definition two channels', so the wider won and the
  other channel's note left the picture with nothing to say it had gone, which two channels sharing a
  drum lane does on every song that splits percussion. The bars carry `CHANNEL_FILL[note.channel]` as
  the roll's marks do and the channel is in the key, so a cell is one channel's reach through one
  pixel of one row and "keep the wider" compares a channel against itself. Dropping the channel back
  out of the key is not the cheaper spelling it looks like: the count is bounded by the song's notes
  either way — the pixel-and-row ceiling is `rollWidth × rows`, some hundred thousand cells, and
  never bound anything — so the only thing that key saved was the notes it was losing. In the key
  rather than beside it because `id` is what `track bar.id` tracks. A silenced channel is dimmed to
  the roll's own `MUTED_OPACITY` rather than dropped, and in a second map so its bars come back
  first and a live one is never veiled by the wash of something that cannot be heard; `charttest`
  pins all of it, none of it visible in a screenshot.
- **Dropping the roll's selection on every change to the document, and again in every commit** — it
  is a set of indices into a `Strip`, and the strip is rebuilt from text the roll may not have
  written, so clearing was the only answer that could not be wrong. It made the inspector unusable
  on a note: the Length slider commits, the document changes, and the note the panel is answering
  about loses its outline in the roll beside it — and the roll's own resize cleared twice over, once
  at the commit and once at the change that commit caused. The **document change** is the one place
  it is decided (`sourceChanged`), and no commit clears any more, which is also what lets an outline
  stand through the compile the roll spends with no strip at all. A panel's splice rewrites one
  command's own text and adds and removes no item, so the indices still name their notes
  (`EditBatch.keepsNotes`, which the lane's own command writes claim too, counted by the **view** in
  `dispatchBatch` because a batch whose `expect` has gone stale is dropped in silence and a count
  taken where the batch was asked for would run ahead of the document — and the loop inspector's
  Recalls is the one panel commit that says no, the body a call plays being part of the calling
  channel's strip); a gesture leaves
  anchors saying where each note went — its frame, and its place among that frame's notes
  (`plannedOrdinals`, `roll-selection.ts`), which within a frame is text order and tick order at
  once and is what `planEdits` writes in. Every note the selection named and the plan still carries,
  not only `touched`: a stretch pushes its neighbours, and one of those the porter had hold of is
  still theirs. Not the tick, which a length change moves for every note after it, so a group would
  lose everything past the one edited; not the address, which every byte written before it moves —
  `emitNote` drops a repeated duration byte, so writing a length shifts the rest of the channel; not
  a source offset mapped through the splices, since `growUnits` widens a unit over the very `o` a
  commit inserts at a note's head and a note carried past a neighbour has no offset to map at all,
  `crossings` lifting it out of the text and writing it back on the far side. The pitch is confirmed
  on the way back in rather than trusted, so the worst a wrong claim can do is take an outline off —
  by the `@` alone for a drum, whose letter says nothing and whose drawn form is handed the row's
  own `c`. The loop box's gap and resize carry none: neither goes through a `Plan`, and `resizeLoop`
  moves the brackets, so notes cross into and out of the body. And `selectedSpans` is **held** across
  the recompile rather than emptied, in the mould of the clock measurement — the bars drawn for that
  whole compile are the last one's, so the last one's addresses are the ones that outline them.
- **The roll toolbar's readout line** — `editing: #0 · tick 7,534 of 14,592 · t55 · 109.4 ticks/s ·
3,468 notes`, rewritten twice a second while playing. It said five things in one place, four of
  which were not the roll's: the channel is what the corner picker already shows, the note count is
  a fact about the song and sits in the status bar whatever view is up, and the tick is the
  transport's, whose clock well shows either m:ss or `tick N / M` and flips on a click
  (`solar-soundtrack.clock`). The tick face runs on the roll's own display clock (`rollClock`) at
  frame rate rather than on a half-second sample, so the number and the line it stands for cannot
  disagree, and `slowTick` went with the readout. The tempo and the tick rate are the status bar's
  too, read at the playhead — the driver's tempo while it plays and the walk's last `t` otherwise —
  so a song the driver cannot keep up with says `231.9 of 498.0 ticks/s` from any view. What stays
  on the toolbar is what only the roll can say: how many notes are selected, and why a channel or a
  gesture was refused.
- **The toolbar's messages at `ml-auto` in the wrapping strip** — a message that did not fit beside
  the controls wrapped onto a row of its own and took the row away again when it went, so the roll
  moved under the pointer on every refusal and every change of selection. The messages have a fixed
  line of their own (`basis-full`, `h-4`), drawn when empty, and each one is truncated to that line
  with its full text in a `title`.
