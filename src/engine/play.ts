import { activeFactions, canAct, createEngineState, effectiveFaction, upcastBaseId, type EngineState } from "./combat";
import { currentTurnActor, executeCommand, type CombatCommand } from "./commands";
import {
  decisionSubject,
  type DecisionAnswer,
  type DecisionRequest,
  type ReactionAnswer,
  type ReactionRequest,
  type RollOutcome,
  type RollRequest
} from "./decisions";
import { closeActionEconomy, closeTurn, combatOutcome, hasOpenActionEconomy, openNextTurn, playAutomatedTurn, syncTurnOrder, type SimulationOutcome } from "./turns";
import type { CombatantState, CombatLogEvent, EncounterSnapshot, Faction, Id } from "./types";

/* ─── Play: a fight run by hand ─────────────────────────────────────────────────
 * Some sides (or single creatures) are played by a person, the rest by the AI. A fight goes forward one step at a
 * time — a command on a person's turn, or `advance` to the next turn (played by the AI when it's the AI's) — and every
 * step runs through `runPlayStep`.
 *
 * The engine can't stop in the middle of an attack to wait for a click, so a choice a person has to make (a
 * reaction, a legendary action, the next swing of a multiattack…) is handled by running the step again: the first time
 * the question comes up with no answer, the step finishes on the AI's choice, is thrown away, and `needs-decision`
 * comes back with the question and the board as it was then. Given the answer, the same step runs again from its start
 * with the same seed, so everything up to the question repeats exactly, and this time the answer is there. (Throwing
 * to stop wouldn't work: the AI catches errors around its moves and resolvers.)
 */

export type Controller = "human" | "ai";

/**
 * How a person wants one of their creatures' reactions handled for the rest of the fight: ask each time, use it every
 * time it's offered, or never.
 */
export type ReactionPolicy = "ask" | "use" | "never";

/** The policy key that covers all of a creature's opportunity attacks. */
export const OPPORTUNITY_ATTACKS = "opportunity-attack";

export interface PlayControl {
  /** Who plays each side. A side left out is the AI's. */
  factions: Partial<Record<Faction, Controller>>;
  /** Single creatures handed to the other player than their side's. */
  tokens?: Record<Id, Controller>;
  /** `reactionPolicyKey(combatantId, actionId or OPPORTUNITY_ATTACKS)` → how it's handled. */
  reactions?: Record<string, ReactionPolicy>;
  /** Ask before a person's creatures react. Off: the AI decides unless a reaction has its own policy. Default on. */
  askReactions?: boolean;
  /** The same for opportunity attacks. Default on. */
  askOpportunityAttacks?: boolean;
}

export function reactionPolicyKey(combatantId: Id, reaction: Id): string {
  return `${combatantId}:${reaction}`;
}

/**
 * Who plays `combatant`: a dominated creature is played by whoever plays its dominator, a summon by whoever plays its
 * summoner (unless it has been handed over itself), anyone else by its own setting or its side's.
 */
export function controllerOf(snapshot: EncounterSnapshot, control: PlayControl, combatant: CombatantState, depth = 0): Controller {
  if (depth < 4) {
    const dominated = combatant.conditions?.find((condition) => condition.name === "dominated");
    const dominator = dominated?.sourceCombatantId ? snapshot.combatants.find((other) => other.id === dominated.sourceCombatantId) : undefined;
    if (dominator && dominator.id !== combatant.id) {
      return controllerOf(snapshot, control, dominator, depth + 1);
    }
  }
  const own = control.tokens?.[combatant.id];
  if (own) return own;
  if (combatant.summon && depth < 4) {
    const summoner = snapshot.combatants.find((other) => other.id === combatant.summon!.summonerId);
    if (summoner) return controllerOf(snapshot, control, summoner, depth + 1);
  }
  return control.factions[effectiveFaction(snapshot, combatant)] ?? "ai";
}

/** One step of a fight in Play: a command on a person's open turn, or on to the next turn. */
export type PlayStep = { kind: "command"; command: CombatCommand } | { kind: "advance" };

/** An answer given to a question a step asked, under the question's key. */
export interface RecordedAnswer {
  key: string;
  answer: DecisionAnswer;
}

/** A roll a step made, for the roll strip: its key (to override it), what it was, and where it fell in the log. */
export interface RollRecord {
  key: string;
  request: RollRequest;
  logLength: number;
}

export type PlayStatus =
  /** A person's creature's turn is open, waiting for their commands. */
  | { kind: "your-turn"; actorId: Id }
  /** Run another `advance` step: the next turn hasn't been opened yet. */
  | { kind: "advance" }
  | { kind: "over"; outcome: SimulationOutcome };

export interface PlayStepInput {
  snapshot: EncounterSnapshot;
  log: CombatLogEvent[];
  step: PlayStep;
  control: PlayControl;
  /** Answers to this step's questions so far, in the order it asks them. */
  answers?: RecordedAnswer[];
  /** Rolls a DM has overruled, by key. */
  overrides?: Record<string, RollOutcome>;
}

export type PlayStepResult =
  | { kind: "done"; snapshot: EncounterSnapshot; log: CombatLogEvent[]; status: PlayStatus; answers: RecordedAnswer[]; rolls: RollRecord[] }
  /** A person has to choose: `request` is the question, `board` and `log` are how things stood when it came up. */
  | { kind: "needs-decision"; request: DecisionRequest; board: EncounterSnapshot; log: CombatLogEvent[]; answers: RecordedAnswer[]; rolls: RollRecord[] }
  /** The command can't be done (out of range, no action left…): nothing changed. */
  | { kind: "refused"; reason: string };

/** The seed a step runs on: where it starts in the log, so running it again rolls the same dice. */
export function playSeed(snapshot: EncounterSnapshot, log: CombatLogEvent[]): string {
  return `${snapshot.seed}:play:${log.length}`;
}

/** Run one step. Pure: the snapshot and log passed in are left as they were. */
export function runPlayStep(input: PlayStepInput): PlayStepResult {
  const state = createEngineState({ ...input.snapshot, seed: playSeed(input.snapshot, input.log) });
  state.log = [...input.log];
  const given = input.answers ?? [];
  const used: RecordedAnswer[] = [];
  const rolls: RollRecord[] = [];
  let pending: { request: DecisionRequest; board: EncounterSnapshot; log: CombatLogEvent[] } | undefined;
  let desync: string | undefined;

  state.decide = (request) => {
    if (request.kind === "roll") {
      if (!pending) rolls.push({ key: request.key, request, logLength: state.log.length });
      const outcome = input.overrides?.[request.key];
      return outcome ? { kind: "roll", outcome } : undefined;
    }
    const subject = state.snapshot.combatants.find((combatant) => combatant.id === decisionSubject(request));
    if (!subject || controllerOf(state.snapshot, input.control, subject) === "ai") {
      return undefined;
    }
    // A person's own answer to this very question stands, even if they've since set the reaction to always or never.
    const answer = pending ? undefined : given[used.length];
    if (answer?.key === request.key) {
      used.push(answer);
      return answer.answer;
    }
    if (request.kind === "reaction") {
      const ruled = ruleReaction(input.control, request);
      if (ruled === "ai") return undefined;
      if (ruled !== "ask") return ruled;
    }
    // Past the first unanswered question the run is thrown away: the AI's choices will do.
    if (pending) return undefined;
    if (answer) {
      desync ??= `expected ${answer.key}, reached ${request.key}`;
      return undefined;
    }
    pending = { request, board: withSeed(structuredClone(state.snapshot), input.snapshot.seed), log: [...state.log] };
    return undefined;
  };

  let status: PlayStatus;
  try {
    status = runStep(state, input.step, input.control);
  } catch (error) {
    // A question came up first: whatever went wrong after it happened on the AI's stand-in answer.
    if (pending) return { kind: "needs-decision", ...pending, answers: used, rolls };
    return { kind: "refused", reason: error instanceof Error ? error.message : String(error) };
  }
  if (desync) {
    throw new Error(`Play desync: ${desync}`);
  }
  if (pending) {
    return { kind: "needs-decision", ...pending, answers: used, rolls };
  }
  return { kind: "done", snapshot: withSeed(state.snapshot, input.snapshot.seed), log: state.log, status, answers: used, rolls };
}

/** The step's own seed is only for its dice: the encounter keeps its own. */
function withSeed(snapshot: EncounterSnapshot, seed: string): EncounterSnapshot {
  snapshot.seed = seed;
  return snapshot;
}

function runStep(state: EngineState, step: PlayStep, control: PlayControl): PlayStatus {
  const controller = (combatant: CombatantState) => controllerOf(state.snapshot, control, combatant);
  if (step.kind === "command") {
    const command = step.command;
    executeCommand(state, command);
    // The DM's hand changes nothing about whose turn it is.
    if (command.kind === "dm") return playStatusOf(state.snapshot, control);
    if (activeFactions(state.snapshot).size <= 1) return over(state);
    return command.kind === "end-turn" || command.kind === "ai-turn"
      ? { kind: "advance" }
      : { kind: "your-turn", actorId: command.actorId };
  }

  // A token may have been added by hand since the last step, or the order edited.
  syncTurnOrder(state);
  if (activeFactions(state.snapshot).size <= 1) return over(state);
  // A turn left open (the board came from Step, or a reload) is closed before the next one opens.
  const open = currentTurnActor(state.snapshot);
  if (open && hasOpenActionEconomy(open)) {
    closeTurn(state, open.id);
    if (activeFactions(state.snapshot).size <= 1) return over(state);
  }
  const opening = openNextTurn(state, { controllerOf: controller });
  if (opening.kind === "over") return over(state);
  const { actor } = opening;
  if (controller(actor) === "human" && playableByHand(actor)) {
    return { kind: "your-turn", actorId: actor.id };
  }
  playAutomatedTurn(state, actor);
  if (activeFactions(state.snapshot).size <= 1) {
    closeActionEconomy(actor);
    return over(state);
  }
  closeTurn(state, actor.id);
  if (activeFactions(state.snapshot).size <= 1) return over(state);
  return { kind: "advance" };
}

/**
 * Where a fight in Play stands on `snapshot`, without running anything: after an undo, or a reload. A person's
 * creature with its turn open waits for them; otherwise the next step is `advance` (which also closes a turn the AI
 * left open), unless one side is left.
 */
export function playStatusOf(snapshot: EncounterSnapshot, control: PlayControl): PlayStatus {
  const factions = [...activeFactions(snapshot)];
  if (snapshot.round > 0 && factions.length <= 1) {
    const winner = factions[0] ?? null;
    return { kind: "over", outcome: { winner, rounds: snapshot.round, completed: winner !== null, warnings: [] } };
  }
  const actor = currentTurnActor(snapshot);
  if (actor && hasOpenActionEconomy(actor) && controllerOf(snapshot, control, actor) === "human" && playableByHand(actor)) {
    return { kind: "your-turn", actorId: actor.id };
  }
  return { kind: "advance" };
}

function over(state: EngineState): PlayStatus {
  return { kind: "over", outcome: combatOutcome(state)! };
}

/**
 * Whether a person gets to play this turn. A creature that can't act at all (stunned, surprised in round 1) just loses
 * it, and a confused one's turn is rolled — the AI's turn handles both, as it always has.
 */
function playableByHand(actor: CombatantState): boolean {
  if ((actor.conditions ?? []).some((condition) => condition.modifiers?.forcesRandomAction)) return false;
  return canAct(actor, "action") || canAct(actor, "bonus");
}

/**
 * A person's standing orders for a reaction: an answer when they're settled ("use it every time", "never"), `"ai"`
 * when they've left it to the AI, or `"ask"`.
 */
function ruleReaction(control: PlayControl, request: ReactionRequest): ReactionAnswer | "ask" | "ai" {
  const opportunity = request.trigger === "enemy-leaves-reach";
  const asking = (opportunity ? control.askOpportunityAttacks : control.askReactions) !== false;
  // A reaction's setting covers it at every slot: Counterspell's is one, whichever slot it's cast with.
  const policies = request.options.map((option) => ({
    option,
    policy: control.reactions?.[reactionPolicyKey(request.reactorId, opportunity ? OPPORTUNITY_ATTACKS : upcastBaseId(option.actionId))]
  }));
  const always = policies.filter(({ policy }) => policy === "use").map(({ option }) => option);
  if (always.length > 0) {
    // The AI's pick if it's one of them; else, for a counter, the slot surest to stop the spell (the cheaper on a tie).
    const surest = [...always].sort((a, b) => (b.counter?.chance ?? 0) - (a.counter?.chance ?? 0) || (a.counter?.slot ?? 0) - (b.counter?.slot ?? 0))[0]!;
    return { kind: "reaction", actionId: request.aiChoice && always.some((option) => option.actionId === request.aiChoice) ? request.aiChoice : surest.actionId };
  }
  if (policies.every(({ policy }) => policy === "never")) {
    return { kind: "reaction", actionId: null };
  }
  const open = policies.filter(({ policy }) => policy !== "never");
  if (open.every(({ policy }) => policy === undefined) && !asking) return "ai";
  return "ask";
}
