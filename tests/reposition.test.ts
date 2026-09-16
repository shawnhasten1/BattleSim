import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  normalizeActionDefinition,
  resolveRepositionAction,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type {
  ActiveZone,
  CombatantState,
  CreatureDefinition,
  EncounterSnapshot,
  RepositionActionDefinition,
  WallSegment
} from "@/engine";

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

function mistyStepAction(overrides: Partial<RepositionActionDefinition> = {}): RepositionActionDefinition {
  return {
    kind: "reposition",
    id: "misty-step-test",
    name: "Misty Step",
    actionType: "bonus",
    range: 30,
    targeting: { target: "self" },
    resourceCost: { resourceId: "slot-2", amount: 1 },
    automationSupport: "full",
    ...overrides
  };
}

function giveReposition(encounter: EncounterSnapshot, action: RepositionActionDefinition): CreatureDefinition {
  const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
  definition.actions = [action];
  return definition;
}

describe("reposition — resolver", () => {
  it("teleports the caster to a chosen destination, spending the bonus action and resource", () => {
    const encounter = baseEncounter("reposition-happy");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };

    const state = createEngineState(encounter);
    const result = resolveRepositionAction(state, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test");

    expect(result.moved).toBe(true);
    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.position).toEqual({ x: 4, y: 1 });
    expect(after.actionEconomy?.bonus).toBe(false);
    expect(after.resources?.["slot-2"]).toBe(0);
    const moveEvent = state.log.find((e) => e.type === "CombatantMoved");
    expect(moveEvent?.data).toMatchObject({ combatantId: CASTER, destination: { x: 4, y: 1 }, teleport: true });
  });

  it("throws and spends nothing when the destination is beyond range", () => {
    const encounter = baseEncounter("reposition-out-of-range");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };

    const state = createEngineState(encounter);
    expect(() => resolveRepositionAction(state, CASTER, CASTER, { x: 11, y: 1 }, "misty-step-test")).toThrow(/range/);

    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.position).toEqual({ x: 1, y: 1 });
    expect(after.actionEconomy?.bonus ?? true).toBe(true);
    expect(after.resources?.["slot-2"]).toBe(1);
  });

  it("throws when the destination is occupied", () => {
    const encounter = baseEncounter("reposition-occupied");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 4, y: 1 };

    const state = createEngineState(encounter);
    expect(() => resolveRepositionAction(state, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test")).toThrow(/occupied/);
  });

  it("throws when the destination is impassable terrain", () => {
    const encounter = baseEncounter("reposition-impassable");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    encounter.map.terrain = [{
      id: "pit", name: "Pit", type: "impassable",
      polygon: [{ x: 4, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 4, y: 2 }]
    }];

    const state = createEngineState(encounter);
    expect(() => resolveRepositionAction(state, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test")).toThrow(/occupied|impassable/);
  });

  it("blocks the destination when requiresLineOfEffect is set and a wall stands between; bypasses it by default", () => {
    const wall: WallSegment = {
      id: "door", start: { x: 3, y: 0 }, end: { x: 3, y: 3 },
      blocksMovement: false, blocksSight: false, blocksProjectiles: true, cover: "total"
    };

    // Default (requiresLineOfEffect omitted): the wall is bypassed.
    const bypassEncounter = baseEncounter("reposition-los-bypass");
    giveReposition(bypassEncounter, mistyStepAction());
    bypassEncounter.rules.requireLineOfEffect = true;
    bypassEncounter.map.walls = [wall];
    const bypassCaster = bypassEncounter.combatants.find((c) => c.id === CASTER)!;
    bypassCaster.position = { x: 1, y: 1 };
    bypassCaster.resources = { "slot-2": 1 };
    const bypassState = createEngineState(bypassEncounter);
    expect(() => resolveRepositionAction(bypassState, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test")).not.toThrow();

    // Opted in (requiresLineOfEffect: true): the same wall now blocks it.
    const gatedEncounter = baseEncounter("reposition-los-gated");
    giveReposition(gatedEncounter, mistyStepAction({ requiresLineOfEffect: true }));
    gatedEncounter.rules.requireLineOfEffect = true;
    gatedEncounter.map.walls = [wall];
    const gatedCaster = gatedEncounter.combatants.find((c) => c.id === CASTER)!;
    gatedCaster.position = { x: 1, y: 1 };
    gatedCaster.resources = { "slot-2": 1 };
    const gatedState = createEngineState(gatedEncounter);
    expect(() => resolveRepositionAction(gatedState, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test")).toThrow(/[Ll]ine of effect/);
  });

  it("triggers no opportunity attack or reaction while teleporting past an adjacent hostile", () => {
    const encounter = baseEncounter("reposition-no-oa");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    // Adjacent to the straight line between start and destination — a normal
    // walk between them would provoke; a teleport must not.
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };

    const state = createEngineState(encounter);
    resolveRepositionAction(state, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test");

    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(false);
    expect(state.log.some((e) => e.type === "ReactionTriggered")).toBe(false);
  });

  it("fires an on-enter zone covering only the destination, not an intermediate cell", () => {
    const encounter = baseEncounter("reposition-zone-enter");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };

    const zoneAtDestination: ActiveZone = {
      id: "zone-dest", name: "Trap Zone", sourceCombatantId: "enemy-goblin-1", sourceActionId: "trap",
      origin: { x: 4, y: 1 }, area: { type: "circle", size: 5 }, anchor: "fixed", affects: "all",
      trigger: ["on-enter"], concentration: false, createdRound: 1
    };
    const zoneBetween: ActiveZone = {
      id: "zone-between", name: "Passed-Over Zone", sourceCombatantId: "enemy-goblin-1", sourceActionId: "trap",
      origin: { x: 2, y: 1 }, area: { type: "circle", size: 5 }, anchor: "fixed", affects: "all",
      trigger: ["on-enter"], concentration: false, createdRound: 1
    };
    encounter.activeZones = [zoneAtDestination, zoneBetween];

    const state = createEngineState(encounter);
    resolveRepositionAction(state, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test");

    const destZone = state.snapshot.activeZones!.find((z) => z.id === "zone-dest")!;
    const betweenZone = state.snapshot.activeZones!.find((z) => z.id === "zone-between")!;
    expect(destZone.appliedRounds?.[CASTER]).toBe(state.snapshot.round);
    expect(betweenZone.appliedRounds?.[CASTER]).toBeUndefined();
  });

  it("recenters a self-anchored zone onto the caster's new position", () => {
    const encounter = baseEncounter("reposition-recenter");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    encounter.activeZones = [{
      id: "aura", name: "Spirit Guardians", sourceCombatantId: CASTER, sourceActionId: "aura-action",
      origin: { x: 1, y: 1 }, area: { type: "circle", size: 15 }, anchor: "self", affects: "hostile",
      trigger: [], concentration: true, createdRound: 1
    }];

    const state = createEngineState(encounter);
    resolveRepositionAction(state, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test");

    expect(state.snapshot.activeZones![0]!.origin).toEqual({ x: 4, y: 1 });
  });

  it("still teleports a caster whose movement is otherwise crippled by a condition", () => {
    const encounter = baseEncounter("reposition-restrained");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    caster.conditions = [{
      id: "restrained-1", name: "restrained", startedRound: 1,
      modifiers: { movementMultiplier: 9999 }
    }];

    const state = createEngineState(encounter);
    const result = resolveRepositionAction(state, CASTER, CASTER, { x: 4, y: 1 }, "misty-step-test");

    expect(result.moved).toBe(true);
  });

  it("moves the chosen ally, not the caster, in single-target mode — and spends the caster's economy/resources", () => {
    const encounter = baseEncounter("reposition-single");
    giveReposition(encounter, mistyStepAction({ targeting: { target: "single" } }));
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    const ally = encounter.combatants.find((c) => c.id === "pc-archer")!;
    ally.position = { x: 2, y: 1 };

    const state = createEngineState(encounter);
    resolveRepositionAction(state, CASTER, "pc-archer", { x: 5, y: 1 }, "misty-step-test");

    const casterAfter = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    const allyAfter = state.snapshot.combatants.find((c) => c.id === "pc-archer")!;
    expect(allyAfter.position).toEqual({ x: 5, y: 1 });
    expect(casterAfter.position).toEqual({ x: 1, y: 1 });
    expect(casterAfter.actionEconomy?.bonus).toBe(false);
    expect(casterAfter.resources?.["slot-2"]).toBe(0);
  });

  it("stamps a spell-level concentration flag onto a compiled reposition action with none of its own", () => {
    const encounter = baseEncounter("reposition-concentration-stamp");
    const definition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    definition.actions = [];
    definition.spells = [{
      id: "spell-blink", name: "Blink Spell", level: 2, castingTime: "bonus", range: "self",
      concentration: true,
      resourceCost: { resourceId: "slot-2", amount: 1 },
      automationSupport: "full",
      action: mistyStepAction({ id: "spell-blink-action", concentration: undefined })
    }];

    const state = createEngineState(encounter);
    const compiled = getExecutableActions(state.snapshot.definitions.find((d) => d.id === CASTER_DEF)!)
      .find((a) => a.id === "spell-blink-action");
    expect(compiled?.kind).toBe("reposition");
    expect((compiled as RepositionActionDefinition).concentration).toBe(true);
  });
});

describe("reposition — AI escape (ranged posture)", () => {
  const RANGED_CASTER = "pc-archer";
  const RANGED_CASTER_DEF = "def-archer";

  it("blinks a threatened ranged caster to a legal, safer destination", () => {
    const encounter = baseEncounter("reposition-ai-escape");
    encounter.definitions.find((d) => d.id === RANGED_CASTER_DEF)!.actions = [mistyStepAction()];
    const caster = encounter.combatants.find((c) => c.id === RANGED_CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    caster.resourceStance = "balanced";
    // Surrounded by melee walls on three sides so ordinary movement can't
    // reach safety — the corridor only opens up within teleport range.
    encounter.map.walls = [
      { id: "w1", start: { x: 0, y: 0 }, end: { x: 3, y: 0 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false },
      { id: "w2", start: { x: 0, y: 2 }, end: { x: 3, y: 2 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false },
      { id: "w3", start: { x: 0, y: 0 }, end: { x: 0, y: 2 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false }
    ];
    const threat = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    threat.position = { x: 2, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === RANGED_CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(chosenActionId(state)).toBe("misty-step-test");
    const after = state.snapshot.combatants.find((c) => c.id === RANGED_CASTER)!;
    expect(after.position).not.toEqual({ x: 1, y: 1 });
    expect(after.resources?.["slot-2"]).toBe(0);
  });

  it("does not spend the spell when the ranged caster is already safe", () => {
    const encounter = baseEncounter("reposition-ai-safe");
    encounter.definitions.find((d) => d.id === RANGED_CASTER_DEF)!.actions = [mistyStepAction()];
    const caster = encounter.combatants.find((c) => c.id === RANGED_CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 8, y: 6 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.position = { x: 8, y: 7 };

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === RANGED_CASTER)!;
    takeAutomatedTurn(state, actor);

    const after = state.snapshot.combatants.find((c) => c.id === RANGED_CASTER)!;
    expect(after.resources?.["slot-2"]).toBe(1);
  });

  it("a melee caster does NOT flee just for being adjacent to the enemy it's fighting", () => {
    // Regression test: earlier v1 scoring treated any adjacency as "threatened"
    // regardless of posture, so a melee actor would blink away from the exact
    // fight it was trying to win.
    const encounter = baseEncounter("reposition-no-melee-flee");
    giveReposition(encounter, mistyStepAction());
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.position).toEqual({ x: 1, y: 1 });
    expect(after.resources?.["slot-2"]).toBe(1);
  });
});

describe("reposition — AI gap-closer (melee posture)", () => {
  it("blinks a melee caster past a wall into range instead of Dashing, then lands an attack the same turn", () => {
    const encounter = baseEncounter("reposition-gap-closer");
    const fighterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    fighterDefinition.actions = [...fighterDefinition.actions, mistyStepAction()];
    // A wall blocks ordinary movement (and Dash) from ever reaching the target
    // this turn, but doesn't block line of effect — exactly the "blink through
    // an obstacle" case a teleport exists for.
    encounter.map.walls = [
      { id: "maze-wall", start: { x: 0, y: 2 }, end: { x: 12, y: 2 }, blocksMovement: true, blocksSight: false, blocksProjectiles: false }
    ];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1, "second-wind": 1, "action-surge": 1 };
    const target = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    target.position = { x: 1, y: 3 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.actionId === "misty-step-test")).toBe(true);
    expect(state.log.some((e) => e.type === "AttackRolled")).toBe(true);
    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.resources?.["slot-2"]).toBe(0);
    expect(after.actionEconomy?.action).toBe(false);
  });

  it("does not spend the spell when a plain move already reaches the target", () => {
    const encounter = baseEncounter("reposition-gap-closer-not-needed");
    const fighterDefinition = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    fighterDefinition.actions = [...fighterDefinition.actions, mistyStepAction()];
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 1, y: 1 };
    caster.resources = { "slot-2": 1, "second-wind": 1, "action-surge": 1 };
    const target = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    target.position = { x: 3, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    const actor = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    takeAutomatedTurn(state, actor);

    const after = state.snapshot.combatants.find((c) => c.id === CASTER)!;
    expect(after.resources?.["slot-2"]).toBe(1);
    expect(state.log.some((e) => e.type === "AttackRolled")).toBe(true);
  });
});

describe("reposition — import normalization", () => {
  it("round-trips a raw reposition action, not degrading it to unsupported", () => {
    const normalized = normalizeActionDefinition({
      kind: "reposition", name: "Misty Step", actionType: "bonus", range: 30,
      targeting: { target: "self" }
    });
    expect(normalized.kind).toBe("reposition");
  });
});
