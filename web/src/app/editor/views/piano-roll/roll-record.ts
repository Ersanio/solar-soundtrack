import {
  DestroyRef,
  type Signal,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';

import { NOTE_MIN } from '@amk/core/hardcoded-tables';
import type { SongTimeline } from '@amk/spc/song-walk';
import { frameClock } from '../../../shared/chart/frame-clock';
import { Audition } from '../../../state/audition';
import { EditorRequests } from '../../../state/editor-requests';
import { EditorStore } from '../../../state/editor-store';
import { type MidiKey, MidiInput } from '../../../state/midi-input';
import { Mixer } from '../../../state/mixer';
import { Playback } from '../../../state/playback';
import { silencedReason } from '../../../state/transport-view';
import { CHANNEL_FILL } from '../../../util/channel-palette';
import { onChange } from '../../../util/on-change';
import type { EditMode } from './roll-edit';
import type { LaneStack } from './roll-layout';
import { barRect } from './roll-metrics';
import { rowOfPlaced } from './roll-preview';
import { channelStrip, isStrip } from './roll-strip';
import {
  type Take,
  type Wall,
  emptyTake,
  keyDown,
  keyUp,
  loopWalls,
  onWall,
  recordTickStep,
  releaseAll,
  snappedTick,
  takeNotes,
  writtenOfKey,
} from './roll-take';
import { songReading, takeEdits } from './roll-write/take-edits';

/**
 * `armed` is a recording waiting for its first key: the pointer stands where it
 * was, so the take has no silence in front of it.
 */
export type RecordPhase = 'idle' | 'armed' | 'recording';

/** One note of the take in flight, as a box in the roll's own coordinates. */
export interface TakeBar {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The fill of the channel the key landed on. */
  fill: string;
  /** On a loop's ticks, where it will not be written. */
  blocked: boolean;
}

export interface RecordSources {
  /** The channel being edited, which every take is recorded on. */
  editChannel: Signal<number | null>;
  /** Names a channel as the one being edited, for a key played with none picked. */
  pickChannel: (channel: number) => void;
  /** The other channels a chord spreads over. */
  chordChannels: Signal<readonly number[]>;
  keySounds: Signal<boolean>;
  /** Play the song under the take rather than running the pointer in silence. */
  playSong: Signal<boolean>;
  /** What a note's ends snap to, in ticks; `0` for none. */
  snap: Signal<number>;
  editMode: Signal<EditMode>;
  stack: Signal<LaneStack>;
  zoom: Signal<number>;
  rowHeight: Signal<number>;
  timeline: Signal<SongTimeline | null>;
  /**
   * Where the transport's own playhead is, at frame rate. A function because the
   * view that answers it is built after this, and reads this in turn.
   */
  transportTick: () => number;
}

export interface RollRecord {
  phase: Signal<RecordPhase>;
  /** The record pointer at frame rate, or `null` when nothing is being recorded. */
  tick: Signal<number | null>;
  /** The same pointer ten times a second, for the mark window. */
  windowTick: Signal<number | null>;
  /** The channels a take is spread over: the edited one and the chord's, ascending. */
  channels: Signal<readonly number[]>;
  /** The notes already played, and the keys still down. */
  doneBars: Signal<readonly TakeBar[]>;
  liveBars: Signal<readonly TakeBar[]>;
  /** The rows of the keys being held, for the key column to light. */
  heldRows: Signal<ReadonlySet<number>>;
  /** How many notes the take holds so far. */
  noteCount: Signal<number>;
  /** Why the last recording did not start or was not written, or what it left out. */
  message: Signal<string | null>;
  /** The earliest tick a key pressed now could sound at, or `null` while none would sound. */
  keyTick: Signal<number | null>;
  /** Arm a recording, to start on the first key; a refusal is left in `message`. */
  arm(): void;
  /** Stop the recording in flight and write it, or disarm one still waiting. */
  stop(): void;
  /**
   * A key from somewhere other than a MIDI input, taken exactly as one from
   * there is — the computer's keyboard played as a piano.
   */
  key(event: MidiKey): void;
}

/** A transport tick this far behind the pointer is the loop coming round, not jitter. */
const WRAP_TICKS = 2;

/** How often the mark window's copy of the pointer moves, in milliseconds. */
const WINDOW_MS = 100;

/**
 * Recording from a MIDI keyboard: the pointer a take is timed against, the take
 * itself, the sound of each key, and the write at the end.
 *
 * A composable in `roll-view.ts`'s shape, and it must be called from an
 * injection context for the same reason: it starts a frame callback and two
 * effects, and takes `DestroyRef` to stop them. It holds the one listener slot
 * `MidiInput` has for as long as the roll is open.
 *
 * The pointer is its own rather than the transport's, because a take can run
 * past the end of the song and a song with nothing in it can still be recorded
 * into. It free-runs at the clock's own slope (`recordTickStep`); with the song
 * playing under the take it reads the transport's playhead instead, for as long
 * as that is still moving forwards. Either way it stands still until the first
 * key, and so does the song.
 *
 * Nothing is written until the recording stops. The notes are drawn as they are
 * played and go into the text as one edit (`takeEdits`), so a take is one undo
 * step and every key is sounded against a song that is not changing under it.
 */
export function rollRecord(sources: RecordSources): RollRecord {
  const editor = inject(EditorStore);
  const mixer = inject(Mixer);
  const playback = inject(Playback);
  const audition = inject(Audition);
  const midi = inject(MidiInput);
  const requests = inject(EditorRequests);

  const phase = signal<RecordPhase>('idle');
  const take = signal<Take>(emptyTake([]));
  const pointer = signal<number | null>(null);
  const coarse = signal<number | null>(null);
  const message = signal<string | null>(null);
  /** Every key physically down and in range, by MIDI number, as the byte it names. */
  const down = signal<ReadonlyMap<number, number>>(new Map<number, number>());

  /** Where the take began, which is where the transport is left when it ends. */
  let startTick = 0;
  /** The stamp the pointer was last carried to, on `performance.now()`'s clock. */
  let lastAt = 0;
  let coarseAt = 0;
  /** Whether the pointer is the transport's: not, waiting for it to start, or yes. */
  let follows: 'no' | 'starting' | 'yes' = 'no';
  /** Whether this take has the song playing under it. */
  let withSong = false;
  /** True while the transport is still coming up to be held for a take. */
  let cueing = false;
  /** Each recorded channel's loops, taken once as the recording is armed. */
  let walls = new Map<number, readonly Wall[]>();
  /** The audition handle of each key that is sounding, by MIDI number. */
  const sounds = new Map<number, number>();

  const channels = computed<readonly number[]>(() => {
    const edited = sources.editChannel();
    return edited === null
      ? []
      : [...new Set([edited, ...sources.chordChannels()])].sort((a, b) => a - b);
  });

  /**
   * The channel a key lands on: the one picked, or else the lowest the mixer
   * leaves audible, which is picked there and then. A keyboard has no pointer to
   * say which channel it means, and a key that did nothing until a chip was
   * found would read as a keyboard that does not work.
   */
  const keyChannel = (): number | null => {
    const picked = sources.editChannel();
    if (picked !== null) {
      return picked;
    }

    for (let channel = 0; channel < CHANNEL_FILL.length; channel++) {
      if ((mixer.silenced() & (1 << channel)) === 0) {
        sources.pickChannel(channel);
        return channel;
      }
    }

    return null;
  };

  /** One pass of the song in ticks, past which there is no song to sound a key in. */
  const songEnd = computed(() => {
    const stats = editor.result()?.stats;
    return stats ? stats.introTicks + stats.loopTicks : 0;
  });

  /** The pointer carried to a moment, which is the tick a key pressed then lands on. */
  const tickAt = (at: number): number => {
    const now = pointer();
    if (now === null) {
      return sources.transportTick();
    }

    return phase() === 'recording' && follows !== 'starting'
      ? recordTickStep(now, (at - lastAt) / 1000, editor.clock())
      : now;
  };

  /** One frame of the pointer. */
  const advance = (at: number): void => {
    const now = pointer();
    if (now === null || at === 0) {
      return;
    }

    const free = recordTickStep(now, (at - lastAt) / 1000, editor.clock());
    let next = now;
    if (follows === 'yes') {
      const song = sources.transportTick();
      const end = songEnd();
      if (playback.isPlaying() && song >= now - WRAP_TICKS && (end <= 0 || song < end - 0.5)) {
        next = Math.max(now, song);
      } else {
        // The song has ended or come round its loop, and the take has not: the
        // transport stops there and the pointer carries on by itself.
        follows = 'no';
        if (!playback.isIdle()) {
          playback.stop();
        }

        next = free;
      }
    } else if (phase() === 'recording' && follows === 'no') {
      next = free;
    }

    lastAt = Math.max(lastAt, at);
    pointer.set(next);
    if (at - coarseAt >= WINDOW_MS) {
      coarseAt = at;
      coarse.set(next);
    }
  };

  const frame = frameClock(computed(() => phase() !== 'idle'));

  // Sanctioned effect: driving the record pointer. The frame stamp is the only
  // thing tracked, as in `roll-clock.ts`.
  effect(() => {
    const at = frame();
    untracked(() => advance(at));
  });

  /** Sounds a key at a tick of the song, for as long as it is held. */
  const sound = (key: number, channel: number, written: number, tick: number): void => {
    if (!sources.keySounds()) {
      return;
    }

    const end = songEnd();
    const handle = audition.holdNote({
      channel,
      // Past the end there is no song to emulate up to, so the last tick stands in.
      tick: Math.max(0, end > 0 ? Math.min(tick, end - 1) : tick),
      note: written,
      quiet: true,
    });
    if (handle !== null) {
      sounds.set(key, handle);
    }
  };

  const hush = (key: number): void => {
    const handle = sounds.get(key);
    if (handle !== undefined) {
      audition.releaseNote(handle);
      sounds.delete(key);
    }
  };

  const onKey = (event: MidiKey): void => {
    const written = writtenOfKey(event.key);
    if (!event.down) {
      down.update((held) => {
        const next = new Map(held);
        next.delete(event.key);
        return next;
      });
      hush(event.key);
      if (phase() !== 'idle') {
        take.set(keyUp(take(), event.key, tickAt(event.at)));
      }

      return;
    }

    if (written !== null) {
      down.update((held) => new Map(held).set(event.key, written));
    }

    if (phase() === 'idle') {
      // Not recording: the key is only heard, where the playhead stands.
      const channel = written === null ? null : keyChannel();
      if (channel !== null && written !== null) {
        sound(event.key, channel, written, sources.transportTick());
      }

      return;
    }

    if (phase() === 'armed') {
      // The first key is what starts the pointer, on the moment it was pressed,
      // and the song under it where there is one.
      phase.set('recording');
      lastAt = event.at;
      if (withSong) {
        letGo();
      }
    }

    const tick = tickAt(event.at);
    const taken = keyDown(take(), event.key, tick);
    if (taken) {
      take.set(taken.take);
      // At the tick the note will be written on, which is where it will play.
      sound(event.key, taken.held.channel, taken.held.written, snappedTick(tick, sources.snap()));
    }
  };

  /** Why a recording cannot start, or `null`; and each channel's loops where it can. */
  const cannotRecord = (): string | null => {
    const result = editor.result();
    const timeline = sources.timeline();
    if (!result?.ok || !timeline || editor.compiledText() !== editor.source()) {
      return $localize`:@@roll.record.song-has-errors:roll.record.song-has-errors`;
    }

    const found = new Map<number, readonly Wall[]>();
    for (const channel of channels()) {
      if ((mixer.silenced() & (1 << channel)) !== 0) {
        return silencedReason(channel, mixer.soloed());
      }

      const strip = channelStrip({
        source: editor.source(),
        channel,
        noteMap: result.noteMap ?? [],
        commandMap: result.commandMap ?? [],
        timeline,
        index: editor.tokens(),
        tempoRatio: result.stats?.tempoRatio ?? 1,
      });
      if (!isStrip(strip)) {
        return $localize`:@@roll.record.channel-refused:roll.record.channel-refused ${channel}:channel: ${strip.refused}:reason:`;
      }

      found.set(channel, loopWalls(strip));
    }

    walls = found;
    return null;
  };

  const arm = (): void => {
    if (phase() !== 'idle') {
      return;
    }

    message.set(null);
    if (keyChannel() === null) {
      message.set($localize`:@@roll.record.every-channel-muted:roll.record.every-channel-muted`);
      return;
    }

    editor.compileNow();
    const refused = cannotRecord();
    if (refused !== null) {
      message.set(refused);
      return;
    }

    const at = Math.max(0, sources.transportTick());
    audition.stop();
    startTick = at;
    take.set(emptyTake(channels()));
    pointer.set(at);
    coarse.set(at);
    lastAt = performance.now();
    coarseAt = 0;
    follows = 'no';
    withSong = sources.playSong();
    phase.set('armed');

    if (withSong) {
      cue();
    } else if (!playback.isIdle()) {
      // In silence: whatever was playing stops, and stands where it had got to.
      playback.stop();
      playback.seek(at);
    }
  };

  /**
   * Holds the song ready under a take that is waiting for its first key: loaded
   * and run up to where it stands, and paused there, so that key has only to
   * let it go. Started on the key instead, the song would trail the pointer by
   * however long the transport takes to come up.
   */
  const cue = (): void => {
    if (cueing || playback.state() === 'paused') {
      return;
    }

    if (playback.isPlaying()) {
      void playback.toggle();
      return;
    }

    cueing = true;
    void playback.toggle().then(() => {
      cueing = false;
      if (!playback.isPlaying()) {
        // The song would not play, so the take runs in silence.
        withSong = false;
        follows = 'no';
      } else if (phase() === 'idle' || !withSong) {
        // The take it was coming up for has ended.
        playback.stop();
        playback.seek(startTick);
      } else if (phase() === 'armed') {
        void playback.toggle();
      } else {
        // A key arrived first, and the pointer has been waiting on this.
        follows = 'yes';
      }
    });
  };

  /** Lets the held song go, under the first key of a take. */
  const letGo = (): void => {
    if (cueing) {
      follows = 'starting';
      return;
    }

    if (playback.state() === 'paused') {
      void playback.toggle();
    }

    if (!playback.isPlaying()) {
      withSong = false;
      return;
    }

    follows = 'yes';
    // A song the porter set going while the take waited has moved on from it.
    pointer.update((tick) => Math.max(tick ?? 0, sources.transportTick()));
  };

  const read = (text: string) => {
    const compiled = editor.compileText(text);
    return compiled ? songReading(text, compiled.result, compiled.aramAddress) : null;
  };

  const stop = (): void => {
    if (phase() === 'idle') {
      return;
    }

    const done = releaseAll(take(), tickAt(performance.now()));
    for (const key of [...sounds.keys()]) {
      hush(key);
    }

    const sung = withSong;
    withSong = false;
    follows = 'no';
    phase.set('idle');
    pointer.set(null);
    coarse.set(null);
    take.set(emptyTake([]));

    // Back to where the take began, so the next press of play is the take.
    if (sung && !playback.isIdle()) {
      playback.stop();
    }

    playback.seek(startTick);

    const snap = sources.snap();
    const takes = done.channels.map((channel) => ({
      channel,
      notes: takeNotes(done, channel, snap),
    }));
    if (takes.every((each) => each.notes.length === 0)) {
      return;
    }

    const outcome = takeEdits(editor.source(), takes, sources.editMode(), read);
    if ('refused' in outcome) {
      message.set(outcome.refused);
      return;
    }

    requests.applyAll(outcome.edit ? [outcome.edit] : null);
    if (outcome.dropped > 0) {
      message.set(
        outcome.dropped === 1
          ? $localize`:@@roll.record.on-a-loop.one:roll.record.on-a-loop.one`
          : $localize`:@@roll.record.on-a-loop.other:roll.record.on-a-loop.other ${outcome.dropped}:count:`,
      );
    }
  };

  /**
   * The earliest tick a key pressed now could be sounded at, or `null` while no
   * key would be sounded at all.
   *
   * Half a snap step back from the pointer while recording, since a note is
   * sounded on the tick it snaps to and that can be earlier than the press.
   */
  const keyTick = computed(() => {
    if (!sources.keySounds() || sources.editChannel() === null) {
      return null;
    }

    const lead = phase() === 'idle' ? 0 : sources.snap() / 2;
    return (pointer() ?? sources.transportTick()) - lead;
  });

  const barOf = (
    id: string,
    channel: number,
    note: { startTick: number; ticks: number; written: number },
  ): TakeBar | null => {
    const row = rowOfPlaced({ written: note.written, drum: null }, sources.stack());
    return row < 0
      ? null
      : {
          id,
          x: note.startTick * sources.zoom(),
          ...barRect(row, sources.rowHeight(), note.ticks, sources.zoom()),
          fill: CHANNEL_FILL[channel],
          blocked: onWall(note, walls.get(channel) ?? []),
        };
  };

  const doneBars = computed<readonly TakeBar[]>(() => {
    const played = take();
    const snap = sources.snap();
    return played.channels.flatMap((channel) =>
      takeNotes(played, channel, snap)
        .map((note, at) => barOf(`${channel}:${at}`, channel, note))
        .filter((bar) => bar !== null),
    );
  });

  const liveBars = computed<readonly TakeBar[]>(() => {
    const now = pointer();
    if (now === null) {
      return [];
    }

    const snap = sources.snap();
    return take()
      .held.map((held) => {
        const from = snappedTick(held.startTick, snap);
        return barOf(`held:${held.key}`, held.channel, {
          startTick: from,
          ticks: Math.max(1, now - from),
          written: held.written,
        });
      })
      .filter((bar) => bar !== null);
  });

  const heldRows = computed<ReadonlySet<number>>(() => {
    const rows = new Set<number>();
    const stack = sources.stack();
    for (const written of down().values()) {
      const row = stack.rowOfKey.get(written - NOTE_MIN);
      if (row !== undefined) {
        rows.add(row);
      }
    }

    return rows;
  });

  midi.listen(onKey);

  // Sanctioned effect: the MIDI keyboards going away. No key-up will come for a
  // key that was down on one, so every key is let go where the pointer stands.
  onChange(midi.status, (status) => {
    if (status === 'on') {
      return;
    }

    if (phase() !== 'idle') {
      take.set(releaseAll(take(), tickAt(performance.now())));
    }

    for (const key of [...sounds.keys()]) {
      hush(key);
    }

    down.set(new Map<number, number>());
  });

  // Sanctioned effect: mirroring the recording into the mailbox, where the
  // transport's Stop button reads whether there is one to stop.
  effect(() => requests.recording.set(phase() !== 'idle'));

  // Sanctioned effect: that button's press, which ends a take as Record does.
  onChange(requests.recordingStops, () => stop());

  // The roll is rebuilt on every tab switch, and a take in flight is the
  // porter's work: it is written rather than dropped with the component.
  inject(DestroyRef).onDestroy(() => {
    midi.listen(null);
    stop();
    requests.recording.set(false);
    for (const key of [...sounds.keys()]) {
      hush(key);
    }
  });

  return {
    phase: phase.asReadonly(),
    tick: pointer.asReadonly(),
    windowTick: coarse.asReadonly(),
    channels,
    doneBars,
    liveBars,
    heldRows,
    noteCount: computed(() => take().played.length + take().held.length),
    message: message.asReadonly(),
    keyTick,
    arm,
    stop,
    key: onKey,
  };
}
