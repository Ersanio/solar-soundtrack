import { Component, type ElementRef, computed, input, model, viewChildren } from '@angular/core';

export interface TabDef<Id extends string = string> {
  id: Id;
  label: string;
}

/**
 * An ARIA tab strip.
 *
 * Follows the APG tabs pattern rather than being a row of buttons that look
 * like tabs: exactly one tab is in the focus order at a time and the arrow keys
 * move between them, so a keyboard user tabs *past* the strip rather than
 * through every tab. Panels are the caller's business — it renders them with
 * `@switch` and gives each `role="tabpanel"` plus `id="panel-<id>"`, which is
 * what `aria-controls` here points at.
 *
 * Generic over the id so a caller can pass a union rather than `string`, and
 * have the compiler check that its `@switch` covers every tab.
 */
@Component({
  selector: 'amk-tabs',
  host: { class: 'flex items-center gap-1', role: 'tablist' },
  template: `
    @for (tab of tabs(); track tab.id) {
      <button
        #tabButton
        type="button"
        role="tab"
        [id]="'tab-' + tab.id"
        [attr.aria-selected]="tab.id === active()"
        [attr.aria-controls]="'panel-' + tab.id"
        [tabindex]="tab.id === active() ? 0 : -1"
        [class]="buttonClass(tab.id === active())"
        (click)="active.set(tab.id)"
        (keydown)="onKeydown($event, $index)"
      >
        {{ tab.label }}
      </button>
    }
  `,
})
export class Tabs<Id extends string = string> {
  readonly tabs = input.required<readonly TabDef<Id>[]>();
  readonly active = model.required<Id>();

  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  protected readonly count = computed(() => this.tabs().length);

  private static readonly BASE =
    'cursor-pointer rounded-t-md px-3 py-1 text-xs font-semibold tracking-wide uppercase transition-colors';

  protected buttonClass(selected: boolean): string {
    return `${Tabs.BASE} ${
      selected
        ? 'bg-surface text-ink border-edge border-x border-t'
        : 'text-ink-muted hover:text-ink'
    }`;
  }

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
    // Selection follows focus, so the newly selected tab must actually take it
    // — otherwise focus stays on a tab that is now `tabindex="-1"`.
    this.buttons()[next]?.nativeElement.focus();
  }
}
