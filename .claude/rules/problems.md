---
paths:
  - 'web/src/app/output/diagnostics-list/**'
  - 'web/src/app/state/suppressions.ts'
  - 'web/src/app/state/suppressible.ts'
  - 'web/src/app/editor/top-bar/suppressions-button/**'
---

# The Problems list: suppression

Read before changing suppression or the top bar's list of suppressed warnings. Adding a diagnostic
is the `add-diagnostic` skill, which says when one gets a `SUPPRESSIBLE` entry.

## Suppression

`Suppressions` holds codes, not occurrences: suppressing one hides it in every song, persisted under
`solar-soundtrack.suppressed`. `EditorStore.diagnostics` is `allDiagnostics` less every non-error
whose code is suppressed, so the list, both counts and the editor's underlines follow without a
change of their own; **an error is never suppressed**, whatever is stored. `SUPPRESSIBLE` lists the
non-error codes for the top bar's picker, each described by its own catalog entry with `…` for the
values; the row's Suppress button works for any non-error code, listed or not.
