import { Component, effect, signal } from '@angular/core';

import { Panel } from '../../shared/panel/panel';
import { type TabDef, Tabs } from '../../shared/tabs/tabs';
import { ChannelMixer } from '../channel-mixer/channel-mixer';
import { PianoRoll } from '../views/piano-roll/piano-roll';
import { SampleBrowser } from '../views/sample-browser/sample-browser';
import { SourceView } from '../views/source-view/source-view';

type ViewId = 'source' | 'samples' | 'roll';

const VIEW_KEY = 'solar-soundtrack.view';

const VIEWS: readonly TabDef<ViewId>[] = [
  { id: 'source', label: 'Source' },
  { id: 'samples', label: 'Samples' },
  { id: 'roll', label: 'Piano Roll' },
];

/** The stored view, or the one the pane opens on when there is none. */
function readView(): ViewId {
  const stored = localStorage.getItem(VIEW_KEY);
  return VIEWS.find((view) => view.id === stored)?.id ?? 'source';
}

/**
 * The left pane: one view of the song at a time, and the channel mixer under
 * all of them.
 *
 * The views share this pane rather than taking a column of their own so that
 * the ARAM budget stays visible on the right while samples are being added —
 * the moment a sample set stops fitting is the moment you want to see it.
 *
 * This component is only the shell. It owns which view is selected and nothing
 * else: each view brings its own controls in an `amk-toolbar` of its own, since
 * word wrap means nothing in the sample library and a piano roll's zoom will
 * mean nothing in the source. Adding a view is a folder under `views/`, an
 * entry in {@link VIEWS} and a `@case`.
 */
@Component({
  selector: 'amk-editor-pane',
  imports: [Panel, Tabs, ChannelMixer, SourceView, SampleBrowser, PianoRoll],
  templateUrl: './editor-pane.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class EditorPane {
  protected readonly VIEWS = VIEWS;
  protected readonly view = signal<ViewId>(readView());

  constructor() {
    // Sanctioned effect: mirroring state into localStorage, as `app.ts` does
    // for the split and the palette for its category.
    effect(() => {
      try {
        localStorage.setItem(VIEW_KEY, this.view());
      } catch {
        /* Private browsing, or a full quota. The tabs still work this session. */
      }
    });
  }
}
