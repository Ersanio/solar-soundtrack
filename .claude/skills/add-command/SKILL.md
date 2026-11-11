---
name: add-command
description: Use when adding an MML or hex command, or changing an existing one's availability, name, argument count, meaning or glyph — the full list of registries one command byte lives in, from the compiler to the palette, and the harness that pins each.
---

# Adding or changing a command

One command's meaning is stated in about ten places, and no type ties them together. Miss one and
the song still compiles: the palette greys the wrong button, the roll draws no glyph, or the walk
mis-frames every byte after it. Work down the list and say for each step "changed" or "not
affected, because …".

Use the `VCMD` constant from `@amk/core/hardcoded-tables` where one exists; `packages/mml-compiler`
keeps its literals, which are `Music.cpp`'s.

## 0. Establish what AddmusicK does

1. **`COMMANDS.html`** at the repository root is the per-target truth table (`#amk 1`-`4`, `#am4`,
   `#amm`). Find the command's row and cite it. If the change contradicts the table, the table or
   the change is wrong; settle that first against `AddmusicKsrc/Music.cpp` and `main.asm`.
2. The compiler is not permissive in either direction (root `CLAUDE.md`). Availability and argument
   counts are AddmusicK's, per target, never a convenience.

## 1. Compiler (`packages/mml-compiler`, `.claude/rules/compiler.md`)

- `packages/core/src/hardcoded-tables.ts` `HEX_LENGTHS`: the byte's argument count, indexed from
  `FIRST_VCMD`. It is `Music.cpp`'s table; change it only with the cited line. `VCMD` in the same
  file names every byte `$DA`-`$FE`; a renamed command is renamed there.
- `parser.ts` `parseHexCommand` for a `$XX` (the `currentHex` / `hexLeft` / `currentHexSub`
  conditions carry every per-target rule and sub-command, e.g. `$FA`), or the letter's own
  `parse*` method reached from the `// prettier-ignore` dispatch table. Cite the `Music.cpp` lines.
- A new refusal or warning is a diagnostic: the `add-diagnostic` skill.
- Pinned by `selftest` (bytes and diagnostics).

## 2. Scanner and command model (`packages/mml-tokens`)

- `src/tokens.ts`: `VCMD_NAMES` or `LETTER_NAMES` (the name, a `$localize` ID under
  `command.name.*`), `vcmdName` (names that depend on a sub-command or the target), `expectedArgs`
  (how many arguments at this target, with these leading bytes) and `scanHex` (the scanner's
  mirror of `hexLeft`). `expectedArgs` and `scanHex` must agree with `parseHexCommand`.
- `src/commands/hex-params.ts` `HEX_PARAMS` or `letter-params.ts` `LETTER_PARAMS`: what each
  argument means, named as `AddmusicKreadme`'s hex command reference names it; `units.ts` for a new
  unit. Every name and note is a `$localize` message (`command.*`, `inspector.*`).
- `src/commands/availability.ts`: whether each dialect takes the command, restating the parser's
  conditions for a palette that asks before the text exists.
- `src/commands/in-force.ts` `commandScope`: `SONG_VCMDS`, `STRUCTURE_VCMDS` or the letter sets.
  Unlisted VCMDs are `'note-state'` and get a glyph on bars.
- `src/dialect.ts` if the command changes what is in force for later ones (tempo, velocity table,
  the `$FA $06` switch); `echo-hazards.ts`, `fir-override.ts`, `command-hazards.ts` if it can
  compile clean and misbehave.
- Pinned by `tokentest` (scanner against compiler, `VCMD_NAMES` coverage, scopes) and `edittest`
  (splices).

## 3. The walk (`packages/spc`, `.claude/rules/commands-in-the-roll.md`)

- `src/song-walk.ts` `vcmdLength`: variable-length forms (`$FA $FE`, `$FB`, `$FC`). A wrong length
  mis-frames everything after it.
- `src/slots.ts` `slotsOf(vcmd, sub)`: which `StateSlot` the command writes or clears; a new slot
  is added to `StateSlot` and `SLOTS`. `replacedByNextInSlot` if it supersedes.
- `runCommand`: what it does to `NoteState`, the tempo, the loop stack.
- `src/repeat-settings.ts` `settingChanges`, with `CHANNEL_SETTINGS` / `SONG_SETTINGS`, if the
  setting carries into the song's repeat (`SST0510`-`SST0512`).
- Pinned by `walktest` (`scripts/walktest/command-lengths.ts`, `command-list.ts`,
  `in-force-named.ts`, `repeat-settings.ts`).

## 4. Palette, glyph and inspector (`web/`, `.claude/rules/inspector-and-palette.md`)

- `web/src/app/editor/command-palette/catalog.ts` `ENTRIES`: one `hex(…)`, `letter(…)` or
  `syntax` entry with its category, icon, blurb and default snippet. A byte a letter writes is
  named by that entry's `writes`; one that must not be offered is `withheld`, never omitted —
  `glyph-of.ts` reads the same table backwards for the roll's bars.
- A new icon is a name in `GLYPH_NAMES` (`command-icon.ts`) and a `@case` in `command-icon.html`.
- `web/src/app/output/command-inspector/command-inspector.ts` `view`: only if the command gets a
  panel of its own instead of the parameter table; the panel is a folder beside the others and a
  `@case` in `command-inspector.html`.
- Pinned by `palettetest`: every entry compiled at every dialect against `availability.ts`, every
  `VCMD_NAMES` byte resolving to a glyph, no two entries sharing a label.

## 5. Text

Every ID added above needs its English in `web/src/locale/messages.en.json`: the `add-ui-text`
skill. `npm run i18n` adds the stubs.

## 6. Finish

- Update the command's row in `COMMANDS.html` if its facts changed.
- A new user-facing command or panel gets a changelog entry (root `CLAUDE.md`).
- Run the harnesses named above, then the `verify-change` skill.
