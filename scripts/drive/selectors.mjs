// Every DOM selector the app driver reads the running editor through, one comment each on what it finds.
//
// The app carries no test hooks, so these are structural: component selectors, attribute
// components, child positions and the utility classes a state is drawn with. None matches on
// English text, so they hold under `npm run start:ids` as well. A template that reorders its
// children moves the positional ones, and `drive.mjs --snapshot` then reports nulls rather than
// wrong values, which is the cue to come back here.

export const SELECTORS = {
  // --- Source ---------------------------------------------------------------

  /** CodeMirror's content element. Its `cmTile.view` is the EditorView, in whichever tab is showing. */
  cmContent: '.cm-content',

  // --- Status bar -----------------------------------------------------------

  /** The compile status dot: the bar's first child. It carries `statusBusyClass` while a compile or the driver load is pending. */
  statusDot: 'amk-status-bar > span:nth-child(1)',
  /** The compile status sentence beside the dot ("1234 bytes · 3.1 ms", or the error count). */
  statusText: 'amk-status-bar > span:nth-child(2)',
  /** The problems count, the bar's first button. Its text holds the count when there are two or more. */
  statusProblems: 'amk-status-bar > button:nth-of-type(1)',
  /** The free-ARAM button, the bar's second. */
  statusAram: 'amk-status-bar > button:nth-of-type(2)',
  /** The song-wide readouts after the two buttons: the walk's note count, then the tempo and tick rate. */
  statusReadouts: 'amk-status-bar > span.tabular-nums',

  // --- Diagnostics ----------------------------------------------------------

  /** One row per diagnostic. Three spans each: the line, `severity CODE`, the message. No rows means no problems. */
  diagnosticRows: 'amk-diagnostics-list li > button',

  // --- Transport ------------------------------------------------------------

  /** Play/pause: the transport's first button, icon-only. Disabled until a driver has loaded. */
  play: 'amk-transport-controls > button:nth-of-type(1)',
  /** Present inside `play` only while the song is playing. */
  pauseIcon: 'amk-icon-pause',
  /** Stop: the second button. */
  stop: 'amk-transport-controls > button:nth-of-type(2)',
  /** The Loop toggle: the third button. Lit when it carries `togglePressedClass`. */
  loop: 'amk-transport-controls > button:nth-of-type(3)',
  /** The Hot reload toggle: the fourth button. */
  hotReload: 'amk-transport-controls > button:nth-of-type(4)',
  /** The clock well: the fifth button. Its text is `m:ss / m:ss` or the tick face; a click flips it. */
  clock: 'amk-transport-controls > button:nth-of-type(5)',
  /** The seek bar: the one range input that is a direct child. `value` and `max` are driver ticks. */
  seek: 'amk-transport-controls > input[type="range"]',

  // --- Editor pane ----------------------------------------------------------

  /** The view tabs, in template order: Source, Piano roll, then Samples after the divider. */
  tabs: 'amk-editor-pane amk-tabs button',
  /** Undo and redo, in that order. Two toolbars carry a pair and the source view's is hidden behind the roll, so filter to the visible one. */
  historyButtons: 'amk-history-buttons button',

  // --- Piano roll -----------------------------------------------------------

  /** The roll component; absent while another tab is showing. */
  roll: 'amk-piano-roll',
  /** The roll's vertical scroller. Measure this for the visible pane, not the `<svg>` inside it, which moves when the roll scrolls. */
  rollScroller: 'amk-piano-roll div.overflow-y-auto',
  /** The roll's own `<svg>`. Toolbar icons and the two bars over the roll are `<svg>`s too, hence the scroller. */
  rollSvg: 'amk-piano-roll div.overflow-y-auto > svg',
  /** The roll's warning strip: one row per thing the walk could not make sense of. */
  rollWarnings: 'amk-piano-roll > ul > li',
  /** One group per drawn note. Only the notes near the camera are in the DOM, not the whole song. */
  marks: 'g[amk-roll-notes] g.mark',
  /** A mark's two bars, relative to the mark: the slot, then the gate, sharing a left edge. The class `fill-ch-N` is the channel. */
  markBars: ':scope > rect[rx="2"]',
  /** A mark's selection ring, relative to the mark; present only on a selected note. */
  markRing: ':scope > rect[rx="3"]',
  /** A mark's name ("C6"), relative to the mark. Absent below the row height that has room for text. */
  markLabel: ':scope > text',
  /** A mark's command glyphs, relative to the mark. The plate to click is each group's `rect[rx="2"]`. */
  markGlyphs: ':scope > g.group',
  /** One per drawn loop pass. Carries `data-channel`, `data-body`, `data-tick` and `data-ticks`. */
  loopEdges: 'g[amk-roll-loops] rect.loop-edge',
  /** The playhead line inside the roll's `<svg>`. */
  playhead: 'amk-piano-roll div.overflow-y-auto line.stroke-accent',
  /** The edit layer: the preview of a gesture in flight. */
  editLayer: 'g[amk-roll-edit]',
  /** A glyph in the command lane under the roll. Found by its `<title>`, clicked at its `rect[rx="2"]`. */
  laneGlyphs: 'amk-roll-command-lane g.group',
  /** The eight channel chips in the corner over the key column. */
  channelChips: 'amk-roll-channels button',

  // --- Dev server -----------------------------------------------------------

  /** Vite's overlay for a failed rebuild. It covers the page and eats every pointer event. */
  errorOverlay: 'vite-error-overlay',
};

/** On `statusDot` while the status is `busy`. */
export const STATUS_BUSY_CLASS = 'animate-pulse';

/** On `statusDot` when the compile succeeded. */
export const STATUS_OK_CLASS = 'bg-good';

/** On `statusDot` when the compile or the driver load failed. */
export const STATUS_ERROR_CLASS = 'bg-danger';

/** On an `amk-toggle` button while it is pressed. */
export const TOGGLE_PRESSED_CLASS = 'bg-control/20';

/** A bar's channel, from its fill class. */
export const CHANNEL_FILL_PATTERN = /\bfill-ch-(\d)\b/;
