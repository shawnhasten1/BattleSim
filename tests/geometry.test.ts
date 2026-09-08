import { describe, expect, it } from "vitest";
import {
  findPath,
  findReachableCells,
  gridDistance,
  isFootprintLegal,
  lineOfEffect,
  movementCostForCell,
  sampleEncounter,
  cellsInArea
} from "@/engine";
import type { BattleMapState } from "@/engine";

describe("geometry", () => {
  it("supports standard and five-ten-five diagonal distance", () => {
    expect(gridDistance({ x: 0, y: 0 }, { x: 3, y: 3 }, sampleEncounter.map.grid)).toBe(15);
    expect(gridDistance(
      { x: 0, y: 0 },
      { x: 3, y: 3 },
      { ...sampleEncounter.map.grid, diagonalMode: "five-ten-five" }
    )).toBe(20);
  });

  it("blocks line of effect through projectile-blocking walls", () => {
    expect(lineOfEffect(sampleEncounter.map, { x: 1, y: 1 }, { x: 8, y: 2 })).toBe(false);
  });

  it("routes around movement-blocking walls when a legal path exists", () => {
    const path = findPath(sampleEncounter.map, { x: 1, y: 1 }, { x: 8, y: 2 }, 1);
    expect(path.reachable).toBe(true);
    expect(path.cells.length).toBeGreaterThan(2);
    expect(path.cost).toBeGreaterThan(7);
  });

  it("charges extra movement for difficult terrain", () => {
    expect(movementCostForCell(sampleEncounter.map.terrain, { x: 2, y: 4 })).toBe(2);
  });

  it("allows transit through occupied cells at half movement speed without allowing occupied destinations", () => {
    const map: BattleMapState = {
      id: "occupied-lane",
      name: "Occupied Lane",
      grid: { width: 5, height: 1, distancePerSquare: 5, diagonalMode: "standard" },
      walls: [],
      terrain: []
    };
    const occupied = [{ x: 2, y: 0 }];

    const path = findPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }, 1, occupied, {
      allowOccupiedTransit: true,
      occupiedMovementMultiplier: 2
    });
    const occupiedDestination = findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }, 1, occupied, {
      allowOccupiedTransit: true,
      occupiedMovementMultiplier: 2
    });
    const reachable = findReachableCells(map, { x: 0, y: 0 }, 1, 5, occupied, {
      allowOccupiedTransit: true,
      occupiedMovementMultiplier: 2
    });

    expect(path.reachable).toBe(true);
    expect(path.cost).toBe(5);
    expect(path.cells).toContainEqual({ x: 2, y: 0 });
    expect(occupiedDestination.reachable).toBe(false);
    expect(reachable).toContainEqual(expect.objectContaining({ cell: { x: 4, y: 0 }, cost: 5 }));
    expect(reachable).not.toContainEqual(expect.objectContaining({ cell: { x: 2, y: 0 }, cost: 3 }));
  });

  it("rejects a large creature footprint in a one-square corridor", () => {
    const corridor: BattleMapState = {
      id: "corridor",
      name: "Corridor",
      grid: { width: 4, height: 4, distancePerSquare: 5, diagonalMode: "standard" },
      walls: [],
      terrain: [
        {
          id: "top-block",
          name: "Top Block",
          type: "impassable",
          polygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 1 },
            { x: 0, y: 1 }
          ]
        },
        {
          id: "bottom-block",
          name: "Bottom Block",
          type: "impassable",
          polygon: [
            { x: 0, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
          ]
        }
      ]
    };

    expect(isFootprintLegal(corridor, { x: 1, y: 1 }, 1)).toBe(true);
    expect(isFootprintLegal(corridor, { x: 1, y: 1 }, 2)).toBe(false);
  });

  it("identifies cells affected by an area template", () => {
    const cells = cellsInArea(sampleEncounter.map, { x: 3, y: 3 }, { type: "circle", size: 10 });
    expect(cells).toContainEqual({ x: 3, y: 3 });
    expect(cells).toContainEqual({ x: 4, y: 3 });
    expect(cells).not.toContainEqual({ x: 8, y: 3 });
  });
});
