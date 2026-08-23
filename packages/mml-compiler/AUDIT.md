# Port audit against AddmusicK 1.0.11

A method-by-method comparison of this package and `@amk/tokens` against `AddmusicKsrc/`. Every
symbol in `parser.ts`, `preprocess.ts` and `link.ts` was mapped to its C++ counterpart and both
sides read; the scanner's two independent statements of each command's argument count were checked
against `HEX_LENGTHS`, the readme, and the driver's own `CommandLengthTable` recovered from
`main.bin`.

Findings had to carry three things to count: a `file:line` on both sides, an MML reproducer of ten
lines or fewer, and an observed result from actually running it. Anything already commented as a
deliberate divergence, and anything where AddmusicK is simply buggy and the port reproduces the bug
faithfully, was not a finding.

**All twenty-three confirmed divergences are fixed.** Each has a `selftest` or `tokentest` case,
written before the fix and failing without it.

## The standard this holds to

The point of the editor is that a song written in it goes into AddmusicK. So a divergence in
_either_ direction is a bug:

- More permissive than AddmusicK is the dangerous one — it compiles here, plays here, and then the
  real tool refuses it.
- Stricter than AddmusicK is merely annoying, but still wrong: it rejects a song that works.

**Where AddmusicK is case-sensitive, so is this.** Where it is case-*in*sensitive — `strnicmp` on a
directive keyword, `getHex` on a hex digit — so is this. The two are not a matter of taste; they are
observable behaviour.

## Wrong bytes

| What                                                                                                                                     | Reference                 |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `$Dd` / `$dD` split the tie off; only the canonical spellings do                                                                         | `Music.cpp:2224`          |
| `#amk 1`'s `$FA $05` emitted literally instead of as a type 6 / type 8 remote code event                                                 | `Music.cpp:1925-1962`     |
| An out-of-range repeat count on `(n)N` or `*N` emitted a `$E9` with the count forced to 1; `error()` returns, so AddmusicK emits nothing | `Music.cpp:1181`, `:1332` |

## Compiled what AddmusicK rejects

| What the port accepted                                                                          | AddmusicK                                                                                       | Reference                                    |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `#AMK 4`, `#DEFINE`, `#IFDEF` — preprocessor directives in any case                             | compares case-sensitively; the parser then catches the capitalised spelling and names the stage | `globals.cpp:788-956`, `Music.cpp:2432-2456` |
| `#Title`, `#LENGTH` inside `#spc`                                                               | `typeName != "title"` — case-sensitive                                                          | `Music.cpp:3471`                             |
| `"kick.BRR"` in `#samples`                                                                      | `extension == ".brr"` — case-sensitive                                                          | `Music.cpp:2723-2728`                        |
| `#samples{`, `#spc{`, `#instruments{`                                                           | every branch but two requires `isspace` after the keyword                                       | `Music.cpp:2415-2506`                        |
| an out-of-range `#define`/`#if` operand                                                         | `strToInt` reads through a `stringstream` into an `int` and throws                              | `globals.cpp:716-726`                        |
| a song with bytes but no ticks — an unclosed `[[` parks every note in the superloop accumulator | `mainLength` stays at its `-1` sentinel and `pointersFirstPass` errors                          | `Music.cpp:3210-3214`                        |

## Rejected what AddmusicK compiles

| What                                                                                                                          | Reference             |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `#halvetempo#0` — one of the two directives matched on prefix alone, with no terminator test                                  | `Music.cpp:2493`      |
| `#amk=N` for N other than 1 — read and thrown away                                                                            | `Music.cpp:2488-2492` |
| `#AM4` / `#AMM` — consumed silently by the parser when the preprocessor's case-sensitive match misses them                    | `Music.cpp:2480-2486` |
| `#option dividetempo 64` failed every short note; `emitNote` hoisted `divideByTempoRatio(0x60)` above the branch that uses it | `Music.cpp:2252-2274` |
| a source ending on a directive with no trailing newline — AddmusicK pads the buffer in `init()`, before the preprocessor runs | `Music.cpp:286`       |

## Diagnostics that were missing

| What                                                                                                                                                                                  | Reference             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| A second raw byte ≥ `$80` falls through to the duration/quantization warning, because AddmusicK folds each warn-once flag into the _condition_ rather than guarding inside the branch | `Music.cpp:1699-1713` |
| An `o` octave directive after `$DD`'s third byte freezes hex validation on 1.0.8 and lower                                                                                            | `Music.cpp:2018-2026` |

## The scanner

None of these reached compiled bytes; they made the command inspector misread source it was shown.

| What                                                                                                                                                                          | Reference             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `$FA $FE` hot-patch chains lost their last byte — the driver takes one further byte per high-bit byte, not just the first                                                     | `Music.cpp:1807-1813` |
| `h-3` scanned as a bare `h` plus an unrelated number; `h` reads through `getIntWithNegative`                                                                                  | `Music.cpp:2310`      |
| A three-digit `#pad` argument whose first two digits landed in `$DA`-`$FE` opened a phantom VCMD and swallowed the next real command; `#pad` reads `getHex(true)`, any length | `Music.cpp:2762`      |
| Under `#am4`, `$E6` with no hex byte after it is a one-byte Tremolo Off; the scanner left `hexLeft` standing and ate the next command                                         | `Music.cpp:433`       |

## Unimplemented, now implemented

`;title=…` in the raw source sets the ID666 title — a plain substring search before preprocessing,
so it counts inside a false `#if` too, and `#spc { #title }` overrides it. `Music.cpp:297-306`.

## Deliberate divergences

**One: `#path` is read and applied to nothing.** `parsePath` (`Music.cpp:2776-2789`) sets `basepath`
to `"./dir/"`, and `Music.cpp:958`, `:2594` and `:2717` join it onto every quoted sample name after
it before resolving the result against the filesystem. There is no filesystem here. The host's
library is one flat list of filenames, matched verbatim, so a prefixed name resolves to nothing and
every sample under a `#path` fails with AMK0058 — a directive that is correct in AddmusicK breaking
the song in the editor, with the diagnostic naming a folder the library could never hold.

The syntax is still AddmusicK's: the quoted string is required, read and consumed, so AMK0052,
AMK0064 and AMK0068 all still reach it and a song this compiles is a song AddmusicK compiles. Only
the prefix is dropped. `SST0504` reports it at `info`, once per occurrence, and `selftest` pins the
resolution, the code, the severity and the span.

This one is not the fidelity argument losing. The reference behaviour has no meaning in a host with
no directories, so there is nothing to be faithful _to_ — which is a different thing from finding it
unhelpful, and is why the two below stayed.

Those two were both stricter than the reference, and both are gone — the fidelity argument wins even
where the reference is doing something plainly unhelpful:

- **An unknown `#directive` is read as music.** `parseSpecialDirective` (`Music.cpp:2413-2506`) has
  no final else, so `pos` is left on the first letter and the scan loop dispatches it: `#c4` is a
  quarter-note C, and `#foo` is the note `f` followed by an `o` with no number. Reporting it would
  have been more helpful and would reject a song AddmusicK builds.
- **`*` before any `[ ]` emits a call to nowhere.** `Music.cpp:1321` has no check that a previous
  loop exists, and `prevLoop` is an `unsigned int` initialised to -1 (`Music.cpp:240`), so `$E9 FF
FF <count>` goes out and relocation lands the pointer one byte below the loop block. `selftest`
  pins that address, so the shape of the breakage is now a fact rather than an accident.

## And one that is not in the compiled output

`lengths()` reports a declared `#length` as `introSeconds` / `mainSeconds`. AddmusicK leaves both at
zero there, so its own readout prints `0:00` for such a song.

This does not reach AddmusicK: the emitted bytes are identical, and so is the ID666 tag — the
declared length is what goes into the header either way. What differs is two numbers the editor
shows in its stats panel. Kept because the alternative is showing `0:00` for a song whose author
stated its length, which is worse for no fidelity gain. Flagged here rather than left implicit, so
it is a decision rather than an oversight.

## Outputs AddmusicK does not have

`noteMap` and `commandMap` record where each note and each byte-emitting command came from in the
source. AddmusicK records neither and has no use for either; they exist so the editor can join a
compiled byte back to the text it was written as — the piano roll draws on the first and names the
commands acting on a note with the second.

Neither changes a byte. `commandMap` is gathered by bracketing `scan`'s one dispatch loop and asking
whether the channel's vector grew, which touches no handler and decides nothing; `selftest` and the
byte tables are what hold that, and the emitted blob is identical across every dialect.

`CompileResult.trace` and `PreprocessResult.removed` are the same kind of thing, for the normalizer
(`normalize.ts`): the parser's state after every dispatch, and the ranges the preprocessor took out.
Both are gathered the way `commandMap` is — a bracket around the dispatch loop, a list appended to
where a directive is consumed — and neither changes a byte; the trace is not even built unless the
request asks for it.

## Checked and not confirmed

`handleSuperLoopExit` and `addNoteLength` index `channelLengths` with `this.channel`, which can be
8, against an 8-element array — which would put `NaN` into the public `stats.channelTicks`. It is
structurally there, but every path that reaches channel 8 also sets one of the four loop flags, so
the bare `else` branch is never taken there. No reproducer was found. Left alone rather than
widening the array, which would change `stats.channelTicks.length` from 8 to 9.
