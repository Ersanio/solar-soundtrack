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

There are no `.spec.ts` files — `npm run test` is Angular scaffolding and runs nothing. The real
suite is the fifteen harnesses under `scripts/`; **`scripts/README.md` says what each one proves**,
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
comparison; there are no deliberate divergences left in the compiled output.

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
plays the song on a worker and records when each tick really arrived; `AMK0503` reports it. Anything
that turns ticks into seconds must go through `EditorStore.clock`, which serves the measurement where
there is one and the prediction where there is not.

**`sampleList: null` is not `[]`.** `null` means the compiler had no opinion and the driver's default
set stands; `[]` means the song genuinely asks for no samples. The list's _order is the SRCN
assignment_, so building an SPC against a different set produces a valid-looking file that plays the
wrong sounds. It is a correctness-critical output, not a statistic.

**Diagnostics carry source spans and stable `AMK####` codes**, and are carried on failure paths too,
so partial UI stays populated. Spans are mapped back to the source the author wrote — `spanAt` is
the single choke point, and anything that bypasses it will be wrong. Constructs this compiler does
not implement are reported as errors, never silently mis-compiled.

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
- **Clearing the clock measurement on recompile** — it takes a second to come back, so `AMK0503` and
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
- **Latching the audition's fast-forward on the track pointer alone**, the way `worklet.ts` does —
  `L_0C31` sets every voice a phrase names to a duration counter of 1 before any of them fetch
  (`main.asm:2314-2318`), and `SetInstrument` runs between that and the `dec` at `L_0C4D`, so a poll
  landing in that window reads 1 and `sawTick` counts the first fetch as a tick of music. The note is
  then handed over inside the pass that starts the song, and the phrase walk still to come reads the
  frames at `scratchAt` as its next phrase: every track pointer goes to zero and nothing sounds at
  all. It latches on `$0200+2n`, the duration byte a voice has actually read (`voiceStarted`), and
  the floor of one tick on `atTicks` is what starts the driver at all. `audiotest` sweeps three to
  eight channels, because how much work `L_0C31` does before the tick voice's own write is what moves
  the fetch against the poll — four channels was silent where one and two were not. The worklet keeps
  the looser latch: a playhead a tick out is a playhead a tick out, where a note handed over a tick
  early is not played.
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
  `Music.cpp:3209`), so the note was written, compiled, reported by `AMK0502` and never heard, and
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
