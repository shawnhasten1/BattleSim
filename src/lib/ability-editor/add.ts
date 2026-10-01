/**
 * Add ability (plan §3.2): one search over the library, the SRD monsters' abilities, recipes and blank kinds. Choosing a
 * row opens the editor on a ready copy and adds nothing until Save. Pure apart from loading a monster's chunk: the Add
 * panel shows it, tests read it.
 */
import {
  getExecutableActions,
  spellcastingAbility,
  type ActionDefinition,
  type ActionRider,
  type CreatureDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { SRD_FEATURES, SRD_SPELLS, SRD_WEAPONS, findSrdFeature, findSrdSpell, findSrdWeapon, type SrdEntryKind } from "@/data/srd";
import { loadSrdMonster, type SrdMonsterAbilityEntry } from "@/data/srd/monsters";
import type { AbilityList, AbilityRecord } from "./refs";
import type { SectionId } from "./sections";
import { castWith } from "./spells";
import { ACTION_TEMPLATES, FEATURE_TEMPLATES, SPELL_TEMPLATES, WEAPON_TEMPLATES } from "./templates";

type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;

export type AddFilter = "all" | "weapons" | "spells" | "monster" | "features" | "recipes";

export const ADD_FILTERS: Array<{ value: AddFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "weapons", label: "Weapons" },
  { value: "spells", label: "Spells" },
  { value: "monster", label: "Monster abilities" },
  { value: "features", label: "Traits & features" },
  { value: "recipes", label: "Recipes" }
];

/** A record ready for the editor, and the list it goes in. */
export interface Prepared {
  list: AbilityList;
  record: AbilityRecord;
  /** Pools it spends that the creature may not have (a copied monster ability's), offered as new while editing. */
  pools?: Record<string, number>;
  /** Sections to open highlighted: the ones a recipe expects filled in. */
  focus?: SectionId[];
}

/* ─── recipes ────────────────────────────────────────────────────────────── */

export type RecipeGroup = "weapon" | "action" | "spell" | "feature";

export interface Recipe {
  id: string;
  label: string;
  hint: string;
  group: RecipeGroup;
  /** The sections to fill in, opened highlighted. */
  focus: SectionId[];
  prepare(definition: CreatureDefinition): Prepared;
}

const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** What each recipe expects filled in; anything not listed opens its group's usual sections. */
const FOCUS: Record<string, SectionId[]> = {
  "weapon:weapon-with-a-rider": ["damage", "effects"],
  "action:breath-weapon": ["target", "roll", "damage"],
  "action:frightful-presence": ["roll"],
  "action:poison-bite": ["roll", "damage", "effects"],
  "action:grappling-claw": ["damage", "effects"],
  "action:swallow": ["damage", "effects"],
  "action:parry": ["while-active"],
  "spell:damage-cantrip": ["roll", "damage"],
  "spell:save-or-condition": ["roll", "effects"],
  "spell:area-blast": ["target", "damage"],
  "spell:healing": ["outcome"],
  "spell:buff": ["outcome"],
  "spell:teleport": ["target"],
  "spell:reaction-spell": ["use", "damage"],
  // Switched on: what it takes and how often, and what it does meanwhile.
  "feature:rage": ["use", "while-active"],
  "feature:reckless-attack": ["use", "while-active"],
  "feature:action-surge": ["use"],
  "feature:charge": ["while-active", "grants"],
  "feature:pounce": ["while-active", "grants"],
  "feature:rampage": ["grants"],
  "feature:stench": ["aura"],
  "feature:fear-aura": ["aura"],
  "feature:fire-aura": ["aura"],
  "feature:aura-of-protection": ["aura"],
  "feature:legendary-resistance": ["while-active"],
  "feature:regeneration": ["while-active"]
};
const GROUP_FOCUS: Record<RecipeGroup, SectionId[]> = { weapon: ["roll", "damage"], action: ["damage"], spell: ["roll"], feature: ["while-active"] };

function recipe(group: RecipeGroup, label: string, hint: string, prepare: (definition: CreatureDefinition) => Omit<Prepared, "focus">): Recipe {
  const id = `${group}:${slug(label)}`;
  const focus = FOCUS[id] ?? GROUP_FOCUS[group];
  return { id, label, hint, group, focus, prepare: (definition) => ({ ...prepare(definition), focus }) };
}

/** Every recipe: weapons, monster actions, spells, and features and traits. */
export const RECIPES: Recipe[] = [
  ...WEAPON_TEMPLATES.map((template) => recipe("weapon", template.label, template.hint, () => ({ list: "weapons", record: structuredClone(template.record) }))),
  ...ACTION_TEMPLATES.map((template) => recipe("action", template.label, template.hint, () => {
    const record = template.record();
    return { list: record.actionType === "reaction" ? "reactions" : record.actionType === "bonus" ? "bonusActions" : "actions", record };
  })),
  ...SPELL_TEMPLATES.map((template) => recipe("spell", template.label === "Reaction" ? "Reaction spell" : template.label, template.hint,
    (definition) => ({ list: "spells", record: template.record(spellcastingAbility(definition)) }))),
  ...FEATURE_TEMPLATES.map((template) => recipe("feature", template.label, template.hint, (definition) => {
    const attacks = getExecutableActions(definition).filter((action): action is AttackAction => action.kind === "attack");
    const record = template.record(attacks);
    return { list: record.category === "trait" ? "traits" : "features", record };
  }))
];

/* ─── the library ────────────────────────────────────────────────────────── */

export interface LibraryEntry {
  kind: SrdEntryKind;
  id: string;
  name: string;
  entry: WeaponDefinition | SpellDefinition | FeatureDefinition;
}

const LIBRARY: LibraryEntry[] = [
  ...SRD_WEAPONS.map((entry): LibraryEntry => ({ kind: "weapon", id: entry.id, name: entry.name, entry })),
  ...SRD_SPELLS.map((entry): LibraryEntry => ({ kind: "spell", id: entry.id, name: entry.name, entry })),
  ...SRD_FEATURES.map((entry): LibraryEntry => ({ kind: "feature", id: entry.id, name: entry.name, entry }))
];

const SRD_SOURCE = (slugId: string) => ({ provider: "homebrew" as const, documentName: "SRD", slug: slugId, importedAt: new Date().toISOString() });
const freshRiders = (riders: ActionRider[] | undefined) => riders?.map((rider) => ({ ...rider, id: `rider-${crypto.randomUUID()}` }));

/**
 * A library entry as one-click attach would add it, for the editor: a weapon or feature copied with its source; a spell
 * cast with this creature's spellcasting ability (its DC and attack follow it), its effects given fresh ids.
 */
export function prepareLibrary(kind: SrdEntryKind, id: string, definition: CreatureDefinition): Prepared | undefined {
  if (kind === "weapon") {
    const weapon = findSrdWeapon(id);
    return weapon ? { list: "weapons", record: { ...structuredClone(weapon), source: SRD_SOURCE(id) } } : undefined;
  }
  if (kind === "spell") {
    const source = findSrdSpell(id);
    if (!source) return undefined;
    const spell = castWith(structuredClone(source), spellcastingAbility(definition));
    const action = spell.action && "riders" in spell.action ? { ...spell.action, riders: freshRiders(spell.action.riders) } as ActionDefinition : spell.action;
    return { list: "spells", record: { ...spell, ...(action ? { action } : {}), source: SRD_SOURCE(id) } };
  }
  const feature = findSrdFeature(id);
  return feature ? { list: feature.category === "trait" ? "traits" : "features", record: { ...structuredClone(feature), source: SRD_SOURCE(id) } } : undefined;
}

/* ─── monster abilities ──────────────────────────────────────────────────── */

/** Every pool id a record spends or names, anywhere inside it. */
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
 * A monster's ability, copied from its creature for the editor. Its own uses or recharge follow its new id when saved;
 * any other pool it spends (charges, legendary resistance) comes with the size the monster had.
 */
export async function prepareMonsterAbility(entry: SrdMonsterAbilityEntry): Promise<Prepared | undefined> {
  const monster = await loadSrdMonster(entry.monsterId);
  const record = (monster?.[entry.list] as Array<{ id: string }> | undefined)?.find((candidate) => candidate.id === entry.id) as AbilityRecord | undefined;
  if (!monster || !record) return undefined;
  const pools = Object.fromEntries([...poolIdsIn(record)]
    .filter((id) => !id.startsWith("usage:") && !id.startsWith("slot-") && monster.resources?.[id] !== undefined)
    .map((id) => [id, monster.resources![id]!]));
  return { list: entry.list, record: structuredClone(record), ...(Object.keys(pools).length ? { pools } : {}) };
}

/* ─── search ─────────────────────────────────────────────────────────────── */

export interface AddResults {
  recipes: Recipe[];
  library: LibraryEntry[];
  monster: SrdMonsterAbilityEntry[];
  /** Monster abilities that matched beyond the ones shown. */
  monsterMore: number;
}

const MONSTER_LIMIT = 12;

const tokensOf = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

/** How well `name` (and the rest of its `text`) matches: 3 starts with the query, 2 a word in the name, 1 elsewhere. */
function rank(tokens: string[], name: string, text: string): number {
  if (!tokens.length) return 1;
  const lowerName = name.toLowerCase();
  const all = `${lowerName} ${text.toLowerCase()}`;
  if (!tokens.every((token) => all.includes(token))) return 0;
  if (lowerName.startsWith(tokens.join(" "))) return 3;
  return tokens.every((token) => lowerName.includes(token)) ? 2 : 1;
}

function ranked<T>(items: readonly T[], tokens: string[], nameOf: (item: T) => string, textOf: (item: T) => string): T[] {
  return items
    .map((item) => ({ item, score: rank(tokens, nameOf(item), textOf(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || nameOf(a.item).localeCompare(nameOf(b.item)))
    .map((entry) => entry.item);
}

const RECIPE_GROUPS: Record<AddFilter, RecipeGroup[]> = {
  all: ["weapon", "action", "spell", "feature"], recipes: ["weapon", "action", "spell", "feature"],
  weapons: ["weapon"], spells: ["spell"], features: ["feature"], monster: ["action"]
};
const LIBRARY_KINDS: Record<AddFilter, SrdEntryKind[]> = {
  all: ["weapon", "spell", "feature"], weapons: ["weapon"], spells: ["spell"], features: ["feature"], monster: [], recipes: []
};

/**
 * What a search finds, by section. Monster abilities need a query (there are hundreds) and `abilities` loaded; traits
 * from them show under "Traits & features" too.
 */
export function searchAdd(query: string, filter: AddFilter, abilities: readonly SrdMonsterAbilityEntry[] | undefined): AddResults {
  const tokens = tokensOf(query);
  const recipes = ranked(RECIPES.filter((entry) => RECIPE_GROUPS[filter].includes(entry.group)), tokens, (entry) => entry.label, (entry) => `${entry.hint} ${entry.group}`);
  const library = ranked(LIBRARY.filter((entry) => LIBRARY_KINDS[filter].includes(entry.kind)), tokens, (entry) => entry.name, (entry) => entry.kind);
  const monsterKinds = filter === "all" || filter === "monster" ? undefined : filter === "features" ? ["trait", "feature"] : [];
  const monsterPool = !tokens.length || !abilities || (monsterKinds && !monsterKinds.length)
    ? []
    : ranked(abilities.filter((entry) => !monsterKinds || monsterKinds.includes(entry.kind)), tokens, (entry) => entry.name, (entry) => `${entry.monster} ${entry.text}`);
  return { recipes, library, monster: monsterPool.slice(0, MONSTER_LIMIT), monsterMore: Math.max(0, monsterPool.length - MONSTER_LIMIT) };
}
