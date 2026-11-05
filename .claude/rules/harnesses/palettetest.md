---
paths:
  - 'scripts/palettetest.ts'
---

# `palettetest`: what it proves

The command palette's catalogue, and it is the one harness whose oracle is the compiler rather than
a table of expected bytes. Five assertions carry it. **Values, never arity**: an entry lists
argument values and `expectedArgs` decides how many there are, so this asserts the two meet exactly
under every dialect — a snippet one byte short does not look wrong, it swallows whatever follows as
its own argument and still compiles. **Availability is a prediction**: `formAvailability` ports
conditions `parser.ts` tests on text that exists to text that does not, so every entry is compiled
in a minimal song at `#amk 1/2/4`, `#am4` and `#amm` and checked against what actually comes back.
`blocked` asserts the song is not clean rather than that it errors, because the quieter failure is
the worse one — `t18,144` below `#amk 3` builds and silently means `t18`. **Supersession is proven,
not claimed**: the palette offers `t144` and not `$E2`, so `SUPERSEDED` compiles both spellings and
compares the output byte for byte, and `ENTRIES` plus that table has to cover all of `$DA`-`$FE` — a
VCMD added to `tokens.ts` fails here until it has a button or a letter form that writes it. **Every
command stays reachable in every dialect**: coverage is counted under each `#amk` level and not at
`#amk 4` alone, since a byte whose only spelling a dialect refuses is a byte no button can write
there — the three fades below `#amk 3`. **A swapped spelling is the same bytes**: where a dialect
refuses the written form the button writes what it would have compiled to, and both are compiled
where each is legal and compared byte for byte, which is what lets the swap stay quiet. Three rows
can only be checked differentially, and why is worth reading: `$E9` and `$FC` carry an address the
compiler works out for itself, and `[[ ]]` re-emits the standing note length inside the loop where a
hand-written `$E6 $00` does not. It also pins that every glyph the icon component names has a
`@case` in its template, which nothing in TypeScript can see — and that every element in that
template carries the `svg:` prefix, since the component draws into a host `<svg>` and has no `<svg>`
of its own to inherit a namespace from: without it an element is built in the HTML namespace, which
type-checks, builds, and ships blank in the palette and on every roll bar alike. Last, it reads the
catalogue _backwards_, the way the roll does: every command that acts on a note resolves to a glyph,
`$ED` gives the four-stage envelope below `$80` and the level-driving one at or above it, and a
second argument turns `t`, `v` and `w` into their fades. **The loop reading is held to the compiler
too**, the one `commands/loops.ts` serves to the two bracket buttons and to the command inspector
alike: a construct's repeat count is priced in **notes played** rather than in text, because each of
the five spellings keeps its number somewhere else — on the second of two `]` commands, on no
command at all for a `(n)m`, or one less than itself for a `$E6` — so a reading that is wrong about
which produces a plausible field over the wrong number. Every count it reads is written back and the
result walked; a retarget is compared by pitch, since two bodies of one note each play the same
number of notes either way; and every refusal is written out by hand and has to raise its code,
AMK0112, AMK0115, AMK0126 and AMK0164 among them. **So is the remote call reading** in
`commands/remote.ts`, which reads `(!n, type[, wait])` and `(!!n)` off the text because neither
raises a command: every spelling of the wait is compiled and the `$FC`'s type and wait bytes
compared with what was read, the body found is the one the `$FC` address points at — a `(0)` body
answering a `(!1)` call included — and every splice the inspector writes compiles clean to the bytes
it claims, a wait written on a move onto type 1 or 2 and taken out on a move off (AMK0146 and
AMK0149 otherwise), a hex wait kept hex with 256 as `$00`, and a length kept a length.
