/**
 * The pools an ability can spend from, as the editor's pool picker lists them: the creature's own (rage, ki, legendary
 * resistance …) and the weapon's charges when the ability is on a weapon. Spell slots and recharge / per-encounter
 * uses are chosen through the limit's own options instead.
 */
import { spellSlotLevel, type CreatureDefinition, type WeaponDefinition } from "@/engine";
import { poolName } from "@/lib/statblock";

export interface PoolOption {
  id: string;
  /** "rage", "The Fear Sword's charges". */
  label: string;
  /** Its starting size on the creature (or the weapon's charges), when known. */
  size?: number;
}

/** Whether a resource id is one the limit picker handles on its own (a spell slot, a recharge or per-encounter pool). */
export function isManagedPool(resourceId: string): boolean {
  return spellSlotLevel(resourceId) !== undefined || resourceId.startsWith("usage:") || resourceId === "legendary-points";
}

/** The pools to offer, the weapon's own charges first. `extra` lists pools created in the editor and not saved yet. */
export function poolOptions(definition: CreatureDefinition, weapon?: WeaponDefinition, extra: Record<string, number> = {}): PoolOption[] {
  const options: PoolOption[] = [];
  if (weapon?.charges) options.push({ id: weapon.charges.id, label: `${weapon.name || "This weapon"}'s charges`, size: weapon.charges.max });
  const pools = { ...(definition.resources ?? {}), ...extra };
  for (const [id, size] of Object.entries(pools)) {
    if (isManagedPool(id) || options.some((option) => option.id === id)) continue;
    options.push({ id, label: poolName(id), size });
  }
  return options;
}

/** A resource id for a pool the DM names ("Ki points" → "ki-points"), unique on the creature. */
export function newPoolId(name: string, definition: CreatureDefinition, extra: Record<string, number> = {}): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "pool";
  const taken = new Set([...Object.keys(definition.resources ?? {}), ...Object.keys(extra)]);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
