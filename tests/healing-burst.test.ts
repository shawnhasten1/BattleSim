import { describe, expect, it } from "vitest";
import {
  combatantsInArea,
  createEngineState,
  resolveHealingBurstAction,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { EncounterSnapshot, HealingActionDefinition } from "@/engine";

function baseEncounter(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";

function prayerOfHealingAction(overrides: Partial<HealingActionDefinition> = {}): HealingActionDefinition {
  return {
    kind: "healing",
    id: "prayer-of-healing-test",
    name: "Prayer of Healing",
    actionType: "action",
    range: 60,
    healing: [{ dice: "4" }],
    targeting: { target: "chosen", count: 3 },
    resourceCost: { resourceId: "slot-2", amount: 1 },
    automationSupport: "full",
    ...overrides
  };
}

function massCureWoundsAction(overrides: Partial<HealingActionDefinition> = {}): HealingActionDefinition {
  return {
    kind: "healing",
    id: "mass-cure-wounds-test",
    name: "Mass Cure Wounds",
    actionType: "action",
    range: 60,
    healing: [{ dice: "4" }],
    targeting: { target: "area" },
    area: { type: "circle", size: 30 },
    areaTargeting: { origin: "point", range: 60 },
    resourceCost: { resourceId: "slot-5", amount: 1 },
    automationSupport: "full",
    ...overrides
  };
}

function giveHealing(encounter: EncounterSnapshot, action: HealingActionDefinition) {
  encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [action];
}

describe("healing burst — resolver", () => {
  it("chosen mode heals each target by the same rolled amount, each clamped to their own max HP", () => {
    const encounter = baseEncounter("burst-chosen");
    giveHealing(encounter, prayerOfHealingAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 2, y: 1 };
    archer.currentHp = 1;
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.faction = "party";
    goblin1.position = { x: 3, y: 1 };
    goblin1.currentHp = 5; // maxHp 7 — clamps to 7, not 5+4=9

    const state = createEngineState(encounter);
    const result = resolveHealingBurstAction(state, CASTER, "prayer-of-healing-test", ["pc-archer", "enemy-goblin-1"]);

    expect(result.healingApplied).toBe(4);
    expect(result.targetIds).toEqual(["pc-archer", "enemy-goblin-1"]);
    expect(state.snapshot.combatants.find((c) => c.id === "pc-archer")!.currentHp).toBe(5);
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp).toBe(7);
    const casterAfter = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(casterAfter.resources?.["slot-2"]).toBe(0);
  });

  it("area mode heals allies caught in the burst, excludes an enemy inside it, and revives a downed ally inside it", () => {
    const encounter = baseEncounter("burst-area");
    giveHealing(encounter, massCureWoundsAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-5": 1 };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 5, y: 1 };
    archer.currentHp = 1;
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.faction = "enemy";
    goblin1.position = { x: 5, y: 2 };
    goblin1.currentHp = 1;
    const goblin2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.faction = "party";
    goblin2.position = { x: 5, y: 3 };
    goblin2.currentHp = 0;
    goblin2.state = "downed";
    goblin2.deathSaves = { successes: 0, failures: 0, stable: false };

    const state = createEngineState(encounter);
    resolveHealingBurstAction(state, CASTER, "mass-cure-wounds-test", [], { x: 5, y: 2 });

    expect(state.snapshot.combatants.find((c) => c.id === "pc-archer")!.currentHp).toBe(5);
    // Enemy inside the same burst radius is never a target — healing bursts always heal same-faction only.
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp).toBe(1);
    const revived = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-2")!;
    expect(revived.state).toBe("active");
    expect(revived.currentHp).toBe(4);
  });

  it("throws when there's no area to place", () => {
    const encounter = baseEncounter("burst-no-aim");
    giveHealing(encounter, massCureWoundsAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.resources = { "slot-5": 1 };

    const state = createEngineState(encounter);
    expect(() => resolveHealingBurstAction(state, CASTER, "mass-cure-wounds-test", [])).toThrow();
  });
});

describe("combatantsInArea — includeDowned option", () => {
  it("excludes downed combatants by default", () => {
    const encounter = baseEncounter("burst-include-downed-default");
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 5, y: 1 };
    archer.state = "downed";
    const definitionsById = new Map(encounter.definitions.map((d) => [d.id, d]));

    const found = combatantsInArea(encounter.map, { x: 5, y: 1 }, { type: "circle", size: 10 }, encounter.combatants, definitionsById);
    expect(found.some((c) => c.id === "pc-archer")).toBe(false);
  });

  it("includes downed combatants when includeDowned is set", () => {
    const encounter = baseEncounter("burst-include-downed-true");
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 5, y: 1 };
    archer.state = "downed";
    const definitionsById = new Map(encounter.definitions.map((d) => [d.id, d]));

    const found = combatantsInArea(encounter.map, { x: 5, y: 1 }, { type: "circle", size: 10 }, encounter.combatants, definitionsById, undefined, { includeDowned: true });
    expect(found.some((c) => c.id === "pc-archer")).toBe(true);
  });
});

describe("healing burst — AI", () => {
  it("picks a multi-target heal over a single-target heal when several allies are wounded", () => {
    const encounter = baseEncounter("burst-ai-picks-burst");
    const fighterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    fighterDefinition.actions = [{
      kind: "healing", id: "cure-wounds-test", name: "Cure Wounds", actionType: "action", range: 30,
      healing: [{ dice: "4" }], targeting: { target: "single" },
      resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full"
    }, prayerOfHealingAction()];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-1": 1, "slot-2": 1 };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 2, y: 1 };
    archer.currentHp = 1;
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.faction = "party";
    goblin1.position = { x: 3, y: 1 };
    goblin1.currentHp = 1;
    const goblin2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.faction = "party";
    goblin2.position = { x: 4, y: 1 };
    goblin2.currentHp = 1;

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.actionId === "prayer-of-healing-test")).toBe(true);
  });

  it("still prioritizes healing over offense even for a burst heal", () => {
    const encounter = baseEncounter("burst-ai-outranks-offense");
    const fighterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    fighterDefinition.actions = [...fighterDefinition.actions, prayerOfHealingAction()];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 2, y: 1 };
    archer.currentHp = 1;
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.faction = "party";
    goblin1.position = { x: 3, y: 1 };
    goblin1.currentHp = 1;
    const target = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    target.position = { x: 2, y: 2 };

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.actionId === "prayer-of-healing-test")).toBe(true);
    expect(state.log.some((e) => e.type === "AttackRolled")).toBe(false);
  });
});
