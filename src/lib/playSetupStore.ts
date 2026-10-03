import type { EncounterSnapshot } from "@/engine";

/**
 * The board as it stood when Play started ("the setup"), per scene, in IndexedDB — so Reset to setup survives a reload
 * without asking localStorage to hold a second copy of the scene next to the persisted encounter.
 *
 * Keyed like the map images (`mapImageKey` in the store). A database of its own, as the token pack has, so the map
 * images' database version is never touched. Every method degrades quietly: no IndexedDB, a blocked open or a failed
 * transaction resolves to `null` / no-op.
 */

const DB_NAME = "battle-sim-play";
const DB_VERSION = 1;
const STORE = "setups";

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

function run<T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
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

export function getPlaySetup(key: string): Promise<EncounterSnapshot | null> {
  if (!key) return Promise.resolve(null);
  return run<EncounterSnapshot>("readonly", (store) => store.get(key)).then((value) =>
    value && typeof value === "object" ? value : null
  );
}

export function putPlaySetup(key: string, setup: EncounterSnapshot): Promise<void> {
  if (!key) return Promise.resolve();
  return run("readwrite", (store) => store.put(setup, key)).then(() => undefined);
}

export function deletePlaySetup(key: string): Promise<void> {
  if (!key) return Promise.resolve();
  return run("readwrite", (store) => store.delete(key)).then(() => undefined);
}
