import { Component, computed, inject, input } from '@angular/core';

import { argsRewritable, commandRewritable, spliceArg, spliceCommand } from '@compiler/edits';
import type { Command } from '@compiler/tokens';
import { Button } from '../../../shared/button/button';
import { type EnumOption, EnumSelect } from '../../../shared/enum-select/enum-select';
import { Slider } from '../../../shared/slider/slider';
import { EditorStore } from '../../../state/editor-store';
import { hex2 } from '../../../util/format';
import { toSigned } from '../commands/param';

const MODES: readonly EnumOption[] = [
  { value: 0x00, label: 'off' },
  { value: 0x01, label: 'a sequence of notes' },
  { value: 0x80, label: 'trill — two notes' },
  { value: 0x81, label: 'glissando' },
];

/** The most notes worth drawing a row each for. `$FB $7F` carries 127. */
const MAX_ROWS = 24;

/**
 * The byte that marks where the sequence restarts.
 *
 * Never a note: the driver tests for it before reading anything as a delta, and
 * there is no escape. Nothing is lost — the entries are *offsets* from the note
 * being played, and −128 semitones was never a real one.
 */
const LOOP_MARKER = 0x80;

/**
 * `$FB` — arpeggio, and the one command whose *length* you edit.
 *
 * Its first byte is a count, and `count` note bytes follow the duration. So the
 * count is not typed: it is derived from how many note rows there are, and Add
 * and Remove are what change it. Typing a count and then having to write exactly
 * that many bytes by hand is the mistake this panel exists to prevent — and a
 * count that disagrees with what follows silently reinterprets the music after
 * it as note data.
 *
 * `$80` and `$81` are not counts at all but the trill and glissando forms, which
 * take a fixed two arguments; the mode select is what moves between the three
 * shapes.
 */
@Component({
  selector: 'amk-arpeggio-command',
  imports: [Button, EnumSelect, Slider],
  templateUrl: './arpeggio-command.html',
  host: { class: 'flex flex-col gap-3' },
})
export class ArpeggioCommand {
  private readonly store = inject(EditorStore);

  readonly command = input.required<Command>();

  protected readonly MODES = MODES;

  protected readonly args = computed(() => this.command().args.map((a) => a.value));
  protected readonly count = computed(() => this.args()[0] ?? 0);

  /** `$00`/`$80`/`$81` are themselves; any other count is "a sequence". */
  protected readonly mode = computed(() => {
    const count = this.count();
    return count === 0x00 || count === 0x80 || count === 0x81 ? count : 0x01;
  });

  protected readonly isSequence = computed(() => this.mode() === 0x01);
  protected readonly isOff = computed(() => this.mode() === 0x00);

  protected readonly duration = computed(() => this.args()[1] ?? 0);

  /**
   * Where the sequence restarts, or `-1` for "at the beginning".
   *
   * The driver finds this lazily rather than by scanning: stepping onto a `$80`
   * sets the loop index to the position *after* it and immediately advances
   * again ($125F-$1261 in the assembled driver). So after one full pass the
   * **last** marker is the one in force, and every earlier one is unreachable —
   * which is why the panel offers exactly one and reports rather than rewrites a
   * source that has several.
   */
  private readonly markers = computed(() =>
    this.args()
      .slice(2)
      .map((value, index) => (value === LOOP_MARKER ? index : -1))
      .filter((index) => index >= 0),
  );

  protected readonly loopAt = computed(() => {
    const markers = this.markers();
    return markers.length === 0 ? -1 : markers[markers.length - 1];
  });

  /** One row per note actually written, capped so a huge sequence stays readable. */
  protected readonly notes = computed(() =>
    this.args()
      .slice(2, 2 + MAX_ROWS)
      .map((value, index) => ({
        index,
        value: toSigned(value),
        hex: `$${hex2(value)}`,
        isMarker: value === LOOP_MARKER,
        /** Only the last marker is live; an earlier one is dead weight. */
        isLive: value === LOOP_MARKER && index === this.loopAt(),
      })),
  );

  /**
   * The two shapes that break the driver rather than merely surprising it.
   *
   * A marker in the last slot sets the loop index past the end of the list, and
   * the walker then reads the song data after the command as note deltas. A list
   * of nothing but markers never lands on a note at all and spins forever with
   * the driver wedged. Neither is worth letting a button produce.
   */
  protected readonly hazard = computed(() => {
    const notes = this.args().slice(2);
    if (notes.length === 0) {
      return null;
    }

    if (notes.every((value) => value === LOOP_MARKER)) {
      return 'Every entry is a loop point, so the driver never reaches a note and hangs.';
    }

    if (notes[notes.length - 1] === LOOP_MARKER) {
      return 'A loop point in the last slot points past the end of the sequence, and the driver reads the song after this command as notes.';
    }

    if (this.markers().length > 1) {
      return `${this.markers().length} loop points are written; only the last takes effect, and the notes before it play once and never again.`;
    }

    return null;
  });

  protected readonly omitted = computed(() => Math.max(0, this.args().length - 2 - MAX_ROWS));

  protected readonly countNote = computed(() => {
    const written = this.count();
    const actual = this.args().length - 2;
    if (this.isSequence() && written !== actual) {
      return `the count says ${written} but ${actual} follow — the driver will read past this command`;
    }

    return null;
  });

  /** The single argument the trill and glissando forms take past the duration. */
  protected readonly extra = computed(() => toSigned(this.args()[2] ?? 0));

  protected readonly extraLabel = computed(() =>
    this.mode() === 0x80 ? 'Pitch change' : 'Semitones per step',
  );

  protected readonly editable = computed(() => argsRewritable(this.command()));

  /** Add and Remove change the command's *shape*, which needs the whole run literal. */
  protected readonly canResize = computed(() => commandRewritable(this.command()));

  protected readonly lockedBecause = computed(() =>
    this.editable()
      ? null
      : `These bytes come from the "${this.command().replacement}" replacement, so they cannot be set here.`,
  );

  // --- editing ---------------------------------------------------------------

  protected setDuration(value: number): void {
    this.store.apply(spliceArg(this.store.source(), this.command(), 1, `$${hex2(value)}`));
  }

  protected setNote(index: number, value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.store.apply(
      spliceArg(this.store.source(), this.command(), index + 2, `$${hex2(byte & 0xff)}`),
    );
  }

  protected setExtra(value: number): void {
    const byte = value < 0 ? value + 0x100 : value;
    this.store.apply(spliceArg(this.store.source(), this.command(), 2, `$${hex2(byte & 0xff)}`));
  }

  protected setMode(mode: number): void {
    if (mode === this.mode()) {
      return;
    }

    const duration = this.duration() || 0x18;
    switch (mode) {
      case 0x00:
        // `$FB $00` turns arpeggio off and takes nothing further.
        this.rewrite([0x00]);
        break;
      case 0x01:
        this.rewrite([2, duration, 0x04, 0x07]);
        break;
      default:
        this.rewrite([mode, duration, this.args()[2] ?? 0x04]);
    }
  }

  protected addNote(): void {
    const notes = this.args().slice(2);
    this.rewrite([notes.length + 1, this.duration(), ...notes, 0x00]);
  }

  /**
   * Whether marking this row would produce a sequence the driver cannot play.
   *
   * The last slot is refused because a marker there sends the loop index past
   * the end; a list with only one other entry is refused because clearing that
   * one later would leave nothing but markers. Both are hangs, not surprises.
   */
  protected canMark(index: number): boolean {
    const notes = this.args().slice(2);
    return this.canResize() && index < notes.length - 1;
  }

  /**
   * Moves the loop point to this row, or clears it if it is already there.
   *
   * Exactly one at a time: a second marker silently disables the first, so
   * offering two would be offering a shape whose earlier notes play once and are
   * then unreachable. Marking replaces the row's note, which is what the byte
   * does — the marker occupies a slot rather than sitting between them.
   */
  protected toggleLoop(index: number): void {
    const notes = this.args().slice(2);
    const already = notes[index] === LOOP_MARKER;

    const next = notes.map((value, i) => {
      if (i === index) {
        // Clearing puts a plain unison back, since the slot still counts.
        return already ? 0x00 : LOOP_MARKER;
      }

      return value === LOOP_MARKER ? 0x00 : value;
    });

    this.rewrite([next.length, this.duration(), ...next]);
  }

  protected removeNote(index: number): void {
    const notes = this.args().slice(2);
    notes.splice(index, 1);
    this.rewrite([notes.length, this.duration(), ...notes]);
  }

  /**
   * Rewrites the whole run, which adding or removing a note necessarily does:
   * the argument list grows or shrinks, so there is no per-token splice that
   * expresses it. The one place in the inspector where the author's spacing
   * inside a command cannot be preserved, and it is a shape change, not a value.
   */
  private rewrite(values: number[]): void {
    const text = `$FB ${values.map((value) => `$${hex2(value & 0xff)}`).join(' ')}`;
    this.store.apply(spliceCommand(this.store.source(), this.command(), text));
  }
}
