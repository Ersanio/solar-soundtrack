---
name: add-diagnostic
description: Use when adding or changing a compiler, scanner or editor diagnostic (an AMK#### or SST#### code) — which prefix it takes, where its message and English go, how its span is made, and which harness pins it.
---

# Adding a diagnostic

Read `.claude/rules/compiler.md` (Diagnostics) and `.claude/rules/i18n.md` first; they load when you
open the compiler or the message catalogs anyway.

1. **Pick the prefix by whose finding it is**, not by which file raises it.
   - `AMK####`: a condition AddmusicK itself reports. Port it from `AddmusicKsrc/` and cite the
     `Music.cpp` line in a comment at the call site.
   - `SST####`: a finding AddmusicK does not produce at all. Compiles-clean-then-misbehaves
     findings are `SST05xx`. Check the highest code in use in `packages/core/src/messages/sst.ts`.
   - If AddmusicK accepts what you would flag, the finding is a warning or `severe`, never an error:
     the compiler is not permissive in either direction (root `CLAUDE.md`).
2. **Add the entry** to `packages/core/src/messages/amk.ts` or `sst.ts`, keyed by code, then by
   variant where one code says several things (`"0509.zero"`). Each entry is a function returning a
   `$localize` whose ID is `amk.NNNN[.variant]` / `sst.NNNN[.variant]` and whose source text is the ID
   and its placeholders, named: `` (label: number) => $localize`:@@sst.0509:sst.0509 ${label}:label:` ``.
   A text that varies by form (`a dot` / `N dots`) is one entry per form.
3. **Write the English** under the same ID in `web/src/locale/messages.en.json`, placeholders as
   `{$label}`. `npm run i18n` adds a stub for a new ID if you would rather fill one in.
4. **Raise it** with the entry, not a string. In `parser.ts`:
   `this.warn(start, end, "SST0509", SST["0509"](label))` and `this.info(...)` take a span;
   `this.error(code, message)` reports at the current position; `this.report(severity, start, end,
code, message)` covers `severe`. A span must map back to the text the author wrote — go through
   `spanAt`, never compute offsets into preprocessed text yourself. Raise it on failure paths too,
   so partial UI stays populated.
5. **Pin it** in `scripts/selftest.ts` for compiler diagnostics (the `[source, code, description]`
   tables), or the harness that owns the module that raises it. Assert the span lands on the
   offending character, not only that the code appears.
6. **Verify**: `$env:HARNESS_QUIET=1; npm run selftest`, then `npm run i18n:check`, then the
   `verify-change` skill for the rest.

If the new code is an `SST05xx`, add it to the list of what that band covers in
`.claude/rules/compiler.md`.
