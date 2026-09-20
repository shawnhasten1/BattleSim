import type { CreatureType } from "@/engine";
import { SRD_MONSTER_INDEX, type SrdMonsterIndexEntry } from "@/data/srd/monsters";
import { CREATURE_TYPES } from "@/lib/creature-types";

/** Ids of the permanent SRD folders. They can't collide with user folders (those are UUIDs). */
export const SRD_ROOT_FOLDER_ID = "srd:root";
export const srdTypeFolderId = (type: CreatureType): string => `srd:type:${type}`;

export interface SrdTypeFolder {
  id: string;
  type: CreatureType;
  label: string;
  monsters: SrdMonsterIndexEntry[];
}

export interface SrdMonsterTree {
  id: typeof SRD_ROOT_FOLDER_ID;
  name: string;
  /** Total monsters under the root. */
  count: number;
  types: SrdTypeFolder[];
}

/**
 * SRD Monsters → Monster Type → monster. A permanent, read-only tree: it is derived from the
 * bundled index, so there is nothing to create, rename, move or delete. Empty types are omitted.
 */
export function buildSrdMonsterTree(index: readonly SrdMonsterIndexEntry[] = SRD_MONSTER_INDEX): SrdMonsterTree {
  const types: SrdTypeFolder[] = [];
  for (const { value, label } of CREATURE_TYPES) {
    const monsters = index
      .filter((entry) => entry.type === value)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (monsters.length > 0) types.push({ id: srdTypeFolderId(value), type: value, label, monsters });
  }
  types.sort((a, b) => a.label.localeCompare(b.label));
  return { id: SRD_ROOT_FOLDER_ID, name: "SRD Monsters", count: types.reduce((sum, type) => sum + type.monsters.length, 0), types };
}

/** 0.125 → "1/8", 0.25 → "1/4", 0.5 → "1/2", otherwise the integer. */
export function formatChallengeRating(cr: number): string {
  if (cr === 0.125) return "1/8";
  if (cr === 0.25) return "1/4";
  if (cr === 0.5) return "1/2";
  return String(cr);
}
