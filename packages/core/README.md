# @amk/core

The vocabulary every other package shares. Depends on nothing.

| Module                | What it is                                                   |
| --------------------- | ------------------------------------------------------------ |
| `types.ts`            | What goes into the compiler and what comes out of it         |
| `hardcoded-tables.ts` | Constant tables lifted from AddmusicK's `Music.cpp`          |
| `hex.ts`              | Upper-case hex, the notation everything here writes bytes in |

`types.ts` is the compiler's contract, but the UI reads it too — diagnostics, stats and the sample
list are all rendered — and `@amk/spc` needs `SongTags` for the ID666 header, so it lives at the
bottom rather than inside `@amk/compiler`.

`hardcoded-tables.ts` is here rather than in `@amk/compiler` because `@amk/tokens` needs eight of its
constants, and that is what keeps the scanner off the compiler entirely. Its line references are to
AddmusicK 1.0.11's `Music.cpp` so they can be re-verified when the reference implementation moves.

## Constants that are stated twice on purpose

`BANK_SLOT_COUNT`, `FIRST_PERCUSSION_INSTRUMENT` and `FIRST_CUSTOM_INSTRUMENT` are also stated in
`@amk/spc` — as `SAMPLE_BANK_SLOTS` in `brr.ts`, and by name in `instruments.ts`. That is deliberate
duplication: `@amk/spc` depends on nothing but this package, each side states the AddmusicK-facing
and the driver-facing form of the same number, and `brrtest` and `instrtest` assert they agree so
they cannot drift apart.

## Ticks, not seconds

`CompileStats` carries both, and they are not interchangeable.

`introTicks` / `loopTicks` / `channelTicks` are exact: a tick survives the trip into the driver
intact. `tagSeconds`, `introSeconds` and `mainSeconds` are AddmusicK's own arithmetic — what it
prints, and what the ID666 tag is built from — and are 2–6% out, which is fine for a label and
useless for a playhead, because the error compounds on every pass round the loop. `playback` is the
same split priced at the driver's real tick rate rather than AddmusicK's rounded one, and is the
editor's **fallback**: it is still a prediction over the tempo the song asked for, so it is out by
whatever the driver drops, and it is `null` for a song AddmusicK will not time at all. Anything
following the audio goes through `EditorStore.clock` first, which measures the song rather than
predicting it, and reaches this only when there is no walk of the compiled bytes to read.
