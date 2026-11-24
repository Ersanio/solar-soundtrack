/** A written import compiled, assembled and walked as the document would be: what an Import dialog's preview plays and what its Import is held back by. */

import type { CompileResult } from '@amk/core/types';
import type { BrrSample } from '@amk/spc/brr';
import { walkSong } from '@amk/spc/song-walk';
import { parsing } from '../../state/draft-guard';
import type { EditorStore } from '../../state/editor-store';
import { songClock } from '../../state/song-clock';
import { errorMessage } from '../../util/format';
import type { PreviewSong } from './import-preview';

export interface Candidate {
  song: PreviewSong | null;
  error: string | null;
  /** The compile, when it ran: an import that measures the room it leaves reads it. */
  result: CompileResult | null;
}

/** Samples the text names that the library does not hold yet, and how a compile's sample list resolves with them. */
export interface CandidateSamples {
  names: readonly string[];
  resolve: (sampleList: readonly string[], groups: readonly (string | null)[]) => BrrSample[];
}

/** `text` compiled with `samples` beside the library, assembled into an SPC, and walked for its clock. */
export function buildCandidate(
  store: EditorStore,
  text: string,
  samples: CandidateSamples | null = null,
): Candidate {
  const compiled = store.compileText(text, samples?.names ?? []);
  if (!compiled) {
    return { song: null, error: null, result: null };
  }

  const { result, aramAddress } = compiled;
  const failure = result.diagnostics.find((d) => d.severity === 'error');
  if (!result.ok || !result.data || failure) {
    return { song: null, error: failure ? `${failure.code}: ${failure.message}` : null, result };
  }

  let spc: Uint8Array | null;
  try {
    spc = store.spcFor(
      result,
      samples && result.sampleList
        ? samples.resolve(result.sampleList, result.stats?.sampleGroups ?? [])
        : undefined,
    );
  } catch (error) {
    return { song: null, error: errorMessage(error), result };
  }

  const data = result.data;
  const timeline = parsing(() => walkSong(data, aramAddress));
  const stats = result.stats;
  return {
    song: spc
      ? {
          spc,
          introTicks: stats?.introTicks ?? 0,
          loopTicks: stats?.loopTicks ?? 0,
          loops: stats?.loops ?? true,
          clock: songClock(timeline),
        }
      : null,
    error: null,
    result,
  };
}
