# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Solar Soundtrack — a browser-based AddmusicK 1.0.11 MML editor. It compiles MML to N-SPC song
data, assembles a playable `.spc`, and plays it through an emulated SPC700, entirely client-side.
No ROM, no AddmusicK install, no server.

## Repository layout

The Angular workspace is one level down, in `web/`. **Every npm/ng command runs from `web/`, not
the repository root.** Application code therefore lives at `web/src/`.

At the root, `AddmusicKsrc/` and `AddmusicKreadme/` hold a local copy of AddmusicK 1.0.11's C++
sources and its readme. They are **gitignored and not part of the repository**, but they are the
reference implementation this project is a port of and the code cites them constantly — take them
from an AddmusicK release if they are missing.

## Commands

All from `web/`. Node 24 is what CI uses.

| Command | What it does |
| --- | --- |
| `npm start` | Dev server on `http://localhost:4200/`. |
| `npm run build` | Production build into `dist/`. |
| `npm run watch` | Dev-configuration build with `--watch`, no server. |
| `npm run typecheck` | `tsc -p tsconfig.app.json --noEmit`. |
| `npm run typecheck:scripts` | The same for `scripts/`, which the app tsconfig does not cover. |
| `npm run lint` | `ng lint` over `src/**` and `scripts/**`. |
| `npm run lint:fix` | The same with `--fix`. Follow it with `npm run format`. |
| `npm run format` | Prettier over the workspace. |
| `npm run check` | The merge gate: formatting, both typechecks, all ten byte-level harnesses. |

CI runs `npm run lint` then `npm run check`.

### Tests

There are no `.spec.ts` files in the repository — `npm run test` (`ng test`, Vitest) is scaffolding
and currently runs nothing. The real suite is ten harnesses under `scripts/`, each a standalone
esbuild-bundled Node script with its own npm script. To run one, run its script; they take no
filter flags, so narrowing a run means editing the harness.

Note that none of them covers Angular templates, and neither does `npm run typecheck` — `tsc` does
not run the template compiler, so a bad binding (`viewBox=` instead of `[attr.viewBox]=`) passes
`check` and fails only at `ng build` / `npm start`. Run one of those before believing a UI change.

- `npm run selftest` — compiler output, byte for byte.
- `npm run spctest` — MML → `.spc`, verifying the assembled file's structure. Stubs `fetch` over
  the local `public/driver/` directory.
- `npm run audiotest` — MML → SPC → actual PCM through the real wasm host. This is what proves the
  whole pipeline: a wrong compiler, layout, sample directory or CPUIO handshake produces silence.
- `npm run worklettest` — evaluates the shipped `public/player/spc-worklet.js` inside a `vm` context
  holding only what an AudioWorkletGlobalScope really exposes (no `fetch`, no `setTimeout`, no
  `TextDecoder`). Node has all of those globally, so this catches worklet-only breakage that
  `audiotest` structurally cannot.
- `npm run charttest` — stacked-bar geometry for the ARAM bar.
- `npm run brrtest` — BRR container handling and the decoder.
- `npm run tokentest` — the MML source scanner behind the command inspector. Its load-bearing
  assertion is **restartability**: stepping line by line with the state carried across must equal
  scanning the whole document. CodeMirror will restart the scanner at arbitrary lines, so a state
  machine that secretly depends on having seen the top of the file would work here and mis-colour
  text there, much later.
- `npm run firtest` — the echo FIR maths, anchored on the two filters in the SNES manual that
  AddmusicK ships as `EchoFilter0`/`EchoFilter1`, and on bsnes's own DSP behaviour.
- `npm run instrtest` — the driver's instrument and percussion tables. Its load-bearing assertion is
  that `spc/instruments.ts` finds them in `public/driver/main.bin` **uniquely**: the tables carry no
  citable address (`InstrumentData.asm` and `Commands.asm` are not in an AddmusicK release's
  `AddmusicKsrc/`), so they are located by matching the SRCN column against `INSTRUMENT_TO_SAMPLE`,
  and a second candidate would make that a guess. It also pins the one index where the driver and
  `Music.cpp`'s `instrToSample` disagree — 19, which is the whole `@19` story.
- `npm run adsrtest` — the envelope maths. `CLOCKS` is checked against the *published SNES noise
  ladder*, because the DSP uses the same table for noise and every other function here is defined in
  terms of it; nothing else could catch a transposed digit. It also asserts that the two magic tables
  in AddmusicK's readme calculator are exactly the step counts of bsnes's envelope stepping.

Separately, `scripts/Compare-Spc.ps1` and `scripts/Compare-SongBin.ps1` diff output against a real
AddmusicK build, region-aware so ID666 noise does not drown the real differences. Those are what
establish fidelity; the harnesses only catch gross breakage.

### Automatic pre-hooks

`prestart` / `prebuild` / `prewatch` / `pretypecheck` / `prelint` run these, so never invoke them
by hand:

- **`build:worklet`** — esbuild bundles `web/src/spc/worklet.ts` into `public/player/spc-worklet.js`
  (generated, gitignored). An AudioWorklet is loaded by URL from the audio thread, so the Angular
  builder cannot produce it as part of the app bundle.
- **`generate-git-info`** — writes `web/src/app/git-info.generated.ts` with `git rev-parse HEAD` for the
  toolbar's commit link (generated, gitignored). Captured once at startup, so it goes stale if you
  commit while `npm start` is running; restart to refresh.

## Architecture

Three layers, and the boundary between them is the part that matters.

| Path | Layer |
| --- | --- |
| `web/src/compiler/` | MML compiler: `preprocess.ts` → `parser.ts` → `link.ts`, plus `tokens.ts` |
| `web/src/spc/` | SPC assembly, BRR, echo FIR maths, driver bundle, emulator host, audio worklet |
| `web/src/app/` | Angular UI |

`compiler/` and `spc/` are **framework-free and DOM-free** — no Angular, no `document`, no
`window`, no `fetch` outside `driver.ts`. That is load-bearing, not stylistic: it is why the same
modules run in Node under the harnesses, on the main thread, and inside an AudioWorkletGlobalScope.
Keep it that way. The TS path aliases (`@compiler`, `@core/*`, `@spc/*`) mark the boundary; `core/types.ts`
is the shared vocabulary and deliberately knows nothing about the SPC layer.

### The pipeline

1. **`DriverStore`** loads `public/driver/` (manifest, `main.bin`, SPC/DSP base images, the
   `#default` BRR group), or a user-uploaded `main.bin`. `planAram()` derives the song's ARAM load
   address from the driver's song pointer table. **There is no fallback address** — until a driver
   loads, compilation is blocked rather than run against a guess.
2. **`EditorStore`** debounces typing (150 ms) into a `committed` signal that a `computed` compiles.
   Diagnostics, stats, the ARAM budget and the hex dump are all `computed` off that one result.
3. **`buildSpc()`** assembles the fixed 0x10200-byte SPC. It is a method rather than a `computed`
   because it copies 64 KiB of ARAM plus every sample — wasted work on each keystroke.
4. **`Playback`** hands the SPC to `SpcPlayer`, which owns an AudioContext and an AudioWorkletNode
   running `worklet.ts`, which drives `wasm-host.ts` — Blargg's snes_spc, vendored as
   `public/player/spc.wasm`.

`protocol.ts` is the sole contract between page and audio thread. The worklet is bundled separately,
so a mismatch there surfaces at runtime as silence, not as a type error. Nothing in the app imports
`worklet.ts`.

### Conventions worth knowing

**The port cites its source.** Around 120 comments reference `Music.cpp:3209`, `AddmusicK.cpp:1138`,
`globals.cpp:735`, `main.asm` and so on, against AddmusicK 1.0.11 in `AddmusicKsrc/`. Read the cited
lines before changing compiler behaviour, and cite the lines you port. Behaviour that looks strange
is almost always strange in the original too — reproduce it and say so in a comment. `link.ts` keeps
AddmusicK's redundant two-stage sentinel/relocation dance purely so the two implementations can be
diffed step for step.

**Ticks, not seconds.** Anything that follows the music uses driver ticks (`stats.introTicks`,
`stats.loopTicks`, `stats.playback`). The driver's main loop processes at most one tick per
iteration, so a busy song makes it drop ticks (~0.8% on eight channels) and no formula over tempo can
be exact; a playhead built on one drifts further every pass round the loop. `stats.tagSeconds` /
`introSeconds` / `mainSeconds` are AddmusicK's own arithmetic, kept for the ID666 header and for
labels, and are a few percent out by design.

**Observe the driver rather than predict it.** `driver-state.ts` reads the N-SPC driver's zero page
straight out of the emulator's APU RAM — every byte of it documented in
`AddmusicKreadme/readme_files/aram_map.html` — for tempo, per-voice position and the tick
accumulator, and writes it in exactly one place, for muting. Mutes go to the driver's own `$5E`
register and are never baked into song data, so preview and export build identical bytes and
playback does not break stride.

**`sampleList: null` is not `[]`.** `null` means the compiler had no opinion and the driver's default
set stands; `[]` means the song genuinely asks for no samples. The list's *order is the SRCN
assignment*, so building an SPC against a different set produces a valid-looking file that plays the
wrong sounds. It is a correctness-critical output, not a statistic.

**Diagnostics carry source spans** (`{start, end, line}`) and stable `AMK####` codes, and are carried
on failure paths too so partial UI stays populated. Constructs this compiler does not implement are
reported as errors, never silently mis-compiled.

**Diagnostic spans are mapped back to the source the author wrote.** The parser works on
preprocessed, replacement-expanded text, which is not what is in the editor: `preprocess.ts` removes
the `#amk` marker, every `#define`/`#if` line, the untaken side of a false branch and all comments.
So it returns `origins`, one source offset per output character, the parser keeps that array in step
with its buffer (including through `doReplacement`, where expanded text is attributed to the use
site), and `spanAt` is the single choke point that converts. Anything that adds a diagnostic gets
this for free; anything that bypasses `spanAt` will be wrong. `selftest` asserts the offsets land on
the offending character, not merely near it.

**`tokens.ts` still does not go through the compiler, and must not.** Even with spans mapped, the
scanner needs to run on text that does not compile and without waiting for the 150 ms debounce, so
it is a second, independent pass over the raw source. It reuses `HEX_LENGTHS`/`VCMD_NAMES` from
`tables.ts` rather than restating them, and is shaped as a resumable line stepper with a small
copyable `ScanState` because that is CodeMirror's `StreamLanguage` contract — so the eventual syntax
highlighting is an adapter rather than a rewrite, and `compiler/` stays free of any CodeMirror
dependency.

**The echo FIR sits inside the feedback loop.** `spc/fir.ts` is checked against bsnes's own DSP
(`AddmusicKsrc/SPC_DSP.cpp:610-700`): a coefficient is worth `c/128`, a repeat is scaled by
`EFB/128 · H(f)` so repeat *k* has gain `|H|^k`, and taps 0–6 are summed into a value that *wraps*
at 16 bits before tap 7 is added and clamped — so `Σ|c₀…c₆| > 128` can crackle. C7 multiplies the
newest sample and C0 the oldest, which does not affect any plot here because magnitude is blind to
tap reversal.

**The changelog is part of the feature.** `web/src/app/changelog/changelog-data.ts` backs the top
bar's changelog popup. A commit that adds or materially changes a user-facing feature adds its
entry **in the same commit** — a new block at the top of `CHANGELOG` if the date is new, otherwise
one more string in the existing block for that date.

Write for **music porters, not developers**, and keep it to a short phrase naming the feature:
"Sample browser & importer", not a sentence about how it works. How something is implemented never
belongs here, however interesting — nobody writing MML needs to know the playhead follows the
driver rather than estimating it. Refactors, internal work and small fixes get no entry at all. It
is hand-written and must never be generated from commit subjects, which are not written for users.

### Angular specifics

Angular 22, zoneless (the workspace was scaffolded `--zoneless`, so zone.js is not a dependency and
there is nothing to opt into), no router, no NgModules. Signals throughout: `signal`/`computed` for
state, `effect` reserved for mirroring into imperative sinks (localStorage, the player, the DSP).
State lives in four `@Service()` singletons in `app/state/`, in dependency order `DriverStore` →
`SampleStore` → `EditorStore` → `Playback`.

Selector prefix is `amk` — `amk-root`, `amk-editor-pane` for components, camelCase `amk*` for
directives. ESLint enforces both.

Styling is Tailwind v4, with the entire theme as CSS variables in `web/src/styles.css` (v4 has no
`tailwind.config.js`). Dark-only on purpose. The `--color-seg-*` ARAM bar palette is a validated
categorical set — do not reorder or re-hue it without re-validating, since adjacent-pair CVD
separation and contrast against `--color-surface` are the properties being preserved. Templates are
linted for accessibility, and the global `:focus-visible` outline must not be removed by components.

Persistence: the MML draft goes to `localStorage`; the sample library to IndexedDB via
`app/util/idb.ts`, which resolves rather than rejects on every path — storage is genuinely optional
(private browsing, exhausted quota) and must never stop someone compiling a song.

Framework-generic Angular 22 conventions (signal APIs, `@Service()`, host bindings, control flow,
accessibility) live in `web/.claude/CLAUDE.md`, which the Angular CLI generated via
`--ai-config=claude` and can regenerate. Keep project-specific guidance here instead, so that file
stays safe to overwrite.

### Formatting

Prettier owns the whole workspace, in two profiles split by layer — `app/` at 2 spaces, single
quotes, width 100; `compiler/`, `spc/`, `core/` and `scripts/` at tabs, double quotes, width 120,
carried over from the pre-Angular prototype. Both are in `.prettierrc`, with matching
`.editorconfig` sections so editors agree; **change both or neither**. Never hand-format — run
`npm run format`, and `npm run check` fails on anything Prettier would rewrite.

`endOfLine` is `"auto"` because the working tree is CRLF. Prettier's `"lf"` default makes every
file fail `--check` for reasons that have nothing to do with formatting.

Two regions carry `// prettier-ignore`, both because reflow destroys information rather than
because someone preferred the old layout: the MML command dispatch in `parser.ts`, which is a
lookup table one line per case, and the one hand-annotated byte table in `selftest.ts`, where each
line is a little-endian word with its own comment. Add a marker only for that kind of reason, and
say what it is.

The reformat that first ran Prettier over the tree is listed in `.git-blame-ignore-revs`. Enable it
with `git config blame.ignoreRevsFile .git-blame-ignore-revs` so `git blame` on the ported compiler
keeps pointing at the port.

### Linting

`eslint.config.js` is where the conventions above stop being prose. Rules that exist to hold a
property the codebase already has (`prefer-signals`, `prefer-service-decorator`, `inject-at-top`,
`consistent-type-imports`, and the template rules) are set to `error`, and `ng lint` runs with
`maxWarnings: 0` — a `warn` would never fail CI, so there is no point setting one.

Four rules are deliberately **off**, each with its reasoning inline in the config. Read that before
switching one on: `no-unnecessary-condition` and `template/no-duplicate-attributes` and
`template/button-has-type` report only false positives here, and `template/no-call-expression`
cannot tell a signal read from a method call, so it flags 178 correct lines. The bug that last rule
would catch is kept out structurally instead — panels build a `computed` of view models rather than
calling a method per row (`sample-browser.ts`, `aram-budget.ts`, `stats-grid.ts`).

One last block sits **after `eslintConfigPrettier`**, and has to: it holds `curly` and
`padding-line-between-statements`, which brace every block and leave a blank line after it. Neither
is something Prettier can do — it never adds braces and never inserts blank lines, only collapses
them — so this is the one place where layout is a lint rule, and there is no formatter option to go
looking for. `eslint-config-prettier` switches `curly` off, so setting it in any earlier block would
be silently undone. `npm run lint:fix` fixes both; run `npm run format` after it, since the brace
fixer emits `if (x) { … }` on one line and leaves the wrapping to Prettier.

## Deployment

`.github/workflows/ci.yml` lints and checks every push and PR; pushes to `main` additionally build
with `--base-href=/<repo-name>/` and deploy `web/dist/solar-soundtrack/browser` to GitHub Pages.
The build must go through `npm run build` rather than `ng build` so the prebuild hook still emits
the worklet bundle, which is not checked in. The app is a PWA (`ngsw-config.json`); the service
worker is enabled in production builds only.
