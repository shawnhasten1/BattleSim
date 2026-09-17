import { describe, expect, it } from "vitest";
import {
  createEngineState,
  effectiveFaction,
  normalizeActionDefinition,
  resolveSaveAction,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { ActionDefinition, ConditionInstance, EncounterSnapshot, RandomSource } from "@/engine";

// A deterministic RNG: `valuesBySides[sides]` is consumed in order for each `nextInt(_, sides)`.
// Unscripted keys fall back to `minInclusive` — handy for the always-pick-the-first-candidate cases below.
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

function baseEncounter(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

function pushAction(encounter: EncounterSnapshot, definitionId: string, action: ActionDefinition) {
  encounter.definitions.find((d) => d.id === definitionId)!.actions.push(action);
}

function dominatedCondition(sourceCombatantId: string): ConditionInstance {
  return { id: "dominated-test", name: "dominated", sourceCombatantId, startedRound: 1 };
}

describe("effectiveFaction", () => {
  it("resolves to the dominator's faction while dominated, and reverts once the condition is gone", () => {
    const encounter = baseEncounter("effective-faction");
    const state = createEngineState(encounter);
    const goblin = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.conditions = [dominatedCondition("pc-fighter")];

    expect(effectiveFaction(state.snapshot, goblin)).toBe("party");

    goblin.conditions = [];
    expect(effectiveFaction(state.snapshot, goblin)).toBe("enemy");
    expect(goblin.faction).toBe("enemy"); // the stored faction itself was never touched
  });
});

describe("domination — hostile pool", () => {
  function setup() {
    const encounter = baseEncounter("domination-pool");
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    const goblin2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    archer.position = { x: 10, y: 1 };
    goblin1.position = { x: 10, y: 2 };
    goblin1.conditions = [dominatedCondition("pc-fighter")];
    goblin2.state = "dead"; // keep exactly one candidate in the pool
    return encounter;
  }

  it("a former ally does not attack a dominated enemy", () => {
    const state = createEngineState(setup());
    const goblin1Hp = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp;
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);
    expect(state.log.some((e) => e.type === "AttackRolled" && e.data?.targetId === "enemy-goblin-1")).toBe(false);
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.currentHp).toBe(goblin1Hp);
  });

  it("attacks resume once the domination is stripped", () => {
    const state = createEngineState(setup());
    const goblin1 = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.conditions = [];
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);
    expect(state.log.some((e) => e.type === "AttackRolled" && e.data?.targetId === "enemy-goblin-1")).toBe(true);
  });
});

describe("domination — the dominated creature's own turn", () => {
  it("attacks its former ally instead of the party that dominated it", () => {
    const encounter = baseEncounter("domination-turn");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    encounter.combatants.find((c) => c.id === "pc-archer")!.position = { x: 1, y: 10 };
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    const goblin2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin1.position = { x: 10, y: 1 };
    goblin2.position = { x: 10, y: 2 }; // adjacent — within scimitar reach
    goblin1.conditions = [dominatedCondition("pc-fighter")];

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!);

    expect(state.log.some((e) => e.type === "AttackRolled" && e.data?.targetId === "enemy-goblin-2")).toBe(true);
    expect(state.log.some((e) => e.type === "AttackRolled" && (e.data?.targetId === "pc-fighter" || e.data?.targetId === "pc-archer"))).toBe(false);
  });
});

describe("domination — restrictToCreatureTypes gating", () => {
  function dominateBeastEncounter() {
    const encounter = baseEncounter("dominate-beast-gate");
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    pushAction(encounter, "def-fighter", {
      kind: "save", id: "dom-beast-test", name: "Dominate Beast", actionType: "action",
      saveAbility: "wis", dc: 15, range: 60, damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "dominated",
        duration: { kind: "save-ends", saveAt: "turn-end" },
        save: { ability: "wis", onSuccess: "negates" },
        restrictToCreatureTypes: ["beast"]
      }],
      automationSupport: "full"
    });
    return encounter;
  }

  it("skips the rider against a non-beast target (goblins are humanoid)", () => {
    const state = createEngineState(dominateBeastEncounter());
    state.rng = scriptedRng({ 20: [1] }); // fails the save
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", "dom-beast-test");
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.conditions ?? []).toHaveLength(0);
  });

  it("applies the rider once the target's type matches", () => {
    const encounter = dominateBeastEncounter();
    encounter.definitions.find((d) => d.id === "def-goblin")!.type = "beast";
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] });
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", "dom-beast-test");
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.conditions?.some((c) => c.name === "dominated")).toBe(true);
  });
});

describe("confusion — forcesRandomAction turn override", () => {
  function confusedEncounter() {
    const encounter = baseEncounter("confusion");
    const fighter = encounter.combatants.find((c) => c.id === "pc-fighter")!;
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    fighter.position = { x: 5, y: 5 };
    archer.position = { x: 5, y: 6 }; // adjacent ally — the only in-reach target
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.state = "dead";
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";
    fighter.conditions = [{ id: "confused-test", name: "confused", startedRound: 1, modifiers: { forcesRandomAction: true } }];
    return encounter;
  }

  it("outcome 1: attacks a random in-reach creature, including an ally", () => {
    const state = createEngineState(confusedEncounter());
    state.rng = scriptedRng({ 3: [1] });
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-fighter")!);
    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.reason === "confused" && e.data?.targetId === "pc-archer")).toBe(true);
  });

  it("outcome 2: moves to a random adjacent legal cell", () => {
    const encounter = confusedEncounter();
    encounter.combatants.find((c) => c.id === "pc-archer")!.position = { x: 20, y: 20 }; // out of reach — force outcome 2's path
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 3: [2] });
    const fighter = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    const before = { ...fighter.position };
    takeAutomatedTurn(state, fighter);
    const after = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.reason === "confused" && e.data?.destination)).toBe(true);
    expect(after.position).not.toEqual(before);
  });

  it("outcome 3: does nothing", () => {
    const encounter = confusedEncounter();
    encounter.combatants.find((c) => c.id === "pc-archer")!.position = { x: 20, y: 20 };
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 3: [3] });
    const fighter = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    const before = { ...fighter.position };
    takeAutomatedTurn(state, fighter);
    const after = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    expect(after.position).toEqual(before);
    expect(after.currentHp).toBe(fighter.currentHp);
    expect(state.log.some((e) => e.type === "AiDecision" && e.data?.reason === "confused" && !e.data?.targetId && !e.data?.destination)).toBe(true);
  });
});

describe("domination — AI valuation", () => {
  it("a controller-profile actor picks a dominate spell over a weak attack", () => {
    const encounter = baseEncounter("domination-valuation");
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.tacticsProfile = "controller";
    archer.position = { x: 1, y: 1 };
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 1, y: 2 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const archerDef = encounter.definitions.find((d) => d.id === "def-archer")!;
    archerDef.actions = [
      {
        kind: "save", id: "dominate-test", name: "Dominate Person", actionType: "action",
        saveAbility: "wis", dc: 15, range: 60, damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
        riders: [{
          kind: "condition", when: "on-save-fail", condition: "dominated",
          duration: { kind: "save-ends", saveAt: "turn-end" },
          save: { ability: "wis", onSuccess: "negates" }
        }],
        automationSupport: "full"
      },
      {
        kind: "attack", id: "weak-attack-test", name: "Sling", actionType: "action", attackType: "ranged",
        ability: "dex", attackBonus: 0, range: 80, damage: [{ dice: "1d4", damageType: "bludgeoning" }],
        automationSupport: "full"
      }
    ];

    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] }); // the dominate save fails, if that's the action chosen
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);

    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.conditions?.some((c) => c.name === "dominated")).toBe(true);
  });

  it("does not recast a concentration spell on a new target while an earlier domination is still live", () => {
    const encounter = baseEncounter("domination-retention");
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.tacticsProfile = "controller";
    archer.position = { x: 1, y: 1 };
    archer.concentration = { sourceConditionId: "dominated-test" };

    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 1, y: 2 };
    goblin1.conditions = [{ id: "dominated-test", name: "dominated", sourceCombatantId: "pc-archer", startedRound: 1, concentration: true }];

    const goblin2 = encounter.combatants.find((c) => c.id === "enemy-goblin-2")!;
    goblin2.position = { x: 1, y: 3 };

    const archerDef = encounter.definitions.find((d) => d.id === "def-archer")!;
    archerDef.actions = [
      {
        kind: "save", id: "dominate-test", name: "Dominate Person", actionType: "action",
        saveAbility: "wis", dc: 15, range: 60, damage: [], halfDamageOnSuccess: false, onSuccess: "negates", concentration: true,
        riders: [{
          kind: "condition", when: "on-save-fail", condition: "dominated",
          duration: { kind: "save-ends", saveAt: "turn-end" },
          save: { ability: "wis", onSuccess: "negates" }
        }],
        automationSupport: "full"
      },
      {
        kind: "attack", id: "weak-attack-test", name: "Sling", actionType: "action", attackType: "ranged",
        ability: "dex", attackBonus: 0, range: 80, damage: [{ dice: "1d4", damageType: "bludgeoning" }],
        automationSupport: "full"
      }
    ];

    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [1] }); // the dominate save would fail if the AI (wrongly) recast it
    takeAutomatedTurn(state, state.snapshot.combatants.find((c) => c.id === "pc-archer")!);

    // goblin2 was never dominated — the AI didn't spend its turn recasting the concentration spell.
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-2")!.conditions?.some((c) => c.name === "dominated") ?? false).toBe(false);
    // goblin1's domination survived the turn: concentration was never broken to cast something new.
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!.conditions?.some((c) => c.name === "dominated")).toBe(true);
  });
});

describe("domination — import normalization", () => {
  it("round-trips a raw condition rider carrying restrictToCreatureTypes, without degrading the condition name", () => {
    const normalized = normalizeActionDefinition({
      kind: "save", name: "Dominate Beast", actionType: "action", saveAbility: "wis", dc: 15, range: 60,
      riders: [{
        kind: "condition", when: "on-save-fail", condition: "dominated",
        duration: { kind: "save-ends", saveAt: "turn-end" },
        restrictToCreatureTypes: ["beast"]
      }]
    });
    expect(normalized.kind).toBe("save");
    const rider = "riders" in normalized ? normalized.riders?.[0] : undefined;
    expect(rider?.kind).toBe("condition");
    expect(rider && "condition" in rider ? rider.condition : undefined).toBe("dominated");
    expect(rider && "restrictToCreatureTypes" in rider ? rider.restrictToCreatureTypes : undefined).toEqual(["beast"]);
  });
});
