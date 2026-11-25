---
paths:
  - 'packages/song-import/**'
  - 'web/src/app/editor/import-dialog/**'
  - 'web/src/app/editor/mod-import-dialog/**'
---

# Import

Read before changing an importer in `@amk/import` or an Import dialog. The package's own
`CLAUDE.md` explains each step of reading and writing a MIDI or a MOD file; this is what must stay
true.

## The package

- **It writes text, and a module's samples as PCM.** No encoder, compile, walk or player: the
  dialogs, `miditest`, `modtest`, `s3mtest`, `xmtest` and `ittest` do that with what it returns. It reads
  `@amk/spc/instruments` and `@amk/spc/pitch` for the stock instruments' ranges and the driver's pitch
  arithmetic, and the lint boundary allows nothing more, so a module's samples are planned here (`planSample`) and encoded by the
  caller (`@amk/spc/brr-encode`).
- **Codes, not words.** A refusal is an `SmfError`, `ModError`, `S3mError`, `XmError`, `ItError` or `UmxError` code, a warning an
  `ImportWarning` or `TrackerImportWarning`; `import-text.ts` words them under the `import` i18n group.
- **Read once, write often.** `readMidi` does the parsing and the split into parts and takes no
  options; `writeMidi` takes the grid, the parts kept and their instruments and runs on every
  change. A part's `id` does not depend on any option, so a choice survives a new grid.
- **A written song raises no problem.** Whatever the file, the song compiles and the editor's
  diagnostics — `SST0502`, `SST0507`, `SST0511`, `SST0513`-`SST0515`, `AMK0141`/`AMK0142`, `AMK0200`
  — stay quiet. `miditest`'s `stress` section is the net for that; a fix to the writer that a
  diagnostic catches belongs there as well as in the section it is about.
- **Ticks.** Times are file ticks until the writer and driver ticks after it; the snap grid is in
  driver ticks.
- **A module is two driver ticks to a tracker tick**, so its BPM is the song's quarter-note BPM and its
  per-tick effects land on whole ticks. `#default` is always listed first (`#optimized` with the
  dialog's Use Optimized SMW Samples, `TrackerSongOptions.optimized`), so the song is safe beside
  SMW's sound effects, and the module's samples come after it at `@30` up. A sample offset (9xx, Oxx)
  has no AddmusicK equivalent and is counted, its note played from the sample's start. Arpeggio is `$FB`
  under legato, which is on only from an arpeggio note's key-on to a tracker tick before its end, so it
  never crosses a loop point; tremolo is `$E5` only in front of a key-on; each channel takes one
  `$EE` (the package's `CLAUDE.md`). Pan is matched through `PanValues`'s curve and the volume
  scaled so the two sides sum alike at every pan (`panOf`, `heardAt`); a centred song is about 2 dB
  under a hard-panned one's full volume, the price of never clipping. A slot that copies an earlier
  one shares its file (`copiesOf`), and a one-shot's end fades to silence.
- **Formats meet at the tracker model.** A format's reader and player are the only code that knows
  its units: they hand `tracker/model.ts`'s `TrackerSong` and `TrackerPlay` (pitch in semitones from
  a sample's reference note, `baseHz`, 16-bit PCM, the vibrato's and tremolo's phase step and swing)
  to `tracker/samples.ts` and `tracker/write-mml.ts`, which never branch on the format. A change for
  one format belongs in its player, not in the writer.
- **A MOD's repeated passes are label loops** only where a pass and the one after it open on no
  tie, and each pass states its octave afresh, so two passes alike in text and in the driver state
  they start under play alike.
- **At most eight channels are written**, on `#0` up: one part (or module channel) each, or with
  `share` the ones `mml/channels.ts`'s `packChannels` puts together, which never cut one another
  short (`clashes`). `CHANNEL_LIMIT` and `TRACKER_CHANNEL_LIMIT` are where the number is stated. A
  MIDI hand-over between parts is the only overlap allowed, and the writer trims it as it trims one
  within a part; module channels share only where their notes never overlap at all, and a shared
  channel is written from one merged `ChannelTicks` (`mergeChannels`). Clashes are computed once,
  at read time, from notes that every later write's are a subset of in time.
- **A module's songs are found by its own player**, started at each order no song before has
  played (`findSongs`), so what is listed is what the writer gets. A reader plays them all once;
  choosing one is `withSong`, which sums it up again and replays nothing.

## The dialog

- `top-bar.html`'s Import is a `<label>` round a file input, so the press is the picker's own. Any
  file opens a dialog: `detectFormat` sends a tracker module (MOD, S3M, XM, IT) or a UMX to `ModImportDialog`, the
  tracker dialog, and everything else to `ImportDialog`, which says why when it cannot read it. The
  tracker dialog unwraps a UMX (`unwrapUmx`) and reads the module inside with the format's reader (`READERS`).
- The candidate is a `computed` chain: written, compiled with `EditorStore.compileText`, assembled
  with `EditorStore.spcFor`, walked for its clock. Import is held back while it has no SPC.
- **The preview is a third `AudioContext`** (`import-preview.ts`), not `Playback` or `Audition`:
  the candidate is not the document. It is made when the dialog opens and disposed when it closes,
  however it closes (`Modal.closed`). Pressing play stops the transport and the previewer first
  (`stopAll`). Its position and seek bar are ticks; seconds only label them.
- **Share channels**, in both dialogs, is off until pressed. Pressing it keeps the porter's choice
  and adds the parts (or module channels) that now fit (`addWhileFits`); releasing it keeps the
  first eight by priority (`oneEach`; a module's by notes struck). While it is on, a Keep toggle is
  disabled only where it would need a ninth channel (`fits`, `fitsShared`), and each row's `#N`
  chip is read from the written song's `channels`.
- **The drum map** (`import-drums.ts`) is a write option, `SongOptions.drums`: it changes the
  instrument and pitch a GM drum key is written with, never the kit's families or its parts, which
  `GM_DRUMS` fixes at read time. It holds only what differs from stock and is kept in storage
  across imports (`solar-soundtrack.import-drums`), each entry checked as it is read.
- Import replaces the whole document through `EditorRequests.applyAll` with `show`, one undo step
  back to the song that was open, as `held-song-banner.ts` does.
- **The tracker dialog** (`mod-import-dialog/`), for any tracker module, is the MIDI dialog's shape on the same preview and
  candidate chain (`import-candidate.ts`), with the song's samples passed beside the library
  (`EditorStore.compileText`'s extra names, `SampleStore.resolveWith`) until Import adds them
  (`SampleStore.add`); Undo brings the old song back and leaves the samples. Every sample on Auto
  shares the one factor that fills what ARAM has left once the song, its stock set and the samples with a
  factor of their own are in. The room is measured on a write with every Auto sample at 1 and the
  factor found from it (`fitFactor`), then measured again on a write at that factor and the factor
  lowered where it no longer fits, since each instrument's tuning, and so the octave its notes are
  written in, moves with the factor (`firstFactor`, `autoFactor`). A factor whose BRR would pass 64 KB
  is offered disabled. Each encoding is
  kept per sample and factor while the dialog is open, encoded with `encodeBrrWithHeadroom` so no
  sample wraps the DSP's interpolation. A module holding more than one song shows
  a Song select; choosing another suggests its channels afresh and keeps each sample's choice.

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
- **BRR encoded inside `@amk/import`** — `planSample`, `brr-encode`, `eslint.config.js`
- **A short loop widened by raising the factor** — `loopRepeats`, `plannedFrames`
- **The song's bytes taken to be the same at every factor** — `firstFactor`, `autoFactor`
- **Songs found by an order walk apart from the player** — `findSongs`
- **Pan mapped straight onto y** — `panOf`, `heardAt`
- **Every sample slot its own BRR** — `copiesOf`, `sameAs`
