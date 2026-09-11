import { describe, expect, it } from "vitest";
import { createEngineState, sampleEncounter, takeAutomatedTurn } from "@/engine";
import type { ActionDefinition, EncounterSnapshot, ResourceStance } from "@/engine";

function baseEncounter(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";
const TARGET = "enemy-goblin-1";

function chosenActionId(state: ReturnType<typeof createEngineState>): string | undefined {
  return state.log.find((e) => e.type === "AiDecision" && e.data?.actionId)?.data?.actionId as string | undefined;
}

/** Caster vs. a single un-droppable target, choosing between the given offensive actions. */
function runOffensiveChoice(seed: string, stance: ResourceStance, actions: ActionDefinition[]): string | undefined {
  const encounter = baseEncounter(seed);
  const caster = encounter.combatants.find((c) => c.id === CASTER)!;
  caster.position = { x: 5, y: 4 };
  caster.tacticsProfile = "basic-melee";
  caster.resourceStance = stance;
  caster.resources = { ki: 1 };
  const target = encounter.combatants.find((c) => c.id === TARGET)!;
  target.position = { x: 6, y: 4 };
  target.currentHp = 500;
  encounter.definitions.find((d) => d.id === "def-goblin")!.maxHp = 500;
  encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
  encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = actions;
  const state = createEngineState(encounter);
  const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
  takeAutomatedTurn(state, actor);
  return chosenActionId(state);
}

const FREE_JAB: ActionDefinition = {
  kind: "attack", id: "free-jab", name: "Jab", actionType: "action", attackType: "melee",
  ability: "str", attackBonus: 5, range: 5, reach: 5, autoHit: true,
  damage: [{ dice: "1", damageType: "bludgeoning" }],
  automationSupport: "full"
};

describe("AI — resource stance", () => {
  it("liberal spends a limited resource for an edge balanced and conservative pass on", () => {
    const smallEdge: ActionDefinition = {
      ...FREE_JAB, id: "costed-small", name: "Minor Smite",
      damage: [{ dice: "2", damageType: "radiant" }],
      resourceCost: { resourceId: "ki", amount: 1 }
    };
    expect(runOffensiveChoice("stance-small-conservative", "conservative", [FREE_JAB, smallEdge])).toBe("free-jab");
    expect(runOffensiveChoice("stance-small-balanced", "balanced", [FREE_JAB, smallEdge])).toBe("free-jab");
    expect(runOffensiveChoice("stance-small-liberal", "liberal", [FREE_JAB, smallEdge])).toBe("costed-small");
  });

  it("conservative passes on a resource that balanced and liberal both spend", () => {
    const bigEdge: ActionDefinition = {
      ...FREE_JAB, id: "costed-big", name: "Smite",
      damage: [{ dice: "4", damageType: "radiant" }],
      resourceCost: { resourceId: "ki", amount: 1 }
    };
    expect(runOffensiveChoice("stance-big-conservative", "conservative", [FREE_JAB, bigEdge])).toBe("free-jab");
    expect(runOffensiveChoice("stance-big-balanced", "balanced", [FREE_JAB, bigEdge])).toBe("costed-big");
    expect(runOffensiveChoice("stance-big-liberal", "liberal", [FREE_JAB, bigEdge])).toBe("costed-big");
  });
});

describe("AI — resource stance (healing)", () => {
  const FREE_HEAL: ActionDefinition = {
    kind: "healing", id: "free-heal", name: "Lay on Hands", actionType: "action", range: 5,
    healing: [{ dice: "5" }], automationSupport: "full"
  };
  const COSTED_HEAL: ActionDefinition = {
    kind: "healing", id: "costed-heal", name: "Cure Wounds", actionType: "action", range: 5,
    healing: [{ dice: "9" }], resourceCost: { resourceId: "slot1", amount: 1 }, automationSupport: "full"
  };

  function runHealChoice(seed: string, stance: ResourceStance): string | undefined {
    const encounter = baseEncounter(seed);
    const healer = encounter.combatants.find((c) => c.id === CASTER)!;
    healer.position = { x: 2, y: 2 };
    healer.tacticsProfile = "basic-melee";
    healer.resourceStance = stance;
    healer.resources = { slot1: 1 };
    const ally = encounter.combatants.find((c) => c.id === "pc-archer")!;
    ally.position = { x: 2, y: 3 };
    ally.currentHp = 20;
    encounter.definitions.find((d) => d.id === "def-archer")!.maxHp = 100;
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.state = "dead";
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [FREE_HEAL, COSTED_HEAL];
    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);
    return chosenActionId(state);
  }

  it("a conservative healer takes the at-will heal; a liberal one spends the limited one", () => {
    expect(runHealChoice("heal-stance-conservative", "conservative")).toBe("free-heal");
    expect(runHealChoice("heal-stance-liberal", "liberal")).toBe("costed-heal");
  });
});
