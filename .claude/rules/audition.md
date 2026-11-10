---
paths:
  - 'web/src/app/state/{audition,note.worker,commit-audition,note-transpose}.ts'
  - 'packages/spc/src/note-audition.ts'
  - 'web/src/app/editor/views/sample-browser/audition-button/**'
---

# Audition

Read before changing the note and region preview: `Audition`, `note.worker.ts`, the fast-forward
and voice parking.

## Auditioning a note, and a stretch of the song

`note-audition.ts` is the same knowledge pointed a third way: not reading the driver and not writing
one register of it, but putting a note the song does not contain in front of it and recording what
comes out. `auditionNote` emulates the song from the top to a tick, hands the driver a note there,
and returns PCM. It always emulates at least one tick, however early the note is: the dump's PC is
the driver's main loop with the song index still sitting in `$F6`, so until `PlaySong` has had a
pass there are no track pointers, no volumes and no instruments to hand a note to.

Emulating rather than reconstructing, because the list of things a note sounds under is longer than
anything worth modelling: the instrument and its sample, envelope and tuning; a track volume that may
be mid-fade; pan; `q`'s gate and velocity; vibrato and tremolo phase; a pitch envelope; the global
volume; the tempo; and an echo buffer holding the last delay's worth of the song. `song-walk.ts`
models some of that and says which parts it does not. The driver holds all of it, so the driver is
asked.

**The rest of the song sounds under it.** The other seven voices are parked, not halted: each goes on
playing the note it holds at that tick, keys off where its own note ends — `$0100+x` counts down in
the read-ahead whether or not a voice is fetching (`main.asm:3213`) — and never reads another byte of
music data. So a click on a note in a chord is that chord. Parking rather than halting is also what
keeps the frames safe where they are: they are written over the song's load address, and the `$40`
phrase table with it, and a voice that reads a `$00` walks that table (`L_0C01`) and reinstalls all
eight track pointers from what the audition has just written. A parked voice never reaches one. It is
only 127 ticks, so `parkOthers` runs again after every block.

The mixer's mask decides which of those channels are in it, and the mask is what the fast-forward
runs under as well — held the way `worklet.ts` holds it — so the echo the note lands on is the echo
the transport is making. The **target's own bit is ignored**: honouring it would take that voice's
volume on the way through and step 5 below would hand it straight back, so the note would sound
regardless. A caller that wants silence needs no emulator at all.

**Reaching the tick is not arriving at it.** `sawTick` reports a tick off `$44`, which the driver
writes at the very top of a pass — a `$49` update and a `ProcessAPU2Input` call before that tick's
music runs (`main.asm:193, 227, 239`) — and reading a tick without waiting for it is exactly what a
playhead wants. A note cannot be handed over on that reading, because the tick a note starts on is
the tick its own commands are dispatched on: the `@`, the `v` and the `y` written in front of it come
out of the same fetch as the note byte (`L_0C57`).

So `arrive` waits for two more things, and which of them is missing decides how the note goes wrong —
by where the target voice sits in a walk that runs 0 to 7 (`main.asm:2328-2459`), so identical music
on two channels gets two different answers. Before the voice's own fetch, the note sounds under the
**previous** note's instrument, volume and pan. Inside it, `L_0CB3` reloads `$70+x` from the song's
own duration byte a moment after `startVoiceAt` has written 1 there (`:2440-2441`), so the voice
plays the song's note and falls into the frames at the scratch address when that runs out — a
**second key-on** partway through the audition. The same reload decides when the other seven can be
parked, too: a `$70+x` written into a voice already inside its fetch is overwritten a moment later,
and a voice that is not parked reads on to the next note and to the `$00` past it.

The recipe, once the fast-forward has arrived:

1. `parkVoice` on the target, so the settle below cannot carry it past the tick that was asked for.
2. `applyChannelMutes` over the target voice, plus whatever the mixer is already holding, until the
   driver has cleared `$5C`, so the note that was ringing there stops without a click and the backup
   is holding that voice's own volume. The driver clears it once it has walked every voice
   (`main.asm:2502-2512`), which is what a block count could only guess at — a music tick is 37 ms
   apart at `t55`. Then arrive again, the settle having rendered. The other six are left alone: every
   one of them keyed on the note it plays at this tick during the walk the arrival waited for, and
   muting them here would take the front off that attack and hand it back a tick later.
3. `parkOthers`, so nothing else reads music data from here. Tempo and the global fades run on
   regardless, and so do every parked voice's own fade, vibrato and key-off.
4. The note's frames at the caller's scratch address, the voice pointed there, its duration counter
   forced to 1 — which is how the driver starts its own voices (`main.asm:2314-2318`).
5. `restoreTrackVolume`, deliberately without the `$5C` dirty bit, so the DSP keeps 0 until the new
   note keys on and recomputes it. `NoteVCMD` sets the flag itself (`main.asm:459`).

The hand-over therefore happens where the driver says rather than after a fixed count of blocks, and
the last of the arrival steps to the top of a pass so that where it says is the _same_ place every
time. It is not the same sample-for-sample: a mixer mask, or a different voice's fetch to wait for,
moves the key-on by a few CPU cycles, and the DSP's free-running envelope counter sits differently
under the attack. `audiotest` measures that at a few ten-thousandths of the signal, with the body of
the note unmoved.

`noteFrames` mirrors the compiler's `emitNote` (Music.cpp:2254), so the bytes are the ones a note of
that length would really be written as. **It writes no `q` byte**, because the driver only reads one
when the byte after the duration is below `$80` — leaving it out is what makes the gate and velocity
the song left standing apply. The exception is a channel the song has never written to, which has
neither a `q` nor an instrument and would otherwise play for one tick at no volume: there `@0` and
`q7f` stand in, which are what the driver and the compiler respectively default to.

**A note can carry its `$DD`**, and the same argument decides how: the four bytes go where `emitNote`
would leave them and the driver is left to find them. It has to be that way round, because `$DD` is
not dispatched — the note before it reads it by peeking at the byte standing at the track pointer
(`main.asm:L_10E4`), and only on a tick that does _not_ fetch music data, since `main.asm:2337-2339`
jumps straight past `L_0CC6`'s read-ahead on one that does. So **where the slide arms is decided by
the frame the peek reads it in**: `afterTicks` ticks of note, then that frame — `frameTicks` of it —
then the command, then whatever the note has left, as ties. That is `c4 $DD` against `c4^4 $DD`, and
it is the whole reason `Music.cpp:2224` rewinds a tie out of a `$DD`'s way. A frame of one tick
therefore never arms at all — every tick of it is a fetch tick — and the command loop dispatches the
`$DD` into its empty slot instead, which is what AddmusicK does with the same song.

Usually that frame is the note's last, and `f+2 $DD $00 $D6 a+^2` is where it is not: the tie is
written after the command, so the note runs on for 96 ticks behind the four bytes. Which is why the
frame's own length is carried rather than taken as "the rest of the note" — the two are the same
number in every other shape, and a one-tick frame in the middle of a note arms nothing while a
96-tick one arms at once.

The operands come from `song-walk.ts` (`WalkNote.bend`) and never from the source. The text cannot
say `afterTicks`: `emitNote` chunks a note of `$80` ticks or more inside one note-map entry, so
`c1 $DD` arms 96 ticks in with no tie written anywhere. Anything no `emitNote` could have produced —
an arm past the note's end, one before its head, a frame no duration byte can say, one the note has
not the ticks to hold — is dropped,
and the frames come out byte for byte those of the flat note. The target arrives as the **emitted**
byte, the driver adding `$43` and `!HTuneValues+x` itself at arm time. And the tail is not lengthened
to cover the slide: `delay + duration` may outrun the note, and then the note keys off part way
through the bend, which is what the song does — the note after it is where the slide was going.

One thing it does not do: the length is fixed when the request is made — the PCM is rendered before
it is heard, so there is nothing to send a note-off to, which is the price of not putting a second
emulator on a second audio thread. That bounds the whole preview, the parked voices included, so a
click on a short note is a short answer however long the notes under it were going to be.

What the mask reaches is therefore a whole channel and not a corner of one. `audiotest` pins it as a
level: the chord under a note is heard, silencing one of its channels sits between silencing none and
silencing all, and silencing all of them gives back the note on its own.
The echo it lands on is still the transport's, the mask being held through the
fast-forward, and the buffer still holds the song as the mixer leaves it — the last delay's worth
decays under the note at the song's own feedback rate, which is what a note written there would
really land on top of.

**`auditionRegion` is the same file's other half, and its opposite in the one respect that matters.**
A selection of the roll is not a note: what the porter picked out is a piece of the **song**, so it
is played as the transport would play it. Nothing is injected into ARAM and nothing is parked — every
voice reads its own music, and a voice that reaches its `$00` walks the phrase table exactly as it
does under the transport, there being no frames written over it to protect. The mask is honoured as
it is given, with no target's bit stripped: a region belongs to no channel, so a silenced voice is
simply not heard.

It skips `arrive` for the same reason. Waiting for the target voice's fetch is what puts a note's
hand-over after the tick's own commands, and here it would put the recording's first sample after the
first note keyed on and take that attack off. `sawTick` reads `$44` at the top of a pass and before
that tick's music runs, so stopping at the count is stopping with the tick still ahead — which is
what a region wants and a note cannot use. What ends the span parks **every** voice: the notes
standing at that tick ring out and key off where they were written to, and nothing new starts.

## Two AudioContexts

`SpcPlayer` owns one for song playback. `Audition` owns a second for one-shot audition — a sample, or
one note of the song. They are separate on purpose: auditioning must not interrupt or be interrupted
by the song, and a note is meant to be sounded _while_ the song plays.

A sample needs no emulator, and a service of its own is what keeps that path from waiting on
`player.init()` — hearing a 65-byte square wave would otherwise mean downloading and compiling the
SPC core first. A note does need one, and gets a second, on a worker: `note.worker.ts` runs the song
silently up to the tick, hands the driver the note there and renders it, so what reaches this side is
finished PCM and the context only has a buffer to play. The emulator playing the song is inside an
`AudioWorkletProcessor` and is never addressed, which is the whole of why a note can be auditioned
over a song without disturbing it.

A note of the song carries the `$DD` the walk read for it (`StripItem.slide`), so a bar that slides
in the song slides under the pointer — clicked, and on every row a drag of it crosses, the target
being absolute. Its target is also the one number on this path that must _not_ go through the
transposition `Audition` applies: that turns a written row pitch into the byte the compiler would
emit, and a slide's target already is one.

The mixer is the one thing the two paths share, and only as a number. A note on a channel the mixer
silences is refused in `Audition` before an emulator is asked for — hearing nothing does not need a
few hundred milliseconds of fast-forward to arrive at — and a deliberate key press says why, where a
drag asks quietly because it asks once per row. A note that does sound carries the mask with it, and
the mask is now what decides **which of the other channels are heard under it**: `auditionNote` parks
the other seven rather than halting them, so each plays out the note it holds at that tick and a
click on a note in a chord is that chord. The mask reaching the fast-forward as well is what keeps
the echo the note lands on the echo the transport is making. Neither is a route back to the worklet's
emulator. The mutes apply with the transport stopped too: they are a standing monitoring state, not a
property of something playing.

`playRegion` is the same path with the note taken out of it: a selection of the roll — a loop's pass
taken by its box, or a `Ctrl`+drag over the grid — is played as a **stretch of the song**, `Audition`
posting the same worker a second kind of request and `auditionRegion` recording the ticks with every
voice reading its own music. There is no refusal here, where a note on a silenced channel gets one: a
region belongs to no one channel, so the mask simply decides what is in it. The two share one token,
so pressing a note while a selection is rendering supersedes it rather than sounding over it.

That worker is separate from `clock.worker.ts` rather than another message on it. The clock
measurement fires a second after typing stops, which is exactly when someone is about to click, and
an audition queued behind a whole pass of emulation would arrive hundreds of milliseconds late. They
share `spc-core.ts`, which is the one-emulator-per-worker bootstrap both need.

## Decisions already made

- **Latching the audition's fast-forward on the track pointer alone**, the way `worklet.ts` does —
  `L_0C22` installs every voice's pointer, and `L_0C31` gives them instruments, a whole pass before
  any of them has read a duration byte (`main.asm:2302-2341`), so a poll landing there starts the
  count on a song that is not reading music yet and `atTicks` comes round a pass early. The note is
  then handed over inside the pass that starts the song, and the phrase walk still to come reads the
  frames at `scratchAt` as its next phrase: every track pointer goes to zero and nothing sounds at
  all. It latches on `$0200+2n`, the duration byte a voice has actually read (`voiceStarted`), and
  the floor of one tick on `atTicks` is what starts the driver at all. `audiotest` sweeps three to
  eight channels, because how much work `L_0C31` does before the song's first fetch is what moves it
  against the poll — four channels was silent where one and two were not. The worklet keeps the
  looser latch: a playhead a tick out is a playhead a tick out, where a note handed over a tick early
  is not played.
- **Auditioning a note's slide off the `$DD` its own text carries** — `StripItem.bend` is the token,
  and a token cannot say when the driver arms it. `$DD` is not dispatched: the note before it peeks
  at the byte standing at the track pointer (`main.asm:L_10E4`), and only on a tick that does not
  fetch music data, `main.asm:2337-2339` jumping straight past `L_0CC6`'s read-ahead on one that
  does. So the arm is decided by **the frame the peek reads it in**, and `emitNote` chunks a note
  of `$80` ticks or more inside one `noteMap` entry with no boundary anywhere in its text —
  `c4 $DD`, `c4^4 $DD` and `c1 $DD` carry the same three operands and arm 0, 48 and 96 ticks in. The
  operands come off the walk (`WalkNote.bend`, `afterTicks` and `frameTicks` with them) into `StripItem.slide`, joined
  index by index over the list `expandAndJoin` has already checked so the two cannot drift, and a
  note past the end of the pass auditions **flat**: an approximate bend that sounds like the real one
  is worse than none, which is the reading `commands-in-force.ts` already takes. `noteFrames` then
  writes the four bytes where `emitNote` would leave them and lets the driver find them, rather than
  reconstructing a pitch curve — the same argument as emulating the song up to the tick instead of
  modelling what a note sounds under, and it is what makes a frame of one tick behave here as it
  does in the song, dispatched into the empty slot and never armed. Operands no `emitNote` could have
  written are dropped rather than approximated. The target goes in as the **emitted** byte and is the
  one value on that path `Audition.transposed` must not touch: it exists to turn a written row pitch
  into an emitted one, the compiler resolved `h` and the instrument's tuning long ago into
  `NoteAddress.note`, and the driver adds `$43` and `!HTuneValues+x`
  itself when it arms.
- **Rebuilding an audition's frames from `afterTicks` and the note's length alone** — it takes the
  arm's frame to be the note's _last_, which puts the `$DD` after every frame the note has, and
  `f+2 $DD $00 $D6 a+^2` is where that is false: `^` emits a `$C6` frame of its own and a tie keys
  nothing on (`main.asm:2403-2405`), so those 96 ticks land on the `f+` and the command sits between
  the note's two frames. Read as a last frame it is a 192-tick tail, which no duration byte can say,
  and the slide was dropped outright — the note previewed flat where the transport bent it; take the
  tail check away and it arms 96 ticks late instead. The frame's own length is carried
  (`PitchSlide.frameTicks`, `track.duration` at the peek) and the ticks behind it written as the ties
  they are. It cannot be derived: `c=1 $DD $00 $18 a ^=95` and `c4 $DD $00 $18 a ^4` are both 96
  ticks arming at 0 and only the second arms at all, and `StripItem.segments` cannot answer it either,
  being the note map's frames and not `emitNote`'s. What the frames after the arm are is inaudible —
  the slide counts off `$90`/`$91` — so only their total is reproduced. `StripItem.bend` reads from
  the item's **first** segment's end for the same shape, `growUnits` ending a unit at its last
  segment and so at a point past the `$DD`, which left every guard that reads `bend` switched off.
- **Handing an auditioned note over the moment the fast-forward's tick count reached its tick** —
  `sawTick` reads `$44`, which the driver writes at the top of a pass, a `$49` update and a
  `ProcessAPU2Input` call before that tick's music runs (`main.asm:193, 227, 239`); reading a tick
  without waiting for it is what a playhead wants and not what a note wants, since the tick a note
  starts on is the tick its own commands are dispatched on — the `@`, the `v` and the `y` in front of
  it come out of the same fetch as the note byte. Four settle blocks are 4 ms against a fetch pass
  that runs well past that on eight busy channels, so ARAM was patched inside `L_0C4D`'s walk, which
  runs voices 0 to 7, and identical music on two channels got two different answers. Before a voice's
  fetch, the note sounded under the **previous** instrument. Inside it, `L_0CB3` reloaded `$70+x`
  from the song's own duration byte over `startVoiceAt`'s 1 (`:2440-2441`), so the voice played the
  song's note and fell into the audition's frames when it ran out — a second key-on half way through.
  And halting another voice mid-fetch left it reading through a pointer whose high byte had just gone
  to zero, where the `$00` it found walked the phrase table over every pointer at once and six
  channels of eight went silent. `arrive` waits for the target voice's own fetch mark to move and for
  `$48` to say no per-voice loop is in flight, then steps to the top of a pass so the point is the
  same one every time; the settle waits for the driver to clear `$5C` rather than counting blocks;
  and the voice is parked meanwhile, since a halt would stop `L_0D1C` taking its volume. Not
  sample-identical even so, and no arrangement of this is: a mixer mask, or a different voice's fetch
  to wait for, moves the key-on a few CPU cycles and the DSP's free-running envelope counter with it.
  `audiotest` prices that at a few ten-thousandths of the signal, with the body of the note unmoved,
  and the mask control there is a level for the same reason.
- **Halting the other seven voices for an audition** — a note in a chord came back as that note
  alone, which is not what it sounds like there and is the one question a preview is asked. They are
  **parked** instead (`parkVoice`, `$70+2n` at the ceiling): a parked voice reads no further music
  data but keeps everything else, so it plays out the note it holds at that tick, keys off where its
  own note ends — `$0100+x` counts down in the read-ahead whether or not a voice is fetching
  (`main.asm:3213`) — and takes its fade and its vibrato with it. `silenced` is then what says which
  channels are in the chord, held through the recording as well as the fast-forward. Not a halt with
  the volume left on, which is the cheap spelling of "let them ring": `L_0D1C` skips a halted voice
  (`main.asm:2503-2505`), so its `VxVOL` is never rewritten again and it rings at a fixed level for
  the whole preview instead of ending. And the park is what keeps the frames where they are — they go
  over the song's load address and the `$40` phrase table with it, and a voice reading a `$00` walks
  that table over all eight track pointers (`L_0C01`), which a parked voice never reaches. It lasts
  127 ticks, so `parkOthers` runs again after every block. The settle stopped muting everything at
  the same time: the other voices keyed on at this tick during the walk the arrival waited for, and
  muting them there took the front off that attack and handed it back a tick later.
- **A region audition built out of the note previewer's frames** — a selection is not a note, and one
  injected per note would park every other voice and play a chord the song has not got.
  `auditionRegion` runs the same `fastForward` and then records with **nothing parked and nothing
  injected**: every voice reads its own music, a voice that reaches its `$00` walks the phrase table
  exactly as the song does, and what comes back is the song over those ticks. `parkOthers` was only
  ever there to keep a voice off the frames a note was written over, and there are none here — but
  the span's _end_ parks every voice, so its last notes ring out and nothing new starts. No `arrive`
  either: that waits for the target voice to fetch, which is right when a note is being handed over
  and takes the attack off the region's first note, where `sawTick` reads `$44` at the top of a pass
  and leaves the driver about to play the tick asked for. One worker and one token with `playNote`,
  so a note press and a box press supersede each other rather than sounding together.
- **Sounding a carried selection as one span of the song** — `selectionSpan` over the frame's
  selected notes, handed to `auditionSpan` at the slop transition and silent per row after it, on
  the reading that a group of notes is no more one note than a transposed body is. It answers the
  wrong question: a span is the song where those notes **were**, at the pitch they **were**, played
  once and never again, so it says nothing at all past the first three pixels and a group carried an
  octave up sounds exactly like one carried a semitone — which is the one thing the drag most needs
  to hear. The note under the pointer is the one whose bar follows it, and the whole group moves by
  one delta, so that note names the interval every other note took; `soundDrag` reads
  `items[held.item]` and is already what a single note's drag sounds. The span was not free either:
  a region is a whole silent run of the song plus up to `MAX_AUDITION_SECONDS` of PCM on the one
  worker `playNote` shares, so it also stood in front of the per-row renders that would have said
  something. `auditionSpan` keeps the `Ctrl` marquee and the loop box's edge, where the question
  really is which notes were just picked out.
