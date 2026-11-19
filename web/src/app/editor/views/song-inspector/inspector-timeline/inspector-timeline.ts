import {
  Component,
  type ElementRef,
  computed,
  effect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';

import {
  NOISE_SAMPLE,
  SOUNDING_DB,
  type SongAnalysis,
} from '../../../../state/analysis/song-analysis';
import { canvasColors, fitCanvas } from '../../../../shared/chart/canvas-colors';
import { elementSize } from '../../../../shared/chart/element-size';
import { EditorStore } from '../../../../state/editor-store';
import { Mixer } from '../../../../state/mixer';
import { Playback } from '../../../../state/playback';
import { SongAnalyzer } from '../../../../state/song-analyzer';
import { CHANNEL_FILL, CHANNEL_QUIET } from '../../../../util/channel-palette';
import { rollClock } from '../../piano-roll/roll-clock';
import {
  TIMELINE_WIDTH,
  areaPath,
  columnMax,
  flagPath,
  linePath,
  markedColumns,
  spectrogramColumns,
  tickFraction,
} from '../timeline-paths';

/** A row of the timeline: one `<svg>` lane, with what it is called beside it. */
interface Lane {
  key: string;
  label: string;
  title: string;
  /** Height in pixels, which is also the lane's `viewBox` height. */
  height: number;
  box: string;
  areas: { d: string; class: string }[];
  lines: { d: string; class: string; dashed?: boolean }[];
  /** Thin vertical marks, as x columns: clipping. */
  marks: number[];
  markClass: string;
  /** Dimmed: a channel the mixer silences or the song leaves empty. */
  quiet: boolean;
  /** The label's own classes: struck through for a channel the mixer silences. */
  labelClass: string;
}

interface Group {
  key: string;
  heading: string;
  lanes: Lane[];
}

const VOICES = 8;

/** The floor of a level lane: anything quieter is not sounding. */
const LANE_FLOOR = SOUNDING_DB;

function lane(key: string, label: string, title: string, height: number): Lane {
  return {
    key,
    label,
    title,
    height,
    box: `0 0 ${TIMELINE_WIDTH} ${height}`,
    areas: [],
    lines: [],
    marks: [],
    markClass: '',
    quiet: false,
    labelClass: '',
  };
}

const hex = (value: number): string => `$${value.toString(16).toUpperCase().padStart(2, '0')}`;

/**
 * The whole pass at once, as the analysis heard it: a lane per channel, a lane per sample, the
 * loudness, the stereo field, the echo and the spectrogram, on one tick axis with the playhead
 * across all of them. A click anywhere seeks there.
 *
 * Every lane takes the same fraction of the width for the same tick (`timeline-paths.ts`), so a
 * line drawn down them is one moment of the song. Built from the standing analysis; dimmed while
 * that is out of date.
 */
@Component({
  selector: 'amk-inspector-timeline',
  templateUrl: './inspector-timeline.html',
  host: { class: 'flex flex-col' },
})
export class InspectorTimeline {
  private readonly analyzer = inject(SongAnalyzer);
  private readonly playback = inject(Playback);
  private readonly editor = inject(EditorStore);
  private readonly mixer = inject(Mixer);

  protected readonly text = {
    noise: $localize`:@@analysis.timeline.noise:analysis.timeline.noise`,
    levels: $localize`:@@analysis.timeline.levels:analysis.timeline.levels`,
    samples: $localize`:@@analysis.timeline.samples:analysis.timeline.samples`,
    loudness: $localize`:@@analysis.timeline.loudness:analysis.timeline.loudness`,
    loudnessTitle: $localize`:@@analysis.timeline.loudness.title:analysis.timeline.loudness.title`,
    stereo: $localize`:@@analysis.timeline.stereo:analysis.timeline.stereo`,
    correlation: $localize`:@@analysis.timeline.correlation:analysis.timeline.correlation`,
    correlationTitle: $localize`:@@analysis.timeline.correlation.title:analysis.timeline.correlation.title`,
    echo: $localize`:@@analysis.timeline.echo:analysis.timeline.echo`,
    buffer: $localize`:@@analysis.timeline.echo-buffer:analysis.timeline.echo-buffer`,
    bufferTitle: $localize`:@@analysis.timeline.echo-buffer.title:analysis.timeline.echo-buffer.title`,
    settings: $localize`:@@analysis.timeline.echo-settings:analysis.timeline.echo-settings`,
    settingsTitle: $localize`:@@analysis.timeline.echo-settings.title:analysis.timeline.echo-settings.title`,
    sends: $localize`:@@analysis.timeline.echo-sends:analysis.timeline.echo-sends`,
    sendsTitle: $localize`:@@analysis.timeline.echo-sends.title:analysis.timeline.echo-sends.title`,
  };

  private readonly spectrogram = viewChild<ElementRef<HTMLCanvasElement>>('spectrogram');
  private readonly spectrogramSize = elementSize(this.spectrogram);
  private readonly colors = canvasColors();

  /** The spectrogram's axis, top to bottom, three octaves apart, so evenly spaced on its log scale. */
  protected readonly frequencyLabels = ['16k', '2k', '250', '31.5'];

  protected readonly analysis = this.analyzer.analysis;
  protected readonly stale = this.analyzer.stale;

  private readonly tempo = computed(() => {
    const driver = this.playback.driver();
    return driver && driver.tempo > 0 ? driver.tempo - 1 : 0;
  });

  private readonly clock = rollClock({
    running: computed(() => this.playback.isPlaying() && !this.playback.isScrubbing()),
    anchor: this.playback.songTicks,
    clock: this.editor.clock,
    tempo: this.tempo,
    pass: this.playback.durationTicks,
  });

  /** The pass the axis spans: the analysis's own, so a stale one still lines up with itself. */
  private readonly pass = computed(
    () => this.analysis()?.passTicks ?? this.playback.durationTicks(),
  );

  /** The playhead, as a percentage of the width. */
  protected readonly playheadAt = computed(() => {
    const tick =
      this.playback.isPlaying() && !this.playback.isScrubbing()
        ? this.clock.tick()
        : this.playback.position();
    return tickFraction(tick, this.pass()) * 100;
  });

  /** Where the intro ends and the loop begins, as a percentage, or `null` for a song with no intro. */
  protected readonly loopAt = computed(() => {
    const stats = this.editor.result()?.stats;
    const intro = stats?.introTicks ?? 0;
    return intro > 0 && stats?.loops ? tickFraction(intro, this.pass()) * 100 : null;
  });

  protected readonly groups = computed<Group[]>(() => {
    const analysis = this.analysis();
    if (!analysis) {
      return [];
    }

    return [
      this.levelGroup(analysis),
      this.sampleGroup(analysis),
      this.loudnessGroup(analysis),
      this.echoGroup(analysis),
    ];
  });

  constructor() {
    // Sanctioned effect: painting the spectrogram, when the analysis, the box or the theme changes.
    effect(() => {
      const analysis = this.analysis();
      const size = this.spectrogramSize();
      this.colors.version();
      untracked(() => this.drawSpectrogram(analysis, size.width, size.height));
    });
  }

  /** Seeks to the tick under the pointer. */
  protected seekAt(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    const box = target.getBoundingClientRect();
    if (box.width <= 0) {
      return;
    }

    const fraction = (event.clientX - box.left) / box.width;
    this.playback.seek(Math.round(fraction * this.pass()));
  }

  private reached(analysis: SongAnalysis): number {
    return Math.min(analysis.buckets, Math.ceil(analysis.ticks / analysis.bucketTicks) || 1);
  }

  private levelGroup(analysis: SongAnalysis): Group {
    const silenced = this.mixer.silenced();
    const used = new Set(this.mixer.channels().map((channel) => channel.index));
    const reached = this.reached(analysis);
    const lanes = Array.from({ length: VOICES }, (_, voice) => {
      const row = lane(`ch${voice}`, `#${voice}`, '', 18);
      const quiet = (silenced & (1 << voice)) !== 0;
      row.quiet = quiet || !used.has(voice);
      row.labelClass = quiet ? CHANNEL_QUIET : row.quiet ? 'opacity-40' : '';
      if (!quiet) {
        const levels = analysis.voiceLevel.subarray(
          voice * analysis.buckets,
          (voice + 1) * analysis.buckets,
        );
        const columns = columnMax(levels, reached, analysis.bucketTicks, analysis.passTicks);
        row.areas.push({
          d: areaPath(columns, LANE_FLOOR, 0, row.height),
          class: CHANNEL_FILL[voice],
        });
      }

      return row;
    });

    return { key: 'levels', heading: this.text.levels, lanes };
  }

  private sampleGroup(analysis: SongAnalysis): Group {
    const set = this.editor.sampleSet();
    const reached = this.reached(analysis);
    const lanes = analysis.samples.map((sample) => {
      const name =
        sample.id === NOISE_SAMPLE ? this.text.noise : (set[sample.id]?.name ?? hex(sample.id));
      const label = sample.id === NOISE_SAMPLE ? name : `${hex(sample.id)} ${name}`;
      const row = lane(`s${sample.id}`, label, label, 14);
      const columns = columnMax(sample.level, reached, analysis.bucketTicks, analysis.passTicks);
      row.areas.push({ d: areaPath(columns, LANE_FLOOR, 0, row.height), class: 'fill-control' });
      return row;
    });

    return { key: 'samples', heading: this.text.samples, lanes };
  }

  private loudnessGroup(analysis: SongAnalysis): Group {
    const reached = this.reached(analysis);
    const { bucketTicks, passTicks } = analysis;

    const loudness = lane('loudness', this.text.loudness, this.text.loudnessTitle, 56);
    const peak = columnMax(analysis.peak, reached, bucketTicks, passTicks);
    const lufs = columnMax(analysis.loudness, reached, bucketTicks, passTicks);
    loudness.areas.push({
      d: areaPath(peak, LANE_FLOOR, 0, loudness.height),
      class: 'fill-control/40',
    });
    loudness.lines.push({
      d: linePath(lufs, LANE_FLOOR, 0, loudness.height, true),
      class: 'stroke-accent',
    });
    loudness.marks = markedColumns(analysis.clips, reached, bucketTicks, passTicks);
    loudness.markClass = 'fill-danger';

    const stereo = lane('stereo', this.text.correlation, this.text.correlationTitle, 28);
    // The lowest correlation in each column, so a moment of phase trouble is not averaged away.
    const negated = analysis.correlation.map((value) => -value);
    const lowest = columnMax(negated, reached, bucketTicks, passTicks).map((value) => -value);
    stereo.lines.push({ d: linePath(lowest, -1, 1, stereo.height), class: 'stroke-good' });
    stereo.lines.push({ d: `M0 ${stereo.height / 2}H${TIMELINE_WIDTH}`, class: 'stroke-edge' });

    return { key: 'loudness', heading: this.text.stereo, lanes: [loudness, stereo] };
  }

  private echoGroup(analysis: SongAnalysis): Group {
    const reached = this.reached(analysis);
    const { bucketTicks, passTicks } = analysis;

    const buffer = lane('echo-buffer', this.text.buffer, this.text.bufferTitle, 28);
    const energy = columnMax(analysis.echoEnergy, reached, bucketTicks, passTicks);
    buffer.areas.push({
      d: areaPath(energy, LANE_FLOOR, 0, buffer.height),
      class: 'fill-seg-echo',
    });

    const settings = lane('echo-settings', this.text.settings, this.text.settingsTitle, 28);
    const volume = new Float32Array(analysis.buckets);
    for (let b = 0; b < analysis.buckets; b++) {
      volume[b] =
        (Math.abs(analysis.echoVolume[b * 2]) + Math.abs(analysis.echoVolume[b * 2 + 1])) / 2;
    }

    settings.lines.push({ d: `M0 ${settings.height / 2}H${TIMELINE_WIDTH}`, class: 'stroke-edge' });
    settings.lines.push({
      d: linePath(columnMax(volume, reached, bucketTicks, passTicks), -128, 128, settings.height),
      class: 'stroke-accent',
    });
    settings.lines.push({
      d: linePath(
        columnMax(analysis.echoFeedback, reached, bucketTicks, passTicks),
        -128,
        128,
        settings.height,
      ),
      class: 'stroke-warn',
      dashed: true,
    });

    const sends = lane('echo-sends', this.text.sends, this.text.sendsTitle, VOICES * 3);
    for (let voice = 0; voice < VOICES; voice++) {
      sends.areas.push({
        d: flagPath(analysis.echoSends, reached, voice, bucketTicks, passTicks, voice * 3, 2),
        class: CHANNEL_FILL[voice],
      });
    }

    return { key: 'echo', heading: this.text.echo, lanes: [buffer, settings, sends] };
  }

  private drawSpectrogram(analysis: SongAnalysis | null, width: number, height: number): void {
    const canvas = this.spectrogram()?.nativeElement;
    if (!canvas) {
      return;
    }

    const context = fitCanvas(canvas, width, height);
    if (!context) {
      return;
    }

    context.clearRect(0, 0, width, height);
    if (!analysis || analysis.spectrogram.columns === 0) {
      return;
    }

    const { rows, levels, ticks } = analysis.spectrogram;
    const pixels = Math.max(1, Math.round(width));
    const lookup = spectrogramColumns(ticks, analysis.passTicks, pixels);

    // The ramp from the ground through the controls and the accent to the ink.
    const stops = ['surface', 'control', 'accent', 'ink'].map((token) => this.colors.rgb(token));
    const ramp = new Uint8ClampedArray(256 * 3);
    for (let n = 0; n < 256; n++) {
      const at = (n / 255) * (stops.length - 1);
      const from = Math.min(stops.length - 2, Math.floor(at));
      const t = at - from;
      for (let c = 0; c < 3; c++) {
        ramp[n * 3 + c] = stops[from][c] + (stops[from + 1][c] - stops[from][c]) * t;
      }
    }

    const image = new ImageData(pixels, rows);
    for (let x = 0; x < pixels; x++) {
      const column = lookup[x];
      for (let row = 0; row < rows; row++) {
        const at = ((rows - 1 - row) * pixels + x) * 4;
        const level = column < 0 ? 0 : levels[column * rows + row];
        image.data[at] = ramp[level * 3];
        image.data[at + 1] = ramp[level * 3 + 1];
        image.data[at + 2] = ramp[level * 3 + 2];
        image.data[at + 3] = column < 0 ? 0 : 255;
      }
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = pixels;
    offscreen.height = rows;
    offscreen.getContext('2d')?.putImageData(image, 0, 0);
    context.imageSmoothingEnabled = true;
    context.drawImage(offscreen, 0, 0, width, height);
  }
}
