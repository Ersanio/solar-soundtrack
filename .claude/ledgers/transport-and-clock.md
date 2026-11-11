# Decisions already made: `.claude/rules/transport-and-clock.md`

The ledger of `.claude/rules/transport-and-clock.md`: each entry is a design that was built or
considered there and moved away from, with the reason. The rule carries one index line per entry.

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
  the gap shut (`roll-clock-step.ts`).
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
