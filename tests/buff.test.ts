import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  normalizeActionDefinition,
  resolveBuffAction,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { BuffActionDefinition, EncounterSnapshot } from "@/engine";

function baseEncounter(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";

function chosenActionId(state: ReturnType<typeof createEngineState>): string | undefined {
  return state.log.find((e) => e.type === "AiDecision" && e.data?.actionId)?.data?.actionId as string | undefined;
}

function shieldOfFaithAction(overrides: Partial<BuffActionDefinition> = {}): BuffActionDefinition {
  return {
    kind: "buff",
    id: "shield-of-faith-test",
    name: "Shield of Faith",
    actionType: "bonus",
    range: 60,
    targeting: { target: "single" },
    appliedCondition: { id: "shield-of-faith-test-condition", name: "custom", durationRounds: 10, modifiers: { armorClass: 2 } },
    resourceCost: { resourceId: "slot-1", amount: 1 },
    automationSupport: "full",
    ...overrides
  };
}

function blessAction(overrides: Partial<BuffActionDefinition> = {}): BuffActionDefinition {
  return {
    kind: "buff",
    id: "bless-test",
    name: "Bless",
    actionType: "action",
    range: 30,
    targeting: { target: "chosen", count: 3 },
    appliedCondition: { id: "bless-test-condition", name: "custom", durationRounds: 10, modifiers: { attackRoll: 2 } },
    resourceCost: { resourceId: "slot-1", amount: 1 },
    automationSupport: "full",
    ...overrides
  };
}

function giveBuff(encounter: EncounterSnapshot, action: BuffActionDefinition) {
  encounter.definitions.find((d) => d.id === CASTER_DEF)!.actions = [action];
}

describe("buff — resolver", () => {
  it("buffs the caster in self mode", () => {
    const encounter = baseEncounter("buff-self");
    giveBuff(encounter, shieldOfFaithAction({ targeting: { target: "self" } }));
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.resources = { "slot-1": 1 };

    const state = createEngineState(encounter);
    const result = resolveBuffAction(state, CASTER, "shield-of-faith-test", []);

    expect(result.targetIds).toEqual([CASTER]);
    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.conditions?.some((c) => c.id === "shield-of-faith-test-condition" && c.modifiers?.armorClass === 2)).toBe(true);
    expect(after.actionEconomy?.bonus).toBe(false);
    expect(after.resources?.["slot-1"]).toBe(0);
  });

  it("buffs up to the chosen count of allies, leaving the rest untouched", () => {
    const encounter = baseEncounter("buff-chosen");
    giveBuff(encounter, blessAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 5, y: 1 };
    caster.resources = { "slot-1": 1 };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 5, y: 2 };
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.faction = "party";
    goblin1.position = { x: 5, y: 3 };
    const goblin2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.faction = "party";
    goblin2.position = { x: 5, y: 4 };
    // A fourth ally, also in range — count caps the cast at 3.
    encounter.combatants.push({
      ...structuredClone(archer),
      id: "pc-fourth",
      displayName: "Fourth Ally",
      position: { x: 5, y: 5 }
    });

    const state = createEngineState(encounter);
    const result = resolveBuffAction(state, CASTER, "bless-test", ["pc-archer", "enemy-goblin-1", "enemy-goblin-2", "pc-fourth"]);

    expect(result.targetIds).toEqual(["pc-archer", "enemy-goblin-1", "enemy-goblin-2"]);
    const fourth = state.snapshot.combatants.find((c) => c.id === "pc-fourth")!;
    expect(fourth.conditions?.some((c) => c.id === "bless-test-condition")).toBeFalsy();
    for (const id of ["pc-archer", "enemy-goblin-1", "enemy-goblin-2"]) {
      const target = state.snapshot.combatants.find((c) => c.id === id)!;
      expect(target.conditions?.some((c) => c.id === "bless-test-condition" && c.modifiers?.attackRoll === 2), id).toBe(true);
    }
  });

  it("throws and spends nothing when the target is out of range", () => {
    const encounter = baseEncounter("buff-out-of-range");
    giveBuff(encounter, shieldOfFaithAction({ range: 5 }));
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-1": 1 };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 11, y: 7 };

    const state = createEngineState(encounter);
    expect(() => resolveBuffAction(state, CASTER, "shield-of-faith-test", ["pc-archer"])).toThrow(/range/);
    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.resources?.["slot-1"]).toBe(1);
  });

  it("throws when the action is already spent", () => {
    const encounter = baseEncounter("buff-already-spent");
    giveBuff(encounter, shieldOfFaithAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.resources = { "slot-1": 2 };
    caster.actionEconomy = { action: true, bonus: false, reaction: true };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = caster.position;

    const state = createEngineState(encounter);
    expect(() => resolveBuffAction(state, CASTER, "shield-of-faith-test", ["pc-archer"])).toThrow();
  });

  it("breaks the caster's prior concentration buff when casting a new one", () => {
    const encounter = baseEncounter("buff-concentration");
    giveBuff(encounter, shieldOfFaithAction({ concentration: true }));
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.resources = { "slot-1": 2 };
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = caster.position;

    const state = createEngineState(encounter);
    resolveBuffAction(state, CASTER, "shield-of-faith-test", ["pc-archer"]);
    const casterAfterFirst = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    casterAfterFirst.actionEconomy = { action: true, bonus: true, reaction: true };

    resolveBuffAction(state, CASTER, "shield-of-faith-test", [CASTER]);

    const archerAfter = state.snapshot.combatants.find((c) => c.id === "pc-archer")!;
    expect(archerAfter.conditions?.some((c) => c.id === "shield-of-faith-test-condition")).toBe(false);
    expect(state.log.some((e) => e.type === "ConditionExpired" && e.data?.combatantId === "pc-archer")).toBe(true);
  });

  it("grants temp HP once, using the higher roll (no stacking)", () => {
    const encounter = baseEncounter("buff-temp-hp");
    giveBuff(encounter, shieldOfFaithAction({
      targeting: { target: "self" },
      tempHp: [{ dice: "5" }],
      resourceCost: { resourceId: "slot-1", amount: 1 }
    }));
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.resources = { "slot-1": 1 };
    caster.tempHp = 8;

    const state = createEngineState(encounter);
    resolveBuffAction(state, CASTER, "shield-of-faith-test", []);

    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    // Rolled 5, but already had 8 — Math.max, not additive.
    expect(after.tempHp).toBe(8);
  });

  it("stamps spell-level concentration onto a compiled buff action with none of its own", () => {
    const encounter = baseEncounter("buff-concentration-stamp");
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    definition.actions = [];
    definition.spells = [{
      id: "spell-bless", name: "Bless Spell", level: 1, castingTime: "action", range: 30,
      concentration: true,
      resourceCost: { resourceId: "slot-1", amount: 1 },
      automationSupport: "full",
      action: blessAction({ id: "spell-bless-action", concentration: undefined })
    }];

    const state = createEngineState(encounter);
    const compiled = getExecutableActions(state.snapshot.definitions.find((d) => d.id === CASTER_DEF)!)
      .find((a) => a.id === "spell-bless-action");
    expect(compiled?.kind).toBe("buff");
    expect((compiled as BuffActionDefinition).concentration).toBe(true);
  });
});

describe("buff — AI", () => {
  it("picks Shield of Faith as a bonus action alongside a main attack", () => {
    const encounter = baseEncounter("buff-ai-bonus");
    const fighterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    fighterDefinition.actions = [...fighterDefinition.actions, shieldOfFaithAction({ targeting: { target: "self" } })];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-1": 1 };
    const target = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    target.position = { x: 2, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.actionId === "shield-of-faith-test" && e.data?.slot === "bonus")).toBe(true);
    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.conditions?.some((c) => c.id === "shield-of-faith-test-condition")).toBe(true);
  });

  it("does not recast Bless on an already-blessed party", () => {
    const encounter = baseEncounter("buff-ai-already-blessed");
    const fighterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    fighterDefinition.actions = [blessAction()];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-1": 1 };
    caster.conditions = [{ id: "bless-test-condition", name: "custom", startedRound: 1, modifiers: { attackRoll: 2 } }];
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 2, y: 1 };
    archer.conditions = [{ id: "bless-test-condition", name: "custom", startedRound: 1, modifiers: { attackRoll: 2 } }];
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.state = "dead";
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.actionId === "bless-test")).toBe(false);
    expect(actor.resources?.["slot-1"]).toBe(1);
  });

  it("skips Bless in favor of a lethal attack that's available", () => {
    const encounter = baseEncounter("buff-ai-lethal-attack");
    const fighterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    fighterDefinition.actions = [...fighterDefinition.actions, blessAction()];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-1": 1 };
    const target = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    target.position = { x: 2, y: 1 };
    target.currentHp = 1;
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(chosenActionId(state)).toBe("longsword");
  });
});

describe("buff — import normalization", () => {
  it("round-trips a raw buff action, not degrading it to unsupported", () => {
    const normalized = normalizeActionDefinition({
      kind: "buff", name: "Bless", actionType: "action", range: 30,
      targeting: { target: "chosen", count: 3 },
      appliedCondition: { durationRounds: 10, modifiers: { attackRoll: 2 } }
    });
    expect(normalized.kind).toBe("buff");
  });
});
