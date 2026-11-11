---
name: verify-change
description: Use before calling a change in this repository done, before committing, or when asked to test it. Says how to run only the checks that cover the files you touched, how to read a failure, then lint, check and build, and how to tell this machine's Node crashes from a real failure.
---

# Verifying a change

## 1. The checks for what you touched

`npm run affected`. It reads the files changed since `HEAD` (untracked ones too), and runs Prettier
and ESLint on them, the code map and citation checks, `tsc` for the workspaces involved, every
harness whose bundle imports one of them, and `i18n:check` when a template, a `$localize` or
`messages.en.json` changed. It prints what it selected and which file caused each selection, then
a table of results. `npm run affected -- --dry` prints the selection without running it;
`-- --since main` compares against a branch instead of `HEAD`; and
`npm run affected -- --dry <file> [<file> ...]` answers what covers the files named, whatever the
diff holds.

One harness on its own is `npm run <name>`; a passing run prints one line,
`<name>: N passed, 0 failed`.

- `HARNESS_ONLY=<section>[,<section>]` runs only those sections of a harness split into section
  files, named as the files under its `scripts/<name>/` are (`selftest`, `tokentest`,
  `palettetest`, `audiotest`, `walktest`, `charttest` and `rolltest` are split). PowerShell:
  `$env:HARNESS_ONLY='loop-resize'; npm run rolltest; Remove-Item Env:HARNESS_ONLY`. Bash:
  `HARNESS_ONLY=loop-resize npm run rolltest`.
- `HARNESS_VERBOSE=1` prints every `ok` line and section header.
- `node --enable-source-maps .selftest/<name>.mjs` runs the last bundle again without rebuilding
  it, which is the quickest way to tell a crash from a failure.

**No harness imports these**, so a green `affected` says nothing about them and only the running
app does (the `drive-the-app` skill): `roll-gesture.ts`, `roll-view.ts`, `roll-camera.ts`,
`roll-shortcuts.ts`, `editor-store.ts`, `editor-requests.ts`, `source-view`, `codemirror/*`, and
every component class and template. `affected` names the changed files that fall in this group.

What each harness proves: `scripts/CLAUDE.md`, and the rule for that harness in
`.claude/rules/harnesses/`, which loads when you open it.

## 2. The gates CI runs

`npm run lint`, then `npm run check`. `check` runs every step even after one fails and ends with a
table, so one run reports everything that is broken; its last step builds the app to extract its
messages, which is the only step that compiles the Angular templates — `npm run typecheck` does
not. After fixing something, `npm run check -- <step> [<step> ...]` runs only the steps named.
`npm run ci` is lint, check and `npm run build` in one command.

## 3. Depending on the change

- **Anything a porter sees**: watch it work in the running app with the `drive-the-app` skill.
- **Compiler bytes**: with AddmusicK to hand, diff against it with `scripts/Compare-SongBin.ps1`
  (the sharper one) or `scripts/Compare-Spc.ps1`.
- **A user-facing feature**: its changelog entry goes in `web/src/app/changelog/changelog-data.ts`
  in the same commit (root `CLAUDE.md`).

## Reading a failure

- **The table** at the end of `check` and `affected` gives each step's result, and under it, for
  each failure, its FAIL lines and the last lines of its output. The whole output of a step is in
  `.selftest/logs/<step>.log` (`i18n-check.log` for `i18n:check`).
- **A harness failure** prints `FAIL  <check name>  (<file>:<line> < <caller>:<line>)` and a detail
  line: the first location is where `check` was called, the second the line that called that
  helper. Failed names are listed again above the tally, `<name>: N passed, M failed`.
- **A JS throw** is a FAIL line as well, `FAIL  <section>: threw <message>`, with the stack under
  it. The other sections still run and the tally still prints.
- **Node crashes here are environmental.** Harnesses, `tsc`, `eslint` and `ng build` intermittently
  die below the JS layer with no stack: `Segmentation fault` and exit 139 in Bash,
  `Fatal error in , line 0` and exit 3, or in PowerShell no message at all and `$LASTEXITCODE` of
  `-1073741819` (`3221225477`, `0xC0000005`). `check` and `affected` retry such a step twice and
  report `crashed 1x, passed on retry`, which is a pass. Run by hand, re-run the same command; two
  crashes in a row are still the flake. `npm run lint` is not retried for you.
- **`CODEMAP.md is stale`**: `npm run codemap`. A file it names as having no doc comment needs one
  at its top.
- **`line citation(s) point outside what they cite`**: the comment or rule named on the left cites
  a line its target no longer has. Find where the cited code went and correct the number.
- **Prettier `--check`**: `npm run format`. The after-edit hook formats what Edit and Write touch;
  files changed any other way (a script, `git checkout`) are not covered.
- **Line endings**: `git ls-files --eol <files>` showing `w/lf` on a changed file means it came in
  around the hook. Pipe `{"tool_input":{"file_path":"<absolute path>"}}` into
  `node .claude/hooks/after-edit.mjs`, or run `unix2dos -q` on it.
