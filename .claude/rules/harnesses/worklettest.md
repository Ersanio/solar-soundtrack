---
paths:
  - 'scripts/worklettest.ts'
---

# `worklettest`: what it proves

Evaluates the _built_ `spc-worklet.js` inside a `vm` context holding only what an
AudioWorkletGlobalScope really exposes — no `fetch`, no `setTimeout`, no `TextDecoder`. Node has all
of those globally, so this catches worklet-only breakage that `audiotest` structurally cannot. It
also pins that a **seek lands on the tick it was asked for**: the fast-forward stops on the driver's
own tick count, so it is exact where a request in seconds could only be converted through a
predicted tempo and would run early the further in it reached — and that a target the song never
reaches returns rather than freezing the audio thread, which is what the stall backstop is for. And
that a song whose lowest channel is `#1` still reports advancing ticks and lands a seek — the count
is latched on the voice the driver plays, and without that every playhead in the app starts before
the music does. Last, that a looping song of one-tick notes keeps the rate its tempo asks for over
five passes: the playhead is folded by `ticks % loopTicks` against the compiler's count, so a
counter that runs slow never wobbles, it walks away, and by the fourth pass the line is most of a
loop from the notes it is drawn over. And that a **voice capture** is posted only on request,
about forty times a second, a full window per voice with the played voices moving and the rest
still, captures still arriving after a seek backwards, a mute captured at volume 0 — and that with it on the output is the same sample for sample
and the tick stream the same tick for tick.
