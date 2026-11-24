/**
 * The Import dialog's preview: the candidate song on a player of its own, with a playhead in
 * driver ticks and a seek bar over them.
 *
 * A third `AudioContext`, beside the transport's and the note previewer's, because the candidate
 * is not the document and must not disturb what the transport holds. Pressing play stops the
 * other two first, so nothing sounds over it. Seconds only label a tick, through the walk's clock
 * (`.claude/rules/transport-and-clock.md`).
 */

import { computed, signal } from '@angular/core';

import { SpcPlayer, type SongTiming } from '@amk/spc/player';
import { clamp } from '../../util/math';
import { formatTime, minuteDigits } from '../../util/format';
import { type SongClock, secondsAtTick } from '../../state/song-clock';

/** What the preview plays: the candidate's SPC and what the player needs to know of its shape. */
export interface PreviewSong {
  spc: Uint8Array;
  introTicks: number;
  loopTicks: number;
  loops: boolean;
  clock: SongClock | null;
}

export class ImportPreview {
  readonly state = signal<'idle' | 'playing' | 'paused'>('idle');
  /** Where the song has got to, folded into one pass. */
  private readonly ticks = signal(0);
  /** Where the seek bar is being dragged to, while the drag goes on. */
  private readonly scrubbing = signal<number | null>(null);
  private readonly song = signal<PreviewSong | null>(null);
  private readonly player = new SpcPlayer();

  readonly durationTicks = computed(() => {
    const song = this.song();
    return song ? song.introTicks + song.loopTicks : 0;
  });
  readonly position = computed(() => this.scrubbing() ?? this.ticks());
  readonly canSeek = computed(() => this.durationTicks() > 0);

  /** `m:ss / m:ss`, the position and the length, both read off the walk's clock. */
  readonly clock = computed(() => {
    const clock = this.song()?.clock ?? null;
    if (!clock) {
      return '';
    }

    const total = secondsAtTick(clock, this.durationTicks());
    const digits = minuteDigits(total);
    return `${formatTime(secondsAtTick(clock, this.position()), digits)} / ${formatTime(total, digits)}`;
  });

  constructor(
    private readonly volume: () => number,
    private readonly silenceOthers: () => void,
    private readonly fail: (error: unknown) => void,
  ) {
    this.player.onPosition = (ticks) => this.ticks.set(ticks);
    this.player.onEnded = () => {
      this.state.set('idle');
      this.ticks.set(0);
    };

    this.player.onError = (error) => {
      this.state.set('idle');
      this.fail(error);
    };
  }

  private timing(song: PreviewSong): SongTiming {
    const total = song.clock ? secondsAtTick(song.clock, song.introTicks + song.loopTicks) : 0;
    return {
      introTicks: song.introTicks,
      loopTicks: song.loopTicks,
      fadeSeconds: total > 0 ? clamp(total / 8, 1, 3) : undefined,
      songLoops: song.loops,
    };
  }

  /** Hands over a new candidate; one playing is swapped in place at the tick it had reached. */
  load(song: PreviewSong | null): void {
    this.song.set(song);
    if (!song) {
      this.stop();
      return;
    }

    if (this.state() !== 'idle') {
      const paused = this.state() === 'paused';
      this.player.play(
        song.spc,
        Math.min(this.player.getSongTicks(), this.durationTicks()),
        this.timing(song),
      );
      if (paused) {
        this.player.pause();
      }
    }
  }

  /** Play, pause or resume. The first press is the audio unlock gesture. */
  async toggle(): Promise<void> {
    const song = this.song();
    if (!song) {
      return;
    }

    if (this.state() === 'playing') {
      this.player.pause();
      this.state.set('paused');
      return;
    }

    this.silenceOthers();
    if (this.state() === 'paused') {
      this.player.resume();
      this.state.set('playing');
      return;
    }

    try {
      await this.player.init();
      this.player.setVolume(this.volume());
      this.player.play(song.spc, this.ticks(), this.timing(song));
      this.state.set('playing');
    } catch (error) {
      this.fail(error);
    }
  }

  stop(): void {
    this.player.stop();
    this.state.set('idle');
    this.ticks.set(0);
  }

  scrubTo(ticks: number): void {
    this.scrubbing.set(clamp(ticks, 0, this.durationTicks()));
  }

  /** Lets go of the seek bar: a playing song replays to there, a stopped one starts there. */
  commitScrub(): void {
    const ticks = this.scrubbing();
    if (ticks === null) {
      return;
    }

    this.scrubbing.set(null);
    this.ticks.set(ticks);
    this.player.seek(ticks);
  }

  dispose(): void {
    this.state.set('idle');
    void this.player.dispose();
  }
}
