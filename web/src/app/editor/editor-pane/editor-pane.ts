import { Component, effect, inject, signal, untracked } from '@angular/core';

import { IconAnalysis } from '../../shared/icons/icon-analysis';
import { IconRoll } from '../../shared/icons/icon-roll';
import { IconSamples } from '../../shared/icons/icon-samples';
import { IconScope } from '../../shared/icons/icon-scope';
import { IconSource } from '../../shared/icons/icon-source';
import { type TabDef, Tabs } from '../../shared/tabs/tabs';
import { ChannelMixer } from '../channel-mixer/channel-mixer';
import { EditorRequests } from '../../state/editor-requests';
import { AudioVisualization } from '../views/audio-visualization/audio-visualization';
import { PianoRoll } from '../views/piano-roll/piano-roll';
import { SampleBrowser } from '../views/sample-browser/sample-browser';
import { SongInspector } from '../views/song-inspector/song-inspector';
import { SourceView } from '../views/source-view/source-view';
import { readStored, writeStored } from '../../util/storage';

type ViewId = 'source' | 'samples' | 'roll' | 'inspector' | 'visualization';

const VIEW_KEY = 'solar-soundtrack.view';

const VIEWS: readonly TabDef<ViewId>[] = [
  { id: 'source', label: $localize`:@@editor.tab.source:editor.tab.source`, icon: IconSource },
  {
    id: 'roll',
    label: $localize`:@@editor.tab.roll:editor.tab.roll`,
    icon: IconRoll,
  },
  {
    id: 'inspector',
    label: $localize`:@@editor.tab.inspector:editor.tab.inspector`,
    icon: IconAnalysis,
    aside: true,
  },
  {
    id: 'visualization',
    label: $localize`:@@editor.tab.visualization:editor.tab.visualization`,
    icon: IconScope,
    aside: true,
  },
  {
    id: 'samples',
    label: $localize`:@@editor.tab.samples:editor.tab.samples`,
    icon: IconSamples,
    aside: true,
  },
];

/** The stored view, or the one the pane opens on when there is none. */
function readView(): ViewId {
  const stored = readStored(VIEW_KEY);
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
 * entry in {@link VIEWS} with its icon, and a `@case`.
 */
@Component({
  selector: 'amk-editor-pane',
  imports: [
    Tabs,
    ChannelMixer,
    SourceView,
    SampleBrowser,
    PianoRoll,
    SongInspector,
    AudioVisualization,
  ],
  templateUrl: './editor-pane.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class EditorPane {
  private readonly requests = inject(EditorRequests);

  protected readonly VIEWS = VIEWS;
  protected readonly view = signal<ViewId>(readView());

  constructor() {
    // Sanctioned effect: mirroring state into localStorage, as `app.ts` does
    // for the split and the palette for its category.
    effect(() => writeStored(VIEW_KEY, this.view()));

    // Sanctioned effect: consuming a request from outside the pane, as the output pane consumes
    // `revealSection`; put back to `null` so asking twice still takes.
    effect(() => {
      const view = this.requests.revealView();
      if (view) {
        untracked(() => {
          this.requests.revealView.set(null);
          this.view.set(view);
        });
      }
    });
  }
}
