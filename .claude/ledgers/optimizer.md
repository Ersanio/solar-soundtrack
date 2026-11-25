# Decisions already made: `.claude/rules/optimizer.md`

The ledger of `.claude/rules/optimizer.md`: each entry is a design that was built or considered there
and moved away from, with the reason. The rule carries one index line per entry.

- **Tie superloops through hot patch bit 0.2** — porters write `[[^=96]]10` under
  `#option amk109hotpatch`, whose bit 0.2 makes the read-ahead follow into loop bodies, so a tie
  may open one. Setting it would change how the read-ahead treats every loop in the song, and the
  roll refuses a channel that ties across a bracket, so the optimizer leaves ties outside loops
  (`tieOpens`) and refuses hot-patched songs altogether.
- **Remote codes in the first version** — a call costs 5 bytes against a label call's 4, so
  lossless remote moves save little that label loops do not; and `walkSong` does not enter a remote
  body, so `compareSongs` could not prove one. Remote moves wait for a proof that renders both songs
  and compares the audio.
- **Writing `*`, replacements or commands-only bodies** — `*` names the last body defined anywhere
  and the palette no longer writes it; the roll refuses a channel written through a `"x=y"`; a body
  with no note is a zero-width loop box. Each would leave a channel the roll cannot edit.
- **The tracker writer's pass loops left on under the optimizer** — optimizing the writer's
  `(n)[ … ]` text kept each pass as a fixed block and stopped repeats that cross a pass: 4_spirits
  came to 10.3 KB against 8.8 KB from flat text. The dialog writes with `passLoops: false` and falls
  back to the pass loops only for a song the optimizer cannot shorten.
- **A label for one run back to back** — `(1)[c16]31` costs about what `[[c16]]32` does, but a
  superloop is what porters write for a run used nowhere else, so the label pass leaves a single run
  of a body up to `MAX_PERIOD` items to the superloop pass.
- **The fix dialog's diff in Finalize** — a rewrite touches nearly every line, so `fix-diff` showed
  the whole song removed and added again. Finalize shows the sizes and the moves instead.
