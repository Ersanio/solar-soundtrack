---
paths:
  - 'scripts/audiotest.ts'
---

# `audiotest`: what it proves

MML → SPC → actual PCM through the real wasm host. **This is what proves the whole pipeline**: a
wrong compiler, layout, sample directory or CPUIO handshake produces silence. It also pins that **muting
does not change how fast the song plays**: the mixer takes a voice's volume and leaves `$5E` alone,
because disabling a channel makes the driver's main loop cheaper and a song at the one-tick-per-pass
ceiling turns that into a 29% speed-up. Checked on eight channels at t254, where an easy song shows
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
emulator is asked for, and honouring the bit here would take that voice's volume and then hand it
straight back. It also pins **where the note is handed over**: on a tick the whole song fetches on,
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
out byte for byte flat.
