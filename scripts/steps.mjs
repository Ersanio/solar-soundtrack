// What `check.mjs` and `affected.mjs` share: running a list of steps and reporting them as one table.
//
// A step is a shell command. Its whole output goes to `.selftest/logs/<step>.log` and the terminal
// gets one line per step, then a table, then each failure's FAIL lines and the end of its log, so a
// CI log alone says what broke. A step that dies the way Node dies on a flaky machine (see
// `crashed`) is run again, twice at most, and reported as passed on retry.
import { spawn } from 'node:child_process';
import console from 'node:console';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logs = join(root, '.selftest', 'logs');

/** Every harness, in the order `npm run check` runs them. */
export const HARNESSES = [
  'selftest',
  'tokentest',
  'edittest',
  'palettetest',
  'adsrtest',
  'instrtest',
  'brrtest',
  'firtest',
  'spctest',
  'audiotest',
  'worklettest',
  'walktest',
  'charttest',
  'rolltest',
];

/** A step that is one of the root `package.json` scripts. */
export const npmStep = (name) => ({ name, command: `npm run --silent ${name}` });

const RETRIES = 2;
const FAIL_LINES = 12;
const TAIL_LINES = 30;

/** Exit codes of a process that died below the JS layer: a segfault as a shell, V8 and Windows report it. */
const CRASH_CODES = new Set([139, 3, 3221225477, -1073741819]);

/** Whether a failed run looks like the environment's crash rather than the step's own verdict. */
function crashed(code, output) {
  return code === null || CRASH_CODES.has(code) || /Segmentation fault|Fatal error in/.test(output);
}

// eslint-disable-next-line no-control-regex -- stripping terminal colour is the point
const plain = (text) => text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');

function run(command) {
  return new Promise((resolve) => {
    // Through the shell: `npm` is `npm.cmd` on Windows, which `spawn` will not start by name.
    const child = spawn(command, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('error', (error) => resolve({ code: 1, output: String(error) }));
    child.on('close', (code) => resolve({ code, output: plain(chunks.join('')) }));
  });
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

/** One step, retried while it crashes. Writes its log and answers what the table shows. */
async function runStep(step) {
  const started = Date.now();
  const log = join(logs, `${step.name.replace(/[^\w.-]+/g, '-')}.log`);
  let text = '';
  let crashes = 0;
  let last;
  for (;;) {
    last = await run(step.command);
    text += `$ ${step.command}\n${last.output}\n[exit ${last.code}]\n\n`;
    if (last.code === 0 || !crashed(last.code, last.output) || crashes === RETRIES) {
      break;
    }

    crashes++;
  }

  writeFileSync(log, text);
  const passed = last.code === 0;
  const crashing = !passed && crashed(last.code, last.output);
  let result = passed ? 'ok' : 'FAILED';
  if (passed && crashes > 0) {
    result = `crashed ${crashes}x, passed on retry`;
  } else if (crashing) {
    result = `CRASHED ${crashes + 1}x (exit ${last.code})`;
  }

  const lines = last.output.split('\n');
  const tally = /^\S+: (\d+ passed, \d+ failed)$/m.exec(last.output);

  return {
    name: step.name,
    passed,
    result,
    ms: Date.now() - started,
    tally: tally ? tally[1] : '',
    fails: [...new Set(lines.filter((line) => /^\s*FAIL\b/.test(line)).map((l) => l.trim()))],
    tail: lines.filter((line) => line.trim() !== '').slice(-TAIL_LINES),
    log: relative(root, log).replace(/\\/g, '/'),
  };
}

function table(results) {
  const rows = results.map((r) => [r.name, r.result, r.ms === null ? '' : seconds(r.ms), r.tally]);
  const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => row[column].length)));
  for (const row of rows) {
    const cells = row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column]) : cell));
    console.log(`  ${cells.join('  ').trimEnd()}`);
  }
}

/**
 * Runs the steps in order and prints the report. Carries on past a failure unless `bail`, in which
 * case the steps after it are listed as skipped. Answers the process exit code.
 */
export async function runSteps(steps, { bail = false } = {}) {
  mkdirSync(logs, { recursive: true });
  const started = Date.now();
  const results = [];
  let stopped = false;
  for (const [index, step] of steps.entries()) {
    if (stopped) {
      results.push({ name: step.name, passed: true, result: 'skipped', ms: null, tally: '' });
      continue;
    }

    process.stdout.write(`[${index + 1}/${steps.length}] ${step.name} ... `);
    const result = await runStep(step);
    results.push(result);
    console.log(`${result.result} (${seconds(result.ms)})`);
    stopped = bail && !result.passed;
  }

  const failures = results.filter((result) => !result.passed);
  console.log('');
  table(results);

  for (const failure of failures) {
    console.log(`\n--- ${failure.name}: ${failure.result} --- full output: ${failure.log}`);
    for (const line of failure.fails.slice(0, FAIL_LINES)) {
      console.log(`  ${line}`);
    }

    if (failure.fails.length > FAIL_LINES) {
      console.log(`  ... and ${failure.fails.length - FAIL_LINES} more FAIL lines in the log`);
    }

    console.log(`  last ${failure.tail.length} lines:`);
    for (const line of failure.tail) {
      console.log(`    ${line}`);
    }
  }

  const skipped = results.filter((result) => result.result === 'skipped').length;
  const ran = results.length - skipped;
  console.log(
    `\n${failures.length === 0 ? 'all' : `${failures.length} of`} ${ran} step(s) ${failures.length === 0 ? 'passed' : 'FAILED'}` +
      `${skipped > 0 ? `, ${skipped} skipped` : ''} in ${seconds(Date.now() - started)}` +
      `${failures.length > 0 ? `: ${failures.map((f) => f.name).join(', ')}` : ''}`,
  );

  return failures.length === 0 ? 0 : 1;
}
