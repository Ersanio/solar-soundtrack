---
paths:
  - 'scripts/tokentest.ts'
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
section pins `bendAnchor` and the three hazards a byte earns where it stands. A slide is not
dispatched — the note in front of it peeks one byte ahead — so what is checked is a byte adjacency:
that a rest anchors one exactly as a note does, `$C7` being a note byte to the driver; that a tie is
a frame of its own, so `c4^8 $DD` arms on 24 ticks and not the 72 it is written as, which is
`accumulateTiedLength` rewinding the tie out of the way; that a one-tick frame arms nothing, since
every tick of one fetches, and that a frame is `emitNote`'s — a note of 128 ticks or more goes out
in 96-tick pieces, so `c1 $DD` arms in the last 96 and `c=193 $DD` in a single tick; and that a
command writing bytes between the two is what the driver reads instead, where `q`, `h`, `o`, `l` and
`@21`-`@29` write none and are stepped over. Every answer with a note in it names that note, the one
in front of a blocker too, since it is what the bend inspector draws the slide from. Where it arms,
the **room** it has is pinned too, and every figure was read off the emulated driver: the slide
steps only on ticks that fetch nothing, so each frame gives it one tick fewer than it lasts, from
the frame it arms in through every tie written after the command, until a note or a rest —
`a96 $DD $00 $FF $80^1^4^16^192` has 251 ticks and not 255, its 253 ticks of tie being three frames.
Two ties a command apart are two frames where two adjacent ones fold into one, and a tie straight
before the next `$DD` gives its last segment up as a frame of its own. A loop call is in that list
and is why the pass takes the whole `TokenIndex`: `(` raises no command at all, so the command list
alone cannot see it. `SST0506` is then every `$F7` at every dialect, `SST0507` every slide the
walk-free answer says is stranded, and `SST0508` a `$E4` under `#am4` and nowhere else. And a remote
call's `$` wait is an argument whatever it equals: `(!1, 1, $E0)` opens no `$E0`, so the `$ED` after
it keeps both its arguments, across a line break too, and a call left unclosed ends at the first
token that is not part of one.
