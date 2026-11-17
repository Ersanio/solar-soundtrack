import { Component, booleanAttribute, computed, input } from '@angular/core';

import { BUTTON_ICON_SIZES, BUTTON_SIZES, CONTROL_BASE, type ButtonSize } from '../button/button';

type ToggleVariant = 'default' | 'segment' | 'indicator';
type ToggleTone = 'lit' | 'danger';

/**
 * A button's base with the glow's colour and shadow among what fades, and a
 * slower fade than a button's hover, so switching on is seen to light up.
 */
const TOGGLE_BASE = `${CONTROL_BASE} transition-[color,background-color,border-color,box-shadow,--recess-glow] duration-200`;

/**
 * Recessed, where a button is raised, so a state is not mistaken for an action:
 * FL Studio sets its toggles into the chrome.
 */
const OFF = 'recess text-ink-muted hover:not-disabled:text-ink';

/**
 * A label drawn heavier without being set in a heavier font: the glyphs again,
 * a fraction of a pixel to the right, which leaves every advance alone where
 * `font-medium` would widen the toggle and push the toolbar along. A shadow is
 * drawn as glyphs, with the fill's own antialiasing; a text stroke is drawn as a
 * path, and its greyscale edge haloes a ClearType fill.
 */
const HEAVY = '[text-shadow:0.35px_0_0_currentcolor]';

/** The same recess glowing, as FL Studio lights a mode that is on; it sets its own label colour. */
const ON = `recess recess-lit ${HEAVY}`;

const TONES: Record<ToggleTone, string> = {
  lit: '',
  danger: '[--lit-tone:var(--color-danger)] [--lit-warmth:0]',
};

/**
 * A segment sits in a recessed track the caller draws, and the one that is
 * selected is raised as a plate rather than lit.
 */
const SEGMENT_BASE =
  'inline-flex h-6 cursor-pointer items-center justify-center gap-1.5 rounded-sm border px-2 text-xs leading-none whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const SEGMENT_ON = `plate text-ink ${HEAVY}`;
const SEGMENT_OFF = 'border-transparent text-ink-muted hover:not-disabled:text-ink';

/** A bare glyph, no plate: lime when on, as FL Studio's channel lock is. */
const INDICATOR_BASE =
  'inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors disabled:cursor-not-allowed disabled:opacity-40';
const INDICATOR_ON = 'text-led';
const INDICATOR_OFF = 'text-ink-muted hover:not-disabled:text-ink';

/**
 * A two-state button whose lit recess is the state.
 *
 * Loop, Hot Reload and Follow on the transport and the editor's word wrap are all
 * one of these. The recess says which state it is in and nothing else does. There
 * is no output either: what a press means is the caller's business, so it binds
 * `(click)` itself. `tone="danger"` lights it red rather than in `--color-lit`,
 * for an armed Record.
 *
 * The `segment` variant is for a set of which exactly one is selected — the
 * palettes' categories — and it is told from a plain toggle on purpose: a
 * filter that picks which buttons are shown must not look like the buttons it
 * shows. Segments go in a track the caller draws:
 *
 * ```html
 * <div class="well inline-flex gap-0.5 rounded-sm p-0.5">
 *   <button amk-toggle variant="segment" [pressed]="filter() === 'all'" …>All</button>
 * </div>
 * ```
 *
 * The `indicator` variant is a glyph with no plate, which takes `--color-led`
 * when on, as a small light rather than a plate — a sample's keep lock.
 *
 * ```html
 * <button amk-toggle [pressed]="loop()" (click)="loop.set(!loop())">Loop</button>
 * <button amk-toggle icon [pressed]="wrap()" title="Word wrap" (click)="toggleWrap()">
 *   <amk-icon-wrap />
 * </button>
 * ```
 */
@Component({
  selector: 'button[amk-toggle]',
  template: '<ng-content />',
  host: {
    '[attr.type]': '"button"',
    '[class]': 'classes()',
  },
})
export class Toggle {
  readonly pressed = input.required<boolean>();
  readonly size = input<ButtonSize>('sm');
  /** A square, icon-only toggle: the label is a glyph and the `title` says what it does. */
  readonly icon = input(false, { transform: booleanAttribute });
  readonly variant = input<ToggleVariant>('default');
  readonly tone = input<ToggleTone>('lit');

  protected readonly classes = computed(() => {
    const pressed = this.pressed();
    const size = this.size();
    const shape = this.icon() ? BUTTON_ICON_SIZES[size] : BUTTON_SIZES[size];

    switch (this.variant()) {
      case 'segment':
        return `${SEGMENT_BASE} ${pressed ? SEGMENT_ON : SEGMENT_OFF}`;
      case 'indicator':
        return `${INDICATOR_BASE} ${shape} ${pressed ? INDICATOR_ON : INDICATOR_OFF}`;
      case 'default':
        return `${TOGGLE_BASE} ${shape} ${pressed ? `${ON} ${TONES[this.tone()]}` : OFF}`;
    }
  });
}
