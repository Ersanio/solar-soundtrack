// Bundles one harness into `.selftest/<name>.mjs` and runs it under `node --enable-source-maps`.
// Usage: run-harness.mjs <name> [--bundle-only]
//
// The bundle carries a sourcemap, so a FAIL line and a stack name source lines, and esbuild's
// metafile goes beside it as `.selftest/<name>.meta.json`, which is what `affected.mjs` reads to
// know which source files a harness covers. The bundle can be run again without rebuilding:
// `node --enable-source-maps .selftest/<name>.mjs`.
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.selftest');

/** A harness is `scripts/<name>.ts`, or `scripts/<name>/main.ts` where it is split into sections. */
export function entryOf(name) {
  for (const entry of [`scripts/${name}.ts`, `scripts/${name}/main.ts`]) {
    if (existsSync(join(root, entry))) {
      return entry;
    }
  }

  return null;
}

/** Writes the bundle, its sourcemap and its metafile. Paths in the metafile are relative to the root. */
export async function bundle(name, logLevel = 'warning') {
  const entry = entryOf(name);
  if (entry === null) {
    throw new Error(
      `no harness named ${name}: neither scripts/${name}.ts nor scripts/${name}/main.ts`,
    );
  }

  const result = await build({
    absWorkingDir: root,
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(out, `${name}.mjs`),
    sourcemap: true,
    metafile: true,
    logLevel,
  });

  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${name}.meta.json`), JSON.stringify(result.metafile));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const name = process.argv[2];
  if (!name || name.startsWith('-')) {
    console.error('usage: run-harness.mjs <name> [--bundle-only]');
    process.exit(2);
  }

  try {
    await bundle(name);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (process.argv.includes('--bundle-only')) {
    process.exit(0);
  }

  const run = spawnSync(process.execPath, ['--enable-source-maps', join(out, `${name}.mjs`)], {
    cwd: root,
    stdio: 'inherit',
  });

  // A signal has no exit status; 139 is what a shell reports for the segfault it usually is.
  process.exit(run.status ?? 139);
}
