// The merge gate behind `npm run check`: formatting, the code map, the citations, three typechecks,
// every harness, and the English, as separate steps reported in one table.
// Usage: check.mjs [--bail] [--list] [step ...]
//
// Every step runs even after one fails, unless `--bail`. Naming steps runs only those, in the
// gate's own order: `npm run check -- rolltest i18n:check`. Retries, logs and the report are
// `steps.mjs`.
import console from 'node:console';
import process from 'node:process';
import { HARNESSES, npmStep, runSteps } from './steps.mjs';

const STEPS = [
  'format:check',
  'codemap:check',
  'citations:check',
  'typecheck',
  'typecheck:packages',
  'typecheck:scripts',
  ...HARNESSES,
  // Last: it builds the app, which is the one step that compiles the Angular templates.
  'i18n:check',
];

const args = process.argv.slice(2);
const named = args.filter((arg) => !arg.startsWith('--'));
const unknown = named.filter((name) => !STEPS.includes(name));
if (args.includes('--list') || unknown.length > 0) {
  if (unknown.length > 0) {
    console.error(`no such step: ${unknown.join(', ')}`);
  }

  console.log(STEPS.join('\n'));
  process.exit(unknown.length > 0 ? 2 : 0);
}

const steps = STEPS.filter((name) => named.length === 0 || named.includes(name)).map(npmStep);
process.exit(await runSteps(steps, { bail: args.includes('--bail') }));
