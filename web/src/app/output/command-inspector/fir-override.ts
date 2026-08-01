import type { Command } from '@compiler/tokens';

/**
 * The `$F1`/`$F5` override, looked at from either end.
 *
 * `$F1`'s third argument reloads one of the driver's two built-in filter tables
 * (`main.asm:3507`), so it overwrites whatever coefficients a `$F5` put in the
 * DSP. AddmusicK does this silently — there is no `$F5` code in `Music.cpp` at
 * all — and it is easy to spend a while tuning eight bytes that a later command
 * throws away.
 *
 * Only commands in the same channel are compared. Within one channel source
 * order is execution order; across channels the driver interleaves by time, so
 * "later in the file" would not mean "runs afterwards" and the warning would be
 * guesswork. A `$F5` and a `$F1` in different channels are left alone.
 */
export function firOverriddenBy(fir: Command, commands: Command[]): Command | null {
  return (
    commands.find(
      (other) =>
        other.vcmd === 0xf1 &&
        other.channel === fir.channel &&
        other.span.start > fir.span.start,
    ) ?? null
  );
}

/** The `$F5` this `$F1` discards, if there is one before it in the channel. */
export function firOverriddenBefore(echo: Command, commands: Command[]): Command | null {
  let found: Command | null = null;
  for (const other of commands) {
    if (other.span.start >= echo.span.start) break;
    if (other.vcmd === 0xf5 && other.channel === echo.channel) found = other;
  }
  return found;
}

/** `0` or `1` — which built-in table, for naming it in the warning. */
export function builtInFilterName(which: number): string {
  if (which === 0) return 'filter 0, the SMW low-pass';
  if (which === 1) return 'filter 1, flat';
  return `filter ${which}, which is out of range`;
}
