/**
 * Where an ability lives on a creature, and how to read or put it back. The ability editor holds a working copy of the
 * record an `AbilityRef` points at, and saves by putting the whole record back (see the store's `replaceAbilityRecord`),
 * so nothing it doesn't show is ever rebuilt.
 */
import type {
  ActionDefinition,
  CreatureDefinition,
  DeathEffectDefinition,
  FeatureDefinition,
  LegendaryActionRef,
  SpellDefinition,
  WeaponDefinition
} from "@/engine";

/** The lists on a creature that hold abilities by id. */
export type AbilityList =
  | "weapons"
  | "spells"
  | "features"
  | "traits"
  | "deathEffects"
  | "lairActions"
  | "actions"
  | "bonusActions"
  | "reactions";

/** The lists a granted ability can live under. */
export type GrantingList = "weapons" | "features" | "traits";

export type AbilityRef =
  | { list: AbilityList; id: string }
  /** A legendary action: they have no ids, so it's found by its place in `legendary.actions`. */
  | { list: "legendary"; index: number }
  /** An action a weapon or feature grants, in its parent's `grantedActions`. */
  | { list: "granted"; parent: { list: GrantingList; id: string }; id: string };

/** Where a new ability can go: a list, the legendary actions, or the actions a weapon or feature grants. */
export type AbilityInsertTarget = AbilityList | "legendary" | { granted: { list: GrantingList; id: string } };

/** The record type each kind of ref points at. */
export interface AbilityRecordFor {
  weapons: WeaponDefinition;
  spells: SpellDefinition;
  features: FeatureDefinition;
  traits: FeatureDefinition;
  deathEffects: DeathEffectDefinition;
  lairActions: ActionDefinition;
  actions: ActionDefinition;
  bonusActions: ActionDefinition;
  reactions: ActionDefinition;
  legendary: LegendaryActionRef;
  granted: ActionDefinition;
}

export type AbilityRecord = AbilityRecordFor[keyof AbilityRecordFor];

const ACTION_LISTS = new Set<AbilityRef["list"]>(["actions", "bonusActions", "reactions"]);

export function isActionList(list: AbilityRef["list"]): list is "actions" | "bonusActions" | "reactions" {
  return ACTION_LISTS.has(list);
}

/** The list an action of this type belongs in. A free action sits with the actions. */
export function actionListFor(actionType: ActionDefinition["actionType"]): "actions" | "bonusActions" | "reactions" {
  return actionType === "bonus" ? "bonusActions" : actionType === "reaction" ? "reactions" : "actions";
}

/** A stable string for a ref, for React keys and comparisons. */
export function refKey(ref: AbilityRef): string {
  if (ref.list === "legendary") return `legendary:${ref.index}`;
  if (ref.list === "granted") return `granted:${ref.parent.list}:${ref.parent.id}:${ref.id}`;
  return `${ref.list}:${ref.id}`;
}

function listOf(definition: CreatureDefinition, list: AbilityList): Array<{ id: string }> {
  return (definition[list] as Array<{ id: string }> | undefined) ?? [];
}

export function findAbility<R extends AbilityRef>(definition: CreatureDefinition, ref: R): AbilityRecordFor[R["list"]] | undefined;
export function findAbility(definition: CreatureDefinition, ref: AbilityRef): AbilityRecord | undefined {
  if (ref.list === "legendary") return definition.legendary?.actions[ref.index];
  if (ref.list === "granted") {
    const parent = listOf(definition, ref.parent.list).find((item) => item.id === ref.parent.id) as WeaponDefinition | FeatureDefinition | undefined;
    return parent?.grantedActions?.find((action) => action.id === ref.id);
  }
  return listOf(definition, ref.list).find((item) => item.id === ref.id) as AbilityRecord | undefined;
}

/**
 * The creature with `record` put back where `ref` points, as given (no normalizing: see the store). An action whose
 * type changed moves to the list for its new type, and a feature whose category changed moves between features and
 * traits; the returned ref says where it ended up.
 */
export function withAbility(definition: CreatureDefinition, ref: AbilityRef, record: AbilityRecord): { definition: CreatureDefinition; ref: AbilityRef } {
  if (ref.list === "legendary") {
    const legendary = definition.legendary;
    if (!legendary?.actions[ref.index]) return { definition, ref };
    const actions = legendary.actions.map((entry, index) => (index === ref.index ? (record as LegendaryActionRef) : entry));
    return { definition: { ...definition, legendary: { ...legendary, actions } }, ref };
  }
  if (ref.list === "granted") {
    const parents = listOf(definition, ref.parent.list) as Array<WeaponDefinition | FeatureDefinition>;
    const next = parents.map((parent) => parent.id === ref.parent.id
      ? { ...parent, grantedActions: (parent.grantedActions ?? []).map((action) => (action.id === ref.id ? (record as ActionDefinition) : action)) }
      : parent);
    return { definition: { ...definition, [ref.parent.list]: next }, ref };
  }

  const target = targetList(ref.list, record);
  if (target === ref.list) {
    const next = listOf(definition, ref.list).map((item) => (item.id === ref.id ? record : item));
    return { definition: { ...definition, [ref.list]: next }, ref };
  }
  // Moving lists: out of the old one, onto the end of the new one.
  const id = (record as { id: string }).id;
  return {
    definition: {
      ...definition,
      [ref.list]: listOf(definition, ref.list).filter((item) => item.id !== ref.id),
      [target]: [...listOf(definition, target), record]
    },
    ref: { list: target, id }
  };
}

/** Where a record in `list` belongs once edited: an action goes by its type, a feature by its category. */
function targetList(list: AbilityList, record: AbilityRecord): AbilityList {
  if (isActionList(list)) return actionListFor((record as ActionDefinition).actionType);
  if (list === "features" || list === "traits") return (record as FeatureDefinition).category === "trait" ? "traits" : "features";
  return list;
}

/** The creature with `record` added to the end of `list` (or of the list its type belongs in). */
export function withNewAbility(definition: CreatureDefinition, list: AbilityList, record: AbilityRecord): { definition: CreatureDefinition; ref: AbilityRef } {
  const target = targetList(list, record);
  const id = (record as { id: string }).id;
  return { definition: { ...definition, [target]: [...listOf(definition, target), record] }, ref: { list: target, id } };
}

/** Every ability on a creature, in the order a sheet lists them within each list. */
export function abilityRefs(definition: CreatureDefinition): AbilityRef[] {
  const lists: AbilityList[] = ["weapons", "spells", "features", "traits", "actions", "bonusActions", "reactions", "lairActions", "deathEffects"];
  const refs: AbilityRef[] = lists.flatMap((list) => listOf(definition, list).map((item): AbilityRef => ({ list, id: item.id })));
  const legendary = (definition.legendary?.actions ?? []).map((_, index): AbilityRef => ({ list: "legendary", index }));
  const granted = (["weapons", "features", "traits"] as const).flatMap((list) =>
    (listOf(definition, list) as Array<WeaponDefinition | FeatureDefinition>).flatMap((parent) =>
      (parent.grantedActions ?? []).map((action): AbilityRef => ({ list: "granted", parent: { list, id: parent.id }, id: action.id }))));
  return [...refs, ...legendary, ...granted];
}
