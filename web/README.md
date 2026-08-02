# Solar Soundtrack

A browser-based AddmusicK 1.0.11 MML editor. It compiles MML to N-SPC song data, assembles a
playable `.spc`, and plays it through an emulated SPC700 — entirely client-side. No ROM, no
AddmusicK install, no server.

## Working in this repository

The Angular workspace is one level down, in `web/`. **Every npm command runs from `web/`, not the
repository root.** Node 24 is what CI uses.

```bash
cd web
npm ci
npm start          # dev server on http://localhost:4200/
```

### Use the npm scripts, not `ng` directly

`npm start`, `npm run build` and `npm run watch` each have a pre-hook that generates two files
which are **not** checked in:

- `public/player/spc-worklet.js`, bundled from `src/spc/worklet.ts`. An AudioWorklet is loaded by
  URL from the audio thread, so the Angular builder cannot produce it as part of the app bundle.
- `src/app/git-info.generated.ts`, holding the commit SHA for the toolbar's commit link.

Running `ng serve` or `ng build` skips those hooks, and the result is an app that builds and then
fails at runtime with a play button that does nothing. Reach for `npm run ...` every time.

`git-info.generated.ts` is captured once at startup, so it goes stale if you commit while
`npm start` is running. Restart to refresh it.

| Command          | What it does                                                        |
| ---------------- | ------------------------------------------------------------------- |
| `npm start`      | Dev server.                                                         |
| `npm run build`  | Production build into `dist/`.                                      |
| `npm run watch`  | Dev-configuration build with `--watch`, no server.                  |
| `npm run format` | Prettier over the workspace.                                        |
| `npm run lint`   | ESLint over `src/`, `scripts/` and the templates.                   |
| `npm run check`  | **The merge gate.** Formatting, both typechecks, all ten harnesses. |

CI runs `npm run lint` then `npm run check` on every push and pull request.

## Tests

There are no `.spec.ts` files — `npm run test` is scaffolding and runs nothing. The real suite is
ten byte-level harnesses under `scripts/`, each a standalone Node script with its own npm script:

`selftest` (compiler output, byte for byte) · `spctest` (MML → `.spc` structure) · `audiotest`
(MML → SPC → real PCM through the wasm host — this is what proves the whole pipeline) ·
`worklettest` (the shipped worklet bundle, inside a scope holding only what an
AudioWorkletGlobalScope really has) · `charttest` · `brrtest` · `tokentest` · `firtest` ·
`instrtest` · `adsrtest`.

They share `scripts/harness.ts`. Use it rather than writing another copy of `check` or the `fetch`
stub — the stub reproduces two dev-server behaviours that once caused a real bug.

**None of them compiles Angular templates, and neither does `npm run typecheck`.** A bad binding
passes `npm run check` and fails only at `npm run build` or `npm start`, so run one of those before
believing a UI change.

`scripts/Compare-Spc.ps1` and `scripts/Compare-SongBin.ps1` diff output against a real AddmusicK
build. Those are what establish fidelity; the harnesses only catch gross breakage.

## Formatting

Prettier owns the workspace in two profiles: `app/` at 2 spaces and single quotes, and `compiler/`,
`spc/`, `core/` and `scripts/` at tabs and double quotes, carried over from the pre-Angular
prototype. Run `npm run format`; `npm run check` fails on anything it would rewrite.

`git blame` should skip the commit that first ran Prettier over the tree:

```bash
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Architecture

`CLAUDE.md` at the repository root is the long version — the pipeline, the AddmusicK citation
convention, and what to read before changing compiler behaviour. In short:

| Path                | Layer                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| `web/src/compiler/` | MML compiler                                                             |
| `web/src/spc/`      | SPC assembly, BRR, echo FIR, driver bundle, emulator host, audio worklet |
| `web/src/app/`      | Angular UI                                                               |

`compiler/` and `spc/` are framework-free and DOM-free, which is what lets the same modules run in
Node under the harnesses, on the main thread, and inside an AudioWorkletGlobalScope. Keep it that
way.
