---
paths:
  - 'web/src/app/state/{playback,mixer,song-clock,measure-clock,clock-measurer,clock.worker,transport-view,spc-core,stop-all}.ts'
  - 'packages/spc/src/{worklet,player,protocol,wasm-host,driver-state}.ts'
  - 'web/src/app/editor/{transport-controls,channel-mixer}/**'
  - 'web/src/app/editor/views/piano-roll/roll-clock*.ts'
---

# Transport and clock

Read before changing the transport, the seek bar, the playhead, `Playback`, `Mixer`, the worklet,
the clock measurement, or anything that turns ticks into seconds.

## Rules

**Ticks, not seconds.** Anything that follows the music uses driver ticks. The driver's main loop
processes at most one tick per iteration, so a busy song drops ticks (~0.8% on eight channels) and no
formula over tempo can be exact; a playhead built on one drifts further every pass round the loop.
`stats.tagSeconds` / `introSeconds` / `mainSeconds` are AddmusicK's own arithmetic, kept for the
ID666 header and for labels, and are a few percent out by design.

This is a rule about **denomination, not just about arithmetic**. Nothing that follows the music
stores or accepts seconds: the seek bar's `max` and `value` are ticks, `Playback` holds one playhead
in ticks, and `player.seek` and the worklet take the tick itself — the worklet stops on its own tick
count rather than on a sample count, so a seek lands where it was asked to. Seconds appear at exactly
two edges: as the m:ss **label** `web/src/app/state/song-clock.ts` derives from a tick, and for the
fade past the end of the song, where the driver has stopped reading music data and there are no ticks
left to count. The conversion has no inverse on purpose — seconds are produced and never consumed, so
no position round-trips through a clock. Adding a `tickAtSeconds` back means a seconds-denominated
control got in, and that is the thing to fix instead.

The compiler's own seconds — `stats.tagSeconds` / `introSeconds` / `mainSeconds`, the ID666 header
and the "Length" tile — are outside this: they are AddmusicK's arithmetic, reported as it reports it.

**And the tick rate itself is measured, not assumed.** The driver runs at most one tick per pass of
its main loop, so a song asking for more than it can manage gets fewer — 46% of the requested rate on
a real eight-channel `t254` song, where the ~0.8% above is an ordinary-tempo figure. No formula
predicts it, because it depends on the work each tick costs. `web/src/app/state/measure-clock.ts`
plays the song on a worker and records when each tick really arrived; `SST0503` reports it. Anything
that turns ticks into seconds must go through `EditorStore.clock`, which serves the measurement where
there is one and the prediction where there is not.

## The transport's clock

`state/song-clock.ts` turns ticks into seconds, and it lives in the app because nothing else can
reach both halves of the answer. `@amk/spc`'s walk records every tempo command on the tick the driver
runs it; `@amk/tokens`' `tempoFadeSteps` is the driver's own per-tick model of a `$E3`. Neither
package may import the other (`eslint.config.js`'s `SPC_BEYOND_THE_MATHS`), so the join is here. It
is a placement the dependency graph forces, not a preference, and nothing about the module is
otherwise app-specific — `charttest` and `walktest` both drive it directly.

It exists because **the compiler will not time some perfectly ordinary songs**, and is right not to.
`estimateSeconds` is segment-wise over source text, so a `t` that runs more than once has no place in
it and a tempo fade has no segment at all; AddmusicK gives up on the song's whole length either way
(`Music.cpp:809`), and this port reproduces that faithfully, so `stats.playback` is `null` for them.

So `durationSeconds` and `secondsAt` read the clock and fall back to `stats.playback` only when there
is no walk to read. `durationTicks` needs neither: ticks are known for every song that compiles, and
that is why it, and not a length in seconds, is what the transport is built on. The two agree exactly on any song that sets its own `t`; a song that sets
none reads **55/54 longer**, because `estimateSeconds` treats `0x36` as a written byte where
`main.asm:177` puts it straight into `$51`. That is the same ruling as "assume t53 for songs that
don't have a tempo command", and `walktest` pins the ratio so it cannot drift.

## The clock is measured, not only predicted

Predicting is not enough, and the gap is not small. The driver's main loop handles at most one music
tick per pass, so a song that asks for more ticks a second than it can manage simply gets fewer.
Measured against the emulator: one channel at `t254` reaches 99.6% of the 498 ticks a second it asks
for, four channels reach 81%, eight reach 50%, and a real eight-channel `t254` song reaches **46%**.
Even eight channels at `t100` lose 8%. The `~0.8%` figure in `packages/spc/CLAUDE.md` is an
ordinary-tempo one.

Every predicted seconds figure is `ticks × the tempo the song asked for`, so on such a song it is
out by the whole shortfall — a 32-second pass called 15 seconds long.

Nothing can compute the shortfall. It is a function of how much work each tick costs, which varies
with the live channels, the commands they carry and the passage being played: one song's opening
measures run at 1.86x where its whole pass is 2.15x, so even sampling the start is wrong by 13%. So
`measure-clock.ts` plays the song instead, silently, and records when each tick
actually arrived. It produces a `SongClock` — the same shape `songClock` predicts — and everything
downstream reads one through the other without knowing which it has.

That costs about 90 ms for a half-minute pass and several hundred for a long one, which is a stutter
on the main thread and a dropout on the audio thread. So `clock.worker.ts` runs it, and
`ClockMeasurer` asks **a second after typing stops** rather than on every compile — a typing burst
would throw every answer away, and a second of quiet is far less than it takes to reach for the
transport. The predicted clock stands in the meantime and stands for good if the measurement fails,
which is why it is still worth having.

`SST0503` is the same finding pointed at the porter: past 10% the song is not playing at the tempo
it was written at, and a SNES drops the same ticks, so it is a fact about the song rather than about
this editor. `severe`, beside the echo hazards, `SST0502`, `SST0510`-`SST0512` and the two command hazards — it compiles
cleanly and then misbehaves on playback. What the `SST05xx` band shares is not that, but that
`Music.cpp` produces none of them: `SST0504`, for a `#path` this editor deliberately ignores, is
`info` and is about the editor rather than the song. The comparison starts at the first tick: the
driver's boot, and the echo buffer `$FA $04` zeroes in the song's first tick — some 26 ms per delay
unit, a pause AddmusicK puts at the top of every song on purpose — are one-off costs, and a short
song would read them as a rate. The pass length keeps them, since they are heard.

**Nothing that follows the music is denominated in seconds**, the seek bar included: its `min`, `max`
and `value` are driver ticks, `Playback.position` and `scrubbing` are ticks, `player.seek` and the
worklet take the tick itself, and the m:ss beside the bar is a label `secondsAt` derives from the
tick under the thumb. `Playback` holds one playhead, `songTicks`.

That is why the conversion runs one way only. `secondsAtTick` has no inverse: seconds are produced
for a label and never consumed, so no position ever has to survive a round trip through a clock that
is a prediction until the song has been measured.

Two things stay in seconds because they genuinely are wall-clock, not because they were missed: the
fade past the end of the song — the driver has stopped reading music data by then, so there are no
ticks left to count — and the frame timing inside the piano roll, which is about the display's
refresh rate and not the song's.

**A MIDI recording's pointer is ticks too, and runs forwards only.** It is not the transport's
playhead — a take can outrun the song — so `recordTickStep` (`roll-take.ts`) carries it one frame
at a time at `ticksPerSecondAt`'s rate, the way the playhead's own velocity is set between anchors.
That is a wall clock going in and a tick coming out, once per frame, and still no `tickAtSeconds`:
nothing looks a second up in the clock's table, and a key's tick is the pointer carried to the
moment the key was pressed.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/transport-and-clock.md` — read it
before proposing a redesign in this area, or when a title below matches what you are about to do.
A new entry goes there, with its line here, in the same change.

- **Anything seconds-denominated in the transport** — `elapsed`, `tickAtSeconds`, `canSeek`
- **The m:ss readout from a two-piece intro/loop interpolation** — `stats.playback`, `song-clock.ts`
- **Clearing the clock measurement on recompile** — `SST0503`, `ClockMeasurer`
- **Extrapolating the roll's playhead at the tempo byte's rate** — `ticksPerSecondAt`, `charttest`
- **The tempo shortfall taken over the whole pass from `loadSpc`** — `main.asm`, `ModifyEchoDelay`,
  `tempoShortfall`, `Measurement.leadSeconds`, `clock.seconds`
- **Re-deriving the roll's playhead from the newest anchor each frame** — `roll-clock-step.ts`
- **Muting by writing the driver's `$5E`** — `applyChannelMutes`
- **A 1024-frame render block in the worklet**
- **The mixer's mutes, solo and output level living on `Playback`** — `Mixer`, `volume`,
  `EditorStore`, `Audition`, `GainNode`, `AudioContext`
- **Counting music ticks off a voice's note duration counter** — `emitNote`, `walktest`
