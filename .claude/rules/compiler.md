---
paths:
  - 'packages/mml-compiler/**'
  - 'packages/mml-tokens/src/{tokens,dialect,echo-hazards,fir-override,arpeggio-count}.ts'
  - 'packages/mml-tokens/src/commands/availability.ts'
  - 'packages/core/src/messages/**'
  - 'scripts/selftest/**'
---

# Compiler, scanner and diagnostics

Read before changing `packages/mml-compiler`, the `@amk/tokens` scanner, a diagnostic, or the
scanner-side files that restate the parser's conditions or raise findings of their own
(`commands/availability.ts`, `echo-hazards.ts`, `fir-override.ts`, `arpeggio-count.ts`). Adding a diagnostic is the
`add-diagnostic` skill; adding or changing a command is `add-command`.

## `#path`, the one deliberate divergence

**`#path` is the one deliberate divergence, and the bar it had to clear is high.** It is read,
validated and applied to nothing (`parsePath`, `SST0504`), because the reference behaviour has
nothing to mean here: `basepath` is a directory prefix resolved against a filesystem, and the host's
library is one flat list of filenames matched verbatim, so a prefixed name resolves to nothing and
every sample under a `#path` fails with AMK0058. That is not the same as finding the reference
unhelpful — an unknown `#directive` read as music and a `*` that calls nowhere are unhelpful and
were kept (root `CLAUDE.md`). Nothing else earns this: a second divergence needs the reference
behaviour to be undefined here, not merely inconvenient.

## Diagnostics

**Diagnostics carry source spans and stable codes**, and are carried on failure paths too, so
partial UI stays populated. **The prefix says whose finding it is, not which file raises it**:
`AMK####` is a condition AddmusicK itself reports, ported from `AddmusicKsrc/` with the `Music.cpp`
line cited; `SST####` is one `Music.cpp` does not produce at all, so a porter is never told
AddmusicK objects to something it has no opinion about. The echo hazards, the unreachable-channel
warning, the tempo shortfall, a tempo, channel setting or song setting that carries over into the
song's repeat (`SST0510`-`SST0512`), the `#path` notice, the runaway-replacement guard, the five
command hazards — `$F7`'s dead dispatch slot, a `$DD` no note's read-ahead can reach, `#am4`'s
silent `$E4` offset, an arpeggio with more than one loop point (`SST0517`), and one that ends on a
loop point (`SST0519`) — a remote call that
points at no body (`SST0509`), and a note pitched past
what its instrument can play or a vibrato or an arpeggio that takes one there (`SST0513`-`SST0515`),
a note an arpeggio never keys on (`SST0516`), and an `$FB` whose count disagrees with the notes
written after it (`SST0518`, beside the AMK0151, AMK0152 or AMK0155 AddmusicK raises there without
saying why) are `SST05xx`, which is
also where a finding goes when the reference does not
_finish_ rather than not object: `SST0505` bounds a replacement that expands into itself, and
AddmusicK grows its buffer forever on the same song, so there is no run to be faithful to and
nothing to divide with `#path`. `SST0301` guards `compile()`'s own ARAM argument. A new diagnostic
takes the prefix of the tool that found it. Spans are mapped back to the source the author wrote —
`spanAt` is the single choke point, and anything that bypasses it will be wrong. Constructs this
compiler does not implement are reported as errors, never silently mis-compiled.

A diagnostic's entry is in `@amk/core/messages/amk.ts` or `sst.ts`, keyed by code and variant
(`AMK["0096.rate"]`), and its words are under the same ID in `web/src/locale/messages.en.json`
(`amk.0096.rate`); the call site states the code and calls the entry. Where one code says several
things each gets an entry of its own, and a text that varies by form — `"a dot"` or `"N dots"`,
`is` or `are`, the five leftover-directive articles — is one whole message per form. `report`
keys its de-duplication on the English, as every page and harness sees it. The ID scheme and how to
add one: `.claude/rules/i18n.md`.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/compiler.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **Mirroring the parser's `$DD` lookahead in `step` as a lookahead** — `parseHexCommand`,
  `skipSpaces`, `tokentest`, `ScanState.ddTarget`, `getInt`, `ddTargetOctave`, `awaitingAmkVersion`
- **Filing every parser diagnostic, a repeat of the same finding at the same span included** —
  `SST0505`, `spanAt`, `report`
- **A Normalize button, and the parse trace and walk-comparison oracle behind it** — `SST06xx`
- **Refusing a `(!n, type)` whose body was never recorded, as AMK0115** — `Music.cpp:290`,
  `Music.cpp:1178`, `SST0509`, `parseLoopStart`
- **One code per setting that carries into the repeat, worded for that setting** — `SST0511`,
  `SST0512`, `repeat-settings.ts`, `SST0510`
- **Judging remote code at the loop's first rest, as every other setting is**
