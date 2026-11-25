/** The optimizer run on a text as the editor compiles it, with the samples it brings beside the library's. */

import {
  type ExistingLoops,
  type OptimizeMode,
  type OptimizeResult,
  optimizeSong,
} from '@amk/optimize/optimize';
import type { EditorStore } from '../../state/editor-store';

/** `text` optimized in `mode`, or null before the driver loads. */
export function optimizeText(
  store: EditorStore,
  aramAddress: number | undefined,
  text: string,
  mode: OptimizeMode,
  extraSamples: readonly string[] = [],
  existingLoops: ExistingLoops = 'keep',
): OptimizeResult | null {
  if (aramAddress === undefined) {
    return null;
  }

  return optimizeSong(text, {
    mode,
    existingLoops,
    aramAddress,
    compile: (source, at) => {
      const compiled = store.compileText(source, extraSamples, at);
      if (!compiled) {
        throw new Error('The driver went away during an optimize.');
      }

      return compiled.result;
    },
  });
}
