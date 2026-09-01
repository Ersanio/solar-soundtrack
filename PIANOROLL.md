# Piano roll shortcuts

A reference for the piano roll editor while there is no proper readme page for it. The **channel**
is picked by the eight toggles in the corner above the keyboard, by a click on any note, or by
soloing a part in the mixer below. It does not have to be picked first: with none picked you can
still grab, stretch, copy or delete a note in any channel, and doing so picks that note's channel.
Drawing a new note, the marquee and the keyboard shortcuts do need one, since empty grid belongs to
no channel.

## Mouse

| Gesture                                    | What it does                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Hover over empty grid                      | A ghost bar shows where the next note goes and how long it will be                                        |
| Press on empty grid                        | Draws a note there and keeps it under the pointer until you let go                                        |
| Click on empty grid                        | Draws the note and leaves it there                                                                        |
| Drag the middle of a note                  | Moves it a snap step at a time, one row per semitone up and down                                          |
| Drag a selected group of notes             | Moves them together, sounding the note you grabbed as it crosses rows                                     |
| Drag a note's left or right edge           | Stretches that end; the other end stays put                                                               |
| Click a loop box's edge                    | Selects the loop's whole group, closes its outline up, plays that pass, names it in the loop inspector    |
| Drag a loop box's top or bottom sideways   | Moves that pass along the song: rests open in front of it and the recall splits, or close and it joins up |
| Drag a loop box's top or bottom up or down | Transposes every note of the body, one row per semitone                                                   |
| Drag a loop box's left or right            | Resizes the loop — the right end moves where the body ends, the left end where it begins                  |
| Hold `Alt` during any gesture              | Tick precision: no snapping, for either a position or a length                                            |
| Click a note                               | Selects it, sounds it with its pitch slide, and puts the caret on it                                      |
| Double-click a note                        | Goes to it in the MML                                                                                     |
| `Ctrl` + click a note                      | Adds it to, or takes it out of, the selection                                                             |
| `Ctrl` + drag on empty grid                | Draws a box, selects every note of this channel inside it, and plays that stretch of the song             |
| `Ctrl` + drag a note                       | Copies it instead of moving it — the whole selection, if there is one                                     |
| `Shift` + drag on empty grid               | Draws a note where you pressed and pulls its right edge along                                             |
| `Shift` + drag a note                      | Locks it to the axis you first drag along — sideways it keeps its row, up or down it keeps its tick       |
| Right-click a note                         | Deletes it                                                                                                |
| Right-drag across notes                    | Deletes each one the pointer crosses                                                                      |
| Middle-click                               | Nothing yet                                                                                               |
| Middle-drag                                | Pans the roll, both ways at once                                                                          |
| Wheel while drawing a note                 | Sizes it — `l1`, `l2`, `l3`, `l4`, `l6`, `l8` … down to `l192`                                            |
| Wheel while holding a note still           | Resizes that note the same way, from its right edge                                                       |
| `Alt` + wheel while sizing                 | Sizes it a tick at a time instead                                                                         |
| `Ctrl` + wheel                             | Zooms in and out about the pointer                                                                        |
| `Shift` + wheel                            | Scrolls the roll sideways                                                                                 |
| `Alt` + wheel                              | Makes the rows taller and shorter, about the pointer                                                      |
| Drag the overview bar                      | Scrolls the roll through the song — grab the lit box and it follows you                                   |
| Drag the timeline below it                 | Moves the playhead; hold past either end and the roll scrolls along                                       |
| Click a key on the left                    | Sounds that pitch on the channel being edited, so you can find it by ear                                  |
| `Ctrl` + click a channel chip              | Solos that channel, which also picks it to edit                                                           |

## Keyboard

| Key                         | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `Delete` / `Backspace`      | Deletes the selected notes                                      |
| `Escape`                    | Drops the selection and the inspector with it, then the channel |
| `←` `→`                     | Nudges the selection by one snap step                           |
| `↑` `↓`                     | Moves the selection a semitone                                  |
| `Shift` + `↑` `↓`           | Moves it an octave                                              |
| `Ctrl` + `A`                | Selects every note on this channel                              |
| `Alt` + `Q`                 | Quantize — pulls each selected note's start onto the snap       |
| `Alt` + `L`                 | Legato — stretches each selected note until it touches the next |
| `Ctrl` + `J`                | Glue — joins selected notes that already touch into one         |
| `Ctrl` + `B`                | Copies the selection one bar to the right                       |
| `Ctrl` + `Z` / `Ctrl` + `Y` | Undo and redo, the same history the MML editor uses             |

Shortcuts are ignored while you are typing in the MML, so `Ctrl+A` there still selects the text.

## The two bars over the roll

The wide one is the **whole song at once**, with the part you are looking at marked on it, and it is
how you get around: grab that lit box and it follows the pointer, or press anywhere else on the bar
to go straight there.

The thin one under it is the **timeline** — bar numbers, beat ticks, and a triangle whose tip is on
the playhead. Drag the triangle to move the music, and keep dragging past either end of it to carry
the roll along with you. Anything that moves the **view** unticks **Follow playback** — the wide
bar always, the timeline only when a drag runs off the end of it and starts scrolling — since you
have taken the roll somewhere the song is not. Tick it again to catch up with the music.

## What a note's icons mean

A bar carries its own pitch on the left and, on the right, one icon per command acting on that
note — its volume, its envelope, its instrument, and so on. Hover the bar to have them named, click
one to ask the inspector about that command, or double-click it to go to it in the MML.

An icon on a **solid pale chip** is a command that note puts in force; a plain outlined icon is one
it inherits from earlier in the channel. So a run of notes under one `v200` shows the chip on the
note the `v200` actually landed on and the outline on the rest, and the hover says the same thing in
words — "sets volume" against "under volume". The chips come first, so a bar with room for one icon
spends it on a command that starts at that note rather than on one it inherits.

A wide bar shows more icons than a narrow one, and a bar too small for its own name shows none at
all; three dots in the last slot mean there are more than fit, on a chip of their own when one of
the ones they stand for starts at that note. The hover and the inspector always have the whole
list — the inspector under two headings, one for what the note sets and one for what it plays
under. Its buttons answer to the same pair the bar's own icons do: a click asks the inspector about
that command and leaves you in the roll, a double click goes to it in the MML.

**Changing a value in the inspector replays the note.** Let a slider go and the selected note — the
one whose bar or icon you last clicked — sounds again under the new value, once the edit has
compiled. With no note selected — after `Escape`, or a click in the command lane — a commit makes
no sound.

## The command lane

Under the roll is a strip holding nothing but command icons, on the song's own timeline: what takes
effect, and where, with the note data out of the way. **Commands** on the toolbar opens and closes
it, and it stays as you left it.

It holds **every command that takes effect** — the song's own settings, `t`, `w`, `$E4` and the whole
echo unit, `$EF` to `$F2` and the `$F5` filter, and every channel setting too: a `v`, a `y`, an `@`,
an `$ED`, and the ones that switch something off, `$DF`, `$F0`, `$FD` and `$FE`. Each sits on the
tick the driver reads it at, whatever else is happening there.

Most of those also show as an icon on a note bar, and the two are not repeating each other. A bar's
icons are the commands acting on _that note_, so they stand where the note does; the lane stands
where the driver reads the command. In `c4 v200 d4` those are the same tick. In `c4 v200 r4 d4` they
are a rest apart — the lane has the `v200` in the rest, where it runs, and `d4`'s icon says `d4` is
the note playing under it. The lane is the one place the whole song's commands can be read in the
order they run, which a set of per-note icons cannot be.

A `$DD` pitch slide is the one that stands _behind_ its note rather than in front of it. It is the
note before it that reads it, so its icon is on that note's bar and on no bar after — a slide runs
once and leaves nothing for the next note to play under — and the lane puts it on that note's own
tick, which is where it is heard rather than where the bytes sit. In `c4 $DD $00 $18 $A6 d4` both are
tick 0, under `c4`. The rule below says the rest of what follows from that.

Four things are on no bar at any point in the song, so the lane is the only place they appear at
all: a command replaced before the next note sounds, one written after a channel's last note, the
four that switch something off — a bar names what a note is playing _under_, and there is nothing to
name once vibrato is off — and a `$DD` with no note in front of it to read it, which is a slide the
driver never plays.

The other direction: `q`, `h` and `@21`-`@29` are on the bars alone and never here. They emit no
byte, so the driver never reads them at a tick of their own; the note they fold into is their only
honest position, and that note is already drawing them. Neither an `o` nor an `l` is a command in
this sense — they are what the roll's rows and lengths already are.

The icons are all eight channels at once, each in its channel's colour — which for a song-wide
command is the channel that wrote it.

**The channel you are editing sits in the top rows**, above every other channel's, so its commands
are the ones you can read without lifting the stack. Pick a different channel and the rows are dealt
again.

**Muting a channel takes its own settings off the lane.** A `v`, a `y`, an `@` or an `$ED` on a
channel you cannot hear sets nothing you can hear, so it goes rather than fading. What that channel
contributes to the whole song stays and fades instead: a `t`, a `w` or an echo write runs whatever
channel it happens to be written on, and muting that channel does not stop it.

**Whatever command you are inspecting is outlined here**, in the same white the roll outlines a
selected note with, however you reached it — an icon on a bar, an icon in the lane, or a button in
the note inspector. The lane is the one place every command appears, so it is where "this is the one"
can always be said. A command written inside a `[ ]` that plays twice is outlined at both ticks: it
is one command, wherever the driver reads it.

**Drag the line above the lane to make it taller**, the way the divider between the editor and the
output pane works. Five icons deep is where it opens and the shortest it goes; ten is the tallest.
Double-click the line to put it back to five. The height is remembered with the rest of the roll's
settings.

The lane scrolls sideways with the roll and carries the same grid and the same playhead, so an icon
sits under the note it acts on and on the beat it lands on — centred on its own tick, straddling the
bar or beat rule it runs on. The two ends are the exceptions, so that neither goes off the edge: the
one at the very start sits just inside it, and one on the song's last tick just inside that. Where several land on one tick they stack
upwards; five icons deep is as much as the lane opens at, and a plain wheel over it lifts the stack
when there is more. Nothing is ever left out for want of room — however many commands land on one
tick, each gets a row of its own, and the wheel and the seam are what reach them. Click an icon to
ask the inspector about that command, or double-click it to go
to it in the MML — the same as clicking one on a bar, except that it leaves the channel you are
editing alone and lets go of the selected note: a lane icon names a command of the song rather than
a note of it, so a value committed from here replays nothing. **Right-click one to delete it**, in one undo step. That is the counterweight to a
roll that keeps a command wherever something still plays under it: an edit hands the command back to
the notes that need it, and this is how you say none of them do. A command written through a
`"name=value"` cannot be deleted this way — its icon offers no right-click — because the text it
would take out is the call site rather than the command.

**Drag an icon sideways to move that command to another tick.** It snaps to the starts of the notes
and rests in its own channel — the ticks where something actually begins — so it lands in front of a
note or a rest rather than part-way through one, and it never leaves the channel it is written in,
since within a channel the order of the text is the order things happen. Let it go where it already
runs and nothing happens at all, not even an undo step. Dragging up or down does nothing: which row
an icon sits on is packing, and says nothing about the song.

This is also how a command written **inside** a note is got out of one — a `v200` between a note's
head and its `^` — which is what deleting or gluing that note is otherwise refused for.

A song-wide setting drags too, on the boundaries of the channel that wrote it, which is the channel
its colour names. If the roll cannot read that channel — a `[ ]`, a `(n)` call, a `"name=value"` —
the icon turns red while you hold it and the lane says why; letting go then changes nothing.

## Three settings that decide how a drag lands

**Grid** is the time signature the bar lines are drawn from: beats in a bar, over the note value that
gets the beat. `6`/`8` is six `l8`s to a bar. MML has no time signature of its own, so this is yours.
`0` beats draws no grid at all. A fresh roll opens on `4`/`16` — a line every sixteenth with a
heavier one every quarter note, which is the grid FL Studio opens on.

**Snap** is the step a note moves in — `Bar`, `Beat`, `½ beat`, `¼ beat`, `⅛ beat`, `⅟₁₆ beat`, or
`Off`. `Bar` and `Beat` are read off the Grid, so the two stay in step without being welded
together, and a fresh roll snaps to `Beat` — which at `4`/`16` is the sixteenth the lines are drawn
at. Set the Grid to 4/4 and a beat is a whole quarter note instead, far too coarse to draw
sixteenths against, and one of the fractions is what you want.

**Dragging moves a note by whole steps; it does not pull it onto the grid.** A note written a
little before the beat is meant to be there, and dragging it a bar later should leave it a little
before that beat too — so what snaps is how far it travels, and it keeps whatever it had against the
grid. `←` and `→` have always worked this way and a drag now agrees with them. Drawing a _new_ note
is the exception, and has to be: a note that does not exist yet has no position of its own to keep,
so it lands on the grid where the ghost said it would. **`Alt`+`Q` is the one thing that pulls a note
onto the grid**, which is what quantizing is for.

**Stretching does not use Snap.** A length lands on the note values themselves — a whole, a half, a
quarter, an eighth, and their dotted forms — because a note in MML is a duration rather than a region
on a timeline. The bubble that follows the edge says which one you are on and how many ticks it is.

**The bubble reads the note as it will be written** — `c8.`, or `c=37` where the length has no name
of its own — so what it says during the drag is what lands in the MML at the end of it. Stretch
several notes at once and it drops the letter and says the length alone: they all take that length,
and only one of them is a `c`.

**A new note starts at the length of the last one you drew, stretched or clicked**, so a run of
sixteenths costs one sizing rather than one per note, and picking up an existing note is enough to
go on drawing at its length. The first note of a fresh roll is an `l8`. Deleting a note leaves the
length alone — it is the note you were last interested in that sets it, not the one you threw away.

To size the one you are placing, keep the button down and turn the wheel: it steps through `1`, `2`,
`3`, `4`, `6`, `8` and on down to `192`, and where you let go is where the next note starts. The
same wheel over a note you are **holding still** resizes that note from its right edge. There are no
dotted stops on the wheel — those are a stretch away, and putting them on the wheel would double the
turns it takes to cross.

**Edits** is what happens when a gesture would put two notes on top of each other. A channel plays
one note at a time, so that is something the roll has to answer one way or the other, and this is
where you say which:

- **Overwrite** takes the ticks. The note you are placing wins, and whatever was under it keeps
  whatever it did not cover: the ticks being taken are hatched in red on that note's own row while
  you drag, and what survives is drawn as a striped outline. A note you land wholly inside comes
  back as two — the part before you and the part after you, at the same pitch. This is what a fresh
  roll starts on.
- **Insert** moves the notes in the way out of the way, shown as striped outlines while you drag.
  They go in the direction you are dragging, and the notes they run into go with them.
- **Strict** never writes an overlap. The bar turns red, the ticks where the two would sound at once
  are washed red down the whole roll, and letting go changes nothing.

It is one rule for every gesture — drawing, dragging, nudging with the arrows, stretching an edge,
and `Alt+Q` — so where you grabbed the bar does not change the answer. It does not reach the Length
slider in the inspector, which writes one note's own length and never looks at its neighbours.

## What happens to a command when the note it was written for goes

Every gesture that removes a note or a rest — a `Backspace`, a note drawn over the top, a glue, a
carve — asks the same question about the `v`, `y`, `q`, `@` and the like written just in front of it:
**does anything in the edited song still play under it?**

If something does, the command stays. A note you did not touch counts, and so does the note you are
drawing, so the spot keeps its dynamics and what changed is which note sits there. If nothing does —
it was the last note on the channel, or another `v` takes over before the next note sounds — the
command goes with the note.

The gesture is no part of the question. `Backspace` on a note and drawing over the same note get the
same answer, which is a fact about the song rather than about how you got there. It is the driver's
own reading, too, not a scan of the MML: a command inside a `[ ]` played twice, or a `(1)n` called
from another channel, is followed where it actually runs.

A command that stays stays exactly where you wrote it. Where the roll has to lay a whole run of new
text over the stretch that held it — drawing over two notes with a `v200` between them — it writes
the command out again on the tick it ran at, which splits the note you drew into two tied halves
around it: `c4 d4 v200 e4 f4` drawn over from the `d4` comes back `c4 g4 v200 ^4 f4`. A tie is one
note, so nothing about what you drew has changed.

Song settings such as `t` and `w`, an `o` or an `l`, and the intro `/` are outside all of this: no
note gesture moves one. Dragging its icon along the command lane is how a `t` or a `w` is moved on
purpose, and an `o`, an `l` and the `/` are not in the lane at all. So is everything written above a
channel's first note, which is the channel's setup rather than any one note's. And a command written **inside** a note — between its head and a `^` —
can only be kept by a run being laid over those ticks; delete or glue such a note with something
still playing under that command and the gesture is refused instead, because there is no tick left
to put it on. Delete it from the lane first if you meant it to go.

## What the roll will and will not do

- **No chords.** A channel plays one note at a time, so two notes can never overlap. What a gesture
  does about that is the **Edits** setting above, and it is the same answer for every gesture.
- **A push can run out of room.** The start of the channel is the end of the road for notes being
  shoved left, and a selection cannot shove its own notes aside to make space for itself. Insert
  mode says so the way strict mode does — red, and nothing committed. Overwrite never runs out of
  room, because it takes room rather than needing it — but a selection cannot eat its own notes
  either, so stretching two notes that already touch into each other is refused there too.
- **A command written inside a note pins that note's start.** A `v200` halfway through a note stands
  a number of ticks into it, so taking ticks off that note's _front_ would carry the command along
  with it and it would sound later than you wrote it. Overwriting the head of such a note is
  refused; overwriting its tail is not, and the command stays exactly where it is. Cutting the note
  shorter than the ticks in front of the command is refused too — there is nowhere left inside the
  note for it to fire.
- **A gap is a rest.** The space between two notes is the rest between them, and moving a note
  rewrites that rest rather than moving anything else. Anything you wrote inside the gap keeps its
  distance from the note that follows it, and a rest covered completely is asked the same question a
  note is — see above.
- **A refusal says so.** Where a gesture cannot be written, the roll turns the bars red while you
  are still holding it, and the toolbar says why in words — "there is something written where that
  note would go", and so on. A reason arrived at only when you let go stays on the toolbar until the
  next edit lands, since the gesture it belongs to is over by then.
- **A drum's row is its instrument.** Dragging a drum up or down moves it between drum lanes by
  rewriting its `@21`–`@29`. Dragging one onto the keyboard, or a pitched note onto a drum lane, is
  refused: that is a change to what every note after it plays on, not a move.
- **Drawing on an empty channel writes the channel.** Pick a channel the song has never used and draw
  on it, and the roll writes a `#N` block for it at the end of the MML, with the settings a fresh
  channel runs under — `o4 q7F @0 v255 y10` — before the note. No `l`: every length the roll writes
  is the note's own, so nothing it puts there reads a default. All of it is one undo step. The
  block goes at the end because an octave and a default length carry across a `#N`, so a block
  dropped in between two others would change what the second one is read under; **Normalize** is what
  puts the blocks back in `#0` to `#7` order.
- **And fills it out with rests to the length of the song.** A song is only as long as its shortest
  channel — the driver stops every channel the moment one of them runs out — so a new channel holding
  one note would cut the rest of the song off at that note and hide it from the roll. The rest after
  the note is what stops that: the new channel comes to exactly the length the song already played
  for. Draw _past_ the end of the song and no rest is added; that channel is simply the long one, and
  the warning about music past the end of the song says so.
- **And gives it the song's intro marker.** If the rest of the song has a `/`, the new channel gets one
  too, on the same tick — every channel resumes from its own marker on each pass round the loop, so one
  in the wrong place would leave the channel playing against the song. If the tick lands part-way
  through a rest it is written as two rests, and if it lands part-way through the note the note is
  written as `c8 / ^8`, which still sounds as one note.
- **Every edit is one undo step**, including a whole selection moved at once, and it is the same
  history `Ctrl+Z` uses in the MML editor.

## Starting from nothing

**Opening the roll on a song with no playable music writes the least the song needs to compile.**
A song is not editable here until it compiles, and a song with nothing to play does not — so the
roll seeds one rest, and whatever has to stand in front of it. A blank document becomes `#amk 4`
and a `#0` opened the way a drawn channel is, plus the song-wide `w255` and the driver's own boot
tempo written out as `t53`, holding one whole rest. A document holding only a header — an `#spc`
block counts as part of the header — gets that same channel. And once anything of yours is written,
a `#N` or any command above the channels, only the rest goes in, at the end of the last channel's
block: everything else the seed could write is tick-0 state, and a seeded `v255` or `t53` would
silently win over a `v200` or `t60` already there. The seed is one undo step, and a song that
fails to compile for reasons of its own is never written to.

## When a channel cannot be edited

**A channel you cannot hear cannot be edited.** Mute it, or solo another part, and its notes go dim,
stop answering the pointer, drop whatever was selected on them, and the toolbar says which of the two
it is. Unmute it, or lift the solo, and it takes edits again — though the selection does not come
back, having been dropped rather than hidden.

Some MML has no one-to-one relationship between what is written and what is played, and the roll says
so in the toolbar rather than guessing. A `{ }` triplet, a `"name=value"` replacement or a
`#halvetempo` all mean one written note is not one played note.

Loops are not on that list: a `[ ]` loop, a `[[ ]]` subloop or the same thing written as
`$E6 $00` … `$E6 $nn`, a `*` and a `(n)` call are all edited in place — see **Loops** below. What
still refuses a loop-bearing channel is the handful of shapes the roll cannot line up with what
plays: a loop and a subloop that _cross_ (one opens inside the other and closes outside it, which
compiles and then plays neither construct as written), an unterminated `$E6 $00` that nothing
closes, and a `*` or `(n)` that replays a remote code body.

A legacy `&` is refused for a different reason, and refuses the whole song rather than one channel:
it is an operator rather than a command, so nothing above the compiler can say which channel it is
written on, and the bend duration it compiles to is the length of the note _before_ it — so an edit
to that note would silently change a slide nothing on screen has drawn. **Normalize** is the way out.
It writes every `&` as the `$DD` it already compiles to, byte for byte, after which the slide is a
command the roll can see and the rules below apply to it. A slide it cannot write out — one standing
after a tie, which `$DD` would move — is left alone and named in the dialog, and goes on refusing the
song.

A `$DD` pitch slide is not one of them, and is the one command with a rule of its own. It is not
dispatched: the note before it is what reads it, by peeking at the byte standing at the track pointer
(`main.asm:L_10E4`), and its slot in the dispatch table holds `$0000`. So its position is a **byte**
adjacency rather than a tick — a rest written between the note and the slide sounds right up to the
moment it plays — and its last parameter may be a note written after it, which emits nothing of its
own and reads the octave in force where it stands. The roll keeps both: a run written after a note
goes after the whole construct, the octave a rewrite puts back lands in front of the slide rather
than at the next note's head, and the slide is never taken away by a deletion in the way an ordinary
`v` or `y` is. Two gestures are refused outright, in their own words — deleting the note a slide
rides on, and dragging the slide's own glyph along the command lane, since every place the lane can
drop one is in front of a note where this one has to go behind one.

The same fact decides where it is drawn. Its icon is on the bar of the note that reads it, plated the
way anything a note starts is plated, and on no bar after it: a `v` or a `y` is state the notes that
follow go on playing under, and a slide is over when it is over. A slide inside a `[ ]` played twice
is two slides, so both notes carry it and both are plated. On the lane it sits on that same tick,
which for `c4^4 $DD …` is 48 ticks into the note rather than at its head — the read-ahead does not
find the slide until the tie's own ticks, which is why writing one after a tie is a rewrite Normalize
declines to make.

And it decides what you hear. Clicking the bar plays the note **with its slide**, as does every row a
drag of it crosses, since the target is an absolute note the bar would still slide to wherever it was
dropped. Where the slide starts is read off the song rather than off the text, for the same reason
the lane's tick is: `c4 $DD`, `c4^4 $DD` and `c1 $DD` carry the same three bytes and arm at 0, 48 and
96 ticks in, and the last has no tie written anywhere. A note the roll cannot check against the song —
one past the point the shortest channel ends — sounds flat rather than approximately right.

A tie written **after** the command is the one shape where the slide is not at the end of its note:
`f+2 $DD $00 $D6 a+^2` is a note of 192 ticks that arms at the head and goes on ringing for 96 ticks
behind the four bytes, because `^` emits a frame of its own and a tie keys nothing on. The bar is the
whole 192 ticks, the glyph is on it, and the preview arms where the song arms.

A remote code definition is not one of them. `(!1)[ … ]` has to be written above the first `#N`, which
puts it on the same channel the music below that marker starts on, but its body plays only where a
`(!1, …)` call fires it — so the first channel of a song with remote code is edited like any other,
and the definition is left exactly where it was written.

## Loops

**Select the notes you want repeated and press `Loop` in the command palette.** The brackets go
round the whole run from the first selected note to the last, everything in between included, and
the loop opens playing twice with its repeat count left selected — the **Loop inspector**'s
**Repeats** field is beside it, so the number is one keystroke away. Nothing between the brackets is rewritten: the
notes, the rests and every `v`, `y` and `@` among them stay exactly as they were.

The palette lives in the pane beside the roll, under **Add a command**, and it opens on whatever
note you last clicked — so a marquee, `Ctrl+A` and a press on a loop box's edge each put the caret on
the first note they select, and the palette follows. With nothing selected the two bracket buttons
are greyed, and the line under them says so.

A fresh loop is **named with the lowest number the song is not already using**, counting from 0, so
it can be recalled later with `(0)3` — and a `(!1)` remote definition counts as using `(0)`, since
AddmusicK files the two in one slot. Press `Loop` **inside a loop** and you get a subloop instead:
AddmusicK holds one `[ ]` and one `[[ ]]` at a time, in either order, and the readout says which of
the two the button is about to write. Both spent, and the button is greyed with the reason.

Two selections it will not wrap, each said in words: one with notes on both sides of a bracket, and
one that reaches across a channel. The intro `/` cannot go inside a loop either, and neither can
music written through a `"name=value"` replacement.

**`Loop call` plays a loop you have already written, again from here.** It names the nearest loop
written above the cursor, which is not a preference: AddmusicK reads a song in order, so a call can
only reach a loop it has already met. The button is greyed where there is nothing above to call, and
where the cursor is inside a `[ ]` body — a loop cannot be called from inside another loop, though
one inside a `[[ ]]` is fine. There is no `*` button: a `*` replays whichever loop was opened above
it, which is decided by where it is written and by nothing you can point at, so it is the one loop
shape the roll cannot draw a handle for. A `*` already in a song still plays, still draws and still
edits.

**The Loop inspector names the loop the cursor is in.** Put it on a loop's brackets, its repeat
count, its call, or anywhere inside its body, and that panel — in the pane beside the roll, under the
command inspector — says what the construct is and lets its **Repeats** be changed: one card per
loop, and two for a note inside a subloop inside a loop, innermost first. With the cursor in no loop
the panel is not there at all. A call's card also says **which** loop it plays, chosen from the ones declared above
it. A loop with no name of its own offers to take one, so that a call can reach it; a name already
written is never changed, since every call in the song is written against it.

A loop is one run of text the driver plays many times, and the roll draws it that way: **every pass
is on screen**, each as a box around the rows its notes span, washed in the channel's own colour.
The pass standing where the text is — the `[ ]` itself — wears a **dashed** edge and the solider
wash; every other pass, the repeats at the declaration and every `(n)` or `*` recall, wears a
**dotted** edge and a fainter one, the ghost of the group it repeats. The dashed box says "this is
the group an edit rewrites"; a dotted one says "this plays again here"; and a **solid** one says the
group is selected.

**An edit to any pass edits them all**, because there is only one text. Click the third pass of a
looped note and every pass rings, with the one you clicked solid and its siblings stepped back —
that is the roll saying "these change together, and this is the one you took hold of". Drag, stretch
or delete any of them and the body is rewritten once; the recompile is what plays it everywhere.

**The box's edge is the pass's handle.** Click the dashed or dotted line and the loop's whole group
of notes is selected — the body's own, and the notes of every loop written **inside** it, which is
exactly what the box is drawn round; a click that never moves just leaves it selected, ready for the
arrow keys and `Delete`. **Every box of that body closes its dashes up into one solid line** while it
is selected, the declaration and every recall of it together, on every channel that plays it, and a
loop written inside goes solid with it: the outline says "this is the group you have hold of" the way
the ring round a note does. The Loop inspector answers about **that box**: press the
dashed one and it names the `[ ]` itself, press a dotted one and it names the `(1)3` whose ghost you
pressed, with that call's own count and the loop it plays both live. The two are one text and the
caret lands in the same place either way, so the press is the only thing that can tell them apart.

Keep the button down and drag the **top or bottom rule** sideways and **that pass moves along the
song**: a gap of rests opens at the boundary in front of it, everything from there on slides right
together, and where the grab was mid-run the recall's count splits around the gap — `(1)5` grabbed
at its third pass becomes `(1)2 r1^1^1 (1)3`, and an unlabeled `[c4 d4]3` becomes `[c4 d4] r… *2`,
still one body played from both halves. That is how other notes get a place in between. Dragging
left closes free space instead: the drag stops at the rests actually in front of the pass, and never
moves a command off its tick.

**Dragging it all the way back joins the two halves up again.** Close the gap completely and the
pair becomes the one call it was: `(1)2 r1^1^1 (1)3` is `(1)5` again, `[c4 d4] r… *2` is
`[c4 d4]3`, and `* r… *3` is `*4`. The half that stays keeps its own spelling and takes the other's
repeats, so it does not matter which of the two ways the loop was written. The readout says the
count before you let go. Anything with a tick of its own written between the two — a `v200`, a
note, the intro `/` — keeps them apart: the space closes up to it and the two calls stay two,
because one call has nowhere to put what was standing in the middle of it. Two calls already
touching are left alone as well, there being no gap to close and so no drag to make.

**The boxes move with the music.** Whatever the drag is — a pass sliding, an end resizing, a body
transposing, or a note inside it being carried — the tint and the outline follow the notes while the
button is still down, so a box is always drawn round the bars it is a box for. A loop that plays
inside another grows to keep it in.

Drag that same rule **up or down** instead and **the whole body transposes**, one row per semitone,
every pass of it moving together because there is one text; the readout says the interval. Which of
the two the drag is settles the moment it starts moving and stays settled, so wandering off the
straight does not swap one edit for the other. A loop written **inside** that one goes with it — its
notes play only where this loop plays, so they are part of the same group and both boxes follow. A
loop merely **called** from inside it does not: its text plays in other places in the song too, and
moving it there is not what the box was asked for. Drums keep their lanes — a drum's row is its
instrument, not a pitch — and a transpose that would put a note off the writable range is refused
with the reason on the toolbar, the whole group with it. The notes _inside_ the body are still moved
one at a time by dragging their own bars, as above; the box is the construct's handle, and up or
down it carries the construct's contents as one.

**The box's ends resize the loop.** The **right** end changes the body's own length: pull it out and
a rest goes on the body's tail, pull it in and the body's trailing rests come off — `[a1 r1]5`
dragged in is `[a1]5`, still one loop — stopping at the first note, which is that note's own edge to
stretch. The **left** end moves where the loop _begins_ while the notes inside stand still: the loop
starts earlier and the same rest goes at the **head** of the body, so the first pass plays exactly
where it played and only the passes behind it slide. That is why growing leftward needs rests in
front of the loop to grow into, and says so where there are none — two loops written back to back
grow into each other only from the right, where what follows slides along instead of being written
over. It is the **first** pass of the loop's first occurrence that has that end: a later one's start
cannot move without splitting the recall, which is what the top and bottom rules already do. Two
passes of the same loop meet at every edge in between, and that seam belongs to the pass on the
left — a press there resizes from its far end rather than asking for a start that cannot move.

The end you take hold of follows the pointer, whichever pass it belongs to. A pass three deep begins
three changes later, so its far end travels four times as far as the body grows: drag it four beats
and the loop gains one. What the readout says is the **body's** new length, which is what every pass
of it takes.
That holds across channels too: a `(1)` loop written on `#0` and recalled on `#1` is one body both
voices play, and editing it from either channel changes both — the sibling washes on the other
channel are the warning and the promise at once. Editing one pass _differently_ from its siblings is
not something the roll will do: a loop is one text, and making pass two a variation means writing
the passes out by hand.

**Clicking a pass plays that pass.** Its box's edge sounds the whole of it — the song emulated up to
the tick the pass starts at and then simply let go, so every channel the mixer allows is heard and
every command that runs in between runs. Clicking a **note** of the pass sounds that note, under the
tick it is on: the two passes of `@0 (1)[c4 d4]2 @17 (1)2` sound under `@0` and `@17` respectively —
the note's byte is fixed when the text is compiled, and everything else about it is a fact about the
pass. A box drawn with `Ctrl` over any stretch of the roll plays that stretch the same way.

**A labelled loop shows its number.** While its group is selected, each of its boxes carries the
`(n)` the loop is written with, in the top-left corner. `(1)[a1]5` and its `(1)2` recall both show
`1`; a bare `[ ]`, a `*` and a `[[ ]]` name no body and show nothing. It is a fixed size, so it
neither grows with the zoom nor with the rows, and a box too small to hold it shows nothing rather
than something cut.

**Drawing inside any pass writes into the body.** The note lands in the text once, between the
brackets, and appears on every pass — the ghost's siblings show it landing everywhere before the
button is even released. A gap inside the body is a rest in the body, exactly as it is outside one.

**Changing the body's length moves the song.** Stretch a looped note and every pass grows; every
later pass, and everything written after the loop, slides by the change times the passes in front
of it. The preview shows the whole of that while the pointer is down — the untouched notes of the
body ride along as striped outlines, and the rest of the channel slides live — so nothing about the
commit is a surprise. The body's last note is the body's tail, and a body is a channel in
miniature: deleting it tightens the loop, where deleting a note in the middle leaves a rest.

What a loop will not do, each in its own words on the toolbar: a note cannot be dragged **onto** a
loop from outside — the loop's ticks are a wall, not a gap — and a selection with notes on both
sides of a bracket has no one text to rewrite, so it refuses. What a bracket cannot straddle is a
change of **tick**: deleting or transposing such a selection works, each side planned in its own
frame and committed as one step. A note at the head of a body that plays a drum
loaded _before_ the `[` refuses to move: rewriting it would hand the drum to the next note. A
command written between the brackets cannot be dragged along the command lane — it runs once per
pass, where it stands — where deleting it from the lane still works. And the edge drag has two
refusals of its own: a subloop grabbed past its first pass has no name to call it back by — `[[ ]]`
has no label and no `*`, and a single pass cannot even be spelled, `]]1` being the `$E6 $00` open
byte — and a loop that plays inside another loop has no song-time position of its own to move.

The **Normalize #N** button beside that message rewrites just that channel into a shape the roll can
splice — triplets given plain lengths, and every note given its own length so that no `l` decides
it — and leaves every other channel of the song exactly as it was; loops stay exactly as written,
being shapes the roll edits in place. The plain **Normalize** button does the whole song. Neither
changes what the song plays: the result is compiled and compared against the original first, and
refused if anything moved.
