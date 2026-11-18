/**
 * The diagnostic codes the porter has suppressed, in every song, kept in the browser as the theme is.
 *
 * Only a code is kept, never a message or a span: suppressing AMK0216 hides every AMK0216. An
 * error cannot be suppressed whatever is stored here, which `EditorStore.diagnostics` decides.
 */

import { Service, effect, signal } from '@angular/core';

import { readStored, writeStored } from '../util/storage';

const STORAGE_KEY = 'solar-soundtrack.suppressed';

/** `AMK0216`, `SST0502`: what a stored entry has to look like to be read back. */
const CODE = /^(?:AMK|SST)\d{4}$/;

/** The stored list, or nothing where storage holds something else. */
function readCodes(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(readStored(STORAGE_KEY) ?? '[]');
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((code): code is string => typeof code === 'string' && CODE.test(code))
        : [],
    );
  } catch {
    return new Set();
  }
}

@Service()
export class Suppressions {
  readonly codes = signal<ReadonlySet<string>>(readCodes());

  constructor() {
    // Sanctioned effect: mirroring the list into localStorage.
    effect(() => writeStored(STORAGE_KEY, JSON.stringify([...this.codes()].sort())));
  }

  suppress(code: string): void {
    if (!this.codes().has(code)) {
      this.codes.update((codes) => new Set([...codes, code]));
    }
  }

  restore(code: string): void {
    if (this.codes().has(code)) {
      this.codes.update((codes) => new Set([...codes].filter((each) => each !== code)));
    }
  }

  restoreAll(): void {
    this.codes.set(new Set());
  }
}
