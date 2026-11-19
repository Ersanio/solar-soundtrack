import { Component, computed, inject } from '@angular/core';

import { NOISE_SAMPLE } from '../../../../state/analysis/song-analysis';
import { EditorStore } from '../../../../state/editor-store';
import { SongAnalyzer } from '../../../../state/song-analyzer';
import { dbfs, percent } from '../inspector-units';

interface Row {
  key: string;
  srcn: string;
  name: string;
  bytes: string;
  share: string;
  peak: string;
  /** Loaded into ARAM and never heard. */
  unheard: boolean;
}

/**
 * Every sample the song is built with against what the analysis heard of it: what it costs in ARAM,
 * how much of the pass it sounds in and how loud it gets. A sample that costs bytes and is never
 * heard is the one worth taking out.
 */
@Component({
  selector: 'amk-sample-usage',
  templateUrl: './sample-usage.html',
  host: { class: 'flex flex-col' },
})
export class SampleUsage {
  private readonly editor = inject(EditorStore);
  private readonly analyzer = inject(SongAnalyzer);

  protected readonly text = {
    noise: $localize`:@@analysis.samples.noise:analysis.samples.noise`,
    never: $localize`:@@analysis.samples.never:analysis.samples.never`,
  };

  protected readonly rows = computed<Row[]>(() => {
    const analysis = this.analyzer.analysis();
    if (!analysis) {
      return [];
    }

    const reached = Math.max(
      1,
      Math.min(analysis.buckets, Math.ceil(analysis.ticks / analysis.bucketTicks)),
    );
    const heard = new Map(analysis.samples.map((lane) => [lane.id, lane]));
    const row = (id: number, name: string, bytes: number | null): Row => {
      const lane = heard.get(id);
      return {
        key: `${id}`,
        srcn: id === NOISE_SAMPLE ? '—' : `$${id.toString(16).toUpperCase().padStart(2, '0')}`,
        name,
        bytes: bytes === null ? '—' : bytes.toLocaleString(),
        share: lane ? percent(lane.sounding / reached) : this.text.never,
        peak: lane ? dbfs(lane.peakDb) : '—',
        unheard: !lane && (bytes ?? 0) > 0,
      };
    };

    const rows = this.editor.sampleSet().map((sample, id) => row(id, sample.name, sample.bytes));
    if (heard.has(NOISE_SAMPLE)) {
      rows.push(row(NOISE_SAMPLE, this.text.noise, null));
    }

    return rows;
  });

  /** The bytes the samples nobody hears take, for the line under the table. */
  protected readonly unheardBytes = computed(() => {
    const analysis = this.analyzer.analysis();
    if (!analysis) {
      return 0;
    }

    const heard = new Set(analysis.samples.map((lane) => lane.id));
    return this.editor
      .sampleSet()
      .reduce((sum, sample, id) => (heard.has(id) ? sum : sum + sample.bytes), 0);
  });

  protected readonly unheardLabel = computed(() => this.unheardBytes().toLocaleString());
}
