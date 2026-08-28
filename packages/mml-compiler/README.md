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
deliberately ignores, `normalize.ts`'s `SST06xx` refusals, and `SST0301` on `compile()`'s ARAM
argument rather than on anything in the MML. Constructs this compiler does not implement are
reported as errors, never silently mis-compiled.

## The parse trace, and the normalizer built on it

`compile({ …, options: { trace: true } })` returns `CompileResult.trace`: one event per dispatch of
the scan loop — its source span, the character it dispatched on, the parser's state once it
returned, and what it did to the loop structure — plus the final buffer and its `origins`, the span
of every replacement the parser expanded, and the table every note was tuned by. It is gathered
where the command map is, by bracketing `scan`'s one dispatch loop, and a loop event is read off the
bytes a handler wrote rather than asked of the handler: `[` moves the channel to 8, `]` moves it back
and leaves `$E9 lo hi n` on the caller, `*` and `(n)m` leave the same four bytes, and `]]n` leaves
`$E6 n-1`. A subloop written `$E6 $00` … `$E6 $nn` toggles the same flag and leaves the same bytes,
so it is read the same way and unrolls the same way, and either end of a pair may be either
spelling; the event sits on the argument byte, one `$XX` being one dispatch, so `LoopEvent.from`
says where the run began. `$E9` and `$FC` have no such reading — the compiler works their address
out for itself and relocates it (`link.ts`), so a hand-written one names a body nothing can
resolve. One guarded line in `doReplacement` records a match's extent, which is the only place it
is known. Nothing is recorded unless asked for, and no byte changes either way.

`normalize.ts` is what it exists for: nine text-to-text passes that leave a song with no
`#define`, no replacement, no triplet, no loop or call, no `l`, no legacy `&`, one block per channel
in channel order, `o`/`q`/`@`/`t` written where a channel left them implied, `<`/`>` made absolute
and the drum `@` before every drum note — the shape an editor can splice. The default note length is the one
piece of parse state a splice cannot work around — it is one variable for the whole song and `#N`,
`[`, `]`, `(n)`, `*`, `/` and `{ }` all leave it standing — so every note is given its own length
instead, segment by segment, since `c4^` is an explicit 48 and an implied 24. That is always
writable where an `l` was: dots and `=n` are legal on a note for every dialect and on an `l` only
from `#amk 4`. A `[ ]` body is compiled once, under
the state standing at its `[`, and replayed from bytes, so each copy of its text is preceded by
whatever re-creates that state and the last copy followed by whatever restores the state that stood
after the construct; `h` is switched off again by a `#N` re-entering the channel, which resets `h`
and nothing else a note reads (`parseHash`). What cannot be re-created is refused with an `SST06xx`
diagnostic saying why: an instrument a copy would be tuned differently under — `h` _replaces_
instrument tuning (`parseNote`), so no `h` is ever written and `@` only for a drum remap — a `*`
with no loop before it, a legacy `&` whose duration byte comes from a bracket, `tuning[n]=`, and a
`(!n, type, n)` whose length argument is the `l` in force, which is the one reader of the default
that is not a note and so has nowhere to be written out to. A loop and a subloop that **cross** —
one opened inside the other and closed outside it, which AddmusicK builds because it guards nesting
and not crossing — is refused there too: a voice has one subloop return (`Commands.asm:365`), so the
close jumps into the other construct's body, and the channel either ends on that body's `$00` with
the call counter spent or re-enters the `$E9` and starts its count again. The passes never emit text from bytes;
the note map's tick counts are the one thing read from the compile, for the lengths a triplet's
notes become.

A legacy `&` is written out as the `$DD` it compiles to (`writePitchSlides`), which is what lets the
piano roll open a song using one: `&` is an operator rather than a command, so nothing above the
compiler can say which channel it is on, and the roll refuses all eight while one stands. The rewrite
is exact rather than merely equivalent — the duration is `prevNoteLength` off the trace, the target
is the emitted byte off the note map, and the run goes where the note's own parse would have
appended it, so the same four bytes land in the same place. It is written all in hex and never as
`$DD`'s note-target form, which would consume the drum remap (`parseNote`) and leave the note after
it pitched, error AMK0161 wherever a `q` is pending, and be unable to spell a rest or a tie at all —
a `&` reaches all three. Two shapes it declines, reporting `SST0617` at info severity rather than
refusing the song: a slide whose note is already a `$DD`'s written target, which has no note-map
entry to read a byte from, and one standing after a tie, since `accumulateTiedLength` rewinds a tie
out of the way of the text `$DD` on every target but out of the way of a `&` only on the legacy ones
— so writing it out either gains that rewind or loses it, and the tie moves the slide with it. It
runs before `drumPerNote`, whose suppression test reads only the event directly in front of a note.

`NormalizeInput.onlyChannel` narrows the whole thing to one channel, which is what the piano roll
asks for: it edits one channel at a time, so a channel it cannot splice wants putting in order on its
own — and must not be refused because a _different_ channel has a loop that cannot be unrolled. Every
pass that works construct by construct filters on it; `resolvePreprocessor` and `inlineReplacements`
are global by nature and run whole; `writeDefaults` writes no `t`, since a tempo reaches all eight
channels however local the block it sits in; `orderChannels` refuses with `SST0615` rather than
joining one channel's blocks, because that moves text past the others and changes the `o` and `l`
they inherit; and `writeNoteLengths` stands down entirely, so a scoped run keeps its `l`s. Scoping
the rewrite does not scope the reader there: one `l` is read by every later channel's bare notes and
by every `[ ]` body, whose events carry channel 8, so taking one out means rewriting text a scoped
run has promised to leave alone. The roll is unharmed by that — a note's length is read off its own
written text — which is why the pass is a property of the whole song rather than of a channel.

The normalizer does not check its own work, because it cannot: the walk that would is in
`@amk/spc`, which this package may not import. `web/src/app/state/normalize-song.ts` runs the
passes, compiles and walks after each, and applies nothing unless every intermediate plays the same
music as the original — scoped or not, the standard is the same one; `normalizetest` pins both
halves. `WalkNote.bend` is what makes a `$DD` visible to that comparison at all: the walk reports the
slide on the note whose read-ahead picks it up, carrying the operands _and_ how far into that note
the peek found them, so a rewrite that moved a slide behind a tie is caught rather than passed as the
same music.

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
