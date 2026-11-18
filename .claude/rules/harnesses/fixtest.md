---
paths:
  - 'scripts/fixtest/**'
---

# `fixtest`: what it proves

The Problems list's fixes (`web/src/app/output/diagnostics-list/fixes/`) and the diff its dialog
draws. A fix is held to the song it leaves, never to its text alone: `expectFix` compiles the
fixed text, walks it and diagnoses it the way `EditorStore.allDiagnostics` does, and fails unless
the fixed code is gone and no error code appears that the song did not have. Every fix is also
checked well formed — each `expect` is what the text holds, the edits are in order and apart, and
`against` is the text they were built on — which is what `applyAll` relies on and cannot check.

Three things here are load-bearing in ways the name does not suggest:

- **The fixes that claim to change nothing are held to the same bytes** (`sameBytes`): the second
  `#option smwvtable`, `#option dividetempo 1`, the lowered note letters and the deleted stray
  character. The `#spc` cut is held to the same tag instead, since the tag is what it touches.
- **The "not offered" cases are as much the point as the offered ones.** An N-SPC request after
  `#option smwvtable` means something, a `$DD` cannot move across an octave or a bracket, a song
  holding a `$FA` cannot become `#amm` (AMK0156), a `#spc` value holding a `\"` is not cut
  (`preprocess` reads every `"` as a delimiter), and Trim is not offered for a channel with a loop.
  Each is a fix that would compile here, or look right, and break the song.
- **The echo fix is pinned as a boundary, not a value**: the lowered feedback fades and one step
  further does not, on the same side of zero, so a fix that lowered it too far would fail as surely
  as one that did not lower it enough.

| Section      | What it pins                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------- |
| `directives` | redundant directives deleted, misplaced ones moved, the target written or switched, `#pad`, `#spc` |
| `text`       | upper-case notes lowered and a stray character deleted, both to the same bytes                     |
| `names`      | a sample, group or `#spc` field put right only where exactly one name fits                         |
| `samples`    | a used sample added to `#samples`, a list written where there was none, `#default` put first       |
| `hazards`    | `$F7` deleted, a stranded `$DD` moved back to its note, a runaway echo's feedback lowered          |
| `lengths`    | SST0502's Pad and Trim, each leaving every channel the same length and nothing unreachable         |
| `repeat`     | a carried setting written again after the `/`, remote code reset, a toggle switched back           |
| `diff`       | the dialog's rows: kinds, line numbers, context, what is folded, CRLF and long lines               |
