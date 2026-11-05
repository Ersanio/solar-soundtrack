---
name: drive-the-app
description: Use to see a UI change working in the real editor — launching a private dev server, driving it in headless Edge with playwright-core, seeding a song, and reading the roll, the inspector and the transport from the DOM. Includes the traps that make a working feature look broken.
---

# Driving the running editor

Templates and runtime behaviour are covered by neither `npm run typecheck` nor the harnesses, so a
UI change is not done until it has been seen in the app.

## 1. A server of your own

- **Simplest: serve the production build.** `npm run build` writes
  `web/dist/solar-soundtrack/browser/`; a few lines of `node:http` in the scratchpad that serve it
  on port 4201 and answer unknown paths with `index.html` are enough. It is the shipped artifact,
  needs no worktree, and cannot touch the user's dev-server cache. Use a dev server only to iterate.
- **Never run a second `ng serve` from the main checkout's `web/` while the user's may be up.** Both
  write `web/.angular/cache/<ver>/solar-soundtrack/.tsbuildinfo`, and a corrupted one breaks every
  server, the user's `npm start` included, until that file is deleted with no server running.
- To iterate, serve from a **git worktree** on **port 4201**:
  `git worktree add <scratchpad>/wt HEAD`, junction the root `node_modules` into it
  (`New-Item -ItemType Junction <wt>/node_modules -Target <repo>/node_modules`), copy in the
  working-tree changes you want to see, run `npm run prepare:assets` there, then
  `npx ng serve --port 4201` from its `web/`. (`npm start -- --port 4201` does not work: npm hands
  the port to `ng serve` as a project name.) A different port is also a different origin, so its
  localStorage is not the user's.
- Wait for `Application bundle generation complete` in the server's log, not `failed`. A watching
  server whose build fails keeps serving the last good bundle with a 200, so grep the served
  `main.js` for a string you just added after **every** edit (it is unminified: use a
  space-tolerant pattern). A stale server also serves `/` while 404ing assets: probe
  `/driver/manifest.json` and `/player/spc-worklet.js`.
- If port 4200 is busy it is probably the user's server. Do not kill it.

## 2. The browser

`npm install playwright-core` in the scratchpad (never the repo; older scratchpads' copies are
hollow), then `chromium.launch({ channel: "msedge", headless: true })` — the system Edge, no
download. Add `args: ["--autoplay-policy=no-user-gesture-required"]` when audio matters. The
`claude-in-chrome` tools work too; read state with `javascript_tool` rather than screenshots.

## 3. Seeding and reading state

Seed localStorage with `page.addInitScript` before `goto`:

- `solar-soundtrack.draft` — the MML. On the user's own origin this is their actual work: copy it
  to another key first and prove the restore byte-identical.
- `solar-soundtrack.view` — the raw string `roll` (not JSON) to open the piano roll.
- `solar-soundtrack.pianoroll` —
  `{"zoom":2,"rowHeight":26,"follow":false,"allOctaves":false,"editChannel":0}`. The default row
  height draws no names or glyphs at all; zoom 8 pushes the second bar past the pane's edge, under
  the divider; `editChannel` is the channel the roll edits (`null` edits none).

After `goto`, wait about 4.5 s (compile, then the clock measurement). Then:

- Diagnostics: the `amk-diagnostics-list` text reads `No problems.` or `line N severe AMK0503 …`.
- The source text, whichever view is showing:
  `document.querySelector('.cm-content').cmTile.view.state.doc.toString()`.
- The caret (the inspector follows it):
  `document.querySelector('.cm-content').cmTile.view.dispatch({ selection: { anchor } })` —
  the view is on `cmTile`, not `cmView`.
- Play: the first `amk-transport-controls button` is icon-only. After a click its `title` reads
  `Pause` and it holds an `amk-icon-pause`. `button:has-text("Play")` matches a different element.
  **Loop is off by default.**
- The roll's own `<svg>` is the one inside `div.overflow-y-auto` (sort candidates by height, not
  width). Components are attribute selectors: `[amk-roll-edit] rect`.
- A note's bar is its `rect.fill-ch-N` (two per note share a left edge; keep the wider). Check
  `elementFromPoint(x, y)` before clicking a centre.
- Rings: `g.mark > rect[rx="3"]` for a selected note; `amk-roll-command-lane g.group rect[rx="3"]`
  for a lane glyph, which is found by its `<title>` and clicked at its `rect[rx="2"]` plate.
- Whether an edit landed: the undo button's `disabled`. Two toolbars carry history buttons and the
  source view's is hidden behind the roll, so take the visible one:
  `amk-history-buttons button[title^="Undo"]:visible`.
- An audition sounded: wrap `AudioBufferSourceNode.prototype.start` in an init script and count;
  poll for a few seconds, since a note renders on a worker.

## 4. Gestures

- A drag needs real intermediate moves (`mouse.down()`, several `mouse.move()`, `mouse.up()`) to
  pass the roll's slop test (`SLOP_PX` in `roll-gesture.ts`); too few and nothing commits.
- `page.mouse.click(x, y, { modifiers })` ignores `modifiers`: hold the key with
  `keyboard.down('Shift')` around the click.
- The first pointer interaction after load can race the measurement — retry the first click once.
- `amk-slider` wraps a native range input: set `.value`, then dispatch `input` and `change` with
  `{ bubbles: true }`.
- `page.keyboard.press('Escape')` reaches the roll's `window:keydown` handler without focusing
  anything.
- A transient rebuild error puts a `<vite-error-overlay>` over the page that eats every pointer
  event; reload once the edits are finished.

The long-form notes behind each of these are in the auto memory
(`driving-the-app-headless-on-this-machine.md`).
