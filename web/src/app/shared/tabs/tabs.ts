import { Component, type ElementRef, computed, input, model, viewChildren } from '@angular/core';

export interface TabDef<Id extends string = string> {
  id: Id;
  label: string;
}

/**
 * A tab strip.
 *
 * The arrow keys move between tabs and selection follows focus, so a keyboard
 * only ever needs one key per tab rather than a click. Panels are the caller's
 * business — it renders them with `@switch`.
 *
 * Generic over the id so a caller can pass a union rather than `string`, and
 * have the compiler check that its `@switch` covers every tab.
 */
@Component({
  selector: 'amk-tabs',
  templateUrl: './tabs.html',
  // Wraps rather than overflows: the pane this sits in drags down to a quarter
  // of the window, where a strip of more than about four tabs does not fit on
  // one line. A second row is legible; a clipped one is not.
  host: { class: 'flex flex-wrap items-center gap-1' },
})
export class Tabs<Id extends string = string> {
  readonly tabs = input.required<readonly TabDef<Id>[]>();
  readonly active = model.required<Id>();

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  protected readonly count = computed(() => this.tabs().length);

  // `whitespace-nowrap` so a two-word label wraps as a tab rather than as text:
  // without it "Piano Roll" breaks in half and takes the whole strip with it.
  private static readonly BASE =
    'cursor-pointer rounded-t-md px-3 py-1 text-xs font-semibold tracking-wide whitespace-nowrap uppercase transition-colors';

  /** One view model rather than a class method called per tab per pass. */
  protected readonly rows = computed(() => {
    const active = this.active();
    return this.tabs().map((tab) => ({
      ...tab,
      class: `${Tabs.BASE} ${
        tab.id === active
          ? 'bg-surface text-ink border-edge border-x border-t'
          : 'text-ink-muted hover:text-ink'
      }`,
    }));
  });

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const last = this.count() - 1;
    let next: number;

    switch (event.key) {
      case 'ArrowRight':
        next = index === last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
        next = index === 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }

    event.preventDefault();
    this.active.set(this.tabs()[next].id);
    // Selection follows focus, so the newly selected tab has to actually take
    // it — otherwise the arrow keys move the highlight and leave focus behind.
    this.buttons()[next]?.nativeElement.focus();
  }
}
