import { Component, computed, inject, input } from '@angular/core';

import { argEditable, argumentText, spliceArg } from '@amk/tokens/edits';
import type { Command } from '@amk/tokens';
import { argLockedBecause } from '../commands/context';
import { Slider } from '../../../shared/slider/slider';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { noteTicksBefore, tempoBefore } from '@amk/tokens/dialect';
import { BendGraph } from '../bend-graph/bend-graph';
import { toSigned } from '@amk/tokens/commands/param';
import { dragPreview } from '../commands/preview';
import { noteName, ticksLabel } from '@amk/tokens/commands/units';
import { NotePicker } from '../note-picker/note-picker';

/**
 * `$DD` pitch bend and `$EB`/`$EC` pitch envelope — a delay, a slide and a target.
 *
 * One component for the three because they are one picture with the ends
 * swapped: `$DD` slides the note playing *to* a named note, `$EB` bends every
 * later note away from itself by a number of semitones, and `$EC` bends into it
 * from there. Which is which is two lines below rather than three files.
 *
 * `$DD`'s target is an absolute note byte, so it gets the note picker; the other
 * two are signed semitone offsets and get a centred slider.
 */
@Component({
  selector: 'amk-bend-command',
  imports: [BendGraph, NotePicker, Slider],
  templateUrl: './bend-command.html',
  host: { class: 'flex flex-col gap-3' },
})
export class BendCommand {
  private readonly store = inject(EditorStore);

  private readonly requests = inject(EditorRequests);

  readonly command = input.required<Command>();

  protected readonly args = computed(() => this.command().args.map((a) => a.value));
  protected readonly vcmd = computed(() => this.command().vcmd ?? 0);

  /** `$DD` names a note; `$EB`/`$EC` name a distance from one. */
  protected readonly isPitchBend = computed(() => this.vcmd() === 0xdd);

  /** `$DD`'s target written as a note rather than a byte, the form AMK also takes. */
  protected readonly noteTarget = computed(() => this.command().noteTarget);

  /** Two bytes and a written note is three parameters, as three bytes is. */
  protected readonly hasTarget = computed(
    () => this.args().length >= 3 || this.noteTarget() !== undefined,
  );

  /**
   * Cleared by the re-scan a commit causes; see `dragPreview`. The sliders bind
   * to the committed values below, not to these — see the note in
   * `vibrato-command` for why that matters.
   */
  private readonly drag = dragPreview(this.command);

  protected readonly delay = computed(() => this.args()[0] ?? 0);
  protected readonly duration = computed(() => this.args()[1] ?? 0);
  protected readonly target = computed(() => this.args()[2] ?? 0);

  protected readonly shownDelay = computed(() => this.drag.at(0, this.delay()));
  protected readonly shownDuration = computed(() => this.drag.at(1, this.duration()));
  protected readonly shownTarget = computed(() => this.drag.at(2, this.target()));

  protected preview(index: number, value: number): void {
    // The semitone slider reports a signed value; the graph reads the byte.
    this.drag.set(index, index === 2 && !this.isPitchBend() && value < 0 ? value + 0x100 : value);
  }

  protected readonly tempo = computed(() =>
    tempoBefore(this.command(), this.store.tokens().commands),
  );

  protected readonly delayLabel = computed(() => ticksLabel(this.shownDelay(), this.tempo()));
  protected readonly durationLabel = computed(() => ticksLabel(this.shownDuration(), this.tempo()));

  protected readonly noteLabel = computed(() => noteName(this.shownTarget()));

  /** What the slider binds to: the document's value, signed. */
  protected readonly semitones = computed(() => toSigned(this.target()));

  /**
   * Where the slide starts and ends, in semitones from the written note.
   *
   * `$DD` starts at the note playing — which is zero on this axis — and ends at
   * an absolute byte the graph cannot place against it, since it does not know
   * what note is sounding. So the picture is drawn as the interval it would be
   * from `o4 c`, which is honest about the *shape* and says as much beneath.
   * `$EC` is the only one that runs the other way.
   */
  protected readonly from = computed(() => {
    if (this.isPitchBend()) {
      return 0;
    }

    return this.vcmd() === 0xec ? toSigned(this.shownTarget()) : 0;
  });

  protected readonly to = computed(() => {
    if (this.isPitchBend()) {
      return this.shownTarget() - 0xa4; // relative to o4 c, the graph's stand-in
    }

    return this.vcmd() === 0xec ? 0 : toSigned(this.shownTarget());
  });

  protected readonly note = computed(() =>
    this.noteTarget()
      ? 'The slide rides on the note before it and ends on the note written after it. That note plays nothing of its own — the driver reads its pitch as this command’s last byte — and which byte that is depends on the octave in force, any h, the instrument’s tuning and a drum remap, so it is not shown here. A length written on it is not read.'
      : this.isPitchBend()
        ? 'The slide rides on the note before it and starts on that note’s second tick, so the shape above is drawn against o4 c as a stand-in.'
        : this.vcmd() === 0xec
          ? 'Every later note starts this far away and arrives at its written pitch.'
          : 'Every later note starts at its written pitch and departs by this much.',
  );

  /**
   * Ticks of the note this bend rides on that it can actually use.
   *
   * One less than the note's own length: the driver's read-ahead cannot run on
   * the tick a note begins (`main.asm:2338`), so the slide starts on the second.
   */
  private readonly window = computed(() => {
    const ticks = noteTicksBefore(this.command(), this.store.tokens().commands);
    return ticks === null ? null : ticks - 1;
  });

  /**
   * Whether the bend fits in the note it rides on, and what is lost if not.
   *
   * The seconds beside the two sliders are unconditional, and the song is not:
   * the next key-on overwrites the slide state outright (`main.asm:465-466`), so
   * a `$DD` that outlasts its note is simply cut off mid-slide and never reaches
   * the target. This is what says so.
   */
  protected readonly reachability = computed(() => {
    if (!this.isPitchBend()) {
      return null;
    }

    const window = this.window();
    if (window === null) {
      return 'No note precedes this on the channel, so there is nothing for the slide to ride on and nothing is heard.';
    }

    const delay = this.shownDelay();
    const span = delay + this.shownDuration();
    if (delay >= window) {
      return `The note before this is ${window + 1} ticks, so the slide has ${window} to run in — the delay alone uses them all and none of the bend is heard.`;
    }

    if (span > window) {
      return `The note before this gives the slide ${window} ticks; this asks for ${span}, so it is cut off partway and never reaches the target.`;
    }

    return null;
  });

  protected editable(index: number): boolean {
    return argEditable(this.command(), index);
  }

  protected lockedBecause(index: number): string | null {
    return argLockedBecause(this.command(), index);
  }

  protected setArg(index: number, value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.requests.apply(
      spliceArg(this.store.source(), this.command(), index, argumentText(this.command(), byte)),
    );
  }
}
