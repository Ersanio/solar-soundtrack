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

- **A row chosen by the instrument in force, not by the byte** — `placeOf` put a note on a drum lane
  whenever `@21`-`@29` was the instrument in force, on the argument that everything played while a
  drum is loaded is that drum being hit, so `@29 c d e` was three marks on one lane. But only the
  first of them is a drum byte on `#0`-`#5` (`parser.ts:2753` clears the instrument after the
  remap); the others are pitched bytes that play the drum's sample at the pitch written, which is
  not the pitch the table gives the drum. The editing side reads the byte — `roll-strip.ts` names a
  drum only from the `@` that fed one, and `rowOfItem` finds the rest on their keys — so those bars
  were drawn on a lane where no drag, erase or box selection reached them, and grabbed on a key row
  where nothing was drawn. A note drawn on the keyboard after a drum jumped to the drum's lane once
  it compiled, and a body head fed by a drum loaded before its `[` (`remapFed`) was drawn on its
  lane but found nowhere. Rows now follow the byte, and `rowOfItem` falls back to the walk's byte
  for that body head. The sample a pitched note still plays is said by the `@` glyph on its bar
  (`drumFrom`) and by its hover.

- **The computer keyboard as a piano behind a Typing keys toggle** — the computer's keys played
  the roll's piano only while a toolbar toggle, `Settings.typingKeys`, was on, and the Record group
  appeared only while it or the MIDI switch was (`RollRecord.listening`), with the last of the two
  going off ending a take in flight. The toggle guarded against nothing: every shortcut the roll
  has on a letter takes `Ctrl` or `Alt`, and its bare keys — Space, Delete, Backspace, the arrows,
  Escape — are none of `keyOfCode`'s, so the piano and `rollShortcut` never want the same press.
  What it did do was make a porter switch the keyboard on before it worked. The keys are now always
  taken, outside fields and dialogs, and Record is always on the toolbar.

- **The MIDI keyboard switch as a recording setting, with a fixed label** — Use MIDI Keyboard sat
  in `roll-record-dialog/` beside Play the song and Key sounds (`roll.record.use-midi-keyboard`),
  and before that beside the transport; in both, only its title said whether a keyboard was
  connected. A MIDI keyboard plays the roll whenever the roll is open, not only into a take, and
  whether one is connected is a standing state that a dialog opened before recording kept out of
  sight. The switch is in the top bar left of the exports, and its label is the state: Connect,
  Connected, or not detected while MIDI is on with no keyboard found.

- **The keyboard's controls on a row of their own under the roll's settings** — a `basis-full` row
  under the toolbar held Typing keys, Record, Key sounds, Play the song and the chord chips, all
  visible all the time, and Record armed on its first press. Most of it is set once and left, and
  the row cost the roll a line of height. Record is now one toggle on the main row after Edits; a
  press while idle opens the dialog, whose Arm arms (`RollRecord.arm`), as FL Studio's record
  button asks what to record before it arms.
