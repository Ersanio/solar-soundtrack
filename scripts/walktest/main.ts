/**
 * The song-data walker: `@amk/spc/song-walk`.
 *
 * The piano roll is drawn entirely from what this says, and a walker that
 * mis-frames one command draws a plausible-looking roll that is quietly wrong —
 * there is no visual tell. Three assertions carry the weight, and none of them
 * is obvious from the names:
 *
 * 1. **`vcmdLength` is pinned against `expectedArgs`.** `@amk/spc` may not reach
 *    `@amk/tokens`, so the two packages each state how long a VCMD is — one
 *    about emitted bytes, one about source text. That is the arrangement
 *    `BANK_SLOT_COUNT` and `MELODIC_SRCN` already live under, and it is only
 *    safe because something asserts the pair agree. This is that something.
 *    Checked at the default target alone, deliberately: the dialect forks are
 *    gone by the time bytes exist, since `parser.ts` rewrites `#am4`'s
 *    `$ED $80` to `$F6` and `#amk 1`'s `$FC` before either reaches the blob.
 *
 * 2. **`$FB`'s arguments are not walked as notes.** An arpeggio's note bytes sit
 *    in the `$80` range without being notes, so a walker that priced `$FB` at a
 *    fixed length would invent a chord out of nowhere and still produce a
 *    timeline that looks entirely reasonable. The song here writes two notes and
 *    must yield exactly two.
 *
 * 3. **The emulator is the oracle.** Tick totals agreeing with `stats` only
 *    proves the walk agrees with AddmusicK's own prediction — both could be
 *    wrong together. So the real driver is run, and at every poll the note the
 *    walk says is sounding is compared against the one the voice's track pointer
 *    is actually on. Overwhelming agreement rather than unanimity, for the
 *    reason `audiotest` gives: a pointer read from outside the emulator can be
 *    caught half-written.
 *
 * A fourth, for `SST0502`: a loop that repeats too many times must kill no
 * *written* note. The same four notes sound in the iterations that survive, and
 * a diagnostic that underlined them would be telling an author a note is dead
 * while they can hear it playing.
 *
 * A fifth, for `SST0510`-`SST0512`: what a pass carries into the repeat is
 * what the running driver holds a few ticks into it. The tempo is `tempoAtEnd`,
 * not the last of `tempoChanges`, and a command at the very end of a channel
 * runs only when the driver reaches it before the `$00` that ends the phrase.
 *
 *   npm run walktest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { summarise } from "../harness";
import "./command-lengths";
import "./song-length";
import "./tempo-map";
import "./loops";
import "./command-list";
import "./command-lane";
import "./clock-agrees";
import "./no-loop";
import "./notes-mapped";
import "./written-pitch";
import "./not-notes";
import "./percussion";
import "./ties-gates-range";
import "./slide-read-ahead";
import "./slide-start";
import "./longer-channel";
import "./repeat-tempo";
import "./repeat-settings";
import "./malformed-data";
import "./driver-plays";
import "./driver-key-off";
import "./tempo-shortfall";
import "./in-force-named";

summarise();
