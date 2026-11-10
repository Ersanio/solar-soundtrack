---
paths:
  - 'eslint.config.js'
  - '.prettierrc'
  - '.prettierignore'
  - '.editorconfig'
  - '.gitignore'
  - 'package.json'
  - 'tsconfig.base.json'
  - 'web/{package.json,angular.json,ngsw-config.json}'
  - 'web/tsconfig*.json'
  - '.github/**'
  - 'scripts/*.mjs'
  - '.claude/settings.json'
  - '.claude/hooks/**'
---

# Tooling

Read before changing the pre-hooks, `eslint.config.js`, `.prettierrc`, CI or deployment.

## Automatic pre-hooks

Never invoke these by hand. `prestart` / `prestart:ids` / `prebuild` / `prewatch` in
`web/package.json` run the first two and the third; `pretypecheck` and `preextract-i18n` there and
`prelint` at the root run `generate-git-info` alone, which is all those need:

- **`build:worklet`** — `@amk/spc`'s own build; esbuild bundles `worklet.ts` into
  `assets/player/spc-worklet.js` (generated, gitignored). An AudioWorklet is loaded by URL from the
  audio thread, so the Angular builder cannot produce it as part of the app bundle.
- **`sync-spc-assets`** — mirrors `packages/spc/assets/` into `web/public/`. The Angular builder
  refuses an asset path outside its own workspace root; the copies are gitignored and
  `packages/spc/assets/` is the only source of truth.
- **`generate-git-info`** — writes `web/src/app/git-info.generated.ts` for the top bar's commit link
  (generated, gitignored). Captured once at startup, so it goes stale if you commit while
  `npm start` is running; restart to refresh.

## The English

`npm run i18n` runs `ng extract-i18n` (an AOT build of the app in the source locale, JSON format,
raw output in the gitignored `.selftest/i18n/`) and then `scripts/i18n-catalog.mjs write`, which
checks every ID and that every message's source is its ID and placeholders, adds a stub for a new ID
to `web/src/locale/messages.en.json`, drops a removed one, and sorts and formats the file through
Prettier, one message to a line. `npm run i18n:check`, the last step of `npm run check`, fails
instead on any of those, on a stub left in place, and on English whose placeholders differ from the
code's, listing the IDs. Extraction itself fails on one ID with two different sources
(`i18nDuplicateTranslation: "error"` in `angular.json`).

The build reads the English through `i18n.locales.en` and inlines it (`localize: ["en"]` in the
build options). Its `subPath` is empty, so the output stays at the root of `browser/`, where CI
deploys it from. The `ids` configuration, build and serve, sets `localize: false` and is what
`npm run start:ids` serves. A missing English is a build warning, not an error, so a new message
can be seen in place before its English is written.

JSON rather than XLIFF or ARB because those record each message's file and line, so every edit
anywhere would churn the file, and because it is the one of the three that is pleasant to edit by
hand.

## Formatting

Prettier owns the whole workspace, in two profiles split by layer — `web/src/app/` at 2 spaces,
single quotes, width 100; `packages/` and `scripts/` at tabs, double quotes, width 120, carried over
from the pre-Angular prototype so the port can still be diffed against AddmusicK's C++. Both are in
`.prettierrc`, with matching `.editorconfig` sections so editors agree; **change both or neither**.

`endOfLine` is `"auto"` because the working tree is CRLF. Prettier's `"lf"` default makes every file
fail `--check` for reasons that have nothing to do with formatting. `"auto"` also means a file
flipped wholesale to LF passes `--check`, which is why the after-edit hook (below) puts CRLF back.

Four regions carry `// prettier-ignore`, all because reflow destroys information rather than because
someone preferred the old layout: the MML command dispatch in `parser.ts`, which is a lookup table
one line per case; the one hand-annotated byte table in `selftest.ts`, where each line is a
little-endian word with its own comment; and `INSTRUMENT_TO_SAMPLE` and `VELOCITY_VALUES` in
`hardcoded-tables.ts`, whose rows are `Music.cpp`'s own, a comment to each. Add a marker only for that kind of reason, and say what it
is.

Reformats are listed in `.git-blame-ignore-revs`. Enable it with
`git config blame.ignoreRevsFile .git-blame-ignore-revs` so `git blame` on the ported compiler keeps
pointing at the port.

## Linting

`eslint.config.js` at the root is where the conventions in `CLAUDE.md` stop being prose. One config
for every workspace, run as plain `eslint` — `ng lint` is only a wrapper, and flat config does not walk up
from `web/`, so a second config there would drift.

Rules that exist to hold a property the codebase already has (`prefer-signals`,
`prefer-service-decorator`, `inject-at-top`, `consistent-type-imports`, and the template rules) are
set to `error` rather than `warn` — though `--max-warnings 0` means a warning would fail the run
just the same, so the level says which of the two a rule is rather than whether it bites.

Several rules are deliberately **off**, each with its reasoning inline in the config. Read that
before switching one on: `no-unnecessary-condition`, `template/no-duplicate-attributes` and
`template/button-has-type` report only false positives here, and `template/no-call-expression`
cannot tell a signal read from a method call, so it flags 405 correct lines. The bug that last rule
would catch is kept out structurally instead.

One block sits **after `eslintConfigPrettier`**, and has to: it holds `curly` and
`padding-line-between-statements`. Neither is something Prettier can do — it never adds braces and
never inserts blank lines, only collapses them — so this is the one place where layout is a lint
rule. `eslint-config-prettier` switches `curly` off, so setting it in any earlier block would be
silently undone. `npm run lint:fix` fixes both; run `npm run format` after it.

`template/i18n` has a block of its own, scoped to `web/src/app/**/*.html` because `index.html` is
not a template Angular's i18n reads. It wants an `@@id` on every text and every text-bearing
attribute; its `ignoreAttributes` adds SVG geometry and the components' keyword inputs (`variant`,
`size`, `origin`) to the rule's own list. A new keyword input goes there, not an `i18n-` marker on a
value nobody reads. `attributes-order` wants an `i18n-*` marker after every binding on the element;
`lint:fix` sorts them.

To prove the scoping is what you think it is, diff `npx eslint --print-config` over
`packages/mml-compiler/src/parser.ts`, `packages/spc/src/fir.ts` and `web/src/app/app.ts`. Those
resolve 1, 121 and 146 rules respectively.

## Deployment

`.github/workflows/ci.yml` lints and checks every push and PR; pushes to `main` additionally build
with `--base-href=/<repo-name>/` and deploy `web/dist/solar-soundtrack/browser` to GitHub Pages. The
build must go through `npm run build` rather than `ng build` so the prebuild hooks still run. The app
is a PWA (`web/ngsw-config.json`); the service worker is enabled in production builds only.

The same Pages artifact carries the guide, an mdBook in `docs/book/` (chapters in `docs/book/src/`,
listed in `SUMMARY.md`). The deploy job builds it after the app, because `ng build` empties its
output folder, into `docs/` inside it: the app is at `/<repo-name>/`, the guide at
`/<repo-name>/docs/`. mdBook is not an npm dependency; CI downloads the release pinned in
`MDBOOK_VERSION`, and sets `site-url` through `MDBOOK_OUTPUT__HTML__SITE_URL` for the same reason
the base href comes from the repository name. Preview it locally with `mdbook serve docs/book`.

`navigationUrls` in `ngsw-config.json` is Angular's default list plus `!/docs` and `!/docs/**`.
Without them the service worker answers every extensionless navigation in its scope with the app's
`index.html`, so after one visit to the editor `/<repo-name>/docs/` opens the editor. Both are
absolute on purpose: the worker matches the URL with its scope already stripped, so `/docs/` is
what it tests, while the generator prefixes a relative pattern with the base href and
`/<repo-name>/docs/**` then never matches. `/docs/**` does not match `/docs` itself, hence the pair.

## Claude Code

`.claude/settings.json` (checked in) registers one hook: `PostToolUse` on `Edit|Write` runs
`.claude/hooks/after-edit.mjs`. For a text file inside the repository, outside the reference sources,
`node_modules` and build output, it rewrites bare `\n` as `\r\n` when `core.autocrlf` is `true` —
Edit and Write sometimes return a CRLF file as LF, and `endOfLine: "auto"` then keeps it — and runs
Prettier through its API with the same ignore files and config the CLI uses. A parse error exits 2,
which shows Prettier's message to Claude; every other failure exits quietly so an edit is never held
up. Claude Code reads hooks when a session starts, so a change to either file takes effect in the
next one. Machine-local permissions stay in the gitignored `settings.local.json`.

`.gitignore` tracks `.claude/rules/`, `.claude/hooks/`, `.claude/settings.json` and
`.claude/skills/`, except the `angular-*` skills the Angular CLI installs, which stay ignored along
with everything else under `.claude/`.

`CODEMAP.md` is written by `scripts/codemap.mjs` (`npm run codemap`), and `npm run codemap:check`,
early in `npm run check`, fails on a stale map or on a source file under `packages/*/src`, `web/src`
or `scripts` with no doc comment. A file's entry is the first sentence of its first `/** */` block,
or of the `//` lines it opens with.
