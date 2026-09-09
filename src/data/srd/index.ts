import type { SpellDefinition, WeaponDefinition } from "@/engine";
import { SRD_WEAPONS } from "./weapons";
import { SRD_SPELLS } from "./spells";

/**
 * Bundled, offline weapon + spell library. Entries are plain `WeaponDefinition` /
 * `SpellDefinition` records; attaching one deep-clones it and re-mints every id
 * (see the store's `attachSrdWeapon` / `attachSrdSpell`). Adding an entry is a
 * data change only — see `README.md`.
 *
 * Bump `SRD_LIBRARY_VERSION` whenever the data changes; a future "refresh
 * attached copies" feature will diff against it.
 */
export const SRD_LIBRARY_VERSION = "2024.2";

export { SRD_WEAPONS } from "./weapons";
export { SRD_SPELLS } from "./spells";

export type SrdEntryKind = "weapon" | "spell";

export interface SrdSearchResult {
  kind: SrdEntryKind;
  id: string;
  name: string;
  /** `WeaponDefinition` for weapons, `SpellDefinition` for spells. */
  entry: WeaponDefinition | SpellDefinition;
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

const WEAPONS_BY_ID = indexById(SRD_WEAPONS, "weapon");
const SPELLS_BY_ID = indexById(SRD_SPELLS, "spell");

/* ── lookup ───────────────────────────────────────────────────────────────── */

export function findSrdWeapon(id: string): WeaponDefinition | undefined {
  return WEAPONS_BY_ID.get(id);
}

export function findSrdSpell(id: string): SpellDefinition | undefined {
  return SPELLS_BY_ID.get(id);
}

/** Case-insensitive name substring search. `kind` narrows the result set. */
export function searchSrd(query: string, kind?: SrdEntryKind): SrdSearchResult[] {
  const needle = query.trim().toLowerCase();
  const results: SrdSearchResult[] = [];
  if (kind !== "spell") {
    for (const entry of SRD_WEAPONS) {
      if (!needle || entry.name.toLowerCase().includes(needle)) {
        results.push({ kind: "weapon", id: entry.id, name: entry.name, entry });
      }
    }
  }
  if (kind !== "weapon") {
    for (const entry of SRD_SPELLS) {
      if (!needle || entry.name.toLowerCase().includes(needle)) {
        results.push({ kind: "spell", id: entry.id, name: entry.name, entry });
      }
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/* ── drag-and-drop payload (drag source wired in a later phase) ─────────────── */

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
    if (
      parsed && typeof parsed === "object"
      && (parsed as SrdDragPayload).kind && (parsed as SrdDragPayload).id
      && ((parsed as SrdDragPayload).kind === "weapon" || (parsed as SrdDragPayload).kind === "spell")
      && typeof (parsed as SrdDragPayload).id === "string"
    ) {
      return { kind: (parsed as SrdDragPayload).kind, id: (parsed as SrdDragPayload).id };
    }
  } catch {
    // fall through
  }
  return null;
}
