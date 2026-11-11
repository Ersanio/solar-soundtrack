---
paths:
  - 'web/src/app/state/{commands-in-force,command-timeline}.ts'
  - 'packages/spc/src/{song-walk,song-walk-types,slots}.ts'
  - 'packages/mml-tokens/src/commands/in-force.ts'
  - 'web/src/app/editor/views/piano-roll/roll-command-*.ts'
  - 'web/src/app/editor/views/piano-roll/roll-command-lane/**'
---

# Commands in the roll

Read before changing command glyphs on bars, the command lane, `commands-in-force.ts`,
`command-timeline.ts`, or the walk's slots (`packages/spc/src/slots.ts`).

## How it works now

A command is drawn in two places that answer different questions: a **glyph on a bar** says which
commands that note plays under, and the **command lane** says the tick the driver reads each
command on. Neither is derived from the other, and neither reads the text around a note to decide.

**The walk is the authority for anything that emits a VCMD** (`packages/spc/src/song-walk.ts`, with
its slots in `slots.ts` and its public model in `song-walk-types.ts`, both re-exported from it):

- `StateSlot` / `SLOTS` is what `main.asm` keeps where; two commands sharing a slot supersede each
  other. `slotsOf(vcmd, sub)` says which slot a command writes or clears, and is the one table to
  extend for a new command.
- `runCommand` dispatches each VCMD and calls `recordOrigin`, the one place a slot changes hands.
  It stores the command's ARAM address in the channel's or the song's `origins` and raises a
  `WalkCommand` into `SongTimeline.commands`; a write of the address a slot already holds raises
  nothing.
- `emitNote` freezes the origins onto each `WalkNote` (`origins`, indexed as `SLOTS`), with
  `drumFrom` for the note whose drum byte loaded the sample in force and `bendFrom` for a `$DD`
  the note's read-ahead swallowed. `$DD` fills no slot; its `WalkCommand` is raised from its own
  arm.
- Nothing inside a `$FC` body is followed, and a rest pushes no `WalkNote`, which is why the lane
  reads `SongTimeline.commands` and not the notes.

**The source is the authority for what emits nothing** (`@amk/tokens/commands/in-force`):
`parseTimeInForce` answers `q`, `h` and `@21`-`@29` in text order, exactly as `parser.ts` folded
them. `commandScope` sorts every command into `'note-state'`, `'song'`, `'position'` or
`'structure'` and is the one statement of what reaches a glyph. The two sets are disjoint, and
`tokentest` asserts it.

**The joins are in `web/src/app/state/`**, outside the store so `walktest` can pin them:
`commandsInForceOf` (`commands-in-force.ts`) turns a `WalkNote` into its `Command`s through
`CompileResult.commandMap`, `definedAt` says which of them the note puts in force by comparing
command identity with the note before it on the channel (`notePreceding`), and `commandTimeline`
(`command-timeline.ts`) is the lane's list — `'song'` and `'note-state'` commands, whole-song, once
per compile.

**Geometry is the roll's**: `roll-command-layout.ts` (`packCommandLane`, `laneGlyphX`,
`laneWindow`; `charttest`) packs rows over the whole song with the edited channel first and drops
or dims what the mixer silences; `roll-command-move.ts` (`commandMoveTargets`, `planCommandMove`,
`commandMoveRefusal`; `rolltest`) plans a glyph's sideways drag; `roll-command-lane/` draws and
takes the pointer. A bar's own glyphs are fitted by `fitBarContent` in `roll-bar-text.ts`.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/commands-in-the-roll.md` — read it
before proposing a redesign in this area, or when a title below matches what you are about to do.
A new entry goes there, with its line here, in the same change.

- **Answering "which commands act on this note" from the source alone** — `commandMap`
- **`Command.channel` left `undefined` above the first `#N`** — `detectStartingChannel`,
  `parseTimeInForce`
- **Naming a note's drum `@` from the note's own text** — `WalkNote.drumFrom`, `parseTimeInForce`,
  `commands-in-force.ts`
- **Tinting the glyph a note puts in force, and finding it by comparing `origins` arrays** —
  `--color-accent`, `--color-ch-0`, `--color-warn`, `--color-ch-3`, `--color-good`, `--color-ch-2`,
  `roll-notes.html`, `--color-surface`
- **Drawing a bar's glyphs in the walk's slot order alone** — `fitBarContent`, `SLOTS`, `buildMarks`
- **The command lane as the complement of the bars, holding only what no bar stands over** —
  `WalkCommand.onANote`, `origins`, `command-timeline.ts`, `commandScope`, `commandsInForceOf`,
  `onANote`, `Track.owners`
- **Reading the lane off `definedAt` alone** — `emitNote`, `WalkNote`, `origins`, `WalkCommand`,
  `recordOrigin`
- **A native `overflow-y-auto` on the command lane** — `roll-view.md`
- **Packing the lane over the window on screen** — `tickWindow`, `packCommandLane`, `laneWindow`,
  `depth`
- **A muted channel's commands dimmed rather than dropped, the way its bars are** — `commandScope`,
  `packCommandLane`, `command-timeline.ts`
- **Packing the lane without regard to which channel is being edited** — `packCommandLane`,
  `editChannel`, `editing`
- **A row cap on the command lane, with the rest of a column drawn as three dots** —
  `packCommandLane`, `depth`, `fitBarContent`
- **`$DD` filed as a state slot, the way `$DE` and `$ED` are** — `slotsOf`, `origins`,
  `recordOrigin`, `track.ticks`, `drumFrom`, `WalkNote.bendFrom`, `commands-in-force.ts`,
  `definedAt`
- **The selected command's `Delete` falling through to the notes where the command cannot go** —
  `eraseCommand`, `inspectable`, `commandAtCaret`, `Command`, `commandAt`
- **`inspecting.set(null)` taken as the lane letting go of the selected note** —
  `EditorRequests.inspecting`, `gestures.selection()`, `Delete`, `commandPicked`,
  `RollNotes.channelPicked`, `RollNotes`, `inspecting`
- **A bar's chip leaving its note outlined, so a commit from the panel had something to replay** —
  `gestures.selection()`, `EditorRequests.inspecting`, `Delete`, `inspecting`, `click`,
  `pointerdown`
- **The bar's selection ring in the lane's `stroke-ink`, the way the lane draws it** —
  `roll-notes.html`
- **Ringing a bar's `more` dots when the selected command is one they stand for** — `defining`,
  `MarkGlyph.command`
- **A lane glyph clearing `inspecting`, as naming a command of the song rather than a note of it** —
  `noteHeardOn`, `commandsInForce`, `walktest`
