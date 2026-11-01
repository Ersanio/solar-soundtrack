// Keeps web/src/locale/messages.en.json, the English for every message, in step with the IDs in the
// code. Usage: i18n-catalog.mjs write|check
//
// The code carries IDs, not text: a message's source text is its ID and its placeholders.
// `write` adds a stub for a new ID and drops a removed one; `check` fails on either, on a stub, on
// English whose placeholders differ from the code's, and on a message whose source is not its ID.
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extracted = join(root, '.selftest', 'i18n', 'messages.json');
const english = join(root, 'web', 'src', 'locale', 'messages.en.json');

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

// A template's line breaks are layout, not text.
const tidy = (message) => message.replace(/\s*\n\s*/g, ' ').trim();

/** The cases of a message that is one ICU, or null: `{VAR_PLURAL, plural, =1 {…} other {…}}`. */
function icuCases(message) {
  const head = message.match(/^\{VAR_[A-Z_0-9]+, (?:plural|select),/);
  if (!head || !message.endsWith('}')) {
    return null;
  }

  const cases = [];
  const body = message.slice(head[0].length, -1);
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open < 0) {
      break;
    }

    let depth = 0;
    let close = open;
    for (; close < body.length; close++) {
      depth += body[close] === '{' ? 1 : body[close] === '}' ? -1 : 0;
      if (depth === 0) {
        break;
      }
    }

    cases.push(body.slice(open + 1, close));
    i = close + 1;
  }

  return cases;
}

/** Placeholder names in a message: `{$NAME}`, and `{NAME}` inside an ICU case. */
function placeholders(message) {
  const cases = icuCases(message);
  const parts = cases ?? [message];
  const pattern = cases ? /\{\$?([A-Za-z0-9_]+)\}/g : /\{\$([A-Za-z0-9_]+)\}/g;
  return [...new Set(parts.flatMap((part) => [...part.matchAll(pattern)].map((m) => m[1])))].sort();
}

/** Whether a source text is its ID and nothing else besides placeholders, in every ICU case. */
function isIdOnly(id, message) {
  const strip = (part) =>
    part
      .replace(/\{\$?[A-Za-z0-9_]+\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return (icuCases(message) ?? [message]).every((part) => strip(part) === id);
}

const source = JSON.parse(readFileSync(extracted, 'utf8')).translations;
const failures = [];

const bad = Object.keys(source).filter(
  (id) => !ID.test(id) || !GROUPS.has(id.slice(0, id.indexOf('.'))),
);
if (bad.length > 0) {
  console.error('These messages need an @@id of the form group.name, with a known group:');
  for (const id of bad) {
    console.error(`  ${id}: ${JSON.stringify(source[id]).slice(0, 100)}`);
  }

  process.exit(1);
}

const worded = Object.keys(source).filter((id) => !isIdOnly(id, tidy(source[id])));
if (worded.length > 0) {
  console.error('These messages have words in the code; it holds the ID, the English goes in');
  console.error('web/src/locale/messages.en.json:');
  for (const id of worded) {
    console.error(`  ${id}: ${JSON.stringify(tidy(source[id])).slice(0, 100)}`);
  }

  process.exit(1);
}

let current = {};
try {
  current = JSON.parse(readFileSync(english, 'utf8')).translations;
} catch {
  // Missing or unreadable: every message counts as added.
}

const ids = Object.keys(source).sort();
const added = ids.filter((id) => !(id in current));
const removed = Object.keys(current).filter((id) => !(id in source));

if (mode === 'write') {
  // A new ID's stub is its source text, so the page shows the ID until the English is written.
  const translations = Object.fromEntries(
    ids.map((id) => [id, id in current ? current[id] : tidy(source[id])]),
  );
  const text = await prettier.format(JSON.stringify({ locale: 'en', translations }, null, 2), {
    ...(await prettier.resolveConfig(english)),
    filepath: english,
  });
  let crlf = false;
  try {
    crlf = readFileSync(english, 'utf8').includes('\r\n');
  } catch {
    // A first write: Prettier's line endings stand.
  }

  writeFileSync(english, crlf ? text.replace(/\r?\n/g, '\r\n') : text);
  console.log(`${ids.length} messages in web/src/locale/messages.en.json`);
  if (added.length > 0) {
    console.log(`  added, English to write: ${added.join(', ')}`);
  }

  if (removed.length > 0) {
    console.log(`  removed: ${removed.join(', ')}`);
  }

  process.exit(0);
}

const unwritten = ids.filter((id) => id in current && current[id] === tidy(source[id]));
const mismatched = ids.filter(
  (id) => id in current && placeholders(current[id]).join() !== placeholders(source[id]).join(),
);

for (const [label, list] of [
  ['no English', added],
  ['English for an ID the code no longer has', removed],
  ['English still the stub `npm run i18n` wrote', unwritten],
  ['placeholders differ from the code', mismatched],
]) {
  if (list.length > 0) {
    failures.push(`  ${label}: ${list.slice(0, 20).join(', ')}${list.length > 20 ? ', …' : ''}`);
  }
}

if (failures.length > 0) {
  console.error('web/src/locale/messages.en.json is out of step with the code:');
  console.error(failures.join('\n'));
  for (const id of mismatched.slice(0, 5)) {
    console.error(
      `  ${id}: code has {${placeholders(source[id])}}, English {${placeholders(current[id])}}`,
    );
  }

  console.error('Run `npm run i18n` to add and drop IDs, then write the English.');
  process.exit(1);
}

console.log(`${ids.length} messages, all with English`);
