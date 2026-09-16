import { describe, expect, it } from "vitest";
import { createEngineState, moveCombatant, sampleEncounter, takeAutomatedTurn } from "@/engine";
import type { ActionDefinition, CombatantState, EncounterSnapshot } from "@/engine";

function baseEncounter(seed: string): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = seed;
  encounter.map.walls = [];
  encounter.map.terrain = [];
  return encounter;
}

const CASTER = "pc-fighter";
const CASTER_DEF = "def-fighter";

function actorOf(state: ReturnType<typeof createEngineState>, id: string): CombatantState {
  return state.snapshot.combatants.find((c) => c.id === id)!;
}

function eventIndex(state: ReturnType<typeof createEngineState>, predicate: (e: (typeof state.log)[number]) => boolean): number {
  return state.log.findIndex(predicate);
}

describe("shared per-turn movement budget", () => {
  it("moveCombatant rejects a second move once the turn's speed is spent", () => {
    const encounter = baseEncounter("movement-pool");
    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 0, y: 0 };
    const state = createEngineState(encounter);

    // def-fighter: speed 30 / distancePerSquare 5 = 6 squares this turn.
    moveCombatant(state, CASTER, { x: 6, y: 0 });
    expect(actorOf(state, CASTER).position).toEqual({ x: 6, y: 0 });

    expect(() => moveCombatant(state, CASTER, { x: 7, y: 0 })).toThrow();
    // and a move within what's actually left (0 squares) still fails
    expect(() => moveCombatant(state, CASTER, { x: 6, y: 1 })).toThrow();
  });
});

describe("AI — joint action/bonus-action turn planning", () => {
  it("takes the bonus action first when only that order fits the shared movement budget", () => {
    const mainAttack: ActionDefinition = {
      kind: "attack", id: "main-atk", name: "Longsword", actionType: "action", attackType: "melee",
      ability: "str", attackBonus: 20, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "slashing" }],
      automationSupport: "full"
    };
    const bonusHeal: ActionDefinition = {
      kind: "healing", id: "lay-on-hands", name: "Lay on Hands", actionType: "bonus", range: 5,
      healing: [{ dice: "1d4+3" }], automationSupport: "full"
    };

    const encounter = baseEncounter("joint-bonus-first");
    const casterDef = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDef.actions = [mainAttack, bonusHeal];
    casterDef.features = [];

    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 0, y: 0 };
    caster.tacticsProfile = "basic-melee";

    // Ally already adjacent (in range for the bonus heal without moving).
    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 0, y: 1 };
    archer.currentHp = 4;

    // Sole hostile, far enough that closing to melee range spends nearly the
    // whole move — not enough left, after closing, to also reach the ally.
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 6, y: 0 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state, CASTER));

    const healIndex = eventIndex(state, (e) => e.type === "HealingApplied" && e.data?.targetId === "pc-archer");
    const moveIndex = eventIndex(state, (e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER);
    const attackIndex = eventIndex(state, (e) => e.type === "AttackRolled" && e.data?.attackerId === CASTER);

    expect(healIndex).toBeGreaterThanOrEqual(0);
    expect(moveIndex).toBeGreaterThanOrEqual(0);
    expect(attackIndex).toBeGreaterThanOrEqual(0);
    // Bonus heal resolves before the caster ever has to move toward the goblin.
    expect(healIndex).toBeLessThan(moveIndex);
    expect(moveIndex).toBeLessThan(attackIndex);

    expect(actorOf(state, "pc-archer").currentHp).toBeGreaterThan(4);
    const actor = actorOf(state, CASTER);
    expect(actor.actionEconomy?.action).toBe(false);
    expect(actor.actionEconomy?.bonus).toBe(false);

    const moved = state.log.filter((e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER);
    const totalMoveCost = moved.reduce((sum, e) => sum + (e.data?.cost as number), 0);
    expect(totalMoveCost).toBeLessThanOrEqual(6);
  });

  it("splits movement around both actions — partial move, action, more move, bonus action", () => {
    const mainAttack: ActionDefinition = {
      kind: "attack", id: "main-atk", name: "Longsword", actionType: "action", attackType: "melee",
      ability: "str", attackBonus: 20, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "slashing" }],
      automationSupport: "full"
    };
    const bonusHeal: ActionDefinition = {
      kind: "healing", id: "lay-on-hands", name: "Lay on Hands", actionType: "bonus", range: 5,
      healing: [{ dice: "1d4+3" }], automationSupport: "full"
    };

    const encounter = baseEncounter("joint-split-move");
    const casterDef = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDef.actions = [mainAttack, bonusHeal];
    casterDef.features = [];

    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 0, y: 0 };
    caster.tacticsProfile = "basic-melee";

    // Neither target is in range at turn start, but both fit in one 6-square move.
    const goblin1 = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin1.position = { x: 3, y: 0 };
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 2, y: 4 };
    archer.currentHp = 4;

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state, CASTER));

    const moved = state.log.filter((e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER);
    expect(moved).toHaveLength(2);
    const totalMoveCost = moved.reduce((sum, e) => sum + (e.data?.cost as number), 0);
    expect(totalMoveCost).toBeLessThanOrEqual(6);

    const [firstMove, secondMove] = moved.map((e) => state.log.indexOf(e));
    const attackIndex = eventIndex(state, (e) => e.type === "AttackRolled" && e.data?.attackerId === CASTER);
    const healIndex = eventIndex(state, (e) => e.type === "HealingApplied" && e.data?.targetId === "pc-archer");

    // move -> action -> move -> bonus action, in that order.
    expect(firstMove).toBeLessThan(attackIndex);
    expect(attackIndex).toBeLessThan(secondMove);
    expect(secondMove).toBeLessThan(healIndex);

    expect(actorOf(state, "pc-archer").currentHp).toBeGreaterThan(4);
    const actor = actorOf(state, CASTER);
    expect(actor.actionEconomy?.action).toBe(false);
    expect(actor.actionEconomy?.bonus).toBe(false);
  });

  it("moves into range before a bonus-action heal that only the legacy fallback reaches (no silent no-op)", () => {
    const bonusHeal: ActionDefinition = {
      kind: "healing", id: "healing-word", name: "Healing Word", actionType: "bonus", range: 30,
      healing: [{ dice: "1d4+3" }], automationSupport: "full"
    };

    const encounter = baseEncounter("bonus-heal-move");
    const casterDef = encounter.definitions.find((d) => d.id === CASTER_DEF)!;
    casterDef.actions = [bonusHeal];
    casterDef.features = [];

    const caster = encounter.combatants.find((c) => c.id === CASTER)!;
    caster.position = { x: 0, y: 0 };

    const archer = encounter.combatants.find((c) => c.id === "pc-archer")!;
    archer.position = { x: 9, y: 0 };
    archer.currentHp = 4;

    encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.state = "dead";
    encounter.combatants.find((c) => c.id === "enemy-goblin-2")!.state = "dead";

    const state = createEngineState(encounter);
    takeAutomatedTurn(state, actorOf(state, CASTER));

    expect(state.log.some((e) => e.type === "CombatantMoved" && e.data?.combatantId === CASTER)).toBe(true);
    expect(state.log.some((e) => e.type === "HealingApplied" && e.data?.targetId === "pc-archer")).toBe(true);
    expect(actorOf(state, "pc-archer").currentHp).toBeGreaterThan(4);
  });
});
