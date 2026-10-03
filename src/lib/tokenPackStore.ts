/**
 * Token art the DM imported for SRD monsters, stored in this browser only (IndexedDB), keyed by
 * the monster's slug. It is never written into a creature definition, so it never syncs to the
 * server or reaches another user. See SRD_TOKEN_IMAGES_PLAN.md.
 *
 * A database of its own (not `mapImageStore`'s `battle-sim`) so neither store has to know the
 * other's schema version. Every method degrades quietly, as the map image store does: a private
 * window or a disabled IndexedDB reads as empty and writes as no-ops.
 */

const DB_NAME = "battle-sim-tokens";
const DB_VERSION = 1;
const STORE = "srd-tokens";

export interface StoredTokenImage {
  slug: string;
  blob: Blob;
}

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
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** Run `body` in one transaction; resolves true once it commits, false if it couldn't. */
function transact(mode: IDBTransactionMode, body: (store: IDBObjectStore) => void): Promise<boolean> {
  return openDb().then(
    (db) =>
      new Promise<boolean>((resolve) => {
        if (!db) {
          resolve(false);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          body(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.onabort = () => resolve(false);
        } catch {
          resolve(false);
        }
      })
  );
}

/** Every stored image. */
export async function listTokenImages(): Promise<StoredTokenImage[]> {
  let keys: IDBValidKey[] = [];
  let values: unknown[] = [];
  const ok = await transact("readonly", (store) => {
    const keyRequest = store.getAllKeys();
    const valueRequest = store.getAll();
    keyRequest.onsuccess = () => { keys = keyRequest.result; };
    valueRequest.onsuccess = () => { values = valueRequest.result; };
  });
  if (!ok) return [];
  return keys.flatMap((key, index) => {
    const value = values[index];
    return typeof key === "string" && value instanceof Blob ? [{ slug: key, blob: value }] : [];
  });
}

/** The slugs that have an image, without reading the images. */
export async function listTokenImageSlugs(): Promise<string[]> {
  let keys: IDBValidKey[] = [];
  const ok = await transact("readonly", (store) => {
    const request = store.getAllKeys();
    request.onsuccess = () => { keys = request.result; };
  });
  return ok ? keys.filter((key): key is string => typeof key === "string") : [];
}

/** Store (or replace) several images at once. */
export function putTokenImages(images: StoredTokenImage[]): Promise<boolean> {
  if (images.length === 0) return Promise.resolve(true);
  return transact("readwrite", (store) => {
    for (const { slug, blob } of images) if (slug) store.put(blob, slug);
  });
}

export function deleteTokenImage(slug: string): Promise<boolean> {
  if (!slug) return Promise.resolve(true);
  return transact("readwrite", (store) => { store.delete(slug); });
}

export function clearTokenImages(): Promise<boolean> {
  return transact("readwrite", (store) => { store.clear(); });
}

/** Test seam: drop the cached connection so a fresh `indexedDB` global is picked up. */
export function __resetTokenPackStoreForTests(): void {
  dbPromise = null;
}
