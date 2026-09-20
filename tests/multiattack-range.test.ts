import { describe, expect, it } from "vitest";
import { runAutomatedEncounter, sampleEncounter, type CombatantState, type CreatureDefinition } from "@/engine";

/**
 * A Multiattack whose steps have different reach (a bearded devil: 5 ft beard + 10 ft glaive) is only
 * in range at the SHORTEST step's reach. The planner used the longest, stopped 10 ft away, and the
 * beard step threw "beyond 5 ft. range" — the whole turn was lost.
 */
const devil: CreatureDefinition = {
  id: "def-mixed-reach",
  name: "Mixed Reach",
  size: "medium",
  type: "fiend",
  armorClass: 13,
  maxHp: 60,
  speed: 30,
  abilities: { str: 16, dex: 10, con: 15, int: 9, wis: 11, cha: 11 },
  actions: [
    { kind: "attack", id: "beard", name: "Beard", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5, range: 5, reach: 5, damage: [{ dice: "1d8+3", damageType: "piercing" }], automationSupport: "full" },
    { kind: "attack", id: "glaive", name: "Glaive", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5, range: 10, reach: 10, damage: [{ dice: "1d10+3", damageType: "slashing" }], automationSupport: "full" },
    { kind: "multiattack", id: "multiattack", name: "Multiattack", actionType: "action", attacks: [{ actionId: "beard", count: 1 }, { actionId: "glaive", count: 1 }], automationSupport: "full" }
  ]
};

describe("mixed-reach multiattack", () => {
  it("closes to the shortest step's reach instead of losing the turn", () => {
    const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;
    const pc: CombatantState = { id: "pc", definitionId: fighter.id, displayName: "Fighter", faction: "party", position: { x: 1, y: 3 }, currentHp: 200, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" };
    // 10 ft (two squares) away: inside the glaive's reach, outside the beard's.
    const enemy: CombatantState = { id: "devil", definitionId: devil.id, displayName: "Devil", faction: "enemy", position: { x: 3, y: 3 }, currentHp: 60, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced" };
    const snapshot = {
      ...structuredClone(sampleEncounter),
      seed: "mixed-reach",
      rules: { ...sampleEncounter.rules, requireLineOfEffect: false },
      map: { ...sampleEncounter.map, walls: [], terrain: [] },
      definitions: [fighter, devil],
      combatants: [pc, enemy]
    };

    const result = runAutomatedEncounter(snapshot, 4);
    expect(result.outcome.warnings.filter((warning) => /automated turn failed/.test(warning))).toEqual([]);
    expect(result.log.some((entry) => entry.type === "MultiattackResolved" && entry.data?.attackerId === "devil")).toBe(true);
  });
});
