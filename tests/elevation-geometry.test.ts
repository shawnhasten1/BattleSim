import { describe, expect, it } from "vitest";
import {
  distanceWithHeight,
  encounterSnapshotSchema,
  findPath,
  findReachableCells,
  footprintGroundHeight,
  groundHeightAt,
  heightOfSpot,
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
