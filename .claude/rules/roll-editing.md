---
paths:
  - 'web/src/app/editor/views/piano-roll/roll-edit.ts'
  - 'web/src/app/editor/views/piano-roll/roll-strip.ts'
  - 'web/src/app/editor/views/piano-roll/roll-gesture.ts'
  - 'web/src/app/editor/views/piano-roll/roll-seed.ts'
  - 'web/src/app/editor/views/piano-roll/roll-command-move.ts'
  - 'web/src/app/editor/views/piano-roll/roll-write/**'
  - 'web/src/app/editor/views/piano-roll/percussion.ts'
  - 'web/src/app/editor/views/piano-roll/percussion-panel/**'
  - 'scripts/rolltest/**'
---

# Piano roll: editing

Read before changing how a roll gesture becomes text: `roll-edit.ts`, `roll-write/`,
`roll-strip.ts`, `roll-gesture.ts`, rests, padding, drums, opening a channel.

## Editing from the piano roll

`editor/views/piano-roll/roll-strip.ts` and `roll-edit.ts` are the two halves of a roll gesture, and
both are Angular-free so `rolltest` can drive them against a real compile.

The **strip** is one channel as a sequence the roll can splice. It is built from the compiler's
`noteMap` rather than from the walk, because `noteMap` carries **rests** — the walk drops them — and a
gap the roll can address is exactly a rest it can rewrite. A `^` is its own entry whenever anything
but whitespace separates it from its note, so `c4 v200 ^8` is two entries and one note; the strip
item carries both as its `segments`, and a length change rewrites the **last** segment so the ramp
keeps its place.

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

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/roll-editing.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **A strict one-to-one gate between the walk's notes and the roll's strip** — `walkSong`,
  `unreachable`, `expandAndJoin`
- **Deciding a push's direction per neighbour**
- **Re-serializing the whole run of text between two notes** — `realiseRegion`, `pinned`
- **Taking a gap's change from the rest nearest the note _before_ it**
- **Removing a deleted note's unit and writing the gap's rest somewhere else**
- **A tail ending wherever its music ends** — `realiseRegion`, `plannedFrameTicks`
- **Putting the intro `/` a channel the roll opens needs on the nearest note boundary** —
  `parser.ts:parseIntro`, `rolltest`, `loopTick`
- **Filling a channel the roll opens out to the _longest_ channel** — `main.asm:L_0C01`,
  `Music.cpp:3209`, `rolltest`
- **Writing a channel the roll opens into its place in `#0`-`#7` order** — `octave`,
  `defaultNoteLength`, `parseHash`
- **Letting a note drawn past the end of the song extend only its own channel** — `main.asm:L_0C01`,
  `Music.cpp:3209`, `SST0502`, `padChannels`, `Strip`, `channelStrip`, `rolltest`, `playsFor`
- **Padding a channel with a rest of its own every time** — `ChannelTail.rest`
- **Each gesture answering an overlap for itself** — `resolved`, `touched`
- **Counting a carve's pieces in `reach`** — `plan.erased`, `pushed`
- **Writing a spawned run in front of the region's items rather than after them** —
  `loopsWhereItDid`, `loopTick`, `writeInto`
- **A region's tick count doubling as the sign that it is the tail** — `regionsOf`, `realiseRegion`,
  `Region.tail`, `crossings`
- **Counting a remote code definition's `[ ]` against the starting channel** — `Music.cpp:1015`,
  `gather`, `inRemoteDefinition`, `commandMap`, `growUnits`
- **`planEdits` answering a refusal with a bare `null`** — `REFUSE_SPELL`, `REFUSE_CROWDED`,
  `REFUSE_RAMP`, `channelStrip`, `Plan.refused`, `planGesture`
- **Reading `itemsRunTogether` over a region with no rest in it** — `planEdits`, `windowCarries`
- **A run refusing a `t`, a `w`, an echo write, a `/`, an `l`, a comment or an octave shift in its
  window** — `RunMark`
- **Moving a note across the intro `/` or a song-wide command in place** — `coversMarker`
- **Anchoring a spawned run at `strip.items[0]` where no note after the region survives** —
  `writeInto`, `removeItem`, `planEdits`
- **A wholly overwritten item's declarations left for the replacement to inherit** —
  `reachesSomething`, `windowOf`
- **That gate on `plan.erased`, so overwrite dropped a declaration and Backspace kept it** —
  `carve`, `erased`, `roll-marks.ts`
- **Moving a kept command to the head of the next surviving note** — `RunMark`, `spawnRun`
- **Deriving a command's reach from a slot table built off the source** — `commandsInForceOf`,
  `Command`, `definedAt`, `channelStrip`, `index.commands`, `TokenIndex`, `tokenize`,
  `EditContext.inForce`
- **`removeItem` splicing a multi-segment unit whole** — `growUnits`, `unitSpan`, `roll-strip.ts`,
  `insideCommands`, `REFUSE_INSIDE`, `REFUSE_RAMP`
- **Handing a command a deletion left behind to the next surviving note** — `commandScope`,
  `plan.erased`, `reachesSomething`, `roll-command-move.ts`, `WalkCommand`
- **Refusing a piano-roll channel for using `$DD` at all** — `main.asm:L_10E4`, `writeInto`,
  `StripItem.bend`, `afterBend`, `prefixCommandsOf`, `reachesSomething`, `exitOctaveFor`
- **Asking the reach question of every `'note-state'` command a removed item carried** —
  `replacedByNextInSlot`, `song-walk.ts`, `slotsOf`
- **Reading a note's drum off the `@` written beside it alone** — `NoteAddress.note`, `drumApart`
- **Spelling every rest that has no single length as `=ticks`** — `spellRest`
