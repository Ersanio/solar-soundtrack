# @amk/compiler

MML to N-SPC song data. A port of AddmusicK 1.0.11's `Music.cpp`, and shaped by that fact.

`preprocess.ts` → `parser.ts` → `link.ts`, with `index.ts` as the entry point and the tables in
`@amk/core`. Depends on `@amk/core` and nothing else.

## This package is not linted, and its comments are not thinned

`eslint.config.js` gives it one rule — an import boundary — and no others. Style rules ask code to
read a certain way, and the way this code should read is _like `Music.cpp`_. A rule that pushes a
method to be shorter, a condition to be inverted, or a loop to become a `map` makes the two
implementations harder to diff, which is the only tool there is for establishing that the port is
faithful. The same argument covers the comments: roughly 100 of them cite a `Music.cpp` line, and
they are the port's audit trail rather than explanations of TypeScript.

Prettier still runs. Formatting does not change what the code says, and the tabs/double-quotes/120
profile exists so the port can be diffed against the C++.

**Read the cited lines before changing behaviour, and cite the lines you port.** Behaviour that
looks strange is almost always strange in the original too — reproduce it and say so in a comment.
`AUDIT.md` is the record of the last line-by-line comparison: what was fixed, and what is still
known to diverge.
`link.ts` keeps AddmusicK's redundant two-stage sentinel/relocation dance for exactly this reason:
so the two implementations can be stepped through side by side.

## Not permissive, in either direction

A song written in this editor is going into AddmusicK, so matching it is the whole job. Accepting
what AddmusicK rejects is the dangerous failure — it compiles here, plays here, and the real tool
refuses it. Rejecting what AddmusicK accepts is merely annoying, and still wrong.

**Where AddmusicK is case-sensitive, so is this.** `#Title` is not a title, `"kick.BRR"` is not a
sample, and `#DEFINE` is not a define. Where it is case-*in*sensitive — `strnicmp` on a directive
keyword, a hex digit — so is this. Neither is a matter of taste; both are observable behaviour, and
`AUDIT.md` records where each was checked.

Being friendlier is never a reason to widen what is accepted. If a construct is ambiguous or
unimplemented, report it — never guess, and never silently mis-compile.

## Targets

| Marker   | Target                     |
| -------- | -------------------------- |
| `#amk 4` | AddmusicK 1.0.9+ (current) |
| `#amk 2` | AddmusicK 1.0-1.0.8        |
| `#amk 1` | AddmusicK Beta             |
| `#am4`   | Addmusic 4.05              |
| `#amm`   | AddmusicM                  |

`#amk 3` (Codec's beta) is rejected — AddmusicK itself does not implement it.

There is exactly one deliberate divergence in what this compiles, and it is `#path`: the directive is
read and validated and then applied to nothing, because the host's sample library is one flat list of
filenames and a directory prefix resolves to nothing in it. `SST0504` says so on every occurrence.
`AUDIT.md` carries the reasoning and is the record; every other divergence found is a bug, and gets a
test before it gets a fix.

## Diagnostics are mapped back to the source the author wrote

The parser works on preprocessed, replacement-expanded text, which is not what is in the editor:
`preprocess.ts` removes the `#amk` marker, every `#define`/`#if` line, the untaken side of a false
branch, and all comments.

So it returns `origins`, one source offset per output character; the parser keeps that array in step
with its buffer, including through `doReplacement`, where expanded text is attributed to the use
site; and `spanAt` is the single choke point that converts. Anything that adds a diagnostic gets this
for free. **Anything that bypasses `spanAt` will be wrong.** `selftest` asserts the offsets land on
the offending character, not merely near it.

Diagnostics carry stable codes and are produced on failure paths too, so partial UI stays populated.
The prefix says whose finding it is, not which file raises it: `AMK####` is a condition AddmusicK
itself reports, which is nearly everything `preprocess.ts`, `parser.ts` and `link.ts` produce;
`SST####` is one `Music.cpp` does not produce at all — `SST0504` for the `#path` this port
deliberately ignores, `SST0505` for a replacement that expands into itself, and `SST0301` on
`compile()`'s ARAM argument rather than on anything in the MML.
Constructs this compiler does not implement are reported as errors, never silently mis-compiled.

`SST0505` is the one place a code covers a song AddmusicK cannot finish rather than one it rejects.
`Music.cpp:135` counts nested expansion at a single position — that is `AMK0023` here — and so sees
`"1=1 1"` and not `"1=[q7F @0 a1]"`, whose value starts with `[`: the recursion there runs between
calls, `getInt` expanding the `a1` that the last expansion delivered, and the buffer outgrows `pos`
forever. `MAX_EXPANSION_GROWTH` bounds the growth, because growth is what diverges — `scan` advances
at least one character per dispatch, so a bounded buffer terminates. Scanning the values for their
own keys instead would refuse `"F=$E7 $0F"`, which contains `F` and terminates, since `getHex` offers
only the first character of its argument for replacement.

Both recursion guards latch and stop the scan, which is what `Music.cpp:139`'s fatal `printError`
does. A diagnostic already filed for the same code, span and message is not filed again: `pos`
advances between reports, so text the author wrote cannot raise one span twice, and text that arrived
by expansion collapses onto its use site by construction.

## `sampleList: null` is not `[]`

`null` means the compiler had no opinion and the host's driver default stands; `[]` means the song
genuinely asks for no samples. The list's _order is the SRCN assignment_, so building an SPC against
a different set produces a valid-looking file that plays the wrong sounds. It is a
correctness-critical output, not a statistic.

## Ticks, not seconds

`stats.introTicks`, `stats.loopTicks` and `stats.channelTicks` are exact — a tick is the same tick
on both sides of the boundary. `stats.tagSeconds`, `introSeconds` and `mainSeconds` are AddmusicK's
own arithmetic, kept for the ID666 header and for labels, and are a few percent out by design.
`stats.playback` is the same split measured against the driver's real tick rate.

Anything that follows the music uses ticks. See `@amk/spc`'s README for why no formula over tempo
can be exact.
