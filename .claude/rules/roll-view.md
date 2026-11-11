---
paths:
  - 'web/src/app/editor/views/piano-roll/piano-roll.{ts,html}'
  - 'web/src/app/editor/views/piano-roll/roll-{view,camera,layout,selection,shortcuts,metrics,target,pictures,marks,bar-text,lengths,settings,preview}.ts'
  - 'web/src/app/editor/views/piano-roll/roll-{scrub,overview,grid,toolbar,tooltip,keys,lanes,notes,channels,edit-layer}/**'
  - 'web/src/app/util/on-change.ts'
---

# Piano roll: view and interaction

Read before changing the roll's camera, scrub and overview bars, grid, cursor, hover, pointer
handling, selection or toolbar.

## How it works now

`piano-roll.ts` holds the song's shape and the porter's settings and calls four composables from
its field initialisers, in dependency order: `rollView`, `rollTarget`, `rollGestures`,
`rollPictures`. The flat `roll-*.ts` files they lean on are Angular-free so `charttest` and
`rolltest` can import them. `roll-architecture.md` has the reasoning; this is the map.

**Camera** (`roll-view.ts`, `roll-camera.ts`, `roll-layout.ts`). `rollCamera` is a module record
of signals that outlives the component, which is rebuilt on every tab switch. `viewTick` is the
tick at the roll's left edge; `scroll` is one `transform` at frame rate, bound in the parent so no
child re-evaluates. Following pages (`pageStart`, `PAGE_TURN_AT`, `PAGE_STEP`) or pins the playhead
at `PLAYHEAD_AT`; `setFollow(false)` parks the view at `panTick`. The playhead is drawn at the
song's own tick (`xAtTick`, unclamped), so it leaves the pane when the view is parked. Every
tick↔x mapping is in `roll-layout.ts`: `tickWindow`, `xAtTick`, `tickAtX`, `overviewOffset`,
`overviewTick`, `gridLines`, `laneStack`.

**Two bars, one job each.** `roll-overview/` is the whole song and moves the view (`onPanStart`,
`onPanTo`, `onPanEnd`); `roll-scrub/` is the roll's own timeline and moves the song
(`onScrubStart`…, previewing through `playback.scrubTo` and committing one `seek`). Both only
report an x; both `<svg>`s are sized in pixels.

**Pictures** (`roll-pictures.ts`, `roll-marks.ts`). Every picture is a `computed` over one mark
window — `tickWindow` snapped outward to a whole note off the 10 Hz anchor — and never over the
frame clock. `rowOf` places a note for the bars, the minimap and the lit keys alike; `buildMarks`,
`buildMinimap` and the loop builders share the file. `roll-preview.ts` draws a gesture in flight
off its `Plan`, and `RollNotes` is told which bars that plan is moving (`movingSpans`).

**Which channel** (`roll-target.ts`). `editChannel` is the channel really picked, a field of the
persisted `Settings` (`roll-settings.ts`); `editing` falls back to the channel of the bar under the
pointer, so a bar can be grabbed before a channel is chosen. Keys, labels and lane packing read
`editChannel`. A channel the mixer silences cannot be edited and drops its selection
(`followMixer`, through `onChange` so only the transition acts).

**Pointer.** A bar's `click` asks the inspector and its `dblclick` reveals the source
(`roll-notes/`), so the roll's note `pointerdown` neither captures the pointer nor prevents the
default until the press has travelled `SLOP_PX`. The cursor is a `computed` (`hoverCursor`) over
the hover, not set from the move handler. The middle-button pan is `piano-roll.ts`'s
(`onEditDown`), taken before the gesture layer.

**Selection** is a set of strip indices owned by `roll-gesture.ts`. A strip is rebuilt on every
compile, so a selection crosses a commit as `NoteAnchor`s (`anchorsFor`, `notesAtAnchors` in
`roll-selection.ts`) and is published outside the roll only as spans
(`EditorRequests.selectedRun`). `roll-shortcuts.ts` is the keyboard, as plain callbacks.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/roll-view.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **Parking the roll in an `effect` on the follow flag** — `setFollow`
- **Seeking the roll by `Shift`+wheel, committed on a 200 ms quiet timer**
- **One bar over the roll doing both jobs** — `roll-overview/`, `roll-scrub/`, `playTick`,
  `songHead`, `headTick`
- **`w-full` on the bars over the roll** — `elementSize`, `viewBox`
- **Roll rows on the emitted note byte** — `NoteAddress.written`
- **A single click on a roll bar revealing the source** — `reveal`
- **A component element inside the roll's `<svg>`** — `palettetest`
- **A fixed quarter-note grid in the roll, with a heavier rule every whole note and no bars** —
  `gridLines`, `tickWindow`
- **Capturing the pointer, and preventing the default, on the roll's `pointerdown`** — `click`,
  `dblclick`, `itemAt`
- **The roll's playhead line derived from `lead`** — `xAtTick`
- **An HTML bubble for the roll's length readout**
- **The roll's page anchor reset on the transport being idle, rather than on its going idle** —
  `roll-camera.ts`
- **Keeping the roll alive behind `[class.hidden]`**
- **`cursor-pointer` on the roll's note bars** — `cursor`, `NOTE_GAP`, `itemAt`, `hoverCursor`,
  `pointer`
- **Moving `editChannel` onto `Mixer`** — `Settings`, `localStorage`, `followMixer`, `onChange`,
  `util/on-change.ts`, `roll-view.ts`, `untracked`, `silenced()`
- **Refusing every gesture until a channel is picked** — `editing`, `hovered`, `onPointerDown`,
  `editRefusal`, `onKey`, `editChannel`
- **A muted channel editable but un-clickable** — `silencedReason`, `Audition`
- **Setting that cursor from the pointer move that reported the position** — `crosshair`,
  `computed`, `Hover`, `pointerdown`
- **The roll's own bars drawn without regard to the gesture in flight** — `Plan`, `moving`,
  `movingSpans`, `buildMarks`, `planGesture`, `Ctrl`
- **A refused plan returning `NOTHING`** — `touched`, `blocked`, `Preview.refused`, `rowOfPlaced`
- **Letting the wheel size a note that is already being dragged** — `planGesture`, `Gesture`,
  `SLOP_PX`, `stepLength`, `stretch`
- **`shownPlan` gated on `moved || kind === 'spawn'` alone**
- **The middle-button pan inside `roll-gesture.ts`** — `Strip`, `onEditDown`, `Move`, `pointerdown`,
  `mousedown`
- **Snapping a drag's destination rather than the distance it travelled** — `draggedTick`, `moved`,
  `run()`, `spawn`, `quantize`
- **One `Shift` flag for both of the gestures it changes** — `anchored`, `shift`
- **`Shift` as a row lock alone, or `Ctrl` as the tick lock beside it** — `shift`
- **The overview bar's minimap in one grey, deduped by pixel and row alone** — `MUTED_OPACITY`,
  `charttest`
- **Dropping the roll's selection on every change to the document, and again in every commit** —
  `Strip`, `sourceChanged`, `EditBatch.keepsNotes`, `dispatchBatch`, `expect`, `plannedOrdinals`,
  `roll-selection.ts`, `planEdits`
- **The roll toolbar's readout line** — `rollClock`, `slowTick`
- **The toolbar's messages at `ml-auto` in the wrapping strip** — `title`
