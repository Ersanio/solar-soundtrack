import { type Signal, effect, untracked } from '@angular/core';

/**
 * Runs `handler` when `source` changes value, and never on the value it starts
 * at.
 *
 * An effect runs once when it is created, so one reading the state alone acts on
 * a value nothing has just done: a component rebuilt on a tab switch would adopt
 * a decision taken long before it existed. This records what it came in on and
 * speaks only for the transition.
 *
 * The handler is `untracked`, so what it reads cannot re-arm it. Like `effect`,
 * it must be called from an injection context.
 */
export function onChange<T>(source: Signal<T>, handler: (value: T) => void): void {
  let held = untracked(source);
  effect(() => {
    const value = source();
    untracked(() => {
      if (value === held) {
        return;
      }

      held = value;
      handler(value);
    });
  });
}
