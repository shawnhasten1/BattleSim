import {
  activeFactions,
  admitReinforcements,
  canAct,
  createEngineState,
  event,
  getDefinition,
  getExecutableActions,
  moveCombatant,
  opportunityAttackThreats,
  repositionZone,
  resolveAreaSaveAction,
  resolveAreaTargeting,
  resolveAttackBonus,
  resolveBeamCount,
  rollInitiative,
  remainingMovementBudget,
  resolveAttack,
  resolveBuffAction,
  resolveDeathSave,
  resolveHealingAction,
  resolveHealingBurstAction,
  resolveActivateFeatureAction,
  resolveMultiattackAction,
  resolveNumericFormula,
  resolveRepositionAction,
  resolveSaveDc,
  resolveSaveAction,
  resolveUtilityAction,
  runTurnEnd,
  runTurnStart,
  spellSlotLevel,
  tickZones,
  type EngineState
} from "./combat";
import { cellIntersectsArea, cellsInArea, combatantsInArea, hazardPathingOverlay, zoneTerrainOverlay, type AimVector } from "./areas";
import { abilityModifier, parseDiceExpression, repeatDice, resolveScaledDamage } from "./dice";
import { coverBetween, findPath, findReachableCells, gridDistance, isFootprintLegal, lineOfEffect, pathCostField, sizeFootprint, terrainAtCell, wallCover, type ReachableCell } from "./geometry";
import type { Ability, ActionDefinition, ActionRider, ActorTag, AreaSaveActionDefinition, CombatantState, CombatLogEvent, ConditionName, CreatureDefinition, EncounterSnapshot, FeatureEffect, Point, ResourceStance, TacticsProfile } from "./types";

type HealingAction = Extract<ActionDefinition, { kind: "healing" }>;
type RepositionAction = Extract<ActionDefinition, { kind: "reposition" }>;
type BuffAction = Extract<ActionDefinition, { kind: "buff" }>;
type FeatureActivationAction = Extract<ActionDefinition, { kind: "activate-feature" }>;
type OffensiveAction =
  | Extract<ActionDefinition, { kind: "attack" }>
  | Extract<ActionDefinition, { kind: "save" }>
  | Extract<ActionDefinition, { kind: "area-save" }>
  | Extract<ActionDefinition, { kind: "multiattack" }>;

interface HealingPlan {
  action: HealingAction;
  target: CombatantState;
  score: number;
  reasons: string[];
  /** The heal can land this turn without moving (target in range, or a self-heal). */
  reachable: boolean;
}

interface RepositionPlan {
  action: RepositionAction;
  mover: CombatantState;
  destination: Point;
  score: number;
  reasons: string[];
}

/** Singular-target buff plan (self or one ally) — the shape `BonusPick`/`bonusPickTargetRange` need. */
interface BuffPlan {
  action: BuffAction;
  target: CombatantState;
  score: number;
  reasons: string[];
  /** The buff can land this turn without moving (target in range, or self). */
  reachable: boolean;
}

/** `"chosen"`-mode buff plan (Bless-style, up to N allies) — deliberately NOT fed through `BonusPick`, see `selectBuffBurstAction`. */
interface BuffBurstPlan {
  action: BuffAction;
  targets: CombatantState[];
  score: number;
  reasons: string[];
}

/** `"chosen"`/`"area"` healing plan — mirrors `HealingPlan`'s scoring but for `resolveHealingBurstAction`. Deliberately NOT fed through `BonusPick`, see `selectHealingBurstAction`. */
interface HealingBurstPlan {
  action: HealingAction;
  targets: CombatantState[];
  aim?: Point;
  score: number;
  reasons: string[];
}

interface OffensivePlan {
  action: OffensiveAction;
  target: CombatantState;
  range: number;
  score: number;
  expectedDamage: number;
  distance: number;
  reachableNow: boolean;
  canMoveIntoRange: boolean;
  reasons: string[];
}

interface MovementPlan {
  cell: Point;
  pathCost: number;
  targetDistance: number;
  score: number;
  opportunityThreats: number;
  /** Average cover (AC value 0/2/5) the actor would have from hostiles at this cell. */
  coverBonus: number;
  /**
   * Real remaining route cost from `cell` to the target (walls/terrain-aware, not
   * straight-line). Only set on a partial-approach plan — the in-range path never
   * needs it, and `targetDistance` (straight-line) stays the field to use there.
   */
  routeToTarget?: number;
}

interface FeatureActivationPlan {
  action: FeatureActivationAction;
  score: number;
  reasons: string[];
}

interface TacticsSettings {
  profile: TacticsProfile;
  preferred: "melee" | "ranged";
  preferredMinDistance: number;
  preferredMaxDistance: number;
  areaWeight: number;
  killWeight: number;
  woundedWeight: number;
  protectWeight: number;
  reactionRiskWeight: number;
  /** How hard a ranged actor works to keep cover between itself and its threats. Melee: 0. */
  coverWeight: number;
  /** How strongly this profile avoids standing in an enemy-sourced damaging `ActiveZone`. */
  hazardWeight: number;
  /** How much a `condition` rider's expected control value is worth. Controllers: high; brutes: near zero. */
  controlWeight: number;
  /** How strongly this profile chases a `high-priority`-tagged target / avoids a `low-priority` one. */
  priorityWeight: number;
  reposition: boolean;
}

/** Score contribution of each `ActorTag` before it's scaled by a profile's `priorityWeight`. */
const TAG_PRIORITY_VALUE: Partial<Record<ActorTag, number>> = {
  "high-priority": 14,
  "low-priority": -8
};

/**
 * How much a persistent-zone spell's placement score credits a hostile who
 * *isn't* standing in the blast yet but whose shortest path to its nearest
 * target of the caster's side runs through it — a one-shot burst only cares
 * who's caught right now, but a zone will still be there next turn, so
 * blocking a likely approach route has real (if speculative) value. Well
 * under 1 since it's a prediction, not a landed hit.
 */
const ZONE_PREDICTIVE_APPROACH_DISCOUNT = 0.4;

function tagPriorityValue(tags: ActorTag[] | undefined): number {
  if (!tags || tags.length === 0) {
    return 0;
  }
  return tags.reduce((sum, tag) => sum + (TAG_PRIORITY_VALUE[tag] ?? 0), 0);
}

/**
 * Scales every `resourcePenalty` term (healing/feature-activation/offensive
 * action scoring) by the actor's DM-assigned resource stance. `balanced` is
 * exactly 1 so it reproduces today's scoring unchanged.
 */
function resourceStanceMultiplier(stance: ResourceStance): number {
  switch (stance) {
    case "conservative":
      return 3;
    case "liberal":
      return 0.15;
    case "balanced":
    default:
      return 1;
  }
}

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

export function runAutomatedEncounter(snapshot: EncounterSnapshot, maxRounds = 50): SimulationRunResult {
  const state = createEngineState(snapshot);
  const warnings: string[] = [];
  rollIfNeeded(state);

  // Resume from wherever the incoming snapshot's turn order already stands
  // (e.g. the DM stepped a few turns by hand before clicking Auto Run) instead
  // of always restarting at a fresh round. Otherwise anyone who hasn't gone
  // yet this round gets skipped straight into "round + 1": already-acted
  // combatants can get a phantom extra turn, and round-scoped state (like a
  // "surprised" bearer who hasn't had their round-1 turn denied yet) desyncs
  // and can resolve early.
  let nextIndex = state.snapshot.round > 0 ? state.snapshot.turnIndex + 1 : 0;

  while (activeFactions(state.snapshot).size > 1 && state.snapshot.round < maxRounds) {
    if (nextIndex >= state.snapshot.combatants.length) {
      nextIndex = 0;
    }
    if (nextIndex === 0) {
      state.snapshot.round += 1;
      admitReinforcements(state);
      tickZones(state);
    }
    for (let index = nextIndex; index < state.snapshot.combatants.length; index += 1) {
      state.snapshot.turnIndex = index;
      const actor = state.snapshot.combatants[index];
      if (!actor) {
        continue;
      }
      if (actor.state === "downed") {
        resolveDeathSave(state, actor.id);
        if (activeFactions(state.snapshot).size <= 1) {
          break;
        }
        continue;
      }
      if (actor.state !== "active") {
        continue;
      }
      runTurnStart(state, actor);
      // A zone can down/kill an actor before its turn body runs (Insect Plague
      // on a low-HP combatant) — bail out the same way the pre-turn state check
      // above does, rather than letting `takeAutomatedTurn` act on a corpse.
      if (actor.state !== "active") {
        if (activeFactions(state.snapshot).size <= 1) {
          break;
        }
        continue;
      }
      state.log.push(event(state, "TurnStarted", `${actor.displayName} started a turn`, { combatantId: actor.id }));
      // A resolver throw from an AI mispick must not abort the whole run (and,
      // through it, an entire batch) — contain it to a lost turn + a warning.
      let warning: string | undefined;
      try {
        warning = takeAutomatedTurn(state, actor);
      } catch (error) {
        warning = `${actor.displayName}: automated turn failed — ${error instanceof Error ? error.message : String(error)}`;
        state.log.push(event(state, "AutomationWarning", warning, { combatantId: actor.id }));
      }
      if (warning) {
        warnings.push(warning);
      }
      if (activeFactions(state.snapshot).size <= 1) {
        break;
      }
      runTurnEnd(state, actor.id);
    }
    nextIndex = 0;
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

/** Resolve a chosen offensive plan through the right engine call, with beam / multiattack target spread. */
function executeOffensivePlan(state: EngineState, actor: CombatantState, plan: OffensivePlan): void {
  const action = plan.action;
  if (action.kind === "attack") {
    const targets = action.attackDelivery === "beams"
      ? beamTargets(state.snapshot, actor, action, plan.target, plan.range)
      : plan.target.id;
    resolveAttack(state, actor.id, targets, action.id);
  } else if (action.kind === "multiattack") {
    const alloc = multiattackTargetIds(state.snapshot, actor, action, plan.target, plan.range);
    resolveMultiattackAction(state, actor.id, alloc.targetIds, action.id, { attackTargetIds: alloc.attackTargetIds });
  } else if (action.kind === "save") {
    const bonusTargetIds = saveBonusTargetIds(state.snapshot, actor, action, plan.target, plan.range);
    resolveSaveAction(state, actor.id, plan.target.id, action.id, { bonusTargetIds });
  } else if (action.kind === "area-save") {
    resolveAreaSaveAction(state, actor.id, plan.target.position, action.id);
  }
}

/**
 * Allocate a multiattack's individual attacks across targets: fill the primary
 * to (estimated) death, then spill onto the next-lowest-HP hostile in reach.
 * Mirrors `beamTargets`. Returns the ordered `targetIds` (for spill-on-death) and
 * a flat per-attack list (`attackTargetIds`).
 */
function multiattackTargetIds(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  action: Extract<ActionDefinition, { kind: "multiattack" }>,
  primary: CombatantState,
  range: number
): { targetIds: string[]; attackTargetIds: string[] | undefined } {
  const definition = getDefinition(snapshot, actor);
  const executables = getExecutableActions(definition);
  const primaryDefinition = getDefinition(snapshot, primary);
  const perAttackDamage = action.attacks.flatMap((step) => {
    const child = executables.find((candidate) => candidate.id === step.actionId);
    const value = child && child.kind === "attack"
      ? Math.max(1, expectedDamageAgainst(child, definition, actor, primaryDefinition))
      : 1;
    return Array.from({ length: Math.max(0, step.count) }, () => value);
  });
  const others = snapshot.combatants
    .filter((c) => c.faction !== actor.faction && c.state === "active" && c.id !== primary.id
      && isValidTarget(snapshot, actor, c, range))
    .sort((a, b) => a.currentHp - b.currentHp || a.id.localeCompare(b.id));
  const targetIds = [primary.id, ...others.map((c) => c.id)];
  if (others.length === 0) {
    return { targetIds, attackTargetIds: undefined };
  }
  const pool = [primary, ...others];
  const assigned: Record<string, number> = {};
  const attackTargetIds: string[] = [];
  let cursor = 0;
  for (const damage of perAttackDamage) {
    while (cursor < pool.length - 1 && (assigned[pool[cursor]!.id] ?? 0) >= pool[cursor]!.currentHp) {
      cursor += 1;
    }
    const pick = pool[cursor]!;
    attackTargetIds.push(pick.id);
    assigned[pick.id] = (assigned[pick.id] ?? 0) + damage;
  }
  return { targetIds, attackTargetIds };
}

/** Id of a synthesised / feature-granted `utility` action for `mode` at the given slot, if the actor has one. */
function utilityActionId(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  mode: "dash" | "disengage" | "dodge",
  slot: "action" | "bonus"
): string | undefined {
  return getExecutableActions(getDefinition(snapshot, actor))
    .find((candidate) => candidate.kind === "utility" && candidate.mode === mode && candidate.actionType === slot)?.id;
}

/** A dashed move that would bring `target` into `range` this turn, or `undefined`. Never mutates `actor`. */
function dashDestinationTowardTarget(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings,
  options: { allowPartialApproach?: boolean } = {}
): MovementPlan | undefined {
  const saved = actor.turnFlags;
  actor.turnFlags = { ...(saved ?? {}), dashed: true };
  try {
    const plan = bestDestinationTowardTarget(snapshot, actor, target, range, tactics, options);
    if (!plan) return undefined;
    if (options.allowPartialApproach) return plan;
    return plan.targetDistance <= range ? plan : undefined;
  } finally {
    actor.turnFlags = saved;
  }
}

/** Spend the Dodge action when the actor is threatened and has nothing better to do. */
function resolveDodgeIfThreatened(state: EngineState, actor: CombatantState): boolean {
  if (actor.state !== "active" || !canAct(actor, "action") || !isThreatenedAt(state.snapshot, actor, actor.position)) {
    return false;
  }
  const dodgeId = utilityActionId(state.snapshot, actor, "dodge", "action");
  if (!dodgeId) {
    return false;
  }
  state.log.push(event(state, "AiDecision", `${actor.displayName} takes the Dodge action`, { combatantId: actor.id }));
  try {
    resolveUtilityAction(state, actor.id, dodgeId);
    return true;
  } catch {
    return false;
  }
}

type BonusPick =
  | { kind: "heal"; plan: HealingPlan }
  | { kind: "buff"; plan: BuffPlan }
  | { kind: "offense"; plan: OffensivePlan };

/** Target/range a `BonusPick` needs in reach, regardless of whether it's a heal, a buff, or an attack. */
function bonusPickTargetRange(pick: BonusPick): { target: CombatantState; range: number } {
  return pick.kind === "offense"
    ? { target: pick.plan.target, range: pick.plan.range }
    : { target: pick.plan.target, range: pick.plan.action.range };
}

/**
 * Best bonus-action candidate: a bonus-action heal, buff (Shield of Faith —
 * only the singular-target buff shape flows through here, see
 * `selectBuffAction`), or the best bonus-action offensive plan (Spiritual
 * Weapon, an off-hand bite, Healing Word) — tie-break order heal > buff >
 * offense (staying alive still trumps a buff; a buff still edges out a
 * marginal attack on ties). `relaxReachability` widens the offense side to
 * targets only reachable via movement — used by `selectJointTurnPlan`, which
 * plans that movement itself; the default (used by `maybeSpendBonusAction`)
 * only weighs what's reachable from where the actor already stands.
 */
function selectBonusCandidate(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  tactics: TacticsSettings,
  options: { relaxReachability?: boolean } = {}
): BonusPick | undefined {
  const heal = selectHealingAction(snapshot, actor, "bonus");
  const buff = selectBuffAction(snapshot, actor, "bonus");
  const offense = selectOffensivePlan(snapshot, actor, tactics, "bonus", options);
  if (heal && (!buff || heal.score >= buff.score) && (!offense || heal.score >= offense.score)) {
    return { kind: "heal", plan: heal };
  }
  if (buff && (!offense || buff.score >= offense.score)) {
    return { kind: "buff", plan: buff };
  }
  return offense ? { kind: "offense", plan: offense } : undefined;
}

/** Log and resolve a `BonusPick`. Returns false (and does nothing) if its target stopped being valid. */
function resolveBonusPick(state: EngineState, actor: CombatantState, pick: BonusPick): boolean {
  if (pick.kind === "heal") {
    const heal = pick.plan;
    state.log.push(event(state, "AiDecision", `${actor.displayName} used a bonus action to heal`, {
      combatantId: actor.id, actionId: heal.action.id, targetId: heal.target.id, slot: "bonus"
    }));
    try {
      resolveHealingAction(state, actor.id, heal.target.id, heal.action.id);
    } catch { /* map state moved on */ }
    return true;
  }
  if (pick.kind === "buff") {
    const buff = pick.plan;
    state.log.push(event(state, "AiDecision", `${actor.displayName} used a bonus action (${buff.action.name})`, {
      combatantId: actor.id, actionId: buff.action.id, targetId: buff.target.id, slot: "bonus"
    }));
    try {
      resolveBuffAction(state, actor.id, buff.action.id, [buff.target.id]);
    } catch { /* map state moved on */ }
    return true;
  }
  const offense = pick.plan;
  if (offense.target.state !== "active") {
    return false;
  }
  state.log.push(event(state, "AiDecision", `${actor.displayName} used a bonus action (${offense.action.name})`, {
    combatantId: actor.id, actionId: offense.action.id, targetId: offense.target.id, slot: "bonus"
  }));
  try {
    executeOffensivePlan(state, actor, offense);
  } catch { /* map state moved on */ }
  return true;
}

/** After the main action, spend a still-open bonus action. Only targets already in reach count. */
function maybeSpendBonusAction(state: EngineState, actor: CombatantState, tactics: TacticsSettings): void {
  if (actor.state !== "active" || !canAct(actor, "bonus")) {
    return;
  }
  const pick = selectBonusCandidate(state.snapshot, actor, tactics);
  if (pick) {
    // A heal/buff target can be `canMoveIntoRange` without being `reachable`
    // yet — close the gap first, mirroring the main-action heal short-circuit
    // above.
    if ((pick.kind === "heal" || pick.kind === "buff") && !pick.plan.reachable) {
      const move = bestDestinationTowardTarget(state.snapshot, actor, pick.plan.target, pick.plan.action.range, tactics);
      if (move) {
        try {
          moveCombatant(state, actor.id, move.cell);
        } catch { /* map state moved on */ }
      }
    }
    if (resolveBonusPick(state, actor, pick)) {
      return;
    }
  }
  const reposition = selectRepositionAction(state.snapshot, actor, "bonus");
  if (reposition) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} blinks away with ${reposition.action.name}`, {
      combatantId: actor.id, actionId: reposition.action.id, targetId: reposition.mover.id, destination: reposition.destination, slot: "bonus"
    }));
    try {
      resolveRepositionAction(state, actor.id, reposition.mover.id, reposition.destination, reposition.action.id);
    } catch { /* map state moved on */ }
    return;
  }
  maybeRepositionZone(state, actor);
}

/**
 * Moonbeam-style caster-directed reposition: only reached once a real bonus-
 * action spell/heal has already had its shot (a genuine bonus action always
 * beats "free extra value" from nudging a zone). If the actor has a zone of
 * their own that's `repositionable` and some hostile isn't caught by it yet,
 * spend the leftover bonus action moving it toward the nearest such hostile,
 * capped at `maxFeetPerCasterTurn`.
 */
function maybeRepositionZone(state: EngineState, actor: CombatantState): void {
  const zone = state.snapshot.activeZones?.find((candidate) =>
    candidate.sourceCombatantId === actor.id && candidate.repositionable);
  if (!zone || !canAct(actor, "bonus")) {
    return;
  }
  const snapshot = state.snapshot;
  const definitionsById = new Map(snapshot.definitions.map((definition) => [definition.id, definition]));
  const caughtIds = new Set(combatantsInArea(snapshot.map, zone.origin, zone.area, snapshot.combatants, definitionsById).map((combatant) => combatant.id));
  const uncaught = snapshot.combatants.filter((combatant) =>
    combatant.faction !== actor.faction && combatant.state === "active" && !caughtIds.has(combatant.id));
  if (!uncaught.length) {
    return;
  }
  const nearest = uncaught.reduce<{ combatant: CombatantState; distance: number } | null>((closest, candidate) => {
    const distance = gridDistance(zone.origin, candidate.position, snapshot.map.grid);
    return !closest || distance < closest.distance ? { combatant: candidate, distance } : closest;
  }, null)?.combatant;
  if (!nearest) {
    return;
  }

  const distancePerSquare = snapshot.map.grid.distancePerSquare;
  const maxSquares = zone.repositionable!.maxFeetPerCasterTurn / distancePerSquare;
  const dx = nearest.position.x - zone.origin.x;
  const dy = nearest.position.y - zone.origin.y;
  const distSquares = Math.hypot(dx, dy);
  if (distSquares < 0.01) {
    return;
  }
  const step = Math.min(distSquares, maxSquares);
  const destination = { x: zone.origin.x + (dx / distSquares) * step, y: zone.origin.y + (dy / distSquares) * step };

  try {
    repositionZone(state, actor.id, zone.id, destination);
    state.log.push(event(state, "AiDecision", `${actor.displayName} moves ${zone.name} toward ${nearest.displayName}`, {
      combatantId: actor.id, zoneId: zone.id, targetId: nearest.id, slot: "bonus"
    }));
  } catch { /* not actually repositionable right now */ }
}

interface JointTurnPlan {
  order: "main-first" | "bonus-first";
  mainPlan: OffensivePlan;
  bonusPick: BonusPick;
  /** Movement to reach the first slot's target, if it isn't already in range. */
  leg1: MovementPlan | undefined;
  /** Movement to reach the second slot's target from leg 1's landing spot, if needed. */
  leg2: MovementPlan | undefined;
}

/** Movement (if any) to bring `target` into `range`, or `undefined` if nothing in the remaining budget reaches it. */
function planLegTowardTarget(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings
): { move: MovementPlan | undefined; feasible: boolean } {
  if (isValidTarget(snapshot, actor, target, range)) {
    return { move: undefined, feasible: true };
  }
  const move = bestDestinationTowardTarget(snapshot, actor, target, range, tactics);
  return { move, feasible: move != null };
}

/**
 * Whether `first`'s target then `second`'s target can both be reached this turn,
 * in that order, out of one shared movement budget. Scores leg 2 from leg 1's
 * landing cell by temporarily relocating `actor` there (same save/mutate/restore
 * idiom `dashDestinationTowardTarget` uses to score a hypothetical Dash) — never
 * leaves `actor` mutated on return.
 */
function twoLegOrder(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  first: { target: CombatantState; range: number },
  second: { target: CombatantState; range: number },
  tactics: TacticsSettings
): { leg1: MovementPlan | undefined; leg2: MovementPlan | undefined } | undefined {
  const leg1Result = planLegTowardTarget(snapshot, actor, first.target, first.range, tactics);
  if (!leg1Result.feasible) {
    return undefined;
  }
  if (!leg1Result.move) {
    const leg2Result = planLegTowardTarget(snapshot, actor, second.target, second.range, tactics);
    return leg2Result.feasible ? { leg1: undefined, leg2: leg2Result.move } : undefined;
  }

  const savedPosition = actor.position;
  const savedFlags = actor.turnFlags;
  actor.position = leg1Result.move.cell;
  actor.turnFlags = { ...(savedFlags ?? {}), movementUsed: (savedFlags?.movementUsed ?? 0) + leg1Result.move.pathCost };
  try {
    const leg2Result = planLegTowardTarget(snapshot, actor, second.target, second.range, tactics);
    return leg2Result.feasible ? { leg1: leg1Result.move, leg2: leg2Result.move } : undefined;
  } finally {
    actor.position = savedPosition;
    actor.turnFlags = savedFlags;
  }
}

/**
 * Weighs the already-chosen main-action plan against the best bonus-action
 * candidate and, if both targets fit in one shared movement budget in either
 * visiting order, returns the plan to execute both this turn. Ties (both orders
 * feasible — the combined score is the same either way, since neither action's
 * value depends on which happens first) favor main-first to minimize churn from
 * today's default ordering. Returns `undefined` when no joint plan is feasible —
 * callers fall back to the legacy single-slot flow.
 */
function selectJointTurnPlan(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  mainPlan: OffensivePlan,
  tactics: TacticsSettings
): JointTurnPlan | undefined {
  if (!canAct(actor, "bonus")) {
    return undefined;
  }
  const bonusPick = selectBonusCandidate(snapshot, actor, tactics, { relaxReachability: true });
  if (!bonusPick) {
    return undefined;
  }
  const mainTarget = { target: mainPlan.target, range: mainPlan.range };
  const bonusTarget = bonusPickTargetRange(bonusPick);
  if (mainTarget.target.id === bonusTarget.target.id) {
    // Same target for both slots — one leg (or none) already covers both; no
    // ordering ambiguity for the legacy flow to get wrong.
    return undefined;
  }

  const mainFirst = twoLegOrder(snapshot, actor, mainTarget, bonusTarget, tactics);
  if (mainFirst) {
    return { order: "main-first", mainPlan, bonusPick, leg1: mainFirst.leg1, leg2: mainFirst.leg2 };
  }
  const bonusFirst = twoLegOrder(snapshot, actor, bonusTarget, mainTarget, tactics);
  if (bonusFirst) {
    return { order: "bonus-first", mainPlan, bonusPick, leg1: bonusFirst.leg1, leg2: bonusFirst.leg2 };
  }
  return undefined;
}

/** Log and resolve `plan` as the main action — the exact steps `takeAutomatedTurn`'s own tail uses. */
function resolveMainOffensivePlan(state: EngineState, actor: CombatantState, plan: OffensivePlan): void {
  state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${plan.action.name}`, {
    combatantId: actor.id,
    actionId: plan.action.id,
    targetId: plan.target.id,
    score: plan.score,
    expectedDamage: plan.expectedDamage,
    distance: plan.distance,
    reachableNow: plan.reachableNow,
    canMoveIntoRange: plan.canMoveIntoRange,
    reasons: plan.reasons
  }));
  executeOffensivePlan(state, actor, plan);
}

/**
 * Executes a `JointTurnPlan`: move → resolve slot 1 → move → resolve slot 2, in
 * the planned order. Each leg is re-planned against the live board right before
 * it's spent (not reused from planning time) — the first action landing (e.g. a
 * multiattack spilling onto and killing the second target) can change what the
 * second leg actually needs.
 */
function executeJointTurnPlan(state: EngineState, actor: CombatantState, joint: JointTurnPlan, tactics: TacticsSettings): void {
  const bonusTarget = bonusPickTargetRange(joint.bonusPick);
  const steps: Array<{ slot: "action" | "bonus"; target: CombatantState; range: number }> = joint.order === "main-first"
    ? [
        { slot: "action", target: joint.mainPlan.target, range: joint.mainPlan.range },
        { slot: "bonus", target: bonusTarget.target, range: bonusTarget.range }
      ]
    : [
        { slot: "bonus", target: bonusTarget.target, range: bonusTarget.range },
        { slot: "action", target: joint.mainPlan.target, range: joint.mainPlan.range }
      ];

  for (const step of steps) {
    if (actor.state !== "active") {
      return;
    }
    if (!isValidTarget(state.snapshot, actor, step.target, step.range)) {
      const move = bestDestinationTowardTarget(state.snapshot, actor, step.target, step.range, tactics);
      if (move) {
        try {
          moveCombatant(state, actor.id, move.cell);
        } catch { /* map state moved on */ }
      }
    }
    if (actor.state !== "active") {
      return;
    }
    if (step.slot === "action") {
      if (isValidTarget(state.snapshot, actor, joint.mainPlan.target, joint.mainPlan.range) && joint.mainPlan.target.state === "active") {
        resolveMainOffensivePlan(state, actor, joint.mainPlan);
      }
    } else {
      resolveBonusPick(state, actor, joint.bonusPick);
    }
  }
}

export function takeAutomatedTurn(state: EngineState, actor: CombatantState): string | undefined {
  const tactics = tacticsSettings(actor.tacticsProfile);

  // Incapacitated / stunned / paralysed (or a `deniesActions` effect): no action
  // and no bonus action — the creature loses its turn rather than acting at a
  // penalty.
  if (!canAct(actor, "action") && !canAct(actor, "bonus")) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} loses its turn`, {
      combatantId: actor.id,
      reason: "cannot-act"
    }));
    return undefined;
  }

  let movedThisTurn = false;
  const healing = selectHealingAction(state.snapshot, actor);
  const healingBurst = selectHealingBurstAction(state.snapshot, actor);
  if (healing && (!healingBurst || healing.score >= healingBurst.score)) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose healing`, {
      combatantId: actor.id,
      actionId: healing.action.id,
      targetId: healing.target.id,
      score: healing.score,
      reasons: healing.reasons
    }));
    if (!healing.reachable) {
      const move = bestDestinationTowardTarget(state.snapshot, actor, healing.target, healing.action.range, tactics);
      if (move) {
        try {
          moveCombatant(state, actor.id, move.cell);
          movedThisTurn = true;
        } catch { /* map state moved on */ }
      }
    }
    try {
      resolveHealingAction(state, actor.id, healing.target.id, healing.action.id);
    } catch (error) {
      state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s heal could not resolve`, {
        combatantId: actor.id,
        actionId: healing.action.id,
        targetId: healing.target.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
    maybeSpendBonusAction(state, actor, tactics);
    return undefined;
  }
  if (healingBurst) {
    const targetIds = healingBurst.targets.map((target) => target.id);
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${healingBurst.action.name}`, {
      combatantId: actor.id,
      actionId: healingBurst.action.id,
      targetIds,
      score: healingBurst.score,
      reasons: healingBurst.reasons
    }));
    try {
      resolveHealingBurstAction(state, actor.id, healingBurst.action.id, targetIds, healingBurst.aim);
    } catch (error) {
      state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s ${healingBurst.action.name} could not resolve`, {
        combatantId: actor.id,
        actionId: healingBurst.action.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
    maybeSpendBonusAction(state, actor, tactics);
    return undefined;
  }

  let plan = selectOffensivePlan(state.snapshot, actor, tactics);

  // A buff (Bless, action-cost) competes on score against the chosen offensive
  // plan rather than hard-preempting it the way healing does — there's no
  // equivalent urgency to a buff, so it should lose to a genuinely good attack.
  // When there's no offensive plan at all (nothing in range, or a pure support
  // caster with no attack), any positive-scoring buff is free value — take it
  // rather than falling through to "no fully automated action."
  const buff = selectBuffAction(state.snapshot, actor, "action") ?? selectBuffBurstAction(state.snapshot, actor);
  if (buff && (!plan || buff.score > plan.score)) {
    const isBurst = "targets" in buff;
    if (!isBurst && !buff.reachable) {
      const move = bestDestinationTowardTarget(state.snapshot, actor, buff.target, buff.action.range, tactics);
      if (move) {
        try {
          moveCombatant(state, actor.id, move.cell);
        } catch { /* map state moved on */ }
      }
    }
    const targetIds = isBurst ? buff.targets.map((target) => target.id) : [buff.target.id];
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${buff.action.name}`, {
      combatantId: actor.id,
      actionId: buff.action.id,
      targetIds,
      score: buff.score,
      reasons: buff.reasons
    }));
    try {
      resolveBuffAction(state, actor.id, buff.action.id, targetIds);
    } catch (error) {
      state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s ${buff.action.name} could not resolve`, {
        combatantId: actor.id,
        actionId: buff.action.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
    maybeSpendBonusAction(state, actor, tactics);
    return undefined;
  }

  if (!plan) {
    resolveDodgeIfThreatened(state, actor);
    maybeSpendBonusAction(state, actor, tactics);
    // No target because the only opposition left is a reinforcement that hasn't
    // arrived — hold position quietly rather than raising an automation warning.
    const awaitingReinforcements = state.snapshot.combatants.some(
      (other) => other.faction !== actor.faction && other.state === "reserve"
    );
    const noVisibleEnemies = !state.snapshot.combatants.some(
      (other) => other.faction !== actor.faction && other.state === "active"
    );
    if (awaitingReinforcements && noVisibleEnemies) {
      state.log.push(event(state, "AiDecision", `${actor.displayName} holds position — no enemies in sight`, {
        combatantId: actor.id,
        reason: "awaiting-reinforcements"
      }));
      return undefined;
    }
    const warning = `${actor.displayName} has no fully automated action`;
    state.log.push(event(state, "AutomationWarning", warning, { combatantId: actor.id }));
    return warning;
  }

  const activation = selectFeatureActivationAction(state.snapshot, actor);
  if (activation) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${activation.action.name}`, {
      combatantId: actor.id,
      actionId: activation.action.id,
      score: activation.score,
      reasons: activation.reasons
    }));
    resolveActivateFeatureAction(state, actor.id, activation.action.id);
    plan = selectOffensivePlan(state.snapshot, actor, tactics) ?? plan;
  }

  // Before committing to "move fully toward the main action, then see what's left
  // for the bonus action," check whether the main and bonus actions are better
  // planned together — same shared movement budget, but weighing which is worth
  // moving for and in which order. Only attempted when the main target is
  // reachable by an ordinary move (already in range, or `canMoveIntoRange`) — a
  // target that needs Dash or a bonus-action gap-closer just to be reached at all
  // leaves no budget to jointly plan around, so that harder-to-reach branch below
  // is left untouched.
  if (actor.state === "active" && (isValidTarget(state.snapshot, actor, plan.target, plan.range) || plan.canMoveIntoRange)) {
    const joint = selectJointTurnPlan(state.snapshot, actor, plan, tactics);
    if (joint) {
      executeJointTurnPlan(state, actor, joint, tactics);
      if (actor.state === "active") {
        maybeSpendBonusAction(state, actor, tactics);
      }
      return undefined;
    }
  }

  if (!isValidTarget(state.snapshot, actor, plan.target, plan.range)) {
    // No options ⇒ only cells already within attack range come back.
    const movement = bestDestinationTowardTarget(state.snapshot, actor, plan.target, plan.range, tactics);
    const normalReaches = movement != null;
    // A melee actor with a bonus-action self-teleport available gets first
    // refusal on closing a gap a plain move can't — it lands a guaranteed
    // attack with the action instead of spending the whole turn on Dash with
    // nothing to show for it. Tried before Dash; a free move that already
    // reaches is still preferred (no reason to burn the spell for that).
    const gapCloser = !normalReaches
      ? selectMeleeGapCloserReposition(state.snapshot, actor, plan.target, plan.range, tactics)
      : undefined;
    // A single move can't close the gap; if a doubled (Dash) move would, spend
    // the action on Dash instead of half-closing and standing idle.
    const dashMove = !normalReaches && !gapCloser && canAct(actor, "action")
      ? dashDestinationTowardTarget(state.snapshot, actor, plan.target, plan.range, tactics)
      : undefined;

    if (gapCloser) {
      try {
        resolveRepositionAction(state, actor.id, actor.id, gapCloser.destination, gapCloser.action.id);
        movedThisTurn = true;
        state.log.push(event(state, "AiDecision", `${actor.displayName} blinks into range with ${gapCloser.action.name}`, {
          combatantId: actor.id, actionId: gapCloser.action.id, targetId: plan.target.id, destination: gapCloser.destination, slot: "bonus"
        }));
      } catch { /* map state moved on */ }
    } else if (dashMove) {
      const dashId = utilityActionId(state.snapshot, actor, "dash", "action");
      if (dashId) {
        try {
          resolveUtilityAction(state, actor.id, dashId);
          moveCombatant(state, actor.id, dashMove.cell);
          state.log.push(event(state, "AiDecision", `${actor.displayName} dashed toward ${plan.target.displayName}`, {
            combatantId: actor.id, targetId: plan.target.id, destination: dashMove.cell, remainingDistance: dashMove.targetDistance
          }));
        } catch { /* map state moved on */ }
      }
      maybeSpendBonusAction(state, actor, tactics);
      return undefined;
    }

    if (movement) {
      try {
        const previousDistance = gridDistance(actor.position, plan.target.position, state.snapshot.map.grid);
        moveCombatant(state, actor.id, movement.cell);
        movedThisTurn = true;
        const coverNote = movement.coverBonus >= 2 ? ` into ${coverPhrase(movement.coverBonus)}` : "";
        state.log.push(event(state, "AiDecision", `${actor.displayName} moved ${Math.round(movement.pathCost * state.snapshot.map.grid.distancePerSquare)} ft toward ${plan.target.displayName}${coverNote}`, {
          combatantId: actor.id,
          targetId: plan.target.id,
          destination: movement.cell,
          pathCost: movement.pathCost,
          previousDistance,
          remainingDistance: movement.targetDistance,
          opportunityThreats: movement.opportunityThreats,
          coverAtDestination: movement.coverBonus,
          movementScore: movement.score
        }));
      } catch {
        // Candidate generation should avoid illegal moves; if map state changed, skip movement.
      }
    } else if (!gapCloser) {
      // Can't get within range this turn, even with a Dash. Close the distance
      // instead of standing still: Dash toward the target if that covers more
      // ground (the action would go unused anyway), otherwise just move — and
      // Dodge if the advance walked into a threatened square.
      const feet = (pathCost: number) => Math.round(pathCost * state.snapshot.map.grid.distancePerSquare);
      const previousDistance = gridDistance(actor.position, plan.target.position, state.snapshot.map.grid);
      const walkApproach = bestDestinationTowardTarget(
        state.snapshot, actor, plan.target, plan.range, tactics, { allowPartialApproach: true }
      );
      const dashId = canAct(actor, "action")
        ? utilityActionId(state.snapshot, actor, "dash", "action")
        : undefined;
      const dashApproach = dashId
        ? dashDestinationTowardTarget(state.snapshot, actor, plan.target, plan.range, tactics, { allowPartialApproach: true })
        : undefined;

      // Compare by real remaining route, not straight-line distance — a Dash is
      // only worth it if it actually advances the walk-around further.
      const walkRoute = walkApproach?.routeToTarget ?? Number.POSITIVE_INFINITY;
      const dashRoute = dashApproach?.routeToTarget ?? Number.POSITIVE_INFINITY;

      if (dashApproach && dashId && dashRoute < walkRoute - 1e-9) {
        try {
          resolveUtilityAction(state, actor.id, dashId);
          moveCombatant(state, actor.id, dashApproach.cell);
          movedThisTurn = true;
          state.log.push(event(state, "AiDecision", `${actor.displayName} dashed ${feet(dashApproach.pathCost)} ft toward ${plan.target.displayName} (still out of range)`, {
            combatantId: actor.id,
            targetId: plan.target.id,
            destination: dashApproach.cell,
            pathCost: dashApproach.pathCost,
            previousDistance,
            remainingDistance: dashApproach.targetDistance,
            remainingRoute: dashApproach.routeToTarget,
            opportunityThreats: dashApproach.opportunityThreats
          }));
        } catch { /* map state moved on */ }
        maybeSpendBonusAction(state, actor, tactics);
        return undefined;
      }

      if (walkApproach) {
        try {
          moveCombatant(state, actor.id, walkApproach.cell);
          movedThisTurn = true;
          state.log.push(event(state, "AiDecision", `${actor.displayName} moved ${feet(walkApproach.pathCost)} ft toward ${plan.target.displayName} (still out of range)`, {
            combatantId: actor.id,
            targetId: plan.target.id,
            destination: walkApproach.cell,
            pathCost: walkApproach.pathCost,
            previousDistance,
            remainingDistance: walkApproach.targetDistance,
            remainingRoute: walkApproach.routeToTarget,
            opportunityThreats: walkApproach.opportunityThreats
          }));
          resolveDodgeIfThreatened(state, actor);
        } catch { /* map state moved on */ }
        maybeSpendBonusAction(state, actor, tactics);
        return undefined;
      }

      state.log.push(event(state, "AutomationWarning", `${actor.displayName} found no legal movement toward ${plan.target.displayName}`, {
        combatantId: actor.id,
        targetId: plan.target.id,
        actionId: plan.action.id,
        range: plan.range
      }));
    }
    // A reaction provoked by that move (an opportunity attack) may have downed or
    // killed the actor outright — there's no action left to spend.
    if (actor.state !== "active") {
      return undefined;
    }
    // After spending the move, re-pick among actions that can actually land from
    // here — don't swap to a plan that needs yet more movement (and then stall).
    plan = (movedThisTurn ? selectOffensivePlan(state.snapshot, actor, tactics, "action", { mustReachNow: true }) : undefined)
      ?? selectOffensivePlan(state.snapshot, actor, tactics)
      ?? plan;
  }

  if (!isValidTarget(state.snapshot, actor, plan.target, plan.range)) {
    resolveDodgeIfThreatened(state, actor);
    maybeSpendBonusAction(state, actor, tactics);
    const warning = `${actor.displayName} could not reach a valid target with ${plan.action.name}`;
    state.log.push(event(state, "AutomationWarning", warning, {
      combatantId: actor.id,
      actionId: plan.action.id,
      targetId: plan.target.id
    }));
    return warning;
  }

  if (plan.target.state !== "active") {
    maybeSpendBonusAction(state, actor, tactics);
    return undefined;
  }

  // Ranged: if the in-range target is behind cover, step out to a cell that
  // denies it that cover before firing (uses the move, keeps the action).
  if (!movedThisTurn && actor.state === "active" && planIsRangedThroughCover(plan.action)) {
    const shotPos = bestShotPositionAgainst(state.snapshot, actor, plan.target, plan.range, tactics);
    if (shotPos) {
      try {
        moveCombatant(state, actor.id, shotPos.cell);
        movedThisTurn = true;
        state.log.push(event(state, "AiDecision", `${actor.displayName} repositioned for a clear shot at ${plan.target.displayName}`, {
          combatantId: actor.id,
          targetId: plan.target.id,
          destination: shotPos.cell,
          pathCost: shotPos.pathCost,
          opportunityThreats: shotPos.opportunityThreats,
          movementScore: shotPos.score
        }));
      } catch { /* map state moved on */ }
    }
  }

  if (!isValidTarget(state.snapshot, actor, plan.target, plan.range) || plan.target.state !== "active") {
    maybeSpendBonusAction(state, actor, tactics);
    return undefined;
  }

  state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${plan.action.name}`, {
    combatantId: actor.id,
    actionId: plan.action.id,
    targetId: plan.target.id,
    score: plan.score,
    expectedDamage: plan.expectedDamage,
    distance: plan.distance,
    reachableNow: plan.reachableNow,
    canMoveIntoRange: plan.canMoveIntoRange,
    reasons: plan.reasons
  }));

  executeOffensivePlan(state, actor, plan);

  if (!movedThisTurn && actor.state === "active" && tactics.reposition) {
    let reposition = bestRepositionAfterAction(state.snapshot, actor, plan.target, plan.range, tactics);
    // If the only worthwhile reposition would provoke, spend a granted bonus
    // Disengage (Cunning Action) and recompute — the path is now free.
    if (reposition && reposition.opportunityThreats > 0 && canAct(actor, "bonus")) {
      const disengageId = utilityActionId(state.snapshot, actor, "disengage", "bonus");
      if (disengageId) {
        try {
          resolveUtilityAction(state, actor.id, disengageId);
          state.log.push(event(state, "AiDecision", `${actor.displayName} disengaged (bonus action)`, { combatantId: actor.id }));
          reposition = bestRepositionAfterAction(state.snapshot, actor, plan.target, plan.range, tactics);
        } catch { /* map state moved on */ }
      }
    }
    if (reposition) {
      try {
        moveCombatant(state, actor.id, reposition.cell);
        const coverNote = reposition.coverBonus >= 2 ? ` to ${coverPhrase(reposition.coverBonus)}` : "";
        state.log.push(event(state, "AiDecision", `${actor.displayName} repositioned${coverNote}`, {
          combatantId: actor.id,
          targetId: plan.target.id,
          destination: reposition.cell,
          pathCost: reposition.pathCost,
          remainingDistance: reposition.targetDistance,
          opportunityThreats: reposition.opportunityThreats,
          coverAtDestination: reposition.coverBonus,
          movementScore: reposition.score
        }));
      } catch {
        // Candidate generation should avoid illegal moves; if map state changed, skip repositioning.
      }
    }
  }

  maybeSpendBonusAction(state, actor, tactics);
  return undefined;
}

function rollIfNeeded(state: EngineState): void {
  if (state.snapshot.combatants.every((combatant) => typeof combatant.initiative === "number")) {
    state.snapshot.combatants.sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.id.localeCompare(b.id));
    return;
  }
  rollInitiative(state);
}

function selectNearestHostile(snapshot: EncounterSnapshot, actor: CombatantState): CombatantState | undefined {
  return snapshot.combatants
    .filter((combatant) => combatant.faction !== actor.faction && combatant.state === "active")
    .sort((a, b) => gridDistance(actor.position, a.position, snapshot.map.grid) - gridDistance(actor.position, b.position, snapshot.map.grid)
      || a.currentHp - b.currentHp
      || a.id.localeCompare(b.id))[0];
}

function selectWoundedAlly(snapshot: EncounterSnapshot, actor: CombatantState): CombatantState | undefined {
  return snapshot.combatants
    .filter((combatant) => combatant.faction === actor.faction && (combatant.state === "active" || combatant.state === "downed"))
    .filter((combatant) => {
      const definition = getDefinition(snapshot, combatant);
      return combatant.currentHp < definition.maxHp;
    })
    .sort((a, b) => a.currentHp - b.currentHp || a.id.localeCompare(b.id))[0];
}

function tacticsSettings(profile: TacticsProfile): TacticsSettings {
  switch (profile) {
    case "basic-ranged":
      return {
        profile,
        preferred: "ranged",
        preferredMinDistance: 25,
        preferredMaxDistance: 80,
        areaWeight: 1,
        killWeight: 18,
        woundedWeight: 7,
        protectWeight: 0,
        reactionRiskWeight: 2,
        coverWeight: 3,
        hazardWeight: 2.5,
        controlWeight: 6,
        priorityWeight: 1,
        reposition: true
      };
    case "skirmisher":
      return {
        profile,
        preferred: "ranged",
        preferredMinDistance: 20,
        preferredMaxDistance: 60,
        areaWeight: 1,
        killWeight: 20,
        woundedWeight: 10,
        protectWeight: 0,
        reactionRiskWeight: 4,
        coverWeight: 4,
        hazardWeight: 3,
        controlWeight: 6,
        priorityWeight: 1,
        reposition: true
      };
    case "brute":
      return {
        profile,
        preferred: "melee",
        preferredMinDistance: 0,
        preferredMaxDistance: 5,
        areaWeight: 0.5,
        killWeight: 28,
        woundedWeight: 16,
        protectWeight: 0,
        reactionRiskWeight: 1,
        coverWeight: 0,
        hazardWeight: 1,
        controlWeight: 2,
        priorityWeight: 2.5,
        reposition: false
      };
    case "defender":
      return {
        profile,
        preferred: "melee",
        preferredMinDistance: 0,
        preferredMaxDistance: 5,
        areaWeight: 0.6,
        killWeight: 18,
        woundedWeight: 8,
        protectWeight: 22,
        reactionRiskWeight: 3,
        coverWeight: 0,
        hazardWeight: 1.5,
        controlWeight: 14,
        priorityWeight: 0.6,
        reposition: false
      };
    case "controller":
      return {
        profile,
        preferred: "ranged",
        preferredMinDistance: 30,
        preferredMaxDistance: 90,
        areaWeight: 2.3,
        killWeight: 16,
        woundedWeight: 6,
        protectWeight: 8,
        reactionRiskWeight: 3,
        coverWeight: 2.5,
        hazardWeight: 2,
        controlWeight: 26,
        priorityWeight: 0.8,
        reposition: true
      };
    case "basic-melee":
    default:
      return {
        profile: "basic-melee",
        preferred: "melee",
        preferredMinDistance: 0,
        preferredMaxDistance: 5,
        areaWeight: 0.7,
        killWeight: 18,
        woundedWeight: 8,
        protectWeight: 0,
        reactionRiskWeight: 2,
        coverWeight: 0,
        hazardWeight: 1.5,
        controlWeight: 4,
        priorityWeight: 1.2,
        reposition: false
      };
  }
}

function selectHealingAction(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  slot: "action" | "bonus" = "action"
): HealingPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const woundedAllies = snapshot.combatants
    .filter((combatant) => combatant.faction === actor.faction && (combatant.state === "active" || combatant.state === "downed"))
    .filter((combatant) => {
      const allyDefinition = getDefinition(snapshot, combatant);
      return combatant.currentHp < allyDefinition.maxHp;
    });
  const healingActions = getExecutableActions(definition)
    .filter((action): action is HealingAction => action.kind === "healing"
      && action.actionType === slot
      && action.automationSupport === "full"
      && canPayResource(actor, action));
  const tactics = tacticsSettings(actor.tacticsProfile);
  const candidates = healingActions.flatMap((action) => woundedAllies.map((target) => {
    const targetDefinition = getDefinition(snapshot, target);
    const missingHp = targetDefinition.maxHp - target.currentHp;
    const missingHpRatio = missingHp / Math.max(1, targetDefinition.maxHp);
    const average = averageHealing(action, definition);
    const distance = gridDistance(actor.position, target.position, snapshot.map.grid);
    const selfTarget = action.targeting?.target === "self" || (action.range === 0 && target.id === actor.id);
    const reachable = selfTarget || isValidTarget(snapshot, actor, target, action.range);
    // If it's out of range, it's only a real option when the healer can close
    // the gap this turn — otherwise `resolveHealingAction` would just throw.
    const canMoveIntoRange = reachable
      || Boolean(bestDestinationTowardTarget(snapshot, actor, target, action.range, tactics));
    const reasons = [
      target.state === "downed" ? "downed ally" : `${Math.round(missingHpRatio * 100)}% HP missing`,
      `${Math.round(average)} expected healing`,
      reachable ? "in range" : "moves into range"
    ];
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    const priorityBonus = (target.tags?.includes("protected") ? 20 : 0)
      + (target.tags?.includes("high-priority") ? 10 : 0)
      + (target.tags?.includes("low-priority") ? -15 : 0);
    if (priorityBonus > 0) reasons.push("guarded ally");
    if (priorityBonus < 0) reasons.push("tagged low-priority");
    const score = (target.state === "downed" ? 95 : missingHpRatio * 45)
      + Math.min(average, missingHp)
      + priorityBonus
      - resourcePenalty
      - distance / 20
      + (reachable ? 10 : 2);
    return { action, target, score, reasons, reachable, canMoveIntoRange };
  }));

  const viable = candidates.filter((candidate) => candidate.canMoveIntoRange);
  viable.sort((a, b) => b.score - a.score || a.target.currentHp - b.target.currentHp || a.action.id.localeCompare(b.action.id));
  const best = viable[0];
  if (!best || best.score < 35) {
    return undefined;
  }
  return { action: best.action, target: best.target, score: best.score, reasons: best.reasons, reachable: best.reachable };
}

/**
 * `"chosen"` (Prayer of Healing) / `"area"` (Mass Cure Wounds) healing —
 * mirrors `selectHealingAction`'s scoring terms (missing-HP%, downed bonus,
 * clamped average healing, resource penalty) summed over the resolved
 * target set, but stays a separate function/plan type rather than widening
 * `HealingPlan` — that type is a `BonusPick` consumer (see `BonusPick`
 * below) and this shape (plural targets, no single `range`-from-actor
 * concept for area mode) doesn't fit it.
 */
function selectHealingBurstAction(snapshot: EncounterSnapshot, actor: CombatantState): HealingBurstPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const burstActions = getExecutableActions(definition)
    .filter((action): action is HealingAction => action.kind === "healing"
      && (action.targeting?.target === "chosen" || action.targeting?.target === "area")
      && action.actionType === "action"
      && action.automationSupport === "full"
      && canPayResource(actor, action));
  if (!burstActions.length) {
    return undefined;
  }

  const definitionsById = new Map(snapshot.definitions.map((candidate) => [candidate.id, candidate]));
  let best: HealingBurstPlan | undefined;

  for (const action of burstActions) {
    const average = averageHealing(action, definition);
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    const scoreFor = (target: CombatantState) => {
      const targetDefinition = getDefinition(snapshot, target);
      const missingHp = targetDefinition.maxHp - target.currentHp;
      const missingHpRatio = missingHp / Math.max(1, targetDefinition.maxHp);
      return (target.state === "downed" ? 95 : missingHpRatio * 45) + Math.min(average, missingHp);
    };

    if (action.targeting?.target === "chosen") {
      const woundedAllies = snapshot.combatants
        .filter((combatant) => combatant.faction === actor.faction && (combatant.state === "active" || combatant.state === "downed"))
        .filter((combatant) => combatant.currentHp < getDefinition(snapshot, combatant).maxHp)
        .filter((combatant) => isValidTarget(snapshot, actor, combatant, action.range));
      const scored = woundedAllies
        .map((target) => ({ target, value: scoreFor(target) - gridDistance(actor.position, target.position, snapshot.map.grid) / 20 }))
        .sort((a, b) => b.value - a.value);
      const taken = scored.slice(0, action.targeting?.count ?? scored.length);
      if (!taken.length) {
        continue;
      }
      const score = taken.reduce((sum, candidate) => sum + candidate.value, 0) - resourcePenalty;
      if (score > 0 && (!best || score > best.score)) {
        best = { action, targets: taken.map((candidate) => candidate.target), score, reasons: [`heals ${taken.length} allies`] };
      }
      continue;
    }

    // "area" — try centering the burst on each wounded ally within range and
    // keep whichever placement catches the most total value. A full grid
    // search isn't needed: the best center is always at (or adjacent to) a
    // cluster of wounded allies, and every wounded ally's own position is a
    // candidate for "the center of its cluster."
    if (!action.area) {
      continue;
    }
    const rangeLimit = action.areaTargeting?.range ?? action.range;
    const woundedInRange = snapshot.combatants
      .filter((combatant) => combatant.faction === actor.faction && (combatant.state === "active" || combatant.state === "downed"))
      .filter((combatant) => combatant.currentHp < getDefinition(snapshot, combatant).maxHp)
      .filter((combatant) => gridDistance(actor.position, combatant.position, snapshot.map.grid) <= rangeLimit);
    let bestPlacement: { origin: Point; targets: CombatantState[]; value: number } | undefined;
    for (const candidate of woundedInRange) {
      const caught = combatantsInArea(snapshot.map, candidate.position, action.area, snapshot.combatants, definitionsById, undefined, { includeDowned: true })
        .filter((target) => target.faction === actor.faction);
      const value = caught.reduce((sum, target) => sum + scoreFor(target), 0);
      if (!bestPlacement || value > bestPlacement.value) {
        bestPlacement = { origin: candidate.position, targets: caught, value };
      }
    }
    if (!bestPlacement || !bestPlacement.targets.length) {
      continue;
    }
    const score = bestPlacement.value - resourcePenalty - gridDistance(actor.position, bestPlacement.origin, snapshot.map.grid) / 20;
    if (score > 0 && (!best || score > best.score)) {
      best = { action, targets: bestPlacement.targets, aim: bestPlacement.origin, score, reasons: [`heals ${bestPlacement.targets.length} allies in a burst`] };
    }
  }

  return best;
}

/**
 * Singular-target buff (Shield of Faith) — mirrors `selectHealingAction`'s
 * shape (candidates = actions × eligible allies, scored, sorted) minus the
 * HP-missing terms, which have no buff analog. Hard-filters any ally who
 * already carries this exact buff's condition id — structurally prevents
 * recasting the same buff on an already-buffed party, not just a
 * score-tuning hope.
 */
function selectBuffAction(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  slot: "action" | "bonus" = "action"
): BuffPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const buffActions = getExecutableActions(definition)
    .filter((action): action is BuffAction => action.kind === "buff"
      && action.actionType === slot
      && (action.targeting?.target ?? "single") !== "chosen"
      // Prep-only buffs (Aid, Mage Armor) are DM-toggled before combat, not
      // an in-combat option — never a candidate here.
      && !action.prepOnly
      && action.automationSupport === "full"
      && canPayResource(actor, action));
  if (!buffActions.length) {
    return undefined;
  }
  const allies = snapshot.combatants.filter((combatant) => combatant.faction === actor.faction && combatant.state === "active");

  const candidates = buffActions.flatMap((action) => {
    const mode = action.targeting?.target ?? "single";
    const eligible = mode === "self" ? [actor] : allies;
    const conditionId = action.appliedCondition.id ?? action.id;
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    return eligible
      .filter((target) => !target.conditions?.some((condition) => condition.id === conditionId))
      .map((target) => {
        const distance = mode === "self" ? 0 : gridDistance(actor.position, target.position, snapshot.map.grid);
        const reachable = mode === "self" || isValidTarget(snapshot, actor, target, action.range);
        const canMoveIntoRange = reachable || Boolean(bestDestinationTowardTarget(snapshot, actor, target, action.range, tacticsSettings(actor.tacticsProfile)));
        const priorityBonus = (target.tags?.includes("protected") ? 20 : 0)
          + (target.tags?.includes("high-priority") ? 10 : 0)
          + (target.tags?.includes("low-priority") ? -15 : 0);
        const score = 15 + priorityBonus - resourcePenalty - distance / 20 + (reachable ? 10 : 2);
        return { action, target, score, reasons: ["worth buffing"], reachable, canMoveIntoRange };
      });
  });

  const viable = candidates.filter((candidate) => candidate.canMoveIntoRange);
  viable.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
  const best = viable[0];
  return best && best.score > 0
    ? { action: best.action, target: best.target, score: best.score, reasons: best.reasons, reachable: best.reachable }
    : undefined;
}

/**
 * `"chosen"`-mode buff (Bless: "up to three creatures within range of you").
 * Real 5e casting time for every such spell in this library is `"action"`,
 * so unlike `selectBuffAction` this never needs a `slot` param or `BonusPick`
 * wiring. Picks the top-`count` not-already-buffed allies by the same
 * priority-tag/distance terms `selectBuffAction` uses (no HP term — that's
 * healing's concern).
 */
function selectBuffBurstAction(snapshot: EncounterSnapshot, actor: CombatantState): BuffBurstPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const buffActions = getExecutableActions(definition)
    .filter((action): action is BuffAction => action.kind === "buff"
      && action.actionType === "action"
      && action.targeting?.target === "chosen"
      && !action.prepOnly
      && action.automationSupport === "full"
      && canPayResource(actor, action));
  if (!buffActions.length) {
    return undefined;
  }
  const allies = snapshot.combatants.filter((combatant) => combatant.faction === actor.faction && combatant.state === "active");

  let best: BuffBurstPlan | undefined;
  for (const action of buffActions) {
    const conditionId = action.appliedCondition.id ?? action.id;
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    const scored = allies
      .filter((target) => !target.conditions?.some((condition) => condition.id === conditionId))
      .filter((target) => isValidTarget(snapshot, actor, target, action.range))
      .map((target) => {
        const priorityBonus = (target.tags?.includes("protected") ? 20 : 0)
          + (target.tags?.includes("high-priority") ? 10 : 0)
          + (target.tags?.includes("low-priority") ? -15 : 0);
        return { target, value: 15 + priorityBonus - gridDistance(actor.position, target.position, snapshot.map.grid) / 20 };
      })
      .sort((a, b) => b.value - a.value);
    const taken = scored.slice(0, action.targeting?.count ?? scored.length);
    if (!taken.length) {
      continue;
    }
    const score = taken.reduce((sum, candidate) => sum + candidate.value, 0) - resourcePenalty;
    if (score > 0 && (!best || score > best.score)) {
      best = { action, targets: taken.map((candidate) => candidate.target), score, reasons: [`buffs ${taken.length} allies`] };
    }
  }
  return best;
}

/** Score a single candidate cell for a teleporting `mover` — no target/direction, just "is this a good place to be." */
function teleportDestinationScore(snapshot: EncounterSnapshot, actor: CombatantState, cell: Point, tactics: TacticsSettings): number {
  const nearestHostile = nearestHostileDistanceFrom(snapshot, actor, cell);
  const threatPenalty = isThreatenedAt(snapshot, actor, cell) ? -40 : 0;
  const hazardPenalty = hazardAtCell(snapshot, actor, cell) * tactics.hazardWeight * 10;
  const coverBonus = tactics.coverWeight > 0 && mapHasCoverWalls(snapshot)
    ? coverFromHostilesAt(snapshot, actor, cell) * tactics.coverWeight
    : 0;
  return distanceBandScore(nearestHostile, tactics) + threatPenalty - hazardPenalty + coverBonus;
}

/**
 * Best legal cell within `action.range` of `actor` for `mover` to blink to —
 * reuses the same spacing/hazard/cover scoring `movementPlanForCell` builds
 * normal movement plans from, just with no path/budget/OA constraint since a
 * teleport ignores all three. Enumerated via `cellsInArea` (a plain circle
 * scan, the same primitive area-save AI scoring already uses), not
 * `findReachableCells` (which is pathfinding-bound and wrong here).
 */
function bestTeleportDestination(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  action: RepositionAction,
  mover: CombatantState,
  tactics: TacticsSettings
): Point | undefined {
  const moverDefinition = getDefinition(snapshot, mover);
  const footprint = sizeFootprint(moverDefinition.size);
  const occupied = occupiedCellsFor(snapshot, mover.id);
  const currentScore = teleportDestinationScore(snapshot, actor, mover.position, tactics);
  const candidates = cellsInArea(snapshot.map, actor.position, { type: "circle", size: action.range })
    .filter((cell) => isFootprintLegal(snapshot.map, cell, footprint, occupied)
      && (!action.requiresLineOfEffect || !snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, actor.position, cell)))
    .map((cell) => ({ cell, score: teleportDestinationScore(snapshot, actor, cell, tactics) }))
    .filter((candidate) => candidate.score > currentScore + 4);

  candidates.sort((a, b) => b.score - a.score || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  return candidates[0]?.cell;
}

/**
 * Picks the best reposition (teleport) spell/target/destination combo for
 * `slot`, mirroring `selectHealingAction`'s shape/scoring conventions. v1
 * scope: only ever reached for the `"bonus"` slot (see `maybeSpendBonusAction`)
 * — an action-cost reposition spell (Dimension Door) can call this the same
 * way once it's worth wiring into the main-action decision tree.
 */
function selectRepositionAction(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  slot: "action" | "bonus" = "bonus"
): RepositionPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const tactics = tacticsSettings(actor.tacticsProfile);
  const repositionActions = getExecutableActions(definition)
    .filter((action): action is RepositionAction => action.kind === "reposition"
      && action.actionType === slot
      && action.automationSupport === "full"
      && canPayResource(actor, action));
  if (!repositionActions.length) {
    return undefined;
  }
  const movers = snapshot.combatants.filter((combatant) =>
    combatant.faction === actor.faction && combatant.state === "active");

  const candidates = repositionActions.flatMap((action) => {
    const eligibleMovers = action.targeting?.target === "single"
      ? movers.filter((mover) => isValidTarget(snapshot, actor, mover, action.range))
      : [actor];
    return eligibleMovers.map((mover) => {
      const destination = bestTeleportDestination(snapshot, actor, action, mover, tactics);
      if (!destination) {
        return undefined;
      }
      // A big, guaranteed-to-clear-the-bar floor when genuinely threatened (mirrors
      // `selectHealingAction`'s "downed ally = 95" pattern) — v1 is an escape tool,
      // not a general repositioning optimizer, so a merely-nicer, unthreatened spot
      // should not be worth burning a spell slot over. Gated to a ranged posture:
      // a melee actor being "threatened" (adjacent to a hostile) after its own
      // action just closed the distance to attack is the intended outcome of its
      // turn, not something to flee — a melee actor that wants to close the gap
      // in the first place gets `selectMeleeGapCloserReposition` instead.
      const urgency = tactics.preferred === "ranged" && isThreatenedAt(snapshot, actor, mover.position) ? 50 : 0;
      const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
      const reasons = [urgency > 0 ? "escapes an immediate threat" : "improves position", `${action.name}`];
      return { action, mover, destination, score: urgency - resourcePenalty + 10, reasons };
    });
  }).filter((candidate): candidate is RepositionPlan => candidate != null);

  candidates.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
  const best = candidates[0];
  return best && best.score >= 30 ? best : undefined;
}

interface GapCloserPlan {
  action: RepositionAction;
  destination: Point;
}

/**
 * A melee actor's bonus-action self-teleport, used to CLOSE distance into
 * attack range this turn — tried by `takeAutomatedTurn` before falling back
 * to Dash when a plain move can't reach. Landing a guaranteed attack with
 * the action beats spending the whole turn on Dash for nothing. Melee-only:
 * a ranged actor wants distance from its targets, not less of it.
 */
function selectMeleeGapCloserReposition(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings
): GapCloserPlan | undefined {
  if (tactics.preferred !== "melee" || !canAct(actor, "bonus")) {
    return undefined;
  }
  const definition = getDefinition(snapshot, actor);
  const repositionActions = getExecutableActions(definition)
    .filter((action): action is RepositionAction => action.kind === "reposition"
      && action.actionType === "bonus"
      && (action.targeting?.target ?? "self") === "self"
      && action.automationSupport === "full"
      && canPayResource(actor, action));
  if (!repositionActions.length) {
    return undefined;
  }
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCellsFor(snapshot, actor.id);

  let best: GapCloserPlan | undefined;
  for (const action of repositionActions) {
    const legalCells = cellsInArea(snapshot.map, actor.position, { type: "circle", size: action.range })
      .filter((cell) => gridDistance(cell, target.position, snapshot.map.grid) <= range
        && isFootprintLegal(snapshot.map, cell, footprint, occupied)
        && (!action.requiresLineOfEffect || !snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, actor.position, cell))
        && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, cell, target.position)));
    if (!legalCells.length) {
      continue;
    }
    legalCells.sort((a, b) => gridDistance(a, target.position, snapshot.map.grid) - gridDistance(b, target.position, snapshot.map.grid));
    const destination = legalCells[0]!;
    if (!best || resourceCostWeight(action) < resourceCostWeight(best.action)) {
      best = { action, destination };
    }
  }
  return best;
}

function selectFeatureActivationAction(snapshot: EncounterSnapshot, actor: CombatantState): FeatureActivationPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const hostiles = snapshot.combatants.filter((combatant) => combatant.faction !== actor.faction && combatant.state === "active");
  if (hostiles.length === 0) {
    return undefined;
  }
  const actions = getExecutableActions(definition)
    .filter((action): action is FeatureActivationAction => action.kind === "activate-feature"
      && action.actionType === "bonus"
      && action.automationSupport === "full"
      && canPayResource(actor, action)
      && Boolean(action.condition)
      && !hasActiveFeatureCondition(actor, action.featureId));
  const candidates = actions.map((action) => {
    const effects = action.condition?.effects ?? [];
    const hasOffense = effects.some((effect) => effect.kind === "damage-bonus" || effect.kind === "attack-bonus" || effect.kind === "attack-advantage");
    const hasDefense = effects.some((effect) => effect.kind === "damage-adjustment"
      || effect.kind === "armor-class-bonus"
      || effect.kind === "save-bonus"
      || effect.kind === "save-advantage");
    const duration = action.condition?.durationRounds ?? 1;
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    const score = (hasOffense ? 25 : 0)
      + (hasDefense ? 18 : 0)
      + Math.min(duration, 10)
      - resourcePenalty;
    const reasons = [
      hasOffense ? "improves attacks" : "no attack boost",
      hasDefense ? "improves defenses" : "no defensive boost",
      `${duration} round duration`
    ];
    return { action, score, reasons };
  }).filter((candidate) => candidate.score >= 20);

  candidates.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
  return candidates[0];
}

function hasActiveFeatureCondition(actor: CombatantState, featureId: string): boolean {
  return (actor.conditions ?? []).some((condition) => condition.sourceId === featureId);
}

function selectOffensivePlan(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  tactics: TacticsSettings,
  slot: "action" | "bonus" = "action",
  options: { mustReachNow?: boolean; relaxReachability?: boolean } = {}
): OffensivePlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const hostiles = snapshot.combatants.filter((combatant) => combatant.faction !== actor.faction && combatant.state === "active");
  const definitionsById = new Map(snapshot.definitions.map((candidate) => [candidate.id, candidate]));
  const candidates = getExecutableActions(definition)
    .filter((action): action is OffensiveAction => action.automationSupport === "full" && action.actionType === slot && canPayResource(actor, action) && (action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack"))
    .flatMap((action) => hostiles.map((target) => {
      const targetDefinition = getDefinition(snapshot, target);
      const range = actionRange(action, definition);
      const distance = gridDistance(actor.position, target.position, snapshot.map.grid);
      const reachableNow = isValidTarget(snapshot, actor, target, range);
      const canMoveIntoRange = reachableNow || Boolean(bestDestinationTowardTarget(snapshot, actor, target, range, tactics));
      const expectedDamage = expectedDamageAgainst(action, definition, actor, targetDefinition);
      const controlValue = action.kind === "area-save" ? 0 : expectedRiderControl(action, definition, targetDefinition, tactics);
      const preferredBonus = actionMatchesPreference(action, definition, tactics) ? 8 : 0;
      const resourcePenalty = resourceCostWeight(action) * 4 * resourceStanceMultiplier(actor.resourceStance)
        * optionalRiderCostDiscount(action, definition, targetDefinition);
      const targetHpRatio = clamp(target.currentHp / Math.max(1, targetDefinition.maxHp), 0, 1);
      const killPressure = target.currentHp <= expectedDamage
        ? tactics.killWeight
        : expectedDamage / Math.max(1, target.currentHp) * 6;
      const woundedPressure = (1 - targetHpRatio) * tactics.woundedWeight;
      const protectPressure = tactics.protectWeight > 0 && threatensWoundedAlly(snapshot, actor, target)
        ? tactics.protectWeight
        : 0;
      const tagPressure = tagPriorityValue(target.tags) * tactics.priorityWeight;
      const spacingScore = action.kind === "attack" && (action.attackType === "ranged" || action.attackType === "spell")
        ? distanceBandScore(distance, tactics)
        : 0;
      const threatenedRangedPenalty = isThreatenedAt(snapshot, actor, actor.position)
        && action.kind === "attack"
        && action.attackType !== "melee"
        ? 12
        : 0;
      const targetCover = snapshot.rules.cover
        && ((action.kind === "attack" && action.attackType !== "melee")
          || (action.kind === "save" && action.saveAbility === "dex"))
        ? coverBetween(
          snapshot.map,
          actor.position,
          sizeFootprint(definition.size),
          target.position,
          sizeFootprint(targetDefinition.size)
        ).acBonus
        : 0;
      const coverPenalty = targetCover * 1.5;
      const reasons = [
        `${Math.round(expectedDamage * 10) / 10} expected damage`,
        reachableNow ? "target in range" : canMoveIntoRange ? "can move into range" : "out of reach",
        preferredBonus > 0 ? `${tactics.preferred} tactic match` : "off-profile action"
      ];
      if (killPressure >= tactics.killWeight) reasons.push("can drop target");
      if (woundedPressure > 0) reasons.push("wounded target");
      if (protectPressure > 0) reasons.push("protecting wounded ally");
      if (threatenedRangedPenalty > 0) reasons.push("ranged attack threatened");
      if (coverPenalty > 0) reasons.push(targetCover >= 5 ? "target behind three-quarters cover" : "target behind half cover");
      if (controlValue > 0) reasons.push("imposes a condition");
      if (tagPressure > 0) reasons.push("tagged high-priority");
      if (tagPressure < 0) reasons.push("tagged low-priority");
      let score = expectedDamage * 2
        + controlValue
        + preferredBonus
        + killPressure
        + woundedPressure
        + protectPressure
        + tagPressure
        + spacingScore
        - resourcePenalty
        - threatenedRangedPenalty
        - coverPenalty
        - distance / 12;
      if (reachableNow) score += 10;
      else if (canMoveIntoRange) score += 2;
      else score -= 35;
      if (action.kind === "area-save") {
        // Score the blast where it will actually land (self-centred / aimed templates included).
        const { origin, aimVector, fromSelf } = resolveAreaTargeting(actor, definition, action, target.position);
        const affected = combatantsInArea(snapshot.map, origin, action.area, snapshot.combatants, definitionsById, aimVector)
          // A self-origin blast never catches its own caster (matches resolution).
          .filter((combatant) => !(fromSelf && combatant.id === actor.id));
        const hostiles = affected.filter((combatant) => combatant.faction !== actor.faction);
        const hostileValue = hostiles.reduce((sum, combatant) => {
          const combatantDefinition = getDefinition(snapshot, combatant);
          return sum
            + expectedDamageAgainst(action, definition, actor, combatantDefinition)
            + expectedRiderControl(action, definition, combatantDefinition, tactics)
            + tagPriorityValue(combatant.tags) * tactics.priorityWeight;
        }, 0);
        const friendlyRisk = affected
          .filter((combatant) => combatant.faction === actor.faction)
          .reduce((sum, combatant) => sum + expectedDamageAgainst(action, definition, actor, getDefinition(snapshot, combatant)), 0);
        score += hostileValue * (1.2 + tactics.areaWeight) - friendlyRisk * 2.5;
        reasons.push(`${hostiles.length} hostile targets`);
        if (friendlyRisk > 0) reasons.push("friendly fire risk");
        if (action.zone) {
          const predictedValue = predictedZoneApproachValue(snapshot, actor, definition, action, origin, aimVector, affected, tactics);
          score += predictedValue * (1.2 + tactics.areaWeight);
          if (predictedValue > 0) reasons.push("blocks a likely approach route");
        }
      } else if (action.kind === "save") {
        // Hold Person-style upcast: extra in-range hostiles caught for free, valued like the primary target.
        const capacity = upcastExtraTargetCapacity(action);
        if (capacity > 0) {
          const extraTargets = hostiles.filter((hostile) => hostile.id !== target.id && isValidTarget(snapshot, actor, hostile, range));
          const bonusCount = Math.min(capacity, extraTargets.length);
          if (bonusCount > 0) {
            score += bonusCount * (expectedDamage + controlValue) * 0.85;
            reasons.push(`hits ${bonusCount} bonus target${bonusCount > 1 ? "s" : ""} from upcasting`);
          }
        }
      }
      return { action, target, range, score, expectedDamage, distance, reachableNow, canMoveIntoRange, reasons };
    }))
    // A bonus action is normally a follow-up: the actor has already moved / acted,
    // so only targets it can hit from where it stands count. `mustReachNow` applies
    // the same rule after the action-phase move is already spent. `relaxReachability`
    // is the exception: it lets `selectJointTurnPlan` weigh a bonus-action target the
    // actor hasn't moved toward yet, using the full remaining movement budget.
    .filter((plan) => (slot === "action" && !options.mustReachNow)
      || plan.reachableNow
      || (options.relaxReachability && plan.canMoveIntoRange));

  candidates.sort((a, b) => b.score - a.score || a.target.currentHp - b.target.currentHp || a.target.id.localeCompare(b.target.id));
  return candidates[0];
}

function isValidTarget(snapshot: EncounterSnapshot, actor: CombatantState, target: CombatantState, range: number): boolean {
  return gridDistance(actor.position, target.position, snapshot.map.grid) <= range
    && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, actor.position, target.position));
}

/**
 * Spread a beam attack's beams: focus the primary target until an estimate says
 * it is dead, then spill the rest onto the next-best hostile in range. Collapses
 * to "all beams on the primary" when there is only one hostile.
 */
function beamTargets(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  action: Extract<ActionDefinition, { kind: "attack" }>,
  primary: CombatantState,
  range: number
): string[] {
  const definition = getDefinition(snapshot, actor);
  const beams = resolveBeamCount(action, definition.character?.level ?? 1, spellSlotLevel(action.resourceCost?.resourceId));
  if (beams <= 1) {
    return [primary.id];
  }
  const ranked = snapshot.combatants
    .filter((c) => c.faction !== actor.faction && c.state === "active" && c.id !== primary.id && isValidTarget(snapshot, actor, c, range))
    .map((c) => ({ combatant: c, value: expectedDamageAgainst(action, definition, actor, getDefinition(snapshot, c)) }))
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.combatant);
  const ordered = [primary, ...ranked];
  if (ordered.length === 1) {
    return Array.from({ length: beams }, () => primary.id);
  }
  const perBeam = Math.max(1, expectedDamageAgainst(action, definition, actor, getDefinition(snapshot, primary)) / beams);
  const assigned: Record<string, number> = {};
  const result: string[] = [];
  for (let index = 0; index < beams; index += 1) {
    const pick = ordered.find((c) => (assigned[c.id] ?? 0) < c.currentHp) ?? ordered[0]!;
    result.push(pick.id);
    assigned[pick.id] = (assigned[pick.id] ?? 0) + perBeam;
  }
  return result;
}

/** Extra in-range hostiles an upcast save spell catches for free (Hold Person-style), nearest first, capped by `upcastExtraTargetCapacity`. */
function saveBonusTargetIds(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  action: Extract<ActionDefinition, { kind: "save" }>,
  primary: CombatantState,
  range: number
): string[] {
  const capacity = upcastExtraTargetCapacity(action);
  if (capacity <= 0) {
    return [];
  }
  return snapshot.combatants
    .filter((c) => c.faction !== actor.faction && c.state === "active" && c.id !== primary.id && isValidTarget(snapshot, actor, c, range))
    .sort((a, b) => gridDistance(actor.position, a.position, snapshot.map.grid) - gridDistance(actor.position, b.position, snapshot.map.grid))
    .slice(0, capacity)
    .map((c) => c.id);
}

function bestDestinationTowardTarget(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings,
  options: { allowPartialApproach?: boolean } = {}
): MovementPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCellsFor(snapshot, actor.id);
  const movementBudget = remainingMovementBudget(snapshot, actor);
  const pathingMap = hazardPathingOverlay(zoneTerrainOverlay(snapshot.map, snapshot.activeZones));
  const plans = findReachableCells(pathingMap, actor.position, footprint, movementBudget, occupied, {
    allowOccupiedTransit: true,
    occupiedMovementMultiplier: 2
  }).map((reachable) => movementPlanForCell(snapshot, actor, target, range, tactics, reachable));

  const inRange = plans.filter((candidate) => candidate.targetDistance <= range
    && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, candidate.cell, target.position)));
  if (inRange.length > 0) {
    inRange.sort((a, b) => b.score - a.score || a.pathCost - b.pathCost || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
    return inRange[0];
  }

  if (!options.allowPartialApproach) {
    return undefined;
  }

  // Nothing in range is reachable this move. Rather than stand still, advance as
  // far toward the target as the budget allows — but "far" has to mean along a
  // real route, not straight-line distance, or a wall between the actor and the
  // target can send it to a cell that reads as "closer" while actually needing a
  // much longer walk around. A single cost field rooted at the target gives every
  // candidate's true remaining path length in one pass (movement cost is
  // symmetric, so "cost from target to cell" == "cost from cell to target").
  const routeField = pathCostField(pathingMap, target.position, footprint, occupied, {
    allowOccupiedTransit: true,
    occupiedMovementMultiplier: 2
  });
  const currentRouteCost = routeField.get(cellKey(actor.position)) ?? Number.POSITIVE_INFINITY;
  const approach = plans
    .map((candidate) => ({ candidate, routeCost: routeField.get(cellKey(candidate.cell)) ?? Number.POSITIVE_INFINITY }))
    .filter(({ routeCost }) => routeCost < currentRouteCost - 1e-9);
  if (approach.length === 0) {
    return undefined;
  }
  approach.sort((a, b) =>
    a.routeCost - b.routeCost
    || a.candidate.opportunityThreats - b.candidate.opportunityThreats
    || a.candidate.pathCost - b.candidate.pathCost
    || b.candidate.score - a.candidate.score
    || a.candidate.cell.y - b.candidate.cell.y
    || a.candidate.cell.x - b.candidate.cell.x);
  return { ...approach[0].candidate, routeToTarget: approach[0].routeCost };
}

function cellKey(point: Point): string {
  return `${point.x},${point.y}`;
}

function bestRepositionAfterAction(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings
): MovementPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCellsFor(snapshot, actor.id);
  const movementBudget = remainingMovementBudget(snapshot, actor);
  const currentDistance = gridDistance(actor.position, target.position, snapshot.map.grid);
  const currentNearestHostile = nearestHostileDistanceFrom(snapshot, actor, actor.position);
  const currentCover = tactics.coverWeight > 0 && mapHasCoverWalls(snapshot)
    ? coverFromHostilesAt(snapshot, actor, actor.position)
    : 0;
  const currentScore = distanceBandScore(currentDistance, tactics)
    + Math.min(currentNearestHostile, tactics.preferredMinDistance) / 5
    + (currentCover > 0 ? currentCover * tactics.coverWeight + 4 : 0);
  const candidates = findReachableCells(hazardPathingOverlay(zoneTerrainOverlay(snapshot.map, snapshot.activeZones)), actor.position, footprint, movementBudget, occupied, {
    allowOccupiedTransit: true,
    occupiedMovementMultiplier: 2
  })
    .map((reachable) => movementPlanForCell(snapshot, actor, target, range, tactics, reachable))
    .filter((candidate) => candidate.targetDistance <= range
      && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, candidate.cell, target.position))
      && candidate.score > currentScore + 4);

  candidates.sort((a, b) => b.score - a.score || a.pathCost - b.pathCost || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  return candidates[0];
}

function mapHasCoverWalls(snapshot: EncounterSnapshot): boolean {
  return snapshot.map.walls.some((wall) => wallCover(wall) !== "none");
}

function coverPhrase(coverBonus: number): string {
  return coverBonus >= 5 ? "three-quarters cover" : coverBonus >= 2 ? "half cover" : "the open";
}

/** Mean cover (AC value 0/2/5) the actor would have from every active hostile if it stood on `cell`. */
function coverFromHostilesAt(snapshot: EncounterSnapshot, actor: CombatantState, cell: Point): number {
  const actorFootprint = sizeFootprint(getDefinition(snapshot, actor).size);
  const hostiles = snapshot.combatants.filter(
    (combatant) => combatant.faction !== actor.faction && combatant.state === "active"
  );
  if (hostiles.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const hostile of hostiles) {
    const result = coverBetween(
      snapshot.map,
      hostile.position,
      sizeFootprint(getDefinition(snapshot, hostile).size),
      cell,
      actorFootprint
    );
    sum += result.blocksTargeting ? 5 : result.acBonus;
  }
  return sum / hostiles.length;
}

/**
 * Extra placement value for a persistent-zone spell from hostiles who
 * *aren't* caught in the blast yet: for each such hostile, find its nearest
 * target on the caster's side and check whether the shortest path there
 * crosses the candidate zone. A one-shot burst has no reason to care about
 * this (the blast is gone next turn); a zone sticking around makes "sits on
 * their approach route" a real, if speculative, reason to place it here.
 */
function predictedZoneApproachValue(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  definition: CreatureDefinition,
  action: AreaSaveActionDefinition,
  origin: Point,
  aimVector: AimVector | undefined,
  alreadyCaught: CombatantState[],
  tactics: TacticsSettings
): number {
  const zoneCellKeys = new Set(cellsInArea(snapshot.map, origin, action.area, aimVector).map((cell) => `${cell.x},${cell.y}`));
  if (zoneCellKeys.size === 0) {
    return 0;
  }
  const alliesOfCaster = snapshot.combatants.filter((combatant) => combatant.faction === actor.faction && combatant.state === "active");
  if (alliesOfCaster.length === 0) {
    return 0;
  }
  const caughtIds = new Set(alreadyCaught.map((combatant) => combatant.id));
  const otherHostiles = snapshot.combatants.filter((combatant) =>
    combatant.faction !== actor.faction && combatant.state === "active" && !caughtIds.has(combatant.id));

  let value = 0;
  for (const hostile of otherHostiles) {
    const hostileDefinition = getDefinition(snapshot, hostile);
    const nearestAlly = alliesOfCaster.reduce<{ ally: CombatantState; distance: number } | null>((closest, ally) => {
      const distance = gridDistance(hostile.position, ally.position, snapshot.map.grid);
      return !closest || distance < closest.distance ? { ally, distance } : closest;
    }, null)?.ally;
    if (!nearestAlly) {
      continue;
    }
    const path = findPath(snapshot.map, hostile.position, nearestAlly.position, sizeFootprint(hostileDefinition.size));
    if (!path.reachable || !path.cells.some((cell) => zoneCellKeys.has(`${cell.x},${cell.y}`))) {
      continue;
    }
    value += (expectedDamageAgainst(action, definition, actor, hostileDefinition)
      + tagPriorityValue(hostile.tags) * tactics.priorityWeight) * ZONE_PREDICTIVE_APPROACH_DISCOUNT;
  }
  return value;
}

/**
 * Sum of enemy-sourced damaging/rider `ActiveZone`s AND damaging/rider hazard
 * terrain tiles (acid, lava, ...) covering `cell`, from `actor`'s perspective
 * (an ally's own zone is never a hazard to them; terrain hazards have no
 * caster/faction, so they count against everyone equally).
 */
function hazardAtCell(snapshot: EncounterSnapshot, actor: CombatantState, cell: Point): number {
  let hazard = 0;
  const zones = snapshot.activeZones;
  if (zones?.length) {
    for (const zone of zones) {
      if (!zone.damage?.length && !zone.riders?.length) {
        continue;
      }
      const source = snapshot.combatants.find((combatant) => combatant.id === zone.sourceCombatantId);
      const harmsActor = !(zone.affects === "hostile" && source?.faction === actor.faction);
      if (harmsActor && cellIntersectsArea(cell, zone.origin, zone.area, snapshot.map.grid.distancePerSquare)) {
        hazard += 1;
      }
    }
  }
  const tile = terrainAtCell(snapshot.map.terrain, cell);
  if (tile?.hazard && (tile.hazard.damage?.length || tile.hazard.riders?.length)) {
    hazard += 1;
  }
  return hazard;
}


function movementPlanForCell(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings,
  reachable: ReachableCell
): MovementPlan {
  const { cell, cost, cells } = reachable;
  const targetDistance = gridDistance(cell, target.position, snapshot.map.grid);
  const threats = opportunityAttackThreats(snapshot, actor.id, cells).length;
  const nearestHostile = nearestHostileDistanceFrom(snapshot, actor, cell);
  const coverBonus = tactics.coverWeight > 0 && mapHasCoverWalls(snapshot)
    ? coverFromHostilesAt(snapshot, actor, cell)
    : 0;
  // A flat bump for being in *any* cover clears the reposition hysteresis; the
  // scaled term then rewards stronger cover.
  const coverScore = coverBonus > 0 ? coverBonus * tactics.coverWeight + 4 : 0;
  // Every cell actually entered along the way, not just where the move ends —
  // `cells[0]` is the start (already-occupied ground, not "entered" by this
  // move), matching the on-enter convention `checkZoneOnEnter` /
  // `checkTerrainHazardOnEnter` use for the real damage application.
  // Without this, a destination that's itself hazard-free scored as "safe"
  // even when the only path there cut straight through a lava tile.
  const hazardExposure = tactics.hazardWeight > 0
    ? cells.slice(1).reduce((total, step) => total + hazardAtCell(snapshot, actor, step), 0)
    : 0;
  const hazardPenalty = hazardExposure * tactics.hazardWeight * 10;
  const score = tactics.preferred === "melee"
    ? -targetDistance * 2 - cost - threats * tactics.reactionRiskWeight * 10 - hazardPenalty
    : distanceBandScore(targetDistance, tactics)
      + Math.min(nearestHostile, tactics.preferredMinDistance) / 4
      - cost * 0.75
      - threats * tactics.reactionRiskWeight * 10
      - (targetDistance > range ? 30 : 0)
      + coverScore
      - hazardPenalty;
  return { cell, pathCost: cost, targetDistance, score, opportunityThreats: threats, coverBonus };
}

/** Cover (AC value; total cover scored as 6) `target` would have from an attacker standing on `cell`. */
function targetCoverFrom(snapshot: EncounterSnapshot, cell: Point, actorFootprint: number, target: CombatantState): number {
  const result = coverBetween(
    snapshot.map,
    cell,
    actorFootprint,
    target.position,
    sizeFootprint(getDefinition(snapshot, target).size)
  );
  return result.blocksTargeting ? 6 : result.acBonus;
}

/** A ranged action whose to-hit / save is degraded by the target's cover. */
function planIsRangedThroughCover(action: OffensiveAction): boolean {
  if (action.kind === "attack") return action.attackType === "ranged" || action.attackType === "spell";
  if (action.kind === "save" || action.kind === "area-save") return action.saveAbility === "dex";
  return false;
}

/**
 * A cell the actor can reach with a *normal* move (keeping its action for the
 * shot) that gives a cleaner line at `target` — less cover, or unblocks a shot
 * blocked by total cover — while staying in range and line of effect. Returns
 * `undefined` when the actor already has a clear shot or nothing reachable
 * improves it enough to be worth the step.
 */
function bestShotPositionAgainst(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings
): MovementPlan | undefined {
  if (!snapshot.rules.cover || !mapHasCoverWalls(snapshot)) return undefined;
  const definition = getDefinition(snapshot, actor);
  const footprint = sizeFootprint(definition.size);
  const currentCover = targetCoverFrom(snapshot, actor.position, footprint, target);
  if (currentCover <= 0) return undefined; // already a clean shot

  const occupied = occupiedCellsFor(snapshot, actor.id);
  const movementBudget = remainingMovementBudget(snapshot, actor);
  const candidates = findReachableCells(hazardPathingOverlay(zoneTerrainOverlay(snapshot.map, snapshot.activeZones)), actor.position, footprint, movementBudget, occupied, {
    allowOccupiedTransit: true,
    occupiedMovementMultiplier: 2
  })
    .map((reachable) => ({ reachable, gain: currentCover - targetCoverFrom(snapshot, reachable.cell, footprint, target) }))
    .filter(({ reachable, gain }) => gain > 0
      && gridDistance(reachable.cell, target.position, snapshot.map.grid) <= range
      && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, reachable.cell, target.position)))
    .map(({ reachable, gain }) => {
      const plan = movementPlanForCell(snapshot, actor, target, range, tactics, reachable);
      // Reward the cover stripped off the target on top of the usual band /
      // self-cover / threat / cost terms.
      return { ...plan, score: plan.score + gain * 3, gain };
    })
    // Don't wade into a melee threat to shave a little cover — only if it opens
    // an otherwise-blocked shot or removes three-quarters cover.
    .filter((plan) => plan.opportunityThreats === 0 || plan.gain >= 5);

  candidates.sort((a, b) => b.score - a.score || a.pathCost - b.pathCost || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  return candidates[0];
}

function distanceBandScore(distance: number, tactics: TacticsSettings): number {
  if (tactics.preferred === "melee") {
    return distance <= tactics.preferredMaxDistance ? 8 : -distance / 2;
  }
  if (distance < tactics.preferredMinDistance) {
    return -(tactics.preferredMinDistance - distance) / 2;
  }
  if (distance > tactics.preferredMaxDistance) {
    return -(distance - tactics.preferredMaxDistance) / 4;
  }
  return 8;
}

function occupiedCellsFor(snapshot: EncounterSnapshot, movingCombatantId: string): Point[] {
  return snapshot.combatants
    .filter((combatant) => combatant.id !== movingCombatantId && combatant.state === "active")
    .flatMap((combatant) => {
      const definition = getDefinition(snapshot, combatant);
      const footprint = sizeFootprint(definition.size);
      const cells: Point[] = [];
      for (let y = 0; y < footprint; y += 1) {
        for (let x = 0; x < footprint; x += 1) {
          cells.push({ x: combatant.position.x + x, y: combatant.position.y + y });
        }
      }
      return cells;
    });
}

function nearestHostileDistanceFrom(snapshot: EncounterSnapshot, actor: CombatantState, position: Point): number {
  const distances = snapshot.combatants
    .filter((combatant) => combatant.faction !== actor.faction && combatant.state === "active")
    .map((combatant) => gridDistance(position, combatant.position, snapshot.map.grid));
  return Math.min(Number.POSITIVE_INFINITY, ...distances);
}

function isThreatenedAt(snapshot: EncounterSnapshot, actor: CombatantState, position: Point): boolean {
  return snapshot.combatants.some((hostile) => {
    if (hostile.faction === actor.faction || hostile.state !== "active") {
      return false;
    }
    const definition = getDefinition(snapshot, hostile);
    return getExecutableActions(definition).some((action) => {
      if (action.kind !== "attack" || action.attackType !== "melee" || action.automationSupport !== "full") {
        return false;
      }
      const reach = action.reach ?? action.range;
      return gridDistance(hostile.position, position, snapshot.map.grid) <= reach
        && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, hostile.position, position));
    });
  });
}

function threatensWoundedAlly(snapshot: EncounterSnapshot, actor: CombatantState, hostile: CombatantState): boolean {
  return snapshot.combatants.some((ally) => {
    if (ally.faction !== actor.faction || ally.id === actor.id || ally.state !== "active") {
      return false;
    }
    const definition = getDefinition(snapshot, ally);
    const wounded = ally.currentHp <= Math.floor(definition.maxHp / 2);
    // A `protected` ally is guarded at full HP too, not just once it's bloodied.
    const guarded = wounded || Boolean(ally.tags?.includes("protected"));
    return guarded && gridDistance(hostile.position, ally.position, snapshot.map.grid) <= 5;
  });
}

function canPayResource(actor: CombatantState, action: ActionDefinition): boolean {
  if (!("resourceCost" in action) || !action.resourceCost) {
    return true;
  }
  return (actor.resources?.[action.resourceCost.resourceId] ?? 0) >= action.resourceCost.amount;
}

/**
 * Scoring weight for spending an action's resourceCost. A spell slot's real
 * scarcity is its tier, not the flat `amount` (always 1 whether it's a slot-1
 * or a slot-9) — spending a higher slot should look pricier even though every
 * `spellUpcastVariants` tier "costs 1". Non-slot resources (ki points, item
 * charges) keep the flat amount-based weight.
 */
function resourceCostWeight(action: ActionDefinition): number {
  if (!("resourceCost" in action) || !action.resourceCost) {
    return 0;
  }
  return spellSlotLevel(action.resourceCost.resourceId) ?? action.resourceCost.amount;
}

/**
 * For a "spend charge" optional-rider action (see `weaponToActions`), the
 * charge is only actually spent when the rider's own gate fires — an
 * `on-crit` upgrade rarely pays its cost. Scale the resource penalty by that
 * same trigger chance so the AI doesn't undervalue a rare-trigger upgrade the
 * way a flat, certain cost would. Any other resourceCost (a spell slot, an
 * `"always"` rider folded into the base attack) is a certain spend — discount 1.
 */
function optionalRiderCostDiscount(
  action: ActionDefinition,
  source: ReturnType<typeof getDefinition>,
  target: ReturnType<typeof getDefinition>
): number {
  if (!("resourceCost" in action) || !action.resourceCost || !("riders" in action) || !action.riders) {
    return 1;
  }
  const rider = action.riders.find((candidate) => "resourceCost" in candidate && candidate.resourceCost === action.resourceCost);
  if (!rider || rider.kind === "note") {
    return 1;
  }
  const landChance = action.kind === "attack"
    ? chanceToHit(resolveAttackBonus(action, source), target.armorClass)
    : undefined;
  const failChance = (action.kind === "save" || action.kind === "area-save")
    ? chanceToFailSave(resolveSaveDc(action, source), target.saves?.[action.saveAbility] ?? abilityModifier(target.abilities[action.saveAbility]))
    : undefined;
  return riderTriggerChance(rider.when, { landChance, failChance });
}

function actionMatchesPreference(action: OffensiveAction, source: ReturnType<typeof getDefinition>, tactics: TacticsSettings): boolean {
  // control-focused profiles treat a save-or-condition / rider action as on-profile.
  if (tactics.controlWeight >= 15 && actionImposesConditions(action, source)) {
    return true;
  }
  if (action.kind === "attack") {
    return tactics.preferred === "ranged"
      ? action.attackType === "ranged" || action.attackType === "spell"
      : action.attackType === "melee";
  }
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    return action.attacks.some((step) => {
      const child = actions.find((candidate) => candidate.id === step.actionId);
      return child?.kind === "attack" && actionMatchesPreference(child, source, tactics);
    });
  }
  return tactics.preferred === "ranged";
}

/** True when the action (or a multiattack child) carries a `condition` rider. */
function actionImposesConditions(action: OffensiveAction, source: ReturnType<typeof getDefinition>): boolean {
  if (action.kind === "attack" || action.kind === "save" || action.kind === "area-save") {
    return (action.riders ?? []).some((rider) => rider.kind === "condition");
  }
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    return action.attacks.some((step) => {
      const child = actions.find((candidate) => candidate.id === step.actionId);
      return child?.kind === "attack" && (child.riders ?? []).some((rider) => rider.kind === "condition");
    });
  }
  return false;
}

function saveOnSuccessIsHalf(action: Extract<OffensiveAction, { kind: "save" | "area-save" }>): boolean {
  return action.onSuccess ? action.onSuccess === "half" : action.halfDamageOnSuccess;
}

function expectedDamageAgainst(
  action: OffensiveAction,
  source: ReturnType<typeof getDefinition>,
  sourceCombatant: CombatantState,
  target: ReturnType<typeof getDefinition>
): number {
  const casterLevel = source.character?.level ?? 1;
  if (action.kind === "attack") {
    const perHit = averageDamage(action, source) + averageAttackFeatureDamage(action, source, sourceCombatant, target, new Set());
    const beams = action.attackDelivery === "beams" ? resolveBeamCount(action, casterLevel, spellSlotLevel(action.resourceCost?.resourceId)) : 1;
    const hitChance = action.autoHit ? 1 : chanceToHit(resolveAttackBonus(action, source), target.armorClass);
    return perHit * hitChance * beams + expectedRiderDamage(action, source, target, { landChance: hitChance, beams });
  }
  if (action.kind === "save" || action.kind === "area-save") {
    const average = averageDamage(action, source);
    const failChance = chanceToFailSave(resolveSaveDc(action, source), target.saves?.[action.saveAbility] ?? abilityModifier(target.abilities[action.saveAbility]));
    const damageEv = average * (failChance + (saveOnSuccessIsHalf(action) ? (1 - failChance) * 0.5 : 0));
    return damageEv + expectedRiderDamage(action, source, target, { failChance });
  }
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    const oncePerTurnEffects = new Set<string>();
    return action.attacks.reduce((sum, step) => {
      const child = actions.find((candidate) => candidate.id === step.actionId);
      if (child?.kind !== "attack") {
        return sum;
      }
      let childSum = 0;
      for (let index = 0; index < step.count; index += 1) {
        const average = averageDamage(child, source) + averageAttackFeatureDamage(child, source, sourceCombatant, target, oncePerTurnEffects);
        childSum += average * chanceToHit(resolveAttackBonus(child, source), target.armorClass);
      }
      return sum + childSum;
    }, 0);
  }
  return averageDamage(action, source);
}

function chanceToHit(attackBonus: number, armorClass: number): number {
  const needed = armorClass - attackBonus;
  return clamp((21 - needed) / 20, 0.05, 0.95);
}

function chanceToFailSave(dc: number, saveBonus: number): number {
  const successChance = clamp((21 - (dc - saveBonus)) / 20, 0.05, 0.95);
  return 1 - successChance;
}

/** Chance a rider's gate passes, given the parent action's hit / save odds. */
function riderTriggerChance(
  when: Exclude<ActionRider, { kind: "note" }>["when"],
  ctx: { landChance?: number; failChance?: number }
): number {
  switch (when) {
    case "always": return 1;
    case "on-hit": return ctx.landChance ?? 0.6;
    case "on-crit": return (ctx.landChance ?? 0.6) * 0.05;
    case "on-miss": return 1 - (ctx.landChance ?? 0.6);
    case "on-save-fail": return ctx.failChance ?? 0.5;
    case "on-save-success": return 1 - (ctx.failChance ?? 0.5);
    default: return 0;
  }
}

function riderComponentAverage(components: Array<{ dice: string; scaling?: unknown; abilityModifier?: keyof CreatureDefinition["abilities"]; bonusFormula?: Parameters<typeof resolveNumericFormula>[0] }>, source: ReturnType<typeof getDefinition>): number {
  const casterLevel = source.character?.level ?? 1;
  return components.reduce((sum, component) => {
    const parsed = parseDiceExpression(resolveScaledDamage(component.dice, component.scaling as never, { casterLevel }));
    const diceAverage = parsed.terms.reduce((termSum, term) => termSum + term.sign * term.count * ((term.sides + 1) / 2), 0) + parsed.modifier;
    const abilityBonus = component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0;
    return sum + diceAverage + abilityBonus + resolveNumericFormula(component.bonusFormula, source);
  }, 0);
}

/** Expected extra HP damage from an action's `damage` riders. */
function expectedRiderDamage(
  action: OffensiveAction,
  source: ReturnType<typeof getDefinition>,
  _target: ReturnType<typeof getDefinition>,
  ctx: { landChance?: number; failChance?: number; beams?: number }
): number {
  const riders = "riders" in action ? action.riders ?? [] : [];
  let total = 0;
  for (const rider of riders) {
    if (rider.kind !== "damage") {
      continue;
    }
    const average = riderComponentAverage(rider.components, source);
    const triggerChance = riderTriggerChance(rider.when, ctx);
    // an on-hit / on-crit rider fires per beam; a condition-gate rider is once
    const multiplier = (rider.when === "on-hit" || rider.when === "on-crit") ? (ctx.beams ?? 1) : 1;
    total += average * triggerChance * multiplier;
  }
  return total;
}

/** Relative disabling value of a condition, 0..1. */
function conditionSeverity(name: ConditionName): number {
  switch (name) {
    case "paralyzed":
    case "stunned":
    case "unconscious":
      return 1;
    case "incapacitated":
    case "restrained":
      return 0.65;
    case "frightened":
    case "blinded":
    case "prone":
    case "grappled":
      return 0.45;
    case "charmed":
    case "poisoned":
    case "deafened":
      return 0.3;
    default:
      return 0.2;
  }
}

/** Best-guess ability driving a rider's save DC when it has none of its own — mirrors the parent action's own DC-driving ability. */
function riderFallbackAbility(action: OffensiveAction): Ability {
  if (action.kind === "attack") {
    return action.ability;
  }
  if (action.kind === "save" || action.kind === "area-save") {
    return action.saveAbility;
  }
  return "str";
}

function riderSaveDc(rider: Extract<ActionRider, { kind: "condition" }>, source: ReturnType<typeof getDefinition>, fallbackAbility: Ability): number {
  const save = rider.save;
  const fallbackDc = 8 + abilityModifier(source.abilities[fallbackAbility]) + (source.proficiencyBonus ?? 2);
  if (!save) {
    return fallbackDc;
  }
  if (save.dc != null) {
    return save.dc;
  }
  return save.dcFormula ? resolveNumericFormula(save.dcFormula, source) : fallbackDc;
}

/** Expected control value from an action's `condition` riders against one target. */
function expectedRiderControl(
  action: OffensiveAction,
  source: ReturnType<typeof getDefinition>,
  target: ReturnType<typeof getDefinition>,
  tactics: TacticsSettings
): number {
  if (tactics.controlWeight <= 0) {
    return 0;
  }
  const riders = "riders" in action ? action.riders ?? [] : [];
  let total = 0;
  for (const rider of riders) {
    if (rider.kind !== "condition") {
      continue;
    }
    const name: ConditionName = typeof rider.condition === "string" ? rider.condition : "custom";
    const severity = conditionSeverity(name);

    let pApplied: number;
    if (rider.when === "always") {
      pApplied = 1;
    } else if (rider.when === "on-save-fail") {
      pApplied = (action.kind === "save" || action.kind === "area-save")
        ? chanceToFailSave(resolveSaveDc(action, source), target.saves?.[action.saveAbility] ?? abilityModifier(target.abilities[action.saveAbility]))
        : 0.5;
    } else if (rider.when === "on-hit") {
      const hitChance = action.kind === "attack"
        ? (action.autoHit ? 1 : chanceToHit(resolveAttackBonus(action, source), target.armorClass))
        : 1;
      // a rider that negates on its own save only lands when that save fails
      const negateChance = rider.save && rider.save.onSuccess === "negates"
        ? 1 - chanceToFailSave(riderSaveDc(rider, source, riderFallbackAbility(action)), target.saves?.[rider.save.ability] ?? abilityModifier(target.abilities[rider.save.ability]))
        : 0;
      pApplied = hitChance * (1 - negateChance);
    } else {
      pApplied = 0;
    }
    total += tactics.controlWeight * pApplied * severity;
  }
  return total;
}

function averageHealing(action: HealingAction, source: ReturnType<typeof getDefinition>): number {
  const base = action.healing.reduce((sum, component) => {
    const parsed = parseDiceExpression(component.dice);
    const diceAverage = parsed.terms.reduce((termSum, term) => termSum + term.sign * term.count * ((term.sides + 1) / 2), 0) + parsed.modifier;
    const abilityBonus = component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0;
    return sum + diceAverage + abilityBonus;
  }, 0);
  return base + averageUpcastDiceBonus(action);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function averageDamage(action: ActionDefinition, source: ReturnType<typeof getDefinition>): number {
  if (action.kind === "healing" || action.kind === "reposition" || action.kind === "buff" || action.kind === "unsupported" || action.kind === "activate-feature" || action.kind === "utility") {
    return 0;
  }
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    return action.attacks.reduce((sum, step) => {
      const child = actions.find((candidate) => candidate.id === step.actionId);
      return sum + (child ? averageDamage(child, source) * step.count : 0);
    }, 0);
  }
  const base = action.damage.reduce((sum, component) => sum + averageDamageComponent(component, source), 0);
  return base + averageUpcastDiceBonus(action);
}

/** How many extra targets a save action's upcast grants for free at whatever slot tier its own `resourceCost` implies (Hold Person-style). 0 for a base cast or an action with no `upcast.targets`. */
function upcastExtraTargetCapacity(action: Extract<ActionDefinition, { kind: "save" }>): number {
  const perSlotTargets = action.upcast?.perSlotAboveBase?.targets;
  if (!perSlotTargets || action.spellLevel == null) {
    return 0;
  }
  const slotLevel = spellSlotLevel(action.resourceCost?.resourceId);
  const slotsAboveBase = slotLevel != null ? Math.max(0, slotLevel - action.spellLevel) : 0;
  return slotsAboveBase * perSlotTargets;
}

/** Expected value of an action's upcast damage-dice bonus at whatever slot tier its own `resourceCost` implies (0 for a base cast, or an action with no `upcast`). */
function averageUpcastDiceBonus(action: Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" | "healing" }>): number {
  const perSlotDice = action.upcast?.perSlotAboveBase?.damageDice;
  if (!perSlotDice || action.spellLevel == null) {
    return 0;
  }
  const slotLevel = spellSlotLevel(action.resourceCost?.resourceId);
  const slotsAboveBase = slotLevel != null ? Math.max(0, slotLevel - action.spellLevel) : 0;
  if (slotsAboveBase === 0) {
    return 0;
  }
  const parsed = parseDiceExpression(repeatDice(perSlotDice, slotsAboveBase));
  return parsed.terms.reduce((sum, term) => sum + term.sign * term.count * ((term.sides + 1) / 2), 0) + parsed.modifier;
}

function averageAttackFeatureDamage(
  action: Extract<ActionDefinition, { kind: "attack" }>,
  source: ReturnType<typeof getDefinition>,
  sourceCombatant: CombatantState,
  target: ReturnType<typeof getDefinition>,
  usedOncePerTurnEffects: Set<string>
): number {
  let total = 0;
  for (const feature of featureEffectSources(source, sourceCombatant)) {
    for (const [effectIndex, effect] of (feature.effects ?? []).entries()) {
      if ((effect.kind !== "damage-bonus" && effect.kind !== "save-gated-damage")
        || !featureAppliesToExpectedAction(effect, action)
        || !hasOnlyAlwaysExpectedConditions(effect)) {
        continue;
      }
      const effectKey = `${feature.id}:${effectIndex}`;
      if (effect.oncePerTurn && usedOncePerTurnEffects.has(effectKey)) {
        continue;
      }
      if (effect.oncePerTurn) {
        usedOncePerTurnEffects.add(effectKey);
      }
      const damageAverage = effect.damage.reduce((sum, component) => sum + averageDamageComponent(component, source), 0);
      if (effect.kind === "save-gated-damage") {
        const dc = effect.save.dc ?? (effect.save.dcFormula
          ? resolveNumericFormula(effect.save.dcFormula, source)
          : 8 + abilityModifier(source.abilities[effect.save.ability]) + (source.proficiencyBonus ?? 2));
        const saveBonus = target.saves?.[effect.save.ability] ?? abilityModifier(target.abilities[effect.save.ability]);
        const failChance = chanceToFailSave(dc, saveBonus);
        total += damageAverage * (failChance + ((effect.save.halfDamageOnSuccess ?? false) ? (1 - failChance) * 0.5 : 0));
      } else {
        total += damageAverage;
      }
    }
  }
  return total;
}

function featureAppliesToExpectedAction(effect: FeatureEffect, action: Extract<ActionDefinition, { kind: "attack" }>): boolean {
  if ("actionIds" in effect && effect.actionIds && !effect.actionIds.includes(action.id)) {
    return false;
  }
  if ("attackTypes" in effect && effect.attackTypes && !effect.attackTypes.includes(action.attackType)) {
    return false;
  }
  return !("abilities" in effect) || !effect.abilities || effect.abilities.includes(action.ability);
}

function featureEffectSources(source: ReturnType<typeof getDefinition>, combatant: CombatantState): Array<{ id: string; effects?: FeatureEffect[] }> {
  const activeConditionSources = (combatant.conditions ?? [])
    .filter((condition) => condition.effects?.length)
    .map((condition) => ({
      id: condition.sourceId ?? condition.id,
      effects: condition.effects
    }));
  return [...(source.features ?? []), ...(source.traits ?? []), ...activeConditionSources];
}

function hasOnlyAlwaysExpectedConditions(effect: FeatureEffect): boolean {
  const required = [
    ...("condition" in effect && effect.condition ? [effect.condition] : []),
    ...("allConditions" in effect && effect.allConditions ? effect.allConditions : [])
  ];
  const alternatives = "anyConditions" in effect && effect.anyConditions ? effect.anyConditions : [];
  return required.every((condition) => condition === "always") && alternatives.length === 0;
}

function averageDamageComponent(component: Extract<ActionDefinition, { kind: "attack" }>["damage"][number], source: ReturnType<typeof getDefinition>): number {
  const casterLevel = source.character?.level ?? 1;
  const parsed = parseDiceExpression(resolveScaledDamage(component.dice, component.scaling, { casterLevel }));
  const diceAverage = parsed.terms.reduce((termSum, term) => termSum + term.sign * term.count * ((term.sides + 1) / 2), 0) + parsed.modifier;
  const abilityBonus = component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0;
  const formulaBonus = resolveNumericFormula(component.bonusFormula, source);
  return diceAverage + abilityBonus + formulaBonus;
}

function actionRange(action: OffensiveAction, source: ReturnType<typeof getDefinition>): number {
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    const ranges = action.attacks
      .map((step) => actions.find((candidate) => candidate.id === step.actionId))
      .filter((candidate): candidate is Extract<ActionDefinition, { kind: "attack" }> => candidate?.kind === "attack")
      .map((candidate) => candidate.attackType === "melee" ? candidate.reach ?? candidate.range : candidate.longRange ?? candidate.range);
    return Math.max(0, ...ranges);
  }
  return action.kind === "attack" && action.attackType === "melee" ? action.reach ?? action.range : action.kind === "attack" ? action.longRange ?? action.range : action.range;
}
