---
paths:
  - 'scripts/s3mtest/**'
---

# `s3mtest`: what it proves

S3M import, `@amk/import/s3m`, through the tracker writer `modtest` also covers. Every file is
built in memory by `support.ts`'s S3M writer, so there are no binary fixtures. A file is imported,
each kept sample planned and encoded as the dialog does, and the song compiled beside them, walked,
diagnosed as the editor diagnoses it and assembled, with `modtest`'s `song` and `encoded`, which
this harness imports rather than copies. The oracle is **the compiler and the walk, and the
player's own record**: the walk's notes are held to the ticks the S3M strikes them at and their
pitch to the semitone ST3's period plays nearest, and the volumes, pans and periods the player
records are held to what `st3play` computes.

Three things here are load-bearing in ways the name does not suggest:

- **`stress` is the net for every interaction.** Five seeded twelve-channel songs using every
  command, the volume column, order markers and a jump back, imported at three factors, both loop
  modes and two separations, each required to raise nothing and to assemble. Its notes span five
  octaves, so it is also what holds the writer's vibrato to the range (`SST0514`): a MOD's three
  octaves never reach the edges. A new player or writer feature belongs in its generator.
- **`pitch`'s tolerance stops at a base rate of about 2.5 kHz**, as `modtest`'s does: a C2SPD
  times the factor below that leaves a small multiplier coarser than eleven cents.
- **`effects` reads the player's record directly** for what the text cannot show — a slide's
  period step, a volume on each tick, a pan — so a change to the player's arithmetic fails there
  even where the written song would still compile.

| Section   | What it pins                                                                                                                                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reader`  | the PCM channels kept and their pans (side, pan table, mono), packed cells, 8- and 16-bit signed and unsigned and stereo samples, the loop, C2SPD 0, a cut file, the order markers, a second song after a `---`, the refusal, a UMX |
| `timing`  | twelve driver ticks a row at speed 6, Axx, Txx as `t` and T20 ignored, Bxx as the loop point, Cxx in BCD and not, SBx, SEx, SDx and a delay past its row counted                                                                    |
| `pitch`   | ST3's periods, 36 notes at three C2SPDs and three factors within the tolerance, S2x's finetune, and a seven-octave range folded with its pitch class kept                                                                           |
| `effects` | the volume column, Dxy and its fine and fast slides and memory, Vxx, Ixy, E, F and G as `$DD`, H and U as `$DE`, J as `$FB`, R as `$E5`, Qxy, SCx and `^^`, S8x and Xxx, and Oxx, S1x and AdLib counted                             |
| `stress`  | the seeded busy songs at every factor, loop mode and separation raising nothing and assembling, and shared with every channel that fits kept                                                                                        |
