---
paths:
  - 'packages/mml-optimizer/**'
  - 'web/src/app/editor/finalize-dialog/**'
---

# The optimizer

Read before changing `@amk/optimize`, the top bar's Finalize, or Loop Repeated Music in the tracker
Import dialog. How a song goes through it is in `packages/mml-optimizer/CLAUDE.md`; this is what
must stay true.

## What must stay true

- **It never changes what plays.** Every result is compiled and its walk compared with the
  original's (`compareSongs`) before it is returned, and a move that fails is barred, never kept.
  A result no smaller than the input is the input.
- **The walk does not see key-off.** `walkSong` folds a tie into its note without the driver's
  read-ahead (`main.asm:2964-3039`), which steps over `$E9` and stops at a body's `$00`. So no body
  opens on a tie or has its first note, rest or tie a tie, and no tie follows an occurrence or a
  superloop, commands between included (`tieOpens`, `tieNext`). These rules are the only guard;
  `optimizetest`'s `constraints` holds them.
- **A hot-patched song is refused** (`readSong`): bits 0.2 and 1.0 change what the read-ahead does
  at a loop and at a rest (COMMANDS.html §6).
- **The output opens in the piano roll on every channel the input did.** Nothing it writes is a
  replacement, a `*`, a crossed loop, a tie across a bracket or a commands-only body; a drum's `@`
  and a `$DD` stay glued to their note.
- **A body compiles once, on channel 8**: an `@` in it no longer tunes the text after a call, and a
  superloop's compiler state after it is its first pass's. `followsAlike`,
  `superloopFollowsAlike` and the final `instrumentBlame` hold the notes after either to the
  instrument they compiled through.
- **A transposed call** needs a body with no drum, `$DD` (whose target ignores `$FA $02` unless
  hot patch bit 0.3 is set), `$FA $02`, `$E4` or `$F3`, on a channel that writes no `$FA $02` itself.
  The roll draws the body's notes at their written pitch under every call, with the transpose in the
  tooltip; that trade-off is the porter's choice, made for both modes.
- **Rest loops are `finalize` only**: a looped silence is a loop box a note cannot be drawn into.
- **Labels** are numbered above every label the song uses and every remote slot (`(!k)` is label
  `k - 1`), defined at the first use in text order (AMK0115), counted to 255 at most.

## Porter techniques

From hand-finalized songs, and what the optimizer does with each:

- A single repeated note or rest as a superloop: `[[o5c]]16`, `[[r=64]]16`. Done (rests in
  `finalize`).
- A label defined on one channel and called on others. Done.
- A label called at another pitch: `$FA $02 $FC (00)2 … $FA $02 $00`, for bass lines and
  sequences. Done.
- A superloop of calls: `[[ (501)(502) ]]14`. Done.
- A label called under a different volume, `v78 (204) v55 (204)`, for an echo made of copies.
  Found when the volume is outside the body.
- Ties in a superloop, `[[^=96]]10`, under `#option amk109hotpatch`. Not done: see the ledger.
- Remote codes, mostly as effects: an ADSR release at key-off `(!40,3)`, the instrument set again at
  every key-on `(!2,-1)`, arpeggio tables. Not done yet: the walk does not enter a remote body, so
  a remote-code move needs an audio-render proof first.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/optimizer.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **Tie superloops through hot patch bit 0.2** — `$FA $FE`, `tieOpens`
- **Remote codes in the first version** — `$FC`, `compareSongs`
- **Writing `*`, replacements or commands-only bodies**
- **The tracker writer's pass loops left on under the optimizer** — `passLoops`
- **A label for one run back to back** — `evaluate`, `MAX_PERIOD`
- **The fix dialog's diff in Finalize** — `fix-diff`
