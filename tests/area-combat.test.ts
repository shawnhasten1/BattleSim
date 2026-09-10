import { describe, expect, it } from "vitest";
import { areaFlashForEvent } from "@/lib/combatFeedback";
import { createEngineState, resolveAreaSaveAction, sampleEncounter } from "@/engine";
import type { EncounterSnapshot, RandomSource } from "@/engine";

function scriptedRng(valuesBySides: Record<number, number[]>): RandomSource {
  const indexes: Record<number, number> = {};
  const make = (): RandomSource => ({
    next: () => 0,
    nextInt: (minInclusive: number, maxInclusive: number) => {
      const index = indexes[maxInclusive] ?? 0;
      indexes[maxInclusive] = index + 1;
      const value = valuesBySides[maxInclusive]?.[index] ?? minInclusive;
      return Math.min(Math.max(value, minInclusive), maxInclusive);
    },
    fork: make
  });
  return make();
}

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

  it("rolls the blast damage once and applies the same number to every creature (half on a save)", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.seed = "fireball-shared-roll";
    encounter.map.walls = [];
    encounter.combatants = [
      { id: "mage", definitionId: "def-archer", displayName: "Mage", faction: "party",
        position: { x: 1, y: 1 }, currentHp: 24, tempHp: 0, state: "active", tacticsProfile: "basic-ranged" },
      { id: "g1", definitionId: "def-goblin", displayName: "G1", faction: "enemy",
        position: { x: 8, y: 4 }, currentHp: 80, tempHp: 0, state: "active", tacticsProfile: "basic-melee" },
      { id: "g2", definitionId: "def-goblin", displayName: "G2", faction: "enemy",
        position: { x: 9, y: 4 }, currentHp: 80, tempHp: 0, state: "active", tacticsProfile: "basic-melee" },
      { id: "g3", definitionId: "def-goblin", displayName: "G3", faction: "enemy",
        position: { x: 8, y: 5 }, currentHp: 80, tempHp: 0, state: "active", tacticsProfile: "basic-melee" }
    ];
    encounter.definitions.find((d) => d.id === "def-archer")!.actions.push({
      kind: "area-save", id: "fireball", name: "Fireball", actionType: "action", saveAbility: "dex",
      dc: 12, range: 150, area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 150 },
      damage: [{ dice: "8d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half",
      affects: "hostile", automationSupport: "full"
    });

    const state = createEngineState(encounter);
    // blast: 8d6 all 1s → 8. Then per-target saves: g1/g2 fail (2), g3 saves (20).
    // A per-target re-roll would give g2 the next 8d6 (all 6s → 48).
    state.rng = scriptedRng({ 6: [1, 1, 1, 1, 1, 1, 1, 1, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6], 20: [2, 2, 20] });
    const result = resolveAreaSaveAction(state, "mage", { x: 8, y: 4 }, "fireball");

    const dmg = Object.fromEntries(result.targets.map((t) => [t.targetId, t.damageApplied]));
    expect(dmg.g1).toBe(8);
    expect(dmg.g2).toBe(8); // same roll as g1, not a fresh 8d6
    expect(dmg.g3).toBe(4); // saved → exactly half of the shared roll
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
