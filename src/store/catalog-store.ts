"use client";

import { create } from "zustand";
import type { BuildSources } from "@/lib/character-builder/build";
import { mergeCatalog, type CatalogEntry, type CatalogKind } from "@/lib/character-builder/homebrew";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * The account's homebrew and imported catalog entries (plan Phase 8), and the builder's sources with them merged in
 * after the SRD's. Every place that builds a character reads `sources`, so a homebrew class is offered, built and leveled
 * exactly as an SRD one is.
 */
interface CatalogState {
  entries: CatalogEntry[];
  /** The SRD catalog and library with the entries added: rebuilt only when the entries change. */
  sources: BuildSources;
  status: "idle" | "loading" | "ready" | "failed";
  /** Entries the server holds that no longer pass their schemas. */
  problems: string[];
  load: () => Promise<void>;
  /** Saves new or changed entries; what the server turned down comes back, and the rest are kept. */
  save: (entries: CatalogEntry[]) => Promise<{ saved: CatalogEntry[]; problems: string[] }>;
  remove: (kind: CatalogKind, id: string) => Promise<boolean>;
  /** Sets the entries without the server (tests, and a page with no account). */
  setEntries: (entries: CatalogEntry[]) => void;
}

const merged = (entries: CatalogEntry[]) => ({ entries, sources: mergeCatalog(SRD_BUILD_SOURCES, entries) });

/** Replaces entries with the same kind and id, and adds the rest. */
function upserted(entries: CatalogEntry[], changed: CatalogEntry[]): CatalogEntry[] {
  const key = (item: CatalogEntry) => `${item.kind}|${item.entry.id}`;
  const next = new Map(entries.map((item) => [key(item), item]));
  for (const item of changed) next.set(key(item), item);
  return [...next.values()];
}

export const useCatalogStore = create<CatalogState>((set, get) => ({
  entries: [],
  sources: SRD_BUILD_SOURCES,
  status: "idle",
  problems: [],
  load: async () => {
    set({ status: "loading" });
    try {
      const response = await fetch("/api/catalog");
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { entries: CatalogEntry[]; problems?: string[] };
      set({ ...merged(data.entries), status: "ready", problems: data.problems ?? [] });
    } catch {
      set({ status: "failed" });
    }
  },
  save: async (entries) => {
    const response = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries })
    }).catch(() => null);
    if (!response) return { saved: [], problems: ["The server couldn't be reached."] };
    const data = await response.json().catch(() => ({})) as { entries?: CatalogEntry[]; problems?: string[]; error?: string };
    const saved = data.entries ?? [];
    if (saved.length) set(merged(upserted(get().entries, saved)));
    return { saved, problems: data.problems ?? (data.error ? [data.error] : []) };
  },
  remove: async (kind, id) => {
    const response = await fetch(`/api/catalog/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) return false;
    set(merged(get().entries.filter((item) => !(item.kind === kind && item.entry.id === id))));
    return true;
  },
  setEntries: (entries) => set(merged(entries))
}));

/** The builder's sources: the SRD's, with the account's homebrew entries. */
export const useBuildSources = () => useCatalogStore((state) => state.sources);
