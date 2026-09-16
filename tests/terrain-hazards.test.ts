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

    // Destination is the hazard tile itself, not a cell beyond it — since
    // moveCombatant now detours around a hazard when a comparable route
    // exists (see hazardPathingOverlay), landing *on* it is the only way to
    // guarantee this move actually enters it, for a clean test of the damage
    // mechanics in isolation from route selection (covered separately below).
    moveCombatant(state, "enemy-goblin-1", { x: 3, y: 1 }, { provokeOpportunityAttacks: false });

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

    // Destination is the hazard tile itself — see the lava test above for why.
    moveCombatant(state, "enemy-goblin-1", { x: 3, y: 1 }, { provokeOpportunityAttacks: false });

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

    // Destination is the hazard tile itself — see the lava test above for why.
    moveCombatant(state, "enemy-goblin-1", { x: 3, y: 1 }, { provokeOpportunityAttacks: false });

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

    // Destination is the hazard tile itself — see the lava test above for why.
    moveCombatant(state, "enemy-goblin-1", { x: 3, y: 1 }, { provokeOpportunityAttacks: false });

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

  it("AI won't cut straight through a lava tile en route to a hazard-free destination, even when that destination itself is clear", () => {
    // The two AI-avoidance tests above only prove the AI won't *rest* on a
    // hazard tile — the destination itself was always hazard-free there, so
    // they pass even without path-wide scoring (see movementPlanForCell in
    // simulation.ts). This scenario specifically targets the gap: the lava
    // tile sits on the *cheapest route* to an otherwise-fine destination, not
    // at the destination — the archer's straight retreat north from (6,4)
    // crosses lava at (6,3), while a diagonal retreat to (4,2) is the same
    // Chebyshev distance from the hostile (6 squares either way) and the same
    // movement cost (3 squares), but touches no hazard tile at all.
    const e = encounter();
    e.seed = "terrain-hazard-ai-avoid-path";
    e.map.terrain = [lavaTile({ x: 6, y: 3 })];
    const archer = e.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 6, y: 4 };
    archer.tacticsProfile = "basic-ranged";
    const fighter = e.combatants.find((c) => c.id === "pc-fighter")!;
    fighter.state = "dead";
    const goblin1 = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 6, y: 7 };
    const goblin2 = e.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.state = "dead";

    const state = createEngineState(e);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);

    const moved = state.log.find((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "pc-archer");
    const path = (moved?.data?.cells as { x: number; y: number }[] | undefined) ?? [];
    expect(path.some((step) => step.x === 6 && step.y === 3), `path ${JSON.stringify(path)} should route around the lava tile`).toBe(false);
    expect(state.log.some((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "pc-archer")).toBe(false);
  });

  it("a melee approach takes the costlier detour around lava instead of the cheapest route straight through it", () => {
    // Even the path-summed scoring fix above isn't enough on its own: every
    // reachable *destination* cell downstream of a hazard on the objectively
    // cheapest route inherits a path that crosses it, because `findReachableCells`
    // (plain Dijkstra) only ever keeps the single cheapest route to each cell —
    // a costlier, hazard-free alternate route to that exact same cell is
    // discarded before movementPlanForCell ever gets a chance to weigh it. Here
    // the fighter's shortest line to melee range runs straight through lava;
    // the equally-viable adjacent cell one row up is 0.5 squares more
    // expensive (one diagonal step) precisely because it avoids the lava row
    // entirely — proving pathfinding itself (hazardPathingOverlay in areas.ts,
    // used by both the AI's candidate search and the real move in
    // combat.ts's moveCombatant) now discovers and prefers that costlier-but-
    // safer route, not just that the tactical destination score disfavors it.
    const e = encounter();
    e.seed = "terrain-hazard-melee-detour";
    e.map.terrain = [lavaTile({ x: 4, y: 1 })];
    const fighter = e.combatants.find((c) => c.id === "pc-fighter")!;
    fighter.position = { x: 1, y: 1 };
    fighter.tacticsProfile = "basic-melee";
    const archer = e.combatants.find((c) => c.id === "pc-archer")!;
    archer.state = "dead";
    const goblin1 = e.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 7, y: 1 };
    const goblin2 = e.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.state = "dead";

    const state = createEngineState(e);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-fighter")!);

    const moved = state.log.find((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "pc-fighter");
    const path = (moved?.data?.cells as { x: number; y: number }[] | undefined) ?? [];
    expect(path.some((step) => step.x === 4 && step.y === 1), `path ${JSON.stringify(path)} should detour around the lava tile`).toBe(false);
    expect(state.log.some((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "pc-fighter")).toBe(false);
    // The real cost paid should reflect the true (detour) route, not the
    // planning-only hazard-inflated one — 5.5 squares (4 orthogonal + one
    // diagonal step), well within the fighter's 30 ft / 6-square budget.
    expect(moved?.data?.cost).toBeCloseTo(5.5, 5);
  });
});
