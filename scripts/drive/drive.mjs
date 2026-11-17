// Drives the built editor in headless Edge and prints what it shows as one JSON snapshot.
// Usage: node scripts/drive/drive.mjs [--dist [dir] | --url <url>] [--song <file.mml>] [--snapshot]
//          [--steps <file.mjs>] [--screenshot <png>] [--out <json>] [--view source|roll|samples]
//          [--channel <0-7|none>] [--zoom <n>] [--row-height <n>] [--marks <n>] [--viewport WxH]
//          [--timeout <ms>] [--audio] [--ids] [--headed]
//
// It opens the app in a fresh browser profile, seeds the draft and the roll's settings through
// localStorage before the page's own scripts run, waits until the compile has landed and the
// workers have gone quiet, then reads the DOM through `selectors.mjs`. `--dist` serves a build
// through `serve.mjs` on a free port; `--url` drives a server that is already up. A steps file
// exports `default async ({ page, snapshot, helpers }) => …` and runs before the snapshot and the
// screenshot are taken. The JSON goes to stdout (or `--out`), everything else to stderr, and the
// exit code is 1 when the page never became ready or the steps threw.
//
// `playwright-core` is not a dependency of this repository; the script says how to supply it.
/* global document, window, localStorage, getComputedStyle */
import console from 'node:console';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import {
  CHANNEL_FILL_PATTERN,
  SELECTORS,
  STATUS_BUSY_CLASS,
  STATUS_ERROR_CLASS,
  STATUS_OK_CLASS,
  TOGGLE_PRESSED_CLASS,
} from './selectors.mjs';
import { DEFAULT_DIST, startServer } from './serve.mjs';

const USAGE = `usage: node scripts/drive/drive.mjs [options]

  --dist [dir]        serve a build and drive it (default: web/dist/solar-soundtrack/browser)
  --url <url>         drive a server that is already running instead
  --song <file.mml>   seed this file as the draft (default: the app's own sample song)
  --view <name>       source | roll | samples (default: roll)
  --channel <n|none>  the channel the roll edits, 0-7 (default: 0)
  --zoom <n>          0.5 | 1 | 2 | 4 | 8 (default: 2)
  --row-height <n>    6 | 9 | 13 | 18 | 26 | 36 (default: 26, the least that draws names and glyphs)
  --snapshot          print the JSON snapshot (the default when no --steps or --screenshot is given)
  --steps <file.mjs>  run \`export default async ({ page, snapshot, helpers }) => …\` first
  --screenshot <png>  save a screenshot after the steps
  --out <json>        write the snapshot to a file instead of stdout
  --marks <n>         how many note marks to list (default: 200; the counts cover all of them)
  --viewport <WxH>    default 1600x900
  --timeout <ms>      how long to wait for the page to be ready (default: 30000)
  --audio             let the page start audio without a user gesture
  --ids               the server is \`npm run start:ids\`: text fields hold message IDs
  --headed            show the browser window`;

const VALUE_FLAGS = new Set([
  'url',
  'song',
  'view',
  'channel',
  'zoom',
  'row-height',
  'steps',
  'screenshot',
  'out',
  'marks',
  'viewport',
  'timeout',
]);
const BOOLEAN_FLAGS = new Set(['snapshot', 'audio', 'ids', 'headed', 'help']);

/** The command line as a record. `--dist` takes its directory only when one follows. */
function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    const next = argv[i + 1];
    if (name === 'dist') {
      options.dist = next && !next.startsWith('--') ? argv[++i] : DEFAULT_DIST;
    } else if (name && VALUE_FLAGS.has(name) && next !== undefined) {
      options[name] = argv[++i];
    } else if (name && BOOLEAN_FLAGS.has(name)) {
      options[name] = true;
    } else {
      throw new Error(`unknown or incomplete argument: ${argv[i]}`);
    }
  }

  return options;
}

/**
 * `playwright-core`, from wherever Node can find it.
 *
 * Through `require` and not `import`, because only `require` reads `NODE_PATH`, which is how a
 * copy installed outside the repository is reached.
 */
function loadPlaywright() {
  for (const from of [import.meta.url, pathToFileURL(join(process.cwd(), 'drive.cjs')).href]) {
    try {
      return createRequire(from)('playwright-core');
    } catch {
      // Try the next place.
    }
  }

  throw new Error(
    [
      'playwright-core could not be resolved.',
      'It is deliberately not a dependency of this repository. Install it somewhere outside the',
      'repository (a temp or scratchpad directory) and point NODE_PATH at it:',
      '',
      '  npm install --prefix <dir> playwright-core',
      '  PowerShell:  $env:NODE_PATH = "<dir>\\node_modules"; node scripts/drive/drive.mjs …',
      '  Bash:        NODE_PATH="<dir>/node_modules" node scripts/drive/drive.mjs …',
      '',
      'No browser download is needed: the driver launches the installed Microsoft Edge.',
    ].join('\n'),
  );
}

/**
 * Runs in the page before any of its scripts: seeds localStorage and counts worker traffic.
 *
 * The draft is seeded once per browser profile, so a reload inside a steps file keeps what the
 * steps typed. The worker counts are what makes "the clock measurement has landed" observable:
 * the measurement changes nothing in the DOM for a song the driver keeps up with.
 */
function initScript({ storage }) {
  try {
    if (localStorage.getItem('solar-soundtrack.driven') === null) {
      for (const [key, value] of Object.entries(storage)) {
        localStorage.setItem(key, value);
      }

      localStorage.setItem('solar-soundtrack.driven', '1');
    }
  } catch {
    // Storage refused; the app runs on its defaults.
  }

  const traffic = { started: 0, posted: 0, replied: 0 };
  window.__driveWorkers = traffic;
  const Native = window.Worker;
  if (Native) {
    window.Worker = class extends Native {
      constructor(...args) {
        super(...args);
        traffic.started++;
        this.addEventListener('message', () => traffic.replied++);
      }

      postMessage(...args) {
        // The note previewer's `prepare` is never answered: it asks the worker to make
        // checkpoints ahead of the notes, and nobody waits on them.
        if (args[0]?.kind !== 'prepare') {
          traffic.posted++;
        }

        return super.postMessage(...args);
      }
    };
  }
}

/** Runs in the page: everything the snapshot reports, read through the selectors. */
function readPage({ selectors, classes, channelPattern, markLimit }) {
  const one = (selector, within = document) => within.querySelector(selector);
  const all = (selector, within = document) => [...within.querySelectorAll(selector)];
  const text = (element) => element?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const number = (value) => (value === null || value === undefined ? null : Number(value));
  const digits = (value) => {
    const found = value?.replace(/[^\d]/g, '') ?? '';
    return found === '' ? null : Number(found);
  };

  const visible = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
  };

  const channelOf = new RegExp(channelPattern);

  const view = one(selectors.cmContent)?.cmTile?.view ?? null;
  let stored = null;
  try {
    stored = localStorage.getItem('solar-soundtrack.draft');
  } catch {
    // Storage refused.
  }

  const dot = one(selectors.statusDot);
  const dotClass = dot?.getAttribute('class') ?? '';
  const status = {
    kind: !dot
      ? null
      : dotClass.includes(classes.busy)
        ? 'busy'
        : dotClass.includes(classes.ok)
          ? 'ok'
          : dotClass.includes(classes.error)
            ? 'error'
            : 'info',
    text: text(one(selectors.statusText)),
    problems: text(one(selectors.statusProblems)),
    aram: text(one(selectors.statusAram)),
    readouts: all(selectors.statusReadouts)
      .filter((element) => element.tagName === 'SPAN')
      .map(text),
  };

  const diagnostics = all(selectors.diagnosticRows).map((row) => {
    const [line, code, message] = all(':scope > span', row).map(text);
    const [severity, id] = (code ?? '').split(' ');
    return { line: digits(line), severity: severity ?? null, code: id ?? null, message };
  });

  const play = one(selectors.play);
  const seek = one(selectors.seek);
  const transport = play
    ? {
        playing: one(selectors.pauseIcon, play) !== null,
        canPlay: !play.disabled,
        canStop: !(one(selectors.stop)?.disabled ?? true),
        loop: one(selectors.loop)?.getAttribute('class')?.includes(classes.pressed) ?? null,
        hotReload:
          one(selectors.hotReload)?.getAttribute('class')?.includes(classes.pressed) ?? null,
        clock: text(one(selectors.clock)),
        positionTicks: seek ? Number(seek.value) : null,
        durationTicks: seek ? Number(seek.max) : null,
        canSeek: seek ? !seek.disabled : null,
      }
    : null;

  const history = all(selectors.historyButtons).filter(visible);
  const scroller = one(selectors.rollScroller);
  let roll = null;
  if (one(selectors.roll)) {
    const pane = scroller?.getBoundingClientRect() ?? null;
    const perChannel = {};
    const marks = [];
    let selected = 0;
    for (const mark of all(selectors.marks)) {
      const bars = all(selectors.markBars, mark);
      const slot = bars[0];
      if (!slot) {
        continue;
      }

      const channel = number(channelOf.exec(slot.getAttribute('class') ?? '')?.[1]);
      perChannel[channel] = (perChannel[channel] ?? 0) + 1;
      const ringed = one(selectors.markRing, mark) !== null;
      selected += ringed ? 1 : 0;
      if (marks.length >= markLimit) {
        continue;
      }

      // The attributes are the roll's own coordinates; the box is where a pointer would land.
      const box = slot.getBoundingClientRect();
      marks.push({
        channel,
        x: number(slot.getAttribute('x')),
        y: number(slot.getAttribute('y')),
        width: number(slot.getAttribute('width')),
        height: number(slot.getAttribute('height')),
        gate: number(bars[1]?.getAttribute('width')),
        label: text(one(selectors.markLabel, mark)),
        glyphs: all(selectors.markGlyphs, mark).length,
        selected: ringed,
        muted: mark.classList.contains('pointer-events-none'),
        client: {
          x: Math.round(box.x * 10) / 10,
          y: Math.round(box.y * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        },
        inPane: pane
          ? box.right > pane.left &&
            box.left < pane.right &&
            box.bottom > pane.top &&
            box.top < pane.bottom
          : null,
      });
    }

    const playhead = one(selectors.playhead);
    let settings = null;
    try {
      settings = JSON.parse(localStorage.getItem('solar-soundtrack.pianoroll') ?? 'null');
    } catch {
      // Not JSON.
    }

    roll = {
      drawn: one(selectors.rollSvg) !== null,
      pane: pane
        ? {
            x: Math.round(pane.x),
            y: Math.round(pane.y),
            width: Math.round(pane.width),
            height: Math.round(pane.height),
          }
        : null,
      viewBox: one(selectors.rollSvg)?.getAttribute('viewBox') ?? null,
      warnings: all(selectors.rollWarnings).map(text),
      markCount: Object.values(perChannel).reduce((sum, count) => sum + count, 0),
      marksPerChannel: perChannel,
      selectedMarks: selected,
      marks,
      loopBoxes: all(selectors.loopEdges).map((edge) => ({
        channel: number(edge.dataset.channel),
        body: number(edge.dataset.body),
        tick: number(edge.dataset.tick),
        ticks: number(edge.dataset.ticks),
        x: number(edge.getAttribute('x')),
        y: number(edge.getAttribute('y')),
        width: number(edge.getAttribute('width')),
        height: number(edge.getAttribute('height')),
      })),
      laneGlyphs: all(selectors.laneGlyphs).map((glyph) => text(one('title', glyph))),
      playheadX: playhead ? number(playhead.getAttribute('x1')) : null,
      editChannel: settings?.editChannel ?? null,
      settings,
    };
  }

  return {
    source: view ? view.state.doc.toString() : stored,
    caret: view ? view.state.selection.main.head : null,
    status,
    diagnostics,
    transport,
    history: {
      canUndo: history[0] ? !history[0].disabled : null,
      canRedo: history[1] ? !history[1].disabled : null,
    },
    roll,
    workers: { ...(window.__driveWorkers ?? {}) },
    errorOverlay: one(selectors.errorOverlay) !== null,
  };
}

/** Runs in the page: the cheap fingerprint the readiness poll compares between passes. */
function readPulse({ selectors, classes }) {
  const dot = document.querySelector(selectors.statusDot);
  const traffic = window.__driveWorkers ?? { started: 0, posted: 0, replied: 0 };
  const play = document.querySelector(selectors.play);
  return {
    booted: dot !== null && document.querySelector(selectors.cmContent)?.cmTile?.view != null,
    busy: dot?.getAttribute('class')?.includes(classes.busy) ?? true,
    ok: dot?.getAttribute('class')?.includes(classes.ok) ?? false,
    canPlay: play ? !play.disabled : false,
    posted: traffic.posted,
    replied: traffic.replied,
    print: [
      document.querySelector(selectors.statusText)?.textContent,
      document.querySelector(selectors.clock)?.textContent,
      document.querySelectorAll(selectors.diagnosticRows).length,
      document.querySelectorAll(selectors.marks).length,
      document.querySelector(selectors.rollSvg)?.getAttribute('viewBox'),
      traffic.posted,
      traffic.replied,
    ].join('|'),
  };
}

const CLASSES = {
  busy: STATUS_BUSY_CLASS,
  ok: STATUS_OK_CLASS,
  error: STATUS_ERROR_CLASS,
  pressed: TOGGLE_PRESSED_CLASS,
};

/** How long the page must hold still once the clock measurement has answered. */
const SETTLE_MS = 400;
/**
 * How long it must hold still when no worker has been asked anything.
 *
 * Longer than the second the app waits after a compile before measuring the clock, so a
 * measurement that is going to be asked for has been by the time this runs out.
 */
const SETTLE_UNMEASURED_MS = 1500;
const POLL_MS = 100;

/**
 * Waits for the page to be ready to read and to take a gesture.
 *
 * Ready is: the status dot has stopped pulsing (the driver loaded and a compile landed, or
 * failed), every message posted to a worker has been answered, and nothing the snapshot reads
 * has changed for a settle window. Resolves with whether that happened inside the timeout.
 */
async function waitForReady(page, timeout) {
  const deadline = Date.now() + timeout;
  let last = '';
  let since = Date.now();
  let pulse = null;
  while (Date.now() < deadline) {
    try {
      pulse = await page.evaluate(readPulse, { selectors: SELECTORS, classes: CLASSES });
    } catch {
      pulse = null; // Mid-navigation; ask again.
    }

    const now = Date.now();
    if (!pulse || pulse.print !== last) {
      last = pulse?.print ?? '';
      since = now;
    }

    if (pulse && pulse.booted && !pulse.busy && pulse.posted === pulse.replied) {
      // A compile that failed measures nothing, so there is no answer to wait for.
      const measured = pulse.replied > 0 || !pulse.ok;
      if (now - since >= (measured ? SETTLE_MS : SETTLE_UNMEASURED_MS)) {
        return { ready: true, waitedMs: timeout - (deadline - now) };
      }
    }

    await sleep(POLL_MS);
  }

  return { ready: false, waitedMs: timeout, pulse };
}

/** What a steps file is handed beside `page` and `snapshot`. */
function makeHelpers(page, options, timeout) {
  return {
    selectors: SELECTORS,
    /** True under `--ids`: text read from the page is message IDs, so match on structure. */
    ids: options.ids === true,
    /** Waits for the compile and the workers to settle again, after an edit or a reload. */
    waitForReady: (ms = timeout) => waitForReady(page, ms),
    /** The document's text. */
    source: () =>
      page.evaluate((selector) => {
        return document.querySelector(selector).cmTile.view.state.doc.toString();
      }, SELECTORS.cmContent),
    /** Replaces the whole document, as one undoable change, and waits for the compile. */
    setSource: async (text) => {
      await page.evaluate(
        ({ selector, text }) => {
          const view = document.querySelector(selector).cmTile.view;
          view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        },
        { selector: SELECTORS.cmContent, text },
      );
      return waitForReady(page, timeout);
    },
    /** Puts the caret at a document offset; the inspector follows it. */
    setCaret: (anchor) =>
      page.evaluate(
        ({ selector, anchor }) => {
          document.querySelector(selector).cmTile.view.dispatch({ selection: { anchor } });
        },
        { selector: SELECTORS.cmContent, anchor },
      ),
    /** What is under a point, as `TAG.class…`: the check to make before clicking a bar's centre. */
    elementAt: (x, y) =>
      page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          return hit ? `${hit.tagName}.${hit.getAttribute('class') ?? ''}` : null;
        },
        { x, y },
      ),
    /** The centre of a mark from a snapshot, in page pixels. */
    centreOf: (mark) => ({
      x: mark.client.x + mark.client.width / 2,
      y: mark.client.y + mark.client.height / 2,
    }),
    /**
     * A drag with real intermediate moves, which is what gets a roll gesture past its slop test.
     * `modifiers` are held for the whole drag, since `page.mouse` ignores a `modifiers` option.
     */
    drag: async (from, to, { steps = 12, modifiers = [] } = {}) => {
      for (const key of modifiers) {
        await page.keyboard.down(key);
      }

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps,
        );
      }

      await page.mouse.up();
      for (const key of [...modifiers].reverse()) {
        await page.keyboard.up(key);
      }
    },
    /** A click with a modifier really held. */
    clickAt: async (x, y, { modifiers = [], count = 1 } = {}) => {
      for (const key of modifiers) {
        await page.keyboard.down(key);
      }

      await page.mouse.click(x, y, { clickCount: count });
      for (const key of [...modifiers].reverse()) {
        await page.keyboard.up(key);
      }
    },
    /** Presses play or pause and resolves with whether the song is now playing. */
    togglePlay: async () => {
      await page.locator(SELECTORS.play).click();
      await sleep(150);
      return page.evaluate(
        ({ play, pause }) => document.querySelector(play)?.querySelector(pause) !== null,
        { play: SELECTORS.play, pause: SELECTORS.pauseIcon },
      );
    },
    /** Sets a native range input, firing what a real drag fires: `input`, then `change`. */
    setRange: (selector, value) =>
      page.evaluate(
        ({ selector, value }) => {
          const input = document.querySelector(selector);
          input.value = String(value);
          input.dispatchEvent(new window.Event('input', { bubbles: true }));
          input.dispatchEvent(new window.Event('change', { bubbles: true }));
        },
        { selector, value },
      ),
    sleep,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  if (options.url && options.dist) {
    throw new Error('--url and --dist are alternatives; pass one');
  }

  const view = options.view ?? 'roll';
  if (!['source', 'roll', 'samples'].includes(view)) {
    throw new Error(`--view is source, roll or samples, not ${view}`);
  }

  const editChannel = options.channel === 'none' ? null : Number(options.channel ?? 0);
  const [width, height] = (options.viewport ?? '1600x900').split('x').map(Number);
  const timeout = Number(options.timeout ?? 30000);
  const markLimit = Number(options.marks ?? 200);
  if (![width, height, timeout, markLimit].every((n) => Number.isFinite(n) && n >= 0)) {
    throw new Error('--viewport, --timeout and --marks take numbers');
  }

  // The stored shapes are the app's own: the draft is the MML as text, the view a bare word and
  // not JSON, and the roll's settings the JSON `readSettings` checks field by field.
  const storage = {
    'solar-soundtrack.view': view,
    'solar-soundtrack.pianoroll': JSON.stringify({
      zoom: Number(options.zoom ?? 2),
      rowHeight: Number(options['row-height'] ?? 26),
      follow: false,
      allOctaves: false,
      editChannel,
    }),
  };
  if (options.song) {
    storage['solar-soundtrack.draft'] = readFileSync(resolve(options.song), 'utf8');
  }

  const { chromium } = loadPlaywright();
  const wantsSnapshot = options.snapshot || options.out || !(options.steps || options.screenshot);

  let server = null;
  let browser = null;
  let failed = false;
  try {
    let url = options.url;
    if (!url) {
      server = await startServer({ dir: options.dist ?? DEFAULT_DIST });
      url = server.url;
      console.error(`serving ${server.dir} at ${url}`);
    }

    browser = await chromium.launch({
      channel: 'msedge',
      headless: !options.headed,
      args: options.audio ? ['--autoplay-policy=no-user-gesture-required'] : [],
    });
    // A new context is a new profile: its localStorage is nobody's work. Service workers are
    // blocked so a production build cannot answer from a cache of an earlier one.
    const context = await browser.newContext({
      viewport: { width, height },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => pageErrors.push(String(error?.stack ?? error)));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });
    page.on('requestfailed', (request) => {
      failedRequests.push(`${request.failure()?.errorText ?? 'failed'} ${request.url()}`);
    });

    await page.addInitScript(initScript, { storage });
    await page.goto(url, { waitUntil: 'load', timeout });
    const readiness = await waitForReady(page, timeout);
    if (!readiness.ready) {
      failed = true;
      console.error(`the page was not ready after ${timeout} ms; the snapshot is what it shows`);
    }

    const snapshot = async () => ({
      url: page.url(),
      ids: options.ids === true,
      ready: readiness.ready,
      waitedMs: readiness.waitedMs,
      ...(await page.evaluate(readPage, {
        selectors: SELECTORS,
        classes: CLASSES,
        channelPattern: CHANNEL_FILL_PATTERN.source,
        markLimit,
      })),
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      failedRequests: [...failedRequests],
    });

    let stepsResult;
    let stepsError = null;
    if (options.steps) {
      const steps = await import(pathToFileURL(resolve(options.steps)).href);
      if (typeof steps.default !== 'function') {
        throw new Error(`${options.steps} has no default export to run`);
      }

      try {
        stepsResult = await steps.default({
          page,
          snapshot,
          helpers: makeHelpers(page, options, timeout),
        });
      } catch (error) {
        failed = true;
        stepsError = String(error?.stack ?? error);
        console.error(`the steps threw: ${stepsError}`);
      }
    }

    if (options.screenshot) {
      const target = resolve(options.screenshot);
      mkdirSync(dirname(target), { recursive: true });
      await page.screenshot({ path: target });
      console.error(`screenshot: ${target}`);
    }

    if (wantsSnapshot) {
      const result = await snapshot();
      if (options.steps) {
        result.steps = { result: stepsResult ?? null, error: stepsError };
      }

      const json = JSON.stringify(result, null, 2);
      if (options.out) {
        const target = resolve(options.out);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, json);
        console.error(`snapshot: ${target}`);
      } else {
        console.log(json);
      }
    }
  } finally {
    await browser?.close();
    await server?.close();
  }

  return failed ? 1 : 0;
}

try {
  if (process.argv.includes('--dist') || !process.argv.includes('--url')) {
    const at = process.argv.indexOf('--dist');
    const named = at >= 0 ? process.argv[at + 1] : undefined;
    const dir = named && !named.startsWith('--') ? named : DEFAULT_DIST;
    if (!process.argv.includes('--help') && !existsSync(join(resolve(dir), 'index.html'))) {
      throw new Error(
        `no build at ${resolve(dir)}\n` +
          'Build one (see .claude/skills/drive-the-app/SKILL.md for the safe way) and pass its ' +
          'browser directory with --dist, or pass --url for a server that is already running.',
      );
    }
  }

  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof Error && error.message.startsWith('unknown or incomplete')) {
    console.error(`\n${USAGE}`);
  }

  process.exitCode = 2;
}
