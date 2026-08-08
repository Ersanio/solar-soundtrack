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

## Fixed

Each has a `selftest` case, written before the fix and failing without it.

| What                                                                            | Reference                    | Cost            |
| ------------------------------------------------------------------------------- | ---------------------------- | --------------- |
| `$Dd` / `$dD` split the tie off; the canonical spellings fold it in             | `Music.cpp:2224`             | wrong bytes     |
| `#amk 1`'s `$FA $05` emitted literally instead of as a remote code event        | `Music.cpp:1925-1962`        | wrong bytes     |
| `#option dividetempo 64` failed every short note                                | `Music.cpp:2252-2274`        | compile aborted |
| A source ending on a directive with no trailing newline failed                  | `Music.cpp:286`              | compile aborted |
| `$FD`/`$FE` labelled "(reserved)" — they are Tremolo Off and Pitch Envelope Off | `hex_command_reference.html` | wrong label     |

## Outstanding — the port is more permissive than AddmusicK

These all accept a song AddmusicK would reject. That is the dangerous direction: it compiles here,
plays here, and then the real tool refuses it. But closing them means _adding_ errors to input that
works today, so each is a decision rather than a fix.

| What the port accepts                                               | AddmusicK                                               | Reference             |
| ------------------------------------------------------------------- | ------------------------------------------------------- | --------------------- |
| `#AMK 4`, `#DEFINE`, `#IFDEF` — preprocessor directives in any case | compares case-sensitively; these fall through and error | `globals.cpp:788-947` |
| `#Title`, `#LENGTH` inside `#spc`                                   | case-sensitive                                          | `Music.cpp:3465-3471` |
| `"Foo.BRR"` in `#samples`                                           | lower-cases nothing; rejects the extension              | `Music.cpp:2722-2728` |
| `#samples{`, `#spc{`, `#instruments{` — `{` as a keyword terminator | requires `isspace` after the keyword                    | `Music.cpp:2415-2489` |
| an out-of-range `#define`/`#if` operand                             | `strToInt` throws, "Could not parse integer"            | `globals.cpp:716-726` |

And one in the other direction: `#halvetempo` is the single directive AddmusicK matches on prefix
alone, with no trailing-whitespace test, so `#halvetempo#0` is legal there and rejected here
(`Music.cpp:2493`). Likewise `#amk=N` for N other than 1 is consumed silently by AddmusicK
(`Music.cpp:2488-2492`) and reported here as an unknown directive.

## Outstanding — diagnostics AddmusicK produces and the port does not

| What                                                                                                                 | Reference             |
| -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| A second raw byte ≥ `$80` falls through to AddmusicK's duration/quantization warning; the port stays silent          | `Music.cpp:1699-1713` |
| An `o` octave directive after `$DD`'s third byte warns on a pre-1.0.9 target                                         | `Music.cpp:2018-2026` |
| A song where every channel ends on a zero tick length is rejected                                                    | `Music.cpp:3210-3214` |
| An out-of-range repeat count on `(n)N` or `*N` aborts the command; the port forces it to 1 and emits the call anyway | `Music.cpp:1181-1185` |

The last is the one worth looking at first: it changes what gets emitted, not just what gets said.

## Outstanding — the scanner only

None of these reach compiled bytes; they make the command inspector misread source it is shown.

| What                                                                                                                                 | Reference        |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `$FA $FE` hot-patch chains lose their last byte — `expectedArgs` allows one continuation, the driver allows one per high-bit byte    | `Music.cpp:1811` |
| `h-3` scans as a bare `h` plus an unrelated number; the parser reads the negative                                                    | `Music.cpp:2310` |
| A three-digit `#pad` argument whose first two digits land in `$DA`-`$FE` opens a phantom VCMD and swallows the next real command     | `Music.cpp:2762` |
| Under `#am4`, `$E6` with no hex byte after it is a one-byte Tremolo Off; the scanner leaves `hexLeft` at 1 and eats the next command | `Music.cpp:433`  |

## Unimplemented

`;title=…` as a comment in the raw source sets the ID666 title (`Music.cpp:297-306`). The port has
no equivalent, so the tag stays empty. A feature rather than a divergence.

## Checked and not confirmed

`handleSuperLoopExit` and `addNoteLength` index `channelLengths` with `this.channel`, which can be
8, against an 8-element array — which would put `NaN` into the public `stats.channelTicks`. It is
structurally there, but every path that reaches channel 8 also sets one of the four loop flags, so
the bare `else` branch is never taken there. No reproducer was found. Left alone rather than
widening the array, which would change `stats.channelTicks.length` from 8 to 9.
