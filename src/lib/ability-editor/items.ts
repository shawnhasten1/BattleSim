/**
 * The item editor's model (ITEMS_PLAN.md §4): what changing an item's type, its stack or charges, and what drinking or
 * giving a potion takes does to the record, and what "Add" offers as a new use. Pure: the item sections show it, tests
 * read it.
 */
import {
  fullHealing,
  healsMoreInFull,
  isConsumableType,
  isDrinkUse,
  type ActionDefinition,
  type ArmorStats,
  type HealingActionDefinition,
  type ItemDefinition,
  type ItemSupply,
  type ItemType,
  type ResourceCost
} from "@/engine";
import { blankAttack, blankBuff, blankHeal, blankSpecialAction } from "./templates";

/** The slot drinking a potion takes: its first drink's (an action, when it has none yet). */
/** Armor or a shield worn (only worn armor counts toward AC) or carried: Standard's Worn switch and the Codex's orb. */
export function withWorn(item: ItemDefinition, worn: boolean): ItemDefinition {
  const { equipped: _equipped, ...rest } = item;
  return worn ? rest : { ...rest, equipped: false };
}

/** An item that needs attunement, attuned or not (until it's attuned, it does nothing): the editor's box and the Codex's pill. */
export function withAttuned(item: ItemDefinition, attuned: boolean): ItemDefinition {
  return { ...item, attunement: { attuned } };
}

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

const SLOT_PHRASE = { action: "an action", bonus: "a bonus action" } as const;

/** What its first rolled healing drink comes to in full ("2d4 + 2": 10), or undefined when it heals nothing rolled. */
export function fullHealAmount(item: ItemDefinition): number | undefined {
  const drink = item.grantedActions?.find((use): use is HealingActionDefinition => isDrinkUse(use) && use.kind === "healing" && healsMoreInFull(use));
  return drink ? fullHealing(drink) : undefined;
}

/** Whether drinking or giving it takes a bonus action: what an action instead can be traded for. */
export function hasBonusUse(item: ItemDefinition): boolean {
  return drinkTiming(item) === "bonus" || giveTiming(item) === "bonus";
}

/** Whether it heals in full when it's used with an action where a bonus action would do (the copies the engine adds). */
export function healsInFullWithAction(item: ItemDefinition): boolean {
  return item.fullWithAction === true && hasBonusUse(item) && fullHealAmount(item) !== undefined;
}

/**
 * What using a potion takes, in words, as it stands: "Drinking it or giving it to a creature within 5 ft takes a bonus
 * action. An action instead heals the full 10 HP."
 */
export function potionTimingText(item: ItemDefinition): string {
  const drink = drinkTiming(item);
  const give = giveTiming(item);
  const first = give === "never"
    ? `Drinking it takes ${SLOT_PHRASE[drink]}; it can't be given.`
    : give === drink
      ? `Drinking it or giving it to a creature within 5 ft takes ${SLOT_PHRASE[drink]}.`
      : `Drinking it takes ${SLOT_PHRASE[drink]}, and giving it to a creature within 5 ft ${SLOT_PHRASE[give]}.`;
  return healsInFullWithAction(item) ? `${first} An action instead of a bonus action heals the full ${fullHealAmount(item)} HP.` : first;
}

/** Armor or a shield with some of its AC numbers changed (`undefined` clears one: its weight's Dexterity cap, no Strength needed). */
export function withArmor(item: ItemDefinition, patch: Partial<ArmorStats>): ItemDefinition {
  const current: ArmorStats = item.armor ?? (item.type === "shield" ? { category: "shield", ac: 2 } : { category: "light", ac: 11 });
  const next = { ...current, ...patch } as ArmorStats & Record<string, unknown>;
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
  return { ...item, armor: next };
}

/** The pool its uses spend: its supply's (`"supply"` on a new item until it's added, `item:<id>` after). */
export function supplyIdOf(item: ItemDefinition): string {
  return item.supply?.id ?? "supply";
}

const withoutRegains = ({ regains: _regains, ...supply }: ItemSupply): ItemSupply => supply;

/**
 * The item as another type. A potion can be given (for an action, until that's changed) and nothing else can. A wand's
 * stack becomes charges (7, back at dawn, when it had none); a potion's, a scroll's or a flask's charges become a stack
 * (one, when it had none). Armor starts as leather (AC 11, light) and a shield as +2, worn; neither is a stack. Worn
 * items and gear keep whatever they had.
 */
export function withItemType(item: ItemDefinition, type: ItemType): ItemDefinition {
  if (type === item.type) return item;
  const { give, followsTableRule, armor, equipped, ...rest } = item;
  let next: ItemDefinition = type === "potion"
    ? { ...rest, type, give: give ?? { actionType: "action" }, ...(followsTableRule === false ? { followsTableRule } : {}) }
    : { ...rest, type };
  if (type === "armor" || type === "shield") {
    const stats: ArmorStats = type === "shield" ? { category: "shield", ac: 2, ...(armor?.magicBonus ? { magicBonus: armor.magicBonus } : {}) }
      : armor && armor.category !== "shield" ? armor : { category: "light", ac: 11, ...(armor?.magicBonus ? { magicBonus: armor.magicBonus } : {}) };
    const { supply, ...unstacked } = next;
    next = { ...(supply?.unit === "charges" ? next : unstacked), armor: stats, ...(equipped === false ? { equipped } : {}) };
  }
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
