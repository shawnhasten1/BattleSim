import {
  canAct,
  commandProblem,
  effectiveFaction,
  findReachableCells,
  getDefinition,
  getExecutableActions,
  gridDistance,
  movementOptionsFor,
  remainingMovementBudget,
  runPlayStep,
  sizeFootprint,
  type CombatCommand,
  type CombatLogEvent,
  type DecisionAnswer,
  type DecisionRequest,
  type EncounterSnapshot,
  type Id,
  type PlayControl,
  type PlayStep,
  type Point,
  type SimulationOutcome
} from "@/engine";

/** Plays a person's side in a headless fight: what to do on their turns, and how to answer their questions. */
export interface Driver {
  /** A person's creature's turn is open: the next command (end the turn when done). */
  turn: (snapshot: EncounterSnapshot, actorId: Id) => CombatCommand;
  /** A question for a person. Default: whatever the AI would choose. */
  decide?: (request: DecisionRequest, board: EncounterSnapshot) => DecisionAnswer;
}

/** The answer the AI would give, as a person's answer: what the tests use when a question isn't the point. */
export function aiAnswer(request: DecisionRequest): DecisionAnswer {
  switch (request.kind) {
    case "reaction": return { kind: "reaction", actionId: request.aiChoice };
    case "legendary-resistance": return { kind: "legendary-resistance", use: request.aiChoice };
    case "legendary-action":
    case "lair-action": return { kind: request.kind, pick: request.aiChoice };
    case "multiattack-swing": return { kind: "multiattack-swing" };
    case "roll": return { kind: "roll", outcome: request.outcome };
  }
}

export interface StepRun {
  result: Extract<ReturnType<typeof runPlayStep>, { kind: "done" }>;
  questions: DecisionRequest[];
}

/** One step, answering its questions with `decide` (re-running it each time, as the store will). */
export function runStep(snapshot: EncounterSnapshot, log: CombatLogEvent[], step: PlayStep, control: PlayControl, decide: Driver["decide"] = aiAnswer): StepRun {
  const questions: DecisionRequest[] = [];
  let answers: Array<{ key: string; answer: DecisionAnswer }> = [];
  let result = runPlayStep({ snapshot, log, step, control, answers });
  while (result.kind === "needs-decision") {
    questions.push(result.request);
    answers = [...result.answers, { key: result.request.key, answer: decide(result.request, result.board) }];
    result = runPlayStep({ snapshot, log, step, control, answers });
    if (questions.length > 200) throw new Error("A step kept asking questions");
  }
  if (result.kind === "refused") throw new Error(`Refused: ${result.reason}`);
  return { result, questions };
}

export interface PlayedFight {
  snapshot: EncounterSnapshot;
  log: CombatLogEvent[];
  outcome: SimulationOutcome;
  questions: DecisionRequest[];
  commands: CombatCommand[];
}

/** Play a fight to the end: the AI's sides by the AI, a person's by `driver`. */
export function playFight(start: EncounterSnapshot, control: PlayControl, driver: Driver, maxSteps = 2000): PlayedFight {
  let snapshot = start;
  let log: CombatLogEvent[] = [];
  let step: PlayStep = { kind: "advance" };
  const questions: DecisionRequest[] = [];
  const commands: CombatCommand[] = [];
  for (let count = 0; count < maxSteps; count += 1) {
    const { result, questions: asked } = runStep(snapshot, log, step, control, driver.decide);
    questions.push(...asked);
    snapshot = result.snapshot;
    log = result.log;
    if (result.status.kind === "over") {
      return { snapshot, log, outcome: result.status.outcome, questions, commands };
    }
    if (result.status.kind === "your-turn") {
      const command = driver.turn(snapshot, result.status.actorId);
      commands.push(command);
      step = { kind: "command", command };
    } else {
      step = { kind: "advance" };
    }
  }
  throw new Error("The fight didn't finish");
}

/**
 * A plain player: attack an enemy in reach with the first attack that can, else walk once toward the nearest enemy
 * and try again, else end the turn.
 */
export function basicDriver(decide?: Driver["decide"]): Driver {
  return {
    decide,
    turn(snapshot, actorId) {
      const actor = snapshot.combatants.find((combatant) => combatant.id === actorId)!;
      const definition = getDefinition(snapshot, actor);
      const enemies = snapshot.combatants.filter((combatant) => combatant.state === "active"
        && effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor));
      if (canAct(actor, "action")) {
        const attacks = getExecutableActions(definition).filter((action) => action.kind === "attack" && action.actionType === "action" && action.automationSupport === "full");
        for (const action of attacks) {
          for (const enemy of enemies) {
            const command: CombatCommand = { kind: "use", actorId, actionId: action.id, target: { targetIds: [enemy.id] } };
            if (!commandProblem(snapshot, command)) return command;
          }
        }
        if (!actor.turnFlags?.movementUsed && enemies.length > 0) {
          const move = stepToward(snapshot, actorId, enemies.map((enemy) => enemy.position));
          if (move) return move;
        }
      }
      return { kind: "end-turn", actorId };
    }
  };
}

/** A move for `actorId` that ends as close as it can get to the nearest of `goals`, or undefined if it can't get closer. */
export function stepToward(snapshot: EncounterSnapshot, actorId: Id, goals: Point[]): CombatCommand | undefined {
  const actor = snapshot.combatants.find((combatant) => combatant.id === actorId)!;
  const definition = getDefinition(snapshot, actor);
  const grid = snapshot.map.grid;
  const occupied = snapshot.combatants
    .filter((combatant) => combatant.id !== actorId && combatant.state === "active")
    .flatMap((combatant) => {
      const size = sizeFootprint(getDefinition(snapshot, combatant).size);
      const cells: Point[] = [];
      for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) cells.push({ x: combatant.position.x + x, y: combatant.position.y + y });
      return cells;
    });
  const distanceToGoal = (cell: Point) => Math.min(...goals.map((goal) => gridDistance(cell, goal, grid)));
  const here = distanceToGoal(actor.position);
  const reachable = findReachableCells(snapshot.map, actor.position, sizeFootprint(definition.size), remainingMovementBudget(snapshot, actor), occupied, movementOptionsFor(definition))
    .filter((candidate) => distanceToGoal(candidate.cell) < here)
    .sort((a, b) => distanceToGoal(a.cell) - distanceToGoal(b.cell) || a.cost - b.cost);
  for (const candidate of reachable) {
    const command: CombatCommand = { kind: "move", actorId, waypoints: [candidate.cell] };
    if (!commandProblem(snapshot, command)) return command;
  }
  return undefined;
}
