# Piano roll shortcuts

A reference for the piano roll editor while there is no proper readme page for it. The **channel**
is picked by the eight toggles in the corner above the keyboard, by a click on any note, or by
soloing a part in the mixer below. It does not have to be picked first: with none picked you can
still grab, stretch, copy or delete a note in any channel, and doing so picks that note's channel.
Drawing a new note, the marquee and the keyboard shortcuts do need one, since empty grid belongs to
no channel.

## Mouse

| Gesture                          | What it does                                                             |
| -------------------------------- | ------------------------------------------------------------------------ |
| Hover over empty grid            | A ghost bar shows where the next note goes and how long it will be       |
| Press on empty grid              | Draws a note there and keeps it under the pointer until you let go       |
| Click on empty grid              | Draws the note and leaves it there                                       |
| Drag the middle of a note        | Moves it a snap step at a time, one row per semitone up and down         |
| Drag a note's left or right edge | Stretches that end; the other end stays put                              |
| Hold `Alt` during any gesture    | Tick precision: no snapping, for either a position or a length           |
| Click a note                     | Selects just that note, sounds it, and puts the caret on it in the MML   |
| Double-click a note              | Goes to it in the MML                                                    |
| `Ctrl` + click a note            | Adds it to, or takes it out of, the selection                            |
| `Ctrl` + drag on empty grid      | Draws a box and selects every note of this channel inside it             |
| `Ctrl` + drag a note             | Copies it instead of moving it — the whole selection, if there is one    |
| `Shift` + drag on empty grid     | Draws a note where you pressed and pulls its right edge along            |
| `Shift` + drag a note            | Moves it along the song only; it cannot leave the row it started on      |
| Right-click a note               | Deletes it                                                               |
| Right-drag across notes          | Deletes each one the pointer crosses                                     |
| Middle-click                     | Nothing yet                                                              |
| Middle-drag                      | Pans the roll, both ways at once                                         |
| Wheel while drawing a note       | Sizes it — `l1`, `l2`, `l3`, `l4`, `l6`, `l8` … down to `l192`           |
| Wheel while holding a note still | Resizes that note the same way, from its right edge                      |
| `Alt` + wheel while sizing       | Sizes it a tick at a time instead                                        |
| `Ctrl` + wheel                   | Zooms in and out about the pointer                                       |
| `Shift` + wheel                  | Scrolls the roll sideways                                                |
| `Alt` + wheel                    | Makes the rows taller and shorter, about the pointer                     |
| Drag the overview bar            | Scrolls the roll through the song — grab the lit box and it follows you  |
| Drag the timeline below it       | Moves the playhead; hold past either end and the roll scrolls along      |
| Click a key on the left          | Sounds that pitch on the channel being edited, so you can find it by ear |
| `Ctrl` + click a channel chip    | Solos that channel, which also picks it to edit                          |

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
under.

## The command lane

Under the roll is a strip holding nothing but command icons, on the song's own timeline: what takes
effect, and where, with the note data out of the way. **Commands** on the toolbar opens and closes
it, and it stays as you left it.

It holds **what the bars cannot show**, so nothing appears twice. That is two things:

- **The song's own settings** — `t`, `w`, `$E4` and the whole echo unit, `$EF` to `$F2` and the `$F5`
  filter. These reach every channel at once, so they act on the song rather than on any note of it,
  and no bar has ever drawn them.
- **The commands that switch something off** — `$DF`, `$F0`, `$FD`, `$FE`. A bar names what a note is
  playing _under_, and there is nothing to name once vibrato is off, so these appear on no bar at any
  point in the song.

Everything else stays on the bars: a `v`, a `q`, a `@`, an `$ED` and the rest of the channel state is
already on the note that sets it, with a solid chip to say so.

The icons are all eight channels at once, each in its channel's colour — which for a song-wide
command is the channel that wrote it — and a muted channel fades rather than disappears.

The lane scrolls sideways with the roll and carries the same grid and the same playhead, so an icon
sits under the note it acts on and on the beat it lands on. Where several land on one tick they stack
upwards; three icons deep is as much as fits, and a plain wheel over the lane lifts the stack when
there is more. A tick crowded past what the lane will draw at all ends in three dots; hover them for
how many are behind. Click an icon to ask the inspector about that command, or double-click it to go
to it in the MML — the same as clicking one on a bar, except that it leaves the channel you are
editing alone.

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
  refused; overwriting its tail is not, and the command stays exactly where it is.
- **A gap is a rest.** The space between two notes is the rest between them, and moving a note
  rewrites that rest rather than moving anything else. Anything you wrote inside the gap keeps its
  distance from the note that follows it.
- **A refusal says so.** Where a gesture cannot be written, the roll turns the bars red while you
  are still holding it, and the toolbar says why in words — "there is something written where that
  note would go", and so on. A reason arrived at only when you let go stays on the toolbar until the
  next edit lands, since the gesture it belongs to is over by then.
- **A drum's row is its instrument.** Dragging a drum up or down moves it between drum lanes by
  rewriting its `@21`–`@29`. Dragging one onto the keyboard, or a pitched note onto a drum lane, is
  refused: that is a change to what every note after it plays on, not a move.
- **Drawing on an empty channel writes the channel.** Pick a channel the song has never used and draw
  on it, and the roll writes a `#N` block for it at the end of the MML, with the settings a fresh
  channel runs under — `o4 l8 q7F @0 v255 y10` — before the note. All of it is one undo step. The
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

## When a channel cannot be edited

**A channel you cannot hear cannot be edited.** Mute it, or solo another part, and its notes go dim,
stop answering the pointer, drop whatever was selected on them, and the toolbar says which of the two
it is. Unmute it, or lift the solo, and it takes edits again — though the selection does not come
back, having been dropped rather than hidden.

Some MML has no one-to-one relationship between what is written and what is played, and the roll says
so in the toolbar rather than guessing. A `[ ]` loop, a `*` or `(n)` call, a `{ }` triplet, a
`"name=value"` replacement, a `$DD` pitch slide or a `#halvetempo` all mean one written note is not
one played note.

A remote code definition is not one of them. `(!1)[ … ]` has to be written above the first `#N`, which
puts it on the same channel the music below that marker starts on, but its body plays only where a
`(!1, …)` call fires it — so the first channel of a song with remote code is edited like any other,
and the definition is left exactly where it was written.

The **Normalize #N** button beside that message rewrites just that channel into a shape the roll can
splice — loops written out, triplets given plain lengths — and leaves every other channel of the song
exactly as it was. The plain **Normalize** button does the whole song. Neither changes what the song
plays: the result is compiled and compared against the original first, and refused if anything moved.
