import { describe, expect, it } from "vitest";
import {
  createEngineState, findPath, findReachableCells, moveCombatant, movementCostForCell, movementOptionsFor, movementReference, remainingMovementBudget,
  runAutomatedEncounter, sampleEncounter, applyTerrainHazardTriggers,
  type BattleMapState, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type MovementProfile, type Point, type TerrainZone
} from "@/engine";

/** Movement modes: each cell costs whichever mode crosses it cheapest, in squares of the creature's fastest speed. */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

function tile(x: number, y: number, type: TerrainZone["type"], tags: string[] = [], movementMultiplier?: number, extra: Partial<TerrainZone> = {}): TerrainZone {
  return { id: `t-${x}-${y}`, name: tags[0] ?? type, type, polygon: [{ x, y }, { x: x + 1, y }, { x: x + 1, y: y + 1 }, { x, y: y + 1 }], cell: { x, y }, tags, movementMultiplier, ...extra };
}
const column = (x: number, type: TerrainZone["type"], tags: string[], multiplier?: number) => Array.from({ length: 8 }, (_, y) => tile(x, y, type, tags, multiplier));
const mapWith = (terrain: TerrainZone[], width = 12, height = 8): BattleMapState => ({ ...structuredClone(sampleEncounter.map), grid: { ...sampleEncounter.map.grid, width, height }, walls: [], terrain });

const walker: MovementProfile = { walk: 30 };
const flier: MovementProfile = { walk: 30, fly: 60 };
const swimmer: MovementProfile = { walk: 20, swim: 60 };
const climber: MovementProfile = { walk: 30, climb: 30 };
const burrower: MovementProfile = { walk: 30, burrow: 30 };

const cost = (terrain: TerrainZone[], profile: MovementProfile) => movementCostForCell(terrain, { x: 0, y: 0 }, profile);

describe("terrain cost per movement mode", () => {
  it("a walker with no profile is unchanged: the painted multiplier", () => {
    expect(movementCostForCell([], { x: 0, y: 0 })).toBe(1);
    expect(movementCostForCell([tile(0, 0, "difficult")], { x: 0, y: 0 })).toBe(2);
    expect(movementCostForCell([tile(0, 0, "difficult", [], 4)], { x: 0, y: 0 })).toBe(4);
    expect(movementCostForCell([tile(0, 0, "impassable")], { x: 0, y: 0 })).toBe(Infinity);
    expect(cost([tile(0, 0, "difficult")], walker)).toBe(2); // and a walk-only profile agrees
  });

  it("a flier pays one square of its (larger) budget for any ground: difficult terrain, water and hazards are ignored", () => {
    expect(cost([], flier)).toBe(1); // 60 ft of flying = 12 squares, so its budget is 12 squares of cost 1
    expect(cost([], walker)).toBe(1);
    expect(cost([], { walk: 30, fly: 60 })).toBe(1);
    expect(cost([tile(0, 0, "difficult", [], 4)], flier)).toBe(1);
    expect(cost([tile(0, 0, "custom", ["water", "deep"])], flier)).toBe(1);
    expect(cost([tile(0, 0, "hazard", ["lava"], 8)], flier)).toBe(1);
  });

  it("but not solid rock or impassable terrain", () => {
    expect(cost([tile(0, 0, "custom", ["solid"])], flier)).toBe(Infinity);
    expect(cost([tile(0, 0, "impassable")], flier)).toBe(Infinity);
  });

  it("water: walkers wade shallows at ×2 and can't cross deep; swimmers cross both at their speed", () => {
    const shallow = [tile(0, 0, "custom", ["water"], 2)];
    const deep = [tile(0, 0, "custom", ["water", "deep"])];
    expect(cost(shallow, walker)).toBe(2);
    expect(cost(deep, walker)).toBe(Infinity);
    expect(cost(shallow, swimmer)).toBeCloseTo(1, 5); // 60-ft swim in 60-ft reference
    expect(cost(deep, swimmer)).toBeCloseTo(1, 5);
    expect(cost([], swimmer)).toBeCloseTo(3, 5); // on land it walks at 20 of a 60 reference
  });

  it("a swimmer can't swim on dry land, and a walker with a swim speed still prefers the cheaper of the two", () => {
    expect(cost([], { walk: 30, swim: 30 })).toBe(1);
    expect(cost([tile(0, 0, "custom", ["water"], 2)], { walk: 30, swim: 30 })).toBe(1);
  });

  it("burrowing works only through solid ground, climbing only where a walker isn't stopped by cliffs", () => {
    const rock = [tile(0, 0, "custom", ["solid"])];
    const cliff = [tile(0, 0, "custom", ["climbable"])];
    expect(cost(rock, walker)).toBe(Infinity);
    expect(cost(rock, burrower)).toBe(1);
    expect(cost([], burrower)).toBe(1); // it just walks on the surface
    expect(cost(cliff, walker)).toBe(Infinity);
    expect(cost(cliff, climber)).toBe(1);
    expect(cost([tile(0, 0, "difficult", [], 4)], climber)).toBe(1); // scrambles over rough ground
    expect(cost([tile(0, 0, "custom", ["water", "deep"])], climber)).toBe(Infinity);
  });

  it("movementReference is the fastest mode", () => {
    expect(movementReference(flier)).toBe(60);
    expect(movementReference({ walk: 5, fly: 30 })).toBe(30);
    expect(movementReference(walker)).toBe(30);
  });
});

describe("paths", () => {
  const river = (tags: string[], multiplier?: number) => mapWith(column(5, "custom", tags, multiplier));
  const across = (profile: MovementProfile, map: BattleMapState) => findPath(map, { x: 1, y: 4 }, { x: 9, y: 4 }, 1, [], { movement: profile });

  it("a walker can't cross a deep river; a swimmer and a flier can", () => {
    const deep = river(["water", "deep"]);
    expect(across(walker, deep).reachable).toBe(false);
    expect(across(swimmer, deep).reachable).toBe(true);
    expect(across(flier, deep).reachable).toBe(true);
  });

  it("wading a shallow river costs a walker one extra square; a flier is unaffected (and has twice the budget)", () => {
    const shallow = river(["water"], 2);
    expect(across(walker, shallow).cost).toBe(9); // 8 squares + 1 extra for the wade
    expect(across(flier, shallow).cost).toBe(8); // of a 12-square budget, against the walker 9 of 6
  });

  it("a burrower goes straight through a rock wall the walker must go around", () => {
    const rock = mapWith(Array.from({ length: 7 }, (_, y) => tile(5, y, "custom", ["solid"]))); // gap at the bottom row
    const around = across(walker, rock);
    const through = across(burrower, rock);
    expect(around.reachable).toBe(true);
    expect(through.cost).toBeLessThan(around.cost);
    expect(through.cost).toBe(8);
  });

  it("a climber scales a cliff a walker cannot", () => {
    const cliff = river(["climbable"]);
    expect(across(walker, cliff).reachable).toBe(false);
    expect(across(climber, cliff).reachable).toBe(true);
  });

  it("reachable cells grow with the fastest mode: a flier reaches twice as far on open ground", () => {
    const map = mapWith([], 30, 3);
    const far = (profile: MovementProfile) => Math.max(...findReachableCells(map, { x: 0, y: 1 }, 1, movementReference(profile) / 5, [], { movement: profile }).map(({ cell }) => cell.x));
    expect(far(walker)).toBe(6);
    expect(far(flier)).toBe(12);
  });
});

function scene(definition: CreatureDefinition, terrain: TerrainZone[], from: Point = { x: 1, y: 4 }, opponent?: Point): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const token = (id: string, def: CreatureDefinition, faction: "party" | "enemy", position: Point): CombatantState => ({
    id, definitionId: def.id, displayName: id, faction, position, currentHp: def.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced"
  });
  return {
    ...base, map: { ...base.map, grid: { ...base.map.grid, width: 20, height: 8 }, walls: [], terrain },
    definitions: [fighter, definition],
    combatants: [token("mover", definition, "enemy", from), ...(opponent ? [token("hero", fighter, "party", opponent)] : [])]
  };
}
const creature = (movement: MovementProfile, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  ...fighter, id: "def-mover", name: "Mover", speed: movement.walk, movement, ...extra
});

describe("in play", () => {
  it("the turn's budget is measured in the fastest speed (a bat: 5 walk, 30 fly)", () => {
    const state = createEngineState(scene(creature({ walk: 5, fly: 30 }), []));
    expect(remainingMovementBudget(state.snapshot, state.snapshot.combatants[0]!)).toBe(6);
    const walkerState = createEngineState(scene(creature({ walk: 30 }), []));
    expect(remainingMovementBudget(walkerState.snapshot, walkerState.snapshot.combatants[0]!)).toBe(6);
  });

  it("moveCombatant lets a flier cross deep water in one move, and refuses a walker", () => {
    const deep = column(5, "custom", ["water", "deep"]);
    const flying = createEngineState(scene(creature({ walk: 30, fly: 60 }), deep));
    moveCombatant(flying, "mover", { x: 10, y: 4 });
    expect(flying.snapshot.combatants[0]!.position).toEqual({ x: 10, y: 4 });

    const walking = createEngineState(scene(creature({ walk: 30 }), deep));
    expect(() => moveCombatant(walking, "mover", { x: 10, y: 4 })).toThrow();
  });

  it("a flier is not burned by lava it is above; a walker is", () => {
    const lava = tile(1, 4, "hazard", ["lava"], undefined, { hazard: { trigger: ["on-enter", "start-of-turn-in-zone"], damage: [{ dice: "4d10", damageType: "fire" }] } });
    const flying = createEngineState(scene(creature({ walk: 30, fly: 60 }), [lava]));
    applyTerrainHazardTriggers(flying, "mover", "turn-start");
    expect(flying.snapshot.combatants[0]!.currentHp).toBe(flying.snapshot.definitions[1]!.maxHp);

    const walking = createEngineState(scene(creature({ walk: 30 }), [lava]));
    applyTerrainHazardTriggers(walking, "mover", "turn-start");
    expect(walking.snapshot.combatants[0]!.currentHp).toBeLessThan(walking.snapshot.definitions[1]!.maxHp);
  });

  it("the AI closes on a target across a deep river only if it can cross it", () => {
    const deep = column(10, "custom", ["water", "deep"]);
    const finish = (movement: MovementProfile) => {
      const result = runAutomatedEncounter(scene(creature(movement, { maxHp: 60 }), deep, { x: 6, y: 4 }, { x: 15, y: 4 }), 6);
      return result.log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "mover");
    };
    expect(finish({ walk: 30, fly: 60 })).toBe(true);
    expect(finish({ walk: 30 })).toBe(false);
  });
});

describe("options", () => {
  it("movementOptionsFor keeps ally transit and walk mirrors the sheet's speed", () => {
    expect(movementOptionsFor({ speed: 40, movement: { walk: 30, fly: 60 } })).toEqual({ allowOccupiedTransit: true, occupiedMovementMultiplier: 2, movement: { walk: 40, fly: 60 } });
    expect(movementOptionsFor({ speed: 30 }).movement).toEqual({ walk: 30 });
  });
});
