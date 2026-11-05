---
paths:
  - 'scripts/instrtest.ts'
---

# `instrtest`: what it proves

The driver's instrument and percussion tables. Its load-bearing assertion is that `instruments.ts`
finds them in `main.bin` **uniquely** — the tables carry no citable address, so they are located by
matching the SRCN column against `INSTRUMENT_TO_SAMPLE`, and a second candidate would make that a
guess. It also pins the one index where the driver and `Music.cpp`'s `instrToSample` disagree: 19,
which is the whole `@19` story — and, for the same reason the compiler's own constants are
cross-checked here, that `@amk/tokens`' `LAST_DRIVER_INSTRUMENT` counts the same table as
`MELODIC_SLOTS`, which is what lets the instrument picker offer the entry only a raw `$DA` reaches.
