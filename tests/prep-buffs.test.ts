import { describe, expect, it, beforeEach } from "vitest";
import { createEngineState, sampleEncounter, takeAutomatedTurn } from "@/engine";
import type { BuffActionDefinition, EncounterSnapshot } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { actionFromEffectDraft, effectDraftFromAction } from "@/components/sheet/builders/schemas";

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";

function aidAction(overrides: Partial<BuffActionDefinition> = {}): BuffActionDefinition {
  return {
    kind: "buff",
    id: "aid-test",
    name: "Aid",
    actionType: "action",
    range: 30,
    targeting: { target: "chosen", count: 3 },
    prepOnly: true,
    appliedCondition: { id: "aid-test-condition", name: "custom", durationRounds: 100 },
    tempHp: [{ dice: "5" }],
    resourceCost: { resourceId: "slot-1", amount: 1 },
    automationSupport: "full",
    ...overrides
  };
}

function prepEncounter(): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
  definition.actions = [...definition.actions, aidAction()];
  definition.resources = { ...(definition.resources ?? {}), "slot-1": 2 };
  const caster = encounter.combatants.find((c) => c.id === CASTER)!;
  caster.resources = { ...(caster.resources ?? {}), "slot-1": 2 };
  return encounter;
}

function casterCombatant() {
  return useEncounterStore.getState().encounter.combatants.find((c) => c.id === CASTER)!;
}

describe("prep buffs — store toggle", () => {
  beforeEach(() => {
    useEncounterStore.getState().replaceEncounter(prepEncounter());
  });

  it("toggling on applies a permanent condition, spends the resource, and grants temp HP", () => {
    useEncounterStore.getState().togglePrepBuff(CASTER, "aid-test");

    const combatant = casterCombatant();
    const condition = combatant.conditions?.find((c) => c.id === "aid-test-condition");
    expect(condition).toBeDefined();
    expect(condition?.expiresAt).toBeUndefined();
    expect(combatant.resources?.["slot-1"]).toBe(1);
    expect(combatant.tempHp).toBe(5);
  });

  it("toggling off removes the condition and refunds the resource", () => {
    useEncounterStore.getState().togglePrepBuff(CASTER, "aid-test");
    useEncounterStore.getState().togglePrepBuff(CASTER, "aid-test");

    const combatant = casterCombatant();
    expect(combatant.conditions?.some((c) => c.id === "aid-test-condition")).toBe(false);
    expect(combatant.resources?.["slot-1"]).toBe(2);
  });

  it("does not double-spend across an on/off/on cycle", () => {
    useEncounterStore.getState().togglePrepBuff(CASTER, "aid-test");
    useEncounterStore.getState().togglePrepBuff(CASTER, "aid-test");
    useEncounterStore.getState().togglePrepBuff(CASTER, "aid-test");

    expect(casterCombatant().resources?.["slot-1"]).toBe(1);
  });

  it("no-ops for an action that isn't a prepOnly buff on this combatant", () => {
    useEncounterStore.getState().togglePrepBuff(CASTER, "longsword");
    expect(casterCombatant().conditions ?? []).toEqual([]);
  });

  it("restartCombat clears a toggled-on prep buff, its temp HP, and its resource spend", () => {
    useEncounterStore.getState().togglePrepBuff(CASTER, "aid-test");
    useEncounterStore.getState().restartCombat();

    const combatant = casterCombatant();
    expect(combatant.conditions ?? []).toEqual([]);
    expect(combatant.tempHp).toBe(0);
    expect(combatant.resources?.["slot-1"]).toBe(2);
  });
});

describe("prep buffs — AI never casts them in combat", () => {
  it("skips a prepOnly buff entirely, even with no other action available", () => {
    const encounter = prepEncounter();
    encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [aidAction()];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.state = "dead";
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.actionId === "aid-test")).toBe(false);
    expect(actor.resources?.["slot-1"]).toBe(2);
    expect(actor.conditions ?? []).toEqual([]);
  });
});

describe("prep buffs — builder round-trip", () => {
  it("compiles and decompiles the prepOnly toggle", () => {
    const draft = effectDraftFromAction(aidAction());
    expect(draft.prepOnly).toBe(true);

    const compiled = actionFromEffectDraft({ ...draft, shape: "buff" }, { spell: true });
    expect(compiled.kind).toBe("buff");
    expect((compiled as BuffActionDefinition).prepOnly).toBe(true);
  });

  it("defaults prepOnly to falsy for a normal buff", () => {
    const draft = effectDraftFromAction(aidAction({ prepOnly: undefined }));
    expect(draft.prepOnly).toBeFalsy();

    const compiled = actionFromEffectDraft({ ...draft, shape: "buff" }, { spell: true });
    expect((compiled as BuffActionDefinition).prepOnly).toBeUndefined();
  });
});
