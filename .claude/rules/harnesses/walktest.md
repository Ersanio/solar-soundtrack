---
paths:
  - 'scripts/walktest/**'
---

# `walktest`: what it proves

The song-data walker, `@amk/spc/song-walk`, which is the only thing the piano roll draws from — and
a walker that mis-frames one command draws a plausible roll that is quietly wrong, with no visual
tell. `scripts/walktest/main.ts` runs one section file per subject, in the order below;
`support.ts` holds what they share (the driver, `build`, the samples by name).

Three assertions carry it:

- **The two packages are pinned together** (`command-lengths.ts`). `@amk/spc` may not reach
  `@amk/tokens`, so each states how long a VCMD is, one about emitted bytes and one about source
  text, and this asserts they agree — the only thing that makes the restatement safe.
- **`$FB`'s arguments are not notes** (`not-notes.ts`). An arpeggio's operands sit in the `$80`
  range without being notes, so pricing `$FB` at a fixed length invents a chord out of nowhere and
  still yields a timeline that reads as reasonable.
- **The emulator is the oracle** (`driver-plays.ts` and the other `driver-*`, `repeat-*` and
  `tempo-shortfall.ts` sections). Tick totals matching `stats` only prove the walk agrees with
  AddmusicK's own prediction and both could be wrong together, so the real driver is run and the
  note the walk predicts is compared against the one each voice's track pointer is actually on.

## Section files

### `command-lengths.ts`

`vcmdLength` against `expectedArgs` at every `$DA`-`$FE`, every `$FB` count and every `$FA $FE`
chain length.

### `song-length.ts`

The walk and the compiler agree on how long the song is, a song per hazard. Among them: a command
above the first `#N` is in force on the lowest channel the song declares and on no other, and a
channel written in two blocks is one track — six notes on `#0` in time order, the second block's
under its own `@`.

### `tempo-map.ts`

A `t` inside a `[ ]` is recorded **once per iteration** — an execution and not a byte, which is the
thing the compiler cannot say and the whole reason the map exists.

### `loops.ts`

The **loop list** (`SongTimeline.loops`), the walk's own record of which voice replays which body,
how many times, entering at which tick:

- a `[ ]n` is one run of n passes; `]]n` plays n and the hex `$E6` byte one more;
- a label recall and a `*` are runs of their own, told from the declaration by the one fact that
  carries it — a `]`'s `$E9` is dropped from the command map where a `(n)m`, `*n` or `$E6` is not;
- a subloop inside a loop is one run per outer pass, so readers multiply nothing;
- a cross-channel recall runs on the calling voice;
- the body range holds exactly the loop block's notes;
- a run whose every pass is past the pass cut is still recorded, the list being a full-walk figure
  like `channelTicks`.

What is _not_ a run is pinned beside what is: an unterminated `$E6 $00`, a remote definition and
its call, and a count-zero `$E9`, which only a hand-built blob can spell (`]0` is AMK0116) and which
plays its body once and ends the phrase on the body's `$00`, as `cmdE9` never tests its count. A
crossed loop and subloop file what really played — one call run and a one-pass sub whose body range
partially overlaps it — so a reader refusing that shape has a stable input.

### `command-list.ts`

The **command list** the roll's lane is drawn from (`SongTimeline.commands`), which records a slot
changing hands rather than a byte being read:

- a command at the top of a channel is on tick 0, one after a note is on that note's end tick, and
  one written before a rest is on the **rest's** own tick — the case a note-anchored reading puts a
  whole rest late, and the reason the list exists at all;
- a `$DA` that moves two slots at once is still one entry; a `[ ]` re-running an unchanged command
  is one entry where one that alternates is an entry every time round; a song-wide `t` is recorded
  once and not once per channel, where `invalidateAll` hands all eight a fresh array; a command
  past the shortest channel never runs;
- a `$DF` that takes vibrato away is recorded where one with nothing to take is not;
- every address in the list is one `commandMap` names, bar the two `$FA` bytes AddmusicK prepends
  to the lowest channel's blob, which nobody wrote and which are pinned by count instead.

A `$DD` is the one entry that is not a slot changing hands and the one raised outside
`recordOrigin`, so four checks pin it apart from the rest: it is on the tick of the note that reads
it and not on the note's end tick, where every other command in that position sits; a tie in front
of it takes the tick with the slide; one inside a `[ ]` is an entry **every pass**, since a slide is
an execution where a `v200` rewritten to the value already in the slot is not; and one with no note
to ride is still recorded, at the tick the command loop reaches it and jumps to the `$0000` its
dispatch slot holds — nothing is left off the lane.

Each entry says whether a note **begins** on its own tick and sounds with it in force (`onANote`) —
the walk's description of where a bar stands relative to a command. The lane does not filter on it
and nothing else reads it, so this section is the only thing holding it correct. Seven songs,
because the ways a bar and a tick can disagree do not look alike: a command the next note keys on
with, one read while the channel rests, one read inside a tie, which sounds no note of its own, one
replaced before the next note sounds, one with no note left after it on its channel, one whose only
note the pass never reaches, and a `$DF`, which empties a slot and so is in no note's `origins` at
any tick. Told off the **entry** and not the address, which `[[ v100 v200 ]]2 c4` is what catches:
both `v200`s are written once, run at tick 0 on one channel and share a span, and only the second
is in force at the note.

### `command-lane.ts`

The **rule** the lane is drawn by (`state/command-timeline.ts`), which is the walk's list, the
command map, the scanner's spelling and `commandScope` joined, and which nothing but the join can
exercise. The lane holds every command that takes effect, so what these pin is the tick each lands
on and what is not a command it can speak for at all:

- one written straight before the note that reads it is on the lane **and** on that note's bar, at
  the one tick, and one read while the channel rests is on the lane a rest earlier than the bar
  that names it — both pairs asserted together, the first because a command drawn twice is the
  ordinary case and the second because that is where the two positions come apart;
- a replacement puts both halves on it, in the order the driver ran them, where the one replaced
  reaches no bar at all;
- a `$DF` is on it wherever it runs, having emptied a slot rather than taken one;
- `t` and the echo unit are on it needing no rest to qualify;
- an `o`, an `l`, a `>` and a `[ ]` are on it never.

And the note a lane glyph is **heard on** (`noteHeardOn`), which is what a value committed for it
replays: the bar that would draw the command as a chip, reached across a rest, past a note the
command was read inside a tie of, and back to the note a `$DD` rides; a `t`, which no bar draws,
and a command replaced before the next note keyed on take the next note to begin, and one past the
channel's last note takes none.

### `clock-agrees.ts`

The clock retimes no ordinary song relative to `stats.playback`, with the one class that does
differ pinned as the exact ratio 55/54 rather than left to be found later.

### `no-loop.ts`

A song that does not loop.

### `notes-mapped.ts`

Every note the walk finds is a note the compiler mapped.

### `written-pitch.ts`

The note map's **written** pitch beside the byte — `@2 o5 g` is `$B2` on the wire and `$B7` as
written, `h12 o0 c` is `$80` and `$74` — which is the row the roll draws on and the one thing the
walk cannot recover from bytes; that `$FA $02` is reported as a channel's tune and moves no byte;
and that a song-wide `t` or `$E4` on one channel is reported by the next note on every channel, not
only the one that ran it.

### `not-notes.ts`

The commands that must not be walked as notes: the song writes two notes round a `$FB` and must
yield exactly two.

### `percussion.ts`

`@29 o2a1b2c3` is one drum then two pitched notes on `#0` but three drums on `#6`, which is the
channel-dependent behaviour that makes walking bytes worth doing at all.

### `ties-gates-range.ts`

Ties, gates and the pitched range. `noteSoundingTicks`, which the note inspector prices a length
being dragged with rather than walking bytes, is held to the walk at every length to 300 under
every gate, and again under `#halvetempo`, which shrinks the pieces with the notes.

### `slide-read-ahead.ts`

The `$DD` a note's read-ahead picks up (`WalkNote.bend`), which is the one command the walk reports
as part of a note rather than on its own: it is on the note in front of it and on no note after, a
legacy `&` reads identically to the hex form, and a tie written before the command moves when the
slide starts. That last is what `afterTicks` is for, telling `[len note $DD]` from
`[len note $C6 $DD]`; the operands alone are equal in both, so a walk without it would call two
different songs the same, and `Music.cpp:2224` rewinds a tie out of the way of a `$DD` precisely
because they are not. A tie written _after_ the command is the shape `frameTicks` is for: in
`f+2 $DD $00 $D6 a+^2` the `^` emits a frame of its own and keys nothing on, so the arm stays at
the head of a 192-tick note with 96 ticks of it behind the four bytes, and the frame the peek read
them in is not the note's last one.

### `slide-start.ts`

The note the bend inspector draws a slide from: `slideStart` reads the byte the note map gives the
note `bendAnchor` names, which is the walk's own `bend.target - note` interval, the emitted byte
under `h` rather than the written one, and an answer that survives an edit after that note and not
one before it — the window a slider's commit opens until the recompile lands.

### `longer-channel.ts`

A channel longer than the song is reported (`SST0502`), not drawn. A loop that repeats too many
times kills no _written_ note: the same notes sound in the iterations that survive, so none of them
is underlined.

### `repeat-tempo.ts`

`tempoAtEnd`, which `SST0510` compares the repeat against, held to the running driver: `$51` a few
ticks into the repeat is the tempo the walk carried, including a `t` at the very end of `#0`, which
runs before the `$00` that ends the phrase, and not the same `t` at the end of `#1`, which never
runs.

### `repeat-settings.ts`

`SST0511`/`SST0512`, held to the driver the same way for every setting `repeat-settings.ts` models:
each warns where changed inside the loop and is quiet where written at the loop start, a toggle at
the loop start fixes nothing, and the running driver's volume, instrument, legato, echo, master
volume, transpose, fine tune and tremolo registers a few ticks into the repeat are what the walk
says carried. Remote code a rest cannot run is judged at the loop's first note, held to the driver
the same way: a rest runs no key-on code, and a type 3 keeps a voice on through the loop's first
rest only under legato or on a channel the phrase change cuts short.

### `malformed-data.ts`

Malformed data is contained, not thrown.

### `driver-plays.ts`

The driver plays what the walk says it will: at every poll the note the walk says is sounding
against the one the voice's track pointer is on. And a compiled `]2` patched to a count of zero:
the running driver never reaches the notes after the call, where the unpatched song does, and the
walk stops at the body's end with it.

### `driver-key-off.ts`

**Where a note is keyed off**, which is not `q`'s fraction of it: the read-ahead keys off at the
gate counter or at `!WaitTime` ticks before the frame ends, whichever is first, so `q7F` cuts a
quarter to 46 and not 47, and `$F4 $02` flips that for every channel at once. The running driver is
the oracle — each note is timed from key-on to key-off through `!PlayingVoices`, which nothing else
writes, across lengths that reach every branch of the rule, 193 among them, whose last 96-tick
piece is a single tick with no read-ahead tick to key off on.

### `tempo-shortfall.ts`

The **measured** clock, which is the only figure in the app that had to be played to be found:

- an easy song measures within a percent of the prediction;
- eight channels at `t254` fall more than 1.5x short of the rate they ask for;
- a short song whose first tick zeroes a 30 KB echo buffer still measures at tempo — the lead-in
  before the first tick is a cost and not a rate, and stays in the pass length because it is heard;
- a song of one-tick ties and a song of nothing but one-tick notes both measure at tempo, which a
  count taken off the note duration counter reads 8.5% and three times slow — `$70+2n` is reloaded
  with the 1 it was already holding, so the tick that fetched such a note moves nothing to see;
- `measure-clock.ts` prices a driver tick exactly as `@amk/tokens` does — the same restatement
  guard `vcmdLength` lives under, and what `SST0503` rides on.

### `in-force-named.ts`

The exactness the **command** map exists for, which is what makes a glyph on a bar clickable.

- Every entry addresses the byte the scanner says was written at its span — off by one and it
  addresses an argument, and still walks and still draws — and no note is in both maps, which
  would make a note a command in force on itself.
- The two shapes no reading of the source can reach: `v255 (1)[ c8 d8 e8 ]2 v200 (1)5` turns three
  written notes into 21, the first six under `v255` and the rest under `v200`, where the command
  that decides it is not inside the body at all; and a command at the _end_ of a `[ ]` body is in
  force for that body's own notes on the second pass and not the first, where one at the head is
  in force on every pass and would pass under any answer at all.
- `$DF` takes the vibrato slot away rather than filling it. A drum loaded by its own note byte
  leaves no stale `@` behind and names the loading note in `drumFrom` instead — and, through
  `state/commands-in-force.ts`, a note still on a drum's sample is shown under the `@` that loaded
  it, when the loading byte sat inside a `[ ]`, was replayed by a `*`, or was called from another
  channel, where no reading of that note's own text could find it.
- Which of the commands acting on a note the note **puts** in force rather than inherits — the roll
  plates those glyphs and the two mistakes available are both silent: comparing `origins` arrays
  instead of the commands in them lights up every channel's next note after any song-wide `t`,
  since `recordOrigin` invalidates all eight, and taking "the note before" from the note list
  instead of from the channel lights up alternate notes on every song with more than one voice, so
  a song is written for each. Also that a `[ ]` re-running a command that changes nothing is not a
  second definition where one that alternates is a definition every time round, that a slot a
  `$DA` cleared is put back in force by the byte re-enabling it, and that one `v200` inside a
  `(1)[ ]` called from two channels is put in force on both — which is why the colour saying so
  cannot be a channel's own.
- A channel that never writes an `@` plays `@0` (`main.asm:2321`), one song reaches every slot the
  walk tracks, and consecutive notes under unchanged state share one `origins` array — the roll
  builds a view model off those, so a fresh array per note is a fresh view model per note.
- The slide, through `state/commands-in-force.ts`: it is a command acting on the note in front of
  it, so that note's bar draws it and puts it in force and no bar after it draws anything — the
  exact inversion of filing it as a slot, which would have every note after a slide reporting one
  it does not play, and which is silent both ways. The written-note form is one glyph and its
  target sounds no note of its own; a slide inside a `[ ]` is put in force on **both** passes,
  since neither note inherited the other's; and one standing after a rest is on no bar at all, the
  lane being the only place it appears.
