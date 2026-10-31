# Piano roll: editing

Read before changing how a roll gesture becomes text: `roll-edit.ts`, `roll-write.ts`,
`roll-strip.ts`, `roll-gesture.ts`, rests, padding, drums, opening a channel.

## Decisions already made

- **A strict one-to-one gate between the walk's notes and the roll's strip** — `walkSong` ends the
  pass at the shortest channel in use and sets everything after it aside as `unreachable`, so a
  channel longer than the shortest is the commonest shape a song has and an equality check refused
  editing on nearly all of them. The agreement is a **prefix** (`expandAndJoin`), and the items past
  the cut are editable and carry `verified: false`.
- **Deciding a push's direction per neighbour**, by which half of each one the overlap lands on —
  A shoves B right, B shoves C right, C shoves B left, and it never terminates. The half-rule picks
  the direction at the _first_ neighbour, which is the one the porter can see, and the cascade keeps
  it: every later shove then moves a note strictly away over a finite ordered set.
- **Re-serializing the whole run of text between two notes** to realise a gap — it moves every `v`,
  `y` and `$ED` written in that run. The gap is pieces of rest between **hard** bounds — text read at
  a tick: a byte-emitting command or the intro `/` (`realiseRegion`, `pinned`) — and each bound keeps
  its tick, clamped into the gap's new extent.
- **Taking a gap's change from the rest nearest the note _before_ it** — so a `v200`, a `t60` or the
  intro `/` written in the gap rode along with the note after it, the lane's glyph moved under a
  gesture that never named it, and dragging a note beside the `/` moved the song's loop point. The
  rest beside **whichever note moved** takes the change: the stretch before the first hard bound when
  the note in front's end moved, the one after the last when the note behind's start did.
- **Removing a deleted note's unit and writing the gap's rest somewhere else** — after the note in
  front, or at the next note's head where there was none, which put a channel's `t60` or fade at
  tick 0 when its first note went and slid every command between two deleted notes onto the first.
  A deleted note's segments are **pieces of rest where it stood**, merged with the rests they touch
  (soft text between — whitespace, comments, `o`, `l`, a deleted command — joins them), so nothing
  written around it moves.
- **A tail ending wherever its music ends** — in a channel, deleting the shortest one's last note cut
  the song short and silenced the others past the new end, and deleting a song's only note left
  `#0 o4`, which does not compile; in a body, deleting the last note tightened the loop and an
  emptied one was `[]2`, which the strip cannot frame. A tail keeps its length (`realiseRegion`,
  `plannedFrameTicks`): a channel is only ever lengthened by a note gesture, and shortening a loop is
  the box's right-end resize. Not trimmed back to the song's end where a channel runs long either:
  that would move any command written in its trailing rests.
- **Putting the intro `/` a channel the roll opens needs on the nearest note boundary**, or leaving it
  out where the tick falls inside the note — every channel resumes from its own marker on each pass
  (`parser.ts:parseIntro` writes `phrasePointers[channel][1]`), so a marker a note out of place moves
  the whole song's loop point, and none at all restarts the channel at its top. The tick decides, and
  the piece it lands inside is split: a rest becomes two rests, the note becomes a head and a `^`
  continuation, which is still one note because a tie emits `$C6`. `rolltest` pins `loopTick` across
  the edit, which is the only reading that catches a marker on the wrong tick.
- **Filling a channel the roll opens out to the _longest_ channel**, or leaving it at the length of
  its first note — the second cuts the song off at that note, since the driver reloads every track
  pointer the moment one voice reads its `$00` (`main.asm:L_0C01`, `Music.cpp:3209`), and the first
  writes rests past a point the song never reaches. It is filled out to the **shortest playable**
  channel, `stats.introTicks + stats.loopTicks`, which leaves that minimum exactly where it was: the
  song plays for as long after a channel is opened as before it, which `rolltest` pins per case.
- **Writing a channel the roll opens into its place in `#0`-`#7` order** — `octave` and
  `defaultNoteLength` are one variable each and `parseHash` resets neither, so a block dropped
  between two others changes what the second is parsed under. A new `#N` goes at the **end of the
  document**, where nothing follows it to be disturbed.
- **Letting a note drawn past the end of the song extend only its own channel** — the driver reloads
  all eight track pointers the moment one voice reads its `$00` (`main.asm:L_0C01`,
  `Music.cpp:3209`), so the note was written, compiled, reported by `SST0502` and never heard, and
  the roll had no way to make a song longer. A gesture reaching past `stats.introTicks +
stats.loopTicks` pads **every other channel that would cut the song short** out to meet it
  (`padChannels`), in the same commit and so the same undo step. It counts the notes the gesture
  moved — placed and pushed both — rather than every note in the plan, or a deletion in a channel
  already running long would lengthen the song. A rest on the end needs no walk agreement and no
  `Strip`, so a channel `channelStrip` refuses outright is padded like any other; a channel at 0
  ticks is left alone, since it holds nothing back. `rolltest`'s `playsFor` is what pins it — a rest
  one note short reads exactly like a rest of the right length.
- **Padding a channel with a rest of its own every time** — a second draw past the end wrote a second
  `rN` line under the first. A channel whose text ends on a rest has that rest lengthened
  (`ChannelTail.rest`, off the note map, and only while the compile is of the text in the editor),
  and one ending on anything else — a note, a bracket, a comment — is appended to as before.
- **Each gesture answering an overlap for itself** — drawing, dragging and quantizing held the same
  block of code three times over and a stretch answered inside its own loop, so a mode added to the
  table fell straight through to the push at all four sites with nothing to catch it: they were
  `if`s, and `switch-exhaustiveness-check` cannot see an `if`. `resolved` is the one place the modes
  are told apart, and a gesture brings only what it alone knows — which way a push should send what
  is in the way, and which notes are its own. A stretch still pushes once per edge and carves once
  after them all, because a carve inside that loop eats a note the same gesture is about to move:
  it is not in `touched` yet, so nothing holds it back.
- **Counting a carve's pieces in `reach`** — a carve only ever makes a note shorter, so every piece
  it leaves sits at a tick the channel had already reached; reading the furthest of them as "how far
  this gesture reaches" padded every other channel out to meet a note nothing had moved, which is
  the same failure the `reach` comment already warned of for a deletion. `plan.erased` is what says
  a carve is what filled `pushed`, and the two resolvers never both run since the mode picks one.
- **Writing a spawned run in front of the region's items rather than after them** — with the intro
  `/` written between the note before the region and the region's own contents, the run went in
  front of the marker and the channel re-entered a whole region late. The song plays for the same
  length either way, so `loopsWhereItDid` in a **one-channel** song is the only reading that catches
  it: `loopTick` is the lowest tick any channel re-enters at, and a second channel marked on the old
  tick holds the reading down. `writeInto` anchors at `gap.before - 1`, which is the same offset for
  a region that holds nothing.
- **A region's tick count doubling as the sign that it is the tail** — `regionsOf` sizes each gap as
  the distance from the note before it _in the text_, so a plan that asks for two notes in an order
  the text does not have them in produces a **negative** mid-channel gap, which `realiseRegion` read
  as `-1`'s "the tail, so any length will do" and left alone. The channel was then written with
  every note after the crossing slid along, silently and with nothing refused. `Region.tail` says
  where a region is; the sign says nothing, and a negative gap anywhere else is refused. The
  crossing itself is taken out before that by `crossings`, which moves the note into `born` so its
  unit is removed and written again on the far side — a note that changes places has to change
  places in the text, and rewriting it where it stands cannot express that.
- **Counting a remote code definition's `[ ]` against the starting channel** — AddmusicK tells a
  definition from a call by nothing but position (`Music.cpp:1015`), so `(!1)[ … ]` always sits above
  the first `#N` and its brackets gather on the starting channel like everything up there. That
  refused channel 0 outright on every song with one. `gather` marks the body and both its brackets
  `inRemoteDefinition` and the roll's gate skips them. Not by exempting everything above the first
  `#N` — a `[ ]` written up there that no `(!n)` armed is the channel's own music and does play it
  twice — and not by giving the body `channel: 8` the way the compiler's `commandMap` does, which
  would be right for the roll and wrong for the echo hazards and the FIR designer, who would lose a
  `$F1` written inside a body. The commands stay in `growUnits`'s list too, where a `]` that cannot
  lead a unit is a barrier.
- **`planEdits` answering a refusal with a bare `null`** — the gesture was undone and nothing on
  screen said why, while `REFUSE_SPELL`, `REFUSE_CROWDED` and `REFUSE_RAMP` sat exported and unread.
  It answers `Edit[] | EditRefusal`, which is the shape `channelStrip` already has, and the roll puts
  the sentence beside the toolbar's own "cannot edit". Not folded into `Plan.refused` either:
  `planGesture` refuses what it can see while the pointer is down, which is what the red bars are
  already drawing, where a spelling refusal is only known at the commit that undoes the gesture — so
  it is held against the document it was given for rather than leaving with the gesture that earned
  it.
- **Reading `itemsRunTogether` over a region with no rest in it** — nothing is laid over anything
  there: the run is inserted at one offset and every item in the region is a note `planEdits` removes
  outright, so the guard was protecting a boundary that had gone anyway. It refused the commonest
  shape a carve leaves — a note drawn over a run of notes with a `v` or a `y` written between them —
  and wrote nothing at all. The guard is `windowCarries`, over the window the run consumes: a unit
  being removed and a declaration deleted with its item are leaving, and everything read at a tick
  is written by the run on that tick.
- **A run refusing a `t`, a `w`, an echo write, a `/`, an `l`, a comment or an octave shift in its
  window** — none of them is anything the run cannot speak for. Song-wide commands and the `/` are
  read at a tick like a `v` is, so they are carried as `RunMark`s; a comment and an `l` say nothing
  about time and are left where they stand; an `o`, `<` or `>` is taken out, the run entering at the
  octave standing in front of the window and putting back the one the original had after it. Only a
  `$DD`, a bracket and a command written through a `"name=value"` still refuse. The text in front of
  the window's first item is carried as well where the run begins before that item did, its octave
  tokens left in place there, since the run is written after them and enters under them.
- **Moving a note across the intro `/` or a song-wide command in place** — it pushed the marker to
  the note's edge, moving the loop point or the tempo change. A note that comes to stand across or
  beyond one is lifted like a crossing (`coversMarker`) and written by the run, which splits it
  around the marker. Not one with a command inside it or a slide riding it, which cannot be lifted.
- **Anchoring a spawned run at `strip.items[0]` where no note after the region survives** —
  `writeInto`'s head branch aims at the next _surviving_ note, and a carve that swallowed the whole
  channel leaves none: `items[0]` is then a note the same plan is deleting, `removeItem` takes the
  whitespace in front of a unit with it, and the insertion therefore lands strictly inside a range
  being removed, which `planEdits` refuses. The run goes after the region's last item, as it goes
  after the note before the gap in the other branch, and that only abuts the removal.
- **A wholly overwritten item's declarations left for the replacement to inherit** — the erased
  note's `v200` stayed in the text, so it landed on whatever was drawn over it, and one standing
  between two erased items refused the whole gesture as crowded. An item the plan removes takes the
  `'note-state'` commands in its prefix and inside its own unit with it, but only the ones **nothing
  in the edited song still sounds under** (`reachesSomething`); the channel's first item is exempt,
  its prefix being the channel's setup. Not region-wide either: the laid-out run covers the
  **window** (`windowOf`), the contiguous items the gesture actually touches, which is what lets a
  rest it never reached keep its bytes and its own `v200` both — a run over the whole region would
  move that kept command off its tick, which is the crowded refusal all over again.
- **That gate on `plan.erased`, so overwrite dropped a declaration and Backspace kept it** — only
  `carve` fills `erased`, so the two answers differed on "did the ticks get a new occupant", which is
  a fact about the edit path and not one a musician reasons about. And the reasoning that separated
  them was thinner than it looked: a drawn note declares nothing of its own, so erasing `v255 c4` and
  drawing over it re-voices everything to the right just as silently as the deletion would have. The
  question names no gesture — a surviving note counts as a reacher and so does one being drawn, which
  is why drawing over a note keeps its `v200` where deleting the same note takes it. `plan.erased`
  stays, `roll-marks.ts` drawing the hatching from it.
- **Moving a kept command to the head of the next surviving note** — the cheaper spelling, and it
  loses the tick: in `c4 v200 d4 v100 e4 f4` overdrawn from 48 the `v100` runs 48 ticks inside the
  drawn note and there is no surviving head at that tick, so the note's second half would sound at
  `v200` with nothing to say so. A run splits the born note at the command's own tick and writes it
  between the tied halves instead (`RunMark`, `spawnRun`), which is the intro `/`'s mechanism
  widened from one tick to a list — and a tie emits `$C6`, so the two halves are still one note.
- **Deriving a command's reach from a slot table built off the source** — the walk has already
  resolved it, and a source-order scan is blind to a `[ ]` body played twice and to a `(1)n` called
  from another channel. `commandsInForceOf` answers a note with the `Command` objects acting on it,
  by the same stable identity `definedAt` compares, so "the slot changed hands" is the first note
  the pass played without the command in its list. The identity is the trap: `channelStrip` filters
  `index.commands` from its own `TokenIndex`, so a second `tokenize` makes every membership test
  false and keeps every command while looking like it works — `EditContext.inForce` and
  `Strip.commands` must come from one scan, which is what `rolltest`'s `Built.index` is for.
- **`removeItem` splicing a multi-segment unit whole** — `growUnits` ends `unitSpan` at the **last**
  segment (`roll-strip.ts`), so a `v200` written inside a note went out with the note in silence, and
  a `t` or an intro `/` would have gone the same way. A command inside a removed unit is asked the
  reach question on its own tick (`insideCommands`) and dropped where nothing sounds under it; where
  a run is being laid over those ticks the run takes it over; and a plain deletion leaves the note's
  segments as rest around it, so it keeps its tick. Only where a surviving note now covers that tick
  — a glue — is the gesture refused (`REFUSE_INSIDE`): there is no tick left to put it on and no
  gesture can say which side of the note the porter meant it to follow. `REFUSE_RAMP` keeps the one
  site whose reason really is the length, a note cut shorter than the ticks in front of the command.
- **Handing a command a deletion left behind to the next surviving note** — deleting `b3` from
  `o4 a=27 p12,147 b3 c3` leaves the `p` in front of the rest that takes those ticks, and putting it
  on `c3` instead loses the tick: the `p` runs at 27, where the driver read it and where the rest
  still is, so a per-channel `$E8`, `$DC` or `$DD` would have its whole ramp shifted by whatever the
  deleted note happened to be worth. `commandScope` sorts by reach and not by whether a command
  evolves over ticks, so there is no axis to spare the fades on. It is the `plan.erased` split as
  well: a note **drawn over** `b3` begins on tick 27 and keeps the `p` where it is, so only the
  deletion would move it, and whether the gesture matters is the one thing `reachesSomething` exists
  to answer no to. The command stays where it was written and the lane's glyph is dragged
  (`roll-command-move.ts`), which is a tick the porter picked rather than one a deletion inferred —
  the same standing the right-click erase already has. Horizontal only, lane rows being first-fit
  packing; snapped to the channel's own item heads, so the insertion is always into an item's prefix
  and no note has to be split into tied halves; in its own channel, since within one channel text
  order is execution order; and with no target past the last item, because the pass ends at the
  shortest channel and a command written after a channel's last note raises no `WalkCommand` at all
  — a target out there is one a command could be dragged to and not back from.
- **Refusing a piano-roll channel for using `$DD` at all** — the sentence named a target note, and
  the all-hex `$DD $00 $18 $A4` has none, so the commonest form of the commonest bend refused the
  channel for a reason that was not true of it. What the blanket refusal was really carrying is a
  hazard that has nothing to do with the target: `$DD` is not dispatched, the note before it reads it
  by peeking at the byte standing at the track pointer (`main.asm:L_10E4`), and its dispatch slot
  holds `$0000` — so its position is a **byte** adjacency, and `writeInto` anchoring a gap's rest at
  the note before the gap put that rest between the two. The guards are per-fact and named:
  `StripItem.bend` says which item carries a slide, `afterBend` moves the anchor past the whole
  construct, `prefixCommandsOf` never lets a removal take a `$DD` — `reachesSomething` scans forward
  and the loss here is in front of the command — `exitOctaveFor` stops suppressing the octave restore
  where a note target reads it, and deleting the rider and dragging the glyph are refused in their
  own words. Not a narrowing to the note-target form: that would have shipped the byte-adjacency bug
  under a sentence saying the channel was fine.
- **Asking the reach question of every `'note-state'` command a removed item carried** — the walk
  only ever names a command that _fills_ a slot, so a switch-off (`$DF`, `$F0`, `$FD`, `$FE`) is in
  force at no note and a `$F4` toggle shares one slot with eight others it does not replace; all of
  them answered "reaches nothing" and went with the note, leaving the vibrato on. The question is put
  only to a byte-less `q`, `h` or drum `@` and to a command whose slot the next write takes over whole
  (`replacedByNextInSlot` in `song-walk.ts`, beside `slotsOf`); anything else stays.
- **Reading a note's drum off the `@` written beside it alone** — the remap is consumed by the next
  note and by no rest, so `@21 r4 d4` plays `d4` as the drum, and the strip drew and hit-tested it on
  the keyboard, a note drawn between the two took the drum, and deleting `d4` handed it to the note
  after. Whether a note is a drum is the byte the compiler emitted (`NoteAddress.note`, `$D0` up),
  which is exact past the end of the pass too where the walk has nothing; the `@` is the last one
  since the previous note's head (`drumApart`), a `^` being no note. It goes with its note, moves to
  the note's head when a note is drawn between them, and is rewritten beside the note on a lane
  change.
- **Spelling every rest that has no single length as `=ticks`** — `r=60` for `r16` and `r4` merged.
  `spellRest` ties up to three common lengths (`r4^16`), a whole note down to a 64th plain and
  dotted, and falls back to `=ticks` only where they cannot reach it. Rests only: a note's `c=60` is
  what the roll's length bubble promises.
