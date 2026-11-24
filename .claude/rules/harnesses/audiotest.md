---
paths:
  - 'scripts/audiotest/**'
---

# `audiotest`: what it proves

MML → SPC → actual PCM through the real wasm host. **This is what proves the whole pipeline**: a
wrong compiler, layout, sample directory or CPUIO handshake produces silence. It pins that **muting
happens in the DSP and the driver never sees it**: APU RAM after a muted run is byte for byte what an
unmuted run leaves. A channel whose volume the song rewrites every tick — an `$E8` fade with a `v` and
a `q` at the head of every pass, which used to play louder muted than unmuted — is silent, and comes
back mid-fade at the song's own level. A ringing note is cut and comes back mid-note. And **muting does
not change how fast the song plays**: `$5E` is left alone, because disabling a channel makes the
driver's main loop cheaper and a song at the one-tick-per-pass ceiling turns that into a 29% speed-up.
Checked on eight channels at t254, where an easy song shows
nothing at all. It also pins that the voice the tick count runs on is one the driver plays: a song
whose lowest channel is `#1` is counted off voice 1 and ticks exactly as the same music on `#0` does
— the latch reads the track pointer's high byte as the driver does (`main.asm:2315`), because a
whole-word read lands in the driver's start-up hot-patch trick (`main.asm:2104`), takes voice 0, and
counts nothing for the rest of the song. Last, it pins **auditioning one note**: that the frames
handed to the driver are the ones `emitNote` would write for a note of that length, that the note is
played under the instrument and the `q` the song left standing rather than under a default, that a
channel the song never uses is still audible, and that the emulator is left exactly as it was found
— the caller's SPC image unwritten and the song rendering byte for byte the same afterwards, which
is what "a note can be auditioned while the song plays" rests on. Last of all, that the **mixer's
mask decides what is heard under the note**: the other seven voices are parked rather than halted,
so they play out the notes they hold at that tick, and the mask takes a whole channel out of that
rather than a corner of its echo. Pinned as levels — the chord under a note is heard, silencing one
of its three channels sits between silencing none and silencing all, and silencing all of them gives
back the note on its own — plus that a note auditioned into the last bar of the song still holds its
ticks, which is what says the parking kept a voice from walking the phrase table over the frames.
The tick the fast-forward reached does not move either, because `$5E` is still untouched. The target
channel's own bit is ignored, in both spellings: a note on a silenced channel is refused before an
emulator is asked for, and honouring the bit here would mute that voice and then unmute it at the
hand-over. It also pins **where the note is handed over**: on a tick the whole song fetches on,
every one of the eight channels is heard, hears the `@` written immediately in front of it, and keys
on once at its own pitch — reaching the tick is not the same as arriving at it, and a hand-over made
inside the driver's own per-voice walk gets a different answer per channel, since the walk runs 0 to 7.
The eight renders agree to a twenty-fifth of the signal overall and a five-hundredth past the
attack, which is a level rather than an identity for the reason the mask control gives. Last of all,
that a note carrying a `$DD` **slides**: the four bytes go where `emitNote` would leave them, so
where the driver arms the slide is decided by the frame the peek reads it in rather than by anything
predicting it — pinned as bytes for an arm at the head, an arm on a tie, an uneven one, a chunked
note, a note that goes on behind the four bytes because its tie was written after the command, and a
frame of one tick, which is written all the same and which the driver then never arms, the
read-ahead being skipped on every tick that fetches. It is pinned as **audio** by a zero-crossing
rate that is first calibrated on the same sample, by auditioning the two notes an octave either
side: without that control the rate says only that something changed, and `@8` would have failed it
— its sample is already pitched high enough that the DSP saturates above o4 and an octave up reads
the same as no slide at all. The direction is checked both ways for the same reason, and a slide's
rate has to fall short of its target's own, since a slide arrives rather than jumps. `delay` is
pinned with no measurement in it at all: three renders one operand byte apart, whose first differing
sample must come strictly later as it grows. And `afterTicks` — the reading the whole thing turns on
— holds the pitch still through the half of the note in front of the frame the peek reads it in,
where the same three bytes at the head have already moved it; while the ticks a note has _behind_
the arm move nothing at all, a slide counting off `$90`/`$91` once armed rather than off frames.
Operands no `emitNote` could have written are dropped rather than approximated, and the note comes
out byte for byte flat. And that a **checkpoint** changes nothing: a note auditioned from a frozen
emulator is the note auditioned from the top of the song, sample for sample, on three channels and
under a mixer mask, again off the same checkpoint, and off one that was itself run on from an
earlier one — with the three a checkpoint must not be resumed from (on the note's own tick, past
it, under another mask) falling back to the run from the top. An identity rather than a level,
because the two runs render the same blocks in the same order.

## Section files

`scripts/audiotest/main.ts` runs one section file per subject, in the order below, and `support.ts`
holds what they share: the driver, the one emulator instance every section loads its own SPC into,
`compileToSpc`, `renderMuted`, and the level and pitch measures. `HARNESS_ONLY=<file name>` runs one
section alone.

| File                     | What it pins                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sound.ts`               | The emulator boots, a compiled song makes sound, silence is silent, notes differ audibly, and fast-forward lands somewhere different.                                           |
| `muting.ts`              | Muting happens in the DSP and nowhere else: the driver never sees it, nothing the song writes undoes it, and the mix, the song's speed, a ringing note and unmuting all behave. |
| `pitch.ts`               | The DSP plays the pitch `@amk/spc/pitch` says: true, wrapped past `$4000` on `@0`, `@8` and a custom ×3.5, and silent past o7 b and below o1 c.                                 |
| `samples.ts`             | Sample sets through the emulator: `#samples`, a custom instrument, `optimizeSampleUsage` and a `.bnk` bank.                                                                     |
| `loop-and-ticks.ts`      | The loop lasts as long as the compiler says, the driver's ticks are counted exactly, and the voice the count is latched on is one the driver plays.                             |
| `note-map.ts`            | The note map lands on what the driver is playing.                                                                                                                               |
| `audition.ts`            | One note, auditioned where the song is playing.                                                                                                                                 |
| `audition-in-song.ts`    | An auditioned note with the rest of the song under it, and handed over on a tick the whole song fetches on.                                                                     |
| `audition-slide.ts`      | An auditioned note sliding as the `$DD` riding on it says.                                                                                                                      |
| `audition-checkpoint.ts` | A note auditioned from a checkpoint is the note auditioned from the top of the song, byte for byte.                                                                             |
| `voices.ts`              | Rendering a frame at a time is the same bytes as a block, audio and APU RAM; `VxOUTX` moves on a keyed voice only; a mute reads as volume 0.                                    |
| `analysis.ts`            | The Song Inspector's analysis: a lane per voice played, a mute that empties its lane and quietens the mix, samples on their SRCN, echo only where it is on, clipping counted.   |
| `render.ts`              | The `.wav` export: the song unchanged to the tick that ends its second loop, then a fade to a silent last frame; a song that does not loop rings out; the RIFF header.          |
