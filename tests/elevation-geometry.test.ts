import { describe, expect, it } from "vitest";
import {
  cliffEdges,
  distanceWithHeight,
  encounterSnapshotSchema,
  findPath,
  findReachableCells,
  footprintGroundHeight,
  groundHeightAt,
  heightOfSpot,
  planRamp,
  withGroundHeights,
  sampleEncounter,
  type BattleMapState,
  type GridConfig
} from "@/engine";

/** Ground height: walkers take steps up to 5 ft; cliffs stop them, cost climbers, and don't bother fliers. */
const flat = (width = 10, height = 5, elevation?: Record<string, number>): BattleMapState => ({
  ...structuredClone(sampleEncounter.map),
  grid: { ...sampleEncounter.map.grid, width, height },
  walls: [],
  terrain: [],
  elevation: elevation ? { cells: elevation } : undefined
});
const at = (x: number, y: number) => ({ x, y });

/** A tall shelf filling columns 4+ of every row, 10 ft up: a cliff along the whole line between column 3 and 4. */
const shelf = (rise: number, width = 10, height = 5) => {
  const cells: Record<string, number> = {};
  for (let y = 0; y < height; y += 1) for (let x = 4; x < width; x += 1) cells[`${x},${y}`] = rise;
  return flat(width, height, cells);
};

describe("ground height", () => {
  it("reads a cell's height, defaulting to the datum, and a flat map costs nothing", () => {
    const map = flat(6, 3, { "2,1": 10 });
    expect(groundHeightAt(map, at(2, 1))).toBe(10);
    expect(groundHeightAt(map, at(0, 0))).toBe(0);
    expect(groundHeightAt({ elevation: undefined }, at(2, 1))).toBe(0);
  });

  it("a large creature stands on the highest cell under it", () => {
    const map = flat(6, 6, { "2,2": 15 });
    expect(footprintGroundHeight(map, at(1, 1), 2)).toBe(15);
    expect(footprintGroundHeight(map, at(3, 3), 2)).toBe(0);
    expect(heightOfSpot(map, at(1, 1), 2, 20)).toBe(35);
  });
});

describe("walking between heights", () => {
  it("steps up and down a stair-sized rise, and pays nothing extra for it", () => {
    const map = shelf(5);
    const path = findPath(map, at(2, 2), at(6, 2), 1);
    expect(path.reachable).toBe(true);
    expect(path.cost).toBe(4);
  });

  it("can't walk up a cliff", () => {
    const path = findPath(shelf(10), at(2, 2), at(6, 2), 1);
    expect(path.reachable).toBe(false);
  });

  it("walks up a ramp of 5 ft steps instead, going around the cliff to reach it", () => {
    // Column 4+ is 10 ft up; a ramp in row 0 climbs 5 then 10 so the shelf can be reached there.
    const map = shelf(10);
    map.elevation!.cells["3,0"] = 5;
    const path = findPath(map, at(2, 4), at(6, 4), 1);
    expect(path.reachable).toBe(true);
    // It has to head up to row 0, over the ramp at column 3, and back down: far longer than the straight 4 squares.
    expect(path.cost).toBeGreaterThan(4);
    expect(path.cells.some((cell) => cell.x === 3 && cell.y === 0)).toBe(true);
  });

  it("a walker's reachable cells stop at the cliff", () => {
    const reach = findReachableCells(shelf(10), at(2, 2), 1, 10);
    expect(reach.some((entry) => entry.cell.x >= 4)).toBe(false);
    expect(reach.some((entry) => entry.cell.x === 3)).toBe(true);
  });

  it("a climber scales the cliff at a square per 5 ft, and a flier ignores it", () => {
    const map = shelf(10);
    const climber = findPath(map, at(2, 2), at(6, 2), 1, [], { movement: { walk: 30, climb: 30 } });
    expect(climber.reachable).toBe(true);
    // 2 flat squares, a 10 ft cliff (2 squares), 2 more flat: 6 squares' worth against 4 flat.
    expect(climber.cost).toBeCloseTo(5, 5);

    const flier = findPath(map, at(2, 2), at(6, 2), 1, [], { movement: { walk: 30, fly: 60 } });
    expect(flier.reachable).toBe(true);
    // Fastest speed is 60 (12 squares a turn) and a 30-ft walker's square costs 2, so flying is 1 per square.
    expect(flier.cost).toBeCloseTo(4, 5);
  });

  it("a map with no elevation behaves exactly as before", () => {
    const withoutLayer = flat(10, 5);
    const withEmptyLayer = flat(10, 5, {});
    expect(findPath(withoutLayer, at(0, 0), at(9, 4), 1).cost).toBe(findPath(withEmptyLayer, at(0, 0), at(9, 4), 1).cost);
  });
});

describe("distance with height", () => {
  const grid = (mode: GridConfig["diagonalMode"]): GridConfig => ({ ...sampleEncounter.map.grid, diagonalMode: mode });

  it("counts the larger of flat and vertical on a standard grid", () => {
    expect(distanceWithHeight(grid("standard"), at(0, 0), at(0, 0), 30)).toBe(30);
    expect(distanceWithHeight(grid("standard"), at(0, 0), at(1, 0), 5)).toBe(5); // 5 up, 5 across is still 5
    expect(distanceWithHeight(grid("standard"), at(0, 0), at(6, 0), 10)).toBe(30);
  });

  it("treats the vertical like another diagonal under 5-10-5", () => {
    expect(distanceWithHeight(grid("five-ten-five"), at(0, 0), at(2, 0), 10)).toBe(15); // 2 across + 2 up: 2 + floor(2/2)
    expect(distanceWithHeight(grid("five-ten-five"), at(0, 0), at(0, 0), 20)).toBe(20);
  });

  it("is just the flat distance when there's no height difference", () => {
    expect(distanceWithHeight(grid("standard"), at(0, 0), at(3, 4), 0)).toBe(20);
  });
});

describe("saving and importing", () => {
  it("keeps ground heights and altitude through the encounter schema, and no longer strips a painted tile's hazard", () => {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.map.elevation = { cells: { "2,3": 10, "4,4": 5 } };
    snapshot.map.terrain = [{
      id: "lava-1", name: "Lava", type: "hazard", tags: ["lava"], cell: { x: 1, y: 1 },
      polygon: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
      hazard: { trigger: ["on-enter"], damage: [{ dice: "4d10", damageType: "fire" }] }
    }];
    snapshot.combatants[0]!.altitude = 20;
    const parsed = encounterSnapshotSchema.parse(snapshot);
    expect(parsed.map.elevation).toEqual({ cells: { "2,3": 10, "4,4": 5 } });
    expect(parsed.combatants[0]!.altitude).toBe(20);
    expect(parsed.map.terrain[0]!.cell).toEqual({ x: 1, y: 1 });
    expect(parsed.map.terrain[0]!.hazard?.damage?.[0]?.dice).toBe("4d10");
  });
});

describe("ramps, edges and writing heights", () => {
  const mapOf = (elevation?: Record<string, number>) => flat(12, 8, elevation);

  it("a ramp fills in the steps between a low cell and a high cell", () => {
    const map = mapOf({ "0,2": 0, "4,2": 20 });
    const plan = planRamp(map, at(0, 2), at(4, 2), 1);
    expect(plan.cells.map((entry) => entry.height)).toEqual([0, 5, 10, 15, 20]);
    expect(plan.cells.every((entry) => entry.cell.y === 2)).toBe(true);
    expect(plan.walkable).toBe(true);
    expect(plan.steepestStep).toBe(5);
    expect(plan.squaresNeeded).toBe(4);
  });

  it("works from the high end down, and keeps the ends at the heights they already had", () => {
    const map = mapOf({ "0,2": 10, "2,2": 0 });
    const plan = planRamp(map, at(0, 2), at(2, 2), 1);
    expect(plan.cells.map((entry) => [entry.cell.x, entry.height])).toEqual([[0, 10], [1, 5], [2, 0]]);
  });

  it("warns when the slope is too steep to walk, and says how long it needs to be", () => {
    const map = mapOf({ "0,2": 0, "2,2": 30 });
    const plan = planRamp(map, at(0, 2), at(2, 2), 1);
    expect(plan.walkable).toBe(false);
    expect(plan.steepestStep).toBe(15);
    expect(plan.squaresNeeded).toBe(6);
    expect(plan.squaresSpanned).toBe(2);
  });

  it("is as wide as asked, and a walker can use every row of it", () => {
    const map = mapOf({ "0,2": 0, "4,2": 20 });
    const plan = planRamp(map, at(0, 2), at(4, 2), 3);
    const rows = new Set(plan.cells.map((entry) => entry.cell.y));
    expect(rows.size).toBe(3);
    expect(plan.walkable).toBe(true);
    // Every cell in a column has the same height.
    for (const entry of plan.cells) expect(entry.height).toBe(entry.cell.x * 5);
  });

  it("can run on a diagonal, and checks the diagonal steps too", () => {
    const map = mapOf({ "0,0": 0, "3,3": 15 });
    const plan = planRamp(map, at(0, 0), at(3, 3), 1);
    expect(plan.cells.map((entry) => entry.height)).toEqual([0, 5, 10, 15]);
    expect(plan.walkable).toBe(true);
  });

  it("does nothing between a cell and itself", () => {
    expect(planRamp(mapOf(), at(2, 2), at(2, 2), 1).cells).toEqual([]);
  });

  it("finds the edges walkers can't cross: a plateau's open sides, and nothing along 5 ft steps", () => {
    const map = mapOf({ "3,3": 10, "4,3": 10, "5,3": 5, "6,3": 0 });
    const edges = cliffEdges(map);
    // (3,3) is open on three sides, (4,3) on two; the 10 -> 5 -> 0 ft steps eastward are all walkable.
    expect(edges).toHaveLength(5);
    expect(edges.every((edge) => edge.drop === 10)).toBe(true);
    expect(edges).toContainEqual({ x1: 3, y1: 3, x2: 3, y2: 4, drop: 10 }); // west side of (3,3)
    expect(edges).toContainEqual({ x1: 3, y1: 3, x2: 4, y2: 3, drop: 10 }); // its north side
    expect(edges).toContainEqual({ x1: 4, y1: 4, x2: 5, y2: 4, drop: 10 }); // south side of (4,3)
    expect(edges.some((edge) => edge.x1 === 5 && edge.x2 === 5)).toBe(false); // (4,3) -> (5,3) is a 5 ft step
  });

  it("writes heights into the layer, drops a 0, and no cells at all means no layer", () => {
    let layer = withGroundHeights(undefined, [{ cell: at(1, 1), height: 10 }, { cell: at(2, 1), height: -5 }]);
    expect(layer).toEqual({ cells: { "1,1": 10, "2,1": -5 } });
    layer = withGroundHeights(layer, [{ cell: at(1, 1), height: 0 }]);
    expect(layer).toEqual({ cells: { "2,1": -5 } });
    expect(withGroundHeights(layer, [{ cell: at(2, 1), height: 0 }])).toBeUndefined();
  });
});
