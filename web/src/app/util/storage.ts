/**
 * `localStorage`, for code that would rather carry on without it.
 *
 * Storage is genuinely optional here — private browsing, a full quota, a
 * blocked third-party context — and every caller wants the same answer when it
 * is missing: use the default, say nothing. Reading it bare throws at the point
 * of access, and several of these run in field initialisers, so an unguarded
 * read does not degrade a preference, it fails the component's construction.
 *
 * A parsed value is the caller's business: what is stored under a key, and what
 * counts as valid, differ per caller. This only makes the access itself safe.
 */

/** The stored string, or `null` when there is none and when storage refuses. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a value, or does nothing at all. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private browsing, or a full quota. The setting still holds this session. */
  }
}
