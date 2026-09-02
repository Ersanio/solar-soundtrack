import { Service, computed, effect, signal } from '@angular/core';

import { PRESETS, type ThemePreset } from '../theme/theme-presets';
import {
  type Overrides,
  type Palette,
  THEME_TOKENS,
  type ThemeTokenName,
  isHexColour,
  isTokenName,
  propertyOf,
} from '../theme/theme-tokens';
import { readStored, writeStored } from '../util/storage';

const STORAGE_KEY = 'solar-soundtrack.theme';

/**
 * The stylesheet's own colours, read once before anything has overridden them.
 *
 * `styles.css` stays the single definition of what the app looks like by
 * default: a copy of those values in TypeScript would be a second source of
 * truth for one set of colours, and the two would drift the first time either
 * was edited alone. Stylesheets are render-blocking, so the document has them
 * by the time Angular bootstraps, and this runs before {@link ThemeStore}'s own
 * effect has written a thing.
 *
 * An unregistered custom property is returned as it was authored rather than
 * computed, so `#191919` comes back as `#191919` — which is the spelling
 * `<input type="color">` wants.
 */
function readDefaults(): Palette {
  const style = getComputedStyle(document.documentElement);

  return Object.fromEntries(
    THEME_TOKENS.map((token) => [
      token.name,
      style.getPropertyValue(propertyOf(token.name)).trim(),
    ]),
  ) as Palette;
}

/**
 * The stored overrides, token by token.
 *
 * Token by token and not a spread, as `roll-settings.ts` reads its own: a
 * custom property accepts any text at all, so a hand-edited value is installed
 * without complaint and then paints nothing, which reads as the theme being
 * broken rather than as a setting being wrong. A key that is not a token and a
 * value that is not a colour are both dropped.
 */
function readOverrides(): Overrides {
  let stored: unknown;
  try {
    const raw = readStored(STORAGE_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    stored = null; // Not ours, or not JSON; the defaults are fine.
  }

  return parseOverrides(stored);
}

/** The tokens in `value` that name a colour, and nothing else. */
export function parseOverrides(value: unknown): Overrides {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const overrides: Partial<Record<ThemeTokenName, string>> = {};
  for (const [name, colour] of Object.entries(value)) {
    if (isTokenName(name) && isHexColour(colour)) {
      overrides[name] = colour;
    }
  }

  return overrides;
}

/**
 * Puts the overrides on `<html>` as inline custom properties.
 *
 * An element's own style beats the `:root` rule Tailwind emits, so this reaches
 * every utility and every `var()` reader without a second selector or an
 * `!important`. A token that is no longer overridden has its property
 * *removed* rather than set back to the default, which is what makes a reset
 * exact — the stylesheet's value shows through, whatever it has since become.
 */
function applyOverrides(overrides: Overrides, surface: string): void {
  const style = document.documentElement.style;

  for (const token of THEME_TOKENS) {
    const colour = overrides[token.name];
    if (colour) {
      style.setProperty(propertyOf(token.name), colour);
    } else {
      style.removeProperty(propertyOf(token.name));
    }
  }

  // The one copy of the colour that lives outside the CSS, and the only one
  // that can follow a change; the manifest's is baked into the installed app.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', surface);
}

/**
 * What the app is painted in, and the porter's changes to it.
 *
 * Off the spine entirely, like `EditorRequests`: it injects nothing, and
 * everything downstream of it reads CSS rather than this service. The one
 * imperative sink is the document itself.
 */
@Service()
export class ThemeStore {
  readonly presets = PRESETS;

  /** The stylesheet's values. Read once, and never written to. */
  private readonly defaults: Palette = readDefaults();

  /** Only the tokens the porter has moved off a default. */
  readonly overrides = signal<Overrides>(readOverrides());

  /**
   * A colour being dragged in the picker. Shown, and never stored.
   *
   * `<input type="color">` reports every step of a drag through the operating
   * system's picker on `input` and settles on `change`, which is the same split
   * `Slider` and `NumberField` already make. Folding both into
   * {@link overrides} would put a synchronous `localStorage` write on every
   * frame of that drag; layering a transient signal over the stored one keeps
   * the tint live and the writes at one per edit.
   */
  private readonly previewing = signal<Overrides>({});

  /** What is on screen: the stored overrides with any drag laid over them. */
  readonly effective = computed<Overrides>(() => ({
    ...this.overrides(),
    ...this.previewing(),
  }));

  readonly palette = computed<Palette>(() => ({ ...this.defaults, ...this.effective() }));

  /** Whether anything at all has been changed, which is what Reset all needs. */
  readonly customised = computed(() => Object.keys(this.overrides()).length > 0);

  /** The preset the stored overrides are exactly, or null for a mix of the porter's own. */
  readonly activePreset = computed<string | null>(() => {
    const overrides = this.overrides();

    return PRESETS.find((preset) => sameOverrides(preset.overrides, overrides))?.id ?? null;
  });

  constructor() {
    // Sanctioned effect: mirroring signal state into the document, which is an
    // imperative sink, as `playback.ts` does for the player.
    effect(() => applyOverrides(this.effective(), this.palette().surface));

    // Sanctioned effect: mirroring state into localStorage, as `app.ts` does
    // for the split. The preview deliberately does not reach this.
    effect(() => writeStored(STORAGE_KEY, JSON.stringify(this.overrides())));
  }

  /** The colour a token is standing at, override or default. */
  colourOf(name: ThemeTokenName): string {
    return this.palette()[name];
  }

  /** Shows a colour without storing it. Ended by {@link set} or {@link reset}. */
  preview(name: ThemeTokenName, colour: string): void {
    if (isHexColour(colour)) {
      this.previewing.set({ [name]: colour });
    }
  }

  /** Takes the colour, and lets go of whatever was being previewed. */
  set(name: ThemeTokenName, colour: string): void {
    if (!isHexColour(colour)) {
      return;
    }

    this.previewing.set({});
    this.overrides.update((overrides) => ({ ...overrides, [name]: colour }));
  }

  /** Puts one token back to the stylesheet's own colour. */
  reset(name: ThemeTokenName): void {
    this.previewing.set({});
    this.overrides.update((overrides) => {
      const next = { ...overrides };
      delete next[name];

      return next;
    });
  }

  usePreset(preset: ThemePreset): void {
    this.previewing.set({});
    this.overrides.set({ ...preset.overrides });
  }

  /** Back to the stylesheet on every token, which is the Graphite preset. */
  resetAll(): void {
    this.previewing.set({});
    this.overrides.set({});
  }

  /** The overrides as text, for a porter who wants to keep or pass on a theme. */
  exportJson(): string {
    return JSON.stringify(this.overrides(), null, 2);
  }

  /** Takes a pasted theme, or answers false and changes nothing. */
  importJson(json: string): boolean {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return false;
    }

    if (!parsed || typeof parsed !== 'object') {
      return false;
    }

    this.previewing.set({});
    this.overrides.set(parseOverrides(parsed));

    return true;
  }
}

function sameOverrides(a: Overrides, b: Overrides): boolean {
  const names = Object.keys(a) as ThemeTokenName[];
  if (names.length !== Object.keys(b).length) {
    return false;
  }

  return names.every((name) => a[name] === b[name]);
}
