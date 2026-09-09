/**
 * Per-scene battlemap background images, stored in IndexedDB.
 *
 * Backgrounds are data URLs that run 0.3-2 MB *after* downscaling. A handful of
 * saved scenes blows the ~5 MB `localStorage` budget shared by the whole
 * encounter store, so images live here instead: IndexedDB gets a per-origin
 * quota in the hundreds of MB and is the right home for blobby data. Only the
 * *current* scene's image is mirrored into Zustand state (for rendering); every
 * other scene's image sits in IndexedDB until you open it.
 *
 * Keyed by encounter id — the saved DB id once a scene is saved, the snapshot's
 * own `id` while it is still a draft. `mapImageKey()` in the store picks.
 *
 * Every method degrades quietly: a private window, a disabled IndexedDB, a
 * blocked upgrade, or a transaction error resolves to `null` / no-op rather than
 * throwing into a render or a store action.
 */

const DB_NAME = "battle-sim";
const DB_VERSION = 1;
const STORE = "map-images";

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const request = body(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(request.result ?? null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

export function getMapImage(key: string): Promise<string | null> {
  if (!key) return Promise.resolve(null);
  return run<string>("readonly", (store) => store.get(key)).then((value) =>
    typeof value === "string" ? value : null
  );
}

export function putMapImage(key: string, dataUrl: string): Promise<void> {
  if (!key || !dataUrl) return Promise.resolve();
  return run("readwrite", (store) => store.put(dataUrl, key)).then(() => undefined);
}

export function deleteMapImage(key: string): Promise<void> {
  if (!key) return Promise.resolve();
  return run("readwrite", (store) => store.delete(key)).then(() => undefined);
}

/** Copy an image to a new key (used when a scene is duplicated). No-op if the source is missing. */
export async function copyMapImage(fromKey: string, toKey: string): Promise<void> {
  if (!fromKey || !toKey || fromKey === toKey) return;
  const image = await getMapImage(fromKey);
  if (image) await putMapImage(toKey, image);
}

/** All keys currently held, for reconciliation / cleanup. */
export function listMapImageKeys(): Promise<string[]> {
  return run<IDBValidKey[]>("readonly", (store) => store.getAllKeys()).then((keys) =>
    Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : []
  );
}

/** Drop every stored image whose key is not in `keep`. Best-effort. */
export async function pruneMapImages(keep: Iterable<string>): Promise<void> {
  const keepSet = new Set(keep);
  const existing = await listMapImageKeys();
  await Promise.all(existing.filter((key) => !keepSet.has(key)).map((key) => deleteMapImage(key)));
}

/** Test seam — drop the cached connection so a fresh `indexedDB` global is picked up. */
export function __resetMapImageStoreForTests(): void {
  dbPromise = null;
}
