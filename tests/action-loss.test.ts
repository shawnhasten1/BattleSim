import { describe, expect, it } from "vitest";
import {
  applyCondition,
  canAct,
  createEngineState,
  expireConditions,
  moveCombatant,
  resolveAttack,
  resolveSaveAction,
  sampleEncounter,
  takeAutomatedTurn
} from "@/engine";
import type { ConditionInstance, EncounterSnapshot, RandomSource } from "@/engine";

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

function baseEncounter(seed = "action-loss"): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  return encounter;
}

function condition(name: ConditionInstance["name"], modifiers?: ConditionInstance["modifiers"]): ConditionInstance {
  return { id: `${name}-1`, name, startedRound: 0, modifiers };
}

describe("canAct", () => {
  it("is true for a fresh, unconditioned combatant on every slot", () => {
    const state = createEngineState(baseEncounter());
    const actor = state.snapshot.combatants[0]!;
    expect(canAct(actor, "action")).toBe(true);
    expect(canAct(actor, "bonus")).toBe(true);
    expect(canAct(actor, "reaction")).toBe(true);
  });

  it("is false on every slot while stunned / paralyzed", () => {
    for (const name of ["stunned", "paralyzed", "incapacitated", "unconscious"] as const) {
      const state = createEngineState(baseEncounter());
      const actor = state.snapshot.combatants[0]!;
      applyCondition(state, actor.id, condition(name, undefined));
      // default modifiers are filled in by the store/rider path; here assert the
      // name alone is enough for canAct.
      expect(canAct(actor, "action"), name).toBe(false);
      expect(canAct(actor, "bonus"), name).toBe(false);
      expect(canAct(actor, "reaction"), name).toBe(false);
    }
  });

  it("honours an explicit deniesReactions modifier without touching the other slots", () => {
    const state = createEngineState(baseEncounter());
    const actor = state.snapshot.combatants[0]!;
    applyCondition(state, actor.id, condition("custom", { deniesReactions: true }));
    expect(canAct(actor, "reaction")).toBe(false);
    expect(canAct(actor, "action")).toBe(true);
    expect(canAct(actor, "bonus")).toBe(true);
  });

  it("is false once the slot is spent", () => {
    const state = createEngineState(baseEncounter());
    const actor = state.snapshot.combatants[0]!;
    actor.actionEconomy = { action: false, bonus: true, reaction: true };
    expect(canAct(actor, "action")).toBe(false);
    expect(canAct(actor, "bonus")).toBe(true);
  });

  it("is false for a non-active combatant", () => {
    const state = createEngineState(baseEncounter());
    const actor = state.snapshot.combatants[0]!;
    actor.state = "downed";
    expect(canAct(actor, "action")).toBe(false);
  });
});

describe("resolvers refuse an incapacitated actor", () => {
  it("resolveAttack throws for a stunned attacker", () => {
    const encounter = baseEncounter("stun-attack");
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    const state = createEngineState(encounter);
    applyCondition(state, "pc-fighter", condition("stunned"));
    expect(() => resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword")).toThrow(/cannot take a/);
  });

  it("resolveSaveAction throws for a paralyzed caster", () => {
    const encounter = baseEncounter("para-save");
    const fighter = encounter.definitions.find((d) => d.id === "def-fighter")!;
    fighter.actions.push({
      kind: "save", id: "shout", name: "Shout", actionType: "action", saveAbility: "con",
      dc: 12, range: 30, damage: [{ dice: "1d6", damageType: "thunder" }],
      halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full"
    });
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    const state = createEngineState(encounter);
    applyCondition(state, "pc-fighter", condition("paralyzed"));
    expect(() => resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", "shout")).toThrow(/cannot take a/);
  });
});

describe("takeAutomatedTurn — loses its turn", () => {
  it("a stunned actor takes no action and logs the loss", () => {
    const encounter = baseEncounter("stun-turn");
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    const state = createEngineState(encounter);
    applyCondition(state, "pc-fighter", condition("stunned"));
    const actor = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    takeAutomatedTurn(state, actor);
    expect(state.log.some((e) => e.type === "AttackRolled")).toBe(false);
    expect(state.log.some((e) => e.type === "AiDecision" && /loses its turn/.test(e.message))).toBe(true);
  });
});

describe("opportunity attacks respect canAct", () => {
  it("a stunned reactor makes no opportunity attack when an enemy runs past", () => {
    const encounter = baseEncounter("stun-oa");
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter" || c.id === "enemy-goblin-1");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 2, y: 1 };
    goblin.actionEconomy = { action: true, bonus: true, reaction: true };
    const state = createEngineState(encounter);
    applyCondition(state, "enemy-goblin-1", condition("stunned"));
    moveCombatant(state, "pc-fighter", { x: 1, y: 3 });
    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(false);
    expect(state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")?.actionEconomy?.reaction).toBe(true);
  });
});

describe("incomingAttackRoll", () => {
  it("a condition on the target shifts attack rolls made against it", () => {
    const encounter = baseEncounter("incoming");
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter" || c.id === "enemy-goblin-1");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 50;
    const fighter = encounter.definitions.find((d) => d.id === "def-fighter")!;
    // a to-hit that only lands with the +5 bump: AC 15, +2 attack bonus, need d20 >= 13
    (fighter.actions[0] as { attackBonus?: number }).attackBonus = 2;
    const state = createEngineState(encounter);
    state.rng = scriptedRng({ 20: [8] });
    // 8 + 2 = 10 < 15 → miss without help
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    expect(state.log.find((e) => e.type === "AttackRolled")?.data?.hit).toBe(false);

    const state2 = createEngineState(encounter);
    state2.rng = scriptedRng({ 20: [8] });
    applyCondition(state2, "enemy-goblin-1", condition("custom", { incomingAttackRoll: 5 }));
    resolveAttack(state2, "pc-fighter", "enemy-goblin-1", "longsword");
    // 8 + 2 + 5 = 15 >= 15 → hit
    expect(state2.log.find((e) => e.type === "AttackRolled")?.data?.hit).toBe(true);
  });
});

describe("until-start-of-next-turn duration", () => {
  it("a reaction-lock rider clears at the bearer's next turn start", () => {
    const encounter = baseEncounter("react-lock");
    const fighter = encounter.definitions.find((d) => d.id === "def-fighter")!;
    fighter.actions.push({
      kind: "attack", id: "shock", name: "Shocking Touch", actionType: "action", attackType: "melee",
      ability: "str", attackBonus: 50, range: 5, reach: 5,
      damage: [{ dice: "1", damageType: "lightning" }],
      riders: [{
        kind: "condition", when: "on-hit", condition: { custom: "reaction-locked" },
        modifiers: { deniesReactions: true }, duration: { kind: "until-start-of-next-turn" }
      }],
      automationSupport: "full"
    });
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 50;
    const state = createEngineState(encounter);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "shock");

    const locked = state.snapshot.combatants.find((c) => c.id === "enemy-goblin-1")!;
    expect(locked.conditions?.some((c) => c.modifiers?.deniesReactions)).toBe(true);
    expect(canAct(locked, "reaction")).toBe(false);

    // advance to the goblin's turn start
    const goblinIdx = state.snapshot.combatants.findIndex((c) => c.id === "enemy-goblin-1");
    state.snapshot.round += 1;
    state.snapshot.turnIndex = goblinIdx;
    expireConditions(state, "start");
    expect(locked.conditions?.some((c) => c.modifiers?.deniesReactions)).toBe(false);
    expect(canAct(locked, "reaction")).toBe(true);
  });
});
