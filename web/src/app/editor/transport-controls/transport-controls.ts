import { Component, computed, effect, inject, signal } from '@angular/core';

import { Audition } from '../../state/audition';
import { Button } from '../../shared/button/button';
import { IconLoop } from '../../shared/icons/icon-loop';
import { IconPause } from '../../shared/icons/icon-pause';
import { IconPlay } from '../../shared/icons/icon-play';
import { IconStop } from '../../shared/icons/icon-stop';
import { IconVolume } from '../../shared/icons/icon-volume';
import { Toggle } from '../../shared/toggle/toggle';
import { EditorStore } from '../../state/editor-store';
import { Mixer } from '../../state/mixer';
import { Playback } from '../../state/playback';
import { stopAll } from '../../state/stop-all';
import { readStored, writeStored } from '../../util/storage';
import { rollClock } from '../views/piano-roll/roll-clock';

/** The volume slider's ceiling, in percent. */
const VOLUME_MAX = 500;

/** What the clock shows: the m:ss the song's clock gives a tick, or the tick itself. */
type ClockFace = 'time' | 'ticks';

const CLOCK_KEY = 'solar-soundtrack.clock';

/** The stored face, or the m:ss one when there is none. */
function readClockFace(): ClockFace {
  return readStored(CLOCK_KEY) === 'ticks' ? 'ticks' : 'time';
}

/** The browser's default range thumb, in px — Chromium's is 16, Firefox's 1em is within a couple. */
const THUMB_WIDTH = 16;

@Component({
  selector: 'amk-transport-controls',
  imports: [Button, Toggle, IconLoop, IconPause, IconPlay, IconStop, IconVolume],
  templateUrl: './transport-controls.html',
  host: {
    class:
      'border-edge bg-inset/50 flex h-10 min-w-0 items-center gap-1.5 rounded-md border px-1.5',
  },
})
export class TransportControls {
  protected readonly playback = inject(Playback);
  protected readonly mixer = inject(Mixer);
  protected readonly store = inject(EditorStore);
  private readonly audition = inject(Audition);
  protected readonly VOLUME_MAX = VOLUME_MAX;

  /**
   * Anything there is to stop: the song, or a note or selection being previewed.
   *
   * The two are asked separately because they are separate — the previewer has
   * its own AudioContext and neither interrupts the other of its own accord — so
   * this button is where they meet, as the volume slider is for the level.
   */
  protected readonly canStop = computed(
    () => !this.playback.isIdle() || this.audition.previewing(),
  );

  /** Which face the clock shows; a click flips it, and the choice is kept. */
  protected readonly clockFace = signal<ClockFace>(readClockFace());

  /** The tempo as `t` writes it — `DriverState.tempo` is `$51`, one higher. */
  private readonly tempo = computed(() => {
    const driver = this.playback.driver();
    return driver && driver.tempo > 0 ? driver.tempo - 1 : 0;
  });

  /**
   * The tick face counts at frame rate, and only then: the m:ss face reads the
   * ten-a-second anchor as it always has, and a scrub shows where the song is
   * being asked to go rather than where it is.
   */
  private readonly counting = computed(
    () => this.clockFace() === 'ticks' && this.playback.isPlaying() && !this.playback.isScrubbing(),
  );

  /** The roll's own display clock, so the number here and the line there agree. */
  private readonly displayClock = rollClock({
    running: this.counting,
    anchor: this.playback.songTicks,
    clock: this.store.clock,
    tempo: this.tempo,
    pass: this.playback.durationTicks,
  });

  protected readonly clockLabel = computed(() => {
    if (this.clockFace() === 'time') {
      return `${this.playback.timeLabel()} / ${this.playback.durationLabel()}`;
    }

    const tick = this.counting() ? this.displayClock.tick() : this.playback.position();
    return `tick ${Math.round(tick).toLocaleString()} / ${this.playback.durationTicks().toLocaleString()}`;
  });

  protected readonly clockTitle = computed(() =>
    this.clockFace() === 'time'
      ? 'Time in the song — click for ticks'
      : 'Driver ticks — click for time',
  );

  /** True while a pointer is down on the volume slider, or after a keyboard change until it blurs. */
  protected readonly volumeReadout = signal(false);

  /** The percentage under the volume thumb, or `null` when nothing is adjusting it. */
  protected readonly volumeBubble = computed(() => {
    if (!this.volumeReadout()) {
      return null;
    }

    const volume = this.mixer.volume();
    const fraction = volume / VOLUME_MAX;

    // The thumb's centre: half a thumb in from the left, then its travel is the track less one thumb.
    return {
      left: `calc(${THUMB_WIDTH / 2}px + ${fraction} * (100% - ${THUMB_WIDTH}px))`,
      text: `${volume}%`,
    };
  });

  constructor() {
    // Sanctioned effect: mirroring state into localStorage, as `app.ts` does for
    // the split.
    effect(() => writeStored(CLOCK_KEY, this.clockFace()));
  }

  protected toggleClockFace(): void {
    this.clockFace.update((face) => (face === 'time' ? 'ticks' : 'time'));
  }

  /** Stops whichever of the two is going, and both where both are — the roll's `Space` too. */
  protected stop(): void {
    stopAll(this.playback, this.audition);
  }

  protected onVolume(event: Event): void {
    this.mixer.volume.set(Number((event.target as HTMLInputElement).value));
    this.volumeReadout.set(true);
  }

  /**
   * Dragging: move the readout with the pointer, but leave the song alone.
   *
   * The bar is denominated in driver ticks, like everything else that follows
   * the music — the m:ss beside it is the label {@link Playback.timeLabel}
   * derives, not the value being dragged.
   */
  protected onScrub(event: Event): void {
    this.playback.scrubTo(Number((event.target as HTMLInputElement).value));
  }
}
