import { describe, expect, it } from "vitest";
import { createEngineState, resolveAreaSaveAction, sampleEncounter } from "@/engine";
import type { EncounterSnapshot } from "@/engine";

describe("area combat", () => {
  it("resolves saving throws against targets in an area", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "area-save";
    encounter.map.walls = [];
    encounter.definitions[1]?.actions.push({
      kind: "area-save",
      id: "burning-hands",
      name: "Burning Hands",
      actionType: "action",
      saveAbility: "dex",
      dc: 13,
      range: 20,
      area: { type: "cone", size: 20, direction: "east" },
      damage: [{ dice: "6", damageType: "fire" }],
      halfDamageOnSuccess: true,
      affects: "hostile",
      automationSupport: "full"
    });

    const state = createEngineState(encounter);
    const result = resolveAreaSaveAction(state, "pc-archer", { x: 5, y: 3 }, "burning-hands");
    expect(result.targets.some((target) => target.targetId.startsWith("enemy-"))).toBe(true);
    expect(state.log.some((entry) => entry.type === "AreaSaveResolved")).toBe(true);
  });
});
