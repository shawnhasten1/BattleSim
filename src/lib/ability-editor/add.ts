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
  type ItemDefinition,
  type LegendaryActionRef,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import {
  SRD_FEATURES, SRD_ITEMS, SRD_SPELL_SCROLLS, SRD_SPELLS, SRD_WEAPONS, findSrdFeature, findSrdItem, findSrdSpell, findSrdWeapon, type SrdEntryKind
} from "@/data/srd";
import { loadSrdMonster, type SrdMonsterAbilityEntry } from "@/data/srd/monsters";
import { legendaryUsed, ownAbilityFrom } from "./legendary";
import type { AbilityInsertTarget, AbilityRecord } from "./refs";
import { ownSpellScroll, ownSpellScrolls } from "./scrolls";
import type { SectionId } from "./sections";
import { castWith } from "./spells";
import { ACTION_TEMPLATES, FEATURE_TEMPLATES, ITEM_TEMPLATES, SPELL_TEMPLATES, WEAPON_TEMPLATES, blankDeathEffect, blankItem } from "./templates";

type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;

export type AddFilter = "all" | "mine" | "weapons" | "spells" | "items" | "monster" | "features" | "recipes";

export const ADD_FILTERS: Array<{ value: AddFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "mine", label: "My library" },
  { value: "weapons", label: "Weapons" },
  { value: "spells", label: "Spells" },
  { value: "items", label: "Items" },
  { value: "monster", label: "Monster abilities" },
  { value: "features", label: "Traits & features" },
  { value: "recipes", label: "Recipes" }
];

/** A record ready for the editor, and where it goes: a list, or the legendary actions. */
export interface Prepared {
  list: AbilityInsertTarget;
  record: AbilityRecord;
  /** Pools it spends that the creature may not have (a copied monster ability's), offered as new while editing. */
  pools?: Record<string, number>;
  /** Sections to open highlighted: the ones a recipe expects filled in. */
  focus?: SectionId[];
  /** Creatures it summons or changes into that the scene may not have (a My library entry's): they come with it. */
  creatures?: CreatureDefinition[];
}

/* ─── recipes ────────────────────────────────────────────────────────────── */

export type RecipeGroup = "weapon" | "action" | "spell" | "feature" | "item" | "death";

export interface Recipe {
  id: string;
  label: string;
  hint: string;
  group: RecipeGroup;
  /** The sections to fill in, opened highlighted. */
  focus: SectionId[];
  prepare(definition: CreatureDefinition): Prepared;
  /** A recipe that's a search: choosing it searches for this (under Items) instead of opening the editor. */
  search?: string;
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
  "feature:regeneration": ["while-active"],
  "item:healing-potion": ["use", "grants"],
  "item:buff-potion": ["grants"],
  "item:wand": ["use", "grants"],
  "item:thrown-flask": ["grants"],
  "item:worn-item": ["while-active"],
  "item:armor": ["armor"],
  "item:shield": ["armor"],
  "item:other-gear": ["basics"],
  "death:death-burst": ["target", "roll", "damage"]
};
const GROUP_FOCUS: Record<RecipeGroup, SectionId[]> = { weapon: ["roll", "damage"], action: ["damage"], spell: ["roll"], feature: ["while-active"], item: ["grants"], death: ["damage"] };

function recipe(group: RecipeGroup, label: string, hint: string, prepare: (definition: CreatureDefinition) => Omit<Prepared, "focus">): Recipe {
  const id = `${group}:${slug(label)}`;
  const focus = FOCUS[id] ?? GROUP_FOCUS[group];
  return { id, label, hint, group, focus, prepare: (definition) => ({ ...prepare(definition), focus }) };
}

/**
 * A gas spore's or a mephit's burst: when it dies, everyone within 10 feet makes a CON save against poison, and is
 * poisoned for a minute on a failure (it repeats the save at the end of each of its turns).
 */
function deathBurst(): Omit<Prepared, "focus"> {
  const blank = blankDeathEffect();
  return {
    list: "deathEffects",
    record: {
      ...blank,
      action: {
        ...blank.action,
        saveAbility: "con",
        damage: [{ dice: "3d6", damageType: "poison", diceCount: 3, diceSize: 6 }],
        // The burst's own save gates it, and its repeats use the same save and DC.
        riders: [{ kind: "condition", when: "on-save-fail", condition: "poisoned", duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" } }]
      } as typeof blank.action
    }
  };
}

/** Every recipe: weapons, monster actions, spells, features and traits, and what happens when it dies. */
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
  })),
  ...ITEM_TEMPLATES.map((template) => recipe("item", template.label, template.hint, () => ({ list: "items", record: template.record() }))),
  // A scroll is made from a spell: the recipe asks for one by searching for the scrolls.
  {
    ...recipe("item", "Spell scroll", "A scroll of any spell in the library or on this creature: type the spell after “scroll”", () => ({ list: "items", record: { ...blankItem(), name: "Spell scroll", type: "scroll" } })),
    search: "scroll "
  },
  recipe("death", "Death burst", "When it dies, everyone within 10 ft makes a save or is poisoned (a gas spore, a mephit)", deathBurst)
];

/* ─── the library ────────────────────────────────────────────────────────── */

export interface LibraryEntry {
  kind: SrdEntryKind;
  id: string;
  name: string;
  entry: WeaponDefinition | SpellDefinition | FeatureDefinition | ItemDefinition;
}

const LIBRARY: LibraryEntry[] = [
  ...SRD_WEAPONS.map((entry): LibraryEntry => ({ kind: "weapon", id: entry.id, name: entry.name, entry })),
  ...SRD_SPELLS.map((entry): LibraryEntry => ({ kind: "spell", id: entry.id, name: entry.name, entry })),
  ...SRD_FEATURES.map((entry): LibraryEntry => ({ kind: "feature", id: entry.id, name: entry.name, entry })),
  ...SRD_ITEMS.map((entry): LibraryEntry => ({ kind: "item", id: entry.id, name: entry.name, entry }))
];

/** A scroll of every library spell: listed only when a search asks for scrolls. */
const SCROLLS: LibraryEntry[] = SRD_SPELL_SCROLLS.map((entry) => ({ kind: "item", id: entry.id, name: entry.name, entry }));

/** Whether a search asks for scrolls: one of its words is "scroll" (or "scrolls"). */
const wantsScrolls = (tokens: string[]) => tokens.some((token) => token === "scroll" || token === "scrolls");

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
  if (kind === "item") {
    const own = ownSpellScroll(definition, id);
    const item = findSrdItem(id) ?? own;
    const source = own ? { provider: "homebrew" as const, documentName: "Spell scroll", slug: id, importedAt: new Date().toISOString() } : SRD_SOURCE(id);
    return item ? { list: "items", record: { ...structuredClone(item), source } } : undefined;
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
  if (!monster) return undefined;
  const record = entry.list === "legendary" ? legendaryCopy(monster, Number(entry.id))
    : (monster[entry.list] as Array<{ id: string }> | undefined)?.find((candidate) => candidate.id === entry.id) as AbilityRecord | undefined;
  if (!record) return undefined;
  const pools = Object.fromEntries([...poolIdsIn(record)]
    .filter((id) => !id.startsWith("usage:") && !id.startsWith("slot-") && monster.resources?.[id] !== undefined)
    .map((id) => [id, monster.resources![id]!]));
  return { list: entry.list, record: structuredClone(record), ...(Object.keys(pools).length ? { pools } : {}) };
}

/**
 * A monster's legendary action, for another creature: one that uses one of the monster's abilities (a dragon's tail
 * attack) gets that ability as its own, since the creature it's copied to doesn't have the monster's.
 */
function legendaryCopy(monster: CreatureDefinition, index: number): LegendaryActionRef | undefined {
  const entry = monster.legendary?.actions[index];
  if (!entry) return undefined;
  const copy = structuredClone(entry);
  const used = legendaryUsed(monster, entry);
  if (!used) return copy;
  delete copy.actionId;
  return { ...copy, action: ownAbilityFrom(used, entry.name) };
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
  all: ["weapon", "action", "spell", "feature", "item", "death"], recipes: ["weapon", "action", "spell", "feature", "item", "death"], mine: [],
  weapons: ["weapon"], spells: ["spell"], items: ["item"], features: ["feature"], monster: ["action", "death"]
};
const LIBRARY_KINDS: Record<AddFilter, SrdEntryKind[]> = {
  all: ["weapon", "spell", "feature", "item"], mine: [], weapons: ["weapon"], spells: ["spell"], items: ["item"], features: ["feature"], monster: [], recipes: []
};

/**
 * What a search finds, by section. Monster abilities need a query (there are hundreds) and `abilities` loaded; traits
 * from them show under "Traits & features" too. Spell scrolls show only when the search asks for a scroll ("scroll
 * fireball"): one of every library spell, and of each of `definition`'s own spells.
 */
export function searchAdd(
  query: string,
  filter: AddFilter,
  abilities: readonly SrdMonsterAbilityEntry[] | undefined,
  definition?: Pick<CreatureDefinition, "spells">
): AddResults {
  const tokens = tokensOf(query);
  const recipes = ranked(RECIPES.filter((entry) => RECIPE_GROUPS[filter].includes(entry.group)), tokens, (entry) => entry.label, (entry) => `${entry.hint} ${entry.group}`);
  const scrolls = wantsScrolls(tokens)
    ? [...SCROLLS, ...(definition ? ownSpellScrolls(definition).map((entry): LibraryEntry => ({ kind: "item", id: entry.id, name: entry.name, entry })) : [])]
    : [];
  const library = ranked([...LIBRARY, ...scrolls].filter((entry) => LIBRARY_KINDS[filter].includes(entry.kind)), tokens, (entry) => entry.name, (entry) => entry.kind);
  const monsterKinds = filter === "all" || filter === "monster" ? undefined : filter === "features" ? ["trait", "feature"] : [];
  const monsterPool = !tokens.length || !abilities || (monsterKinds && !monsterKinds.length)
    ? []
    : ranked(abilities.filter((entry) => !monsterKinds || monsterKinds.includes(entry.kind)), tokens, (entry) => entry.name, (entry) => `${entry.monster} ${entry.text}`);
  return { recipes, library, monster: monsterPool.slice(0, MONSTER_LIMIT), monsterMore: Math.max(0, monsterPool.length - MONSTER_LIMIT) };
}
