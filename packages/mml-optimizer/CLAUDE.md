# @amk/optimize

A song rewritten to compile smaller and play exactly as it did: music that repeats becomes label
loops, calls from other channels, transposed calls and superloops, and, when finalizing, long rests
become superloops. The tracker Import dialog runs it on every write (`import` mode), and the top
bar's Finalize runs it on the open song (`finalize` mode). The rules it keeps, and the porter
techniques it follows, are in `.claude/rules/optimizer.md`.

Depends on `@amk/core`, `@amk/compiler` (the real byte counts and the proof), `@amk/tokens` (reading
the text) and `@amk/spc` (`walkSong`, `vcmdLength`), and on no importer — `eslint.config.js` holds
it. It takes the caller's compile, so the sample names and groups are the editor's.

| Module           | What it is                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `optimize.ts`    | `optimizeSong`: plan, write, compile, prove; a move that fails is barred and the rest retried |
| `read.ts`        | The compiled song read into items, each with the bytes it compiled to and the state around it |
| `repeats.ts`     | A suffix array, its LCP, and the groups of positions sharing a run                            |
| `plan.ts`        | The passes: label loops (exact and transposed), superloops, rest loops                        |
| `write.ts`       | A plan written as MML, with where each move landed                                            |
| `equivalence.ts` | Two compiled songs' walks compared, loops, `$FA $02` and remote addresses aside               |
| `unroll.ts`      | Redo: a song's own loops played out pass by pass                                              |

## How a song goes through it

1. **Compile** with the caller's compile. A song whose only error is AMK0300, too long for the
   driver's slot, is compiled at `0x0100` instead, so a flat import that does not fit can still be
   read and shortened; the walk does not depend on the load address.
2. **Read** (`readSong`). Each note, rest, tie and command becomes an item keyed by what it
   compiled to: a note by its emitted byte, its ticks, the `q` in force and its instrument's tuning
   shift; a command by its bytes. Equal keys compile to equal bytes wherever the text lands, a
   body on channel 8 or a call from another channel included. `o`, `<`, `>` and `l` are dropped and
   written again where a note needs them. Anything else — an existing loop or call, a remote call,
   a replacement, `&`, `{ }`, a comment — is a `fixed` item written as it was, the octave and `l`
   it reads restored before it. A song in another dialect, under a tempo ratio, or with a hot patch
   is refused.
3. **Plan** (`plan`). Rounds of the label pass, each over a fresh suffix array of the song's item
   keys, take every non-overlapping run worth looping, best first. Then superloops over each
   channel, then over the bodies not called inside one, and in `finalize` rest loops.
4. **Write** (`writePlan`): each label defined at its first use in text order, numbered above every
   label and remote slot the song uses; a transposed call wrapped in `$FA $02 $xx … $FA $02 $00`.
5. **Prove.** The written notes must name the bytes they did (`misreadNote`); the compile must
   raise no error and no diagnostic the original did not (`newDiagnostic`); the compiler instrument
   each tuned note compiles through must match (`instrumentBlame`); and the walks must agree
   (`compareSongs`). A failure is mapped to the move written around it, which is barred, and the plan
   runs again, twelve times at most. A result no smaller than the input is the input.

`existingLoops: "redo"` first plays the song's own loops out (`unrollLoops`), and uses that only
where its walk agrees with the original's; otherwise the loops are kept.
