import { describe, expect, it } from "vitest";
import { normalizeOpen5eItem, type Open5eImportedPayload } from "@/adapters";
import {
  armoredAc,
  compileItemUses,
  damageAdjustmentsFor,
  featureSources,
  movementProfileOf,
  sampleEncounter,
  withItemPool,
  type CreatureDefinition,
  type ItemDefinition
} from "@/engine";
import { findSrdItem } from "@/data/srd";

/** ARMOR_PLAN.md Phase 2: the SRD's armor and magic armor, and Open5e's armor. */

const srd = (slug: string) => structuredClone(findSrdItem(`srd:item:${slug}`)!) as ItemDefinition;

/** A creature with Dexterity 14 (+2), Strength 13 and an AC of 12 without armor, wearing `items`. */
function wearing(...items: ItemDefinition[]): CreatureDefinition {
  return {
    id: "def-kael", name: "Kael", size: "medium", type: "humanoid", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
    abilities: { str: 13, dex: 14, con: 14, int: 10, wis: 10, cha: 10 }, actions: [], items
  };
}

describe("the SRD's armor", () => {
  it("gives the AC its table says, Dexterity +2 added as its weight allows", () => {
    const table: Array<[string, number]> = [
      ["padded-armor", 13], ["leather-armor", 13], ["studded-leather-armor", 14],
      ["hide-armor", 14], ["chain-shirt", 15], ["scale-mail", 16], ["breastplate", 16], ["half-plate", 17],
      ["ring-mail", 14], ["chain-mail", 16], ["splint-armor", 17], ["plate-armor", 18]
    ];
    expect(table.map(([slug]) => [slug, armoredAc(wearing(srd(slug))).total])).toEqual(table);
    expect(armoredAc(wearing(srd("shield"))).total).toBe(14);
    expect(armoredAc(wearing(srd("plate-armor"), srd("shield"))).total).toBe(20);
  });

  it("slows a wearer below its Strength: chain mail asks 13, splint and plate 15; mithral asks nothing", () => {
    expect(movementProfileOf(wearing(srd("chain-mail"))).walk).toBe(30);
    expect(movementProfileOf(wearing(srd("plate-armor"))).walk).toBe(20);
    expect(movementProfileOf(wearing(srd("splint-armor"))).walk).toBe(20);
    expect(movementProfileOf(wearing(srd("mithral-chain-mail"))).walk).toBe(30);
    expect(srd("mithral-half-plate").armor?.stealthDisadvantage).toBeUndefined();
  });

  it("counts magic armor's and shields' bonuses", () => {
    expect(armoredAc(wearing(srd("shield-plus-3"))).total).toBe(17);
    expect(armoredAc(wearing(srd("elven-chain"))).total).toBe(16);
    expect(armoredAc(wearing(srd("glamoured-studded-leather"))).total).toBe(15);
    expect(armoredAc(wearing(srd("dwarven-plate"))).total).toBe(20);
    expect(armoredAc(wearing(srd("dragon-scale-mail"))).total).toBe(17);
  });

  it("gives adamantine plate its no-critical-hits, and the Spellguard Shield its advantage on saves against magic", () => {
    expect(featureSources(wearing(srd("adamantine-plate"))).flatMap((source) => source.effects ?? []).map((effect) => effect.kind)).toContain("no-critical-hits");
    expect(featureSources(wearing(srd("spellguard-shield"))).flatMap((source) => source.effects ?? [])).toContainEqual({ kind: "save-advantage", against: { source: "magical" } });
  });

  it("Armor of Invulnerability resists nonmagical damage, and once a day makes its wearer immune to it", () => {
    const armor = withItemPool(srd("armor-of-invulnerability"), "invulnerable");
    const definition = wearing(armor);
    const adjustments = damageAdjustmentsFor(definition, { ...sampleEncounter.combatants[0]!, conditions: [] });
    expect(adjustments).toContainEqual({ type: "resistance", damageType: "slashing", nonMagicalOnly: true });
    expect(armor.supply).toEqual({ id: "item:invulnerable", size: 1, unit: "charges", regains: "dawn" });
    const [use] = compileItemUses(armor);
    expect(use).toMatchObject({ kind: "buff", actionType: "action", resourceCost: { resourceId: "item:invulnerable", amount: 1 } });
  });

  it("Demon Armor's gauntlets are a magic claw attack, +1 to hit and damage", () => {
    const [claws] = compileItemUses(srd("demon-armor"));
    expect(claws).toMatchObject({
      kind: "attack", attackType: "melee", attackBonusFormula: { base: 1, ability: "str", proficiency: true },
      damage: [{ dice: "1d8+1", damageType: "slashing", magical: true }]
    });
  });
});

describe("Open5e's armor", () => {
  const payload = (raw: Record<string, unknown>, document = "srd-2014"): Open5eImportedPayload => ({
    provider: "open5e", resource: "item", slug: String(raw.key), key: String(raw.key), documentKey: document,
    importedAt: "2026-10-05T00:00:00.000Z", payloadVersion: "v2", raw: { ...raw, document: { key: document, name: "SRD" } }
  });

  it("is armor with its numbers, fully simulated when it's mundane", () => {
    const chain = normalizeOpen5eItem(payload({
      key: "srd_chain-mail", name: "Chain mail", category: { key: "armor", name: "Armor" },
      armor: { name: "Chain mail", category: "heavy", ac_base: 16, ac_add_dexmod: false, ac_cap_dexmod: null, grants_stealth_disadvantage: true, strength_score_required: 13 }
    }));
    expect(chain).toMatchObject({ type: "armor", automationSupport: "full", armor: { category: "heavy", ac: 16, strength: 13, stealthDisadvantage: true } });
    expect(chain.armor?.maxDex).toBeUndefined();
    const breastplate = normalizeOpen5eItem(payload({
      key: "srd-2024_breastplate", name: "Breastplate", category: { key: "armor" },
      armor: { category: "medium", ac_base: 14, ac_add_dexmod: true, ac_cap_dexmod: 2, grants_stealth_disadvantage: false, strength_score_required: null }
    }, "srd-2024"));
    expect(breastplate.armor).toEqual({ category: "medium", ac: 14 });
    expect(armoredAc(wearing(chain)).total).toBe(16);
  });

  it("tells a shield by its category or its name, whichever Open5e gives", () => {
    const old = normalizeOpen5eItem(payload({ key: "srd_shield", name: "Shield", category: { key: "shield", name: "Shield" }, armor: null }));
    const filedAsHeavy = normalizeOpen5eItem(payload({
      key: "srd-2024_shield", name: "Shield", category: { key: "armor" },
      armor: { name: "Shield", category: "heavy", ac_base: 2, ac_add_dexmod: false, ac_cap_dexmod: null, grants_stealth_disadvantage: false, strength_score_required: null }
    }, "srd-2024"));
    for (const shield of [old, filedAsHeavy]) expect(shield).toMatchObject({ type: "shield", armor: { category: "shield", ac: 2 }, automationSupport: "full" });
  });

  it("magic armor keeps its base, marked partial; armor with no numbers is only carried for reference, and sets no AC", () => {
    const magic = normalizeOpen5eItem(payload({
      key: "x_plate-plus-1", name: "Plate +1", category: { key: "armor" }, rarity: { key: "rare", name: "Rare" }, is_magic_item: true,
      armor: { category: "heavy", ac_base: 18, ac_add_dexmod: false, ac_cap_dexmod: null, grants_stealth_disadvantage: true, strength_score_required: 15 }
    }));
    expect(magic).toMatchObject({ type: "armor", automationSupport: "partial", notSimulated: expect.stringMatching(/its magic/) });
    const words = normalizeOpen5eItem(payload({ key: "x_odd-armor", name: "Armor of Odd Luck", category: { key: "armor" }, rarity: { key: "rare" } }));
    expect(words).toMatchObject({ type: "worn", automationSupport: "manual-only" });
    expect(armoredAc(wearing(words)).total).toBe(12);
    // Armor kept for reference only doesn't set the AC either.
    expect(armoredAc(wearing({ ...srd("plate-armor"), automationSupport: "manual-only" })).total).toBe(12);
  });
});
