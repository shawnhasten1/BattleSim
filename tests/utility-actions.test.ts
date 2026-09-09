import { describe, expect, it } from "vitest";
import {
  createEngineState,
  expireConditions,
  getExecutableActions,
  moveCombatant,
  resetActionEconomy,
  resolveActivateFeatureAction,
  resolveAttack,
  resolveUtilityAction,
  sampleEncounter
} from "@/engine";
import type { ActionDefinition, CreatureDefinition, EncounterSnapshot } from "@/engine";

type UtilityAction = Extract<ActionDefinition, { kind: "utility" }>;

function bareDefinition(overrides: Partial<CreatureDefinition> = {}): CreatureDefinition {
  return {
    id: "def-util",
    name: "Utility Tester",
    size: "medium",
    armorClass: 14,
    maxHp: 30,
    speed: 30,
    proficiencyBonus: 2,
    abilities: { str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    actions: [
      {
        kind: "attack", id: "jab", name: "Jab", actionType: "action", attackType: "melee",
        ability: "str", attackBonus: 4, range: 5, reach: 5,
        damage: [{ dice: "1d4", damageType: "bludgeoning" }], automationSupport: "full"
      }
    ],
    ...overrides
  };
}

function movementEncounter(seed = "utility"): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  return encounter;
}

describe("synthesised standard actions", () => {
  it("every creature gets action-cost Dash / Disengage / Dodge (full) and Hide / Help (partial)", () => {
    const actions = getExecutableActions(bareDefinition());
    const utils = actions.filter((a): a is UtilityAction => a.kind === "utility");
    expect(utils.map((a) => a.id).sort()).toEqual([
      "utility:dash", "utility:disengage", "utility:dodge", "utility:help", "utility:hide"
    ]);
    for (const u of utils) {
      expect(u.actionType).toBe("action");
      expect(u.automationSupport).toBe(u.mode === "hide" || u.mode === "help" ? "partial" : "full");
    }
  });

  it("an authored action-cost utility suppresses the synthesised one for that mode", () => {
    const def = bareDefinition({
      actions: [
        {
          kind: "utility", id: "scramble", name: "Scramble", actionType: "action",
          mode: "dash", automationSupport: "full"
        }
      ]
    });
    const dashes = getExecutableActions(def).filter((a) => a.kind === "utility" && a.mode === "dash");
    expect(dashes.map((a) => a.id)).toEqual(["scramble"]);
  });

  it("a feature-granted bonus Disengage does not suppress the full-action Disengage", () => {
    const def = bareDefinition({
      features: [{
        id: "cunning-action", name: "Cunning Action", category: "feature", automationSupport: "full",
        grantedActions: [{
          kind: "utility", id: "cunning-disengage", name: "Cunning Action: Disengage",
          actionType: "bonus", mode: "disengage", automationSupport: "full"
        }]
      }]
    });
    const disengages = getExecutableActions(def).filter((a) => a.kind === "utility" && a.mode === "disengage");
    expect(disengages.map((a) => a.id).sort()).toEqual(["cunning-disengage", "utility:disengage"]);
    expect(disengages.find((a) => a.id === "cunning-disengage")?.actionType).toBe("bonus");
  });
});

describe("resolveUtilityAction — Dash", () => {
  it("doubles the movement budget", () => {
    const encounter = movementEncounter("dash");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    // clear the far side so a long straight path exists
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter");
    const far = { x: 11, y: 1 }; // 10 cells = 50 ft; speed 30 = 6 cells

    const noDash = createEngineState(encounter);
    expect(() => moveCombatant(noDash, "pc-fighter", far)).toThrow(/not reachable/);

    const dashed = createEngineState(encounter);
    resolveUtilityAction(dashed, "pc-fighter", "utility:dash");
    expect(() => moveCombatant(dashed, "pc-fighter", far)).not.toThrow();
    expect(dashed.snapshot.combatants[0]!.position).toEqual(far);
    expect(dashed.snapshot.combatants[0]!.actionEconomy?.action).toBe(false);
  });
});

describe("resolveUtilityAction — Disengage & avoids-opportunity-attacks", () => {
  function adjacentPair(seed: string) {
    const encounter = movementEncounter(seed);
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter" || c.id === "enemy-goblin-1");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 2, y: 1 };
    return encounter;
  }

  it("baseline: moving out of reach provokes an opportunity attack", () => {
    const state = createEngineState(adjacentPair("oa-baseline"));
    moveCombatant(state, "pc-fighter", { x: 1, y: 4 });
    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(true);
  });

  it("Disengage suppresses opportunity attacks for the turn", () => {
    const state = createEngineState(adjacentPair("oa-disengage"));
    resolveUtilityAction(state, "pc-fighter", "utility:disengage");
    moveCombatant(state, "pc-fighter", { x: 1, y: 4 });
    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(false);
    expect(state.snapshot.combatants.find((c) => c.id === "pc-fighter")?.turnFlags?.disengaged).toBe(true);
  });

  it("an avoids-opportunity-attacks feature suppresses them without Disengaging", () => {
    const encounter = adjacentPair("oa-mobile");
    encounter.definitions.find((d) => d.id === "def-fighter")!.features = [{
      id: "mobile", name: "Mobile", category: "feature", automationSupport: "full",
      effects: [{ kind: "avoids-opportunity-attacks", condition: "always" }]
    }];
    const state = createEngineState(encounter);
    moveCombatant(state, "pc-fighter", { x: 1, y: 4 });
    expect(state.log.some((e) => e.type === "OpportunityAttackTriggered")).toBe(false);
  });
});

describe("resolveUtilityAction — Dodge", () => {
  it("applies a self-condition that shifts incoming attacks and expires at the dodger's next turn", () => {
    const encounter = movementEncounter("dodge");
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter" || c.id === "enemy-goblin-1");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 50;
    const state = createEngineState(encounter);

    resolveUtilityAction(state, "pc-fighter", "utility:dodge");
    const dodger = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    const cond = dodger.conditions?.find((c) => c.sourceName === "Dodge");
    expect(cond?.modifiers).toMatchObject({ incomingAttackRoll: -4, savingThrows: { dex: 2 } });
    expect(cond?.expiresAt?.timing).toBe("start");
    expect(state.log.some((e) => e.type === "UtilityActionResolved")).toBe(true);

    // clears at the dodger's next turn start
    const idx = state.snapshot.combatants.findIndex((c) => c.id === "pc-fighter");
    state.snapshot.round += 1;
    state.snapshot.turnIndex = idx;
    expireConditions(state, "start");
    expect(dodger.conditions?.some((c) => c.sourceName === "Dodge")).toBe(false);
  });
});

describe("resolveUtilityAction — bookkeeping", () => {
  it("spends the action slot and refuses a second action", () => {
    const encounter = movementEncounter("spend");
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter");
    const state = createEngineState(encounter);
    resolveUtilityAction(state, "pc-fighter", "utility:dodge");
    expect(state.snapshot.combatants[0]!.actionEconomy?.action).toBe(false);
    expect(() => resolveUtilityAction(state, "pc-fighter", "utility:dash")).toThrow(/already used/);
  });

  it("Hide / Help resolve but log an automation warning", () => {
    const encounter = movementEncounter("hide");
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter");
    const state = createEngineState(encounter);
    resolveUtilityAction(state, "pc-fighter", "utility:hide");
    expect(state.log.some((e) => e.type === "AutomationWarning" && /hide/.test(e.message))).toBe(true);
    expect(state.log.some((e) => e.type === "UtilityActionResolved")).toBe(true);
  });

  it("resetActionEconomy clears the turn flags", () => {
    const combatant = structuredClone(sampleEncounter).combatants[0]!;
    combatant.turnFlags = { dashed: true, disengaged: true };
    resetActionEconomy(combatant);
    expect(combatant.turnFlags).toBeUndefined();
    expect(combatant.actionEconomy).toEqual({ action: true, bonus: true, reaction: true });
  });
});

describe("extra-action (Action Surge)", () => {
  function surgeEncounter() {
    const encounter = movementEncounter("surge");
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter" || c.id === "enemy-goblin-1");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 200;
    const fighter = encounter.definitions.find((d) => d.id === "def-fighter")!;
    (fighter.actions[0] as { attackBonus?: number }).attackBonus = 100;
    fighter.features = [{
      id: "action-surge", name: "Action Surge", category: "feature", automationSupport: "full",
      effects: [{ kind: "extra-action", slot: "action" }]
    }];
    fighter.actions.push({
      kind: "activate-feature", id: "surge", name: "Action Surge", actionType: "free",
      featureId: "action-surge", resourceCost: { resourceId: "action-surge", amount: 1 },
      automationSupport: "full"
    });
    encounter.combatants.find((c) => c.id === "pc-fighter")!.resources = { "action-surge": 1 };
    return encounter;
  }

  it("hands back a spent action slot and consumes the resource", () => {
    const state = createEngineState(surgeEncounter());
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    expect(state.snapshot.combatants.find((c) => c.id === "pc-fighter")?.actionEconomy?.action).toBe(false);

    resolveActivateFeatureAction(state, "pc-fighter", "surge");
    const fighter = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    expect(fighter.actionEconomy?.action).toBe(true);
    expect(fighter.resources?.["action-surge"]).toBe(0);
    expect(state.log.some((e) => e.type === "ActionEconomyRefreshed" && e.data?.slot === "action")).toBe(true);

    // the refreshed slot lets a second attack resolve
    expect(() => resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword")).not.toThrow();
  });

  it("Action Surge is blocked while stunned (free actions still check canAct)", () => {
    const state = createEngineState(surgeEncounter());
    const fighter = state.snapshot.combatants.find((c) => c.id === "pc-fighter")!;
    fighter.conditions = [{ id: "stun", name: "stunned", startedRound: 0 }];
    expect(() => resolveActivateFeatureAction(state, "pc-fighter", "surge")).toThrow(/cannot act/);
  });
});
