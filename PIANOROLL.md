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
| Drag the middle of a note        | Moves it — snapped along the grid, one row per semitone up and down      |
| Drag a note's left or right edge | Stretches that end; the other end stays put                              |
| Hold `Alt` while dragging        | Tick precision: no snapping, for either a position or a length           |
| Click a note                     | Selects just that note, sounds it, and puts the caret on it in the MML   |
| Double-click a note              | Goes to it in the MML                                                    |
| `Ctrl` + click a note            | Adds it to, or takes it out of, the selection                            |
| `Ctrl` + drag on empty grid      | Draws a box and selects every note of this channel inside it             |
| `Ctrl` + drag a note             | Copies it instead of moving it                                           |
| Right-click a note               | Deletes it                                                               |
| Right-drag across notes          | Deletes each one the pointer crosses                                     |
| Wheel while drawing a note       | Sizes it — `l1`, `l2`, `l3`, `l4`, `l6`, `l8` … down to `l192`           |
| `Alt` + wheel while drawing      | Sizes it a tick at a time instead                                        |
| `Ctrl` + wheel                   | Zooms in and out about the pointer                                       |
| `Shift` + wheel                  | Scrolls the roll sideways                                                |
| Drag the overview bar            | Scrolls the roll through the song — grab the lit box and it follows you  |
| Drag the timeline below it       | Moves the playhead; hold past either end and the roll scrolls along      |
| Click a key on the left          | Sounds that pitch on the channel being edited, so you can find it by ear |
| `Ctrl` + click a channel chip    | Solos that channel, which also picks it to edit                          |

## Keyboard

| Key                         | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `Delete` / `Backspace`      | Deletes the selected notes                                      |
| `Escape`                    | Clears the selection, or the channel once nothing is selected   |
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

## Three settings that decide how a drag lands

**Grid** is the time signature the bar lines are drawn from: beats in a bar, over the note value that
gets the beat. `6`/`8` is six `l8`s to a bar. MML has no time signature of its own, so this is yours.
`0` beats draws no grid at all.

**Snap** is what a note lands on when you draw or drag it — `Bar`, `Beat`, `½ beat`, `¼ beat`,
`⅛ beat`, `⅟₁₆ beat`, or `Off`. `Bar` and `Beat` are read off the Grid, so the two stay in step
without being welded together: at 4/4 a beat is a whole quarter note, which is far too coarse to
draw sixteenths against.

**Stretching does not use Snap.** A length lands on the note values themselves — a whole, a half, a
quarter, an eighth, and their dotted forms — because a note in MML is a duration rather than a region
on a timeline. The bubble that follows the edge says which one you are on and how many ticks it is.

**The bubble reads the note as it will be written** — `c8.`, or `c=37` where the length has no name
of its own — so what it says during the drag is what lands in the MML at the end of it. Stretch
several notes at once and it drops the letter and says the length alone: they all take that length,
and only one of them is a `c`.

**A new note starts at the length of the last one you drew or stretched**, so a run of sixteenths
costs one sizing rather than one per note. To size the one you are placing, keep the button down and
turn the wheel: it steps through `1`, `2`, `3`, `4`, `6`, `8` and on down to `192`, and where you let
go is where the next note starts. There are no dotted stops on the wheel — those are a stretch away,
and putting them on the wheel would double the turns it takes to cross.

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

The **Normalize #N** button beside that message rewrites just that channel into a shape the roll can
splice — loops written out, triplets given plain lengths — and leaves every other channel of the song
exactly as it was. The plain **Normalize** button does the whole song. Neither changes what the song
plays: the result is compiled and compared against the original first, and refused if anything moved.
