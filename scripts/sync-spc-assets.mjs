/**
 * Mirrors `packages/spc/assets/` into `web/public/`.
 *
 * The driver bundle and the emulator belong to `@amk/spc` — the harnesses read
 * them straight out of the package, and nothing about them is the editor's — but
 * the Angular builder refuses an asset path outside its workspace root, so the
 * app cannot simply point at them. Copying is what bridges that, and the copies
 * are gitignored: `packages/spc/assets/` is the only source of truth.
 *
 * The destinations are wiped first, so a sample deleted from the package cannot
 * survive in the app's copy and go on being served.
 */

import { cpSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const name of ['driver', 'player']) {
  const to = join(root, 'web', 'public', name);
  rmSync(to, { recursive: true, force: true });
  cpSync(join(root, 'packages', 'spc', 'assets', name), to, { recursive: true });
}
