import { NgComponentOutlet } from '@angular/common';
import {
  Component,
  type ElementRef,
  type Type,
  computed,
  input,
  model,
  viewChildren,
} from '@angular/core';

export interface TabDef<Id extends string = string> {
  id: Id;
  label: string;
  /** A glyph component drawn before the label. */
  icon?: Type<unknown>;
  /** Pushed to the right end of the strip, behind a rule; the first such tab carries the rule. */
  aside?: boolean;
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
  imports: [NgComponentOutlet],
  templateUrl: './tabs.html',
  // One row: the strip sits above the whole editor pane, which holds three
  // tabs at every supported width, so there is nothing to wrap onto.
  host: { class: 'border-edge bg-raised flex h-8 shrink-0 items-stretch border-b px-1' },
})
export class Tabs<Id extends string = string> {
  readonly tabs = input.required<readonly TabDef<Id>[]>();
  readonly active = model.required<Id>();

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  protected readonly count = computed(() => this.tabs().length);

  // `whitespace-nowrap` so a two-word label wraps as a tab rather than as text:
  // without it "Piano Roll" breaks in half and takes the whole strip with it.
  private static readonly BASE =
    'inline-flex cursor-pointer items-center gap-1.5 border-t-2 px-3 text-sm whitespace-nowrap transition-colors';

  /** One view model rather than a class method called per tab per pass. */
  protected readonly rows = computed(() => {
    const active = this.active();
    let asideSeen = false;

    return this.tabs().map((tab) => {
      const firstAside = tab.aside === true && !asideSeen;
      asideSeen ||= firstAside;

      return {
        ...tab,
        firstAside,
        class: `${Tabs.BASE} ${
          tab.id === active
            ? 'border-control bg-surface text-ink'
            : 'border-transparent text-ink-muted hover:text-ink'
        }`,
      };
    });
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
