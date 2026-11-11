---
paths:
  - 'web/src/app/editor/views/piano-roll/roll-loops/**'
  - 'web/src/app/editor/views/piano-roll/roll-write/loop-edits.ts'
  - 'web/src/app/output/loop-inspector/**'
  - 'web/src/app/editor/command-palette/loop-wrap.ts'
  - 'packages/mml-tokens/src/commands/loops.ts'
---

# Loops

Read before changing loop boxes, wrap, join and split, `roll-loops/`, the loop inspector and
`loop-focus.ts`, or `(n)m` and `*`.

## How it works now

A loop is never unrolled. A body is one text, every pass of it is drawn, and an edit to any pass
edits that text, so all its passes change together.

**Two readings, kept apart.** What _plays_ comes from the walk: `SongTimeline.loops` is one
`LoopRun` per place a body plays (`channel`, `kind`, `from`, `body`, `count`, `passes`), and a run
whose `from` the command map cannot name is the declaration playing in place. What may be _written_
comes from the token stream: `readLoops` in `@amk/tokens/commands/loops` mirrors the parser's
`channel === 8` and `inE6Loop` with no compile, and `loopAt`, `loopsAt`, `loopTargets`,
`loopStateAt` and `loopContents` answer off it. `palettetest` holds that reading to the compiler.

**Drawing** (`roll-marks.ts`, called from `roll-pictures.ts`):

- `buildLoopRegions` makes one `LoopRegionBox` per pass, on the mark window's cadence.
- `followLoopRegions` is a second pass that moves the built boxes with the gesture in flight.
- `buildLoopLabels` is a third, for the `(n)` plate of a selected group on `editChannel`.
- `RollLoops` draws the boxes under the bars and takes the selected bodies as an input;
  `RollLoopLabels` draws the plates above them and takes no pointer.

**The strip** (`roll-strip.ts`): `discoverLoops` joins the walk's runs to the text. Each body is a
`StripFrame` with frame-local items and **every** voice's runs of that body; a construct in its
parent frame is one opaque item carrying a `LoopSite` (`kind`, `text`, `close`, `label`).
`constructFor` names the construct under a box, `framesInside` the bodies written inside one.

**Gestures on a box** start in `roll-gesture.ts` at a press on `.loop-edge`, which carries
`data-tick` and `data-ticks`. Within `EDGE_PX` of an end the press resizes the body; elsewhere on
the stroke the axis of the drag decides, sideways sliding the pass and vertical transposing the
body with the bodies inside it. `roll-write/loop-edits.ts` plans the text: `openGap` splits a count
round a gap of rests, `loopJoin` closes two calls back into one, `resizeLoop` changes the body's
length, with `gapSlack`, `bodyRests`, `passesAt` and `firstPassOn` pricing them. The arithmetic a
harness must reach is in `roll-edit.ts`: `frameAt` (filtered to the strip's own channel),
`framePasses`, `shiftBoundariesFor`, `passShiftsFor`, `plannedFrameTicks`, `planFrames`.

**Outside the roll.** `loop-wrap.ts` is the palette's policy over `readLoops`: `wrapVerdict` picks
`[ ]` or `[[ ]]` for the run in `EditorRequests.selectedRun` or refuses with a `WRAP_*` sentence,
and `callVerdict` writes a `(n)m` for the nearest labelled loop above the caret.
`output/loop-inspector/` is its own panel under the command inspector, absent when the caret is in
no loop: `loopFocus` lists the constructs round the caret across the five spellings (`LoopKind`),
and `loopCountEdit`, `loopNameEdit` and `loopTargetEdit` choose each spelling's splice.
`EditorRequests.inspectingLoop` only reorders that list, and only while the caret is in the body
it names.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/loops.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **Unrolling loops as the roll's answer to a `[ ]`** — `SongTimeline.loops`, `recordCommand`
- **Editing one pass of a loop differently from its siblings**
- **The loop box's edge drag as an in-body group move** — `openGap`, `gapSlack`
- **The loop box's edge as one gesture** — `realiseRegion`, `plannedFrameTicks`, `EDGE_PX`,
  `buildLoopRegions`
- **A left-end resize that moved the notes inside the body** — `resizeLoop`, `frame.span.start`,
  `delta`
- **A resize taking the pointer's travel as the body's own change** — `Drag.loop.ahead`, `passesAt`
- **Both ends of a seam offered where two passes meet**
- **`ShiftBoundaries` generalised to a shift per bucket** — `roll-notes.ts`, `shiftBoundariesFor`,
  `roll-edit.ts`, `plannedFrameTicks`
- **The loop label carried on `LoopRegionBox`** — `buildLoopLabels`, `LoopSite.label`,
  `widenOverLabel`, `openGap`, `editChannel`, `editing`
- **A handle of its own for the loop's transpose** — `Shift`, `Drag.axis`, `piano-roll-view.md`,
  `Drag.loop`
- **`keysBetween` for that drag's semitones**
- **Dimming the loop boxes to 30% while a body-length edit is held** — `followLoopRegions`,
  `buildLoopLabels`, `RollLoops`, `RollNotes`, `buildPreview`
- **`ShiftBoundaries` asked about a loop box's edges** — `passShiftsFor`, `shiftBoundariesFor`,
  `framePasses`, `heldPasses`
- **A `selected` flag on `LoopRegionBox`** — `RollLoops`, `RollNotes`
- **The loop wrap's refusal carried on `Availability`** — `palettetest`, `blocked`, `ResolvedEntry`,
  `availability`, `entryBlocked`, `placeAvailability`
- **Reading the brackets for that wrap off the walk, or off a parse trace** — `channel`, `inE6Loop`,
  `@amk/tokens/commands/loops`, `parseLoopStart`
- **Starting a wrap's brackets at the first selected note** — `parser.ts:2473`, `unitStartBefore`,
  `main.asm:L_10E4`
- **A repeat count on the loop box, or a wheel over its edge to step it**
- **A loop's Repeats field as a `LETTER_PARAMS` row on `]`** — `ParamDescriptor`, `commandAt`,
  `Command`, `label`, `LETTER_COMMAND_KINDS`, `loopAt`, `spliceArg`, `insertAt`
- **That construct drawn as a card _inside_ the command inspector** — `loopAt`, `loopFocus`
- **Reading that count off the digits in the source** — `countEnd`, `gather`, `Command`,
  `argEditable`, `spliceRange`
- **Making a `(n)m` a `Command` in `gather` instead** — `label`, `roll-strip.ts:discoverLoops`,
  `commandScope`, `readLoops`
- **The roll's loop hint read as a fact about the caret rather than as a redirection** —
  `EditorRequests.inspectingLoop`, `loopFocus`, `discoverLoops`, `readLoops`, `palettetest`
- **A free number field for which loop a `(n)m` recalls** — `parseLabelLoop`, `loopPointers`,
  `parseLoopStart`, `loopTargets`
- **Renaming a loop from that same control**
- **Keeping the palette's `*` button** — `prevLoop`, `parser.ts:parseStarLoop`, `parseLoopStart`,
  `loopPointers`
- **The roll publishing its selection as strip indices** — `EditorRequests.selectedRun`,
  `wrapVerdict`, `WRAP_SPLIT`, `REFUSE_SPLIT`
- **The loop box's transpose planned in the grabbed body's frame alone** — `buildLoopRegions`,
  `framesInside`, `planFrames`, `planGroupEdits`, `run()`, `parseLabelLoop`, `coalesce`, `planReach`
- **The loop join guarded by `holdsCommands` over the text between the two calls** —
  `strip.commands`, `gather`, `Command`, `tokens.ts:839`, `prefixCommandsOf`, `loopTick`,
  `rolltest`, `loopsWhereItDid`
- **A `REFUSE_*` where the joined count passes 255** — `roll-edit.ts`, `parser.ts:2247`,
  `closeBefore`, `REFUSE_LOOP_LEAD_ROOM`
- **The joined count read off `passesAt().before`, or off the digits** — `loop-focus.ts`,
  `LoopRun.passes.length`, `walkSong`, `notes`
- **Routing a drawn note's frame off `StripFrame.runs` whole** — `discoverLoops`,
  `shiftBoundariesFor`, `framePasses`, `planReach`, `frameAt`, `BodyRows`, `strip.channel`,
  `firstPassOn`
- **Dealing the roll's marks into shift buckets from the press** — `shiftBoundaries`,
  `RollNotes.buckets`, `click`, `roll-notes.ts:select`, `onPointerUp`, `askAboutSelection`,
  `underWay`, `shownPlans`
