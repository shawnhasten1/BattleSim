import { describe, expect, it } from "vitest";
import { createEngineState, moveCombatant, resolveAreaSaveAction, sampleEncounter, updateDefeatState } from "@/engine";
import type { EncounterSnapshot } from "@/engine";

/**
 * `anchor: "self"` zones (Spirit Guardians-style hazard auras) recenter on
 * their source combatant every move (`recenterSelfAnchoredZones`) and, on
 * every such move, sweep for newly-covered targets rather than only
 * checking the mover's own path (`sweepSelfAnchoredZoneOnMove`) — 5e's rule
 * that spirits sweeping into a creature's space damage it, not just the
 * creature walking in. These tests exercise that mechanism directly via
 * `moveCombatant`, the single implementation shared by Auto Run and Step
 * mode, so both call sites are covered by construction.
 */
function selfAuraEncounter(): EncounterSnapshot {
  const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const caster = encounter.definitions.find((definition) => definition.id === "def-fighter");
  if (caster) {
    caster.actions = [{
      kind: "area-save",
      id: "spirit-aura",
      name: "Spirit Aura",
      actionType: "action",
      saveAbility: "con",
      dc: 10,
      range: 15,
      area: { type: "circle", size: 15 },
      targeting: { origin: "self", range: 0 },
      damage: [{ dice: "1", damageType: "radiant" }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "hostile",
      concentration: true,
      zone: { duration: { kind: "concentration" }, trigger: ["on-enter"], anchor: "self" },
      automationSupport: "full"
    }];
  }
  const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter");
  if (fighter) fighter.position = { x: 1, y: 1 };
  return encounter;
}

describe("self-anchored (hazard aura) zones", () => {
  it("plants the zone centered on the caster's own position", () => {
    const encounter = selfAuraEncounter();
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 1, y: 1 }, "spirit-aura");

    const zone = state.snapshot.activeZones?.[0];
    expect(zone?.anchor).toBe("self");
    expect(zone?.origin).toEqual({ x: 1, y: 1 });
  });

  it("recenters on the caster as they move", () => {
    const encounter = selfAuraEncounter();
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 1, y: 1 }, "spirit-aura");

    moveCombatant(state, "pc-fighter", { x: 3, y: 1 });

    expect(state.snapshot.activeZones?.[0]?.origin).toEqual({ x: 3, y: 1 });
  });

  it("damages a stationary hostile the caster's aura sweeps into (not just ones who walk in)", () => {
    const encounter = selfAuraEncounter();
    // 5 squares (25 ft) from the caster's start — outside the 15 ft radius
    // until the caster closes half the distance.
    const goblin = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (goblin) goblin.position = { x: 6, y: 1 };
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 1, y: 1 }, "spirit-aura");
    expect(state.snapshot.activeZones?.[0]?.appliedRounds?.["enemy-goblin-1"]).toBeUndefined();

    // Caster moves to (3,1): now 3 squares (15 ft) from the stationary goblin — just inside.
    moveCombatant(state, "pc-fighter", { x: 3, y: 1 });

    const zone = state.snapshot.activeZones?.[0];
    expect(zone?.appliedRounds?.["enemy-goblin-1"]).toBe(state.snapshot.round);
    expect(state.log.some((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "enemy-goblin-1")).toBe(true);
  });

  it("does not double-apply within the same round across two moves that both cover the target", () => {
    const encounter = selfAuraEncounter();
    const goblin = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
    if (goblin) goblin.position = { x: 3, y: 1 };
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 1, y: 1 }, "spirit-aura");

    // First move brings the goblin (already close) inside for the first time.
    moveCombatant(state, "pc-fighter", { x: 2, y: 1 });
    const hitsAfterFirstMove = state.log.filter((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "enemy-goblin-1").length;
    expect(hitsAfterFirstMove).toBe(1);

    // Second move this same round still covers the goblin — must not re-apply.
    moveCombatant(state, "pc-fighter", { x: 1, y: 1 });
    const hitsAfterSecondMove = state.log.filter((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "enemy-goblin-1").length;
    expect(hitsAfterSecondMove).toBe(1);
  });

  it("disappears when the concentrating caster is downed", () => {
    const encounter = selfAuraEncounter();
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 1, y: 1 }, "spirit-aura");
    expect(state.snapshot.activeZones).toHaveLength(1);

    const fighter = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighter.currentHp = 0;
    updateDefeatState(state, fighter);

    expect(state.snapshot.activeZones).toHaveLength(0);
  });
});
