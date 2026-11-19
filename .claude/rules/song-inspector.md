---
paths:
  - 'web/src/app/editor/views/song-inspector/**'
  - 'web/src/app/editor/spectrum/**'
  - 'web/src/app/editor/spectrum-mini/**'
  - 'web/src/app/state/analysis/**'
  - 'web/src/app/state/{analysis.worker,song-analyzer,live-tap}.ts'
  - 'web/src/app/shared/chart/canvas-colors.ts'
---

# Song Inspector

Read before changing the Song Inspector tab, the top bar's spectrum, `SongAnalyzer`, the analysis
worker, the live capture or the canvas colours.

## Two halves, two sources

**The whole-song half is played, not predicted.** `state/analysis/song-analysis.ts` plays one pass
silently on `analysis.worker.ts`, in the mould of the clock measurement, and reads every voice off
the DSP as it goes. The DSP stores each voice's `VxOUTX` — its waveform after the envelope and
before volume — on every sample, so rendering **a frame at a time** (`SpcCore.renderVoices`) turns
a register into a signal. That is the same bytes a block render makes; `audiotest` (`voices.ts`)
pins it, audio and APU RAM both, so the transport is free to capture while it plays. A voice as
heard is `OUTX × VxVOL/128 × MVOL/128` (`scope.ts`, `heardGain`), which the mix agrees with to the
sample on a lone voice.

**The live half reads the transport.** The spectrum is an `AnalyserNode` `SpcPlayer` hangs beside
its gain, so it reads the song and not the listening level. The scopes and the vectorscope read
`VoiceCapture`s the worklet posts about forty times a second, and only while something holds
`Playback.watchVoices` — the live meters, while the tab is open. A capture is the last 32 ms of
every voice's `OUTX`, the mix and the volumes; `LiveTap` holds the newest and the canvases pull from
it on the frame clock.

## Rules

- **Ticks are the axis.** The analysis buckets the pass by the driver's own ticks, counted as
  `measure-clock.ts` counts them, and every lane maps a tick to the same fraction of the width
  (`timeline-paths.ts`). The spectrogram's columns are taken at a steady rate in time, so they are
  looked up by tick rather than stretched (`spectrogramColumns`). Nothing here turns a tick into a
  second.
- **The mixer's mask is applied in the DSP, as the transport applies it**, and the analysis is run
  again when it changes. A muted channel is silent in every chart, and the mix, the loudness and
  the echo are those of what is left; the eight channel lanes stay, empty and struck through.
- **One frequency axis for every song**: the 28 third-octave bands from 31.5 Hz to 16 kHz, the
  DSP's Nyquist, on −72…0 dBFS (`spectrum-bands.ts`). A band takes the louder of its bins' power
  over the window's bandwidth and its loudest bin, so a full-scale sine reads 0 dB in its band
  however few bins the band holds; `charttest` pins the calibration for both windows.
- **The scopes are drawn as heard, on one scale for all eight**, full at −6 dBFS
  (`SCOPE_FULL_SCALE`) and held at the edge past it. A mix of eight runs each voice far below full
  scale, so a box full at 0 dBFS draws every ordinary voice as a flat line.
- **The analysis is replaced, never cleared**, and drawn dimmed while stale, as the clock
  measurement is held. It runs only while watched: a second after a compile, 300 ms after a mute,
  and at once when there is nothing to show.
- **A canvas draws in tokens too.** Frame-rate and raster charts — the spectrum, the scopes, the
  vectorscope, the spectrogram — are canvases, and every other chart stays SVG. `canvas-colors.ts`
  resolves a `--color-*` token off `<html>` and is told of every `ThemeStore` write by a
  `MutationObserver`, so no colour is written twice and a porter's theme reaches the canvases.
- **The correlation meter beside the vectorscope is eased, held and silent-proof.** A 32 ms reading
  jumps about, so the bar eases toward it over 0.3 s; the lowest of the last two seconds is held as
  a mark, a dip below 0 being the moment worth seeing; and silence, which has no correlation, leaves
  the meter standing rather than pulling it to 0 (`stepCorrelation`).
- **Channel identity is never colour alone** here either: every lane and scope carries `#n`.

## Decisions already made

Designs built or considered here and moved away from, one line each: the entry's title and the
identifiers it names. The full entries are in `.claude/ledgers/song-inspector.md` — read it before
proposing a redesign in this area, or when a title below matches what you are about to do. A new
entry goes there, with its line here, in the same change.

- **A whole-song chart that fills in live as the song plays** — `SongAnalyzer`, `LiveTap`
- **Per-channel levels from envelope and volume alone** — `VxENVX`, `renderVoices`
- **A spectrum that stops at 3 kHz** — `THIRD_OCTAVES`, `HIGH_HZ`
- **Overlaid lines for the channel and sample levels** — `areaPath`, `columnMax`
- **Muting by subtracting a channel from one analysis** — `analyseSong`, `mask`
- **Scopes full at 0 dBFS** — `SCOPE_FULL_SCALE`
