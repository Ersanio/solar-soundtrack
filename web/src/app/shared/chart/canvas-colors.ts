import { DestroyRef, type Signal, inject, signal } from '@angular/core';

/**
 * The theme's colours for a `<canvas>`, which cannot read `var()`.
 *
 * Every colour is still a `--color-*` token from `styles.css`: a canvas asks for one by name and is
 * handed what the token resolves to on `<html>` now. `ThemeStore` writes a porter's colours there
 * as inline custom properties, so a `MutationObserver` on the element's `style` and `class` is told
 * of every change, and {@link version} lets a canvas redraw when one lands.
 *
 * Call from an injection context.
 */
export interface CanvasColors {
  /** Bumped whenever the theme changes. */
  version: Signal<number>;
  /** A token's colour, as a CSS colour string: `color('ch-3')`, `color('accent')`. */
  color(token: string): string;
  /** The same as `[r, g, b]`, 0 to 255, for colours mixed per pixel. */
  rgb(token: string): readonly [number, number, number];
}

export function canvasColors(): CanvasColors {
  const version = signal(0);
  const root = document.documentElement;
  const cache = new Map<string, string>();
  const rgbCache = new Map<string, readonly [number, number, number]>();

  const observer = new MutationObserver(() => {
    cache.clear();
    rgbCache.clear();
    version.update((n) => n + 1);
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
  inject(DestroyRef).onDestroy(() => observer.disconnect());

  // One pixel to resolve any CSS colour, `oklch()` and `color-mix()` included, to its bytes.
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });

  const color = (token: string): string => {
    let value = cache.get(token);
    if (value === undefined) {
      value = getComputedStyle(root).getPropertyValue(`--color-${token}`).trim() || 'currentColor';
      cache.set(token, value);
    }

    return value;
  };

  const rgb = (token: string): readonly [number, number, number] => {
    let value = rgbCache.get(token);
    if (value === undefined) {
      value = [0, 0, 0];
      if (probe) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = color(token);
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
        value = [r, g, b];
      }

      rgbCache.set(token, value);
    }

    return value;
  };

  return { version: version.asReadonly(), color, rgb };
}

/**
 * Sizes a canvas's backing store to its box at the device's pixel ratio and returns a context
 * scaled so drawing is in CSS pixels. `null` while the box has no size.
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  if (width <= 0 || height <= 0) {
    return null;
  }

  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(width * ratio);
  const h = Math.round(height * ratio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const context = canvas.getContext('2d');
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}
