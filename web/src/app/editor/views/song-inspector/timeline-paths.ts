/**
 * The Song Inspector's timeline as paths: buckets of a pass squeezed into a fixed number of
 * columns, keeping each column's loudest bucket so a short peak is never averaged away.
 *
 * Every lane is drawn in a {@link TIMELINE_WIDTH} by lane-height `viewBox` stretched to the pane,
 * so the x of a tick is the same fraction of the width in every lane and on the spectrogram.
 */

/** Columns across the pass: finer than any pane is wide, coarse enough to stay a short path. */
export const TIMELINE_WIDTH = 1000;

/** Where a level is drawn, 0 (the floor) to 1 (the ceiling). */
export function levelY(value: number, floor: number, ceil: number, height: number): number {
  const fraction = Math.min(1, Math.max(0, (value - floor) / (ceil - floor)));
  return height * (1 - fraction);
}

/**
 * The loudest of `values[0 .. count)` in each column, bucket `b` covering the fraction
 * `[b × bucketTicks, (b + 1) × bucketTicks) / passTicks` of the width. `NaN` for a column no bucket
 * reaches.
 */
export function columnMax(
  values: ArrayLike<number>,
  count: number,
  bucketTicks: number,
  passTicks: number,
  columns = TIMELINE_WIDTH,
): Float32Array {
  const out = new Float32Array(columns).fill(Number.NaN);
  if (passTicks <= 0) {
    return out;
  }

  for (let b = 0; b < count; b++) {
    const from = Math.floor(((b * bucketTicks) / passTicks) * columns);
    const to = Math.min(
      columns,
      Math.max(from + 1, Math.ceil((((b + 1) * bucketTicks) / passTicks) * columns)),
    );
    for (let column = Math.max(0, from); column < to; column++) {
      const value = values[b];
      if (!(out[column] >= value)) {
        out[column] = value;
      }
    }
  }

  return out;
}

/**
 * A filled area from the floor up to each column's level: one closed path, columns below the floor
 * or unreached dropping it to the floor, so silence draws nothing.
 */
export function areaPath(
  columns: Float32Array,
  floor: number,
  ceil: number,
  height: number,
): string {
  let path = `M0 ${height}`;
  for (let x = 0; x < columns.length; x++) {
    const value = columns[x];
    const y = Number.isNaN(value) ? height : levelY(value, floor, ceil, height);
    path += `H${x}V${round(y)}H${x + 1}`;
  }

  return `${path}V${height}Z`;
}

/**
 * A line through each column's level, broken where a column is unreached or, with `gapBelow`,
 * where it falls under the floor.
 */
export function linePath(
  columns: Float32Array,
  floor: number,
  ceil: number,
  height: number,
  gapBelow = false,
): string {
  let path = '';
  let open = false;
  for (let x = 0; x < columns.length; x++) {
    const value = columns[x];
    if (Number.isNaN(value) || (gapBelow && value <= floor)) {
      open = false;
      continue;
    }

    const y = round(levelY(value, floor, ceil, height));
    path += open ? `L${x + 0.5} ${y}` : `M${x + 0.5} ${y}`;
    open = true;
  }

  return path;
}

/** The columns where any bucket in them has a count above zero, as x positions. */
export function markedColumns(
  counts: ArrayLike<number>,
  count: number,
  bucketTicks: number,
  passTicks: number,
): number[] {
  const columns = columnMax(counts, count, bucketTicks, passTicks);
  const marked: number[] = [];
  columns.forEach((value, x) => {
    if (value > 0) {
      marked.push(x);
    }
  });
  return marked;
}

/**
 * Runs of columns where `bit` is set in `flags`, as one path of rectangles `height` tall at `y`:
 * the echo's per-channel sends.
 */
export function flagPath(
  flags: ArrayLike<number>,
  count: number,
  bit: number,
  bucketTicks: number,
  passTicks: number,
  y: number,
  height: number,
): string {
  const set = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    set[b] = flags[b] & (1 << bit) ? 1 : 0;
  }

  const columns = columnMax(set, count, bucketTicks, passTicks);
  let path = '';
  let start = -1;
  for (let x = 0; x <= columns.length; x++) {
    const on = x < columns.length && columns[x] > 0;
    if (on && start < 0) {
      start = x;
    } else if (!on && start >= 0) {
      path += `M${start} ${y}h${x - start}v${height}h${start - x}Z`;
      start = -1;
    }
  }

  return path;
}

/** The fraction of the width a tick sits at. */
export function tickFraction(tick: number, passTicks: number): number {
  return passTicks > 0 ? Math.min(1, Math.max(0, tick / passTicks)) : 0;
}

/**
 * The spectrogram column covering each of `width` pixel columns, by tick: columns are taken at a
 * steady rate in time, which is not a steady rate in ticks once the tempo moves, so the image is
 * resampled by lookup rather than stretched. -1 where no column has reached that far.
 */
export function spectrogramColumns(
  ticks: Float32Array,
  passTicks: number,
  width: number,
): Int32Array {
  const out = new Int32Array(width).fill(-1);
  if (ticks.length === 0 || passTicks <= 0) {
    return out;
  }

  let column = 0;
  for (let x = 0; x < width; x++) {
    const tick = ((x + 0.5) / width) * passTicks;
    while (column + 1 < ticks.length && ticks[column + 1] <= tick) {
      column++;
    }

    if (tick <= ticks[ticks.length - 1] + (ticks.length > 1 ? ticks[1] - ticks[0] : 0)) {
      out[x] = column;
    }
  }

  return out;
}

const round = (value: number): number => Math.round(value * 10) / 10;
