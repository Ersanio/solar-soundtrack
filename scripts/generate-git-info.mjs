import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outFile = join(scriptDir, '..', 'web', 'src', 'app', 'git-info.generated.ts');

let sha = 'unknown';
try {
  sha = execSync('git rev-parse HEAD', { cwd: scriptDir, encoding: 'utf8' }).trim();
} catch {
  // Not running inside a git checkout (or git is unavailable) — keep the 'unknown' fallback.
}

writeFileSync(outFile, `export const GIT_COMMIT_SHA = '${sha}';\n`);
