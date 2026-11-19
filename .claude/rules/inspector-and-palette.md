---
paths:
  - 'web/src/app/output/command-inspector/**'
  - 'web/src/app/editor/command-palette/**'
  - 'packages/mml-tokens/src/{command-hazards,edits}.ts'
  - 'packages/mml-tokens/src/commands/{param,hex-params,letter-params,units,describe,remote,instruments}.ts'
---

# Inspector and palette

Read before changing the command inspector, a note's Length row, the instrument picker, the
command palette, the `$DD` and `q` readouts, the bend graph or the FIR designer.

The inspector's rows come from the descriptor tables in `@amk/tokens/commands` and its writes from
`@amk/tokens/edits`, which is why those files load this rule; `packages/mml-tokens/CLAUDE.md`
describes both. Adding or changing a command is the `add-command` skill.

`fir-graph`'s frequency axis is **linear**, DC to Nyquist, which is not what an audio plot usually
does. Eight taps at 32 kHz have no authority below a couple of kHz, so a log axis would spend most
of its width on the part of the spectrum the filter cannot address, and push the nulls and ripple
that actually distinguish one filter from another into a corner. The cost is that hearing is
logarithmic and this is not.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/inspector-and-palette.md` — read it
before proposing a redesign in this area, or when a title below matches what you are about to do.
A new entry goes there, with its line here, in the same change.

- **Auto-scaling the bend graph to the further end of the bend**
- **A tone slider in the FIR designer** — `designTone`, `Warm`, `Dark`, `Bright`
- **Clearing the inspector by moving the caret off what it was answering about** — `commandAt`,
  `tokens.ts`, `EditorRequests.dismissed`
- **The instrument picker normalising every pick to a plain `@n`** — `instrumentByte`, `edittest`
- **A note's Length row as a `ParamDescriptor` over `command.args`** — `resolveCommand`, `Length`,
  `getNoteLength`, `NoteLengthSegment`, `note-length/length-rows.ts`, `insertAt`, `spliceRange`,
  `Music.cpp:2950`
- **Taking the digits back out when a slider lands on the `l`'s own value**
- **A `Write byte` button, and then deleting the row to take it away** — `Commands.asm:633`,
  `SST0506`, `glyphOf`, `palettetest`, `chipWrite`, `OFFERED`, `ENTRIES`, `caveat`
- **Yellow on a palette button, for a `caution` availability and for a `caveat`** — `palettetest`,
  `packages/mml-tokens/CLAUDE.md`, `blocked`, `SST0506`, `SST0508`, `command-hazards.ts`, `muted`,
  `roll-toolbar.html`
- **Answering “is this `$DD` armed” with a tick count and a `null`** — `accumulateTiedLength`,
  `bendAnchor`, `COMMANDS.html`
- **A `$DD` behind another read as having nothing in front of it** — `bendAnchor`,
  `main.asm:3247-3249`, `TokenIndex.ties`, `crowded`, `SST0507`
- **A slide's room read off the note in front of it alone** — `emitNote`, `BendAnchor.window`,
  `TokenIndex.ties`, `Command`
- **`q`'s high nybble read as a percentage of the note** — `noteFrames`, `frameSoundingTicks`,
  `noteSoundingTicks`, `@amk/core`, `walktest`
- **The `$DD` bend graph drawn against `o4 c` as a stand-in** — `NoteAddress.note`, `bendAnchor`,
  `slide-start.ts`, `WalkNote.bend`
- **The vibrato readout measured from the emitted byte** — `vibrato-swing.ts`, `NoteAddress.written`
- **The arpeggio inspector stating that several loop points are written** — `hazard`, `SST0517`,
  `command-hazards.ts`, `hazard-fixes.ts`
