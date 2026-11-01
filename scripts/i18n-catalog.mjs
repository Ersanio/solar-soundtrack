// Turns `ng extract-i18n`'s output into web/src/locale/messages.json, sorted by ID so each group
// sits together, or checks that the committed file is current. Usage: i18n-catalog.mjs write|check
import console from 'node:console';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extracted = join(root, '.selftest', 'i18n', 'messages.json');
const catalog = join(root, 'web', 'src', 'locale', 'messages.json');

/** Every ID's first segment. docs/claude/i18n.md says what each group holds. */
const GROUPS = new Set([
  'amk',
  'sst',
  'command',
  'inspector',
  'loops',
  'palette',
  'roll',
  'editor',
  'source',
  'samples',
  'transport',
  'mixer',
  'topbar',
  'output',
  'status',
  'theme',
  'changelog',
  'update',
  'error',
  'common',
]);

const ID = /^[a-z]+(\.[a-z0-9]+(-[a-z0-9]+)*)+$/;

const mode = process.argv[2];
if (mode !== 'write' && mode !== 'check') {
  console.error('usage: i18n-catalog.mjs write|check');
  process.exit(2);
}

const { locale, translations } = JSON.parse(readFileSync(extracted, 'utf8'));

const bad = Object.keys(translations).filter(
  (id) => !ID.test(id) || !GROUPS.has(id.slice(0, id.indexOf('.'))),
);
if (bad.length > 0) {
  console.error('These messages need an @@id of the form group.name, with a known group:');
  for (const id of bad) {
    console.error(`  ${id}: ${JSON.stringify(translations[id]).slice(0, 100)}`);
  }

  process.exit(1);
}

// A template's line breaks are layout, not text: the catalog shows each message on one line.
const tidy = (message) => message.replace(/\s*\n\s*/g, ' ').trim();

const sorted = Object.fromEntries(
  Object.keys(translations)
    .sort()
    .map((id) => [id, tidy(translations[id])]),
);
const text = await prettier.format(JSON.stringify({ locale, translations: sorted }, null, 2), {
  ...(await prettier.resolveConfig(catalog)),
  filepath: catalog,
});

if (mode === 'write') {
  mkdirSync(dirname(catalog), { recursive: true });
  let crlf = false;
  try {
    crlf = readFileSync(catalog, 'utf8').includes('\r\n');
  } catch {
    // A first write: Prettier's line endings stand.
  }

  writeFileSync(catalog, crlf ? text.replace(/\r?\n/g, '\r\n') : text);
  console.log(`${Object.keys(sorted).length} messages written to web/src/locale/messages.json`);
  process.exit(0);
}

let committed = {};
try {
  committed = JSON.parse(readFileSync(catalog, 'utf8')).translations;
} catch {
  // Missing or unreadable: every message counts as added.
}

const added = Object.keys(sorted).filter((id) => !(id in committed));
const removed = Object.keys(committed).filter((id) => !(id in sorted));
const changed = Object.keys(sorted).filter((id) => id in committed && committed[id] !== sorted[id]);
if (added.length + removed.length + changed.length > 0) {
  console.error('web/src/locale/messages.json is out of date; run `npm run i18n`.');
  for (const [label, ids] of [
    ['added', added],
    ['removed', removed],
    ['changed', changed],
  ]) {
    if (ids.length > 0) {
      console.error(`  ${label}: ${ids.slice(0, 20).join(', ')}${ids.length > 20 ? ', …' : ''}`);
    }
  }

  process.exit(1);
}

console.log(`${Object.keys(sorted).length} messages, all current`);
