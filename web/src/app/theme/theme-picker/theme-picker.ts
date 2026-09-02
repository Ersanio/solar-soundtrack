import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';

import { Button } from '../../shared/button/button';
import { ColorField } from '../../shared/color-field/color-field';
import { IconClose } from '../../shared/icons/icon-close';
import { IconPalette } from '../../shared/icons/icon-palette';
import { ThemeStore } from '../../state/theme-store';
import { type ThemePreset } from '../theme-presets';
import { THEME_GROUPS, THEME_TOKENS, type ThemeTokenName } from '../theme-tokens';

/** A colour row, as the picker draws it. */
interface ColourRow {
  name: ThemeTokenName;
  label: string;
  hint: string;
  value: string;
  overridden: boolean;
}

/** One section of the picker, and the rows in it. */
interface ColourGroup {
  id: string;
  label: string;
  rows: ColourRow[];
}

/**
 * The top bar's theme control and the panel it drops down.
 *
 * The colours themselves live in `styles.css`; what this offers is a preset, a
 * colour at a time, and a way to carry a theme somewhere else.
 */
@Component({
  selector: 'amk-theme-picker',
  imports: [Button, ColorField, IconClose, IconPalette],
  host: {
    class: 'relative',
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
  },
  templateUrl: './theme-picker.html',
})
export class ThemePicker {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly theme = inject(ThemeStore);

  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');

  protected readonly open = signal(false);

  /** Shown after a paste that was not a theme, and cleared by the next one. */
  protected readonly importFailed = signal(false);

  /**
   * Every row of the panel, built in one pass.
   *
   * One `computed` rather than a method per row: the panel holds twenty-five
   * colours, and a template that asked each of them a question would ask all
   * twenty-five on every change-detection pass.
   */
  protected readonly groups = computed<ColourGroup[]>(() => {
    const palette = this.theme.palette();
    const overrides = this.theme.overrides();

    return THEME_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      rows: THEME_TOKENS.filter((token) => token.group === group.id).map((token) => ({
        name: token.name,
        label: token.label,
        hint: token.hint,
        value: palette[token.name],
        overridden: token.name in overrides,
      })),
    }));
  });

  /** The presets, each with the surfaces it would paint, for the swatches on its button. */
  protected readonly presetButtons = computed(() => {
    const active = this.theme.activePreset();
    const defaults = this.theme.palette();

    return this.theme.presets.map((preset) => ({
      preset,
      active: preset.id === active,
      swatches: (['surface', 'raised', 'edge', 'ink'] as const).map(
        (name) => preset.overrides[name] ?? defaults[name],
      ),
    }));
  });

  /**
   * The overrides as text, for the textarea that both shows and takes one.
   *
   * The binding and the typing do not fight: nothing here changes until
   * `change` fires, and a theme taken on then comes straight back through this
   * as the normalised JSON, which is what says the paste was understood.
   */
  protected readonly exported = computed(() => this.theme.exportJson());

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  /** Closing from inside the panel, so focus has to go somewhere deliberate. */
  protected dismiss(): void {
    this.open.set(false);
    this.trigger().nativeElement.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        break;
      default:
        return;
    }

    event.preventDefault();
    this.dismiss();
  }

  /**
   * `pointerdown` rather than `click`, so the panel closes as the press lands
   * rather than on release. The trigger is inside the host, so its own press is
   * left to `toggle()` — closing here first would let the click reopen it.
   */
  protected onDocumentPointerDown(event: PointerEvent): void {
    if (!this.open()) {
      return;
    }

    if (this.host.nativeElement.contains(event.target as Node)) {
      return;
    }

    this.open.set(false);
  }

  protected usePreset(preset: ThemePreset): void {
    this.importFailed.set(false);
    this.theme.usePreset(preset);
  }

  protected resetAll(): void {
    this.importFailed.set(false);
    this.theme.resetAll();
  }

  protected onImport(event: Event): void {
    const field = event.target as HTMLTextAreaElement;
    const text = field.value.trim();

    if (!text) {
      this.importFailed.set(false);
      return;
    }

    this.importFailed.set(!this.theme.importJson(text));
  }
}
