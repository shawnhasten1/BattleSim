/**
 * My library: abilities a DM saves from the ability editor to use again on any creature (an item made from the SRD's
 * Boots of Speed that adds 10 ft instead, a Tough feat built by hand). Kept per account on the server (`/api/my-library`,
 * the catalog table under kind "ability"), and searched and added from Add ability the way the SRD library is.
 */
import { z } from "zod";
import {
  spellcastingAbility,
  type CreatureDefinition,
  type FeatureDefinition,
  type ItemDefinition,
  type SourceMetadata,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import type { AddFilter, Prepared } from "./add";
import { castWith } from "./spells";

/** What a library entry holds: the kinds of record the SRD library has too. */
export type SavedKind = "item" | "weapon" | "spell" | "feature";
export type SavedRecord = ItemDefinition | WeaponDefinition | SpellDefinition | FeatureDefinition;

export interface SavedAbility {
  /** `mine:<uuid>`: the entry's id, which a copy on a sheet names as its source's slug. */
  id: string;
  kind: SavedKind;
  name: string;
  record: SavedRecord;
  /** Pools it spends that a creature may not have, at the size they had when it was saved (Rage's uses). */
  pools?: Record<string, number>;
  savedAt: string;
}

/** The source a copy from the library carries: its document is "My library" and its slug the entry's id. */
export const MY_LIBRARY = "My library";

export function savedSource(entryId: string): SourceMetadata {
  return { provider: "homebrew", documentName: MY_LIBRARY, slug: entryId, importedAt: new Date().toISOString() };
}

/** A new entry's id. */
export const newSavedId = () => `mine:${crypto.randomUUID()}`;

/** The kind a record the editor has open can be saved as, or undefined (an action, a legendary action, a death effect). */
export function savedKindOf(type: string): SavedKind | undefined {
  return type === "item" || type === "weapon" || type === "spell" || type === "feature" ? type : undefined;
}

/** The library entry a record was made from (a copy on a sheet, or the editor's working copy), while it's still saved. */
export function linkedEntry(record: { source?: SourceMetadata }, entries: readonly SavedAbility[]): SavedAbility | undefined {
  const source = record.source;
  if (source?.documentName !== MY_LIBRARY || !source.slug) return undefined;
  return entries.find((entry) => entry.id === source.slug);
}

/** Every `resourceId` in a record equal to `from`, as `to`. */
function withPoolRenamed<T>(value: T, from: string, to: string): T {
  if (from === to) return value;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node).map(([key, item]) => [key, key === "resourceId" && item === from ? to : walk(item)]));
  };
  return walk(value) as T;
}

/** Every pool id a record spends or names. */
function poolIdsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) poolIdsIn(item, into);
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "resourceId" && typeof item === "string") into.add(item);
      else poolIdsIn(item, into);
    }
  }
  return into;
}

/**
 * A record as the library keeps it, out of the creature's way: an item's stack or charges are its `"supply"` again (a
 * library item's own name for them), and a weapon's charges lose the creature's prefix, each with every use pointed at
 * the new name. Its other pools come along with their sizes (the creature's, or a pool made in the editor), apart from
 * spell slots and its own uses or recharge, which a creature always has or makes.
 */
export function savedFrom(
  kind: SavedKind,
  record: SavedRecord,
  definition: Pick<CreatureDefinition, "resources">,
  options: { id: string; name: string; newPools?: Record<string, number>; savedAt?: string }
): SavedAbility {
  let copy = structuredClone(record) as SavedRecord;
  const own = new Set<string>();
  if (kind === "item") {
    const item = copy as ItemDefinition;
    if (item.supply) {
      copy = withPoolRenamed({ ...item, supply: { ...item.supply, id: "supply" } }, item.supply.id, "supply");
      own.add("supply");
    }
  } else if (kind === "weapon") {
    const weapon = copy as WeaponDefinition;
    if (weapon.charges) {
      const prefix = `${weapon.id}:`;
      const plain = weapon.charges.id.startsWith(prefix) ? weapon.charges.id.slice(prefix.length) : weapon.charges.id;
      copy = withPoolRenamed({ ...weapon, charges: { ...weapon.charges, id: plain } }, weapon.charges.id, plain);
      own.add(plain);
    }
  }
  const pools: Record<string, number> = {};
  for (const pool of poolIdsIn(copy)) {
    if (own.has(pool) || pool.startsWith("slot-") || pool.startsWith("usage:")) continue;
    const size = definition.resources?.[pool] ?? options.newPools?.[pool];
    if (size !== undefined) pools[pool] = size;
  }
  copy = { ...copy, name: options.name, source: savedSource(options.id) } as SavedRecord;
  return {
    id: options.id,
    kind,
    name: options.name,
    record: copy,
    ...(Object.keys(pools).length ? { pools } : {}),
    savedAt: options.savedAt ?? new Date().toISOString()
  };
}

/** The list a saved record goes in on a creature. */
export function listOf(entry: Pick<SavedAbility, "kind" | "record">): Prepared["list"] {
  if (entry.kind === "item") return "items";
  if (entry.kind === "weapon") return "weapons";
  if (entry.kind === "spell") return "spells";
  return (entry.record as FeatureDefinition).category === "trait" ? "traits" : "features";
}

/**
 * A saved entry ready for a creature, as a library row's is: a copy pointing back at the entry, its pools offered, and a
 * spell cast with this creature's spellcasting ability (its DC and attack follow it), as an SRD spell is.
 */
export function prepareSaved(entry: SavedAbility, definition: CreatureDefinition): Prepared {
  let record = structuredClone(entry.record) as SavedRecord;
  if (entry.kind === "spell") record = castWith(record as SpellDefinition, spellcastingAbility(definition));
  return {
    list: listOf(entry),
    record: { ...record, source: savedSource(entry.id) } as Prepared["record"],
    ...(entry.pools && Object.keys(entry.pools).length ? { pools: { ...entry.pools } } : {})
  };
}

/** Which kinds Add ability's filters show. */
const FILTER_KINDS: Record<AddFilter, SavedKind[]> = {
  all: ["weapon", "spell", "feature", "item"], mine: ["weapon", "spell", "feature", "item"],
  weapons: ["weapon"], spells: ["spell"], items: ["item"], features: ["feature"], monster: [], recipes: []
};

/** The saved entries a search finds, under a filter: every word in the name (or the kind), best first; all of them without words. */
export function searchSaved(entries: readonly SavedAbility[], query: string, filter: AddFilter): SavedAbility[] {
  const kinds = FILTER_KINDS[filter];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => kinds.includes(entry.kind))
    .map((entry) => {
      const name = entry.name.toLowerCase();
      const text = `${name} ${entry.kind}`;
      const score = !tokens.length ? 1 : !tokens.every((token) => text.includes(token)) ? 0 : name.startsWith(tokens.join(" ")) ? 3 : 2;
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
}

/* ─── checking what comes from the server ────────────────────────────────── */

const recordSchema = z.object({ id: z.string(), name: z.string().min(1) }).passthrough();

const savedSchema = z.object({
  id: z.string().regex(/^mine:[\w-]+$/, "an id like mine:<id>"),
  kind: z.enum(["item", "weapon", "spell", "feature"]),
  name: z.string().trim().min(1, "a name").max(200),
  record: recordSchema,
  pools: z.record(z.string(), z.number().int().min(0)).optional(),
  savedAt: z.string()
});

/** A library entry, checked: the entry, or what's wrong with it. */
export function parseSavedAbility(value: unknown): { entry: SavedAbility; problem?: undefined } | { entry?: undefined; problem: string } {
  const parsed = savedSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { problem: `${issue?.path.join(".") || "entry"}: ${issue?.message ?? "not a library entry"}` };
  }
  // The record is checked deeper when a creature takes it (the engine normalizes it on insert).
  return { entry: parsed.data as unknown as SavedAbility };
}
