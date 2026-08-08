# @amk/compiler

MML to N-SPC song data. A port of AddmusicK 1.0.11's `Music.cpp`, and shaped by that fact.

`preprocess.ts` → `parser.ts` → `link.ts`, with `index.ts` as the entry point and the tables in
`@amk/core`. Depends on `@amk/core` and nothing else.

## This package is not linted, and its comments are not thinned

`eslint.config.js` gives it one rule — an import boundary — and no others. Style rules ask code to
read a certain way, and the way this code should read is _like `Music.cpp`_. A rule that pushes a
method to be shorter, a condition to be inverted, or a loop to become a `map` makes the two
implementations harder to diff, which is the only tool there is for establishing that the port is
faithful. The same argument covers the comments: roughly 80 of them cite a `Music.cpp` line, and
they are the port's audit trail rather than explanations of TypeScript.

Prettier still runs. Formatting does not change what the code says, and the tabs/double-quotes/120
profile is carried over from the pre-Angular prototype precisely so the port can be diffed against
the C++.

**Read the cited lines before changing behaviour, and cite the lines you port.** Behaviour that
looks strange is almost always strange in the original too — reproduce it and say so in a comment.
`link.ts` keeps AddmusicK's redundant two-stage sentinel/relocation dance for exactly this reason:
so the two implementations can be stepped through side by side.

## Targets

| Marker   | Target                     |
| -------- | -------------------------- |
| `#amk 4` | AddmusicK 1.0.9+ (current) |
| `#amk 2` | AddmusicK 1.0-1.0.8        |
| `#amk 1` | AddmusicK Beta             |
| `#am4`   | Addmusic 4.05              |
| `#amm`   | AddmusicM                  |

`#amk 3` (Codec's beta) is rejected — AddmusicK itself does not implement it.

One deliberate divergence: an unknown `#directive` is an error here, where `parseSpecialDirective`
(`Music.cpp:2413`) has no else branch and lets the scanner read `#foo` as a note. The comment at
that branch in `parser.ts` says so. Any other divergence is either a bug or needs a comment like it.

## Diagnostics are mapped back to the source the author wrote

The parser works on preprocessed, replacement-expanded text, which is not what is in the editor:
`preprocess.ts` removes the `#amk` marker, every `#define`/`#if` line, the untaken side of a false
branch, and all comments.

So it returns `origins`, one source offset per output character; the parser keeps that array in step
with its buffer, including through `doReplacement`, where expanded text is attributed to the use
site; and `spanAt` is the single choke point that converts. Anything that adds a diagnostic gets this
for free. **Anything that bypasses `spanAt` will be wrong.** `selftest` asserts the offsets land on
the offending character, not merely near it.

Diagnostics carry stable `AMK####` codes and are produced on failure paths too, so partial UI stays
populated. Constructs this compiler does not implement are reported as errors, never silently
mis-compiled.

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
