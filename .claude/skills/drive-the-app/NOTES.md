# Driving the editor: the long form

The reasoning behind `SKILL.md`, and the details that only matter once something looks broken.
`scripts/drive/drive.mjs` does the launching, seeding, waiting and reading; these notes say why it
does each the way it does, and what a steps file has to know.

## Why drive it at all

The app's templates and runtime behaviour are covered by neither `npm run typecheck` nor the
harnesses. Driving the built app is the only check on a binding that compiles and does nothing, on
a gesture, or on anything the transport does once audio is running.

## The browser

`chromium-cli` is not on this machine and no browser is downloaded. `playwright-core` launches the
system Edge: `chromium.launch({ channel: 'msedge', headless: true })`. It is installed outside the
repository — `npm install --prefix <scratchpad>\pw playwright-core` takes about a second — and
reached through `NODE_PATH`, which `require` reads and `import` does not; `drive.mjs` therefore
loads it with `createRequire`. A `node_modules/playwright-core` left in an older session's
scratchpad is hollow, so install into the current one rather than pointing at an old path.

`--audio` adds `--autoplay-policy=no-user-gesture-required`. With it, pressing play genuinely
starts the emulated SPC700 and the 10 Hz driver-state stream, so playhead behaviour is testable
headlessly.

Every run is a new browser context, which is a new profile: its localStorage belongs to nobody.
Service workers are blocked in it, because the production build registers one and a cached shell
from an earlier build would be served in place of the one on disk.

The `claude-in-chrome` tools are a working alternative. Navigate a fresh tab and read state with
`javascript_tool` rather than screenshots — grid lines, `<select>` options and tick counts are far
easier to assert from the DOM than to eyeball, the first screenshot after a navigate often times
out once and succeeds on retry, and screenshots time out for as long as an audition is rendering
while `javascript_tool` still answers. Its `left_click_drag` sends too few `pointermove`s for the
roll's slop test, so a drag made with it commits nothing.

## The server

`scripts/drive/serve.mjs` serves a built directory on a port the operating system picks, bound to
the loopback address, and prints the URL. It mounts the build under the `<base href>` its
`index.html` declares (`/` for a local build; CI builds with `--base-href=/<repository>/`). A path
with no extension and no file answers with `index.html`; a missing file with an extension is a 404,
so a missing asset shows up in the snapshot's `failedRequests` rather than as HTML where bytes were
expected. `.wasm` is served as `application/wasm`, which streaming compilation requires.

**Where the build comes from is the dangerous part.** Two Angular builds or servers running from
one `web/` both write `web/.angular/cache/<ver>/solar-soundtrack/.tsbuildinfo`; concurrent writes
leave valid JSON followed by leftover bytes, and from then on every server — the user's `npm start`
included — fails with `Angular compilation initialization failed` or TypeScript's
`Debug Failure. Expected C:/…/.tsbuildinfo === C:\…\.tsbuildinfo`. It survives restarts. The fix is
to delete that one file (it is a cache) with no server running. The prevention is a git worktree,
which has a `web/.angular` of its own:

```powershell
git worktree add --detach <scratchpad>\wt HEAD
New-Item -ItemType Junction -Path <scratchpad>\wt\node_modules -Target "<repo>\node_modules"
```

A junction, not a symlink, needs no admin rights. The workspace links under `node_modules/@amk/*`
are relative, so inside the worktree they resolve to the worktree's own `packages/`, which is what
makes the build honest. Copy the working-tree files under test into it, then `npm run build` at its
root; the pre-hooks run by themselves there. A worktree's `.git` is a file, not a directory, so a
script that probes `.git/<something>` has to ask `git rev-parse --git-path <something>` instead.

Tear down in this order: `cmd /c rmdir <scratchpad>\wt\node_modules` (removes the junction and
nothing behind it), then `git worktree remove --force <scratchpad>\wt`. `Remove-Item -Recurse` on
the worktree with the junction still in place follows it into the real `node_modules`.

**A dev server, for iterating.** From the worktree: `npm run prepare:assets` at its root, then
`npx ng serve --port 4201` from its `web/`. A bare `ng serve` skips the pre-hooks, which is why
`prepare:assets` is run by hand here and nowhere else; `npm start -- --port 4201` is not a way
round it, since npm hands the port to `ng serve` as a project name. Drive it with
`--url http://localhost:4201/`.

- Wait for `Application bundle generation complete` in its log, not `failed`.
- **A watching server goes stale silently when a build fails, and keeps serving the last good
  bundle at 200.** "My string is in `main.js`" proves that one build landed, never that the current
  source is live, so grep again after every edit. `ng serve` output is unminified: grep with a
  space-tolerant pattern (`'idle *=== *wasIdle'`). This is fatal for an A/B test of a hunk — a
  `TS6133: declared but never read` from deleting the only reader of a `let` freezes the bundle,
  both arms measure the same build, and they "agree".
- A server left running across a restructure serves `/` at 200 while 404ing every asset. Probe
  `/driver/manifest.json` and `/player/spc-worklet.js`; under the driver those show up in
  `failedRequests`.
- Editing source while a page is open can put a `<vite-error-overlay>` over the app on a transient
  rebuild error. It intercepts every pointer event; the snapshot reports it as `errorOverlay`.
  Reload once the edits are finished.

**The user's own server on port 4200 is not for driving.** An origin is scheme, host and port, so
any other port has a localStorage of its own. On `:4200`, `solar-soundtrack.draft` is the user's
actual work and typing in the editor overwrites it. If something forces a session onto that origin
through the user's real browser, copy the draft to a separate localStorage key first (a `window.`
variable does not survive a reload), take its length and a cheap hash, and prove the restore
byte-identical. Do not kill that server either; find a PID with `netstat -ano | findstr :4200` only
for a server you started.

## What is seeded

`drive.mjs` writes these through `page.addInitScript`, before any of the app's scripts run, once
per profile so a reload inside a steps file keeps what the steps typed:

- `solar-soundtrack.draft` — the MML as plain text (`EditorStore`'s `source` reads it; with no key
  the app opens on `SAMPLE_SONG`). Written only under `--song`.
- `solar-soundtrack.view` — the bare word `source`, `roll` or `samples` (`editor-pane.ts`). It is
  not JSON: `'"roll"'` matches no view and leaves the app on Source.
- `solar-soundtrack.pianoroll` — JSON, read field by field by `readSettings` in
  `roll-settings.ts`, which keeps its default for any field that fails its check. The driver
  writes `{ zoom, rowHeight, follow: false, allOctaves: false, editChannel }`.
  - `rowHeight` 26 (one of 6, 9, 13, 18, 26, 36). `fitBarContent` returns nothing below
    `MIN_CONTENT_HEIGHT`, and the app's default of 9 leaves a bar 7 tall, so a default roll has
    bars with no `text` and no `g.group` at all — which reads as a broken template and is not.
  - `zoom` 2 (one of 0.5, 1, 2, 4, 8). Zoom stretches width only. At 8 a quarter note is 384 px, so
    on a 1600 px viewport the second bar's centre is past the roll pane's right edge, under the
    pane divider, which swallows the click.
  - `follow: false` keeps the camera still under a playing song.
  - `editChannel` is the channel the roll edits, 0–7; `null` (`--channel none`) edits none, and then drawing on empty grid and the keyboard shortcuts are refused.

Other keys the app keeps, should a steps file need them: `solar-soundtrack.clock` (the transport's
clock face), `.problems` and `.build` (`open`/`closed`), `.split`, `.drawer`, `.theme`, `.samples`.

## Readiness

The driver polls every 100 ms, up to `--timeout`, for all of:

1. the status dot (`amk-status-bar`'s first child) exists and CodeMirror's view is attached;
2. the dot is not pulsing — `busy` covers both the driver bundle loading and the first compile;
3. every message posted to a worker has been answered;
4. nothing in a fingerprint of the page (status sentence, clock, diagnostic count, mark count, the
   roll's `viewBox`, the worker counts) has changed for a settle window.

The worker count is the reason for an init-script wrapper round `Worker`. The clock measurement
starts a second after a compile holds still (`MEASURE_IDLE_MS`) and runs on a worker, and for a
song the driver keeps up with it changes nothing in the DOM, so there is nothing else to wait on.
Once a reply has been seen the settle window is 400 ms; until then it is 1500 ms, long enough for a
measurement that is going to be asked for to have been. A compile that failed measures nothing and
takes the short window. A typical cold load is ready in about 1.6 s.

The measurement matters for more than the clock: it can add `SST0503`, and the first pointer
interaction after load can race it — a bar click that opens no inspector. Retry the first click
once before believing a handler is broken.

## Reading the page

Everything goes through `scripts/drive/selectors.mjs`. The app has no test hooks, so the selectors
are structural; each has a comment saying what it finds. None matches English text, so a run
against `npm run start:ids` reads the same structure, with message IDs where the words would be.
Parsed numbers (`diagnostics[].line`) are taken from the digits for that reason.

- **Source.** `document.querySelector('.cm-content').cmTile.view` is the EditorView, in whichever
  tab is showing, since the source view is hidden rather than destroyed. This CodeMirror keeps the
  view on `cmTile`; `.cmView` is undefined. `view.state.doc.toString()` is the text;
  `view.dispatch({ selection: { anchor } })` moves the caret, and the inspector follows it.
- **Diagnostics.** `amk-diagnostics-list li > button`, three spans each: the line, `severity CODE`,
  the message. No rows is no problems. The list is in the DOM whether or not the Problems section
  is folded, so it is read with `textContent`.
- **Status bar.** The dot's class says the kind (`animate-pulse` busy, `bg-good` ok, `bg-danger`
  error). The readouts after the two buttons are the walk's note count and the tempo with its tick
  rate (`t254 · 231.9 of 498.0 ticks/s` when the driver cannot keep up).
- **Transport.** The first `amk-transport-controls > button` is play, icon-only; while playing it
  holds an `amk-icon-pause`. `button:has-text("Play")` finds a different element that clicks
  without error and starts nothing, which looks exactly like a broken AudioContext. Loop is the
  third button and **off by default**, so anything about wrapping has to turn it on first or the
  song plays once and stops. The seek bar's `value` and `max` are driver ticks. The clock well (the
  fifth button) shows `m:ss / m:ss`, or the tick face at frame rate once clicked (persisted as
  `solar-soundtrack.clock`).
- **The playhead in the roll**, in ticks: `(line.stroke-accent x1 − the scroll group's translate
x) / zoom`, which holds in both follow modes because the key column cancels.
- **The roll's own `<svg>`** is the one inside `div.overflow-y-auto`. `amk-piano-roll svg` matches
  toolbar icons first, and sorting `svg[viewBox]` by width does not help: the overview bar (36 px
  tall) and the scrub bar (20 px) are exactly as wide as the roll by construction. Measure the
  scroller for the visible pane, not the `<svg>`, which moves when the roll scrolls.
- **Components inside that `<svg>` are attribute selectors**: `g[amk-roll-notes]`,
  `g[amk-roll-loops]`, `g[amk-roll-edit]`.
- **A note** is a `g.mark`. Its bar is two `rect[rx="2"]` sharing a left edge — the slot, then the
  narrower gate — with the channel in the class `fill-ch-N`. The group's own bounding box includes
  the label and the glyph plates, so its centre can fall a row off the bar: the snapshot's `client`
  box is the slot's. Only the notes near the camera are in the DOM, and those include bars scrolled
  out of the pane, so `inPane` says which a pointer can reach.
- **Empty grid has to be computed** from the bars' own boxes, not guessed: a spot past the notes is
  easily past the pane's right edge too, and a press on a bar moves that note instead of drawing.
- **Rings.** A selected note has `g.mark > rect[rx="3"]`; an inspected bar chip
  `g.mark g.group rect[rx="3"]`; the command lane `amk-roll-command-lane g.group rect[rx="3"]`.
  `g.mark g.group rect` also matches `<rect>`s inside a glyph's own artwork, so tally plates by
  class rather than by count.
- **A lane glyph** is found by its `<title>` (`Volume · v200 · #0 · tick 0 · …`, in the snapshot as
  `roll.laneGlyphs`) and clicked at its `rect[rx="2"]` plate.
- **Loop boxes.** One `rect.loop-edge` per drawn pass, with `data-channel`, `data-body`,
  `data-tick` and `data-ticks`. It takes the pointer on its stroke only.
- **A tooltip.** `dispatchEvent('pointerenter')` on the `g.mark`; `hover()` times out when two
  channels' marks overlap, since the upper rect intercepts the pointer.
- **Whether an edit landed.** The undo button's `disabled`. Two toolbars carry history buttons and
  the source view's is hidden behind the roll, so the snapshot reads the visible pair.
- **Whether an audition sounded.** Wrap `AudioBufferSourceNode.prototype.start` in an init script
  (`page.addInitScript` from a steps file, then `page.reload()`) and count. `Audition` is the only
  buffer-source user on the page — the transport is an AudioWorklet — and a note renders on a
  worker, so poll for the increment for a few seconds.
- **The inspector's empty state** is its placeholder, the message `inspector.put-the-cursor-on`
  ("Put the cursor on a note or command …").

## Gestures

- **A drag needs real intermediate moves.** `mouse.down()`, several `mouse.move()`, `mouse.up()`;
  with too few the roll's slop test (`SLOP_PX`, `roll-gesture.ts`) never trips, nothing commits and
  undo stays disabled. `helpers.drag` makes twelve by default.
- **`page.mouse.click(x, y, { modifiers })` silently ignores `modifiers`** — only
  `locator.click()` takes them — so a "shift-click" made that way is a plain click and the test
  measures the wrong path. `helpers.clickAt` and `helpers.drag` hold the keys with
  `keyboard.down`.
- **Check what is under the point first.** `helpers.elementAt(x, y)` should answer
  `rect.fill-ch-N…`; `DIV.bg-edge…cursor-col-resize` is the pane divider.
- **`amk-slider` wraps a native `input[type=range]`.** Set `.value`, dispatch `input` then `change`
  with `{ bubbles: true }`, and preview and commit fire as a real drag's do — commit only if the
  value differs. `helpers.setRange` does this.
- **`page.keyboard.press('Escape')` reaches the roll's `window:keydown` handler** with `body` as
  the target, so nothing needs focusing first.
