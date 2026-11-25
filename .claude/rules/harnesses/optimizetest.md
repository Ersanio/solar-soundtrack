---
paths:
  - 'scripts/optimizetest/**'
---

# `optimizetest`: what it proves

The MML optimizer, `@amk/optimize`. Every song is MML written in the section, or a tracker module
built in memory with `modtest`'s writer and written flat. The oracle is **a second reading of the
walk and the piano roll's own strip**, not the optimizer's proof: `support.ts`'s `sameNotes` lists
each walked note's tick, pitch with `$FA $02` folded in, length, gate, volume and instrument, and
`refusedChannels` opens every channel with `roll-strip.ts`'s `channelStrip`.

| Section       | What it pins                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constructs`  | Each move on a song written for it: a label loop, a call from another channel, a transposed call, a superloop, a rest loop in `finalize` only                                                   |
| `constraints` | No tie across a loop edge, the porter's loops, labels, remote code and macros kept, a hot-patched song untouched, no `$DD` transposed, nothing to loop returned as it was, counts within a byte |
| `tracker`     | Seeded modules: a quarter smaller at least, playing the same, raising no problem, assembling, open in the roll, within two seconds                                                              |
| `redo`        | Every loop spelling played out and looped again, never larger than keeping them; a recall under another `q`                                                                                     |

Two things here are load-bearing in ways the names do not suggest:

- **`constraints`' tie checks are the only guard on key-off.** The walk folds a tie into its note
  without the driver's read-ahead, so neither `sameNotes` nor the optimizer's own proof would see a
  tie hidden behind a call; the roll's refusal of a tie across a bracket and the text checks do.
- **`tracker` is the net for the interactions.** A change to the passes that trades size between
  songs shows first in its quarter-smaller bound and its two-second bound.
