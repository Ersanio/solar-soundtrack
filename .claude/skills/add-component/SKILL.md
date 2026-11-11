---
name: add-component
description: Use when adding an Angular component, panel, view or shared control to web/, or a state service — this repository's conventions where they differ from generic Angular advice, and the files a new component has to be registered in.
---

# Adding a component

`web/CLAUDE.md` has the app's structure and loads with any file under `web/`. Where it or this
list disagrees with `web/.claude/CLAUDE.md` or an installed Angular skill, this repository wins
(root `CLAUDE.md`).

## The file

1. **A folder per component**, `kebab-name/kebab-name.ts` and `kebab-name.html`, under the area it
   belongs to (`web/CLAUDE.md`, Layout). No `.spec.ts`, no stylesheet.
2. **Selector prefix `amk`**: `amk-stats-grid` for an element; an attribute selector on a native
   element where the element matters (`button[amk-toggle]`); and inside an `<svg>` always an
   attribute on a real `<g>` with the template's elements prefixed `svg:`
   (`.claude/rules/roll-architecture.md`, Files and components). ESLint enforces the prefix.
3. **`templateUrl`**, unless the template is one element or `<ng-content />`.
4. **A doc comment**, a `/** */` block on the class or at the top of the file. Its first sentence is the
   file's line in `CODEMAP.md`; the gate fails without one. Run `npm run codemap` after adding the
   file. Keep comments short and in the present tense.
5. No `standalone`, no `changeDetection`, no NgModule, no `@HostBinding`/`@HostListener`: host
   classes and bindings go in the decorator's `host` object.

## The class

- `inject()` fields first (`inject-at-top` is a lint error), then `input()` / `output()` /
  `model()`, then state. Template-facing members are `protected readonly`.
- **Signals only.** `signal` and `computed` for state. `effect` is reserved for mirroring into an
  imperative sink (storage, the player, CodeMirror) and carries a `// Sanctioned effect:` comment
  saying which.
- **Build a view model, not methods.** A `computed` of rows with everything resolved; the template
  calls nothing per row (`stats-grid.ts`, `aram-budget.ts`, `sample-rows.ts`). The lint rule that
  would enforce it is off, so the structure is what keeps the bug out.
- **State lives in the `@Service()` singletons in `web/src/app/state/`** and flows one way
  (`DriverStore` → `SampleStore` → `EditorStore` → `Playback`). A new service uses `@Service()`,
  never `@Injectable`, and must not turn that order round. Anything that edits MML writes through
  `EditorRequests` (`.claude/rules/state-and-editor.md`); an inspector panel through
  `CommitAudition`.
- Arithmetic worth testing goes in an Angular-free file beside the component, so a harness can
  import it.

## The template

- Native control flow (`@if`, `@for`, `@switch`); `class` and `style` bindings, never `ngClass` or
  `ngStyle`.
- **Tailwind utilities and theme variables only.** No hex literal, no inline `style=` (a
  `[style.width.px]` binding for geometry is fine); every colour is a `--color-*` token from
  `web/src/styles.css` (`.claude/rules/ui-and-theme.md`).
- **Use the shared controls** in `web/src/app/shared/`: `amk-button`, `amk-toggle`, `amk-slider`,
  `amk-number-field`, `amk-enum-select`, `amk-checkbox`, `amk-section`, `amk-toolbar`, the popover
  and tabs. A mode is an `amk-toggle`, not a checkbox. A dragged control previews continuously and
  commits once (`web/CLAUDE.md`, Preview and commit).
- **Every text is an i18n ID**: the `add-ui-text` skill. A new keyword input (`variant`, `size`)
  goes in `template/i18n`'s `ignoreAttributes` in `eslint.config.js`, not behind an `i18n-` marker.
- No `aria-*`, `role` or `tabindex`. Do not remove the global `:focus-visible` outline.

## Registering it

- Add it to the parent's `imports` and template.
- A new editor tab: `web/CLAUDE.md`, "Adding a view" (`VIEWS` in `editor-pane.ts`, a `@case`, its
  own `<amk-toolbar>`).
- A new inspector panel: a `@case` in `command-inspector.html` and its arm in `view`
  (`command-inspector.ts`).
- A user-facing feature adds its changelog entry in the same commit
  (`web/src/app/changelog/changelog-data.ts`; root `CLAUDE.md`).

## Before calling it done

`npm run typecheck` does not compile templates. Run `npm run build` or `npm start` to see the
template compile, `npm run lint`, then the `verify-change` skill; `drive-the-app` shows it working.
