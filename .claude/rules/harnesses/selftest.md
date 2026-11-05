---
paths:
  - 'scripts/selftest.ts'
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
