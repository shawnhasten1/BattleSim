/**
 * The Abilities list (plan §3.1): every record on a creature once, in statblock order, placed where it's mainly used,
 * with what its row shows (its cost, its other uses, how much of it the simulator runs). The resources above it are
 * `src/lib/actor-sheet/resources.ts`. Pure: the Abilities tab shows it, tests read it.
 */
import {
  casterLevelOf,
  resolveNumericFormula,
  spellcastingAbility,
  spellSlotLevel,
  type Ability,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type FeatureDefinition,
  type ItemDefinition,
  type ResourceCost,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import type { DefinitionItemType } from "@/lib/definition-edits";
import { costText, MANUAL_REACTION_NOTES, poolName, statblockFor, usageLabel } from "@/lib/statblock";
import { actionLimit, spellLimit, type Limit } from "./bindings";
import { activationOf } from "./features";
import { findAbility, refKey, type AbilityInsertTarget, type AbilityList, type AbilityRecord, type AbilityRef } from "./refs";
import { canBeReaction } from "./spells";
import { abilityWarnings, type WarningId } from "./validate";

export type ListGroupId = "traits" | "actions" | "bonus" | "reactions" | "spellcasting" | "items" | "legendary" | "lair" | "death";

/** ● simulated, ◐ partly, ○ reference only or no combat effect. */
export type Automation = "simulated" | "partial" | "reference" | "no-effect";

/** Where Move to… can take an action. */
export type MoveTarget = "actions" | "bonus" | "reactions";

export interface ListRow {
  ref: AbilityRef;
  key: string;
  name: string;
  /** The statblock's short line. */
  line: string;
  /** What using it costs: "Recharge 5–6", "3/encounter", "1 rage", "3 charges". Absent at will. */
  cost?: string;
  /** Its other uses and switches: "also a bonus action", "power attack", "concentration". */
  chips: string[];
  automation: Automation;
  /** The dot's tooltip: why it's what it is. */
  automationNote: string;
  /** An optional rule: whether it's switched on. */
  enabled?: boolean;
  /** Where Move to… can take it (none for a record that isn't an action). */
  moves: MoveTarget[];
  /** How the sheet deletes it (a legendary action by its place). */
  itemType?: DefinitionItemType;
}

export interface SpellLevel {
  level: number;
  title: string;
  /** "3 of 4 slots". */
  slots?: string;
  rows: ListRow[];
}

export interface ListGroup {
  id: ListGroupId;
  title: string;
  /** "3 a round" (legendary), "Wisdom · save DC 15 · +7 to hit · 6th-level spellcaster" (spellcasting). */
  note?: string;
  rows: ListRow[];
  /** Spellcasting: its spells by level. */
  levels?: SpellLevel[];
  /** Spellcasting: what its note says, for a heading that edits the ability. */
  spellcasting?: { ability: Ability; dc: number; toHit: number; casterLevel: number };
}

const TITLES: Record<ListGroupId, string> = {
  traits: "Traits", actions: "Actions", bonus: "Bonus actions", reactions: "Reactions", spellcasting: "Spellcasting",
  items: "Items", legendary: "Legendary actions", lair: "Lair actions", death: "On death"
};
const ORDER: ListGroupId[] = ["traits", "actions", "bonus", "reactions", "spellcasting", "items", "legendary", "lair", "death"];

/** How many items a creature can be attuned to at once (5e). More is warned, not blocked (ITEMS_PLAN.md D7). */
export const ATTUNEMENT_LIMIT = 3;
const MOVE_GROUPS: MoveTarget[] = ["actions", "bonus", "reactions"];

/* ─── where a record is mainly used ──────────────────────────────────────── */

/** An action by what it takes: a free action sits with the actions. */
function slotGroup(actionType: ActionDefinition["actionType"]): MoveTarget {
  return actionType === "bonus" ? "bonus" : actionType === "reaction" ? "reactions" : "actions";
}

/** A weapon by the first slot it's used in: an action, unless it's only ever a bonus action. */
export function weaponGroup(weapon: WeaponDefinition): ListGroupId {
  const slots = (weapon.usableAs ?? ["action"]).filter((slot) => slot !== "reaction");
  return slots[0] === "bonus" ? "bonus" : "actions";
}

/**
 * A feature by how it's used: one that's switched on goes with what switching it on takes (Rage: a bonus action); one
 * that only grants abilities goes with its first (Second Wind, Extra Attack); anything else, always on, is a trait.
 */
export function featureGroup(feature: FeatureDefinition): ListGroupId {
  const activation = activationOf(feature);
  if (activation) return slotGroup(activation.actionType);
  const grants = (feature.grantedActions ?? []).filter((action) => action.kind !== "activate-feature");
  const alwaysOn = Boolean(feature.effects?.length || feature.aura || feature.emanation || feature.modifiers);
  return grants.length && !alwaysOn ? slotGroup(grants[0]!.actionType) : "traits";
}

/* ─── what a row shows ───────────────────────────────────────────────────── */

function limitChip(limit: Limit, cost: ResourceCost | undefined, usage: Parameters<typeof usageLabel>[0], slotted: boolean): string | undefined {
  switch (limit.kind) {
    case "at-will": return undefined;
    // A spell's slot is its level, which its heading says.
    case "slot": return slotted ? undefined : cost ? costText(cost) : undefined;
    case "pool": return cost ? costText(cost) : undefined;
    case "uses":
    case "recharge": return usageLabel(usage) || undefined;
  }
}

function actionCost(action: ActionDefinition): string | undefined {
  return limitChip(actionLimit.get(action), "resourceCost" in action ? action.resourceCost : undefined, "usage" in action ? action.usage : undefined, false);
}

/**
 * The editor's warnings that leave a record running as written: a leveled spell that spends nothing, damage that adds
 * another ability, and what the statblock already says. Any other means part of it never happens: the AI never uses it
 * (Reckless Attack, a manual reaction, a missing pool), using it does nothing yet, or a routine skips a step.
 */
const RUNS_AS_WRITTEN = new Set<WarningId>([
  "free-leveled-spell", "damage-ability-mismatch", "partly-simulated", "reference-only", "too-many-attuned", "scroll-above-level"
]);
/** The lists whose records the dot checks with the editor's warnings: all of them. */
const CHECKED_LISTS = new Set<AbilityRef["list"]>([
  "weapons", "items", "spells", "features", "traits", "actions", "bonusActions", "reactions", "legendary", "lairActions", "deathEffects"
]);

function automationOf(definition: CreatureDefinition, ref: AbilityRef): { automation: Automation; automationNote: string } {
  const entry = statblockFor(definition, ref);
  if (!entry || entry.support === "reference") return { automation: "reference", automationNote: "Reference only: the AI never uses it." };
  if (entry.support === "no-effect") return { automation: "no-effect", automationNote: "No combat effect: nothing in it changes a fight." };
  const record = CHECKED_LISTS.has(ref.list) ? findAbility(definition, ref) : undefined;
  const gaps = record ? abilityWarnings(definition, ref, record).filter((warning) => !RUNS_AS_WRITTEN.has(warning.id)) : [];
  // A manual reaction's warning already says what its statblock note does.
  const notSimulated = gaps.some((warning) => warning.id === "manual-reaction")
    ? entry.notSimulated.filter((note) => !MANUAL_REACTION_NOTES.includes(note))
    : entry.notSimulated;
  if (!gaps.length && !notSimulated.length) return { automation: "simulated", automationNote: "Simulated: the AI uses it as written." };
  const notes = [...gaps.map((warning) => warning.message), ...(notSimulated.length ? [`Not simulated: ${notSimulated.join(" ")}`] : [])];
  return { automation: "partial", automationNote: `Partly simulated. ${notes.join(" ")}` };
}

const ITEM_TYPES: Partial<Record<AbilityList, DefinitionItemType>> = {
  weapons: "weapon", items: "item", spells: "spell", features: "feature", traits: "trait", actions: "action", bonusActions: "bonusAction",
  reactions: "reaction", lairActions: "lairAction", deathEffects: "deathEffect"
};

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The statblock's short line, without what the row already says: its cost chip ("Recharge 5–6 · …", "… (1 rage)"), its
 * name ("Second Wind: …"), its spell level heading, or its group ("bonus action: …"); a reaction's trigger reads
 * "when it is targeted by a melee attack".
 */
function lineOf(short: string, name: string, cost: string | undefined, spell: boolean, group: ListGroupId | undefined): string {
  let line = short;
  if (cost && line.startsWith(`${cost} · `)) line = line.slice(cost.length + 3);
  if (spell) line = line.replace(/^(?:cantrip|level \d+) · /, "");
  if (line.startsWith(`${name}: `)) line = line.slice(name.length + 2);
  if (group === "bonus") line = line.replace(/^bonus action(?:: | · )/, "");
  if (group === "reactions") line = line.replace(/^reaction: /, "when ");
  if (cost) line = line.replace(new RegExp(`(?: · | \\()${escapeRegExp(cost)}\\)?$`), "");
  return line;
}

function row(definition: CreatureDefinition, ref: AbilityRef, name: string, fields: Partial<ListRow>, group?: ListGroupId): ListRow {
  const entry = statblockFor(definition, ref);
  return {
    ref,
    key: refKey(ref),
    name,
    // Without what a chip already says ("concentration").
    line: lineOf(entry?.short ?? "", name, fields.cost, ref.list === "spells", group)
      .split(" · ").filter((part) => !fields.chips?.includes(part)).join(" · "),
    chips: [],
    moves: [],
    ...automationOf(definition, ref),
    ...(ref.list === "legendary" ? { itemType: "legendary" as const } : ref.list !== "granted" ? { itemType: ITEM_TYPES[ref.list] } : {}),
    ...fields
  };
}

function weaponRow(definition: CreatureDefinition, weapon: WeaponDefinition): ListRow {
  const slots = weapon.usableAs ?? ["action"];
  const chips = [
    ...(weaponGroup(weapon) === "actions" && slots.includes("bonus") ? ["also a bonus action"] : []),
    ...(weapon.powerAttack ? ["power attack"] : [])
  ];
  const cost = weapon.resourceCost ? costText(weapon.resourceCost) : weapon.charges ? `${weapon.charges.max} ${weapon.charges.max === 1 ? "charge" : "charges"}` : undefined;
  return row(definition, { list: "weapons", id: weapon.id }, weapon.name, { chips, cost }, weaponGroup(weapon));
}

/**
 * An item by how many are left: "2 of 3" on a token (a stack), "5 of 7 charges"; on a creature on its own, what each
 * token starts with ("×3", "7 charges"). Its attunement is a chip.
 */
function itemRow(definition: CreatureDefinition, item: ItemDefinition, combatant: CombatantState | undefined): ListRow {
  const supply = item.supply;
  const full = supply ? definition.resources?.[supply.id] ?? supply.size : undefined;
  const left = supply && combatant ? combatant.resources?.[supply.id] ?? 0 : undefined;
  const count = supply && full !== undefined
    ? supply.unit === "charges"
      ? `${left !== undefined ? `${left} of ` : ""}${full} ${full === 1 ? "charge" : "charges"}`
      : left !== undefined ? `${left} of ${full}` : `×${full}`
    : undefined;
  const chips = item.attunement ? [item.attunement.attuned ? "attuned" : "not attuned"] : [];
  return row(definition, { list: "items", id: item.id }, item.name, { ...(count ? { cost: count } : {}), chips }, "items");
}

function actionRow(definition: CreatureDefinition, list: "actions" | "bonusActions" | "reactions", action: ActionDefinition): ListRow {
  const group = slotGroup(action.actionType);
  // A standard action is an action or a bonus action; anything that can carry a trigger can be a reaction too.
  const moves = MOVE_GROUPS.filter((to) => to !== group && (to !== "reactions" || canBeReaction(action)) && (action.kind !== "utility" || to !== "reactions"));
  return row(definition, { list, id: action.id }, action.name, { cost: actionCost(action), moves }, group);
}

function featureRow(definition: CreatureDefinition, feature: FeatureDefinition): ListRow {
  const list = (definition.traits ?? []).includes(feature) ? "traits" : "features";
  const activation = activationOf(feature);
  const first = activation ?? (feature.grantedActions ?? []).find((action) => action.kind !== "activate-feature");
  return row(definition, { list, id: feature.id }, feature.name, {
    cost: first ? actionCost(first) : undefined,
    chips: feature.optional ? ["optional rule"] : [],
    ...(feature.optional ? { enabled: feature.enabled === true } : {})
  }, featureGroup(feature));
}

function spellRow(definition: CreatureDefinition, spell: SpellDefinition): ListRow {
  const cost = limitChip(spellLimit.get(spell), spell.action && "resourceCost" in spell.action ? spell.action.resourceCost : spell.resourceCost,
    spell.action && "usage" in spell.action ? spell.action.usage : undefined, true);
  return row(definition, { list: "spells", id: spell.id }, spell.name, {
    cost,
    chips: spell.concentration ? ["concentration"] : []
  });
}

const ORDINAL = ["Cantrips", "1st level", "2nd level", "3rd level", "4th level", "5th level", "6th level", "7th level", "8th level", "9th level"];
const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;

/** "save DC 15 · +7 to hit · 6th-level spellcaster": the Spellcasting heading after its ability. */
export function spellcastingFacts({ dc, toHit, casterLevel }: { dc: number; toHit: number; casterLevel: number }): string {
  return `save DC ${dc} · ${toHit >= 0 ? "+" : ""}${toHit} to hit · ${ORDINAL_NUMBERS[casterLevel] ?? `${casterLevel}th`}-level spellcaster`;
}

const ORDINAL_NUMBERS = ["0th", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th", "11th", "12th", "13th", "14th", "15th", "16th", "17th", "18th", "19th", "20th"];

function spellcastingGroup(definition: CreatureDefinition, combatant: CombatantState | undefined): ListGroup | undefined {
  const spells = definition.spells ?? [];
  if (!spells.length) return undefined;
  const ability = spellcastingAbility(definition);
  const dc = resolveNumericFormula({ base: 8, ability: "spellcasting", proficiency: true }, definition);
  const toHit = resolveNumericFormula({ ability: "spellcasting", proficiency: true }, definition);
  const levels = [...new Set(spells.map((spell) => spell.level))].sort((a, b) => a - b).map((level): SpellLevel => {
    const full = level > 0 ? definition.resources?.[`slot-${level}`] : undefined;
    // What a token has left as the engine reads it (one it lacks is none), as the resource list says it.
    const now = level > 0 ? (combatant ? combatant.resources?.[`slot-${level}`] ?? 0 : full) : undefined;
    return {
      level,
      title: level === 0 ? "Cantrips (at will)" : ORDINAL[level] ?? `Level ${level}`,
      ...(full !== undefined ? { slots: `${now} of ${full} ${full === 1 ? "slot" : "slots"}` } : {}),
      rows: spells.filter((spell) => spell.level === level).map((spell) => spellRow(definition, spell))
    };
  });
  const casterLevel = casterLevelOf(definition);
  return {
    id: "spellcasting",
    title: TITLES.spellcasting,
    note: `${ABILITY_NAMES[ability]} · ${spellcastingFacts({ dc, toHit, casterLevel })}`,
    rows: [],
    levels,
    spellcasting: { ability, dc, toHit, casterLevel }
  };
}

/* ─── the list ───────────────────────────────────────────────────────────── */

/** The creature's abilities in statblock order, each once, where it's mainly used. Empty groups are left out. */
export function abilityList(definition: CreatureDefinition, combatant?: CombatantState): ListGroup[] {
  const groups = new Map<ListGroupId, ListRow[]>(ORDER.map((id) => [id, []]));
  const add = (id: ListGroupId, entry: ListRow) => groups.get(id)!.push(entry);

  for (const feature of [...(definition.traits ?? []), ...(definition.features ?? [])]) add(featureGroup(feature), featureRow(definition, feature));
  for (const weapon of definition.weapons ?? []) add(weaponGroup(weapon), weaponRow(definition, weapon));
  for (const item of definition.items ?? []) add("items", itemRow(definition, item, combatant));
  for (const list of ["actions", "bonusActions", "reactions"] as const) {
    for (const action of definition[list] ?? []) add(slotGroup(action.actionType), actionRow(definition, list, action));
  }
  (definition.legendary?.actions ?? []).forEach((entry, index) => {
    add("legendary", row(definition, { list: "legendary", index }, entry.name, { cost: `${entry.cost} ${entry.cost === 1 ? "action" : "actions"}` }));
  });
  for (const action of definition.lairActions ?? []) add("lair", row(definition, { list: "lairActions", id: action.id }, action.name, {}));
  for (const effect of definition.deathEffects ?? []) add("death", row(definition, { list: "deathEffects", id: effect.id }, effect.name, {}));

  // As in a statblock: a multiattack (or a feature that only grants one, like Extra Attack) heads its group, then the
  // weapons, the creature's own actions, and what its features give. Each keeps its order within that.
  const rank = ({ ref }: ListRow): number => {
    if (ref.list === "weapons") return 1;
    if (ref.list === "actions" || ref.list === "bonusActions" || ref.list === "reactions") {
      return definition[ref.list]?.find((action) => action.id === ref.id)?.kind === "multiattack" ? 0 : 2;
    }
    if (ref.list === "features" || ref.list === "traits") {
      const feature = definition[ref.list]?.find((candidate) => candidate.id === ref.id);
      const grants = (feature?.grantedActions ?? []).filter((action) => action.kind !== "activate-feature");
      return feature && !activationOf(feature) && grants[0]?.kind === "multiattack" ? 0 : 3;
    }
    return 2;
  };
  const out: ListGroup[] = [];
  for (const id of ORDER) {
    if (id === "spellcasting") {
      const spellcasting = spellcastingGroup(definition, combatant);
      if (spellcasting) out.push(spellcasting);
      continue;
    }
    const rows = groups.get(id)!;
    if (!rows.length) continue;
    const sorted = rows.map((entry, index) => ({ entry, index }))
      .sort((a, b) => rank(a.entry) - rank(b.entry) || a.index - b.index)
      .map(({ entry }) => entry);
    out.push({
      id,
      title: TITLES[id],
      ...(id === "legendary" && definition.legendary ? { note: `${definition.legendary.pool} a round` } : {}),
      ...(id === "items" && definition.items?.some((item) => item.attunement)
        ? { note: `attuned ${definition.items.filter((item) => item.attunement?.attuned).length} of ${ATTUNEMENT_LIMIT}` }
        : {}),
      ...(id === "lair" ? { note: "on initiative 20, while it's in its lair" } : {}),
      ...(id === "death" ? { note: "once, when it drops to 0 HP" } : {}),
      rows: sorted
    });
  }
  return out;
}

/* ─── row actions ────────────────────────────────────────────────────────── */

/**
 * A copy of a record to insert beside it: "Bite (copy)". Saving gives it new ids, and its own uses or recharge a pool of
 * its own (`withOwnUsagePool`).
 */
export function duplicateOf(definition: CreatureDefinition, ref: AbilityRef): { list: AbilityInsertTarget; record: AbilityRecord; after: string } | undefined {
  if (ref.list === "granted") return undefined;
  const record = findAbility(definition, ref);
  if (!record) return undefined;
  const copy = structuredClone(record) as AbilityRecord & { name: string };
  // A legendary action has no id: its copy goes after it by place.
  return { list: ref.list === "legendary" ? "legendary" : ref.list, record: { ...copy, name: `${copy.name} (copy)` }, after: ref.list === "legendary" ? String(ref.index) : ref.id };
}

