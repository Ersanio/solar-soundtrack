/**
 * One emulator per worker, brought up on demand.
 *
 * Every one of the app's workers wants the same thing — a `SpcCore` that outlives the
 * request that asked for it, because `instantiate` and the ARAM search inside it
 * are what cost, not the emulation. Module state is per worker instance, so each
 * worker importing this gets its own core and its own compiled module.
 *
 * The URL is passed in rather than resolved here: a relative `fetch` inside a
 * worker resolves against the worker's own bundled URL rather than the app's base
 * href, which is `/<repo>/` on Pages.
 */

import { type SpcCore, instantiate } from '@amk/spc/wasm-host';

let core: Promise<SpcCore> | null = null;

/**
 * The promise is what is kept, not the core: two requests arriving while the
 * module is still compiling have to be handed the same instance, and a
 * checkpoint taken on one emulator means nothing to another.
 */
export function coreFor(wasmUrl: string): Promise<SpcCore> {
  core ??= fetch(wasmUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Could not load ${wasmUrl} (HTTP ${response.status}).`);
      }

      return instantiate(await WebAssembly.compile(await response.arrayBuffer()));
    })
    .catch((error: unknown) => {
      core = null; // So the next request tries again rather than inheriting the failure.
      throw error;
    });

  return core;
}
