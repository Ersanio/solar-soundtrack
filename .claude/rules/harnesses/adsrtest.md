---
paths:
  - 'scripts/adsrtest.ts'
---

# `adsrtest`: what it proves

The envelope maths. `CLOCKS` is checked against the _published SNES noise ladder_, because the DSP
uses the same table for noise and every other function there is defined in terms of it; nothing else
could catch a transposed digit. It also asserts that the two magic tables in AddmusicK's readme
calculator are exactly the step counts of bsnes's envelope stepping.
