"use client";

import { create } from "zustand";
import type { SavedAbility } from "@/lib/ability-editor/my-library";

/**
 * My library: the account's saved abilities (`/api/my-library`), loaded once when the editor opens. Add ability lists
 * them for any creature; the ability editor saves to them.
 */
interface MyLibraryState {
  entries: SavedAbility[];
  status: "idle" | "loading" | "ready" | "failed";
  /** Entries the server holds that no longer pass their check. */
  problems: string[];
  load: () => Promise<void>;
  /** Saves a new entry or replaces one with its id: the saved entry, or why it wasn't saved. */
  save: (entry: SavedAbility) => Promise<{ entry?: SavedAbility; problem?: string }>;
  remove: (id: string) => Promise<boolean>;
  /** Sets the entries without the server (tests). */
  setEntries: (entries: SavedAbility[]) => void;
}

const sorted = (entries: SavedAbility[]) => [...entries].sort((a, b) => a.name.localeCompare(b.name));

export const useMyLibraryStore = create<MyLibraryState>((set, get) => ({
  entries: [],
  status: "idle",
  problems: [],
  load: async () => {
    set({ status: "loading" });
    try {
      const response = await fetch("/api/my-library");
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { entries: SavedAbility[]; problems?: string[] };
      set({ entries: sorted(data.entries), status: "ready", problems: data.problems ?? [] });
    } catch {
      set({ status: "failed" });
    }
  },
  save: async (entry) => {
    const response = await fetch("/api/my-library", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entry })
    }).catch(() => null);
    if (!response) return { problem: "The server couldn't be reached." };
    const data = await response.json().catch(() => ({})) as { entry?: SavedAbility; error?: string };
    if (!response.ok || !data.entry) return { problem: data.error ?? `The server said no (${response.status}).` };
    const saved = data.entry;
    set({ entries: sorted([...get().entries.filter((candidate) => candidate.id !== saved.id), saved]) });
    return { entry: saved };
  },
  remove: async (id) => {
    const response = await fetch(`/api/my-library/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return false;
    set({ entries: get().entries.filter((entry) => entry.id !== id) });
    return true;
  },
  setEntries: (entries) => set({ entries: sorted(entries), status: "ready" })
}));
