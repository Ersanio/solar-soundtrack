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
scripts/                fifteen byte-level harnesses
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

| Command             | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `npm start`         | Dev server on `http://localhost:4200/`.                              |
| `npm run build`     | Production build into `web/dist/`.                                   |
| `npm run watch`     | Dev-configuration build with `--watch`, no server.                   |
| `npm run lint`      | ESLint over every workspace.                                         |
| `npm run format`    | Prettier over the workspace.                                         |
| `npm run typecheck` | The app. `:packages` and `:scripts` cover the rest.                  |
| `npm run check`     | The merge gate: formatting, three typechecks, all fifteen harnesses. |

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
- **`generate-git-info`** — writes `web/src/app/git-info.generated.ts` for the toolbar's commit link
  (generated, gitignored). Captured once at startup, so it goes stale if you commit while
  `npm start` is running; restart to refresh.

### Tests

There are no `.spec.ts` files, and no `npm run test` — the suite is the fifteen harnesses under
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
warning, the tempo shortfall and the `#path` notice are `SST05xx`, the normalize refusals are
`SST06xx`, and `SST0301` guards `compile()`'s own ARAM argument. A new diagnostic takes the prefix
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
- **Unrolling loops from the text alone, or decompiling the walk into MML** — a `[ ]` body is
  compiled once, under the parse-time state at its `[`, and replayed from bytes, so copying its
  text n times replays `<`, `>` and the drum remap's clearing n times, and a `(1)n` called from
  another channel parses the body under that channel's `o`, `l` and `h`; and bytes cannot say what
  was written. The parser records the state each body was compiled under (`ParseTrace`, gathered
  where `commandMap` is), the rewrite is text to text (`normalize.ts`), and the walk of every
  pass's result is compared to the walk of the original before anything reaches the document
  (`state/normalize-song.ts`). No `h` is ever written either: it replaces the instrument's tuning
  rather than adding to it, so `h0` is not "no transposition".
- **Normalize refusals in the roll's problems strip** — the button is on the Source toolbar too,
  which has no strip, and a refusal is the answer to a click rather than a property of the song.
  The dialog that asks before the rewrite (`editor/normalize-button/`) is where a refusal shows,
  and a song already in shape gets the same dialog rather than a click that does nothing.
- **A strict one-to-one gate between the walk's notes and the roll's strip** — `walkSong` ends the
  pass at the shortest channel in use and sets everything after it aside as `unreachable`, so a
  channel longer than the shortest is the commonest shape a song has and an equality check refused
  editing on nearly all of them, pointing at Normalize, which does not fix it. The agreement is a
  **prefix** (`agreesWithWalk`), and the items past the cut are editable and carry `verified: false`.
- **Deciding a push's direction per neighbour**, by which half of each one the overlap lands on —
  A shoves B right, B shoves C right, C shoves B left, and it never terminates. The half-rule picks
  the direction at the _first_ neighbour, which is the one the porter can see, and the cascade keeps
  it: every later shove then moves a note strictly away over a finite ordered set.
- **`unreachable` in `timelinesAgree`** — sound-looking and wrong: unrolling changes the list by
  construction, since a note inside a `[ ]` is dropped once per replay and the copies it becomes are
  separate addresses. `channelTicks` is what holds a channel's tail to account. `normalizetest`
  caught it.
- **A trailing octave run winning over a leading one** — in `c4 o5 d4` the `o5` is adjacent to both
  notes, and two edit units claiming it produce overlapping splices that CodeMirror merges rather
  than refuses. Leading wins (`growUnits`), which is also what makes the restore stable: a repitch
  writes `o3 c4 o4 d4`, and on the next pass that `o4` is `d4`'s own leading octave.
- **Re-serializing the whole run of text between two notes** to realise a gap — it moves every `v`,
  `y` and `$ED` written in that run. Each item carries a `prefixSpan` instead, the rest nearest the
  note _before_ the gap absorbs the change, and a gap whose run holds a fade command is refused.
- **Refusing `<` and `>` in an edited channel** — they are not commands to the scanner at all, and
  they are harmless: a note's octave comes from its own `written` byte rather than from a running
  sum, so `o4 c4 > d4` repitches either note without disturbing the other. `rolltest` pins it.
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
  between two others changes what the second is parsed under, and only `ParseTrace` knows what to
  restore. The roll's compile carries no trace, and asking for one costs an event per dispatch. A new
  `#N` goes at the **end of the document**, where nothing follows it to be disturbed; `orderChannels`
  is what puts the blocks in order afterwards, and it writes the `o` and `l` a moved block needs.
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
  already under way (locked to its row), and those settle at different times. `anchored` is read at
  the press and never again; `shift` is refreshed on every move, as `fine` is.
- **Counting a remote code definition's `[ ]` against the starting channel** — AddmusicK tells a
  definition from a call by nothing but position (`Music.cpp:1015`), so `(!1)[ … ]` always sits above
  the first `#N` and its brackets gather on the starting channel like everything up there. That
  refused channel 0 outright on every song with one, and pointed at Normalize, which leaves remote
  code alone by design and could never clear it. `gather` marks the body and both its brackets
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
- **Reading the loop structure off the dispatch character alone** — `loopEventOf` switched on `[`,
  `]`, `*` and `(`, and a hex command dispatches as `"$"`, so `[[ ]]n` raised a `subOpen`/`subClose`
  pair and the same subloop written `$E6 $00`/`$E6 $nn` raised nothing. Normalize could not see it,
  and the roll refused the channel through `agreesWithWalk` and offered a Normalize that had nothing
  to unroll. The tests are on the bytes and the `inE6Loop` flag, which both spellings share, so a
  `case "$"` reads it the same way — `grew` at 1 rather than 2, since `parseHexCommand` appends one
  byte per dispatch. `LoopEvent.from` carries where the run began, because the flag turns over on
  the argument byte and the event's span is that byte alone; it is a **source** offset, mapped
  through `spanAt` like every other one the trace carries, since `hexRun` is a `scanned` offset.
  `$E9` and `$FC` get no such reading: their address is worked out by the compiler and relocated
  (`link.ts`), so a hand-written one names a body nothing can resolve.
- **Writing a note's missing length in front of the dots already there** — dots compose rather than
  add, `getNoteLengthModifier` halving the running value at each one (Music.cpp:2950), so under a
  36-tick default `c.` is 36 + 18 while `c8..` is 24 + 12 + 6. The segment's own ticks are computed
  and the whole length text re-spelled from the total, dots included; in the ordinary case that is
  the same text anyway, `c` under `l4` being `c4`. And `spellDuration` rather than `spellLength`,
  since `l=n` range-checks nothing so a segment can outrun the whole note one token stops at.
- **Classifying the prelude event by event, with a `(` read before its `[`** — only the `[` carries
  the loop event that says a remote definition is opening, so `orderChannels` painted the `(!n)`
  label of one as music and set `sawMusic`; the `[` reached back and repainted it a beat later, but
  the flag stayed. Every remote body holding an `o`, `l`, `q`, `h`, `<` or `>` was then refused
  `SST0612` — "after music above the first channel" — on the strength of its own label, with nothing
  above the first `#N` at all. The label is skipped by looking one event ahead, the mirror of the
  lookbehind that paints it. Not by clearing `sawMusic` when the `[` arrives either: that would also
  clear it for real music written before the definition, which is what the diagnostic is about.
- **`writeNoteLengths` filtering on `onlyChannel`, the way `flattenTriplets` does** — that filter is
  sound for a `{ }`, which is a bracketed region on one channel, and unsound for an `l`, which is one
  variable the whole song reads: `#1`'s bare notes read `#0`'s, and a `[ ]` body's events carry
  channel 8 rather than the channel that wrote them. A scoped run deleted the `l` and left its
  readers alone, and the oracle refused the song — which is the one thing the scoped form exists to
  avoid, since it is what the roll's **Normalize #N** runs. There is no correct per-channel version:
  rewriting every reader means rewriting text a scoped run has promised to leave. It stands down
  instead, as `orderChannels` does, and the channel keeps its `l`s — which costs the roll nothing,
  a note's length being read off its own written text.
- **`writeNoteLengths` working note by note** — every segment's digits are independently optional
  and `accumulateTiedLength` folds a run across whitespace and nothing else, so one event's span can
  cover several: `c4^` is an explicit 48 and an implied 24, `r4 r r` is one rest of three. The
  `$DD` target note is the exception in the other direction — `parseNote` appends its byte and
  returns before it reads a length at all (`parser.ts:2971-2975`), so a length written there is a
  stray digit nothing reads, and `normalizetest`'s fixed-point check is what caught it.
- **Pairing a crossed loop and subloop up, or unrolling one** — `[ c4 $E6 $00 d4 ]2 e4 $E6 $01`
  compiles, AddmusicK guarding nesting and not crossing (`Music.cpp:1208-1290`), and `unrollLoops`'s
  one stack popped the wrong partner at each end and dropped both in silence: no construct, no
  diagnostic, and a dialog saying "Nothing to normalize" beside a roll refusing the channel and
  offering Normalize as the answer. Matching the two ends up and emitting both constructs does not
  work — the loop's range and the subloop's **partially overlap**, so neither `contains` the other,
  both survive the `topLevel` filter and `applyEdits` throws. Neither does unrolling: a voice has one
  subloop return (`Commands.asm:365`), so the close jumps into the other construct's body, and from
  there the channel either ends on that body's `$00` with the call counter already spent
  (`main.asm:2345`) — that song plays `c4 d4 c4 d4 e4 d4` and stops, with everything written after
  the close never reached — or re-enters the `$E9` and starts its count again. `SST0616` says which
  of the two it is. Not a check for entries left on the stack either: an unterminated `$E6 $00`
  compiles, opens a subloop nothing closes, plays exactly what it says, and has nothing to unroll.
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

## Angular specifics

Angular 22, zoneless (scaffolded `--zoneless`, so zone.js is not a dependency and there is nothing
to opt into), no router, no NgModules. Signals throughout: `signal`/`computed` for state, `effect`
reserved for mirroring into imperative sinks (localStorage, the player, the DSP). State lives in
eight `@Service()` singletons in `web/src/app/state/`. The spine runs one way, `DriverStore` →
`SampleStore` → `EditorStore` → `Playback`; `ClockMeasurer` feeds `EditorStore`, `Audition` hangs
off it beside `Playback`, `Mixer` hangs off it and is read by both of those and by the roll, and
`EditorRequests` depends on nothing at all. `web/README.md` has the rest.

Selector prefix is `amk` — `amk-root`, `amk-editor-pane` for components, camelCase `amk*` for
directives. ESLint enforces both.

Styling is Tailwind v4, with the entire theme as CSS variables in `web/src/styles.css` (v4 has no
`tailwind.config.js`). Dark-only on purpose. Two **validated categorical sets** live there —
`--color-seg-*` for the ARAM bar and `--color-ch-*` for the eight music channels — and neither may be
reordered or re-hued without re-validating, since adjacent-pair CVD separation and contrast against
`--color-surface` are the properties being preserved. The order is the mechanism, not decoration: it
is what the adjacent-pair check runs against. `--color-ch-*` does not clear the all-pairs gate and no
set of eight can, so nothing may leave channel identity to colour alone; `styles.css` says what
carries it instead.

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
