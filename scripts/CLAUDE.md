# Harnesses

Fourteen byte-level checks, each a standalone esbuild-bundled Node script with its own npm script.
There are no `.spec.ts` files anywhere in the repository and no `npm run test`. These are the suite.

Run one by name (`npm run selftest`), or let `npm run affected` pick the ones that import what you
changed. `npm run check` runs all fourteen, one step each, in the order of these groups, which are
also runnable on their own:

| Group               | Harnesses                                         |
| ------------------- | ------------------------------------------------- |
| `check:compiler`    | `selftest`                                        |
| `check:tokens`      | `tokentest`, `edittest`, `palettetest`            |
| `check:spc`         | `adsrtest`, `instrtest`, `brrtest`, `firtest`     |
| `check:integration` | `spctest`, `audiotest`, `worklettest`, `walktest` |
| `check:app`         | `charttest`, `rolltest`                           |

Ten of the fourteen import a value from two or more `@amk/*` packages — every one but `adsrtest`,
`edittest`, `selftest` and `tokentest` — which is why they all live here rather than one per package,
and why they share `harness.ts` rather than each carrying a copy: copies drift. Recount that rule
rather than bumping the number when one is added.

## What each one proves

Each harness's full account is a rule in `.claude/rules/harnesses/`, and it loads when you open that
harness. In one line each:

- `selftest` — Compiler output, byte for byte.
- `spctest` — MML → `.spc`, verifying the assembled file's structure.
- `audiotest` — MML → SPC → actual PCM through the real wasm host.
- `worklettest` — Evaluates the _built_ `spc-worklet.js` inside a `vm` context holding only what an AudioWorkletGlobalScope really exposes — no `fetch`, no `setTimeout`, no `TextDecoder`.
- `charttest` — Stacked-bar geometry for the ARAM bar, the shared plot space, `clamp`, and the piano roll's lanes, window arithmetic and percussion set.
- `walktest` — The song-data walker, `@amk/spc/song-walk`, which is the only thing the piano roll draws from — and a walker that mis-frames one command draws a plausible roll that is quietly wrong, with no visual tell.
- `brrtest` — BRR container handling and the decoder.
- `tokentest` — The MML scanner, and the command model on it.
- `firtest` — The echo FIR maths, anchored on the two filters in the SNES manual that AddmusicK ships as `EchoFilter0`/`EchoFilter1`, and on bsnes's own DSP behaviour.
- `instrtest` — The driver's instrument and percussion tables.
- `adsrtest` — The envelope maths.
- `palettetest` — The command palette's catalogue, and it is the one harness whose oracle is the compiler rather than a table of expected bytes.
- `edittest` — The splices the command inspector writes back into the source.
- `rolltest` — The piano roll's edits: `roll-strip.ts` and `roll-edit.ts`, driven the way the roll drives them.

## Running one, and reading what it prints

`npm run <name>` is `node scripts/run-harness.mjs <name>`: esbuild bundles `scripts/<name>.ts` (or
`scripts/<name>/main.ts`) into `.selftest/<name>.mjs` with a sourcemap and a metafile
(`.selftest/<name>.meta.json`), then runs it under `node --enable-source-maps`. To run the same
bundle again without rebuilding: `node --enable-source-maps .selftest/<name>.mjs`.

A passing run prints one line, `<name>: N passed, 0 failed`. A failing check prints

```
<its section's header>
  FAIL  <check name>  (<file>:<line> < <caller's file>:<line>)
        <detail>
```

and every failed name is listed again above the tally. The location is where `check` was called,
innermost first, so a failure inside a shared helper names the helper's line and then the line in the
section that called it. A JS throw is a FAIL line too — `FAIL  <section>: threw <message>` with the
stack as its detail — and the tally still prints: in `rolltest` and `walktest` the sections after
the one that threw still run, and in a single-file harness the checks before the throw are counted.
N is the number of `check` calls that ran, so a harness whose N dropped has lost assertions.

| Variable            | Effect                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HARNESS_VERBOSE=1` | Every `ok` line, every section header and the `info` lines.                                                                                                        |
| `HARNESS_ONLY=a,b`  | `rolltest` and `walktest` only: run just those sections, named as their files are (`loop-resize`, `driver-plays`). An unknown name lists the sections and exits 2. |

PowerShell: `$env:HARNESS_ONLY='loops'; npm run rolltest; Remove-Item Env:HARNESS_ONLY`. Bash:
`HARNESS_ONLY=loops npm run rolltest`. `HARNESS_QUIET` is accepted and does nothing; quiet is the
default.

## `npm run check` and `npm run affected`

Both run a list of steps through `steps.mjs` and report the same way: one progress line per step,
a table of step, result, duration and tally, and for each failure its first FAIL lines and the last
30 lines of its output. A step's whole output is in `.selftest/logs/<step>.log` (`:` in a step name
is written `-`). The exit code is non-zero when any step failed.

- **`npm run check`** (`check.mjs`) is the gate: `format:check`, `codemap:check`,
  `citations:check`, `typecheck`, `typecheck:packages`, `typecheck:scripts`, the fourteen harnesses,
  `i18n:check`. It carries on past a failure, so one run reports everything that is broken;
  `-- --bail` stops at the first. `npm run check -- rolltest i18n:check` runs only the steps named,
  and `-- --list` prints the names.
- **`npm run affected`** (`affected.mjs`) runs what covers the files changed since `HEAD`, untracked
  ones included (`-- --since main` for a branch): Prettier and ESLint on those files, the code map
  and citations, `tsc` for each workspace touched and for the projects that import it, every harness
  whose bundle has a changed file among its metafile inputs, and `i18n:check` when a template, a
  file with `$localize` or the English changed. It prints each selection with the files that caused
  it, and names changed source files no harness imports. `-- --dry` prints the selection only, and
  files named after `--` replace the diff. Every harness is bundled first, so the inputs are the
  imports as they stand; `worklettest` also counts the inputs of the worklet it evaluates.
- **A crash is retried.** A step that exits 139, 3, 3221225477 or -1073741819, dies on a signal, or
  prints `Segmentation fault` or `Fatal error in` is Node dying below the JS layer, which this
  machine does intermittently. It is run again, twice at most, and the table says
  `crashed 1x, passed on retry`; a step that crashes three times is `CRASHED 3x`.

`npm run ci` is `lint`, `check` and `build` in turn.

## `citations.mjs`

`npm run citations:check`. Every `<file>.ts:NNN` or `:NNN-MMM` in the source and in the guidance
(`CLAUDE.md` files, `.claude/**/*.md`) that names a file in the repository must point at lines the
file has, and one written `<file>.ts:NNN (name)` must fall inside the function, method, class or
top-level constant of that name. A bare file name is matched against every file of that name and
passes if any holds the lines. Citations into AddmusicK's sources are not checked, since those files
are not in the repository. It proves a citation is in range, not that it still points at the right
line: an edit above a cited line moves it silently, so re-read citations into a file you lengthen.

## `codemap.mjs`

`npm run codemap` writes `CODEMAP.md`; `codemap:check` fails when it is stale. Beside each file's
first sentence the map carries three things, each shaped so that an ordinary edit does not make it
stale:

- **A size floor**, `(1500+ lines)`, from 300 lines up, on the ladder 300, 500, 750, 1000, 1500,
  2000, 3000, 4000, 6000. An exact count would change with every edit.
- **An outline** for a file of 1000 lines or more: its top-level functions, its classes with their
  methods, its exported constants, and in a harness its `section(...)` titles, each with a line
  number. `codemap:check` ignores the line numbers and compares the names, so the map goes stale
  when a declaration is added, removed, renamed or reordered and not when lines move. The numbers
  are therefore as of the last `npm run codemap`; grep the name when one has drifted.
- **The rules** whose `paths:` globs match a file in the directory, read from `.claude/rules/` at
  generation time, so changing a rule's `paths:` can make the map stale.

A directory holding only `icon-*.ts` files is one line. A first sentence that ends in a colon and
introduces a list is completed with the list's items; a file whose entry would still end in a colon
is reported with the files that have no doc comment.

## `harness.ts`

`check`, `section`, `info`, `summarise`, `runSections`, `SPC_ASSETS` and `stubFetch`. Use them
rather than writing another copy, and print nothing with `console.log`: a header goes through
`section`, which holds it back until a check under it fails, and a figure worth seeing on a passing
run goes through `info`. A harness split into sections lists them in its `main.ts` as
`runSections([["name", () => import("./name")], …])`; each section still runs as its module is
evaluated, in list order.

`stubFetch` reproduces two dev-server behaviours deliberately, because between them a missing sample
file surfaces as "invalid BRR length 2205" rather than a 404:

1. paths are decoded with `decodeURI`, which leaves `%40` untouched, so an over-encoded `@` never
   resolves to a real file;
2. an unresolved path is answered 200 with index.html, not 404 — so code that trusts `response.ok`
   gets HTML where it expected bytes.

A harness that threw on a missing file instead would pass while the browser failed.

Every harness imports `./localize` before anything else. The packages and the app code they reach
write their messages by ID (`.claude/rules/i18n.md`), and the page's build swaps the English in; a
harness runs that code unbuilt, so `localize.ts` defines `$localize` and loads
`web/src/locale/messages.en.json` into it. Imported first, both are in place before any
module-level message is built, and an assertion on a message's words reads the English a porter
sees.

## What none of them cover

**Angular templates.** Neither these nor `npm run typecheck` run the template compiler. The last
step of `npm run check` does — `i18n:check` builds the app to extract its messages, so a bad
binding (`viewBox=` instead of `[attr.viewBox]=`) fails there — but nothing here renders one.

## Establishing fidelity

`Compare-Spc.ps1` and `Compare-SongBin.ps1` diff output against a real AddmusicK build, region-aware
so ID666 noise does not drown the real differences. Those are what establish fidelity; the harnesses
only catch gross breakage.

`Compare-SongBin.ps1` is the sharper of the two: AddmusicK writes `asm/SNES/bin/musicXX.bin` for
every song it compiles, and past its 12-byte RATS header that file is exactly the blob this editor's
`.bin` export produces. Same song, same load address, so every difference is a real compiler
difference rather than a layout artefact. Run it with one argument to read the header and see which
address to compile at.
