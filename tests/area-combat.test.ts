import { describe, expect, it } from "vitest";
import { areaFlashForEvent } from "@/lib/combatFeedback";
import { createEngineState, resolveAreaSaveAction, sampleEncounter } from "@/engine";
import type { EncounterSnapshot } from "@/engine";

function encounterWithBurningHands(): EncounterSnapshot {
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
  return encounter;
}

describe("area combat", () => {
  it("resolves saving throws against targets in an area", () => {
    const state = createEngineState(encounterWithBurningHands());
    const result = resolveAreaSaveAction(state, "pc-archer", { x: 5, y: 3 }, "burning-hands");
    expect(result.targets.some((target) => target.targetId.startsWith("enemy-"))).toBe(true);
    expect(state.log.some((entry) => entry.type === "AreaSaveResolved")).toBe(true);
  });

  it("stamps the area shape on ActionDeclared so the replay flash can draw it", () => {
    const encounter = encounterWithBurningHands();
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-archer", { x: 5, y: 3 }, "burning-hands");

    const declared = state.log.find((entry) => entry.type === "ActionDeclared" && entry.data?.actionId === "burning-hands");
    expect(declared).toBeDefined();
    expect(declared!.data?.area).toEqual({ type: "cone", size: 20, direction: "east" });
    expect(declared!.data?.damageType).toBe("fire");

    const flash = areaFlashForEvent(declared!, encounter.map);
    expect(flash).not.toBeNull();
    expect(flash!.origin).toEqual({ x: 5, y: 3 });
    expect(flash!.damageType).toBe("fire");
    expect(flash!.cells.length).toBeGreaterThan(0);
    // east cone from x=5 never reaches west of the origin
    expect(flash!.cells.every((cell) => cell.x >= 5)).toBe(true);
  });
});
