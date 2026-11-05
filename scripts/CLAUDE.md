# Harnesses

Fourteen byte-level checks, each a standalone esbuild-bundled Node script with its own npm script.
There are no `.spec.ts` files anywhere in the repository and no `npm run test`. These are the suite.

Run one by name (`npm run selftest`). They take no filter flags, so narrowing a run means editing
the harness. `npm run check` runs all fourteen, grouped:

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

## Quiet output

Every passing check prints an `ok` line, so a full `npm run check` prints over 300 KB. Set
`HARNESS_QUIET` and only section headers, failures and the tally are printed:
`$env:HARNESS_QUIET=1; npm run check` in PowerShell, `HARNESS_QUIET=1 npm run check` in Bash. Unset,
the output is unchanged.

## `harness.ts`

`check`, `summarise`, `SPC_ASSETS` and `stubFetch`. Use them rather than writing
another copy.

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
