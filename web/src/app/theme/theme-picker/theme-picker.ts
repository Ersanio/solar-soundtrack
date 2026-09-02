import { Component, computed, inject, signal } from '@angular/core';

import { Button } from '../../shared/button/button';
import { ColorField } from '../../shared/color-field/color-field';
import { IconPalette } from '../../shared/icons/icon-palette';
import { Popover } from '../../shared/popover/popover';
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
  imports: [Button, ColorField, IconPalette, Popover],
  templateUrl: './theme-picker.html',
})
export class ThemePicker {
  protected readonly theme = inject(ThemeStore);

  /** Shown after a paste that was not a theme, and cleared by the next one. */
  protected readonly importFailed = signal(false);

  /** A preset's button, and the first one spanning both columns so five do not leave an orphan. */
  private static readonly PRESET =
    'border-edge bg-inset hover:border-control flex cursor-pointer flex-col gap-1 rounded-md border px-2 py-1.5 text-left transition-colors';
  private static readonly PRESET_WIDE = `${ThemePicker.PRESET} col-span-2`;

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

    return this.theme.presets.map((preset, index) => ({
      preset,
      active: preset.id === active,
      class: index === 0 ? ThemePicker.PRESET_WIDE : ThemePicker.PRESET,
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
