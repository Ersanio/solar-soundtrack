---
name: drive-the-app
description: Use to see a UI change working in the real editor — launching a private dev server, driving it in headless Edge with playwright-core, seeding a song, and reading the roll, the inspector and the transport from the DOM. Includes the traps that make a working feature look broken.
---

# Driving the running editor

Templates and runtime behaviour are covered by neither `npm run typecheck` nor the harnesses, so a
UI change is not done until it has been seen in the app. `scripts/drive/` is the tooling:

| File            | What it is                                                                   |
| --------------- | ---------------------------------------------------------------------------- |
| `drive.mjs`     | Opens the app in headless Edge, seeds a song, waits, prints a JSON snapshot. |
| `serve.mjs`     | Static server for a built app, on a free port; `drive.mjs --dist` starts it. |
| `selectors.mjs` | Every selector the driver reads through, each with a comment. Fix them here. |

`NOTES.md` beside this file is the long form of everything below.

## 1. One command

```powershell
$env:NODE_PATH = "<scratchpad>\pw\node_modules"   # see "playwright-core" below
node scripts/drive/drive.mjs --dist <build>\web\dist\solar-soundtrack\browser --song <file.mml> --snapshot
```

The snapshot is one JSON object on stdout (`--out <file>` writes it instead; it runs to tens of
kilobytes, so prefer `--out` and read the fields you need):

- `ready`, `waitedMs` — whether the page settled; exit code 1 when it did not.
- `source`, `caret` — the document, from CodeMirror.
- `status` — `kind` (`ok`/`error`/`busy`/`info`), the status sentence, the problems and ARAM
  buttons, and `readouts` (the song's note count, the tempo and tick rate).
- `diagnostics` — `{ line, severity, code, message }` per row; `[]` is no problems.
- `transport` — `playing`, `canPlay`, `loop`, `clock`, `positionTicks`, `durationTicks`.
- `history` — `canUndo`/`canRedo` of the visible toolbar: the test for "did an edit land".
- `roll` — `markCount`, `marksPerChannel`, `marks` (channel, `x`/`y`/`width`/`height`/`gate` in
  the roll's coordinates, `label`, `client` box in page pixels, `inPane`, `selected`),
  `loopBoxes` (`channel`, `body`, `tick`, `ticks`), `laneGlyphs`, `warnings`, `settings`.
- `consoleErrors`, `pageErrors`, `failedRequests` — all three should be empty.

Other flags (`--help` lists them): `--url <url>` for a server already up, `--view source|roll|samples`,
`--channel <n|none>`, `--zoom`, `--row-height`, `--screenshot <png>`, `--audio` (playback without a
user gesture), `--headed`, `--timeout`, `--marks <n>`, and `--ids` for a run against
`npm run start:ids`, where every text field holds a message ID instead of English. With no `--song`
the app opens on its own sample song.

**Interaction is a steps file**, run before the snapshot and the screenshot:

```js
// <scratchpad>/steps.mjs — node scripts/drive/drive.mjs --dist … --steps <scratchpad>/steps.mjs
export default async ({ page, snapshot, helpers }) => {
  const before = await snapshot();
  const mark = before.roll.marks.find((m) => m.channel === 0 && m.inPane);
  const from = helpers.centreOf(mark);
  await helpers.drag(from, { x: from.x, y: from.y - 52 }); // two rows up at --row-height 26
  await helpers.waitForReady();
  return { canUndo: (await snapshot()).history.canUndo }; // lands in the snapshot's `steps.result`
};
```

`page` is playwright's. `helpers` has `selectors`, `ids`, `waitForReady`, `source`, `setSource`,
`setCaret`, `elementAt`, `centreOf`, `drag`, `clickAt`, `togglePlay`, `setRange` and `sleep`. Keep
steps files in the scratchpad unless they are worth checking in.

## 2. A build to drive

`drive.mjs` needs a build or a URL; it never builds.

- **Never build or serve from the main checkout's `web/` while the user's `npm start` may be up.**
  Both write `web/.angular/cache/<ver>/solar-soundtrack/.tsbuildinfo`, and a corrupted one breaks
  every server, the user's included, until that file is deleted with no server running.
- **Build in a git worktree**, which has a cache of its own:

  ```powershell
  git worktree add --detach <scratchpad>\wt HEAD
  New-Item -ItemType Junction -Path <scratchpad>\wt\node_modules -Target "<repo>\node_modules"
  # copy in the working-tree files you want to see, then, from <scratchpad>\wt:
  npm run build
  ```

  Then `--dist <scratchpad>\wt\web\dist\solar-soundtrack\browser`. Afterwards remove the junction
  first (`cmd /c rmdir <scratchpad>\wt\node_modules`), then `git worktree remove --force` — a
  recursive delete through the junction would empty the real `node_modules`.

- **To iterate, serve from the same worktree on port 4201**: `npm run prepare:assets` at the
  worktree's root, then `npx ng serve --port 4201` from its `web/`, and drive it with
  `--url http://localhost:4201/`. Running `prepare:assets` by hand is the one deliberate exception
  to the root `CLAUDE.md`'s "never invoke the pre-hooks by hand": a bare `ng serve` skips them, and
  `npm start -- --port 4201` does not work (npm hands the port to `ng serve` as a project name).
- Wait for `Application bundle generation complete` in the server's log, not `failed`. A watching
  server whose build fails keeps serving the last good bundle with a 200, so grep the served
  `main.js` for a string you just added after **every** edit (it is unminified: use a
  space-tolerant pattern).
- If port 4200 is busy it is probably the user's server. Do not kill it, and do not drive it:
  `solar-soundtrack.draft` on that origin is their actual work. The driver's browser profile is
  fresh on every run, so on any other server it touches nobody's storage.

## 3. playwright-core

Not a dependency of the repository, and it stays that way. Install it in the scratchpad and name it
in `NODE_PATH` (the driver resolves it with `require`, which reads that variable):

```powershell
npm install --prefix <scratchpad>\pw playwright-core
$env:NODE_PATH = "<scratchpad>\pw\node_modules"
```

It launches the installed Edge (`channel: 'msedge'`), so there is no browser download. Without it
the driver exits 2 and prints these two lines. The `claude-in-chrome` tools are a fallback; read
state with `javascript_tool` rather than screenshots.

## 4. Traps that make a working feature look broken

- **Readiness is not a sleep.** The driver waits for the status dot to stop pulsing, for every
  worker message to be answered (the clock measurement is a worker round trip a second after the
  compile), and for the page to hold still. After anything that recompiles, call
  `helpers.waitForReady()` before reading or pressing. The first pointer interaction can still race
  a measurement — retry the first click once before believing a broken handler.
- **Only notes near the camera are in the DOM.** `roll.markCount` is what is drawn, not the song;
  the song's count is in `status.readouts`. Off-screen bars are in the DOM too: filter on `inPane`.
- **Names and glyphs need `rowHeight` 26** (the driver's default; the app's own default draws
  neither). **Zoom 2, not 8**: at 8 the second bar's centre is under the pane divider.
- **Check `helpers.elementAt(x, y)` before clicking a centre** — it should be `rect.fill-ch-N`.
  Two channels' marks can overlap, and a muted channel's bars take no pointer at all.
- **A drag needs real intermediate moves** to pass the roll's slop test (`SLOP_PX` in
  `roll-gesture.ts`); `helpers.drag` makes twelve. Too few and nothing commits.
- **`page.mouse.click(x, y, { modifiers })` ignores `modifiers`**; `helpers.clickAt` and
  `helpers.drag` hold the keys for real.
- **Play is the transport's first button, and it is icon-only.** `button:has-text("Play")` matches
  a different element that clicks without error and starts nothing. Use `helpers.togglePlay()`,
  with `--audio`. **Loop is off by default**, so a song plays once and stops.
- **Two toolbars carry undo and redo**, and the source view's is hidden behind the roll; the
  snapshot's `history` reads the visible pair.
- **The source view is on `cmTile`, not `cmView`**: `.cm-content`'s `cmTile.view` is the
  EditorView, alive in every tab.
- **`solar-soundtrack.view` is the bare word `roll`**, not JSON; `'"roll"'` leaves the app on Source.
- **Components inside the roll's `<svg>` are attribute selectors**: `g[amk-roll-notes]`, not
  `amk-roll-notes`.
- **`amk-slider` wraps a native range input**: `helpers.setRange` sets `.value` and fires `input`
  then `change`, which previews and commits as a real drag does.
- **On a dev server, a transient rebuild error puts a `<vite-error-overlay>` over the page** that
  eats every pointer event (`errorOverlay: true` in the snapshot); reload once the edits are done.
- **A selector that stops matching reports `null` or an empty list**, not an error. If a field goes
  empty after a template change, the fix is in `scripts/drive/selectors.mjs`.
