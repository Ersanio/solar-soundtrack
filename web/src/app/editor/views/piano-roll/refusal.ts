/** A refusal: why the roll will not splice a channel or write a gesture out, in the words it shows. */

export interface Refusal {
  refused: string;
}

export function isRefusal(outcome: unknown): outcome is Refusal {
  return (outcome as Refusal).refused !== undefined;
}
