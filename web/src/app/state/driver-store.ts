import { Service, computed, signal } from '@angular/core';

import { type DriverBundle, loadDriver } from '@spc/driver';
import {
  type InstrumentTables,
  bundledInstrumentTables,
  readInstrumentTables,
} from '@spc/instruments';
import { type AramPlan, planAram } from '@spc/layout';
import { errorMessage } from '../util/format';

/**
 * The N-SPC driver and the ARAM layout derived from it.
 *
 * Everything downstream depends on this: the song's load address comes from the
 * driver's song pointer table, and every pointer the compiler emits is relocated
 * against it. So there is no "no driver" fallback — until one loads, compilation
 * is blocked rather than run against a guessed address.
 *
 * There is exactly one driver, `public/driver/main.bin`, and it is a final-pass
 * AddmusicK build carrying its own song table and global songs. So there is no
 * state to track here beyond "has it arrived yet": what ships is what a stock
 * install has, and the ARAM figures are exact without anyone supplying anything.
 */
@Service()
export class DriverStore {
  private readonly loaded = signal<DriverBundle | null>(null);

  readonly loadError = signal<string | null>(null);

  readonly driver = this.loaded.asReadonly();
  readonly ready = computed(() => this.driver() !== null);

  /** Where the song lands and which `$F6` index selects it. */
  readonly plan = computed<AramPlan | null>(() => {
    const driver = this.driver();
    return driver ? planAram(driver) : null;
  });

  /**
   * The instrument and percussion tables this driver actually carries.
   *
   * Read out of `main.bin` rather than stated, so replacing the image reports its
   * own instruments; falls back to the bundled tables, labelled, when the search
   * cannot make sense of it. See `spc/instruments.ts`.
   */
  readonly instruments = computed<InstrumentTables>(() => {
    const driver = this.driver();
    if (!driver) {
      return bundledInstrumentTables();
    }

    return readInstrumentTables(driver.programData, driver.programPos);
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.loaded.set(await loadDriver());
    } catch (error) {
      this.loadError.set(errorMessage(error));
    }
  }
}
