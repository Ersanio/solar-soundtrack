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
- **`generate-git-info`** — writes `web/src/app/git-info.generated.ts` for the toolbar's commit link
  (generated, gitignored). Captured once at startup, so it goes stale if you commit while
  `npm start` is running; restart to refresh.

### Tests

There are no `.spec.ts` files — `npm run test` is Angular scaffolding and runs nothing. The real
suite is the fourteen harnesses under `scripts/`; **`scripts/README.md` says what each one proves**,
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
  overwrote a position set in the same gesture that came off the song. Parking happens at the two
  call sites that stop following, the follow toggle and the scrub bar's pointer-down.
- **Seeking the roll by `Shift`+wheel, committed on a 200 ms quiet timer** — nothing on screen said
  the roll could be seeked at all, and the commit fired on a guess about when the gesture had ended
  rather than on anything the porter did. The scrub bar above the roll is the affordance, and a
  pointer-up is a real end.
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
- **`unreachable` in `timelinesAgree`** — sound-looking and wrong: unrolling changes the list by
  construction, since a note inside a `[ ]` is dropped once per replay and the copies it becomes are
  separate addresses. `channelTicks` is what holds a channel's tail to account. `normalizetest`
  caught it.
- **The roll's playhead line derived from `lead`** — the camera and the line were one number, so
  unticking Follow parked the line with the view and nothing in the roll said where the music had
  got to: the line, the scrub marker and the lit keys all froze together, and the frame clock was
  switched off with them. `lead` is the camera's alone; the line is the song's tick in the camera's
  coordinates (`xAtTick`), and the clip is what hides it once the song runs off the pane. Not a
  clamp to the edge either — a line held there would say the song was there.
- **The mixer's mutes and solo living on `Playback`** — the note previewer has to refuse a channel
  they silence, and it neither owns nor wants the transport: it shares no worklet, no audio thread
  and no song being played, and reaching through `Playback` to find the mask would make it depend on
  all three. `Mixer` holds the mask and the solo, injects `EditorStore` alone, and is read by
  `Playback`, `Audition` and the roll. The mask is the only thing the two audio paths share, and it
  is a number.
- **The roll's page anchor reset on the transport being idle, rather than on its going idle** — an
  effect runs once when it is created, so a roll rebuilt while the song was stopped zeroed the anchor
  it had just been given and the view shifted by up to a page on every tab switch. It follows the
  transition: what re-measures the pages is a stop. The camera outliving the component
  (`roll-camera.ts`) is what turned a harmless re-run into a lost position.
- **Keeping the roll alive behind `[class.hidden]`**, as the source view is — the symmetry is
  inviting and it does not work: `display: none` destroys the layout box, so the native vertical
  scroller comes back at row 0 regardless, and a hidden roll goes on drawing marks, a grid and a
  transform for a tab nobody is looking at. CodeMirror is hidden because its undo history is not
  something anything could hand back; a camera is four numbers that can be.

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
