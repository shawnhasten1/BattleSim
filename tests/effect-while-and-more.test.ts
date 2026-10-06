import { describe, expect, it } from "vitest";
import {
  createEngineState,
  effectGateHolds,
  effectiveDefinition,
  featureSources,
  findPath,
  getDefinition,
  movementOptionsFor,
  resolveAttack,
  sampleEncounter,
  sizeWith,
  speedWith,
  targetTypeMatches,
  type CombatantState,
  type CreatureDefinition,
  type FeatureEffect,
  type ItemDefinition
} from "@/engine";
import { findSrdFeature } from "@/data/srd";
import { effectSentence } from "@/lib/statblock";

/** EFFECTS_PLAN.md, Phase 4: "While" on every effect, damage reduction, difficult terrain, creature types, size. */

const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 2,
  abilities: { str: 16, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: [], ...overrides
});
const chain: ItemDefinition = { id: "chain", name: "Chain Mail", type: "armor", armor: { category: "heavy", ac: 16, strength: 13 }, automationSupport: "full" };
const trait = (name: string, effects: FeatureEffect[]) => ({ id: name, name, category: "feature" as const, effects, automationSupport: "full" as const });
const token = (conditions: CombatantState["conditions"] = []) => ({ conditions });

describe("While, on any effect", () => {
  it("leaves out an effect whose armor, shield or activation it lacks", () => {
    const shieldBonus: FeatureEffect = { kind: "save-bonus", bonus: { base: 1 }, shield: true };
    const raging: FeatureEffect = { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "fire" }, whileCondition: "rage-active" };
    const definition = creature({ features: [trait("Gated", [shieldBonus, raging])] });
    const effects = (combatant?: { conditions?: CombatantState["conditions"] }) => featureSources(definition, combatant as CombatantState).flatMap((source) => source.effects ?? []);
    expect(effects(token())).toEqual([]);
    expect(effects(token([{ id: "rage-active", name: "custom", startedRound: 1 }]))).toEqual([raging]);
    const shielded = creature({ items: [{ id: "s", name: "Shield", type: "shield", armor: { category: "shield", ac: 2 }, automationSupport: "full" }], features: [trait("Gated", [shieldBonus])] });
    expect(featureSources(shielded, token() as CombatantState).flatMap((source) => source.effects ?? [])).toEqual([shieldBonus]);
    expect(effectGateHolds(creature({ items: [chain] }), undefined, { kind: "evasion", armor: "none" })).toBe(false);
  });

  it("Defense: +1 AC only while it wears armor", () => {
    const acWith = (items: ItemDefinition[]) => {
      const snapshot = structuredClone(sampleEncounter);
      const defense = structuredClone(findSrdFeature("srd:feature:defense")!);
      snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-fighter" ? { ...entry, armorClass: 12, features: [defense], items } : entry));
      const { state, goblin, attack } = goblinNextToFighter(snapshot);
      return resolveAttack(state, goblin.id, "pc-fighter", attack).targetAc;
    };
    expect(acWith([])).toBe(12);
    expect(acWith([chain])).toBe(17);
  });

  it("says it in the sentence", () => {
    expect(effectSentence({ kind: "save-bonus", bonus: { base: 1 }, shield: true }, creature())).toBe("It gains a +1 bonus to saving throws while it holds a shield.");
    expect(effectSentence({ kind: "evasion", whileCondition: "rage-active" }, creature())).toMatch(/while it rages\.$/);
  });
});

/** The sample goblin next to the fighter, with its first attack. */
function goblinNextToFighter(snapshot: typeof sampleEncounter) {
  const state = createEngineState(snapshot);
  const fighter = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
  const goblin = state.snapshot.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
  goblin.position = { x: fighter.position.x + 1, y: fighter.position.y };
  const attack = getDefinition(state.snapshot, goblin).actions.find((action) => action.kind === "attack")!.id;
  return { state, goblin, attack };
}

describe("damage reduction", () => {
  it("takes its amount off a hit's damage of its types: the same seeded hit, with and without", () => {
    const reduction: FeatureEffect = { kind: "damage-reduction", amount: { base: 3 }, damageTypes: ["bludgeoning", "piercing", "slashing"], nonMagicalOnly: true };
    const dealt = (seed: number, features: CreatureDefinition["features"]) => {
      const snapshot = structuredClone(sampleEncounter);
      snapshot.seed = String(seed);
      snapshot.definitions = snapshot.definitions.map((entry) => (entry.id === "def-fighter" ? { ...entry, features } : entry));
      const { state, goblin, attack } = goblinNextToFighter(snapshot);
      const result = resolveAttack(state, goblin.id, "pc-fighter", attack);
      return { hit: result.hit, damage: result.damageApplied };
    };
    let compared = 0;
    for (let seed = 1; seed <= 40 && compared < 3; seed += 1) {
      const plain = dealt(seed, []);
      if (!plain.hit) continue;
      expect(dealt(seed, [trait("Heavy Armor Master", [reduction])]).damage).toBe(Math.max(0, plain.damage - 3));
      compared += 1;
    }
    expect(compared).toBe(3);
    expect(effectSentence(reduction, creature())).toBe("Bludgeoning, piercing, and slashing damage it takes from nonmagical attacks is reduced by 3.");
  });
});

describe("difficult terrain", () => {
  it("costs a creature that ignores it no extra movement", () => {
    const map = structuredClone(sampleEncounter.map);
    map.walls = [];
    map.terrain = [{ id: "mud", name: "Mud", type: "difficult", polygon: [{ x: 2, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 10 }, { x: 2, y: 10 }] }];
    const plain = creature();
    const free = creature({ features: [trait("Freedom of Movement", [{ kind: "ignore-difficult-terrain" }])] });
    const cost = (definition: CreatureDefinition) => findPath(map, { x: 0, y: 2 }, { x: 8, y: 2 }, 1, [], movementOptionsFor(effectiveDefinition(definition))).cost;
    expect(cost(plain)).toBe(12);
    expect(cost(free)).toBe(8);
  });
});

describe("creature types", () => {
  it("an attack's effect against some types only", () => {
    const bane: FeatureEffect = { kind: "damage-bonus", damage: [{ dice: "2d6", damageType: "radiant" }], targetTypes: ["undead", "fiend"] };
    expect(targetTypeMatches({ type: "undead" }, bane)).toBe(true);
    expect(targetTypeMatches({ type: "humanoid" }, bane)).toBe(false);
    expect(targetTypeMatches({}, bane)).toBe(false);
    expect(targetTypeMatches({ type: "humanoid" }, { kind: "damage-bonus", damage: [] })).toBe(true);
  });
});

describe("size and slower speeds", () => {
  it("a size, or so many larger or smaller", () => {
    expect(sizeWith("medium", [{ kind: "size", steps: 1 }])).toBe("large");
    expect(sizeWith("medium", [{ kind: "size", steps: -1 }])).toBe("small");
    expect(sizeWith("gargantuan", [{ kind: "size", steps: 1 }])).toBeUndefined();
    expect(sizeWith("medium", [{ kind: "size", to: "huge" }])).toBe("huge");
    expect(effectiveDefinition(creature({ traits: [trait("Enlarged", [{ kind: "size", steps: 1 }])] })).size).toBe("large");
    expect(effectSentence({ kind: "size", steps: 1 }, creature())).toBe("It is one size larger.");
  });

  it("halved, or none at all, after any bonus", () => {
    const sources = (...effects: Array<Extract<FeatureEffect, { kind: "speed" }>>) => effects.map((effect, index) => ({ label: `S${index}`, effect }));
    expect(speedWith(creature(), sources({ kind: "speed", multiplier: 0.5 })).movement.walk).toBe(15);
    expect(speedWith(creature(), sources({ kind: "speed", multiplier: 2 }, { kind: "speed", multiplier: 0.5 })).movement.walk).toBe(30);
    expect(speedWith(creature(), sources({ kind: "speed", multiplier: 0 })).movement.walk).toBe(0);
  });
});
