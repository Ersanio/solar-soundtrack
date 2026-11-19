---
paths:
  - 'web/src/app/output/diagnostics-list/**'
  - 'web/src/app/state/suppressions.ts'
  - 'web/src/app/state/suppressible.ts'
  - 'web/src/app/editor/top-bar/suppressions-button/**'
  - 'scripts/fixtest/**'
---

# The Problems list: fixes and suppression

Read before changing a fix, the fix dialog or its diff, suppression, or the top bar's list of
suppressed warnings. Adding a diagnostic is the `add-diagnostic` skill, which says when one gets a
fix or a `SUPPRESSIBLE` entry.

## Fixes

**A fix answers one diagnostic with the edits that make it**, and is offered only where it exists:
`fixesFor` (`output/diagnostics-list/fixes/fixes.ts`) dispatches by code to one family per file,
and a family with nothing to say offers nothing, so no button stands beside a diagnostic it cannot
clear. Each family is Angular-free so `fixtest` can hold it to the song it leaves.

- **Never from the message.** A message is display text. A fix finds what it rewrites in the scan,
  taking the diagnostic's span as a hint, because most spans are wherever the parser was standing
  (`warnOnce` reports at `pos`).
- **The text a diagnostic indexes is the text its fix is built on.** The scan's own findings
  (`SST0500`, `SST0501`, `SST0506`, `SST0507`, `SST0517`, `SST0518`) use `FixContext.live`; everything the compiler or
  the walk raises uses `FixContext.compiled`, the compiled text and `EditorStore.compiledTokens`,
  which may be one edit behind the document. `Fix.against` names that text. `openFix` forces the
  compile and rebuilds a fix whose text has moved on, and `apply` refuses one that still has.
- **Edits come from the shared builders**: `@amk/tokens/edits`, `roll-write/splice.ts`,
  `roll-strip.ts`'s `channelTails`, `channelHome` and `channelMarkers`, `@amk/core/mml-text`'s
  spelling. `makeFix` sorts them and throws on an overlap, which `applyAll` cannot refuse.
- **A fix must not widen what AddmusicK accepts or break what it reads.** Every "not offered"
  guard in a family is a fix that would compile here and fail there, or look right and change the
  music; `fixtest` pins each. The dialog compiles the fixed text before it offers Apply and holds it
  back on any error code the song does not have now — the net for a song no case foresaw.
- **Apply is one undo step and a summons.** `applyAll(edits, select, false, true)`: one transaction,
  with `EditBatch.show` bringing the source forward focused on the change, so Ctrl+Z reaches it.

`repeat-carry.ts`'s findings (`repeatTempoFindings`, `repeatSettingFindings`) are the one reading
the `SST0510`-`SST0512` diagnostics and their fixes share, so the two cannot disagree about what the
first pass's setting was or which reset the message names.

## The diff

`fix-diff.ts` turns `(against, edits)` into rows with no general diff over the song: only the lines
the edits touch are compared, line against line within each hunk and character against character
within a changed line, with `CONTEXT_LINES` either side and the rest folded. A long hunk or line
falls back to lining up in order and to common ends. `fix-diff/` draws it in `--color-diff-add`,
`--color-diff-remove` and `--color-diff-change`, with a `−` `+` `~` gutter so a row's kind is never
said by colour alone.

## Suppression

`Suppressions` holds codes, not occurrences: suppressing one hides it in every song, persisted under
`solar-soundtrack.suppressed`. `EditorStore.diagnostics` is `allDiagnostics` less every non-error
whose code is suppressed, so the list, both counts and the editor's underlines follow without a
change of their own; **an error is never suppressed**, whatever is stored. `SUPPRESSIBLE` lists the
non-error codes for the top bar's picker, each described by its own catalog entry with `…` for the
values; the row's Suppress button works for any non-error code, listed or not.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/problems.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **Building a fix only while the compile has caught up with the document** — `FixContext.compiled`,
  `compiledTokens`, `Fix.against`
- **Cutting a `#spc` value that holds `\"` by the length the parser reads** — `getQuotedString`,
  `preprocess.ts`, `AMK0205`
