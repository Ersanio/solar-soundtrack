import { Component, computed, inject, input } from '@angular/core';

import { argEditable, argumentText, spliceArg } from '@amk/tokens/edits';
import type { Command } from '@amk/tokens';
import { argLockedBecause } from '../commands/context';
import { Slider } from '../../../shared/slider/slider';
import { CommitAudition } from '../../../state/commit-audition';
import { EditorStore } from '../../../state/editor-store';
import { tempoBefore } from '@amk/tokens/dialect';
import { bendAnchor } from '@amk/tokens/command-hazards';
import { BendGraph } from '../bend-graph/bend-graph';
import { toSigned } from '@amk/tokens/commands/param';
import { dragPreview } from '../commands/preview';
import { noteName, ticksLabel } from '@amk/tokens/commands/units';
import { NotePicker } from '../note-picker/note-picker';
import { slideStart } from './slide-start';

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

  private readonly commitAudition = inject(CommitAudition);

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
   * Where the slide starts and ends, in semitones from the note it starts on.
   *
   * `$DD` starts at the note it rides on — zero on this axis — and ends at an
   * absolute byte, so the end is that byte less the note's ({@link start}).
   * `null` where the note has no byte to measure from, and nothing is drawn.
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
      const start = this.start();
      return start.kind === 'note' ? this.shownTarget() - start.byte : null;
    }

    return this.vcmd() === 0xec ? 0 : toSigned(this.shownTarget());
  });

  protected readonly note = computed(() => {
    if (this.noteTarget()) {
      return $localize`:@@inspector.bend.the-slide-rides-on-the:inspector.bend.the-slide-rides-on-the`;
    }

    if (!this.isPitchBend()) {
      return this.vcmd() === 0xec
        ? $localize`:@@inspector.bend.every-later-note-starts-this:inspector.bend.every-later-note-starts-this`
        : $localize`:@@inspector.bend.every-later-note-starts-at:inspector.bend.every-later-note-starts-at`;
    }

    const start = this.start();
    switch (start.kind) {
      case 'note':
        return $localize`:@@inspector.bend.the-slide-rides-on-the-2:inspector.bend.the-slide-rides-on-the-2 ${noteName(start.byte)}:byte: ${this.startsOn()}:startsOn:`;
      case 'unknown':
        return $localize`:@@inspector.bend.the-slide-rides-on-the-3:inspector.bend.the-slide-rides-on-the-3 ${this.startsOn()}:startsOn:`;
      case 'rest':
        return $localize`:@@inspector.bend.the-slide-rides-on-the-4:inspector.bend.the-slide-rides-on-the-4`;
      case 'drum':
        return $localize`:@@inspector.bend.the-slide-rides-on-a:inspector.bend.the-slide-rides-on-a`;
      case 'nothing':
        return $localize`:@@inspector.bend.a-slide-rides-on-the:inspector.bend.a-slide-rides-on-the`;
    }
  });

  /**
   * Which tick of the note the slide starts on. The read-ahead arms it in the note's last piece,
   * so a tied or long note starts it that far in rather than on its own second tick.
   */
  private startsOn(): string {
    const anchor = this.anchor();
    if (anchor.kind !== 'rides' || anchor.lead === 0) {
      return $localize`:@@inspector.bend.starts-on-that-notes-second:inspector.bend.starts-on-that-notes-second`;
    }

    return $localize`:@@inspector.bend.starts-ticks-into-it-on:inspector.bend.starts-ticks-into-it-on ${anchor.lead + 1}:ticks: ${anchor.frame}:frame:`;
  }

  /** What the slide rides on, and so whether the driver arms it at all. */
  private readonly anchor = computed(() => bendAnchor(this.command(), this.store.tokens()));

  /** The byte of the note the slide starts from, off the compile. */
  private readonly start = computed(() => {
    const text = this.store.compiledText();
    const notes = this.store.result()?.noteMap;
    return slideStart(
      this.anchor(),
      text === null || !notes ? null : { text, notes },
      this.store.source(),
    );
  });

  /**
   * Whether the driver reaches this bend, and whether it fits the note it rides on.
   *
   * Three of the four answers are fatal rather than merely lossy, and they say what
   * `SST0507` says: `$DD` is picked up by a peek at the byte standing at the track
   * pointer (`main.asm:L_10E4`) and its own dispatch slot is `$0000`, so anything
   * that breaks that adjacency stops the song rather than shortening the slide.
   *
   * Where it does ride, the seconds beside the two sliders are unconditional and the
   * song is not: the next key-on overwrites the slide state outright
   * (`main.asm:465-466`), so a `$DD` that outlasts its window is cut off mid-slide and
   * never reaches the target. `bendAnchor` says how long that window is.
   */
  protected readonly reachability = computed(() => {
    if (!this.isPitchBend()) {
      return null;
    }

    const anchor = this.anchor();
    switch (anchor.kind) {
      case 'nothing':
        return $localize`:@@inspector.bend.no-note-plays-before-this:inspector.bend.no-note-plays-before-this`;
      case 'blocked':
        return $localize`:@@inspector.bend.the-written-between-this-and:inspector.bend.the-written-between-this-and ${anchor.by.name}:name:`;
      case 'tooShort':
        if (anchor.ticks > 1) {
          return anchor.tied
            ? $localize`:@@inspector.bend.tie-pieces:inspector.bend.tie-pieces ${anchor.ticks}:ticks:`
            : $localize`:@@inspector.bend.note-pieces:inspector.bend.note-pieces ${anchor.ticks}:ticks:`;
        }

        return anchor.tied
          ? $localize`:@@inspector.bend.tie-one-tick:inspector.bend.tie-one-tick`
          : $localize`:@@inspector.bend.note-one-tick:inspector.bend.note-one-tick`;

      case 'rides':
        break;
    }

    const { window } = anchor;
    const delay = this.shownDelay();
    const span = delay + this.shownDuration();
    if (delay >= window) {
      return $localize`:@@inspector.bend.the-slide-has-ticks-before:inspector.bend.the-slide-has-ticks-before ${window}:window:`;
    }

    if (span > window) {
      return $localize`:@@inspector.bend.the-slide-has-ticks-before-2:inspector.bend.the-slide-has-ticks-before-2 ${window}:window: ${span}:span:`;
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
    this.commitAudition.apply(
      spliceArg(this.store.source(), this.command(), index, argumentText(this.command(), byte)),
    );
  }
}
