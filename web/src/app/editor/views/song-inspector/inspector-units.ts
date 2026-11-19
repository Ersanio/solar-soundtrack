/**
 * The Song Inspector's figures with their units, each a message so its wording lives with the rest
 * of the English.
 */

import { SILENT_DB } from '../../../state/analysis/song-analysis';

/** A level that is the analysis's floor reads as silence rather than as -120. */
const silent = (db: number): boolean => !Number.isFinite(db) || db <= SILENT_DB;

export function dbfs(db: number): string {
  return silent(db)
    ? $localize`:@@analysis.unit.silent:analysis.unit.silent`
    : $localize`:@@analysis.unit.dbfs:analysis.unit.dbfs ${db.toFixed(1)}:value:`;
}

export function lufs(value: number): string {
  return silent(value)
    ? $localize`:@@analysis.unit.silent:analysis.unit.silent`
    : $localize`:@@analysis.unit.lufs:analysis.unit.lufs ${value.toFixed(1)}:value:`;
}

/** A share, 0 to 1, as a whole percentage — 1% at the least for anything above nothing. */
export function percent(share: number): string {
  const value = share > 0 ? Math.max(1, Math.round(share * 100)) : 0;
  return $localize`:@@analysis.unit.percent:analysis.unit.percent ${value}:value:`;
}
