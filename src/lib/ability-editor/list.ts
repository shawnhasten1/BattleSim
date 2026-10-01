/**
 * The Abilities list (plan §3.1): every record on a creature once, in statblock order, placed where it's mainly used,
 * with what its row shows (its cost, its other uses, how much of it the simulator runs), and the pools strip above it.
 * Pure: the Abilities tab shows it, tests read it.
 */
import {
  resolveNumericFormula,
  spellcastingAbility,
  spellSlotLevel,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type FeatureDefinition,
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

export type ListGroupId = "traits" | "actions" | "bonus" | "reactions" | "spellcasting" | "legendary" | "lair" | "death";

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
  /** "3 a round" (legendary), "Wisdom · save DC 15 · +7 to hit" (spellcasting). */
  note?: string;
  rows: ListRow[];
  /** Spellcasting: its spells by level. */
  levels?: SpellLevel[];
}

const TITLES: Record<ListGroupId, string> = {
  traits: "Traits", actions: "Actions", bonus: "Bonus actions", reactions: "Reactions", spellcasting: "Spellcasting",
  legendary: "Legendary actions", lair: "Lair actions", death: "On death"
};
const ORDER: ListGroupId[] = ["traits", "actions", "bonus", "reactions", "spellcasting", "legendary", "lair", "death"];
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
const RUNS_AS_WRITTEN = new Set<WarningId>(["free-leveled-spell", "damage-ability-mismatch", "partly-simulated", "reference-only"]);
/** The lists whose records the dot checks with the editor's warnings: all of them. */
const CHECKED_LISTS = new Set<AbilityRef["list"]>([
  "weapons", "spells", "features", "traits", "actions", "bonusActions", "reactions", "legendary", "lairActions", "deathEffects"
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
  weapons: "weapon", spells: "spell", features: "feature", traits: "trait", actions: "action", bonusActions: "bonusAction",
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

function spellcastingGroup(definition: CreatureDefinition, combatant: CombatantState | undefined): ListGroup | undefined {
  const spells = definition.spells ?? [];
  if (!spells.length) return undefined;
  const ability = spellcastingAbility(definition);
  const dc = resolveNumericFormula({ base: 8, ability: "spellcasting", proficiency: true }, definition);
  const toHit = resolveNumericFormula({ ability: "spellcasting", proficiency: true }, definition);
  const levels = [...new Set(spells.map((spell) => spell.level))].sort((a, b) => a - b).map((level): SpellLevel => {
    const full = level > 0 ? definition.resources?.[`slot-${level}`] : undefined;
    const now = level > 0 ? combatant?.resources?.[`slot-${level}`] ?? full : undefined;
    return {
      level,
      title: level === 0 ? "Cantrips (at will)" : ORDINAL[level] ?? `Level ${level}`,
      ...(full !== undefined ? { slots: `${now} of ${full} ${full === 1 ? "slot" : "slots"}` } : {}),
      rows: spells.filter((spell) => spell.level === level).map((spell) => spellRow(definition, spell))
    };
  });
  return {
    id: "spellcasting",
    title: TITLES.spellcasting,
    note: `${ABILITY_NAMES[ability]} · save DC ${dc} · ${toHit >= 0 ? "+" : ""}${toHit} to hit`,
    rows: [],
    levels
  };
}

/* ─── the list ───────────────────────────────────────────────────────────── */

/** The creature's abilities in statblock order, each once, where it's mainly used. Empty groups are left out. */
export function abilityList(definition: CreatureDefinition, combatant?: CombatantState): ListGroup[] {
  const groups = new Map<ListGroupId, ListRow[]>(ORDER.map((id) => [id, []]));
  const add = (id: ListGroupId, entry: ListRow) => groups.get(id)!.push(entry);

  for (const feature of [...(definition.traits ?? []), ...(definition.features ?? [])]) add(featureGroup(feature), featureRow(definition, feature));
  for (const weapon of definition.weapons ?? []) add(weaponGroup(weapon), weaponRow(definition, weapon));
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

/* ─── the pools strip ────────────────────────────────────────────────────── */

export interface PoolChip {
  id: string;
  /** "Fire Breath", "rage", "Legendary actions". */
  label: string;
  kind: "recharge" | "uses" | "pool" | "legendary";
  /** What's left now (the token's), and its full size (the creature's). */
  now: number;
  full: number;
  /** "ready", "recharging", "2/3", "3 a round". */
  state: string;
}

/** Every action on the creature that can spend a pool, with where it came from. */
function spenders(definition: CreatureDefinition): Array<{ name: string; action: ActionDefinition }> {
  const out: Array<{ name: string; action: ActionDefinition }> = [];
  for (const list of ["actions", "bonusActions", "reactions", "lairActions"] as const) for (const action of definition[list] ?? []) out.push({ name: action.name, action });
  for (const spell of definition.spells ?? []) if (spell.action) out.push({ name: spell.name, action: spell.action });
  for (const owner of [...(definition.features ?? []), ...(definition.traits ?? []), ...(definition.weapons ?? [])]) {
    for (const action of owner.grantedActions ?? []) out.push({ name: action.kind === "activate-feature" ? owner.name : action.name, action });
  }
  return out;
}

/**
 * The creature's pools, for the strip above the list: what recharges (ready or recharging), what has uses, its named
 * pools (rage, ki, a weapon's charges) and its legendary actions. Spell slots are in the Spellcasting block.
 */
export function poolsStrip(definition: CreatureDefinition, combatant?: CombatantState): PoolChip[] {
  const sizes = definition.resources ?? {};
  const nowOf = (id: string) => combatant?.resources?.[id] ?? sizes[id] ?? 0;
  const chips: PoolChip[] = [];
  const seen = new Set<string>();
  const users = spenders(definition);

  for (const { name, action } of users) {
    const usage = "usage" in action ? action.usage : undefined;
    const cost = "resourceCost" in action ? action.resourceCost : undefined;
    if (!usage || !cost?.resourceId.startsWith("usage:") || seen.has(cost.resourceId)) continue;
    seen.add(cost.resourceId);
    // A pool shared on purpose (a dragon's two breaths) is named for everything that spends it.
    const names = [...new Set(users.filter((user) => "resourceCost" in user.action && user.action.resourceCost?.resourceId === cost.resourceId).map((user) => user.name))];
    const full = sizes[cost.resourceId] ?? (usage.kind === "uses" ? usage.uses ?? 1 : 1);
    const now = nowOf(cost.resourceId);
    chips.push({
      id: cost.resourceId, label: names.join(", "), kind: usage.kind === "recharge" ? "recharge" : "uses", now, full,
      state: usage.kind === "recharge" ? (now > 0 ? "ready" : "recharging") : `${now}/${full}`
    });
  }

  const charges = new Map((definition.weapons ?? []).filter((weapon) => weapon.charges).map((weapon) => [weapon.charges!.id, weapon.name]));
  for (const [id, full] of Object.entries(sizes)) {
    if (seen.has(id) || id.startsWith("usage:") || spellSlotLevel(id) !== undefined || id === "legendary-points") continue;
    seen.add(id);
    // Named for what spends it (Rage, Second Wind) or, failing that, the pool itself ("Legendary resistance").
    const weapon = charges.get(id) ?? [...charges.entries()].find(([chargesId]) => id.endsWith(`:${chargesId}`))?.[1];
    const names = [...new Set(users.filter((user) => "resourceCost" in user.action && user.action.resourceCost?.resourceId === id).map((user) => user.name))];
    const own = poolName(id, 1);
    const label = weapon ? `${weapon} charges` : names.length ? names.join(", ") : `${own.charAt(0).toUpperCase()}${own.slice(1)}`;
    chips.push({ id, label, kind: "pool", now: nowOf(id), full, state: `${nowOf(id)}/${full}` });
  }

  if (definition.legendary?.actions.length) {
    const full = definition.legendary.pool;
    chips.push({ id: "legendary-points", label: "Legendary actions", kind: "legendary", now: nowOf("legendary-points") || full, full, state: `${full} a round` });
  }
  return chips;
}
