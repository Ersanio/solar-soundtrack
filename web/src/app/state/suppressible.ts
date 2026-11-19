/**
 * Every code that is never an error, and so may be suppressed, with what each one says.
 *
 * What it says is its own catalog entry with `…` for the values, so the words stay the ones the
 * Problems list shows. This feeds the suppression dialog's picker; the Suppress button on a row
 * works for any code that is not an error, listed here or not.
 */

import { AMK } from '@amk/core/messages/amk';
import { SST } from '@amk/core/messages/sst';
import type { Severity } from '@amk/core/types';

/** A value left out of a message. Typed as anything, since the catalogs take numbers too. */
const GAP = '…' as never;

export interface Suppressible {
  readonly code: string;
  readonly severity: Exclude<Severity, 'error'>;
  /** One line per thing the code says, where it says more than one. */
  readonly describe: () => readonly string[];
}

export const SUPPRESSIBLE: readonly Suppressible[] = [
  { code: 'AMK0100', severity: 'warning', describe: () => [AMK['0100'](GAP)] },
  { code: 'AMK0200', severity: 'warning', describe: () => [AMK['0200.length']()] },
  { code: 'AMK0201', severity: 'warning', describe: () => [AMK['0201']()] },
  { code: 'AMK0202', severity: 'warning', describe: () => [AMK['0202']()] },
  { code: 'AMK0203', severity: 'warning', describe: () => [AMK['0203']()] },
  { code: 'AMK0204', severity: 'warning', describe: () => [AMK['0204']()] },
  {
    code: 'AMK0205',
    severity: 'warning',
    describe: () => [AMK['0205.transpose'](), AMK['0205.truncated'](GAP, GAP, GAP)],
  },
  { code: 'AMK0206', severity: 'warning', describe: () => [AMK['0206']()] },
  {
    code: 'AMK0207',
    severity: 'warning',
    describe: () => [AMK['0207.am4'](), AMK['0207.amm']()],
  },
  { code: 'AMK0208', severity: 'warning', describe: () => [AMK['0208']()] },
  { code: 'AMK0209', severity: 'warning', describe: () => [AMK['0209']()] },
  { code: 'AMK0210', severity: 'warning', describe: () => [AMK['0210']()] },
  { code: 'AMK0211', severity: 'warning', describe: () => [AMK['0211']()] },
  { code: 'AMK0212', severity: 'warning', describe: () => [AMK['0212'](GAP)] },
  { code: 'AMK0213', severity: 'warning', describe: () => [AMK['0213'](GAP, GAP)] },
  { code: 'AMK0214', severity: 'warning', describe: () => [AMK['0214']()] },
  { code: 'AMK0216', severity: 'warning', describe: () => [AMK['0216']()] },
  { code: 'AMK0217', severity: 'warning', describe: () => [AMK['0217']()] },
  { code: 'AMK0218', severity: 'warning', describe: () => [AMK['0218']()] },
  { code: 'SST0500', severity: 'severe', describe: () => [SST['0500'](GAP)] },
  { code: 'SST0501', severity: 'severe', describe: () => [SST['0501'](GAP, GAP)] },
  { code: 'SST0502', severity: 'severe', describe: () => [SST['0502.one'](GAP, GAP, GAP)] },
  { code: 'SST0503', severity: 'severe', describe: () => [SST['0503'](GAP)] },
  { code: 'SST0504', severity: 'info', describe: () => [SST['0504']()] },
  { code: 'SST0506', severity: 'severe', describe: () => [SST['0506']()] },
  { code: 'SST0507', severity: 'severe', describe: () => [SST['0507.nothing']()] },
  { code: 'SST0508', severity: 'warning', describe: () => [SST['0508']()] },
  { code: 'SST0509', severity: 'warning', describe: () => [SST['0509'](GAP)] },
  { code: 'SST0510', severity: 'severe', describe: () => [SST['0510'](GAP, GAP)] },
  { code: 'SST0511', severity: 'severe', describe: () => [SST['0511'](GAP, GAP, GAP)] },
  { code: 'SST0512', severity: 'severe', describe: () => [SST['0512'](GAP, GAP)] },
  { code: 'SST0513', severity: 'severe', describe: () => [SST['0513.high'](GAP, GAP, GAP)] },
  { code: 'SST0514', severity: 'severe', describe: () => [SST['0514.wraps'](GAP, GAP)] },
  {
    code: 'SST0515',
    severity: 'severe',
    describe: () => [SST['0515.high'](GAP, GAP, GAP, GAP)],
  },
  { code: 'SST0516', severity: 'severe', describe: () => [SST['0516'](GAP)] },
];
