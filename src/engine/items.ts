import { parseDiceExpression } from "./dice";
import type {
  ActionDefinition,
  BuffActionDefinition,
  CreatureDefinition,
  EncounterSnapshot,
  HealingActionDefinition,
  HealingComponent,
  Id,
  ItemDefinition,
  ItemType,
  ItemUseMeta,
  PotionUse,
  ResourceCost,
  RuleProfile
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

/** "a Potion of Healing", "an Elixir of Health": an item named the way the log says it. */
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/** How long a potion's benefit must last for it to be drunk before a fight starts: 10 minutes. */
export const PREP_DRINK_ROUNDS = 100;

/** A buff potion whose benefit outlasts a fight (Heroism, Resistance): drunk before it starts, like a prep spell. */
export function isPrepDrink(action: ActionDefinition): action is BuffActionDefinition {
  return action.kind === "buff" && action.item?.use === "drink" && (action.appliedCondition.durationRounds ?? Number.POSITIVE_INFINITY) >= PREP_DRINK_ROUNDS;
}

/** A potion's give copy carries this suffix on its drink's id: `<drink id>:give`. */
export const GIVE_SUFFIX = ":give";

/** An action copy that heals in full carries this suffix: `<drink id>:full`, `<drink id>:give:full`. */
export const FULL_SUFFIX = ":full";

/** A use cast a level higher for extra charges carries this suffix with what it spends: `<use id>:charges-3`. */
export const CHARGES_SUFFIX = ":charges-";

/** Items used up one at a time: each use spends one of the stack. */
export function isConsumableType(type: ItemType): boolean {
  return type === "potion" || type === "scroll" || type === "thrown";
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
  const potion = item.type === "potion";
  const meta: ItemUseMeta = { id: item.id, name: item.name, type: item.type, consumes: item.supply?.unit === "count" };
  const uses = (item.grantedActions ?? []).map((use) => ({
    ...use,
    item: potion && isDrinkUse(use) ? { ...meta, use: "drink" as const } : meta
  } as ActionDefinition));
  const give = potion ? item.give : undefined;
  const gives = give ? uses.filter(isDrinkUse).map((drink) => giveCopy(drink, give.actionType)) : [];
  const tiers = item.supply ? uses.flatMap((use) => chargeTiers(use, item.supply!.size)) : [];
  const all = [...uses, ...gives, ...tiers];
  // With an action where a bonus action would do, a heal is its full amount: an action copy of each bonus-action heal.
  if (!item.fullWithAction) return all;
  return [...all, ...all.flatMap((use) => (use.kind === "healing" && use.actionType === "bonus" && healsMoreInFull(use) ? [fullCopy(use)] : []))];
}

/**
 * A wand's use cast a level higher for each extra charge (`upcast.byCharges`): a copy for each charge count it could
 * spend, up to every charge the item holds and no higher than 9th level. Each grows as a higher slot would grow it (its
 * first damage or healing dice, its darts) and is that level of spell, so a counterspeller reads it right.
 */
function chargeTiers(use: ActionDefinition, size: number): ActionDefinition[] {
  const upcast = "upcast" in use ? use.upcast : undefined;
  const level = "spellLevel" in use ? use.spellLevel : undefined;
  const cost = "resourceCost" in use ? use.resourceCost : undefined;
  if (!upcast?.byCharges || level == null || !cost) return [];
  const tiers: ActionDefinition[] = [];
  for (let extra = 1; cost.amount + extra <= size && level + extra <= 9; extra += 1) {
    tiers.push(raisedBy(use, extra, level, cost.amount));
  }
  return tiers;
}

function raisedBy(use: ActionDefinition, extra: number, level: number, amount: number): ActionDefinition {
  const per = "upcast" in use ? use.upcast?.perSlotAboveBase : undefined;
  const { byCharges: _byCharges, ...upcast } = ("upcast" in use ? use.upcast : undefined) ?? {};
  const copy = {
    ...use,
    id: `${use.id}${CHARGES_SUFFIX}${amount + extra}`,
    resourceCost: { ...(use as { resourceCost: ResourceCost }).resourceCost, amount: amount + extra },
    spellLevel: level + extra,
    upcast
  } as ActionDefinition;
  const grow = <C extends { dice: string; diceCount?: number; diceSize?: number; flatBonus?: number }>(components: C[]): C[] => {
    if (!per?.damageDice || !components.length) return components;
    const { diceCount: _count, diceSize: _size, flatBonus: _flat, ...first } = components[0]!;
    return [{ ...first, dice: grownDice(first.dice, per.damageDice, extra) } as C, ...components.slice(1)];
  };
  if (copy.kind === "attack" || copy.kind === "save" || copy.kind === "area-save") copy.damage = grow(copy.damage);
  if (copy.kind === "healing") copy.healing = grow(copy.healing);
  if (copy.kind === "attack" && per?.beams && copy.attackDelivery === "beams") copy.beamCount = (copy.beamCount ?? 1) + per.beams * extra;
  return copy;
}

/** `base` with `per` added `times` over, like dice merged: "8d6" with "1d6" twice is "10d6". */
export function grownDice(base: string, per: string, times: number): string {
  const counts = new Map<number, number>();
  let modifier = 0;
  const add = (dice: string, by: number) => {
    const parsed = parseDiceExpression(dice);
    for (const term of parsed.terms) {
      const key = term.sign * term.sides;
      counts.set(key, (counts.get(key) ?? 0) + term.count * by);
    }
    modifier += parsed.modifier * by;
  };
  add(base, 1);
  add(per, times);
  const terms = [...counts].map(([key, count]) => `${key < 0 ? "-" : "+"}${count}d${Math.abs(key)}`).join("");
  return `${terms}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`.replace(/^\+/, "");
}

/** The most a dice expression can come to: "2d4+2" is 10. */
export function maxOfDice(dice: string): number {
  const parsed = parseDiceExpression(dice);
  return parsed.terms.reduce((sum, term) => sum + (term.sign > 0 ? term.count * term.sides : -term.count), 0) + parsed.modifier;
}

/** Whether healing in full is more than rolling: a heal with dice in it. */
export function healsMoreInFull(use: HealingActionDefinition): boolean {
  return use.healing.some((component) => parseDiceExpression(component.dice).terms.length > 0);
}

/** What a heal comes to in full, before any ability modifier: "2d4+2" is 10. */
export function fullHealing(use: HealingActionDefinition): number {
  return use.healing.reduce((sum, component) => sum + maxOfDice(component.dice), 0);
}

/** A healing component at its maximum: a flat number, its ability modifier (if any) still added. */
function inFull(component: HealingComponent): HealingComponent {
  return { dice: String(maxOfDice(component.dice)), ...(component.abilityModifier ? { abilityModifier: component.abilityModifier } : {}) };
}

function fullCopy(use: HealingActionDefinition): ActionDefinition {
  return {
    ...use,
    id: `${use.id}${FULL_SUFFIX}`,
    actionType: "action",
    healing: use.healing.map(inFull),
    item: { ...(use as ActionDefinition).item!, full: true }
  } as ActionDefinition;
}

/** What drinking and giving a potion take under a table's potion rule. */
export function potionTimings(rule: PotionUse | undefined): { drink: "action" | "bonus"; give: "action" | "bonus" } {
  if (rule === "bonus") return { drink: "bonus", give: "bonus" };
  if (rule === "drink-bonus") return { drink: "bonus", give: "action" };
  return { drink: "action", give: "action" };
}

/**
 * A potion with the table's rules written into it, unless it keeps its own timing (`followsTableRule: false`): what
 * drinking it takes, what giving it takes (when it can be given), and whether an action instead heals in full (only
 * where a bonus action would do). The same object when it already says so.
 */
export function withTableRule(item: ItemDefinition, rules: Pick<RuleProfile, "potionUse" | "potionActionHealsFull">): ItemDefinition {
  if (item.type !== "potion" || item.followsTableRule === false) return item;
  const timings = potionTimings(rules.potionUse);
  let changed = false;
  const grantedActions = item.grantedActions?.map((use) => {
    if (!isDrinkUse(use) || use.actionType === timings.drink) return use;
    changed = true;
    return { ...use, actionType: timings.drink } as ActionDefinition;
  });
  const give = item.give && item.give.actionType !== timings.give ? { actionType: timings.give } : item.give;
  if (give !== item.give) changed = true;
  const bonusOption = timings.drink === "bonus" || (Boolean(give) && timings.give === "bonus");
  const full = Boolean(rules.potionActionHealsFull) && bonusOption;
  if (full !== Boolean(item.fullWithAction)) changed = true;
  if (!changed) return item;
  const { fullWithAction: _full, ...rest } = item;
  return { ...rest, ...(grantedActions ? { grantedActions } : {}), ...(give ? { give } : {}), ...(full ? { fullWithAction: true } : {}) };
}

/**
 * The encounter with its table's potion rules (`snapshot.rules`) written into every potion that follows them: the
 * engine reads only what a potion says, so a run, a saved run and an exported encounter carry the timing they were
 * played with. The same objects all the way down when nothing changes.
 */
export function withItemRules(snapshot: EncounterSnapshot): EncounterSnapshot {
  let changed = false;
  const definitions = snapshot.definitions.map((definition) => {
    if (!definition.items?.length) return definition;
    const items = definition.items.map((item) => withTableRule(item, snapshot.rules));
    if (items.every((item, index) => item === definition.items![index])) return definition;
    changed = true;
    return { ...definition, items };
  });
  return changed ? { ...snapshot, definitions } : snapshot;
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
  const consumable = isConsumableType(item.type);
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
