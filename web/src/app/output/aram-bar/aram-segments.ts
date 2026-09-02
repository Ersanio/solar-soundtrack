import type { AramBudget } from '@amk/spc/layout';
import type { Segment } from './aram-bar';

/**
 * A budget as the bar draws it.
 *
 * `computeBudget` already emits exactly the five regions the bar draws, so
 * there is nothing to roll up — only the zero-byte ones go, the bar having no
 * zero-width mark to draw. The budget table keeps its own `free` row at zero
 * bytes for the opposite reason: "no room left" is what that table is read for.
 * Here rather than in either reader, so the bar in the top bar and the one in
 * the budget panel are fed the same segments.
 */
export function budgetSegments(budget: AramBudget | null): Segment[] {
  if (!budget) {
    return [];
  }

  return budget.rows
    .filter((row) => row.bytes > 0)
    .map((row) => ({ group: row.key, label: row.label, bytes: row.bytes }));
}
