import { Service, computed, signal } from '@angular/core';

import { type DriverBundle, loadDriver } from '@amk/spc/driver';
import { type InstrumentTables, readInstrumentTables } from '@amk/spc/instruments';
import { errorMessage } from '../util/format';

/**
 * The N-SPC driver and the ARAM layout that goes with it.
 *
 * Everything downstream depends on this: the song's load address is the slot the
 * driver's own song pointer table reserves, and every pointer the compiler emits
 * is relocated against it. So there is no "no driver" fallback — until one loads,
 * compilation is blocked rather than run against a guessed address.
 *
 * There is exactly one driver, `packages/spc/assets/driver/main.bin`, and it is a final-pass
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

  /**
   * The instrument and percussion tables the driver carries.
   *
   * Read out of `main.bin` rather than stated: the tables carry no citable
   * address, so the image is the only authority on them. `null` until it has
   * loaded, like everything else here. See `@amk/spc/instruments`.
   */
  readonly instruments = computed<InstrumentTables | null>(() => {
    const driver = this.driver();
    return driver ? readInstrumentTables(driver.programData, driver.manifest.programPos) : null;
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
