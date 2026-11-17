# Decisions already made: `.claude/rules/piano-roll-architecture.md`

The ledger of `.claude/rules/piano-roll-architecture.md`: each entry is a design that was built or
considered there and moved away from, with the reason. The rule carries one index line per entry.

- **A percussion set the porter chooses** — the toolbar's Percussion toggle opened a strip of one
  chip per instrument the song played (`percussion-panel/`, fed by the walk's `usedInstruments`),
  and the chosen set, `@21`-`@29` plus `@10` by default (`DEFAULT_PERCUSSION`), was stored in
  `Settings.percussion` and read back by `parsePercussion`. It existed because nothing in the data
  says which sample is a drum, and asking the porter was the only answer never wrong. Only the
  drawing read it, though. The editing side knows a drum as `@21`-`@29` and nothing else:
  - `roll-strip.ts` names a note's drum from the `@` (`isPercussionInstrument`);
  - the press, the marquee and the cursor find a note on the row `rowOfPlaced` gives it;
  - drawing on a lane writes `@N c` with no octave;
  - a lane's key and a drag's audition play `$D0 + N − 21`.

  So any other instrument on a lane — `@10` by default, or a sampled kick the porter added — was
  drawn on its lane where no press could reach it, and grabbed on its written key's row where
  nothing was drawn. A note drawn on its lane sounded at whatever octave stood, since the letter has
  a say for every instrument outside the driver's table, and its preview played `$C5` or a byte
  that is no note at all. A `@21`-`@29` taken off the set failed the same way in reverse. The pitch
  of those other instruments is also heard, so a lane hid something the porter listens to. And the
  set was one per browser rather than one per song, so `@30` as a kick in one song made `@30` a
  drum in the next, where it was a bass. Drum lanes are now `@21`-`@29` (`isDrum`), the range the
  editing side already uses, and every other instrument is on the keyboard. Deriving the set from
  the sample instead was rejected before the set was built, and stays rejected: asking whether the
  driver's own drums play a sample says no once one drum sample is swapped for another.
