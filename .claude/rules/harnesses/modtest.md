---
paths:
  - 'scripts/modtest/**'
---

# `modtest`: what it proves

MOD import, `@amk/import/mod`. Every file is built in memory by `support.ts`'s MOD writer, so there
are no binary fixtures. A file is imported, each kept sample planned and encoded as the dialog does
(`encoded`), and the song compiled beside them, walked, diagnosed as the editor diagnoses it and
assembled (`song`). The oracle is **the compiler and the walk, not the text**: the walk's notes are
held to the ticks the MOD strikes them at, and their pitch register to the semitone the MOD plays.

Three things here are load-bearing in ways the name does not suggest:

- **`stress` is the net for every interaction.** Five seeded eight-channel songs using every effect,
  repeats and a jump back, imported at three factors, both loop modes and two separations, each
  required to raise nothing and to assemble. A new writer feature belongs in its generator as well
  as in its own section.
- **`pitch`'s tolerance is the driver's.** `SetPitch` shifts its table value right before it
  multiplies, so a sample over three octaves keeps fewer bits at its lowest, and a low factor leaves a
  small multiplier coarse. Twelve cents is what `tuningFor`'s search reaches on ProTracker's three
  octaves at a factor of 0.3; a choice of octave by any simpler rule lands near twenty.
- **`problems` excludes only `info`**, as in `miditest`: an imported song that opens to warnings is
  an import that did not finish its job.

| Section   | What it pins                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reader`  | each signature's channel count, a cell's four bytes, the pattern count from all 128 orders, FLT8's pairs, the loop quirks, a cut file, the refusals |
| `timing`  | twelve driver ticks a row at speed 6, `F03`, a BPM as `t` at its row, Bxx as the loop point, `D16` in BCD, `E6x`, `EEx` and `EDx` on the walk       |
| `pitch`   | 36 notes at three finetunes and three factors, FastTracker's periods to 28, and a seven-octave range folded with its pitch class kept               |
| `effects` | vibrato as `$DE`/`$DF`, 3xx, 1xx and E2x as `$DD`, `Cxx` through a square root, a slide as a fade, `ECx`, a one-shot's end, panning, 9xx and E3x    |
| `loops`   | repeated orders as one label loop with calls and a count, every key-on walked through them, and a pass that opens on a tie written out              |
| `samples` | the loop on a block at five factors, a tiny loop widened, a one-shot's length and level, a copy at 1, and `fitFactor` against a room                |
| `stress`  | the seeded busy songs at every factor, loop mode and separation raising nothing and assembling, and a dropped sample's notes counted                |
