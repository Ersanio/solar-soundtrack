---
paths:
  - 'packages/song-import/**'
  - 'web/src/app/editor/import-dialog/**'
---

# Import

Read before changing an importer in `@amk/import` or the Import dialog. The package's own
`CLAUDE.md` explains each step of reading and writing a MIDI file; this is what must stay true.

## The package

- **It writes text and nothing else.** No compile, walk or player: the dialog and `miditest` do
  that with the song it returns. It reads `@amk/spc/instruments` and `@amk/spc/pitch` for the stock
  instruments' ranges, and the lint boundary allows nothing more.
- **Codes, not words.** A refusal is an `SmfError` code, a warning an `ImportWarning`; the dialog's
  `import-text.ts` words them under the `import` i18n group.
- **Read once, write often.** `readMidi` does the parsing and the split into parts and takes no
  options; `writeMidi` takes the grid, the parts kept and their instruments and runs on every
  change. A part's `id` does not depend on any option, so a choice survives a new grid.
- **A written song raises no problem.** Whatever the file, the song compiles and the editor's
  diagnostics — `SST0502`, `SST0507`, `SST0511`, `SST0513`-`SST0515`, `AMK0141`/`AMK0142`, `AMK0200`
  — stay quiet. `miditest`'s `stress` section is the net for that; a fix to the writer that a
  diagnostic catches belongs there as well as in the section it is about.
- **Ticks.** Times are file ticks until the writer and driver ticks after it; the snap grid is in
  driver ticks.
- **At most eight parts are written**, in part order, on `#0` up. `CHANNEL_LIMIT` is the one place
  the number is stated.

## The dialog

- `top-bar.html`'s Import is a `<label>` round a file input, so the press is the picker's own. Any
  file opens the dialog, which says why when it cannot read it; `detectFormat` picks the reader.
- The candidate is a `computed` chain: written, compiled with `EditorStore.compileText`, assembled
  with `EditorStore.spcFor`, walked for its clock. Import is held back while it has no SPC.
- **The preview is a third `AudioContext`** (`import-preview.ts`), not `Playback` or `Audition`:
  the candidate is not the document. It is made when the dialog opens and disposed when it closes,
  however it closes (`Modal.closed`). Pressing play stops the transport and the previewer first
  (`stopAll`). Its position and seek bar are ticks; seconds only label them.
- Import replaces the whole document through `EditorRequests.applyAll` with `show`, one undo step
  back to the song that was open, as `held-song-banner.ts` does.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/import.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **A channel's settings written at its first note only** — `settings`, `SST0511`
- **A kit opening on `@21`-`@29` before a rest** — `@0`, `settings`
- **Note lengths from `@amk/core`'s `spellLength`** — `spellTicks`, `AMK0200`
- **Drum hits struck together sharing a voice** — `allocate`, `allowance`
- **Each note of a chord to the free voice nearest its pitch** — `allocate`, `match`, `NEW_VOICE`
- **The parts that sound the most suggested by weight alone** — `suggestedParts`
