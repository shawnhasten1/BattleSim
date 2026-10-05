import {
  getExecutableActions,
  type ActionDefinition,
  type CreatureDefinition,
  type LegendaryActionRef,
  type MultiattackActionDefinition,
  type MultiattackGeneric,
  type MultiattackStep
} from "@/engine";
import { legendaryUsersOf, withoutLegendaryAction } from "./ability-editor/legendary";

/** A record on a creature's sheet that can be deleted on its own. A legendary action's `itemId` is its index. */
export type DefinitionItemType =
  | "weapon"
  | "item"
  | "spell"
  | "deathEffect"
  | "feature"
  | "trait"
  | "action"
  | "bonusAction"
  | "reaction"
  | "lairAction"
  | "legendary";

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
 * attacks) is removed from every multiattack, and a multiattack left with no steps is deleted. With a `replacement`
 * (`id:<action>` or `any:<kind>`), the steps that used the record use it instead, and every routine is kept.
 */
export function withoutDefinitionItem(definition: CreatureDefinition, itemType: DefinitionItemType, itemId: string, replacement?: string): CreatureDefinition {
  // A legendary action is only itself: nothing else uses it.
  if (itemType === "legendary") return withoutLegendaryAction(definition, Number(itemId));
  const { itemRemoved, removedIds } = removalOf(definition, itemType, itemId);
  const scrub = (list: ActionDefinition[] | undefined): ActionDefinition[] | undefined => list
    ?.flatMap((action): ActionDefinition[] => {
      if (action.kind !== "multiattack") return [action];
      if (replacement) return [withStepsReplaced(action, removedIds, replacement)];
      const scrubbed = withoutSteps(action, removedIds);
      return scrubbed ? [scrubbed] : [];
    });
  return {
    ...itemRemoved,
    actions: scrub(itemRemoved.actions) ?? [],
    bonusActions: scrub(itemRemoved.bonusActions),
    reactions: scrub(itemRemoved.reactions),
    ...withLegendaryUsesReplaced(definition, removedIds, replacement)
  };
}

/**
 * The legendary actions once the abilities in `removed` are gone: one that used one of them uses `replacement` instead
 * (an ability, `id:<action>`), or is reference text from then on. Nothing when no legendary action used them.
 */
function withLegendaryUsesReplaced(definition: CreatureDefinition, removed: ReadonlySet<string>, replacement?: string): Pick<CreatureDefinition, "legendary"> | Record<string, never> {
  const legendary = definition.legendary;
  const users = new Set(legendaryUsersOf(definition, removed).map((user) => user.index));
  if (!legendary || !users.size) return {};
  const swapTo = replacement?.startsWith("id:") ? replacement.slice(3) : undefined;
  const actions = legendary.actions.map((entry, index): LegendaryActionRef => {
    if (!users.has(index)) return entry;
    if (swapTo) return { ...entry, actionId: swapTo };
    const next = { ...entry };
    delete next.actionId;
    return next;
  });
  return { legendary: { ...legendary, actions } };
}

/** The creature without the record itself, and every executable action that went with it. */
function removalOf(definition: CreatureDefinition, itemType: Exclude<DefinitionItemType, "legendary">, itemId: string): { itemRemoved: CreatureDefinition; removedIds: Set<string> } {
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
  // An item's stack or charges are the item: they go with it.
  const deletedItem = itemType === "item" ? (definition.items ?? []).find((item) => item.id === itemId) : undefined;
  const resources = deletedItem?.supply && definition.resources?.[deletedItem.supply.id] !== undefined
    ? Object.fromEntries(Object.entries(definition.resources).filter(([id]) => id !== deletedItem.supply!.id))
    : definition.resources;
  const itemRemoved: CreatureDefinition = {
    ...definition,
    ...(resources !== definition.resources ? { resources } : {}),
    weapons: withoutRecord(definition.weapons, itemType === "weapon" || weaponIdsFromAction.size > 0, weaponIdsFromAction),
    items: withoutRecord(definition.items, itemType === "item"),
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
  return { itemRemoved, removedIds };
}

/** A routine with every step that used a `removed` ability using `replacement` instead; counts and rules stay. */
function withStepsReplaced(action: MultiattackActionDefinition, removed: Set<string>, replacement: string): MultiattackActionDefinition {
  const swap = (steps: MultiattackStep[]) => steps.map((step): MultiattackStep => {
    if (!step.actionId || !removed.has(step.actionId)) return step;
    const next = { ...step };
    delete next.actionId;
    delete next.any;
    return replacement.startsWith("any:") ? { ...next, any: replacement.slice(4) as MultiattackGeneric } : { ...next, actionId: replacement.slice(3) };
  });
  return {
    ...action,
    attacks: swap(action.attacks),
    ...(action.options ? { options: action.options.map((option) => ({ ...option, attacks: swap(option.attacks) })) } : {})
  };
}

/** Every step a routine has, its options' included. */
const stepCount = (action: MultiattackActionDefinition) => action.attacks.length + (action.options ?? []).reduce((sum, option) => sum + option.attacks.length, 0);

/**
 * A routine without the steps that use `removed` abilities (a generic step names none, so it stays). An option left
 * empty goes; a main routine left empty hands over to its first option; with nothing left, the routine goes too.
 */
function withoutSteps(action: MultiattackActionDefinition, removed: Set<string>): MultiattackActionDefinition | undefined {
  const keep = (steps: MultiattackActionDefinition["attacks"]) => steps.filter((step) => !step.actionId || !removed.has(step.actionId));
  const main = keep(action.attacks);
  const options = (action.options ?? []).map((option) => ({ ...option, attacks: keep(option.attacks) })).filter((option) => option.attacks.length > 0);
  const routines = main.length ? [{ attacks: main }, ...options] : options;
  if (!routines.length) return undefined;
  const [first, ...rest] = routines;
  const next: MultiattackActionDefinition = { ...action, attacks: first!.attacks };
  delete next.options;
  return rest.length ? { ...next, options: rest } : next;
}

export interface MultiattackLoss {
  multiattack: MultiattackActionDefinition;
  /** The multiattack once the record is gone, or undefined when it's deleted along with it. */
  after?: MultiattackActionDefinition;
  /** The creature once the record is gone, to name what the multiattack is left with. */
  definitionAfter: CreatureDefinition;
}

/** The legendary actions that use a record (or what it produces): deleting it leaves them nothing to do, so the sheet asks first. */
export function legendaryLosses(definition: CreatureDefinition, itemType: DefinitionItemType, itemId: string): Array<{ index: number; entry: LegendaryActionRef }> {
  if (itemType === "legendary" || !definition.legendary) return [];
  return legendaryUsersOf(definition, removalOf(definition, itemType, itemId).removedIds);
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
      return after && stepCount(after) === stepCount(multiattack) ? [] : [{ multiattack, after, definitionAfter }];
    });
}
