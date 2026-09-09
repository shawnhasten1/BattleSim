import type { StateStorage } from "zustand/middleware";

/**
 * `localStorage` for the encounter store, hardened against `QuotaExceededError`.
 *
 * The store persists the encounter and the event log into a single key. (Map
 * backgrounds moved to IndexedDB — see `mapImageStore` — but legacy values may
 * still carry them until the first re-save.) A long event log, or a leftover
 * legacy image, can still approach the ~5 MB budget, and a throwing `setItem`
 * surfaces as a fatal runtime error mid-interaction. Instead we shed the
 * heaviest fields in order and keep the rest of the state persistent.
 */

const SHED_ORDER: string[] = ["mapImagesByEncounterId", "mapImageDataUrl", "log"];

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" ||
      error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      error.code === 22 ||
      error.code === 1014)
  );
}

export function createEncounterStorage(): StateStorage {
  return {
    getItem: (name) => {
      try {
        return typeof localStorage === "undefined" ? null : localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.setItem(name, value);
        return;
      } catch (error) {
        if (!isQuotaError(error)) throw error;
      }

      // Over quota — drop the heavy fields one at a time and try again.
      let parsed: { state?: Record<string, unknown> } | null = null;
      try {
        parsed = JSON.parse(value);
      } catch {
        parsed = null;
      }
      if (!parsed?.state) {
        console.warn(`[encounter-store] persist skipped: "${name}" exceeds storage quota`);
        return;
      }

      for (const field of SHED_ORDER) {
        if (field in parsed.state) {
          delete parsed.state[field];
          try {
            localStorage.setItem(name, JSON.stringify(parsed));
            console.warn(
              `[encounter-store] storage quota exceeded — persisted without "${field}". ` +
                `Map images live only in this tab until you save the encounter.`
            );
            return;
          } catch (error) {
            if (!isQuotaError(error)) throw error;
          }
        }
      }
      console.warn(`[encounter-store] persist skipped: "${name}" still exceeds quota after shedding heavy fields`);
    },
    removeItem: (name) => {
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    }
  };
}
