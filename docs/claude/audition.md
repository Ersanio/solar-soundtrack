# Audition

Read before changing the note and region preview: `Audition`, `note.worker.ts`, the fast-forward
and voice parking.

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
