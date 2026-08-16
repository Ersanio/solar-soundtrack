import { Pipe, type PipeTransform } from '@angular/core';

import { hex, hex2 } from './format';

/**
 * Hex formatting for templates.
 *
 * `format.ts` is unreachable from a template, and pipes rather than component
 * methods keep this out of the change-detection path: a pure pipe re-runs only
 * when its argument changes.
 */
@Pipe({ name: 'hex' })
export class HexPipe implements PipeTransform {
  transform(value: number): string {
    return hex(value);
  }
}

/** A byte: two digits, zero-padded. */
@Pipe({ name: 'hex2' })
export class Hex2Pipe implements PipeTransform {
  transform(value: number): string {
    return hex2(value);
  }
}
