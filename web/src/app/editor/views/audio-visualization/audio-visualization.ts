import { Component, computed, inject } from '@angular/core';

import { Toolbar } from '../../../shared/toolbar/toolbar';
import { Playback } from '../../../state/playback';
import { LiveMeters } from './live-meters/live-meters';

/**
 * The Audio Visualization tab: the song as it plays, read off the transport — the spectrum, a
 * scope per channel and the stereo field.
 */
@Component({
  selector: 'amk-audio-visualization',
  imports: [Toolbar, LiveMeters],
  templateUrl: './audio-visualization.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class AudioVisualization {
  private readonly playback = inject(Playback);

  protected readonly status = computed(() =>
    this.playback.isPlaying()
      ? $localize`:@@analysis.live.status.playing:analysis.live.status.playing`
      : $localize`:@@analysis.live.status.stopped:analysis.live.status.stopped`,
  );
}
