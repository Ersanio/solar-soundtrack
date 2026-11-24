---
paths:
  - 'scripts/ittest/**'
---

# `ittest`: what it proves

IT import, `@amk/import/it`, through the tracker writer the other tracker harnesses also cover.
Every file is built in memory by `support.ts`'s IT writer, so there are no binary fixtures; its
`bitStream` packs values at a bit width so the IT 2.14 decompressor can be fed streams whose output
is known. A file is imported, each kept sample planned and encoded as the dialog does, and the song
compiled beside them, walked, diagnosed as the editor diagnoses it and assembled, with `modtest`'s
`song` and `encoded`. The oracle is **the compiler and the walk, and the player's own record**: the
walk's notes are held to the ticks the IT strikes them at and their pitch to the semitone it plays
nearest, and the volumes, pans and pitches the player records to what `it2play` computes.

Three things here are load-bearing in ways the name does not suggest:

- **`stress` is the net for every interaction.** Four seeded twelve-channel songs using every
  command and the volume column, each in sample mode and in instrument mode (envelopes with a
  sustain and a loop, a pitch envelope, a keymap over a 16-bit and a ping-pong sample, fadeouts and
  a New Note Action), on linear and Amiga slides, imported at three factors and both loop modes,
  each required to raise nothing and to assemble. A new player feature belongs in its generator.
- **`reader`'s compression checks are hand-built.** No example the importer was written against is
  compressed, so the decompressor is held to streams `bitStream` packs at widths 9, 7 and 17 and to
  a width change; a change to `decompress8` or `decompress16` that keeps those is not yet proof
  against a real IT 2.14 file.
- **`pitch` stops where the DSP does.** A C5Speed of 44100 at a factor of 1 puts B-6 past what the
  DSP can play, where the writer folds it an octave down by design, so those cases are left out
  rather than loosened.

| Section       | What it pins                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reader`      | the header and channel pans, packed cells, signed, unsigned, 16-bit and stereo samples, ping-pong and sustain loops, IT 2.14 and 2.15 compression, instruments, refusals, a UMX                                                 |
| `timing`      | twelve driver ticks a row at speed 6, Axx, Txx and T1x, Bxx as the loop point, Cxx, SBx, SEx, S6x, SDx, a short pattern and the order markers                                                                                   |
| `pitch`       | IT's rates, 36 notes on linear and Amiga slides at three C5Speeds and factors within the tolerance, and the keymap's translated notes and samples                                                                               |
| `effects`     | Dxy and its fine slides and memory, the volume column, Mxx, Nxy, Vxx, Wxy, Ixy, E, F and G as `$DD`, H, U and the column's vibrato as `$DE`, J, R, Q, SCx, `^^^`, `===`, Xxx, S8x, Pxy, the separation, and Oxx and Yxy counted |
| `instruments` | the volume envelope's rise, sustain, release and loop, the fadeout, the global volumes, the panning and pitch envelopes, the auto-vibrato, and a New Note Action counted                                                        |
| `stress`      | the seeded busy songs in both modes, on both slides, at every factor and loop mode raising nothing and assembling                                                                                                               |
