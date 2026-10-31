# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

Solar Soundtrack — a browser-based AddmusicK 1.0.11 MML editor. It compiles MML to N-SPC song data,
assembles a playable `.spc`, and plays it through an emulated SPC700, entirely client-side. No ROM,
no AddmusicK install, no server.

## Layout

An npm workspace. **Every command runs from the repository root.**

```
packages/core/          @amk/core      types, AddmusicK's tables, hex
packages/mml-compiler/  @amk/compiler  preprocess -> parser -> link
packages/mml-tokens/    @amk/tokens    scanner, splices, command model
packages/spc/           @amk/spc       BRR, echo FIR, ARAM, emulator, worklet
web/                    the Angular editor
scripts/                fourteen byte-level harnesses
```

```
@amk/core      → nothing
@amk/compiler  → core
@amk/spc       → core
@amk/tokens    → core, and @amk/spc/{adsr,fir}
web            → all four
```

Each package has a `README.md` and that is where the long explanations live — the port's citation
convention, why the driver is observed rather than predicted, what the scanner can and cannot mirror
from the parser, what the harnesses actually prove. Read the one for the package you are changing.

`AddmusicKsrc/` and `AddmusicKreadme/` hold a local copy of AddmusicK 1.0.11's C++ sources and its
readme. They are **gitignored and not part of the repository**, but they are the reference
implementation this project is a port of and the code cites them constantly — take them from an
AddmusicK release if they are missing.

## Commands

Node 24 is what CI uses. CI runs `npm run lint` then `npm run check`.

| Command             | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `npm start`         | Dev server on `http://localhost:4200/`.                               |
| `npm run build`     | Production build into `web/dist/`.                                    |
| `npm run watch`     | Dev-configuration build with `--watch`, no server.                    |
| `npm run lint`      | ESLint over every workspace.                                          |
| `npm run format`    | Prettier over the workspace.                                          |
| `npm run typecheck` | The app. `:packages` and `:scripts` cover the rest.                   |
| `npm run check`     | The merge gate: formatting, three typechecks, all fourteen harnesses. |

`npm run check` does **not** compile Angular templates, and neither does `npm run typecheck` — `tsc`
does not run the template compiler, so a bad binding (`viewBox=` instead of `[attr.viewBox]=`)
passes `check` and fails only at `npm run build` / `npm start`. Run one of those before believing a
UI change.

### Automatic pre-hooks

Never invoke these by hand — the `pre*` scripts run them, and all three write generated, gitignored
output: **`build:worklet`** bundles the AudioWorklet, **`sync-spc-assets`** mirrors
`packages/spc/assets/` (the only source of truth) into `web/public/`, and **`generate-git-info`**
writes the top bar's commit link, captured once at startup, so restart `npm start` after
committing. Which hook runs which, and why each exists: `docs/claude/tooling.md`.

### Tests

There are no `.spec.ts` files, and no `npm run test` — the suite is the fourteen harnesses under
`scripts/`; **`scripts/README.md` says what each one proves**,
and several of those assertions are load-bearing in ways that are not obvious from the name.

`scripts/Compare-Spc.ps1` and `scripts/Compare-SongBin.ps1` diff output against a real AddmusicK
build. Those are what establish fidelity; the harnesses only catch gross breakage.

## Rules

**The port cites its source.** Around 350 comments reference `Music.cpp:3209`, `AddmusicK.cpp:1138`,
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
what the reference does. `packages/mml-compiler/AUDIT.md` is the record of the last line-by-line
comparison.

**`#path` is the one deliberate divergence, and the bar it had to clear is high.** It is read,
validated and applied to nothing (`parsePath`, `SST0504`), because the reference behaviour has
nothing to mean here: `basepath` is a directory prefix resolved against a filesystem, and the host's
library is one flat list of filenames matched verbatim, so a prefixed name resolves to nothing and
every sample under a `#path` fails with AMK0058. That is not the same as finding the reference
unhelpful — the two constructs above are unhelpful and were kept. Nothing else earns this: a second
divergence needs the reference behaviour to be undefined here, not merely inconvenient.

**`packages/mml-compiler` is not linted, and its comments are not thinned.** It is a port, and style
rules would make it harder to diff against the C++ that is the only check on its faithfulness. It
gets one ESLint rule, an import boundary. Prettier still runs.

**Comments describe the code as it is, not as it was.** No "it used to", "this replaced", "which is
where it was", "the bug this exists to fix", "before this existed". A comment that says "it was once
X, and X was wrong because Y" has one useful sentence — the present-tense reason for the shape it has
now — and the rest is history: state the reason and stop, or state Y as a plain counterfactual ("a
spread would take whatever is in storage on trust"). Harness comments say what is pinned, not what
once broke. This applies to the READMEs too. The git log holds what changed; a shape that was moved
away from and is worth not proposing again goes in the **Decisions already made** ledger of the
matching topic file (see Topic files below), in the same change, and nowhere in the source.
(`AUDIT.md`, the changelog and `.git-blame-ignore-revs` are records by genre and are outside this.)

**Package boundaries are a lint rule.** npm links every workspace into `node_modules/@amk`, so
TypeScript resolves a sibling package however the tsconfigs are written; `no-restricted-imports` in
`eslint.config.js` is what actually holds the graph. Adding an edge means changing that rule
deliberately.

**Ticks, not seconds.** Anything that follows the music uses driver ticks, and stores and accepts
nothing else: the driver drops ticks on a busy song, so no formula over tempo can be exact and a
playhead built on one drifts further every pass round the loop. Seconds appear at exactly two
edges — the m:ss label derived from a tick, and the fade past the end of the song — and the
conversion has no inverse on purpose. The tick rate itself is measured, not assumed: anything that
turns ticks into seconds goes through `EditorStore.clock`. AddmusicK's own seconds
(`stats.tagSeconds` / `introSeconds` / `mainSeconds`, the ID666 header, the "Length" tile) are
outside this. The full rule is in `docs/claude/transport-and-clock.md`; read it before touching the
transport, the playhead or the clock.

**`sampleList: null` is not `[]`.** `null` means the compiler had no opinion and the driver's default
set stands; `[]` means the song genuinely asks for no samples. The list's _order is the SRCN
assignment_, so building an SPC against a different set produces a valid-looking file that plays the
wrong sounds. It is a correctness-critical output, not a statistic.

**Diagnostics carry source spans and stable codes**, and are carried on failure paths too, so
partial UI stays populated. **The prefix says whose finding it is, not which file raises it**:
`AMK####` is a condition AddmusicK itself reports, ported from `AddmusicKsrc/` with the `Music.cpp`
line cited; `SST####` is one `Music.cpp` does not produce at all. A new diagnostic takes the prefix
of the tool that found it. Spans are mapped back to the source the author wrote — `spanAt` is the
single choke point, and anything that bypasses it will be wrong. Constructs this compiler does not
implement are reported as errors, never silently mis-compiled. What each `SST05xx` covers:
`docs/claude/compiler.md`.

**Accessibility is not supported.** The app ships no ARIA attributes and no `role` or `tabindex`,
and none are planned. `angular.configs.templateAccessibility` is therefore absent from the
template lint block, and the "Accessibility Requirements" section of `web/.claude/CLAUDE.md` does
not apply here — that file is generated by the Angular CLI and is kept byte-identical to what the
CLI emits, so the override is stated here instead. The global `:focus-visible` outline is a
different concern and must not be removed by components.

**The changelog is part of the feature.** `web/src/app/changelog/changelog-data.ts` backs the top
bar's changelog popup. A commit that adds or materially changes a user-facing feature adds its entry
**in the same commit** — a new block at the top of `CHANGELOG` if the date is new, otherwise one more
string in the existing block for that date.

Write for **music porters, not developers**, and keep it to a short phrase naming the feature:
"Sample browser & importer", not a sentence about how it works. How something is implemented never
belongs here, however interesting. Refactors, internal work and small fixes get no entry at all. It
is hand-written and must never be generated from commit subjects, which are not written for users.

## Topic files

`docs/claude/` holds the guidance that matters for one area of the code only. Nothing there loads
on its own: **read an area's file before changing code in it**. If unsure which applies, grep
`docs/claude/` for the identifier you are about to touch — the entries name their identifiers.

Each file ends in a **Decisions already made** ledger: shapes this code has had and moved away
from, on record there rather than in comments — the code says what it is; the ledger says what it
is not going back to. One entry each: what it was, what it is, why. A new entry goes in the ledger
of the area it belongs to, in the same change; if no file fits, add one and list it here.

| File                       | Read before changing                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transport-and-clock.md`   | the transport, the seek bar, the playhead, `Playback`, `Mixer`, the worklet, the clock measurement, anything that turns ticks into seconds           |
| `audition.md`              | the note and region preview: `Audition`, `note.worker.ts`, the fast-forward and voice parking                                                        |
| `roll-view.md`             | the roll's camera, scrub and overview bars, grid, cursor, hover, pointer handling, selection and toolbar                                             |
| `roll-editing.md`          | how a roll gesture becomes text: `roll-edit.ts`, `roll-write.ts`, `roll-strip.ts`, `roll-gesture.ts`, rests, padding, drums, opening a channel       |
| `roll-octaves.md`          | `roll-octave.ts`, or anything that writes or removes an `o`, `<` or `>`                                                                              |
| `loops.md`                 | loop boxes, wrap, join and split, `roll-loops/`, the loop inspector and `loop-focus.ts`, `(n)m` and `*`                                              |
| `commands-in-the-roll.md`  | command glyphs on bars, the command lane, `commands-in-force.ts`, `command-timeline.ts`, `song-walk.ts`'s slots                                      |
| `inspector-and-palette.md` | the command inspector, a note's Length row, the instrument picker, the command palette, the `$DD` and `q` readouts, the bend graph, the FIR designer |
| `compiler.md`              | `packages/mml-compiler`, the `@amk/tokens` scanner, diagnostics                                                                                      |
| `ui-and-theme.md`          | `styles.css` colours, `ThemeStore` and presets, the panes, sidebar, tabs and shared controls                                                         |
| `tooling.md`               | the pre-hooks, `eslint.config.js`, `.prettierrc`, CI and deployment                                                                                  |

## Angular specifics

Angular 22, zoneless (scaffolded `--zoneless`, so zone.js is not a dependency and there is nothing
to opt into), no router, no NgModules. Signals throughout: `signal`/`computed` for state, `effect`
reserved for mirroring into imperative sinks (localStorage, the player, the DSP). State lives in
ten `@Service()` singletons in `web/src/app/state/`. The spine runs one way, `DriverStore` →
`SampleStore` → `EditorStore` → `Playback`; `ClockMeasurer` feeds `EditorStore`, `Audition` hangs
off it beside `Playback`, `Mixer` hangs off it and is read by both of those and by the roll, and
`CommitAudition` is the command inspector's write path over `EditorRequests` and `Audition` — a
panel's commit replays the selected note once its compile lands. `EditorRequests` and `ThemeStore`
depend on nothing at all, and nothing depends on the second either: it puts the porter's colours on
`<html>` as inline custom properties, and everything downstream reads those as CSS rather than
asking the service. `web/README.md` has the rest.

Selector prefix is `amk` — `amk-root`, `amk-editor-pane` for components, camelCase `amk*` for
directives. ESLint enforces both.

Styling is Tailwind v4, with the entire theme as CSS variables in `web/src/styles.css` (v4 has no
`tailwind.config.js`). Dark-only on purpose. `--color-seg-*` and `--color-ch-*` there are
**validated categorical sets**: never reorder or re-hue their defaults, and never make the default
`--color-surface` lighter than `#1f282f`, without re-validating — and never leave channel identity
to colour alone. What is validated, and why a porter's own overrides may break it:
`docs/claude/ui-and-theme.md`.

Framework-generic Angular 22 conventions (signal APIs, `@Service()`, host bindings, control flow)
live in `web/.claude/CLAUDE.md`, which the Angular CLI generated via `--ai-config=claude` and can
regenerate. Keep project-specific guidance here instead, so that file stays safe to overwrite.

## Formatting

Prettier owns the whole workspace, in two profiles split by layer — `web/src/app/` at 2 spaces,
single quotes, width 100; `packages/` and `scripts/` at tabs, double quotes, width 120, carried over
from the pre-Angular prototype so the port can still be diffed against AddmusicK's C++. Both are in
`.prettierrc`, with matching `.editorconfig` sections so editors agree; **change both or neither**.
Never hand-format — run `npm run format`, and `npm run check` fails on anything Prettier would
rewrite.

`endOfLine` is `"auto"` because the working tree is CRLF. Prettier's `"lf"` default makes every file
fail `--check` for reasons that have nothing to do with formatting.

Two regions carry `// prettier-ignore`, each because reflow would destroy information; read
`docs/claude/tooling.md` before adding a third. A reformat commit is listed in
`.git-blame-ignore-revs`.

## Linting

`eslint.config.js` at the root is the one config for every workspace, run as plain `eslint`.
Several rules are deliberately **off**, each with its reasoning inline — read it before switching
one on. `npm run lint:fix` fixes `curly` and blank-line padding; run `npm run format` after it. How
the config is scoped and why: `docs/claude/tooling.md`.

## Deployment

CI lints and checks every push and PR, and deploys `main` to GitHub Pages through `npm run build` —
never `ng build`, which skips the prebuild hooks. Details: `docs/claude/tooling.md`.
