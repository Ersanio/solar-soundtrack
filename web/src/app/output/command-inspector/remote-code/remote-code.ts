import { Component, computed, inject, input } from '@angular/core';

import type { RemoteCall, RemoteConstruct, RemoteReset } from '@amk/tokens/commands/remote';
import { ticksLabel } from '@amk/tokens/commands/units';
import { EnumSelect } from '../../../shared/enum-select/enum-select';
import { Slider } from '../../../shared/slider/slider';
import { CommitAudition } from '../../../state/commit-audition';
import { EditorStore } from '../../../state/editor-store';
import { CommandChip } from '../command-chip/command-chip';
import { dragPreview } from '../commands/preview';
import { remoteResetEdit, remoteTypeEdit, remoteView, remoteWaitEdit } from './remote-focus';

/**
 * A remote code call — its type, its wait, and the commands its body runs — or a
 * reset.
 *
 * Not the parameter table, because a call is not a `Command`: its parts are
 * read off the text by `@amk/tokens/commands/remote`, and the third argument is
 * there only for two of the types. `remote-focus.ts` builds what this draws and
 * the splices it hands back.
 */
@Component({
  selector: 'amk-remote-code',
  imports: [CommandChip, EnumSelect, Slider],
  templateUrl: './remote-code.html',
  host: { class: 'contents' },
})
export class RemoteCode {
  private readonly store = inject(EditorStore);

  private readonly commitAudition = inject(CommitAudition);

  readonly construct = input.required<RemoteConstruct>();

  private readonly view = computed(() =>
    remoteView({
      index: this.store.tokens(),
      loops: this.store.loops(),
      construct: this.construct(),
    }),
  );

  protected readonly call = computed(() => {
    const view = this.view();
    return view.kind === 'call' ? view : null;
  });

  protected readonly reset = computed(() => {
    const view = this.view();
    return view.kind === 'reset' ? view : null;
  });

  private readonly drag = dragPreview(this.construct);

  /** The wait said in ticks, note length and seconds, following the slider mid-drag. */
  protected readonly waitNote = computed(() => {
    const wait = this.call()?.wait;
    return wait ? ticksLabel(this.drag.at('wait', wait.ticks), wait.tempo) : null;
  });

  protected previewWait(ticks: number): void {
    this.drag.set('wait', ticks);
  }

  protected setType(call: RemoteCall, type: number): void {
    this.commitAudition.apply(remoteTypeEdit(this.store.source(), call, type));
  }

  protected setWait(call: RemoteCall, ticks: number): void {
    this.commitAudition.apply(remoteWaitEdit(this.store.source(), call, ticks));
  }

  protected setReset(reset: RemoteReset, which: number): void {
    this.commitAudition.apply(remoteResetEdit(this.store.source(), reset, which));
  }
}
