import {
  getExecutableActions,
  type ActionDefinition,
  type CreatureDefinition,
  type MultiattackActionDefinition
} from "@/engine";

/** A record on a creature's sheet that can be deleted on its own. */
export type DefinitionItemType =
  | "weapon"
  | "spell"
  | "deathEffect"
  | "feature"
  | "trait"
  | "action"
  | "bonusAction"
  | "reaction"
  | "lairAction";

const ACTION_BUCKET: Partial<Record<DefinitionItemType, "actions" | "bonusActions" | "reactions">> = {
  action: "actions",
  bonusAction: "bonusActions",
  reaction: "reactions"
};

function multiattacksOf(definition: CreatureDefinition): MultiattackActionDefinition[] {
  return [...(definition.actions ?? []), ...(definition.bonusActions ?? []), ...(definition.reactions ?? [])]
    .filter((action): action is MultiattackActionDefinition => action.kind === "multiattack");
}

/**
 * The creature without one of its records, and without what went with it: every executable action the record
 * produced (a weapon's bonus-action, reaction and power-attack copies, a spell's upcast variants, a feature's granted
 * attacks) is removed from every multiattack, and a multiattack left with no steps is deleted.
 */
export function withoutDefinitionItem(definition: CreatureDefinition, itemType: DefinitionItemType, itemId: string): CreatureDefinition {
  const removedIds = new Set<string>([itemId]);
  if (itemType === "weapon") {
    const weapon = (definition.weapons ?? []).find((item) => item.id === itemId);
    if (weapon?.actionId) removedIds.add(weapon.actionId);
    removedIds.add(`weapon:${itemId}`);
  }
  if (itemType === "spell") {
    const spell = (definition.spells ?? []).find((item) => item.id === itemId);
    if (spell?.action?.id) removedIds.add(spell.action.id);
  }
  // An action row can be a weapon's or a spell's compiled attack in older data; deleting it deletes its source.
  const weaponIdsFromAction = itemType === "action"
    ? new Set((definition.weapons ?? []).filter((weapon) => removedIds.has(weapon.actionId ?? `weapon:${weapon.id}`)).map((weapon) => weapon.id))
    : new Set<string>();
  const spellIdsFromAction = itemType === "action"
    ? new Set((definition.spells ?? []).filter((spell) => spell.action?.id && removedIds.has(spell.action.id)).map((spell) => spell.id))
    : new Set<string>();

  const bucket = ACTION_BUCKET[itemType];
  const withoutRecord = <T extends { id: string }>(list: T[] | undefined, applies: boolean, alsoIds?: Set<string>): T[] | undefined =>
    applies ? (list ?? []).filter((item) => item.id !== itemId && !alsoIds?.has(item.id)) : list;
  const itemRemoved: CreatureDefinition = {
    ...definition,
    weapons: withoutRecord(definition.weapons, itemType === "weapon" || weaponIdsFromAction.size > 0, weaponIdsFromAction),
    spells: withoutRecord(definition.spells, itemType === "spell" || spellIdsFromAction.size > 0, spellIdsFromAction),
    deathEffects: withoutRecord(definition.deathEffects, itemType === "deathEffect"),
    lairActions: withoutRecord(definition.lairActions, itemType === "lairAction"),
    features: withoutRecord(definition.features, itemType === "feature"),
    traits: withoutRecord(definition.traits, itemType === "trait"),
    actions: withoutRecord(definition.actions, bucket === "actions") ?? [],
    bonusActions: withoutRecord(definition.bonusActions, bucket === "bonusActions"),
    reactions: withoutRecord(definition.reactions, bucket === "reactions")
  };

  // Everything the record produced: whatever could be used before and can't be now.
  const remaining = new Set(getExecutableActions(itemRemoved).map((action) => action.id));
  for (const action of getExecutableActions(definition)) {
    if (!remaining.has(action.id)) removedIds.add(action.id);
  }
  const scrub = (list: ActionDefinition[] | undefined): ActionDefinition[] | undefined => list
    ?.map((action) => action.kind === "multiattack"
      ? { ...action, attacks: action.attacks.filter((step) => !removedIds.has(step.actionId)) }
      : action)
    .filter((action) => action.kind !== "multiattack" || action.attacks.length > 0);
  return {
    ...itemRemoved,
    actions: scrub(itemRemoved.actions) ?? [],
    bonusActions: scrub(itemRemoved.bonusActions),
    reactions: scrub(itemRemoved.reactions)
  };
}

export interface MultiattackLoss {
  multiattack: MultiattackActionDefinition;
  /** The multiattack once the record is gone, or undefined when it's deleted along with it. */
  after?: MultiattackActionDefinition;
  /** The creature once the record is gone, to name what the multiattack is left with. */
  definitionAfter: CreatureDefinition;
}

/** The multiattacks that deleting a record would change or delete, so the sheet can ask first. */
export function multiattackLosses(definition: CreatureDefinition, itemType: DefinitionItemType, itemId: string): MultiattackLoss[] {
  const definitionAfter = withoutDefinitionItem(definition, itemType, itemId);
  const remaining = new Map(multiattacksOf(definitionAfter).map((multiattack) => [multiattack.id, multiattack]));
  return multiattacksOf(definition)
    // Deleting a multiattack itself changes no other multiattack.
    .filter((multiattack) => !(ACTION_BUCKET[itemType] && multiattack.id === itemId))
    .flatMap((multiattack) => {
      const after = remaining.get(multiattack.id);
      return after && after.attacks.length === multiattack.attacks.length ? [] : [{ multiattack, after, definitionAfter }];
    });
}
