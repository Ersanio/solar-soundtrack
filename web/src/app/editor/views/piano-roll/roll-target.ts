import { type Signal, computed, inject } from '@angular/core';

import type { Command } from '@amk/tokens';
import { EditorStore } from '../../../state/editor-store';
import { Mixer } from '../../../state/mixer';
import { silencedReason } from '../../../state/transport-view';
import type { SongTimeline } from '@amk/spc/song-walk';
import type { Mark } from './roll-marks';
import { type Strip, channelStrip, channelTails, isStrip } from './roll-strip';

export interface TargetSources {
  /** The bar under the pointer, which names a channel a press can take with it. */
  hovered: Signal<Mark | null>;
  /** The channel really picked, or `null` while none is. */
  editChannel: Signal<number | null>;
  /** The walk, which the strip is built against. */
  timeline: Signal<SongTimeline | null>;
}

export interface RollTarget {
  /** The channel a gesture acts on: picked, or under the pointer while none is. */
  editing: Signal<number | null>;
  /** That channel as a sequence the roll can splice, or `null`. */
  strip: Signal<Strip | null>;
  /** Why a *picked* channel cannot be edited, for the toolbar to say. */
  editRefusal: Signal<string | null>;
  /** The gesture bag's four facts about the song the edit is written into. */
  targetAMKVersion: Signal<number>;
  songTargetProgram: Signal<number>;
  playableTicks: Signal<number>;
  introTicks: Signal<number | null>;
  /** Every channel as somewhere rests can be appended. */
  channelTails: Signal<ReturnType<typeof channelTails>>;
  /** What the walk had in force at a note, by the address of its head. */
  inForceAt: Signal<(address: number) => readonly Command[] | null>;
}

/**
 * What a gesture acts on, and whether it may.
 *
 * Exactly the bag `rollGestures` is handed, gathered in one place because every
 * member of it answers one question — which channel is being edited, and what
 * the compile says about it — and because they have to come from **one** scan of
 * the text: the commands `planEdits` compares are `Command` objects out of
 * `EditorStore.tokens()`, so a second `tokenize` makes every identity test
 * silently false.
 *
 * It injects `EditorStore` and `Mixer` rather than taking a dozen of their
 * signals, as `commands/byte-args.ts` injects `EditorStore`; what stays in the
 * source bag is what the roll itself owns. No sinks: naming a channel is the
 * component's, because it has to let go of a selection this file has never seen.
 */
export function rollTarget(sources: TargetSources): RollTarget {
  const editor = inject(EditorStore);
  const mixer = inject(Mixer);

  /**
   * The channel of the bar under the pointer.
   *
   * A muted bar takes no pointer at all (`roll-notes.html`), so it never sets
   * this and a channel nothing can be heard on is never offered.
   */
  const hoverChannel = computed(() => sources.hovered()?.note.channel ?? null);

  /**
   * The channel a gesture acts on: the one being edited, or — while none is —
   * the one under the pointer, so a press on a bar can take the channel with it.
   *
   * The press then names it for real, through the `pick` sink `onPointerDown`
   * already calls. Empty grid offers nothing, so drawing, the marquee and the
   * shortcuts still need a channel chosen: only a bar can say which channel a
   * gesture on it belongs to.
   */
  const editing = computed(() => sources.editChannel() ?? hoverChannel());

  /**
   * Why the channel about to be edited is not being heard, or `null` where it is.
   *
   * A channel nothing can be heard on takes no interaction, which is the rule its
   * bars already keep by taking no pointer; editing is the rest of it, since a
   * note drawn there is one the porter can neither hear nor click. The same
   * sentence the note previewer refuses to sound it in.
   */
  const silencedEdit = computed(() => {
    const channel = editing();
    return channel !== null && (mixer.silenced() & (1 << channel)) !== 0
      ? silencedReason(channel, mixer.soloed())
      : null;
  });

  /**
   * The channel being edited, as a sequence the roll can splice — or the reason
   * it cannot be one.
   *
   * Everything span-based takes the same staleness test: a span into a document
   * that has moved points at the wrong thing. Here it is the difference between
   * an edit and a corruption, so it is the first check rather than the last.
   */
  const stripOutcome = computed(() => {
    const channel = editing();
    const result = editor.result();
    const timeline = sources.timeline();
    if (channel === null || !result?.ok || !timeline || editor.compiledText() !== editor.source()) {
      return null;
    }

    const quiet = silencedEdit();
    if (quiet !== null) {
      return { refused: quiet };
    }

    return channelStrip({
      source: editor.source(),
      channel,
      noteMap: result.noteMap ?? [],
      commandMap: result.commandMap ?? [],
      timeline,
      index: editor.tokens(),
      tempoRatio: result.stats?.tempoRatio ?? 1,
    });
  });

  const strip = computed<Strip | null>(() => {
    const outcome = stripOutcome();
    return outcome && isStrip(outcome) ? outcome : null;
  });

  /**
   * Why the picked channel cannot be edited, for the toolbar to say.
   *
   * Only for a channel really picked: a hovered one is not being edited, and the
   * toolbar would be explaining a refusal beside the words "editing: none".
   */
  const editRefusal = computed(() => {
    const outcome = sources.editChannel() === null ? null : stripOutcome();
    return outcome && !isStrip(outcome) ? outcome.refused : null;
  });

  const targetAMKVersion = computed(() => editor.result()?.stats?.targetAMKVersion ?? 4);

  const songTargetProgram = computed(() => editor.result()?.stats?.songTargetProgram ?? 0);

  /**
   * How long the song plays, which is how far a channel being opened is filled
   * out with rests. The transport's own figure rather than the walk's `ticks` —
   * see `EditContext.playableTicks`.
   */
  const playableTicks = computed(() => {
    const stats = editor.result()?.stats;
    return stats ? stats.introTicks + stats.loopTicks : 0;
  });

  /** Where the song loops back to, so a channel being opened re-enters with it. */
  const introTicks = computed(() => {
    const stats = editor.result()?.stats;
    return stats?.hasIntro === true ? stats.introTicks : null;
  });

  /**
   * Every channel as somewhere rests can be appended, so a gesture reaching past
   * the end of the song can bring the other channels out with it.
   *
   * Off the same result and the same source {@link stripOutcome} reads, so the
   * tick counts and the offsets come from one compile — and off `channelTicks`,
   * which {@link playableTicks} is the smallest non-zero member of.
   */
  const tails = computed(() =>
    channelTails(editor.source(), editor.tokens(), editor.result()?.stats?.channelTicks ?? []),
  );

  /** The walk's notes by address, which is how a strip item names the one it is. */
  const walkedNotes = computed(
    () => new Map((sources.timeline()?.notes ?? []).map((note) => [note.address, note])),
  );

  /**
   * What the walk had in force at a note, by the address of its head, or `null`
   * for a note the pass never reached.
   *
   * The answers are `Command` objects out of `EditorStore.tokens()`, which is
   * the same index {@link stripOutcome} hands `channelStrip` — so the commands
   * `planEdits` compares are one set of objects and identity means what it says.
   * Two scans of one text hold the same commands as different objects, and every
   * comparison between them is silently false.
   */
  const inForceAt = computed<(address: number) => readonly Command[] | null>(() => {
    const acting = editor.commandsInForce();
    const walked = walkedNotes();
    return (address) => {
      const note = walked.get(address);
      return note === undefined ? null : acting(note);
    };
  });

  return {
    editing,
    strip,
    editRefusal,
    targetAMKVersion,
    songTargetProgram,
    playableTicks,
    introTicks,
    channelTails: tails,
    inForceAt,
  };
}
