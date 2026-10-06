import {
  activeFactions,
  armorClassOf,
  canAct,
  areaSaveChoices,
  damageBonusExpected,
  diceTradeCost,
  onlyWhenEmptyProblem,
  spellTurnProblem,
  whileConditionProblem,
  chosenAreaTargets,
  growthProblem,
  limitedToOneThing,
  onHitTermsProblem,
  damageAdjustmentMultiplier,
  resistanceIgnoredBy,
  damageAdjustmentsFor,
  dividedHealing,
  healingBonusOf,
  healingSlotLevel,
  maximizableHealing,
  effectiveFaction,
  conditionSeverity,
  averageOfDice,
  featureSources,
  findActionDefinition,
  simulatedFeatures,
  targetingProblem,
  isImmuneToCondition,
  riderAffectsCreatureType,
  saveAdvantageApplies,
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
  remainingMovementBudget,
  resolveAttack,
  resolveBuffAction,
  resolveSummonAction,
  isTargetable,
  markConditionId,
  markMoveProblem,
  resolveHealingAction,
  resolveHealingBurstAction,
  resolveActivateFeatureAction,
  resolveMultiattackAction,
  type MultiattackSwingChoice,
  type MultiattackSwingContext,
  resolveNumericFormula,
  resolveRepositionAction,
  resolveSaveDc,
  resolveSaveAction,
  resolveUtilityAction,
  runTurnEnd,
  LEGENDARY_POINTS,
  LEGENDARY_SUFFIX,
  escapeChance,
  isImmuneAfterSave,
  isLegendaryVariant,
  isLairVariant,
  attackPrerequisitesMet,
  hasChargedAt,
  refillLegendaryPoints,
  resolveUse,
  spellSlotLevel,
  isDominatedUpcast,
  chosenTargetCount,
  upcastBaseId,
  castLevelOf,
  INCAPACITATING_CONDITIONS,
  setCounterAdvisor,
  threatByLevel,
  type CounterAdvice,
  type CounterAssessment,
  type DeclaredCast,
  type EngineState
} from "./combat";
import { askDecision, type SpellThreat, type SpellThreatLine, type TurnOptionRequest, type TurnPick } from "./decisions";
import { attackFamilyId, attackReach, canPayFor, defaultSwingAttack, stepAbility, swingCandidates, swingsOf, type MultiattackSwing } from "./multiattack";
import { FULL_SUFFIX, withArticle } from "./items";
import { cellIntersectsArea, cellsInArea, combatantsInArea, hazardPathingOverlay, zoneTerrainOverlay, type AimVector } from "./areas";
import { abilityModifier, parseDiceExpression, repeatDice, resolveScaledDamage } from "./dice";
import { altitudeMoveCost, combatantHeight, spatialDistance, spatialDistanceToPoint } from "./combat";
import { footprintGroundHeight, movementProfileOf, movementReference, coverBetween, findPath, movementOptionsFor, findReachableCells, gridDistance, isFootprintLegal, lineOfEffect, pathCostField, sizeFootprint, terrainAtCell, wallCover, type ReachableCell } from "./geometry";
import type { Ability, ActionDefinition, ActionRider, ActorTag, AreaSaveActionDefinition, CombatantState, CombatLogEvent, ConditionName, CreatureDefinition, EncounterSnapshot, FeatureEffect, Id, LegendaryActionRef, Point, ResourceStance, SummonActionDefinition, TacticsProfile, WeaponMastery } from "./types";

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
/** A mark (Hunter's Mark, Hex) cast on, or moved to, a foe with the bonus action. Always in range now. */
interface MarkPlan {
  action: BuffAction;
  target: CombatantState;
  score: number;
  reasons: string[];
}

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
  /** Altitude to hold over `cell` (fliers only), and the movement it costs on top of `pathCost`. */
  altitude?: number;
  altitudeCost?: number;
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

interface SummonPlan {
  action: SummonActionDefinition;
  /** Which option to summon — only meaningful for `choice: "pick"`; `"random"` actions ignore it. */
  optionId?: Id;
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

/**
 * The rules that close a creature's turn: the shared turn-end rules, then the legendary-action window —
 * legendary creatures other than the one who just acted get to act. Called only by `closeTurn` (turns.ts).
 */
export function finishTurn(state: EngineState, actorId: Id): void {
  runTurnEnd(state, actorId);
  runLegendaryWindow(state, actorId);
}

/**
 * At the end of another creature's turn each legendary creature may spend legendary points on ONE of its
 * legendary actions. Points that aren't spent are lost when the creature's own turn comes round, so it takes
 * the best affordable option that reaches a target — the cost only breaks ties.
 */
export function runLegendaryWindow(state: EngineState, endedActorId: Id): void {
  for (const combatant of state.snapshot.combatants) {
    if (combatant.id === endedActorId || combatant.state !== "active") continue;
    const definition = getDefinition(state.snapshot, combatant);
    if (!definition.legendary || !canAct(combatant, "free")) continue;
    if (combatant.resources?.[LEGENDARY_POINTS] === undefined) refillLegendaryPoints(state, combatant);
    const points = combatant.resources?.[LEGENDARY_POINTS] ?? 0;
    if (points < 1) continue;
    const legendary = getExecutableActions(definition).filter(isLegendaryVariant);
    const options = legendary.filter((action): action is OffensiveAction =>
      action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack");
    const plan = options.length > 0
      ? selectOffensivePlan(state.snapshot, combatant, tacticsSettings(combatant.tacticsProfile), "action", { actions: options, mustReachNow: true })
      : undefined;
    const aiPlan = plan && !(plan.expectedDamage <= 0 && plan.score <= 0) ? plan : undefined;

    // A player who plays this creature picks any legendary action it can afford — those the engine can't run by
    // hand — or passes (Play).
    if (state.decide) {
      const affordable = legendary.filter((action) => canPayFor(combatant, action as { resourceCost?: { resourceId: string; amount: number } }));
      const byHand = legendaryByHand(definition, legendary).filter(({ ref }) => ref.cost <= points);
      const answer = affordable.length + byHand.length > 0
        ? askDecision<TurnOptionRequest>(state, {
          kind: "legendary-action", combatantId: combatant.id, afterId: endedActorId, pointsLeft: points,
          options: [
            ...affordable.map((action) => ({ actionId: action.id, name: action.name, cost: turnOptionCost(action) })),
            ...byHand.map(({ id, ref }) => ({ actionId: id, name: ref.name, cost: ref.cost, byHand: true }))
          ],
          aiChoice: aiPlan ? planPick(aiPlan) : null
        }, combatant.id)
        : undefined;
      if (answer) {
        if (answer.pick) takeChosenTurnAction(state, combatant, answer.pick, endedActorId);
        if (activeFactions(state.snapshot).size <= 1) return;
        continue;
      }
    }

    if (!aiPlan) continue;
    const cost = "resourceCost" in aiPlan.action ? aiPlan.action.resourceCost?.amount ?? 1 : 1;
    state.log.push(event(state, "LegendaryActionUsed", `${combatant.displayName} uses ${aiPlan.action.name} (legendary, ${cost} point${cost === 1 ? "" : "s"})`, {
      combatantId: combatant.id, actionId: aiPlan.action.id, cost, after: endedActorId
    }));
    try {
      executeOffensivePlan(state, combatant, aiPlan);
    } catch (error) {
      state.log.push(event(state, "AutomationWarning", `${combatant.displayName}: legendary action failed — ${error instanceof Error ? error.message : String(error)}`, { combatantId: combatant.id }));
    }
    if (activeFactions(state.snapshot).size <= 1) return;
  }
}

/** A by-hand legendary action's option id: its place among the creature's legendary actions. */
export const LEGENDARY_BY_HAND = "legendary-by-hand:";
/** A by-hand lair action's option id: the lair action's own id after it. */
export const LAIR_BY_HAND = "lair-by-hand:";

/** A creature's legendary actions the engine can't run (Detect, a description only): a person can take them by hand. */
function legendaryByHand(definition: CreatureDefinition, compiled: ActionDefinition[]): Array<{ id: string; ref: LegendaryActionRef }> {
  const ids = new Set(compiled.map((action) => action.id));
  return (definition.legendary?.actions ?? []).flatMap((ref, index) => {
    const baseId = ref.action?.id ?? ref.actionId;
    return baseId && ids.has(`${baseId}${LEGENDARY_SUFFIX}`) ? [] : [{ id: `${LEGENDARY_BY_HAND}${index}`, ref }];
  });
}

/** A legendary or lair action taken by hand: its cost spent and logged, for the DM to apply. */
function takeTurnActionByHand(state: EngineState, creature: CombatantState, pick: TurnPick, afterId?: Id): boolean {
  const definition = getDefinition(state.snapshot, creature);
  if (pick.actionId.startsWith(LEGENDARY_BY_HAND)) {
    const ref = definition.legendary?.actions[Number(pick.actionId.slice(LEGENDARY_BY_HAND.length))];
    const points = creature.resources?.[LEGENDARY_POINTS] ?? 0;
    if (!ref || points < ref.cost) return true;
    creature.resources = { ...(creature.resources ?? {}), [LEGENDARY_POINTS]: points - ref.cost };
    state.log.push(event(state, "LegendaryActionUsed", `${creature.displayName} uses ${ref.name} (legendary, ${ref.cost} point${ref.cost === 1 ? "" : "s"})`, {
      combatantId: creature.id, actionId: pick.actionId, cost: ref.cost, after: afterId
    }));
    state.log.push(event(state, "ManualActionUsed", `${creature.displayName} uses ${ref.name}: resolve it by hand`, {
      actorId: creature.id, actionId: pick.actionId, actionName: ref.name, targetIds: pick.targetIds ?? [], description: ref.description
    }));
    return true;
  }
  if (pick.actionId.startsWith(LAIR_BY_HAND)) {
    const action = (definition.lairActions ?? []).find((candidate) => candidate.id === pick.actionId.slice(LAIR_BY_HAND.length));
    if (!action) return true;
    creature.lastLairActionId = pick.actionId;
    state.log.push(event(state, "LairAction", `Lair action (initiative ${LAIR_INITIATIVE}): ${creature.displayName} uses ${action.name}`, {
      combatantId: creature.id, actionId: pick.actionId
    }));
    state.log.push(event(state, "ManualActionUsed", `${creature.displayName}'s lair: ${action.name}, resolve it by hand`, {
      actorId: creature.id, actionId: pick.actionId, actionName: action.name, targetIds: pick.targetIds ?? [],
      description: "description" in action ? action.description : undefined
    }));
    return true;
  }
  return false;
}

/** What a legendary or lair action costs from its pool: legendary points, or 1 for a lair action. */
function turnOptionCost(action: ActionDefinition): number {
  return "resourceCost" in action && action.resourceCost?.resourceId === LEGENDARY_POINTS ? action.resourceCost.amount : 1;
}

/** An AI plan, as the pick a player would have made. */
function planPick(plan: OffensivePlan): TurnPick {
  return plan.action.kind === "area-save"
    ? { actionId: plan.action.id, aim: plan.target.position }
    : { actionId: plan.action.id, targetIds: [plan.target.id] };
}

/** A legendary action (after `afterId`'s turn) or a lair action a player picked: logged as the AI's are, then used as aimed. */
function takeChosenTurnAction(state: EngineState, creature: CombatantState, pick: TurnPick, afterId?: Id): void {
  if (takeTurnActionByHand(state, creature, pick, afterId)) return;
  const action = findActionDefinition(getDefinition(state.snapshot, creature), pick.actionId);
  if (!action) return;
  if (afterId !== undefined) {
    const cost = turnOptionCost(action);
    state.log.push(event(state, "LegendaryActionUsed", `${creature.displayName} uses ${action.name} (legendary, ${cost} point${cost === 1 ? "" : "s"})`, {
      combatantId: creature.id, actionId: action.id, cost, after: afterId
    }));
  } else {
    state.log.push(event(state, "LairAction", `Lair action (initiative ${LAIR_INITIATIVE}): ${creature.displayName} uses ${action.name}`, {
      combatantId: creature.id, actionId: action.id, targetId: pick.targetIds?.[0]
    }));
  }
  try {
    resolveUse(state, creature.id, pick.actionId, pick);
  } catch (error) {
    state.log.push(event(state, "AutomationWarning", `${creature.displayName}: ${action.name} failed — ${error instanceof Error ? error.message : String(error)}`, { combatantId: creature.id }));
  }
}

/** Lair actions happen on initiative count 20, losing ties. */
export const LAIR_INITIATIVE = 20;

/**
 * Each creature fighting in its lair (`inLair`, with `lairActions`) takes one lair action on initiative 20. The turn
 * sequencer (`openNextTurn`) calls this just before each turn begins. It fires before the first creature whose initiative is below 20 (so
 * a creature that rolled exactly 20 still goes first); if nobody is below 20 it fires before the round's first turn.
 * The AI picks the best one that reaches a target, never the one it used last round.
 */
export function runLairWindow(state: EngineState, nextActor: CombatantState): void {
  const round = state.snapshot.round;
  if (round <= 0 || (state.snapshot.lairRound ?? 0) >= round) return;
  const lairCreatures = state.snapshot.combatants.filter((combatant) => combatant.inLair && (getDefinition(state.snapshot, combatant).lairActions?.length ?? 0) > 0);
  if (lairCreatures.length === 0) return;
  const anyBelow = state.snapshot.combatants.some((combatant) => combatant.state !== "reserve" && (combatant.initiative ?? 0) < LAIR_INITIATIVE);
  if (anyBelow && (nextActor.initiative ?? 0) >= LAIR_INITIATIVE) return;
  state.snapshot.lairRound = round;

  for (const creature of lairCreatures) {
    // A lair acts through its master: an incapacitated (or dead) creature takes no lair action.
    if (creature.state !== "active" || !canAct(creature, "free")) continue;
    const definition = getDefinition(state.snapshot, creature);
    const fresh = getExecutableActions(definition).filter((action) => isLairVariant(action) && action.id !== creature.lastLairActionId);
    const options = fresh.filter((action): action is OffensiveAction =>
      action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack");
    const plan = options.length > 0
      ? selectOffensivePlan(state.snapshot, creature, tacticsSettings(creature.tacticsProfile), "action", { actions: options, mustReachNow: true })
      : undefined;

    // A player who plays the lair's master picks one (never last round's) — those the engine can't run by hand — or
    // lets it pass (Play).
    const freshByHand = (definition.lairActions ?? []).filter((action) => action.kind === "unsupported" && `${LAIR_BY_HAND}${action.id}` !== creature.lastLairActionId);
    if (state.decide && fresh.length + freshByHand.length > 0) {
      const aiPlan = plan && !(plan.expectedDamage <= 0 && plan.score <= 0) ? plan : undefined;
      const answer = askDecision<TurnOptionRequest>(state, {
        kind: "lair-action", combatantId: creature.id,
        options: [
          ...fresh.map((action) => ({ actionId: action.id, name: action.name, cost: 1 })),
          ...freshByHand.map((action) => ({ actionId: `${LAIR_BY_HAND}${action.id}`, name: action.name, cost: 1, byHand: true }))
        ],
        aiChoice: aiPlan ? planPick(aiPlan) : null
      }, creature.id);
      if (answer) {
        if (answer.pick) {
          creature.lastLairActionId = answer.pick.actionId;
          takeChosenTurnAction(state, creature, answer.pick);
        } else {
          state.log.push(event(state, "LairAction", `${creature.displayName}'s lair is quiet this round (initiative ${LAIR_INITIATIVE})`, {
            combatantId: creature.id, actionId: null
          }));
          creature.lastLairActionId = undefined;
        }
        if (activeFactions(state.snapshot).size <= 1) return;
        continue;
      }
    }

    if (!plan || (plan.expectedDamage <= 0 && plan.score <= 0)) {
      state.log.push(event(state, "LairAction", `${creature.displayName}'s lair stirs, but nothing is in reach (initiative ${LAIR_INITIATIVE})`, {
        combatantId: creature.id, actionId: null
      }));
      creature.lastLairActionId = undefined;
      continue;
    }
    state.log.push(event(state, "LairAction", `Lair action (initiative ${LAIR_INITIATIVE}): ${creature.displayName} uses ${plan.action.name}`, {
      combatantId: creature.id, actionId: plan.action.id, targetId: plan.target.id
    }));
    creature.lastLairActionId = plan.action.id;
    try {
      executeOffensivePlan(state, creature, plan);
    } catch (error) {
      state.log.push(event(state, "AutomationWarning", `${creature.displayName}: lair action failed — ${error instanceof Error ? error.message : String(error)}`, { combatantId: creature.id }));
    }
    if (activeFactions(state.snapshot).size <= 1) return;
  }
}

/**
 * Rampage: having dropped a creature this turn, the attacker spends its bonus action to move (up to half its speed,
 * granted as extra movement) and bite the nearest foe it can reach.
 */
function tryFollowUpAfterKill(state: EngineState, actor: CombatantState, tactics: TacticsSettings): boolean {
  if (!actor.turnFlags?.droppedCreature || !canAct(actor, "bonus")) return false;
  const definition = getDefinition(state.snapshot, actor);
  const followUps = getExecutableActions(definition).filter((action): action is OffensiveAction =>
    action.kind === "attack" && action.actionType === "bonus" && action.onlyAfter === "dropped-creature");
  if (followUps.length === 0) return false;
  const plan = selectOffensivePlan(state.snapshot, actor, tactics, "bonus", { actions: followUps, relaxReachability: true });
  if (!plan) return false;
  if (!isValidTarget(state.snapshot, actor, plan.target, plan.range)) {
    const move = bestDestinationTowardTarget(state.snapshot, actor, plan.target, plan.range, tactics);
    if (!move) return false;
    try {
      moveCombatant(state, actor.id, move.cell, { altitude: move.altitude });
    } catch {
      return false;
    }
  }
  if (actor.state !== "active" || !isValidTarget(state.snapshot, actor, plan.target, plan.range)) return false;
  state.log.push(event(state, "AiDecision", `${actor.displayName} rampages on to ${plan.target.displayName} with ${plan.action.name}`, {
    combatantId: actor.id, actionId: plan.action.id, targetId: plan.target.id, slot: "bonus", reason: "after-kill"
  }));
  try {
    executeOffensivePlan(state, actor, plan);
  } catch { /* map state moved on */ }
  return true;
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
    const swings = planMultiattackSwings(state.snapshot, actor, action, plan.target);
    resolveMultiattackAction(state, actor.id, swings.targetIds, action.id, {
      attackTargetIds: swings.attackTargetIds,
      attackActionIds: swings.attackActionIds,
      beforeSwing: (context) => decideMultiattackSwing(state, actor, context, swings)
    });
  } else if (action.kind === "save") {
    const bonusTargetIds = saveBonusTargetIds(state.snapshot, actor, action, plan.target, plan.range);
    resolveSaveAction(state, actor.id, plan.target.id, action.id, { bonusTargetIds });
  } else if (action.kind === "area-save") {
    resolveAreaSaveAction(state, actor.id, plan.target.position, action.id);
  }
}

type MultiattackAction = Extract<ActionDefinition, { kind: "multiattack" }>;
type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;

/**
 * How the AI plans a routine. One of "any weapon attack" swings, from a creature with both melee and ranged attacks,
 * is planned two ways: close in and swing, or shoot from where it is. Each is a copy whose generic swings are melee
 * or ranged only, under the routine's own id: when the swings are made, each picks from all of its attacks.
 */
function multiattackPlanningForms(action: MultiattackAction, executables: ActionDefinition[]): MultiattackAction[] {
  if (!action.attacks.some((step) => step.any === "weapon")) return [action];
  const forms = (["melee", "ranged"] as const)
    .map((any): MultiattackAction => ({ ...action, attacks: action.attacks.map((step) => (step.any === "weapon" ? { ...step, any } : step)) }))
    .filter((form) => form.attacks.every((step) => !step.any || swingCandidates(step, executables).length > 0));
  return forms.length ? forms : [action];
}

/**
 * The best attack for one swing against one target: the most expected damage for what it spends. A power attack
 * pays against a low AC and not a high one; a charge only when the stance and the payoff say so. With the board
 * (`weigh`), a dice trade (Cunning Strike) is weighed as `diceTradeValue` does, in damage terms; without, it's no
 * better than the plain swing.
 */
function bestSwingAttack(
  candidates: AttackAction[],
  source: CreatureDefinition,
  sourceCombatant: CombatantState,
  target: CreatureDefinition,
  targetCombatant: CombatantState | undefined,
  usedOncePerTurnEffects: Set<string>,
  weigh?: { snapshot: EncounterSnapshot; tactics: TacticsSettings; log?: CombatLogEvent[] }
): { attack: AttackAction; value: number; damage: number; hitChance: number } | undefined {
  const adjustments = targetCombatant ? damageAdjustmentsFor(target, targetCombatant) : target.damageAdjustments;
  // Brutal Strike: only with the board to say it can be used now; the weapon's plain swing then has the advantage it
  // gives up.
  const usable = candidates.filter((attack) => !attack.onHitTerms?.forgoesAdvantage
    || (weigh !== undefined && !onHitTermsProblem(weigh.snapshot, sourceCombatant, attack, weigh.log)));
  const advantaged = new Set(usable.filter((attack) => attack.onHitTerms?.forgoesAdvantage).map((attack) => attackFamilyId(attack, candidates)));
  let best: { attack: AttackAction; value: number; damage: number; hitChance: number } | undefined;
  for (const attack of usable) {
    const plainChance = attack.autoHit ? 1 : chanceToHit(resolveAttackBonus(attack, source), armorClassOf(target).total);
    const hitChance = !attack.onHitTerms?.forgoesAdvantage && advantaged.has(attackFamilyId(attack, candidates))
      ? 1 - (1 - plainChance) ** 2
      : plainChance;
    const damage = (averageDamage(attack, source, adjustments) + averageAttackFeatureDamage(attack, source, sourceCombatant, target, new Set(usedOncePerTurnEffects))
      + averageMarkDamage(source, sourceCombatant, targetCombatant, adjustments)) * hitChance
      + expectedRiderDamage(attack, source, target, { landChance: hitChance });
    // In damage terms, half the plan-level penalty a single attack that spends the same would carry.
    const cost = resourceCostWeight(attack) * 2 * resourceStanceMultiplier(sourceCombatant.resourceStance) * optionalRiderCostDiscount(attack, source, target);
    const terms = attack.onHitTerms;
    const trade = weigh && targetCombatant && terms?.tradesDice
      ? (expectedRiderControl({ ...attack, riders: (attack.riders ?? []).filter((rider) => rider.group === terms.group) }, source, target, weigh.tactics)
        + diceTradeValue(weigh.snapshot, sourceCombatant, source, attack, targetCombatant, target, weigh.tactics, weigh.log)) / 2
      : 0;
    // An on-hit option's condition (Open Hand Technique's Topple, Ensnaring Strike): its control, with the board.
    const grouped = (attack.riders ?? []).filter((rider) => rider.group);
    const control = weigh && grouped.length && !terms?.tradesDice ? expectedRiderControl({ ...attack, riders: grouped }, source, target, weigh.tactics) / 2 : 0;
    // Stunning Strike: a paid upgrade that takes the target's turn is worth that turn.
    const denial = turnDenialValue(attack, source, target, targetCombatant);
    // Tactical Master: what the mastery used instead adds over the weapon's own.
    const swap = attack.swappedMastery
      ? (masteryWorth(attack.swappedMastery.to, attack, source, target, hitChance) - masteryWorth(attack.swappedMastery.from, attack, source, target, hitChance))
      : 0;
    const value = damage - cost + trade + control + denial + swap;
    if (!best || value > best.value + 1e-9) best = { attack, value, damage, hitChance };
  }
  return best;
}

/** The weapons (attack families) a "one weapon" routine could be held to, best first against `target`. */
function routineFamilies(action: MultiattackAction, executables: ActionDefinition[]): Array<string | undefined> {
  if (!action.oneWeapon) return [undefined];
  const families = new Set(action.attacks.flatMap((step) => swingCandidates(step, executables).map((attack) => attackFamilyId(attack, executables))));
  return families.size ? [...families] : [undefined];
}

/** A routine's expected damage against one target with one weapon family (or any), each swing with its best attack. */
function familyExpectedDamage(
  action: MultiattackAction,
  family: string | undefined,
  source: CreatureDefinition,
  sourceCombatant: CombatantState,
  target: CreatureDefinition,
  targetCombatant: CombatantState | undefined
): number {
  const executables = getExecutableActions(source);
  const used = new Set<string>();
  let total = 0;
  let previousHit = 1;
  for (const swing of swingsOf(action.attacks)) {
    // A breath in place of a bite (a chimera's option) counts for what it would deal this target.
    const ability = stepAbility(swing.step, executables);
    if (ability) {
      if (canPayFor(sourceCombatant, ability)) total += expectedDamageAgainst(ability, source, sourceCombatant, target, targetCombatant);
      continue;
    }
    const candidates = swingCandidates(swing.step, executables)
      .filter((attack) => canPayFor(sourceCombatant, attack) && (!family || attackFamilyId(attack, executables) === family));
    const best = bestSwingAttack(candidates, source, sourceCombatant, target, targetCombatant, used);
    if (!best) continue;
    averageAttackFeatureDamage(best.attack, source, sourceCombatant, target, used);
    total += best.value * (swing.step.requiresPreviousHit ? previousHit : 1);
    previousHit = best.hitChance;
  }
  return total;
}

/** The weapon a "one weapon" routine does best with against `target` (undefined: each swing picks freely). */
function bestRoutineFamily(
  action: MultiattackAction,
  source: CreatureDefinition,
  sourceCombatant: CombatantState,
  target: CreatureDefinition,
  targetCombatant: CombatantState | undefined
): string | undefined {
  const families = routineFamilies(action, getExecutableActions(source));
  let best: { family: string | undefined; value: number } | undefined;
  for (const family of families) {
    const value = familyExpectedDamage(action, family, source, sourceCombatant, target, targetCombatant);
    if (!best || value > best.value + 1e-9) best = { family, value };
  }
  return best?.family;
}

/** A routine's expected damage against one target, each swing with its best attack (held to one weapon if it must be). */
function multiattackExpectedDamage(
  action: MultiattackAction,
  source: CreatureDefinition,
  sourceCombatant: CombatantState,
  target: CreatureDefinition,
  targetCombatant: CombatantState | undefined
): number {
  const family = bestRoutineFamily(action, source, sourceCombatant, target, targetCombatant);
  return Math.max(0, familyExpectedDamage(action, family, source, sourceCombatant, target, targetCombatant));
}

/**
 * Who each swing of a routine attacks, and with what. Swings fill the primary target to (estimated) death, then spill
 * onto the next-lowest-HP hostile, each only onto someone its own attacks reach from here. The most constrained swing
 * picks first (the claws, before a bite that reaches 10 ft), and the step's rule holds: a "different" swing never joins
 * another's target, a "same as previous" one follows the swing before it. Returns the ordered `targetIds` (for
 * spill-on-death) and per-swing target and attack ids (sparse: a save step, or a swing with nobody in reach, has none).
 */
function planMultiattackSwings(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  action: MultiattackAction,
  primary: CombatantState
): { targetIds: string[]; attackTargetIds: string[]; attackActionIds: string[] } {
  const definition = getDefinition(snapshot, actor);
  const executables = getExecutableActions(definition);
  // The routine as the engine runs it: a planning copy restricts its "any weapon" swings, the real one doesn't.
  const found = findActionDefinition(definition, action.id);
  const routine = found?.kind === "multiattack" ? found : action;
  const others = snapshot.combatants
    .filter((c) => effectiveFaction(snapshot, c) !== effectiveFaction(snapshot, actor) && isTargetable(c) && c.id !== primary.id)
    .sort((a, b) => a.currentHp - b.currentHp || a.id.localeCompare(b.id));
  const pool = [primary, ...others];
  const targetIds = pool.map((c) => c.id);
  const swings = swingsOf(routine.attacks).filter((swing) => !stepAbility(swing.step, executables));
  const family = bestRoutineFamily(routine, definition, actor, getDefinition(snapshot, primary), primary);
  const budget: Record<string, number> = { ...(actor.resources ?? {}) };
  const affordable = (attack: AttackAction) => !attack.resourceCost || (budget[attack.resourceCost.resourceId] ?? 0) >= attack.resourceCost.amount;
  // A dice trade spends a once-a-turn bonus (Sneak Attack): one swing plans it.
  const tradedFrom = new Set<string>();
  const candidatesFor = (swing: MultiattackSwing) => swingCandidates(swing.step, executables)
    .filter((attack) => affordable(attack) && (!family || attackFamilyId(attack, executables) === family)
      && !(attack.onHitTerms?.tradesDice && tradedFrom.has(attack.onHitTerms.tradesDice.featureId))
      && !(attack.onHitTerms?.onceKey && tradedFrom.has(attack.onHitTerms.onceKey)));
  const reachOf = (swing: MultiattackSwing) => Math.max(0, ...candidatesFor(swing).map(attackReach));
  const assigned: Record<string, number> = {};
  const attackTargetIds: string[] = [];
  const attackActionIds: string[] = [];
  const weigh = { snapshot, tactics: tacticsSettings(actor.tacticsProfile), log: undefined as CombatLogEvent[] | undefined };
  const choose = (swing: MultiattackSwing, target: CombatantState) => {
    const usable = candidatesFor(swing).filter((attack) => !targetingProblem(snapshot, actor, target, attack));
    return bestSwingAttack(usable, definition, actor, getDefinition(snapshot, target), target, new Set(), weigh);
  };
  const commit = (swing: MultiattackSwing, target: CombatantState, best: { attack: AttackAction; damage: number }) => {
    attackTargetIds[swing.index] = target.id;
    attackActionIds[swing.index] = best.attack.id;
    assigned[target.id] = (assigned[target.id] ?? 0) + Math.max(1, best.damage);
    const cost = best.attack.resourceCost;
    if (cost) budget[cost.resourceId] = (budget[cost.resourceId] ?? 0) - cost.amount;
    if (best.attack.onHitTerms?.tradesDice) tradedFrom.add(best.attack.onHitTerms.tradesDice.featureId);
    if (best.attack.onHitTerms?.onceKey) tradedFrom.add(best.attack.onHitTerms.onceKey);
  };

  const order = [...swings].sort((a, b) => reachOf(a) - reachOf(b) || a.index - b.index);
  for (const swing of order) {
    if (swing.step.target === "same-as-previous") continue;
    const taken = swing.step.target === "different"
      ? new Set(attackTargetIds.filter((id, index) => id && index !== swing.index))
      : new Set<string>();
    let pick: { target: CombatantState; best: { attack: AttackAction; damage: number } } | undefined;
    for (const target of pool) {
      if (taken.has(target.id)) continue;
      const best = choose(swing, target);
      if (!best) continue;
      if ((assigned[target.id] ?? 0) < target.currentHp) {
        pick = { target, best };
        break;
      }
      // Everyone in reach already has enough coming: the first of them, if nobody better turns up.
      pick ??= { target, best };
    }
    if (pick) commit(swing, pick.target, pick.best);
  }
  // A swing that follows the one before goes where it went.
  for (const swing of swings) {
    if (swing.step.target !== "same-as-previous") continue;
    const before = swings.filter((candidate) => candidate.index < swing.index).at(-1);
    const target = before ? pool.find((c) => c.id === attackTargetIds[before.index]) : undefined;
    const best = target ? choose(swing, target) : undefined;
    if (target && best) commit(swing, target, best);
  }
  return { targetIds, attackTargetIds, attackActionIds };
}

/**
 * One swing of a routine, decided when it's made (D10), after the swing before it landed. The planned target if it's
 * still up and in reach; else whoever in reach is worth it most (one it can drop first); else, with nobody in reach,
 * a move toward the nearest hostile it can reach with the movement it has left (opportunity attacks apply, so it
 * won't walk away from a threat while badly hurt), then the swing.
 */
function decideMultiattackSwing(
  state: EngineState,
  actor: CombatantState,
  context: MultiattackSwingContext,
  planned: { attackTargetIds: string[]; attackActionIds: string[] }
): MultiattackSwingChoice | undefined {
  const { snapshot } = state;
  const { step } = context.swing;
  // "Against the same target": the resolver keeps it on the previous swing's target.
  if (step.target === "same-as-previous") return undefined;
  const definition = getDefinition(snapshot, actor);
  const taken = step.target === "different" ? new Set(context.targetedIds) : new Set<string>();
  const live = (combatant: CombatantState | undefined): combatant is CombatantState => Boolean(combatant)
    && (combatant!.state === "active" || combatant!.state === "downed") && isTargetable(combatant!) && !taken.has(combatant!.id);
  const bestAgainst = (target: CombatantState) => bestSwingAttack(
    context.candidates.filter((attack) => !targetingProblem(snapshot, actor, target, attack)),
    definition, actor, getDefinition(snapshot, target), target, new Set(), { snapshot, tactics: tacticsSettings(actor.tacticsProfile), log: state.log }
  );

  const plannedTarget = snapshot.combatants.find((combatant) => combatant.id === planned.attackTargetIds[context.swing.index]);
  if (live(plannedTarget) && plannedTarget.state === "active") {
    const best = bestAgainst(plannedTarget);
    if (best) {
      const wanted = context.candidates.find((attack) => attack.id === planned.attackActionIds[context.swing.index]);
      // A dice trade (or a Brutal Strike) goes on the first swing that can pay for it, whichever the plan gave it to:
      // the same weapon, with it or not, as the swing stands now (Sneak Attack still to come, or already dealt).
      const retraded = wanted && (wanted.onHitTerms || best.attack.onHitTerms)
        && attackFamilyId(wanted, context.candidates) === attackFamilyId(best.attack, context.candidates);
      if (retraded) return { targetId: plannedTarget.id, actionId: best.attack.id };
      // The planned attack, unless that weapon can't reach from here any more.
      return { targetId: plannedTarget.id, actionId: wanted && !targetingProblem(snapshot, actor, plannedTarget, wanted) ? wanted.id : best.attack.id };
    }
  }

  const hostiles = snapshot.combatants.filter((combatant) => effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor)
    && combatant.state === "active" && live(combatant));
  const inReach = hostiles
    .map((target) => ({ target, best: bestAgainst(target) }))
    .filter((entry): entry is { target: CombatantState; best: NonNullable<ReturnType<typeof bestAgainst>> } => Boolean(entry.best))
    .sort((a, b) => Number(b.target.currentHp <= b.best.damage) - Number(a.target.currentHp <= a.best.damage)
      || b.best.value - a.best.value || a.target.currentHp - b.target.currentHp || a.target.id.localeCompare(b.target.id));
  if (inReach[0]) return { targetId: inReach[0].target.id, actionId: inReach[0].best.attack.id };

  // Nobody in reach: walk on to the next foe, if the move is worth its risk.
  const reach = Math.max(0, ...context.candidates.map(attackReach));
  const hurt = actor.currentHp <= definition.maxHp / 2;
  const tactics = tacticsSettings(actor.tacticsProfile);
  const nearest = [...hostiles].sort((a, b) => spatialDistance(snapshot, actor, a) - spatialDistance(snapshot, actor, b) || a.id.localeCompare(b.id));
  for (const target of nearest) {
    const move = bestDestinationTowardTarget(snapshot, actor, target, reach, tactics);
    if (!move || (hurt && move.opportunityThreats > 0)) continue;
    try {
      const previousDistance = spatialDistance(snapshot, actor, target);
      moveCombatant(state, actor.id, move.cell, { altitude: move.altitude });
      state.log.push(event(state, "AiDecision", `${actor.displayName} moves on to ${target.displayName} to finish its attacks`, {
        combatantId: actor.id, targetId: target.id, destination: move.cell, pathCost: move.pathCost, previousDistance,
        opportunityThreats: move.opportunityThreats, reason: "multiattack-move"
      }));
    } catch {
      continue;
    }
    // An opportunity attack on the way may have dropped it.
    if (actor.state !== "active") return { skip: true };
    const best = bestAgainst(target);
    return best ? { targetId: target.id, actionId: best.attack.id } : { skip: true };
  }
  return undefined;
}


/** Id of a synthesised / feature-granted `utility` action for `mode` at the given slot, if the actor has one. */
function utilityActionId(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  mode: "dash" | "disengage" | "dodge",
  slot: "action" | "bonus"
): string | undefined {
  // One it can pay for, a free one first (Patient Defense's plain Disengage before the one that spends a point).
  const options = getExecutableActions(getDefinition(snapshot, actor))
    .filter((candidate) => candidate.kind === "utility" && candidate.mode === mode && candidate.actionType === slot && canPayResource(actor, candidate));
  return (options.find((candidate) => !("resourceCost" in candidate && candidate.resourceCost)) ?? options[0])?.id;
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
  | { kind: "mark"; plan: MarkPlan }
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
  options: { relaxReachability?: boolean; noDrink?: boolean; focus?: CombatantState } = {}
): BonusPick | undefined {
  const heal = betterHeal(selectHealingAction(snapshot, actor, "bonus"), options.noDrink ? undefined : selectItemDrink(snapshot, actor, "bonus"));
  const buff = selectBuffAction(snapshot, actor, "bonus");
  const mark = selectMarkAction(snapshot, actor, options.focus);
  const offense = selectOffensivePlan(snapshot, actor, tactics, "bonus", options);
  if (heal && [buff, mark, offense].every((rival) => !rival || heal.score >= rival.score)) {
    return { kind: "heal", plan: heal };
  }
  if (buff && [mark, offense].every((rival) => !rival || buff.score >= rival.score)) {
    return { kind: "buff", plan: buff };
  }
  if (mark && (!offense || mark.score >= offense.score)) {
    return { kind: "mark", plan: mark };
  }
  return offense ? { kind: "offense", plan: offense } : undefined;
}

function betterHeal(a: HealingPlan | undefined, b: HealingPlan | undefined): HealingPlan | undefined {
  if (!a || !b) return a ?? b;
  return b.score > a.score ? b : a;
}

/** Log and resolve a `BonusPick`. Returns false (and does nothing) if its target stopped being valid. */
function resolveBonusPick(state: EngineState, actor: CombatantState, pick: BonusPick): boolean {
  if (pick.kind === "heal") {
    const heal = pick.plan;
    const item = heal.action.item;
    state.log.push(event(state, "AiDecision", item?.use === "drink"
      ? `${actor.displayName} used a bonus action to drink ${withArticle(item.name)}`
      : item?.use === "give"
        ? `${actor.displayName} used a bonus action to give ${heal.target.displayName} ${withArticle(item.name)}`
        : `${actor.displayName} used a bonus action to heal`, {
      combatantId: actor.id, actionId: heal.action.id, targetId: heal.target.id, slot: "bonus",
      ...(item ? { score: heal.score, reasons: heal.reasons } : {})
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
  if (pick.kind === "mark") {
    const mark = pick.plan;
    if (mark.target.state !== "active") return false;
    state.log.push(event(state, "AiDecision", `${actor.displayName} used a bonus action (${mark.action.name})`, {
      combatantId: actor.id, actionId: mark.action.id, targetId: mark.target.id, slot: "bonus", score: mark.score, reasons: mark.reasons
    }));
    try {
      resolveBuffAction(state, actor.id, mark.action.id, [mark.target.id]);
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
function maybeSpendBonusAction(state: EngineState, actor: CombatantState, tactics: TacticsSettings, options: { noDrink?: boolean } = {}): void {
  if (actor.state !== "active" || !canAct(actor, "bonus")) {
    return;
  }
  if (tryFollowUpAfterKill(state, actor, tactics)) {
    return;
  }
  const pick = selectBonusCandidate(state.snapshot, actor, tactics, options);
  if (pick) {
    // A heal/buff target can be `canMoveIntoRange` without being `reachable`
    // yet — close the gap first, mirroring the main-action heal short-circuit
    // above.
    if ((pick.kind === "heal" || pick.kind === "buff") && !pick.plan.reachable) {
      const move = bestDestinationTowardTarget(state.snapshot, actor, pick.plan.target, pick.plan.action.range, tactics);
      if (move) {
        try {
          moveCombatant(state, actor.id, move.cell, { altitude: move.altitude });
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
    effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant) && !caughtIds.has(combatant.id));
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
  const bonusPick = selectBonusCandidate(snapshot, actor, tactics, { relaxReachability: true, focus: mainPlan.target });
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
          moveCombatant(state, actor.id, move.cell, { altitude: move.altitude });
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

/**
 * Why `selectOffensivePlan` found nothing for this turn:
 * - `no-automated-action` — the creature has no fully automated attack / save / multiattack at all: a real
 *   gap in what the engine can run, and the only case worth an automation warning;
 * - `out-of-resources` — it has one, but every option is spent (slots, uses) or would break a concentration
 *   effect that is still working;
 * - `no-enemies` — there is nobody left to act against;
 * - `no-reachable-target` — it could act, but can't reach or target anyone this turn (boxed in behind
 *   allies or walls, no line of effect).
 */
export type IdleReason = "no-automated-action" | "out-of-resources" | "no-enemies" | "no-reachable-target";

export function explainIdleTurn(snapshot: EncounterSnapshot, actor: CombatantState): { reason: IdleReason; message: string } {
  const isOffensive = (action: ActionDefinition): action is OffensiveAction =>
    action.automationSupport === "full"
    && action.actionType === "action"
    && (action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack");
  const executables = getExecutableActions(getDefinition(snapshot, actor));
  const offensive = executables.filter(isOffensive);
  if (offensive.length === 0) {
    return { reason: "no-automated-action", message: "has no fully automated action" };
  }
  const concentrating = hasWorkingConcentrationEffect(snapshot, actor);
  const usable = offensive.filter((action) => canPayResource(actor, action, executables) && !("concentration" in action && action.concentration && concentrating));
  if (usable.length === 0) {
    return { reason: "out-of-resources", message: "has nothing left it can use this turn" };
  }
  const hasEnemy = snapshot.combatants.some(
    (other) => effectiveFaction(snapshot, other) !== effectiveFaction(snapshot, actor) && isTargetable(other)
  );
  return hasEnemy
    ? { reason: "no-reachable-target", message: "couldn't reach or target anyone this turn" }
    : { reason: "no-enemies", message: "has no enemies left to act against" };
}

export function takeAutomatedTurn(state: EngineState, actor: CombatantState): string | undefined {
  const tactics = tacticsSettings(actor.tacticsProfile);

  // Daze, Abjure Foes: only one of moving, an action and a bonus action. It takes its action from where it stands when
  // there's something to hit from there; otherwise it moves toward its target.
  if (limitedToOneThing(actor) && !actor.turnFlags?.limitedTo && canAct(actor, "action")) {
    const here = selectOffensivePlan(state.snapshot, actor, tactics, "action", { mustReachNow: true });
    if (here && isValidTarget(state.snapshot, actor, here.target, here.range)) {
      actor.turnFlags = { ...(actor.turnFlags ?? {}), limitedTo: "act" };
      state.log.push(event(state, "AiDecision", `${actor.displayName} can do only one thing this turn: it acts from where it stands`, {
        combatantId: actor.id, reason: "one-thing-act"
      }));
    } else {
      const plan = selectOffensivePlan(state.snapshot, actor, tactics, "action", { relaxReachability: true });
      actor.turnFlags = { ...(actor.turnFlags ?? {}), limitedTo: "move" };
      const move = plan ? bestDestinationTowardTarget(state.snapshot, actor, plan.target, plan.range, tactics, { allowPartialApproach: true }) : undefined;
      if (plan && move) {
        try {
          moveCombatant(state, actor.id, move.cell, { altitude: move.altitude });
          state.log.push(event(state, "AiDecision", `${actor.displayName} can do only one thing this turn: it moves toward ${plan.target.displayName}`, {
            combatantId: actor.id, targetId: plan.target.id, destination: move.cell, reason: "one-thing-move"
          }));
          return undefined;
        } catch { /* map state moved on */ }
      }
      state.log.push(event(state, "AiDecision", `${actor.displayName} can do only one thing this turn, and has nothing worth doing`, {
        combatantId: actor.id, reason: "one-thing-idle"
      }));
      return undefined;
    }
  }

  // Turn Undead: a turned creature moves as far from whoever turned it as it can, and does nothing else.
  const fleeingFrom = fleeSource(state.snapshot, actor);
  if (fleeingFrom) {
    fleeTurn(state, actor, fleeingFrom);
    return undefined;
  }

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

  // Confusion et al: the bearer's turn is overridden by a random roll instead
  // of the normal decision tree. Checked after the cannot-act early return so
  // a confused-and-also-stunned creature still just loses its turn.
  if (actor.conditions?.some((condition) => condition.modifiers?.forcesRandomAction)) {
    return resolveConfusedTurn(state, actor);
  }

  takeResourceConversions(state, actor);

  // Someone in a grapple spends the action breaking free when there's a fair chance of it (a restrained creature
  // fights at a penalty and can't move, so it matters most then); otherwise it fights on from where it is.
  const chanceToEscape = escapeChance(getDefinition(state.snapshot, actor), actor);
  const restrainedByHold = (actor.conditions ?? []).some((condition) => condition.hold && condition.name === "restrained");
  if (chanceToEscape >= (restrainedByHold ? 0.3 : 0.6) && canAct(actor, "action")) {
    const escape = getExecutableActions(getDefinition(state.snapshot, actor)).find((candidate) => candidate.kind === "utility" && candidate.mode === "escape");
    if (escape) {
      state.log.push(event(state, "AiDecision", `${actor.displayName} tries to break free of a grapple`, { combatantId: actor.id, reason: "escape-hold" }));
      resolveUtilityAction(state, actor.id, escape.id);
      return undefined;
    }
  }

  let movedThisTurn = false;
  let healing = withoutRedundantGive(state.snapshot, actor, selectHealingAction(state.snapshot, actor));
  // A potion given with the action for its full amount is only worth the action when the rolled one, given with the
  // bonus action, wouldn't keep the ally up as well: otherwise the bonus action gives it now, and the action is free.
  const rolledGive = needlessFullGive(state.snapshot, actor, healing);
  if (rolledGive) {
    resolveBonusPick(state, actor, { kind: "heal", plan: rolledGive });
    healing = withoutRedundantGive(state.snapshot, actor, selectHealingAction(state.snapshot, actor));
  }
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
          moveCombatant(state, actor.id, move.cell, { altitude: move.altitude });
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
  // rather than falling through to an idle turn.
  const buff = selectBuffAction(state.snapshot, actor, "action") ?? selectBuffBurstAction(state.snapshot, actor);

  // A summon is a standing investment (new allies for the rest of the fight), so it beats a comparable buff or
  // attack when it scores higher than both — not merely "no offensive plan at all", the way a free buff does.
  const summon = selectSummonAction(state.snapshot, actor, "action");

  // A potion drunk with the action is worth what it beats: about to drop, it outscores most attacks; merely bloodied,
  // only an idle action (nothing in reach, nothing better to do). Where the bonus action could drink one too (rolled),
  // the action's (the full amount) is worth only what it adds to that: the turn weighs attacking and drinking with the
  // bonus action against drinking with the action and using the bonus action for whatever else is best.
  const drink = selectItemDrink(state.snapshot, actor, "action");
  const drinkEdge = drink ? drink.score - bonusDrinkForgone(state.snapshot, actor, tactics) : 0;
  if (drink && [plan, buff, summon].every((rival) => !rival || drinkEdge > rival.score)) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose to drink ${withArticle(drink.action.item!.name)}`, {
      combatantId: actor.id,
      actionId: drink.action.id,
      targetId: actor.id,
      score: drink.score,
      reasons: drink.reasons
    }));
    try {
      resolveHealingAction(state, actor.id, actor.id, drink.action.id);
    } catch (error) {
      state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s ${drink.action.name} could not resolve`, {
        combatantId: actor.id,
        actionId: drink.action.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
    // A turn drinks one potion: the bonus action goes to whatever else is best.
    maybeSpendBonusAction(state, actor, tactics, { noDrink: true });
    return undefined;
  }
  if (summon && (!plan || summon.score > plan.score) && (!buff || summon.score > buff.score)) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${summon.action.name}`, {
      combatantId: actor.id,
      actionId: summon.action.id,
      score: summon.score,
      reasons: summon.reasons
    }));
    try {
      resolveSummonAction(state, actor.id, summon.action.id, summon.optionId);
    } catch (error) {
      state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s ${summon.action.name} could not resolve`, {
        combatantId: actor.id,
        actionId: summon.action.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
    maybeSpendBonusAction(state, actor, tactics);
    return undefined;
  }

  if (buff && (!plan || buff.score > plan.score)) {
    const isBurst = "targets" in buff;
    if (!isBurst && !buff.reachable) {
      const move = bestDestinationTowardTarget(state.snapshot, actor, buff.target, buff.action.range, tactics);
      if (move) {
        try {
          moveCombatant(state, actor.id, move.cell, { altitude: move.altitude });
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
      (other) => effectiveFaction(state.snapshot, other) !== effectiveFaction(state.snapshot, actor) && other.state === "reserve"
    );
    const noVisibleEnemies = !state.snapshot.combatants.some(
      (other) => effectiveFaction(state.snapshot, other) !== effectiveFaction(state.snapshot, actor) && other.state === "active"
    );
    if (awaitingReinforcements && noVisibleEnemies) {
      state.log.push(event(state, "AiDecision", `${actor.displayName} holds position — no enemies in sight`, {
        combatantId: actor.id,
        reason: "awaiting-reinforcements"
      }));
      return undefined;
    }
    // "No plan" has several very different causes. Only a genuine gap in what the engine can run is an
    // automation warning; the rest are ordinary tactical situations (a back-rank creature that can't
    // reach anyone, a caster who has spent its slots) and are logged as decisions, not warnings.
    const idle = explainIdleTurn(state.snapshot, actor);
    if (idle.reason === "no-automated-action") {
      const warning = `${actor.displayName} has no fully automated action`;
      state.log.push(event(state, "AutomationWarning", warning, { combatantId: actor.id }));
      return warning;
    }
    state.log.push(event(state, "AiDecision", `${actor.displayName} ${idle.message}`, {
      combatantId: actor.id,
      reason: idle.reason
    }));
    return undefined;
  }

  const activation = selectFeatureActivationAction(state.snapshot, actor, plan);
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

  // Free activations that pay off this turn (Reckless Attack before Strength melee swings, Sacred Weapon before melee
  // ones; a purely defensive one, Superior Defense, once the creature is hurt): they cost no action, so each that's
  // worth it is taken.
  const freeActivations = selectFreeActivations(state.snapshot, actor, plan);
  for (const free of freeActivations) {
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${free.action.name}`, {
      combatantId: actor.id,
      actionId: free.action.id,
      score: free.score,
      reasons: free.reasons,
      slot: "free"
    }));
    resolveActivateFeatureAction(state, actor.id, free.action.id);
  }
  if (freeActivations.length) plan = selectOffensivePlan(state.snapshot, actor, tactics) ?? plan;

  // A target already in sight is marked before anything else spends the bonus action; one the move brings into sight,
  // after the move.
  if (markBeforeAttacking(state, actor, plan, tactics)) plan = selectOffensivePlan(state.snapshot, actor, tactics) ?? plan;

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
    // A bonus-action Dash (an orc's Aggressive, a spy's Cunning Action) closes the gap and keeps the action
    // for the attack — always better than spending the action on Dash.
    const bonusDashId = !normalReaches && !gapCloser && canAct(actor, "bonus")
      ? utilityActionId(state.snapshot, actor, "dash", "bonus")
      : undefined;
    const bonusDashMove = bonusDashId
      ? dashDestinationTowardTarget(state.snapshot, actor, plan.target, plan.range, tactics)
      : undefined;
    // A single move can't close the gap; if a doubled (Dash) move would, spend
    // the action on Dash instead of half-closing and standing idle.
    const dashMove = !normalReaches && !gapCloser && !bonusDashMove && canAct(actor, "action")
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
    } else if (bonusDashMove && bonusDashId) {
      try {
        resolveUtilityAction(state, actor.id, bonusDashId);
        moveCombatant(state, actor.id, bonusDashMove.cell, { altitude: bonusDashMove.altitude });
        movedThisTurn = true;
        state.log.push(event(state, "AiDecision", `${actor.displayName} dashes toward ${plan.target.displayName} (bonus action)`, {
          combatantId: actor.id, targetId: plan.target.id, destination: bonusDashMove.cell, remainingDistance: bonusDashMove.targetDistance, slot: "bonus"
        }));
      } catch { /* map state moved on */ }
    } else if (dashMove) {
      const dashId = utilityActionId(state.snapshot, actor, "dash", "action");
      if (dashId) {
        try {
          resolveUtilityAction(state, actor.id, dashId);
          moveCombatant(state, actor.id, dashMove.cell, { altitude: dashMove.altitude });
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
        const previousDistance = spatialDistance(state.snapshot, actor, plan.target);
        moveCombatant(state, actor.id, movement.cell, { altitude: movement.altitude });
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
    } else if (!gapCloser && !bonusDashMove) {
      // Can't get within range this turn, even with a Dash. Close the distance
      // instead of standing still: Dash toward the target if that covers more
      // ground (the action would go unused anyway), otherwise just move — and
      // Dodge if the advance walked into a threatened square.
      const feet = (pathCost: number) => Math.round(pathCost * state.snapshot.map.grid.distancePerSquare);
      const previousDistance = spatialDistance(state.snapshot, actor, plan.target);
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
          moveCombatant(state, actor.id, dashApproach.cell, { altitude: dashApproach.altitude });
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
          moveCombatant(state, actor.id, walkApproach.cell, { altitude: walkApproach.altitude });
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

      // A walker under a flier it can't touch has nowhere useful to go, and says so below instead.
      if (outOfMeleeReachVertically(state.snapshot, actor, plan.target, plan.action) === undefined) {
        state.log.push(event(state, "AutomationWarning", `${actor.displayName} found no legal movement toward ${plan.target.displayName}`, {
          combatantId: actor.id,
          targetId: plan.target.id,
          actionId: plan.action.id,
          range: plan.range
        }));
      }
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
    const overhead = outOfMeleeReachVertically(state.snapshot, actor, plan.target, plan.action);
    if (overhead !== undefined) {
      const above = combatantHeight(state.snapshot, plan.target) > combatantHeight(state.snapshot, actor);
      state.log.push(event(state, "AiDecision", `${actor.displayName} can't reach ${plan.target.displayName} with ${plan.action.name}: ${plan.target.displayName} is ${overhead} ft ${above ? "up" : "below"}`, {
        combatantId: actor.id,
        targetId: plan.target.id,
        actionId: plan.action.id,
        verticalGap: overhead,
        reason: "out-of-reach-vertically"
      }));
      return undefined;
    }
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
        moveCombatant(state, actor.id, shotPos.cell, { altitude: shotPos.altitude });
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
  if (markBeforeAttacking(state, actor, plan, tactics)) {
    const marked = selectOffensivePlan(state.snapshot, actor, tactics, "action", { mustReachNow: true });
    if (marked && isValidTarget(state.snapshot, actor, marked.target, marked.range)) plan = marked;
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
        moveCombatant(state, actor.id, reposition.cell, { altitude: reposition.altitude });
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

  maybeTakeSafeAltitude(state, actor, tactics);
  maybeSpendBonusAction(state, actor, tactics);
  return undefined;
}

/**
 * A mark (Hunter's Mark, Hex) adds to every hit on its creature, this turn's included: when the bonus action is best
 * spent on one, it goes on the turn's target before the attacks. Only before attack rolls: a turn that casts Fireball
 * isn't one to change for a mark. Whether it did (the caller re-picks its plan).
 */
function markBeforeAttacking(state: EngineState, actor: CombatantState, plan: OffensivePlan, tactics: TacticsSettings): boolean {
  if (actor.state !== "active" || !canAct(actor, "bonus") || (plan.action.kind !== "attack" && plan.action.kind !== "multiattack")
    || !hasMarkAction(getDefinition(state.snapshot, actor))) return false;
  const first = selectBonusCandidate(state.snapshot, actor, tactics, { focus: plan.target });
  return first?.kind === "mark" && resolveBonusPick(state, actor, first);
}

/**
 * Confusion (and any other `forcesRandomAction` condition): the bearer's turn
 * is overridden by a random roll instead of the normal decision tree —
 * simplified to 3 outcomes (RAW's real d10 table condensed, same "approximate
 * and document it" precedent as Bless's flat +2). Faction-agnostic on
 * purpose: this is about the bearer's own scrambled turn, not which side it's
 * fighting for, so it never touches `effectiveFaction`.
 */
function resolveConfusedTurn(state: EngineState, actor: CombatantState): string | undefined {
  const snapshot = state.snapshot;
  const definition = getDefinition(snapshot, actor);
  const outcome = state.rng.nextInt(1, 3);

  if (outcome === 1) {
    const meleeActions = getExecutableActions(definition).filter(
      (action): action is Extract<ActionDefinition, { kind: "attack" }> =>
        action.kind === "attack" && action.attackType === "melee" && action.automationSupport === "full" && canPayResource(actor, action)
    );
    const candidates: { action: Extract<ActionDefinition, { kind: "attack" }>; target: CombatantState }[] = [];
    for (const action of meleeActions) {
      const reach = action.reach ?? action.range;
      for (const other of snapshot.combatants) {
        if (other.id === actor.id || other.state !== "active") {
          continue;
        }
        if (isValidTarget(snapshot, actor, other, reach)) {
          candidates.push({ action, target: other });
        }
      }
    }
    if (candidates.length > 0) {
      const pick = candidates[state.rng.nextInt(0, candidates.length - 1)]!;
      state.log.push(event(state, "AiDecision", `${actor.displayName} is confused and attacks ${pick.target.displayName}`, {
        combatantId: actor.id,
        actionId: pick.action.id,
        targetId: pick.target.id,
        reason: "confused"
      }));
      try {
        resolveAttack(state, actor.id, pick.target.id, pick.action.id);
      } catch (error) {
        state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s confused attack could not resolve`, {
          combatantId: actor.id,
          actionId: pick.action.id,
          targetId: pick.target.id,
          error: error instanceof Error ? error.message : String(error)
        }));
      }
      return undefined;
    }
    // No melee target in reach — RAW has the creature wander; simplified down to "do nothing" (outcome 3).
  }

  if (outcome === 2) {
    const footprint = sizeFootprint(definition.size);
    const occupied = occupiedCellsFor(snapshot, actor.id);
    const pathingMap = hazardPathingOverlay(zoneTerrainOverlay(snapshot.map, snapshot.activeZones));
    const reachable = findReachableCells(pathingMap, actor.position, footprint, snapshot.map.grid.distancePerSquare, occupied, { ...movementOptionsFor(definition), allowOccupiedTransit: false })
      .filter((candidate) => candidate.cell.x !== actor.position.x || candidate.cell.y !== actor.position.y);
    if (reachable.length > 0) {
      const destination = reachable[state.rng.nextInt(0, reachable.length - 1)]!.cell;
      state.log.push(event(state, "AiDecision", `${actor.displayName} is confused and stumbles to a random square`, {
        combatantId: actor.id,
        destination,
        reason: "confused"
      }));
      try {
        moveCombatant(state, actor.id, destination);
      } catch { /* map state moved on */ }
      return undefined;
    }
  }

  state.log.push(event(state, "AiDecision", `${actor.displayName} is confused and does nothing`, {
    combatantId: actor.id,
    reason: "confused"
  }));
  return undefined;
}

function selectNearestHostile(snapshot: EncounterSnapshot, actor: CombatantState): CombatantState | undefined {
  return snapshot.combatants
    .filter((combatant) => effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant))
    .sort((a, b) => spatialDistance(snapshot, actor, a) - spatialDistance(snapshot, actor, b)
      || a.currentHp - b.currentHp
      || a.id.localeCompare(b.id))[0];
}

function selectWoundedAlly(snapshot: EncounterSnapshot, actor: CombatantState): CombatantState | undefined {
  return snapshot.combatants
    .filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && (combatant.state === "active" || combatant.state === "downed"))
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
  const curable = (action: HealingAction, combatant: CombatantState) => (action.cures && action.fromPool
    ? [...new Set((combatant.conditions ?? []).map((condition) => condition.name).filter((name) => action.cures!.conditions.includes(name)))]
    : []);
  const woundedAllies = snapshot.combatants
    .filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && (combatant.state === "active" || combatant.state === "downed"));
  const healingActions = getExecutableActions(definition)
    .filter((action): action is HealingAction => action.kind === "healing"
      && action.actionType === slot
      && action.automationSupport === "full"
      // Drinking a potion is `selectItemDrink`'s call: whether it's about to drop, not how hurt it is.
      && action.item?.use !== "drink"
      && canPayResource(actor, action));
  const tactics = tacticsSettings(actor.tacticsProfile);
  const candidates = healingActions.flatMap((action) => woundedAllies
    // Hurt, or (Lay On Hands' cures) with a condition it can end.
    .filter((target) => target.currentHp < getDefinition(snapshot, target).maxHp || curable(action, target).length > 0)
    .filter((target) => !(action.targeting?.notSelf && target.id === actor.id))
    // A potion is given to someone who can't drink their own: down, or incapacitated.
    .filter((target) => action.item?.use !== "give" || target.state === "downed" || isIncapacitated(target))
    .map((target) => {
    const targetDefinition = getDefinition(snapshot, target);
    const missingHp = targetDefinition.maxHp - target.currentHp;
    const missingHpRatio = missingHp / Math.max(1, targetDefinition.maxHp);
    // Lay on Hands heals what's missing, as far as the pool goes.
    const average = action.fromPool ? Math.min(missingHp, actor.resources?.[action.fromPool.resourceId] ?? 0) : averageHealing(action, definition);
    const distance = spatialDistance(snapshot, actor, target);
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
    // Lay On Hands' cures: a paralyzed or stunned ally freed is worth a great deal, a poisoned one less.
    const pool = action.fromPool ? actor.resources?.[action.fromPool.resourceId] ?? 0 : 0;
    const cured = curable(action, target).sort((a, b) => conditionSeverity(b) - conditionSeverity(a))
      .slice(0, action.cures ? Math.floor(pool / Math.max(1, action.cures.poolCost)) : 0);
    const cureValue = cured.reduce((sum, name) => sum + conditionSeverity(name) * 60, 0);
    if (cured.length) reasons.push(`ends ${joinNames(cured)}`);
    const score = (target.state === "downed" ? 95 : missingHpRatio * 45)
      + cureValue
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
 * Giving a potion with the action is pointless when a bonus-action heal (Healing Word) already reaches the same ally
 * from here: that heal gets them up and the action is still free. Undefined then, so the turn goes on to the bonus heal.
 */
function withoutRedundantGive(snapshot: EncounterSnapshot, actor: CombatantState, healing: HealingPlan | undefined): HealingPlan | undefined {
  if (healing?.action.item?.use !== "give" || !canAct(actor, "bonus")) return healing;
  const bonus = selectHealingAction(snapshot, actor, "bonus");
  return bonus && !bonus.action.item && bonus.reachable && bonus.target.id === healing.target.id ? undefined : healing;
}

/**
 * A potion given with the action for its full amount (ITEMS_PLAN.md §6, D10) when the same potion given with the bonus
 * action, rolled, would keep the ally up about as well: that rolled give, to make now, so the action stays free for an
 * attack. Undefined when the full amount is worth the action (the ally would likely drop again on the roll but not on
 * the full amount), or when the rolled give can't reach the ally from here.
 */
function needlessFullGive(snapshot: EncounterSnapshot, actor: CombatantState, healing: HealingPlan | undefined): HealingPlan | undefined {
  const item = healing?.action.item;
  if (!healing || !item?.full || item.use !== "give" || !canAct(actor, "bonus")) return undefined;
  const definition = getDefinition(snapshot, actor);
  const rolledId = healing.action.id.slice(0, -FULL_SUFFIX.length);
  const rolled = getExecutableActions(definition).find((action): action is HealingAction => action.id === rolledId
    && action.kind === "healing" && action.actionType === "bonus" && canPayResource(actor, action));
  const ally = healing.target;
  if (!rolled || !isValidTarget(snapshot, actor, ally, rolled.range)) return undefined;
  const missing = getDefinition(snapshot, ally).maxHp - ally.currentHp;
  const danger = dangerBeforeNextTurn(snapshot, ally);
  const standing = ally.currentHp + ally.tempHp;
  const afterRolled = dropChanceAfterHealing(danger, standing, missing, healingOutcomes(rolled, definition));
  const afterFull = dropChanceAfterHealing(danger, standing, missing, healingOutcomes(healing.action, definition));
  if (afterRolled - afterFull >= KEEPS_IT_UP) return undefined;
  return {
    action: rolled,
    target: ally,
    score: healing.score,
    reachable: true,
    reasons: [...healing.reasons, `rolled, with the bonus action: ${Math.round(afterRolled * 100)}% to drop again before its next turn (${Math.round(afterFull * 100)}% for the full amount)`]
  };
}

function isIncapacitated(combatant: CombatantState): boolean {
  return (combatant.conditions ?? []).some((condition) => INCAPACITATING_CONDITIONS.has(condition.name));
}

/** What a creature faces before its next turn: what it can expect to take, and each threat's chance to land and what it deals. */
export interface Danger {
  /** Expected damage before its next turn. */
  total: number;
  threats: number;
  /** Each threat's chance to land and what it deals when it does (its expected damage ÷ that chance). */
  hits: Array<{ chance: number; damage: number }>;
}

/**
 * The damage `actor` can expect to take before its next turn (ITEMS_PLAN.md §3). Every active hostile acts once before
 * then; each one that can get to it (its fastest speed plus its best attack's reach or range) adds the most it's
 * expected to deal it with one of its actions. Distances are straight lines, so a wall in between isn't counted: it can
 * overcount, never undercount. Each threat also says how likely it is to land: an attack's chance to hit, an even
 * chance for a save or a routine.
 */
export function dangerBeforeNextTurn(snapshot: EncounterSnapshot, actor: CombatantState): Danger {
  const definition = getDefinition(snapshot, actor);
  const danger: Danger = { total: 0, threats: 0, hits: [] };
  for (const hostile of snapshot.combatants) {
    if (hostile.state !== "active" || hostile.containedBy || effectiveFaction(snapshot, hostile) === effectiveFaction(snapshot, actor) || !canAct(hostile, "action")) continue;
    const hostileDefinition = getDefinition(snapshot, hostile);
    const executables = getExecutableActions(hostileDefinition);
    const distance = spatialDistance(snapshot, hostile, actor);
    const speed = movementReference(movementProfileOf(hostileDefinition));
    let worst: { expected: number; chance: number } | undefined;
    for (const action of executables) {
      if (action.automationSupport !== "full" || action.actionType !== "action"
        || !(action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack")
        || !canPayResource(hostile, action, executables)
        || distance > speed + actionRange(action, hostileDefinition)) continue;
      const expected = expectedDamageAgainst(action, hostileDefinition, hostile, definition, actor);
      if (expected <= 0 || (worst && expected <= worst.expected)) continue;
      const chance = action.kind === "attack"
        ? (action.autoHit ? 1 : chanceToHit(resolveAttackBonus(action, hostileDefinition), armorClassOf(definition).total))
        : 0.5;
      worst = { expected, chance };
    }
    if (worst) {
      danger.total += worst.expected;
      danger.threats += 1;
      danger.hits.push({ chance: worst.chance, damage: worst.expected / worst.chance });
    }
  }
  return danger;
}

/** The most threats `dropChance` weighs one by one (2^n outcomes); the rest count at what they're expected to deal. */
const DROP_CHANCE_THREATS = 10;

/** What the threats can deal together, each total with its chance: worked out once per danger. */
const dangerOutcomes = new WeakMap<Danger, Array<{ damage: number; chance: number }>>();

function damageOutcomes(danger: Danger): Array<{ damage: number; chance: number }> {
  const known = dangerOutcomes.get(danger);
  if (known) return known;
  const ranked = [...danger.hits].sort((a, b) => b.chance * b.damage - a.chance * a.damage);
  const rest = ranked.slice(DROP_CHANCE_THREATS).reduce((sum, hit) => sum + hit.chance * hit.damage, 0);
  let totals = new Map<number, number>([[rest, 1]]);
  for (const hit of ranked.slice(0, DROP_CHANCE_THREATS)) {
    const next = new Map<number, number>();
    for (const [damage, chance] of totals) {
      next.set(damage + hit.damage, (next.get(damage + hit.damage) ?? 0) + chance * hit.chance);
      next.set(damage, (next.get(damage) ?? 0) + chance * (1 - hit.chance));
    }
    totals = next;
  }
  const outcomes = [...totals].map(([damage, chance]) => ({ damage, chance }));
  dangerOutcomes.set(danger, outcomes);
  return outcomes;
}

/**
 * The chance the threats take away at least `hp` before its next turn: each lands or not, at its chance, dealing what it
 * deals when it does. A single hit for more than it has left is a likely drop even when, on average, the threats
 * together are expected to deal less (two goblins' shortbows against a fighter at 5 HP).
 */
export function dropChance(danger: Danger, hp: number): number {
  if (hp <= 0) return 1;
  return damageOutcomes(danger).reduce((sum, outcome) => (outcome.damage >= hp ? sum + outcome.chance : sum), 0);
}

/** The most dice (by their faces, added up) `healingOutcomes` rolls out one by one; a bigger heal counts at its average. */
const HEALING_OUTCOME_FACES = 120;

/**
 * What a heal can come to, each amount with its chance: every die rolled out (2d4 + 2 is 4 to 10, 7 the likeliest) and
 * its modifiers added. A flat heal (a potion's full amount) is one amount, certain.
 */
function healingOutcomes(action: HealingAction, source: CreatureDefinition): Array<{ amount: number; chance: number }> {
  let flat = averageUpcastDiceBonus(action);
  const dice: Array<{ sides: number; sign: number }> = [];
  for (const component of action.healing) {
    const parsed = parseDiceExpression(component.dice);
    flat += parsed.modifier + (component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0);
    for (const term of parsed.terms) {
      for (let die = 0; die < term.count; die += 1) dice.push({ sides: term.sides, sign: term.sign });
    }
  }
  if (dice.reduce((faces, die) => faces + die.sides, 0) > HEALING_OUTCOME_FACES) {
    return [{ amount: averageHealing(action, source), chance: 1 }];
  }
  let sums = new Map<number, number>([[0, 1]]);
  for (const die of dice) {
    const next = new Map<number, number>();
    for (const [sum, chance] of sums) {
      for (let face = 1; face <= die.sides; face += 1) {
        next.set(sum + die.sign * face, (next.get(sum + die.sign * face) ?? 0) + chance / die.sides);
      }
    }
    sums = next;
  }
  return [...sums].map(([sum, chance]) => ({ amount: Math.max(0, sum + flat), chance }));
}

/** The chance of dropping before its next turn once healed: each of the heal's outcomes at its chance, none past its max. */
function dropChanceAfterHealing(danger: Danger, standing: number, missing: number, outcomes: Array<{ amount: number; chance: number }>): number {
  const byHp = new Map<number, number>();
  for (const outcome of outcomes) {
    const hp = standing + Math.min(outcome.amount, missing);
    byHp.set(hp, (byHp.get(hp) ?? 0) + outcome.chance);
  }
  let total = 0;
  for (const [hp, chance] of byHp) total += chance * dropChance(danger, hp);
  return total;
}

/** How much less likely to drop before its next turn a potion must make a creature for it to count as keeping it up. */
const KEEPS_IT_UP = 0.25;
/**
 * What staying up is worth to a creature, a whole drop avoided: the down itself (`DOWN_VALUE`, as the AI weighs dropping
 * an enemy) and the turns it would lose on the floor, about an attack's worth more. (A function: `DOWN_VALUE` is
 * declared further down.)
 */
const stayingUpValue = () => DOWN_VALUE * 3;

/**
 * A healing potion its holder drinks (ITEMS_PLAN.md §3, D4). It's worth drinking when the creature is likely to drop
 * before its next turn and the potion would keep it up: it's worth staying up (`stayingUpValue`) for every bit it
 * lowers the chance of dropping (`dropChance` before and after drinking), on top of the HP it restores. Bloodied, it's an option the caller
 * weighs against what else the slot could do (it only scores what the HP is worth); a `liberal` creature also drinks
 * whenever the heal won't be wasted. A `conservative` one only drinks when it would keep it up. A buff potion goes
 * through `selectBuffAction`.
 */
function selectItemDrink(snapshot: EncounterSnapshot, actor: CombatantState, slot: "action" | "bonus"): HealingPlan | undefined {
  if (actor.state !== "active") return undefined;
  const definition = getDefinition(snapshot, actor);
  const drinks = getExecutableActions(definition)
    .filter((action): action is HealingAction => action.kind === "healing"
      && action.item?.use === "drink"
      && action.actionType === slot
      && action.automationSupport === "full"
      && canPayResource(actor, action));
  const missing = definition.maxHp - actor.currentHp;
  if (!drinks.length || missing <= 0) return undefined;
  const danger = dangerBeforeNextTurn(snapshot, actor);
  const standing = actor.currentHp + actor.tempHp;
  const dropNow = dropChance(danger, standing);
  const bloodied = actor.currentHp <= definition.maxHp / 2;
  const stance = actor.resourceStance;
  let best: HealingPlan | undefined;
  for (const action of drinks) {
    const average = averageHealing(action, definition);
    // How much less likely it is to drop before its next turn once it has drunk this: every way the heal can roll.
    const saves = dropNow - dropChanceAfterHealing(danger, standing, missing, healingOutcomes(action, definition));
    const keepsItUp = saves >= KEEPS_IT_UP;
    const worthIt = keepsItUp
      || (stance !== "conservative" && bloodied)
      || (stance === "liberal" && missing >= average);
    if (!worthIt) continue;
    const price = resourceCostWeight(action) * 3 * resourceStanceMultiplier(stance);
    const score = Math.min(average, missing) * 2 + stayingUpValue() * Math.max(0, saves) - price + 10;
    const reasons = [
      `${actor.currentHp} HP left`,
      keepsItUp
        ? `≈${Math.round(danger.total)} damage likely before its next turn (${danger.threats} in reach): ${Math.round(dropNow * 100)}% to drop, ${Math.round((dropNow - saves) * 100)}% after drinking`
        : bloodied ? "bloodied" : "the heal won't be wasted",
      action.item?.full ? `the full ${Math.round(average)}, with an action instead of a bonus action` : `${Math.round(average)} expected healing`
    ];
    if (!best || score > best.score) best = { action, target: actor, score, reasons, reachable: true };
  }
  return best;
}

/**
 * What drinking with the action gives up in the bonus action (ITEMS_PLAN.md §6, D10): where the bonus action could drink
 * a potion too (rolled), what that drink would have been worth over the best of everything else the bonus action could
 * do instead. Nothing when the bonus action can't drink one (a potion that takes an action, or the bonus action spent).
 */
function bonusDrinkForgone(snapshot: EncounterSnapshot, actor: CombatantState, tactics: TacticsSettings): number {
  if (!canAct(actor, "bonus")) return 0;
  const rolled = selectItemDrink(snapshot, actor, "bonus");
  if (!rolled) return 0;
  const other = selectBonusCandidate(snapshot, actor, tactics, { noDrink: true });
  return Math.max(0, rolled.score - (other?.plan.score ?? 0));
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
        .filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && (combatant.state === "active" || combatant.state === "downed"))
        .filter((combatant) => combatant.currentHp < getDefinition(snapshot, combatant).maxHp)
        .filter((combatant) => isValidTarget(snapshot, actor, combatant, action.range));
      // Preserve Life: worth what its shares do, and only when that's as much as a heal would need to be.
      if (action.divided) {
        const shares = dividedHealing(snapshot, action.divided, woundedAllies);
        const value = shares.reduce((sum, { target, amount }) => {
          const max = getDefinition(snapshot, target).maxHp;
          return sum + (target.state === "downed" ? 95 : ((max - target.currentHp) / Math.max(1, max)) * 45) + amount - spatialDistance(snapshot, actor, target) / 20;
        }, 0);
        const score = value - resourcePenalty;
        if (shares.length && score >= 35 && (!best || score > best.score)) {
          best = { action, targets: shares.map(({ target }) => target), score, reasons: [`shares healing among ${shares.length} allies`] };
        }
        continue;
      }
      const scored = woundedAllies
        .map((target) => ({ target, value: scoreFor(target) - spatialDistance(snapshot, actor, target) / 20 }))
        .sort((a, b) => b.value - a.value);
      const taken = scored.slice(0, chosenTargetCount(action) ?? scored.length);
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
      .filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && (combatant.state === "active" || combatant.state === "downed"))
      .filter((combatant) => combatant.currentHp < getDefinition(snapshot, combatant).maxHp)
      .filter((combatant) => spatialDistance(snapshot, actor, combatant) <= rangeLimit);
    let bestPlacement: { origin: Point; targets: CombatantState[]; value: number } | undefined;
    for (const candidate of woundedInRange) {
      const caught = combatantsInArea(snapshot.map, candidate.position, action.area, snapshot.combatants, definitionsById, undefined, { includeDowned: true })
        .filter((target) => effectiveFaction(snapshot, target) === effectiveFaction(snapshot, actor));
      const value = caught.reduce((sum, target) => sum + scoreFor(target), 0);
      if (!bestPlacement || value > bestPlacement.value) {
        bestPlacement = { origin: candidate.position, targets: caught, value };
      }
    }
    if (!bestPlacement || !bestPlacement.targets.length) {
      continue;
    }
    const score = bestPlacement.value - resourcePenalty - spatialDistanceToPoint(snapshot, actor, bestPlacement.origin) / 20;
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
      // A conscious ally can drink its own potion: the AI drinks its buff potions and gives none.
      && action.item?.use !== "give"
      // A mark goes on a foe: `selectMarkAction`.
      && !action.mark
      // Prep-only buffs (Aid, Mage Armor) are DM-toggled before combat, not
      // an in-combat option — never a candidate here.
      && !action.prepOnly
      && action.automationSupport === "full"
      && canPayResource(actor, action)
      // Don't trade a still-working concentration effect for a new one.
      && (!action.concentration || !hasWorkingConcentrationEffect(snapshot, actor)));
  if (!buffActions.length) {
    return undefined;
  }
  const allies = snapshot.combatants.filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && combatant.state === "active");

  const candidates = buffActions.flatMap((action) => {
    const mode = action.targeting?.target ?? "single";
    // Bardic Inspiration goes to someone else.
    const eligible = mode === "self" ? [actor] : action.targeting?.notSelf ? allies.filter((ally) => ally.id !== actor.id) : allies;
    const conditionId = action.appliedCondition.id ?? upcastBaseId(action.id);
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    return eligible
      .filter((target) => !target.conditions?.some((condition) => condition.id === conditionId))
      .map((target) => {
        const distance = mode === "self" ? 0 : spatialDistance(snapshot, actor, target);
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

/** How many rounds a mark is reckoned to pay off for: it moves on when its creature drops, so most of a fight. */
const MARK_ROUNDS = 3;

function hasMarkAction(definition: CreatureDefinition): boolean {
  return getExecutableActions(definition).some((action) => action.kind === "buff" && Boolean(action.mark));
}

/**
 * A mark (Hunter's Mark, Hex) worth the bonus action: cast on `focus` (the creature the turn attacks; without one, the
 * foe in range it pays most against), or moved there for free once the last marked creature dropped. Scored as a
 * bonus-action attack would be (twice its damage, and what an attack in reach gets) for its extra damage on the hits
 * the actor can expect over the next few rounds, less what a cast spends. Never cast while another concentration effect
 * (a mark on a living creature among them) is still working.
 */
function selectMarkAction(snapshot: EncounterSnapshot, actor: CombatantState, focus?: CombatantState): MarkPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const marks = getExecutableActions(definition).filter((action): action is BuffAction => action.kind === "buff"
    && Boolean(action.mark)
    && action.actionType === "bonus"
    && action.automationSupport === "full"
    && canPayResource(actor, action));
  if (!marks.length) return undefined;
  const working = hasWorkingConcentrationEffect(snapshot, actor);
  const foes = (focus ? [focus] : snapshot.combatants)
    .filter((combatant) => combatant.state === "active" && effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant));
  let best: MarkPlan | undefined;
  for (const action of marks) {
    if (action.mark?.moving ? markMoveProblem(snapshot, actor, action) : working) continue;
    const conditionId = markConditionId(action);
    const penalty = resourceCostWeight(action) * 4 * resourceStanceMultiplier(actor.resourceStance);
    for (const target of foes) {
      if (!isValidTarget(snapshot, actor, target, action.range)
        || (target.conditions ?? []).some((condition) => condition.id === conditionId && condition.sourceCombatantId === actor.id)) {
        continue;
      }
      const perRound = expectedMarkDamagePerRound(snapshot, definition, action, target);
      if (perRound <= 0) continue;
      const score = perRound * MARK_ROUNDS * 2 + 10 - penalty;
      if (score > 0 && (!best || score > best.score + 1e-9)) {
        best = { action, target, score, reasons: [`about ${perRound.toFixed(1)} more damage a round on ${target.displayName}`] };
      }
    }
  }
  return best;
}

/** A mark's extra damage a round against `target`: its damage on each hit times the hits the actor's attacks can expect. */
function expectedMarkDamagePerRound(snapshot: EncounterSnapshot, source: CreatureDefinition, action: BuffAction, target: CombatantState): number {
  const targetDefinition = getDefinition(snapshot, target);
  const adjustments = damageAdjustmentsFor(targetDefinition, target);
  const perHit = (action.appliedCondition.effects ?? []).reduce((sum, effect) => sum + (effect.kind === "incoming-hit-damage" && effect.onlyFromSource
    ? effect.damage.reduce((total, component) => total + averageDamageComponent(component, source) * defenseMultiplier(component, adjustments), 0)
    : 0), 0);
  if (perHit <= 0) return 0;
  const executables = getExecutableActions(source);
  const attacks = executables.filter((candidate): candidate is AttackAction => candidate.kind === "attack"
    && candidate.actionType === "action" && candidate.automationSupport === "full");
  if (!attacks.length) return 0;
  const casterLevel = source.character?.level ?? 1;
  const rolls = Math.max(1, ...executables.map((candidate) => {
    if (candidate.automationSupport !== "full" || candidate.actionType !== "action") return 0;
    if (candidate.kind === "multiattack") return swingsOf(candidate.attacks).filter((swing) => !stepAbility(swing.step, executables)).length;
    if (candidate.kind === "attack" && candidate.attackDelivery === "beams") return resolveBeamCount(candidate, casterLevel, spellSlotLevel(candidate.resourceCost?.resourceId));
    return 0;
  }));
  const bestBonus = Math.max(...attacks.map((attack) => resolveAttackBonus(attack, source)));
  return perHit * rolls * chanceToHit(bestBonus, armorClassOf(targetDefinition).total);
}

/** The bearer's own marks on `targetCombatant`: what each of its hits there adds (Hunter's Mark's 1d6 force). */
function averageMarkDamage(
  source: CreatureDefinition,
  sourceCombatant: CombatantState,
  targetCombatant: CombatantState | undefined,
  adjustments: CreatureDefinition["damageAdjustments"]
): number {
  let total = 0;
  for (const condition of targetCombatant?.conditions ?? []) {
    if (condition.sourceCombatantId !== sourceCombatant.id) continue;
    for (const effect of condition.effects ?? []) {
      if (effect.kind !== "incoming-hit-damage" || !effect.onlyFromSource) continue;
      total += effect.damage.reduce((sum, component) => sum + averageDamageComponent(component, source) * defenseMultiplier(component, adjustments), 0);
    }
  }
  return total;
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
      && !action.mark
      && !action.prepOnly
      && action.automationSupport === "full"
      && canPayResource(actor, action)
      // Don't trade a still-working concentration effect for a new one.
      && (!action.concentration || !hasWorkingConcentrationEffect(snapshot, actor)));
  if (!buffActions.length) {
    return undefined;
  }
  const allies = snapshot.combatants.filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && combatant.state === "active");

  let best: BuffBurstPlan | undefined;
  for (const action of buffActions) {
    const conditionId = action.appliedCondition.id ?? upcastBaseId(action.id);
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    const scored = allies
      .filter((target) => !target.conditions?.some((condition) => condition.id === conditionId))
      .filter((target) => isValidTarget(snapshot, actor, target, action.range))
      .map((target) => {
        const priorityBonus = (target.tags?.includes("protected") ? 20 : 0)
          + (target.tags?.includes("high-priority") ? 10 : 0)
          + (target.tags?.includes("low-priority") ? -15 : 0);
        return { target, value: 15 + priorityBonus - spatialDistance(snapshot, actor, target) / 20 };
      })
      .sort((a, b) => b.value - a.value);
    const taken = scored.slice(0, chosenTargetCount(action) ?? scored.length);
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
    effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && combatant.state === "active");

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

function selectFeatureActivationAction(snapshot: EncounterSnapshot, actor: CombatantState, plan?: OffensivePlan): FeatureActivationPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const hostiles = snapshot.combatants.filter((combatant) => effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant));
  if (hostiles.length === 0) {
    return undefined;
  }
  // Its bonus action may be gone already (a turn played again after Action Surge).
  if (!canAct(actor, "bonus")) return undefined;
  const actions = getExecutableActions(definition)
    .filter((action): action is FeatureActivationAction => action.kind === "activate-feature"
      && action.actionType === "bonus"
      && action.automationSupport === "full"
      && canPayResource(actor, action)
      && Boolean(action.condition)
      && !hasActiveFeatureCondition(actor, action.featureId, action.condition?.id)
      // Large Form: only with room to grow.
      && !growthProblem(snapshot, actor, action)
      // Steady Aim: only standing still with an attack in reach from here, before it has moved.
      && (!action.stillOnly || ((actor.turnFlags?.movementUsed ?? 0) === 0 && plan !== undefined
        && (plan.action.kind === "attack" || plan.action.kind === "multiattack") && isValidTarget(snapshot, actor, plan.target, plan.range))));
  const candidates = actions.map((action) => {
    const effects = action.condition?.effects ?? [];
    const hasOffense = effects.some((effect) => effect.kind === "damage-bonus" || effect.kind === "attack-bonus" || effect.kind === "attack-advantage")
      || (action.condition?.nextAttack?.role === "made" && action.condition.nextAttack.mode === "advantage");
    const hasDefense = effects.some((effect) => effect.kind === "damage-adjustment"
      || effect.kind === "armor-class-bonus"
      || effect.kind === "save-bonus"
      || effect.kind === "save-advantage");
    const duration = action.condition?.durationRounds ?? 1;
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    // Draconic Flight, Large Form: flying, or more speed, for the fight.
    const modifiers = action.condition?.modifiers;
    const hasMobility = modifiers?.flySpeed !== undefined || (modifiers?.speedBonusFt ?? 0) > 0;
    const score = (hasOffense ? 25 : 0)
      + (hasDefense ? 18 : 0)
      + (hasMobility ? 15 : 0)
      + Math.min(duration, 10)
      - resourcePenalty;
    const reasons = [
      hasOffense ? "improves attacks" : "no attack boost",
      hasDefense ? "improves defenses" : "no defensive boost",
      ...(hasMobility ? ["more mobile"] : []),
      `${duration} round duration`
    ];
    return { action, score, reasons };
  }).filter((candidate) => candidate.score >= 20);

  candidates.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
  return candidates[0];
}

/** The attacks an offensive plan swings with: its own, or a multiattack's steps. */
function planAttacks(plan: OffensivePlan, executables: ActionDefinition[]): AttackAction[] {
  if (plan.action.kind === "attack") return [plan.action];
  if (plan.action.kind !== "multiattack") return [];
  return plan.action.attacks.flatMap((step) => swingCandidates(step, executables));
}

/** Whether an attack is one an effect's scope covers: its attack types and abilities (a finesse weapon, the better). */
function scopeCovers(effect: FeatureEffect, attack: AttackAction, definition: CreatureDefinition): boolean {
  const scope = effect as { attackTypes?: string[]; abilities?: Ability[]; spellsOnly?: boolean; actionIds?: string[] };
  if (scope.attackTypes && !scope.attackTypes.includes(attack.attackType)) return false;
  if (scope.spellsOnly && attack.spellLevel === undefined) return false;
  if (scope.actionIds && !scope.actionIds.includes(attack.id)) return false;
  if (scope.abilities) {
    // A compiled attack names the ability it uses (a finesse weapon's is already the better of the two).
    if (!attack.ability || !scope.abilities.includes(attack.ability)) return false;
  }
  return true;
}

/**
 * Free activations worth taking this turn. One that boosts attacks (Reckless Attack, Sacred Weapon) is taken when the
 * plan swings with an attack it covers, and, if it lowers the creature's defenses (Reckless Attack's advantage against
 * it), only while it has half its hit points or more. One that only defends (Superior Defense) is taken once it's down to
 * half, with an enemy close. A cost is weighed as for any activation (the stance scales it).
 */
function selectFreeActivations(snapshot: EncounterSnapshot, actor: CombatantState, plan: OffensivePlan): FeatureActivationPlan[] {
  if (!canAct(actor, "free")) return [];
  const definition = getDefinition(snapshot, actor);
  const executables = getExecutableActions(definition);
  const attacks = planAttacks(plan, executables);
  const healthy = actor.currentHp * 2 >= definition.maxHp;
  const threatened = snapshot.combatants.some((other) => effectiveFaction(snapshot, other) !== effectiveFaction(snapshot, actor)
    && isTargetable(other) && spatialDistance(snapshot, actor, other) <= 10);
  const chosen: FeatureActivationPlan[] = [];
  for (const action of executables) {
    if (action.kind !== "activate-feature" || action.actionType !== "free" || action.automationSupport !== "full") continue;
    if (!action.condition || !canPayResource(actor, action) || hasActiveFeatureCondition(actor, action.featureId, action.condition?.id)) continue;
    const effects = action.condition.effects ?? [];
    const offense = effects.filter((effect) => effect.kind === "damage-bonus" || effect.kind === "attack-bonus" || effect.kind === "attack-advantage");
    const defense = effects.some((effect) => effect.kind === "damage-adjustment" || effect.kind === "armor-class-bonus"
      || effect.kind === "save-bonus" || effect.kind === "save-advantage") || (action.condition.modifiers?.armorClass ?? 0) > 0;
    const exposes = (action.condition.modifiers?.incomingAttackRoll ?? 0) > 0;
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    let score = 0;
    const reasons: string[] = [];
    if (offense.length) {
      if (!attacks.some((attack) => offense.some((effect) => scopeCovers(effect, attack, definition)))) continue;
      if (exposes && !healthy) continue;
      score = 25 + Math.min(action.condition.durationRounds ?? 1, 10);
      reasons.push("improves this turn's attacks", exposes ? "healthy enough to be exposed" : "no downside");
    } else if (defense) {
      if (healthy || !threatened) continue;
      score = 22 + Math.min(action.condition.durationRounds ?? 1, 10);
      reasons.push("hurt, with an enemy close");
    } else {
      continue;
    }
    score -= resourcePenalty;
    if (score < 20) continue;
    chosen.push({ action, score, reasons });
  }
  return chosen.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
}

/**
 * Action Surge and the like: a free activation whose feature hands back the action. Taken after the turn's action, when
 * there's still something to attack (a conservative creature waits for a bloodied target), and the turn is played again
 * with the action it gives. Returns whether it was taken.
 */
export function takeSurgedAction(state: EngineState, actor: CombatantState): boolean {
  if (actor.state !== "active" || actor.actionEconomy?.action !== false || !canAct(actor, "free")) return false;
  const definition = getDefinition(state.snapshot, actor);
  const features = [...(definition.features ?? []), ...(definition.traits ?? [])];
  const surge = getExecutableActions(definition).find((action): action is FeatureActivationAction => action.kind === "activate-feature"
    && action.actionType === "free" && action.automationSupport === "full" && canPayResource(actor, action)
    && Boolean(features.find((feature) => feature.id === action.featureId)?.effects?.some((effect) => effect.kind === "extra-action" && effect.slot === "action")));
  if (!surge) return false;
  const plan = selectOffensivePlan(state.snapshot, actor, tacticsSettings(actor.tacticsProfile));
  if (!plan) return false;
  if (actor.resourceStance === "conservative" && plan.target.currentHp * 2 > getDefinition(state.snapshot, plan.target).maxHp) return false;
  state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${surge.name}`, {
    combatantId: actor.id, actionId: surge.id, targetId: plan.target.id, reasons: ["another action against an enemy in reach"], slot: "free"
  }));
  resolveActivateFeatureAction(state, actor.id, surge.id);
  return true;
}

function hasActiveFeatureCondition(actor: CombatantState, featureId: string, conditionId?: string): boolean {
  // Its own condition, or the same one from another feature (Innate Sorcery bought with sorcery points).
  return (actor.conditions ?? []).some((condition) => condition.sourceId === featureId || (conditionId !== undefined && condition.id === conditionId));
}

/** Roughly how much a creature is worth having on the field as a fresh ally: its durability plus its best attack. */
/** How much more a summon is worth on round 1, when its allies have the whole fight ahead of them. */
const SUMMON_OPENING_BONUS = 4;

function allyValue(definition: CreatureDefinition): number {
  const bestAttack = Math.max(0, ...getExecutableActions(definition)
    .filter((action) => action.automationSupport === "full" && (action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack"))
    .map((action) => averageDamage(action, definition)));
  return Math.sqrt(Math.max(1, definition.maxHp)) * 3 + bestAttack;
}

/**
 * Whether summoning is worth the action, and which option (for `choice: "pick"`) to take — the one whose
 * `allyValue × count` is highest. `chance` (a balor's 50%) discounts the score, since the action can fizzle.
 */
function selectSummonAction(snapshot: EncounterSnapshot, actor: CombatantState, slot: "action" | "bonus" = "action"): SummonPlan | undefined {
  const definition = getDefinition(snapshot, actor);
  const actions = getExecutableActions(definition)
    .filter((action): action is SummonActionDefinition => action.kind === "summon"
      && action.actionType === slot
      && action.automationSupport === "full"
      && canPayResource(actor, action)
      && (actor.summon?.generation ?? 0) + 1 <= (action.maxGeneration ?? 2));
  if (actions.length === 0) return undefined;

  const candidates = actions.map((action) => {
    const scored = action.options.map((option) => {
      const summonedDefinition = snapshot.definitions.find((candidate) => candidate.id === option.definitionId);
      if (!summonedDefinition) return { optionId: option.id, value: 0 };
      const count = typeof option.count === "number" ? option.count : Math.max(1, averageOfDice(option.count.dice));
      return { optionId: option.id, value: allyValue(summonedDefinition) * count };
    });
    const best = scored.reduce((top, candidate) => (candidate.value > top.value ? candidate : top), scored[0]!);
    const chanceFactor = (action.chance ?? 100) / 100;
    const resourcePenalty = resourceCostWeight(action) * 3 * resourceStanceMultiplier(actor.resourceStance);
    // Allies called in at the start have the whole fight to pay off, so a summoner opens with it (a much better
    // attack can still win); after the opening round the summon competes on its plain value.
    const opening = snapshot.round <= 1 ? SUMMON_OPENING_BONUS : 1;
    const score = best.value * chanceFactor * opening - resourcePenalty;
    return {
      action, optionId: action.choice === "pick" ? best.optionId : undefined, score,
      reasons: [
        `summons ~${Math.round(best.value)} worth of allies`,
        ...(action.chance !== undefined ? [`${action.chance}% chance`] : []),
        ...(opening > 1 ? ["opening move"] : [])
      ]
    };
  });

  candidates.sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
  const top = candidates[0];
  return top && top.score > 0 ? top : undefined;
}

function selectOffensivePlan(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  tactics: TacticsSettings,
  slot: "action" | "bonus" = "action",
  options: { mustReachNow?: boolean; relaxReachability?: boolean; actions?: OffensiveAction[] } = {}
): OffensivePlan | undefined {
  const definition = getDefinition(snapshot, actor);
  // Swallowed: the only thing it can act against is whatever swallowed it.
  const hostiles = actor.containedBy
    ? snapshot.combatants.filter((combatant) => combatant.id === actor.containedBy)
    : snapshot.combatants.filter((combatant) => effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant));
  const definitionsById = new Map(snapshot.definitions.map((candidate) => [candidate.id, candidate]));
  const executables = getExecutableActions(definition);
  const candidates = (options.actions ?? executables)
    .filter((action): action is OffensiveAction => action.automationSupport === "full" && (options.actions !== undefined || action.actionType === slot) && canPayResource(actor, action, executables) && (action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack"))
    // Brutal Strike: not without Reckless Attack on. Open Hand Technique's: only in Flurry of Blows.
    .filter((action) => !onHitTermsProblem(snapshot, actor, action) && !action.routineOnly)
    // Don't trade a still-working concentration effect for a new one.
    .filter((action) => !("concentration" in action && action.concentration) || !hasWorkingConcentrationEffect(snapshot, actor))
    // A routine of "any weapon attack" swings is planned two ways: close in and swing, or shoot from here.
    .flatMap((action): OffensiveAction[] => (action.kind === "multiattack" ? multiattackPlanningForms(action, executables) : [action]))
    .flatMap((action) => hostiles.map((target) => {
      const targetDefinition = getDefinition(snapshot, target);
      const range = actionRange(action, definition);
      const distance = spatialDistance(snapshot, actor, target);
      const reachableNow = isValidTarget(snapshot, actor, target, range);
      const canMoveIntoRange = reachableNow || Boolean(bestDestinationTowardTarget(snapshot, actor, target, range, tactics));
      const expectedDamage = expectedDamageAgainst(action, definition, actor, targetDefinition, target);
      const controlValue = action.kind === "area-save" ? 0 : expectedRiderControl(action, definition, targetDefinition, tactics);
      // Stunning Strike: what the target would do with the turn it loses (on the damage scale of 2).
      const denialValue = turnDenialValue(action, definition, targetDefinition, target) * 2;
      const tradeValue = diceTradeValue(snapshot, actor, definition, action, target, targetDefinition, tactics);
      // Subtle Spell: worth its point only when a foe near enough could counter the spell.
      const subtleValue = action.metamagic?.option === "subtle" ? (counterThreatNear(snapshot, actor) ? 4 * Math.max(1, castLevelOf(action) ?? 1) : -2) : 0;
      // Extended Spell: a concentration spell of 2nd level or more is likelier to last (advantage on its saves).
      const extendedValue = action.metamagic?.option === "extended" ? 2 * Math.max(0, (castLevelOf(action) ?? 0) - 1) : 0;
      const chargeValue = expectedChargeValue(snapshot, actor, definition, action, target, range, canMoveIntoRange);
      const preferredBonus = actionMatchesPreference(action, definition, tactics, targetDefinition) ? 8 : 0;
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
      // A single ranged attack, or a routine whose every swing is ranged (a Scout's two longbow shots).
      const shoots = (action.kind === "attack" && action.attackType !== "melee") || (action.kind === "multiattack" && routineIsRanged(action, executables));
      const spacingScore = shoots ? distanceBandScore(distance, tactics) : 0;
      // Shooting with an enemy beside it.
      const threatenedRangedPenalty = shoots && isThreatenedAt(snapshot, actor, actor.position) ? 12 : 0;
      const targetCover = snapshot.rules.cover
        && (shoots || (action.kind === "save" && action.saveAbility === "dex"))
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
      if (denialValue > 0) reasons.push("may take its turn");
      if (tradeValue !== 0 && action.kind === "attack" && action.onHitTerms?.tradesDice) {
        reasons.push(tradeValue > -1 ? `${action.onHitTerms.name} for ${action.onHitTerms.tradesDice.dice} damage ${action.onHitTerms.tradesDice.dice === 1 ? "die" : "dice"}` : `no ${action.onHitTerms.name} without the bonus it spends`);
      }
      if (chargeValue > 0) reasons.push("charges in");
      if (subtleValue > 0) reasons.push("can't be countered");
      if (tagPressure > 0) reasons.push("tagged high-priority");
      if (tagPressure < 0) reasons.push("tagged low-priority");
      let score = expectedDamage * 2
        + controlValue
        + denialValue
        + tradeValue
        + subtleValue
        + extendedValue
        + chargeValue * 2
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
        const area = areaPlanValue(snapshot, actor, definition, action, target, tactics, definitionsById);
        score += area.score;
        reasons.push(...area.reasons);
      } else if (action.kind === "multiattack") {
        // A breath in place of a bite (a chimera's option) is worth what the breath itself would be.
        for (const step of action.attacks) {
          const ability = stepAbility(step, executables);
          if (ability?.kind !== "area-save" || !canPayFor(actor, ability)) continue;
          const area = areaPlanValue(snapshot, actor, definition, ability, target, tactics, definitionsById);
          score += area.score;
          reasons.push(...area.reasons.map((reason) => `${ability.name}: ${reason}`));
        }
      } else if (action.kind === "save") {
        // Hold Person-style upcast: extra in-range hostiles caught for free, valued like the primary target.
        const capacity = upcastExtraTargetCapacity(action);
        if (capacity > 0) {
          const extraTargets = hostiles.filter((hostile) => hostile.id !== target.id && isValidTarget(snapshot, actor, hostile, range)
            && !actionAffectsNothing(action, getDefinition(snapshot, hostile)));
          const bonusCount = Math.min(capacity, extraTargets.length);
          if (bonusCount > 0) {
            score += bonusCount * (expectedDamage + controlValue) * 0.85;
            reasons.push(`hits ${bonusCount} bonus target${bonusCount > 1 ? "s" : ""} from upcasting`);
          }
        }
      }
      return { action, target, range, score, expectedDamage, distance, reachableNow, canMoveIntoRange, reasons };
    }))
    // Pounce's bite needs a prone target its charge hit; Rampage's needs a kill first.
    .filter((plan) => attackPrerequisitesMet(actor, plan.action, plan.target))
    // A swallow only works on a creature the swallower is already grappling.
    .filter((plan) => !(plan.action.kind === "attack" && plan.action.requiresHeld && !(plan.target.conditions ?? []).some((condition) => condition.hold && condition.sourceCombatantId === actor.id)))
    // Someone who already resisted an `immuneAfterSave` action (Frightful Presence) can't be affected by it again.
    .filter((plan) => plan.action.kind === "attack" || plan.action.kind === "multiattack" || !isImmuneAfterSave(actor, plan.target, plan.action))
    // Dominate Person on a construct: nothing it does can touch the target, so don't spend the slot.
    .filter((plan) => !actionAffectsNothing(plan.action, getDefinition(snapshot, plan.target)))
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

/**
 * What an area ability adds to a plan beyond the damage it deals the target: everyone else it catches (an enemy's
 * worth, an ally's risk), scored where the blast will actually land (self-centred and aimed templates included), and
 * a lingering area's hold on the routes enemies are likely to take.
 */
function areaPlanValue(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  definition: CreatureDefinition,
  action: AreaSaveActionDefinition,
  target: CombatantState,
  tactics: TacticsSettings,
  definitionsById: Map<string, CreatureDefinition>
): { score: number; reasons: string[] } {
  const { origin, aimVector, fromSelf } = resolveAreaTargeting(actor, definition, action, target.position);
  const inArea = combatantsInArea(snapshot.map, origin, action.area, snapshot.combatants, definitionsById, aimVector)
    // A self-origin blast never catches its own caster (matches resolution).
    .filter((combatant) => !(fromSelf && combatant.id === actor.id));
  // Abjure Foes: only the creatures it's used on.
  const affected = action.maxTargets === undefined ? inArea
    : chosenAreaTargets(snapshot, actor, action, inArea.filter((combatant) => action.affects === "all" || effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor)));
  const hostiles = affected.filter((combatant) => effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor));
  // Heightened Spell's target and the allies Careful Spell or Sculpt Spells spares, as the engine picks them.
  const { heightenedId, spared } = areaSaveChoices({ snapshot }, actor, action, affected);
  const hostileValue = hostiles.reduce((sum, combatant) => {
    const combatantDefinition = getDefinition(snapshot, combatant);
    return sum
      + expectedDamageAgainst(action, definition, actor, combatantDefinition, combatant, { saveDisadvantage: combatant.id === heightenedId })
      + expectedRiderControl(action, definition, combatantDefinition, tactics)
      + tagPriorityValue(combatant.tags) * tactics.priorityWeight;
  }, 0);
  const allies = affected.filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor));
  // Land's Aid harms only its foes, and wants its ally in it.
  const friendlyRisk = action.healsOneAlly?.length && action.affects === "hostile" ? 0 : allies
    .filter((combatant) => !spared.has(combatant.id))
    .reduce((sum, combatant) => sum + expectedDamageAgainst(action, definition, actor, getDefinition(snapshot, combatant), combatant), 0);
  // Land's Aid: the most hurt ally in it heals, worth what it gets back.
  const healValue = action.healsOneAlly?.length
    ? Math.max(0, ...allies.filter((ally) => ally.state === "active" || ally.state === "downed").map((ally) => Math.min(
      getDefinition(snapshot, ally).maxHp - ally.currentHp,
      action.healsOneAlly!.reduce((sum, component) => sum + averageHealingDice(component.dice), 0))))
    : 0;
  let score = hostileValue * (1.2 + tactics.areaWeight) - friendlyRisk * 2.5 + healValue;
  const reasons = [`${hostiles.length} hostile targets`];
  if (friendlyRisk > 0) reasons.push("friendly fire risk");
  if (healValue > 0) reasons.push("heals an ally");
  if (action.zone) {
    const predictedValue = predictedZoneApproachValue(snapshot, actor, definition, action, origin, aimVector, affected, tactics);
    score += predictedValue * (1.2 + tactics.areaWeight);
    if (predictedValue > 0) reasons.push("blocks a likely approach route");
  }
  return { score, reasons };
}

/**
 * How far overhead (or below) `target` is when a melee `action` from a creature that can't fly simply can't touch it,
 * else `undefined`. That is not a mapping failure to warn about, just a fact of the fight the log should state plainly.
 */
function outOfMeleeReachVertically(snapshot: EncounterSnapshot, actor: CombatantState, target: CombatantState, action: OffensiveAction): number | undefined {
  if (action.kind !== "attack" || action.attackType !== "melee") return undefined;
  if (movementProfileOf(getDefinition(snapshot, actor)).fly) return undefined;
  const gap = Math.abs(combatantHeight(snapshot, actor) - combatantHeight(snapshot, target));
  return gap > (action.reach ?? action.range) ? gap : undefined;
}

function isValidTarget(snapshot: EncounterSnapshot, actor: CombatantState, target: CombatantState, range: number): boolean {
  return spatialDistance(snapshot, actor, target) <= range
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
    .filter((c) => effectiveFaction(snapshot, c) !== effectiveFaction(snapshot, actor) && isTargetable(c) && c.id !== primary.id && isValidTarget(snapshot, actor, c, range))
    .map((c) => ({ combatant: c, value: expectedDamageAgainst(action, definition, actor, getDefinition(snapshot, c), c) }))
    .sort((a, b) => b.value - a.value)
    .map((entry) => entry.combatant);
  const ordered = [primary, ...ranked];
  if (ordered.length === 1) {
    return Array.from({ length: beams }, () => primary.id);
  }
  const perBeam = Math.max(1, expectedDamageAgainst(action, definition, actor, getDefinition(snapshot, primary), primary) / beams);
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
    .filter((c) => effectiveFaction(snapshot, c) !== effectiveFaction(snapshot, actor) && isTargetable(c) && c.id !== primary.id && isValidTarget(snapshot, actor, c, range))
    .filter((c) => !actionAffectsNothing(action, getDefinition(snapshot, c)))
    .sort((a, b) => spatialDistance(snapshot, actor, a) - spatialDistance(snapshot, actor, b))
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
  const plans = findReachableCells(pathingMap, actor.position, footprint, movementBudget, occupied, movementOptionsFor(definition)).map((reachable) => movementPlanForCell(snapshot, actor, target, range, tactics, reachable, movementBudget));

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
  const routeField = pathCostField(pathingMap, target.position, footprint, occupied, movementOptionsFor(definition));
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
  const currentDistance = spatialDistance(snapshot, actor, target);
  const currentNearestHostile = nearestHostileDistanceFrom(snapshot, actor, actor.position);
  const currentCover = tactics.coverWeight > 0 && mapHasCoverWalls(snapshot)
    ? coverFromHostilesAt(snapshot, actor, actor.position)
    : 0;
  const currentScore = distanceBandScore(currentDistance, tactics)
    + Math.min(currentNearestHostile, tactics.preferredMinDistance) / 5
    + (currentCover > 0 ? currentCover * tactics.coverWeight + 4 : 0);
  const candidates = findReachableCells(hazardPathingOverlay(zoneTerrainOverlay(snapshot.map, snapshot.activeZones)), actor.position, footprint, movementBudget, occupied, movementOptionsFor(definition))
    .map((reachable) => movementPlanForCell(snapshot, actor, target, range, tactics, reachable, movementBudget))
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
    (combatant) => effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant)
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
  const alliesOfCaster = snapshot.combatants.filter((combatant) => effectiveFaction(snapshot, combatant) === effectiveFaction(snapshot, actor) && combatant.state === "active");
  if (alliesOfCaster.length === 0) {
    return 0;
  }
  const caughtIds = new Set(alreadyCaught.map((combatant) => combatant.id));
  const otherHostiles = snapshot.combatants.filter((combatant) =>
    effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant) && !caughtIds.has(combatant.id));

  let value = 0;
  for (const hostile of otherHostiles) {
    const hostileDefinition = getDefinition(snapshot, hostile);
    const nearestAlly = alliesOfCaster.reduce<{ ally: CombatantState; distance: number } | null>((closest, ally) => {
      const distance = spatialDistance(snapshot, hostile, ally);
      return !closest || distance < closest.distance ? { ally, distance } : closest;
    }, null)?.ally;
    if (!nearestAlly) {
      continue;
    }
    const path = findPath(snapshot.map, hostile.position, nearestAlly.position, sizeFootprint(hostileDefinition.size));
    if (!path.reachable || !path.cells.some((cell) => zoneCellKeys.has(`${cell.x},${cell.y}`))) {
      continue;
    }
    value += (expectedDamageAgainst(action, definition, actor, hostileDefinition, hostile)
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
      const harmsActor = !(zone.affects === "hostile" && source && effectiveFaction(snapshot, source) === effectiveFaction(snapshot, actor));
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


/**
 * Where a creature that can fly should hold itself over `cell` to deal with `target`, and what getting there costs.
 * A melee flier comes down (or up) only as far as it takes to reach; a ranged one climbs just past the reach of any
 * ground-bound melee foe. Either change is limited to what its movement, after the walk to `cell`, can pay for.
 */
function plannedAltitude(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  cell: Point,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings,
  pathCost: number,
  budget: number
): { altitude: number; cost: number } {
  const definition = getDefinition(snapshot, actor);
  const current = actor.altitude ?? 0;
  if (!movementProfileOf(definition).fly) {
    return { altitude: current, cost: 0 };
  }
  const footprint = sizeFootprint(definition.size);
  const here = footprintGroundHeight(snapshot.map, cell, footprint);
  let desired = current;
  if (tactics.preferred === "melee") {
    const gap = here + current - combatantHeight(snapshot, target);
    if (Math.abs(gap) > range) {
      // Close just enough to strike: down onto the target's level plus reach, or up to its level minus reach.
      desired = gap > 0
        ? Math.floor((combatantHeight(snapshot, target) + range - here) / 5) * 5
        : Math.ceil((combatantHeight(snapshot, target) - range - here) / 5) * 5;
    }
  } else {
    const safe = safeAltitudeAt(snapshot, actor, cell);
    if (safe !== undefined && safe > current) desired = safe;
  }
  desired = Math.max(0, desired);
  const perFoot = altitudeMoveCost(snapshot, definition, 1);
  const spare = Math.max(0, budget - pathCost);
  const affordable = Number.isFinite(perFoot) && perFoot > 0 ? Math.floor(spare / perFoot / 5) * 5 : 0;
  const change = Math.max(-affordable, Math.min(affordable, desired - current));
  return { altitude: current + change, cost: Math.abs(change) * perFoot };
}

/**
 * How high above `cell` a flier must hover to be out of every ground-bound melee foe's reach, or `undefined` when
 * nothing that can only fight on the ground is a threat. Foes that fly, or only shoot, are not helped by height.
 */
function safeAltitudeAt(snapshot: EncounterSnapshot, actor: CombatantState, cell: Point): number | undefined {
  const footprint = sizeFootprint(getDefinition(snapshot, actor).size);
  const here = footprintGroundHeight(snapshot.map, cell, footprint);
  let need: number | undefined;
  for (const hostile of snapshot.combatants) {
    if (effectiveFaction(snapshot, hostile) === effectiveFaction(snapshot, actor) || !isTargetable(hostile)) continue;
    const definition = getDefinition(snapshot, hostile);
    if (movementProfileOf(definition).fly || (hostile.altitude ?? 0) > 0) continue;
    const reaches = getExecutableActions(definition)
      .filter((action) => action.kind === "attack" && action.attackType === "melee" && action.automationSupport === "full")
      .map((action) => (action.kind === "attack" ? action.reach ?? action.range : 0));
    if (reaches.length === 0) continue;
    const above = combatantHeight(snapshot, hostile) + Math.max(...reaches) + 5 - here;
    need = Math.max(need ?? 0, Math.ceil(above / 5) * 5);
  }
  return need;
}

/** After acting, a flier that fights from range climbs out of the reach of foes who can't follow it up. */
function maybeTakeSafeAltitude(state: EngineState, actor: CombatantState, tactics: TacticsSettings): void {
  if (actor.state !== "active" || tactics.preferred === "melee") return;
  const definition = getDefinition(state.snapshot, actor);
  if (!movementProfileOf(definition).fly) return;
  const safe = safeAltitudeAt(state.snapshot, actor, actor.position);
  const current = actor.altitude ?? 0;
  if (safe === undefined || safe <= current) return;
  const perFoot = altitudeMoveCost(state.snapshot, definition, 1);
  const spare = remainingMovementBudget(state.snapshot, actor);
  const affordable = Number.isFinite(perFoot) && perFoot > 0 ? Math.floor(spare / perFoot / 5) * 5 : 0;
  const altitude = Math.min(safe, current + affordable);
  if (altitude <= current) return;
  try {
    moveCombatant(state, actor.id, actor.position, { altitude });
    state.log.push(event(state, "AiDecision", `${actor.displayName} climbs to ${altitude} ft, out of reach of the ground`, {
      combatantId: actor.id, altitude, reason: "out-of-melee-reach"
    }));
  } catch { /* map state moved on */ }
}

function movementPlanForCell(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  range: number,
  tactics: TacticsSettings,
  reachable: ReachableCell,
  budget = remainingMovementBudget(snapshot, actor)
): MovementPlan {
  const { cell, cost: pathCost, cells } = reachable;
  const flight = plannedAltitude(snapshot, actor, cell, target, range, tactics, pathCost, budget);
  // Rising or dropping is movement too, so it counts against the plan like the walk does.
  const cost = pathCost + flight.cost;
  const targetDistance = spatialDistance(snapshot, actor, target, { a: cell, aAltitude: flight.altitude });
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
  return {
    cell, pathCost, targetDistance, score, opportunityThreats: threats, coverBonus,
    ...(movementProfileOf(getDefinition(snapshot, actor)).fly ? { altitude: flight.altitude, altitudeCost: flight.cost } : {})
  };
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
  const candidates = findReachableCells(hazardPathingOverlay(zoneTerrainOverlay(snapshot.map, snapshot.activeZones)), actor.position, footprint, movementBudget, occupied, movementOptionsFor(definition))
    .map((reachable) => ({ reachable, gain: currentCover - targetCoverFrom(snapshot, reachable.cell, footprint, target) }))
    .filter(({ reachable, gain }) => gain > 0
      && spatialDistance(snapshot, actor, target, { a: reachable.cell }) <= range
      && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, reachable.cell, target.position)))
    .map(({ reachable, gain }) => {
      const plan = movementPlanForCell(snapshot, actor, target, range, tactics, reachable, movementBudget);
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

/** Turn Undead: the creature a turned one runs from (its condition's source, while it's still in the fight), if any. */
function fleeSource(snapshot: EncounterSnapshot, actor: CombatantState): CombatantState | undefined {
  const condition = (actor.conditions ?? []).find((entry) => entry.modifiers?.fleesFromSource && entry.sourceCombatantId);
  const source = condition ? snapshot.combatants.find((combatant) => combatant.id === condition.sourceCombatantId) : undefined;
  return source && (source.state === "active" || source.state === "downed") ? source : undefined;
}

/** A turned creature's turn: to the cell it can reach farthest from `from` (the nearest such on a tie), and no more. */
function fleeTurn(state: EngineState, actor: CombatantState, from: CombatantState): void {
  const snapshot = state.snapshot;
  const definition = getDefinition(snapshot, actor);
  const footprint = sizeFootprint(definition.size);
  const here = spatialDistance(snapshot, actor, from);
  const best = findReachableCells(hazardPathingOverlay(zoneTerrainOverlay(snapshot.map, snapshot.activeZones)), actor.position, footprint,
    remainingMovementBudget(snapshot, actor), occupiedCellsFor(snapshot, actor.id), movementOptionsFor(definition))
    .map((reachable) => ({ reachable, distance: spatialDistance(snapshot, actor, from, { a: reachable.cell }) }))
    .filter(({ distance }) => distance > here)
    .sort((a, b) => b.distance - a.distance || a.reachable.cost - b.reachable.cost || a.reachable.cell.y - b.reachable.cell.y || a.reachable.cell.x - b.reachable.cell.x)[0];
  if (best) {
    try {
      moveCombatant(state, actor.id, best.reachable.cell);
      state.log.push(event(state, "AiDecision", `${actor.displayName} flees from ${from.displayName}`, {
        combatantId: actor.id, sourceId: from.id, destination: best.reachable.cell, reason: "flee"
      }));
      return;
    } catch { /* the board moved on */ }
  }
  state.log.push(event(state, "AiDecision", `${actor.displayName} can't get any farther from ${from.displayName}`, {
    combatantId: actor.id, sourceId: from.id, reason: "flee-cornered"
  }));
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
    .filter((combatant) => effectiveFaction(snapshot, combatant) !== effectiveFaction(snapshot, actor) && isTargetable(combatant))
    .map((combatant) => spatialDistance(snapshot, actor, combatant, { a: position }));
  return Math.min(Number.POSITIVE_INFINITY, ...distances);
}

function isThreatenedAt(snapshot: EncounterSnapshot, actor: CombatantState, position: Point): boolean {
  return snapshot.combatants.some((hostile) => {
    if (effectiveFaction(snapshot, hostile) === effectiveFaction(snapshot, actor) || hostile.state !== "active") {
      return false;
    }
    const definition = getDefinition(snapshot, hostile);
    return getExecutableActions(definition).some((action) => {
      if (action.kind !== "attack" || action.attackType !== "melee" || action.automationSupport !== "full") {
        return false;
      }
      const reach = action.reach ?? action.range;
      return spatialDistance(snapshot, hostile, actor, { b: position }) <= reach
        && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, hostile.position, position));
    });
  });
}

function threatensWoundedAlly(snapshot: EncounterSnapshot, actor: CombatantState, hostile: CombatantState): boolean {
  return snapshot.combatants.some((ally) => {
    if (effectiveFaction(snapshot, ally) !== effectiveFaction(snapshot, actor) || ally.id === actor.id || ally.state !== "active") {
      return false;
    }
    const definition = getDefinition(snapshot, ally);
    const wounded = ally.currentHp <= Math.floor(definition.maxHp / 2);
    // A `protected` ally is guarded at full HP too, not just once it's bloodied.
    const guarded = wounded || Boolean(ally.tags?.includes("protected"));
    return guarded && spatialDistance(snapshot, hostile, ally) <= 5;
  });
}

function canPayResource(actor: CombatantState, action: ActionDefinition, executables?: ActionDefinition[]): boolean {
  if ("resourceCost" in action && action.resourceCost && (actor.resources?.[action.resourceCost.resourceId] ?? 0) < action.resourceCost.amount) {
    return false;
  }
  // Metamagic's sorcery points, and Quickened Spell's rule about level 1+ spells this turn.
  if (action.extraCost && (actor.resources?.[action.extraCost.resourceId] ?? 0) < action.extraCost.amount) return false;
  if (spellTurnProblem(actor, action)) return false;
  if (onlyWhenEmptyProblem(actor, action)) return false;
  if (whileConditionProblem(actor, action)) return false;
  // Lay on Hands: anything left in its pool.
  if (action.kind === "healing" && action.fromPool && (actor.resources?.[action.fromPool.resourceId] ?? 0) <= 0) {
    return false;
  }
  // The same spell for a pricier slot isn't a choice while a cheaper one is left.
  if (isDominatedUpcast(actor, action)) {
    return false;
  }
  // A routine needs every ability it names: an option that breathes fire isn't offered while the breath recharges.
  return action.kind !== "multiattack" || !executables || multiattackPayable(actor, action, executables);
}

/** Whether a routine only ever shoots: every attack its swings could make is ranged (a Scout's two longbow shots). */
function routineIsRanged(action: Extract<ActionDefinition, { kind: "multiattack" }>, executables: ActionDefinition[]): boolean {
  const attacks = action.attacks.flatMap((step) => swingCandidates(step, executables));
  return attacks.length > 0 && attacks.every((attack) => attack.attackType !== "melee");
}

/** Whether every step of a routine can be made: its abilities paid for, and each attack step with something to swing. */
function multiattackPayable(actor: CombatantState, action: Extract<ActionDefinition, { kind: "multiattack" }>, executables: ActionDefinition[]): boolean {
  return action.attacks.every((step) => {
    const ability = stepAbility(step, executables);
    if (ability) return canPayFor(actor, ability);
    return swingCandidates(step, executables).some((candidate) => canPayFor(actor, candidate));
  });
}

/**
 * Scoring weight for spending an action's resourceCost. A spell slot's real
 * scarcity is its tier, not the flat `amount` (always 1 whether it's a slot-1
 * or a slot-9) — spending a higher slot should look pricier even though every
 * `spellUpcastVariants` tier "costs 1". Non-slot resources (ki points, item
 * charges) keep the flat amount-based weight.
 */
function resourceCostWeight(action: ActionDefinition): number {
  // Metamagic: a sorcery point is weighed like a point of any pool, on top of the slot. Breath Weapon in place of an
  // attack: the breath's use, which the routine spends.
  const extra = (action.extraCost?.amount ?? 0) + (action.withReplacement?.resourceCost?.amount ?? 0);
  if (!("resourceCost" in action) || !action.resourceCost) {
    return extra;
  }
  return extra + baseCostWeight(action as ActionDefinition & { resourceCost: NonNullable<ActionDefinition["extraCost"]> });
}

function baseCostWeight(action: ActionDefinition & { resourceCost: NonNullable<ActionDefinition["extraCost"]> }): number {
  // Legendary points are use-it-or-lose-it each round, so a point is worth little — just enough to prefer
  // three 1-point attacks over one 3-point option that does no more.
  if (action.resourceCost.resourceId === LEGENDARY_POINTS) return action.resourceCost.amount * 0.2;
  // An item: a potion, a flask or a scroll is gone for good (a slot or a charge comes back after a rest), and a scroll
  // is never cheaper than a slot of its spell's level; a wand's charge is priced like any other pool's.
  if (action.item) {
    return action.item.consumes ? action.resourceCost.amount * Math.max(2, castLevelOf(action) ?? 0) : action.resourceCost.amount;
  }
  const weight = spellSlotLevel(action.resourceCost.resourceId) ?? action.resourceCost.amount;
  // A recharge ability comes back on its own (a Recharge 5-6 breath in ~3 turns), so spending it is cheap.
  const usage = "usage" in action ? action.usage : undefined;
  if (usage?.kind === "recharge" && usage.recharge) {
    const die = usage.recharge.die ?? 6;
    const chance = Math.min(1, (die - usage.recharge.min + 1) / die);
    return weight * (1 - chance);
  }
  return weight;
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
    ? chanceToHit(resolveAttackBonus(action, source), armorClassOf(target).total)
    : undefined;
  const failChance = (action.kind === "save" || action.kind === "area-save")
    ? chanceToFailSave(resolveSaveDc(action, source), target.saves?.[action.saveAbility] ?? abilityModifier(target.abilities[action.saveAbility]))
    : undefined;
  return riderTriggerChance(rider.when, { landChance, failChance });
}

function actionMatchesPreference(
  action: OffensiveAction,
  source: ReturnType<typeof getDefinition>,
  tactics: TacticsSettings,
  /** When known, condition riders it is immune to don't make an action "on-profile" for a controller. */
  target?: ReturnType<typeof getDefinition>
): boolean {
  // control-focused profiles treat a save-or-condition / rider action as on-profile.
  if (tactics.controlWeight >= 15 && actionImposesConditions(action, source, target)) {
    return true;
  }
  if (action.kind === "attack") {
    return tactics.preferred === "ranged"
      ? action.attackType === "ranged" || action.attackType === "spell"
      : action.attackType === "melee";
  }
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    return action.attacks.some((step) => swingCandidates(step, actions).some((child) => actionMatchesPreference(child, source, tactics, target)));
  }
  return tactics.preferred === "ranged";
}

/**
 * A single-target action that can't touch this creature at all: no damage of its own, and every effect it carries is
 * for other creature types (Dominate Person on anything but a humanoid). Area actions aren't judged by their aim point.
 */
function actionAffectsNothing(action: OffensiveAction, target: ReturnType<typeof getDefinition>): boolean {
  if ((action.kind !== "save" && action.kind !== "attack") || action.damage.length) {
    return false;
  }
  const effects = (action.riders ?? []).filter((rider) => rider.kind !== "note");
  return effects.length > 0 && effects.every((rider) => !riderAffectsCreatureType(rider, target));
}

/** True when the action (or a multiattack child) carries a `condition` rider. */
function actionImposesConditions(action: OffensiveAction, source: ReturnType<typeof getDefinition>, target?: ReturnType<typeof getDefinition>): boolean {
  // A condition rider counts unless the target is known to be immune to that condition, or of a type it skips.
  const lands = (rider: ActionRider) => rider.kind === "condition"
    && !(target && (isImmuneToCondition(target, typeof rider.condition === "string" ? rider.condition : rider.condition.custom)
      || !riderAffectsCreatureType(rider, target)));
  if (action.kind === "attack" || action.kind === "save" || action.kind === "area-save") {
    return (action.riders ?? []).some(lands);
  }
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    return action.attacks.some((step) => swingCandidates(step, actions).some((child) => (child.riders ?? []).some(lands)));
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
  target: ReturnType<typeof getDefinition>,
  targetCombatant?: CombatantState,
  options: { saveDisadvantage?: boolean } = {}
): number {
  const casterLevel = source.character?.level ?? 1;
  // The target's resistances, immunities, vulnerabilities and absorption — with its live conditions and
  // features when we have the combatant (a raging Barbarian resists), else just its definition.
  const adjustments = targetCombatant ? damageAdjustmentsFor(target, targetCombatant) : target.damageAdjustments;
  if (action.kind === "attack") {
    const perHit = averageDamage(action, source, adjustments) + averageAttackFeatureDamage(action, source, sourceCombatant, target, new Set())
      + averageMarkDamage(source, sourceCombatant, targetCombatant, adjustments) + empoweredGain(action);
    const beams = action.attackDelivery === "beams" ? resolveBeamCount(action, casterLevel, spellSlotLevel(action.resourceCost?.resourceId)) : 1;
    const hitChance = action.autoHit ? 1 : chanceToHit(resolveAttackBonus(action, source), armorClassOf(target).total);
    // Potent Cantrip: half the damage on a miss.
    const onMiss = action.halfDamageOnMiss ? averageDamage(action, source, adjustments) * 0.5 * (1 - hitChance) * beams : 0;
    return perHit * hitChance * beams + onMiss + expectedRiderDamage(action, source, target, { landChance: hitChance, beams });
  }
  if (action.kind === "save" || action.kind === "area-save") {
    const average = averageDamage(action, source, adjustments) + empoweredGain(action);
    // Heightened Spell: a single target's save is at disadvantage (an area's chosen one, `options.saveDisadvantage`).
    const heightened = options.saveDisadvantage === true || (action.kind === "save" && action.metamagic?.option === "heightened");
    const failChance = chanceToFailSave(
      resolveSaveDc(action, source),
      target.saves?.[action.saveAbility] ?? abilityModifier(target.abilities[action.saveAbility]),
      targetHasSaveAdvantage(target, action, action.saveAbility, riderConditionNames(action), targetCombatant),
      heightened
    );
    const damageEv = average * (failChance + (saveOnSuccessIsHalf(action) ? (1 - failChance) * 0.5 : 0));
    return damageEv + expectedRiderDamage(action, source, target, { failChance });
  }
  if (action.kind === "multiattack") {
    // Each swing with its best attack: a power attack where it pays, a ranged one for a "ranged" swing.
    return multiattackExpectedDamage(action, source, sourceCombatant, target, targetCombatant);
  }
  return averageDamage(action, source, adjustments);
}

function chanceToHit(attackBonus: number, armorClass: number): number {
  const needed = armorClass - attackBonus;
  return clamp((21 - needed) / 20, 0.05, 0.95);
}

/**
 * Whether the target has advantage on the save this action forces — Magic Resistance against a spell, Fey
 * Ancestry against a charm — judged from the target's own features (auras aside). Advantage roughly squares the
 * chance of failing, which is how a control spell should be weighed against a creature that resists it.
 */
function targetHasSaveAdvantage(
  target: ReturnType<typeof getDefinition>,
  action: OffensiveAction,
  ability: Ability,
  conditions: ConditionName[],
  targetCombatant?: CombatantState
): boolean {
  const sourceAction = {
    spellLevel: "spellLevel" in action ? action.spellLevel : undefined,
    magical: ("magical" in action && action.magical === true) || (action.kind === "attack" && action.attackType === "spell") || undefined
  };
  return featureSources(target, targetCombatant).some((feature) => (feature.effects ?? []).some(
    (effect) => effect.kind === "save-advantage" && saveAdvantageApplies(effect, { ability, sourceAction, conditions })
  ));
}

/** The named conditions an action's riders would inflict, for "advantage against being charmed" style checks. */
function riderConditionNames(action: OffensiveAction): ConditionName[] {
  const riders = "riders" in action ? action.riders ?? [] : [];
  return riders.flatMap((rider) => (rider.kind === "condition" && typeof rider.condition === "string" ? [rider.condition] : []));
}

function chanceToFailSave(dc: number, saveBonus: number, advantage = false, disadvantage = false): number {
  const successChance = clamp((21 - (dc - saveBonus)) / 20, 0.05, 0.95);
  const failChance = 1 - successChance;
  if (advantage && disadvantage) return failChance;
  // Disadvantage (Heightened Spell): it fails unless both dice succeed.
  if (disadvantage) return 1 - successChance * successChance;
  return advantage ? failChance * failChance : failChance;
}

/**
 * Empowered Spell's expected gain: the lowest dice below average rolled again, up to its count, each such die worth a
 * quarter of its size more on average (a d6 below 3.5 averages 2; rerolled, 3.5).
 */
function empoweredGain(action: OffensiveAction): number {
  const count = action.rerollDamageDice ?? 0;
  if (!count || !("damage" in action)) return 0;
  const first = action.damage[0];
  const match = first ? /^(\d+)d(\d+)/.exec(first.dice) : null;
  if (!match) return 0;
  const dice = Number(match[1]);
  const sides = Number(match[2]);
  // About half the dice come up below average; the reroll takes the lowest of them.
  return Math.min(count, Math.ceil(dice / 2)) * (sides + 1) / 4 * 1.5;
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
  target: ReturnType<typeof getDefinition>,
  ctx: { landChance?: number; failChance?: number; beams?: number }
): number {
  const riders = "riders" in action ? action.riders ?? [] : [];
  let total = 0;
  for (const rider of riders) {
    if (rider.kind !== "damage" || !riderAffectsCreatureType(rider, target)) {
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

/**
 * Whether the actor's current concentration is still doing something — a
 * live condition it's sourcing on an active combatant (Dominate Person/Beast,
 * Hold Person, Bless...) or a zone it's sustaining (Cloudkill, Spike Growth,
 * Moonbeam). Casting another concentration action would silently break it
 * (`breakConcentration` in combat.ts sweeps it away the instant the new one
 * resolves), so candidates flagged `concentration` are filtered out while
 * this is true — recasting Dominate Person while an earlier target is still
 * dominated, or a fresh Bless over one still buffing the party, is never
 * worth the trade. Once the sustained effect ends on its own (save, death,
 * a failed concentration check), this goes false and the AI is free to cast
 * a new one.
 */
function hasWorkingConcentrationEffect(snapshot: EncounterSnapshot, actor: CombatantState): boolean {
  if (!actor.concentration) {
    return false;
  }
  const sustainsCondition = snapshot.combatants.some((combatant) =>
    combatant.state === "active"
    && (combatant.conditions ?? []).some((condition) => condition.concentration && condition.sourceCombatantId === actor.id));
  if (sustainsCondition) {
    return true;
  }
  return (snapshot.activeZones ?? []).some((zone) => zone.concentration && zone.sourceCombatantId === actor.id);
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
    // A Hold Person on something immune to paralysis is worth nothing; so is a Dominate Person on a non-humanoid.
    if (isImmuneToCondition(target, typeof rider.condition === "string" ? rider.condition : rider.condition.custom)
      || !riderAffectsCreatureType(rider, target)) {
      continue;
    }
    const severity = conditionSeverity(name);
    total += tactics.controlWeight * riderLandChance(action, rider, source, target) * severity;
  }
  return total;
}

type ConditionRider = Extract<ActionRider, { kind: "condition" }>;

/**
 * Roughly what a weapon's mastery adds to a hit, on the damage scale: Sap a fifth of the target's threat, Topple a
 * prone target's worth when its save fails, Vex an easier next swing; Push and Slow a little; the rest nothing here
 * (Graze's damage, Cleave's and Nick's extra attacks are counted where they happen).
 */
function masteryWorth(mastery: WeaponMastery, attack: AttackAction, source: CreatureDefinition, target: CreatureDefinition, hitChance: number): number {
  switch (mastery) {
    case "sap": return hitChance * threatPerRound(target) * 0.2;
    case "topple": {
      const dc = 8 + abilityModifier(source.abilities[attack.ability]) + (source.proficiencyBonus ?? 2);
      return hitChance * chanceToFailSave(dc, target.saves?.con ?? abilityModifier(target.abilities.con)) * 2.5;
    }
    case "vex": return hitChance * 1.5;
    case "push":
    case "slow": return hitChance * 0.5;
    default: return 0;
  }
}

/** Conditions that take a creature's turn from it. */
const TURN_TAKING: ReadonlySet<ConditionName> = new Set<ConditionName>(["stunned", "paralyzed", "incapacitated", "unconscious", "petrified"]);

/**
 * Stunning Strike: an on-hit upgrade paid for when it lands (`costPaidOnHit`) that takes the target's turn is worth what
 * the target would deal in that turn, at the chance it lands; nothing on a target already out of it. Only such paid
 * upgrades: a monster's own riders keep their tactics' control weights.
 */
function turnDenialValue(action: OffensiveAction, source: CreatureDefinition, target: CreatureDefinition, targetCombatant?: CombatantState): number {
  if (action.kind !== "attack" || !action.costPaidOnHit) return 0;
  if ((targetCombatant?.conditions ?? []).some((condition) => TURN_TAKING.has(condition.name))) return 0;
  const riders = (action.riders ?? []).filter((rider): rider is ConditionRider => rider.kind === "condition" && Boolean(rider.resourceCost)
    && typeof rider.condition === "string" && TURN_TAKING.has(rider.condition) && !isImmuneToCondition(target, rider.condition)
    && riderAffectsCreatureType(rider, target));
  if (!riders.length) return 0;
  // A creature the hit itself likely drops loses nothing to a stun.
  const hit = averageDamage(action, source);
  const left = targetCombatant?.currentHp ?? target.maxHp;
  const survives = left > hit * 1.5 ? 1 : left > hit ? 0.5 : 0.1;
  const threat = threatPerRound(target);
  return Math.max(...riders.map((rider) => riderLandChance(action, rider, source, target) * threat)) * survives;
}

/** What a creature deals in a turn, roughly: its best offensive action's average damage, at a typical chance to land. */
const threatByDefinition = new WeakMap<CreatureDefinition, number>();

function threatPerRound(definition: CreatureDefinition): number {
  const known = threatByDefinition.get(definition);
  if (known !== undefined) return known;
  const actions = getExecutableActions(definition).filter((action) => action.actionType === "action" && action.automationSupport === "full"
    && (action.kind === "attack" || action.kind === "save" || action.kind === "area-save" || action.kind === "multiattack"));
  const threat = Math.max(0, ...actions.map((action) => averageDamage(action, definition))) * 0.65;
  threatByDefinition.set(definition, threat);
  return threat;
}

/** "poisoned and stunned". */
function joinNames(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Resource conversions worth making at the start of its turn: a spell slot made (Font of Magic's from sorcery points, a
 * bonus action; Wild Resurgence's from a Wild Shape use, no action) once it has none left, the highest it can afford;
 * and a pool it spends that has run dry (Bardic Inspiration, Wild Shape) topped up with its lowest slot, no action,
 * unless it's conservative.
 */
function takeResourceConversions(state: EngineState, actor: CombatantState): void {
  const executables = getExecutableActions(getDefinition(state.snapshot, actor));
  const conversions = executables.filter((action): action is Extract<ActionDefinition, { kind: "activate-feature" }> =>
    action.kind === "activate-feature" && Boolean(action.gains) && action.automationSupport === "full" && canPayResource(actor, action));
  if (!conversions.length) return;
  const convert = (action: Extract<ActionDefinition, { kind: "activate-feature" }>, why: string) => {
    state.log.push(event(state, "AiDecision", `${actor.displayName} chose ${action.name}`, { combatantId: actor.id, actionId: action.id, reasons: [why], slot: action.actionType }));
    resolveActivateFeatureAction(state, actor.id, action.id);
  };
  const slotsLeft = Object.entries(actor.resources ?? {}).some(([id, count]) => spellSlotLevel(id) !== undefined && count > 0);
  if (!slotsLeft) {
    const make = conversions
      .filter((action) => spellSlotLevel(action.gains!.resourceId) !== undefined && (action.actionType === "free" || (action.actionType === "bonus" && canAct(actor, "bonus"))))
      .sort((a, b) => spellSlotLevel(b.gains!.resourceId)! - spellSlotLevel(a.gains!.resourceId)! || (a.actionType === "free" ? -1 : 1))[0];
    if (make) convert(make, "no spell slots left");
  }
  if (actor.resourceStance === "conservative") return;
  const refilled = new Set<string>();
  const fromSlots = conversions
    .filter((action) => action.actionType === "free" && spellSlotLevel(action.resourceCost?.resourceId) !== undefined && spellSlotLevel(action.gains!.resourceId) === undefined)
    .sort((a, b) => spellSlotLevel(a.resourceCost?.resourceId)! - spellSlotLevel(b.resourceCost?.resourceId)!);
  for (const action of fromSlots) {
    const pool = action.gains!.resourceId;
    if (refilled.has(pool) || (actor.resources?.[pool] ?? 0) > 0 || !canPayResource(actor, action)) continue;
    // Only a pool something it can do spends (not the conversions themselves).
    const spent = executables.some((other) => other.id !== action.id && !(other.kind === "activate-feature" && other.gains)
      && "resourceCost" in other && other.resourceCost?.resourceId === pool);
    if (!spent) continue;
    refilled.add(pool);
    convert(action, `no ${pool.replace(/[-_]+/g, " ")} left`);
  }
}

/** Whether a foe within 60 ft could counter a spell `actor` casts now: a counter it can pay for, with its reaction. */
function counterThreatNear(snapshot: EncounterSnapshot, actor: CombatantState): boolean {
  const faction = effectiveFaction(snapshot, actor);
  return snapshot.combatants.some((foe) => effectiveFaction(snapshot, foe) !== faction && canAct(foe, "reaction")
    && spatialDistance(snapshot, actor, foe) <= 60
    && getExecutableActions(getDefinition(snapshot, foe)).some((action) => action.actionType === "reaction"
      && "reaction" in action && action.reaction?.trigger.kind === "enemy-casts-spell" && canPayResource(foe, action)));
}

/**
 * An on-hit option paid in dice of a damage bonus (Cunning Strike), weighed against the plain attack. Unless that
 * bonus looks set to land, its riders and move won't come: what they'd add is taken back, and a little more so the
 * plain attack wins. When it does: the move's worth (a skirmisher with a foe beside it), less the dice given up (their
 * average at the chance to hit, on the damage scale of 2). Its riders' control is counted with the attack's own.
 */
function diceTradeValue(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  definition: CreatureDefinition,
  action: OffensiveAction,
  target: CombatantState,
  targetDefinition: CreatureDefinition,
  tactics: TacticsSettings,
  log?: CombatLogEvent[]
): number {
  const terms = action.kind === "attack" ? action.onHitTerms : undefined;
  if (action.kind !== "attack" || !terms?.tradesDice) return 0;
  if (!damageBonusExpected(snapshot, actor, target, action, terms.tradesDice.featureId, log)) {
    const own = (action.riders ?? []).filter((rider) => rider.group === terms.group);
    return -1 - expectedRiderControl({ ...action, riders: own }, definition, targetDefinition, tactics);
  }
  const hitChance = action.autoHit ? 1 : chanceToHit(resolveAttackBonus(action, definition), armorClassOf(targetDefinition).total);
  const move = terms.move && tactics.reposition && isThreatenedAt(snapshot, actor, actor.position) ? 6 : 0;
  return move - diceTradeCost(definition, terms.tradesDice) * hitChance * 2;
}

/** Chance a `condition` rider lands on `target`: always, on a failed save, or on a hit it doesn't save against. */
function riderLandChance(
  action: OffensiveAction,
  rider: ConditionRider,
  source: ReturnType<typeof getDefinition>,
  target: ReturnType<typeof getDefinition>
): number {
  if (rider.when === "always") {
    return 1;
  }
  if (rider.when === "on-save-fail") {
    return (action.kind === "save" || action.kind === "area-save")
      ? chanceToFailSave(
        resolveSaveDc(action, source),
        target.saves?.[action.saveAbility] ?? abilityModifier(target.abilities[action.saveAbility]),
        targetHasSaveAdvantage(target, action, action.saveAbility, riderConditionNames(action))
      )
      : 0.5;
  }
  if (rider.when === "on-hit") {
    const hitChance = action.kind === "attack"
      ? (action.autoHit ? 1 : chanceToHit(resolveAttackBonus(action, source), armorClassOf(target).total))
      : 1;
    // a rider that negates on its own save only lands when that save fails
    const negateChance = rider.save && rider.save.onSuccess === "negates"
      ? 1 - chanceToFailSave(
        riderSaveDc(rider, source, riderFallbackAbility(action)),
        target.saves?.[rider.save.ability] ?? abilityModifier(target.abilities[rider.save.ability]),
        targetHasSaveAdvantage(target, action, rider.save.ability, typeof rider.condition === "string" ? [rider.condition] : [])
      )
      : 0;
    return hitChance * (1 - negateChance);
  }
  return 0;
}

export function averageHealing(action: HealingAction, source: ReturnType<typeof getDefinition>): number {
  // Supreme Healing gives the dice their highest; Disciple of Life adds 2 + the slot's level.
  const bonus = healingBonusOf(source);
  const maximize = bonus.maximize && maximizableHealing(action);
  const base = action.healing.reduce((sum, component) => {
    const parsed = parseDiceExpression(component.dice);
    const diceAverage = parsed.terms.reduce((termSum, term) => termSum + term.sign * term.count * (maximize ? term.sides : (term.sides + 1) / 2), 0) + parsed.modifier;
    const abilityBonus = component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0;
    return sum + diceAverage + abilityBonus;
  }, 0);
  const slot = healingSlotLevel(action);
  return base + averageUpcastDiceBonus(action, maximize) + (bonus.slotBonus && slot !== undefined ? 2 + slot : 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** An action's average damage on a hit (or a failed save): the AI's estimate, and the previews'. */
export function averageDamage(
  action: ActionDefinition,
  source: ReturnType<typeof getDefinition>,
  /** The target's defenses: each component's average is scaled by how much of that damage type gets through. */
  targetAdjustments?: CreatureDefinition["damageAdjustments"],
  /** A critical hit: every die rolled twice. */
  critical = false
): number {
  if (action.kind === "healing" || action.kind === "reposition" || action.kind === "buff" || action.kind === "unsupported" || action.kind === "activate-feature" || action.kind === "utility" || action.kind === "summon" || action.kind === "transform") {
    return 0;
  }
  if (action.kind === "multiattack") {
    // Each swing with the attack it makes when nobody chooses (its own, or a generic step's hardest-hitting).
    const actions = getExecutableActions(source);
    return swingsOf(action.attacks).reduce((sum, swing) => {
      const attack = defaultSwingAttack(swing.step, swingCandidates(swing.step, actions));
      return sum + (attack ? averageDamage(attack, source, targetAdjustments, critical) : 0);
    }, 0);
  }
  // Overchannel: every die at its highest.
  const maximize = action.maximizeDamage === true;
  const base = action.damage.reduce((sum, component) => sum + averageDamageComponent(component, source, critical, maximize) * defenseMultiplier(component, targetAdjustments, source), 0);
  return base + averageUpcastDiceBonus(action, maximize) * (critical ? 2 : 1);
}

/** How many extra targets a save action's upcast grants for free at whatever slot tier its own `resourceCost` implies (Hold Person-style). 0 for a base cast or an action with no `upcast.targets`. */
export function upcastExtraTargetCapacity(action: Extract<ActionDefinition, { kind: "save" }>): number {
  const perSlotTargets = action.upcast?.perSlotAboveBase?.targets;
  if (!perSlotTargets || action.spellLevel == null) {
    return 0;
  }
  const slotLevel = spellSlotLevel(action.resourceCost?.resourceId);
  const slotsAboveBase = slotLevel != null ? Math.max(0, slotLevel - action.spellLevel) : 0;
  // Twinned Spell: an effective level higher.
  const twinned = action.metamagic?.option === "twinned" ? 1 : 0;
  return (slotsAboveBase + twinned) * perSlotTargets;
}

/** Expected value of an action's upcast damage-dice bonus at whatever slot tier its own `resourceCost` implies (0 for a base cast, or an action with no `upcast`). */
function averageUpcastDiceBonus(action: Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" | "healing" }>, maximize = false): number {
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
  return parsed.terms.reduce((sum, term) => sum + term.sign * term.count * (maximize ? term.sides : (term.sides + 1) / 2), 0) + parsed.modifier;
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
/**
 * What a charge adds to an attack against `target` (Charge, Pounce, Trampling Charge): its extra damage, the value of
 * knocking the target down, and the bonus-action follow-up it unlocks. Only counted when the charge will actually
 * happen — the attacker has already closed the distance this turn, or it has to cover at least that much ground
 * straight at the target to reach it.
 */
function expectedChargeValue(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  definition: CreatureDefinition,
  action: OffensiveAction,
  target: CombatantState,
  range: number,
  canMoveIntoRange: boolean
): number {
  if (action.kind !== "attack" || action.attackType !== "melee") return 0;
  let value = 0;
  for (const feature of featureEffectSources(definition, actor)) {
    for (const effect of feature.effects ?? []) {
      const charged = ("condition" in effect && effect.condition === "charged") || ("allConditions" in effect && effect.allConditions?.includes("charged"));
      if (!charged || !featureAppliesToExpectedAction(effect, action)) continue;
      const feet = ("chargeFeet" in effect ? effect.chargeFeet : undefined) ?? 20;
      const willCharge = hasChargedAt(snapshot, actor, target, feet)
        || (canMoveIntoRange && gridDistance(actor.position, target.position, snapshot.map.grid) - range >= feet);
      if (!willCharge) continue;
      if (effect.kind === "damage-bonus") value += effect.damage.reduce((sum, component) => sum + averageOfDice(component.dice), 0);
      if (effect.kind === "apply-condition-on-hit") value += 6;
    }
  }
  if (value <= 0) return 0;
  // A charge hit also opens its bonus-action follow-up (Pounce's bite, a trampling stomp).
  const followUp = getExecutableActions(definition).find((candidate) => candidate.kind === "attack" && candidate.onlyAfter === "charge-hit");
  if (followUp) value += averageDamage(followUp, definition) * 0.6;
  return value;
}


function featureAppliesToExpectedAction(effect: FeatureEffect, action: Extract<ActionDefinition, { kind: "attack" }>): boolean {
  if ("actionIds" in effect && effect.actionIds && !effect.actionIds.includes(upcastBaseId(action.id))) {
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
  return [...simulatedFeatures(source), ...activeConditionSources];
}

function hasOnlyAlwaysExpectedConditions(effect: FeatureEffect): boolean {
  const required = [
    ...("condition" in effect && effect.condition ? [effect.condition] : []),
    ...("allConditions" in effect && effect.allConditions ? effect.allConditions : [])
  ];
  const alternatives = "anyConditions" in effect && effect.anyConditions ? effect.anyConditions : [];
  return required.every((condition) => condition === "always") && alternatives.length === 0 && !("targetMarked" in effect && effect.targetMarked);
}

/**
 * How much of a damage component gets through the target's defenses (0 immune … −1 absorbed, which would
 * heal it). For "choose one of these types" components the wielder picks the best. Types that depend on the
 * attack ("same as attack") aren't known here and count as full.
 */
function defenseMultiplier(
  component: Extract<ActionDefinition, { kind: "attack" }>["damage"][number],
  targetAdjustments: CreatureDefinition["damageAdjustments"],
  /** Whose damage it is: its Boon of Irresistible Offense counts. */
  source?: CreatureDefinition
): number {
  if (!targetAdjustments?.length) {
    return 1;
  }
  const ignoresResistance = source ? ignoredResistances(source) : undefined;
  const origin = { magical: component.magical === true, material: component.material, ...(ignoresResistance ? { ignoresResistance } : {}) };
  if (component.damageTypeOptions?.length) {
    return Math.max(...component.damageTypeOptions.map((type) => damageAdjustmentMultiplier(type, targetAdjustments, origin)));
  }
  return component.damageType === "same-as-attack" ? 1 : damageAdjustmentMultiplier(component.damageType, targetAdjustments, origin);
}

/** A heal's dice on average ("2d6" → 7). */
function averageHealingDice(dice: string): number {
  try {
    const parsed = parseDiceExpression(dice);
    return parsed.terms.reduce((sum, term) => sum + term.sign * term.count * ((term.sides + 1) / 2), 0) + parsed.modifier;
  } catch {
    return 0;
  }
}

/** The damage types whose resistance a creature's damage ignores, kept per definition. */
const ignoredResistancesByDefinition = new WeakMap<CreatureDefinition, ReturnType<typeof resistanceIgnoredBy>>();

function ignoredResistances(definition: CreatureDefinition): ReturnType<typeof resistanceIgnoredBy> {
  if (!ignoredResistancesByDefinition.has(definition)) ignoredResistancesByDefinition.set(definition, resistanceIgnoredBy(definition));
  return ignoredResistancesByDefinition.get(definition);
}

function averageDamageComponent(component: Extract<ActionDefinition, { kind: "attack" }>["damage"][number], source: ReturnType<typeof getDefinition>, critical = false, maximize = false): number {
  const casterLevel = source.character?.level ?? 1;
  const parsed = parseDiceExpression(resolveScaledDamage(component.dice, component.scaling, { casterLevel }));
  const diceAverage = parsed.terms.reduce((termSum, term) => termSum + term.sign * term.count * (maximize ? term.sides : (term.sides + 1) / 2), 0) * (critical ? 2 : 1) + parsed.modifier;
  const abilityBonus = component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0;
  const formulaBonus = resolveNumericFormula(component.bonusFormula, source);
  return diceAverage + abilityBonus + formulaBonus;
}

function actionRange(action: OffensiveAction, source: ReturnType<typeof getDefinition>): number {
  if (action.kind === "multiattack") {
    const actions = getExecutableActions(source);
    // A step reaches as far as its farthest attack (a generic step's longbow). The routine closes in to the
    // *shortest* step's reach, so every swing can land on the target: a 5 ft beard and a 10 ft glaive want 5 ft.
    const ranges = action.attacks.flatMap((step) => {
      const reaches = swingCandidates(step, actions).map(attackReach);
      return reaches.length ? [Math.max(...reaches)] : [];
    });
    return ranges.length > 0 ? Math.min(...ranges) : 0;
  }
  return action.kind === "attack" && action.attackType === "melee" ? action.reach ?? action.range : action.kind === "attack" ? action.longRange ?? action.range : action.range;
}

/* ─── Counters: is a spell worth stopping? ─────────────────────────────────────
 * The engine knows which slot stops which spell and the chance of a check (`counterOutlook`, combat.ts); this decides
 * whether to, and with which slot. It weighs what the spell would do if let through (`spellThreat`) against the slot,
 * priced the way the AI prices a slot when spending it on its own spells.
 */

/** What dropping a creature is worth, in expected hit points: the AI's default kill weight. */
const DOWN_VALUE = 18;
/** A buff put up on one of the caster's side: the base `selectBuffAction` gives putting one up. */
const BUFF_TARGET_VALUE = 15;
/** The longest a condition is counted as lasting, in turns. */
const MAX_TURNS_HELD = 3;
/** A slot's price per level: the ×4 `selectOffensivePlan` pays for one (`resourceCostWeight` of a slot is its level). */
const SLOT_PRICE = 4;
/** Spending the reaction when it may still want it for something else before its next turn (Shield, an opportunity attack). */
const REACTION_COST = 2;

/**
 * What a spell being cast would do to `reactor`'s side if it isn't stopped — `areaPlanValue` seen from the other side.
 * For each creature it's declared at: expected damage (with the save, half on a save, resistances, riders and upcast
 * dice of the copy being cast), the chance it drops it, and each condition it would land × how bad it is × what the
 * creature is worth to its side × how many turns it would likely last. Harm to the caster's own side counts against
 * stopping it; healing and buffs it gives them count for. A spell whose effect can't be read is valued by its level.
 */
export function spellThreat(
  snapshot: EncounterSnapshot,
  reactor: CombatantState,
  caster: CombatantState,
  action: ActionDefinition,
  declared: DeclaredCast,
  level: number
): SpellThreat {
  const casterDefinition = getDefinition(snapshot, caster);
  const ours = effectiveFaction(snapshot, reactor);
  const counts = new Map<Id, number>();
  for (const id of declared.targetIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const creatures: SpellThreatLine[] = [];
  const sideOf = (combatant: CombatantState): "ours" | "theirs" => (effectiveFaction(snapshot, combatant) === ours ? "ours" : "theirs");

  if (action.kind === "attack" || action.kind === "save" || action.kind === "area-save") {
    const beams = action.kind === "attack" && action.attackDelivery === "beams" ? Math.max(1, declared.targetIds.length) : 1;
    for (const [id, count] of counts) {
      const target = snapshot.combatants.find((combatant) => combatant.id === id);
      if (!target || target.state === "dead" || target.state === "fled") continue;
      const targetDefinition = getDefinition(snapshot, target);
      const damage = expectedDamageAgainst(action, casterDefinition, caster, targetDefinition, target) / beams * count;
      const conditions = conditionsLanding(action, casterDefinition, targetDefinition);
      const likelyDown = target.currentHp > 0 && damage >= target.currentHp;
      // Hit while down: a failed death save, or worse.
      const downValue = target.currentHp <= 0 ? (damage > 0 ? DOWN_VALUE : 0)
        : likelyDown ? DOWN_VALUE : DOWN_VALUE / 3 * damage / Math.max(1, target.currentHp);
      const worth = allyValue(targetDefinition);
      const held = conditions.reduce((sum, condition) => sum + condition.chance * conditionSeverity(condition.name as ConditionName) * worth * condition.turns, 0);
      const harm = damage + downValue + held;
      const side = sideOf(target);
      creatures.push({ combatantId: id, side, damage, likelyDown, conditions, value: side === "ours" ? harm : -harm });
    }
    let total = creatures.reduce((sum, line) => sum + line.value, 0);
    // A lingering area also holds the routes into it.
    if (action.kind === "area-save" && action.zone && declared.origin) {
      const caught = creatures.flatMap((line) => snapshot.combatants.filter((combatant) => combatant.id === line.combatantId));
      total += predictedZoneApproachValue(snapshot, caster, casterDefinition, action, declared.origin, declared.aimVector, caught, tacticsSettings(caster.tacticsProfile));
    }
    return { total, basis: "effect", creatures };
  }

  if (action.kind === "healing") {
    const average = averageHealing(action, casterDefinition);
    for (const id of counts.keys()) {
      const target = snapshot.combatants.find((combatant) => combatant.id === id);
      if (!target || target.state === "dead" || target.state === "fled") continue;
      const missing = Math.max(0, getDefinition(snapshot, target).maxHp - target.currentHp);
      const healing = Math.min(average, missing);
      const gain = healing + (target.currentHp <= 0 && healing > 0 ? DOWN_VALUE : 0);
      const side = sideOf(target);
      creatures.push({ combatantId: id, side, damage: 0, likelyDown: false, conditions: [], healing, value: side === "theirs" ? gain : -gain });
    }
    return { total: creatures.reduce((sum, line) => sum + line.value, 0), basis: "effect", creatures };
  }

  if (action.kind === "buff") {
    for (const id of counts.keys()) {
      const target = snapshot.combatants.find((combatant) => combatant.id === id);
      if (!target) continue;
      const side = sideOf(target);
      creatures.push({ combatantId: id, side, damage: 0, likelyDown: false, conditions: [], value: side === "theirs" ? BUFF_TARGET_VALUE : -BUFF_TARGET_VALUE });
    }
    return { total: creatures.reduce((sum, line) => sum + line.value, 0), basis: "effect", creatures };
  }

  // A teleport, a summons, anything partly by hand: its effect can't be read, so its level stands in.
  return threatByLevel(level);
}

/** The conditions a spell's riders would land on a target: the chance of each, and the turns it would likely last. */
function conditionsLanding(
  action: Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" }>,
  source: CreatureDefinition,
  target: CreatureDefinition
): SpellThreatLine["conditions"] {
  const out: SpellThreatLine["conditions"] = [];
  for (const rider of action.riders ?? []) {
    if (rider.kind !== "condition") continue;
    const name = typeof rider.condition === "string" ? rider.condition : rider.condition.custom;
    if (isImmuneToCondition(target, name) || !riderAffectsCreatureType(rider, target)) continue;
    const chance = riderLandChance(action, rider, source, target);
    if (chance <= 0) continue;
    out.push({ name, chance, turns: turnsHeld(action, rider, source, target) });
  }
  return out;
}

/** How many turns a condition would likely hold its target: its rounds, or until it saves (1 ÷ the chance it does). */
function turnsHeld(
  action: Extract<ActionDefinition, { kind: "attack" | "save" | "area-save" }>,
  rider: ConditionRider,
  source: CreatureDefinition,
  target: CreatureDefinition
): number {
  const duration = rider.duration;
  const saveOutChance = (): number => {
    const ability = rider.save?.ability ?? (action.kind === "attack" ? undefined : action.saveAbility);
    if (!ability) return 0;
    const dc = rider.save ? riderSaveDc(rider, source, riderFallbackAbility(action)) : action.kind === "attack" ? 10 : resolveSaveDc(action, source);
    return 1 - chanceToFailSave(dc, target.saves?.[ability] ?? abilityModifier(target.abilities[ability]), false);
  };
  switch (duration.kind) {
    case "until-start-of-next-turn":
    case "until-source-turn":
    case "until-end-of-next-turn":
      return 1;
    case "rounds": {
      const rounds = Math.min(MAX_TURNS_HELD, Math.max(1, duration.rounds));
      if (!duration.repeatSaveAt) return rounds;
      return Math.min(rounds, 1 / Math.max(1 / MAX_TURNS_HELD, saveOutChance()));
    }
    case "save-ends":
      return Math.min(MAX_TURNS_HELD, 1 / Math.max(1 / MAX_TURNS_HELD, saveOutChance()));
    case "concentration":
    case "permanent":
      return MAX_TURNS_HELD;
  }
}

/** What spending its reaction costs `definition`: something if it has another use for one (Shield, opportunity attacks). */
function reactionCost(definition: CreatureDefinition): number {
  return getExecutableActions(definition).some((action) => action.automationSupport === "full"
    && ((action.actionType === "reaction" && !("reaction" in action && action.reaction?.trigger.kind === "enemy-casts-spell"))
      || (action.kind === "attack" && action.attackType === "melee" && action.actionType === "action")))
    ? REACTION_COST
    : 0;
}

/**
 * Whether to counter a spell, and with which slot: each slot's chance of stopping it × what it would do, less the
 * slot's price (its level × 4, × the resource stance) and the reaction. The best wins if that's above nothing; a
 * reaction set to `"always"` takes its best that can work regardless, and one set to `"manual"` is never taken.
 */
export function assessCounter(advice: CounterAdvice): CounterAssessment {
  const { snapshot, reactor, caster, spell, level } = advice;
  const threat = spell ? spellThreat(snapshot, reactor, caster, spell.action, spell.declared, level) : threatByLevel(level);
  const stance = resourceStanceMultiplier(reactor.resourceStance);
  const reaction = reactionCost(getDefinition(snapshot, reactor));
  const scored = advice.options.map((option) => {
    const slotCost = option.slot * SLOT_PRICE * stance;
    return { option, score: { actionId: option.actionId, slotCost, score: option.chance * threat.total - slotCost - reaction } };
  });
  const best = scored
    .filter(({ option }) => option.priority !== "manual" && option.chance > 0)
    .sort((a, b) => b.score.score - a.score.score || a.option.slot - b.option.slot || a.option.actionId.localeCompare(b.option.actionId))[0];
  const pick = best && (best.score.score > 0 || best.option.priority === "always") ? best.option.actionId : undefined;
  return { threat, scores: scored.map(({ score }) => score), pick };
}

setCounterAdvisor(assessCounter);
