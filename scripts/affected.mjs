// Runs the checks that cover the files changed since the last commit, and nothing else.
// Usage: affected.mjs [--dry] [--bail] [--since <ref>] [file ...]
//
// Files named on the command line replace the diff, which answers "what covers this file".
// The changed files are `git diff --name-only <ref>` (HEAD unless `--since`) plus the untracked
// ones. A harness is selected when one of them is an input of its bundle, read from the metafile
// esbuild writes; every harness is bundled first, so the inputs are the imports as they stand.
// Beside the harnesses: Prettier and ESLint on the changed files themselves, the code map and the
// citations, `tsc` for each workspace touched and for what depends on it, and `i18n:check` when a
// template, a `$localize` or the English changed. `--dry` prints the selection and runs nothing.
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import { bundle } from './run-harness.mjs';
import { HARNESSES, npmStep, root, runSteps } from './steps.mjs';

const args = process.argv.slice(2);
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : 'HEAD';
if (since === undefined) {
  console.error('usage: affected.mjs [--dry] [--bail] [--since <ref>]');
  process.exit(2);
}

const git = (...argv) =>
  execFileSync('git', argv, { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '');

/** Paths given on the command line stand in for the diff: "what covers these files". */
const named = args
  .filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--since')
  .map((file) => relative(root, resolve(file)).replace(/\\/g, '/'));

const changed = [
  ...new Set(
    named.length > 0
      ? named
      : [
          ...git('diff', '--name-only', '-z', since),
          ...git('ls-files', '-z', '--others', '--exclude-standard'),
        ],
  ),
].sort();

const origin = named.length > 0 ? 'named' : `changed since ${since}`;
if (changed.length === 0) {
  console.log(`nothing changed since ${since}`);
  process.exit(0);
}

const present = changed.filter((file) => existsSync(join(root, file)));
const quoted = (files) => files.map((file) => `"${file}"`).join(' ');

/** step name -> why it was selected; insertion order is run order. */
const selected = new Map();
const select = (step, why) => {
  if (!selected.has(step.name)) {
    selected.set(step.name, { step, why: [] });
  }

  selected.get(step.name).why.push(why);
};

const some = (files) => `${files.slice(0, 3).join(', ')}${files.length > 3 ? ', ...' : ''}`;

if (present.length > 0) {
  select(
    { name: 'format', command: `npx prettier --check --ignore-unknown ${quoted(present)}` },
    `${present.length} changed file(s)`,
  );
}

const lintable = present.filter((file) => /\.(ts|mjs|js|html)$/.test(file));
if (lintable.length > 0) {
  select(
    {
      name: 'lint',
      command: `npm run --silent generate-git-info && npx eslint --max-warnings 0 --no-warn-ignored ${quoted(lintable)}`,
    },
    `${lintable.length} changed source file(s)`,
  );
}

const SOURCE = /^(packages\/[^/]+\/src|web\/src|scripts)\/.+\.(ts|mjs)$/;
const mapped = changed.filter(
  (file) => SOURCE.test(file) || /^\.claude\/rules\/.+\.md$/.test(file),
);
if (mapped.length > 0) {
  select(npmStep('codemap:check'), some(mapped));
}

const citing = changed.filter((file) => /\.(ts|mjs|html|css|md)$/.test(file));
if (citing.length > 0) {
  select(npmStep('citations:check'), some(citing));
}

// Typechecks: a workspace's own, then the two projects that read every package.
const packages = [...new Set(changed.map((file) => /^packages\/([^/]+)\//.exec(file)?.[1]))].filter(
  (name) => name !== undefined && existsSync(join(root, 'packages', name, 'tsconfig.json')),
);
for (const name of packages) {
  select(
    { name: `tsc packages/${name}`, command: `npx tsc -p packages/${name}` },
    some(changed.filter((file) => file.startsWith(`packages/${name}/`))),
  );
}

const app = changed.filter((file) => file.startsWith('web/'));
if (app.length > 0 || packages.length > 0) {
  select(npmStep('typecheck'), app.length > 0 ? some(app) : 'the app imports every package');
}

// Harnesses. A bundle that will not build is selected, so its error is in the report.
const worklet = await build({
  absWorkingDir: join(root, 'packages', 'spc'),
  entryPoints: ['src/worklet.ts'],
  bundle: true,
  format: 'esm',
  write: false,
  metafile: true,
  logLevel: 'silent',
}).then(
  (result) => Object.keys(result.metafile.inputs).map((input) => `packages/spc/${input}`),
  () => changed,
);

const harnesses = [];
const covered = new Set();
for (const name of HARNESSES) {
  let inputs;
  try {
    await bundle(name, 'silent');
    inputs = Object.keys(
      JSON.parse(readFileSync(join(root, '.selftest', `${name}.meta.json`), 'utf8')).inputs,
    );
    inputs.forEach((input) => covered.add(input));
  } catch {
    harnesses.push([name, 'its bundle does not build']);
    continue;
  }

  // `worklettest` evaluates the built worklet, which its own bundle does not import.
  const covers = new Set(name === 'worklettest' ? [...inputs, ...worklet] : inputs);
  const hits = changed.filter((file) => covers.has(file));
  if (hits.length > 0) {
    harnesses.push([name, some(hits)]);
  }
}

const scripts = changed.filter((file) => /^scripts\/.+\.ts$/.test(file));
if (scripts.length > 0 || harnesses.length > 0) {
  select(
    npmStep('typecheck:scripts'),
    scripts.length > 0 ? some(scripts) : 'the harnesses selected below',
  );
}

for (const [name, why] of harnesses) {
  select(npmStep(name), why);
}

// The English is extracted from a build of the app, so this is also what compiles the templates.
const worded = present.filter((file) => {
  if (file === 'web/src/locale/messages.en.json' || /^web\/src\/.+\.html$/.test(file)) {
    return true;
  }

  return (
    /^(web\/src|packages\/[^/]+\/src)\/.+\.ts$/.test(file) &&
    /\$localize|@Component\(/.test(readFileSync(join(root, file), 'utf8'))
  );
});
const gone = changed.filter((file) => !present.includes(file) && /^web\/src\//.test(file));
if (worded.length > 0 || gone.length > 0) {
  select(npmStep('i18n:check'), some([...worded, ...gone]));
}

console.log(`${changed.length} file(s) ${origin}; selected:`);
const width = Math.max(0, ...[...selected.keys()].map((name) => name.length));
for (const [name, { why }] of selected) {
  console.log(`  ${name.padEnd(width)}  <- ${why.join('; ')}`);
}

const unreached = HARNESSES.filter((name) => !selected.has(name));
console.log(`harnesses not selected: ${unreached.length === 0 ? 'none' : unreached.join(', ')}`);

const uncovered = changed.filter(
  (file) => /^(web\/src\/app|packages\/[^/]+\/src)\/.+\.ts$/.test(file) && !covered.has(file),
);
if (uncovered.length > 0) {
  console.log(`no harness imports: ${uncovered.join(', ')}`);
  console.log('  only the running app shows these working: the drive-the-app skill');
}

if (args.includes('--dry') || selected.size === 0) {
  process.exit(0);
}

console.log('');
process.exit(
  await runSteps(
    [...selected.values()].map(({ step }) => step),
    { bail: args.includes('--bail') },
  ),
);
