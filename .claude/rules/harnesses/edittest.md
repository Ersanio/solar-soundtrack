---
paths:
  - 'scripts/edittest.ts'
---

# `edittest`: what it proves

The splices the command inspector writes back into the source. Four load-bearing assertions, the
first two comparing whole strings rather than numbers because numbers cannot see either failure. **Gap
preservation**: a tab, a column of aligned bytes or a mid-run `; comment` survives an edit to the
byte beside it. **The macro interlock, per part**: `"ech=$EF"` used as `ech $80 $10 $10` has a macro
for its command byte and literal text for every argument, so the arguments are writable and the byte
is not. **The instrument picker's list and its write are one map**: `@`, `@@` and a raw `$DA` reach
different sets — 19-29 is a drum, a custom instrument or nothing depending on the spelling, and
`#am4` moves the custom band to `$13` — so every instrument `instrumentReach` offers is written out
and rescanned, and `selectedInstrument` has to name the one that was picked. A list read one way and
a write built another offers one instrument and selects a different one, silently. **A note's length
is written onto the note**: a bare `c` under an `l8` has no argument to splice and is still 24 ticks
long, so the digits are inserted where none were written, and they go in front of the dots — which
compose rather than add (`Music.cpp:2950`) — so `l8 c.` written back at its own denominator is `c8.`
and still 36 ticks; the standing `l`, the notes around it and a tie's other segment are read back
unmoved.
