import {
  afterNextRender,
  Component,
  DestroyRef,
  type ElementRef,
  Injector,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';

import { Button } from '../../shared/button/button';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import type { NormalizeOutcome, NormalizePass } from '../../state/normalize-song';

/** How long Confirm refuses a click once the dialog is up, in seconds. */
const CONFIRM_HOLD_S = 3;

/** What each pass does to a song, for the porter; the dialog lists the ones that apply to this one. */
const CHANGES: Record<NormalizePass, string> = {
  preprocessor: '#define, #ifdef and #if blocks resolved, and the branches not taken removed',
  replacements:
    '"name=text" replacements written out where they are used, and their definitions removed',
  triplets: '{ } triplets written as plain note lengths',
  loops: 'every [ ] loop, * and (n) call written out in full, once per time it plays',
  channels:
    'one block per channel, in #0 to #7 order, with music above the first #N moved under it',
  defaults:
    'the octave, default length, quantization, instrument and tempo written where the song left them implied, and < > made absolute',
  drums: 'the drum instrument written before every drum note',
};

/** What the dialog is up about. */
type Proposal =
  | { kind: 'rewrite'; source: string; text: string; changes: readonly string[]; size: string }
  | { kind: 'unchanged' }
  | { kind: 'refused'; reasons: readonly string[] };

const HEADINGS: Record<Proposal['kind'], string> = {
  rewrite: 'Normalize the song?',
  unchanged: 'Nothing to normalize',
  refused: 'Normalize refused',
};

function sizeOf(text: string): string {
  const lines = text.split('\n').length;
  return `${text.length.toLocaleString()} characters on ${lines.toLocaleString()} lines`;
}

function describe(outcome: NormalizeOutcome, source: string): Proposal {
  if (!outcome.ok) {
    return { kind: 'refused', reasons: outcome.diagnostics.map((d) => `${d.code} ${d.message}`) };
  }

  if (outcome.text === source) {
    return { kind: 'unchanged' };
  }

  return {
    kind: 'rewrite',
    source,
    text: outcome.text,
    changes: outcome.changed.map((pass) => CHANGES[pass]),
    size: `${sizeOf(source)} → ${sizeOf(outcome.text)}`,
  };
}

/**
 * The Normalize button, and the dialog it puts up before anything is rewritten.
 *
 * One component for both toolbars that carry it, so the question is asked the
 * same way from the source and from the roll. The rewrite is worked out *before*
 * the dialog opens, which is what lets it say which passes change this song
 * rather than what the passes do in general — and lets a refusal, or a song
 * already in shape, be said in the same place, since neither toolbar has a
 * strip of its own for them.
 *
 * A native `<dialog>`, shown modally: the rest of the page is inert while it is
 * up, so the document cannot move under the rewrite; Escape cancels it; and
 * focus returns to the button when it closes. Confirm is held for
 * {@link CONFIRM_HOLD_S} seconds, long enough to read what is about to happen
 * to every line.
 *
 * The apply is one whole-document `EditorRequests.replace`, so one CodeMirror
 * transaction and one undo step, and its `expect` is the text the rewrite was
 * built from — a keystroke that lands in between makes it a no-op rather than
 * an overwrite. A song already in shape is left alone: a replace with the same
 * text is still a transaction, and so an undo step that visibly does nothing.
 */
@Component({
  selector: 'amk-normalize-button',
  imports: [Button],
  templateUrl: './normalize-button.html',
  host: { class: 'contents' },
})
export class NormalizeButton {
  private readonly editor = inject(EditorStore);
  private readonly requests = inject(EditorRequests);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /**
   * The one channel to rewrite, or `null` for the whole song.
   *
   * The same button and the same dialog either way: a narrower target is still
   * the same question, and a refusal still belongs in the dialog rather than in
   * the roll's problems strip, because it is the answer to a click.
   */
  readonly channel = input<number | null>(null);

  protected readonly label = computed(() => {
    const channel = this.channel();
    return channel === null ? 'Normalize' : `Normalize #${channel}`;
  });

  protected readonly title = computed(() =>
    this.channel() === null
      ? 'Rewrite the song for editing: #define and replacements resolved, every loop unrolled, triplets written out, one block per channel, and o/l/q/@/t written where the song left them implied. What plays does not change; refused if it would.'
      : `Rewrite channel ${this.channel()} for editing, and leave every other channel exactly as it is. What plays does not change; refused if it would.`,
  );

  /** Off while the document has moved past the compile the rewrite would be built on. */
  protected readonly canNormalize = computed(() => this.editor.canNormalize());

  protected readonly proposal = signal<Proposal | null>(null);

  /** Seconds before Confirm takes a click; 0 once it does. */
  protected readonly holdFor = signal(0);
  private timer: ReturnType<typeof setInterval> | undefined;

  protected readonly heading = computed(() => {
    const proposal = this.proposal();
    return proposal ? HEADINGS[proposal.kind] : '';
  });

  /** Danger for a rewrite and a refusal alike; only "nothing to do" is calm. */
  protected readonly edgeClass = computed(() =>
    this.proposal()?.kind === 'unchanged' ? 'border-edge' : 'border-danger/60',
  );
  protected readonly bandClass = computed(() =>
    this.proposal()?.kind === 'unchanged' ? 'border-edge' : 'border-danger/40 bg-danger/10',
  );
  protected readonly headingClass = computed(() =>
    this.proposal()?.kind === 'unchanged' ? 'text-ink-muted' : 'text-danger',
  );

  protected readonly confirmLabel = computed(() =>
    this.holdFor() > 0 ? `Normalize (${this.holdFor()})` : 'Normalize',
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopHold());
  }

  protected open(): void {
    const source = this.editor.source();
    const outcome = this.editor.normalize(this.channel() ?? undefined);
    if (!outcome) {
      return;
    }

    const proposal = describe(outcome, source);
    this.proposal.set(proposal);
    // Shown once its content has rendered, since opening is what moves focus
    // into it, and an empty dialog has nothing to move focus to.
    afterNextRender(() => this.dialog().nativeElement.showModal(), { injector: this.injector });
    if (proposal.kind === 'rewrite') {
      this.startHold();
    }
  }

  protected confirm(): void {
    const proposal = this.proposal();
    if (proposal?.kind !== 'rewrite' || this.holdFor() > 0) {
      return;
    }

    this.requests.apply({
      span: { start: 0, end: proposal.source.length, line: 1 },
      text: proposal.text,
      expect: proposal.source,
    });
    this.close();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  /** The dialog's own `close` event, which Escape and {@link close} both reach. */
  protected onClosed(): void {
    this.stopHold();
    this.holdFor.set(0);
    this.proposal.set(null);
  }

  private startHold(): void {
    this.holdFor.set(CONFIRM_HOLD_S);
    this.timer = setInterval(() => {
      this.holdFor.update((seconds) => seconds - 1);
      if (this.holdFor() <= 0) {
        this.stopHold();
      }
    }, 1000);
  }

  private stopHold(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
