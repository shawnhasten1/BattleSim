import { describe, expect, it, beforeEach } from "vitest";
import { sampleEncounter } from "@/engine";
import type { EncounterSnapshot, ZonePersistence } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The "Step" button (`advanceTurn`) re-implements the turn-boundary sequence
 * by hand instead of calling `runAutomatedEncounter` — it originally missed
 * the zone hooks (`applyZoneTriggers` / `driftZones` / `tickZones`) added for
 * Auto Run, so persistent zones silently never triggered, drifted, or
 * expired when a user stepped through combat one turn at a time instead of
 * using Auto Run. These tests drive the real store, not just the engine, so
 * a future re-implementation of `advanceTurn` can't silently drop them again.
 */
function zoneEncounter(zone: ZonePersistence): EncounterSnapshot {
  const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const caster = encounter.definitions.find((definition) => definition.id === "def-fighter");
  if (caster) {
    caster.actions = [{
      kind: "area-save",
      id: "swarm-zone",
      name: "Swarm Zone",
      actionType: "action",
      saveAbility: "con",
      dc: 10,
      range: 60,
      area: { type: "circle", size: 10 },
      targeting: { origin: "point", range: 60 },
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

  // Fixed initiative so `advanceTurn()` (which rolls initiative on its very
  // first call when any combatant lacks one) instead takes this order
  // deterministically: fighter, archer, goblin-1, goblin-2.
  const order: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 10, "enemy-goblin-2": 5 };
  for (const combatant of encounter.combatants) {
    combatant.initiative = order[combatant.id] ?? 0;
  }
  return encounter;
}

describe("Step mode (advanceTurn) respects persistent zones", () => {
  beforeEach(() => {
    useEncounterStore.getState().replaceEncounter(structuredClone(sampleEncounter));
  });

  it("fires start-of-turn-in-zone damage on a combatant standing in the zone", () => {
    const encounter = zoneEncounter({ duration: { kind: "rounds", rounds: 10 }, trigger: ["start-of-turn-in-zone"], anchor: "fixed" });
    useEncounterStore.getState().replaceEncounter(encounter);

    // Step until the goblin (already standing in the zone) has taken its turn.
    for (let i = 0; i < 6; i += 1) {
      useEncounterStore.getState().advanceTurn();
      const log = useEncounterStore.getState().log;
      if (log.some((entry) => entry.type === "TurnStarted" && entry.data?.combatantId === "enemy-goblin-1")) break;
    }

    const log = useEncounterStore.getState().log;
    expect(log.some((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "enemy-goblin-1")).toBe(true);
  });

  it("expires a rounds-limited zone via tickZones as steps advance", () => {
    const encounter = zoneEncounter({ duration: { kind: "rounds", rounds: 1 }, trigger: ["on-enter"], anchor: "fixed" });
    useEncounterStore.getState().replaceEncounter(encounter);

    // Cast it: step until the fighter (index 0) has acted once.
    useEncounterStore.getState().advanceTurn();
    expect(useEncounterStore.getState().encounter.activeZones?.length ?? 0).toBeGreaterThan(0);

    // Keep stepping through a full extra round so the round boundary is crossed.
    for (let i = 0; i < 8; i += 1) {
      useEncounterStore.getState().advanceTurn();
    }

    // Not `activeZones.length === 0`: the caster keeps a target alive and
    // free action economy, so it can (and, once hazard-aware pathing was
    // added, reliably does) re-cast this concentration zone the instant the
    // old one lapses — the list can legitimately read back to 1 the moment
    // after `tickZones` cleared it. What this test actually guards
    // (`advanceTurn` wiring `tickZones` in, per the file docblock) is that
    // an expiry happened at all, not that no zone exists at this exact step.
    expect(useEncounterStore.getState().log.some((entry) => entry.type === "ZoneExpired")).toBe(true);
  });

  it("drifts a Cloudkill-style zone away from its caster as the caster's turns come up", () => {
    const encounter = zoneEncounter({
      duration: { kind: "rounds", rounds: 10 },
      trigger: ["on-enter"],
      anchor: "fixed",
      movement: { driftFeetPerCasterTurn: 10 }
    });
    useEncounterStore.getState().replaceEncounter(encounter);

    // Fighter (the caster) goes first: casts the zone, but drift only applies
    // on the *next* time their own turn comes up.
    useEncounterStore.getState().advanceTurn();
    const originAfterCast = useEncounterStore.getState().encounter.activeZones?.[0]?.origin;
    expect(originAfterCast).toEqual({ x: 5, y: 1 });

    // Step through the rest of the round and back around to the fighter.
    for (let i = 0; i < 4; i += 1) {
      useEncounterStore.getState().advanceTurn();
    }

    const originAfterDrift = useEncounterStore.getState().encounter.activeZones?.[0]?.origin;
    expect(originAfterDrift).not.toEqual(originAfterCast);
    expect(useEncounterStore.getState().log.some((entry) => entry.type === "ZoneMoved")).toBe(true);
  });
});
