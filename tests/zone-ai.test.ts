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

/**
 * Phase 3's remaining item: Moonbeam-style caster-directed repositioning.
 * `maybeRepositionZone` (simulation.ts) only runs once a real bonus-action
 * spell/heal has had its shot, so this scenario gives the caster no bonus
 * actions at all — the only thing that can happen with a leftover bonus
 * action is the zone chasing the hostile it didn't already catch.
 */
describe("persistent-zone AI repositioning", () => {
  it("spends a leftover bonus action moving a repositionable zone toward an uncaught hostile (Moonbeam)", () => {
    const encounter: EncounterSnapshot = structuredClone(sampleEncounter);
    encounter.map.walls = [];
    encounter.map.terrain = [];
    encounter.seed = "zone-reposition";

    const fighter = encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
    fighter.position = { x: 1, y: 1 };
    const archer = encounter.combatants.find((combatant) => combatant.id === "pc-archer")!;
    archer.state = "dead";

    // Much closer than the other hostile (so it's overwhelmingly the AI's
    // preferred initial cast target), but still far enough from the caster
    // that a 5 ft-radius blast centred on it doesn't also catch the caster
    // as friendly fire.
    const near = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
    near.position = { x: 4, y: 1 };
    // Far enough that a 5 ft-radius blast on the near hostile can't also
    // catch this one, but within the 60 ft reposition cap of that cast point.
    const far = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-2")!;
    far.position = { x: 11, y: 1 };

    const casterDefinition = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    casterDefinition.actions = [{
      kind: "area-save",
      id: "moonbeam",
      name: "Moonbeam",
      actionType: "action",
      saveAbility: "con",
      dc: 10,
      range: 60,
      area: { type: "circle", size: 5 },
      targeting: { origin: "point", range: 60 },
      damage: [{ dice: "2d10", damageType: "radiant" }],
      halfDamageOnSuccess: true,
      onSuccess: "half",
      affects: "hostile",
      zone: {
        duration: { kind: "rounds", rounds: 5 },
        trigger: ["on-enter"],
        anchor: "fixed",
        repositionable: { maxFeetPerCasterTurn: 60 }
      },
      automationSupport: "full"
    }];
    // No bonus-action actions at all — the only reason a bonus action gets
    // spent this turn is `maybeRepositionZone`.
    casterDefinition.bonusActions = [];

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter")!);

    const cast = state.log.find((entry) => entry.type === "AreaSaveResolved");
    expect(cast, "should have cast Moonbeam").toBeDefined();
    expect(cast!.data!.origin).toEqual({ x: 4, y: 1 });

    const reposition = state.log.find((entry) => entry.type === "AiDecision" && entry.data?.slot === "bonus" && entry.data?.zoneId);
    expect(reposition, "should have repositioned the zone toward the uncaught hostile").toBeDefined();
    expect(reposition!.data!.targetId).toBe("enemy-goblin-2");

    const zone = state.snapshot.activeZones?.[0];
    // 7 squares = 35 ft, under the 60 ft cap — the zone reaches the far hostile exactly.
    expect(zone?.origin).toEqual({ x: 11, y: 1 });

    const caster = state.snapshot.combatants.find((combatant) => combatant.id === "pc-fighter");
    expect(caster?.actionEconomy?.bonus).toBe(false);
  });
});
