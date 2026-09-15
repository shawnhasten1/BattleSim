import { describe, expect, it } from "vitest";
import {
  createEngineState,
  resolveAreaSaveAction,
  runTurnEnd,
  runTurnStart,
  sampleEncounter
} from "@/engine";
import type { EncounterSnapshot, ZonePersistence } from "@/engine";

/**
 * `runTurnStart`/`runTurnEnd` (src/engine/combat.ts) replace two previously
 * hand-synced turn-boundary sequences — `runAutomatedEncounter` (Auto Run)
 * and the Step button's `advanceTurn` — that had already drifted apart once
 * (a missing-zone-hook regression) and were drifted again at the time of
 * this extraction (`resetActionEconomy` ran first in one, last in the
 * other). These tests cover the shared functions directly so a future
 * change can't silently drop a step from one call site without the other.
 */
function zoneSpellEncounter(zone: ZonePersistence): EncounterSnapshot {
  const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
  encounter.map.walls = [];
  const caster = encounter.definitions.find((definition) => definition.id === "def-fighter");
  if (caster) {
    caster.actions = [{
      kind: "area-save",
      id: "swarm-zone",
      name: "Swarm Zone",
      actionType: "action",
      saveAbility: "con",
      dc: 10,
      range: 30,
      area: { type: "circle", size: 10 },
      targeting: { origin: "point", range: 30 },
      damage: [{ dice: "1", damageType: "poison" }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "hostile",
      concentration: true,
      zone,
      automationSupport: "full"
    }];
  }
  const enemy = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1");
  if (enemy) enemy.position = { x: 5, y: 1 };
  return encounter;
}

describe("runTurnStart", () => {
  it("resets a stale action economy and clears turn flags", () => {
    const state = createEngineState(structuredClone(sampleEncounter));
    const actor = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    actor.actionEconomy = { action: false, bonus: false, reaction: false };
    actor.turnFlags = { dashed: true, disengaged: true };

    runTurnStart(state, actor);

    expect(actor.actionEconomy).toEqual({ action: true, bonus: true, reaction: true });
    expect(actor.turnFlags).toBeUndefined();
  });

  it("still fires start-of-turn-in-zone for a combatant standing in the zone", () => {
    const encounter = zoneSpellEncounter({ duration: { kind: "concentration" }, trigger: ["start-of-turn-in-zone"], anchor: "fixed" });
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 5, y: 1 }, "swarm-zone");
    const goblin = state.snapshot.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;

    runTurnStart(state, goblin);

    const zone = state.snapshot.activeZones?.[0];
    expect(zone?.appliedRounds?.["enemy-goblin-1"]).toBe(state.snapshot.round);
  });

  it("drifts a caster's movement-tagged zone at the start of the caster's own turn", () => {
    const encounter = zoneSpellEncounter({
      duration: { kind: "concentration" },
      trigger: ["on-enter"],
      anchor: "fixed",
      movement: { driftFeetPerCasterTurn: 10 }
    });
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 5, y: 1 }, "swarm-zone");
    const originBefore = { ...state.snapshot.activeZones![0]!.origin };
    const fighter = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;

    runTurnStart(state, fighter);

    const originAfter = state.snapshot.activeZones![0]!.origin;
    expect(originAfter).not.toEqual(originBefore);
  });
});

describe("runTurnEnd", () => {
  it("fires end-of-turn-in-zone for a combatant standing in the zone", () => {
    const encounter = zoneSpellEncounter({ duration: { kind: "concentration" }, trigger: ["end-of-turn-in-zone"], anchor: "fixed" });
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "pc-fighter", { x: 5, y: 1 }, "swarm-zone");
    const goblin = state.snapshot.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;

    runTurnEnd(state, goblin.id);

    const zone = state.snapshot.activeZones?.[0];
    expect(zone?.appliedRounds?.["enemy-goblin-1"]).toBe(state.snapshot.round);
  });

  it("expires a start-timed condition at the matching turn boundary", () => {
    const state = createEngineState(structuredClone(sampleEncounter));
    const actor = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    actor.conditions = [{
      id: "cond-1",
      name: "poisoned",
      startedRound: state.snapshot.round,
      expiresAt: { round: state.snapshot.round, turnIndex: state.snapshot.turnIndex, timing: "end" }
    }];

    runTurnEnd(state, actor.id);

    expect(actor.conditions).toHaveLength(0);
  });
});
