/**
 * My library: abilities a DM saves from the ability editor to use again on any creature (an item made from the SRD's
 * Boots of Speed that adds 10 ft instead, a Tough feat built by hand, a breath weapon, a legendary tail attack). Kept per
 * account on the server (`/api/my-library`, the catalog table under kind "ability"), and searched and added from Add
 * ability the way the SRD library is.
 */
import { z } from "zod";
import {
  collectDependencies,
  getExecutableActions,
  spellcastingAbility,
  type ActionDefinition,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type ItemDefinition,
  type LegendaryActionRef,
  type MultiattackStep,
  type SourceMetadata,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { isSrdMonsterId } from "@/data/srd/monsters";
import type { AddFilter, Prepared } from "./add";
import { legendaryUsed, ownAbilityFrom } from "./legendary";
import { castWith } from "./spells";

/** Every kind of ability the editor makes: an action is an attack, a special action, a reaction, a lair action… */
export type SavedKind = "item" | "weapon" | "spell" | "feature" | "action" | "legendary" | "death";
export type SavedRecord = ItemDefinition | WeaponDefinition | SpellDefinition | FeatureDefinition | ActionDefinition | LegendaryActionRef | DeathEffectDefinition;

/** The lists an action can sit in on a creature. */
export type ActionList = "actions" | "bonusActions" | "reactions" | "lairActions";
const ACTION_LISTS: readonly ActionList[] = ["actions", "bonusActions", "reactions", "lairActions"];

export interface SavedAbility {
  /** `mine:<uuid>`: the entry's id, which a copy on a sheet names as its source's slug. */
  id: string;
  kind: SavedKind;
  name: string;
  record: SavedRecord;
  /** For an action: the list it goes in (a lair action stays one; a reaction goes with the reactions). */
  list?: ActionList;
  /** Pools it spends that a creature may not have, at the size they had when it was saved (Rage's uses). */
  pools?: Record<string, number>;
  /**
   * The creatures its summons and shapechanges name that aren't SRD monsters (those are fetched again by id), with
   * what they name in turn, so it works in another encounter.
   */
  creatures?: CreatureDefinition[];
  /**
   * For a multiattack: the name of each ability its steps name, by the id it had. Another creature's ability of the
   * same name takes its place there (its Bite for this one's Bite).
   */
  steps?: Record<string, string>;
  savedAt: string;
}

/** The source a copy from the library carries: its document is "My library" and its slug the entry's id. */
export const MY_LIBRARY = "My library";

export function savedSource(entryId: string): SourceMetadata {
  return { provider: "homebrew", documentName: MY_LIBRARY, slug: entryId, importedAt: new Date().toISOString() };
}

/** A new entry's id. */
export const newSavedId = () => `mine:${crypto.randomUUID()}`;

const KINDS: readonly SavedKind[] = ["item", "weapon", "spell", "feature", "action", "legendary", "death"];

/** The kind a record the editor has open is saved as (its record type: every one can be). */
export function savedKindOf(type: string): SavedKind | undefined {
  return (KINDS as readonly string[]).includes(type) ? type as SavedKind : undefined;
}

/** What a kind is called on a row: "item", "action", "legendary action". */
export const SAVED_KIND_WORDS: Record<SavedKind, string> = {
  item: "item", weapon: "weapon", spell: "spell", feature: "feature", action: "action", legendary: "legendary action", death: "on death"
};

/** What a row calls an entry: an action by the list it goes in ("bonus action", "lair action"). */
export function savedKindWord(entry: Pick<SavedAbility, "kind" | "record" | "list">): string {
  if (entry.kind !== "action") return SAVED_KIND_WORDS[entry.kind];
  const list = listOf(entry);
  return list === "bonusActions" ? "bonus action" : list === "reactions" ? "reaction" : list === "lairActions" ? "lair action" : "action";
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

/** The creatures a record's summons and shapechanges name, anywhere inside it (a feature's or an item's grant too). */
export function namedCreatureIds(value: unknown, into = new Set<string>()): string[] {
  if (Array.isArray(value)) for (const item of value) namedCreatureIds(item, into);
  else if (value && typeof value === "object") {
    const node = value as { kind?: unknown; options?: unknown; forms?: unknown };
    if (node.kind === "summon" && Array.isArray(node.options)) {
      for (const option of node.options as Array<{ definitionId?: string; template?: unknown }>) if (option.definitionId && !option.template) into.add(option.definitionId);
    }
    if (node.kind === "transform" && Array.isArray(node.forms)) {
      for (const form of node.forms as Array<{ definitionId?: string }>) if (form.definitionId) into.add(form.definitionId);
    }
    for (const item of Object.values(value)) namedCreatureIds(item, into);
  }
  return [...into];
}

/** The creatures to keep with a record: the ones it names that aren't SRD monsters, found in `scene`, and what they name. */
function creaturesFor(record: SavedRecord, scene: readonly CreatureDefinition[]): CreatureDefinition[] {
  const byId = new Map(scene.map((creature) => [creature.id, creature]));
  const kept = new Map<string, CreatureDefinition>();
  const queue = namedCreatureIds(record);
  while (queue.length) {
    const id = queue.shift()!;
    if (kept.has(id) || isSrdMonsterId(id)) continue;
    const creature = byId.get(id);
    if (!creature) continue;
    kept.set(id, structuredClone(creature));
    queue.push(...collectDependencies(creature));
  }
  return [...kept.values()];
}

/** Every step of a multiattack's routines, or a legendary action's own multiattack's (none for anything else). */
function stepsOf(record: unknown): MultiattackStep[] {
  const held = record as { kind?: string; action?: unknown };
  const action = (held?.kind === undefined ? held?.action : held) as { kind?: string; attacks?: MultiattackStep[]; options?: Array<{ attacks: MultiattackStep[] }> } | undefined;
  if (action?.kind !== "multiattack") return [];
  return [...(action.attacks ?? []), ...(action.options ?? []).flatMap((option) => option.attacks)];
}

/**
 * A multiattack's steps pointed at `definition`'s abilities: a step keeps an ability it has under the same name, else
 * takes the one called what `names` says. A step that finds neither keeps its id (the editor warns about it).
 */
function withStepsBound<T>(record: T, names: Record<string, string>, definition: CreatureDefinition): T {
  const steps = stepsOf(record);
  if (!steps.length) return record;
  const held = record as { kind?: string; action?: ActionDefinition };
  if (held.kind === undefined) return { ...record, action: withStepsBound(held.action!, names, definition) };
  const executables = getExecutableActions(definition);
  const bind = (step: MultiattackStep): MultiattackStep => {
    const name = step.actionId ? names[step.actionId] : undefined;
    if (!step.actionId || !name) return step;
    const same = (action: ActionDefinition) => action.name.trim().toLowerCase() === name.trim().toLowerCase();
    if (executables.some((action) => action.id === step.actionId && same(action))) return step;
    const found = executables.find(same);
    return found ? { ...step, actionId: found.id } : step;
  };
  const action = record as { attacks: MultiattackStep[]; options?: Array<{ attacks: MultiattackStep[] }> };
  return {
    ...record,
    attacks: action.attacks.map(bind),
    ...(action.options ? { options: action.options.map((option) => ({ ...option, attacks: option.attacks.map(bind) })) } : {})
  };
}

/** The abilities a multiattack's steps name that `definition` has none of (by id or name): what to add or change first. */
export function unboundSteps(record: unknown, definition: CreatureDefinition): string[] {
  const ids = new Set(getExecutableActions(definition).map((action) => action.id));
  return [...new Set(stepsOf(record).flatMap((step) => (step.actionId && !ids.has(step.actionId) ? [step.actionId] : [])))];
}

/** The SRD monsters an entry needs fetched to be added: the ones it names, and the ones its kept creatures name. */
export function srdCreaturesNeeded(entry: Pick<SavedAbility, "record" | "creatures">): string[] {
  const ids = new Set([...namedCreatureIds(entry.record), ...(entry.creatures ?? []).flatMap(collectDependencies)]);
  return [...ids].filter(isSrdMonsterId);
}

/**
 * A record as the library keeps it, out of the creature's way: an item's stack or charges are its `"supply"` again (a
 * library item's own name for them), and a weapon's charges lose the creature's prefix, each with every use pointed at
 * the new name. A legendary action that uses one of the creature's abilities takes a copy of it as its own. Its other
 * pools come along with their sizes (the creature's, or a pool made in the editor), apart from spell slots and its own
 * uses or recharge, which a creature always has or makes; and so do the creatures it summons or turns into that aren't
 * SRD monsters (from `scene`, the encounter's creatures and any the editor fetched).
 */
export function savedFrom(
  kind: SavedKind,
  record: SavedRecord,
  definition: CreatureDefinition,
  options: { id: string; name: string; list?: string; newPools?: Record<string, number>; scene?: readonly CreatureDefinition[]; savedAt?: string }
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
  } else if (kind === "legendary") {
    const entry = copy as LegendaryActionRef;
    const used = legendaryUsed(definition, entry);
    if (used) {
      const { actionId: _actionId, ...rest } = entry;
      copy = { ...rest, action: ownAbilityFrom(used, entry.name) };
    }
  }
  const pools: Record<string, number> = {};
  for (const pool of poolIdsIn(copy)) {
    if (own.has(pool) || pool.startsWith("slot-") || pool.startsWith("usage:")) continue;
    const size = definition.resources?.[pool] ?? options.newPools?.[pool];
    if (size !== undefined) pools[pool] = size;
  }
  const creatures = creaturesFor(copy, options.scene ?? []);
  const executables = getExecutableActions(definition);
  const steps = Object.fromEntries(stepsOf(copy).flatMap((step) => {
    const named = step.actionId ? executables.find((action) => action.id === step.actionId) : undefined;
    return named ? [[named.id, named.name]] : [];
  }));
  copy = { ...copy, name: options.name, source: savedSource(options.id) } as SavedRecord;
  const list = kind === "action" && (ACTION_LISTS as readonly string[]).includes(options.list ?? "") ? options.list as ActionList : undefined;
  return {
    id: options.id,
    kind,
    name: options.name,
    record: copy,
    ...(list ? { list } : {}),
    ...(Object.keys(pools).length ? { pools } : {}),
    ...(creatures.length ? { creatures } : {}),
    ...(Object.keys(steps).length ? { steps } : {}),
    savedAt: options.savedAt ?? new Date().toISOString()
  };
}

/** The list a saved record goes in on a creature. */
export function listOf(entry: Pick<SavedAbility, "kind" | "record" | "list">): Prepared["list"] {
  switch (entry.kind) {
    case "item": return "items";
    case "weapon": return "weapons";
    case "spell": return "spells";
    case "feature": return (entry.record as FeatureDefinition).category === "trait" ? "traits" : "features";
    case "legendary": return "legendary";
    case "death": return "deathEffects";
    case "action": {
      if (entry.list) return entry.list;
      const actionType = (entry.record as ActionDefinition).actionType;
      return actionType === "bonus" ? "bonusActions" : actionType === "reaction" ? "reactions" : "actions";
    }
  }
}

/**
 * A saved entry ready for a creature, as a library row's is: a copy pointing back at the entry, its pools offered, the
 * creatures it summons or turns into that it keeps, a spell cast with this creature's spellcasting ability (its DC and
 * attack follow it) as an SRD spell is, and a multiattack's steps on this creature's abilities of the same names.
 */
export function prepareSaved(entry: SavedAbility, definition: CreatureDefinition): Prepared {
  let record = structuredClone(entry.record) as SavedRecord;
  if (entry.kind === "spell") record = castWith(record as SpellDefinition, spellcastingAbility(definition));
  if (entry.steps) record = withStepsBound(record, entry.steps, definition);
  return {
    list: listOf(entry),
    record: { ...record, source: savedSource(entry.id) } as Prepared["record"],
    ...(entry.pools && Object.keys(entry.pools).length ? { pools: { ...entry.pools } } : {}),
    ...(entry.creatures?.length ? { creatures: structuredClone(entry.creatures) } : {})
  };
}

/** Which kinds Add ability's filters show. */
const FILTER_KINDS: Record<AddFilter, readonly SavedKind[]> = {
  all: KINDS, mine: KINDS,
  weapons: ["weapon"], spells: ["spell"], items: ["item"], features: ["feature"], monster: ["action", "legendary", "death"], recipes: []
};

/** The saved entries a search finds, under a filter: every word in the name (or the kind), best first; all of them without words. */
export function searchSaved(entries: readonly SavedAbility[], query: string, filter: AddFilter): SavedAbility[] {
  const kinds = FILTER_KINDS[filter];
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((entry) => kinds.includes(entry.kind))
    .map((entry) => {
      const name = entry.name.toLowerCase();
      const text = `${name} ${SAVED_KIND_WORDS[entry.kind]}`;
      const score = !tokens.length ? 1 : !tokens.every((token) => text.includes(token)) ? 0 : name.startsWith(tokens.join(" ")) ? 3 : 2;
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map(({ entry }) => entry);
}

/* ─── checking what comes from the server ────────────────────────────────── */

// A legendary action has no id of its own; every other record has one. Deeper checks are the engine's, on insert.
const recordSchema = z.object({ id: z.string().optional(), name: z.string().min(1) }).passthrough();
const creatureSchema = z.object({ id: z.string(), name: z.string() }).passthrough();

const savedSchema = z.object({
  id: z.string().regex(/^mine:[\w-]+$/, "an id like mine:<id>"),
  kind: z.enum(["item", "weapon", "spell", "feature", "action", "legendary", "death"]),
  name: z.string().trim().min(1, "a name").max(200),
  record: recordSchema,
  list: z.enum(["actions", "bonusActions", "reactions", "lairActions"]).optional(),
  pools: z.record(z.string(), z.number().int().min(0)).optional(),
  creatures: z.array(creatureSchema).optional(),
  steps: z.record(z.string(), z.string()).optional(),
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
