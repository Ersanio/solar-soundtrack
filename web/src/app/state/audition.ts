import { DestroyRef, Service, inject, signal } from '@angular/core';

import { SPC_SAMPLE_RATE } from '@amk/spc/wasm-host';
import { EditorStore } from './editor-store';
import { errorMessage } from '../util/format';

/**
 * Playing one sample, on its own AudioContext.
 *
 * Separate from `Playback` because it shares nothing with the transport — no
 * worklet, no wasm, no emulator, no song — and because the separation is the
 * point rather than an accident of layout: auditioning a sample must not
 * interrupt or be interrupted by the song, and the two contexts are what makes
 * that true. Making this wait on `player.init()` would also mean downloading and
 * compiling the SPC core just to hear a 65-byte square wave.
 *
 * The context is built on the first audition rather than on construction, so a
 * session that never auditions never opens one.
 */
@Service()
export class Audition {
  private readonly editor = inject(EditorStore);

  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  /** The sample currently being auditioned, for the UI to show. */
  readonly playing = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      void this.context?.close();
    });
  }

  /**
   * Plays decoded sample PCM at the DSP's native rate.
   *
   * This is the sample *as stored*: no instrument tuning, no pitch, no envelope.
   * A sample that sounds an octave off here can still be correct in a song — the
   * `$F3`/`@` tuning is what decides pitch at playback.
   */
  play(name: string, pcm: Int16Array): void {
    this.stop();
    if (pcm.length === 0) {
      return;
    }

    try {
      this.context ??= new AudioContext();
      const context = this.context;

      const buffer = context.createBuffer(1, pcm.length, SPC_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index++) {
        channel[index] = pcm[index] / 0x8000;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => {
        if (this.source === source) {
          this.source = null;
          this.playing.set(null);
        }
      };

      source.start();

      this.source = source;
      this.playing.set(name);
      void context.resume();
    } catch (error) {
      this.editor.fail(errorMessage(error));
    }
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    this.playing.set(null);
    if (!source) {
      return;
    }

    source.onended = null;
    try {
      source.stop();
    } catch {
      // Already finished; nothing to stop.
    }
  }
}
