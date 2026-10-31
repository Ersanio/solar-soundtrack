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

## Decisions already made

- **Anything seconds-denominated in the transport** — a shadow `elapsed` beside the tick playhead, a
  `tickAtSeconds`, `canSeek` gated on a length in seconds (a song with a tempo fade or a repeated `t`
  has none, and got a greyed-out bar) — is covered by "Ticks, not seconds" above.
- **The m:ss readout from a two-piece intro/loop interpolation** over `stats.playback` — exact at the
  section boundaries, drifting between them. The label reads the segment-table clock
  (`song-clock.ts`, or the measurement); the interpolation is the fallback for a song the walk cannot
  read.
- **Clearing the clock measurement on recompile** — it takes a second to come back, so `SST0503` and
  the transport length flickered on every pause in typing. The last measurement stands until the next
  lands (`ClockMeasurer`, "replaced, never cleared").
- **Extrapolating the roll's playhead at the tempo byte's rate** — the driver runs slower than asked,
  so it sat most of a quarter note ahead. The clock's own slope (`ticksPerSecondAt`) is the rate;
  `charttest` pins the difference.
- **The tempo shortfall taken over the whole pass from `loadSpc`** — the driver's boot and the
  echo buffer `$FA $04` zeroes in the song's first tick (`main.asm`, `ModifyEchoDelay`, some 26 ms
  per delay unit) are one-off costs, and a 48-tick song under `$F1 $06` read them as "30% slower".
  `tempoShortfall` compares from the first tick (`Measurement.leadSeconds`); `clock.seconds` keeps
  the lead-in because it is heard.
- **Re-deriving the roll's playhead from the newest anchor each frame** — every anchor arrives with
  the same small lag, so one frame in ten lurched. It carries its position across frames and eases
  the gap shut (`roll-layout.ts`).
- **Muting by writing the driver's `$5E`** — a disabled channel does less work per tick, so a busy
  song sped up. The mixer takes track volume and leaves `$5E` alone (`applyChannelMutes`).
- **A 1024-frame render block in the worklet** — a tick counter that only looks every 1024 frames
  drifts. 32 frames costs ~4% and keeps the count exact.
- **The mixer's mutes, solo and output level living on `Playback`** — the note previewer has to
  refuse a channel they silence and sound what it does play at the level the slider is set to, and
  it neither owns nor wants the transport: it shares no worklet, no audio thread and no song being
  played, and reaching through `Playback` for either would make it depend on all three. `Mixer`
  holds the mask, the solo and `volume`, injects `EditorStore` alone, and is read by `Playback`,
  `Audition` and the roll. What the two audio paths share is two numbers, and nothing else — the
  transport hands the level to the player's gain, the previewer to a `GainNode` of its own on its
  own `AudioContext`.
- **Counting music ticks off a voice's note duration counter** — `$70+2n` is decremented once a tick
  and reloaded from the duration byte the moment it reaches zero, both in the one pass
  (`main.asm:2337, 2440-2441`), so a note one tick long is handed the 1 the counter already held and
  the tick that fetched it moves nothing at all. A run of equal one-tick notes is worse: `emitNote`
  drops the repeated duration byte, so `$0200+2n` stops moving too and nearly every tick goes
  missing. The playhead is folded into one pass by `ticks % loopTicks` against the compiler's count,
  so a counter that runs slow does not wobble — it walks away, further every pass, in the transport
  and the roll together, since both read the one anchor. It is the driver's own gate instead: a pass
  of the main loop ticks when `$49 + tempo × timer count` passes 255 (`main.asm:220-238`), by the
  carry or by the product's high byte, which are one statement and of which the second is the branch
  a song too busy to keep up leaves through. Read off `$44` and not `$49`, because the driver writes
  `$44` at the top of the pass and `$49` most of a pass later, so a poll can land between the two and
  only `$44` still names the count. `walktest` prices a song of one-tick ties at tempo — the counter
  read it 8.5% slow, and a song of nothing but one-tick notes three times slow.
