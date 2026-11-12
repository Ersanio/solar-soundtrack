---
name: add-harness
description: Use when adding a new test harness under scripts/, splitting one into section files, renaming or removing one — every place a harness is registered, so it runs in the merge gate and its guidance loads.
---

# Adding a harness

First ask whether an existing harness owns the module: a new section file in a split harness
(`scripts/<name>/`, listed in its `main.ts` and in the table of its rule), or a new block in a
single-file harness, needs none of the registration below.
A new harness is for a seam nothing covers. `scripts/CLAUDE.md` says what each one proves and how
they are run; read it first.

## Write it

1. `scripts/<name>.ts`, or `scripts/<name>/main.ts` with section files and a `support.ts` beside
   it where it will grow (`scripts/pianorolltest/` is the model). `scripts/run-harness.mjs` finds either.
2. It opens with a `/** */` doc comment: its first sentence is the harness's entry in `CODEMAP.md`,
   and the gate fails on a file without one.
3. `import "./localize";` comes before every other import, so each module after it finds
   `$localize` and the English (`"../localize"` from a folder).
4. Use `check`, `section`, `summarise`, `SPC_ASSETS` and `stubFetch` from `scripts/harness.ts`; do
   not write another copy. End with `summarise()`.
5. Comments say what is pinned, never what once broke (root `CLAUDE.md`).
6. Formatting is the `packages/` profile: tabs, double quotes, width 120.

## Register it

Grep for an existing harness's name (`git grep -n brrtest`) and match every hit:

- **`package.json`**: a `"<name>": "node scripts/run-harness.mjs <name>"` script, and the name
  appended to the `check:*` group it belongs to (`compiler`, `tokens`, `spc`, `integration`, `app`).
- **`scripts/steps.mjs`** `HARNESSES`: the list `npm run check` runs, in order.
- **`scripts/CLAUDE.md`**: the group table and the one-line "what each one proves" entry. It is
  the one place that counts the harnesses; no other file states the number.
- **`.claude/rules/harnesses/<name>.md`**: frontmatter `paths:` naming the harness file or folder
  (`'scripts/<name>.ts'` or `'scripts/<name>/**'`), then what it proves and which of its assertions
  are load-bearing in ways the name does not suggest. A split harness gets a table of section file
  to what it pins. A file under `.claude/rules/` without `paths:` loads in every session, so never
  leave it out.
- **`.claude/skills/verify-change/SKILL.md`**: which source files the harness covers, if that
  skill carries a table of them.
- **The module's own rule or `CLAUDE.md`**, where it says which harness pins it.

`scripts/tsconfig.json` includes `**/*.ts` and `eslint.config.js` covers `scripts/**/*.ts`, so
neither needs an entry.

## Check it

1. `npm run <name>`, and break one assertion on purpose to see the FAIL line.
2. `npm run codemap`, then `npm run typecheck:scripts` and `npm run lint`.
3. The `verify-change` skill for the rest.
