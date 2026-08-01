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
| `npm run lint` | `ng lint` over `src/**` and `scripts/**`. |
| `npm run check` | The merge gate: typecheck plus the six byte-level harnesses. |

CI runs `npm run lint` then `npm run check`.

### Tests

There are no `.spec.ts` files in the repository — `npm run test` (`ng test`, Vitest) is scaffolding
and currently runs nothing. The real suite is six harnesses under `scripts/`, each a standalone
esbuild-bundled Node script with its own npm script. To run one, run its script; they take no
filter flags, so narrowing a run means editing the harness.

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
| `web/src/compiler/` | MML compiler: `preprocess.ts` → `parser.ts` → `link.ts` |
| `web/src/spc/` | SPC assembly, BRR, driver bundle, emulator host, audio worklet |
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

Two conventions coexist, split by layer. `app/` follows Prettier (`.prettierrc`: 2 spaces, single
quotes, width 100). `compiler/`, `spc/` and `scripts/` use tabs and double quotes, carried over
from the pre-Angular prototype. Match the file you are editing.

## Deployment

`.github/workflows/ci.yml` lints and checks every push and PR; pushes to `main` additionally build
with `--base-href=/<repo-name>/` and deploy `web/dist/solar-soundtrack/browser` to GitHub Pages.
The build must go through `npm run build` rather than `ng build` so the prebuild hook still emits
the worklet bundle, which is not checked in. The app is a PWA (`ngsw-config.json`); the service
worker is enabled in production builds only.
