import { Service, computed, inject, signal } from '@angular/core';

import { EditorStore } from './editor-store';
import { type ChannelState, channelStates, silencedMask } from './transport-view';

/**
 * Which channels are heard, and which the porter has taken out.
 *
 * Off the spine rather than on `Playback`, because two things have to ask the
 * same question and neither owns the other: the transport pushes the mask at the
 * emulator playing the song, and the note previewer refuses to sound a channel
 * the mask silences. A previewer that reached the whole transport to find out
 * would depend on the song being played at all, which it deliberately does not.
 *
 * Nothing here rebuilds the song. The mask is applied to a running driver in APU
 * RAM, so preview and export build identical bytes.
 */
@Service()
export class Mixer {
  private readonly editor = inject(EditorStore);

  /** Channels the user silenced, as a bitmask. */
  private readonly mutedMask = signal(0);
  /**
   * The one channel the user isolated, or `null`. Solo is exclusive rather than
   * a mask: isolating a part means hearing that part, and two channels soloed at
   * once is just a mute of everything else wearing the wrong name.
   */
  private readonly soloedChannel = signal<number | null>(null);

  /**
   * With a channel soloed only that channel is heard, and nothing else applies:
   * engaging solo clears the mutes outright rather than holding them, so what
   * the buttons show is always what is being heard.
   */
  readonly silenced = computed(() => silencedMask(this.mutedMask(), this.soloedChannel()));

  /**
   * The isolated channel, so a caller refusing to sound another one can say
   * which. Not derivable from {@link silenced}: seven bits set is a solo to a
   * listener and seven separate mutes to the buttons, and they read differently.
   */
  readonly soloed = this.soloedChannel.asReadonly();

  /**
   * Only the channels the song actually writes to. A channel with no data has
   * nothing to mute, so it gets no controls at all and they appear as the song
   * grows into them. The state behind them is untouched by this: a channel that
   * goes empty keeps its mute or solo and resumes it if the channel comes back,
   * and `clearChannels()` reaches it either way.
   */
  readonly channels = computed<ChannelState[]>(() =>
    channelStates(
      this.editor.result()?.stats?.channelSizes ?? [],
      this.mutedMask(),
      this.soloedChannel(),
    ),
  );

  readonly isSoloing = computed(() => this.soloedChannel() !== null);
  readonly hasChannelOverrides = computed(() => this.mutedMask() !== 0 || this.isSoloing());

  /** Ignored while a channel is soloed, where the mute buttons are disabled. */
  toggleMute(channel: number): void {
    if (this.isSoloing()) {
      return;
    }

    this.mutedMask.update((mask) => mask ^ (1 << channel));
  }

  /**
   * Moves the solo to `channel`, or lifts it if that channel already has it.
   * Taking a solo discards the mutes, so lifting it again leaves the whole song
   * audible rather than restoring a mute the buttons stopped showing.
   */
  toggleSolo(channel: number): void {
    const soloed = this.soloedChannel() === channel ? null : channel;
    this.soloedChannel.set(soloed);
    if (soloed !== null) {
      this.mutedMask.set(0);
    }
  }

  /** Drops every mute and any solo, so the whole song is heard again. */
  clearChannels(): void {
    this.mutedMask.set(0);
    this.soloedChannel.set(null);
  }
}
