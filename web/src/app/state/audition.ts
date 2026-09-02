import { DestroyRef, Service, computed, inject, signal } from '@angular/core';

import type { CompileResult } from '@amk/core/types';
import { NOTE_MAX, NOTE_MIN } from '@amk/core/hardcoded-tables';
import type { PitchSlide } from '@amk/spc/song-walk';
import { SPC_CHANNELS, SPC_SAMPLE_RATE } from '@amk/spc/wasm-host';
import { EditorStore } from './editor-store';
import { Mixer } from './mixer';
import type { AuditionRequest, NoteReply } from './note.worker';
import { transposeAt } from './note-transpose';
import { silencedReason } from './transport-view';
import { errorMessage } from '../util/format';

/** How long an auditioned note is held when the caller does not say — a whole note. */
export const AUDITION_TICKS = 192;

/** What {@link Audition.playNote} is asked for. */
export interface NotePlay {
  /** Music channel, 0 to 7. */
  channel: number;
  /** Where in the song the note is played, in music ticks. */
  tick: number;
  /**
   * The note **as written** — `$80` plus the key for a pitch, or `$D0`-`$D8` for
   * a drum. The transposition in force is applied here rather than by the caller,
   * because working it out needs the walk and the note map.
   */
  note: number;
  /** How long to hold it, in music ticks. Defaults to {@link AUDITION_TICKS}. */
  ticks?: number;
  /**
   * The `$DD` this note plays, as the walk read it — a note of the song is not
   * heard as it plays without the slide riding on it.
   *
   * Its target is the one value here that does **not** go through
   * {@link Audition.transposed}: that turns a written row pitch into the byte the
   * compiler would emit, and this is already that byte. `h` and the instrument's
   * tuning were resolved at compile time, and the driver adds `$43` and
   * `!HTuneValues+x` itself when it arms the slide (`main.asm:3277-3285`).
   */
  slide?: PitchSlide | null;
  /**
   * Say nothing about a note that did not sound — out of the driver's range, or
   * on a channel the mixer has silenced. For a caller that asks on every row of
   * a drag, where the alternative is the status line answering a question nobody
   * asked twenty times over. One deliberate press is not such a caller.
   */
  quiet?: boolean;
}

/** What {@link Audition.playRegion} is asked for. */
export interface RegionPlay {
  /** The first tick of the span, in music ticks. */
  tick: number;
  /** How many ticks of the song to play from there. */
  ticks: number;
}

/**
 * Playing one sample, one note of the song, or one stretch of it, on its own
 * AudioContext.
 *
 * Separate from `Playback` because it shares no machinery with the transport —
 * no worklet, no audio thread, no song being played — and because the separation
 * is the point rather than an accident of layout: auditioning must not interrupt
 * or be interrupted by the song, and the two contexts are what makes that true. A
 * note can be sounded while the song plays, and is meant to be.
 *
 * What the two do share is `Mixer`, and only as a number. A note on a channel the
 * mixer silences is refused here, before an emulator is asked for; one that
 * sounds carries the mask with it, so the echo it lands on is the echo the
 * transport is making. Neither is a route back to the worklet's emulator.
 *
 * Neither path reaches the emulator that is playing the song. A sample needs no
 * emulator at all — making that wait on `player.init()` would mean downloading
 * and compiling the SPC core just to hear a 65-byte square wave. A note needs
 * one, and gets a second, in a worker: `note.worker.ts` runs the song silently up
 * to the tick, hands the driver the note there and renders it, so what arrives
 * back is finished PCM and this end only has a buffer to play.
 *
 * The context is built on the first audition rather than on construction, so a
 * session that never auditions never opens one; the worker likewise waits for the
 * first note.
 */
@Service()
export class Audition {
  private readonly editor = inject(EditorStore);
  private readonly mixer = inject(Mixer);

  private context: AudioContext | null = null;
  /** The node sounding right now, and so what {@link previewing} is built on. */
  private readonly source = signal<AudioBufferSourceNode | null>(null);
  /** The slider's level, between every source and the destination. */
  private gain: GainNode | null = null;
  private worker: Worker | null = null;

  /**
   * Counts auditions, so PCM that was already being rendered when the next one
   * was asked for is dropped rather than played on top of it.
   */
  private token = 0;

  /**
   * The SPC the last note was auditioned against, and the compilation it came
   * from. Building one copies the whole 64 KiB image and every sample, and a run
   * of clicks is all the same song.
   */
  private image: { result: CompileResult; spc: Uint8Array } | null = null;

  /** The sample currently being auditioned, for the UI to show. */
  readonly playing = signal<string | null>(null);

  /**
   * Whether a render whose answer is still wanted is in flight.
   *
   * A note is heard by running the song silently up to its tick, which costs
   * what the fast-forward costs — so a drag across twenty rows would queue
   * twenty of them on the worker and hear them long after the pointer stopped.
   * The roll waits for this to clear and then asks for the row it is on *now*,
   * which keeps one render in flight and always the latest pitch.
   *
   * *Wanted* rather than merely running, because a run cannot be cancelled: a
   * {@link stop} clears this while the worker goes on rendering an answer that
   * will be dropped, and a reply the token has passed by leaves it alone rather
   * than clearing the flag of the request that superseded it.
   */
  readonly notePending = signal(false);

  /**
   * Whether a preview is on its way or sounding — what there is for a stop to
   * stop, and the one question the transport's button asks here.
   */
  readonly previewing = computed(() => this.notePending() || this.source() !== null);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stop();
      this.worker?.terminate();
      this.worker = null;
      void this.context?.close();
    });
  }

  /**
   * Plays decoded sample PCM at the DSP's native rate.
   *
   * This is the sample *as stored*: no instrument tuning, no pitch, no envelope.
   * A sample that sounds an octave off here can still be correct in a song — the
   * `$F3`/`@` tuning is what decides pitch at playback. {@link playNote} is the
   * other question, and answers it by playing the song.
   */
  play(name: string, pcm: Int16Array): void {
    this.stop();
    this.start(name, pcm, 1);
  }

  /**
   * Plays one note as it would sound at a point in the song.
   *
   * The whole song up to that tick is emulated, so the note is heard under the
   * instrument, volume, pan, tuning, `q` and echo that are in force there rather
   * than under a reconstruction of them. That takes as long as the fast-forward
   * does — a few hundred milliseconds for a click deep into a long song — and it
   * happens on a worker, so nothing that is playing is disturbed by the wait.
   */
  playNote(request: NotePlay): void {
    const scratchAt = this.editor.aramAddress();
    const spc = this.songImage();
    if (!spc || scratchAt === null || typeof Worker === 'undefined') {
      return;
    }

    // Before the range check, and before an emulator is asked for: hearing
    // nothing needs neither. The mask is the more actionable of the two answers
    // anyway, so a note that is both silenced and out of range reports this one.
    if (this.mixer.silenced() & (1 << request.channel)) {
      if (!request.quiet) {
        this.editor.say(silencedReason(request.channel, this.mixer.soloed()));
      }

      return;
    }

    const note = this.transposed(request);
    if (note === null) {
      // A drag crossing the end of the range asks for this on every row, so a
      // caller that expects to is allowed to ask quietly rather than filling
      // the status line with a message about a note it never committed.
      if (!request.quiet) {
        this.editor.fail('that note is out of range under the instrument in force there');
      }

      return;
    }

    this.stop();
    // This note sounds, so a hint saying why the last one did not has stopped
    // being true — un-muting a channel and hearing it again must not leave the
    // status line still calling it muted.
    this.editor.clearHint();

    this.render({
      kind: 'note',
      token: this.token,
      spc,
      wasmUrl: this.wasmUrl(),
      note: {
        atTicks: Math.max(0, Math.round(request.tick)),
        channel: request.channel,
        note,
        ticks: request.ticks ?? AUDITION_TICKS,
        slide: request.slide ?? null,
        scratchAt,
        // Read here rather than taken from the caller, so nothing can route a
        // preview around the mixer. The target's own bit is never set — a
        // silenced channel was refused above.
        silenced: this.mixer.silenced(),
      },
    });
  }

  /**
   * Plays a stretch of the song as it stands — the ticks a selection covers.
   *
   * The whole song up to the first of them is emulated, as {@link playNote}
   * emulates up to its note, and then it is simply allowed to play: nothing is
   * handed to the driver and no voice is parked, so what is heard is every
   * channel the mixer allows and every command that runs in between. A span past
   * the ceiling comes back cut and says nothing about it — the porter asked to
   * hear the selection, and the transport is what plays a whole song.
   *
   * No mixer refusal either, where a note has one: a region is the song rather
   * than one channel, so a silenced voice is not heard and that is all.
   */
  playRegion(request: RegionPlay): void {
    const spc = this.songImage();
    const ticks = Math.round(request.ticks);
    if (!spc || ticks <= 0 || typeof Worker === 'undefined') {
      return;
    }

    this.stop();
    this.editor.clearHint();
    this.render({
      kind: 'region',
      token: this.token,
      spc,
      wasmUrl: this.wasmUrl(),
      region: {
        atTicks: Math.max(0, Math.round(request.tick)),
        ticks,
        silenced: this.mixer.silenced(),
      },
    });
  }

  /**
   * Resolved here and not in the worker: a relative fetch there would resolve
   * against the worker's own bundled URL rather than the app's base href, which
   * is `/<repo>/` on Pages.
   */
  private wasmUrl(): string {
    return new URL('player/spc.wasm', document.baseURI).href;
  }

  private render(request: AuditionRequest): void {
    try {
      this.worker ??= this.startWorker();
      this.worker.postMessage(request);
      this.notePending.set(true);
    } catch (error) {
      this.worker = null;
      this.notePending.set(false);
      this.editor.fail(errorMessage(error));
    }
  }

  stop(): void {
    // Anything still rendering belongs to the audition being replaced, so its
    // answer is no longer wanted — a caller replacing it sets the flag again in
    // `render` a moment later, and one that is only stopping has nothing coming.
    this.token++;
    this.notePending.set(false);

    const source = this.source();
    this.source.set(null);
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

  /**
   * `name` for a sample, so the browser can show which row is sounding; `null`
   * for a note, which belongs to no row.
   */
  private start(name: string | null, pcm: Int16Array, channels: number): void {
    const frames = Math.floor(pcm.length / channels);
    if (frames === 0) {
      return;
    }

    try {
      this.context ??= new AudioContext();
      const context = this.context;

      const buffer = context.createBuffer(channels, frames, SPC_SAMPLE_RATE);
      for (let channel = 0; channel < channels; channel++) {
        const data = buffer.getChannelData(channel);
        for (let frame = 0; frame < frames; frame++) {
          data[frame] = pcm[frame * channels + channel] / 0x8000;
        }
      }

      // The transport's slider, on this path too: the same note under the
      // pointer and under the playhead is the same note, and one of them
      // ignoring the slider is one of them at a level nobody asked for. Read at
      // the source rather than mirrored by an effect — a preview lasts about a
      // second, and the level it starts at is the level it was asked for.
      if (!this.gain) {
        this.gain = context.createGain();
        this.gain.connect(context.destination);
      }

      this.gain.gain.value = this.mixer.volume() / 100;

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(this.gain);
      source.onended = () => {
        if (this.source() === source) {
          this.source.set(null);
          this.playing.set(null);
        }
      };

      source.start();

      this.source.set(source);
      this.playing.set(name);
      void context.resume();
    } catch (error) {
      this.editor.fail(errorMessage(error));
    }
  }

  /**
   * The written note carried to the byte the compiler would emit for it. `null`
   * when that byte is out of the range the driver can play, which is what the
   * compiler would say about the same note written in the same place.
   */
  private transposed(request: NotePlay): number | null {
    // A drum emits `$D0`-`$D8` whatever pitch is written against it, so there is
    // nothing to carry.
    if (request.note < NOTE_MIN || request.note >= NOTE_MAX) {
      return request.note;
    }

    const timeline = this.editor.timeline();
    const offset = timeline
      ? transposeAt(timeline.notes, this.editor.notesByAddress(), request.channel, request.tick)
      : 0;

    const note = request.note + offset;
    return note >= NOTE_MIN && note < NOTE_MAX ? note : null;
  }

  private songImage(): Uint8Array | null {
    const result = this.editor.result();
    if (!result?.ok || !result.data) {
      return null;
    }

    if (this.image?.result !== result) {
      const spc = this.editor.assembleSpc();
      this.image = spc ? { result, spc } : null;
    }

    return this.image?.spc ?? null;
  }

  private startWorker(): Worker {
    const worker = new Worker(new URL('./note.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<NoteReply>) => {
      const reply = event.data;
      // Superseded while it rendered: a run cannot be cancelled, so late answers
      // are dropped here rather than played over the newer one — and the flag is
      // left alone with them, since it belongs to whatever was asked for last
      // and `playRegion` may have asked while this one was still running.
      if (reply.token !== this.token) {
        return;
      }

      this.notePending.set(false);
      if (!reply.ok) {
        this.editor.fail(reply.message);
        return;
      }

      this.start(null, reply.pcm, SPC_CHANNELS);
    };

    worker.onerror = () => {
      this.worker?.terminate();
      this.worker = null;
      this.notePending.set(false);
    };

    return worker;
  }
}
