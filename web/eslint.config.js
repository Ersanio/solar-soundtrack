// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = defineConfig([
  {
    // Written by `npm run generate-git-info` on every start/build, and
    // gitignored — there is no source of truth here to lint.
    ignores: ['src/app/git-info.generated.ts'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // `any` was 'warn', but `ng lint` does not fail on warnings, so it was a
      // valve that would have leaked silently. There are none in the tree.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-empty-function': ['error', { allow: ['arrowFunctions'] }],

      // The app ships to a browser: a stray log is a leak, not a diagnostic.
      // `console.error` stays, for the bootstrap failure path in main.ts.
      'no-console': ['error', { allow: ['error'] }],

      // Type-only imports are erased by `isolatedModules`; marking them keeps
      // the runtime import graph honest about what is actually loaded.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-shadow': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],

      // The compiler leans on discriminated unions (diagnostics, tokens, SPC
      // command kinds), so a new variant nobody handled is a real risk.
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // `no-unnecessary-condition` is deliberately NOT enabled. It reads the
      // types, and with `noUncheckedIndexedAccess` off every index access is
      // typed as always-defined — so it flags the real bounds guards this
      // byte-array code is built on as dead. It called all of these unnecessary:
      // `parser.ts` matchWord's `after === undefined` (indexing one past the end
      // of the source), `tokens.ts`'s `LETTER_KINDS[c]` miss, `driver.ts`'s
      // check that a manifest actually defines the requested sample group,
      // `export.ts`'s `match[1] ?? 0` for an optional regex group, and
      // `worklet.ts`'s `outputs[0]` guard. Turning it on would pressure the
      // next reader into deleting guards that fire at runtime.

      // Ratchets on behaviour the codebase already has everywhere, so that the
      // conventions in CLAUDE.md stop depending on everyone having read it.
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
      '@angular-eslint/computed-must-return': 'error',
      '@angular-eslint/prefer-service-decorator': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/consistent-component-styles': 'error',
      '@angular-eslint/no-duplicates-in-metadata-arrays': 'error',
      '@angular-eslint/use-component-selector': 'error',
      '@angular-eslint/inject-at-top': 'error',
      '@angular-eslint/no-developer-preview': 'error',
      '@angular-eslint/no-experimental': 'error',

      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'amk',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: ['element', 'attribute'],
          prefix: 'amk',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // CLI test harnesses (npm run selftest/spctest/...) print by design.
    files: ['scripts/**/*.ts', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Node scripts and this config itself: no TypeScript project to resolve,
    // so the type-aware rules above do not apply.
    files: ['**/*.js', '**/*.mjs'],
    extends: [eslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { __dirname: 'readonly', module: 'writable', require: 'readonly' },
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-at-else': 'error',
      '@angular-eslint/template/prefer-at-empty': 'error',
      '@angular-eslint/template/prefer-contextual-for-variables': 'error',
      '@angular-eslint/template/prefer-class-binding': 'error',
      '@angular-eslint/template/prefer-static-string-properties': 'error',
      '@angular-eslint/template/prefer-template-literal': 'error',
      '@angular-eslint/template/prefer-built-in-pipes': 'error',
      '@angular-eslint/template/require-switch-default': 'error',
      '@angular-eslint/template/no-empty-control-flow': 'error',
      '@angular-eslint/template/no-non-null-assertion': 'error',
      '@angular-eslint/template/attributes-order': 'error',

      // Two rules are deliberately absent because everything they flag here is
      // correct:
      //
      // `no-duplicate-attributes` reads `class="..."` next to `[class]="..."`
      // as one attribute written twice. To Angular they are a static attribute
      // and a class-map binding, and it merges them — which is exactly how the
      // ARAM swatches and diagnostic severities set layout statically and
      // colour dynamically.
      //
      // `button-has-type` cannot see through a component. Every `<button
      // amk-button>` already gets `type="button"` from Button's host binding
      // (shared/button/button.ts), so the rule found sixteen buttons and only
      // one of them — a raw `<button>` in the changelog trigger, now fixed —
      // was actually missing a type.

      // Styling is Tailwind utility classes throughout; an inline style is a
      // theme variable that escaped styles.css. `[style.x.px]` bindings, which
      // the ARAM bar needs for geometry, are not what this rule means.
      '@angular-eslint/template/no-inline-styles': ['error', { allowBindToStyle: true }],

      // `no-call-expression` would be the rule that catches work done per row
      // per change-detection pass — the sample browser's decode-the-whole-
      // library bug was exactly its target. It cannot be used here: it matches
      // every `Call` node in a template, and in a signals codebase every read
      // is one. It reports 178 problems, and the first is
      // `library.overrideCount() > 0`. Its `allowList`/`allowPrefix` options
      // match on the callee's name, and nothing in a name distinguishes a
      // signal from a method.
      //
      // So that class of bug is kept out structurally instead: panels build a
      // `computed` of view models with everything resolved — see the `rows` in
      // sample-browser.ts, aram-budget.ts and stats-grid.ts — rather than
      // calling a method per row.
    },
  },
  eslintConfigPrettier,
]);
