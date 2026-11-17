---
paths:
  - 'scripts/charttest/**'
---

# `charttest`: what it proves

Stacked-bar geometry for the ARAM bar, the shared plot space, `clamp`, and the piano roll's lanes
and window arithmetic. Five roll claims live here, none of them visible in a
screenshot: that the playhead's clock absorbs a steady lag instead of re-correcting it on every
anchor, which is the difference between a smooth scroll and one that jerks ten times a second; that
"all octaves" widens the pitch range without conjuring a drum lane the song never plays; that
sweeping a playhead rebuilds the mark window about twice per whole note rather than once per frame,
which is what keeps a scroll off the DOM; that a drum lane is `@21`-`@29` and nothing else, `@10`
and a sampled kick taking their written pitch on the keyboard, and that a bar is drawn on the row a
press finds it on — the marks place a note by its walk instrument and the gestures by the drum `@`
it carries, so a lane those two disagree about is drawn where nothing can grab it and looks entirely
ordinary; that a pitched note draws on the pitch it was **written** at rather than the byte `h` or
the instrument's transposition made of it, with the keyboard growing to take in a written `o0` or
`o7` the driver's o1 c–o6 a has no row for; and that a `$D9`, which only a malformed blob plays,
has no row at all rather than a key that widens the keyboard down to o1 c. It also
pins what a bar can hold: that the compact `C6` a bar is labelled with and the `o6 c` down the key
column can never name different keys, that a row too short holds nothing rather than half a letter,
and that as a bar narrows its glyphs only ever drop — never grow, which is what happens when the
glyphs are allowed the room the name gave up, so a bar loses its note and gains an icon. It also
holds the transport's clock (`state/song-clock.ts`): that a song with no `t` is still clocked at the
driver's t53 rather than treated as tempo-less; that a fade is priced tick by tick and comes to **exactly**
what its inspector label says, so one song can never have two lengths; that a fade cut short keeps
the delta its _written_ duration gave it, since re-deriving one from the ticks that survive is a
different fade and reads entirely reasonable; that `t255` stalls rather than dividing by zero; and
that the segment table joins up at every boundary, without which the readout jumps at each one while
still looking monotone and plausible either side of it. It pins the **scrub bar's** time axis, which
a drag rides on: that the whole song fills the bar at any pane width and any song length, and that
the tick a scrub commits to is exactly the tick under the pointer — one that landed merely near it
would drop the song a note away from where it was dropped every time, with nothing on screen to say
so — and that a song of no ticks answers 0 rather than an `x` of `NaN` on every bar of the minimap,
which renders blank and says nothing. It pins that bar's **minimap** too, where every claim is a
note that is not drawn: that two channels through one pixel of a row are two bars and one channel's
two are one, since the colour is which channel a bar is and a dedupe blind to it drops the narrower
note out of the picture altogether — two channels on a drum lane is the ordinary way that happens;
that the wider survives whichever order the pair arrives in; that a silenced channel is dimmed at
the roll's own value rather than dropped, and comes back before every audible bar so a live one is
never veiled; and that every bar's id is its own, which is what `track` needs and what a channel
kept out of the key would break. It carries the roll's **pages**, the second of its two ways of
following the song: that a turn leaves the music just played still on screen rather than dropping
the playhead against the key column, that the opening page starts _before_ the first tick so a song
is drawn with the same lead-in every later page opens on — without which the margin appears out of
nowhere at the first turn and a scroll back to the beginning shows a space that then vanishes, that
re-anchoring the page grid on a parked view reproduces that view's camera exactly — without which a
scroll is undone by the page boundary the instant the wheel goes quiet, the notes snapping back by
precisely as far as the wheel had moved them, that the playhead can never be drawn off the pane it
is in, that a page never turns backwards as the song runs forwards, and — the one with no visual
tell — that every page a sweep can produce lies inside the window the marks are built for, since a
roll whose marks are built for the wrong span scrolls perfectly smoothly over blank music. And the
roll playhead's **velocity**: extrapolating between anchors at the tempo byte rather than at the
clock's measured slope leaves it more than a quarter note ahead of the notes it is drawn over,
scrolling perfectly smoothly the whole way — the failure with no visual tell at all. And the **command
lane's** packing, where the failure is a command drawn under another and so not drawn at all:
commands landing on one tick stack rather than overlap, two far apart share the top row, and two
close enough for their boxes to touch stack at a low zoom and flatten back to one row at a high one
— checked at every zoom the roll offers, with `x` never nudged aside to make room, since a glyph
moved for its neighbours would be pointing at a tick the command is not on. It pins the **anchoring**
that `x` is: a glyph's centre sits on its tick, so a command on a beat straddles that beat's rule,
and the two ends are held inside the song — the first flush left rather than half behind the key
column, the last flush right rather than hanging past the end-of-song rule, and a song narrower than
one glyph pinned at zero rather than clamped against a negative bound. It pins what a **mute** does,
which turns on how far the command reaches rather than on the channel it is written on: a silenced
channel's own `v` is not drawn at all, so a live channel's command moves up into the row it would
have taken, while a `t` written on that same channel stays and is dimmed at the roll's own value,
still running the whole song. It pins the **edited channel's band** — its glyphs take the top rows
and every other channel's fall strictly below them, so a gap the edited channel leaves in row 0 is
not offered to another channel there and the lane is one row deeper for it, which is the cost the
band is worth. It pins the **lane's height**, which comes off a drag rather than a table and so is
held between its two ends rather than checked against a list: shorter than five rows and taller than
ten are both refused, both ends are whole rows — a pixel figure drifted off a row boundary leaves a
band too short to draw a glyph in — a height between them is kept, and a drag's fractional pixel is
rounded off — the height becomes the `viewBox` the glyphs are laid out against, so a fractional user
unit puts every row's rule on a half pixel. And that a column of forty keeps all forty, one row
lower than the last and `depth` saying so — there is no cap, since a tick whose commands are the
reason the lane was opened must not be the one tick it declines to show — and that slicing the pack
to a window moves no glyph's row and leaves the whole song's depth alone — a scroll range that
shrank as the roll passed a deep column would take the porter's position with it. And the lane's **erase**,
which is one flag and a hover: a command written through a `"name=value"` has its span collapsed
onto the call site, so it is not removable and its hover does not offer it, where one written out in
full is both — the hover being the only thing on screen that says a glyph can be deleted at all. The
lane's **drag** is pinned in the same two fields and two more: that same macro-expanded command
offers no `grab` cursor and no `drag to move` in its hover, where one written out in full offers
both, and a glyph carries the tick and the channel a drag works from rather than leaving them to be
parsed back out of the hover, which is prose for a person. Last, the **loop regions** drawn behind
the bars (`buildLoopRegions`), whose one hard claim is invisible in a screenshot: which pass is the
_declared_ one — the dashed box on a pass whose text is somewhere else invites editing "the loop"
where nothing is written. A `(n)m` or `*` recall is told from the declaration by command-map
membership, since a `]n`'s own `$E9` is the one dispatch `recordCommand` drops; a subloop consults
enclosure instead, both its `$E6` arms being always mapped, so a top-level sub's first pass is
declared while one reopened by an outer loop's second pass is a recall through and through. The rest
is geometry with the same no-tell property: the wash is the channel's own colour, solider on the
declared pass and fainter on every recall, and the box — wash included — spans the rows the pass's
own notes span and no other channel's, never the stack's height, which is what keeps two channels'
loops from brightening each other where they cross; a pass with no notes is not drawn at all, a
silenced channel's regions dim with its bars at the roll's one `MUTED_OPACITY`, a pass outside the
mark window is not drawn, and one past the pass cut never plays — the cut clips a straddling pass to
itself, and the pass's **drawn** length rides on the region because that is what a press measures
its ends against, a handle answering "resize" where no edge is on screen being a handle for
something invisible. The **label** a selected loop's boxes carry (`buildLoopLabels`) has the same
property: a label drawn for a body nothing selected, or for a `*` that names no body, reads as the
roll claiming a loop is called something it is not. So it is asked per construct — `(1)[a1]5` and
its `(1)2` both name the body where a `*2` recalling the very same body names nothing — only the
channel being edited has a selection to show one for, a box too narrow or too short shows nothing
rather than something cut, and the plate is the same size at every zoom and every row height,
sitting in the box's top-left corner.

## Section files

`scripts/charttest/main.ts` runs one section file per subject, in the order below, and `support.ts`
holds what they share: `EPSILON` alone. `HARNESS_ONLY=<file name>` runs one section alone.

| File                       | What it pins                                                                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stack-plot-clamp.ts`      | The stacked bar's geometry, the plot space, and `clamp`.                                                                                                       |
| `lanes.ts`                 | The piano roll's lanes.                                                                                                                                        |
| `window-and-grid.ts`       | The roll's mark window and grid, and the ladder the wheel walks while a note is being drawn.                                                                   |
| `pages.ts`                 | The roll's pages.                                                                                                                                              |
| `playhead-and-overview.ts` | The roll's playhead marking the song rather than the camera, and the overview bar's time axis and minimap.                                                     |
| `loop-regions.ts`          | The loop regions behind the bars.                                                                                                                              |
| `loop-labels.ts`           | The label on a selected loop.                                                                                                                                  |
| `loop-follow.ts`           | The loop boxes following a gesture.                                                                                                                            |
| `playhead-clock.ts`        | The pull at the end of the scrub bar, and the playhead's own clock.                                                                                            |
| `percussion.ts`            | The drum lanes, which are the driver's own `@21`-`@29` and nothing else.                                                                                       |
| `transport-clock.ts`       | The transport's tick-to-seconds clock over songs the compiler will not time, and the roll's playhead following the music rather than the written tempo.        |
| `bar-text.ts`              | What fits inside one bar.                                                                                                                                      |
| `command-lane.ts`          | How the command lane stacks what lands together.                                                                                                               |
| `slider-track.ts`          | The slider's track.                                                                                                                                            |
| `transport-view.ts`        | The transport's mixer and playhead, the playhead dropping what a mid-update read of ARAM invents, and the seconds estimate for a song the walk could not read. |
| `record-pointer.ts`        | The pointer a MIDI recording is timed against: the clock's rate where it stands, the song's last rate past the end, and never backwards.                       |
