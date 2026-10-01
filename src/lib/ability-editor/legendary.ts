/**
 * Legendary actions (plan Phase 7): what one does, and the pool they share. An entry uses one of the creature's own
 * abilities ("The dragon makes a tail attack"), has an ability of its own (Wing Attack), or is reference text the
 * simulator doesn't run (Detect).
 */
import {
  getExecutableActions,
  LEGENDARY_POINTS,
  type ActionDefinition,
  type CreatureDefinition,
  type LegendaryActionRef
} from "@/engine";
import { DEFAULT_LEGENDARY_POOL } from "./refs";
import { blankAttack } from "./templates";

export type LegendaryMode = "uses" | "own" | "reference";

export function legendaryMode(entry: LegendaryActionRef): LegendaryMode {
  return entry.action ? "own" : entry.actionId ? "uses" : "reference";
}

/** The kinds the AI takes between other creatures' turns (and a lair takes on initiative 20): attacks, saves, areas, multiattacks. */
export const OFFENSIVE_KINDS: ReadonlySet<ActionDefinition["kind"]> = new Set(["attack", "save", "area-save", "multiattack"]);

export type LegendaryChoiceGroup = "Attacks" | "Multiattacks" | "Saves and areas" | "Spells" | "Other";

export interface LegendaryChoice {
  /** The compiled action's id, as `LegendaryActionRef.actionId` stores it. */
  value: string;
  label: string;
  group: LegendaryChoiceGroup;
  kind: ActionDefinition["kind"];
}

const GROUP_ORDER: LegendaryChoiceGroup[] = ["Attacks", "Multiattacks", "Saves and areas", "Spells", "Other"];

function groupOf(kind: ActionDefinition["kind"]): LegendaryChoiceGroup {
  if (kind === "attack") return "Attacks";
  if (kind === "multiattack") return "Multiattacks";
  if (kind === "save" || kind === "area-save") return "Saves and areas";
  return "Other";
}

/**
 * What a legendary action can use: each of the creature's abilities once, by the id the engine compiles it under (a
 * weapon's attack, an action, a spell's action, what a feature grants), not their copies (a bonus-action swing, a power
 * attack, an option of a routine). Grouped and ordered for a picker.
 */
export function legendaryChoices(definition: CreatureDefinition): LegendaryChoice[] {
  const compiled = new Map(getExecutableActions(definition).map((action) => [action.id, action]));
  const choice = (id: string | undefined, label: string, group?: LegendaryChoiceGroup): LegendaryChoice[] => {
    const action = id ? compiled.get(id) : undefined;
    return action && action.kind !== "activate-feature" ? [{ value: action.id, label, group: group ?? groupOf(action.kind), kind: action.kind }] : [];
  };
  const choices = [
    ...(definition.weapons ?? []).flatMap((weapon) => choice(weapon.actionId ?? `weapon:${weapon.id}`, weapon.name, "Attacks")),
    ...[...definition.actions, ...(definition.bonusActions ?? []), ...(definition.reactions ?? [])].flatMap((action) => choice(action.id, action.name)),
    ...[...(definition.features ?? []), ...(definition.traits ?? [])].flatMap((feature) => (feature.grantedActions ?? []).flatMap((action) => choice(action.id, action.name))),
    ...(definition.spells ?? []).flatMap((spell) => choice(spell.action?.id, spell.name, "Spells"))
  ];
  return GROUP_ORDER.flatMap((group) => choices.filter((entry) => entry.group === group));
}

/** The ability an entry uses, as the engine compiles it; undefined when it has its own, or uses one the creature lacks. */
export function legendaryUsed(definition: CreatureDefinition, entry: LegendaryActionRef): ActionDefinition | undefined {
  return entry.actionId && !entry.action ? getExecutableActions(definition).find((action) => action.id === entry.actionId) : undefined;
}

/**
 * An ability of its own, copied from one the creature has: taken with legendary points, so it spends nothing else and
 * takes no slot of its own. It gets an id when it's saved.
 */
export function ownAbilityFrom(action: ActionDefinition, name: string): ActionDefinition {
  const copy = structuredClone(action) as ActionDefinition & Record<string, unknown>;
  for (const key of ["usage", "resourceCost", "reaction", "opportunityAttack", "onlyAfter", "grantsMovementFeet"]) delete copy[key];
  return { ...copy, id: "", name, actionType: "action" } as ActionDefinition;
}

/** What it was before switching, kept for the session so switching back brings it back. */
export interface ParkedLegendary {
  actionId?: string;
  action?: ActionDefinition;
}

/**
 * The entry switched to using one of the creature's abilities, an ability of its own, or reference text. Using one
 * picks what it used before, else the creature's first attack, save or multiattack. Its own ability starts as a copy of
 * the one it used (or as a plain attack).
 */
export function withLegendaryMode(
  entry: LegendaryActionRef,
  mode: LegendaryMode,
  parked: ParkedLegendary,
  definition: CreatureDefinition
): { entry: LegendaryActionRef; parked: ParkedLegendary } {
  if (legendaryMode(entry) === mode) return { entry, parked };
  const nextParked: ParkedLegendary = { ...parked, ...(entry.actionId ? { actionId: entry.actionId } : {}), ...(entry.action ? { action: entry.action } : {}) };
  const rest: LegendaryActionRef = { ...entry };
  delete rest.actionId;
  delete rest.action;
  if (mode === "reference") return { entry: rest, parked: nextParked };
  if (mode === "uses") {
    const choices = legendaryChoices(definition);
    const actionId = nextParked.actionId ?? choices.find((candidate) => OFFENSIVE_KINDS.has(candidate.kind))?.value ?? choices[0]?.value;
    return { entry: actionId ? { ...rest, actionId } : rest, parked: nextParked };
  }
  const used = legendaryUsed(definition, entry);
  const action = nextParked.action ?? (used ? ownAbilityFrom(used, entry.name) : { ...blankAttack(), name: entry.name });
  return { entry: { ...rest, action }, parked: nextParked };
}

/** A new legendary action: one of the creature's attacks for one action ("Tail Attack"), or reference text if it has none. */
export function blankLegendaryAction(definition: CreatureDefinition): LegendaryActionRef {
  const attack = legendaryChoices(definition).find((choice) => choice.kind === "attack");
  return attack
    ? { name: `${attack.label} Attack`, cost: 1, description: "", actionId: attack.value }
    : { name: "New legendary action", cost: 1, description: "" };
}

/**
 * The creature taking `pool` legendary actions a round. A creature that also lists its points as a pool (the SRD
 * library's) keeps the two in step.
 */
export function withLegendaryPool(definition: CreatureDefinition, pool: number): CreatureDefinition {
  const legendary = definition.legendary;
  const size = Math.max(1, Math.min(10, Math.round(pool) || DEFAULT_LEGENDARY_POOL));
  if (!legendary || legendary.pool === size) return definition;
  const listed = definition.resources?.[LEGENDARY_POINTS] !== undefined;
  return {
    ...definition,
    legendary: { ...legendary, pool: size },
    ...(listed ? { resources: { ...definition.resources, [LEGENDARY_POINTS]: size } } : {})
  };
}

/** The creature without its legendary action at `index`; with none left, without legendary actions at all. */
export function withoutLegendaryAction(definition: CreatureDefinition, index: number): CreatureDefinition {
  const legendary = definition.legendary;
  if (!legendary?.actions[index]) return definition;
  const actions = legendary.actions.filter((_, at) => at !== index);
  if (actions.length) return { ...definition, legendary: { ...legendary, actions } };
  const next: CreatureDefinition = { ...definition };
  delete next.legendary;
  if (definition.resources?.[LEGENDARY_POINTS] !== undefined) {
    const resources = { ...definition.resources };
    delete resources[LEGENDARY_POINTS];
    next.resources = resources;
  }
  return next;
}

/** The legendary actions (by index) that use one of `removed`: deleting those abilities leaves them nothing to do. */
export function legendaryUsersOf(definition: CreatureDefinition, removed: ReadonlySet<string>): Array<{ index: number; entry: LegendaryActionRef }> {
  return (definition.legendary?.actions ?? []).flatMap((entry, index) => (entry.actionId && !entry.action && removed.has(entry.actionId) ? [{ index, entry }] : []));
}
