# Commands in the roll

Read before changing command glyphs on bars, the command lane, `commands-in-force.ts`,
`command-timeline.ts`, or `song-walk.ts`'s slots.

## Decisions already made

- **Answering "which commands act on this note" from the source alone** — it is right until a `[ ]`
  body or a `(1)n` call plays one run of bytes twice, and then it is confidently wrong with no tell.
  The walk names them by address and `commandMap` maps that back to text; the source answers only
  `q`, `h` and `@21`-`@29`, which emit nothing to address and which the compiler resolved in source
  order anyway. No fallback to a guess when there is no walk, either: an approximate list that looks
  like the exact one is worse than an empty one.
- **`Command.channel` left `undefined` above the first `#N`** — every same-channel scan read it as
  "no channel", so a `q` or a `$F1` written above `#0` reached nothing and the roll's glyphs, the
  echo hazards and the FIR designer all missed it. It is the starting channel — the lowest `#N`
  declared anywhere, 0 without one — because that is where `detectStartingChannel` starts writing
  (Music.cpp:385-400); `parseTimeInForce` reads the markers themselves for the one thing a channel
  number cannot see, `h` being reset by a `#N` that re-enters its own channel.
- **Naming a note's drum `@` from the note's own text** — the last `@21`-`@29` written before it on
  its channel. Right until a `[ ]` works on a copy of the remap, the first drum note clears it, a `*`
  or `(1)n` replays the drum byte, or another channel calls it — and wrong in both directions then,
  with the bar still drawn on the drum's lane. The walk names the note whose byte loaded the drum
  (`WalkNote.drumFrom`), `parseTimeInForce` says which `@` was folded into _that_ note, and
  `commands-in-force.ts` joins the two; the source alone answers only what was folded.
- **Tinting the glyph a note puts in force, and finding it by comparing `origins` arrays** — the
  first is the reading issue #34's own words invite and there is no colour that survives it: the
  eight channel fills are mid-tone and chromatic, so `--color-accent` goes on `--color-ch-0`,
  `--color-warn` on `--color-ch-3` and `--color-good` on `--color-ch-2`, and each is the one that
  vanishes on some channel. The axis the set leaves free is lightness, which is the property
  `roll-notes.html` already leans on for the hover, so a defining glyph is a near-white plate with
  the icon in `--color-surface` and reads against the plate rather than against the bar. The second
  is the cheap spelling of `definedAt` and it is wrong after every `t`: `recordOrigin` calls
  `invalidateAll`, so a song-wide write hands all eight channels a fresh array holding the same
  addresses and every channel's next note claims to set everything it plays under. It is the
  identity of the commands in the list, `index.commands` holding one stable object each. Nor from
  source order — the glyph names whichever command the driver had in force, so in
  `v255 (1)[ c ]2 v200 (1)5` the text has that `c` setting `v255` on the pass it sounds under
  `v200`. `walktest` writes a song for each of the three.
- **Drawing a bar's glyphs in the walk's slot order alone** — `fitBarContent` drops from the end, so
  the ones a narrow bar kept were whichever `SLOTS` names first, and a bar with room for one spent it
  on a `q` no note had touched for a page while the `v` that note actually sets went behind the dots
  with nothing but the mark's plate to say it had. The ones the note puts in force lead
  (`buildMarks`), slot order holding within each half, so the cut takes the inherited ones first. The
  cost is real and is the smaller one: a command moves along the row between the note that sets it
  and the notes after it. Not a fix in `fitBarContent` either — it is handed a count, and a layout
  that knew which glyph mattered would be a layout that knew what a glyph was.
- **The command lane as the complement of the bars, holding only what no bar stands over** — told by
  `WalkCommand.onANote`, whether a note **begins** on the command's own tick and sounds with it in
  force, which is the one thing a scope cannot say and `origins` cannot either, being anchored on a
  note where the question is about the tick. It read as tidy and cost the lane the thing it is for: a
  timeline with holes in it is not a timeline, and the holes were the commands written the ordinary
  way, straight before the note that reads them. A porter scanning the lane for "what runs, and when"
  found the `v` in a rest and not the `v` on a note, with nothing to say which kind was missing. It
  holds **every command that takes effect** (`command-timeline.ts`), scope alone: `commandScope`'s
  `'song'`, which `commandsInForceOf` drops because it acts on the song and not on a note of it, and
  every `'note-state'` one wherever the driver reads it. Most are then drawn twice, and the two are
  not repeating each other — the lane says the tick, the bar's chip says which note plays under it.
  `q`, `h` and `@21`-`@29` stay on the bars alone, emitting no byte to address and so having no tick
  but the note they fold into. `onANote` is kept as the walk's description of the song and read by
  nothing; `Track.owners` is what computes it, off the entry and not the address, since
  `[[ v100 v200 ]]2` raises two `v200` entries at one tick on one channel and only the second is in
  force.
- **Reading the lane off `definedAt` alone** — it is anchored on a _note_ and a timeline needs a
  _tick_: `emitNote` pushes a `WalkNote` for a note and not for a rest, so in `c4 v200 r4 d4` the
  `v200` runs at tick 48 and the lane drew it at 96, a whole rest late. `origins` names what
  _occupies_ a slot, too, so the four that empty one could never be named at all. The walk raises its own
  `WalkCommand` in `recordOrigin`, which is already the one place that knows a slot has changed
  hands, so the two agree wherever they overlap: a write of the address a slot already holds moves
  nothing, and `[ v200 c8 ]2` is one entry from either end. `definedAt` keeps the half it is exactly
  right for, `q`, `h` and `@21`-`@29`, which emit no byte to address and so have no tick but the note
  they fold into — and which a bar therefore draws.
- **A native `overflow-y-auto` on the command lane** — nothing here styles a scrollbar, so a ~15px
  Windows bar eats a third of a 42px lane, and its gutter narrows the content box, which puts the
  lane's right edge a scrollbar out of step with the roll it is drawn to track — the trap `w-full` on
  the bars over the roll (`roll-view.md`) already fell into. A plain wheel lifts the glyphs by a
  transform, and the thumb saying the stack runs deeper is drawn inside the `<svg>`, where it costs
  no width.
- **Packing the lane over the window on screen** — rows are first-fit, so a re-deal at every
  `tickWindow` turnover moved glyphs up and down as the roll scrolled past them, and a glyph that
  changes row while the roll moves is saying something about the scrolling rather than about the song.
  `packCommandLane` runs over the whole song and `laneWindow` only slices it, keeping the whole song's
  `depth` rather than the slice's: that is the scroll range, and one that shrank as a deep column went
  past would take the porter's position with it.
- **A muted channel's commands dimmed rather than dropped, the way its bars are** — the symmetry with
  the roll and the overview is inviting and it takes the wrong thing as the subject: a bar stands for
  a note, which a mute silences whole, where a glyph stands for a command, and how far a command
  reaches is not something the channel it is written on decides. A `v`, a `y` or an `@` on a silenced
  channel sets nothing anybody can hear and is not drawn at all; a `t`, a `w` or an echo write on
  that same channel still runs the whole song, so it stays and is dimmed. The test is
  `commandScope`, in `packCommandLane` rather than in `command-timeline.ts` — what the mixer silences
  is a fact about the moment and the timeline is a fact about the compile.
- **Packing the lane without regard to which channel is being edited** — first-fit over the whole
  song deals a channel's commands into whatever rows are free, so the ones the porter was working on
  were scattered down a stack many rows deep that shows three at a time, and finding them meant
  scrolling the lane on every glance. The edited channel is packed **first** and everything else
  strictly below it (`packCommandLane`), so its commands are always in the top rows. A band rather
  than a preference: letting another channel fill a gap in one of those rows puts a glyph the porter
  is not working on among the ones they are, which is the thing the split is for. Off `editChannel`
  and not the roll's `editing`, whose fallback is the channel of the bar under the pointer — rows
  would then be re-dealt on a hover, which is the same complaint as re-dealing them on a scroll.
- **A row cap on the command lane, with the rest of a column drawn as three dots** — a stack cut to
  keep the DOM finite is still a stack cut, and it cut the wrong thing: a tick carrying more commands
  than the cap is a tick a porter opened the lane to read, so the one column worth the most was the
  one it declined to show, and a count is not an answer to "what runs here". Every command the song
  runs gets a row (`packCommandLane`), the wheel reaches the ones past the bottom and the seam above
  the lane takes it taller. `depth` was always the scroll range; with nothing dropped it is now the
  whole column, so a glyph can always be scrolled to. The bar's own `fitBarContent` mark is a
  different thing and stays — a bar has a fixed width it cannot grow, where the lane has a scroll.
- **`$DD` filed as a state slot, the way `$DE` and `$ED` are** (`slotsOf`, `SLOTS[11]`) — it put a
  slide everywhere it is not and nowhere it is, and both readings were wrong in silence. `origins` is
  frozen when a note keys on and the walk reaches the `$DD` a byte later, so the note that _plays_ the
  slide reported nothing and every note _after_ it reported the slide as state it sounds under —
  which no note does, a slide running once and leaving nothing standing. And the entry `recordOrigin`
  raised carried `track.ticks`, which by then has run on past the note, so the lane drew the slide
  where the note it rides on **ends**. It is the note's own, as `drumFrom` is: `WalkNote.bendFrom`
  holds the address, `commands-in-force.ts` joins it, and the bar of the note in front of the `$DD` is
  what draws it. Its lane entry is raised from the arm itself at `track.ticks - track.duration`, the
  frame the read-ahead found it in — so `c4^4 $DD` is 48 ticks in, which the operands cannot say — and
  once per execution rather than once per slot change, since a `[ ]` body carrying one really does
  slide on every pass. That is also why `definedAt` never counts a `$DD` in the previous note as
  inherited: it is one written command reaching two notes that each ran it, and identity cannot tell
  that from a `v200` still standing. Not a separate list beside `origins` either — a slide is a
  command acting on a note, which is the question `commandsInForceOf` already answers, and a second
  channel for one command would need every reader to ask twice.
- **The selected command's `Delete` falling through to the notes where the command cannot go** —
  a `"name=value"` command's span is collapsed onto the call site, so `eraseCommand` answers `null`
  and the branch would have handed the key on to the note selection: a press aimed at a chip that
  is visibly outlined would silently delete five notes somewhere else. The key is taken whenever the
  caret is on a command the roll draws — `inspectable`, the lane's `'song'` and the bars'
  `'note-state'` scopes — and a command that cannot be removed does nothing. Not on `commandAtCaret`
  alone: a note is a `Command` too and every click on a bar puts the caret on one, so an ungated
  branch would splice the note's own text out in place of the delete gesture, and would take an `o`
  or an `l` nothing on screen rings. It sits **ahead of the channel guard** for the reason the lane
  picks no channel — it holds all eight and a `t` belongs to none of them — and it takes only the
  first press of a held key: the caret lands where the command was and `commandAt` is end-inclusive,
  so a repeat would take the neighbour nobody selected.
- **`inspecting.set(null)` taken as the lane letting go of the selected note** — "the selected note"
  is two things, and the lane owned only one of them: `EditorRequests.inspecting` is the occurrence
  the inspector is describing, where the outlines in the roll are `gestures.selection()`, a set of
  indices into a strip the lane has never seen. So `PIANOROLL.md` said a lane click let the note go
  and the bars went on showing every one of them outlined, with `Delete` then ambiguous between the
  command that had just been picked and eight notes still lit. The lane emits `commandPicked` and the
  roll clears, in the mould of `RollNotes.channelPicked` — the selection is the roll's, as its
  settings are. `RollNotes` emits the same output for the same reason; what the two do differently is
  `inspecting`, the entry below.
- **A bar's chip leaving its note outlined, so a commit from the panel had something to replay** —
  it conflated two things that are not one. The outline is `gestures.selection()`, what a gesture
  would act on; the replay reads `EditorRequests.inspecting`, which occurrence is being described.
  Keeping the first to get the second put a note and a command on screen as subjects at once, with
  `Delete` meaning one of them and nothing saying which. The chip clears the outlines and keeps
  `inspecting`, so the commit is still heard; the lane clears both, having no note to describe.
  Cleared on the **`click`** and never on the `pointerdown`, which is the whole reason a press and
  hold on a chip still drags the note: the press is not taken there, so it reaches the gesture layer,
  which captures the pointer past the slop and leaves no `click` to fire. The overflow dots are the
  one plate exempt — they stand for a list rather than a command, so they have no handler at all and
  the click falls through to the bar, which selects that note.
- **The bar's selection ring in the lane's `stroke-ink`, the way the lane draws it** — sound in the
  lane, where nothing wears the inverted plate, and invisible on half the chips of a bar, where a
  defining one does: a near-white ring round a near-white plate is the same value as the thing it is
  drawn around, and reads as the plate being a pixel bigger rather than as a selection. Moving it
  clear of the plate is no answer either — the chips are packed within a few pixels of each other, so
  the ring would meet its neighbour's. It takes the **pair of colours the plate already uses**, which
  is the axis `roll-notes.html` settled on for the icon: `stroke-surface` over a defining plate,
  `stroke-ink` where there is none, so the ring reads against whatever is behind it on all eight
  channels. Drawn over the plate rather than under it, for the same reason.
- **Ringing a bar's `more` dots when the selected command is one they stand for** — the plate
  already inverts on those terms and the symmetry is inviting, but `defining` is a property of the
  list where a ring is a claim about one command, and the dots stand for commands the bar has no
  room to show: an outline round them says "it is here" about something that is not drawn. It is
  also the one mark with no handler and no span to reveal, so the ring would point at nothing
  clickable. `MarkGlyph.command` rings the glyphs that are drawn, and the lane, where every command
  appears, is where one behind the dots is found.
- **A lane glyph clearing `inspecting`, as naming a command of the song rather than a note of it**
  — true of what the glyph is and wrong about what a commit from its panel should sound: a `v`
  picked there previewed nothing, where the same `v` picked off a bar's chip replayed the bar's
  note. The lane points `inspecting` at the note the command is **heard on** (`noteHeardOn`): the
  first on its channel, still sounding at the tick or beginning after it, whose commands in force
  hold it — the bar that would draw it as a chip, which reaches back to the note a `$DD` rides and
  steps over one a command was read inside a tie of; a `'song'` command, which no bar draws, takes
  the next note to begin. Off `commandsInForce` and not off the tick alone, so the lane and the
  bars cannot name different notes for one command; `walktest` pins the seven shapes.
