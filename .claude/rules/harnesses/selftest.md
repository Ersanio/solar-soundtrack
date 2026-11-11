---
paths:
  - 'scripts/selftest/**'
---

# `selftest`: what it proves

Compiler output, byte for byte. Also that diagnostic spans land on the offending character, not
merely near it. And where text above the first `#N` goes: to the lowest channel the song declares —
`$ED` above a `#1`-only song heads channel 1's body, and a `#0` further down takes it back — with a
`q` or a drum `@` written there reaching that channel's first note (a `q` inside a remote definition
above `#0` included, since it writes `q[prevChannel]`), and an `h` written there reaching nothing
because every `#N` resets it, so a channel's second block starts reset too. And which notes the drum
remap folds into: `@21 c d` is one drum byte and one pitched byte on `#0` and two drums on `#6`, a
rest is not folded, a `[` copies the remap into the loop block and a `]` copies nothing back — so
`@21 [ @0 c ]2 d` still folds `d` — where a `[[ ]]` body writes the channel's own, and a raw `$DA`
leaves it standing; `tokentest` mirrors every one on the source side. It also pins the port's **one
deliberate divergence**, `#path`: the directive is read, validated and applied to nothing, so a
sample name under it resolves exactly as written, an unquoted argument is still `AMK0052`, and
`SST0504` says so once per occurrence at `info` with its span covering the whole directive. A slash
written inside a filename still resolves — the divergence is about the directive, not the character.
And that a replacement expanding into itself is refused rather than run: `"zz=zz $00"` is `AMK0023`,
the port of `Music.cpp:135`'s same-position guard, while `"1=[q7F @0 a1]"` slips past that one and
is `SST0505` on the growth ceiling — with `"F=$E7 $0F"`, which contains its own key and terminates,
still compiling, since that is the song a cycle check would wrongly refuse. It also pins that the
rounds before the ceiling collapse to one finding: they all name the same character, and filing each
one separately is what made the problems list the second freeze. And that a remote call to a label
with no body compiles, as it does there: `(!0, 0)`, `(!0, 7)` and `(!0, 8)` write `loopPointers`'
`$FFFF`, which relocation lands on the last channel's terminating `$00`, and raise nothing, while
any other type raises `SST0509` at `warning` — `(!0)` included even when a body is written for it,
since slot 0 is never recorded.

## Section files

`scripts/selftest/main.ts` runs one section file per subject, in the order below, and `support.ts`
holds what they share: `compile`, the stand-in sample library `LIBRARY`, and `hex` and
`expectBytes`. `HARNESS_ONLY=<file name>` runs one section alone.

| File                               | What it pins                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `notes-and-header.ts`              | The minimal looping song byte for byte, how a note is encoded, and a long note split into ties.                                          |
| `above-first-channel.ts`           | Where commands written above the first `#N` go.                                                                                          |
| `drum-remap.ts`                    | Which notes the `@21`-`@29` drum remap folds into.                                                                                       |
| `header-and-loops.ts`              | The header with an intro and under `#noloop`, loop and label-loop pointers, and relocation to the ARAM address.                          |
| `legacy-targets.ts`                | The legacy targets: that they compile, the compatibility prefix, `y`'s surround flags, legacy note behaviour and legacy hex translation. |
| `preprocessor-and-replacements.ts` | The preprocessor, near-miss directives, hex command validation, and replacements, one that expands into itself included.                 |
| `diagnostic-spans.ts`              | Diagnostic spans point into the source the author wrote, and ARAM overflow is caught.                                                    |
| `parity.ts`                        | Parity against AddmusicKsrc, a case per behaviour.                                                                                       |
| `samples-and-path.ts`              | `#samples` and `#path`.                                                                                                                  |
| `instruments.ts`                   | `#instruments` and `@30` upwards.                                                                                                        |
| `sample-load.ts`                   | The sample load command.                                                                                                                 |
| `remote-code.ts`                   | Remote code.                                                                                                                             |
| `pad-and-warnings.ts`              | `#pad` and the remaining warnings.                                                                                                       |
| `sample-usage.ts`                  | `optimizeSampleUsage`, a `.bnk` sample bank under `#samples`, sample importance, and which samples the song plays.                       |
| `audit.ts`                         | The divergences a line-by-line reading against AddmusicK 1.0.11 found, a case each.                                                      |
