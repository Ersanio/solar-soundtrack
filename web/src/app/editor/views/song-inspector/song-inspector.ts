import { Component, DestroyRef, computed, inject } from '@angular/core';

import { Section } from '../../../shared/section/section';
import { StatTile } from '../../../shared/stat-tile/stat-tile';
import { Toolbar } from '../../../shared/toolbar/toolbar';
import { SongAnalyzer } from '../../../state/song-analyzer';
import { InspectorTimeline } from './inspector-timeline/inspector-timeline';
import { dbfs, lufs, percent } from './inspector-units';
import { LiveMeters } from './live-meters/live-meters';
import { SampleUsage } from './sample-usage/sample-usage';

/**
 * The Song Inspector: what the song sounds like, rather than what it says.
 *
 * Two halves. The live meters follow the transport — the spectrum, a scope per channel, the
 * stereo field. Under them is the whole pass at once, played silently on a worker by
 * `SongAnalyzer` with the mixer's mutes applied: levels per channel and per sample, loudness and
 * clipping, the stereo correlation, the echo, the spectrogram and what each sample costs. Holding
 * this view open is what keeps that analysis current.
 */
@Component({
  selector: 'amk-song-inspector',
  imports: [Toolbar, StatTile, Section, LiveMeters, InspectorTimeline, SampleUsage],
  templateUrl: './song-inspector.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class SongInspector {
  protected readonly analyzer = inject(SongAnalyzer);

  protected readonly text = {
    live: $localize`:@@analysis.section.live:analysis.section.live`,
    timeline: $localize`:@@analysis.section.timeline:analysis.section.timeline`,
    samples: $localize`:@@analysis.section.samples:analysis.section.samples`,
  };

  protected readonly status = computed(() => {
    if (this.analyzer.running()) {
      const value = Math.round(this.analyzer.progress() * 100);
      return $localize`:@@analysis.status.running:analysis.status.running ${value}:percent:`;
    }

    if (!this.analyzer.analysis()) {
      return $localize`:@@analysis.status.none:analysis.status.none`;
    }

    return this.analyzer.stale()
      ? $localize`:@@analysis.status.stale:analysis.status.stale`
      : $localize`:@@analysis.status.current:analysis.status.current`;
  });

  protected readonly tiles = computed(() => {
    const analysis = this.analyzer.analysis();
    if (!analysis) {
      return [];
    }

    return [
      {
        label: $localize`:@@analysis.tile.loudness:analysis.tile.loudness`,
        value: lufs(analysis.integratedLufs),
        dim: false,
      },
      {
        label: $localize`:@@analysis.tile.peak:analysis.tile.peak`,
        value: dbfs(analysis.peakDb),
        dim: false,
      },
      {
        label: $localize`:@@analysis.tile.clipped:analysis.tile.clipped`,
        value: analysis.clipCount.toLocaleString(),
        dim: analysis.clipCount === 0,
      },
      {
        label: $localize`:@@analysis.tile.voices:analysis.tile.voices`,
        value: $localize`:@@analysis.tile.voices.value:analysis.tile.voices.value ${analysis.maxPolyphony}:count:`,
        dim: false,
      },
      {
        label: $localize`:@@analysis.tile.echo:analysis.tile.echo`,
        value: percent(analysis.echoShare),
        dim: analysis.echoShare === 0,
      },
    ];
  });

  constructor() {
    inject(DestroyRef).onDestroy(this.analyzer.watch());
  }
}
