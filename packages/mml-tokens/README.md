# @amk/tokens

The MML scanner and the command model built on it: syntax highlighting, the command inspector, and
the splices that write an edit back into the source.

Depends on `@amk/core`, and on exactly two modules of `@amk/spc` — `adsr` and `fir` — because
explaining what a byte _means_ needs to know what the hardware does with it: noise in hertz, whether
an echo will run away. Nothing else. No CodeMirror, no Angular, no third-party dependency at all;
`TOKEN_TAGS` holds `@lezer/highlight` tag _names_ as plain strings so the adapter can live in the
app.

| Module                     | What it is                                                                      |
| -------------------------- | ------------------------------------------------------------------------------- |
| `tokens.ts`                | The scanner: `step`, `tokenize`, `Command`, `InstrumentDefinition`              |
| `edits.ts`                 | Splices that rewrite a command in the source it was scanned from                |
| `dialect.ts`               | What was in force at a point in the song — dialect, tempo, v-table              |
| `echo-hazards.ts`          | Diagnostics for an echo that compounds instead of decaying                      |
| `fir-override.ts`          | Which `$F5`s a later `$F1` throws away                                          |
| `commands/`                | What each argument _means_, in a form a panel can render and edit               |
| `commands/availability.ts` | Which dialects will take a command, for a palette asking before the text exists |

## A resumable scanner, not a second parser

Two things want to know what is written where: the command inspector, asking "what is under the
caret", and syntax highlighting. Rather than write that twice, the core is a line-oriented stepper
carrying a small copyable state — the shape CodeMirror's `StreamLanguage` wants. `tokenize` is one
wrapper over it; the editor's `mmlLanguage` is the other.

Two properties are load-bearing, and `tokentest` checks both:

1. `step` never looks behind its own `at`, and never at another line. All context crosses a line
   boundary inside `ScanState`. That is what lets CodeMirror restart scanning at any line it likes —
   and a state machine that secretly depended on having seen the top of the file would pass a
   whole-document test and mis-colour text much later.
2. `copyState` is a real copy. CodeMirror keeps one state per line and would otherwise see them all
   mutate together.

**This deliberately does not go through the compiler.** The parser works on preprocessed text —
`preprocess.ts` drops the `#amk` marker, `#define` lines and comments — and maps its spans back to
what the user typed through `origins`, but there are spans to map only once a compile has run.
Scanning the raw text keeps working while the song does not compile, which is most of the time while
someone is typing.

## Where it mirrors the parser, and where it cannot

The dispatch mirrors `Music::parseHexCommand` / `Music::scan` as ported in `parser.ts` — in
particular the `hexLeft` / `currentHex` / `currentHexSub` state machine, which is why a hex command
split across a line break still resolves. The target-program forks (`#am4`'s `$ED` and `$E5`,
`#amk 1`'s `$FC`) are mirrored too, off the markers scanned in place.

One deliberate difference there: `preprocess.ts` resolves the markers before the parser runs, so the
file's last effective marker governs the _whole_ song, where a resumable scanner can only apply a
marker from its line down. Well-formed songs put the marker before any music, where the two agree;
the mid-file divergence is pinned in `tokentest`.

Replacements — `"echo1=$EF"` and then a bare `echo1` — are followed, because writing commands that
way is ordinary and an inspector that went blank on them would be blind to whole songs. `ScanState`
carries the definitions visible at each point as an immutable value, so `copyState` stays a shallow
copy and rule 1 still holds: a state captured at line 40 _is_ the set of replacements in scope at
line 40, with nothing from line 90 leaking back.

Three departures from `parser.ts` follow from that, none of them free, and `tokentest` pins all
three so none gets "fixed":

- **Only a definition that opens and closes on one line registers.** AMK's `getQuotedString` runs
  happily past a newline, but carrying a partial body across lines would put a growing string in the
  copied state, and one stray `"` near the top of a long file would make every keystroke quadratic.
- **Replacements do not expand mid-token.** `getInt` / `getHex` do, so AMK reads `"4=8"` + `c44` as
  `c84` and `"2b=EF"` + `$2b` as `$EF`. Both need a rewrite _inside_ a token, which a model whose
  tokens are spans cannot express.
- **Recursion is bounded by an active set and a character budget**, not by AMK's 500 iterations at
  one position. That count limits chain length; expansion here is a tree, and `"g=g g"` would be
  exponential under any depth-only cap. This runs on every keystroke, so the guard has to bound
  total work.

## Writing an edit back

`edits.ts` is the inverse of `gather`. The inspector edits MML by replacing text, not by
re-emitting it, and the two rules that make that safe live here rather than in the panels — which is
also what lets `edittest` gate them.

**Only the parts that changed are replaced.** A splice runs from the first changed part to the last,
and the text _between_ the parts is copied out of the source verbatim. Column alignment, tabs and a
`; comment` written mid-run all survive an edit to the byte beside them. Re-rendering the whole
command from its values is two characters shorter to write and destroys all three.

**A part that came through a `"find=value"` replacement is not writable.** Every token from one
expansion is stamped with the use site's span, so two arguments out of one macro share a single span
and writing over either would clobber the other — and, if the expansion carried anything past the
command, delete that too. `Command` carries provenance _per part_ precisely so this can be asked per
part: the common `"ech=$EF"` case, where the command byte is a macro and every argument is literal
text, stays editable. Asking it of the whole command would refuse an edit that is perfectly safe.

## Source order is execution order within one channel only

`echo-hazards.ts` and `fir-override.ts` both walk the command list looking backwards, and both stop
at the channel boundary. Within one channel source order is execution order; across channels the
driver interleaves by time, so "later in the file" would not mean "runs afterwards" and the warning
would be guesswork.

Text above the first `#N` is on a channel too: `Command.channel` puts it on the **starting channel**,
the lowest `#N` declared anywhere in the song (0 when there is none), because that is where the
compiler starts writing — `parser.ts:detectStartingChannel`, Music.cpp:385-400 — so a `$F1` or a
`q` written above `#0` heads channel 0's own track and pairs with what `#0` writes below it. Every
module under this rule inherits that from `gather`, which is a whole-document pass and can see the
markers below the line. One departure: the compiler's probe is a substring search over the
preprocessed text, so a `#0` inside a `"…"` string or an untaken `#if` branch counts there and not
here.

The cost is real and accepted: the DSP has a single echo unit, so a `$F1` in `#0` and a `$F5` in `#1`
do interact, and that pairing is missed. A diagnostic that contradicted the FIR designer sitting
next to it would be worse than the gap.

`$F5` is invisible to this compiler and to AddmusicK — `Music.cpp` has no `$F5` code at all, only
the length table entry at `Music.cpp:63` — so every instance is copied through verbatim and nothing
upstream has an opinion to report. That is why the echo diagnostics carry their own `AMK05xx` range
rather than extending the parser's.

There is one blind spot, left alone deliberately: a replacement collapses everything it expands to
onto its use site, so a `$F5` and a `$F1` written inside the _same_ macro share a `span.start` and
neither check sees the other. The alternative — a secondary order carried on every command just for
this — costs more than the warning is worth.

`commands/in-force.ts` is the third module under that rule, and the one place where it happens to be
the whole truth rather than a compromise. It answers which commands act on a note for the piano
roll's glyphs, and it covers only the ones that emit no bytes at all: `q` folds into each note's
duration byte, `h` and `@21`-`@29` into the note byte itself. `parser.ts` does that folding in one
textual pass with its own per-channel state, so the `q` written before a note on that channel is the
`q` that went into the bytes of **every** pass of it — a loop cannot change the answer, because the
answer was decided before the loop existed. `h` is the one that is not per channel: it is a single
variable the parser resets at every `#N`, the one it is already on included, so `parseTimeInForce`
reads the markers off the token index and clears it at each — an `h` above the first channel reaches
nothing, and a channel written in two blocks does not carry the first block's `h` into the second.
`@21`-`@29` is `instrument[channel]` as the parser keeps it, which only `@` writes: a `[` copies it
into the loop block and a `]` copies nothing back, so `@21 [ @0 c ]2 d` folds `d` into a drum, and
the first pitched note it folds clears it except on `#6`/`#7` under `#amk`, so `@21 c d` is one drum
byte and one pitched one. That is the answer about _folding_. Which drum a later note still _sounds_
on is a fact about execution — the drum byte loads the sample and it stays through the `]`, a `*`, a
`(1)n` and a call from another channel — so the walk carries the note that loaded it
(`WalkNote.drumFrom`) and the editor asks this map about _that_ note
(`web/src/app/state/commands-in-force.ts`). Everything that does emit a byte is the walk's to name,
at the address the driver reads it from, and `CompileResult.commandMap` turns that back into source.
The two sets are disjoint by construction and `tokentest` asserts it, since a command answered twice
would draw two glyphs for one setting.

`commandScope` is the same module's other half, and the first classification of commands in this
package — `param.ts`'s `Role` is about one argument's units and the palette's `Category` is about
which strip a button sits on, so neither could say that `t` reaches every channel while `v` reaches
one.

## The descriptor tables

`commands/` says what each argument means: a codec (how the byte becomes the number a control
edits), a role (what the number _is_), and optionally a control, a range, a set of named choices and
a sentence about the consequence the number does not state.

`availability.ts` is the same tables' answer to a different question. The descriptors say what a
command's bytes mean once they are written; this says whether the dialect the song declares will
take that command at all — which is what a palette needs, because it has to grey a button out
_before_ there is any text to diagnose. Every rule in it is a condition `parser.ts` already tests,
restated as a question rather than a check, and `palettetest` compiles every form at every dialect
to hold the two answers together.

One rule keeps the tables honest: **a descriptor never states how many arguments a command takes.**
`tokens.ts` already carries that twice on purpose — as `scanHex`'s `hexLeft` mutations and as
`expectedArgs`, pinned against each other by `tokentest` — and a third statement here would be
invisible to every harness. Descriptors describe as many parameters as they know about and no more;
`resolveCommand` takes the count from `expectedArgs` and pads the tail with raw rows.
