import { DestroyRef, type ElementRef, type Signal, effect, inject, signal } from '@angular/core';

export interface Size {
  width: number;
  height: number;
}

/**
 * An element's content box, as a signal.
 *
 * A chart laid out in pixels needs real dimensions, and one that reads its
 * container once on init silently breaks on the first resize. This tracks the
 * box with a `ResizeObserver` and publishes it as a signal, so the geometry can
 * simply be a `computed` over it.
 *
 * Call from an injection context:
 *
 * ```ts
 * private readonly host = viewChild.required<ElementRef<SVGSVGElement>>('svg');
 * private readonly size = elementSize(this.host);
 * ```
 */
export function elementSize(target: Signal<ElementRef<Element> | undefined>): Signal<Size> {
  const size = signal<Size>({ width: 0, height: 0 });
  let observer: ResizeObserver | undefined;

  // Subscribing to a DOM API rather than deriving state, which is what effects
  // are for. The observer callback lands outside Angular entirely — under
  // zoneless change detection, writing the signal is what schedules a re-render.
  effect(() => {
    const element = target()?.nativeElement;
    observer?.disconnect();
    if (!element) {
      return;
    }

    observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) {
        size.set({ width: box.width, height: box.height });
      }
    });
    observer.observe(element);
  });

  inject(DestroyRef).onDestroy(() => observer?.disconnect());

  return size.asReadonly();
}
