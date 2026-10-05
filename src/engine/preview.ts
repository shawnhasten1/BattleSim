import { cellIntersectsArea, cellsInArea, combatantsInArea } from "./areas";
import {
  actionSaveContext,
  altitudeMoveCost,
  spatialDistanceToPoint,
  areaSaveTargets,
  attackRollInputs,
  canAct,
  effectiveFaction,
  findActionDefinition,
  findCombatant,
  getDefinition,
  getExecutableActions,
  hasLegendaryResistanceFor,
  heldInPlaceBy,
  isImmuneAfterSave,
  opportunityAttackThreats,
  plannedPath,
  remainingMovementBudget,
  resolveAreaTargeting,
  resolveOnSuccess,
  resolveSaveDc,
  routeStepCosts,
  saveDamageOutcome,
  saveActionCoverBonus,
  saveRollInputs,
  standingProblem,
  targetingProblem,
  validateOriginTargeting,
  type EngineState,
  type OpportunityThreat
} from "./combat";
import { movementProfileOf, terrainAtCell } from "./geometry";
import { defaultSwingAttack, swingCandidates, swingsOf, stepAbility } from "./multiattack";
import { averageDamage, averageHealing } from "./simulation";
import { lineOfEffect } from "./geometry";
import type {
  AreaSaveActionDefinition,
  AttackActionDefinition,
  CombatantState,
  CoverLevel,
  EncounterSnapshot,
  Id,
  Point,
  SaveActionDefinition
} from "./types";

/* ─── Previews ──────────────────────────────────────────────────────────────────
 * What a player sees before committing: the chance to hit or to fail a save, the damage it should do, who an area
 * catches, and what a move costs and provokes. Pure — nothing is copied or changed, and no die is rolled — and built
 * from the same inputs the resolvers roll against (`attackRollInputs`, `saveRollInputs`, `areaSaveTargets`,
 * `plannedPath`), so a preview can't disagree with what happens.
 */

/** An engine state around `snapshot` for read-only questions. Nothing is copied; rolling a die throws. */
function readOnly(snapshot: EncounterSnapshot): EngineState {
  const noDice = (): never => {
    throw new Error("A preview can't roll dice");
  };
  return { snapshot, log: [], rng: { next: noDice, nextInt: noDice, fork: noDice } };
}

/** Chance a d20 + `bonus` meets `ac`, a natural 20 always hitting and a natural 1 always missing. */
function d20HitChance(bonus: number, ac: number): number {
  let hits = 1;
  for (let natural = 2; natural <= 19; natural += 1) {
    if (natural + bonus >= ac) hits += 1;
  }
  return hits / 20;
}

function withRollMode(chance: number, mode: "normal" | "advantage" | "disadvantage"): number {
  if (mode === "advantage") return 1 - (1 - chance) ** 2;
  if (mode === "disadvantage") return chance ** 2;
  return chance;
}

export interface AttackPreview {
  /** Why it can't be made against this target, if it can't (range, line of effect…). */
  problem?: string;
  rollMode: "normal" | "advantage" | "disadvantage";
  /** What gives advantage or disadvantage: features, long range. */
  modeReasons: string[];
  /** Everything added to the d20. */
  bonus: number;
  /** The target's AC, with cover. */
  targetAc: number;
  cover: CoverLevel;
  /** Chance it hits (critical hits included) and that it's a critical hit. */
  hitChance: number;
  critChance: number;
  /** Average damage on a hit and on a critical hit, after the target's resistances. */
  damageOnHit: number;
  damageOnCrit: number;
  /** The damage to expect from it, chance and all. */
  expectedDamage: number;
}

/** One attack by `attackerId` with `actionId` against `targetId`, as things stand. */
export function previewAttack(snapshot: EncounterSnapshot, attackerId: Id, targetId: Id, actionId: Id): AttackPreview {
  const state = readOnly(snapshot);
  const attacker = findCombatant(snapshot, attackerId);
  const target = findCombatant(snapshot, targetId);
  const action = findActionDefinition(getDefinition(snapshot, attacker), actionId);
  if (!action || action.kind !== "attack") {
    throw new Error(`${actionId} isn't an attack`);
  }
  return attackPreviewOf(state, attacker, target, action);
}

function attackPreviewOf(state: EngineState, attacker: CombatantState, target: CombatantState, action: AttackActionDefinition): AttackPreview {
  const snapshot = state.snapshot;
  const inputs = attackRollInputs(state, attacker, target, action);
  const hitChance = withRollMode(d20HitChance(inputs.totalBonus, inputs.targetAc), inputs.rollMode);
  const critChance = withRollMode(1 / 20, inputs.rollMode);
  const source = getDefinition(snapshot, attacker);
  const adjustments = getDefinition(snapshot, target).damageAdjustments;
  const damageOnHit = averageDamage(action, source, adjustments);
  const damageOnCrit = averageDamage(action, source, adjustments, true);
  return {
    problem: targetingProblem(snapshot, attacker, target, action),
    rollMode: inputs.rollMode,
    modeReasons: [...inputs.featureAdvantage.sources, ...(inputs.longRange ? ["long range"] : [])],
    bonus: inputs.totalBonus,
    targetAc: inputs.targetAc,
    cover: inputs.cover.level,
    hitChance,
    critChance,
    damageOnHit,
    damageOnCrit,
    expectedDamage: (hitChance - critChance) * damageOnHit + critChance * damageOnCrit
  };
}

export interface RoutinePreview {
  /** Why the first swing can't reach this target, if no attack in the routine can. */
  problem?: string;
  /** The first swing at this target. */
  first: AttackPreview;
  /** How many attacks the routine makes. */
  swings: number;
  /** Every swing at this target with the attack it makes when nobody chooses, chance and all. */
  expectedDamage: number;
}

/** A multiattack (or a character's Attack action) aimed at `targetId`: the first swing, and every swing taken at it. */
export function previewRoutine(snapshot: EncounterSnapshot, attackerId: Id, targetId: Id, actionId: Id): RoutinePreview {
  const state = readOnly(snapshot);
  const attacker = findCombatant(snapshot, attackerId);
  const target = findCombatant(snapshot, targetId);
  const executables = getExecutableActions(getDefinition(snapshot, attacker));
  const action = executables.find((candidate) => candidate.id === actionId);
  if (!action || action.kind !== "multiattack") {
    throw new Error(`${actionId} isn't a multiattack`);
  }
  const attacks = swingsOf(action.attacks)
    .filter((swing) => !stepAbility(swing.step, executables))
    .map((swing) => {
      const candidates = swingCandidates(swing.step, executables);
      const reaching = candidates.filter((candidate) => !targetingProblem(snapshot, attacker, target, candidate));
      return defaultSwingAttack(swing.step, reaching.length ? reaching : candidates);
    })
    .filter((attack): attack is AttackActionDefinition => attack !== undefined);
  if (attacks.length === 0) {
    throw new Error(`${action.name} has no attacks`);
  }
  const previews = attacks.map((attack) => attackPreviewOf(state, attacker, target, attack));
  const reachable = previews.some((preview) => !preview.problem);
  return {
    problem: reachable ? undefined : previews[0]!.problem,
    first: previews[0]!,
    swings: attacks.length,
    expectedDamage: previews.reduce((sum, preview) => sum + (preview.problem ? 0 : preview.expectedDamage), 0)
  };
}

export interface SavePreview {
  problem?: string;
  ability: SaveActionDefinition["saveAbility"];
  dc: number;
  /** What the target adds to its d20, and whether it has advantage (and why). */
  bonus: number;
  advantage: boolean;
  advantageSources: string[];
  /** Chance it fails. */
  failChance: number;
  /** Average damage when it fails, and when it succeeds (half, or none). */
  damageOnFail: number;
  damageOnSuccess: number;
  expectedDamage: number;
  /** It could turn a failure into a success with Legendary Resistance. */
  legendaryResistance: boolean;
  /** It already made this save and is immune to it now (Frightful Presence). */
  immune: boolean;
}

function savePreviewOf(
  state: EngineState,
  caster: CombatantState,
  target: CombatantState,
  action: SaveActionDefinition | AreaSaveActionDefinition,
  coverSaveBonus: number,
  problem?: string
): SavePreview {
  const snapshot = state.snapshot;
  const source = getDefinition(snapshot, caster);
  const dc = resolveSaveDc(action, source, caster);
  const ctx = actionSaveContext(action, dc, coverSaveBonus);
  const { bonus, featureAdvantage } = saveRollInputs(state, target, ctx);
  // A saving throw has no automatic success or failure on a natural 20 or 1.
  const success = Math.min(1, Math.max(0, (21 - (dc - bonus)) / 20));
  const successChance = featureAdvantage.applied ? 1 - (1 - success) ** 2 : success;
  const fullDamage = averageDamage(action, source, getDefinition(snapshot, target).damageAdjustments);
  // As the resolvers apply it: half or none on a success, and Evasion's none-or-half on a Dexterity save.
  const onSuccess = resolveOnSuccess(action);
  const damageWhen = (succeeded: boolean) => {
    const outcome = saveDamageOutcome(state, target, action.saveAbility, onSuccess, succeeded);
    return outcome.dealsDamage ? (outcome.halve ? fullDamage / 2 : fullDamage) : 0;
  };
  const damageOnFail = damageWhen(false);
  const damageOnSuccess = damageWhen(true);
  const failChance = 1 - successChance;
  return {
    problem,
    ability: action.saveAbility,
    dc,
    bonus,
    advantage: featureAdvantage.applied,
    advantageSources: featureAdvantage.sources,
    failChance,
    damageOnFail,
    damageOnSuccess,
    expectedDamage: failChance * damageOnFail + successChance * damageOnSuccess,
    legendaryResistance: hasLegendaryResistanceFor(state, target, ctx),
    immune: isImmuneAfterSave(caster, target, action)
  };
}

/** A single-target saving-throw action by `casterId` against `targetId`. */
export function previewSave(snapshot: EncounterSnapshot, casterId: Id, targetId: Id, actionId: Id): SavePreview {
  const state = readOnly(snapshot);
  const caster = findCombatant(snapshot, casterId);
  const target = findCombatant(snapshot, targetId);
  const action = findActionDefinition(getDefinition(snapshot, caster), actionId);
  if (!action || action.kind !== "save") {
    throw new Error(`${actionId} isn't a saving-throw action`);
  }
  const problem = action.targeting?.target === "self" ? undefined : targetingProblem(snapshot, caster, target, action);
  return savePreviewOf(state, caster, target, action, saveActionCoverBonus(snapshot, caster, target, action), problem);
}

export interface AreaPreview {
  /** Why it can't be put there (range, line of effect to the point). */
  problem?: string;
  origin: Point;
  aimVector?: { x: number; y: number };
  /** The squares it covers. */
  cells: Point[];
  /** It settles as a lasting zone without hitting anyone now (they're hit when they start or end a turn in it). */
  settlesOnly: boolean;
  /** Everyone it catches: friend or foe, and what it should do to them. */
  caught: Array<{ id: Id; hostile: boolean } & Pick<SavePreview, "failChance" | "expectedDamage" | "legendaryResistance" | "advantage">>;
}

/** An area save by `casterId` aimed at `aim` (a point for a placed template, the direction for a cone or line). */
export function previewArea(snapshot: EncounterSnapshot, casterId: Id, actionId: Id, aim: Point): AreaPreview {
  const state = readOnly(snapshot);
  const caster = findCombatant(snapshot, casterId);
  const casterDefinition = getDefinition(snapshot, caster);
  const action = findActionDefinition(casterDefinition, actionId);
  if (!action || action.kind !== "area-save") {
    throw new Error(`${actionId} isn't an area`);
  }
  const placement = resolveAreaTargeting(caster, casterDefinition, action, aim);
  let problem: string | undefined;
  if (!placement.fromSelf) {
    try {
      validateOriginTargeting(snapshot, caster, placement.origin, action);
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }
  }
  const side = effectiveFaction(snapshot, caster);
  return {
    problem,
    origin: placement.origin,
    aimVector: placement.aimVector,
    cells: cellsInArea(snapshot.map, placement.origin, action.area, placement.aimVector),
    settlesOnly: Boolean(action.zone && !action.zone.applyOnCast),
    caught: areaSaveTargets(snapshot, caster, action, placement).map(({ target, cover }) => {
      const coverSaveBonus = action.saveAbility === "dex" ? (cover?.dexSaveBonus ?? 0) : 0;
      const save = savePreviewOf(state, caster, target, action, coverSaveBonus);
      return {
        id: target.id,
        hostile: effectiveFaction(snapshot, target) !== side,
        failChance: save.failChance,
        expectedDamage: save.expectedDamage,
        legendaryResistance: save.legendaryResistance,
        advantage: save.advantage
      };
    })
  };
}

export interface HealingAreaPreview {
  /** Why it can't be put there (range, line of effect to the point). */
  problem?: string;
  origin: Point;
  aimVector?: { x: number; y: number };
  cells: Point[];
  /** The friends it heals: everyone of the healer's side in it, the fallen included. */
  healed: Id[];
  /** About how much each is healed. */
  healing: number;
}

/** A healing area (Mass Cure Wounds) put at `aim`: as `resolveHealingBurstAction` places it, and who it heals. */
export function previewHealingArea(snapshot: EncounterSnapshot, healerId: Id, actionId: Id, aim: Point): HealingAreaPreview {
  const healer = findCombatant(snapshot, healerId);
  const definition = getDefinition(snapshot, healer);
  const action = findActionDefinition(definition, actionId);
  if (!action || action.kind !== "healing" || action.targeting?.target !== "area" || !action.area) {
    throw new Error(`${actionId} isn't a healing area`);
  }
  const placement = resolveAreaTargeting(healer, definition, { targeting: action.areaTargeting }, aim);
  let problem: string | undefined;
  if (!placement.fromSelf) {
    const distance = spatialDistanceToPoint(snapshot, healer, placement.origin);
    if (distance > (action.areaTargeting?.range ?? action.range)) problem = `Origin is ${distance} ft. away, beyond range`;
    else if (snapshot.rules.requireLineOfEffect && !lineOfEffect(snapshot.map, healer.position, placement.origin)) problem = "Line of effect to area origin is blocked";
  }
  const definitionsById = new Map(snapshot.definitions.map((entry) => [entry.id, entry]));
  const side = effectiveFaction(snapshot, healer);
  return {
    problem,
    origin: placement.origin,
    aimVector: placement.aimVector,
    cells: cellsInArea(snapshot.map, placement.origin, action.area, placement.aimVector),
    healed: combatantsInArea(snapshot.map, placement.origin, action.area, snapshot.combatants, definitionsById, placement.aimVector, { includeDowned: true })
      .filter((target) => effectiveFaction(snapshot, target) === side)
      .map((target) => target.id),
    healing: averageHealing(action, definition)
  };
}

export interface MovePreview {
  /** It can get there with the movement it has left. */
  reachable: boolean;
  problem?: string;
  /** The only thing in the way is how far it is. */
  tooFar: boolean;
  /** The whole route, square by square, from where it stands. */
  cells: Point[];
  /** What it costs, in squares and in feet, and what's left after (in squares and feet; all of it, if it can't go). */
  cost: number;
  costFeet: number;
  remaining: number;
  remainingFeet: number;
  /** Squares on the way that cost more than open ground — difficult terrain, another creature's space, a climb — and how many times more. */
  slowed: Array<{ cell: Point; multiplier: number }>;
  /** What goes off on the way: a hazard or a zone it walks into, a zone that hurts each step taken in it. */
  hazards: Array<{ cell: Point; name: string }>;
  /** Who gets an opportunity attack on the way, with what, and where. */
  opportunityAttacks: OpportunityThreat[];
}

/** Feet to one decimal place: diagonals and difficult terrain can cost half a square. */
function feet(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Moving `combatantId` through `waypoints` (the last one is the destination), ending at `altitude` if it flies. */
export function previewMove(snapshot: EncounterSnapshot, combatantId: Id, waypoints: Point[], altitude?: number): MovePreview {
  const mover = findCombatant(snapshot, combatantId);
  const definition = getDefinition(snapshot, mover);
  const perSquare = snapshot.map.grid.distancePerSquare;
  const budget = remainingMovementBudget(snapshot, mover);
  const cells: Point[] = [{ ...mover.position }];
  let cost = 0;
  let from = mover.position;
  const held = heldInPlaceBy(mover);
  let problem: string | undefined = !canAct(mover, "free") ? `${mover.displayName} can't move right now`
    : held ? `${mover.displayName} is ${held.name === "custom" ? `held by ${held.sourceName ?? "something"}` : held.name} and can't move`
      : undefined;
  for (const waypoint of waypoints) {
    if (problem) break;
    problem = standingProblem(snapshot, combatantId, waypoint);
    if (problem) break;
    const path = plannedPath(snapshot, combatantId, waypoint, from);
    if (!path.reachable) {
      problem = "There's no way through to there";
      break;
    }
    cost += path.cost;
    cells.push(...path.cells.slice(1));
    from = waypoint;
  }
  const verticalFt = altitude === undefined ? 0 : Math.abs(Math.max(0, altitude) - (mover.altitude ?? 0));
  if (!problem && verticalFt > 0 && !movementProfileOf(definition).fly) {
    problem = `${mover.displayName} can't fly`;
  }
  if (!problem) {
    cost += altitudeMoveCost(snapshot, definition, verticalFt);
  }
  const tooFar = !problem && cost > budget + 1e-9;
  if (tooFar) {
    problem = `That's ${feet(cost * perSquare)} ft. of movement; ${mover.displayName} has ${feet(budget * perSquare)} ft. left`;
  }
  const remaining = problem ? budget : Math.max(0, budget - cost);
  return {
    reachable: !problem,
    problem,
    tooFar,
    cells,
    cost,
    costFeet: feet(cost * perSquare),
    remaining,
    remainingFeet: feet(remaining * perSquare),
    slowed: routeStepCosts(snapshot, combatantId, cells)
      .map((step, index) => ({ cell: cells[index + 1]!, multiplier: step.cost / step.open }))
      .filter((step) => step.multiplier > 1 + 1e-9 && Number.isFinite(step.multiplier)),
    hazards: moveHazards(snapshot, mover, cells),
    opportunityAttacks: opportunityAttackThreats(snapshot, combatantId, cells)
  };
}

/** What a move along `cells` sets off, as `moveCombatant` would: hazard tiles and zones it enters, and zones that hurt each step. */
function moveHazards(snapshot: EncounterSnapshot, mover: CombatantState, cells: Point[]): Array<{ cell: Point; name: string }> {
  const hazards: Array<{ cell: Point; name: string }> = [];
  const steps = cells.slice(1);
  const seenTiles = new Set<string>();
  for (const cell of steps) {
    const tile = terrainAtCell(snapshot.map.terrain, cell);
    if (tile?.hazard?.trigger.includes("on-enter") && !seenTiles.has(tile.id)) {
      seenTiles.add(tile.id);
      hazards.push({ cell, name: tile.name });
    }
  }
  const per = snapshot.map.grid.distancePerSquare;
  const side = effectiveFaction(snapshot, mover);
  for (const zone of snapshot.activeZones ?? []) {
    const source = snapshot.combatants.find((combatant) => combatant.id === zone.sourceCombatantId);
    if (zone.affects === "hostile" && source && effectiveFaction(snapshot, source) === side) continue;
    const inside = steps.filter((cell) => cellIntersectsArea(cell, zone.origin, zone.area, per));
    if (zone.movementDamage) {
      hazards.push(...inside.map((cell) => ({ cell, name: zone.name })));
    } else if (zone.trigger.includes("on-enter") && inside.length > 0) {
      hazards.push({ cell: inside[0]!, name: zone.name });
    }
  }
  return hazards;
}
