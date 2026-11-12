---
paths:
  - 'scripts/pianorolltest/**'
---

# `pianorolltest`: what it proves

The piano roll's edits: `roll-strip.ts` and `roll-edit.ts`, driven the way the roll drives them. A
gesture is never checked by looking at the text it produced — the text is **compiled and read
back**, and every note the plan said the channel would hold has to be there on its tick, for its
length and at the pitch it was written at, with no other channel moved. That is the only check that
separates a splice which looks right from one which is right, since everything the roll writes is
read back through an `o`, an `l` and a `q` it did not write. The reading it is checked against is a
second one: `played` folds ties out of the compiler's note map itself rather than borrowing the
strip's fold, and it reads the **map** rather than the walk, because the walk ends the pass at the
shortest channel and an edit out in a longer channel's tail would otherwise look like it had done
nothing.

`scripts/pianorolltest/main.ts` runs one section file per subject and `support.ts` holds what they share:
the driver, building and stripping a song, applying edits, and the `expect*` checks. Below, each
section file and what it pins. `bulk.ts` is the bulk gestures, legato and quantize, over a
selection.

## Section files

### `spelling.ts`

The two spellings the roll and the compiler have to agree on are here too: that `spellNote` names
the same key `NOTE_NAMES` does for all seventy the driver plays — they cannot share a table, since
`@amk/core` may not import `@amk/tokens` — and that a note's octave falls back out of its written
byte, which is what makes a repitch exact rather than inferred.

### `gate.ts`

The gate has a song each: a `{ }` triplet, a `"x=c4"` replacement, a `#halvetempo` and a `&`, all
refused; a crossed loop-and-subloop pair, an unterminated `$E6 $00` and a `*` recalling a remote
definition's body, which are the loop shapes still turned away; a channel longer than the shortest,
which must **not** be refused, since that is the commonest shape a song has; a channel with a
zero-tick loop above the first marker, which must not be either; and `o4 c4 > d4`, likewise, because
a note's octave comes from its own byte rather than from a running sum.

### `loops.ts`

The **loops** section is the feature the frames exist for, and every claim in it is one the note map
cannot check — `played` reads it by channel and a body's entries are the loop block's — so its
oracle is the walk spelled out by hand, every pass of every body, plus the rebuilt strip's own
expansion agreement, which re-joins the edited text to the new walk note by note and fails to build
at all if a splice bent the loop structure. It pins the frame shape itself (frame-local ticks, an
instance per pass, each joined to its walk note); a body note repitched, deleted and drawn sounding
on every pass — the gap a rest, so the loop keeps its length — against a body's **last** note
deleted tightening the loop, its tail being free the way a channel's is; a stretch growing every
pass and sliding everything after the loop by passes times the delta, priced by `plannedFrameTicks`
and drawn by the preview once per pass with the later passes slid; the same in a hex `$E6` body,
once inside the pass and once wholly past it, where no instance is corroborated and the moved note
pads the short channel out to be heard; nesting multiplying instances through the outer passes; a
`*` recall playing the declaration's body again; the body's whole group moved as one gesture — a
multi-note selection drag — with the vacated head a rest and the reach into the tail the length
change it always is; and the old instrument-hazard song — `@0 (1)[…]2 @17 (1)2` — editing, which
unrolling refused outright. The refusals hold their own ground: a note dragged onto a loop hits
`REFUSE_LOOP_WALL`, a selection spanning a bracket `REFUSE_SPLIT` (a gesture moving no tick excepted
— a delete or a transpose is planned per frame and written as one commit), a body head fed by a drum
loaded before the `[` `REFUSE_REMAP_FED`, and a command inside a body refuses the lane's drag in its
own words while the channel itself edits. Cross-channel, one body two voices play is pinned from
both ends — an edit from the recalling channel lands in the declaring channel's block and both walks
come out as planned, with the moved note's furthest pass made audible by the pad, and one from the
declaring channel moves the recalling voice's passes with it — and a cross-channel stretch grows
both voices by their own passes' worth and pads **neither**, which is what `padChannels`' per-voice
growth adjustment exists to hold: a channel already moving with the body must not also be padded out
to meet it.

### `loop-carries-loops.ts` and `selection.ts`

Two readings a walk cannot make are pinned on top: **the plan's ordinals name the notes the commit
wrote**, which is what the roll carries its selection across an edit on (`anchorsFor`,
`notesAtAnchors`) — a stretch keeps its neighbours, a note carried past another comes back as the
note that was picked, a deleted one does not, and a drum is confirmed by its `@` alone; and a
voice's own tick count (`channelTicks`) and another voice's whole walk (`alsoPlays`), for a nested
transpose that pads the song once rather than once per frame and a note drawn into a body two
channels play, where `playsFor` cannot see either.

### `loop-edge-gap.ts`

The **edge gap** section is what a press on the loop box's edge holds, `openGap` and `gapSlack`
driven bare: the headline split in the porter's own spelling, `(1)5` grabbed at its third pass
becoming `(1)2 r1^1^1 (1)3` with the first two passes unmoved and the last three slid; a declaration
split writing `*` — or its own label where it has one — bound to the loop it directly follows; a `*`
recall split into two `*`s; the whole occurrence moved right with everything after it; leftward
clamped at the free rest space, a larger rest shortened rather than deleted, and the slack stopping
at a `v200` — the rest after it may go, the command keeps its tick, nothing earlier moves; a subloop
grabbed mid-run refused in its own words, `]]1` being the $E6 $00 open byte, while its whole
occurrence still moves; a nested subloop's box refused, having no song-time text position; a
cross-channel recall split editing the recalling channel alone with the declaring one padded out to
hear the moved passes; and a zero gap, and a mid-run leftward pull, writing nothing.

### `loop-edge-join.ts`

The **edge join** section is the same handle read backwards, `loopJoin` deciding whether a full
close leaves one construct or two: each of the four splits above joined back — a recall into `(1)5`,
a declaration onto its own `]`, a labelled one, and two `*`s into `*4` — a cross-channel recall
joined in the recalling channel alone, the middle of three occurrences taking the neighbour's count
and not every earlier pass the voice plays, and a split fed straight back into a join coming out as
the text it started as, character for character. Its refusals are what say the join reads the music:
a close that stops short leaves two calls, and so does a `v200`, a note, or the intro `/` written
between them — the `/` being the one thing there that `strip.commands` cannot see, `gather` raising
no command for an operator, so the guard is on the text and `loopTick` is the only reading that
catches a join that carried it. Last, a total past 255 falling back to the plain close, since the
ceiling is a fact about how a count is written and not about the music.

The join round trip asks `loopsWhereItDid`, since an intro `/` carried across a construct moves
nothing but the loop point.

### `loop-resize.ts`

The **ends** of that same box resize the loop, and one song carries the whole of it: `#0 o4 r4 [c4]3
d4` grown 48 ticks at its right end plays for 384 ticks and at its left end for 336, because the
right end adds them to the song where the left end pays for them out of the `r4` in front and pulls
the construct back — so the first pass's own note lands on the tick it already had. The headline
shrink is `[a1 r1]5` losing its trailing rest to become `[a1]5`, which is the one stretch of text no
_note_ gesture may rewrite (`realiseRegion` leaves a tail alone deliberately) and the one this
gesture is entirely about. `loopsWhereItDid` rides a **one-channel** song with an intro `/` in front
of the loop, since `loopTick` is the lowest tick any channel re-enters at and a second channel would
hold the reading down; `playsFor` is what pins the pad on a grow that runs past the end of the song,
a rest one note short reading exactly like a rest of the right length. A body two voices play is
grown from the **recalling** end with both walks spelled out, which is what pins `grown` as per
voice. The refusals each get a song that earns them: nothing at that end to take from, a command
standing past the body's last rest, nothing but music in front of a leftward grow, a later pass and
a later _occurrence_ of the same body, and a nested box's left end. And two bare blocks hold the
arithmetic no walk can reach — `bodyRests` at each end, and `shiftBoundariesFor` in all three of its
shapes, since a tail change steps at each pass **end**, a head change at each pass **start** less
the grabbed occurrence's own, and a voice with no construct moved keeps every one of its starts. The
notes on the grabbed channel land in the same place under either list, and only the boundary says
which voice's tail moves by how much.

### The note gestures: `note-drags.ts`, `note-deletes.ts`, `note-draws.ts`, `insert-mode.ts`, `drum-apart.ts`, `bulk.ts`, `refusals.ts`

`note-drags.ts` is the drags and stretches: a drag up a semitone, a drag into the next octave with
the octave put back after it, a repitch under an octave shift keeping the octave its unit carried, a
note dragged earlier into the rest before it, a stretch past a whole note written as a tie, a drum
moved between lanes, a mid-note `v200` that has to keep its place inside the note being stretched,
and a pitch drag on an implicit length that must **not** spell one in — `l4 c` stays `c`.
`note-deletes.ts` is the deletes: the octave a deleted note's unit carried, put back at the head of
the note that reads it and only there, and a note deleted from between two rests, which leaves the
one rest the two now are — with the cases that must **not** merge beside it, a `v200` or the intro
`/` written between them, and a gap whose ticks do not change, so rests the porter wrote touching are
only joined by a gesture that had to move them — and the same thing in a channel's tail, which
nothing else rewrites. `note-draws.ts` is the draws: a note drawn into a rest and past the end of a
channel, one drawn at the octave already standing, which spells none of its own, one drawn past a
`>` written in the gap and one past an upper-case `O`, both of which spell one because the scan over
that gap saw them, the octave put back for the note after a drawn one, and a note drawn in front of a
loop, whose body reads the octave standing at its `[`. `insert-mode.ts` is the pushes, a drag, a
draw and a stretch shoving a neighbour aside; `drum-apart.ts` a drum whose `@` is written apart from
it; `bulk.ts` legato, quantize, glue and a selection moved as one. And `refusals.ts`: a note dragged
onto its neighbour, one dragged off the bottom of the driver's range, a stretch with nowhere to push,
and a note shortened past the command written inside it.

### `overwrite-mode.ts`

Overwrite has a group of its own, because what it writes is a different question from what it plans:
a note eaten whole, a head trimmed, a tail trimmed, a stretch and a left edge that take ticks where
they would have pushed, and — the case the mode turns on — a note landed inside a longer one, which
is proved by reading the note map back as **two** notes at that pitch rather than by the text, since
the tail is a note being created and the region that holds it holds the drawn note too. Three
readings there catch what the text cannot. `playsAsLong` is on every one of them, because a carve
takes only ticks the channel already had, so a song that grew means a carve was counted as reaching
somewhere and every other channel was padded out to meet a note nothing had moved. `loopsWhereItDid`
is on a note drawn over the one after the intro marker, in a song of **one** channel, and the one
channel is the point: `loopTick` is the lowest tick any channel re-enters at, so a second channel
marked at the same tick would hold the reading down and hide a marker that had slipped a whole
region late — the song plays for the same length either way. And the octave a split leaves standing
is the **last** pitched note in the run rather than the only one, with the note that reads it being
the next _surviving_ note rather than the next note item, which may be one the same plan is
deleting. The refusals are the two things a carve can be asked for that the data cannot answer: a
selection eating its own notes, which is the one place overwrite is stricter than insert, and the
head of a note with a command written inside it, whose offset is a number of ticks into the note and
would travel with the note's start.

### `carried-past.ts`

A note carried **past** another has a group of its own, and it is the one place where reading the
text proves nothing at all: a channel whose notes have every one of them slid along reads perfectly
well — the notes are all there, at the lengths they were written at — so `plays what the plan said`
is the only check that sees it, with `playsAsLong` the second net for the shape where the rests left
behind lengthen the channel. A channel's ticks are the running sum of its durations, so tick order
**is** text order, and a drag that carries a note over one of its neighbours breaks that: the note
is lifted out of the text and written again on the far side rather than rewritten where it stands.
All three modes reach it — overwrite most easily, being the one that says yes to a long drag, but
strict has the same hole, since a jump into free space clashes with nothing, and so does insert,
which pushes only what the drag actually lands on. The cases go right past one note and left past
one, where the channel legitimately comes out **shorter** because the note that left was the one
holding its end, so `playsFor` says the figure rather than `playsAsLong` claiming it did not move;
left past one with a note still ending the channel, which does hold; past two at once; past one and
onto the next, so a carve and a crossing happen in the one gesture; a whole selection past a static
note; a drum that keeps its own `@21`; and one carried past the end of the song, where `playsFor`
proves the note still padded every other channel out to meet it. The refusal is a note with a
command written inside it, whose unit encloses that command and would carry it off with the note.

### `removed-commands.ts`

A command's **reach** is what decides whether a removed item takes it with it, and that has a group
of its own because the answer is a fact about the song rather than about the gesture — the same note
deleted and drawn over gets the same reading, which the block pins by writing both. What it keeps: a
`v200` a surviving note still sounds under, one the note being drawn begins on the tick of, and one
out past the end of the pass, where `verified` is false and "nothing sounds under it" is not
something the walk can say. What it drops: a declaration with nothing after it at all, and one
another `y` takes over before the next note sounds — off the walk's own slot bookkeeping rather than
a scan of the source, which is what makes it right through a `[ ]` and a `(n)` call. A command a
laid-out run cannot leave where it stands is written out again on its own tick, so the drawn note
comes back as tied halves and `played`'s fold is what says the pieces are still one note; two
commands in one run split it twice. And the refusals are the three things a run cannot take over: a
`t` between two overdrawn notes, which acts on the song and belongs with neither of them; a command
written **inside** a note being deleted or glued away, which has no tick left to stand on once the
note has gone; and a note cut shorter than the ticks in front of such a command, which is the one
refusal whose reason really is the length.

### `drag-carries.ts`

And `expectCarried` pins the seam itself: the lifting-out belongs to `planEdits` rather than to
`planGesture`, because the plan is what the roll **draws**, and a note demoted a step earlier would
leave the song's own bar on screen and make every crossing drag look like a copy being taken.

### `past-the-end.ts`

Drawing **past** the end of the song has a group of its own, and it is pinned by the length rather
than by the text: `playsFor` says how long the song must play afterwards, because a rest one note
short reads exactly like a rest of the right length and `others` cannot see a rest at all. The cases
are the ways the padding can be wrong — a note drawn past the end of a plain two-channel song, one
where the channel holding the song back is a `[ ]` the roll would not build a strip for, one where
the note was not drawn past the end but _pushed_ there by the note in front of it, an intro song
where the loop point must not move, a channel with no ticks that must not be given any, a channel
already past the new end that needs none, a channel already running past the song where the padding
answers to where the note reaches rather than to where that channel ends, and a deletion in such a
channel, which moves nothing and so must lengthen nothing.

### `opening-a-channel.ts`

Opening a channel has a group of its own, because the text is the whole answer there and the notes
only half of it: the block written for a channel the song has never declared is pinned character for
character — the `#N`, the five defaults, the blank line above it, the rest carrying the note out to
its tick, and the absence of a second `o4` after the one the block just wrote — and beside it, a
channel already declared taking the note into its own block rather than a second `#N`, a block
ending in a `;` comment that must not swallow the run, a drum whose own `@21` follows the opening's
`@0`, an `#am4` song where the opening writes no `@` at all, and the two songs where opening a
channel is refused because a `#N` below the lowest one already there would take the music above the
first marker with it. A song with an intro has three of its own, one per place the `/` can land —
after a note, inside the rest that fills the channel out, and inside the note itself, where the note
is written as a head and a `^` continuation and has to read back as one note. All three pin
`loopTick` across the edit, which is the only reading that catches a marker written on the wrong
tick: the text looks equally plausible either way. Every one of them also pins the song playing for
**as long after the channel is opened as before it** — the rests the opening runs out to the
shortest playable channel are what hold that, and a channel left at the length of its first note
would take the rest of the song with it. `others` reads the note map rather than the walk for these:
a channel being opened is as short as the shortest one in the song, and the walk ends its pass
there.

### `carrying-a-command.ts`

A command **carried along the lane** (`roll-command-move.ts`) is the one edit here that touches no
note at all, so the group asserts that before anything about the text: the channel plays exactly
what it played, no other channel moved, and the song is exactly as long — read through `played`'s
tie fold, since a command taken out from between a note's head and its `^` leaves the two to be
folded into one note map entry where they were two, which is the same music and fewer bytes. What
each case pins past that is the **tick the driver ends up reading it at**, which is the one thing
the text cannot say: `p12,147` written before a rest and written before the note after it look
equally plausible and are 64 ticks apart. `commandTicks` reads the walk rather than the lane for it,
because a command dropped on a note's own tick leaves the lane by construction. The cases are the
motivating song carried onto the note that reads it and carried back to the top of the channel, one
let go where it already runs, which has to write the same **bytes** rather than merely something
equivalent — a wash that still cost an undo step would pass any other reading — one carried onto a
rest, one carried out from inside a note, a song-wide `t`, a `v24,200` fade that has to move whole,
a song of **one** channel where the command crosses the intro `/` and `loopTick` must not move, and
a two-channel song for `others`. The refusals are the channel gate the drag borrows whole — a `[ ]`,
in `channelStrip`'s own sentence — and a command written inside remote code, which the lane cannot
reach at all, the walk not stepping into a body, and which is guarded because moving one would
change every site that calls it. The targets are checked with no compile in the way: one per item,
each at its item's own head, none past the last, and a drop equidistant between two taking the
earlier.

### `pitch-slide.ts`

A `$DD` pitch slide has a group of its own, and it is the one construct whose position is a **byte**
adjacency rather than a tick: the note before it is what reads it (`main.asm:L_10E4`) and its
dispatch slot holds `$0000`, so a rest written between the two sounds right up to the moment it
plays. Both forms are edited — the all-hex one and the one whose last parameter is a written note.
What the cases pin is the two things the text cannot say: that a gap opened under a slide puts its
rest **after** the whole construct rather than between the note and the command, and that a rewrite
of the note the slide rides on leaves the octave in force at its target where it was — read out of
the emitted third byte, since the target's own text does not change when the octave under it does
and it is in no note map for `played` to see. The refusals are the two gestures with no honest
answer: deleting the note a slide rides on, which strands the command in front of nothing, and
dragging its glyph along the lane, since every target the lane offers is a unit's head and this is
the one command that must follow a note rather than lead one. Last, the strip carries the walk's
**reading** of the slide beside the token that wrote it — `StripItem.bend` is the `$DD` in the text,
`StripItem.slide` is what the driver will do with it — joined index by index over the very list
`expandAndJoin` has just checked, which is what keeps it from being a second join that could quietly
disagree. Three songs with **identical operands** are what separate the two: `c4 $DD`, `c4^4 $DD`
and `c1 $DD` arm 0, 48 and 96 ticks in, and the last has no tie written anywhere at all, `emitNote`
having chunked 192 ticks inside one note-map entry. A tie written _after_ the command is pinned too
— `f+2 $DD $00 $D6 a+^2` is one 192-tick note arming at its head with 96 ticks still to come, and
the token is found inside the unit rather than after it, `growUnits` ending that unit at the `^2`
past the `$DD`. Past the end of the pass there is no walk note to ask, so the item carries no slide
however plainly the `$DD` follows it — the same reading the commands-in-force list takes, and the
reason a note the walk cannot corroborate auditions flat rather than approximately right.

### `seed.ts`

The seed is here too, `roll-seed.ts` being what the roll runs when it is opened on a song with no
playable music: a blank document becomes the seed song whole, a bare header or an `#spc` block gets
the seeded channel with its defaults, a declared channel or a command written above the channels
gets only the rest — the defaults are the porter's to write, and tick-0 state the seed wrote would
win over theirs — and every seeded song compiles and plays its whole rest, while a song failing for
its own reasons is left alone.
