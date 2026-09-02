import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import { IconChevronDown } from '../../shared/icons/icon-chevron-down';
import { IconChevronRight } from '../../shared/icons/icon-chevron-right';
import { Section } from '../../shared/section/section';
import { DriverStore } from '../../state/driver-store';
import { EditorRequests } from '../../state/editor-requests';
import { EditorStore } from '../../state/editor-store';
import { readStored, writeStored } from '../../util/storage';
import { AramBudget } from '../aram-budget/aram-budget';
import { CommandInspector } from '../command-inspector/command-inspector';
import { DiagnosticsList } from '../diagnostics-list/diagnostics-list';
import { HexDump } from '../hex-dump/hex-dump';
import { StatsGrid } from '../stats-grid/stats-grid';

const BUILD_KEY = 'solar-soundtrack.build';
const PROBLEMS_KEY = 'solar-soundtrack.problems';

/**
 * The sidebar: the inspector, a collapsible Build section under it, and
 * Problems pinned beneath the scroll column so it stays in view whatever the
 * inspector's height. Below `lg` it is a drawer with a header row of its own.
 */
@Component({
  selector: 'amk-output-pane',
  imports: [
    AramBudget,
    CommandInspector,
    DiagnosticsList,
    HexDump,
    IconChevronDown,
    IconChevronRight,
    Section,
    StatsGrid,
  ],
  templateUrl: './output-pane.html',
  host: { class: 'flex min-h-0 min-w-0 flex-col' },
})
export class OutputPane {
  protected readonly store = inject(EditorStore);
  protected readonly drivers = inject(DriverStore);

  private readonly requests = inject(EditorRequests);
  private readonly injector = inject(Injector);

  /** Whether the pane is folded to its header; the shell sets it below the `lg` breakpoint, where the pane is a drawer. */
  readonly collapsed = input(false);

  /** The header's fold toggle, which the shell answers by flipping {@link collapsed}. */
  readonly collapseToggle = output<void>();

  /** The Build section's element, which a reveal scrolls the column to; absent while `blocked`. */
  private readonly build = viewChild<Section, ElementRef<HTMLElement>>('build', {
    read: ElementRef,
  });

  protected readonly buildOpen = signal(readStored(BUILD_KEY) !== 'closed');
  protected readonly problemsOpen = signal(readStored(PROBLEMS_KEY) !== 'closed');

  protected readonly blocked = computed(() => !this.drivers.ready());

  protected readonly bodyClass = computed(() =>
    this.collapsed()
      ? 'flex min-h-0 flex-1 flex-col max-lg:hidden'
      : 'flex min-h-0 flex-1 flex-col',
  );

  protected readonly overflowing = computed(() => (this.store.budget()?.overflowBytes ?? 0) > 0);

  protected readonly problemsCount = computed(() => this.store.diagnostics().length);

  /** Tinted by the worst severity in the list; complete literals, as Tailwind needs. */
  protected readonly problemsBadgeClass = computed(() => {
    const items = this.store.diagnostics();
    if (items.some((item) => item.severity === 'error')) {
      return 'rounded-md bg-danger/20 px-1.5 font-mono text-xs text-danger';
    }

    if (items.some((item) => item.severity === 'severe' || item.severity === 'warning')) {
      return 'rounded-md bg-warn/20 px-1.5 font-mono text-xs text-warn';
    }

    return 'rounded-md bg-inset px-1.5 font-mono text-xs text-ink-muted';
  });

  constructor() {
    // Sanctioned effects: mirroring the two fold preferences into localStorage.
    effect(() => writeStored(BUILD_KEY, this.buildOpen() ? 'open' : 'closed'));
    effect(() => writeStored(PROBLEMS_KEY, this.problemsOpen() ? 'open' : 'closed'));

    // Sanctioned effect: consuming a request for a section, in the mould of the
    // source view's `reveal`. Build sits in the scroll column, so it is scrolled
    // to after the render that opens it; Problems is pinned and only needs opening.
    effect(() => {
      const section = this.requests.revealSection();
      if (!section) {
        return;
      }

      untracked(() => {
        // Consumed on the spot, so asking for the same section twice still takes.
        this.requests.revealSection.set(null);
        if (this.collapsed()) {
          this.collapseToggle.emit();
        }

        if (section === 'problems') {
          this.problemsOpen.set(true);
          return;
        }

        this.buildOpen.set(true);
        afterNextRender(() => this.build()?.nativeElement.scrollIntoView({ block: 'start' }), {
          injector: this.injector,
        });
      });
    });
  }
}
