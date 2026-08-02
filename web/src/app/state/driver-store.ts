import { Service, computed, signal } from '@angular/core';

import { type DriverBundle, loadDriver, withCustomProgram } from '@spc/driver';
import {
  type InstrumentTables,
  bundledInstrumentTables,
  readInstrumentTables,
} from '@spc/instruments';
import { type AramPlan, planAram } from '@spc/layout';
import { errorMessage } from '../util/format';

/**
 * The loaded N-SPC driver and the ARAM layout derived from it.
 *
 * Everything downstream depends on this: the song's load address comes from the
 * driver's song pointer table, and every pointer the compiler emits is relocated
 * against it. So there is no "no driver" fallback — until one loads, compilation
 * is blocked rather than run against a guessed address.
 */
@Service()
export class DriverStore {
  /** The bundled default, loaded once at startup. */
  private readonly bundled = signal<DriverBundle | null>(null);
  /** A user-supplied `main.bin`, which wins while it is set. */
  private readonly uploaded = signal<DriverBundle | null>(null);

  readonly loadError = signal<string | null>(null);

  readonly driver = computed(() => this.uploaded() ?? this.bundled());
  readonly isCustom = computed(() => this.uploaded() !== null);
  readonly ready = computed(() => this.driver() !== null);

  /** Where the song lands and which `$F6` index selects it. */
  readonly plan = computed<AramPlan | null>(() => {
    const driver = this.driver();
    return driver ? planAram(driver) : null;
  });

  /**
   * The instrument and percussion tables this driver actually carries.
   *
   * Read out of `main.bin` rather than stated, so an uploaded driver reports its
   * own instruments; falls back to the bundled tables, labelled, when the search
   * cannot make sense of the image. See `spc/instruments.ts`.
   */
  readonly instruments = computed<InstrumentTables>(() => {
    const driver = this.driver();
    if (!driver) return bundledInstrumentTables();
    return readInstrumentTables(driver.programData, driver.programPos);
  });

  readonly summary = computed(() => {
    const driver = this.driver();
    return driver
      ? `${driver.source.name} · ${driver.programData.length.toLocaleString()} B`
      : null;
  });

  constructor() {
    void this.loadBundled();
  }

  private async loadBundled(): Promise<void> {
    try {
      this.bundled.set(await loadDriver());
    } catch (error) {
      this.loadError.set(errorMessage(error));
    }
  }

  /** Swaps in an install's own `main.bin`, so the ARAM figures are exact. */
  async useCustom(file: File): Promise<void> {
    const bundled = this.bundled();
    if (!bundled) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      this.uploaded.set(withCustomProgram(bundled, bytes, file.name));
      this.loadError.set(null);
    } catch (error) {
      this.loadError.set(errorMessage(error));
    }
  }

  reset(): void {
    this.uploaded.set(null);
    this.loadError.set(null);
  }
}
