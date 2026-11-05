/**
 * The piano roll's edits: `roll-strip.ts` and `roll-edit.ts`, driven the way the
 * roll drives them and checked against the walk of what they wrote.
 *
 * A gesture is not verified by looking at the text it produced. It is verified
 * by **compiling that text and walking it**: every note the plan said the
 * channel would hold has to be there, on its tick, for its length and at the
 * pitch it was written at — and no other channel may have moved. That is the
 * only check that can tell a splice which looks right from one which is right,
 * because everything the roll writes is read back through `o`, `l` and `q` it
 * did not write.
 *
 * It also holds the two spelling rules the roll and the compiler have to agree
 * on — that `spellNote` names the same key `@amk/tokens`' `NOTE_NAMES` does, and
 * that a note's octave falls out of its written byte — and the refusals, each
 * with a song that earns it.
 *
 *   npm run rolltest
 */

// First, so every module after it finds $localize and the English.

import "../localize";
import { summarise } from "../harness";
import "./spelling";
import "./gate";
import "./loops";
import "./loop-carries-loops";
import "./loop-edge-gap";
import "./loop-edge-join";
import "./loop-resize";
import "./bulk";
import "./insert-mode";
import "./overwrite-mode";
import "./carried-past";
import "./removed-commands";
import "./drum-apart";
import "./refusals";
import "./drag-carries";
import "./past-the-end";
import "./opening-a-channel";
import "./carrying-a-command";
import "./pitch-slide";
import "./selection";
import "./seed";

summarise();
