# @amk/import

Importers: another music format read and written out as AddmusicK MML. MIDI is the one there is;
older AddMusic SPCs and other `.spc` rips are meant to join it as readers beside `midi/`, picked by
`format.ts`'s `detectFormat`, which sniffs a file's signature rather than trusting its name.

Depends on `@amk/core` (the MML spellers' tables, `DEFAULT_TRANSPOSE`, the velocity table) and on
`@amk/spc/instruments` and `@amk/spc/pitch` (the driver's stock instruments and where each stops
playing true), and nothing else — `eslint.config.js` holds it. It writes text; compiling, walking
and playing the result is the caller's. It returns **codes and values, never words**: a refusal is an
`SmfError` code and a warning an `ImportWarning`, which the Import dialog words.

| Module                | What it is                                                            |
| --------------------- | --------------------------------------------------------------------- |
| `format.ts`           | Which importer reads a file, and the SMF inside an RMID wrapper       |
| `midi.ts`             | `readMidi` (once per file) and `writeMidi` (once per option change)   |
| `midi/smf.ts`         | The Standard MIDI File reader                                         |
| `midi/performance.ts` | Every track merged onto one time line: notes and GM controller curves |
| `midi/parts.ts`       | A channel split into parts that play one note at a time               |
| `midi/channels.ts`    | Which parts can share a channel, and packing them onto eight          |
| `midi/gm.ts`          | GM programs and drum keys matched to the stock instruments and drums  |
| `midi/write-mml.ts`   | The parts kept, written as an `#amk 4` song                           |

## Reading

`smf.ts` reads SMF 1.0: `MThd` (format 0 or 1; format 2 is refused), then every chunk, of which only
`MTrk` is read and the rest skipped whole. Running status carries across delta times and is cancelled
by a meta or sysex event. A file cut short keeps what was read before the cut and names the track.

`performance.ts` plays the merged events through each channel's GM state: program and bank, CC7 ×
CC11, CC10, CC1, CC91, the sustain pedal (which holds key-offs back until it lifts), RPN 0 bend range
and RPN 2 coarse tune, pitch bend, CC121 and all notes off. A key struck again while it sounds ends
the note before it. Channel 10 is the kit; a GS rhythm-part sysex or XG's drum bank makes another
channel one, and GS can turn channel 10 back. Loop markers are CC111 or a `loopStart`/`loopEnd`
marker or cue. Times stay in the file's ticks until the writer.

## Parts

AddmusicK's channel plays one note at a time, so `parts.ts` splits each MIDI channel into voices.
The notes struck within a 64th of each other are a chord, and a chord is matched to the free voices
top note to top voice without crossing them (`match`, a small dynamic programme): of the matchings
that keep the order, the one that moves the voices least, a new voice opened only where no free
one is left. So a chord's lines keep their rank from chord to chord, a melody and a bass played on
one channel each keep a voice, and a texture of ten makes ten parts and no more. A voice is free once
its last note has ended, less an allowance of a 64th or half the shorter note, so a legato line
stays one part. A kit is split by family first — kick and snare, hi-hats and cymbals, toms and hand
percussion — and then by hits struck together, each hit taking the first free voice of its family
and holding it for that 64th. The porter's drum map (`SongOptions.drums`) is applied by the writer, so
it changes what a key is played on and never which family or part it lands in. A part's `id` stays the same however the options change, so the
dialog's choices survive a new grid. The suggestion keeps every channel's and every family's first
voice before any second one, so each instrument is heard, and the parts that sound the most within
that.

## Sharing a channel

With `share` on, parts that never sound at once take turns on one channel, so the limit is eight
channels rather than eight parts. `channels.ts` decides which may: `clashes` (computed once, in
`readMidi`) marks two parts that cannot, and a pair clashes where a note of one would cut a note of
the other short. Only a hand-over may overlap — the later note starting within a 64th of the
earlier one's end and outlasting it, which the writer trims as it trims a legato line. A note inside
another, two struck together, or any overlap with a drum hit is a clash. `packChannels` puts each
kept part, in part order, on the lowest channel holding nothing it clashes with, so keeping or
dropping one part moves as few others as it can; `fits` is whether that comes to eight or fewer.
`suggestedShared` and `addWhileFits` take parts in the suggestion's priority while they still fit.

The writer plans each part as it would alone — its own instrument, octave shift, folding and slides
— and `mergePlans` lays a channel's parts out as one stream of notes: a note running into the next
part's is trimmed to meet it, with its pieces and slides cut to what still fits (`trimTo`). Nothing
else is needed at a hand-over: `ChannelText` already writes the instrument, volume, pan, vibrato
and `q` wherever the next note needs them, so the `@` switch and its settings come for free. A
channel takes the echo when any of its parts sends reverb, and its `#N` line names every part on
it.

## Writing

`write-mml.ts` turns the file's quarter note into the driver's 48 ticks and snaps both ends of every
note to the grid. Then, per part: no two notes start together (the later is dropped and counted),
none runs into the next, and a drum lasts until the next hit or a half note. A note across the loop
point is struck again there.

- **Pitch.** The written key is the MIDI key (60 is `o4 c`), with the bend in force at the key-on
  folded in. The part is moved by whole octaves to where most of it fits its instrument's range
  (`keyRange`: o1 c to o6 a, less the instrument's `DEFAULT_TRANSPOSE` and its `highestTrue`
  ceiling), and what is still outside is folded note by note.
- **The bend inside a note** is simplified to ramps (RDP at half a semitone), and the note is cut
  into tied pieces at the ramps' starts, each moving piece followed directly by `$DD $00 dur target`.
  The driver only picks a `$DD` up while the frame in front of it plays at least two ticks and the
  slide before has finished, so a moving piece is one frame (under `$80` ticks), at least three
  ticks, and its slide two shorter than it. A slide that cannot fit, or whose target the instrument
  cannot reach, is left out. The target byte has the instrument's transposition taken off, as the
  compiler takes it off a letter.
- **Commands at the key-on**, each only when it changes: `@` (always, before a drum: on #0-#5 the
  compiler forgets a drum after one hit), `v` from CC7 × CC11 and `vD,N` where the curve moves under
  the note, `y` from CC10 reversed and `$DC` likewise, `$DE` vibrato from CC1 at about 5.5 Hz (left
  off a note at the edge of its range, which the swing would leave), and `q7X` from the velocity.
- **Song-wide.** `w255` and the first `t` open the first channel; later tempos are `t` on that
  channel at their tick, tying a held note across one. CC91 on any kept part is one `$EF`/`$F1` on
  the channels that send it. A loop marker is `/` in every channel, with the tempo restated after
  it.
- **Every channel is padded with rests to the same end**: the bar after the last note, or the loop
  end. A channel left shorter would come round early on every repeat.
- **What the repeat starts under.** In front of the first rest, and right after `/`, the channel
  states the next note's instrument, volume, pan, vibrato and `q`, so the repeat does not inherit
  what the end of the pass set (`SST0511`). `@21`-`@29` emit no byte, so a kit states `@0` there.
- **Lengths** are `spellTicks`/`spellRestTicks`: a dot only where it halves exactly, `=ticks`
  otherwise, since a dot that halves an odd count is AMK0200.

`miditest` pins all of it against the compiler and the walk, and a seeded busy song at every grid
against the editor's diagnostics.
