import { describe, expect, it } from "vitest";
import { sampleEncounter } from "@/engine";
import type { EncounterSnapshot } from "@/engine";
import { planImageReplacement, shouldWarnBeforeReplacingImage } from "@/store/encounter-store";

function encounterWith(overrides: Partial<EncounterSnapshot["map"]> = {}, hasCombatants = false): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.map = { ...encounter.map, ...overrides };
  if (!hasCombatants) encounter.combatants = [];
  return encounter;
}

describe("shouldWarnBeforeReplacingImage", () => {
  it("never warns when the map has no recorded natural dimensions yet (first upload, or a legacy map)", () => {
    const encounter = encounterWith({ image: undefined, walls: [{ id: "w1", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true }] });
    expect(shouldWarnBeforeReplacingImage(encounter, { width: 400, height: 200 })).toBe(false);
  });

  it("never warns when the map has nothing placed (no walls, terrain, or combatants)", () => {
    const encounter = encounterWith({
      image: { offsetX: 0, offsetY: 0, scale: 100, opacity: 1, naturalWidthPx: 1000, naturalHeightPx: 1000 },
      walls: [],
      terrain: []
    });
    expect(shouldWarnBeforeReplacingImage(encounter, { width: 400, height: 200 })).toBe(false);
  });

  it("warns when a wall is placed and the new image's aspect ratio differs meaningfully", () => {
    const encounter = encounterWith({
      image: { offsetX: 0, offsetY: 0, scale: 100, opacity: 1, naturalWidthPx: 1000, naturalHeightPx: 1000 },
      walls: [{ id: "w1", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true }]
    });
    // 1:1 -> 2:1 is a large ratio change
    expect(shouldWarnBeforeReplacingImage(encounter, { width: 2000, height: 1000 })).toBe(true);
  });

  it("warns when terrain is placed even with no walls", () => {
    const encounter = encounterWith({
      image: { offsetX: 0, offsetY: 0, scale: 100, opacity: 1, naturalWidthPx: 1000, naturalHeightPx: 1000 },
      walls: [],
      terrain: [{ id: "t1", name: "Mud", type: "difficult", polygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }]
    });
    expect(shouldWarnBeforeReplacingImage(encounter, { width: 2000, height: 1000 })).toBe(true);
  });

  it("warns when combatants are placed even with an empty map", () => {
    const encounter = encounterWith(
      { image: { offsetX: 0, offsetY: 0, scale: 100, opacity: 1, naturalWidthPx: 1000, naturalHeightPx: 1000 }, walls: [], terrain: [] },
      true
    );
    expect(shouldWarnBeforeReplacingImage(encounter, { width: 2000, height: 1000 })).toBe(true);
  });

  it("does not warn for a near-identical aspect ratio", () => {
    const encounter = encounterWith({
      image: { offsetX: 0, offsetY: 0, scale: 100, opacity: 1, naturalWidthPx: 1000, naturalHeightPx: 1000 },
      walls: [{ id: "w1", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true }]
    });
    // 1000x1000 -> 1005x995 is within the tolerance
    expect(shouldWarnBeforeReplacingImage(encounter, { width: 1005, height: 995 })).toBe(false);
  });
});

describe("planImageReplacement", () => {
  const WALL = { id: "w1", start: { x: 0, y: 0 }, end: { x: 1, y: 0 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true };

  /** A map of `columns` × `rows` squares, with a wall on it if `placed`. */
  function gridMap(columns: number, rows: number, placed = false): EncounterSnapshot {
    const encounter = encounterWith({ walls: placed ? [WALL] : [], terrain: [] });
    encounter.map.grid = { ...encounter.map.grid, width: columns, height: rows };
    return encounter;
  }
  const upload = (widthPx: number, heightPx: number, fileName = "map.png") => ({ size: { widthPx, heightPx }, fileName });
  const usual = { usualPxPerSquare: 100 };

  it("keeps the grid when a re-export fits it, at any resolution", () => {
    // A 30 × 20 map re-exported at 200 px per square (6000 × 4000).
    const plan = planImageReplacement(gridMap(30, 20), upload(6000, 4000), { hasBackground: true, ...usual });
    expect(plan).toEqual({ kind: "keep-grid", fit: { columns: 30, rows: 20, pxPerSquare: 200 } });
  });

  it("applies the detected grid silently to a blank map, whatever preset it was made with", () => {
    const plan = planImageReplacement(gridMap(40, 30), upload(3000, 2000), { hasBackground: false, ...usual });
    expect(plan).toEqual({ kind: "new-grid", fit: { columns: 30, rows: 20, pxPerSquare: 100 }, confirm: null });
  });

  it("lets the image decide on a blank map even when the preset would fit it", () => {
    // 4800 × 3600 fits 40 × 30 at 120 px, but a blank map's preset is no evidence: 100 px reads 48 × 36.
    const plan = planImageReplacement(gridMap(40, 30), upload(4800, 3600), { hasBackground: false, ...usual });
    expect(plan).toMatchObject({ kind: "new-grid", fit: { columns: 48, rows: 36 } });
  });

  it("asks before changing the grid under placed walls, saying how", () => {
    const plan = planImageReplacement(gridMap(30, 20, true), upload(3200, 2000), { hasBackground: true, ...usual });
    expect(plan.kind).toBe("new-grid");
    if (plan.kind !== "new-grid") return;
    expect(plan.fit).toEqual({ columns: 32, rows: 20, pxPerSquare: 100 });
    expect(plan.confirm).toContain("The new image is 32 × 20 squares; this map is 30 × 20.");
  });

  it("asks Scene Config to ask when nothing is detected", () => {
    expect(planImageReplacement(gridMap(30, 20), upload(2048, 1536), { hasBackground: true, ...usual })).toEqual({ kind: "ask" });
  });

  it("reads the file name", () => {
    const plan = planImageReplacement(gridMap(40, 30), upload(4800, 3600, "Crypt [24x18].png"), { hasBackground: false, ...usual });
    expect(plan).toMatchObject({ kind: "new-grid", fit: { columns: 24, rows: 18, pxPerSquare: 200 } });
  });

  it("leaves a file it couldn't measure unpinned", () => {
    expect(planImageReplacement(gridMap(30, 20), { size: null, fileName: "x.png" }, { hasBackground: true, ...usual })).toEqual({ kind: "unmeasured" });
  });
});
