# Piano roll: octaves

Read before changing `roll-octave.ts`, or anything that writes or removes an `o`, `<` or `>`.

## Decisions already made

- **A trailing octave run winning over a leading one** — in `c4 o5 d4` the `o5` is adjacent to both
  notes, and two edit units claiming it produce overlapping splices that CodeMirror merges rather
  than refuses. Leading wins (`growUnits`), which is also what makes the restore stable: a repitch
  writes `o3 c4 o4 d4`, and on the next pass that `o4` is `d4`'s own leading octave.
- **Refusing `<` and `>` in an edited channel** — they are not commands to the scanner at all, and
  they are harmless: a note's octave comes from its own `written` byte rather than from a running
  sum, so `o4 c4 > d4` repitches either note without disturbing the other. `rolltest` pins it. That
  is a statement about the **row**, and what `planEdits` carries between the notes is the next
  entry, **Putting a drawn note's octave back at the end of its run**.
- **Putting a drawn note's octave back at the end of its run**, in the mould of the rewrite path — a
  rewrite restores the octave standing after the note it rewrote, which that note's own byte gives
  it exactly; a run written into a gap has no such anchor, and `<` and `>` are not commands to the
  scanner, so nothing can say which side of the run one written in the gap sits on. The octave goes
  at the **head of the note that reads it** (`spawnInto`) where nothing between the run and that head
  moves the octave — where the text settles, an `o` there being that note's leading octave on the
  next pass — and **straight after the run**, as the original had it there, where a `<` or `>` stands
  between, so that shift still does its job. Only a channel with no note left to hand it to has the
  run carry it, for the leak past a `#N`, and only where something after the channel reads it.
- **Answering a deleted note's octave with `running = null`**, and leaving the note after it to
  notice — a note whose pitch and length are unchanged returns from `rewriteNote` before an octave
  is spelled at all, and the seed above it re-reads `item.octave` off the text the deletion had just
  taken away, so `o2 a8 d8` losing `a8` moved `d8` an octave up. A deleted note's own `o`s **stay in
  the text where something still reads them** (`keptOctaves`), so the notes after it keep the octave
  they were written under with nothing put back — `o2 a8 d8` becomes `o2 r8 d8` — and one only that
  note read goes with it. Not handed to the next note's head through a rewrite of its unit either:
  `noteText` re-spells what it writes, so an untouched `d-8` would come back `c+8`.
- **Two passes each answering a note's octave for itself** — `planEdits`'s item loop gives the next
  surviving note an `o` at its head when the unit above it went and took the channel's own octave
  with it; `spawnInto` gives the note bounding its region one at that same head, for the run it
  wrote in front of it. Both build the same insert at the same offset, `coalesce` concatenates
  rather than dedupes, and a note carried past another came out `o4 o4 d8`. The regions are built
  before the item loop, so the loop can ask whether a run is about to answer for that note
  (`runBefore`) and stand down — the pass that can see what the run leaves is the one that speaks.
  Not a dedupe of identical edits at one offset: two writers agreeing by accident is not the same as
  one of them knowing it has nothing to say.
- **Asking whether the note after a spawn can be left as it is by what stood _before_ the gap** —
  `untouched` compared the previous note's exit octave against the reader's and against the run's,
  so a region at the head of a channel, which has no note before it to compare with, always wrote an
  `o` saying what the run had just said. What that note reads is what the **run** leaves: its last
  pitched note's octave, or the one it entered under where it holds only drums — carried over the
  text between the run and the reader's head by the octave model, and compared with the octave the
  reader was written under.
- **Reading a note's entering octave off `item.octave` alone** — that number is the octave in force
  **after** the unit's own leading `o`, and `growUnits` puts that `o` inside the `unitSpan`
  `rewriteNote` splices whole; so in `> c+32 r64 < o3 c32` the guard compared the previous note's
  exit against the octave the doomed `o3` had just set, agreed with itself at 3, and let the note be
  rewritten with no octave at all — the `<` then took it to o2, and only the byte oracle could see
  it. What enters a unit is read off the text in front of it by the octave model (`roll-octave.ts`),
  and a unit whose note keeps its octave **restates** the `o` the porter wrote there, a channel's
  opening `o4` not being redundancy to tidy. The mirror of it is on the far side of the unit —
  `exitOctaveFor` answers `null` where what follows sets its own, which says the trailing `o` may go
  with the rewrite, and there **is** no rewrite for a note whose pitch and length are both unchanged
  (`rewriteNote` returns before spelling anything, and `spliceRange` answers `null` for text already
  there). Reading the note's own octave there made a drag's destination look like the octave already
  standing, so nothing was spelled and the gesture committed nothing at all. An untouched unit
  leaves what its text says.
- **Guessing the octave in force from the notes either side** — `running = null` wherever a unit
  carried an `o`, a `MOVES_OCTAVE` character scan over the gap, `item.octave` for a construct (always
  `null`) and the last born note's octave for a run ending on a drum. Each was conservative one way
  and wrong the other: a note drawn in front of a `[` handed the loop the run's octave, a pitched note
  drawn among drums leaked its own, a `<` written inside a tie went uncounted, and every unknown
  wrote an `o` saying what was already true. `octaveModel` reads the whole document in source order —
  an `o` sets, `<` and `>` shift, a note reads — and `checkedOctaves` holds it to the compiler's own
  octave for every note of the channel, falling back to `BLIND_OCTAVES` (all unknown, the old
  conservative answers) on any disagreement, a `"name=value"` or an `#if`. It agreed on all 260,244
  notes of the fuzz corpus.
- **Putting an octave back after every rewrite at the end of a channel**, `octave` leaking past a
  `#N` — before a block that sets its own first, or at the end of the song, nothing reads it, and the
  result was `o4 o3` stacks and a round trip that grew an `o4` each way. A restore is written only
  where the next thing the text does with the octave is read it (`octaveNext`, `OctaveModel.next`).
- **Leaving a porter's octave an edit made unread** — `o4 l8 e1` dragged down an octave came out
  `o4 l8 o3 e1`, the `o4` standing in front of an `o` that undoes it. `deadOctaves` takes out an `o`,
  `<` or `>` of the edited channel's that something read before the edit and nothing reads after it,
  or that nothing read already and now stands straight in front of an octave the edit wrote; one the
  edit merely restated is left. Taking out an octave nothing reads changes no note. A note moved to
  the octave standing before the `<` or `>` only it read has those taken out instead of an `o`
  written after them, so `o4 c4 > d4` dropped an octave is `o4 c4 d4`.
- **Letting a drum's unit carry an octave `noteText` cannot write back** — `leadsAUnit` takes an `o`
  as well as a percussion `@`, so the unit reaches over the `@` to the octave beside it, and a drum
  is written `@21 c<length>`, the letter having no say in the byte. The splice took the `o` away and
  every note after the drum moved with it, silently. `drumOctaves` **restates** what the unit
  carried, rather than respelling it: the octave is what those notes are standing in and a lane
  change says nothing about it. Not a narrowing of `leadsAUnit` instead — the `o` can be written on
  either side of the `@`, so the leading scan would have to know it was on a drum before it found
  the `@`, and `unitSpan`'s boundaries are where every insertion in `roll-write.ts` is anchored.
