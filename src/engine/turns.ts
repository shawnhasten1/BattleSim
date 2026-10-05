import {
  activeFactions,
  admitReinforcements,
  compareInitiative,
  createEngineState,
  despawnExpiredSummons,
  event,
  insertIntoTurnOrder,
  rollInitiative,
  runDownedTurn,
  runTurnStart,
  tickZones,
  type EngineState
} from "./combat";
import { finishTurn, runLairWindow, takeAutomatedTurn, takeSurgedAction } from "./simulation";
import type { CombatantState, CombatLogEvent, EncounterSnapshot, Id } from "./types";

/* ─── The turn sequencer ───────────────────────────────────────────────────────
 * One place decides whose turn comes next and what happens between turns: the round wrap and its hooks, the lair
 * action on initiative 20, a downed creature's death save, and the start of the turn. Auto Run (`runAutomatedEncounter`),
 * the Step button (`stepAutomatedTurn`) and Play all go through `openNextTurn` and `closeTurn`, so a new turn-boundary
 * rule added here reaches every way of running a fight. Before this, Step re-implemented the loop by hand and the two
 * drifted apart.
 */

export interface SimulationOutcome {
  winner: string | null;
  rounds: number;
  completed: boolean;
  warnings: string[];
}

export interface SimulationRunResult {
  snapshot: EncounterSnapshot;
  log: CombatLogEvent[];
  outcome: SimulationOutcome;
}

export type TurnOpening =
  /** `actor`'s turn has started (`runTurnStart` has run and `TurnStarted` is logged): it can act. */
  | { kind: "turn"; actor: CombatantState }
  /** No turn: one side is left, the round limit is reached, or nobody can take a turn any more. */
  | { kind: "over"; reason: "decided" | "round-limit" | "stalled" };

export interface OpenTurnOptions {
  /** The fight stops before a round past this one would start. Default: no limit. */
  maxRounds?: number;
  /** Play: who plays each creature. Recorded on `TurnStarted` as `controller`. */
  controllerOf?: (combatant: CombatantState) => "human" | "ai";
}

/** How many rounds one `openNextTurn` may wrap without anyone getting a turn before it gives up. */
const MAX_IDLE_ROUNDS = 100;

/**
 * Auto Run's start: roll initiative unless every combatant has it, else put them in initiative order. Batch runs keep
 * initiative that was rolled before the run, so every seed of a batch uses that order.
 *
 * Ties in a pre-rolled order go by id, not by Dex as `compareInitiative` breaks them. That's how Auto Run has always
 * sorted, and changing it would change the results of every Batch over a pre-rolled order, so it's kept.
 */
export function ensureInitiative(state: EngineState): void {
  if (state.snapshot.combatants.every((combatant) => typeof combatant.initiative === "number")) {
    state.snapshot.combatants.sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.id.localeCompare(b.id));
    return;
  }
  rollInitiative(state);
}

/**
 * The start of each Step (and each Play step): the board may have changed by hand since the last one.
 * - Before the fight, anyone without initiative means everyone rolls.
 * - Mid-fight, a token added since rolls its own and joins the order where it falls, as a summon does: later this
 *   round, or next round if its count has passed.
 * - Then the order is re-sorted (`compareInitiative`), keeping the turn on whoever has it.
 */
export function syncTurnOrder(state: EngineState): void {
  const snapshot = state.snapshot;
  const missing = snapshot.combatants.filter((combatant) => typeof combatant.initiative !== "number");
  if (missing.length > 0 && (snapshot.round <= 0 || missing.length === snapshot.combatants.length)) {
    rollInitiative(state);
    return;
  }
  const currentId = snapshot.round > 0 ? snapshot.combatants[snapshot.turnIndex]?.id : undefined;
  if (missing.length > 0) {
    snapshot.combatants = snapshot.combatants.filter((combatant) => typeof combatant.initiative === "number");
    if (currentId) snapshot.turnIndex = Math.max(0, snapshot.combatants.findIndex((combatant) => combatant.id === currentId));
    for (const newcomer of missing) {
      const { initiative } = insertIntoTurnOrder(state, [newcomer]);
      state.log.push(event(state, "InitiativeRolled", `${newcomer.displayName} joins the fight on initiative ${initiative}`, {
        rolls: [{ combatantId: newcomer.id, total: initiative }],
        order: snapshot.combatants.map((combatant) => combatant.id)
      }));
    }
  }
  snapshot.combatants.sort((a, b) => compareInitiative(snapshot, a, b));
  if (currentId) {
    const index = snapshot.combatants.findIndex((combatant) => combatant.id === currentId);
    if (index >= 0) snapshot.turnIndex = index;
  }
}

/**
 * Move on to the next creature that can take a turn, and start it. On the way it wraps the round (and runs the round's
 * hooks: reinforcements arrive, zones tick, summons expire), takes the lair action on initiative 20, rolls downed
 * creatures' death saves (or stands a regenerating one back up), and skips anyone a start-of-turn effect has taken out.
 *
 * Returns the creature whose turn is now open, or why there's no turn. The caller plays the turn and then calls
 * `closeTurn` — unless the fight was decided during it, as Auto Run does.
 */
export function openNextTurn(state: EngineState, options: OpenTurnOptions = {}): TurnOpening {
  const maxRounds = options.maxRounds ?? Number.POSITIVE_INFINITY;
  const snapshot = state.snapshot;
  let next = snapshot.round > 0 ? snapshot.turnIndex + 1 : 0;
  let idleRounds = 0;
  for (;;) {
    if (next >= snapshot.combatants.length) {
      next = 0;
    }
    if (next === 0) {
      if (activeFactions(snapshot).size <= 1) {
        return { kind: "over", reason: "decided" };
      }
      if (snapshot.round >= maxRounds) {
        return { kind: "over", reason: "round-limit" };
      }
      if (idleRounds >= MAX_IDLE_ROUNDS) {
        return { kind: "over", reason: "stalled" };
      }
      snapshot.round += 1;
      idleRounds += 1;
      admitReinforcements(state);
      tickZones(state);
      despawnExpiredSummons(state);
    }
    snapshot.turnIndex = next;
    const actor = snapshot.combatants[next];
    if (!actor) {
      next = snapshot.turnIndex + 1;
      continue;
    }
    runLairWindow(state, actor);
    if (activeFactions(snapshot).size <= 1) {
      return { kind: "over", reason: "decided" };
    }
    if (actor.state === "downed") {
      // A regenerating monster stands up and carries on into a normal turn; anyone else rolls a death save.
      if (runDownedTurn(state, actor) !== "recovered") {
        if (activeFactions(snapshot).size <= 1) {
          return { kind: "over", reason: "decided" };
        }
        // Re-read the index: an insertion during the turn (a summon, a split) moves it.
        next = snapshot.turnIndex + 1;
        continue;
      }
    }
    if (actor.state !== "active") {
      next = snapshot.turnIndex + 1;
      continue;
    }
    runTurnStart(state, actor);
    // A zone can down or kill a creature before its turn body runs (Insect Plague on a low-HP combatant).
    if (actor.state !== "active") {
      if (activeFactions(snapshot).size <= 1) {
        return { kind: "over", reason: "decided" };
      }
      next = snapshot.turnIndex + 1;
      continue;
    }
    state.log.push(event(state, "TurnStarted", `${actor.displayName} started a turn`,
      options.controllerOf ? { combatantId: actor.id, controller: options.controllerOf(actor) } : { combatantId: actor.id }));
    return { kind: "turn", actor };
  }
}

/** Everything that ends a turn: the turn-end rules, the legendary-action window, and the spent action and bonus action. */
export function closeTurn(state: EngineState, actorId: Id): void {
  finishTurn(state, actorId);
  const actor = state.snapshot.combatants.find((combatant) => combatant.id === actorId);
  if (actor) {
    closeActionEconomy(actor);
  }
}

/** A turn is still open while its creature has its action or its bonus action. */
export function hasOpenActionEconomy(combatant: CombatantState): boolean {
  const actionEconomy = combatant.actionEconomy;
  // The reaction is deliberately excluded: a finished turn keeps its reaction available (see `closeActionEconomy`),
  // so it is not a signal that the turn's end-of-turn bookkeeping still needs to run.
  return Boolean(actionEconomy && (actionEconomy.action || actionEconomy.bonus));
}

/**
 * Ending a turn spends the remaining action and bonus action, but NOT the reaction: a creature keeps its reaction
 * from the end of its turn until the start of its next one — that is the whole window in which opportunity attacks,
 * Shield, Counterspell and Hellish Rebuke fire. `resetActionEconomy` refreshes it at the start of its next turn.
 */
export function closeActionEconomy(combatant: CombatantState): void {
  const current = combatant.actionEconomy ?? { action: true, bonus: true, reaction: true };
  combatant.actionEconomy = { ...current, action: false, bonus: false };
}

/** The outcome once only one side is left (logging `CombatEnded` once), or null while the fight goes on. */
export function combatOutcome(state: EngineState): SimulationOutcome | null {
  const factions = [...activeFactions(state.snapshot)];
  if (factions.length > 1) {
    return null;
  }
  const winner = factions[0] ?? null;
  if (!state.log.some((entry) => entry.type === "CombatEnded")) {
    state.log.push(event(state, "CombatEnded", winner ? `${winner} wins` : "Combat has no active factions", {
      winner,
      rounds: state.snapshot.round
    }));
  }
  return {
    winner,
    rounds: state.snapshot.round,
    completed: winner !== null,
    warnings: state.log
      .filter((entry) => entry.type === "AutomationWarning")
      .map((entry) => entry.message)
  };
}

/** Let the AI play `actor`'s open turn. A resolver throw from an AI mispick is contained to a lost turn and a warning. */
export function playAutomatedTurn(state: EngineState, actor: CombatantState): string | undefined {
  try {
    const outcome = takeAutomatedTurn(state, actor);
    // Action Surge: the turn's action is spent; another one, if there's something worth hitting.
    if (takeSurgedAction(state, actor)) return takeAutomatedTurn(state, actor);
    return outcome;
  } catch (error) {
    const warning = `${actor.displayName}: automated turn failed — ${error instanceof Error ? error.message : String(error)}`;
    state.log.push(event(state, "AutomationWarning", warning, { combatantId: actor.id }));
    return warning;
  }
}

/**
 * The Step button: bring the order up to date, close a turn that was left open, then open the next turn and let the AI
 * play it. Returns whose turn it was (none when nobody could take one) and the outcome if the fight is now over.
 */
export function stepAutomatedTurn(state: EngineState): { actor?: CombatantState; outcome: SimulationOutcome | null } {
  syncTurnOrder(state);
  if (activeFactions(state.snapshot).size <= 1) {
    return { outcome: combatOutcome(state) };
  }
  const current = state.snapshot.round > 0 ? state.snapshot.combatants[state.snapshot.turnIndex] : undefined;
  if (current && hasOpenActionEconomy(current)) {
    closeTurn(state, current.id);
    if (activeFactions(state.snapshot).size <= 1) {
      return { outcome: combatOutcome(state) };
    }
  }
  const opening = openNextTurn(state);
  if (opening.kind === "over") {
    return { outcome: combatOutcome(state) };
  }
  const { actor } = opening;
  playAutomatedTurn(state, actor);
  if (activeFactions(state.snapshot).size > 1) {
    closeTurn(state, actor.id);
  } else {
    closeActionEconomy(actor);
  }
  return { actor, outcome: combatOutcome(state) };
}

/**
 * Auto Run: play the fight to the end (or `maxRounds`) with the AI on every side. Resumes from wherever the snapshot's
 * turn order already stands — the DM may have stepped a few turns by hand first — rather than restarting at a fresh
 * round, so nobody gets a phantom extra turn and round-scoped state (a surprised creature's lost turn) stays in step.
 */
export function runAutomatedEncounter(snapshot: EncounterSnapshot, maxRounds = 50): SimulationRunResult {
  const state = createEngineState(snapshot);
  const warnings: string[] = [];
  ensureInitiative(state);
  return playToTheEnd(state, maxRounds, warnings);
}

/**
 * Auto Run from a fight in progress (Play's "Odds from here"): the turn that's open is played out by the AI and closed,
 * then on to the end as Auto Run goes.
 */
export function runAutomatedFromHere(snapshot: EncounterSnapshot, maxRounds = 50): SimulationRunResult {
  const state = createEngineState(snapshot);
  const warnings: string[] = [];
  ensureInitiative(state);
  const open = state.snapshot.round > 0 ? state.snapshot.combatants[state.snapshot.turnIndex] : undefined;
  if (open && open.state === "active" && hasOpenActionEconomy(open) && activeFactions(state.snapshot).size > 1) {
    const warning = playAutomatedTurn(state, open);
    if (warning) warnings.push(warning);
    if (activeFactions(state.snapshot).size > 1) closeTurn(state, open.id);
  }
  return playToTheEnd(state, maxRounds, warnings);
}

/** The rest of a fight, turn by turn, every creature played by the AI; then its outcome. */
function playToTheEnd(state: EngineState, maxRounds: number, warnings: string[]): SimulationRunResult {
  if (activeFactions(state.snapshot).size > 1 && state.snapshot.round < maxRounds) {
    for (;;) {
      const opening = openNextTurn(state, { maxRounds });
      if (opening.kind === "over") {
        break;
      }
      const warning = playAutomatedTurn(state, opening.actor);
      if (warning) {
        warnings.push(warning);
      }
      if (activeFactions(state.snapshot).size <= 1) {
        break;
      }
      closeTurn(state, opening.actor.id);
    }
  }

  const factions = [...activeFactions(state.snapshot)];
  const winner = factions.length === 1 ? factions[0] ?? null : null;
  state.log.push(event(state, "CombatEnded", winner ? `${winner} wins` : "Combat reached the round limit", {
    winner,
    rounds: state.snapshot.round
  }));

  return {
    snapshot: state.snapshot,
    log: state.log,
    outcome: {
      winner,
      rounds: state.snapshot.round,
      completed: winner !== null,
      warnings
    }
  };
}
