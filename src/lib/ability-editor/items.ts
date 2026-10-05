/**
 * The item editor's model (ITEMS_PLAN.md §4): what changing an item's type, its stack or charges, and what drinking or
 * giving a potion takes does to the record, and what "Add" offers as a new use. Pure: the item sections show it, tests
 * read it.
 */
import { isConsumableType, isDrinkUse, type ActionDefinition, type ItemDefinition, type ItemSupply, type ItemType, type ResourceCost } from "@/engine";
import { blankAttack, blankBuff, blankHeal, blankSpecialAction } from "./templates";

/** The slot drinking a potion takes: its first drink's (an action, when it has none yet). */
export function drinkTiming(item: ItemDefinition): "action" | "bonus" {
  return item.grantedActions?.find(isDrinkUse)?.actionType === "bonus" ? "bonus" : "action";
}

/** The potion with every drink taking `slot`. */
export function withDrinkTiming(item: ItemDefinition, slot: "action" | "bonus"): ItemDefinition {
  if (!item.grantedActions?.some(isDrinkUse)) return item;
  return { ...item, grantedActions: item.grantedActions.map((use) => (isDrinkUse(use) ? ({ ...use, actionType: slot } as ActionDefinition) : use)) };
}

/** What giving the potion to a creature within 5 ft takes, or `"never"` when it can't be given. */
export function giveTiming(item: ItemDefinition): "action" | "bonus" | "never" {
  return item.give?.actionType ?? "never";
}

/** The potion given for `slot`, or not given at all. */
export function withGiveTiming(item: ItemDefinition, slot: "action" | "bonus" | "never"): ItemDefinition {
  const { give: _give, ...rest } = item;
  return slot === "never" ? rest : { ...rest, give: { actionType: slot } };
}

/** The pool its uses spend: its supply's (`"supply"` on a new item until it's added, `item:<id>` after). */
export function supplyIdOf(item: ItemDefinition): string {
  return item.supply?.id ?? "supply";
}

const withoutRegains = ({ regains: _regains, ...supply }: ItemSupply): ItemSupply => supply;

/**
 * The item as another type. A potion can be given (for an action, until that's changed) and nothing else can. A wand's
 * stack becomes charges (7, back at dawn, when it had none); a potion's, a scroll's or a flask's charges become a stack
 * (one, when it had none). Worn items and gear keep whatever they had.
 */
export function withItemType(item: ItemDefinition, type: ItemType): ItemDefinition {
  if (type === item.type) return item;
  const { give, followsTableRule, ...rest } = item;
  let next: ItemDefinition = type === "potion"
    ? { ...rest, type, give: give ?? { actionType: "action" }, ...(followsTableRule === false ? { followsTableRule } : {}) }
    : { ...rest, type };
  if (type === "wand") {
    next = { ...next, supply: item.supply ? { ...item.supply, unit: "charges", regains: item.supply.regains ?? "dawn" } : { id: supplyIdOf(item), size: 7, unit: "charges", regains: "dawn" } };
  } else if (isConsumableType(type)) {
    next = { ...next, supply: item.supply ? { ...withoutRegains(item.supply), unit: "count" } : { id: supplyIdOf(item), size: 1, unit: "count" } };
  }
  return next;
}

/** The item with its stack or charges set (`undefined`: it has none, so its uses are at will). */
export function withSupply(item: ItemDefinition, supply: ItemSupply | undefined): ItemDefinition {
  const { supply: _supply, ...rest } = item;
  return supply ? { ...rest, supply } : rest;
}

/** One thing "Add what using it does" offers. */
export interface ItemUseChoice {
  label: string;
  hint: string;
  make: () => ActionDefinition;
}

/**
 * What a new use of the item can be: a potion's is drunk (a heal or a benefit), a flask's is thrown, anything else's an
 * attack, a save or area, a heal or a benefit. Each spends one of the stack or a charge; an item without either is used
 * at will. A potion's use is named after it, so the log reads "Kael drinks a Potion of Healing".
 */
export function itemUseChoices(item: ItemDefinition): ItemUseChoice[] {
  const cost: ResourceCost | undefined = item.supply ? { resourceId: supplyIdOf(item), amount: 1 } : undefined;
  const costed = <A extends ActionDefinition>(action: A): A => (cost ? { ...action, resourceCost: cost } : action);
  if (item.type === "potion") {
    const slot = drinkTiming(item);
    const named = item.name || "Potion";
    return [
      {
        label: "A heal", hint: "The drinker regains hit points",
        make: () => costed({ ...blankHeal(), name: named, actionType: slot, healing: [{ dice: "2d4+2", diceCount: 2, diceSize: 4, flatBonus: 2 }] })
      },
      {
        label: "A benefit", hint: "The drinker gains temporary hit points, a bonus or a resistance for a while",
        make: () => costed({ ...blankBuff(), name: named, actionType: slot, appliedCondition: { name: "custom", durationRounds: 600 } })
      }
    ];
  }
  if (item.type === "thrown") {
    return [{
      label: "A thrown attack", hint: "A ranged attack, 20/60 ft, with no proficiency",
      make: () => costed({
        ...blankAttack(), name: item.name || "Flask", attackType: "ranged", ability: "dex", attackBonusFormula: { ability: "dex" },
        range: 20, longRange: 60, reach: undefined, damage: [{ dice: "2d6", damageType: "acid", diceCount: 2, diceSize: 6 }]
      })
    }];
  }
  return [
    {
      label: "An attack", hint: "A ray or a bolt: a spell attack",
      make: () => costed({
        ...blankAttack(), name: "Bolt", attackType: "spell", ability: "int", range: 120, reach: undefined,
        damage: [{ dice: "2d8", damageType: "fire", diceCount: 2, diceSize: 8 }]
      })
    },
    { label: "A saving throw or area", hint: "A blast, a web, a burst", make: () => costed(blankSpecialAction()) },
    { label: "A heal", hint: "Regains hit points: itself, or a creature it touches", make: () => costed({ ...blankHeal(), actionType: "action" }) },
    { label: "A benefit", hint: "Gives itself something for a while", make: () => costed({ ...blankBuff(), actionType: "action" }) }
  ];
}
