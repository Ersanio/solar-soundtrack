# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## What this is

Solar Soundtrack — a browser-based AddmusicK 1.0.11 MML editor. It compiles MML to N-SPC song data,
assembles a playable `.spc`, and plays it through an emulated SPC700, entirely client-side. No ROM,
no AddmusicK install, no server.

## Layout

An npm workspace. **Every command runs from the repository root.**

```
packages/core/          @amk/core      types, AddmusicK's tables, hex
packages/mml-compiler/  @amk/compiler  preprocess -> parser -> link
packages/mml-tokens/    @amk/tokens    scanner, splices, command model
packages/spc/           @amk/spc       BRR, echo FIR, ARAM, emulator, worklet
web/                    the Angular editor
scripts/                fourteen byte-level harnesses
```

```
@amk/core      → nothing
@amk/compiler  → core
@amk/spc       → core
@amk/tokens    → core, and @amk/spc/{adsr,fir}
web            → all four
```

Each package has a `README.md` and that is where the long explanations live — the port's citation
convention, why the driver is observed rather than predicted, what the scanner can and cannot mirror
from the parser, what the harnesses actually prove. Read the one for the package you are changing.

`AddmusicKsrc/` and `AddmusicKreadme/` hold a local copy of AddmusicK 1.0.11's C++ sources and its
readme. They are **gitignored and not part of the repository**, but they are the reference
implementation this project is a port of and the code cites them constantly — take them from an
AddmusicK release if they are missing.

## Commands

Node 24 is what CI uses. CI runs `npm run lint` then `npm run check`.

| Command             | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `npm start`         | Dev server on `http://localhost:4200/`.                               |
| `npm run build`     | Production build into `web/dist/`.                                    |
| `npm run watch`     | Dev-configuration build with `--watch`, no server.                    |
| `npm run lint`      | ESLint over every workspace.                                          |
| `npm run format`    | Prettier over the workspace.                                          |
| `npm run typecheck` | The app. `:packages` and `:scripts` cover the rest.                   |
| `npm run check`     | The merge gate: formatting, three typechecks, all fourteen harnesses. |

`npm run check` does **not** compile Angular templates, and neither does `npm run typecheck` — `tsc`
does not run the template compiler, so a bad binding (`viewBox=` instead of `[attr.viewBox]=`)
passes `check` and fails only at `npm run build` / `npm start`. Run one of those before believing a
UI change.

### Automatic pre-hooks

Never invoke these by hand. `prestart` / `prebuild` / `prewatch` in `web/package.json` run the first
two and the third; `pretypecheck` there and `prelint` at the root run `generate-git-info` alone,
which is all either needs:

- **`build:worklet`** — `@amk/spc`'s own build; esbuild bundles `worklet.ts` into
  `assets/player/spc-worklet.js` (generated, gitignored). An AudioWorklet is loaded by URL from the
  audio thread, so the Angular builder cannot produce it as part of the app bundle.
- **`sync-spc-assets`** — mirrors `packages/spc/assets/` into `web/public/`. The Angular builder
  refuses an asset path outside its own workspace root; the copies are gitignored and
  `packages/spc/assets/` is the only source of truth.
- **`generate-git-info`** — writes `web/src/app/git-info.generated.ts` for the top bar's commit link
  (generated, gitignored). Captured once at startup, so it goes stale if you commit while
  `npm start` is running; restart to refresh.

### Tests

There are no `.spec.ts` files, and no `npm run test` — the suite is the fourteen harnesses under
`scripts/`; **`scripts/README.md` says what each one proves**,
and several of those assertions are load-bearing in ways that are not obvious from the name.

`scripts/Compare-Spc.ps1` and `scripts/Compare-SongBin.ps1` diff output against a real AddmusicK
build. Those are what establish fidelity; the harnesses only catch gross breakage.

## Rules

**The port cites its source.** Around 350 comments reference `Music.cpp:3209`, `AddmusicK.cpp:1138`,
`globals.cpp:735`, `main.asm` and so on, against AddmusicK 1.0.11 in `AddmusicKsrc/`. Read the cited
lines before changing compiler behaviour, and cite the lines you port. Behaviour that looks strange
is almost always strange in the original too — reproduce it and say so in a comment.

**The compiler is not permissive.** A song written here is going into AddmusicK, so a divergence in
either direction is a bug: accepting what AddmusicK rejects means it compiles, plays, and then the
real tool refuses it; rejecting what AddmusicK accepts means a working song is turned away. Where
AddmusicK is case-sensitive, so is this — `#Title`, `"kick.BRR"` and `#DEFINE` are all errors, and
`#SAMPLES` is not, because `strnicmp` is what the reference uses there. Convenience is never a
reason to widen what is accepted, and neither is helpfulness a reason to narrow it: an unknown
`#directive` is read as music and `*` with no previous loop emits a call to nowhere, because that is
what the reference does. `packages/mml-compiler/AUDIT.md` is the record of the last line-by-line
comparison.

**`#path` is the one deliberate divergence, and the bar it had to clear is high.** It is read,
validated and applied to nothing (`parsePath`, `SST0504`), because the reference behaviour has
nothing to mean here: `basepath` is a directory prefix resolved against a filesystem, and the host's
library is one flat list of filenames matched verbatim, so a prefixed name resolves to nothing and
every sample under a `#path` fails with AMK0058. That is not the same as finding the reference
unhelpful — the two constructs above are unhelpful and were kept. Nothing else earns this: a second
divergence needs the reference behaviour to be undefined here, not merely inconvenient.

**`packages/mml-compiler` is not linted, and its comments are not thinned.** It is a port, and style
rules would make it harder to diff against the C++ that is the only check on its faithfulness. It
gets one ESLint rule, an import boundary. Prettier still runs.

**Comments describe the code as it is, not as it was.** No "it used to", "this replaced", "which is
where it was", "the bug this exists to fix", "before this existed". A comment that says "it was once
X, and X was wrong because Y" has one useful sentence — the present-tense reason for the shape it has
now — and the rest is history: state the reason and stop, or state Y as a plain counterfactual ("a
spread would take whatever is in storage on trust"). Harness comments say what is pinned, not what
once broke. This applies to the READMEs too. The git log holds what changed; a shape that was moved
away from and is worth not proposing again goes in "Decisions already made" below, in the same
change, and nowhere in the source. (`AUDIT.md`, the changelog and `.git-blame-ignore-revs` are
records by genre and are outside this.)

**Package boundaries are a lint rule.** npm links every workspace into `node_modules/@amk`, so
TypeScript resolves a sibling package however the tsconfigs are written; `no-restricted-imports` in
`eslint.config.js` is what actually holds the graph. Adding an edge means changing that rule
deliberately.

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

**`sampleList: null` is not `[]`.** `null` means the compiler had no opinion and the driver's default
set stands; `[]` means the song genuinely asks for no samples. The list's _order is the SRCN
assignment_, so building an SPC against a different set produces a valid-looking file that plays the
wrong sounds. It is a correctness-critical output, not a statistic.

**Diagnostics carry source spans and stable codes**, and are carried on failure paths too, so
partial UI stays populated. **The prefix says whose finding it is, not which file raises it**:
`AMK####` is a condition AddmusicK itself reports, ported from `AddmusicKsrc/` with the `Music.cpp`
line cited; `SST####` is one `Music.cpp` does not produce at all, so a porter is never told
AddmusicK objects to something it has no opinion about. The echo hazards, the unreachable-channel
warning, the tempo shortfall, the `#path` notice and the runaway-replacement guard are `SST05xx`,
which is also where a finding goes when the reference does not _finish_ rather than not object:
`SST0505` bounds a replacement that expands into itself, and AddmusicK grows its buffer forever on
the same song, so there is no run to be faithful to and nothing to divide with `#path`. `SST0301`
guards `compile()`'s own ARAM argument. A new diagnostic takes the prefix
of the tool that found it. Spans are mapped back to the source the author wrote — `spanAt` is the
single choke point, and anything that bypasses it will be wrong. Constructs this compiler does not
implement are reported as errors, never silently mis-compiled.

**This project ships no ARIA attributes and no `role` or `tabindex`.** Accessibility is deferred,
not attempted-and-abandoned, so half of it is worse than none: the tab strip used to point
`aria-controls` at ids that no longer existed. `angular.configs.templateAccessibility` is therefore
absent from the template lint block, and the "Accessibility Requirements" section of
`web/.claude/CLAUDE.md` does not apply here — that file is generated by the Angular CLI and is kept
byte-identical to what the CLI emits, so the override is stated here instead. The global
`:focus-visible` outline is a different concern and must not be removed by components.

**The changelog is part of the feature.** `web/src/app/changelog/changelog-data.ts` backs the top
bar's changelog popup. A commit that adds or materially changes a user-facing feature adds its entry
**in the same commit** — a new block at the top of `CHANGELOG` if the date is new, otherwise one more
string in the existing block for that date.

Write for **music porters, not developers**, and keep it to a short phrase naming the feature:
"Sample browser & importer", not a sentence about how it works. How something is implemented never
belongs here, however interesting. Refactors, internal work and small fixes get no entry at all. It
is hand-written and must never be generated from commit subjects, which are not written for users.

## Decisions already made

Shapes this code has had and moved away from. Here rather than in comments so they are on record
without sitting in the source — the code says what it is; this says what it is not going back to.
One entry each: what it was, what it is, why.

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
- **Parking the roll in an `effect` on the follow flag** — an effect runs after the handler and
  overwrote a position set in the same gesture that came off the song. Parking happens where the
  following stops, which is `setFollow` and the pull's first frame.
- **Seeking the roll by `Shift`+wheel, committed on a 200 ms quiet timer** — nothing on screen said
  the roll could be seeked at all, and the commit fired on a guess about when the gesture had ended
  rather than on anything the porter did. The scrub bar over the roll is the affordance, and a
  pointer-up is a real end.
- **One bar over the roll doing both jobs** — a drag on the song-wide bar panned the camera and
  seeked the song at the end of the same gesture, so neither could be done alone: no way to look
  ahead without moving the music, and none to move the music without moving the view. Two bars, one
  job each — the overview scrolls (`roll-overview/`), the scrub bar seeks (`roll-scrub/`) — and a
  scrub reaches past the pane by pulling the view along rather than by being song-wide, since a
  timeline drawn in the roll's own coordinates is what puts the marker's tip on the playhead line.
  The preview stays out of the camera for the same reason it is a preview at all: `playTick` reads
  `songHead` and not `headTick`, or the music would slide sideways under the pointer and the marker
  would snap back to `lead` the moment it was grabbed.
- **`w-full` on the bars over the roll** — the pane is measured inside its vertical scrollbar
  (`elementSize` reads the content box) and the bars are drawn outside it, so the `viewBox`
  stretched over that gutter while the pointer maths did not, and the drawn window disagreed with
  the tick under the pointer by about a scrollbar's width. Both are `[style.width.px]="width()"`,
  which is the roll `<svg>`'s own width, so one user unit is one CSS px in one shared space.
- **Template method calls per row** — the sample browser decoded 64 BRR samples on every
  change-detection pass, ten times a second while playing. Panels build one `computed` view model;
  the `no-call-expression` note in `eslint.config.js` says why lint cannot catch it.
- **Muting by writing the driver's `$5E`** — a disabled channel does less work per tick, so a busy
  song sped up. The mixer takes track volume and leaves `$5E` alone (`applyChannelMutes`).
- **Roll rows on the emitted note byte** — `@2 o5 g` drew on o5 d, which is neither what was written
  nor what sounds (the five semitones cancel the sample's tuning), `h` used as the readme's "Tune"
  moved every note off the letters in the source, and no edit could map a byte back to text. Rows
  are the written pitch (`NoteAddress.written`); what a note plays as is a tooltip line. No "as
  played" toggle either: an honest one is not computable, since a sample's root is not in the data.
- **A single click on a roll bar revealing the source** — it threw the author onto the Source tab
  on every glance at a note. A click asks the inspector about that note and a double click goes to
  it; `reveal` carries a `show` flag for the difference.
- **A component element inside the roll's `<svg>`** for the command glyphs — `<amk-command-icon>`
  written there is an unknown SVG element, so it has no layout box and neither it nor its children
  render, silently. The glyph is an attribute component on a real `<svg>` (`svg[amk-glyph]`), and its
  template's elements carry the `svg:` prefix because Angular takes an element's namespace from its
  parent in the same template and that template has no `<svg>` of its own. `palettetest` greps for
  both.
- **Answering "which commands act on this note" from the source alone** — it is right until a `[ ]`
  body or a `(1)n` call plays one run of bytes twice, and then it is confidently wrong with no tell.
  The walk names them by address and `commandMap` maps that back to text; the source answers only
  `q`, `h` and `@21`-`@29`, which emit nothing to address and which the compiler resolved in source
  order anyway. No fallback to a guess when there is no walk, either: an approximate list that looks
  like the exact one is worse than an empty one.
- **Auto-scaling the bend graph to the further end of the bend** — one semitone and two octaves drew
  the same shape. The reach is a fixed octave, stepped by whole octaves.
- **A tone slider in the FIR designer** over `designTone` — a worse route to the presets it
  generates; `Warm`/`Dark`/`Bright` are its output.
- **A 1024-frame render block in the worklet** — a tick counter that only looks every 1024 frames
  drifts. 32 frames costs ~4% and keeps the count exact.
- **`Command.channel` left `undefined` above the first `#N`** — every same-channel scan read it as
  "no channel", so a `q` or a `$F1` written above `#0` reached nothing and the roll's glyphs, the
  echo hazards and the FIR designer all missed it. It is the starting channel — the lowest `#N`
  declared anywhere, 0 without one — because that is where `detectStartingChannel` starts writing
  (Music.cpp:385-400); `parseTimeInForce` reads the markers themselves for the one thing a channel
  number cannot see, `h` being reset by a `#N` that re-enters its own channel.
- **Naming a note's drum `@` from the note's own text** — the last `@21`-`@29` written before it on
  its channel. Right until a `[ ]` works on a copy of the remap, the first drum note clears it, a `*`
  or `(1)n` replays the drum byte, or another channel calls it — and wrong in both directions then,
  with the bar still drawn on the drum's lane. The walk names the note whose byte loaded the drum
  (`WalkNote.drumFrom`), `parseTimeInForce` says which `@` was folded into _that_ note, and
  `commands-in-force.ts` joins the two; the source alone answers only what was folded.
- **A fixed quarter-note grid in the roll, with a heavier rule every whole note and no bars** — MML
  carries no time signature, so the lines declined to claim they were bar lines and a song in 3/4 or
  7/8 got a rule that fell across the beat everywhere but where it happened to agree. The porter
  supplies the signature the format has not got: beats per bar over the note value that gets the
  beat, `0` beats for no grid at all, and `gridLines` counts beats from tick 0 so a bar line is a
  bar's first beat by construction. Not a `tick % barTicks` either — `tickWindow` snaps to a whole
  note, a 7/8 bar is 168 ticks, and the two align only by coincidence.
- **A strict one-to-one gate between the walk's notes and the roll's strip** — `walkSong` ends the
  pass at the shortest channel in use and sets everything after it aside as `unreachable`, so a
  channel longer than the shortest is the commonest shape a song has and an equality check refused
  editing on nearly all of them. The agreement is a **prefix** (`expandAndJoin`), and the items past
  the cut are editable and carry `verified: false`.
- **Deciding a push's direction per neighbour**, by which half of each one the overlap lands on —
  A shoves B right, B shoves C right, C shoves B left, and it never terminates. The half-rule picks
  the direction at the _first_ neighbour, which is the one the porter can see, and the cascade keeps
  it: every later shove then moves a note strictly away over a finite ordered set.
- **A trailing octave run winning over a leading one** — in `c4 o5 d4` the `o5` is adjacent to both
  notes, and two edit units claiming it produce overlapping splices that CodeMirror merges rather
  than refuses. Leading wins (`growUnits`), which is also what makes the restore stable: a repitch
  writes `o3 c4 o4 d4`, and on the next pass that `o4` is `d4`'s own leading octave.
- **Re-serializing the whole run of text between two notes** to realise a gap — it moves every `v`,
  `y` and `$ED` written in that run. Each item carries a `prefixSpan` instead, the rest nearest the
  note _before_ the gap absorbs the change, and a gap whose run holds a fade command is refused.
- **Refusing `<` and `>` in an edited channel** — they are not commands to the scanner at all, and
  they are harmless: a note's octave comes from its own `written` byte rather than from a running
  sum, so `o4 c4 > d4` repitches either note without disturbing the other. `rolltest` pins it. That
  is a statement about the **row**, and what `planEdits` carries between the notes is the entry
  below.
- **Capturing the pointer, and preventing the default, on the roll's `pointerdown`** — both stop
  the browser raising `click` and `dblclick` on the bar underneath, which took away everything a
  single click on a note used to do: naming its channel, asking the inspector about it, and going to
  it in the source on a second click. Capture is taken on the first move past the slop threshold
  instead, which is late enough to leave a click alone and early enough to follow a drag off the
  roll; a press that never moves is a click and commits nothing, drawing on empty grid excepted.
  A bar of another channel is not empty grid either — `itemAt` only knows the edited channel, so the
  press checks `event.target.closest('.mark')` before it decides it is drawing.
- **The roll's playhead line derived from `lead`** — the camera and the line were one number, so
  unticking Follow parked the line with the view and nothing in the roll said where the music had
  got to: the line, the marker on the bars and the lit keys all froze together, and the frame clock was
  switched off with them. `lead` is the camera's alone; the line is the song's tick in the camera's
  coordinates (`xAtTick`), and the clip is what hides it once the song runs off the pane. Not a
  clamp to the edge either — a line held there would say the song was there.
- **The mixer's mutes, solo and output level living on `Playback`** — the note previewer has to
  refuse a channel they silence and sound what it does play at the level the slider is set to, and
  it neither owns nor wants the transport: it shares no worklet, no audio thread and no song being
  played, and reaching through `Playback` for either would make it depend on all three. `Mixer`
  holds the mask, the solo and `volume`, injects `EditorStore` alone, and is read by `Playback`,
  `Audition` and the roll. What the two audio paths share is two numbers, and nothing else — the
  transport hands the level to the player's gain, the previewer to a `GainNode` of its own on its
  own `AudioContext`.
- **An HTML bubble for the roll's length readout**, in the volume slider's mould — the roll's
  coordinates are already the song's, so an HTML one has to undo the scroll transform and the
  scroller's own offset to land where an SVG one lands by standing still.
- **The roll's page anchor reset on the transport being idle, rather than on its going idle** — an
  effect runs once when it is created, so a roll rebuilt while the song was stopped zeroed the anchor
  it had just been given and the view shifted by up to a page on every tab switch. It follows the
  transition: what re-measures the pages is a stop. The camera outliving the component
  (`roll-camera.ts`) is what turned a harmless re-run into a lost position.
- **Putting the intro `/` a channel the roll opens needs on the nearest note boundary**, or leaving it
  out where the tick falls inside the note — every channel resumes from its own marker on each pass
  (`parser.ts:parseIntro` writes `phrasePointers[channel][1]`), so a marker a note out of place moves
  the whole song's loop point, and none at all restarts the channel at its top. The tick decides, and
  the piece it lands inside is split: a rest becomes two rests, the note becomes a head and a `^`
  continuation, which is still one note because a tie emits `$C6`. `rolltest` pins `loopTick` across
  the edit, which is the only reading that catches a marker on the wrong tick.
- **Filling a channel the roll opens out to the _longest_ channel**, or leaving it at the length of
  its first note — the second cuts the song off at that note, since the driver reloads every track
  pointer the moment one voice reads its `$00` (`main.asm:L_0C01`, `Music.cpp:3209`), and the first
  writes rests past a point the song never reaches. It is filled out to the **shortest playable**
  channel, `stats.introTicks + stats.loopTicks`, which leaves that minimum exactly where it was: the
  song plays for as long after a channel is opened as before it, which `rolltest` pins per case.
- **Writing a channel the roll opens into its place in `#0`-`#7` order** — `octave` and
  `defaultNoteLength` are one variable each and `parseHash` resets neither, so a block dropped
  between two others changes what the second is parsed under. A new `#N` goes at the **end of the
  document**, where nothing follows it to be disturbed.
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
- **Latching the audition's fast-forward on the track pointer alone**, the way `worklet.ts` does —
  `L_0C22` installs every voice's pointer, and `L_0C31` gives them instruments, a whole pass before
  any of them has read a duration byte (`main.asm:2302-2341`), so a poll landing there starts the
  count on a song that is not reading music yet and `atTicks` comes round a pass early. The note is
  then handed over inside the pass that starts the song, and the phrase walk still to come reads the
  frames at `scratchAt` as its next phrase: every track pointer goes to zero and nothing sounds at
  all. It latches on `$0200+2n`, the duration byte a voice has actually read (`voiceStarted`), and
  the floor of one tick on `atTicks` is what starts the driver at all. `audiotest` sweeps three to
  eight channels, because how much work `L_0C31` does before the song's first fetch is what moves it
  against the poll — four channels was silent where one and two were not. The worklet keeps the
  looser latch: a playhead a tick out is a playhead a tick out, where a note handed over a tick early
  is not played.
- **Keeping the roll alive behind `[class.hidden]`**, as the source view is — the symmetry is
  inviting and it does not work: `display: none` destroys the layout box, so the native vertical
  scroller comes back at row 0 regardless, and a hidden roll goes on drawing marks, a grid and a
  transform for a tab nobody is looking at. CodeMirror is hidden because its undo history is not
  something anything could hand back; a camera is four numbers that can be.
- **Putting a drawn note's octave back at the end of its run**, in the mould of the rewrite path — a
  rewrite restores the octave standing after the note it rewrote, which that note's own byte gives
  it exactly; a run written into a gap has no such anchor, and `<` and `>` are not commands to the
  scanner, so nothing can say which side of the run one written in the gap sits on. The octave goes
  at the **head of the note that reads it** (`spawnInto`), where the byte is the answer and any
  shift has already been applied — and where the text settles anyway, since an `o` left between two
  rests is claimed by no unit on the next strip build and is what makes a later edit there
  unreadable. Only a channel with no note left to hand it to has the run carry it, for the leak past
  a `#N`.
- **Answering a deleted note's octave with `running = null`**, and leaving the note after it to
  notice — a note whose pitch and length are unchanged returns from `rewriteNote` before an octave
  is spelled at all, and the seed above it re-reads `item.octave` off the text the deletion had just
  taken away, so `o2 a8 d8` losing `a8` moved `d8` an octave up. The note that _reads_ the octave
  asks for it, once per run of deletions (`dropped`) however many notes went, and it goes in at that
  note's head rather than through a rewrite of its unit: `noteText` re-spells what it writes, so an
  untouched `d-8` would come back `c+8` and a `b+4` as `o5 c4`. With no note left to hand it to it
  stays where the last unit was, for the leak past a `#N`; `rolltest` pins both, and the whole
  channel deleted.
- **Letting a note drawn past the end of the song extend only its own channel** — the driver reloads
  all eight track pointers the moment one voice reads its `$00` (`main.asm:L_0C01`,
  `Music.cpp:3209`), so the note was written, compiled, reported by `SST0502` and never heard, and
  the roll had no way to make a song longer. A gesture reaching past `stats.introTicks +
stats.loopTicks` pads **every other channel that would cut the song short** out to meet it
  (`padChannels`), in the same commit and so the same undo step. It counts the notes the gesture
  moved — placed and pushed both — rather than every note in the plan, or a deletion in a channel
  already running long would lengthen the song. A rest on the end needs no note map, no walk
  agreement and no `Strip`, so a channel `channelStrip` refuses outright is padded like any other;
  a channel at 0 ticks is left alone, since it holds nothing back. `rolltest`'s `playsFor` is what
  pins it — a rest one note short reads exactly like a rest of the right length.
- **`cursor-pointer` on the roll's note bars**, to say a bar is clickable — an element's own
  `cursor` beats the one it inherits, so the class silenced the roll's own cursor over every painted
  part of a bar. The `ew-resize` showed in exactly one place: the `NOTE_GAP` sliver past a bar's
  drawn right edge, where nothing is painted and `itemAt` still reports the note, since it hits the
  whole slot. A bar's left end has no such gap and so had no handle at all. The `<svg>`'s
  `[style.cursor]` is the roll's only cursor, and it says which gesture a press starts;
  `hoverCursor` answers `pointer` for the bar that really is only clickable, which is another
  channel's. The glyph plates inside a bar take no cursor either — they are right-aligned, so one
  would sit on the right stretch zone and put the same bug back over the last twelve pixels.
- **Moving `editChannel` onto `Mixer`** so a press on `M` or `S` could set it at its own call site,
  the way the roll's chips do — it is one field of the roll's persisted `Settings`, and a service
  owning it either splits that `localStorage` write in two or takes the whole roll's settings with
  it. The mixer is carried into the roll by a transition-following effect instead
  (`followMixer`), in the mould of the `wasIdle` one beside it: a `let` holding the last mask, the
  body `untracked`. Following the state and not the transition is what does not work — the roll is
  rebuilt on every tab switch, so an effect reading `silenced()` alone would drag the edited channel
  back to a solo taken long ago each time the tab came round.
- **Refusing every gesture until a channel is picked** — the roll was already pointing at the answer
  and would not take it, so the first act on a song was always to find eight small chips in a corner.
  With none picked the strip is built for the channel of the bar under the pointer (`editing`, off
  the `hovered` mark the tooltip already tracks), which gives the cursor, the hit test and the press
  the same channel for free, and `onPointerDown`'s existing `pick` sink names it for real. Not a
  hover-wide adoption either: empty grid belongs to no channel, so drawing, the marquee and the
  shortcuts still ask for one, and `editRefusal` and `onKey` stay on `editChannel` so a channel
  merely hovered is never announced as being edited.
- **A muted channel editable but un-clickable** — its bars take no pointer, so muting the channel
  being edited left drawing and the keyboard working on notes that could not be selected or heard.
  The strip refuses a silenced channel outright, in `silencedReason`'s words, which is the same
  sentence `Audition` refuses to preview one in.
- **Setting that cursor from the pointer move that reported the position** — the roll scrolls under
  a still pointer for the whole of a followed playback, so bars arrived under a cursor that had been
  told `crosshair` and nothing said otherwise until the pointer moved. It is a `computed` over
  `Hover`, which is stored in pixels for this reason, and `drag` is read first so a gesture in
  flight keeps its own cursor. Nothing clears the hover on `pointerdown` either: `drag` is what
  stands it aside in both readers, and a press that turns out to be a click has to have somewhere
  to go back to.
- **The roll's own bars drawn without regard to the gesture in flight** — the marks come off the
  compiled song and the preview off the `Plan`, two paths that never consulted each other, so a
  dragged note was painted twice: a solid bar following the pointer and the original left behind
  with its selection ring still on it. The bars leave out what the preview has taken over
  (`moving`, by strip index, turned into addresses by `movingSpans`), and it is a set rather than a
  flag because a selection drags as a group. Still not folded into `buildMarks`, which rebuilds
  about twice a screen and would otherwise rebuild the whole song's DOM on every pointer move. A
  copy needs no case of its own: `planGesture` gives a copied note `from: -1`, so `Ctrl`+drag hides
  nothing.
- **A refused plan returning `NOTHING`** — the bar under the pointer vanished mid-drag, in the one
  state where the porter most needs to see where the note is, and `PIANOROLL.md` had long said the
  opposite. A refusal that knows where its notes were going keeps them in `touched`, so the bar
  stays, red, until it is let go and the drag snaps back by committing nothing; `blocked` reads
  `Preview.refused` beside the clash count for the colour. `NOTHING` is left to the refusals that
  have nowhere to draw — a pitch off the driver's range has no lane, so `rowOfPlaced` answers -1
  whatever `touched` holds.
- **Each gesture answering an overlap for itself** — drawing, dragging and quantizing held the same
  block of code three times over and a stretch answered inside its own loop, so a mode added to the
  table fell straight through to the push at all four sites with nothing to catch it: they were
  `if`s, and `switch-exhaustiveness-check` cannot see an `if`. `resolved` is the one place the modes
  are told apart, and a gesture brings only what it alone knows — which way a push should send what
  is in the way, and which notes are its own. A stretch still pushes once per edge and carves once
  after them all, because a carve inside that loop eats a note the same gesture is about to move:
  it is not in `touched` yet, so nothing holds it back.
- **Counting a carve's pieces in `reach`** — a carve only ever makes a note shorter, so every piece
  it leaves sits at a tick the channel had already reached; reading the furthest of them as "how far
  this gesture reaches" padded every other channel out to meet a note nothing had moved, which is
  the same failure the `reach` comment already warned of for a deletion. `plan.erased` is what says
  a carve is what filled `pushed`, and the two resolvers never both run since the mode picks one.
- **Writing a spawned run in front of the region's items rather than after them** — with the intro
  `/` written between the note before the region and the region's own contents, the run went in
  front of the marker and the channel re-entered a whole region late. The song plays for the same
  length either way, so `loopsWhereItDid` in a **one-channel** song is the only reading that catches
  it: `loopTick` is the lowest tick any channel re-enters at, and a second channel marked on the old
  tick holds the reading down. `writeInto` anchors at `gap.before - 1`, which is the same offset for
  a region that holds nothing.
- **Letting the wheel size a note that is already being dragged** — `planGesture` takes one
  `Gesture`, and a note carried _and_ resized is two, so the second one silently won and the drag
  went nowhere. The wheel speaks only while the press has not passed `SLOP_PX` (`stepLength`), and
  once it has spoken that press is a `stretch` of the note's far end and stays one however far the
  pointer wanders. The pointer is already saying which of the two it means; this is only agreeing
  with it.
- **`shownPlan` gated on `moved || kind === 'spawn'` alone** — a press the wheel had resized had a
  plan, committed it on pointer-up and drew nothing at all in between, so the length was chosen
  blind. `held.length !== null` is the third way a press becomes something worth drawing, and it is
  the same field the commit reads.
- **The middle-button pan inside `roll-gesture.ts`** — that file refuses everything before it has a
  `Strip`, so panning would have needed a channel picked, and the camera is not the editor's
  anyway. `onEditDown`/`Move`/`Up` take `button === 1` before delegating; the gesture layer's guard
  is narrowed to buttons 0 and 2 so the middle one cannot fall through to drawing. Preventing the
  default on `pointerdown` is what stops the browser's autoscroll, since the compatibility
  `mousedown` goes with it.
- **A region's tick count doubling as the sign that it is the tail** — `regionsOf` sizes each gap as
  the distance from the note before it _in the text_, so a plan that asks for two notes in an order
  the text does not have them in produces a **negative** mid-channel gap, which `realiseRegion` read
  as `-1`'s "the tail, so any length will do" and left alone. The channel was then written with
  every note after the crossing slid along, silently and with nothing refused. `Region.tail` says
  where a region is; the sign says nothing, and a negative gap anywhere else is refused. The
  crossing itself is taken out before that by `crossings`, which moves the note into `born` so its
  unit is removed and written again on the far side — a note that changes places has to change
  places in the text, and rewriting it where it stands cannot express that.
- **Snapping a drag's destination rather than the distance it travelled** — snapping the sum of the
  start and the movement is grid magnetism: a note written a little before the beat was pulled
  square the first time it was touched, and one nudged less than half a step moved when the porter
  had asked for nothing. `draggedTick` snaps `moved` and adds it, so the offset against the grid is preserved and
  the delta is a whole number of steps — the same thing `←` and `→` pass to `run()`, which the drag
  had silently disagreed with. `spawn` keeps the absolute snap, having no position of its own yet,
  and `quantize` is left as the one gesture that squares a note up.
- **Clearing the inspector by moving the caret off what it was answering about** — `commandAt` is
  inclusive at **both** ends (`tokens.ts`), so in `c8 d8` the offset that ends `c8` is the offset
  that begins `d8` and there is no position between them belonging to neither. There is nowhere
  neutral to put the caret, and the roll faking one would be contradicted by the next click in the
  text. `EditorRequests.dismissed` holds the caret the question was withdrawn at instead, so the
  silence is one caret's worth and any move at all ends it — not a mode, which would have to be
  turned off by something and would outlive the gesture that set it.
- **One `Shift` flag for both of the gestures it changes** — `Shift` decides what a press on empty
  grid _is_ (a note pinned at the press with its end on the pointer) and merely _constrains_ a drag
  already under way (locked to one axis), and those settle at different times. `anchored` is read at
  the press and never again; `shift` is refreshed on every move, as `fine` is.
- **`Shift` as a row lock alone, or `Ctrl` as the tick lock beside it** — the second has no key to
  take: `Ctrl` at the press is a copy on a bar, the marquee on empty grid and the selection toggle
  on a click, and every chord with it or `Alt` breaks a combination that already means something.
  `Shift` locks the axis the drag first moved along instead — sideways is the row lock it always
  was, up or down pins the tick. The axis is latched in pixels at the slop transition, where the
  pointer is captured, and never re-derived: a near-diagonal drag re-read every move would flip its
  constraint mid-gesture. `shift` itself stays per-move, so releasing it lifts the lock and
  re-pressing it restores the same axis.
- **Counting a remote code definition's `[ ]` against the starting channel** — AddmusicK tells a
  definition from a call by nothing but position (`Music.cpp:1015`), so `(!1)[ … ]` always sits above
  the first `#N` and its brackets gather on the starting channel like everything up there. That
  refused channel 0 outright on every song with one. `gather` marks the body and both its brackets
  `inRemoteDefinition` and the roll's gate skips them. Not by exempting everything above the first
  `#N` — a `[ ]` written up there that no `(!n)` armed is the channel's own music and does play it
  twice — and not by giving the body `channel: 8` the way the compiler's `commandMap` does, which
  would be right for the roll and wrong for the echo hazards and the FIR designer, who would lose a
  `$F1` written inside a body. The commands stay in `growUnits`'s list too, where a `]` that cannot
  lead a unit is a barrier.
- **Two passes each answering a note's octave for itself** — `planEdits`'s item loop gives the next
  surviving note an `o` at its head when the unit above it went and took the channel's own octave
  with it; `spawnInto` gives the note bounding its region one at that same head, for the run it
  wrote in front of it. Both build the same insert at the same offset, `coalesce` concatenates
  rather than dedupes, and a note carried past another came out `o4 o4 d8`. The regions are built
  before the item loop, so the loop can ask whether a run is about to answer for that note
  (`spawnLeaves`) and stand down — the pass that can see what the run leaves is the one that
  speaks. Not a dedupe of identical edits at one offset: two writers agreeing by accident is not the
  same as one of them knowing it has nothing to say.
- **`planEdits` answering a refusal with a bare `null`** — the gesture was undone and nothing on
  screen said why, while `REFUSE_SPELL`, `REFUSE_CROWDED` and `REFUSE_RAMP` sat exported and unread.
  It answers `Edit[] | EditRefusal`, which is the shape `channelStrip` already has, and the roll puts
  the sentence beside the toolbar's own "cannot edit". Not folded into `Plan.refused` either:
  `planGesture` refuses what it can see while the pointer is down, which is what the red bars are
  already drawing, where a spelling refusal is only known at the commit that undoes the gesture — so
  it is held against the document it was given for rather than leaving with the gesture that earned
  it.
- **Reading `itemsRunTogether` over a region with no rest in it** — nothing is laid over anything
  there: the run is inserted at one offset and every item in the region is a note `planEdits` removes
  outright, so the guard was protecting a boundary that had gone anyway. It refused the commonest
  shape a carve leaves — a note drawn over a run of notes with a `v` or a `y` written between them —
  and wrote nothing at all. The guard is asked only where a rest is being rewritten.
- **Anchoring a spawned run at `strip.items[0]` where no note after the region survives** —
  `writeInto`'s head branch aims at the next _surviving_ note, and a carve that swallowed the whole
  channel leaves none: `items[0]` is then a note the same plan is deleting, `removeItem` takes the
  whitespace in front of a unit with it, and the insertion therefore lands strictly inside a range
  being removed, which `planEdits` refuses. The run goes after the region's last item, as it goes
  after the note before the gap in the other branch, and that only abuts the removal.
- **Asking whether the note after a spawn can be left as it is by what stood _before_ the gap** —
  `untouched` compared the previous note's exit octave against the reader's and against the run's,
  so a region at the head of a channel, which has no note before it to compare with, always wrote an
  `o` saying what the run had just said. What that note reads is what the **run** leaves: `noteText`
  spells an absolute `o` wherever the octave in force is not the one the note needs, so after the run
  the octave standing is the last born note's own. `untouched` is that against the reader's octave,
  plus the `MOVES_OCTAVE` scan over the text between the run and the reader's head — the same scan
  as `inForce`, on the other side of the run.
- **The overview bar's minimap in one grey, deduped by pixel and row alone** — it was the one picture
  of the song that would not say whose note a bar was, and the key made that structural rather than
  incidental: two notes colliding on it are by definition two channels', so the wider won and the
  other channel's note left the picture with nothing to say it had gone, which two channels sharing a
  drum lane does on every song that splits percussion. The bars carry `CHANNEL_FILL[note.channel]` as
  the roll's marks do and the channel is in the key, so a cell is one channel's reach through one
  pixel of one row and "keep the wider" compares a channel against itself. Dropping the channel back
  out of the key is not the cheaper spelling it looks like: the count is bounded by the song's notes
  either way — the pixel-and-row ceiling is `rollWidth × rows`, some hundred thousand cells, and
  never bound anything — so the only thing that key saved was the notes it was losing. In the key
  rather than beside it because `id` is what `track bar.id` tracks. A silenced channel is dimmed to
  the roll's own `MUTED_OPACITY` rather than dropped, and in a second map so its bars come back
  first and a live one is never veiled by the wash of something that cannot be heard; `charttest`
  pins all of it, none of it visible in a screenshot.
- **Tinting the glyph a note puts in force, and finding it by comparing `origins` arrays** — the
  first is the reading issue #34's own words invite and there is no colour that survives it: the
  eight channel fills are mid-tone and chromatic, so `--color-accent` goes on `--color-ch-0`,
  `--color-warn` on `--color-ch-3` and `--color-good` on `--color-ch-2`, and each is the one that
  vanishes on some channel. The axis the set leaves free is lightness, which is the property
  `roll-notes.html` already leans on for the hover, so a defining glyph is a near-white plate with
  the icon in `--color-surface` and reads against the plate rather than against the bar. The second
  is the cheap spelling of `definedAt` and it is wrong after every `t`: `recordOrigin` calls
  `invalidateAll`, so a song-wide write hands all eight channels a fresh array holding the same
  addresses and every channel's next note claims to set everything it plays under. It is the
  identity of the commands in the list, `index.commands` holding one stable object each. Nor from
  source order — the glyph names whichever command the driver had in force, so in
  `v255 (1)[ c ]2 v200 (1)5` the text has that `c` setting `v255` on the pass it sounds under
  `v200`. `walktest` writes a song for each of the three.
- **Drawing a bar's glyphs in the walk's slot order alone** — `fitBarContent` drops from the end, so
  the ones a narrow bar kept were whichever `SLOTS` names first, and a bar with room for one spent it
  on a `q` no note had touched for a page while the `v` that note actually sets went behind the dots
  with nothing but the mark's plate to say it had. The ones the note puts in force lead
  (`buildMarks`), slot order holding within each half, so the cut takes the inherited ones first. The
  cost is real and is the smaller one: a command moves along the row between the note that sets it
  and the notes after it. Not a fix in `fitBarContent` either — it is handed a count, and a layout
  that knew which glyph mattered would be a layout that knew what a glyph was.
- **The command lane as the complement of the bars, holding only what no bar stands over** — told by
  `WalkCommand.onANote`, whether a note **begins** on the command's own tick and sounds with it in
  force, which is the one thing a scope cannot say and `origins` cannot either, being anchored on a
  note where the question is about the tick. It read as tidy and cost the lane the thing it is for: a
  timeline with holes in it is not a timeline, and the holes were the commands written the ordinary
  way, straight before the note that reads them. A porter scanning the lane for "what runs, and when"
  found the `v` in a rest and not the `v` on a note, with nothing to say which kind was missing. It
  holds **every command that takes effect** (`command-timeline.ts`), scope alone: `commandScope`'s
  `'song'`, which `commandsInForceOf` drops because it acts on the song and not on a note of it, and
  every `'note-state'` one wherever the driver reads it. Most are then drawn twice, and the two are
  not repeating each other — the lane says the tick, the bar's chip says which note plays under it.
  `q`, `h` and `@21`-`@29` stay on the bars alone, emitting no byte to address and so having no tick
  but the note they fold into. `onANote` is kept as the walk's description of the song and read by
  nothing; `Track.owners` is what computes it, off the entry and not the address, since
  `[[ v100 v200 ]]2` raises two `v200` entries at one tick on one channel and only the second is in
  force.
- **Reading the lane off `definedAt` alone** — it is anchored on a _note_ and a timeline needs a
  _tick_: `emitNote` pushes a `WalkNote` for a note and not for a rest, so in `c4 v200 r4 d4` the
  `v200` runs at tick 48 and the lane drew it at 96, a whole rest late. `origins` names what
  _occupies_ a slot, too, so the four that empty one could never be named at all. The walk raises its own
  `WalkCommand` in `recordOrigin`, which is already the one place that knows a slot has changed
  hands, so the two agree wherever they overlap: a write of the address a slot already holds moves
  nothing, and `[ v200 c8 ]2` is one entry from either end. `definedAt` keeps the half it is exactly
  right for, `q`, `h` and `@21`-`@29`, which emit no byte to address and so have no tick but the note
  they fold into — and which a bar therefore draws.
- **A native `overflow-y-auto` on the command lane** — nothing here styles a scrollbar, so a ~15px
  Windows bar eats a third of a 42px lane, and its gutter narrows the content box, which puts the
  lane's right edge a scrollbar out of step with the roll it is drawn to track — the trap `w-full` on
  the bars over the roll already fell into. A plain wheel lifts the glyphs by a transform, and the
  thumb saying the stack runs deeper is drawn inside the `<svg>`, where it costs no width.
- **Packing the lane over the window on screen** — rows are first-fit, so a re-deal at every
  `tickWindow` turnover moved glyphs up and down as the roll scrolled past them, and a glyph that
  changes row while the roll moves is saying something about the scrolling rather than about the song.
  `packCommandLane` runs over the whole song and `laneWindow` only slices it, keeping the whole song's
  `depth` rather than the slice's: that is the scroll range, and one that shrank as a deep column went
  past would take the porter's position with it.
- **A wholly overwritten item's declarations left for the replacement to inherit** — the erased
  note's `v200` stayed in the text, so it landed on whatever was drawn over it, and one standing
  between two erased items refused the whole gesture as crowded. An item the plan removes takes the
  `'note-state'` commands in its prefix and inside its own unit with it, but only the ones **nothing
  in the edited song still sounds under** (`reachesSomething`); the channel's first item is exempt,
  its prefix being the channel's setup. Not region-wide either: the laid-out run covers the
  **window** (`windowOf`), the contiguous items the gesture actually touches, which is what lets a
  rest it never reached keep its bytes and its own `v200` both — a run over the whole region would
  move that kept command off its tick, which is the crowded refusal all over again.
- **That gate on `plan.erased`, so overwrite dropped a declaration and Backspace kept it** — only
  `carve` fills `erased`, so the two answers differed on "did the ticks get a new occupant", which is
  a fact about the edit path and not one a musician reasons about. And the reasoning that separated
  them was thinner than it looked: a drawn note declares nothing of its own, so erasing `v255 c4` and
  drawing over it re-voices everything to the right just as silently as the deletion would have. The
  question names no gesture — a surviving note counts as a reacher and so does one being drawn, which
  is why drawing over a note keeps its `v200` where deleting the same note takes it. `plan.erased`
  stays, `roll-marks.ts` drawing the hatching from it.
- **Moving a kept command to the head of the next surviving note** — the cheaper spelling, and it
  loses the tick: in `c4 v200 d4 v100 e4 f4` overdrawn from 48 the `v100` runs 48 ticks inside the
  drawn note and there is no surviving head at that tick, so the note's second half would sound at
  `v200` with nothing to say so. A run splits the born note at the command's own tick and writes it
  between the tied halves instead (`RunMark`, `spawnRun`), which is the intro `/`'s mechanism
  widened from one tick to a list — and a tie emits `$C6`, so the two halves are still one note.
- **Deriving a command's reach from a slot table built off the source** — the walk has already
  resolved it, and a source-order scan is blind to a `[ ]` body played twice and to a `(1)n` called
  from another channel. `commandsInForceOf` answers a note with the `Command` objects acting on it,
  by the same stable identity `definedAt` compares, so "the slot changed hands" is the first note
  the pass played without the command in its list. The identity is the trap: `channelStrip` filters
  `index.commands` from its own `TokenIndex`, so a second `tokenize` makes every membership test
  false and keeps every command while looking like it works — `EditContext.inForce` and
  `Strip.commands` must come from one scan, which is what `rolltest`'s `Built.index` is for.
- **`removeItem` splicing a multi-segment unit whole** — `growUnits` ends `unitSpan` at the **last**
  segment (`roll-strip.ts`), so a `v200` written inside a note went out with the note in silence, and
  a `t` or an intro `/` would have gone the same way. A command inside a removed unit is asked the
  reach question on its own tick (`insideCommands`) and dropped where nothing sounds under it; where
  a run is being laid over those ticks the run takes it over; and with neither, the gesture is
  refused (`REFUSE_INSIDE`), because there is no tick left to put it on and no gesture can say which
  side of the deletion the porter meant it to follow. `REFUSE_RAMP` keeps the one site whose reason
  really is the length, a note cut shorter than the ticks in front of the command.
- **Handing a command a deletion left behind to the next surviving note** — deleting `b3` from
  `o4 a=27 p12,147 b3 c3` leaves the `p` in front of the rest that takes those ticks, and putting it
  on `c3` instead loses the tick: the `p` runs at 27, where the driver read it and where the rest
  still is, so a per-channel `$E8`, `$DC` or `$DD` would have its whole ramp shifted by whatever the
  deleted note happened to be worth. `commandScope` sorts by reach and not by whether a command
  evolves over ticks, so there is no axis to spare the fades on. It is the `plan.erased` split as
  well: a note **drawn over** `b3` begins on tick 27 and keeps the `p` where it is, so only the
  deletion would move it, and whether the gesture matters is the one thing `reachesSomething` exists
  to answer no to. The command stays where it was written and the lane's glyph is dragged
  (`roll-command-move.ts`), which is a tick the porter picked rather than one a deletion inferred —
  the same standing the right-click erase already has. Horizontal only, lane rows being first-fit
  packing; snapped to the channel's own item heads, so the insertion is always into an item's prefix
  and no note has to be split into tied halves; in its own channel, since within one channel text
  order is execution order; and with no target past the last item, because the pass ends at the
  shortest channel and a command written after a channel's last note raises no `WalkCommand` at all
  — a target out there is one a command could be dragged to and not back from.

- **A muted channel's commands dimmed rather than dropped, the way its bars are** — the symmetry with
  the roll and the overview is inviting and it takes the wrong thing as the subject: a bar stands for
  a note, which a mute silences whole, where a glyph stands for a command, and how far a command
  reaches is not something the channel it is written on decides. A `v`, a `y` or an `@` on a silenced
  channel sets nothing anybody can hear and is not drawn at all; a `t`, a `w` or an echo write on
  that same channel still runs the whole song, so it stays and is dimmed. The test is
  `commandScope`, in `packCommandLane` rather than in `command-timeline.ts` — what the mixer silences
  is a fact about the moment and the timeline is a fact about the compile.
- **Packing the lane without regard to which channel is being edited** — first-fit over the whole
  song deals a channel's commands into whatever rows are free, so the ones the porter was working on
  were scattered down a stack many rows deep that shows three at a time, and finding them meant
  scrolling the lane on every glance. The edited channel is packed **first** and everything else
  strictly below it (`packCommandLane`), so its commands are always in the top rows. A band rather
  than a preference: letting another channel fill a gap in one of those rows puts a glyph the porter
  is not working on among the ones they are, which is the thing the split is for. Off `editChannel`
  and not the roll's `editing`, whose fallback is the channel of the bar under the pointer — rows
  would then be re-dealt on a hover, which is the same complaint as re-dealing them on a scroll.

- **Mirroring the parser's `$DD` lookahead in `step` as a lookahead** — `$DD`'s last parameter may be
  a written note, and `parseHexCommand` settles that by reading ahead over spaces, newlines,
  `o<int>`, `<` and `>` (Music.cpp:2012-2042). Its `skipSpaces` crosses line breaks and `step` may
  not read another line, so a scanner that quietly did would pass a whole-document test and
  mis-colour text after a restart, which is the one property `tokentest` exists to hold. It is a
  deferred flag instead (`ScanState.ddTarget`), raised where the lookahead would begin and answered
  by whichever token arrives, and **cleared by default** — ending at anything the parser's loop does
  not name is the rule itself, so `|`, `{`, a marker and every arm added later are right by
  construction rather than by a list. Not one flag either: `getInt` skips no spaces, so `o5` carries
  the lookahead on where `o 5` and a bare `5` end it, and `ddTargetOctave` is what tells the two
  apart — set only when the digits are the next character, which is what keeps it inside one line
  and out of the approximation `awaitingAmkVersion` has to make.
- **Refusing a piano-roll channel for using `$DD` at all** — the sentence named a target note, and
  the all-hex `$DD $00 $18 $A4` has none, so the commonest form of the commonest bend refused the
  channel for a reason that was not true of it. What the blanket refusal was really carrying is a
  hazard that has nothing to do with the target: `$DD` is not dispatched, the note before it reads it
  by peeking at the byte standing at the track pointer (`main.asm:L_10E4`), and its dispatch slot
  holds `$0000` — so its position is a **byte** adjacency, and `writeInto` anchoring a gap's rest at
  the note before the gap put that rest between the two. The guards are per-fact and named:
  `StripItem.bend` says which item carries a slide, `afterBend` moves the anchor past the whole
  construct, `prefixCommandsOf` never lets a removal take a `$DD` — `reachesSomething` scans forward
  and the loss here is in front of the command — `exitOctaveFor` stops suppressing the octave restore
  where a note target reads it, and deleting the rider and dragging the glyph are refused in their
  own words. Not a narrowing to the note-target form: that would have shipped the byte-adjacency bug
  under a sentence saying the channel was fine.
- **A row cap on the command lane, with the rest of a column drawn as three dots** — a stack cut to
  keep the DOM finite is still a stack cut, and it cut the wrong thing: a tick carrying more commands
  than the cap is a tick a porter opened the lane to read, so the one column worth the most was the
  one it declined to show, and a count is not an answer to "what runs here". Every command the song
  runs gets a row (`packCommandLane`), the wheel reaches the ones past the bottom and the seam above
  the lane takes it taller. `depth` was always the scroll range; with nothing dropped it is now the
  whole column, so a glyph can always be scrolled to. The bar's own `fitBarContent` mark is a
  different thing and stays — a bar has a fixed width it cannot grow, where the lane has a scroll.
- **`$DD` filed as a state slot, the way `$DE` and `$ED` are** (`slotsOf`, `SLOTS[11]`) — it put a
  slide everywhere it is not and nowhere it is, and both readings were wrong in silence. `origins` is
  frozen when a note keys on and the walk reaches the `$DD` a byte later, so the note that _plays_ the
  slide reported nothing and every note _after_ it reported the slide as state it sounds under —
  which no note does, a slide running once and leaving nothing standing. And the entry `recordOrigin`
  raised carried `track.ticks`, which by then has run on past the note, so the lane drew the slide
  where the note it rides on **ends**. It is the note's own, as `drumFrom` is: `WalkNote.bendFrom`
  holds the address, `commands-in-force.ts` joins it, and the bar of the note in front of the `$DD` is
  what draws it. Its lane entry is raised from the arm itself at `track.ticks - track.duration`, the
  frame the read-ahead found it in — so `c4^4 $DD` is 48 ticks in, which the operands cannot say — and
  once per execution rather than once per slot change, since a `[ ]` body carrying one really does
  slide on every pass. That is also why `definedAt` never counts a `$DD` in the previous note as
  inherited: it is one written command reaching two notes that each ran it, and identity cannot tell
  that from a `v200` still standing. Not a separate list beside `origins` either — a slide is a
  command acting on a note, which is the question `commandsInForceOf` already answers, and a second
  channel for one command would need every reader to ask twice.
- **Auditioning a note's slide off the `$DD` its own text carries** — `StripItem.bend` is the token,
  and a token cannot say when the driver arms it. `$DD` is not dispatched: the note before it peeks
  at the byte standing at the track pointer (`main.asm:L_10E4`), and only on a tick that does not
  fetch music data, `main.asm:2337-2339` jumping straight past `L_0CC6`'s read-ahead on one that
  does. So the arm is decided by **the frame the peek reads it in**, and `emitNote` chunks a note
  of `$80` ticks or more inside one `noteMap` entry with no boundary anywhere in its text —
  `c4 $DD`, `c4^4 $DD` and `c1 $DD` carry the same three operands and arm 0, 48 and 96 ticks in. The
  operands come off the walk (`WalkNote.bend`, `afterTicks` and `frameTicks` with them) into `StripItem.slide`, joined
  index by index over the list `expandAndJoin` has already checked so the two cannot drift, and a
  note past the end of the pass auditions **flat**: an approximate bend that sounds like the real one
  is worse than none, which is the reading `commands-in-force.ts` already takes. `noteFrames` then
  writes the four bytes where `emitNote` would leave them and lets the driver find them, rather than
  reconstructing a pitch curve — the same argument as emulating the song up to the tick instead of
  modelling what a note sounds under, and it is what makes a frame of one tick behave here as it
  does in the song, dispatched into the empty slot and never armed. Operands no `emitNote` could have
  written are dropped rather than approximated. The target goes in as the **emitted** byte and is the
  one value on that path `Audition.transposed` must not touch: it exists to turn a written row pitch
  into an emitted one, the compiler resolved `h` and the instrument's tuning long ago into
  `NoteAddress.note`, and the driver adds `$43` and `!HTuneValues+x`
  itself when it arms.
- **Rebuilding an audition's frames from `afterTicks` and the note's length alone** — it takes the
  arm's frame to be the note's _last_, which puts the `$DD` after every frame the note has, and
  `f+2 $DD $00 $D6 a+^2` is where that is false: `^` emits a `$C6` frame of its own and a tie keys
  nothing on (`main.asm:2403-2405`), so those 96 ticks land on the `f+` and the command sits between
  the note's two frames. Read as a last frame it is a 192-tick tail, which no duration byte can say,
  and the slide was dropped outright — the note previewed flat where the transport bent it; take the
  tail check away and it arms 96 ticks late instead. The frame's own length is carried
  (`PitchSlide.frameTicks`, `track.duration` at the peek) and the ticks behind it written as the ties
  they are. It cannot be derived: `c=1 $DD $00 $18 a ^=95` and `c4 $DD $00 $18 a ^4` are both 96
  ticks arming at 0 and only the second arms at all, and `StripItem.segments` cannot answer it either,
  being the note map's frames and not `emitNote`'s. What the frames after the arm are is inaudible —
  the slide counts off `$90`/`$91` — so only their total is reproduced. `StripItem.bend` reads from
  the item's **first** segment's end for the same shape, `growUnits` ending a unit at its last
  segment and so at a point past the `$DD`, which left every guard that reads `bend` switched off.
- **Handing an auditioned note over the moment the fast-forward's tick count reached its tick** —
  `sawTick` reads `$44`, which the driver writes at the top of a pass, a `$49` update and a
  `ProcessAPU2Input` call before that tick's music runs (`main.asm:193, 227, 239`); reading a tick
  without waiting for it is what a playhead wants and not what a note wants, since the tick a note
  starts on is the tick its own commands are dispatched on — the `@`, the `v` and the `y` in front of
  it come out of the same fetch as the note byte. Four settle blocks are 4 ms against a fetch pass
  that runs well past that on eight busy channels, so ARAM was patched inside `L_0C4D`'s walk, which
  runs voices 0 to 7, and identical music on two channels got two different answers. Before a voice's
  fetch, the note sounded under the **previous** instrument. Inside it, `L_0CB3` reloaded `$70+x`
  from the song's own duration byte over `startVoiceAt`'s 1 (`:2440-2441`), so the voice played the
  song's note and fell into the audition's frames when it ran out — a second key-on half way through.
  And halting another voice mid-fetch left it reading through a pointer whose high byte had just gone
  to zero, where the `$00` it found walked the phrase table over every pointer at once and six
  channels of eight went silent. `arrive` waits for the target voice's own fetch mark to move and for
  `$48` to say no per-voice loop is in flight, then steps to the top of a pass so the point is the
  same one every time; the settle waits for the driver to clear `$5C` rather than counting blocks;
  and the voice is parked meanwhile, since a halt would stop `L_0D1C` taking its volume. Not
  sample-identical even so, and no arrangement of this is: a mixer mask, or a different voice's fetch
  to wait for, moves the key-on a few CPU cycles and the DSP's free-running envelope counter with it.
  `audiotest` prices that at a few ten-thousandths of the signal, with the body of the note unmoved,
  and the mask control there is a level for the same reason.
- **Halting the other seven voices for an audition** — a note in a chord came back as that note
  alone, which is not what it sounds like there and is the one question a preview is asked. They are
  **parked** instead (`parkVoice`, `$70+2n` at the ceiling): a parked voice reads no further music
  data but keeps everything else, so it plays out the note it holds at that tick, keys off where its
  own note ends — `$0100+x` counts down in the read-ahead whether or not a voice is fetching
  (`main.asm:3213`) — and takes its fade and its vibrato with it. `silenced` is then what says which
  channels are in the chord, held through the recording as well as the fast-forward. Not a halt with
  the volume left on, which is the cheap spelling of "let them ring": `L_0D1C` skips a halted voice
  (`main.asm:2503-2505`), so its `VxVOL` is never rewritten again and it rings at a fixed level for
  the whole preview instead of ending. And the park is what keeps the frames where they are — they go
  over the song's load address and the `$40` phrase table with it, and a voice reading a `$00` walks
  that table over all eight track pointers (`L_0C01`), which a parked voice never reaches. It lasts
  127 ticks, so `parkOthers` runs again after every block. The settle stopped muting everything at
  the same time: the other voices keyed on at this tick during the walk the arrival waited for, and
  muting them there took the front off that attack and handed it back a tick later.
- **Filing every parser diagnostic, a repeat of the same finding at the same span included** — sound
  while `pos` is advancing, since text the author wrote cannot raise one span twice, and it made the
  problems list the second freeze once `SST0505` stopped the first. A song growing until the
  expansion ceiling stops it reports whatever its expansion is made of once per round, and `spanAt`
  collapses every copy onto the one character that was typed: `"1=[q7F @0 a1]"` filed the same
  "cannot nest" error 6,553 times, which CodeMirror underlines and `amk-diagnostics-list` renders a
  row each of. `report` is the one place a diagnostic is filed and it drops a repeat of the same
  code, span and message — six thousand of those are one finding. Not a cap on how many diagnostics
  a parse may hold, which would lose the six-hundredth real error in a song that has one.

- **Unrolling loops as the roll's answer to a `[ ]`** — a rewrite wrote n copies of a body under
  re-asserted parse state, and the roll refused every loop-bearing channel and pointed at it. It is
  the walk instead: `SongTimeline.loops` is raised off the driver's own `$E9`/`$E6`
  frames, the strip frames each body and edits the one text in place, and every pass is drawn,
  auditioned and joined per instance. Unrolling turned away exactly the songs porters write — a
  recall under another instrument, a loop and a subloop that cross — inflated a document
  n-fold, and re-derived from text what the walk already knew; a declaration is told from a recall
  by command-map membership, a `]n`'s own `$E9` being the one dispatch `recordCommand` drops.
- **Editing one pass of a loop differently from its siblings** — considered and not supported, with
  no unroll escape hatch: a body is one text, the dashed box and the sibling rings are that
  statement drawn, and a variation on pass two is written by hand. An editor that offered to
  diverge an instance would have to unroll behind the porter's back, which is the document
  inflation the roll exists to avoid.
- **The loop box's edge drag as an in-body group move** — it slid the body's notes around inside
  the loop, which the notes' own bars already do once the edge click has selected them, and it left
  the roll with no way to put anything _between_ two passes of a recall. The edge is the
  construct's handle, not the notes': dragging it moves that pass occurrence in song time —
  `openGap` splits the recall's count around a gap of rests (`(1)5` → `(1)2 r1^1^1 (1)3`, a
  declaration's `]3` → `] r… *2`), leftward only closes the free rest space `gapSlack` prices, and
  the one shift boundary at the grabbed pass's start is what the preview slides. Not a second
  channel for the preview either: the bucket comparison (`ends[k] <= tick`) already shifts a note
  standing exactly on the boundary, which is the moved pass's own first note.
- **The loop box's edge as one gesture** — a press anywhere on the stroke slid the pass, so a body's
  length could only be changed by stretching the note at its end, and its trailing rest could not be
  reached at all: `realiseRegion` never rewrites a tail, deliberately, and `plannedFrameTicks` prices
  the body on that. The stroke is read by **where on it** the press landed — inside the same
  `EDGE_PX` zone a bar's own handles use it resizes, anywhere else it slides — and `[style.cursor]`
  says which before the press. The handle carries `data-ticks` beside `data-tick` so the press
  measures the box as **drawn**: `buildLoopRegions` clips a pass the song ends inside and floors its
  width at a pixel, so `run.passes[pass].ticks` would put a resize handle where no edge is.
- **A left-end resize that moved the notes inside the body**, the mirror of the right end — not what
  a left edge means: the porter is moving the boundary, not the music. The construct is pulled back
  by exactly the ticks the body's head gains (`resizeLoop`, `'start'`), so the first pass's notes
  stand still and every later pass slides by its own ordinal, and the rest goes at `frame.span.start`
  **before** any command written at the body's head — that command then runs at body-local `delta`
  on a pass beginning `delta` earlier, which is the tick it had. That is also what makes the two ends
  asymmetric at the tail: a right resize moves the voice's end by `count × delta`, a left one by
  `(count − 1) × delta`, the one delta having come out of the rests in front rather than been added
  to the song. Offered on the voice's **first occurrence** of the body and not merely on a run's
  first pass — a later occurrence's start is carried by the passes in front of it, so the end would
  travel the way the pointer did not.
- **A resize taking the pointer's travel as the body's own change** — a pass three deep begins three
  deltas later, so its far end moves by four of them and the handle ran away from the pointer it was
  being dragged by, which is the one thing a handle may not do. The travel is divided by the passes
  in front (`Drag.loop.ahead`, `passesAt`) before it is snapped, so the end follows and the body
  still changes by whole steps; the left end needs no such division, being the first occurrence's
  alone and held under the pointer by the construct moving back with it. Not the note stretch's
  reading, which lets the grabbed note run ahead — a note is being given a length, where an end is
  being put somewhere.
- **Both ends of a seam offered where two passes meet** — every interior edge of a loop is two boxes'
  handles overlapping, the later one drawn on top, so a press on what looks like one edge asked to
  move a later pass's start and was told it could not. The seam belongs to the pass on the **left**
  (`passesAt().abuts`): its far end resizes from any pass. Told by another pass ending exactly there
  rather than by "not the first pass", so `(1)[c4] r1 (1)2` keeps the honest refusal on the second
  occurrence's own start, which really is free and really cannot move.
- **`ShiftBoundaries` generalised to a shift per bucket** for that asymmetry — it is not a different
  shift, it is a different **boundary**. A body-length change lands once per pass and where in the
  pass it lands is what decides it: a stretch or a right resize puts it at the pass's tail, so the
  step is at each pass **end**; a left resize puts it at the head, so the step is at each pass
  **start**, and the grabbed occurrence's own start is no step at all. One list of ticks either way,
  `roll-notes.ts`'s buckets untouched, and `shiftBoundariesFor` lives in `roll-edit.ts` beside
  `plannedFrameTicks` — the two halves of one arithmetic — because it is the only piece of a resize
  no walk can catch and a harness has to reach it.
- **A region audition built out of the note previewer's frames** — a selection is not a note, and one
  injected per note would park every other voice and play a chord the song has not got.
  `auditionRegion` runs the same `fastForward` and then records with **nothing parked and nothing
  injected**: every voice reads its own music, a voice that reaches its `$00` walks the phrase table
  exactly as the song does, and what comes back is the song over those ticks. `parkOthers` was only
  ever there to keep a voice off the frames a note was written over, and there are none here — but
  the span's _end_ parks every voice, so its last notes ring out and nothing new starts. No `arrive`
  either: that waits for the target voice to fetch, which is right when a note is being handed over
  and takes the attack off the region's first note, where `sawTick` reads `$44` at the top of a pass
  and leaves the driver about to play the tick asked for. One worker and one token with `playNote`,
  so a note press and a box press supersede each other rather than sounding together.
- **The loop label carried on `LoopRegionBox`** — that list is built on the mark window's cadence and
  a selection changes on every click, so the whole on-screen box list would be rebuilt for a
  two-character plate; and the loop layer is drawn under the bars, where a label cannot be read. It
  is a second, short pass over the boxes already built (`buildLoopLabels`), drawn above the notes.
  Per **construct** rather than per body: `(1)[a1]5` and `(1)2` both name the body where a `*2`
  recalling that same body names nothing, and the digits come off `LoopSite.label` —
  `widenOverLabel` already reaches over the `(n)` for a declaration's span, so they are read once and
  `openGap`'s split reads the same field instead of scanning for a `)` of its own. Only the channel
  being edited has a selection to show one for, and it is `editChannel` and not `editing`, or a label
  would appear because the pointer wandered over another channel's bar.
- **A handle of its own for the loop's transpose**, beside the rule that slides the pass — the box's
  stroke is nine pixels and its ends are already spoken for, so a third zone on it would be a target
  nobody could hit, and one drawn outside the box would be a second thing to find before the obvious
  thing worked. The **axis** says which of the two a press is, the way `Shift` already picks an axis
  for a note drag: sideways slides, up or down transposes. Latched where `Drag.axis` is and read
  never again — a press that re-decided on every move would swap one edit for the other under the
  hand, which is the same complaint that entry already answers. The refusals do not carry across:
  a `'transpose'` holds `Drag.loop` and reads none of it, since a nested body that has no song-time
  position to slide transposes like any other.
- **`keysBetween` for that drag's semitones**, as a note drag uses it — it answers 0 wherever either
  row is a drum or the noise lane, and a body that plays percussion has its box's rules up there, so
  the gesture never started at all on the songs most likely to want it. It is the **rows** travelled,
  a row of the keyboard being a semitone, which is what `keysBetween` computes anyway wherever both
  ends are keys. And the gesture sounds nothing while it is held: the drag carries a whole body's
  notes, which is no more one note than the construct a slide carries is.
- **Dimming the loop boxes to 30% while a body-length edit is held** — they were the compiled
  song's reading of a song in motion, and a fade is not a way of saying "out of date": the box sat
  where the music used to be while the bars inside it moved out from under it, and the transpose
  made that plain by dropping them seven rows. They **follow** (`followLoopRegions`), a second short
  pass over the built list in `buildLoopLabels`'s mould, and the dim goes with the staleness that
  earned it. Not a bucket transform in `RollLoops` the way `RollNotes` deals its marks, for three
  reasons and not one: a box's width changes, its two edges take different counts so it has no one
  bucket to sit in, and the labels are a separate layer above the bars that would have to be
  transformed in step. A length change written by a plan is drawn as growth at the body's **tail**,
  which is not always the truth but is the reading `buildPreview` already takes — a box telling a
  truth the bars inside it did not would be the worse of the two answers.
- **`ShiftBoundaries` asked about a loop box's edges** — it answers a **tick**, and a pass's edges
  _are_ the boundaries, which is the one place that rule is discontinuous. Counting at-or-before at
  both edges is right for a tail change by luck and wrong for a head change by a whole delta, and no
  function of the tick can mend it: a box in front of the construct and the construct's own first
  box both sit at or below the first pass's start and want different answers. The changed body's
  passes are asked for by name (`passShiftsFor`, beside `shiftBoundariesFor` for its reason, and in
  **deltas** so it holds still from the press), and every other box takes the marks' rule at each of
  its two edges — inclusive at the left, where an insert always lands inside the box, and inclusive
  at the right only where the box **holds** the pass that boundary is for. That one test is what
  tells an outer loop round a growing body from a subloop sitting at that body's tail, whose edges
  are on the same tick and whose answers are opposite, and what stops the pass in front of an
  opening gap swallowing it. `framePasses` is the one walk `heldPasses` and `passShiftsFor` share,
  so the pass the preview projects a bar into and the box drawn round it cannot count differently.
- **A `selected` flag on `LoopRegionBox`** for the solid outline — the box list is built on the mark
  window's cadence and a selection changes on every click, which is the argument that kept the label
  off it too. `RollLoops` takes the body set as a second input and the template asks it per box, as
  `RollNotes` asks its own `selected` per mark. By **body** and not by the edited channel, unlike the
  label: the group is one text, so a recall on another channel goes solid with its declaration, which
  is what the rings on those notes already do.
- **Reading a note's entering octave off `item.octave` alone** — that number is the octave in force
  **after** the unit's own leading `o`, and `growUnits` puts that `o` inside the `unitSpan`
  `rewriteNote` splices whole; so in `> c+32 r64 < o3 c32` the guard compared the previous note's
  exit against the octave the doomed `o3` had just set, agreed with itself at 3, and let the note be
  rewritten with no octave at all — the `<` then took it to o2, and only the byte oracle could see
  it. A unit carrying its own leading `o` leaves the octave **unknown** (`running = null`), which
  costs a redundant absolute `o` exactly where that leading `o` was redundant anyway and is never
  wrong in the other direction, since `null` only ever adds one. Not the `MOVES_OCTAVE` text scan
  `spawnInto` runs on the same question: it is exact where this is conservative, and it buys the
  tidying with a scan per note and a match that over-reads a comment. The mirror of it is on the far
  side of the unit — `exitOctaveFor` answers `null` where the next note sets its own, which says the
  trailing `o` may go with the rewrite, and there **is** no rewrite for a note whose pitch and length
  are both unchanged (`rewriteNote` returns before spelling anything, and `spliceRange` answers
  `null` for text already there). Reading the note's own octave there made a drag's destination look
  like the octave already standing, so nothing was spelled and the gesture committed nothing at all.
  An untouched unit leaves what its text says.
- **Letting a drum's unit carry an octave `noteText` cannot write back** — `leadsAUnit` takes an `o`
  as well as a percussion `@`, so the unit reaches over the `@` to the octave beside it, and a drum
  is written `@21 c<length>`, the letter having no say in the byte. The splice took the `o` away and
  every note after the drum moved with it, silently. `drumOctaves` **restates** what the unit
  carried, rather than respelling it: the octave is what those notes are standing in and a lane
  change says nothing about it. Not a narrowing of `leadsAUnit` instead — the `o` can be written on
  either side of the `@`, so the leading scan would have to know it was on a drum before it found
  the `@`, and `unitSpan`'s boundaries are where every insertion in `roll-write.ts` is anchored.
- **Sounding a carried selection as one span of the song** — `selectionSpan` over the frame's
  selected notes, handed to `auditionSpan` at the slop transition and silent per row after it, on
  the reading that a group of notes is no more one note than a transposed body is. It answers the
  wrong question: a span is the song where those notes **were**, at the pitch they **were**, played
  once and never again, so it says nothing at all past the first three pixels and a group carried an
  octave up sounds exactly like one carried a semitone — which is the one thing the drag most needs
  to hear. The note under the pointer is the one whose bar follows it, and the whole group moves by
  one delta, so that note names the interval every other note took; `soundDrag` reads
  `items[held.item]` and is already what a single note's drag sounds. The span was not free either:
  a region is a whole silent run of the song plus up to `MAX_AUDITION_SECONDS` of PCM on the one
  worker `playNote` shares, so it also stood in front of the per-row renders that would have said
  something. `auditionSpan` keeps the `Ctrl` marquee and the loop box's edge, where the question
  really is which notes were just picked out.
- **The loop wrap's refusal carried on `Availability`** — that field answers to AddmusicK, and
  `palettetest` holds it to exactly that: a `blocked` entry has to come back from the compiler
  unclean. "Nothing is selected" is the palette's own condition and the snippet compiles fine, so
  every song would have failed the harness on a button that was correctly greyed. `ResolvedEntry`
  carries the verdict beside `availability` and `entryBlocked` is where the two meet, in the mould of
  `placeAvailability` being stacked on rather than folded in.
- **Reading the brackets for that wrap off the walk, or off a parse trace** — both answer the wrong
  question. The walk says what _plays_, where a wrap asks what may be _written_, and the two part
  company on the shape that matters: a `(1)n` recalled from another channel plays a body the text
  there does not contain. A trace of the parser's own `channel` and `inE6Loop` would answer it, at an
  event per dispatch of a compile, where the palette answers on every keystroke.
  `@amk/tokens/commands/loops` mirrors those two variables over
  the token stream instead, which needs no compile at all; `[[` is told from `[` by adjacency because
  that is the test `parseLoopStart` makes, and a hand-written `$E6 $00` pair counts as the subloop it
  is.
- **Starting a wrap's brackets at the first selected note** — honest about the selection and wrong
  about the music. `[` copies the drum remap into slot 8 and the note there clears slot 8 alone
  (`parser.ts:2725`, `:3013`), so a `@21` left outside the brackets is still standing when the loop
  ends and hands the drum to the next note. The run reaches back over the note's own leading `o` and
  `@` through `unitStartBefore`, which is the anchor every insertion in the roll already uses. It
  reaches **forward** over a `$DD` for the mirror reason: the slide is read by the note in front of
  it (`main.asm:L_10E4`), so a `]` written between the two puts the body's `$00` where the slide was.
- **A repeat count on the loop box, or a wheel over its edge to step it** — the box's stroke is nine
  pixels and already carries three gestures, and the count is one number in the text. A wrap leaves
  it selected, which puts the loop inspector on the loop it just wrote with the **Repeats** field it
  already has (`output/loop-inspector/`); an existing loop's count changes from that same field.
- **A loop's Repeats field as a `LETTER_PARAMS` row on `]`** — a `ParamDescriptor` is bound to one
  argument of one command, and three of the five spellings do not keep their count there. `]]4` is
  two `]` commands with the count on the second, and `commandAt` is end-inclusive, so a caret on the
  first bracket reaches the _note in front of it_ and the field was unreachable; a `$E6` carries one
  less than the count it means, so the row would have read 3 for a subloop that plays 4; and a `(n)m`
  raises no `Command` at all, `label` not being in `LETTER_COMMAND_KINDS`, so the panel said "nothing
  at the caret" on the commonest recall in the language. The subject is the **construct**: `loopAt`
  answers off the token stream for a bracket, a count, a label, a `*` and either `$E6` arm, and one
  write path picks `spliceArg`, `insertAt` or `spliceRange` by what the spelling actually wrote.
  `"["` left `letter-params.ts` with it — `parseLoopStart` never calls `getInt`, so digits after an
  opening bracket are music and that row could never be filled.
- **That construct drawn as a card _inside_ the command inspector** — additive over whatever else the
  caret was on, which is the right reading of the subject and the wrong place for it: a loop is not a
  command, so the panel that answers "what is under the cursor" was answering two questions at once,
  and the card pushed a note's own parameters and its palette down the pane on every note of a
  loop-heavy song. `output/loop-inspector/` is its own panel under that one, and it is **absent**
  rather than empty when the caret is in no loop — a permanent "not in a loop" row is a cost every
  song without one pays. The command inspector still stands its parameter table down for a caret on
  a construct's own text (`loopAt`, not `loopFocus` — it needs to know only that the subject is a
  loop) and says in one line where the count went, because "nothing at the caret" is untrue of a `]`.
- **Reading that count off the digits in the source** — `countEnd` scans what is written, and
  `[ c4 ]REP` with `"REP=4"` is written with no digits at all: the scan said "nothing, so 1" where
  `gather`, which sees the expansion, said 4. The count comes off the `Command` wherever a spelling
  gathers one, which is four of the five, and the digit scan survives only as the offset an absent
  count would go at. That is also what gives the field `argEditable`'s per-part macro interlock for
  free, instead of a `spliceRange` that would overwrite the use site.
- **Making a `(n)m` a `Command` in `gather` instead** — the tidy-looking fix, and it moves far more
  than it mends: `label` covers `(!n)`, `(!n,t,a)`, `(!!n)`, `("kick.brr",$02)` and `(@5,$02)` too,
  `roll-strip.ts:discoverLoops` pairs `[`/`]` commands **by depth**, and `commandScope` would have to
  learn a sixth structural kind — all so that one panel could ask a question `readLoops` was already
  answering.
- **The roll's loop hint read as a fact about the caret rather than as a redirection** — a press on a
  box's edge leaves the caret on the body's _first note_, so a hint honoured wherever it was set
  would go on answering about a pass clicked long ago. `EditorRequests.inspectingLoop` only ever
  moves a construct `loopFocus` has already listed to the head of that list, and only while the caret
  is inside the body it named. Matched on the **body span** and not on the label, because an
  unlabelled `[ ]` recalled by a `*` has no name for `discoverLoops`'s reading and `readLoops`'s to
  agree on; `palettetest` pins both directions, the hint honoured and a hint for another body ignored.
- **A free number field for which loop a `(n)m` recalls** — `parseLabelLoop` refuses a label that is
  not in `loopPointers` yet (AMK0115), `parseLoopStart` refuses a second declaration of one
  (AMK0124), and `parseLabelLoop` refuses `n + 1 >= 0x10000` (AMK0114), so a number field would have
  had to guard three errors to offer one useful value. It is a select over `loopTargets` — the
  labelled bodies opened _above_ the call, which is `loopPointers`' own contents at that point in the
  parse — and a `(!n)` is never among them: it would compile to a `$E9` into a body only a `$FC`
  should reach.
- **Renaming a loop from that same control** — the label is what every `(n)m` in the song names this
  body by, so changing it points every one of them at a label nothing declares, silently and across
  channels. A body with **no** name is offered one, which breaks nothing because nothing can be
  calling it yet; a name already written is never touched.
- **Keeping the palette's `*` button** — `*` takes `prevLoop`, the last `[` opened
  (`parser.ts:parseStarLoop`, Music.cpp:1321), so what it plays is decided by where it is written and
  by nothing a porter can point at, which is the one loop shape the roll cannot draw a handle for.
  **Loop call** writes a `(n)m` naming the nearest loop declared above the caret — nearest because
  that is what "again" means, and _above_ because `parseLoopStart` files `loopPointers` at the
  opening bracket and a call below is AMK0115. A `*` already in a song still reads, still draws and
  still edits, and its **Recalls** row is how it gets a name.
- **The roll publishing its selection as strip indices** — an index means nothing outside the
  component that built the strip, and the panel that wants it is in the output pane.
  `EditorRequests.selectedRun` carries the **span** from the lowest selected unit to the highest,
  which is the one currency every panel already speaks. By offset and not by strip index: a body's
  items are a frame appended after the root's, so `Ctrl+A` over `c4 [ e4 ]2 d4` has its last index
  inside the body while the run really ends at `d4`. Whether the run may take a bracket is
  `wrapVerdict`'s question — it widens over a construct the run covers whole and refuses one the run
  cuts through, `WRAP_SPLIT`, which is `REFUSE_SPLIT` reached by another route.
- **The loop box's transpose planned in the grabbed body's frame alone** — a body's notes are its
  frame's items and a loop written inside it is an opaque `'construct'` there, so
  `[ c4 [[d4]]2 e4 ]3` dragged up moved `c4` and `e4` and left `d4` sitting under a box drawn round
  it: `buildLoopRegions` grows a box to every note whose tick falls in the pass, so the handle's
  picture and the gesture's reach disagreed with nothing to say so. The press takes the frames
  written **inside** the one it grabbed (`framesInside`) and the gesture is planned once per frame
  and committed once (`planFrames`, `planGroupEdits`) — the split `run()`'s delete already made, the
  rule being not that a deletion is special but that an edit **moving no tick** may cross a bracket,
  frames being disjoint text. By text span and not by a construct's body address: a `(n)m` written
  inside a `[[ ]]` may recall a body declared outside it — `parseLabelLoop` refuses only
  `channel === 8`, so it is out inside a `[ ]` and in inside a `[[ ]]` — and transposing that from
  here would move music elsewhere in the song. The **pad** is the piece that belongs to the gesture
  rather than to a frame: two frames each padding the other channels out to their own reach writes
  the rest twice, `coalesce` running inside a plan and not across them, so it is priced once
  (`planReach`) and only the frame reaching furthest writes it. `playsFor` cannot catch that — an
  over-padded channel stops being the shortest and the song's figure does not move — so
  `rolltest`'s `channelTicks` reads the padded voice's own count. And the costs are taken rather
  than worked around: `selectedBodies` finds the inner body whole too, so both boxes close up solid,
  and `selectedRun` is the whole group's text, which `wrapVerdict` reads as a run inside a loop
  holding a subloop and refuses as `WRAP_DEEP`.
- **The instrument picker normalising every pick to a plain `@n`** — the whole set is then always
  available and one splice serves all three spellings, and it rewrites text the author chose: a
  click on a dropdown turned `$DA $02` into `@2` and `@@5` into `@5`. Only the argument moves, in
  that spelling's own numbering (`instrumentByte`), and an instrument the spelling cannot express is
  not listed — so `@@` and `$DA` offer no drum, neither being able to write one, and `#am4`'s `$DA`
  writes a custom instrument from `$13`. The map and its inverse live in one file so `edittest` can
  round-trip them: a list built on one reading of the bands and a write built on another offers one
  instrument and selects a different one, and nothing about the numbers on either side can see it.
  Not labelled by the sample each instrument resolves to, either — the names are SRCN-indexed and
  a song's own `#samples` moves them, where the number is what the source says. `@19` and `@20` are
  not offered at all, emitting nothing; a caret already on one still shows it, through
  `amk-enum-select`'s unknown-value option, which is what keeps the control from claiming the
  document says something it does not.
- **The loop join guarded by `holdsCommands` over the text between the two calls** — it reads
  `strip.commands`, and the intro `/` is not one of them: `gather` raises no `Command` for an
  operator (`tokens.ts:810`), which `prefixCommandsOf` already says out loud. So `[c4]2 / r4 *2`
  closed and joined wrote `[c4]4 /` and moved the song's loop point by the grabbed occupation's
  whole length, with every note still on its tick and nothing in the walk to say so — only
  `loopTick` catches it, which is why `rolltest`'s case asks `loopsWhereItDid`. What may stand
  between the two is asked of the **text**, which must be blank once the rests go; that also turns
  away a `;` comment and a stray `o5` that would in fact have been harmless, and that is the trade,
  since the safe set cannot be enumerated from a list the dangerous member is not in. The split
  writes exactly `head first  r… head second`, so the round trip never meets the refusal.
- **A `REFUSE_*` where the joined count passes 255** — every refusal in `roll-edit.ts` names music
  the gesture cannot make, and this names a count that cannot be _written_: `(1)200 (1)100` is the
  same music as the `(1)300` that has no spelling (`parser.ts:2492`, `:2792`, `:2836`, AMK0116),
  and the pass has already moved exactly as far as the drag asked. It falls back to the plain
  close. Not `closeBefore`'s reasoning either — `REFUSE_LOOP_LEAD_ROOM` refuses a **partial**
  close, where this is a spelling laid on top of a complete one. A join is offered on no zero gap
  for the mirror of that reason: with the two calls already touching the drag moves nothing, and a
  gesture whose only visible effect is in the Source tab is worse than none.
- **The joined count read off `passesAt().before`, or off the digits** — the first counts every
  earlier pass of the body the voice plays, so `(1)[c4] (1)2 r4 (1)3` joined as `(1)6`; the partner
  is the **nearest** sibling, which is the only reading whose tick arithmetic closes. The second is
  the trap `loop-focus.ts` already records: `[ c4 ]REP` under `"REP=4"` has no digits, and a `*` or
  a `]` at one pass has none either. Both halves come off `LoopRun.passes.length`, which is the
  written count in any song that builds a strip — `walkSong` runs every channel to its own `$00`
  and filters only `notes` at the pass cut, so a construct past the shortest channel is
  `verified: false` with all its passes still there.
- **The selected command's `Delete` falling through to the notes where the command cannot go** —
  a `"name=value"` command's span is collapsed onto the call site, so `eraseCommand` answers `null`
  and the branch would have handed the key on to the note selection: a press aimed at a chip that
  is visibly outlined would silently delete five notes somewhere else. The key is taken whenever the
  caret is on a command the roll draws — `inspectable`, the lane's `'song'` and the bars'
  `'note-state'` scopes — and a command that cannot be removed does nothing. Not on `commandAtCaret`
  alone: a note is a `Command` too and every click on a bar puts the caret on one, so an ungated
  branch would splice the note's own text out in place of the delete gesture, and would take an `o`
  or an `l` nothing on screen rings. It sits **ahead of the channel guard** for the reason the lane
  picks no channel — it holds all eight and a `t` belongs to none of them — and it takes only the
  first press of a held key: the caret lands where the command was and `commandAt` is end-inclusive,
  so a repeat would take the neighbour nobody selected.
- **`inspecting.set(null)` taken as the lane letting go of the selected note** — "the selected note"
  is two things, and the lane owned only one of them: `EditorRequests.inspecting` is the occurrence
  the inspector is describing, where the outlines in the roll are `gestures.selection()`, a set of
  indices into a strip the lane has never seen. So `PIANOROLL.md` said a lane click let the note go
  and the bars went on showing every one of them outlined, with `Delete` then ambiguous between the
  command that had just been picked and eight notes still lit. The lane emits `commandPicked` and the
  roll clears, in the mould of `RollNotes.channelPicked` — the selection is the roll's, as its
  settings are. `RollNotes` emits the same output for the same reason; what the two do differently is
  `inspecting`, the entry below.
- **A bar's chip leaving its note outlined, so a commit from the panel had something to replay** —
  it conflated two things that are not one. The outline is `gestures.selection()`, what a gesture
  would act on; the replay reads `EditorRequests.inspecting`, which occurrence is being described.
  Keeping the first to get the second put a note and a command on screen as subjects at once, with
  `Delete` meaning one of them and nothing saying which. The chip clears the outlines and keeps
  `inspecting`, so the commit is still heard; the lane clears both, having no note to describe.
  Cleared on the **`click`** and never on the `pointerdown`, which is the whole reason a press and
  hold on a chip still drags the note: the press is not taken there, so it reaches the gesture layer,
  which captures the pointer past the slop and leaves no `click` to fire. The overflow dots are the
  one plate exempt — they stand for a list rather than a command, so they have no handler at all and
  the click falls through to the bar, which selects that note.
- **The bar's selection ring in the lane's `stroke-ink`, the way the lane draws it** — sound in the
  lane, where nothing wears the inverted plate, and invisible on half the chips of a bar, where a
  defining one does: a near-white ring round a near-white plate is the same value as the thing it is
  drawn around, and reads as the plate being a pixel bigger rather than as a selection. Moving it
  clear of the plate is no answer either — the chips are packed within a few pixels of each other, so
  the ring would meet its neighbour's. It takes the **pair of colours the plate already uses**, which
  is the axis `roll-notes.html` settled on for the icon: `stroke-surface` over a defining plate,
  `stroke-ink` where there is none, so the ring reads against whatever is behind it on all eight
  channels. Drawn over the plate rather than under it, for the same reason.
- **Ringing a bar's `more` dots when the selected command is one they stand for** — the plate
  already inverts on those terms and the symmetry is inviting, but `defining` is a property of the
  list where a ring is a claim about one command, and the dots stand for commands the bar has no
  room to show: an outline round them says "it is here" about something that is not drawn. It is
  also the one mark with no handler and no span to reveal, so the ring would point at nothing
  clickable. `MarkGlyph.command` rings the glyphs that are drawn, and the lane, where every command
  appears, is where one behind the dots is found.
- **A note's Length row as a `ParamDescriptor` over `command.args`** — a descriptor is bound to one
  argument of one command, and a note's length is not always in an argument: `c` under a standing
  `l8` writes no digits at all, so `resolveCommand` built no rows and the inspector said "this
  command takes no arguments" about a note plainly 24 ticks long — which is the commonest way a song
  is written, one `l` at the head of each channel and bare notes under it. `c^8` writes one number
  for two segments, so row 0 was labelled `Length`, bound to the tie's `8` and described from the
  head's implied length; and `c0` writes one `getNoteLength` throws away. The subject is the
  **segment**, which `NoteLengthSegment` already is, and `note-length/length-rows.ts` is where the
  eleven spellings are told apart and each one's splice chosen — `insertAt` where no digits were
  written, `spliceRange` over the digits alone where they were. The digits and nothing else, because
  a segment's dots compose rather than add (`Music.cpp:2950`): the number that keeps `l8 c.` at 36
  ticks is `8`, and a span reaching over the dot would write the 4 that 36 ticks is without one.
  `denominatorFor` is what makes that safe in the other direction — it answers only an `n` that,
  written, reproduces the length the segment already plays, and `null` where none does, which is a
  dotted or exact `l` and an `=NN` on the note. Not a per-row write target on `ParamRow` either: the
  generic table is one loop over `command.args` and a note-shaped exception in it would be paid for
  by all sixty commands.
- **Taking the digits back out when a slider lands on the `l`'s own value** — it reads as tidy and
  it is a trapdoor: the note would go back to answering an `l` edited later, so a length the porter
  had chosen by ear would move on its own the next time the default did. Digits are written and
  never removed; `c8` under an `l8` is a note that has been given a length of its own.
- **Dropping the roll's selection on every change to the document, and again in every commit** — it
  is a set of indices into a `Strip`, and the strip is rebuilt from text the roll may not have
  written, so clearing was the only answer that could not be wrong. It made the inspector unusable
  on a note: the Length slider commits, the document changes, and the note the panel is answering
  about loses its outline in the roll beside it — and the roll's own resize cleared twice over, once
  at the commit and once at the change that commit caused. The **document change** is the one place
  it is decided (`sourceChanged`), and no commit clears any more, which is also what lets an outline
  stand through the compile the roll spends with no strip at all. A panel's splice rewrites one
  command's own text and adds and removes no item, so the indices still name their notes
  (`EditBatch.keepsNotes`, which the lane's own command writes claim too, counted by the **view** in
  `dispatchBatch` because a batch whose `expect` has gone stale is dropped in silence and a count
  taken where the batch was asked for would run ahead of the document — and the loop inspector's
  Recalls is the one panel commit that says no, the body a call plays being part of the calling
  channel's strip); a gesture leaves
  anchors saying where each note went — its frame, and its place among that frame's notes
  (`plannedOrdinals`, `roll-selection.ts`), which within a frame is text order and tick order at
  once and is what `planEdits` writes in. Every note the selection named and the plan still carries,
  not only `touched`: a stretch pushes its neighbours, and one of those the porter had hold of is
  still theirs. Not the tick, which a length change moves for every note after it, so a group would
  lose everything past the one edited; not the address, which every byte written before it moves —
  `emitNote` drops a repeated duration byte, so writing a length shifts the rest of the channel; not
  a source offset mapped through the splices, since `growUnits` widens a unit over the very `o` a
  commit inserts at a note's head and a note carried past a neighbour has no offset to map at all,
  `crossings` lifting it out of the text and writing it back on the far side. The pitch is confirmed
  on the way back in rather than trusted, so the worst a wrong claim can do is take an outline off —
  by the `@` alone for a drum, whose letter says nothing and whose drawn form is handed the row's
  own `c`. The loop box's gap and resize carry none: neither goes through a `Plan`, and `resizeLoop`
  moves the brackets, so notes cross into and out of the body. And `selectedSpans` is **held** across
  the recompile rather than emptied, in the mould of the clock measurement — the bars drawn for that
  whole compile are the last one's, so the last one's addresses are the ones that outline them.
- **The channel mixer and the roll's picker naming their channels without tinting them**, so that
  `--color-ch-*` lived in the roll's marks and the minimap alone — it made the two controls that
  name a channel the two pictures that would not show its colour, and matching a note seen in the
  roll to the chip that edits it or the buttons that silence it meant reading a digit off eight
  identical grey plates. Both wear the channel's own colour now, from the literal `bg-ch-*` names
  spelled out for the reason `CHANNEL_FILL` gives, with `text-ink` over it because that is what the
  roll's own bars label themselves in on those same eight grounds. The rule the old shape was
  protecting is untouched: the number stays, a silenced channel is still struck through, and the
  eight still do not clear the all-pairs separation gate. What the fill can no longer say is which
  chip is being **edited**, and that is a near-white ring rather than a dimming of the other seven:
  dimming is what a silenced channel already means, and it would have said a channel was inaudible
  for not being edited. The solo's own ring is not a blue either — a mid blue disappears into
  `--color-ch-0` and `--color-ch-6` — so it is a dark ring against the
  edited one's light, which is the lightness axis the eight leave free and the same one the roll's
  glyph plates are told apart on. It yields to the edited chip where one is both — an element has
  one ring, and a solo says itself anyway, being the channel the strike-through has left alone.
- **The palette's class names living in `piano-roll/roll-metrics.ts`** — the mixer is not part of
  the roll, so it would have had to reach into it or keep a second copy of `bg-ch-*` under the same
  name, and a chip that disagreed with a bar about which blue channel 0 is would be worse than no
  colour at all. `util/channel-palette.ts` is the one home for all five arrays; `roll-metrics.ts`
  keeps the geometry and the two muted opacities, which are the roll's own.
- **Routing a drawn note's frame off `StripFrame.runs` whole** — a frame carries **every** voice's
  runs of its body on purpose (`discoverLoops`), because a body declared on one channel and recalled
  from another moves both voices when its length changes, and `shiftBoundariesFor`, `framePasses`
  and `planReach` all read them to say so. A press is the one reader they are wrong for: with a body
  declared in `#3` and recalled in `#4`, `frameAt` found `#3`'s pass over ticks `#4` was nowhere
  near, so a note drawn on channel 4 was written between `#3`'s brackets and played on every pass of
  both voices — and the channel-3 box grew round it while the pointer was down, `BodyRows` being
  keyed by body. It filters on `strip.channel`, as `firstPassOn` and `passesAt` already do, which
  also puts it back in step with `StripItem.instances`: `expandAndJoin` fills those from this
  channel's runs alone, so `itemAt` and `constructFor` were already channel-correct while `frameAt`
  was not. In `roll-edit.ts` for `shiftBoundariesFor`'s reason — a harness cannot drive an Angular
  composable, and `rolltest`'s `planFor` took a gesture's frame from its first item, which a `spawn`
  has not got, so every draw case ran in the root frame and `frameAt` was never executed at all.
- **Dealing the roll's marks into shift buckets from the press** — `shiftBoundaries` answered off the
  held frame alone, so a press on a note inside a `[ ]` body raised the boundaries before anything
  had moved and `RollNotes.buckets` re-parented every bar past the body's first pass end into a
  bucket `<g>` of its own. A bar re-parented while the button is down is destroyed before the
  release, and the browser raises no `click` on a node that has gone: a click on any pass of a loop
  but the first never reached `roll-notes.ts:select`, so the inspector's question and the double
  click's go-to were both lost — silently, and with the ring and the caret still moving, since
  `onPointerUp` sets the selection itself and `askAboutSelection` answers off that. The deal waits
  for `underWay`, the three things `shownPlans` is already drawn on, whose transition is the slop:
  the pointer is captured there and there is no click left to protect, and it never goes back down
  within a gesture, so the boundaries are still dealt once per gesture. Not a guard on the delta
  instead — it flips back at every zero crossing of a length drag, and a re-deal is a rebuild of
  every bar on screen.
- **A lane glyph clearing `inspecting`, as naming a command of the song rather than a note of it**
  — true of what the glyph is and wrong about what a commit from its panel should sound: a `v`
  picked there previewed nothing, where the same `v` picked off a bar's chip replayed the bar's
  note. The lane points `inspecting` at the note the command is **heard on** (`noteHeardOn`): the
  first on its channel, still sounding at the tick or beginning after it, whose commands in force
  hold it — the bar that would draw it as a chip, which reaches back to the note a `$DD` rides and
  steps over one a command was read inside a tie of; a `'song'` command, which no bar draws, takes
  the next note to begin. Off `commandsInForce` and not off the tick alone, so the lane and the
  bars cannot name different notes for one command; `walktest` pins the seven shapes.
- **A Normalize button, and the parse trace and walk-comparison oracle behind it** — eight
  text-to-text passes over a trace of the parser's state at every dispatch, each result compiled,
  walked and compared against the walk of the original before the document was touched, offered on
  both toolbars and beside every refusal in the roll. It was written to make a song editable in the
  piano roll, and the roll went the other way: it took loops over in place, reads a note's octave
  off its own byte and its length off its own text, and no roll code ever read the trace or the
  oracle. What was left was four refusals it could clear — `&`, `"name=value"`, `{ }` and music
  above the first `#N` — for some 2,800 lines, a trace the parser gathered on request, and a button
  standing beside a dozen refusals it could not clear. The roll edits the song as written and says
  what it refuses; the parser records the command map and nothing else. `SST06xx` is retired with
  it — a new editor-side diagnostic takes the next band, not this one.
- **The theme's default colours written a second time in TypeScript**, beside the `@theme` block
  they came from — two sources of truth for one set of colours, and the first edit to either would
  have moved them apart with nothing to notice. `readDefaults` reads them off the document with
  `getComputedStyle` at construction, before the store's own effect has written anything: a
  stylesheet is render-blocking, so it is parsed before Angular bootstraps, and an unregistered
  custom property comes back as it was authored rather than computed. `styles.css` stays the one
  definition, and `@theme static` is what guarantees all of them reach `:root` — Tailwind emits a
  theme variable only where something uses it, and a reset is `removeProperty`, so a token no
  utility happens to name still needs its default sitting there to fall back to.
- **Storing the whole palette rather than only what was changed** — it reads as the simpler shape
  and it freezes a porter on the defaults of the day they first opened the picker: change one
  colour, and the other twenty-four stop following the app for good. `ThemeStore.overrides` holds
  only the tokens moved off a default, which is also what makes a per-token reset exact rather than
  approximate — the property is removed and whatever `styles.css` now says shows through.
- **Re-hueing the eight channels for a preset's chrome** — the set is validated once, against the
  default `--color-surface` `#1e272e`, and every shipped preset's surface is darker than that
  (Graphite `#191919`, Midnight `#16181d`, Contrast `#0a0a0a`, Warm grey `#1a1918`), so under each
  of them every channel's contrast only rises and the worst pair stays above 3:1. The one direction
  that would need re-validating is a **lighter** default, and `#1f282f` is where ch-5 crosses 3:1.
- **The controls painted in `--color-accent`** — a primary button's plate, a checked box, a slider's
  fill and every toggle were the same token as the playhead, the lit keys, the caret and a syntax
  keyword, so there was no way to recolour the chrome without taking the roll's own markers with it.
  `--color-control` is its own token, and `primary` is told from `default` by weight and a tint of
  it — `bg-control/15`, a `border-control/60`, a medium label — rather than by a hue of its own.
  `danger` keeps its hue, saying something the shape of a button cannot. The focus ring stays on the
  accent: it is an affordance rather than a decoration, and it is the one place the music's colour
  reaches the chrome.
- **The source view's colouring drawn from the app's palette** — twelve tags in `TOKEN_TAGS` sharing
  eight shared tokens, so re-colouring the notes moved the body text with them and re-colouring the
  loop brackets moved every severe warning, and the one surface a porter looks at for hours could
  not be touched without disturbing the chrome. `--color-syn-*` is one token per tag, shared with
  nothing, defaulting to what the shared tokens used to give so the source reads as it did. The
  editor's _structure_ stays on the app's palette on purpose — a gutter, a tooltip, the caret and a
  diagnostic's underline are chrome and findings rather than MML, and a porter re-colouring their
  notes is not asking for a different error underline.
- **A preview folded into the stored overrides** — `<input type="color">` reports every step of a
  drag through the operating system's picker on `input`, so that is a synchronous `localStorage`
  write per frame of a drag. `ThemeStore.previewing` is a transient signal laid over the stored one,
  which is the `preview`/`commit` split `Slider` and `NumberField` already make.
- **The view tabs in the editor panel's header, with the development notice beside them** — a
  header that is a tab strip and a warning at once says two things in one row, and the notice was
  the one thing on it that no view owned. The pane opens with a tab row of its own (`amk-tabs`, each
  `TabDef` carrying its icon and whether it sits `aside`), Samples set apart on the right because it
  is a library and not a view of the song, and the notice is the status bar's, beside the compile
  status it belongs with.
- **Hot Reload, Loop and Follow playback as checkboxes** — a checkbox is a form field, a value
  waiting to be submitted, and each of these is a mode the transport or the roll is in. They are
  `amk-toggle`s, a button whose lit plate is the state, as Scroll the notes, All octaves, word wrap
  and Percussion are; the project ships no ARIA, so the plate is the whole of what says which state
  a toggle is in.
- **The compile status in the output panel's header** — it took the one line that could name what
  the pane holds, so the sidebar could not say it was the Inspector. The status bar holds it
  (`status-bar/`), with the problems count beside it, and the sidebar's headers name their sections.
- **The sidebar ordered stats, ARAM, diagnostics, inspector, hex dump** — the inspector is what a
  porter edits with, and it sat under three sections read once a session, so on a short pane it was
  off the bottom on every click in the source. It is the **Inspector** section first, the command
  inspector with the loop inspector under it; **Build** — stats, the ARAM budget, the hex dump — is
  collapsible under that; and **Problems** is pinned below the scroll column with a count badge,
  because a diagnostic has to stay in view whatever height the inspector takes.
- **The sidebar's sections as native `<details>`** — an element that opens on its own click and
  tells nothing about it, so the ARAM meter in the top bar and the problems count in the status bar
  had no way to open the section they point at. `amk-section` carries `open` as a model, persisted
  per section (`solar-soundtrack.build`, `solar-soundtrack.problems`), and
  `EditorRequests.revealSection` is the request: the pane opens the section, unfolds the drawer,
  scrolls to it and puts the signal back to `null`, so the same section can be asked for twice.
- **The two panes stacked below `lg` with no seam between them** — a sidebar at its content height
  under the editor pushed the editor off a tablet's screen, and nothing on it could be made shorter.
  Below `lg` the sidebar is a drawer (`solar-soundtrack.drawer`, `solar-soundtrack.drawer-collapsed`):
  a row-resize seam over it in the column splitter's mould, and a fold that takes it down to its
  header, so the editor keeps the screen and the sidebar is a pull away.
- **`--color-control` a neutral grey** — a chrome with no hue at all reads as unfinished rather
  than as calm, and the reason the token is separate from `--color-accent` never needed it to be
  grey. It is a steel blue a step lighter than the chrome (`#7ea6c4`), so a button reads as the
  toolbar's own material; the accent is the orange (`#ffa53a`) and still means one thing, _this is
  where the music is_ — the playhead, the lit keys, the caret and the focus ring.
- **The default surface at `#191919`** — a neutral grey ground and the four greys around it. The
  default is the Studio blue-grey, in the mould of the DAW the editor's interactions are drawn from —
  `surface #1e272e`, `raised #2f3c45`, `inset #171f25`, `edge #42525c` — and it carries a ceiling:
  the eight channels are validated against `#1e272e`, ch-5 crosses 3:1 above `#1f282f`, and the
  default may not be lighter than that without re-validating the set. The grey is the Graphite
  preset, a snapshot of the fourteen tokens it moves.
- **The mixer's solo `S` lit on `bg-control/25`** — considered and refused for the reason the
  picker's solo ring is not a blue: the control blue is a mid blue, and a mid blue vanishes on
  `--color-ch-0` and `--color-ch-6`. A lit `S` takes the channel's own colour, the one ground it is
  certain to be seen against, and the strip's number is what names the channel either way.
- **The theme picker and the changelog each carrying a trigger, a panel, `Escape` and the
  outside-press close of their own** — two copies of one drop-down, and the second edit to either
  would have moved them apart. `shared/popover/` is the one: a ghost icon trigger, a heading, a
  scrolling body and a footer row that hides itself when nothing is projected into it. The two
  components project their icon and their content and keep only what is theirs — the picker its
  rows and its import, the changelog its entries.
- **The roll toolbar's readout line** — `editing: #0 · tick 7,534 of 14,592 · t55 · 109.4 ticks/s ·
3,468 notes`, rewritten twice a second while playing. It said five things in one place, four of
  which were not the roll's: the channel is what the corner picker already shows, the note count is
  a fact about the song and sits in the status bar whatever view is up, and the tick is the
  transport's, whose clock well shows either m:ss or `tick N / M` and flips on a click
  (`solar-soundtrack.clock`). The tick face runs on the roll's own display clock (`rollClock`) at
  frame rate rather than on a half-second sample, so the number and the line it stands for cannot
  disagree, and `slowTick` went with the readout. The tempo and the tick rate are the status bar's
  too, read at the playhead — the driver's tempo while it plays and the walk's last `t` otherwise —
  so a song the driver cannot keep up with says `231.9 of 498.0 ticks/s` from any view. What stays
  on the toolbar is what only the roll can say: how many notes are selected, and why a channel or a
  gesture was refused.

## Angular specifics

Angular 22, zoneless (scaffolded `--zoneless`, so zone.js is not a dependency and there is nothing
to opt into), no router, no NgModules. Signals throughout: `signal`/`computed` for state, `effect`
reserved for mirroring into imperative sinks (localStorage, the player, the DSP). State lives in
ten `@Service()` singletons in `web/src/app/state/`. The spine runs one way, `DriverStore` →
`SampleStore` → `EditorStore` → `Playback`; `ClockMeasurer` feeds `EditorStore`, `Audition` hangs
off it beside `Playback`, `Mixer` hangs off it and is read by both of those and by the roll, and
`CommitAudition` is the command inspector's write path over `EditorRequests` and `Audition` — a
panel's commit replays the selected note once its compile lands. `EditorRequests` and `ThemeStore`
depend on nothing at all, and nothing depends on the second either: it puts the porter's colours on
`<html>` as inline custom properties, and everything downstream reads those as CSS rather than
asking the service. `web/README.md` has the rest.

Selector prefix is `amk` — `amk-root`, `amk-editor-pane` for components, camelCase `amk*` for
directives. ESLint enforces both.

Styling is Tailwind v4, with the entire theme as CSS variables in `web/src/styles.css` (v4 has no
`tailwind.config.js`). Dark-only on purpose. Two **validated categorical sets** live there —
`--color-seg-*` for the ARAM bar and `--color-ch-*` for the eight music channels — and neither may be
reordered or re-hued **in that file** without re-validating, since adjacent-pair CVD separation and
contrast against `--color-surface` are the properties being preserved. The order is the mechanism,
not decoration: it is what the adjacent-pair check runs against. The ground is part of the
validation too: both sets are validated against `--color-surface` at `#1e272e`, every check passing
and the worst contrast at ch-5 (3.07:1), and the eight drop below 3:1 above `#1f282f`, so the
default surface may not be lighter than that without re-validating. `--color-ch-*` does not clear
the all-pairs gate and no set of eight can, so nothing may leave channel identity to colour alone;
`styles.css` says what carries it instead.

Those values are **defaults**, and `ThemeStore` lets a porter override any of them — the eight
channels included — from the top bar's picker. That is not a hole in the paragraph above, it is what
the paragraph's last sentence buys: the app never said anything with a channel's colour that it was
not also saying with a number, a tooltip or a strike-through, so a porter putting two channels on
one hue loses a convenience and breaks no claim. What still has to be re-validated is a change to
the defaults themselves, which is the set every porter starts from. A preset in
`theme-presets.ts` is held to the same bar and none of the shipped five touch the eight.

Framework-generic Angular 22 conventions (signal APIs, `@Service()`, host bindings, control flow)
live in `web/.claude/CLAUDE.md`, which the Angular CLI generated via `--ai-config=claude` and can
regenerate. Keep project-specific guidance here instead, so that file stays safe to overwrite.

## Formatting

Prettier owns the whole workspace, in two profiles split by layer — `web/src/app/` at 2 spaces,
single quotes, width 100; `packages/` and `scripts/` at tabs, double quotes, width 120, carried over
from the pre-Angular prototype so the port can still be diffed against AddmusicK's C++. Both are in
`.prettierrc`, with matching `.editorconfig` sections so editors agree; **change both or neither**.
Never hand-format — run `npm run format`, and `npm run check` fails on anything Prettier would
rewrite.

`endOfLine` is `"auto"` because the working tree is CRLF. Prettier's `"lf"` default makes every file
fail `--check` for reasons that have nothing to do with formatting.

Two regions carry `// prettier-ignore`, both because reflow destroys information rather than because
someone preferred the old layout: the MML command dispatch in `parser.ts`, which is a lookup table
one line per case, and the one hand-annotated byte table in `selftest.ts`, where each line is a
little-endian word with its own comment. Add a marker only for that kind of reason, and say what it
is.

Reformats are listed in `.git-blame-ignore-revs`. Enable it with
`git config blame.ignoreRevsFile .git-blame-ignore-revs` so `git blame` on the ported compiler keeps
pointing at the port.

## Linting

`eslint.config.js` at the root is where the conventions above stop being prose. One config for every
workspace, run as plain `eslint` — `ng lint` is only a wrapper, and flat config does not walk up
from `web/`, so a second config there would drift.

Rules that exist to hold a property the codebase already has (`prefer-signals`,
`prefer-service-decorator`, `inject-at-top`, `consistent-type-imports`, and the template rules) are
set to `error` rather than `warn` — though `--max-warnings 0` means a warning would fail the run
just the same, so the level says which of the two a rule is rather than whether it bites.

Several rules are deliberately **off**, each with its reasoning inline in the config. Read that
before switching one on: `no-unnecessary-condition`, `template/no-duplicate-attributes` and
`template/button-has-type` report only false positives here, and `template/no-call-expression`
cannot tell a signal read from a method call, so it flags 405 correct lines. The bug that last rule
would catch is kept out structurally instead.

One block sits **after `eslintConfigPrettier`**, and has to: it holds `curly` and
`padding-line-between-statements`. Neither is something Prettier can do — it never adds braces and
never inserts blank lines, only collapses them — so this is the one place where layout is a lint
rule. `eslint-config-prettier` switches `curly` off, so setting it in any earlier block would be
silently undone. `npm run lint:fix` fixes both; run `npm run format` after it.

To prove the scoping is what you think it is, diff `npx eslint --print-config` over
`packages/mml-compiler/src/parser.ts`, `packages/spc/src/fir.ts` and `web/src/app/app.ts`. Those
resolve 1, 121 and 146 rules respectively.

## Deployment

`.github/workflows/ci.yml` lints and checks every push and PR; pushes to `main` additionally build
with `--base-href=/<repo-name>/` and deploy `web/dist/solar-soundtrack/browser` to GitHub Pages. The
build must go through `npm run build` rather than `ng build` so the prebuild hooks still run. The app
is a PWA (`web/ngsw-config.json`); the service worker is enabled in production builds only.
