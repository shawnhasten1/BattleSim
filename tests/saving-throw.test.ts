import { describe, expect, it } from "vitest";
import {
  createEngineState, resolveAttack, rollSavingThrow, runRepeatedSaves, sampleEncounter,
  type CombatantState, type CreatureDefinition, type EncounterSnapshot, type FeatureDefinition
} from "@/engine";

/**
 * Every saving throw goes through `rollSavingThrow`. Two kinds used to skip the target's feature bonuses and
 * advantage (a rider's own save, and a repeated save at turn start/end), so an Aura of Protection or a Magic
 * Resistance-style effect silently didn't apply to a Hold Person-style save. A huge flat bonus makes the outcome
 * deterministic: with it the target always passes, without it (DC 25 vs a low modifier) it always fails.
 */
const base = sampleEncounter;
const fighter = base.definitions.find((definition) => definition.id === "def-fighter")!;

const ward: FeatureDefinition = {
  id: "ward", name: "Big Ward", category: "feature", automationSupport: "full",
  effects: [{ kind: "save-bonus", bonus: { base: 30 } }]
};

function target(withWard: boolean): CreatureDefinition {
  return { ...fighter, id: "def-target", name: "Target", armorClass: 1, abilities: { ...fighter.abilities, wis: 8 }, features: withWard ? [ward] : [] };
}

const frightener: CreatureDefinition = {
  id: "def-frightener", name: "Frightener", size: "medium", armorClass: 10, maxHp: 30, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [{
    kind: "attack", id: "gaze", name: "Gaze", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5,
    damage: [{ dice: "1", damageType: "psychic" }],
    riders: [{ kind: "condition", when: "on-hit", condition: "frightened", duration: { kind: "rounds", rounds: 3 }, save: { ability: "wis", dc: 25, onSuccess: "negates" } }],
    automationSupport: "full"
  }]
};

function scene(targetDef: CreatureDefinition, seed: string): EncounterSnapshot {
  const combatant = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  return { ...structuredClone(base), seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [targetDef, frightener], combatants: [combatant("target", targetDef, "party", 4), combatant("gazer", frightener, "enemy", 5)] };
}

const isFrightened = (state: ReturnType<typeof createEngineState>) =>
  state.snapshot.combatants.find((entry) => entry.id === "target")!.conditions?.some((condition) => condition.name === "frightened") ?? false;

describe("rollSavingThrow", () => {
  it("uses the proficient save when present, otherwise the raw modifier, plus situational bonuses", () => {
    const state = createEngineState(scene({ ...target(false), abilities: { ...fighter.abilities, wis: 14 } }, "roll-1"));
    const targetCombatant = state.snapshot.combatants.find((entry) => entry.id === "target")!;
    const plain = rollSavingThrow(state, targetCombatant, { ability: "wis", dc: 10, kind: "action" });
    expect(plain.roll.modifier).toBe(2); // WIS 14
    expect(plain.dc).toBe(10);

    const bonus = rollSavingThrow(state, targetCombatant, { ability: "wis", dc: 10, kind: "action", situationalBonus: 3 });
    expect(bonus.roll.modifier).toBe(5);

    const proficient = createEngineState(scene({ ...target(false), abilities: { ...fighter.abilities, wis: 14 }, saves: { wis: 7 } }, "roll-2"));
    expect(rollSavingThrow(proficient, proficient.snapshot.combatants.find((entry) => entry.id === "target")!, { ability: "wis", dc: 10, kind: "action" }).roll.modifier).toBe(7);
  });

  it("adds feature bonuses for every kind of save, concentration included", () => {
    const state = createEngineState(scene(target(true), "roll-3"));
    const targetCombatant = state.snapshot.combatants.find((entry) => entry.id === "target")!;
    for (const kind of ["action", "area", "zone", "terrain", "rider", "repeat", "concentration", "feature", "death-effect"] as const) {
      const result = rollSavingThrow(state, targetCombatant, { ability: "con", dc: 10, kind });
      expect(result.featureBonus.total, kind).toBe(30);
      expect(result.featureBonus.sources, kind).toContain("Big Ward");
    }
  });

  it("applies condition modifiers to a concentration save too", () => {
    const state = createEngineState(scene(target(false), "roll-4"));
    const targetCombatant = state.snapshot.combatants.find((entry) => entry.id === "target")!;
    targetCombatant.conditions = [{ id: "bane", name: "custom", startedRound: 1, modifiers: { savingThrows: { con: -4 } } }];
    expect(rollSavingThrow(state, targetCombatant, { ability: "con", dc: 10, kind: "concentration" }).roll.modifier)
      .toBe(Math.floor((fighter.abilities.con - 10) / 2) - 4);
  });
});

describe("a rider's own saving throw honours the target's features", () => {
  const applied = (withWard: boolean, seed: string) => {
    const state = createEngineState(scene(target(withWard), seed));
    resolveAttack(state, "gazer", "target", "gaze");
    return isFrightened(state);
  };

  it("without a ward the DC 25 save always fails and the target is frightened", () => {
    const seeds = ["a", "b", "c", "d", "e"];
    expect(seeds.filter((seed) => applied(false, seed)).length).toBeGreaterThanOrEqual(4); // a natural 1 can still miss the attack
  });

  it("with a +30 save bonus the rider is negated every time (it used to be ignored)", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) expect(applied(true, seed), seed).toBe(false);
  });
});

describe("a repeated save honours the target's features", () => {
  function frightenedTarget(withWard: boolean) {
    const state = createEngineState(scene(target(withWard), "repeat"));
    const targetCombatant = state.snapshot.combatants.find((entry) => entry.id === "target")!;
    targetCombatant.conditions = [{
      id: "fear", name: "frightened", startedRound: 1, sourceCombatantId: "gazer",
      repeatSave: { ability: "wis", dc: 25, timing: "turn-end" }
    }];
    return { state, targetCombatant };
  }

  it("without a ward the target stays frightened", () => {
    const { state, targetCombatant } = frightenedTarget(false);
    runRepeatedSaves(state, "target", "turn-end");
    expect(targetCombatant.conditions?.some((condition) => condition.name === "frightened")).toBe(true);
  });

  it("with a ward the target shakes it off at once (it used to be ignored)", () => {
    const { state, targetCombatant } = frightenedTarget(true);
    runRepeatedSaves(state, "target", "turn-end");
    expect(targetCombatant.conditions?.some((condition) => condition.name === "frightened") ?? false).toBe(false);
    expect(state.log.some((entry) => entry.type === "ConditionExpired" && entry.data?.viaSave === true)).toBe(true);
  });
});
