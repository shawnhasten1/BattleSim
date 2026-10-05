import { abilityModifier } from "./dice";
import type { Ability, ArmorCategory, ArmorStats, CreatureDefinition, ItemDefinition } from "./types";

/**
 * Armor and shields (ARMOR_PLAN.md): what a creature's worn armor makes its AC. Worn body armor's base AC, plus its
 * Dexterity (all of it for light armor, at most +2 for medium, none for heavy), plus its magic bonus, replaces the AC
 * typed on the sheet, which is the AC without armor (natural armor, Unarmored Defense). A worn shield adds its bonus
 * either way. Features, auras and conditions add to this (`effectiveArmorClass`).
 */

/** The most Dexterity a weight of armor adds: all of it (light), +2 (medium), none (heavy). */
export const DEX_CAP: Record<Exclude<ArmorCategory, "shield">, number | undefined> = { light: undefined, medium: 2, heavy: 0 };

/** Armor or a shield, with what it does for AC. */
export type ArmorItem = ItemDefinition & { armor: ArmorStats };

export function isArmorItem(item: ItemDefinition): item is ArmorItem {
  return (item.type === "armor" || item.type === "shield") && Boolean(item.armor);
}

/** Whether the simulator runs it: armor kept for reference only (its text, applied by hand) doesn't set the AC. */
const simulated = (item: ItemDefinition) => item.automationSupport !== "manual-only" && item.automationSupport !== "unsupported";

/** Whether armor or a shield is worn: it can be carried without being worn (`equipped: false`). Anything else is "worn". */
export function isWorn(item: ItemDefinition): boolean {
  return item.equipped !== false;
}

/** Whether an item's magic works: it needs no attunement, or it's attuned. Armor gives its base AC either way. */
const magicWorks = (item: ItemDefinition) => !item.attunement || item.attunement.attuned;

/** The most Dexterity this armor adds (undefined: all of it). */
export function dexCapOf(stats: ArmorStats): number | undefined {
  if (stats.category === "shield") return 0;
  return stats.maxDex ?? DEX_CAP[stats.category];
}

export interface ArmoredAc {
  total: number;
  /** The sum, as the sheet says it: "Chain Mail 16", "Shield 2"; or "without armor 15" with no suit worn. */
  parts: Array<{ label: string; value: number }>;
  /** The worn suit and shield that count, when there are any. */
  armor?: ArmorItem;
  shield?: ArmorItem;
  /** Without a suit: what worked out its AC when it beat the typed AC ("Unarmored Defense", "Mage Armor"). */
  formula?: string;
}

/** An AC without armor worked out from abilities (`unarmored-ac`): Unarmored Defense, Mage Armor. */
export interface UnarmoredFormula {
  /** What it comes from: the feature, item or spell. */
  label: string;
  base: number;
  abilities: Ability[];
  /** Only while no shield is worn either. */
  noShield?: boolean;
}

/** What one worn suit makes the AC: its base and magic, and the Dexterity it adds. */
function suitParts(item: ArmorItem, dex: number): Array<{ label: string; value: number }> {
  const cap = dexCapOf(item.armor);
  const added = cap === undefined ? dex : Math.min(dex, cap);
  const magic = magicWorks(item) ? item.armor.magicBonus ?? 0 : 0;
  return [
    { label: item.name, value: item.armor.ac + magic },
    ...(added !== 0 ? [{ label: "Dex", value: added }] : [])
  ];
}

/**
 * The AC a creature's armor gives it: its best worn suit's (base, Dexterity up to the suit's cap, magic), or without
 * one the best of its typed AC and `formulas` (Unarmored Defense, Mage Armor); plus its best worn shield's bonus and
 * magic. Only one suit and one shield count (D7). A creature that wears nothing and has no formula has exactly its
 * typed AC. `armorClassOf` (combat) gathers the formulas from its features, items and conditions.
 */
export function armoredAc(definition: Pick<CreatureDefinition, "armorClass" | "abilities" | "items">, formulas: UnarmoredFormula[] = []): ArmoredAc {
  const worn = (definition.items ?? []).filter((item): item is ArmorItem => isArmorItem(item) && isWorn(item) && simulated(item));
  if (!worn.length && !formulas.length) return { total: definition.armorClass, parts: [{ label: "without armor", value: definition.armorClass }] };
  const dex = abilityModifier(definition.abilities.dex);
  const sum = (parts: Array<{ value: number }>) => parts.reduce((total, part) => total + part.value, 0);
  const suits = worn.filter((item) => item.armor.category !== "shield")
    .map((item) => ({ item, parts: suitParts(item, dex) }))
    .sort((a, b) => sum(b.parts) - sum(a.parts));
  const shields = worn.filter((item) => item.armor.category === "shield")
    .map((item) => ({ item, value: item.armor.ac + (magicWorks(item) ? item.armor.magicBonus ?? 0 : 0) }))
    .sort((a, b) => b.value - a.value);
  const suit = suits[0];
  const shield = shields[0];
  // Without a suit: the best of the typed AC and what works it out from abilities (a monk's only without a shield).
  const unarmored = formulas.filter((formula) => !(formula.noShield && shield))
    .map((formula) => ({ label: formula.label, value: formula.base + formula.abilities.reduce((total, ability) => total + abilityModifier(definition.abilities[ability]), 0) }))
    .sort((a, b) => b.value - a.value)[0];
  const best = unarmored && unarmored.value > definition.armorClass ? unarmored : undefined;
  const parts = [
    ...(suit ? suit.parts : [best ?? { label: "without armor", value: definition.armorClass }]),
    ...(shield ? [{ label: shield.item.name, value: shield.value }] : [])
  ];
  return {
    total: sum(parts), parts,
    ...(suit ? { armor: suit.item } : {}), ...(shield ? { shield: shield.item } : {}), ...(!suit && best ? { formula: best.label } : {})
  };
}

/** Whether the creature wears armor too heavy for it: below its Strength requirement, it's 10 ft slower. */
export function slowedByArmor(definition: Partial<Pick<CreatureDefinition, "abilities" | "items">>): boolean {
  const strength = definition.abilities?.str;
  if (strength === undefined) return false;
  return (definition.items ?? []).some((item) => isArmorItem(item) && isWorn(item) && simulated(item) && item.armor.category !== "shield"
    && item.armor.strength !== undefined && strength < item.armor.strength);
}
