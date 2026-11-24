---
paths:
  - 'scripts/miditest/**'
---

# `miditest`: what it proves

MIDI import, `@amk/import/midi`. Every file is built in memory by `support.ts`'s SMF writer, so
there are no binary fixtures to drift from the code that reads them. A file is imported, compiled
and walked, and the oracle is **the compiler and the walk, not the text**: the notes the walk plays
are held to the notes the file plays. The song is also diagnosed as the editor diagnoses it
(`support.ts`'s `song`), so an import that compiles but raises a problem fails here.

Two things here are load-bearing in ways the name does not suggest:

- **`stress` is the net for every interaction.** Six seeded busy songs — chords, bends, controller
  sweeps, a kit, two tempos and a loop marker, at six divisions — imported at every grid and both
  loop modes, each required to raise nothing. The `SST0511` carries, the AMK0200 dots, the vibrato
  past the range and the kit hits sharing a voice are each an interaction no section about one
  feature reaches. A new writer feature belongs in the generator as well as in its own section.
- **`problems` excludes only `info`.** A warning is a failure, because an imported song a porter
  opens to warnings is an import that did not finish its job.

| Section       | What it pins                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parser`      | variable-length quantities, running status across delta times and cancelled by a meta event, velocity-0 key-off, RMID, unknown chunks, a cut file, refusals                                                                 |
| `timing`      | PPQ 96/480/960 and SMPTE on 48 ticks a quarter, each snap grid, `t` from BPM and its clamp, a tempo walked at its tick and tied across a note, the padded end                                                               |
| `voices`      | a chord split top line first, a melody kept from its bass, a legato overlap kept one part, the sustain pedal, eight kept out of ten and in part order                                                                       |
| `drums`       | channel 10, a GS rhythm part and XG's bank 127 as kits, families split, every GM key on a stock drum or the bongo, an unmapped key counted, the porter's drum map on drums and pitched instruments with the parts unchanged |
| `instruments` | 128 programs on reachable instruments, the whole keyboard folded into each one's range, a part moved by octaves, the porter's choice and a program change                                                                   |
| `effects`     | `v`, `y`, `q`, a volume fade, the bend at the key-on and RPN 0, `$DD` slides that raise no SST0507, vibrato, reverb as one echo, the loop markers                                                                           |
| `end-to-end`  | a four-part file, title and kit included, walked note for note                                                                                                                                                              |
| `sharing`     | parts taking turns on one channel, walked in their own bars; overlaps, drum hits inside notes and an all-at-once chord kept apart; a hand-over trimmed; twelve parts on three channels                                      |
| `stress`      | the seeded busy songs at every grid and loop mode, and shared on a drum map, raising nothing                                                                                                                                |
