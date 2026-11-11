---
paths:
  - 'web/src/app/state/{editor-store,editor-requests,driver-store,sample-store}.ts'
  - 'web/src/app/editor/codemirror/**'
  - 'web/src/app/editor/views/source-view/**'
  - 'web/src/app/editor/views/sample-browser/**'
---

# State spine, the source view and the sample library

Read before changing `EditorStore`, `EditorRequests`, `DriverStore`, `SampleStore`, the CodeMirror
adapter or the sample browser. `web/CLAUDE.md` has the reasoning behind the write-back path
("Reaching into the editor"); this is what must stay true.

## `EditorStore` has two readings of the text, at two speeds

- **`source`** is the text as typed, written only by `edit()` from the source view's update
  listener. The CodeMirror document is the authority: nothing else writes `source`, and a
  programmatic change reaches the document through `EditorRequests`.
- **The scan is undebounced.** `tokens`, `commandAtCaret`, `loops`, `remotes`, `remoteAtCaret` and
  `instrumentAtCaret` are `computed` over `source`, so the inspector, the palettes and the hover
  agree with the document on every keystroke. Their spans index `source`.
- **The compile is debounced.** `edit()` copies the text into the private `committed` after
  `DEBOUNCE_MS`; `compilation` compiles that, and `result`, `timeline`, `clock`, `budget`,
  `commandsInForce`, `commandTimeline` and `unreachableSpans` hang off it. Their spans index
  `compiledText`, which may be one edit behind `source` — compare the two before trusting a compiled
  span against the document. `compileNow()` skips the wait.
- **One scan.** Commands are compared by identity (`planEdits`, `definedAt`), so everything takes
  them from `EditorStore.tokens()`; a second `tokenize` of the same text makes every such test
  false.
- `diagnostics` joins both speeds on purpose: the compiler's findings and the walk's `SST0502` lag,
  `echoHazards` and `commandHazards` come off the scan and do not.
- `compilation` is `null` until `DriverStore` has a driver; there is no fallback load address.
  `assembleSpc()` is a method, not a `computed`, because it copies 64 KiB and every sample.

## Writing back goes through `EditorRequests`

`EditorRequests` injects nothing; it is a mailbox of signals the source view consumes. Only
`editor/views/source-view/` touches the CodeMirror view.

- `apply(edit)` is one splice and waits out the debounce, since a slider fires it per frame.
  `applyAll(edits, select, keepsNotes)` is a whole gesture in one transaction and one undo step;
  its ranges must not overlap, and it sets `immediate`, on which the view calls `compileNow()`.
  Both ignore a `null` edit.
- Every edit carries `expect`, the text it believes is in the span. The view compares before
  dispatching, so a stale span is an edit that does not take rather than a corrupted document.
  Build edits with `@amk/tokens/edits`, never by slicing strings in a panel.
- `insert()` types a snippet at the view's own selection; `reveal` selects a span, and its `show`
  flag says whether the source tab is brought forward.
- The inspector's panels commit through `CommitAudition`, which forwards here and replays the
  selected note.
- The source view is hidden with `[class.hidden]`, never destroyed, so these effects run while
  another tab is in front.

## The CodeMirror adapter

Only `editor/codemirror/` and `source-view.ts` import CodeMirror. `mml-language.ts` wraps
`@amk/tokens`' `step`/`startState`/`copyState` and adds no `blankLine` or `indent`, either of which
would colour a document differently from `tokenize`. `span-marks.ts` is the decoration field
`playhead.ts` and `unreachable.ts` share. `mml-theme.ts` uses only `styles.css` variables, the
source's colours on `--color-syn-*` tokens of their own.

## Samples

`SampleStore` never writes the bundle in `packages/spc/assets/driver/`: a replaced stock file is an
override in IndexedDB, and the bundled files keep their order, because `INSTRUMENT_TO_SAMPLE` fixes
which SRCN `@0`-`@29` mean. Its `names`, `groups`, `importantSamples` and `optimize` are read inside
`compilation`, so the compile tracks the library. The browser's rows are built by free functions in
`sample-rows.ts` as a `computed`, not by methods called per row.
