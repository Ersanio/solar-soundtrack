---
paths:
  - 'web/src/app/editor/views/piano-roll/roll-octave.ts'
  - 'web/src/app/editor/views/piano-roll/roll-write/octaves.ts'
---

# Piano roll: octaves

Read before changing `roll-octave.ts`, or anything that writes or removes an `o`, `<` or `>`.

## How it works now

**The invariant: an edit changes no note it did not ask to change.** Every note the gesture leaves
alone still sounds in the octave it was written in, and `rolltest` holds each edit to that through
the walk.

**The octave is one variable over the whole document** (`roll-octave.ts`). It starts at 4, no `#N`
resets it, and a loop body is parsed once where it is written, so text order is the whole answer.
`octaveModel` reads it off the token stream as events — an `o` sets, `<` and `>` shift, a note
reads — and `OctaveModel` answers `at`, `carry`, `next`, `first`, `nextAt`, `moves` and `shiftsIn`.
Where the text cannot say (a `"name=value"` replacement, or any `#if`) the answer is `null` and
every reader treats `null` as "restore": `BLIND_OCTAVES` is the model that knows nothing. Nothing
is guessed from neighbouring notes.

**The strip carries what each item needs** (`roll-strip.ts`): `Strip.octaves` is the model, built
by `checkedOctaves`; `StripItem.octave` is the octave the head was written under (`null` for a rest
or a construct), `exitOctave` the one in force after the unit where the unit moved it, and
`hasLeadingOctave` whether the unit already carries an `o`. A channel with a note whose octave
cannot be read is refused when the strip is built.

**Writing** (`roll-write/octaves.ts`, called from `plan-edits.ts`, `rewrite-note.ts`, `gaps.ts` and
`runs.ts`). A rewritten or drawn note spells its own absolute `o` (`octaveFor` and `spellOctave` in
`@amk/core/mml-text`); `<` and `>` in an edited channel are read, never refused. After it:

- `exitOctaveFor` puts the old octave back only where the next thing in the edited text reads it
  before something sets it; `writesItsOwnOctave`, `runBefore` and `underRun` are that question's
  parts, asked once for the whole plan so two frames cannot answer differently.
- `keptOctaves` says which of a removed note's own `o`s something still reads and so stay.
- `drumOctaves` restates the octave a drum's unit reached over, since a drum's text spells none.
- `deadOctaves` takes out the porter's `o`, `<` and `>` that the edit left with nothing to read
  them — spelling only, never music.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/piano-roll-octaves.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **A trailing octave run winning over a leading one** — `growUnits`
- **Refusing `<` and `>` in an edited channel** — `written`, `rolltest`, `planEdits`
- **Putting a drawn note's octave back at the end of its run** — `spawnInto`
- **Answering a deleted note's octave with `running = null`** — `rewriteNote`, `item.octave`,
  `keptOctaves`, `noteText`
- **Two passes each answering a note's octave for itself** — `planEdits`, `spawnInto`, `coalesce`,
  `runBefore`
- **Asking whether the note after a spawn can be left as it is by what stood _before_ the gap** —
  `untouched`
- **Reading a note's entering octave off `item.octave` alone** — `growUnits`, `unitSpan`,
  `rewriteNote`, `roll-octave.ts`, `exitOctaveFor`, `spliceRange`
- **Guessing the octave in force from the notes either side** — `MOVES_OCTAVE`, `item.octave`,
  `octaveModel`, `checkedOctaves`, `BLIND_OCTAVES`
- **Putting an octave back after every rewrite at the end of a channel** — `octave`, `octaveNext`,
  `OctaveModel.next`
- **Leaving a porter's octave an edit made unread** — `deadOctaves`
- **Letting a drum's unit carry an octave `noteText` cannot write back** — `leadsAUnit`,
  `drumOctaves`, `unitSpan`, `roll-write/`
