---
name: add-ui-text
description: Use when adding, rewording or removing any text a porter reads — a label, tooltip, refusal sentence, status line, command name or parameter description, in a template or in TypeScript. Covers the i18n ID, where the English goes, and the commands that keep the two in step.
---

# Adding or changing text

The code carries IDs, never words. `.claude/rules/i18n.md` is the full scheme (it loads with any
template); this is the order to work in.

## Rewording existing text

Change the string in `web/src/locale/messages.en.json` and nothing else. If a value or an inline
element is added or removed, the code's placeholders must change with it.

## A new message

1. **Pick the ID**: `group.segment[.segment]`, lowercase with hyphens. The group is **where the
   porter reads it** (`roll`, `inspector`, `palette`, `samples`, `transport`, …; the table is in
   `i18n.md`), not which file holds it. `scripts/i18n-catalog.mjs` rejects an unknown group.
   Attribute texts end in their role (`.title`, `.label`); TypeScript plurals in `.one` / `.other`.
2. **Write it by ID in the code.**
   - Template: `i18n="@@roll.toolbar.snap"` on the smallest element holding the whole sentence,
     with the ID as its content, then each interpolation named
     `{{ value // i18n(ph='name') }}` and each inline element empty.
   - Static attribute: `i18n-title` with `title="mixer.mute.title"`.
   - TypeScript and the packages: `` $localize`:@@roll.refuse.x:roll.refuse.x ${ticks}:ticks:` `` —
     the ID twice, then each placeholder, named.
   - Bound text that picks between two strings: a `protected readonly text = { … }` of `$localize`
     messages on the component, declared after its `inject()` fields. No call expression in the
     template to build it.
   - One whole sentence per message. Never glue fragments round a condition; each branch is its own
     message.
3. **Add the English**: `npm run i18n` adds a stub for each new ID to `messages.en.json` and drops
   IDs the code no longer has. Write the English over the stub; placeholders read `{$name}` from
   TypeScript and `{$NAME}` from a template.
4. **Look at it**: `npm start` shows the English; `npm run start:ids` shows every message as its
   ID and values, which is how to find the ID of text already on screen.
5. **Check**: `npm run i18n:check` fails on a stub left in place, an ID in the wrong form, and
   English whose placeholders differ from the code's. `npm run lint` fails a template text with no
   `@@id`.

## Not text

- A string that is compared, stored or used as a key is a key: compare `kind`, `vcmd`, an `id`,
  never `Command.name` or a label.
- A diagnostic's message is an entry in `@amk/core/messages/`: the `add-diagnostic` skill.
- Workers and the AudioWorklet have no `$localize`; the modules they import hold no message
  (`i18n.md`, "Packages, workers and the worklet").
- The changelog's entries, `index.html`, MML spellings and number formatting are not marked.
- No `aria-*`, `role` or `tabindex` text: accessibility is not supported (root `CLAUDE.md`).
