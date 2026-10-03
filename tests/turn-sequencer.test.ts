import { describe, expect, it } from "vitest";
import {
  closeTurn,
  createEngineState,
  openNextTurn,
  runAutomatedEncounter,
  sampleEncounter,
  stepAutomatedTurn,
  syncTurnOrder,
  type CombatantState,
  type EncounterSnapshot
} from "@/engine";

/**
 * The turn sequencer (src/engine/turns.ts): the one loop Auto Run, Step and Play share. `openNextTurn` decides whose
 * turn comes next and runs everything between turns; `closeTurn` ends one. The golden logs
 * (turn-loop-golden.test.ts) pin Auto Run's results; these tests pin the pieces, and that stepping a fight turn by turn
 * plays exactly the fight Auto Run plays.
 */
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

function withInitiative(encounter: EncounterSnapshot = sampleEncounter): EncounterSnapshot {
  const snapshot = structuredClone(encounter);
  snapshot.combatants = snapshot.combatants.map((combatant) => ({ ...combatant, initiative: INITIATIVE[combatant.id] }));
  return snapshot;
}

const ids = (state: ReturnType<typeof createEngineState>) => state.snapshot.combatants.map((combatant) => combatant.id);
const find = (state: ReturnType<typeof createEngineState>, id: string) => state.snapshot.combatants.find((combatant) => combatant.id === id)!;

describe("stepping turn by turn", () => {
  it("plays exactly the fight Auto Run plays from the same board and seed", () => {
    for (const seed of ["step-a", "step-b", "step-c"]) {
      const start = { ...withInitiative(), seed };
      const auto = runAutomatedEncounter(start, 50);
      const state = createEngineState(start);
      for (let guard = 0; guard < 500; guard += 1) {
        if (stepAutomatedTurn(state).outcome) break;
      }
      expect(state.log.map((entry) => [entry.type, entry.message, entry.round, entry.turnIndex])).toEqual(
        auto.log.map((entry) => [entry.type, entry.message, entry.round, entry.turnIndex])
      );
    }
  });

  it("closes a turn that was left open before opening the next one", () => {
    const state = createEngineState(withInitiative());
    const opening = openNextTurn(state);
    expect(opening).toMatchObject({ kind: "turn", actor: { id: "pc-fighter" } });
    // The fighter's turn is still open (nobody acted). The next step ends it, then plays the archer.
    const { actor } = stepAutomatedTurn(state);
    expect(actor?.id).toBe("pc-archer");
    expect(find(state, "pc-fighter").actionEconomy).toMatchObject({ action: false, bonus: false, reaction: true });
  });

  it("once the fight is over it opens no more turns", () => {
    const state = createEngineState(withInitiative());
    for (const goblin of state.snapshot.combatants.filter((combatant) => combatant.faction === "enemy")) {
      goblin.state = "defeated";
      goblin.currentHp = 0;
    }
    const first = stepAutomatedTurn(state);
    expect(first.actor).toBeUndefined();
    expect(first.outcome).toMatchObject({ winner: "party", completed: true });
    const logged = state.log.length;
    stepAutomatedTurn(state);
    expect(state.log).toHaveLength(logged);
  });
});

describe("openNextTurn", () => {
  it("starts round 1 with the first creature in the order, and wraps the round after the last", () => {
    const state = createEngineState(withInitiative());
    const order: string[] = [];
    for (let turn = 0; turn < 5; turn += 1) {
      const opening = openNextTurn(state);
      if (opening.kind !== "turn") throw new Error("expected a turn");
      order.push(`${state.snapshot.round}:${opening.actor.id}`);
      closeTurn(state, opening.actor.id);
    }
    expect(order).toEqual(["1:pc-fighter", "1:pc-archer", "1:enemy-goblin-1", "1:enemy-goblin-2", "2:pc-fighter"]);
  });

  it("logs TurnStarted once the turn has started, after the start-of-turn rules", () => {
    const state = createEngineState(withInitiative());
    openNextTurn(state);
    const started = state.log.filter((entry) => entry.type === "TurnStarted");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ message: "Fighter started a turn", data: { combatantId: "pc-fighter" } });
    expect(find(state, "pc-fighter").actionEconomy).toEqual({ action: true, bonus: true, reaction: true });
  });

  it("skips the dead, and rolls a downed character's death save on the way to the next turn", () => {
    const state = createEngineState(withInitiative());
    const archer = find(state, "pc-archer");
    archer.state = "downed";
    archer.currentHp = 0;
    find(state, "enemy-goblin-1").state = "dead";
    const opened: string[] = [];
    for (let turn = 0; turn < 2; turn += 1) {
      const opening = openNextTurn(state);
      if (opening.kind !== "turn") throw new Error("expected a turn");
      opened.push(opening.actor.id);
      closeTurn(state, opening.actor.id);
    }
    expect(opened).toEqual(["pc-fighter", "enemy-goblin-2"]);
    expect(state.log.filter((entry) => entry.type === "DeathSaveRolled").map((entry) => entry.data?.combatantId)).toEqual(["pc-archer"]);
  });

  it("brings in reinforcements when their round starts", () => {
    const start = withInitiative();
    start.combatants = start.combatants.map((combatant): CombatantState =>
      combatant.id === "enemy-goblin-2" ? { ...combatant, state: "reserve", arrivesRound: 2 } : combatant);
    const state = createEngineState(start);
    const rounds: Array<[number, string]> = [];
    for (let turn = 0; turn < 4; turn += 1) {
      const opening = openNextTurn(state);
      if (opening.kind !== "turn") throw new Error("expected a turn");
      rounds.push([state.snapshot.round, opening.actor.id]);
      closeTurn(state, opening.actor.id);
    }
    // Round 1: the goblin is still on its way. Round 2 starts by admitting it, and it takes its turn in order.
    expect(rounds.map(([, id]) => id)).not.toContain("enemy-goblin-2");
    const arrived = state.log.findIndex((entry) => entry.type === "ReinforcementArrived");
    const roundTwo = state.log.findIndex((entry) => entry.type === "TurnStarted" && entry.round === 2);
    expect(arrived).toBeGreaterThan(-1);
    expect(arrived).toBeLessThan(roundTwo);
  });

  it("stops at the round limit", () => {
    const state = createEngineState(withInitiative());
    for (let turn = 0; turn < 4; turn += 1) {
      const opening = openNextTurn(state, { maxRounds: 1 });
      if (opening.kind !== "turn") throw new Error("expected a turn");
      closeTurn(state, opening.actor.id);
    }
    expect(openNextTurn(state, { maxRounds: 1 })).toEqual({ kind: "over", reason: "round-limit" });
    expect(state.snapshot.round).toBe(1);
  });

  it("gives up rather than spinning when nobody will ever take a turn", () => {
    const start = withInitiative();
    start.combatants = start.combatants.map((combatant): CombatantState => ({ ...combatant, state: "reserve", arrivesRound: 999 }));
    const state = createEngineState(start);
    expect(openNextTurn(state)).toEqual({ kind: "over", reason: "stalled" });
  });

  it("says the fight is decided when only one side is left", () => {
    const start = withInitiative();
    start.combatants = start.combatants.filter((combatant) => combatant.faction === "party");
    expect(openNextTurn(createEngineState(start))).toEqual({ kind: "over", reason: "decided" });
  });
});

describe("closeTurn", () => {
  it("spends the action and bonus action but keeps the reaction for the rest of the round", () => {
    const state = createEngineState(withInitiative());
    openNextTurn(state);
    closeTurn(state, "pc-fighter");
    expect(find(state, "pc-fighter").actionEconomy).toEqual({ action: false, bonus: false, reaction: true });
  });
});

describe("syncTurnOrder", () => {
  it("before the fight, anyone without initiative means everyone rolls", () => {
    const start = withInitiative();
    start.combatants[1] = { ...start.combatants[1]!, initiative: undefined };
    const state = createEngineState(start);
    syncTurnOrder(state);
    const rolled = state.log.filter((entry) => entry.type === "InitiativeRolled");
    expect(rolled).toHaveLength(1);
    expect((rolled[0]!.data?.rolls as unknown[]).length).toBe(4);
  });

  it("mid-fight, a token added since rolls its own initiative and joins without taking the turn from anyone", () => {
    const state = createEngineState(withInitiative());
    openNextTurn(state);
    closeTurn(state, "pc-fighter");
    openNextTurn(state); // the archer's turn is open
    const newcomer: CombatantState = { ...structuredClone(find(state, "enemy-goblin-2")), id: "enemy-goblin-3", displayName: "Goblin 3", initiative: undefined, position: { x: 10, y: 6 } };
    state.snapshot.combatants.push(newcomer);
    const before = { fighter: find(state, "pc-fighter").initiative, archer: find(state, "pc-archer").initiative };

    syncTurnOrder(state);

    expect(typeof find(state, "enemy-goblin-3").initiative).toBe("number");
    expect(find(state, "pc-fighter").initiative).toBe(before.fighter);
    expect(find(state, "pc-archer").initiative).toBe(before.archer);
    expect(state.snapshot.combatants[state.snapshot.turnIndex]!.id).toBe("pc-archer");
    expect(ids(state)).toContain("enemy-goblin-3");
    const sorted = [...state.snapshot.combatants].map((combatant) => combatant.initiative ?? 0);
    expect(sorted).toEqual([...sorted].sort((a, b) => b - a));
    expect(state.log.some((entry) => entry.type === "InitiativeRolled" && /^Goblin 3 joins the fight on initiative \d+$/.test(entry.message))).toBe(true);
  });

  it("re-sorts by initiative and keeps the turn where it is", () => {
    const state = createEngineState(withInitiative());
    openNextTurn(state);
    // A hand edit swaps the goblins' places in the order.
    find(state, "enemy-goblin-2").initiative = 13;
    syncTurnOrder(state);
    expect(ids(state)).toEqual(["pc-fighter", "pc-archer", "enemy-goblin-2", "enemy-goblin-1"]);
    expect(state.snapshot.combatants[state.snapshot.turnIndex]!.id).toBe("pc-fighter");
  });
});
