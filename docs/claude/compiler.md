# Compiler, scanner and diagnostics

Read before changing `packages/mml-compiler`, the `@amk/tokens` scanner, or a diagnostic.

## Diagnostics

**Diagnostics carry source spans and stable codes**, and are carried on failure paths too, so
partial UI stays populated. **The prefix says whose finding it is, not which file raises it**:
`AMK####` is a condition AddmusicK itself reports, ported from `AddmusicKsrc/` with the `Music.cpp`
line cited; `SST####` is one `Music.cpp` does not produce at all, so a porter is never told
AddmusicK objects to something it has no opinion about. The echo hazards, the unreachable-channel
warning, the tempo shortfall, a tempo or channel setting that carries over into the song's repeat
(`SST0510`, `SST0511`), the `#path` notice, the runaway-replacement guard, the three
command hazards — `$F7`'s dead dispatch slot, a `$DD` no note's read-ahead can reach, and `#am4`'s
silent `$E4` offset — and a remote call that points at no body (`SST0509`) are `SST05xx`, which is
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
add one: `docs/claude/i18n.md`.

## Decisions already made

- **Mirroring the parser's `$DD` lookahead in `step` as a lookahead** — `$DD`'s last parameter may be
  a written note, and `parseHexCommand` settles that by reading ahead over spaces, newlines,
  `o<int>`, `<` and `>` (Music.cpp:2012-2042). Its `skipSpaces` crosses line breaks and `step` may
  not read another line, so a scanner that quietly did would pass a whole-document test and
  mis-colour text after a restart, which is the one property `tokentest` exists to hold. It is a
  deferred flag instead (`ScanState.ddTarget`), raised where the lookahead would begin and answered
  by whichever token arrives, and **cleared by default** — ending at anything the parser's loop does
  not name is the rule itself, so `|`, `{`, a marker and every arm added later are right by
  construction rather than by a list. Not one flag either: `getInt` skips no spaces, so `o5` carries
  the lookahead on where `o 5` and a bare `5` end it, and `ddTargetOctave` is what tells the two
  apart — set only when the digits are the next character, which is what keeps it inside one line
  and out of the approximation `awaitingAmkVersion` has to make.
- **Filing every parser diagnostic, a repeat of the same finding at the same span included** — sound
  while `pos` is advancing, since text the author wrote cannot raise one span twice, and it made the
  problems list the second freeze once `SST0505` stopped the first. A song growing until the
  expansion ceiling stops it reports whatever its expansion is made of once per round, and `spanAt`
  collapses every copy onto the one character that was typed: `"1=[q7F @0 a1]"` filed the same
  "cannot nest" error 6,553 times, which CodeMirror underlines and `amk-diagnostics-list` renders a
  row each of. `report` is the one place a diagnostic is filed and it drops a repeat of the same
  code, span and message — six thousand of those are one finding. Not a cap on how many diagnostics
  a parse may hold, which would lose the six-hundredth real error in a song that has one.
- **A Normalize button, and the parse trace and walk-comparison oracle behind it** — eight
  text-to-text passes over a trace of the parser's state at every dispatch, each result compiled,
  walked and compared against the walk of the original before the document was touched, offered on
  both toolbars and beside every refusal in the roll. It was written to make a song editable in the
  piano roll, and the roll went the other way: it took loops over in place, reads a note's octave
  off its own byte and its length off its own text, and no roll code ever read the trace or the
  oracle. What was left was four refusals it could clear — `&`, `"name=value"`, `{ }` and music
  above the first `#N` — for some 2,800 lines, a trace the parser gathered on request, and a button
  standing beside a dozen refusals it could not clear. The roll edits the song as written and says
  what it refuses; the parser records the command map and nothing else. `SST06xx` is retired with
  it — a new editor-side diagnostic takes the next band, not this one.
- **Refusing a `(!n, type)` whose body was never recorded, as AMK0115** — it turned away `(!0, 0)`,
  which is how a song switches its remote code off, and AddmusicK has no such check:
  `Music.cpp:1116-1122` writes `loopPointers[i]` unchecked, and that is `$FFFF` for a label with no
  body (`Music.cpp:290`), which relocation lands on the last channel's terminating `$00`. Types 0, 7
  and 8 never read the address (`Commands.asm:1247-1258`), and the readme says "any code can be
  used". AMK0115 is a label-loop finding (`Music.cpp:1178`) and has no remote form. The call writes
  the same bytes AddmusicK writes, and `SST0509` warns for any other type, where the event runs
  that `$00` and does nothing. `(!0)` is always unrecorded, since `parseLoopStart` keeps only
  `loopLabel > 0` (`Music.cpp:1242-1251`), so even a song that defines it is told.
- **One code per setting that carries into the repeat, worded for that setting** — `SST0511` was the
  fine tune ("starts at $EE $20 instead of $EE $10") and `SST0512` the tremolo, with an on and an off
  variant. Carrying is a property of fourteen channel settings (`repeat-settings.ts`), and that shape
  needed a code, a table row and its own grammar for each. `SST0511` is now any channel setting,
  naming the command as it was written, and only the tempo (`SST0510`) keeps its own wording, for
  the default `t53` a song that sets none plays at.
