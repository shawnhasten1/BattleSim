import { describe, expect, it } from "vitest";
import { sampleEncounter } from "@/engine";
import type { EncounterSnapshot } from "@/engine";
import { shouldWarnBeforeReplacingImage } from "@/store/encounter-store";

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
