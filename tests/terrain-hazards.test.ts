import { describe, expect, it } from "vitest";
import { applyTerrainHazardTriggers, createEngineState, moveCombatant, sampleEncounter, takeAutomatedTurn } from "@/engine";
import type { EncounterSnapshot, TerrainZone } from "@/engine";

function lavaTile(cell: { x: number; y: number }): TerrainZone {
  return {
    id: "terrain-lava",
    name: "Lava",
    type: "hazard",
    tags: ["lava"],
    polygon: [
      { x: cell.x, y: cell.y },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x + 1, y: cell.y + 1 },
      { x: cell.x, y: cell.y + 1 }
    ],
    cell,
    hazard: {
      trigger: ["on-enter", "start-of-turn-in-zone"],
      damage: [{ dice: "4d10", damageType: "fire" }]
    }
  };
}

function acidTile(cell: { x: number; y: number }): TerrainZone {
  return {
    id: "terrain-acid",
    name: "Acid Pool",
    type: "hazard",
    tags: ["acid"],
    polygon: [
      { x: cell.x, y: cell.y },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x + 1, y: cell.y + 1 },
      { x: cell.x, y: cell.y + 1 }
    ],
    cell,
    hazard: {
      trigger: ["on-enter", "start-of-turn-in-zone"],
      saveAbility: "dex",
      dc: 12,
      damage: [{ dice: "2d6", damageType: "acid" }],
      onSuccess: "half"
    }
  };
}

/** `dc` is a parameter so tests can force a guaranteed pass/fail without scripting the RNG. */
function iceTile(cell: { x: number; y: number }, dc: number): TerrainZone {
  return {
    id: "terrain-ice",
    name: "Ice",
    type: "hazard",
    tags: ["ice"],
    polygon: [
      { x: cell.x, y: cell.y },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x + 1, y: cell.y + 1 },
      { x: cell.x, y: cell.y + 1 }
    ],
    cell,
    hazard: {
      trigger: ["on-enter"],
      saveAbility: "dex",
      dc,
      riders: [{
        kind: "condition",
        when: "on-save-fail",
        condition: "prone",
        duration: { kind: "until-start-of-next-turn" }
      }]
    }
  };
}

function encounter(): EncounterSnapshot {
  const e = structuredClone(sampleEncounter);
  e.seed = "terrain-hazards";
  e.map.walls = [];
  e.map.terrain = [];
  return e;
}

describe("terrain hazard tiles", () => {
  it("damages a creature that moves into a no-save hazard tile (lava), with no SaveRolled event", () => {
    const e = encounter();
    e.map.terrain = [lavaTile({ x: 3, y: 1 })];
    const enemy = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    enemy.position = { x: 1, y: 1 };
    enemy.currentHp = 100; // survive the hit regardless of the roll
    const state = createEngineState(e);

    moveCombatant(state, "enemy-goblin-1", { x: 4, y: 1 }, { provokeOpportunityAttacks: false });

    expect(state.log.some((entry) => entry.type === "DamageApplied")).toBe(true);
    expect(state.log.some((entry) => entry.type === "SaveRolled")).toBe(false);
    const combatant = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!;
    expect(combatant.currentHp).toBeLessThan(100);
  });

  it("rolls a save for a save-gated hazard tile (acid) and still applies damage on a failed save", () => {
    const e = encounter();
    e.map.terrain = [acidTile({ x: 3, y: 1 })];
    const enemy = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    enemy.position = { x: 1, y: 1 };
    enemy.currentHp = 100;
    const state = createEngineState(e);

    moveCombatant(state, "enemy-goblin-1", { x: 4, y: 1 }, { provokeOpportunityAttacks: false });

    const saveEvent = state.log.find((entry) => entry.type === "SaveRolled");
    expect(saveEvent, "should have rolled a save against the acid tile").toBeDefined();
    expect(saveEvent!.data?.viaTerrain).toBe(true);
    expect(state.log.some((entry) => entry.type === "DamageApplied")).toBe(true);
  });

  it("only triggers once per round even if on-enter and start-of-turn both fire (dedup)", () => {
    const e = encounter();
    e.map.terrain = [lavaTile({ x: 3, y: 1 })];
    const enemy = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    enemy.position = { x: 1, y: 1 };
    enemy.currentHp = 100;
    const state = createEngineState(e);

    moveCombatant(state, "enemy-goblin-1", { x: 3, y: 1 }, { provokeOpportunityAttacks: false });
    const damageCountAfterEnter = state.log.filter((entry) => entry.type === "DamageApplied").length;
    expect(damageCountAfterEnter).toBe(1);

    applyTerrainHazardTriggers(state, "enemy-goblin-1", "turn-start");

    expect(state.log.filter((entry) => entry.type === "DamageApplied")).toHaveLength(damageCountAfterEnter);
  });

  it("re-triggers start-of-turn-in-zone on a later round for a creature still standing in the tile", () => {
    const e = encounter();
    e.map.terrain = [lavaTile({ x: 3, y: 1 })];
    const enemy = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    enemy.position = { x: 3, y: 1 };
    enemy.currentHp = 100;
    const state = createEngineState(e);

    applyTerrainHazardTriggers(state, "enemy-goblin-1", "turn-start");
    expect(state.log.filter((entry) => entry.type === "DamageApplied")).toHaveLength(1);

    state.snapshot.round += 1;
    applyTerrainHazardTriggers(state, "enemy-goblin-1", "turn-start");

    expect(state.log.filter((entry) => entry.type === "DamageApplied")).toHaveLength(2);
  });

  it("does not damage a creature crossing a non-hazard terrain tile (difficult terrain alone)", () => {
    const e = encounter();
    e.map.terrain = [{
      id: "terrain-mud",
      name: "Mud",
      type: "difficult",
      movementMultiplier: 2,
      polygon: [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 2 }, { x: 3, y: 2 }],
      cell: { x: 3, y: 1 }
    }];
    const enemy = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    enemy.position = { x: 1, y: 1 };
    const state = createEngineState(e);

    moveCombatant(state, "enemy-goblin-1", { x: 4, y: 1 }, { provokeOpportunityAttacks: false });

    expect(state.log.some((entry) => entry.type === "DamageApplied")).toBe(false);
  });

  it("knocks a creature prone on a failed save against a damage-free hazard tile (ice)", () => {
    const e = encounter();
    // DC 999 is unreachable by any roll — guarantees a failed save without
    // needing to script the RNG.
    e.map.terrain = [iceTile({ x: 3, y: 1 }, 999)];
    const enemy = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    enemy.position = { x: 1, y: 1 };
    const state = createEngineState(e);

    moveCombatant(state, "enemy-goblin-1", { x: 4, y: 1 }, { provokeOpportunityAttacks: false });

    const saveEvent = state.log.find((entry) => entry.type === "SaveRolled");
    expect(saveEvent?.data?.success).toBe(false);
    expect(state.log.some((entry) => entry.type === "DamageApplied")).toBe(false);
    const combatant = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!;
    expect(combatant.conditions?.some((condition) => condition.name === "prone")).toBe(true);
  });

  it("does not knock a creature prone on a successful save against ice", () => {
    const e = encounter();
    // DC -999 is always beaten — guarantees a successful save.
    e.map.terrain = [iceTile({ x: 3, y: 1 }, -999)];
    const enemy = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    enemy.position = { x: 1, y: 1 };
    const state = createEngineState(e);

    moveCombatant(state, "enemy-goblin-1", { x: 4, y: 1 }, { provokeOpportunityAttacks: false });

    const saveEvent = state.log.find((entry) => entry.type === "SaveRolled");
    expect(saveEvent?.data?.success).toBe(true);
    const combatant = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!;
    expect(combatant.conditions?.some((condition) => condition.name === "prone") ?? false).toBe(false);
  });

  it("AI avoids pathing an archer through a lava tile when an equally good route is open", () => {
    const e = encounter();
    e.seed = "terrain-hazard-ai-avoid";
    // A single lava tile sits on the direct line between the archer and its
    // target; the archer has room to sidestep it at no extra movement cost
    // (both routes are the same Chebyshev distance on an open grid).
    e.map.terrain = [lavaTile({ x: 3, y: 1 })];
    const archer = e.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 1, y: 1 };
    archer.tacticsProfile = "basic-ranged";
    const fighter = e.combatants.find((c) => c.id === "pc-fighter")!;
    fighter.state = "dead";
    const goblin1 = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 9, y: 1 };
    const goblin2 = e.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.state = "dead";

    const state = createEngineState(e);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);

    const finalPosition = state.snapshot.combatants.find((c) => c.id === "pc-archer")!.position;
    expect(finalPosition).not.toEqual({ x: 3, y: 1 });
    expect(state.log.some((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "pc-archer")).toBe(false);
  });

  it("AI avoids pathing through ice too, even though it deals no damage (rider-only hazards still count)", () => {
    const e = encounter();
    e.seed = "terrain-hazard-ai-avoid-ice";
    e.map.terrain = [iceTile({ x: 3, y: 1 }, 999)];
    const archer = e.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 1, y: 1 };
    archer.tacticsProfile = "basic-ranged";
    const fighter = e.combatants.find((c) => c.id === "pc-fighter")!;
    fighter.state = "dead";
    const goblin1 = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 9, y: 1 };
    const goblin2 = e.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.state = "dead";

    const state = createEngineState(e);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);

    const finalPosition = state.snapshot.combatants.find((c) => c.id === "pc-archer")!.position;
    expect(finalPosition).not.toEqual({ x: 3, y: 1 });
  });
});
