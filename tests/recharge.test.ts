import { describe, expect, it } from "vitest";
import { createEngineState, resolveAreaSaveAction, rollRecharges, runAutomatedEncounter, runTurnStart, sampleEncounter, usagePoolId, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";

/** Recharge N–6: spend the breath, roll at the start of each turn, get it back on N or higher. */
const breath = (id: string, min = 5, poolId?: string): CreatureDefinition["actions"][number] => ({
  kind: "area-save", id, name: id, actionType: "action", saveAbility: "dex", dc: 30, range: 30,
  area: { type: "cone", size: 30 }, targeting: { origin: "self", aimedFromSelf: true, range: 30 },
  damage: [{ dice: "2d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "all",
  usage: { kind: "recharge", recharge: { min }, ...(poolId ? { poolId } : {}) },
  resourceCost: { resourceId: `usage:${poolId ?? id}`, amount: 1 }, automationSupport: "full"
} as CreatureDefinition["actions"][number]);

const dragon: CreatureDefinition = {
  id: "def-dragon", name: "Dragon", size: "large", armorClass: 10, maxHp: 400, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  actions: [breath("fire-breath", 5, "breath"), breath("sleep-breath", 5, "breath"), breath("lightning", 6)],
  resources: { "usage:breath": 1, "usage:lightning": 1 }
};

function scene(seed: string): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const fighter = base.definitions.find((definition) => definition.id === "def-fighter")!;
  const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
    id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", resources: definition.resources ? { ...definition.resources } : undefined
  });
  return { ...base, seed, map: { ...base.map, walls: [], terrain: [] }, definitions: [{ ...fighter, maxHp: 5000 }, dragon], combatants: [token("target", { ...fighter, maxHp: 5000 }, "party", 4), token("dragon", dragon, "enemy", 5)] };
}

const dragonOf = (state: ReturnType<typeof createEngineState>) => state.snapshot.combatants.find((entry) => entry.id === "dragon")!;

describe("usagePoolId", () => {
  it("is the action's own pool unless a shared pool is named", () => {
    expect(usagePoolId({ id: "a" })).toBe("usage:a");
    expect(usagePoolId({ id: "a", usage: { kind: "recharge", poolId: "breath" } })).toBe("usage:breath");
  });
});

describe("rollRecharges", () => {
  it("does nothing while the ability is still available", () => {
    const state = createEngineState(scene("x"));
    rollRecharges(state, dragonOf(state));
    expect(state.log.filter((entry) => entry.type === "AbilityRecharged")).toHaveLength(0);
  });

  it("rolls for a spent ability, restores it on success and reports either way", () => {
    let recharged = 0;
    let failed = 0;
    for (let i = 0; i < 40; i += 1) {
      const state = createEngineState(scene(`seed-${i}`));
      const actor = dragonOf(state);
      actor.resources = { ...actor.resources, "usage:lightning": 0 };
      rollRecharges(state, actor);
      const entry = state.log.find((event) => event.type === "AbilityRecharged")!;
      expect(entry.data?.min).toBe(6);
      if (entry.data?.recharged) {
        recharged += 1;
        expect(entry.data.roll).toBe(6);
        expect(actor.resources?.["usage:lightning"]).toBe(1);
      } else {
        failed += 1;
        expect(actor.resources?.["usage:lightning"]).toBe(0);
      }
    }
    expect(recharged).toBeGreaterThan(0); // ≈ 1 in 6
    expect(failed).toBeGreaterThan(recharged);
  });

  it("actions sharing a pool make one roll and recover together", () => {
    for (let i = 0; i < 30; i += 1) {
      const state = createEngineState(scene(`pool-${i}`));
      const actor = dragonOf(state);
      actor.resources = { ...actor.resources, "usage:breath": 0 };
      rollRecharges(state, actor);
      expect(state.log.filter((event) => event.type === "AbilityRecharged")).toHaveLength(1);
    }
  });

  it("runs at the start of a turn", () => {
    const state = createEngineState(scene("turn"));
    const actor = dragonOf(state);
    actor.resources = { ...actor.resources, "usage:breath": 0, "usage:lightning": 0 };
    runTurnStart(state, actor);
    expect(state.log.filter((event) => event.type === "AbilityRecharged")).toHaveLength(2);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const state = createEngineState(scene("same"));
      const actor = dragonOf(state);
      actor.resources = { ...actor.resources, "usage:lightning": 0 };
      for (let turn = 0; turn < 8; turn += 1) runTurnStart(state, actor);
      return state.log.filter((event) => event.type === "AbilityRecharged").map((event) => event.data?.roll);
    };
    expect(run()).toEqual(run());
  });
});

describe("in a fight", () => {
  it("a spent breath comes back and is used again", () => {
    const state = createEngineState(scene("fight"));
    resolveAreaSaveAction(state, "dragon", { x: 4, y: 4 }, "fire-breath");
    expect(dragonOf(state).resources?.["usage:breath"]).toBe(0);
  });

  it("the automated run fires a real dragon's breath more than once over a long fight", () => {
    const fights = ["a", "b", "c", "d", "e"].map((seed) => runAutomatedEncounter(scene(seed), 12));
    const counts = fights.map((result) => result.log.filter((event) => event.type === "ActionDeclared" && /breath|lightning/i.test(String(event.data?.actionName))).length);
    expect(Math.max(...counts)).toBeGreaterThan(2);
    expect(fights.some((result) => result.log.some((event) => event.type === "AbilityRecharged" && event.data?.recharged))).toBe(true);
  });
});
