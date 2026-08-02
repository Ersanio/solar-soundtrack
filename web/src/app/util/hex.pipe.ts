import { Pipe, type PipeTransform } from '@angular/core';

import { hex, hex2, hex4 } from './format';

/**
 * Hex formatting for templates.
 *
 * `format.ts` is unreachable from a template, so before these existed every
 * panel that wanted a byte written the whole
 * `value.toString(16).toUpperCase().padStart(2, '0')` chain inline. Being pipes
 * rather than component methods also keeps them out of the change-detection
 * path: a pure pipe re-runs only when its argument changes.
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

/** An ARAM address: four digits, zero-padded. */
@Pipe({ name: 'hex4' })
export class Hex4Pipe implements PipeTransform {
  transform(value: number): string {
    return hex4(value);
  }
}
