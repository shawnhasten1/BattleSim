import type {
  ActionDefinition,
  BuffActionDefinition,
  CreatureDefinition,
  HealingActionDefinition,
  Id,
  ItemDefinition,
  ItemKind,
  ItemUseMeta
} from "./types";

/**
 * Items: potions, scrolls, wands, flasks and worn magic items (ITEMS_PLAN.md). An item's uses are ordinary actions in
 * its `grantedActions`, spending its `supply`; what it gives while carried is its `effects`. Pure: the compiler, the
 * store and the sheet share these.
 */

/** Item pools are `item:<item id>` once attached. */
export const ITEM_POOL_PREFIX = "item:";

/** The pool an attached item's uses spend. */
export function itemPoolId(itemId: Id): string {
  return `${ITEM_POOL_PREFIX}${itemId}`;
}

/** A potion's give copy carries this suffix on its drink's id: `<drink id>:give`. */
export const GIVE_SUFFIX = ":give";

/** Kinds used up one at a time: each use spends one of the stack. */
export function isConsumableKind(kind: ItemKind): boolean {
  return kind === "potion" || kind === "scroll" || kind === "thrown";
}

/** The items that work: one that needs attunement does nothing until it's attuned. */
export function workingItems(definition: CreatureDefinition): ItemDefinition[] {
  return (definition.items ?? []).filter((item) => !item.attunement || item.attunement.attuned);
}

/** A potion's own use: a heal or a buff its holder drinks, aimed at itself. */
export function isDrinkUse(action: ActionDefinition): action is HealingActionDefinition | BuffActionDefinition {
  return (action.kind === "healing" || action.kind === "buff") && action.targeting?.target === "self";
}

/**
 * An item's uses as the engine runs them, each stamped with the item. A potion that can be given also gets a give
 * copy of each drink (`<id>:give`): the same effect and cost, on another creature within 5 ft, taking the give's slot.
 */
export function compileItemUses(item: ItemDefinition): ActionDefinition[] {
  const potion = item.kind === "potion";
  const meta: ItemUseMeta = { id: item.id, name: item.name, kind: item.kind, consumes: item.supply?.unit === "count" };
  const uses = (item.grantedActions ?? []).map((use) => ({
    ...use,
    item: potion && isDrinkUse(use) ? { ...meta, use: "drink" as const } : meta
  } as ActionDefinition));
  const give = potion ? item.give : undefined;
  if (!give) return uses;
  return [...uses, ...uses.filter(isDrinkUse).map((drink) => giveCopy(drink, give.actionType))];
}

function giveCopy(drink: HealingActionDefinition | BuffActionDefinition, actionType: "action" | "bonus"): ActionDefinition {
  const common = {
    id: `${drink.id}${GIVE_SUFFIX}`,
    name: `${drink.name} (give)`,
    actionType,
    range: 5,
    item: { ...(drink as ActionDefinition).item!, use: "give" as const }
  };
  if (drink.kind === "healing") {
    return { ...drink, ...common, targeting: { target: "single", notSelf: true } };
  }
  // Drunk or given, it's the same potion's effect: one condition id, so nobody has it twice.
  return {
    ...drink,
    ...common,
    targeting: { target: "single", notSelf: true },
    appliedCondition: { ...drink.appliedCondition, id: drink.appliedCondition.id ?? drink.id }
  };
}

/** Action kinds that can spend a resource. */
const COSTED_KINDS = new Set<ActionDefinition["kind"]>([
  "attack", "save", "area-save", "healing", "reposition", "buff", "activate-feature", "multiattack", "utility", "summon"
]);

/**
 * The item with its pool settled under `itemId`: its supply named `item:<itemId>`, and every use that spent the old
 * name (a library entry's `"supply"`, a copied item's pool) spending the new one. A potion, a scroll or a flask always
 * has a stack (one, if it had none), and a use of one that spends nothing spends one of it. The same object when
 * nothing changes.
 */
export function withItemPool(item: ItemDefinition, itemId: Id = item.id): ItemDefinition {
  const consumable = isConsumableKind(item.kind);
  const supply = item.supply ?? (consumable ? { id: itemPoolId(itemId), size: 1, unit: "count" as const } : undefined);
  if (!supply) return item;
  const poolId = itemPoolId(itemId);
  let changed = supply !== item.supply || supply.id !== poolId;
  const grantedActions = item.grantedActions?.map((use) => {
    if (!COSTED_KINDS.has(use.kind)) return use;
    const cost = (use as { resourceCost?: { resourceId: string; amount: number } }).resourceCost;
    if (cost && cost.resourceId === supply.id && supply.id !== poolId) {
      changed = true;
      return { ...use, resourceCost: { ...cost, resourceId: poolId } } as ActionDefinition;
    }
    if (!cost && consumable) {
      changed = true;
      return { ...use, resourceCost: { resourceId: poolId, amount: 1 } } as ActionDefinition;
    }
    return use;
  });
  if (!changed) return item;
  return { ...item, supply: { ...supply, id: poolId }, ...(grantedActions ? { grantedActions } : {}) };
}
