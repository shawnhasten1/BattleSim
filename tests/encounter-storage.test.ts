import { afterEach, describe, expect, it, vi } from "vitest";
import { createEncounterStorage } from "@/lib/encounterStorage";

class MemoryStorage {
  store = new Map<string, string>();
  /** Throw QuotaExceededError once the total serialized size crosses `cap`. */
  constructor(private cap = Infinity) {}
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string) {
    let total = value.length;
    for (const [k, v] of this.store) if (k !== key) total += v.length;
    if (total > this.cap) {
      const err = new DOMException("quota", "QuotaExceededError");
      throw err;
    }
    this.store.set(key, value);
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
}

function withLocalStorage(impl: unknown) {
  vi.stubGlobal("localStorage", impl);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const NAME = "battle-sim-encounter-v1";
const bigImage = "data:image/jpeg;base64," + "A".repeat(4000);
const payload = (extra: Record<string, unknown>) =>
  JSON.stringify({ state: { encounter: { id: "e1" }, selectedCombatantId: "pc", ...extra }, version: 0 });

describe("createEncounterStorage", () => {
  it("writes straight through when under quota", () => {
    const mem = new MemoryStorage();
    withLocalStorage(mem);
    const storage = createEncounterStorage();

    const value = payload({ mapImageDataUrl: bigImage });
    storage.setItem(NAME, value);

    expect(mem.getItem(NAME)).toBe(value);
  });

  it("sheds map images (not the encounter) when the write would exceed quota", () => {
    const mem = new MemoryStorage(2000);
    withLocalStorage(mem);
    const storage = createEncounterStorage();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    storage.setItem(
      NAME,
      payload({ mapImageDataUrl: bigImage, mapImagesByEncounterId: { e1: bigImage }, log: [{ id: "x" }] })
    );

    const saved = JSON.parse(mem.getItem(NAME) as string);
    expect(saved.state.encounter).toEqual({ id: "e1" });
    expect(saved.state.selectedCombatantId).toBe("pc");
    expect(saved.state.mapImagesByEncounterId).toBeUndefined();
    expect(saved.state.mapImageDataUrl).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("never throws QuotaExceededError back to the caller", () => {
    const mem = new MemoryStorage(10);
    withLocalStorage(mem);
    const storage = createEncounterStorage();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(() => storage.setItem(NAME, payload({ mapImageDataUrl: bigImage }))).not.toThrow();
  });

  it("still propagates non-quota errors", () => {
    withLocalStorage({
      getItem: () => null,
      setItem: () => {
        throw new TypeError("boom");
      },
      removeItem: () => {}
    });
    const storage = createEncounterStorage();
    expect(() => storage.setItem(NAME, payload({}))).toThrow("boom");
  });

  it("is inert (no throw) when localStorage is unavailable", () => {
    vi.unstubAllGlobals();
    // @ts-expect-error deliberately remove it
    delete globalThis.localStorage;
    const storage = createEncounterStorage();
    expect(() => storage.setItem(NAME, payload({}))).not.toThrow();
    expect(storage.getItem(NAME)).toBeNull();
  });
});
