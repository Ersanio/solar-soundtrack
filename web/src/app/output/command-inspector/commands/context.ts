import type { Command } from '@amk/tokens';
import type { EnumOption } from '../../../shared/enum-select/enum-select';
import type { EditorStore } from '../../../state/editor-store';
import type { SampleStore } from '../../../state/sample-store';
import { tempoBefore } from '@amk/tokens/dialect';
import type { ParamContext } from '@amk/tokens/commands/param';

/**
 * The song's samples in SRCN order, as a picker's options.
 *
 * The compiled `#samples` list when there is one, because *its order is the SRCN
 * assignment* — index in this array is the byte a command writes. Before a
 * compile exists there is nothing authoritative, so the library's own names
 * stand in; they will be the same list for a song that has just been opened.
 */
export function sampleOptions(store: EditorStore, library: SampleStore): EnumOption[] {
  const names = store.result()?.sampleList ?? library.names();
  return names.map((name, index) => ({ value: index, label: name }));
}

/**
 * What a descriptor needs to know about the song around the command.
 *
 * Built once per render rather than per descriptor: `tempoBefore` walks the
 * command list, and a table with a dozen duration rows would otherwise walk it
 * a dozen times for the same answer.
 */
export function paramContext(
  command: Command,
  store: EditorStore,
  library: SampleStore,
): ParamContext {
  return {
    tempo: tempoBefore(command, store.tokens().commands),
    samples: sampleOptions(store, library),
  };
}
