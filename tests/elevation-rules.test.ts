import { describe, expect, it } from "vitest";
import {
  type ActionDefinition, applyCondition, createEngineState, fallCombatant, moveCombatant, pushCombatant, remainingMovementBudget, resolveAttack, sampleEncounter, spatialDistance,
  updateDefeatState, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type MovementProfile
} from "@/engine";
import { replayTo } from "@/lib/replay";

/** Ground height and altitude: reach and range are measured in 3D, fliers pay to rise, and things that can't stay up fall. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

const spear: ActionDefinition = { kind: "attack", id: "spear", name: "Spear", actionType: "action", attackType: "melee", ability: "str", attackBonus: 100, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "piercing" }], automationSupport: "full" };
const bow: ActionDefinition = { kind: "attack", id: "bow", name: "Bow", actionType: "action", attackType: "ranged", ability: "dex", attackBonus: 100, range: 80, longRange: 320, damage: [{ dice: "1d6", damageType: "piercing" }], automationSupport: "full" };

const creature = (id: string, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id, name: id, maxHp: 60, armorClass: 10, bonusActions: undefined, reactions: undefined, features: undefined, actions: [spear, bow], ...extra
});
const flying = (movement: MovementProfile = { walk: 30, fly: 60 }): Partial<CreatureDefinition> => ({ speed: movement.walk, movement });

function scene(defs: CreatureDefinition[], tokens: Array<{ id: string; def: string; faction?: "party" | "enemy"; x: number; y?: number; altitude?: number }>, elevation?: Record<string, number>): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  return {
    ...base, seed: "elevation",
    map: { ...base.map, grid: { ...base.map.grid, width: 20, height: 10 }, walls: [], terrain: [], elevation: elevation ? { cells: elevation } : undefined },
    definitions: defs,
    combatants: tokens.map((token): CombatantState => {
      const definition = defs.find((candidate) => candidate.id === token.def)!;
      return {
        id: token.id, definitionId: token.def, displayName: token.id, faction: token.faction ?? "enemy", position: { x: token.x, y: token.y ?? 4 },
        altitude: token.altitude, currentHp: definition.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
      };
    })
  };
}
const get = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((entry) => entry.id === id)!;
const fresh = (state: ReturnType<typeof createEngineState>, id: string) => { get(state, id).actionEconomy = { action: true, bonus: true, reaction: true }; get(state, id).turnFlags = undefined; };
const messages = (state: ReturnType<typeof createEngineState>) => state.log.map((entry) => entry.message);

describe("reach and range in three dimensions", () => {
  const defs = [creature("walker"), creature("bird", flying())];

  it("a spear can't reach a flier 30 ft up, but a bow can", () => {
    const state = createEngineState(scene(defs, [{ id: "walker", def: "walker", x: 4, faction: "party" }, { id: "bird", def: "bird", x: 4, y: 5, altitude: 30 }]));
    expect(spatialDistance(state.snapshot, get(state, "walker"), get(state, "bird"))).toBe(30);
    expect(() => resolveAttack(state, "walker", "bird", "spear")).toThrow(/beyond 5 ft/);
    expect(() => resolveAttack(state, "walker", "bird", "bow")).not.toThrow();
  });

  it("a flier only 5 ft up is still within a spear's reach", () => {
    const state = createEngineState(scene(defs, [{ id: "walker", def: "walker", x: 4, faction: "party" }, { id: "bird", def: "bird", x: 4, y: 5, altitude: 5 }]));
    expect(spatialDistance(state.snapshot, get(state, "walker"), get(state, "bird"))).toBe(5);
    expect(() => resolveAttack(state, "walker", "bird", "spear")).not.toThrow();
  });

  it("standing on a hill puts the ground itself out of reach", () => {
    const state = createEngineState(scene(defs, [{ id: "walker", def: "walker", x: 4, faction: "party" }, { id: "bird", def: "bird", x: 5 }], { "5,4": 10 }));
    expect(spatialDistance(state.snapshot, get(state, "walker"), get(state, "bird"))).toBe(10);
    expect(() => resolveAttack(state, "walker", "bird", "spear")).toThrow(/beyond 5 ft/);
  });

  it("a flat map with nobody airborne measures exactly as before", () => {
    const state = createEngineState(scene(defs, [{ id: "walker", def: "walker", x: 4, faction: "party" }, { id: "bird", def: "bird", x: 9, y: 7 }]));
    expect(spatialDistance(state.snapshot, get(state, "walker"), get(state, "bird"))).toBe(25);
  });
});

describe("moving up and down", () => {
  const defs = [creature("walker"), creature("bird", flying())];

  it("a flier climbs at fly speed: every 5 ft costs a square, and the log says so", () => {
    const state = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4 }]));
    const budget = remainingMovementBudget(state.snapshot, get(state, "bird"));
    moveCombatant(state, "bird", { x: 4, y: 4 }, { altitude: 30 });
    expect(get(state, "bird").altitude).toBe(30);
    expect(remainingMovementBudget(state.snapshot, get(state, "bird"))).toBeCloseTo(budget - 6, 5);
    expect(messages(state)).toContain("bird climbs to 30 ft");
  });

  it("moving and rising in one go is one move, and coming down again lands", () => {
    const state = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4 }]));
    moveCombatant(state, "bird", { x: 7, y: 4 }, { altitude: 10 });
    expect(messages(state)).toContain("bird moved and climbs to 10 ft");
    fresh(state, "bird");
    moveCombatant(state, "bird", { x: 7, y: 4 }, { altitude: 0 });
    expect(get(state, "bird").altitude).toBeUndefined();
    expect(messages(state)).toContain("bird lands");
  });

  it("can't climb further than its remaining movement allows", () => {
    const state = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4 }]));
    expect(() => moveCombatant(state, "bird", { x: 4, y: 4 }, { altitude: 200 })).toThrow(/not reachable/);
  });

  it("a creature with no fly speed can't leave the ground", () => {
    const state = createEngineState(scene(defs, [{ id: "walker", def: "walker", x: 4 }]));
    expect(() => moveCombatant(state, "walker", { x: 4, y: 4 }, { altitude: 10 })).toThrow(/can't fly/);
  });

  it("rising out of a foe's reach provokes an opportunity attack", () => {
    const state = createEngineState(scene(defs, [{ id: "walker", def: "walker", faction: "party", x: 4 }, { id: "bird", def: "bird", x: 5 }]));
    moveCombatant(state, "bird", { x: 5, y: 4 }, { altitude: 20 });
    expect(state.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(true);
  });

  it("dropping in next to a foe doesn't", () => {
    const state = createEngineState(scene(defs, [{ id: "walker", def: "walker", faction: "party", x: 4 }, { id: "bird", def: "bird", x: 5, altitude: 20 }]));
    moveCombatant(state, "bird", { x: 5, y: 4 }, { altitude: 0 });
    expect(state.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(false);
  });
});

describe("falling", () => {
  const defs = [creature("walker"), creature("bird", flying()), creature("wisp", flying({ walk: 0, fly: 40, hover: true }))];

  it("a flier that is knocked prone, or can't move, falls: 1d6 per 10 ft, landing prone", () => {
    const state = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4, altitude: 30 }]));
    applyCondition(state, "bird", { id: "c1", name: "restrained", startedRound: 1 });
    expect(get(state, "bird").altitude).toBeUndefined();
    expect(get(state, "bird").currentHp).toBeLessThan(60);
    expect(get(state, "bird").conditions?.some((condition) => condition.name === "prone")).toBe(true);
    const fell = state.log.find((entry) => entry.type === "CombatantFell")!;
    expect(fell.message).toBe("bird falls 30 ft (it is restrained)");
    expect(fell.data).toMatchObject({ feet: 30, damageDice: "3d6" });
  });

  it("a flier on the ground doesn't fall, and a hovering one stays up", () => {
    const grounded = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4 }]));
    applyCondition(grounded, "bird", { id: "c1", name: "prone", startedRound: 1 });
    expect(grounded.log.some((entry) => entry.type === "CombatantFell")).toBe(false);

    const hovering = createEngineState(scene(defs, [{ id: "wisp", def: "wisp", x: 4, altitude: 30 }]));
    applyCondition(hovering, "wisp", { id: "c1", name: "prone", startedRound: 1 });
    expect(get(hovering, "wisp").altitude).toBe(30);
  });

  it("a fall of under 10 ft hurts nothing but still lands it prone; the damage is capped at 20d6", () => {
    const low = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4, altitude: 5 }]));
    fallCombatant(low, get(low, "bird"), 5, "test");
    expect(get(low, "bird").currentHp).toBe(60);
    expect(get(low, "bird").conditions?.some((condition) => condition.name === "prone")).toBe(true);

    const high = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4, altitude: 500 }]));
    fallCombatant(high, get(high, "bird"), 500, "test");
    expect(high.log.find((entry) => entry.type === "CombatantFell")!.data?.damageDice).toBe("20d6");
  });

  it("a flier that dies in the air falls, without further damage", () => {
    const state = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4, altitude: 40 }]));
    get(state, "bird").currentHp = 0;
    updateDefeatState(state, get(state, "bird"));
    expect(get(state, "bird").state).toBe("defeated");
    expect(get(state, "bird").altitude).toBeUndefined();
  });

  it("a walker shoved off a ledge falls the difference; one shoved into a cliff face stops", () => {
    // A 20 ft plateau on columns 0-4; the walker stands on it at column 4 with the edge just past it.
    const plateau: Record<string, number> = {};
    for (let y = 0; y < 10; y += 1) for (let x = 0; x <= 4; x += 1) plateau[`${x},${y}`] = 20;
    const off = createEngineState(scene(defs, [{ id: "walker", def: "walker", x: 4 }], plateau));
    pushCombatant(off, get(off, "walker"), 10, { x: 3, y: 4 });
    expect(get(off, "walker").position.x).toBeGreaterThan(4);
    expect(off.log.find((entry) => entry.type === "CombatantFell")!.data).toMatchObject({ feet: 20, damageDice: "2d6" });

    const into = createEngineState(scene(defs, [{ id: "walker", def: "walker", x: 5 }], plateau));
    pushCombatant(into, get(into, "walker"), 10, { x: 6, y: 4 });
    expect(get(into, "walker").position.x).toBe(5); // the plateau is a wall from below
    expect(into.log.some((entry) => entry.type === "CombatantFell")).toBe(false);
  });

  it("a flier shoved off a ledge is just carried", () => {
    const plateau: Record<string, number> = {};
    for (let y = 0; y < 10; y += 1) for (let x = 0; x <= 4; x += 1) plateau[`${x},${y}`] = 20;
    const state = createEngineState(scene(defs, [{ id: "bird", def: "bird", x: 4 }], plateau));
    pushCombatant(state, get(state, "bird"), 10, { x: 3, y: 4 });
    expect(state.log.some((entry) => entry.type === "CombatantFell")).toBe(false);
  });
});

describe("replay", () => {
  it("shows a climb and a fall in the reconstructed state", () => {
    const defs = [creature("walker"), creature("bird", flying())];
    const snapshot = scene(defs, [{ id: "walker", def: "walker", faction: "party", x: 12 }, { id: "bird", def: "bird", x: 4 }]);
    const state = createEngineState(structuredClone(snapshot));
    moveCombatant(state, "bird", { x: 4, y: 4 }, { altitude: 20 });
    const climbed = replayTo(snapshot, state.log, state.log.length);
    expect(climbed.combatants.find((entry) => entry.id === "bird")!.altitude).toBe(20);
    applyCondition(state, "bird", { id: "c", name: "paralyzed", startedRound: 1 });
    const fell = replayTo(snapshot, state.log, state.log.length);
    expect(fell.combatants.find((entry) => entry.id === "bird")!.altitude).toBeUndefined();
  });
});
