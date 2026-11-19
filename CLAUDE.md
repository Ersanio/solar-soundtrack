# CLAUDE.md

Solar Soundtrack — a browser-based AddmusicK 1.0.11 MML editor. It compiles MML to N-SPC song data,
assembles a playable `.spc`, and plays it through an emulated SPC700, entirely client-side. No ROM,
no AddmusicK install, no server.

## Finding your way

The repository is organised for Claude Code to read. `docs/` belongs to the project's author (the
mdBook guide and their own README) and is not guidance for you.

- **`CODEMAP.md`** lists every source file with the first sentence of its doc comment, by
  directory. Read it first when looking for where something lives. It is generated
  (`npm run codemap`), and `npm run check` fails when it is stale or a source file has no doc
  comment — so every new file opens with one.
- **Nested `CLAUDE.md` files load by themselves** once you touch a file under them:
  `packages/<pkg>/CLAUDE.md` (each package's long explanations), `web/CLAUDE.md` (the app's
  structure and Angular conventions), `scripts/CLAUDE.md` (the harnesses).
- **`.claude/rules/*.md` load by themselves** once you read or edit a file their `paths:` cover.
  Each holds one area's rules, how it works now, and a one-line-per-entry index of its **Decisions
  already made**; the table of rules is at the end of this file. If unsure which applies, grep
  `.claude/rules/` for the identifier you are about to touch — the index lines name their
  identifiers.
- **`.claude/ledgers/<rule>.md` never load by themselves.** Each is the full text behind a rule's
  index: the designs already built or considered there and moved away from, with the reasons. Read
  the matching one before proposing a redesign in an area, or when an index line matches what you
  are about to do.
- **Skills** in `.claude/skills/`: `verify-change` (what to run before calling a change done),
  `drive-the-app` (driving the running editor in a headless browser), and a checklist each for
  `add-command`, `add-diagnostic`, `add-ui-text`, `add-component` and `add-harness`.
- **A hook** runs after every Edit and Write (`.claude/hooks/after-edit.mjs`): it puts back the
  working tree's CRLF endings, runs Prettier on the file, and reports a parse error back to you.
- **`COMMANDS.html`** is the per-target truth table for every MML and hex command. Consult and cite
  it before changing a command's availability, name or argument count.

## Layout

An npm workspace. **Every command runs from the repository root.**

```
packages/core/          @amk/core      types, AddmusicK's tables, hex
packages/mml-compiler/  @amk/compiler  preprocess -> parser -> link
packages/mml-tokens/    @amk/tokens    scanner, splices, command model
packages/spc/           @amk/spc       BRR, echo FIR, ARAM, emulator, worklet
web/                    the Angular editor
scripts/                the byte-level harnesses, the code map, the i18n catalog
.claude/                rules, ledgers, skills, the after-edit hook
docs/                   the author's guide and README; deployed beside the app under docs/
```

```
@amk/core      → nothing
@amk/compiler  → core
@amk/spc       → core
@amk/tokens    → core, and @amk/spc/{adsr,fir}
web            → all four
```

`AddmusicKsrc/` and `AddmusicKreadme/` hold a local copy of AddmusicK 1.0.11's C++ sources and its
readme. They are **gitignored and not part of the repository**, but they are the reference
implementation this project is a port of and the code cites them constantly — take them from an
AddmusicK release if they are missing.

## Commands

Node 24 is what CI uses. CI runs `npm run lint` then `npm run check`.

| Command             | What it does                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------- |
| `npm start`         | Dev server on `http://localhost:4200/`.                                                  |
| `npm run build`     | Production build into `web/dist/`.                                                       |
| `npm run watch`     | Dev-configuration build with `--watch`, no server.                                       |
| `npm run lint`      | ESLint over every workspace.                                                             |
| `npm run format`    | Prettier over the workspace.                                                             |
| `npm run typecheck` | The app. `:packages` and `:scripts` cover the rest.                                      |
| `npm run start:ids` | The dev server with every message showing its i18n ID instead of its English.            |
| `npm run i18n`      | Adds new IDs to `web/src/locale/messages.en.json`, the English, and drops removed ones.  |
| `npm run codemap`   | Rewrites `CODEMAP.md` from the source files' doc comments.                               |
| `npm run check`     | The merge gate: formatting, code map, citations, typechecks, the harnesses, the English. |
| `npm run affected`  | Only the checks that cover the files changed since `HEAD`; `-- --dry` lists them.        |
| `npm run ci`        | What CI gates on plus the deploy build: lint, check, build.                              |
| `npm run drive`     | Drives a built app in headless Edge and prints a JSON snapshot (`drive-the-app` skill).  |

`check` runs every step even after one fails, retries a step that dies in a Node crash, keeps each
step's output in `.selftest/logs/<step>.log` and ends with a table; `-- --bail` stops at the first
failure and `-- pianorolltest i18n:check` runs named steps. Harnesses print one tally line unless a check
fails; `HARNESS_VERBOSE=1` shows every `ok`, and `HARNESS_ONLY=<section>` runs one section of a
sectioned harness. The detail: `scripts/CLAUDE.md` and the `verify-change` skill.

`npm run typecheck` does **not** compile Angular templates — `tsc` does not run the template
compiler, so a bad binding (`viewBox=` instead of `[attr.viewBox]=`) passes it. `npm run check`
does, last: `i18n:check` builds the app to extract its messages. Run `check`, `npm run build` or
`npm start` before believing a UI change.

**Automatic pre-hooks.** Never invoke these by hand — the `pre*` scripts run them, and all three
write generated, gitignored output: `build:worklet` bundles the AudioWorklet, `sync-spc-assets`
mirrors `packages/spc/assets/` (the only source of truth) into `web/public/`, and
`generate-git-info` writes the top bar's commit link, captured once at startup, so restart
`npm start` after committing. Which hook runs which: `.claude/rules/tooling.md`.

**Tests.** There are no `.spec.ts` files and no `npm run test` — the suite is the harnesses
under `scripts/`, and `scripts/CLAUDE.md` says what each one proves; several of those assertions are
load-bearing in ways the name does not suggest. `scripts/Compare-Spc.ps1` and
`scripts/Compare-SongBin.ps1` diff output against a real AddmusicK build. Those establish fidelity;
the harnesses only catch gross breakage.

## Rules

**The port cites its source.** Comments throughout reference `Music.cpp:3209`, `AddmusicK.cpp:1138`,
`globals.cpp:735`, `main.asm` and so on, against AddmusicK 1.0.11 in `AddmusicKsrc/`. Read the cited
lines before changing compiler behaviour, and cite the lines you port. Behaviour that looks strange
is almost always strange in the original too — reproduce it and say so in a comment.

**The compiler is not permissive.** A song written here is going into AddmusicK, so a divergence in
either direction is a bug: accepting what AddmusicK rejects means it compiles, plays, and then the
real tool refuses it; rejecting what AddmusicK accepts means a working song is turned away. Where
AddmusicK is case-sensitive, so is this — `#Title`, `"kick.BRR"` and `#DEFINE` are all errors, and
`#SAMPLES` is not, because `strnicmp` is what the reference uses there. Convenience is never a
reason to widen what is accepted, and neither is helpfulness a reason to narrow it: an unknown
`#directive` is read as music and `*` with no previous loop emits a call to nowhere, because that is
what the reference does. `#path` is the one deliberate divergence, and why it alone qualifies is in
`.claude/rules/compiler.md`. `packages/mml-compiler/AUDIT.md` is the record of the last line-by-line
comparison.

**`packages/mml-compiler` is not linted, and its comments are not thinned.** It is a port, and style
rules would make it harder to diff against the C++ that is the only check on its faithfulness. It
gets one ESLint rule, an import boundary. Prettier still runs. Outside the compiler, keep added
comments short.

**Comments describe the code as it is, not as it was.** No "it used to", "this replaced", "which is
where it was", "the bug this exists to fix", "before this existed". A comment that says "it was once
X, and X was wrong because Y" has one useful sentence — the present-tense reason for the shape it has
now — and the rest is history: state the reason and stop, or state Y as a plain counterfactual ("a
spread would take whatever is in storage on trust"). Harness comments say what is pinned, not what
once broke. This applies to the `CLAUDE.md` files and rules too. The git log holds what changed; a
shape that was moved away from and is worth not proposing again goes in the matching rule's ledger,
`.claude/ledgers/<rule>.md`, with a one-line entry in that rule's **Decisions already made** index,
in the same change, and nowhere in the source. (`AUDIT.md`, the
changelog and `.git-blame-ignore-revs` are records by genre and are outside this.)

**Package boundaries are a lint rule.** npm links every workspace into `node_modules/@amk`, so
TypeScript resolves a sibling package however the tsconfigs are written; `no-restricted-imports` in
`eslint.config.js` is what actually holds the graph. Adding an edge means changing that rule
deliberately.

**Ticks, not seconds.** Anything that follows the music stores and accepts driver ticks and nothing
else, and anything that turns ticks into seconds goes through `EditorStore.clock`; a formula over
tempo drifts, because the driver drops ticks. The full rule: `.claude/rules/transport-and-clock.md`.

**`sampleList: null` is not `[]`.** `null` leaves the driver's default set standing; `[]` asks for no
samples. The list's _order is the SRCN assignment_, so it is a correctness-critical output, not a
statistic (`packages/mml-compiler/CLAUDE.md`).

**Diagnostics carry source spans and stable codes.** `AMK####` is a condition AddmusicK itself
reports, `SST####` one it does not produce; spans go through `spanAt`; constructs this compiler does
not implement are errors, never silent mis-compiles. The detail: `.claude/rules/compiler.md` and the
`add-diagnostic` skill.

**Text a porter reads is written by its i18n ID.** Templates take `i18n="@@group.name"` with the
ID as their text, TypeScript and the packages `` $localize`:@@group.name:group.name` ``, and the
words are in `web/src/locale/messages.en.json`, grouped by where they are read. Change wording
there, not in the code. A string that is compared or stored is a key, never text. The scheme:
`.claude/rules/i18n.md`.

**Accessibility is not supported.** The app ships no ARIA attributes and no `role` or `tabindex`,
and none are planned. `angular.configs.templateAccessibility` is therefore absent from the
template lint block, and the "Accessibility Requirements" section of `web/.claude/CLAUDE.md` does
not apply here — that file is generated by the Angular CLI and kept byte-identical to what the CLI
emits, so the override is stated here instead. The global `:focus-visible` outline is a different
concern and must not be removed by components.

**This repository's conventions override generic Angular advice**, which means
`web/.claude/CLAUDE.md` and any locally installed Angular skill, wherever the two disagree.
A component's template is an external `templateUrl` unless it is one element or `<ng-content />`,
and it has no component stylesheet. Singletons are `@Service()` classes in `web/src/app/state/`.
There is no router and no lazy loading. State is signals: no `async` pipe, and an observable only
where an Angular API hands one over, turned into a signal at once (`update-banner.ts`). There are
no `.spec.ts` tests and no component test harnesses — the harnesses under `scripts/` are the
suite. `web/CLAUDE.md` has the conventions and the `add-component` skill the checklist.

**The changelog is part of the feature.** `web/src/app/changelog/changelog-data.ts` backs the top
bar's changelog popup. A commit that adds or materially changes a user-facing feature adds its entry
**in the same commit** — a new block at the top of `CHANGELOG` if the date is new, otherwise one more
string in the existing block for that date. Write for **music porters, not developers**, as a short
phrase naming the feature: "Sample browser & importer", not a sentence about how it works.
Refactors, internal work and small fixes get no entry. It is hand-written and never generated from
commit subjects.

**Formatting, linting and deployment.** Prettier owns formatting in two profiles — tabs, double
quotes, width 120 for the TypeScript under `packages/` and `scripts/`; 2 spaces, single quotes,
width 100 for everything else, `web/` and `scripts/*.mjs` included — and the hook runs it on each
file you edit; never hand-format. `eslint.config.js` at the root is the
one config for every workspace, and several rules are deliberately **off** with the reasoning
inline. CI deploys `main` to GitHub Pages through `npm run build`, never `ng build`, which skips the
prebuild hooks. All three in detail: `.claude/rules/tooling.md`.

## Rules index

Each loads by itself once you read or edit a file it covers (its `paths:` frontmatter). A new
ledger entry goes in `.claude/ledgers/<rule>.md` for the area it belongs to, with its one-line
index entry in the rule, in the same change; if no rule fits, add one with a `paths:` list, a
ledger beside the others and a row here. A ledger file has no frontmatter, and nothing under
`.claude/rules/` may lack `paths:`, since such a file would load in every session.

| Rule                         | Covers                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport-and-clock.md`     | the transport, the seek bar, the playhead, `Playback`, `Mixer`, the worklet, the clock measurement, anything that turns ticks into seconds               |
| `audition.md`                | the note and region preview: `Audition`, `note.worker.ts`, the fast-forward and voice parking, the two AudioContexts                                     |
| `piano-roll-architecture.md` | how the piano roll is put together: what it draws from, layout, lanes, percussion, which module owns what                                                |
| `piano-roll-view.md`         | the roll's camera, scrub and overview bars, grid, cursor, hover, pointer handling, selection and toolbar                                                 |
| `piano-roll-editing.md`      | how a roll gesture becomes text: `roll-edit.ts`, `roll-write/`, `roll-strip.ts`, `roll-gesture.ts`, rests, padding, drums, opening a channel             |
| `piano-roll-octaves.md`      | `roll-octave.ts`, or anything that writes or removes an `o`, `<` or `>`                                                                                  |
| `loops.md`                   | loop boxes, wrap, join and split, `roll-loops/`, the loop inspector and `loop-focus.ts`, `(n)m` and `*`                                                  |
| `commands-in-the-roll.md`    | command glyphs on bars, the command lane, `commands-in-force.ts`, `command-timeline.ts`, `song-walk.ts`'s slots                                          |
| `inspector-and-palette.md`   | the command inspector, a note's Length row, the instrument picker, the command palette, the `$DD` and `q` readouts, the bend graph, the FIR designer     |
| `compiler.md`                | `packages/mml-compiler`, the `@amk/tokens` scanner, diagnostics, `#path`                                                                                 |
| `state-and-editor.md`        | `EditorStore`'s scan and compile, the write-back path through `EditorRequests`, `DriverStore`, `SampleStore`, the CodeMirror adapter, the sample browser |
| `problems.md`                | the Problems list: its fixes, the fix dialog and its diff, suppression and the top bar's list of suppressed warnings, `fixtest`                          |
| `song-inspector.md`          | the Song Inspector tab, the top bar's spectrum, `SongAnalyzer` and its worker, the live voice capture, the canvas colours                                |
| `i18n.md`                    | any text a porter reads: templates, `$localize`, the AMK/SST catalogs, command names and descriptions, `web/src/locale/messages.en.json`                 |
| `ui-and-theme.md`            | `styles.css` colours, `ThemeStore` and presets, the panes, sidebar, tabs and shared controls                                                             |
| `tooling.md`                 | the pre-hooks, `eslint.config.js`, `.prettierrc`, CI and deployment, the after-edit hook                                                                 |
| `harnesses/<name>.md`        | what each harness proves, loaded with that harness                                                                                                       |
