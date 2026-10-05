import { describe, expect, it } from "vitest";
import {
  armoredAc,
  createEngineState,
  damageAdjustmentsFor,
  dangerBeforeNextTurn,
  movementProfileOf,
  normalizeItemDefinition,
  resolveAttack,
  sampleEncounter,
  type ActionDefinition,
  type ArmorStats,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type ItemDefinition
} from "@/engine";

/** ARMOR_PLAN.md Phase 0: worn armor sets the AC (D1), and what else armor does in a fight. */

const armor = (name: string, stats: ArmorStats, extra: Partial<ItemDefinition> = {}): ItemDefinition => ({
  id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, type: stats.category === "shield" ? "shield" : "armor", armor: stats, automationSupport: "full", ...extra
});
const LEATHER = armor("Leather Armor", { category: "light", ac: 11 });
const CHAIN_SHIRT = armor("Chain Shirt", { category: "medium", ac: 13 });
const PLATE = armor("Plate Armor", { category: "heavy", ac: 18, strength: 15, stealthDisadvantage: true });
const SHIELD = armor("Shield", { category: "shield", ac: 2 });

function creature(dex: number, items: ItemDefinition[], overrides: Partial<CreatureDefinition> = {}): CreatureDefinition {
  return {
    id: "def-kael", name: "Kael", size: "medium", type: "humanoid", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
    abilities: { str: 16, dex, con: 14, int: 10, wis: 10, cha: 10 }, actions: [], items, ...overrides
  };
}
const ac = (dex: number, items: ItemDefinition[], overrides?: Partial<CreatureDefinition>) => armoredAc(creature(dex, items, overrides));

describe("the AC armor gives", () => {
  it("is the typed AC without armor", () => {
    expect(ac(14, [])).toEqual({ total: 12, parts: [{ label: "without armor", value: 12 }] });
  });

  it("adds all of Dexterity to light armor, up to +2 to medium, none to heavy", () => {
    expect(ac(16, [LEATHER])).toMatchObject({ total: 14, parts: [{ label: "Leather Armor", value: 11 }, { label: "Dex", value: 3 }] });
    expect(ac(18, [CHAIN_SHIRT]).total).toBe(15);
    expect(ac(14, [PLATE])).toMatchObject({ total: 18, parts: [{ label: "Plate Armor", value: 18 }] });
    // A low Dexterity costs light and medium armor.
    expect(ac(8, [LEATHER]).total).toBe(10);
    expect(ac(8, [CHAIN_SHIRT]).total).toBe(12);
  });

  it("adds a worn shield, over armor or over the typed AC", () => {
    expect(ac(14, [SHIELD])).toMatchObject({ total: 14, parts: [{ label: "without armor", value: 12 }, { label: "Shield", value: 2 }] });
    expect(ac(14, [PLATE, SHIELD]).total).toBe(20);
  });

  it("adds magic armor's and a magic shield's bonus, only while attuned when they need it", () => {
    const plus1 = { ...PLATE, armor: { ...PLATE.armor!, magicBonus: 1 } };
    const shield2 = { ...SHIELD, armor: { ...SHIELD.armor!, magicBonus: 2 } };
    expect(ac(14, [plus1, shield2]).total).toBe(23);
    // Unattuned, it's still plate: the base counts, the magic doesn't.
    expect(ac(14, [{ ...plus1, attunement: { attuned: false } }]).total).toBe(18);
  });

  it("counts only worn armor, and only the best suit and the best shield", () => {
    expect(ac(14, [{ ...PLATE, equipped: false }]).total).toBe(12);
    expect(ac(16, [LEATHER, CHAIN_SHIRT]).armor?.name).toBe("Chain Shirt");
    expect(ac(14, [SHIELD, { ...SHIELD, id: "shield-2", name: "Shield +1", armor: { ...SHIELD.armor!, magicBonus: 1 } }]).shield?.name).toBe("Shield +1");
  });

  it("takes its own Dexterity cap over its weight's", () => {
    expect(ac(18, [{ ...CHAIN_SHIRT, armor: { ...CHAIN_SHIRT.armor!, maxDex: 3 } }]).total).toBe(16);
  });
});

describe("armor in a fight", () => {
  const ORC_AXE: ActionDefinition = {
    kind: "attack", id: "greataxe", name: "Greataxe", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5,
    range: 5, reach: 5, damage: [{ dice: "1d12+3", damageType: "slashing" }], automationSupport: "full"
  };

  function scene(items: ItemDefinition[], seed = "armor"): EncounterSnapshot {
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = seed;
    encounter.map.walls = [];
    encounter.definitions = [creature(14, items), { ...creature(10, []), id: "def-orc", name: "Orc", items: undefined, actions: [ORC_AXE] }];
    const token = (id: string, definitionId: string, faction: "party" | "enemy", x: number): CombatantState => ({
      id, definitionId, displayName: id, faction, position: { x, y: 3 }, currentHp: 30, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
    });
    encounter.combatants = [token("kael", "def-kael", "party", 3), token("orc", "def-orc", "enemy", 4)];
    return encounter;
  }

  it("is the AC an attack rolls against, with what else adds to it (a ring)", () => {
    const ring: ItemDefinition = { id: "ring", name: "Ring of Protection", type: "worn", effects: [{ kind: "armor-class-bonus", bonus: { base: 1 } }], automationSupport: "full" };
    const state = createEngineState(scene([PLATE, SHIELD, ring]));
    resolveAttack(state, "orc", "kael", "greataxe");
    expect(state.log.find((entry) => entry.type === "AttackRolled")?.data?.targetAc).toBe(21);
  });

  it("is the AC the AI weighs its chance to hit against", () => {
    const encounter = scene([PLATE, SHIELD]);
    // +5 against AC 20: 30% to hit.
    expect(dangerBeforeNextTurn(encounter, encounter.combatants[0]!).hits[0]?.chance).toBeCloseTo(0.3, 5);
  });

  it("too heavy for its wearer slows it 10 ft; carried, or strong enough, it doesn't", () => {
    expect(movementProfileOf(creature(14, [PLATE], { abilities: { str: 13, dex: 14, con: 14, int: 10, wis: 10, cha: 10 } })).walk).toBe(20);
    expect(movementProfileOf(creature(14, [PLATE], { abilities: { str: 15, dex: 14, con: 14, int: 10, wis: 10, cha: 10 } })).walk).toBe(30);
    expect(movementProfileOf(creature(14, [{ ...PLATE, equipped: false }], { abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 10 } })).walk).toBe(30);
  });

  it("adamantine turns a critical hit into a normal hit, and says so", () => {
    const adamantine = { ...PLATE, name: "Adamantine Plate", effects: [{ kind: "no-critical-hits" as const }] };
    // A seed where the orc rolls a natural 20 against plain plate.
    const seed = Array.from({ length: 400 }, (_, index) => `crit-${index}`).find((candidate) => {
      const state = createEngineState(scene([PLATE], candidate));
      resolveAttack(state, "orc", "kael", "greataxe");
      return state.log.find((entry) => entry.type === "AttackRolled")?.data?.critical === true;
    })!;
    expect(seed).toBeDefined();
    const state = createEngineState(scene([adamantine], seed));
    resolveAttack(state, "orc", "kael", "greataxe");
    const roll = state.log.find((entry) => entry.type === "AttackRolled")!;
    expect(roll.data).toMatchObject({ attackRoll: { total: 20 }, hit: true, critical: false, criticalNegatedBy: "Adamantine Plate" });
  });

  it("works only while worn: carried armor's resistance doesn't", () => {
    const resists = { ...PLATE, effects: [{ kind: "damage-adjustment" as const, adjustment: { type: "resistance" as const, damageType: "fire" as const } }] };
    const worn = createEngineState(scene([resists]));
    const carried = createEngineState(scene([{ ...resists, equipped: false }]));
    expect(damageAdjustmentsFor(worn.snapshot.definitions[0]!, worn.snapshot.combatants[0]!).map((adjustment) => adjustment.damageType)).toContain("fire");
    expect(damageAdjustmentsFor(carried.snapshot.definitions[0]!, carried.snapshot.combatants[0]!).map((adjustment) => adjustment.damageType)).not.toContain("fire");
  });
});

describe("armor as saved", () => {
  it("is normalized whole: a shield is a shield, its numbers whole, a carried one kept carried", () => {
    expect(normalizeItemDefinition({ id: "s", name: "Shield", type: "shield", armor: { category: "heavy", ac: 2.5 }, equipped: false, automationSupport: "full" }))
      .toMatchObject({ type: "shield", armor: { category: "shield", ac: 2 }, equipped: false });
    expect(normalizeItemDefinition({ id: "a", name: "Mystery", type: "armor", automationSupport: "full" }).armor).toEqual({ category: "light", ac: 11 });
    expect(normalizeItemDefinition({ id: "p", name: "Plate", type: "armor", armor: { category: "heavy", ac: 18, strength: 15, stealthDisadvantage: true }, equipped: true, automationSupport: "full" }))
      .toMatchObject({ armor: { category: "heavy", ac: 18, strength: 15, stealthDisadvantage: true }, equipped: undefined });
  });
});
