import { describe, expect, it } from "vitest";
import { encounterSnapshotSchema, sampleEncounter } from "@/engine";
import { isUniversalVttFile, parseUniversalVtt, simplifyPolyline, type UniversalVttMap } from "@/lib/universalVtt";

/** A small Dungeondraft-style export: 10 × 8 squares at 100 px, two walls, a closed door and an open one. */
function dungeon(overrides: Record<string, unknown> = {}) {
  return {
    format: 0.3,
    resolution: { map_origin: { x: 0, y: 0 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
    line_of_sight: [
      // A straight run drawn as three points: one wall.
      [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }],
      // A corner: two walls.
      [{ x: 2, y: 2 }, { x: 2, y: 6 }, { x: 7, y: 6 }]
    ],
    objects_line_of_sight: [],
    portals: [
      { position: { x: 5.5, y: 4 }, bounds: [{ x: 5, y: 4 }, { x: 6, y: 4 }], rotation: 0, closed: true, freestanding: false },
      { position: { x: 8, y: 2.5 }, bounds: [{ x: 8, y: 2 }, { x: 8, y: 3 }], rotation: 1.57, closed: false, freestanding: false }
    ],
    lights: [{ position: { x: 3, y: 3 }, range: 5, intensity: 1, color: "ffffffff", shadows: true }],
    image: "iVBORw0KGgoAAAANSUhEUg",
    ...overrides
  };
}

const parsed = (raw: unknown) => {
  const result = parseUniversalVtt(raw);
  if ("error" in result) throw new Error(result.error);
  return result as UniversalVttMap;
};

describe("parseUniversalVtt", () => {
  it("reads the grid and the image", () => {
    const map = parsed(dungeon());
    expect(map.fit).toEqual({ columns: 10, rows: 8, pxPerSquare: 100 });
    expect(map.size).toEqual({ widthPx: 1000, heightPx: 800 });
    expect(map.dataUrl).toBe("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg");
  });

  it("reads walls, with straight runs as one wall", () => {
    const walls = parsed(dungeon()).walls.filter((wall) => !wall.doorState);
    expect(walls.map((wall) => [wall.start, wall.end])).toEqual([
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 2, y: 2 }, { x: 2, y: 6 }],
      [{ x: 2, y: 6 }, { x: 7, y: 6 }]
    ]);
    expect(walls.every((wall) => wall.blocksMovement && wall.blocksSight && wall.blocksProjectiles && wall.cover === "total")).toBe(true);
  });

  it("reads doors as walls with a door state", () => {
    const map = parsed(dungeon());
    expect(map.doors).toBe(2);
    expect(map.walls.filter((wall) => wall.doorState).map((wall) => [wall.doorState, wall.start, wall.end])).toEqual([
      ["closed", { x: 5, y: 4 }, { x: 6, y: 4 }],
      ["open", { x: 8, y: 2 }, { x: 8, y: 3 }]
    ]);
  });

  it("counts squares from the map's origin", () => {
    const map = parsed(dungeon({
      resolution: { map_origin: { x: 2, y: 3 }, map_size: { x: 10, y: 8 }, pixels_per_grid: 100 },
      line_of_sight: [[{ x: 2, y: 3 }, { x: 12, y: 3 }]],
      portals: []
    }));
    expect(map.walls[0]).toMatchObject({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } });
  });

  it("takes walls from the objects that block sight too, and leaves out zero-length ones", () => {
    const map = parsed(dungeon({
      line_of_sight: [[{ x: 1, y: 1 }, { x: 1, y: 1 }]],
      objects_line_of_sight: [[{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 4 }]],
      portals: []
    }));
    expect(map.walls).toHaveLength(4);
  });

  it("knows a JPEG or WebP image from its first bytes, and keeps a data URL as it is", () => {
    expect(parsed(dungeon({ image: "/9j/4AAQSkZJRg" })).dataUrl).toBe("data:image/jpeg;base64,/9j/4AAQSkZJRg");
    expect(parsed(dungeon({ image: "UklGRiQAAABXRUJQ" })).dataUrl).toBe("data:image/webp;base64,UklGRiQAAABXRUJQ");
    expect(parsed(dungeon({ image: "data:image/png;base64,AAAA" })).dataUrl).toBe("data:image/png;base64,AAAA");
  });

  it("says why a file can't be used", () => {
    expect(parseUniversalVtt({ image: "AAAA" })).toEqual({ error: expect.stringContaining("isn't a Universal VTT map") });
    expect(parseUniversalVtt(dungeon({ image: "" }))).toEqual({ error: expect.stringContaining("no image") });
    expect(parseUniversalVtt(dungeon({ resolution: { map_size: { x: 130, y: 10 }, pixels_per_grid: 100 } }))).toEqual({
      error: "This map is 130 × 10 squares; a map can be 4–120 squares a side."
    });
  });

  it("makes walls the encounter schema accepts", () => {
    const encounter = structuredClone(sampleEncounter);
    encounter.map.walls = parsed(dungeon()).walls;
    expect(encounterSnapshotSchema.parse(encounter).map.walls).toHaveLength(5);
  });
});

describe("simplifyPolyline", () => {
  it("keeps corners and drops points on a straight run", () => {
    expect(simplifyPolyline([{ x: 0, y: 0 }, { x: 1, y: 0.001 }, { x: 3, y: 0 }, { x: 3, y: 4 }])).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 }
    ]);
  });

  it("keeps a closed loop's corners", () => {
    const square = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 0 }];
    expect(simplifyPolyline(square)).toEqual(square);
  });
});

describe("isUniversalVttFile", () => {
  it("knows the Universal VTT extensions", () => {
    expect(["map.dd2vtt", "MAP.UVTT", "map.df2vtt"].every(isUniversalVttFile)).toBe(true);
    expect(["map.png", "map.json", "dd2vtt.png"].some(isUniversalVttFile)).toBe(false);
  });
});
