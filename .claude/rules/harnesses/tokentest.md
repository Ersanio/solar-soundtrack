---
paths:
  - 'scripts/tokentest/**'
---

# `tokentest`: what it proves

The MML scanner, and the command model on it. Its load-bearing assertion is **restartability**:
stepping line by line with the state carried across must equal scanning the whole document.
CodeMirror restarts the scanner at arbitrary lines, so a state machine that secretly depended on
having seen the top of the file would pass a whole-document test and mis-colour text much later. It
also holds the inspector's two arithmetic claims about a fade, both of which read as plausible while
being wrong: a tempo fade's seconds are checked against a closed form derived independently of the
per-tick walk that produces them, because `$E3` is the one command whose duration cannot be priced
at the tempo in force; and every fade command is checked to report a duration of 0 as dropped rather
than instant, which is what the driver does with it. It pins `commands/in-force.ts` as well: that
every VCMD and every named letter has a scope, since a table that quietly loses a row is a command
the roll silently stops drawing; that `<` and `>` are never commands at all, where reading
`LETTER_NAMES` would suggest they are; and that the parse-time half — `q`, `h` and `@21`-`@29`, the
ones that emit nothing for a walk to address — carries forward, supersedes, stops at a channel
boundary, starts above the first marker on the starting channel — the lowest `#N` the song declares,
where the compiler starts writing, so a `q` or a drum `@` written there reaches that channel's first
note — clears `h` at every marker including one re-entering its own channel, keeps the drum slot as
the parser keeps `instrument[channel]` — the `[ ]` copy, the one-drum clearing off `#6`/`#7`, a
`$DA` that writes nothing — and covers **only** commands the compiler's map does not, since a
command answered twice would draw two glyphs for one setting. It also pins that the label and the
clock share **one** model of a fade: `tempoFadeSeconds` is a sum over `tempoFadeSteps`, the run has
one entry per tick and never reaches the target it snaps to, and `$51` wraps `t255` to a stop rather
than to 256. `$DD`'s note target has a section of its own, because it is the one place a scanner has
to mirror a lookahead it cannot perform: the parser reads ahead over spaces, newlines, `o<int>`, `<`
and `>` to decide whether the last parameter is a written note, and `step` may not read another
line, so the flag is deferred and cleared by default. Every arm of that loop is pinned in both
directions — what carries the lookahead on, including a comment, a bare line break and an `o` with
no digits, and what ends it, including a bare digit, a spaced `o`, an upper-case `O` where the note
letters take either case, and a replacement, which is the fourth departure the package's README
lists. The check that matters most is not about `$DD` at all: `parseNote` clears the drum remap
before the early return that makes the target a parameter, so the target folds and clears an `@21`
like any other pitched letter — which holds only while `gather` keeps raising an ordinary note
command for it, and nothing else here would notice if it stopped. **Every length segment names its
denominator and where its digits go**: `denominator` is the `1/n` that, written, reproduces the
ticks the segment already plays — its own digits, or the standing `l`'s where it wrote none or wrote
one the parser threw away — and `digits` covers the digits alone, in front of the dots that compose
rather than add and after the `=` of an exact count; every `l` from 1 to 192 is swept, and a bare
note under a dotted or exact `l` reports no denominator rather than a wrong one. The same `$DD`
section pins `bendAnchor` and the three hazards a byte earns where it stands; `pitch-slide-note.ts`
pins that a written target is no frame of its own, so a chain rides the note in front of it. A slide is not
dispatched — the note in front of it peeks one byte ahead — so what is checked is a byte adjacency:
that a rest anchors one exactly as a note does, `$C7` being a note byte to the driver; that a tie is
a frame of its own, so `c4^8 $DD` arms on 24 ticks and not the 72 it is written as, which is
`accumulateTiedLength` rewinding the tie out of the way; that a one-tick frame arms nothing, since
every tick of one fetches, and that a frame is `emitNote`'s — a note of 128 ticks or more goes out
in 96-tick pieces, so `c1 $DD` arms in the last 96 and `c=193 $DD` in a single tick; and that a
command writing bytes between the two is what the driver reads instead, where `q`, `h`, `o`, `l` and
`@21`-`@29` write none and are stepped over — and a tie past a `q` is not rewound, so `c4^8 q7F $DD`
arms on 72. A `$C6` tie standing alone, or after a written target, is a frame the peek runs in like
a note's. The peek runs only while no slide is running, so a `$DD` straight after another arms on
the tick after that slide's delay and steps run out, inside the same frame, and from its target: the
tick it arms on (`arms`) is pinned for a chain, a delay, both readings of a `$00` duration, a slide
carried through a tie or a rest, which leaves it running where a key-on clears it, and the last tick
of a frame against one past it, which is `crowded`. Once one `$DD` of a run cannot arm, the rest of
the run takes its answer. Every answer with a note in it names that note, the one in front of a
blocker too, since it is what the bend inspector draws the slide from. Where it arms,
the **room** it has is pinned too, and every figure was read off the emulated driver: the slide
steps only on ticks that fetch nothing, so each frame gives it one tick fewer than it lasts, from
the frame it arms in through every tie written after the command, until a note or a rest —
`a96 $DD $00 $FF $80^1^4^16^192` has 251 ticks and not 255, its 253 ticks of tie being three frames.
Two ties a command apart are two frames where two adjacent ones fold into one, and a tie straight
before the next `$DD` gives its last segment up as a frame of its own; a slide armed behind another
has what is left of the frame from its own tick. A loop call is in that list
and is why the pass takes the whole `TokenIndex`: `(` raises no command at all, so the command list
alone cannot see it. `SST0506` is then every `$F7` at every dialect, `SST0507` every slide the
walk-free answer says is stranded, `SST0508` a `$E4` under `#am4` and nowhere else, and `SST0517`
an `$FB` list holding loop points before its last — a warning on the whole run, but not for a list
that ends in one or is nothing else, nor for one not yet written to its end, nor for a trill's
interval. A list that ends in one or is nothing else is `SST0519`, severe on the whole run, and a
loop point before the last note, Off and a half-written list are not. `SST0518` is an `$FB` sequence whose count
disagrees with its notes, read as the parser reads the run: short only where something it does not
read on through ends it, so a comment inside the run and a run at the end of the document raise
nothing, and over only by bytes it refuses as commands, so a command byte ends the notes over and a
byte below `$DA` under a legacy target is no note. No count fits where the bytes past it complete a
counted command byte, where the count would be Off or pass `$7F`, or where the sequence would end on
a loop point. And a remote
call's `$` wait is an argument whatever it equals: `(!1, 1, $E0)` opens no `$E0`, so the `$ED` after
it keeps both its arguments, across a line break too, and a call left unclosed ends at the first
token that is not part of one.

## Section files

`scripts/tokentest/main.ts` runs one section file per subject, in the order below, and `support.ts`
holds what they share: `at`, `said`, `tokenAt`, `lengthOf` and `inForceAt`. `HARNESS_ONLY=<file
name>` runs one section alone.

| File                             | What it pins                                                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hex-arguments.ts`               | A hex command gathers exactly its arguments: counted, incomplete, outside `$DA`-`$FE`, `$FB`'s variable length, and abandoned at a bar line.                |
| `letters-and-fades.ts`           | Letter commands and their arguments, the comma forms of `t`, `v` and `w` as fades, and the fade arithmetic the inspector label and the clock share.         |
| `note-lengths.ts`                | Note and rest lengths: ties, `l`, each segment's denominator and digits, dots by dialect, and triplets.                                                     |
| `channels-and-tags.ts`           | Comments and strings, directives and channel markers, the channel a command is written under, remote definitions, lookup by offset, and the highlight tags. |
| `replacements.ts`                | Replacements expanded at the use site: scope, longest match, arguments, transitivity, recursion and the edge cases.                                         |
| `instruments-and-divergences.ts` | `q` and `n` read as hex, the `@` forms, the `#instruments` block, the divergences from AddmusicK pinned on purpose, and a directive's bare-word argument.   |
| `dialect.ts`                     | The dialect a command is read under: the velocity table, the target markers, `#am4`'s `$ED` and `$E5`, and a command stopping at its argument count.        |
| `pitch-slide-note.ts`            | `$DD`'s note target and `bendAnchor`, and a remote call's `$` wait read as an argument.                                                                     |
| `hazards.ts`                     | Command hazards, the bytes that compile clean and then break the song.                                                                                      |
| `arpeggio-count.ts`              | `SST0518`: an `$FB` sequence one short or over, the count that fits, and where none does or nothing is raised.                                              |
| `restartability.ts`              | Restartability, that `copyState` copies, that the scanner always makes progress, and the empty document.                                                    |
| `driver-lengths.ts`              | The scanner agrees with the driver about command lengths.                                                                                                   |
| `command-reach.ts`               | What a command reaches (`commandScope`), and the parse-time half of what is in force on a note.                                                             |
