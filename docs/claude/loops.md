# Loops

Read before changing loop boxes, wrap, join and split, `roll-loops/`, the loop inspector and
`loop-focus.ts`, or `(n)m` and `*`.

## Decisions already made

- **Unrolling loops as the roll's answer to a `[ ]`** — a rewrite wrote n copies of a body under
  re-asserted parse state, and the roll refused every loop-bearing channel and pointed at it. It is
  the walk instead: `SongTimeline.loops` is raised off the driver's own `$E9`/`$E6`
  frames, the strip frames each body and edits the one text in place, and every pass is drawn,
  auditioned and joined per instance. Unrolling turned away exactly the songs porters write — a
  recall under another instrument, a loop and a subloop that cross — inflated a document
  n-fold, and re-derived from text what the walk already knew; a declaration is told from a recall
  by command-map membership, a `]n`'s own `$E9` being the one dispatch `recordCommand` drops.
- **Editing one pass of a loop differently from its siblings** — considered and not supported, with
  no unroll escape hatch: a body is one text, the dashed box and the sibling rings are that
  statement drawn, and a variation on pass two is written by hand. An editor that offered to
  diverge an instance would have to unroll behind the porter's back, which is the document
  inflation the roll exists to avoid.
- **The loop box's edge drag as an in-body group move** — it slid the body's notes around inside
  the loop, which the notes' own bars already do once the edge click has selected them, and it left
  the roll with no way to put anything _between_ two passes of a recall. The edge is the
  construct's handle, not the notes': dragging it moves that pass occurrence in song time —
  `openGap` splits the recall's count around a gap of rests (`(1)5` → `(1)2 r1^1^1 (1)3`, a
  declaration's `]3` → `] r… *2`), leftward only closes the free rest space `gapSlack` prices, and
  the one shift boundary at the grabbed pass's start is what the preview slides. Not a second
  channel for the preview either: the bucket comparison (`ends[k] <= tick`) already shifts a note
  standing exactly on the boundary, which is the moved pass's own first note.
- **The loop box's edge as one gesture** — a press anywhere on the stroke slid the pass, so a body's
  length could only be changed by stretching the note at its end, and its trailing rest could not be
  reached at all: `realiseRegion` never rewrites a tail, deliberately, and `plannedFrameTicks` prices
  the body on that. The stroke is read by **where on it** the press landed — inside the same
  `EDGE_PX` zone a bar's own handles use it resizes, anywhere else it slides — and `[style.cursor]`
  says which before the press. The handle carries `data-ticks` beside `data-tick` so the press
  measures the box as **drawn**: `buildLoopRegions` clips a pass the song ends inside and floors its
  width at a pixel, so `run.passes[pass].ticks` would put a resize handle where no edge is.
- **A left-end resize that moved the notes inside the body**, the mirror of the right end — not what
  a left edge means: the porter is moving the boundary, not the music. The construct is pulled back
  by exactly the ticks the body's head gains (`resizeLoop`, `'start'`), so the first pass's notes
  stand still and every later pass slides by its own ordinal, and the rest goes at `frame.span.start`
  **before** any command written at the body's head — that command then runs at body-local `delta`
  on a pass beginning `delta` earlier, which is the tick it had. That is also what makes the two ends
  asymmetric at the tail: a right resize moves the voice's end by `count × delta`, a left one by
  `(count − 1) × delta`, the one delta having come out of the rests in front rather than been added
  to the song. Offered on the voice's **first occurrence** of the body and not merely on a run's
  first pass — a later occurrence's start is carried by the passes in front of it, so the end would
  travel the way the pointer did not.
- **A resize taking the pointer's travel as the body's own change** — a pass three deep begins three
  deltas later, so its far end moves by four of them and the handle ran away from the pointer it was
  being dragged by, which is the one thing a handle may not do. The travel is divided by the passes
  in front (`Drag.loop.ahead`, `passesAt`) before it is snapped, so the end follows and the body
  still changes by whole steps; the left end needs no such division, being the first occurrence's
  alone and held under the pointer by the construct moving back with it. Not the note stretch's
  reading, which lets the grabbed note run ahead — a note is being given a length, where an end is
  being put somewhere.
- **Both ends of a seam offered where two passes meet** — every interior edge of a loop is two boxes'
  handles overlapping, the later one drawn on top, so a press on what looks like one edge asked to
  move a later pass's start and was told it could not. The seam belongs to the pass on the **left**
  (`passesAt().abuts`): its far end resizes from any pass. Told by another pass ending exactly there
  rather than by "not the first pass", so `(1)[c4] r1 (1)2` keeps the honest refusal on the second
  occurrence's own start, which really is free and really cannot move.
- **`ShiftBoundaries` generalised to a shift per bucket** for that asymmetry — it is not a different
  shift, it is a different **boundary**. A body-length change lands once per pass and where in the
  pass it lands is what decides it: a stretch or a right resize puts it at the pass's tail, so the
  step is at each pass **end**; a left resize puts it at the head, so the step is at each pass
  **start**, and the grabbed occurrence's own start is no step at all. One list of ticks either way,
  `roll-notes.ts`'s buckets untouched, and `shiftBoundariesFor` lives in `roll-edit.ts` beside
  `plannedFrameTicks` — the two halves of one arithmetic — because it is the only piece of a resize
  no walk can catch and a harness has to reach it.
- **The loop label carried on `LoopRegionBox`** — that list is built on the mark window's cadence and
  a selection changes on every click, so the whole on-screen box list would be rebuilt for a
  two-character plate; and the loop layer is drawn under the bars, where a label cannot be read. It
  is a second, short pass over the boxes already built (`buildLoopLabels`), drawn above the notes.
  Per **construct** rather than per body: `(1)[a1]5` and `(1)2` both name the body where a `*2`
  recalling that same body names nothing, and the digits come off `LoopSite.label` —
  `widenOverLabel` already reaches over the `(n)` for a declaration's span, so they are read once and
  `openGap`'s split reads the same field instead of scanning for a `)` of its own. Only the channel
  being edited has a selection to show one for, and it is `editChannel` and not `editing`, or a label
  would appear because the pointer wandered over another channel's bar.
- **A handle of its own for the loop's transpose**, beside the rule that slides the pass — the box's
  stroke is nine pixels and its ends are already spoken for, so a third zone on it would be a target
  nobody could hit, and one drawn outside the box would be a second thing to find before the obvious
  thing worked. The **axis** says which of the two a press is, the way `Shift` already picks an axis
  for a note drag: sideways slides, up or down transposes. Latched where `Drag.axis` is and read
  never again — a press that re-decided on every move would swap one edit for the other under the
  hand, which is the complaint **`Shift` as a row lock alone** (`roll-view.md`) already answers.
  The refusals do not carry across: a `'transpose'` holds `Drag.loop` and reads none of it, since
  a nested body that has no song-time position to slide transposes like any other.
- **`keysBetween` for that drag's semitones**, as a note drag uses it — it answers 0 wherever either
  row is a drum or the noise lane, and a body that plays percussion has its box's rules up there, so
  the gesture never started at all on the songs most likely to want it. It is the **rows** travelled,
  a row of the keyboard being a semitone, which is what `keysBetween` computes anyway wherever both
  ends are keys. And the gesture sounds nothing while it is held: the drag carries a whole body's
  notes, which is no more one note than the construct a slide carries is.
- **Dimming the loop boxes to 30% while a body-length edit is held** — they were the compiled
  song's reading of a song in motion, and a fade is not a way of saying "out of date": the box sat
  where the music used to be while the bars inside it moved out from under it, and the transpose
  made that plain by dropping them seven rows. They **follow** (`followLoopRegions`), a second short
  pass over the built list in `buildLoopLabels`'s mould, and the dim goes with the staleness that
  earned it. Not a bucket transform in `RollLoops` the way `RollNotes` deals its marks, for three
  reasons and not one: a box's width changes, its two edges take different counts so it has no one
  bucket to sit in, and the labels are a separate layer above the bars that would have to be
  transformed in step. A length change written by a plan is drawn as growth at the body's **tail**,
  which is not always the truth but is the reading `buildPreview` already takes — a box telling a
  truth the bars inside it did not would be the worse of the two answers.
- **`ShiftBoundaries` asked about a loop box's edges** — it answers a **tick**, and a pass's edges
  _are_ the boundaries, which is the one place that rule is discontinuous. Counting at-or-before at
  both edges is right for a tail change by luck and wrong for a head change by a whole delta, and no
  function of the tick can mend it: a box in front of the construct and the construct's own first
  box both sit at or below the first pass's start and want different answers. The changed body's
  passes are asked for by name (`passShiftsFor`, beside `shiftBoundariesFor` for its reason, and in
  **deltas** so it holds still from the press), and every other box takes the marks' rule at each of
  its two edges — inclusive at the left, where an insert always lands inside the box, and inclusive
  at the right only where the box **holds** the pass that boundary is for. That one test is what
  tells an outer loop round a growing body from a subloop sitting at that body's tail, whose edges
  are on the same tick and whose answers are opposite, and what stops the pass in front of an
  opening gap swallowing it. `framePasses` is the one walk `heldPasses` and `passShiftsFor` share,
  so the pass the preview projects a bar into and the box drawn round it cannot count differently.
- **A `selected` flag on `LoopRegionBox`** for the solid outline — the box list is built on the mark
  window's cadence and a selection changes on every click, which is the argument that kept the label
  off it too. `RollLoops` takes the body set as a second input and the template asks it per box, as
  `RollNotes` asks its own `selected` per mark. By **body** and not by the edited channel, unlike the
  label: the group is one text, so a recall on another channel goes solid with its declaration, which
  is what the rings on those notes already do.
- **The loop wrap's refusal carried on `Availability`** — that field answers to AddmusicK, and
  `palettetest` holds it to exactly that: a `blocked` entry has to come back from the compiler
  unclean. "Nothing is selected" is the palette's own condition and the snippet compiles fine, so
  every song would have failed the harness on a button that was correctly greyed. `ResolvedEntry`
  carries the verdict beside `availability` and `entryBlocked` is where the two meet, in the mould of
  `placeAvailability` being stacked on rather than folded in.
- **Reading the brackets for that wrap off the walk, or off a parse trace** — both answer the wrong
  question. The walk says what _plays_, where a wrap asks what may be _written_, and the two part
  company on the shape that matters: a `(1)n` recalled from another channel plays a body the text
  there does not contain. A trace of the parser's own `channel` and `inE6Loop` would answer it, at an
  event per dispatch of a compile, where the palette answers on every keystroke.
  `@amk/tokens/commands/loops` mirrors those two variables over
  the token stream instead, which needs no compile at all; `[[` is told from `[` by adjacency because
  that is the test `parseLoopStart` makes, and a hand-written `$E6 $00` pair counts as the subloop it
  is.
- **Starting a wrap's brackets at the first selected note** — honest about the selection and wrong
  about the music. `[` copies the drum remap into slot 8 and the note there clears slot 8 alone
  (`parser.ts:2725`, `:3013`), so a `@21` left outside the brackets is still standing when the loop
  ends and hands the drum to the next note. The run reaches back over the note's own leading `o` and
  `@` through `unitStartBefore`, which is the anchor every insertion in the roll already uses. It
  reaches **forward** over a `$DD` for the mirror reason: the slide is read by the note in front of
  it (`main.asm:L_10E4`), so a `]` written between the two puts the body's `$00` where the slide was.
- **A repeat count on the loop box, or a wheel over its edge to step it** — the box's stroke is nine
  pixels and already carries three gestures, and the count is one number in the text. A wrap leaves
  it selected, which puts the loop inspector on the loop it just wrote with the **Repeats** field it
  already has (`output/loop-inspector/`); an existing loop's count changes from that same field.
- **A loop's Repeats field as a `LETTER_PARAMS` row on `]`** — a `ParamDescriptor` is bound to one
  argument of one command, and three of the five spellings do not keep their count there. `]]4` is
  two `]` commands with the count on the second, and `commandAt` is end-inclusive, so a caret on the
  first bracket reaches the _note in front of it_ and the field was unreachable; a `$E6` carries one
  less than the count it means, so the row would have read 3 for a subloop that plays 4; and a `(n)m`
  raises no `Command` at all, `label` not being in `LETTER_COMMAND_KINDS`, so the panel said "nothing
  at the caret" on the commonest recall in the language. The subject is the **construct**: `loopAt`
  answers off the token stream for a bracket, a count, a label, a `*` and either `$E6` arm, and one
  write path picks `spliceArg`, `insertAt` or `spliceRange` by what the spelling actually wrote.
  `"["` left `letter-params.ts` with it — `parseLoopStart` never calls `getInt`, so digits after an
  opening bracket are music and that row could never be filled.
- **That construct drawn as a card _inside_ the command inspector** — additive over whatever else the
  caret was on, which is the right reading of the subject and the wrong place for it: a loop is not a
  command, so the panel that answers "what is under the cursor" was answering two questions at once,
  and the card pushed a note's own parameters and its palette down the pane on every note of a
  loop-heavy song. `output/loop-inspector/` is its own panel under that one, and it is **absent**
  rather than empty when the caret is in no loop — a permanent "not in a loop" row is a cost every
  song without one pays. The command inspector still stands its parameter table down for a caret on
  a construct's own text (`loopAt`, not `loopFocus` — it needs to know only that the subject is a
  loop) and says in one line where the count went, because "nothing at the caret" is untrue of a `]`.
- **Reading that count off the digits in the source** — `countEnd` scans what is written, and
  `[ c4 ]REP` with `"REP=4"` is written with no digits at all: the scan said "nothing, so 1" where
  `gather`, which sees the expansion, said 4. The count comes off the `Command` wherever a spelling
  gathers one, which is four of the five, and the digit scan survives only as the offset an absent
  count would go at. That is also what gives the field `argEditable`'s per-part macro interlock for
  free, instead of a `spliceRange` that would overwrite the use site.
- **Making a `(n)m` a `Command` in `gather` instead** — the tidy-looking fix, and it moves far more
  than it mends: `label` covers `(!n)`, `(!n,t,a)`, `(!!n)`, `("kick.brr",$02)` and `(@5,$02)` too,
  `roll-strip.ts:discoverLoops` pairs `[`/`]` commands **by depth**, and `commandScope` would have to
  learn a sixth structural kind — all so that one panel could ask a question `readLoops` was already
  answering.
- **The roll's loop hint read as a fact about the caret rather than as a redirection** — a press on a
  box's edge leaves the caret on the body's _first note_, so a hint honoured wherever it was set
  would go on answering about a pass clicked long ago. `EditorRequests.inspectingLoop` only ever
  moves a construct `loopFocus` has already listed to the head of that list, and only while the caret
  is inside the body it named. Matched on the **body span** and not on the label, because an
  unlabelled `[ ]` recalled by a `*` has no name for `discoverLoops`'s reading and `readLoops`'s to
  agree on; `palettetest` pins both directions, the hint honoured and a hint for another body ignored.
- **A free number field for which loop a `(n)m` recalls** — `parseLabelLoop` refuses a label that is
  not in `loopPointers` yet (AMK0115), `parseLoopStart` refuses a second declaration of one
  (AMK0124), and `parseLabelLoop` refuses `n + 1 >= 0x10000` (AMK0114), so a number field would have
  had to guard three errors to offer one useful value. It is a select over `loopTargets` — the
  labelled bodies opened _above_ the call, which is `loopPointers`' own contents at that point in the
  parse — and a `(!n)` is never among them: it would compile to a `$E9` into a body only a `$FC`
  should reach.
- **Renaming a loop from that same control** — the label is what every `(n)m` in the song names this
  body by, so changing it points every one of them at a label nothing declares, silently and across
  channels. A body with **no** name is offered one, which breaks nothing because nothing can be
  calling it yet; a name already written is never touched.
- **Keeping the palette's `*` button** — `*` takes `prevLoop`, the last `[` opened
  (`parser.ts:parseStarLoop`, Music.cpp:1321), so what it plays is decided by where it is written and
  by nothing a porter can point at, which is the one loop shape the roll cannot draw a handle for.
  **Loop call** writes a `(n)m` naming the nearest loop declared above the caret — nearest because
  that is what "again" means, and _above_ because `parseLoopStart` files `loopPointers` at the
  opening bracket and a call below is AMK0115. A `*` already in a song still reads, still draws and
  still edits, and its **Recalls** row is how it gets a name.
- **The roll publishing its selection as strip indices** — an index means nothing outside the
  component that built the strip, and the panel that wants it is in the output pane.
  `EditorRequests.selectedRun` carries the **span** from the lowest selected unit to the highest,
  which is the one currency every panel already speaks. By offset and not by strip index: a body's
  items are a frame appended after the root's, so `Ctrl+A` over `c4 [ e4 ]2 d4` has its last index
  inside the body while the run really ends at `d4`. Whether the run may take a bracket is
  `wrapVerdict`'s question — it widens over a construct the run covers whole and refuses one the run
  cuts through, `WRAP_SPLIT`, which is `REFUSE_SPLIT` reached by another route.
- **The loop box's transpose planned in the grabbed body's frame alone** — a body's notes are its
  frame's items and a loop written inside it is an opaque `'construct'` there, so
  `[ c4 [[d4]]2 e4 ]3` dragged up moved `c4` and `e4` and left `d4` sitting under a box drawn round
  it: `buildLoopRegions` grows a box to every note whose tick falls in the pass, so the handle's
  picture and the gesture's reach disagreed with nothing to say so. The press takes the frames
  written **inside** the one it grabbed (`framesInside`) and the gesture is planned once per frame
  and committed once (`planFrames`, `planGroupEdits`) — the split `run()`'s delete already made, the
  rule being not that a deletion is special but that an edit **moving no tick** may cross a bracket,
  frames being disjoint text. By text span and not by a construct's body address: a `(n)m` written
  inside a `[[ ]]` may recall a body declared outside it — `parseLabelLoop` refuses only
  `channel === 8`, so it is out inside a `[ ]` and in inside a `[[ ]]` — and transposing that from
  here would move music elsewhere in the song. The **pad** is the piece that belongs to the gesture
  rather than to a frame: two frames each padding the other channels out to their own reach writes
  the rest twice, `coalesce` running inside a plan and not across them, so it is priced once
  (`planReach`) and only the frame reaching furthest writes it. `playsFor` cannot catch that — an
  over-padded channel stops being the shortest and the song's figure does not move — so
  `rolltest`'s `channelTicks` reads the padded voice's own count. And the costs are taken rather
  than worked around: `selectedBodies` finds the inner body whole too, so both boxes close up solid,
  and `selectedRun` is the whole group's text, which `wrapVerdict` reads as a run inside a loop
  holding a subloop and refuses as `WRAP_DEEP`.
- **The loop join guarded by `holdsCommands` over the text between the two calls** — it reads
  `strip.commands`, and the intro `/` is not one of them: `gather` raises no `Command` for an
  operator (`tokens.ts:810`), which `prefixCommandsOf` already says out loud. So `[c4]2 / r4 *2`
  closed and joined wrote `[c4]4 /` and moved the song's loop point by the grabbed occupation's
  whole length, with every note still on its tick and nothing in the walk to say so — only
  `loopTick` catches it, which is why `rolltest`'s case asks `loopsWhereItDid`. What may stand
  between the two is asked of the **text**, which must be blank once the rests go; that also turns
  away a `;` comment and a stray `o5` that would in fact have been harmless, and that is the trade,
  since the safe set cannot be enumerated from a list the dangerous member is not in. The split
  writes exactly `head first  r… head second`, so the round trip never meets the refusal.
- **A `REFUSE_*` where the joined count passes 255** — every refusal in `roll-edit.ts` names music
  the gesture cannot make, and this names a count that cannot be _written_: `(1)200 (1)100` is the
  same music as the `(1)300` that has no spelling (`parser.ts:2492`, `:2792`, `:2836`, AMK0116),
  and the pass has already moved exactly as far as the drag asked. It falls back to the plain
  close. Not `closeBefore`'s reasoning either — `REFUSE_LOOP_LEAD_ROOM` refuses a **partial**
  close, where this is a spelling laid on top of a complete one. A join is offered on no zero gap
  for the mirror of that reason: with the two calls already touching the drag moves nothing, and a
  gesture whose only visible effect is in the Source tab is worse than none.
- **The joined count read off `passesAt().before`, or off the digits** — the first counts every
  earlier pass of the body the voice plays, so `(1)[c4] (1)2 r4 (1)3` joined as `(1)6`; the partner
  is the **nearest** sibling, which is the only reading whose tick arithmetic closes. The second is
  the trap `loop-focus.ts` already records: `[ c4 ]REP` under `"REP=4"` has no digits, and a `*` or
  a `]` at one pass has none either. Both halves come off `LoopRun.passes.length`, which is the
  written count in any song that builds a strip — `walkSong` runs every channel to its own `$00`
  and filters only `notes` at the pass cut, so a construct past the shortest channel is
  `verified: false` with all its passes still there.
- **Routing a drawn note's frame off `StripFrame.runs` whole** — a frame carries **every** voice's
  runs of its body on purpose (`discoverLoops`), because a body declared on one channel and recalled
  from another moves both voices when its length changes, and `shiftBoundariesFor`, `framePasses`
  and `planReach` all read them to say so. A press is the one reader they are wrong for: with a body
  declared in `#3` and recalled in `#4`, `frameAt` found `#3`'s pass over ticks `#4` was nowhere
  near, so a note drawn on channel 4 was written between `#3`'s brackets and played on every pass of
  both voices — and the channel-3 box grew round it while the pointer was down, `BodyRows` being
  keyed by body. It filters on `strip.channel`, as `firstPassOn` and `passesAt` already do, which
  also puts it back in step with `StripItem.instances`: `expandAndJoin` fills those from this
  channel's runs alone, so `itemAt` and `constructFor` were already channel-correct while `frameAt`
  was not. In `roll-edit.ts` for `shiftBoundariesFor`'s reason — a harness cannot drive an Angular
  composable, and `rolltest`'s `planFor` took a gesture's frame from its first item, which a `spawn`
  has not got, so every draw case ran in the root frame and `frameAt` was never executed at all.
- **Dealing the roll's marks into shift buckets from the press** — `shiftBoundaries` answered off the
  held frame alone, so a press on a note inside a `[ ]` body raised the boundaries before anything
  had moved and `RollNotes.buckets` re-parented every bar past the body's first pass end into a
  bucket `<g>` of its own. A bar re-parented while the button is down is destroyed before the
  release, and the browser raises no `click` on a node that has gone: a click on any pass of a loop
  but the first never reached `roll-notes.ts:select`, so the inspector's question and the double
  click's go-to were both lost — silently, and with the ring and the caret still moving, since
  `onPointerUp` sets the selection itself and `askAboutSelection` answers off that. The deal waits
  for `underWay`, the three things `shownPlans` is already drawn on, whose transition is the slop:
  the pointer is captured there and there is no click left to protect, and it never goes back down
  within a gesture, so the boundaries are still dealt once per gesture. Not a guard on the delta
  instead — it flips back at every zero crossing of a length drag, and a re-deal is a rebuild of
  every bar on screen.
