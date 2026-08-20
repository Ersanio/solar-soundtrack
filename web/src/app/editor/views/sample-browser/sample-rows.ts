import type { SampleFile, SampleSlot } from '../../../state/sample-store';

/**
 * The library's rows, with everything a template draws already resolved.
 *
 * Free functions rather than methods the components call per row: a method runs
 * on *every* change-detection pass, ten times a second while a song plays, and
 * `SampleStore.bankSlots` alone decodes up to 64 BRR samples for an expanded
 * bank. Built here, the work happens when the library, the compile result or the
 * open set actually changes.
 */

/** A bank slot as the template draws it. */
export interface SlotRow {
  slot: SampleSlot;
  used: boolean;
  requested: boolean;
  waveform: string;
  detail: string;
  size: string;
}

/** A library entry as the template draws it, its open bank's slots included. */
export interface FileRow {
  file: SampleFile;
  /** Whether the user has opened this row, whatever else is true of it. */
  expanded: boolean;
  /** Whether {@link slots} is showing — expanded, a bank, and readable. */
  open: boolean;
  used: boolean;
  requested: boolean;
  /** Empty when this row does not draw one. */
  waveform: string;
  detail: string;
  size: string;
  /** How much of a bank is actually populated — real banks are rarely full. */
  bank: string;
  slots: SlotRow[];
}

/** What a row is judged against: the song's own two lists, and the open set. */
export interface RowContext {
  /** Names the song asked for, before optimisation emptied any. */
  requested: ReadonlySet<string>;
  /** Names the song actually plays, as opposed to merely including. */
  used: ReadonlySet<string>;
  opened: ReadonlySet<string>;
  /** Asked only for a bank that is actually open, since decoding one is not free. */
  slotsOf: (name: string) => SampleSlot[];
}

/**
 * Turns the min/max envelope into a single closed SVG path, top edge left to
 * right and bottom edge back again, in a 0..1 by -1..1 viewBox.
 */
export function waveform(file: SampleFile | SampleSlot): string {
  const envelope = file.envelope;
  const buckets = envelope.length / 2;
  if (buckets === 0) {
    return '';
  }

  const step = 1 / buckets;
  let top = '';
  let bottom = '';
  for (let bucket = 0; bucket < buckets; bucket++) {
    const x = (bucket * step).toFixed(5);
    top += `${bucket === 0 ? 'M' : 'L'}${x},${(-envelope[bucket * 2 + 1]).toFixed(4)}`;
    bottom = `L${x},${(-envelope[bucket * 2]).toFixed(4)}${bottom}`;
  }

  return `${top}${bottom}Z`;
}

function detailLabel(file: SampleFile | SampleSlot): string {
  if ('error' in file && file.error) {
    return file.error;
  }

  const seconds = (file.frames / 32000).toFixed(2);
  const loop = file.loopOffset > 0 ? `loop @ ${file.loopOffset.toLocaleString()}` : 'no loop point';
  return `${file.blocks.toLocaleString()} blocks · ${seconds}s · ${loop}`;
}

/**
 * One library entry.
 *
 * A row's waveform is built only if it will be drawn, which is why `waveform` is
 * empty for anything unreadable or absent from the song, and why a bank's slots
 * are asked for only once it is open.
 */
export function fileRow(file: SampleFile, context: RowContext): FileRow {
  const requested = context.requested.has(file.name);
  const expanded = context.opened.has(file.name);
  const open = expanded && file.kind === 'bank' && file.error === null;

  return {
    file,
    expanded,
    open,
    used: context.used.has(file.name),
    requested,
    waveform: file.kind === 'sample' && file.error === null && requested ? waveform(file) : '',
    detail: detailLabel(file),
    size: `${file.bytes.length.toLocaleString()} B`,
    bank: `${file.slotCount} slots · ${file.usedSlots} non-empty`,
    // A real bank is mostly empty — showing all 64 buries the handful that
    // matter. Each row still displays its own slot index, so the SRCNs stay
    // readable.
    slots: open
      ? context
          .slotsOf(file.name)
          .filter((slot) => !slot.empty)
          .map((slot) => slotRow(slot, context))
      : [],
  };
}

export function slotRow(slot: SampleSlot, context: RowContext): SlotRow {
  return {
    slot,
    used: context.used.has(slot.name),
    requested: context.requested.has(slot.name),
    waveform: waveform(slot),
    detail: detailLabel(slot),
    size: `${slot.bytes.toLocaleString()} B`,
  };
}
