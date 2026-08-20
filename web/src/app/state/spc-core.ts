/**
 * One emulator per worker, brought up on demand.
 *
 * Both of the app's workers want the same thing — a `SpcCore` that outlives the
 * request that asked for it, because `instantiate` and the ARAM search inside it
 * are what cost, not the emulation. Module state is per worker instance, so each
 * worker importing this gets its own core and its own compiled module.
 *
 * The URL is passed in rather than resolved here: a relative `fetch` inside a
 * worker resolves against the worker's own bundled URL rather than the app's base
 * href, which is `/<repo>/` on Pages.
 */

import { type SpcCore, instantiate } from '@amk/spc/wasm-host';

let core: SpcCore | null = null;
let compiled: Promise<WebAssembly.Module> | null = null;

export async function coreFor(wasmUrl: string): Promise<SpcCore> {
  if (core) {
    return core;
  }

  compiled ??= fetch(wasmUrl).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Could not load ${wasmUrl} (HTTP ${response.status}).`);
    }

    return WebAssembly.compile(await response.arrayBuffer());
  });

  core = instantiate(await compiled);
  return core;
}
