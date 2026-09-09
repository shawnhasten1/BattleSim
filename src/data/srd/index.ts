import type { FeatureDefinition, SpellDefinition, WeaponDefinition } from "@/engine";
import { SRD_WEAPONS } from "./weapons";
import { SRD_SPELLS } from "./spells";
import { SRD_FEATURES } from "./features";

/**
 * Bundled, offline weapon + spell + feature library. Entries are plain
 * `WeaponDefinition` / `SpellDefinition` / `FeatureDefinition` records; attaching
 * one deep-clones it and re-mints every id (see the store's `attachSrdWeapon` /
 * `attachSrdSpell` / `attachSrdFeature`). Adding an entry is a data change only
 * — see `README.md`.
 *
 * Bump `SRD_LIBRARY_VERSION` whenever the data changes; a future "refresh
 * attached copies" feature will diff against it.
 */
export const SRD_LIBRARY_VERSION = "2024.3";

export { SRD_WEAPONS } from "./weapons";
export { SRD_SPELLS } from "./spells";
export { SRD_FEATURES } from "./features";

export type SrdEntryKind = "weapon" | "spell" | "feature";

export interface SrdSearchResult {
  kind: SrdEntryKind;
  id: string;
  name: string;
  entry: WeaponDefinition | SpellDefinition | FeatureDefinition;
}

/* ── integrity: freeze + index, throwing on a malformed library ─────────────── */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function indexById<T extends { id: string }>(entries: readonly T[], kind: SrdEntryKind): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  const prefix = `srd:${kind}:`;
  for (const entry of entries) {
    if (!entry.id.startsWith(prefix)) {
      throw new Error(`SRD ${kind} "${entry.id}" must use the "${prefix}<slug>" id form`);
    }
    if (map.has(entry.id)) {
      throw new Error(`Duplicate SRD ${kind} id: ${entry.id}`);
    }
    map.set(entry.id, entry);
  }
  return map;
}

deepFreeze(SRD_WEAPONS);
deepFreeze(SRD_SPELLS);
deepFreeze(SRD_FEATURES);

const WEAPONS_BY_ID = indexById(SRD_WEAPONS, "weapon");
const SPELLS_BY_ID = indexById(SRD_SPELLS, "spell");
const FEATURES_BY_ID = indexById(SRD_FEATURES, "feature");

/* ── lookup ───────────────────────────────────────────────────────────────── */

export function findSrdWeapon(id: string): WeaponDefinition | undefined {
  return WEAPONS_BY_ID.get(id);
}

export function findSrdSpell(id: string): SpellDefinition | undefined {
  return SPELLS_BY_ID.get(id);
}

export function findSrdFeature(id: string): FeatureDefinition | undefined {
  return FEATURES_BY_ID.get(id);
}

/** Case-insensitive name substring search. `kind` narrows the result set. */
export function searchSrd(query: string, kind?: SrdEntryKind): SrdSearchResult[] {
  const needle = query.trim().toLowerCase();
  const results: SrdSearchResult[] = [];
  const push = (entryKind: SrdEntryKind, entries: ReadonlyArray<{ id: string; name: string }>) => {
    for (const entry of entries) {
      if (!needle || entry.name.toLowerCase().includes(needle)) {
        results.push({ kind: entryKind, id: entry.id, name: entry.name, entry: entry as SrdSearchResult["entry"] });
      }
    }
  };
  if (kind === undefined || kind === "weapon") push("weapon", SRD_WEAPONS);
  if (kind === undefined || kind === "spell") push("spell", SRD_SPELLS);
  if (kind === undefined || kind === "feature") push("feature", SRD_FEATURES);
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── drag-and-drop payload ────────────────────────────────────────────────── */

export const SRD_DRAG_MIME = "application/x-battle-sim-srd";

export interface SrdDragPayload {
  kind: SrdEntryKind;
  id: string;
}

export function serializeSrdDragPayload(kind: SrdEntryKind, id: string): string {
  return JSON.stringify({ kind, id } satisfies SrdDragPayload);
}

export function parseSrdDragPayload(raw: string): SrdDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const kind = (parsed as SrdDragPayload)?.kind;
    const id = (parsed as SrdDragPayload)?.id;
    if ((kind === "weapon" || kind === "spell" || kind === "feature") && typeof id === "string" && id) {
      return { kind, id };
    }
  } catch {
    // fall through
  }
  return null;
}
