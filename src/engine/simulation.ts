import {
  activeFactions,
  applyTimedFeatureEffects,
  canAct,
  createEngineState,
  dashFactor,
  event,
  expireConditions,
  getDefinition,
  getExecutableActions,
  moveCombatant,
  opportunityAttackThreats,
  resetActionEconomy,
  resolveAreaSaveAction,
  resolveAreaTargeting,
  resolveAttackBonus,
  resolveBeamCount,
  rollInitiative,
  resolveAttack,
  resolveDeathSave,
  resolveHealingAction,
  resolveActivateFeatureAction,
  resolveMultiattackAction,
  resolveNumericFormula,
  resolveSaveDc,
  resolveSaveAction,
  runRepeatedSaves,
  type EngineState
} from "./combat";
import { combatantsInArea } from "./areas";
import { abilityModifier, parseDiceExpression, resolveScaledDamage } from "./dice";
import { coverBetween, findReachableCells, gridDistance, lineOfEffect, sizeFootprint, wallCover, type ReachableCell } from "./geometry";
import type { ActionDefinition, ActionRider, CombatantState, CombatLogEvent, ConditionName, CreatureDefinition, EncounterSnapshot, FeatureEffect, Point, TacticsProfile } from "./types";

type HealingAction = Extract<ActionDefinition, { kind: "healing" }>;
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
  /** How much a `condition` rider's expected control value is worth. Controllers: high; brutes: near zero. */
  controlWeight: number;
  reposition: boolean;
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

  while (activeFactions(state.snapshot).size > 1 && state.snapshot.round < maxRounds) {
    state.snapshot.round += 1;
    for (let index = 0; index < state.snapshot.combatants.length; index += 1) {
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
      resetActionEconomy(actor);
      expireConditions(state, "start");
      applyTimedFeatureEffects(state, actor.id, "turn-start");
      runRepeatedSaves(state, actor.id, "turn-start");
      state.log.push(event(state, "TurnStarted", `${actor.displayName} started a turn`, { combatantId: actor.id }));
      const warning = takeAutomatedTurn(state, actor);
      if (warning) {
        warnings.push(warning);
      }
      if (activeFactions(state.snapshot).size <= 1) {
        break;
      }
      applyTimedFeatureEffects(state, actor.id, "turn-end");
      runRepeatedSaves(state, actor.id, "turn-end");
      expireConditions(state, "end");
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
  if (healing) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose healing`, {
      combatantId: actor.id,
      actionId: healing.action.id,
      targetId: healing.target.id,
      score: healing.score,
      reasons: healing.reasons
    }));
    resolveHealingAction(state, actor.id, healing.target.id, healing.action.id);
    return undefined;
  }

  let plan = selectOffensivePlan(state.snapshot, actor, tactics);
  if (!plan) {
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

  if (!isValidTarget(state.snapshot, actor, plan.target, plan.range)) {
    const movement = bestDestinationTowardTarget(state.snapshot, actor, plan.target, plan.range, tactics);
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
    } else {
      state.log.push(event(state, "AutomationWarning", `${actor.displayName} found no legal movement toward ${plan.target.displayName}`, {
        combatantId: actor.id,
        targetId: plan.target.id,
        actionId: plan.action.id,
        range: plan.range
      }));
    }
    plan = selectOffensivePlan(state.snapshot, actor, tactics) ?? plan;
  }

  if (!isValidTarget(state.snapshot, actor, plan.target, plan.range)) {
    const warning = `${actor.displayName} could not reach a valid target with ${plan.action.name}`;
    state.log.push(event(state, "AutomationWarning", warning, {
      combatantId: actor.id,
      actionId: plan.action.id,
      targetId: plan.target.id
    }));
    return warning;
  }

  if (plan.target.state !== "active") {
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

  if (plan.action.kind === "attack") {
    const targets = plan.action.attackDelivery === "beams"
      ? beamTargets(state.snapshot, actor, plan.action, plan.target, plan.range)
      : plan.target.id;
    resolveAttack(state, actor.id, targets, plan.action.id);
  } else if (plan.action.kind === "multiattack") {
    resolveMultiattackAction(state, actor.id, plan.target.id, plan.action.id);
  } else if (plan.action.kind === "save") {
    resolveSaveAction(state, actor.id, plan.target.id, plan.action.id);
  } else if (plan.action.kind === "area-save") {
    resolveAreaSaveAction(state, actor.id, plan.target.position, plan.action.id);
  }
  if (!movedThisTurn && actor.state === "active" && tactics.reposition) {
    const reposition = bestRepositionAfterAction(state.snapshot, actor, plan.target, plan.range, tactics);
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
        controlWeight: 6,
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
        controlWeight: 6,
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
        controlWeight: 2,
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
        controlWeight: 14,
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
        controlWeight: 26,
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
        controlWeight: 4,
        reposition: false
      };
  }
}

function selectHealingAction(snapshot: EncounterSnapshot, actor: CombatantState): HealingPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const woundedAllies = snapshot.combatants
    .filter((combatant) => combatant.faction === actor.faction && (combatant.state === "active" || combatant.state === "downed"))
    .filter((combatant) => {
      const allyDefinition = getDefinition(snapshot, combatant);
      return combatant.currentHp < allyDefinition.maxHp;
    });
  const healingActions = getExecutableActions(definition)
    .filter((action): action is HealingAction => action.kind === "healing" && action.automationSupport === "full" && canPayResource(actor, action));
  const candidates = healingActions.flatMap((action) => woundedAllies.map((target) => {
    const targetDefinition = getDefinition(snapshot, target);
    const missingHp = targetDefinition.maxHp - target.currentHp;
    const missingHpRatio = missingHp / Math.max(1, targetDefinition.maxHp);
    const average = averageHealing(action, definition);
    const distance = gridDistance(actor.position, target.position, snapshot.map.grid);
    const reachable = isValidTarget(snapshot, actor, target, action.range);
    const reasons = [
      target.state === "downed" ? "downed ally" : `${Math.round(missingHpRatio * 100)}% HP missing`,
      `${Math.round(average)} expected healing`
    ];
    const resourcePenalty = action.resourceCost ? action.resourceCost.amount * 3 : 0;
    const score = (target.state === "downed" ? 95 : missingHpRatio * 45)
      + Math.min(average, missingHp)
      - resourcePenalty
      - distance / 20
      + (reachable ? 10 : -30);
    return { action, target, score, reasons };
  }));

  candidates.sort((a, b) => b.score - a.score || a.target.currentHp - b.target.currentHp || a.action.id.localeCompare(b.action.id));
  const best = candidates[0];
  if (!best || best.score < 35) {
    return undefined;
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
    const resourcePenalty = resourceCostAmount(action) * 3;
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
  tactics: TacticsSettings
): OffensivePlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const hostiles = snapshot.combatants.filter((combatant) => combatant.faction !== actor.faction && combatant.state === "active");
  const definitionsById = new Map(snapshot.definitions.map((candidate) => [candidate.id, candidate]));
  const candidates = getExecutableActions(definition)
    .filter((action): action is OffensiveAction => action.automationSupport === "full" && action.actionType === "action" && canPayResource(actor, action) && (action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack"))
    .flatMap((action) => hostiles.map((target) => {
      const targetDefinition = getDefinition(snapshot, target);
      const range = actionRange(action, definition);
      const distance = gridDistance(actor.position, target.position, snapshot.map.grid);
      const reachableNow = isValidTarget(snapshot, actor, target, range);
      const canMoveIntoRange = reachableNow || Boolean(bestDestinationTowardTarget(snapshot, actor, target, range, tactics));
      const expectedDamage = expectedDamageAgainst(action, definition, actor, targetDefinition);
      const controlValue = action.kind === "area-save" ? 0 : expectedRiderControl(action, definition, targetDefinition, tactics);
      const preferredBonus = actionMatchesPreference(action, definition, tactics) ? 8 : 0;
      const resourcePenalty = resourceCostAmount(action) * 4;
      const targetHpRatio = clamp(target.currentHp / Math.max(1, targetDefinition.maxHp), 0, 1);
      const killPressure = target.currentHp <= expectedDamage
        ? tactics.killWeight
        : expectedDamage / Math.max(1, target.currentHp) * 6;
      const woundedPressure = (1 - targetHpRatio) * tactics.woundedWeight;
      const protectPressure = tactics.protectWeight > 0 && threatensWoundedAlly(snapshot, actor, target)
        ? tactics.protectWeight
        : 0;
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
      let score = expectedDamage * 2
        + controlValue
        + preferredBonus
        + killPressure
        + woundedPressure
        + protectPressure
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
        const { origin, aimVector } = resolveAreaTargeting(actor, definition, action, target.position);
        const affected = combatantsInArea(snapshot.map, origin, action.area, snapshot.combatants, definitionsById, aimVector);
        const hostiles = affected.filter((combatant) => combatant.faction !== actor.faction);
        const hostileValue = hostiles.reduce((sum, combatant) => {
          const combatantDefinition = getDefinition(snapshot, combatant);
          return sum
            + expectedDamageAgainst(action, definition, actor, combatantDefinition)
            + expectedRiderControl(action, definition, combatantDefinition, tactics);
        }, 0);
        const friendlyRisk = affected
          .filter((combatant) => combatant.faction === actor.faction)
          .reduce((sum, combatant) => sum + expectedDamageAgainst(action, definition, actor, getDefinition(snapshot, combatant)), 0);
        score += hostileValue * (1.2 + tactics.areaWeight) - friendlyRisk * 2.5;
        reasons.push(`${hostiles.length} hostile targets`);
        if (friendlyRisk > 0) reasons.push("friendly fire risk");
      }
      return { action, target, range, score, expectedDamage, distance, reachableNow, canMoveIntoRange, reasons };
    }));

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
  const beams = resolveBeamCount(action, definition.character?.level ?? 1, undefined);
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

function bestDestinationTowardTarget(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings
): MovementPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCellsFor(snapshot, actor.id);
  const movementBudget = definition.speed / snapshot.map.grid.distancePerSquare * dashFactor(actor);
  const candidates = findReachableCells(snapshot.map, actor.position, footprint, movementBudget, occupied, {
    allowOccupiedTransit: true,
    occupiedMovementMultiplier: 2
  })
    .map((reachable) => movementPlanForCell(snapshot, actor, target, range, tactics, reachable))
    .filter((candidate) => candidate.targetDistance <= range
      && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, candidate.cell, target.position)));

  candidates.sort((a, b) => b.score - a.score || a.pathCost - b.pathCost || a.cell.y - b.cell.y || a.cell.x - b.cell.x);
  return candidates[0];
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
  const movementBudget = definition.speed / snapshot.map.grid.distancePerSquare * dashFactor(actor);
  const currentDistance = gridDistance(actor.position, target.position, snapshot.map.grid);
  const currentNearestHostile = nearestHostileDistanceFrom(snapshot, actor, actor.position);
  const currentCover = tactics.coverWeight > 0 && mapHasCoverWalls(snapshot)
    ? coverFromHostilesAt(snapshot, actor, actor.position)
    : 0;
  const currentScore = distanceBandScore(currentDistance, tactics)
    + Math.min(currentNearestHostile, tactics.preferredMinDistance) / 5
    + (currentCover > 0 ? currentCover * tactics.coverWeight + 4 : 0);
  const candidates = findReachableCells(snapshot.map, actor.position, footprint, movementBudget, occupied, {
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
  const score = tactics.preferred === "melee"
    ? -targetDistance * 2 - cost - threats * tactics.reactionRiskWeight * 10
    : distanceBandScore(targetDistance, tactics)
      + Math.min(nearestHostile, tactics.preferredMinDistance) / 4
      - cost * 0.75
      - threats * tactics.reactionRiskWeight * 10
      - (targetDistance > range ? 30 : 0)
      + coverScore;
  return { cell, pathCost: cost, targetDistance, score, opportunityThreats: threats, coverBonus };
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
    return wounded && gridDistance(hostile.position, ally.position, snapshot.map.grid) <= 5;
  });
}

function canPayResource(actor: CombatantState, action: ActionDefinition): boolean {
  if (!("resourceCost" in action) || !action.resourceCost) {
    return true;
  }
  return (actor.resources?.[action.resourceCost.resourceId] ?? 0) >= action.resourceCost.amount;
}

function resourceCostAmount(action: ActionDefinition): number {
  return "resourceCost" in action && action.resourceCost ? action.resourceCost.amount : 0;
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
    const beams = action.attackDelivery === "beams" ? resolveBeamCount(action, casterLevel, undefined) : 1;
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

function riderSaveDc(rider: Extract<ActionRider, { kind: "condition" }>, source: ReturnType<typeof getDefinition>): number {
  const save = rider.save;
  if (!save) {
    return 8 + (source.proficiencyBonus ?? 2);
  }
  if (save.dc != null) {
    return save.dc;
  }
  return save.dcFormula ? resolveNumericFormula(save.dcFormula, source) : 8 + (source.proficiencyBonus ?? 2);
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
        ? 1 - chanceToFailSave(riderSaveDc(rider, source), target.saves?.[rider.save.ability] ?? abilityModifier(target.abilities[rider.save.ability]))
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
  return action.healing.reduce((sum, component) => {
    const parsed = parseDiceExpression(component.dice);
    const diceAverage = parsed.terms.reduce((termSum, term) => termSum + term.sign * term.count * ((term.sides + 1) / 2), 0) + parsed.modifier;
    const abilityBonus = component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0;
    return sum + diceAverage + abilityBonus;
  }, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function averageDamage(action: ActionDefinition, source: ReturnType<typeof getDefinition>): number {
  if (action.kind === "healing" || action.kind === "unsupported" || action.kind === "activate-feature" || action.kind === "utility") {
    return 0;
  }
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    return action.attacks.reduce((sum, step) => {
      const child = actions.find((candidate) => candidate.id === step.actionId);
      return sum + (child ? averageDamage(child, source) * step.count : 0);
    }, 0);
  }
  return action.damage.reduce((sum, component) => sum + averageDamageComponent(component, source), 0);
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
        const dc = effect.save.dc ?? (effect.save.dcFormula ? resolveNumericFormula(effect.save.dcFormula, source) : 8 + (source.proficiencyBonus ?? 2));
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
