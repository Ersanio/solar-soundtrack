---
name: verify-change
description: Use before calling a change in this repository done, before committing, or when asked to test it. Says which harnesses cover the files you touched, how to run them so a failure stays visible, then lint, check and build, and how to tell this machine's Node crashes from a real failure.
---

# Verifying a change

## 1. The harnesses for what you touched, quietly

`HARNESS_QUIET` drops the `ok` lines, so a failure is not lost among a thousand passes. In
PowerShell: `$env:HARNESS_QUIET=1; npm run rolltest`. In Bash: `HARNESS_QUIET=1 npm run rolltest`.

| You touched                                                                                                                     | Run first                                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/mml-compiler`, `packages/core`                                                                                        | `selftest`, then `palettetest` (its oracle is the compiler) |
| the `@amk/tokens` scanner, `dialect.ts`, `command-hazards.ts`, `commands/describe`, `in-force`                                  | `tokentest`                                                 |
| `@amk/tokens` `edits.ts`, `commands/instruments.ts`                                                                             | `edittest`, `instrtest`                                     |
| `commands/loops`, `remote`, `availability`; the command palette; `loop-focus.ts`, `remote-focus.ts`                             | `palettetest`                                               |
| `packages/spc` `adsr`, `instruments`, `brr`, `fir`; `echo-hazards`, `fir-override`                                              | `adsrtest`, `instrtest`, `brrtest`, `firtest`               |
| `packages/spc` `export`, `layout`, `driver`                                                                                     | `spctest`, `audiotest`                                      |
| `packages/spc` `worklet`, `player`, `protocol`, `wasm-host`, `driver-state`, `note-audition`                                    | `worklettest`, `audiotest`                                  |
| `song-walk.ts`; `state/` `song-clock`, `measure-clock`, `repeat-carry`, `command-timeline`, `commands-in-force`                 | `walktest`, then `rolltest`                                 |
| the roll's editing: `roll-edit`, `roll-strip`, `roll-write/`, `roll-octave`, `roll-command-move`, `roll-seed`, `roll-selection` | `rolltest`                                                  |
| the roll's layout, lanes, marks, clock, lengths; `shared/chart`; the slider track; `transport-view`                             | `charttest`                                                 |
| any text a porter reads: a template, a `$localize`, `messages.en.json`                                                          | `npm run i18n:check`                                        |
| a new or renamed source file, or a file's opening comment                                                                       | `npm run codemap`                                           |

What each harness proves: `scripts/CLAUDE.md`, and the rule for that harness in
`.claude/rules/harnesses/`, which loads when you open it.

## 2. The gates CI runs

`npm run lint`, then `$env:HARNESS_QUIET=1; npm run check`. `check` ends by building the app to
extract its messages, which is the only step that compiles the Angular templates —
`npm run typecheck` does not.

## 3. Depending on the change

- **Anything a porter sees**: watch it work in the running app with the `drive-the-app` skill.
- **Compiler bytes**: with AddmusicK to hand, diff against it with `scripts/Compare-SongBin.ps1`
  (the sharper one) or `scripts/Compare-Spc.ps1`.
- **A user-facing feature**: its changelog entry goes in `web/src/app/changelog/changelog-data.ts`
  in the same commit (root `CLAUDE.md`).

## Reading a failure

- **Node crashes here are environmental.** Harnesses, `eslint` and `ng build` intermittently die
  below the JS layer — `Segmentation fault`, exit 139, or `Fatal error in , line 0` (exit 3), with
  no stack. Re-run the same command; two crashes in a row are still the flake. When one aborts
  `npm run check` mid-chain, run the remaining steps on their own rather than starting over.
- **A harness failure** prints `FAIL  <check name>` and a detail line, and the tally reads
  `N check(s) failed`. Search the output for `FAIL`.
- **`CODEMAP.md is stale`**: `npm run codemap`. A file it names as having no doc comment needs one
  at its top.
- **Prettier `--check`**: `npm run format`. The after-edit hook formats what Edit and Write touch;
  files changed any other way (a script, `git checkout`) are not covered.
- **Line endings**: `git ls-files --eol <files>` showing `w/lf` on a changed file means it came in
  around the hook. Pipe `{"tool_input":{"file_path":"<absolute path>"}}` into
  `node .claude/hooks/after-edit.mjs`, or run `unix2dos -q` on it.
