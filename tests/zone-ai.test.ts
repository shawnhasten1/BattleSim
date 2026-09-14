import { describe, expect, it } from "vitest";
import { createEngineState, sampleEncounter, takeAutomatedTurn } from "@/engine";
import type { EncounterSnapshot } from "@/engine";

/**
 * Phase 3 predictive placement: a persistent-zone spell's scoring credits a
 * hostile who isn't caught in the blast yet but whose shortest path to its
 * nearest target on the caster's side runs through the candidate zone (see
 * `predictedZoneApproachValue` in simulation.ts). This scenario is built so
 * the "near" and "chokepoint" candidates are otherwise perfectly symmetric
 * (same distance from the caster, identical target stats) — only the
 * predictive term should break the tie.
 */
describe("persistent-zone AI placement", () => {
  it("prefers a zone origin that sits on a hostile's likely approach route over an equally-close one that doesn't", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    encounter.map.terrain = [];
    encounter.seed = "zone-predictive-placement";

    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighter.position = { x: 1, y: 1 };

    // Only one ally reference point, so "the caster's side" is unambiguous.
    const archer = encounter.combatants.find((combatant) => combatant.id === "pc-archer")!;
    archer.state = "dead";

    // Same Chebyshev distance (5 squares) from the caster as the chokepoint
    // below, but off the far hostile's straight route home — should get no
    // predictive credit.
    const nearOffPath = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
    nearOffPath.position = { x: 1, y: 6 };

    // Sits directly on the far hostile's straight route back toward the
    // caster (both on row y=1) — should get predictive credit.
    const chokepoint = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-2")!;
    chokepoint.position = { x: 6, y: 1 };

    encounter.combatants.push({
      id: "enemy-goblin-3",
      definitionId: "def-goblin",
      displayName: "Goblin 3",
      faction: "enemy",
      position: { x: 11, y: 1 },
      currentHp: 7,
      tempHp: 0,
      state: "active",
      tacticsProfile: "basic-melee",
      resourceStance: "balanced"
    });

    const casterDefinition = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    casterDefinition.actions = [{
      kind: "area-save",
      id: "swarm-zone",
      name: "Swarm Zone",
      actionType: "action",
      saveAbility: "con",
      dc: 10,
      range: 60,
      area: { type: "circle", size: 10 },
      targeting: { origin: "point", range: 60 },
      damage: [{ dice: "1d4", damageType: "poison" }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "hostile",
      zone: { duration: { kind: "rounds", rounds: 5 }, trigger: ["on-enter"], anchor: "fixed" },
      automationSupport: "full"
    }];

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!);

    const decision = state.log.find((entry) => entry.type === "AiDecision" && entry.data?.actionId === "swarm-zone");
    expect(decision, "should have cast the zone spell").toBeDefined();
    expect(decision!.data!.targetId).toBe("enemy-goblin-2");
    expect((decision!.data!.reasons as string[]).some((reason) => reason.includes("blocks a likely approach route"))).toBe(true);

    const resolved = state.log.find((entry) => entry.type === "AreaSaveResolved");
    expect(resolved!.data!.origin).toEqual({ x: 6, y: 1 });
  });
});
