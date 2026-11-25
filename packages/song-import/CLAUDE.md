# @amk/import

Importers: another music format read and written out as AddmusicK MML. MIDI and tracker modules
(MOD, S3M, XM and IT) are what there are, and a UMX is unwrapped to the module it holds; older AddMusic SPCs and
other `.spc` rips are meant to join them as readers beside `midi/`, `mod/`, `s3m/`, `xm/` and `it/`, picked by `format.ts`'s `detectFormat`, which sniffs a file's signature rather than
trusting its name.

Depends on `@amk/core` (the MML spellers' tables, `DEFAULT_TRANSPOSE`, the velocity table) and on
`@amk/spc/instruments` and `@amk/spc/pitch` (the driver's stock instruments and where each stops
playing true), and nothing else — `eslint.config.js` holds it. It writes text, and for a module the
PCM of each sample planned for BRR; encoding, compiling, walking and playing the result is the
caller's. It returns **codes and values, never words**: a refusal is an `SmfError`, `ModError`,
`S3mError`, `XmError`, `ItError` or `UmxError` code and a warning an `ImportWarning` or `TrackerImportWarning`, which the Import dialogs word.

| Module                 | What it is                                                             |
| ---------------------- | ---------------------------------------------------------------------- |
| `format.ts`            | Which importer reads a file, and the SMF inside an RMID wrapper        |
| `midi.ts`              | `readMidi` (once per file) and `writeMidi` (once per option change)    |
| `midi/smf.ts`          | The Standard MIDI File reader                                          |
| `midi/performance.ts`  | Every track merged onto one time line: notes and GM controller curves  |
| `midi/parts.ts`        | A channel split into parts that play one note at a time                |
| `midi/channels.ts`     | `mml/channels.ts`'s packing by part id and part order                  |
| `midi/gm.ts`           | GM programs and drum keys matched to the stock instruments and drums   |
| `midi/write-mml.ts`    | The parts kept, written as an `#amk 4` song                            |
| `mml/lengths.ts`       | Note and rest lengths in driver ticks, spelled without AMK0200         |
| `mml/song-text.ts`     | `t` for a BPM, a polyline simplified to ramps, text for a `#spc` tag   |
| `mml/channels.ts`      | Which voices can share a channel, and packing them onto eight          |
| `tracker.ts`           | `findSongs`, `summarise` and `withSong`, and `writeTracker` per change |
| `tracker/model.ts`     | What every format's reader and player hand over: samples, ticks        |
| `tracker/samples.ts`   | Resampling, loops onto BRR blocks, the tuning, the factor that fits    |
| `tracker/write-mml.ts` | The channels kept, on custom instruments, as an `#amk 4` song          |
| `mod.ts`               | `readMod`: a MOD read, played and summed up for the dialog             |
| `mod/file.ts`          | The MOD reader: signatures, patterns, sample headers                   |
| `mod/play.ts`          | The song played tick by tick as ProTracker plays it                    |
| `s3m.ts`               | `readS3m`: an S3M read, played and summed up for the dialog            |
| `s3m/file.ts`          | The S3M reader: the header, parapointers, packed patterns, samples     |
| `s3m/play.ts`          | The song played tick by tick as Scream Tracker 3 plays it              |
| `xm.ts`                | `readXm`: an XM read, played and summed up for the dialog              |
| `xm/file.ts`           | The XM reader: patterns, instruments, envelopes, delta-coded samples   |
| `xm/play.ts`           | The song played tick by tick as FastTracker II plays it                |
| `it.ts`                | `readIt`: an IT read, played and summed up for the dialog              |
| `it/file.ts`           | The IT reader: packed patterns, samples, compression, instruments      |
| `it/play.ts`           | The song played tick by tick as Impulse Tracker 2 plays it             |
| `tracker/pingpong.ts`  | A ping-pong loop laid out forward, as a BRR loop runs                  |
| `umx.ts`               | An Unreal package unwrapped to the module its Music object holds       |

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
channels rather than eight parts. `mml/channels.ts` decides which may, for a tracker module's
channels as well (Tracker modules, Writing), and `midi/channels.ts` puts it in part ids: `clashes`
(computed once, in `readMidi`) marks two parts that cannot, and a pair clashes where a note of one would cut a note of
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

## Tracker modules

Every format is read by its own reader and played by its own player, which records what each channel
sounds on every tick in `tracker/model.ts`'s terms: the sample sounding, its pitch in semitones
from the sample's reference note (MOD C-2, S3M and XM C-4, IT C-5), the volume of 64, the pan, the
key-ons, the vibrato's and the tremolo's phase step and swing, and the arpeggio's steps. A sample
is 16-bit PCM and `baseHz`, the rate it plays at on the reference note. From there the planner and
the writer serve every format alike, and only the reader and the player know a format's units.

### MOD: reading

`mod/file.ts` follows OpenMPT's `Load_mod.cpp`: the four bytes at 1080 name the channel count
(`M.K.`, `xCHN`, `xxCH`, `CD81`, `OKTA`, `TDZx` and the rest), FLT8 stores eight channels as two
four-channel patterns with its orders doubled, and the pattern count is the highest of all 128
order entries, the song's own orders only where the file is too short for that. A loop under four
bytes is no loop, and a loop start some trackers wrote in bytes is halved where only the half fits.
A 15-sample Soundtracker file has no signature, so it is refused rather than guessed at. A file cut
inside its samples keeps what is there. ProTracker's period limits apply only to a 4-channel
`M.K.`/`M!K!`/`PATT` file whose notes stay in the Amiga's range.

### MOD: playing

`mod/play.ts` plays the song tick by tick as 8bitbubsy's `pt2_replayer.c` does: tick 0 reads the
row and runs 9, B, C, D, F and the E commands, the later ticks the slides, the vibrato, the tremolo
and the arpeggio; Bxx and Dxx (in BCD) move the order, E6x loops rows, EEx repeats one, EDx strikes
late. It records each tick in the model's terms, the period as semitones from the sample's C-2 at
its finetune and the vibrato's period swing as semitones at the period it plays at, and stops at the first row it comes back to outside a pattern loop, which is the
song's loop point; running off the end loops to the restart order. A one-shot sample ends where its
frames run out at the period and tempo it plays at. 9xx, E3x, EFx and a note delay past its row are
counted rather than played, 9xx because AddmusicK plays a sample from its start.

### Songs

A module can hold several songs: a game's, entered at an order of its own for each scene (Deus Ex's
first orders each jump into a loop of their own), or ones listed between `---` markers. Every
player takes the order to start at, and `findSongs` (`tracker.ts`) finds them as libopenmpt finds
subsongs: played from the first order, then from each first order no song before has played, a
later one kept only where it strikes a note. A song that runs off its end loops to its own start
where it never reached the restart order. Each song's play is kept, `summarise` sums up the chosen
one, and `withSong` switches; the samples are the module's whichever is chosen.

### Samples

`tracker/samples.ts` plans each sample's PCM for BRR at a factor. A BRR loop starts on a 16-frame
block and runs to the end, so the loop is resampled to whole blocks, the factor nudged to make that
exact (`plannedFrames`), silence put in front so it starts on a block, and what follows the loop
dropped. A loop under a block at the factor is laid end to end until it fills one, so the factor
stays where it was asked (`loopRepeats`). The resampler is a Blackman-windowed sinc whose
cutoff follows the factor and which reads the loop round past its end, and at a factor of 1 the
frames are copied. `fitFactor` bisects the largest factor every Auto sample can share in a room.
`tuningFor` picks the instrument's multiplier and the octave the reference note is written in by trying each
against every key the song plays on the sample: `SetPitch` shifts its table value before it
multiplies, so low keys lose bits and a small multiplier is coarse, and the choice that is worst
on fewest cents wins, one that leaves notes outside o1 c-o6 a or the DSP's fourteen bits losing to
one that does not. Each is judged after the upward shift a channel's `$EE` can give it, up to
`FINE_TUNE_CENTS`, since that shift is far finer than a small multiplier's step: a tuning a little
flat is as good as exact once the fine tune lifts it. The encoding itself is the caller's (`@amk/spc/brr-encode`).

### Writing

`tracker/write-mml.ts` writes an `#amk 4` song: `#samples` with `#default` (or `#optimized`, `TrackerSongOptions.optimized`) first, then each sample the
kept channels play, and `#instruments` giving each `$FF $E0 $7F` and its tuning at `@30` up.

- **Two driver ticks to a tracker tick**, so the module's BPM is the song's quarter-note BPM (`t` is
  BPM × 0.4096 − 1) and a row at speed 6 a sixteenth; per-tick effects stay exact.
- **A note** lasts to the next key-on, its sample's end or a silence that lasts, tied through, and is
  struck again at the loop point, unless it has fallen silent by then for good. Its key is the reference note's plus its semitones, folded by octaves into what
  the instrument plays true.
- **Sharing.** With `share` (`TrackerSongOptions.share`), channels whose notes never overlap at all
  take turns on one of AddmusicK's: `summarise` computes `clashes` once with no slack, every sample
  played, and `packChannels` lays the kept channels out first-fit. A tracker note already ends where
  it stops sounding, so there is no hand-over to trim. A shared channel's channels are merged into one
  `ChannelTicks`, each tick taken from the channel whose note covers it (`mergeChannels`), and written
  as any channel is, since the writer already states `@`, `v`, `y`, vibrato, tremolo and `q` wherever
  the next note needs them. Dropping a sample only takes notes away, so the clashes stay true; the
  loop point never adds one, since a note struck again there into silence is no note.
- **Volume** is `v` = 255 × √(vol / 64), since the driver squares it (`L_124D`), and a slide is
  simplified to `vD,N` fades. **Pan** is `y`, the module's pan narrowed by the separation.
  **Pitch** within a note is simplified to ramps written as `$DD` after the piece each starts in,
  under the same frame rules as the MIDI writer's. **Vibrato** is `$DE` at the player's phase step over
  two and the swing it recorded, and `$DF` where it stops. The swing is room the tuning leaves either
  side of the note, and a note still at the edge, which the swing would carry below o1 c or past what
  the instrument plays true, has its vibrato left off (`vibratoIn`, `SST0514`).
- **Tremolo** is `$E5`, written only in front of a key-on, since its read-ahead counts its
  arguments one short (COMMANDS.html, `$E5`) and anywhere else it can key a held note off. A note
  takes the first tremolo its rows run, from its key-on; it is raised to the top of the swing,
  because the driver's tremolo only takes volume away, and the amplitude is capped at `$C5`, where
  the stray read would take it for a tie. `$FD` turns it off in front of a note without one.
- **Arpeggio** is `$FB` under legato. Toggling `$F4 $01` on clears the voice's keyed bit, so the
  note's own key-on sounds, and every key-on after it is held back while legato lasts
  (`main.asm:2517-2530`), so the steps move the pitch and leave the sample playing. Where the module's
  arpeggio stops, the note becomes an arpeggio of itself (`$FB $01`), which brings the pitch home;
  a tracker tick before the note ends the arpeggio and legato are turned off, so it keys off as any note
  does and legato never crosses a loop point. A note one tick long, or one whose steps go past what
  its sample plays, keeps its base pitch and is counted.
- **Fine tune.** Each channel takes the `$EE` that brings its notes nearest their pitch on the whole:
  256ths of a semitone under every note (`main.asm:434-435`), upward only.
- **Cuts.** The text is written one pass through an order at a time, each with its octave stated
  afresh, so a pass's text depends only on the driver state it starts under. A pass that comes round
  again in the same state is a label loop (`(n)[ … ]`, then `(n)` or `(n)k`), unless it or the pass
  after it opens on a tie, which a loop's body cannot start or end on. `/` and the song's start
  state the next note's settings ahead of everything (`SST0511`).

`modtest`, `s3mtest`, `xmtest` and `ittest` pin all of it against the compiler and the walk, and seeded busy songs at
several factors against the editor's diagnostics.

## S3M

### Reading

`s3m/file.ts` follows OpenMPT's `Load_s3m.cpp`: `SCRM` at 44, the order list, then parapointers
(offsets over 16) to each instrument and pattern. A pattern is 64 packed rows, each cell a byte
naming its channel and what follows (32 a note and an instrument, 64 a volume, 128 a command), and
a 0 ending the row. Channel settings under 16 are the PCM channels kept, in file order; AdLib and
disabled channels are left out, and an AdLib instrument has no PCM. Samples are 8- or 16-bit, signed
or unsigned (header byte 42), a stereo one mixed to mono, its loop held to its frames; a C2SPD of 0
plays at 8363 and one past 16 bits is kept as Impulse Tracker writes it. The panning is OpenMPT's,
since ST3 on a Sound Blaster pans by channel alone: each channel's side, the pan table where byte 53
is 252, all centred in a mono song.

### Playing

`s3m/play.ts` follows 8bitbubsy's `st3play`. Tick 0 reads the notes (`doamiga`) and runs the
once-a-row commands (`docmd1`), the later ticks the rest (`docmd2`); most commands share one
remembered info byte per channel, H and U another, G and L a third. A period is
`notespd >> octave × 8363 / C2SPD` and plays at 14317056 / period Hz, which the model records as
semitones from the sample's C2SPD, its C-4 rate. Dxy's fine slides run on tick 0, its normal ones on
the later ticks, and on tick 0 too with header flag 64 or a file saved by ST3.00; E and F slide in
ST3's period units, fine and extra fine on tick 0; SBx loops rows for the whole song, SEx repeats a
row's ticks without its notes, SDx strikes late, Qxy strikes again with its volume change, SCx and
`^^` cut. The volume is the channel's 63 under the global volume's 256ths (`setvol`), Vxx taking
hold from the tick after its first. Oxx, S1x, a note delay past its row and a note on an AdLib
instrument are counted rather than played.

## XM

### Reading

`xm/file.ts` follows 8bitbubsy's `ft2_load_xm.c`. The header's size field says where the patterns
start; a pattern's cells are packed, a byte with bit 7 set naming which of note, instrument,
volume, effect and parameter follow. Version 1.04 stores the patterns and then each instrument's
header beside its samples' data; 1.02 and 1.03 store every instrument header, the patterns, then all
the data. An instrument header of size 0 is 263 bytes. Samples are delta-coded, 8- or 16-bit, their
lengths in bytes; a ping-pong loop is laid out forward and back (`unrollPingPong`), since a BRR loop
runs one way. Every instrument's samples are numbered in one list, so each is an instrument of the
song, and an instrument's keymap says which plays each note.

### Playing

`xm/play.ts` follows `ft2_replayer.c`. Tick 0 reads the row (`getNewNote`, with its order of tone
portamento, K00, an instrument alone and a note) and runs the volume column's and the effects'
tick-zero work; the later ticks the rest; EEx replays the row with the later ticks' work only;
`getNextPos` moves on, E6x's break row left standing as FT2 leaves it. Periods are FT2's: linear,
`(1936 - index) × 4`, 64 to a semitone, at `8363 × 2^((4608 - period) / 768)` Hz, or Amiga, 1712 at
C-4, at `8363 × 1712 / period`; a sample's C-4 rate is 8363 Hz moved by its relative note and
finetune. The volume recorded is the note's volume under the global volume, the fadeout after a
key off and the volume envelope, stepped as `updateVolPanAutoVib` steps it; the pan is the panning
envelope's. FT2's arpeggio counts down the ticks left in the row, so its steps come y before x,
and it is recorded that way round. The auto-vibrato is recorded at its full depth where no vibrato
command runs, its sweep not followed. 9xx, E3x, Lxx and a note delay past its row are counted.

## IT

### Reading

`it/file.ts` follows 8bitbubsy's `it2play` (`loaders/it.c`). The header holds 64 channel pans
(+128 disabled, 100 surround) and volumes, then the order list and file offsets to each
instrument, sample and pattern. A pattern's rows are packed per channel, a mask saying which of
note, instrument, volume and command follow and which repeat the channel's last; the channels kept
run to the last any pattern uses. Samples are 8- or 16-bit, signed or unsigned, stereo mixed to
mono, or compressed as IT 2.14 compresses them (`decompress8`, `decompress16`, ported bit for bit:
blocks of 0x8000 bytes of output, each value a delta at a width escape codes change) and, with
convert bit 4, as 2.15 does, the values summed again. A BRR sample has one loop, so the loop is
taken, or the sustain loop where there is none; a ping-pong one is laid out forward. Instruments
of the format before 2.00 are refused (`old-instruments`): every IT example uses the later one.

### Playing

`it/play.ts` follows `it2play`'s `it_music.c` and `it_m_eff.c`. Tick 0 reads the row's notes and
runs each command's init, the later ticks those that run on. D, K and L share a memory, E, F and G
another (G its own with the compatible-Gxx flag). Frequencies are Hz: a note plays at
`C5Speed × 2^((note - 60) / 12)`, which the model records as semitones from the C5Speed, and slides
by 768ths of an octave, or as an Amiga period (`1712 × 8363 / Hz`) would without linear slides. The
volume recorded is the note's under the channel volume, the sample's and instrument's global
volumes, the volume envelope, the fadeout and the global volume; the pan takes the panning
envelope and the separation, the pitch the pitch envelope at half a semitone a step. An envelope
loop plays its end and its start a tick each, as `UpdateEnvelope` does. A note off in sample mode
stops a sample that has no sustain loop; in instrument mode it releases the envelope and fades the
note. One voice plays on a channel, so a New Note Action that would keep the old note sounding is
counted; so are panbrello, the S7x envelope switches, Oxx and a note delay past its row.

## UMX

`umx.ts` follows OpenMPT's `UMXTools.cpp`. An Unreal package names its name, import and export
tables in a 36-byte header, and every count and index in them is a compact index. Fields come and go
with the package version: a name has a length in front from 64, an import or export entry has a
4-byte package from 60, an object's data has 8 and 16 bytes in front below 40 and 60, and what sits
between its property list and its payload differs at 62, 100 and 120 (62 rather than Unreal's own
63, for Mech8.umx and others). The first export whose class is `Music` and whose bytes are a tracker
module is taken, and the module's format is read from its signature, since the name a package gives
it can be wrong. Music that is recorded audio (MP2, Ogg, WAV) has no notes and is refused as
`audio`. The tracker dialog reads any of the four formats unwrapped and names the format it refuses.
`modtest`'s `umx` section builds packages at each version's layout.
