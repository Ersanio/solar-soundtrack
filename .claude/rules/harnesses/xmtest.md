---
paths:
  - 'scripts/xmtest/**'
---

# `xmtest`: what it proves

XM import, `@amk/import/xm`, through the tracker writer `modtest` and `s3mtest` also cover. Every
file is built in memory by `support.ts`'s XM writer, delta-coding its samples as FT2 stores them, so
there are no binary fixtures. A file is imported, each kept sample planned and encoded as the dialog
does, and the song compiled beside them, walked, diagnosed as the editor diagnoses it and assembled,
with `modtest`'s `song` and `encoded`. The oracle is **the compiler and the walk, and the player's
own record**: the walk's notes are held to the ticks the XM strikes them at and their pitch to the
semitone FT2's period plays nearest, and the volumes, pans and periods the player records to what
`ft2_replayer.c` computes.

Three things here are load-bearing in ways the name does not suggest:

- **`stress` is the net for every interaction.** Five seeded twelve-channel songs using every
  effect, the volume column, instruments with a sustained envelope and a fadeout, a keymap over a
  16-bit and a ping-pong sample, a looping panning envelope and an auto-vibrato, repeats and a jump
  back, on both frequency tables, imported at three factors and both loop modes, each required to
  raise nothing and to assemble. A new player feature belongs in its generator.
- **`instruments` reads the envelope tick by tick.** A sustain point that is not held, a loop that
  does not loop or a fadeout off by a tick changes when a note's volume reaches 0, which is where
  the writer ends the note, so it is held to FT2's stepping exactly.
- **`effects` pins FT2's order where it differs from ProTracker's**: an arpeggio's y step before its
  x, a fadeout from the key off's own tick, a tremor that leaves the volume off.

| Section       | What it pins                                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reader`      | the header, packed cells, 8- and 16-bit delta samples, a ping-pong loop laid out, keymaps, an empty instrument, a cut file, the refusal, a UMX, a second song wrapping to its own start |
| `timing`      | twelve driver ticks a row at speed 6, Fxx as speed and BPM, Bxx as the loop point, Dxx in BCD, E6x, EEx, EDx, a short pattern, the restart order                                        |
| `pitch`       | FT2's periods and rates, 36 notes on both tables at three relative notes and factors within the tolerance, E5x, and the keymap's samples                                                |
| `effects`     | the volume column, Axy, Cxx, Gxx, 1xx, 2xx, 3xx and X1x as `$DD`, 4xy and the column's vibrato as `$DE`, 0xy, 7xy, E9x, Rxy, ECx, Kxx, 8xx, Pxy, Txy, and 9xx, E3x and Lxx counted      |
| `instruments` | the volume envelope's rise, sustain, release and loop, the fadeout, an instrument alone restarting it, the panning envelope, the auto-vibrato                                           |
| `stress`      | the seeded busy songs on both tables at every factor and loop mode raising nothing and assembling, and shared with every channel that fits kept                                         |
