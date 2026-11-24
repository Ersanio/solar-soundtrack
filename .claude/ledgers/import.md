# Decisions already made: `.claude/rules/import.md`

The ledger of `.claude/rules/import.md`: each entry is a design that was built or considered there
and moved away from, with the reason. The rule carries one index line per entry.

- **A channel's settings written at its first note only** — the writer once wrote `@`, `v`, `y`,
  `$DE` and `q` in front of the note that needed them and nowhere else. A channel that opens on a
  rest then starts the song under nothing and its repeat under whatever its last note set, which is
  `SST0511` on nearly every imported song, and a vibrato left on at the end ran into the repeat.
  `ChannelText.settings` states the next note's settings in front of the first rest and right after
  `/`, and a channel that ever turns vibrato on states it at the start, so the repeat opens on what
  the first pass opened on.
- **A kit opening on `@21`-`@29` before a rest** — the drum instruments emit no byte (the drum note
  `$D0`-`$D8` selects the sound), so writing the first hit's `@2x` ahead of a rest stated nothing and
  the repeat still inherited the last hit's drum (`SST0511`). A kit states `@0` there, which emits
  `$DA $00`; every hit still writes its own `@2x`.
- **Note lengths from `@amk/core`'s `spellLength`** — it spells any count it can as `N.` or `N..`,
  and halves with a floor as `getNoteLengthModifier` does, so `32..` is a valid 10 ticks; but
  AddmusicK warns AMK0200 for a dot that halves an odd count, and the stress songs raised it at
  every fine grid. `spellTicks` takes a dot only where it halves exactly and writes `=ticks`
  otherwise; `spellRestTicks` ties rests from lengths that all halve exactly.
- **Drum hits struck together sharing a voice** — the overlap allowance a legato line needs was
  applied to a kit too, where a hit occupies its voice for that same allowance, so the two cancelled
  and a kick and snare struck together landed on one voice, the second dropped as a note already
  there. A kit's allowance is 0.
- **Each note of a chord to the free voice nearest its pitch** — taken one note at a time, highest
  first, so the top note took the best voice and the rest took what was left: two ten-note chords in
  turn left one part leaping from o5 e to o2 a while its neighbours held still. A chord is matched to
  the free voices as a whole without crossing (`match`), and opening a voice costs more than any
  move, since a texture of ten split into eleven parts spends a channel on nothing.
- **The parts that sound the most suggested by weight alone** — sustained pad voices outweighed a
  kit's short hits, so a song's drums were left out of its first preview. Every channel's and every
  kit family's first voice comes before any second voice; weight orders within that.
