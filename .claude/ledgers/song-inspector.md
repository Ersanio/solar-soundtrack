# Decisions already made: `.claude/rules/song-inspector.md`

The ledger of `.claude/rules/song-inspector.md`: each entry is a design that was built or
considered there and moved away from, with the reason. The rule carries one index line per entry.

- **A whole-song chart that fills in live as the song plays** — what the transport has heard is
  only what has been played since the last seek, so a chart built from it is blank ahead of the
  playhead and wrong behind a seek. The whole pass is analysed on a worker instead (`SongAnalyzer`),
  so the porter sees the end of the song before playing it, and only the meters that have no
  meaning away from the playhead — the spectrum, the scopes, the vectorscope — read the transport
  (`LiveTap`).
- **Per-channel levels from envelope and volume alone** — `VxENVX × VxVOL` is how loud a voice is
  _set_, not how loud it sounds: one sample is normalised to full scale and another peaks at a
  quarter, and a rest after the release reads the same as a note. Reading `VxOUTX` a frame at a time
  (`renderVoices`) costs about a sixth more emulation and is the voice's own signal, the envelope and
  the sample both in it.
- **A spectrum that stops at 3 kHz** — the DSP mixes at 32 kHz and its output reaches 16 kHz; a
  hi-hat, a cymbal or the noise channel lives above 3 kHz, and a meter that stopped there would show
  them as silence. The range is fixed for every song so two can be compared (`THIRD_OCTAVES`,
  `HIGH_HZ`).
- **Overlaid lines for the channel and sample levels** — eight lines in one plot, and twenty-odd
  for the samples, cross into a tangle in which no one series can be followed. One lane each, filled
  to its level (`areaPath`), reads like the roll's channels, and each column keeps its loudest
  bucket (`columnMax`), so a one-tick hit is not averaged into nothing.
- **Muting by subtracting a channel from one analysis** — an analysis of all eight voices with the
  muted ones' lanes hidden would be instant, but the mix, the loudness and above all the echo are
  not sums of the channels: the echo buffer feeds back on what the muted voice sent it. The pass is
  analysed again with the mask in the DSP (`analyseSong`'s `mask`), which is about a hundredth of
  the song's length.
- **Scopes full at 0 dBFS** — the user asked for the channels as heard, on one scale, and a box
  full at full scale meets that literally. But a mix of eight leaves each voice around a tenth of
  full scale: on the sample song every scope was a flat line. Full at 0.3 (`SCOPE_FULL_SCALE`)
  keeps the one shared scale and makes an ordinary voice legible. At 0.5 (−6 dBFS) the loudest
  voice the default velocity table allows reached only 58% of its box.
- **A spectrum in the top bar** — fourteen bars, each the louder of two bands (`compact`,
  `spectrumBars`), read off the analyser and so free to run. The user wanted the channels instead,
  as a scope of the heard ones. It costs a held capture whenever the top bar shows it.
- **The top bar's scope as one trace per channel** — the heard channels overlaid in one box, each
  in its colour. Tried and replaced by their sum, one trace in the accent (`strokeHeardSum`): in a
  box that small, eight traces crossing are the tangle the timeline's lanes were split to avoid.
