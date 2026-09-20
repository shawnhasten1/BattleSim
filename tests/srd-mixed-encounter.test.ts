import { beforeAll, describe, expect, it } from "vitest";
import { runAutomatedEncounter, type CombatLogEvent, type EncounterSnapshot, type SimulationRunResult } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * A crowded, mixed fight — SRD monsters of many kinds against a mixed party — driven through every way a
 * user can run combat: Auto Run, stepping one turn at a time, and a Batch. The Step button re-implements the
 * engine's turn loop by hand (it has drifted from Auto Run before), so each path is held to the same
 * expectations: nothing throws, no turn is lost to an automation failure, HP stays sane, the dragon's
 * breath is used sparingly, and the SRD creatures actually fight.
 *
 * Each mode runs once in `beforeAll` and the tests assert on the results: a fight this size takes seconds
 * to simulate (see the note in the plan about movement-planning cost), so it isn't repeated per test.
 */
const pristine = useEncounterStore.getState();
const state = () => useEncounterStore.getState();

async function buildMixedEncounter() {
  useEncounterStore.setState(pristine, true);
  state().updateGrid({ width: 22, height: 14 });
  // Party: the sample fighter and archer plus SRD humanoids (one a spellcaster) on the left.
  await state().addSrdMonster("srd:monster:knight", "party", { x: 2, y: 6 });
  await state().addSrdMonster("srd:monster:priest", "party", { x: 2, y: 9 });
  await state().addSrdMonster("srd:monster:veteran", "party", { x: 3, y: 7 });
  await state().addSrdMonster("srd:monster:mage", "party", { x: 1, y: 8 });
  // Enemies on the right: packs, brutes, undead, a swarm and a dragon.
  await state().addSrdMonster("srd:monster:goblin", "enemy", { x: 17, y: 3 }, 2);
  await state().addSrdMonster("srd:monster:wolf", "enemy", { x: 18, y: 7 }, 2);
  await state().addSrdMonster("srd:monster:ogre", "enemy", { x: 19, y: 10 });
  await state().addSrdMonster("srd:monster:ghoul", "enemy", { x: 16, y: 11 });
  await state().addSrdMonster("srd:monster:zombie", "enemy", { x: 15, y: 8 });
  await state().addSrdMonster("srd:monster:swarm-of-rats", "enemy", { x: 14, y: 5 });
  await state().addSrdMonster("srd:monster:young-red-dragon", "enemy", { x: 19, y: 2 });
  return state().encounter;
}

const failures = (log: CombatLogEvent[]) =>
  log.filter((entry) => entry.type === "AutomationWarning" && /automated turn failed/i.test(entry.message)).map((entry) => entry.message);

function srdActionsTaken(log: CombatLogEvent[], encounter: EncounterSnapshot) {
  const srdIds = new Set(encounter.combatants.filter((combatant) => combatant.definitionId.startsWith("srd:monster:")).map((combatant) => combatant.id));
  return log.filter((entry) => entry.type === "ActionDeclared" && srdIds.has(String(entry.data?.actorId)));
}

function breathsPerActor(log: CombatLogEvent[]) {
  const counts = new Map<string, number>();
  for (const entry of log) {
    if (entry.type === "ActionDeclared" && entry.data?.actionName === "Fire Breath") {
      const actor = String(entry.data.actorId);
      counts.set(actor, (counts.get(actor) ?? 0) + 1);
    }
  }
  return counts;
}

function expectSaneHp(encounter: EncounterSnapshot) {
  for (const combatant of encounter.combatants) {
    const max = encounter.definitions.find((definition) => definition.id === combatant.definitionId)!.maxHp;
    expect(combatant.currentHp, combatant.displayName).toBeGreaterThanOrEqual(0);
    expect(combatant.currentHp, combatant.displayName).toBeLessThanOrEqual(max);
  }
}

let start: EncounterSnapshot;
let auto: SimulationRunResult;
let storeAuto: { outcome: ReturnType<typeof state>["outcome"]; log: CombatLogEvent[] };
let step: { outcome: ReturnType<typeof state>["outcome"]; log: CombatLogEvent[]; encounter: EncounterSnapshot; steps: number };

beforeAll(async () => {
  start = await buildMixedEncounter();

  // 1. Engine Auto Run
  auto = runAutomatedEncounter(start, 50);

  // 2. The Auto Run button (same path, through the store)
  await state().runAuto();
  storeAuto = { outcome: state().outcome, log: state().log };

  // 3. The Step button, clicked until the fight ends
  useEncounterStore.setState({ ...pristine, encounter: structuredClone(start), log: [], outcome: null, replayBase: null, replayIndex: null }, true);
  state().rollInitiativeNow();
  let steps = 0;
  while (state().outcome === null && steps < 3000) {
    state().advanceTurn();
    steps += 1;
  }
  step = { outcome: state().outcome, log: state().log, encounter: state().encounter, steps };
}, 120_000);

describe("a mixed SRD encounter runs the same in every mode", () => {
  it("is a genuinely mixed fight", () => {
    const enemies = start.combatants.filter((combatant) => combatant.faction === "enemy");
    const party = start.combatants.filter((combatant) => combatant.faction === "party");
    expect(party.length).toBeGreaterThanOrEqual(6);
    expect(enemies.length).toBeGreaterThanOrEqual(10);
    const srdTypes = new Set(start.definitions.filter((definition) => definition.id.startsWith("srd:monster:")).map((definition) => definition.type));
    expect(srdTypes.size).toBeGreaterThanOrEqual(5);
    const cells = start.combatants.map((combatant) => `${combatant.position.x},${combatant.position.y}`);
    expect(new Set(cells).size).toBe(cells.length); // none share a square
  });

  it("Auto Run: finishes without losing a turn", () => {
    expect(failures(auto.log)).toEqual([]);
    expect(auto.outcome.warnings.filter((warning) => /automated turn failed/.test(warning))).toEqual([]);
    // Every creature here has real attacks, so "no fully automated action" must never be reported (it used to
    // fire whenever only downed characters were left).
    expect(auto.outcome.warnings.filter((warning) => /no fully automated action/.test(warning))).toEqual([]);
    expect(auto.outcome.winner).not.toBeNull();
    expectSaneHp(auto.snapshot);
    expect(srdActionsTaken(auto.log, start).length).toBeGreaterThan(10);
    for (const [, breaths] of breathsPerActor(auto.log)) expect(breaths).toBeLessThanOrEqual(1);
  });

  it("Auto Run button and the engine agree exactly (deterministic)", () => {
    expect(storeAuto.outcome).toMatchObject({ winner: auto.outcome.winner, rounds: auto.outcome.rounds });
    expect(failures(storeAuto.log)).toEqual([]);
    expect(storeAuto.log.length).toBe(auto.log.length);
  });

  it("Step: clicking through every turn ends the fight with no failures", () => {
    expect(step.outcome, `still going after ${step.steps} steps`).not.toBeNull();
    expect(step.outcome!.winner).not.toBeNull();
    expect(failures(step.log)).toEqual([]);
    expectSaneHp(step.encounter);
    expect(srdActionsTaken(step.log, step.encounter).length).toBeGreaterThan(10);
    for (const [, breaths] of breathsPerActor(step.log)) expect(breaths).toBeLessThanOrEqual(1);
    // Rounds only ever go up: nobody gets a phantom extra turn from a mis-wound loop.
    const rounds = step.log.map((entry) => entry.round);
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b));
  });

  it("Step and Auto Run apply the same rules (the same kinds of things happen in both)", () => {
    const kinds = (log: CombatLogEvent[]) => new Set(log.map((entry) => entry.type));
    for (const type of ["AttackRolled", "SaveRolled", "DamageApplied", "CombatantDowned", "CombatEnded"] as const) {
      expect(kinds(auto.log).has(type), `auto ${type}`).toBe(true);
      expect(kinds(step.log).has(type), `step ${type}`).toBe(true);
    }
  });

  it("Batch: many runs finish cleanly and report a sensible summary", () => {
    // A batch repeats the whole fight per run, so use a compact mixed fight to keep this quick.
    useEncounterStore.setState({ ...pristine, encounter: structuredClone(start) }, true);
    const compact = structuredClone(start);
    const keep = new Set(["def-fighter", "def-archer", "srd:monster:knight", "srd:monster:goblin", "srd:monster:wolf", "srd:monster:zombie", "srd:monster:swarm-of-rats", "srd:monster:young-red-dragon"]);
    compact.combatants = compact.combatants.filter((combatant) => keep.has(combatant.definitionId) && !/Goblin 2|Wolf 2/.test(combatant.displayName));
    useEncounterStore.setState({ ...state(), encounter: compact });

    state().runBatch(12);
    const summary = state().batchSummary!;
    expect(summary.runCount).toBe(12);
    expect(summary.warnings.filter((warning) => /automated turn failed/.test(warning))).toEqual([]);
    expect(summary.partyWinRate + summary.enemyWinRate).toBeLessThanOrEqual(1.0001);
    expect(summary.runs).toHaveLength(12);
    expect(summary.rounds.max).toBeLessThanOrEqual(50);
    expect(summary.runs.every((run) => run.rounds >= 1)).toBe(true);
    // Different seeds give different fights (a batch that always plays out identically is broken).
    expect(new Set(summary.runs.map((run) => run.rounds)).size).toBeGreaterThan(1);
  }, 120_000);
});
