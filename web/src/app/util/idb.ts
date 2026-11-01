/**
 * A minimal key/value store over IndexedDB, for the sample library.
 *
 * `localStorage` holds the MML draft (`editor-store.ts`) because it is a
 * string. Samples are binary and can run to hundreds of kilobytes each, which
 * is past what `localStorage` is meant for and would mean base64 on the way in
 * and out. IndexedDB stores a `Uint8Array` as-is.
 *
 * Every operation resolves rather than rejects. Storage is genuinely optional
 * here — private browsing disables it, quota can be exhausted, and a corrupt
 * database should not stop someone compiling a song. Callers get `null` or a
 * silent no-op and the library falls back to living in memory for the session.
 * `available()` reports which of the two happened, so the UI can say so.
 */

const DB_NAME = 'solar-soundtrack';
const DB_VERSION = 1;
const STORE = 'samples';

let opening: Promise<IDBDatabase | null> | undefined;
let failure: string | null = null;

function open(): Promise<IDBDatabase | null> {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      failure = $localize`:@@error.storage.this-browser-has-no-indexeddb:error.storage.this-browser-has-no-indexeddb`;
      resolve(null);
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      failure = $localize`:@@error.storage.indexeddb-could-not-be-opened:error.storage.indexeddb-could-not-be-opened ${String(error)}:error:`;
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      failure = $localize`:@@error.storage.indexeddb-is-unavailable-private-browsing:error.storage.indexeddb-is-unavailable-private-browsing`;
      resolve(null);
    };

    // Another tab holding an old version open. Don't hang the app waiting.
    request.onblocked = () => {
      failure = $localize`:@@error.storage.another-tab-is-holding-the:error.storage.another-tab-is-holding-the`;
      resolve(null);
    };
  });
  return opening;
}

/** Why persistence is unavailable, or `null` while it is working. */
export function storageFailure(): string | null {
  return failure;
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }

        try {
          const request = body(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => {
            const reason =
              request.error?.name ?? $localize`:@@error.storage.unknown:error.storage.unknown`;
            failure = $localize`:@@error.storage.write-failed:error.storage.write-failed ${reason}:error:`;
            resolve(null);
          };
        } catch (error) {
          failure = $localize`:@@error.storage.the-sample-database-rejected-an:error.storage.the-sample-database-rejected-an ${String(error)}:error:`;
          resolve(null);
        }
      }),
  );
}

/** Every stored sample, or an empty map when storage is unavailable. */
export async function loadAll(): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  const db = await open();
  if (!db) {
    return out;
  }

  const keys = await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys());
  const values = await run<unknown[]>('readonly', (store) => store.getAll());
  if (!keys || !values) {
    return out;
  }

  for (let index = 0; index < keys.length; index++) {
    const value = values[index];
    // Guard the shape: a database written by a future version, or partially
    // written, should not reach the BRR parser as something that isn't bytes.
    if (typeof keys[index] === 'string' && value instanceof Uint8Array) {
      out.set(keys[index] as string, value);
    }
  }

  return out;
}

export async function put(key: string, value: Uint8Array): Promise<void> {
  await run('readwrite', (store) => store.put(value, key));
}

export async function del(key: string): Promise<void> {
  await run('readwrite', (store) => store.delete(key));
}

export async function clear(): Promise<void> {
  await run('readwrite', (store) => store.clear());
}
