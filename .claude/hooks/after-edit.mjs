// Claude Code's after-edit hook (PostToolUse on Edit and Write): puts back the CRLF line endings the
// tools sometimes drop, then runs Prettier over the file. A parse error is reported back to Claude
// with exit 2; any other failure is silent, since the hook must never stand in the way of an edit.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Extensions the tools write as text. Anything else is left alone. */
const TEXT = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ps1',
  '.ts',
  '.yaml',
  '.yml',
]);

/** Reference sources, dependencies and build output: never touched. */
const SKIP = [
  'AddmusicKsrc',
  'AddmusicKreadme',
  'node_modules',
  '.selftest',
  'web/dist',
  'web/.angular',
];

async function readInput() {
  let text = '';
  for await (const chunk of process.stdin) {
    text += chunk;
  }

  return JSON.parse(text);
}

/** The working tree is CRLF wherever Git converts on checkout. */
function wantsCrlf() {
  const git = spawnSync('git', ['config', '--get', 'core.autocrlf'], {
    cwd: root,
    encoding: 'utf8',
  });
  return git.stdout.trim() === 'true';
}

/** The repository-relative path, or null for a file this hook does not own. */
function owned(target) {
  if (typeof target !== 'string') {
    return null;
  }

  const rel = relative(root, resolve(target));
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return null;
  }

  const path = rel.split(sep).join('/');
  if (SKIP.some((dir) => path === dir || path.startsWith(`${dir}/`))) {
    return null;
  }

  return TEXT.has(extname(path).toLowerCase()) ? path : null;
}

async function main() {
  const input = await readInput();
  const path = owned(input?.tool_input?.file_path);
  if (path === null) {
    return;
  }

  const file = join(root, path);
  const original = readFileSync(file, 'utf8');
  let text = original;
  if (wantsCrlf() && /(^|[^\r])\n/.test(text)) {
    text = text.replace(/\r?\n/g, '\r\n');
  }

  let failure = null;
  try {
    const { default: prettier } = await import('prettier');
    const info = await prettier.getFileInfo(file, {
      ignorePath: [join(root, '.gitignore'), join(root, '.prettierignore')],
    });
    if (!info.ignored && info.inferredParser) {
      const options = await prettier.resolveConfig(file);
      text = await prettier.format(text, { ...options, filepath: file });
    }
  } catch (error) {
    if (error?.loc || error?.name === 'SyntaxError') {
      failure = error.message;
    }
  }

  if (text !== original) {
    writeFileSync(file, text);
  }

  if (failure !== null) {
    console.error(`Prettier could not parse ${path}:\n${failure}`);
    process.exitCode = 2;
  }
}

main().catch(() => {});
