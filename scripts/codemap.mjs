// Keeps CODEMAP.md, an index of every source file and what it is for, in step with the code.
// Usage: codemap.mjs write|check
//
// A file's entry is the first sentence of its opening comment, or of its first `/** */` block where
// it opens with code. `write` rewrites the map; `check` fails on a stale map instead. Both fail on a
// source file with no doc comment, since a file the map cannot describe is one nobody can find.
//
// An entry also carries a size floor, a long file an outline, and a directory the rules whose
// `paths:` cover it. `check` compares everything but the outlines' line numbers, so an edit that
// only moves lines leaves the map current; `scripts/CLAUDE.md` has the reasoning.
import { execFileSync } from 'node:child_process';
import console from 'node:console';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'CODEMAP.md');

const mode = process.argv[2];
if (mode !== 'write' && mode !== 'check') {
  console.error('usage: codemap.mjs write|check');
  process.exit(2);
}

/** Where source lives. Templates are left out: each sits beside the `.ts` that describes it. */
const SOURCE = /^(packages\/[^/]+\/src|web\/src|scripts)\/.+\.(ts|mjs)$/;

/** Lines that open a file without describing it: tool pragmas and triple-slash directives. */
const PRAGMA = /^\s*\/\/(\/|\s*(@ts-|eslint-|prettier-))/;

/** Every `/** *\/` block. */
const DOC = /\/\*\*([\s\S]*?)\*\//g;

/** A comment block's text with its `*` gutters taken off. */
const ungutter = (body) =>
  body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join('\n')
    .trim();

function sourceFiles() {
  const listed = execFileSync(
    'git',
    [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'packages',
      'web/src',
      'scripts',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  const files = new Set(listed.split('\0').filter((f) => SOURCE.test(f)));
  return [...files].filter((f) => existsSync(join(root, f))).sort();
}

/**
 * What describes the file: the comment it opens with; else the doc comment on its first exported
 * class or function, decorators allowed in between; else its first top-level doc comment. Null if
 * none of the three exists.
 */
function describingComment(text) {
  const lines = text.split(/\r?\n/);
  let at = 0;
  while (at < lines.length && (lines[at].trim() === '' || PRAGMA.test(lines[at]))) {
    at++;
  }

  if (/^\s*\/\//.test(lines[at] ?? '')) {
    const head = [];
    while (at < lines.length && /^\s*\/\//.test(lines[at])) {
      head.push(lines[at].replace(/^\s*\/\/\s?/, ''));
      at++;
    }

    return head.join('\n');
  }

  if (/^\s*\/\*/.test(lines[at] ?? '')) {
    const block = /\/\*\*?([\s\S]*?)\*\//.exec(lines.slice(at).join('\n'));
    if (block) {
      return ungutter(block[1]);
    }
  }

  const main = /^export (default )?(abstract )?(async )?(class|function) /m.exec(text);
  if (main) {
    const before = text.slice(0, main.index);
    const last = [...before.matchAll(DOC)].at(-1);
    if (last && /^\s*(@[\s\S]*)?$/.test(before.slice(last.index + last[0].length))) {
      return ungutter(last[1]);
    }
  }

  for (const block of text.matchAll(/^\/\*\*([\s\S]*?)\*\//gm)) {
    const body = ungutter(block[1]);
    if (body !== '' && !body.startsWith('@')) {
      return body;
    }
  }

  return null;
}

/** The first sentence of the comment's first paragraph, up to the first `.` outside a code span. */
function firstSentence(comment) {
  const lines = [];
  for (const line of comment.split('\n')) {
    if (line.trim() === '' || /^\s*([-*+]|\d+[.)])\s/.test(line)) {
      break;
    }

    lines.push(line.trim());
  }

  let paragraph = lines.join(' ').replace(/\s+/g, ' ').trim();
  // A paragraph that introduces a list is finished by the list: its items, run on.
  if (paragraph.endsWith(':')) {
    const items = [];
    for (const line of comment.split('\n').slice(lines.length)) {
      const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (item) {
        items.push(item[1].trim());
      } else if (line.trim() === '') {
        break;
      } else if (items.length > 0) {
        items[items.length - 1] += ` ${line.trim()}`;
      }
    }

    if (items.length > 0) {
      const run = items.map((item) =>
        item.replace(/[.;]$/, '').replace(/^[A-Z](?=[a-z])/, (letter) => letter.toLowerCase()),
      );

      return `${paragraph} ${run.join('; ')}.`;
    }
  }

  let inCode = false;
  for (let i = 0; i < paragraph.length; i++) {
    const c = paragraph[i];
    if (c === '`') {
      inCode = !inCode;
    }

    const ends = i + 1 === paragraph.length || paragraph[i + 1] === ' ';
    const abbreviation = /\b(e\.g|i\.e|vs|etc)$/.test(paragraph.slice(0, i));
    if (!inCode && (c === '.' || c === '?' || c === '!') && ends && !abbreviation) {
      return paragraph.slice(0, i + 1);
    }
  }

  return paragraph;
}

/** A file's size is the largest of these it reaches, so an edit rarely moves it and the map stays put. */
const SIZES = [300, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000];

/** From this many lines up a file gets an outline of what it declares. */
const OUTLINED = 1000;

const OUTLINE_WIDTH = 110;

/**
 * Where to look inside a long file: its top-level functions, classes with their methods and
 * exported constants, or for a harness its `section(...)` titles, each with its line.
 */
function outline(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const exported = (node) =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const found = [];
  const add = (name, node) => found.push(`\`${name.replace(/`/g, "'")}\`:${line(node)}`);

  const sections = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'section' &&
      node.arguments.length === 1 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      add(node.arguments[0].text, node);
    }

    ts.forEachChild(node, sections);
  };

  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      add(statement.name.text, statement);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      add(statement.name.text, statement);
      for (const member of statement.members) {
        if (ts.isMethodDeclaration(member) && ts.isIdentifier(member.name)) {
          add(member.name.text, member);
        }
      }
    } else if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          add(declaration.name.text, declaration);
        }
      }
    } else {
      sections(statement);
    }
  }

  const rows = [];
  for (const item of found) {
    if (rows.length > 0 && rows.at(-1).length + item.length < OUTLINE_WIDTH) {
      rows[rows.length - 1] += ` ${item}`;
    } else {
      rows.push(item);
    }
  }

  return rows.map((row) => `  - ${row}`);
}

/** A rule's `paths:` glob as a pattern: `**`, `*` and `{a,b}` are all the rules use. */
function globPattern(glob) {
  const pattern = glob
    .replace(/[.+^$()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]*)\}/g, (_, list) => `(${list.split(',').join('|')})`)
    .replace(/\*\*\/?/g, '<any>')
    .replace(/\*/g, '[^/]*')
    .replace(/<any>/g, '.*');

  return new RegExp(`^${pattern}$`);
}

/** Every rule in `.claude/rules` with the patterns its `paths:` frontmatter lists. */
function rules() {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.claude/rules'],
    { cwd: root, encoding: 'utf8' },
  );
  const found = [];
  for (const file of listed
    .split('\0')
    .filter((f) => f.endsWith('.md'))
    .sort()) {
    if (!existsSync(join(root, file))) {
      continue;
    }

    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(root, file), 'utf8'));
    const globs = [...(front?.[1] ?? '').matchAll(/^\s*-\s*['"]?([^'"\r\n]+?)['"]?\s*$/gm)];
    // The fourteen harness rules are one name here: each covers its own harness and nothing else.
    const name = file.slice('.claude/rules/'.length).replace(/^harnesses\/.+$/, 'harnesses/*.md');
    found.push({ name, patterns: globs.map((glob) => globPattern(glob[1])) });
  }

  return found;
}

const RULES = rules();
const missing = [];
const groups = new Map();
for (const file of sourceFiles()) {
  const text = readFileSync(join(root, file), 'utf8');
  const comment = describingComment(text);
  const summary = comment === null ? '' : firstSentence(comment);
  if (summary === '' || summary.endsWith(':')) {
    missing.push(file);
    continue;
  }

  const slash = file.lastIndexOf('/');
  const dir = file.slice(0, slash);
  if (!groups.has(dir)) {
    groups.set(dir, { files: [], entries: [], rules: new Set() });
  }

  const group = groups.get(dir);
  const count = text.split('\n').length;
  const size = SIZES.findLast((floor) => count >= floor);
  group.files.push(file.slice(slash + 1));
  group.entries.push(
    `- \`${file.slice(slash + 1)}\`${size === undefined ? '' : ` (${size}+ lines)`} — ${summary}`,
    ...(count >= OUTLINED ? outline(file, text) : []),
  );
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(file))) {
      group.rules.add(rule.name);
    }
  }
}

const lines = [
  '# Code map',
  '',
  'Every source file under `packages/*/src`, `web/src` and `scripts`, with the first sentence of its',
  'doc comment. Generated by `npm run codemap`; `npm run check` fails when it is stale. Do not edit by',
  'hand — change the comment and regenerate.',
  '',
  'A size is a floor: `(1500+ lines)` is a file of 1500 to 1999. A file of 1000 lines or more carries',
  'an outline of what it declares, each name with its line as of the last regeneration; grep for the',
  'name if the line has drifted. **Rules** names the `.claude/rules/` files whose `paths:` cover',
  'something in the directory, which load by themselves when such a file is opened.',
];
for (const [dir, group] of groups) {
  lines.push('', `## ${dir}`, '');
  if (group.rules.size > 0) {
    lines.push(
      `**Rules:** ${[...group.rules]
        .sort()
        .map((rule) => `\`${rule}\``)
        .join(', ')}`,
      '',
    );
  }

  if (group.files.every((file) => /^icon-[\w-]+\.ts$/.test(file))) {
    const names = group.files.map((file) => `\`${file.slice('icon-'.length, -'.ts'.length)}\``);
    lines.push(
      `- ${names.length} icon components, \`icon-<name>.ts\`, one glyph each: ${names.join(', ')}`,
    );
  } else {
    lines.push(...group.entries);
  }
}

const generated = await prettier.format(lines.join('\n') + '\n', {
  ...(await prettier.resolveConfig(target)),
  filepath: target,
});

if (missing.length > 0) {
  console.error(
    `${missing.length} source file(s) have no doc comment for the code map, or one whose first sentence ends in a colon:\n${missing.map((f) => `  ${f}`).join('\n')}`,
  );
}

/** The map without its outlines' line numbers, which move on every edit and are not what staleness means. */
const comparable = (text) =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => (line.startsWith('  - ') ? line.replace(/`:\d+/g, '`') : line))
    .join('\n');

const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
if (mode === 'check') {
  if (current === null || comparable(current) !== comparable(generated)) {
    console.error('CODEMAP.md is stale. Run `npm run codemap`.');
    process.exit(1);
  }

  process.exit(missing.length > 0 ? 1 : 0);
}

const crlf = current === null ? process.platform === 'win32' : current.includes('\r\n');
writeFileSync(target, crlf ? generated.replace(/\n/g, '\r\n') : generated);
console.log(`CODEMAP.md: ${[...groups.values()].reduce((n, g) => n + g.files.length, 0)} files`);
process.exit(missing.length > 0 ? 1 : 0);
