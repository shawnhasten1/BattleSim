import { describe, expect, it } from "vitest";
import {
  commandProblem,
  controllerOf,
  runPlayStep,
  sampleEncounter,
  type CombatantState,
  type CombatCommand,
  type CreatureDefinition,
  type EncounterSnapshot,
  type PlayControl,
  type ReactionRequest
} from "@/engine";
import { aiAnswer, basicDriver, playFight, runStep } from "./helpers/play";

/**
 * Play, headless (PLAY_MODE_PLAN.md Phase 1): fights run step by step through `runPlayStep`, people's turns and
 * questions answered by scripts. The UI comes later; this is the engine it will drive.
 */
const PARTY_PLAYS: PlayControl = { factions: { party: "human", enemy: "ai" } };
const EVERYONE_PLAYS: PlayControl = { factions: { party: "human", enemy: "human", neutral: "human" } };
const NOBODY_PLAYS: PlayControl = { factions: {} };

const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

function sample(seed = "play"): EncounterSnapshot {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.seed = seed;
  snapshot.combatants = snapshot.combatants.map((combatant) => ({ ...combatant, initiative: INITIATIVE[combatant.id] }));
  return snapshot;
}

const find = (snapshot: EncounterSnapshot, id: string) => snapshot.combatants.find((combatant) => combatant.id === id)!;

describe("a fight played by hand", () => {
  it("the party, played by a person, fights the AI's goblins to the end", () => {
    for (const seed of ["fight-a", "fight-b", "fight-c"]) {
      const fight = playFight(sample(seed), PARTY_PLAYS, basicDriver());
      expect(fight.outcome.completed, seed).toBe(true);
      // Every turn says who played it.
      const turns = fight.log.filter((entry) => entry.type === "TurnStarted");
      expect(turns.length).toBeGreaterThan(0);
      for (const turn of turns) {
        const party = String(turn.data?.combatantId).startsWith("pc-");
        expect(turn.data?.controller, turn.message).toBe(party ? "human" : "ai");
      }
      // The party's turns are its commands: an attack, a move, the end of the turn.
      expect(fight.commands.some((command) => command.kind === "use")).toBe(true);
      expect(fight.commands.some((command) => command.kind === "end-turn")).toBe(true);
      // The goblins' turns are the AI's.
      expect(fight.log.some((entry) => entry.type === "AiDecision" && String(entry.data?.combatantId).startsWith("enemy-"))).toBe(true);
      expect(fight.log.some((entry) => entry.type === "AiDecision" && String(entry.data?.combatantId).startsWith("pc-"))).toBe(false);
    }
  });

  it("with nobody playing, the AI plays every turn and nobody is asked anything", () => {
    const fight = playFight(sample("ai-only"), NOBODY_PLAYS, basicDriver());
    expect(fight.outcome.completed).toBe(true);
    expect(fight.commands).toEqual([]);
    expect(fight.questions).toEqual([]);
  });

  it("the first step rolls initiative if nobody has it, then opens the first turn", () => {
    const start = structuredClone(sampleEncounter);
    const { result } = runStep(start, [], { kind: "advance" }, EVERYONE_PLAYS);
    expect(result.log[0]!.type).toBe("InitiativeRolled");
    expect(result.status.kind).toBe("your-turn");
    expect(result.snapshot.round).toBe(1);
    // The encounter keeps its own seed; the step's was only for its dice.
    expect(result.snapshot.seed).toBe(start.seed);
  });

  it("refuses a command that can't be done, and changes nothing", () => {
    const opened = runStep(sample(), [], { kind: "advance" }, PARTY_PLAYS).result;
    const command: CombatCommand = { kind: "use", actorId: "pc-fighter", actionId: "longsword", target: { targetIds: ["enemy-goblin-2"] } };
    const problem = commandProblem(opened.snapshot, command);
    expect(problem).toMatch(/beyond 5 ft\. range/);
    const result = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: { kind: "command", command }, control: PARTY_PLAYS });
    expect(result).toEqual({ kind: "refused", reason: problem });
    expect(commandProblem(opened.snapshot, { kind: "end-turn", actorId: "pc-archer" })).toBe("It isn't Archer's turn");
  });
});

describe("commands", () => {
  const opened = () => runStep(sample("commands"), [], { kind: "advance" }, PARTY_PLAYS).result;

  it("AI: take this turn — the AI plays the rest of it, then it ends", () => {
    const start = opened();
    const { result } = runStep(start.snapshot, start.log, { kind: "command", command: { kind: "ai-turn", actorId: "pc-fighter" } }, PARTY_PLAYS);
    const fresh = result.log.slice(start.log.length);
    expect(fresh.some((entry) => entry.type === "AiDecision" && entry.data?.combatantId === "pc-fighter")).toBe(true);
    expect(result.status).toEqual({ kind: "advance" });
    expect(find(result.snapshot, "pc-fighter").actionEconomy).toMatchObject({ action: false, bonus: false });
  });

  it("an ability used by hand takes its slot and is logged for the DM to resolve", () => {
    const start = opened();
    const command: CombatCommand = { kind: "use-by-hand", actorId: "pc-fighter", actionId: "utility:help", targetIds: ["pc-archer"], note: "Help the archer" };
    const { result } = runStep(start.snapshot, start.log, { kind: "command", command }, PARTY_PLAYS);
    expect(find(result.snapshot, "pc-fighter").actionEconomy?.action).toBe(false);
    const used = result.log.find((entry) => entry.type === "ManualActionUsed")!;
    expect(used.message).toBe("Fighter uses Help on Archer: resolve it by hand");
    expect(used.data).toMatchObject({ actionId: "utility:help", targetIds: ["pc-archer"], note: "Help the archer" });
    expect(result.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    // Its action is spent now.
    expect(commandProblem(result.snapshot, { kind: "use", actorId: "pc-fighter", actionId: "longsword", target: { targetIds: ["enemy-goblin-1"] } }))
      .toBe("Fighter has already used its action");
  });

  it("moves through waypoints in order, and the turn stays open", () => {
    const start = opened();
    const fighter = find(start.snapshot, "pc-fighter").position;
    const waypoints = [{ x: fighter.x, y: fighter.y + 1 }, { x: fighter.x + 1, y: fighter.y + 1 }];
    const { result } = runStep(start.snapshot, start.log, { kind: "command", command: { kind: "move", actorId: "pc-fighter", waypoints } }, PARTY_PLAYS);
    expect(find(result.snapshot, "pc-fighter").position).toEqual(waypoints[1]);
    expect(result.log.filter((entry) => entry.type === "CombatantMoved")).toHaveLength(2);
    expect(result.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
  });

  it("an ability the engine doesn't run can't be used normally, only by hand", () => {
    const start = sample("unsupported");
    const fighter = start.definitions.find((definition) => definition.id === "def-fighter")!;
    fighter.actions = [...fighter.actions, { kind: "unsupported", id: "rally", name: "Rally", actionType: "bonus", automationSupport: "unsupported" }];
    const turn = runStep(start, [], { kind: "advance" }, PARTY_PLAYS).result;
    expect(commandProblem(turn.snapshot, { kind: "use", actorId: "pc-fighter", actionId: "rally" })).toBe("Rally isn't simulated: use it by hand");
    const { result } = runStep(turn.snapshot, turn.log, { kind: "command", command: { kind: "use-by-hand", actorId: "pc-fighter", actionId: "rally" } }, PARTY_PLAYS);
    expect(find(result.snapshot, "pc-fighter").actionEconomy?.bonus).toBe(false);
    expect(result.log.at(-1)!.message).toBe("Fighter uses Rally: resolve it by hand");
  });
});

/** The fighter next to a goblin; both sides played by people, so the goblin's opportunity attack is a question. */
function adjacent(): { snapshot: EncounterSnapshot; log: ReturnType<typeof runStep>["result"]["log"] } {
  const start = sample("oa");
  start.map.walls = [];
  start.map.terrain = [];
  find(start, "enemy-goblin-1").position = { x: 6, y: 4 };
  find(start, "pc-fighter").position = { x: 5, y: 4 };
  const opened = runStep(start, [], { kind: "advance" }, EVERYONE_PLAYS).result;
  expect(opened.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
  return { snapshot: opened.snapshot, log: opened.log };
}

describe("questions for a person", () => {
  const walkAway: CombatCommand = { kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 4 }] };

  it("an enemy a person plays is asked about its opportunity attack, with the board as it was then", () => {
    const { snapshot, log } = adjacent();
    const first = runPlayStep({ snapshot, log, step: { kind: "command", command: walkAway }, control: EVERYONE_PLAYS });
    expect(first.kind).toBe("needs-decision");
    if (first.kind !== "needs-decision") return;
    const request = first.request as ReactionRequest;
    expect(request).toMatchObject({ kind: "reaction", reactorId: "enemy-goblin-1", trigger: "enemy-leaves-reach", sourceId: "pc-fighter" });
    expect(request.options.map((option) => option.name)).toEqual(["Scimitar"]);
    expect(request.aiChoice).toBe(request.options[0]!.actionId);
    // The board when it asked: the fighter hasn't left its square yet.
    expect(find(first.board, "pc-fighter").position).toEqual({ x: 5, y: 4 });
  });

  it("answered yes, the goblin swings; answered no, it doesn't, and keeps its reaction", () => {
    const { snapshot, log } = adjacent();
    const yes = runStep(snapshot, log, { kind: "command", command: walkAway }, EVERYONE_PLAYS, aiAnswer);
    expect(yes.questions).toHaveLength(1);
    expect(yes.result.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(true);
    expect(find(yes.result.snapshot, "enemy-goblin-1").actionEconomy?.reaction).toBe(false);

    const no = runStep(snapshot, log, { kind: "command", command: walkAway }, EVERYONE_PLAYS, () => ({ kind: "reaction", actionId: null }));
    expect(no.result.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(false);
    expect(find(no.result.snapshot, "enemy-goblin-1").actionEconomy?.reaction).not.toBe(false);
    expect(find(no.result.snapshot, "pc-fighter").position).toEqual({ x: 2, y: 4 });
  });

  it("running a step again with the same answers gives the same log, and the question's log is where it began", () => {
    const { snapshot, log } = adjacent();
    const asked = runPlayStep({ snapshot, log, step: { kind: "command", command: walkAway }, control: EVERYONE_PLAYS });
    if (asked.kind !== "needs-decision") throw new Error("expected a question");
    const answers = [{ key: asked.request.key, answer: aiAnswer(asked.request) }];
    const once = runPlayStep({ snapshot, log, step: { kind: "command", command: walkAway }, control: EVERYONE_PLAYS, answers });
    const twice = runPlayStep({ snapshot, log, step: { kind: "command", command: walkAway }, control: EVERYONE_PLAYS, answers });
    expect(once).toEqual(twice);
    if (once.kind !== "done") throw new Error("expected the step to finish");
    expect(once.log.slice(0, asked.log.length)).toEqual(asked.log);
  });

  it("the AI's own creatures are never asked: the goblin it plays just swings", () => {
    const { snapshot, log } = adjacent();
    const result = runPlayStep({ snapshot, log, step: { kind: "command", command: walkAway }, control: PARTY_PLAYS });
    expect(result.kind).toBe("done");
    if (result.kind === "done") expect(result.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(true);
  });

  it("a reaction set to Always use or Never isn't asked about", () => {
    const { snapshot, log } = adjacent();
    const always: PlayControl = { ...EVERYONE_PLAYS, reactions: { "enemy-goblin-1:opportunity-attack": "use" } };
    const used = runStep(snapshot, log, { kind: "command", command: walkAway }, always);
    expect(used.questions).toEqual([]);
    expect(used.result.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(true);

    const never: PlayControl = { ...EVERYONE_PLAYS, reactions: { "enemy-goblin-1:opportunity-attack": "never" } };
    const declined = runStep(snapshot, log, { kind: "command", command: walkAway }, never);
    expect(declined.questions).toEqual([]);
    expect(declined.result.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(false);

    const leftToTheAi: PlayControl = { ...EVERYONE_PLAYS, askOpportunityAttacks: false };
    const aiDecides = runStep(snapshot, log, { kind: "command", command: walkAway }, leftToTheAi);
    expect(aiDecides.questions).toEqual([]);
    expect(aiDecides.result.log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(true);
  });
});

describe("who plays what", () => {
  const snapshot = sample();
  const goblin = find(snapshot, "enemy-goblin-1");
  const fighter = find(snapshot, "pc-fighter");

  it("a side's setting, unless the token has its own", () => {
    expect(controllerOf(snapshot, PARTY_PLAYS, fighter)).toBe("human");
    expect(controllerOf(snapshot, PARTY_PLAYS, goblin)).toBe("ai");
    expect(controllerOf(snapshot, { ...PARTY_PLAYS, tokens: { [goblin.id]: "human" } }, goblin)).toBe("human");
  });

  it("a dominated creature is played by whoever plays its dominator", () => {
    const dominated: CombatantState = { ...fighter, conditions: [{ id: "dom", name: "dominated", sourceCombatantId: goblin.id, startedRound: 1 }] };
    expect(controllerOf(snapshot, PARTY_PLAYS, dominated)).toBe("ai");
    expect(controllerOf(snapshot, { ...PARTY_PLAYS, tokens: { [goblin.id]: "human" } }, dominated)).toBe("human");
  });

  it("a summon is played by whoever plays its summoner", () => {
    const imp: CombatantState = { ...goblin, id: "imp", faction: "party", summon: { summonerId: fighter.id, generation: 1 } };
    expect(controllerOf(snapshot, PARTY_PLAYS, imp)).toBe("human");
    expect(controllerOf(snapshot, { ...PARTY_PLAYS, tokens: { [fighter.id]: "ai" } }, imp)).toBe("ai");
    expect(controllerOf(snapshot, { ...PARTY_PLAYS, tokens: { imp: "ai" } }, imp)).toBe("ai");
  });
});

export type { CreatureDefinition };
