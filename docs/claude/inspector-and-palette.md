# Inspector and palette

Read before changing the command inspector, a note's Length row, the instrument picker, the
command palette, the `$DD` and `q` readouts, the bend graph or the FIR designer.

## Decisions already made

- **Auto-scaling the bend graph to the further end of the bend** — one semitone and two octaves drew
  the same shape. The reach is a fixed octave, stepped by whole octaves.
- **A tone slider in the FIR designer** over `designTone` — a worse route to the presets it
  generates; `Warm`/`Dark`/`Bright` are its output.
- **Clearing the inspector by moving the caret off what it was answering about** — `commandAt` is
  inclusive at **both** ends (`tokens.ts`), so in `c8 d8` the offset that ends `c8` is the offset
  that begins `d8` and there is no position between them belonging to neither. There is nowhere
  neutral to put the caret, and the roll faking one would be contradicted by the next click in the
  text. `EditorRequests.dismissed` holds the caret the question was withdrawn at instead, so the
  silence is one caret's worth and any move at all ends it — not a mode, which would have to be
  turned off by something and would outlive the gesture that set it.
- **The instrument picker normalising every pick to a plain `@n`** — the whole set is then always
  available and one splice serves all three spellings, and it rewrites text the author chose: a
  click on a dropdown turned `$DA $02` into `@2` and `@@5` into `@5`. Only the argument moves, in
  that spelling's own numbering (`instrumentByte`), and an instrument the spelling cannot express is
  not listed — so `@@` and `$DA` offer no drum, neither being able to write one, and `#am4`'s `$DA`
  writes a custom instrument from `$13`. The map and its inverse live in one file so `edittest` can
  round-trip them: a list built on one reading of the bands and a write built on another offers one
  instrument and selects a different one, and nothing about the numbers on either side can see it.
  Not labelled by the sample each instrument resolves to, either — the names are SRCN-indexed and
  a song's own `#samples` moves them, where the number is what the source says. `@19` and `@20` are
  not offered at all, emitting nothing; a caret already on one still shows it, through
  `amk-enum-select`'s unknown-value option, which is what keeps the control from claiming the
  document says something it does not.
- **A note's Length row as a `ParamDescriptor` over `command.args`** — a descriptor is bound to one
  argument of one command, and a note's length is not always in an argument: `c` under a standing
  `l8` writes no digits at all, so `resolveCommand` built no rows and the inspector said "this
  command takes no arguments" about a note plainly 24 ticks long — which is the commonest way a song
  is written, one `l` at the head of each channel and bare notes under it. `c^8` writes one number
  for two segments, so row 0 was labelled `Length`, bound to the tie's `8` and described from the
  head's implied length; and `c0` writes one `getNoteLength` throws away. The subject is the
  **segment**, which `NoteLengthSegment` already is, and `note-length/length-rows.ts` is where the
  eleven spellings are told apart and each one's splice chosen — `insertAt` where no digits were
  written, `spliceRange` over the digits alone where they were. The digits and nothing else, because
  a segment's dots compose rather than add (`Music.cpp:2950`): the number that keeps `l8 c.` at 36
  ticks is `8`, and a span reaching over the dot would write the 4 that 36 ticks is without one.
  `denominatorFor` is what makes that safe in the other direction — it answers only an `n` that,
  written, reproduces the length the segment already plays, and `null` where none does, which is a
  dotted or exact `l` and an `=NN` on the note. Not a per-row write target on `ParamRow` either: the
  generic table is one loop over `command.args` and a note-shaped exception in it would be paid for
  by all sixty commands.
- **Taking the digits back out when a slider lands on the `l`'s own value** — it reads as tidy and
  it is a trapdoor: the note would go back to answering an `l` edited later, so a length the porter
  had chosen by ear would move on its own the next time the default did. Digits are written and
  never removed; `c8` under an `l8` is a note that has been given a length of its own.
- **A `Write byte` button, and then deleting the row to take it away** — two shapes, both wrong,
  and the second is the one worth naming. `$F7`'s body is commented out (`Commands.asm:633`) and
  its dispatch slot is `$0000`, so the button offered a command with no working form: every use of
  it was a dead SPC, and `SST0506` reporting that afterwards does not make offering it reasonable.
  But the catalogue is two tables in one — `glyphOf` reads the same rows _backwards_ to name and
  draw a command already in a song, and `palettetest` counts them to prove every VCMD `$DA`-`$FE`
  is covered — so deleting the row would have blanked a hand-written `$F7` in the command lane and
  on a roll bar, orphaned the `chipWrite` glyph, and turned a coverage proof into a hole. The row
  stays and carries `withheld: true`; `OFFERED` is what the two strips read and `ENTRIES` is what
  every reverse lookup reads. It carries no `caveat` either, nothing being able to hover a button
  that is not drawn, and `palettetest` holds a withheld byte to raising a diagnostic — so a byte
  cannot quietly leave the palette with nothing put in its place.
- **Yellow on a palette button, for a `caution` availability and for a `caveat`** — it painted an
  alarm the button could not stand behind, and it was wrong in both directions at once. A `caution`
  is a warning AddmusicK itself prints the moment the text exists — `palettetest` pins that there is
  one — so the colour was a dimmer second copy of a finding already in Problems; and the three
  caveats were the palette carrying a driver fact nothing checked, which is the arrangement
  `packages/mml-tokens/README.md` itself called a rule that drifts. The colour was also the _only_
  channel either way, so a `$F7` typed by hand, pasted, or clicked once and forgotten was never
  mentioned at all. Only `blocked` keeps a treatment, which is grey and is the disabled button; the
  three facts are `SST0506`-`SST0508` (`command-hazards.ts`), raised on the byte as written. The
  `caveat` field stays as the readout's prose, since it can speak before there is any text to raise
  a diagnostic against and it is the only home for `$E4`'s dialect-conditional note, and
  `palettetest` holds the two to each other in both directions. The readout line keeps the amber for
  a **dead** button's reason alone (`muted`), which is one rule with one meaning and a fact the
  greyed face already shows — the same standing `roll-toolbar.html`'s `cannot edit:` has.
- **Answering “is this `$DD` armed” with a tick count and a `null`** — it could not say that a `v`
  stood between the note and the command, so the inspector priced a slide that never arms at “95
  ticks to run in” while the song jumped to `$0000`; and it summed a tied note's segments where the
  driver reloads its counter per frame (`main.asm:2440-2441`) and `accumulateTiedLength` rewinds the
  tie out of a `$DD`'s way (`parser.ts:2895-2909`), so `c4^8 $DD` read 72 where the read-ahead gets 24. `bendAnchor` answers with the three ways it fails and the one way it works, which is
  `COMMANDS.html`'s own enumeration, and one pass serves the panel and the diagnostic so the two
  cannot disagree. A rest is an anchor like any note, `$C7` being a note byte to the driver — the
  reading that excluded it would have called a song that plays fine a dead SPC. And “nothing before
  it” is asked ahead of “something in the way”, since nothing can stand _between_ the command and a
  note that is not there: that is what the head of a `(!n)[ … ]` body answers.
- **A slide's room read off the note in front of it alone** — that note's last segment less one, so
  a tie written after the `$DD`, which keys nothing on and is how a porter gives a slide more room,
  counted for nothing, and `c1 $DD` read 191 where the driver gives 95. The slide steps only on ticks
  that fetch nothing (`main.asm:2337-2339`) until a key-on overwrites it (`main.asm:465-466`), so its
  room is every frame from the one it arms in to that key-on, one tick fewer each — and a frame is
  `emitNote`'s, a note of `$80` ticks or more going out in `$60`-tick pieces, which is also what
  makes `c=193 $DD` arm nothing. `BendAnchor.window` is that sum, read off `TokenIndex.ties` since a
  `^` no note opened is no `Command`. Not the note's length plus its ties either, which is a tick
  over per frame: `a96 $DD $00 $FF $80^1^4^16^192` reads 255 that way and the driver gives it 251. A
  rest ends the count although the slide runs on under it, the voice being keyed off.
- **`q`'s high nybble read as a percentage of the note**, and a note's gate as
  `frame × NoteDurations >> 8` alone — the inspector called `q7x` "100% of the note" and the roll
  drew a `q7F` quarter 47 ticks long, and both were wrong the same way. The read-ahead keys off at
  that counter or at `!WaitTime` ticks before the frame ends, whichever is first
  (`main.asm:3212-3243`), `!WaitTime` being 2 until a `$F4 $02` flips it; and only the last of a long
  note's `$60`-tick pieces is cut, the read-ahead never keying off in front of a tie
  (`main.asm:2983-2984`). So no one percentage describes a `q` — `q0x` is 19% of a quarter and 60%
  of a whole note — and the note inspector says what the selected note comes to instead. `noteFrames`,
  `frameSoundingTicks` and `noteSoundingTicks` in `@amk/core` are the one statement of it, read by
  the walk and the inspector both, and `walktest` times every note's key-on and key-off on the
  running driver through `!PlayingVoices`.
- **The `$DD` bend graph drawn against `o4 c` as a stand-in** — `$DD $00 $18 $B0` after an `o4 e`
  read "+12 semitones" for a slide of eight, and a caption owning up to it did not stop the picture
  saying the wrong interval. It is drawn from `NoteAddress.note` of the note `bendAnchor` names
  (`slide-start.ts`): the emitted byte, which is what the driver compares the target against. Not
  from `WalkNote.bend` — the walk names a slide only where it arms inside the pass, and the note map
  names every note compiled. The compile counts while it agrees with the document up to the end of
  that note, since nothing after a note changes its byte, so a commit to the slide's own operands
  does not blank the graph for the recompile it causes. And no stand-in where there is no byte — a
  rest, a drum, no compile — because a curve from a made-up note is the guess that looks exact.
