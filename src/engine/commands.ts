import {
  activeFactions,
  canAct,
  casterLevelOf,
  findActionDefinition,
  findCombatant,
  getDefinition,
  conditionByDm,
  moveCombatant,
  placeByDm,
  repositionZone,
  restoreReactionByDm,
  setHpByDm,
  toggleDoorByDm,
  resolveAreaTargeting,
  resolveManualAction,
  resolveBeamCount,
  resolveUse,
  spatialDistanceToPoint,
  spellSlotLevel,
  chosenTargetCount,
  standingProblem,
  targetingProblem,
  validateBuffTargeting,
  validateHealingTargeting,
  validateOriginTargeting,
  validateRepositionTargeting,
  type EngineState,
  type UseTarget
} from "./combat";
import { canPayFor } from "./multiattack";
import { previewMove, previewRoutine } from "./preview";
import { upcastExtraTargetCapacity } from "./simulation";
import { closeActionEconomy, closeTurn, playAutomatedTurn } from "./turns";
import type { ActionDefinition, CombatantState, ConditionName, EncounterSnapshot, Id, Point } from "./types";

/* ─── Commands ──────────────────────────────────────────────────────────────────
 * What a player does on their creature's turn in Play. Each one calls the resolvers the AI calls (through
 * `resolveUse` for an ability), so nothing about the rules lives here or in the UI. `commandProblem` says why a
 * command can't be done right now, with the words the resolvers would throw.
 */

export type CombatCommand =
  /** Walk (or fly) through `waypoints` in order; the last one is the destination. */
  | { kind: "move"; actorId: Id; waypoints: Point[]; altitude?: number }
  /** Use an ability the engine runs, aimed at `target`. */
  | { kind: "use"; actorId: Id; actionId: Id; target?: UseTarget }
  /** Use an ability by hand: it takes its slot and its cost and is logged; the DM applies what it does. */
  | { kind: "use-by-hand"; actorId: Id; actionId: Id; targetIds?: Id[]; note?: string }
  /** Move a zone the creature controls (Moonbeam): a bonus action. */
  | { kind: "move-zone"; actorId: Id; zoneId: Id; destination: Point }
  /** Hand the rest of this turn to the AI, then end it. */
  | { kind: "ai-turn"; actorId: Id }
  | { kind: "end-turn"; actorId: Id }
  /** The DM changes the board by hand, whoever's turn it is. Logged as the DM's. */
  | { kind: "dm"; change: DmChange };

/** What the DM can change by hand in a fight. Each is logged as the DM's (`source: "dm"`). */
export type DmChange =
  /** Put a creature on a square: no movement spent, nothing provoked or set off. */
  | { kind: "place"; combatantId: Id; destination: Point }
  /** Set its hit points, and its temporary ones if given. */
  | { kind: "hp"; combatantId: Id; hp: number; tempHp?: number }
  /** Put a condition on it, or take one off. */
  | { kind: "condition"; combatantId: Id; add?: ConditionName; removeId?: Id }
  /** Give it back the reaction it has used. */
  | { kind: "reaction"; combatantId: Id }
  /** Open or close a door. */
  | { kind: "door"; wallId: Id; open: boolean };

/** The creature whose turn is open, if the fight has started and it can still act. */
export function currentTurnActor(snapshot: EncounterSnapshot): CombatantState | undefined {
  if (snapshot.round <= 0) return undefined;
  const actor = snapshot.combatants[snapshot.turnIndex];
  return actor && actor.state === "active" ? actor : undefined;
}

function notYourTurn(snapshot: EncounterSnapshot, actorId: Id): string {
  const actor = snapshot.combatants.find((combatant) => combatant.id === actorId);
  return `It isn't ${actor?.displayName ?? "that creature"}'s turn`;
}

/** Do `command` on the open turn. Throws when it can't be done; nothing it did is kept then (the caller discards the state). */
export function executeCommand(state: EngineState, command: CombatCommand): void {
  if (command.kind === "dm") {
    applyDmChange(state, command.change);
    return;
  }
  const actor = currentTurnActor(state.snapshot);
  if (!actor || actor.id !== command.actorId) {
    throw new Error(notYourTurn(state.snapshot, command.actorId));
  }
  switch (command.kind) {
    case "move": {
      if (command.waypoints.length === 0) throw new Error("Pick where to move");
      const problem = previewMove(state.snapshot, actor.id, command.waypoints, command.altitude).problem;
      if (problem) throw new Error(problem);
      command.waypoints.forEach((waypoint, index) => {
        // An opportunity attack on the way can drop it short of the rest of the route.
        if (actor.state !== "active") return;
        moveCombatant(state, actor.id, waypoint, index === command.waypoints.length - 1 ? { altitude: command.altitude } : {});
      });
      return;
    }
    case "use":
      resolveUse(state, actor.id, command.actionId, command.target ?? {});
      return;
    case "use-by-hand":
      resolveManualAction(state, actor.id, command.actionId, { targetIds: command.targetIds, note: command.note });
      return;
    case "move-zone":
      repositionZone(state, actor.id, command.zoneId, command.destination);
      return;
    case "ai-turn":
      playAutomatedTurn(state, actor);
      endTurn(state, actor);
      return;
    case "end-turn":
      endTurn(state, actor);
      return;
  }
}

function applyDmChange(state: EngineState, change: DmChange): void {
  switch (change.kind) {
    case "place":
      placeByDm(state, change.combatantId, change.destination);
      return;
    case "hp":
      setHpByDm(state, change.combatantId, change.hp, change.tempHp);
      return;
    case "condition":
      conditionByDm(state, change.combatantId, change);
      return;
    case "reaction":
      restoreReactionByDm(state, change.combatantId);
      return;
    case "door":
      toggleDoorByDm(state, change.wallId, change.open);
      return;
  }
}

/** Close the turn — unless the fight just ended on it, when only the spent action and bonus action are closed (as Auto Run does). */
function endTurn(state: EngineState, actor: CombatantState): void {
  if (activeFactions(state.snapshot).size > 1) {
    closeTurn(state, actor.id);
  } else {
    closeActionEconomy(actor);
  }
}

/** Why `command` can't be done right now, or undefined if it can. */
export function commandProblem(snapshot: EncounterSnapshot, command: CombatCommand): string | undefined {
  if (command.kind === "dm") {
    const change = command.change;
    if (change.kind === "door") {
      const wall = snapshot.map.walls.find((candidate) => candidate.id === change.wallId);
      return !wall?.doorState ? "That isn't a door" : wall.doorState === "destroyed" ? "That door is destroyed" : undefined;
    }
    const combatant = snapshot.combatants.find((candidate) => candidate.id === change.combatantId);
    if (!combatant) return "That creature isn't in the fight";
    if (change.kind !== "place") return undefined;
    if (combatant.position.x === change.destination.x && combatant.position.y === change.destination.y) return `${combatant.displayName} is already there`;
    return standingProblem(snapshot, combatant.id, change.destination);
  }
  const actor = currentTurnActor(snapshot);
  if (!actor || actor.id !== command.actorId) {
    return notYourTurn(snapshot, command.actorId);
  }
  switch (command.kind) {
    case "move":
      return command.waypoints.length === 0 ? "Pick where to move" : previewMove(snapshot, actor.id, command.waypoints, command.altitude).problem;
    case "use":
      return actionProblem(snapshot, actor.id, command.actionId) ?? targetProblem(snapshot, actor.id, command.actionId, command.target ?? {});
    case "use-by-hand":
      return actionProblem(snapshot, actor.id, command.actionId, { byHand: true });
    case "move-zone":
      return zoneMoveProblem(snapshot, actor, command.zoneId, command.destination);
    case "ai-turn":
    case "end-turn":
      return undefined;
  }
}

const SLOT_NAME: Record<"action" | "bonus" | "reaction", string> = { action: "action", bonus: "bonus action", reaction: "reaction" };

/** Why `actor` can't move its zone `zoneId` (Moonbeam) to `destination`, as `repositionZone` would refuse; leave it out to ask about the zone alone. */
export function zoneMoveProblem(snapshot: EncounterSnapshot, actor: CombatantState, zoneId: Id, destination?: Point): string | undefined {
  const zone = snapshot.activeZones?.find((candidate) => candidate.id === zoneId);
  if (!zone || zone.sourceCombatantId !== actor.id || !zone.repositionable) return "That isn't a zone it can move";
  if (!canAct(actor, "bonus") || actor.actionEconomy?.bonus === false) return `${actor.displayName} has no bonus action to move ${zone.name}`;
  if (!destination) return undefined;
  const squares = Math.hypot(destination.x - zone.origin.x, destination.y - zone.origin.y);
  if (squares > zone.repositionable.maxFeetPerCasterTurn / snapshot.map.grid.distancePerSquare + 1e-6) {
    return `${zone.name} can only move ${zone.repositionable.maxFeetPerCasterTurn} ft`;
  }
  return undefined;
}

/**
 * Why `actorId` can't use `actionId` at all right now, whatever it's aimed at: its slot is spent or denied, it can't
 * pay the cost, or (not by hand) the engine doesn't run it.
 */
export function actionProblem(snapshot: EncounterSnapshot, actorId: Id, actionId: Id, options: { byHand?: boolean } = {}): string | undefined {
  const actor = findCombatant(snapshot, actorId);
  if (actor.state !== "active") return `${actor.displayName} is ${actor.state}`;
  const action = findActionDefinition(getDefinition(snapshot, actor), actionId);
  if (!action) return `${actor.displayName} has no ${actionId}`;
  if (!options.byHand && action.kind === "unsupported") return `${action.name} isn't simulated: use it by hand`;
  const slot = action.actionType;
  if (slot !== "free" && actor.actionEconomy?.[slot] === false) return `${actor.displayName} has already used its ${SLOT_NAME[slot]}`;
  if (!canAct(actor, slot)) return slot === "free" ? `${actor.displayName} can't act right now` : `${actor.displayName} can't take a ${SLOT_NAME[slot]} right now`;
  if (!canPayFor(actor, action as { resourceCost?: { resourceId: string; amount: number } })) return costProblem(action);
  if (action.kind === "utility" && action.mode === "escape" && !(actor.conditions ?? []).some((condition) => condition.hold)) {
    return `${actor.displayName} isn't grappled`;
  }
  return undefined;
}

const ORDINALS = ["0th", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** Why an ability can't be paid for: no slot of its level left, recharging, no uses left, or not enough of a pool. */
function costProblem(action: ActionDefinition): string {
  const cost = "resourceCost" in action ? action.resourceCost : undefined;
  if (!cost) return `Not enough left to use ${action.name}`;
  const slot = spellSlotLevel(cost.resourceId);
  if (slot !== undefined) return `No ${ORDINALS[slot] ?? `${slot}th`}-level slots left`;
  if (cost.resourceId.startsWith("usage:")) {
    return "usage" in action && action.usage?.kind === "recharge" ? `${action.name} is recharging` : `${action.name} has no uses left`;
  }
  return `Not enough ${cost.resourceId.slice(cost.resourceId.lastIndexOf(":") + 1).replace(/[-_]+/g, " ")} left`;
}

/** How many creatures one use of `action` can be aimed at: its beams, or a save's target and the extras an upcast slot adds. */
export function targetCapacity(action: ActionDefinition, casterLevel: number): number {
  if (action.kind === "attack") return action.attackDelivery === "beams" ? resolveBeamCount(action, casterLevel, spellSlotLevel(action.resourceCost?.resourceId)) : 1;
  if (action.kind === "save") return action.targeting?.target === "self" ? 1 : 1 + upcastExtraTargetCapacity(action);
  if (action.kind === "healing" || action.kind === "buff") {
    const mode = action.targeting?.target ?? "single";
    return mode === "chosen" ? chosenTargetCount(action) ?? 1 : 1;
  }
  return 1;
}

function thrown(check: () => void): string | undefined {
  try {
    check();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Why `actionId` can't be aimed at `target`: range, line of effect, too many targets, a destination it can't reach. */
export function targetProblem(snapshot: EncounterSnapshot, actorId: Id, actionId: Id, target: UseTarget): string | undefined {
  const actor = findCombatant(snapshot, actorId);
  const actorDefinition = getDefinition(snapshot, actor);
  const action = findActionDefinition(actorDefinition, actionId);
  if (!action) return `${actor.displayName} has no ${actionId}`;
  const ids = target.targetIds ?? [];
  const find = (id: Id) => snapshot.combatants.find((combatant) => combatant.id === id);
  const missing = ids.find((id) => !find(id));
  if (missing) return "That target isn't in the fight";
  const targets = ids.map((id) => find(id)!);
  const tooMany = (count: number | undefined, fallback: number) =>
    targets.length > (count ?? fallback) ? `${action.name} can target up to ${count ?? fallback}` : undefined;

  const capacity = targetCapacity(action, casterLevelOf(actorDefinition));
  switch (action.kind) {
    case "attack": {
      if (targets.length === 0) return `Pick a target for ${action.name}`;
      if (targets.length > capacity) return `${action.name} can target up to ${capacity}`;
      for (const candidate of targets) {
        const problem = targetingProblem(snapshot, actor, candidate, action);
        if (problem) return problem;
      }
      return undefined;
    }
    case "multiattack":
      if (targets.length === 0) return `Pick a target for ${action.name}`;
      return previewRoutine(snapshot, actorId, targets[0]!.id, actionId).problem;
    case "save": {
      if (action.targeting?.target === "self") return undefined;
      if (targets.length === 0) return `Pick a target for ${action.name}`;
      if (targets.length > capacity) return `${action.name} can target up to ${capacity}`;
      if (new Set(ids).size < ids.length) return "Each creature can be picked only once";
      for (const candidate of targets) {
        const problem = targetingProblem(snapshot, actor, candidate, action);
        if (problem) return problem;
      }
      return undefined;
    }
    case "area-save": {
      if (action.targeting?.origin === "self" && !action.targeting.aimedFromSelf) return undefined;
      if (!target.aim) return `Pick where to aim ${action.name}`;
      const placement = resolveAreaTargeting(actor, actorDefinition, action, target.aim);
      return placement.fromSelf ? undefined : thrown(() => validateOriginTargeting(snapshot, actor, placement.origin, action));
    }
    case "healing": {
      const mode = action.targeting?.target ?? "single";
      if (mode === "self") return undefined;
      if (mode === "area") return target.aim ? undefined : `Pick where to aim ${action.name}`;
      if (targets.length === 0) return `Pick who ${action.name} heals`;
      return (mode === "chosen" ? tooMany(chosenTargetCount(action), 1) : tooMany(1, 1))
        ?? firstProblem(targets, (candidate) => validateHealingTargeting(snapshot, actor, candidate, action));
    }
    case "buff": {
      const mode = action.targeting?.target ?? "single";
      if (mode === "self") return undefined;
      if (targets.length === 0) return `Pick who gets ${action.name}`;
      return (mode === "chosen" ? tooMany(chosenTargetCount(action), 1) : tooMany(1, 1))
        ?? firstProblem(targets, (candidate) => validateBuffTargeting(snapshot, actor, candidate, action));
    }
    case "reposition": {
      if (!target.destination) return `Pick where ${action.name} takes them`;
      const moverId = action.targeting?.target === "single" ? target.moverId ?? ids[0] : actorId;
      const mover = moverId ? find(moverId) : undefined;
      if (!mover) return `Pick who ${action.name} moves`;
      return thrown(() => validateRepositionTargeting(snapshot, actor, mover, target.destination!, action));
    }
    case "summon": {
      if (target.optionId && !action.options.some((option) => option.id === target.optionId)) return "That isn't one of its options";
      return undefined;
    }
    case "transform":
    case "activate-feature":
    case "utility":
      return undefined;
    case "unsupported":
      return `${action.name} isn't simulated: use it by hand`;
  }
}

function firstProblem(targets: CombatantState[], check: (target: CombatantState) => void): string | undefined {
  for (const candidate of targets) {
    const problem = thrown(() => check(candidate));
    if (problem) return problem;
  }
  return undefined;
}

/** How far `point` is from `actorId`, in feet: for range readouts while aiming. */
export function distanceTo(snapshot: EncounterSnapshot, actorId: Id, point: Point): number {
  return spatialDistanceToPoint(snapshot, findCombatant(snapshot, actorId), point);
}

/** The ability `actionId` of `actorId`, as the engine runs it (with its compiled variants' costs). */
export function actionOf(snapshot: EncounterSnapshot, actorId: Id, actionId: Id): ActionDefinition | undefined {
  return findActionDefinition(getDefinition(snapshot, findCombatant(snapshot, actorId)), actionId);
}
