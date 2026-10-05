import type { ActionDefinition, ActionRider, SpellDefinition, SpellUpcast } from "@/engine";

/**
 * A spell as an item casts it (ITEMS_PLAN.md §7): a wand's Fireball, a scroll's Cure Wounds. The spell's own action,
 * at the item's numbers instead of its caster's (a wand's save DC 15, a scroll's DC and attack bonus by level), spending
 * the item's supply (`"supply"`, renamed `item:<id>` on attach). It's still a spell of its level, so a counterspeller
 * reads it right, and it keeps its concentration.
 */
export function itemSpellUse(
  spell: SpellDefinition,
  numbers: { dc?: number; attack?: number },
  options: { id: string; cost?: number; upcast?: SpellUpcast }
): ActionDefinition | undefined {
  if (!spell.action) return undefined;
  const action = structuredClone(spell.action) as ActionDefinition & Record<string, unknown>;
  action.id = options.id;
  action.name = spell.name;
  action.resourceCost = { resourceId: "supply", amount: options.cost ?? 1 };
  action.spellLevel = spell.level;
  const upcast = options.upcast ?? spell.upcast;
  if (upcast) action.upcast = upcast;
  else delete action.upcast;
  if (spell.concentration) action.concentration = true;
  if ((action.kind === "save" || action.kind === "area-save") && numbers.dc !== undefined) {
    delete action.dcFormula;
    action.dc = numbers.dc;
  }
  if (action.kind === "attack" && numbers.attack !== undefined && !action.autoHit) {
    delete action.attackBonusFormula;
    action.attackBonus = numbers.attack;
  }
  const riders = (action as { riders?: ActionRider[] }).riders;
  if (riders && numbers.dc !== undefined) {
    (action as { riders?: ActionRider[] }).riders = riders.map((rider) => withRiderDc(rider, numbers.dc!));
  }
  return action;
}

/** A rider's save at the item's DC, when it names one of its own. */
function withRiderDc(rider: ActionRider, dc: number): ActionRider {
  const save = "save" in rider ? (rider.save as { dc?: number; dcFormula?: unknown } | undefined) : undefined;
  if (!save || (save.dc === undefined && save.dcFormula === undefined)) return rider;
  const { dcFormula: _formula, ...rest } = save;
  return { ...rider, save: { ...rest, dc } } as ActionRider;
}
