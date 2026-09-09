import { combatantsInArea } from "./areas";
import { rollDice, abilityModifier, type DiceRollResult } from "./dice";
import { gridDistance, lineOfEffect, findPath, sizeFootprint } from "./geometry";
import { SeededRandom, type RandomSource } from "./rng";
import type {
  ActionDefinition,
  ActivateFeatureActionDefinition,
  AreaSaveActionDefinition,
  AttackActionDefinition,
  CombatLogEvent,
  CombatantState,
  ConditionInstance,
  CreatureDefinition,
  DamageComponent,
  DamageType,
  DamageTypeReference,
  EncounterSnapshot,
  FeatureCondition,
  FeatureEffect,
  FeatureEffectSaveGate,
  HealingActionDefinition,
  Id,
  MultiattackActionDefinition,
  NumericFormula,
  Point,
  SaveActionDefinition
} from "./types";

export interface EngineState {
  snapshot: EncounterSnapshot;
  log: CombatLogEvent[];
  rng: RandomSource;
}

export interface AttackResult {
  hit: boolean;
  critical: boolean;
  attackRoll: DiceRollResult;
  total: number;
  targetAc: number;
  damageApplied: number;
}

export interface MultiattackResult {
  attacks: AttackResult[];
}

export interface SaveResult {
  success: boolean;
  saveRoll: DiceRollResult;
  total: number;
  dc: number;
  damageApplied: number;
}

export interface AreaSaveResult {
  targets: Array<{ targetId: Id; success: boolean; damageApplied: number }>;
}

export interface HealingResult {
  healingApplied: number;
}

export interface FeatureActivationResult {
  conditionId?: Id;
}

export interface OpportunityThreat {
  reactorId: Id;
  actionId: Id;
  from: Point;
  to: Point;
}

export interface DeathSaveResult {
  roll: DiceRollResult;
  successes: number;
  failures: number;
  stable: boolean;
  died: boolean;
}

type AttackRollMode = "normal" | "advantage" | "disadvantage";

interface AttackFeatureContext {
  rollMode: AttackRollMode;
  critical: boolean;
}

interface DamageApplicationEntry {
  component: DamageComponent;
  critical: boolean;
  halve?: boolean;
  triggerDamageType?: DamageType;
  sourceDefinition?: CreatureDefinition;
  sourceFeatureId?: Id;
  sourceFeatureName?: string;
  sourceEffectKind?: FeatureEffect["kind"];
}

interface FeatureDamageResolution {
  entries: DamageApplicationEntry[];
  sources: string[];
  consumedConditionIds?: Id[];
}

export function createEngineState(snapshot: EncounterSnapshot): EngineState {
  return {
    snapshot: structuredClone(snapshot),
    log: [],
    rng: new SeededRandom(snapshot.seed)
  };
}

export function getDefinition(snapshot: EncounterSnapshot, combatant: CombatantState): CreatureDefinition {
  const definition = snapshot.definitions.find((candidate) => candidate.id === combatant.definitionId);
  if (!definition) {
    throw new Error(`Missing creature definition for combatant ${combatant.id}`);
  }
  return definition;
}

export function getExecutableActions(definition: CreatureDefinition): ActionDefinition[] {
  const weaponActions = (definition.weapons ?? []).map((weapon) => weaponToAction(definition, weapon));
  const spellActions = (definition.spells ?? [])
    .map((spell) => spell.action)
    .filter((action): action is ActionDefinition => Boolean(action));
  const grantedActions = [
    ...(definition.features ?? []),
    ...(definition.traits ?? [])
  ].flatMap((feature) => feature.grantedActions ?? []);

  return dedupeActionsById([
    ...definition.actions,
    ...(definition.bonusActions ?? []),
    ...(definition.reactions ?? []),
    ...weaponActions,
    ...spellActions,
    ...grantedActions
  ]);
}

export function findActionDefinition(definition: CreatureDefinition, actionId: Id): ActionDefinition | undefined {
  return getExecutableActions(definition).find((candidate) => candidate.id === actionId);
}

export function resolveNumericFormula(formula: NumericFormula | undefined, definition: CreatureDefinition): number {
  if (!formula) {
    return 0;
  }
  const base = formula.base ?? 0;
  const abilityBonus = formula.ability ? abilityModifier(definition.abilities[formula.ability]) : 0;
  const proficiencyBonus = formula.proficiency ? (definition.proficiencyBonus ?? proficiencyFromDefinition(definition)) : 0;
  return Math.trunc((base + abilityBonus + proficiencyBonus) * (formula.multiplier ?? 1));
}

export function resolveAttackBonus(action: AttackActionDefinition, definition: CreatureDefinition): number {
  if (action.attackBonusFormula) {
    return resolveNumericFormula(action.attackBonusFormula, definition);
  }
  return action.attackBonus ?? (abilityModifier(definition.abilities[action.ability]) + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition)));
}

export function resolveSaveDc(action: SaveActionDefinition | AreaSaveActionDefinition, definition: CreatureDefinition): number {
  const featureDcBonus = featureSaveDcModifier(definition, action);
  if (action.dcFormula) {
    return resolveNumericFormula(action.dcFormula, definition) + featureDcBonus.total;
  }
  return (action.dc ?? 8 + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition))) + featureDcBonus.total;
}

export function applyTimedFeatureEffects(state: EngineState, combatantId: Id, timing: "turn-start" | "turn-end"): void {
  const combatant = findCombatant(state.snapshot, combatantId);
  const definition = getDefinition(state.snapshot, combatant);
  for (const source of featureSources(definition, combatant)) {
    for (const effect of source.effects ?? []) {
      if (effect.kind !== "resource-regain" || effect.timing !== timing) {
        continue;
      }
      const previous = combatant.resources?.[effect.resourceId] ?? 0;
      const amount = resolveNumericFormula(effect.amount, definition);
      const next = Math.min(effect.max ?? Number.POSITIVE_INFINITY, previous + amount);
      combatant.resources = { ...(combatant.resources ?? {}), [effect.resourceId]: next };
      state.log.push(event(state, "FeatureEffectApplied", `${combatant.displayName} gained ${effect.resourceId}`, {
        combatantId,
        featureId: source.id,
        effect,
        previous,
        next
      }));
    }
  }
}

export function rollInitiative(state: EngineState): void {
  const rolls = state.snapshot.combatants.map((combatant) => {
    const definition = getDefinition(state.snapshot, combatant);
    const dex = abilityModifier(definition.abilities.dex);
    const roll = rollDice(withBonus("1d20", dex), state.rng);
    combatant.initiative = roll.total;
    return { combatant, definition, roll };
  });

  state.snapshot.combatants.sort((a, b) => {
    const aDefinition = getDefinition(state.snapshot, a);
    const bDefinition = getDefinition(state.snapshot, b);
    return (b.initiative ?? 0) - (a.initiative ?? 0)
      || abilityModifier(bDefinition.abilities.dex) - abilityModifier(aDefinition.abilities.dex)
      || a.id.localeCompare(b.id);
  });

  state.log.push(event(state, "InitiativeRolled", "Initiative order established", {
    rolls: rolls.map(({ combatant, roll }) => ({
      combatantId: combatant.id,
      total: roll.total,
      rolls: roll.rolls
    })),
    order: state.snapshot.combatants.map((combatant) => combatant.id)
  }));
}

export function moveCombatant(
  state: EngineState,
  combatantId: Id,
  destination: Point,
  options: { provokeOpportunityAttacks?: boolean } = {}
): Point[] {
  const combatant = findCombatant(state.snapshot, combatantId);
  const definition = getDefinition(state.snapshot, combatant);
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCells(state.snapshot, combatantId);
  const start = combatant.position;
  const path = findPath(state.snapshot.map, start, destination, footprint, occupied, {
    allowOccupiedTransit: true,
    occupiedMovementMultiplier: 2
  });
  const movementMultiplier = Math.max(1, ...(combatant.conditions ?? []).map((condition) => condition.modifiers?.movementMultiplier ?? 1));
  const movementBudget = definition.speed / state.snapshot.map.grid.distancePerSquare / movementMultiplier;

  if (!path.reachable || path.cost > movementBudget) {
    throw new Error(`Destination is not reachable with ${definition.speed} ft. of movement`);
  }

  const movedCells = moveAlongPath(state, combatant, path.cells, options.provokeOpportunityAttacks ?? true);
  const actualPath = pointsEqual(combatant.position, destination)
    ? path
    : findPath(state.snapshot.map, start, combatant.position, footprint, occupied, {
      allowOccupiedTransit: true,
      occupiedMovementMultiplier: 2
    });
  state.log.push(event(state, "CombatantMoved", `${combatant.displayName} moved`, {
    combatantId,
    destination: combatant.position,
    requestedDestination: destination,
    cost: actualPath.reachable ? actualPath.cost : 0,
    requestedCost: path.cost,
    cells: movedCells,
    interrupted: combatant.state !== "active" && !pointsEqual(combatant.position, destination)
  }));
  return movedCells;
}

export function opportunityAttackThreats(snapshot: EncounterSnapshot, moverId: Id, cells: Point[]): OpportunityThreat[] {
  const mover = findCombatant(snapshot, moverId);
  if (mover.state !== "active" || cells.length < 2) {
    return [];
  }
  const threats: OpportunityThreat[] = [];
  const committedReactors = new Set<Id>();
  for (let index = 0; index < cells.length - 1; index += 1) {
    const from = cells[index] as Point;
    const to = cells[index + 1] as Point;
    for (const reactor of snapshot.combatants) {
      if (committedReactors.has(reactor.id) || reactor.id === mover.id || reactor.faction === mover.faction || reactor.state !== "active") {
        continue;
      }
      const action = opportunityAttackAction(snapshot, reactor, from, to);
      if (!action) {
        continue;
      }
      threats.push({ reactorId: reactor.id, actionId: action.id, from, to });
      committedReactors.add(reactor.id);
    }
  }
  return threats;
}

export function resolveAttack(
  state: EngineState,
  attackerId: Id,
  targetId: Id,
  actionId: Id,
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number } = {}
): AttackResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const target = findCombatant(state.snapshot, targetId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "attack") {
    throw new Error(`Attack action ${actionId} is not available to ${attacker.displayName}`);
  }
  return resolveAttackCore(state, attacker, target, attackerDefinition, action, options, true);
}

export function resolveMultiattackAction(
  state: EngineState,
  attackerId: Id,
  targetId: Id,
  actionId: Id,
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number } = {}
): MultiattackResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const target = findCombatant(state.snapshot, targetId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "multiattack") {
    throw new Error(`Multiattack action ${actionId} is not available to ${attacker.displayName}`);
  }
  validateAndSpendAction(attacker, action);
  declareAction(state, attacker, action, { target });

  const attacks: AttackResult[] = [];
  for (const step of action.attacks) {
    const child = findActionDefinition(attackerDefinition, step.actionId);
    if (!child || child.kind !== "attack") {
      throw new Error(`Multiattack child action ${step.actionId} is not an attack`);
    }
    for (let index = 0; index < step.count; index += 1) {
      if (target.state !== "active" && target.state !== "downed") {
        break;
      }
      attacks.push(resolveAttackCore(state, attacker, target, attackerDefinition, child, options, false, action));
    }
  }

  state.log.push(event(state, "MultiattackResolved", `${attacker.displayName} resolved ${action.name}`, {
    attackerId,
    targetId,
    actionId,
    attacks: attacks.length
  }));

  return { attacks };
}

function resolveAttackCore(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  attackerDefinition: CreatureDefinition,
  action: AttackActionDefinition,
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number },
  spendAction: boolean,
  parentAction?: MultiattackActionDefinition
): AttackResult {
  const targetDefinition = getDefinition(state.snapshot, target);
  validateTargeting(state.snapshot, attacker, target, action);
  if (spendAction) {
    validateAndSpendAction(attacker, action);
  }
  if (!parentAction) {
    declareAction(state, attacker, action, { target });
  }

  const featureAdvantage = featureAttackAdvantage(state, attacker, target, action, attackerDefinition);
  const longRange = attackIsAtLongRange(state.snapshot, attacker, target, action);
  const attackOptions = {
    ...options,
    advantage: options.advantage || featureAdvantage.applied,
    disadvantage: options.disadvantage || longRange
  };
  const rollMode = attackRollMode({
    ...attackOptions
  });
  const d20 = rollD20(state.rng, attackOptions);
  const attackBonus = resolveAttackBonus(action, attackerDefinition);
  const featureAttackBonus = featureAttackModifier(state, attacker, target, action, attackerDefinition, { rollMode, critical: false });
  const total = d20.total + attackBonus + conditionAttackModifier(attacker) + featureAttackBonus.total;
  const targetAc = effectiveArmorClass(targetDefinition, target) + (options.coverBonus ?? 0);
  const natural = d20.total;
  const critical = natural === 20;
  const hit = critical || (natural !== 1 && total >= targetAc);
  const featureDamage = hit
    ? featureDamageEntries(state, attacker, target, action, attackerDefinition, { rollMode, critical })
    : { entries: [], sources: [] };
  const targetHitDamage = hit
    ? targetIncomingHitDamageEntries(state, attacker, target, action, { rollMode, critical })
    : { entries: [], sources: [] };
  const damageApplied = hit
    ? applyDamageEntries(state, target, [
      ...action.damage.map((component) => ({ component, critical, triggerDamageType: firstActionDamageType(action) })),
      ...featureDamage.entries,
      ...targetHitDamage.entries
    ], attackerDefinition)
    : 0;
  let appliedConditionEffects: string[] = [];
  if (hit) {
    consumeTriggeredConditions(state, target, targetHitDamage.consumedConditionIds ?? []);
    appliedConditionEffects = applyOnHitFeatureConditions(state, attacker, target, action, attackerDefinition, { rollMode, critical });
  }

  state.log.push(event(state, "AttackRolled", `${attacker.displayName} ${hit ? "hit" : "missed"} ${target.displayName} with ${action.name}`, {
    attackerId: attacker.id,
    targetId: target.id,
    actionId: action.id,
    parentActionId: parentAction?.id,
    attackRoll: d20,
    attackBonus,
    featureAttackBonus: featureAttackBonus.total,
    appliedAttackEffects: [...featureAdvantage.sources, ...featureAttackBonus.sources, ...(longRange ? ["Long Range"] : [])],
    appliedDamageEffects: [...featureDamage.sources, ...targetHitDamage.sources],
    appliedConditionEffects,
    attackBonusFormula: action.attackBonusFormula,
    rollMode,
    longRange,
    total,
    targetAc,
    hit,
    critical,
    damageApplied
  }));

  return { hit, critical, attackRoll: d20, total, targetAc, damageApplied };
}

export function resolveSaveAction(
  state: EngineState,
  attackerId: Id,
  targetId: Id,
  actionId: Id
): SaveResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const target = findCombatant(state.snapshot, targetId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const targetDefinition = getDefinition(state.snapshot, target);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "save") {
    throw new Error(`Save action ${actionId} is not available to ${attacker.displayName}`);
  }
  validateTargeting(state.snapshot, attacker, target, action);
  validateAndSpendAction(attacker, action);
  declareAction(state, attacker, action, { target });

  const saveBonus = (targetDefinition.saves?.[action.saveAbility]
    ?? abilityModifier(targetDefinition.abilities[action.saveAbility]))
    + conditionSaveModifier(target, action.saveAbility);
  const featureSaveBonus = featureSaveModifier(targetDefinition, target, action.saveAbility);
  const featureSaveAdvantage = featureSaveAdvantageModifier(targetDefinition, target, action.saveAbility);
  const saveRoll = rollD20WithBonus(state.rng, saveBonus + featureSaveBonus.total, {
    advantage: featureSaveAdvantage.applied
  });
  const dc = resolveSaveDc(action, attackerDefinition);
  const success = saveRoll.total >= dc;
  const damageApplied = applyDamageComponents(state, target, action.damage, attackerDefinition, false, {
    halve: success && action.halfDamageOnSuccess
  });

  state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${action.saveAbility.toUpperCase()} save against ${action.name}`, {
    attackerId,
    targetId,
    actionId,
    saveRoll,
    total: saveRoll.total,
    dc,
    featureSaveBonus: featureSaveBonus.total,
    appliedSaveEffects: [...featureSaveBonus.sources, ...featureSaveAdvantage.sources],
    success,
    damageApplied
  }));

  return { success, saveRoll, total: saveRoll.total, dc, damageApplied };
}

export function resolveAreaSaveAction(
  state: EngineState,
  attackerId: Id,
  origin: Point,
  actionId: Id
): AreaSaveResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "area-save") {
    throw new Error(`Area save action ${actionId} is not available to ${attacker.displayName}`);
  }
  validateOriginTargeting(state.snapshot, attacker, origin, action);
  validateAndSpendAction(attacker, action);
  declareAction(state, attacker, action, { origin });

  const definitionsById = new Map(state.snapshot.definitions.map((definition) => [definition.id, definition]));
  const affected = combatantsInArea(state.snapshot.map, origin, action.area, state.snapshot.combatants, definitionsById)
    .filter((target) => action.affects === "all" || target.faction !== attacker.faction);
  const targets = affected.map((target) => {
    const targetDefinition = getDefinition(state.snapshot, target);
    const saveBonus = (targetDefinition.saves?.[action.saveAbility]
      ?? abilityModifier(targetDefinition.abilities[action.saveAbility]))
      + conditionSaveModifier(target, action.saveAbility);
    const featureSaveBonus = featureSaveModifier(targetDefinition, target, action.saveAbility);
    const featureSaveAdvantage = featureSaveAdvantageModifier(targetDefinition, target, action.saveAbility);
    const saveRoll = rollD20WithBonus(state.rng, saveBonus + featureSaveBonus.total, {
      advantage: featureSaveAdvantage.applied
    });
    const dc = resolveSaveDc(action, attackerDefinition);
    const success = saveRoll.total >= dc;
    const damageApplied = applyDamageComponents(state, target, action.damage, attackerDefinition, false, {
      halve: success && action.halfDamageOnSuccess
    });

    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${action.saveAbility.toUpperCase()} save against ${action.name}`, {
      attackerId,
      targetId: target.id,
      actionId,
      saveRoll,
      total: saveRoll.total,
      dc,
      featureSaveBonus: featureSaveBonus.total,
      appliedSaveEffects: [...featureSaveBonus.sources, ...featureSaveAdvantage.sources],
      success,
      damageApplied
    }));

    return { targetId: target.id, success, damageApplied };
  });

  state.log.push(event(state, "AreaSaveResolved", `${attacker.displayName} resolved ${action.name} at (${origin.x}, ${origin.y})`, {
    attackerId,
    actionId,
    origin,
    targets
  }));
  return { targets };
}

export function resolveHealingAction(
  state: EngineState,
  healerId: Id,
  targetId: Id,
  actionId: Id
): HealingResult {
  const healer = findCombatant(state.snapshot, healerId);
  const target = findCombatant(state.snapshot, targetId);
  const healerDefinition = getDefinition(state.snapshot, healer);
  const targetDefinition = getDefinition(state.snapshot, target);
  const action = findActionDefinition(healerDefinition, actionId);
  if (!action || action.kind !== "healing") {
    throw new Error(`Healing action ${actionId} is not available to ${healer.displayName}`);
  }
  validateHealingTargeting(state.snapshot, healer, target, action);
  validateAndSpendAction(healer, action);
  declareAction(state, healer, action, { target });

  let healingApplied = 0;
  const rolls = action.healing.map((component) => {
    const abilityBonus = component.abilityModifier ? abilityModifier(healerDefinition.abilities[component.abilityModifier]) : 0;
    const roll = rollDice(withBonus(component.dice, abilityBonus), state.rng);
    healingApplied += roll.total;
    return roll;
  });
  target.currentHp = Math.min(targetDefinition.maxHp, target.currentHp + healingApplied);
  if (target.currentHp > 0 && (target.state === "downed" || target.state === "defeated")) {
    target.state = "active";
    target.deathSaves = { successes: 0, failures: 0, stable: false };
    target.conditions = (target.conditions ?? []).filter((condition) => condition.name !== "unconscious");
  }

  state.log.push(event(state, "HealingApplied", `${target.displayName} regained ${healingApplied} HP`, {
    healerId,
    targetId,
    actionId,
    rolls,
    healingApplied,
    currentHp: target.currentHp
  }));
  return { healingApplied };
}

export function resolveActivateFeatureAction(
  state: EngineState,
  actorId: Id,
  actionId: Id
): FeatureActivationResult {
  const actor = findCombatant(state.snapshot, actorId);
  const actorDefinition = getDefinition(state.snapshot, actor);
  const action = findActionDefinition(actorDefinition, actionId);
  if (!action || action.kind !== "activate-feature") {
    throw new Error(`Feature activation ${actionId} is not available to ${actor.displayName}`);
  }
  validateAndSpendAction(actor, action);
  declareAction(state, actor, action);

  const feature = featureSources(actorDefinition, actor).find((candidate) => candidate.id === action.featureId);
  if (!feature) {
    state.log.push(event(state, "AutomationWarning", `${actor.displayName} activated an unknown feature`, {
      combatantId: actorId,
      actionId,
      featureId: action.featureId
    }));
  }

  const conditionId = applyFeatureActivationCondition(state, actor, action);
  return { conditionId };
}

export function resetActionEconomy(combatant: CombatantState): void {
  combatant.actionEconomy = { action: true, bonus: true, reaction: true };
}

export function resolveDeathSave(state: EngineState, combatantId: Id): DeathSaveResult {
  const combatant = findCombatant(state.snapshot, combatantId);
  if (combatant.state !== "downed") {
    throw new Error(`${combatant.displayName} is not downed`);
  }
  combatant.deathSaves ??= { successes: 0, failures: 0, stable: false };
  if (combatant.deathSaves.stable) {
    return {
      roll: { expression: "stable", rolls: [], modifier: 0, total: 0 },
      successes: combatant.deathSaves.successes,
      failures: combatant.deathSaves.failures,
      stable: true,
      died: false
    };
  }

  const roll = rollDice("1d20", state.rng);
  const natural = roll.rolls[0]?.value ?? roll.total;
  if (natural === 20) {
    combatant.currentHp = 1;
    combatant.state = "active";
    combatant.deathSaves = { successes: 0, failures: 0, stable: false };
  } else if (natural === 1) {
    combatant.deathSaves.failures += 2;
  } else if (natural >= 10) {
    combatant.deathSaves.successes += 1;
  } else {
    combatant.deathSaves.failures += 1;
  }

  if (combatant.deathSaves.failures >= 3) {
    combatant.state = "dead";
    state.log.push(event(state, "CombatantDied", `${combatant.displayName} died`, { combatantId }));
  } else if (combatant.deathSaves.successes >= 3) {
    combatant.deathSaves.stable = true;
    state.log.push(event(state, "CombatantStabilized", `${combatant.displayName} stabilized`, { combatantId }));
  }

  state.log.push(event(state, "DeathSaveRolled", `${combatant.displayName} rolled a death save`, {
    combatantId,
    roll,
    deathSaves: combatant.deathSaves,
    state: combatant.state
  }));

  return {
    roll,
    successes: combatant.deathSaves.successes,
    failures: combatant.deathSaves.failures,
    stable: combatant.deathSaves.stable,
    died: combatant.state === "dead"
  };
}

export function applyCondition(state: EngineState, targetId: Id, condition: ConditionInstance): void {
  const target = findCombatant(state.snapshot, targetId);
  target.conditions = [
    ...(target.conditions ?? []).filter((existing) => existing.id !== condition.id),
    condition
  ];
  state.log.push(event(state, "ConditionApplied", `${target.displayName} gained ${condition.name}`, {
    targetId,
    condition
  }));
}

export function expireConditions(state: EngineState, timing: "start" | "end"): void {
  for (const combatant of state.snapshot.combatants) {
    const conditions = combatant.conditions ?? [];
    const remaining = conditions.filter((condition) => {
      const expiration = condition.expiresAt;
      if (!expiration || expiration.timing !== timing) {
        return true;
      }
      const expired = expiration.round < state.snapshot.round
        || (expiration.round === state.snapshot.round && expiration.turnIndex <= state.snapshot.turnIndex);
      if (expired) {
        state.log.push(event(state, "ConditionExpired", `${combatant.displayName} lost ${condition.name}`, {
          combatantId: combatant.id,
          condition
        }));
      }
      return !expired;
    });
    combatant.conditions = remaining;
  }
}

export function activeFactions(snapshot: EncounterSnapshot): Set<string> {
  return new Set(
    snapshot.combatants
      .filter((combatant) => combatant.state === "active" && combatant.currentHp > 0
        || (snapshot.rules.playerDeathSaves
          && combatant.faction === "party"
          && combatant.state === "downed"
          && !combatant.deathSaves?.stable))
      .map((combatant) => combatant.faction)
  );
}

export function firstUsableAction(definition: CreatureDefinition, preferred: "melee" | "ranged" | "any" = "any"): ActionDefinition | undefined {
  const actions = getExecutableActions(definition);
  return actions.find((action) => action.automationSupport === "full"
    && action.kind === "attack"
    && (preferred === "any" || action.attackType === preferred))
    ?? actions.find((action) => action.automationSupport === "full");
}

export function findCombatant(snapshot: EncounterSnapshot, combatantId: Id): CombatantState {
  const combatant = snapshot.combatants.find((candidate) => candidate.id === combatantId);
  if (!combatant) {
    throw new Error(`Unknown combatant: ${combatantId}`);
  }
  return combatant;
}

export function event(
  state: EngineState,
  type: CombatLogEvent["type"],
  message: string,
  data?: Record<string, unknown>
): CombatLogEvent {
  return {
    id: `${type}-${state.log.length + 1}`,
    round: state.snapshot.round,
    turnIndex: state.snapshot.turnIndex,
    type,
    message,
    data
  };
}

function declareAction(
  state: EngineState,
  actor: CombatantState,
  action: ActionDefinition,
  targetInfo: { target?: CombatantState; origin?: Point } = {}
): void {
  const targetText = targetInfo.target
    ? ` on ${targetInfo.target.displayName}`
    : targetInfo.origin
      ? ` at (${targetInfo.origin.x}, ${targetInfo.origin.y})`
      : "";
  const resourceCost = "resourceCost" in action && action.resourceCost ? action.resourceCost : undefined;
  // Area shape + damage type travel with the declaration so consumers (the
  // replay AoE flash) don't have to re-resolve the action definition.
  const area = "area" in action ? action.area : undefined;
  const damageType = "damage" in action ? action.damage?.[0]?.damageType : undefined;
  state.log.push(event(state, "ActionDeclared", `${actor.displayName} uses ${action.name}${targetText}`, {
    actorId: actor.id,
    actionId: action.id,
    actionName: action.name,
    actionKind: action.kind,
    actionType: action.actionType,
    targetId: targetInfo.target?.id,
    origin: targetInfo.origin,
    resourceCost,
    area,
    damageType
  }));
}

function validateTargeting(
  snapshot: EncounterSnapshot,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition | SaveActionDefinition
): void {
  if (target.state !== "active" && target.state !== "downed") {
    throw new Error("Target is not a legal active combatant");
  }
  const distance = gridDistance(attacker.position, target.position, snapshot.map.grid);
  const range = action.kind === "attack"
    ? action.attackType === "melee"
      ? action.reach ?? action.range
      : action.longRange ?? action.range
    : action.range;
  if (distance > range) {
    throw new Error(`Target is ${distance} ft. away, beyond ${range} ft. range`);
  }
  if (snapshot.rules.requireLineOfEffect && !lineOfEffect(snapshot.map, attacker.position, target.position)) {
    throw new Error("Line of effect is blocked");
  }
}

function attackIsAtLongRange(
  snapshot: EncounterSnapshot,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition
): boolean {
  if (action.attackType === "melee" || !action.longRange) {
    return false;
  }
  const distance = gridDistance(attacker.position, target.position, snapshot.map.grid);
  return distance > action.range && distance <= action.longRange;
}

function validateOriginTargeting(
  snapshot: EncounterSnapshot,
  attacker: CombatantState,
  origin: Point,
  action: AreaSaveActionDefinition
): void {
  const distance = gridDistance(attacker.position, origin, snapshot.map.grid);
  if (distance > action.range) {
    throw new Error(`Origin is ${distance} ft. away, beyond ${action.range} ft. range`);
  }
  if (snapshot.rules.requireLineOfEffect && !lineOfEffect(snapshot.map, attacker.position, origin)) {
    throw new Error("Line of effect to area origin is blocked");
  }
}

function validateHealingTargeting(
  snapshot: EncounterSnapshot,
  healer: CombatantState,
  target: CombatantState,
  action: HealingActionDefinition
): void {
  if (target.state === "dead" || target.state === "fled") {
    throw new Error("Target cannot be healed");
  }
  const distance = gridDistance(healer.position, target.position, snapshot.map.grid);
  if (distance > action.range) {
    throw new Error(`Target is ${distance} ft. away, beyond ${action.range} ft. range`);
  }
  if (snapshot.rules.requireLineOfEffect && !lineOfEffect(snapshot.map, healer.position, target.position)) {
    throw new Error("Line of effect is blocked");
  }
}

function rollD20(rng: RandomSource, options: { advantage?: boolean; disadvantage?: boolean }): DiceRollResult {
  const mode = attackRollMode(options);
  const first = rollDice("1d20", rng);
  if (mode === "normal") {
    return first;
  }
  const second = rollDice("1d20", rng);
  const selected = mode === "advantage"
    ? Math.max(first.total, second.total)
    : Math.min(first.total, second.total);
  return {
    expression: mode === "advantage" ? "1d20 with advantage" : "1d20 with disadvantage",
    rolls: [...first.rolls, ...second.rolls],
    modifier: 0,
    total: selected
  };
}

function rollD20WithBonus(
  rng: RandomSource,
  bonus: number,
  options: { advantage?: boolean; disadvantage?: boolean } = {}
): DiceRollResult {
  const mode = attackRollMode(options);
  if (mode === "normal") {
    return rollDice(withBonus("1d20", bonus), rng);
  }
  const roll = rollD20(rng, options);
  return {
    ...roll,
    expression: withBonus(roll.expression, bonus),
    modifier: bonus,
    total: roll.total + bonus
  };
}

function attackRollMode(options: { advantage?: boolean; disadvantage?: boolean }): AttackRollMode {
  const hasAdvantage = Boolean(options.advantage);
  const hasDisadvantage = Boolean(options.disadvantage);
  if (hasAdvantage === hasDisadvantage) {
    return "normal";
  }
  return hasAdvantage ? "advantage" : "disadvantage";
}

function applyDamageComponents(
  state: EngineState,
  target: CombatantState,
  damage: DamageComponent[],
  source: CreatureDefinition,
  critical: boolean,
  options: { halve?: boolean } = {}
): number {
  return applyDamageEntries(
    state,
    target,
    damage.map((component) => ({ component, critical, halve: options.halve })),
    source
  );
}

function applyDamageEntries(
  state: EngineState,
  target: CombatantState,
  entries: DamageApplicationEntry[],
  source: CreatureDefinition
): number {
  const targetDefinition = getDefinition(state.snapshot, target);
  let totalApplied = 0;
  const components = entries.map((entry) => {
    const component = entry.component;
    const dice = entry.critical ? doubleDice(component.dice) : component.dice;
    const damageSource = entry.sourceDefinition ?? source;
    const abilityBonus = component.abilityModifier ? abilityModifier(damageSource.abilities[component.abilityModifier]) : 0;
    const formulaBonus = resolveNumericFormula(component.bonusFormula, damageSource);
    const roll = rollDice(withBonus(dice, abilityBonus), state.rng);
    const damageType = resolveDamageTypeReference(component.damageType, entry.triggerDamageType);
    const adjusted = adjustDamage(roll.total + formulaBonus, damageType, damageAdjustmentsFor(targetDefinition, target));
    const finalAmount = entry.halve ? Math.floor(adjusted / 2) : adjusted;
    totalApplied += applyHpDamage(target, finalAmount);
    return {
      damageType,
      roll,
      adjusted,
      finalAmount,
      sourceFeatureId: entry.sourceFeatureId,
      sourceFeatureName: entry.sourceFeatureName,
      sourceEffectKind: entry.sourceEffectKind
    };
  });

  state.log.push(event(state, "DamageApplied", `${target.displayName} took ${totalApplied} damage`, {
    targetId: target.id,
    components,
    totalApplied,
    currentHp: target.currentHp,
    tempHp: target.tempHp
  }));
  if (totalApplied > 0) {
    resolveConcentration(state, target, totalApplied);
  }
  updateDefeatState(state, target);
  return totalApplied;
}

function applyHpDamage(target: CombatantState, amount: number): number {
  const tempAbsorbed = Math.min(target.tempHp, amount);
  target.tempHp -= tempAbsorbed;
  const remaining = amount - tempAbsorbed;
  target.currentHp = Math.max(0, target.currentHp - remaining);
  return amount;
}

function updateDefeatState(state: EngineState, target: CombatantState): void {
  if (target.currentHp > 0) {
    return;
  }
  if (target.faction === "party" && state.snapshot.rules.playerDeathSaves) {
    target.state = "downed";
    target.deathSaves = { successes: 0, failures: 0, stable: false };
    applyCondition(state, target.id, {
      id: `${target.id}-unconscious`,
      name: "unconscious",
      startedRound: state.snapshot.round
    });
    state.log.push(event(state, "CombatantDowned", `${target.displayName} is downed`, { combatantId: target.id }));
    return;
  }
  target.state = "defeated";
  state.log.push(event(state, "CombatantDefeated", `${target.displayName} is defeated`, { combatantId: target.id }));
}

function adjustDamage(amount: number, damageType: DamageType, adjustments: CreatureDefinition["damageAdjustments"]): number {
  if (adjustments?.some((adjustment) => adjustment.type === "immunity" && adjustment.damageType === damageType)) {
    return 0;
  }
  if (adjustments?.some((adjustment) => adjustment.type === "resistance" && adjustment.damageType === damageType)) {
    return Math.floor(amount / 2);
  }
  if (adjustments?.some((adjustment) => adjustment.type === "vulnerability" && adjustment.damageType === damageType)) {
    return amount * 2;
  }
  return amount;
}

function resolveDamageTypeReference(damageType: DamageTypeReference, triggerDamageType: DamageType | undefined): DamageType {
  return damageType === "same-as-attack" ? triggerDamageType ?? "slashing" : damageType;
}

function damageAdjustmentsFor(definition: CreatureDefinition, combatant: CombatantState): NonNullable<CreatureDefinition["damageAdjustments"]> {
  const effectAdjustments = featureSources(definition, combatant).flatMap((feature) => (feature.effects ?? [])
    .filter((effect): effect is Extract<FeatureEffect, { kind: "damage-adjustment" }> => effect.kind === "damage-adjustment")
    .filter((effect) => featureConditionsMetForSelf(definition, combatant, effect))
    .map((effect) => effect.adjustment));
  const conditionAdjustments = (combatant.conditions ?? []).flatMap((condition) => condition.modifiers?.damageAdjustments ?? []);
  return [...(definition.damageAdjustments ?? []), ...conditionAdjustments, ...effectAdjustments];
}

function effectiveArmorClass(definition: CreatureDefinition, combatant: CombatantState): number {
  const featureBonus = featureSources(definition, combatant).reduce((sum, feature) => sum + (feature.effects ?? []).reduce((effectSum, effect) => {
    return effect.kind === "armor-class-bonus" ? effectSum + resolveNumericFormula(effect.bonus, definition) : effectSum;
  }, 0), 0);
  return definition.armorClass + featureBonus + (combatant.conditions ?? [])
    .reduce((sum, condition) => sum + (condition.modifiers?.armorClass ?? 0), 0);
}

function conditionAttackModifier(combatant: CombatantState): number {
  return (combatant.conditions ?? []).reduce((sum, condition) => sum + (condition.modifiers?.attackRoll ?? 0), 0);
}

function conditionSaveModifier(combatant: CombatantState, ability: keyof CreatureDefinition["abilities"]): number {
  return (combatant.conditions ?? []).reduce((sum, condition) => sum + (condition.modifiers?.savingThrows?.[ability] ?? 0), 0);
}

function validateAndSpendAction(combatant: CombatantState, action: ActionDefinition): void {
  combatant.actionEconomy ??= { action: true, bonus: true, reaction: true };
  if (!combatant.actionEconomy[action.actionType]) {
    throw new Error(`${combatant.displayName} has already used a ${action.actionType}`);
  }
  if ("resourceCost" in action && action.resourceCost) {
    const available = combatant.resources?.[action.resourceCost.resourceId] ?? 0;
    if (available < action.resourceCost.amount) {
      throw new Error(`${combatant.displayName} lacks ${action.resourceCost.resourceId}`);
    }
    combatant.resources = {
      ...(combatant.resources ?? {}),
      [action.resourceCost.resourceId]: available - action.resourceCost.amount
    };
  }
  combatant.actionEconomy[action.actionType] = false;
}

function weaponToAction(definition: CreatureDefinition, weapon: NonNullable<CreatureDefinition["weapons"]>[number]): AttackActionDefinition {
  const magicBonus = weapon.magicBonus ?? 0;
  return {
    kind: "attack",
    id: weapon.actionId ?? `weapon:${weapon.id}`,
    name: weapon.name,
    actionType: "action",
    attackType: weapon.attackType,
    ability: weapon.ability,
    attackBonusFormula: {
      base: magicBonus,
      ability: weapon.ability,
      proficiency: true
    },
    range: weapon.range,
    longRange: weapon.longRange,
    reach: weapon.reach,
    damage: weapon.damage.map((component) => ({
      ...component,
      bonusFormula: magicBonus
        ? { ...(component.bonusFormula ?? {}), base: (component.bonusFormula?.base ?? 0) + magicBonus }
        : component.bonusFormula
    })),
    automationSupport: "full"
  };
}

function dedupeActionsById(actions: ActionDefinition[]): ActionDefinition[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.id)) {
      return false;
    }
    seen.add(action.id);
    return true;
  });
}

function applyFeatureActivationCondition(
  state: EngineState,
  actor: CombatantState,
  action: ActivateFeatureActionDefinition
): Id | undefined {
  if (!action.condition) {
    return undefined;
  }
  const conditionId = action.condition.id ?? `${actor.id}-${action.featureId}`;
  const durationRounds = action.condition.durationRounds;
  const actorDefinition = getDefinition(state.snapshot, actor);
  const feature = featureSources(actorDefinition, actor).find((candidate) => candidate.id === action.featureId);
  applyCondition(state, actor.id, {
    id: conditionId,
    name: action.condition.name ?? "custom",
    sourceId: action.featureId,
    sourceName: feature?.name,
    sourceCombatantId: actor.id,
    startedRound: state.snapshot.round,
    expiresAt: durationRounds
      ? {
        round: state.snapshot.round + durationRounds,
        turnIndex: state.snapshot.turnIndex,
        timing: "end"
      }
      : undefined,
    modifiers: action.condition.modifiers,
    effects: action.condition.effects
  });
  return conditionId;
}

function featureSources(definition: CreatureDefinition, combatant?: CombatantState): FeatureDefinitionSource[] {
  const activeConditionSources = (combatant?.conditions ?? [])
    .filter((condition) => condition.effects?.length)
    .map((condition) => ({
      id: condition.sourceId ?? condition.id,
      name: condition.sourceName ?? condition.id,
      category: "feature" as const,
      effects: condition.effects,
      automationSupport: "full" as const
    }));
  return [...(definition.features ?? []), ...(definition.traits ?? []), ...activeConditionSources];
}

type FeatureDefinitionSource = NonNullable<CreatureDefinition["features"]>[number];

function featureAttackAdvantage(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  definition: CreatureDefinition
): { applied: boolean; sources: string[] } {
  const sources = featureSources(definition, attacker)
    .filter((feature) => (feature.effects ?? []).some((effect) => effect.kind === "attack-advantage"
      && featureAppliesToAction(effect, action)
      && featureConditionsMet(state, attacker, target, effect, { rollMode: "normal", critical: false })));
  return { applied: sources.length > 0, sources: sources.map((source) => source.name) };
}

function featureAttackModifier(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  definition: CreatureDefinition,
  context: AttackFeatureContext
): { total: number; sources: string[] } {
  let total = 0;
  const sources: string[] = [];
  for (const feature of featureSources(definition, attacker)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "attack-bonus"
        || !featureAppliesToAction(effect, action)
        || !featureConditionsMet(state, attacker, target, effect, context)) {
        continue;
      }
      total += resolveNumericFormula(effect.bonus, definition);
      sources.push(feature.name);
    }
  }
  return { total, sources };
}

function featureDamageEntries(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  definition: CreatureDefinition,
  context: AttackFeatureContext
): FeatureDamageResolution {
  const entries: DamageApplicationEntry[] = [];
  const sources: string[] = [];
  for (const feature of featureSources(definition, attacker)) {
    for (const [effectIndex, effect] of (feature.effects ?? []).entries()) {
      if (!featureAppliesToAction(effect, action) || !featureConditionsMet(state, attacker, target, effect, context)) {
        continue;
      }
      if ((effect.kind === "damage-bonus" || effect.kind === "save-gated-damage")
        && effect.oncePerTurn
        && wasOncePerTurnEffectUsed(state, attacker.id, feature, effectIndex)) {
        continue;
      }
      if (effect.kind === "damage-bonus") {
        markFeatureEffectApplied(state, attacker, target, action, feature, effect, effectIndex);
        entries.push(...effect.damage.map((component) => ({
          component,
          critical: context.critical && (effect.critical ?? true),
          triggerDamageType: firstActionDamageType(action),
          sourceFeatureId: feature.id,
          sourceFeatureName: feature.name,
          sourceEffectKind: effect.kind
        })));
        sources.push(feature.name);
      }
      if (effect.kind === "save-gated-damage") {
        const save = resolveFeatureEffectSave(state, attacker, target, action, definition, feature, effect);
        markFeatureEffectApplied(state, attacker, target, action, feature, effect, effectIndex, {
          saveSuccess: save.success,
          saveTotal: save.total,
          saveDc: save.dc
        });
        entries.push(...effect.damage.map((component) => ({
          component,
          critical: context.critical && (effect.critical ?? false),
          halve: save.success && (effect.save.halfDamageOnSuccess ?? false),
          triggerDamageType: firstActionDamageType(action),
          sourceFeatureId: feature.id,
          sourceFeatureName: feature.name,
          sourceEffectKind: effect.kind
        })));
        sources.push(feature.name);
      }
      if (effect.kind === "swarm-damage") {
        entries.push(...swarmDamageFor(effect, attacker, definition).map((component) => ({
          component,
          critical: true,
          triggerDamageType: firstActionDamageType(action),
          sourceFeatureId: feature.id,
          sourceFeatureName: feature.name,
          sourceEffectKind: effect.kind
        })));
        sources.push(feature.name);
      }
    }
  }
  return { entries, sources };
}

function targetIncomingHitDamageEntries(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  context: AttackFeatureContext
): FeatureDamageResolution {
  const entries: DamageApplicationEntry[] = [];
  const sources: string[] = [];
  const consumedConditionIds: Id[] = [];
  for (const condition of target.conditions ?? []) {
    for (const effect of condition.effects ?? []) {
      if (effect.kind !== "incoming-hit-damage" || !featureConditionsMetForConditionTarget(state, target, effect)) {
        continue;
      }
      entries.push(...effect.damage.map((component) => ({
        component,
        critical: context.critical && (effect.critical ?? false),
        triggerDamageType: firstActionDamageType(action),
        sourceDefinition: effect.damageSource === "condition-source"
          ? conditionSourceDefinition(state, condition) ?? undefined
          : undefined,
        sourceFeatureId: condition.sourceId,
        sourceFeatureName: condition.sourceName ?? condition.id,
        sourceEffectKind: effect.kind
      })));
      sources.push(condition.sourceName ?? condition.id);
      state.log.push(event(state, "FeatureEffectApplied", `${target.displayName}'s ${condition.sourceName ?? condition.id} was triggered`, {
        combatantId: target.id,
        attackerId: attacker.id,
        targetId: target.id,
        actionId: action.id,
        featureId: condition.sourceId,
        featureName: condition.sourceName,
        conditionId: condition.id,
        effectKind: effect.kind
      }));
      if (effect.consumeCondition ?? true) {
        consumedConditionIds.push(condition.id);
      }
    }
  }
  return { entries, sources, consumedConditionIds };
}

function consumeTriggeredConditions(state: EngineState, target: CombatantState, conditionIds: Id[]): void {
  if (conditionIds.length === 0) {
    return;
  }
  const uniqueIds = new Set(conditionIds);
  const consumed = (target.conditions ?? []).filter((condition) => uniqueIds.has(condition.id));
  target.conditions = (target.conditions ?? []).filter((condition) => !uniqueIds.has(condition.id));
  for (const condition of consumed) {
    state.log.push(event(state, "ConditionExpired", `${target.displayName} lost ${condition.sourceName ?? condition.name}`, {
      combatantId: target.id,
      condition,
      reason: "consumed"
    }));
  }
}

function conditionSourceDefinition(state: EngineState, condition: ConditionInstance): CreatureDefinition | undefined {
  if (!condition.sourceCombatantId) {
    return undefined;
  }
  const source = state.snapshot.combatants.find((combatant) => combatant.id === condition.sourceCombatantId);
  return source ? getDefinition(state.snapshot, source) : undefined;
}

function applyOnHitFeatureConditions(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  definition: CreatureDefinition,
  context: AttackFeatureContext
): string[] {
  const sources: string[] = [];
  for (const feature of featureSources(definition, attacker)) {
    for (const [effectIndex, effect] of (feature.effects ?? []).entries()) {
      if (effect.kind !== "apply-condition-on-hit"
        || !featureAppliesToAction(effect, action)
        || !featureConditionsMet(state, attacker, target, effect, context)) {
        continue;
      }
      if (effect.oncePerTurn && wasOncePerTurnEffectUsed(state, attacker.id, feature, effectIndex)) {
        continue;
      }
      const recipient = effect.target === "self" ? attacker : target;
      const conditionId = effect.appliedCondition.id ?? `${recipient.id}-${feature.id}`;
      applyCondition(state, recipient.id, {
        id: conditionId,
        name: effect.appliedCondition.name ?? "custom",
        sourceId: feature.id,
        sourceName: feature.name,
        sourceCombatantId: attacker.id,
        startedRound: state.snapshot.round,
        expiresAt: effect.appliedCondition.durationRounds
          ? {
            round: state.snapshot.round + effect.appliedCondition.durationRounds,
            turnIndex: state.snapshot.turnIndex,
            timing: "end"
          }
          : undefined,
        modifiers: effect.appliedCondition.modifiers,
        effects: effect.appliedCondition.effects
      });
      markFeatureEffectApplied(state, attacker, recipient, action, feature, effect, effectIndex, {
        appliedConditionId: conditionId
      });
      sources.push(feature.name);
    }
  }
  return sources;
}

function featureSaveModifier(
  definition: CreatureDefinition,
  combatant: CombatantState,
  ability: keyof CreatureDefinition["abilities"]
): { total: number; sources: string[] } {
  let total = 0;
  const sources: string[] = [];
  for (const feature of featureSources(definition, combatant)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind === "save-bonus" && (!effect.ability || effect.ability === ability)) {
        total += resolveNumericFormula(effect.bonus, definition);
        sources.push(feature.name);
      }
    }
  }
  return { total, sources };
}

function featureSaveAdvantageModifier(
  definition: CreatureDefinition,
  combatant: CombatantState,
  ability: keyof CreatureDefinition["abilities"]
): { applied: boolean; sources: string[] } {
  const sources: string[] = [];
  for (const feature of featureSources(definition, combatant)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind === "save-advantage"
        && (!effect.ability || effect.ability === ability)
        && featureConditionsMetForSelf(definition, combatant, effect)) {
        sources.push(feature.name);
      }
    }
  }
  return { applied: sources.length > 0, sources };
}

function featureSaveDcModifier(
  definition: CreatureDefinition,
  action: SaveActionDefinition | AreaSaveActionDefinition
): { total: number; sources: string[] } {
  let total = 0;
  const sources: string[] = [];
  for (const feature of featureSources(definition)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "save-dc-bonus") {
        continue;
      }
      if (effect.actionIds && !effect.actionIds.includes(action.id)) {
        continue;
      }
      total += resolveNumericFormula(effect.bonus, definition);
      sources.push(feature.name);
    }
  }
  return { total, sources };
}

function resolveFeatureEffectSave(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  definition: CreatureDefinition,
  feature: FeatureDefinitionSource,
  effect: Extract<FeatureEffect, { kind: "save-gated-damage" }>
): { success: boolean; total: number; dc: number; saveRoll: DiceRollResult } {
  const targetDefinition = getDefinition(state.snapshot, target);
  const saveAbility = effect.save.ability;
  const saveBonus = (targetDefinition.saves?.[saveAbility]
    ?? abilityModifier(targetDefinition.abilities[saveAbility]))
    + conditionSaveModifier(target, saveAbility);
  const featureSaveBonus = featureSaveModifier(targetDefinition, target, saveAbility);
  const featureSaveAdvantage = featureSaveAdvantageModifier(targetDefinition, target, saveAbility);
  const saveRoll = rollD20WithBonus(state.rng, saveBonus + featureSaveBonus.total, {
    advantage: featureSaveAdvantage.applied
  });
  const dc = resolveFeatureSaveDc(effect.save, definition);
  const success = saveRoll.total >= dc;

  state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${saveAbility.toUpperCase()} save against ${feature.name}`, {
    attackerId: attacker.id,
    targetId: target.id,
    actionId: action.id,
    featureId: feature.id,
    effectKind: effect.kind,
    saveRoll,
    total: saveRoll.total,
    dc,
    featureSaveBonus: featureSaveBonus.total,
    appliedSaveEffects: [...featureSaveBonus.sources, ...featureSaveAdvantage.sources],
    success
  }));

  return { success, total: saveRoll.total, dc, saveRoll };
}

function resolveFeatureSaveDc(save: FeatureEffectSaveGate, definition: CreatureDefinition): number {
  if (save.dcFormula) {
    return resolveNumericFormula(save.dcFormula, definition);
  }
  return save.dc ?? 8 + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition));
}

function markFeatureEffectApplied(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  feature: FeatureDefinitionSource,
  effect: FeatureEffect,
  effectIndex: number,
  extraData: Record<string, unknown> = {}
): void {
  state.log.push(event(state, "FeatureEffectApplied", `${attacker.displayName} applied ${feature.name}`, {
    combatantId: attacker.id,
    targetId: target.id,
    actionId: action.id,
    featureId: feature.id,
    featureName: feature.name,
    effectKind: effect.kind,
    effectUseKey: featureEffectUseKey(feature, effect, effectIndex),
    ...extraData
  }));
}

function wasOncePerTurnEffectUsed(
  state: EngineState,
  combatantId: Id,
  feature: FeatureDefinitionSource,
  effectIndex: number
): boolean {
  const effect = feature.effects?.[effectIndex];
  if (!effect) {
    return false;
  }
  const effectUseKey = featureEffectUseKey(feature, effect, effectIndex);
  return state.log.some((entry) => entry.type === "FeatureEffectApplied"
    && entry.round === state.snapshot.round
    && entry.turnIndex === state.snapshot.turnIndex
    && entry.data?.combatantId === combatantId
    && entry.data.effectUseKey === effectUseKey);
}

function featureEffectUseKey(feature: FeatureDefinitionSource, effect: FeatureEffect, effectIndex: number): string {
  const explicitId = "id" in effect && typeof effect.id === "string" ? effect.id : undefined;
  return `${feature.id}:${explicitId ?? effectIndex}`;
}

function featureAppliesToAction(effect: FeatureEffect, action: AttackActionDefinition): boolean {
  if ("actionIds" in effect && effect.actionIds && !effect.actionIds.includes(action.id)) {
    return false;
  }
  if ("attackTypes" in effect && effect.attackTypes && !effect.attackTypes.includes(action.attackType)) {
    return false;
  }
  return !("abilities" in effect) || !effect.abilities || effect.abilities.includes(action.ability);
}

function featureConditionsMet(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  effect: FeatureEffect,
  context: AttackFeatureContext
): boolean {
  const required = [
    ...("condition" in effect && effect.condition ? [effect.condition] : []),
    ...("allConditions" in effect && effect.allConditions ? effect.allConditions : [])
  ];
  const alternatives = "anyConditions" in effect && effect.anyConditions ? effect.anyConditions : [];
  return required.every((condition) => featureConditionMet(state, attacker, target, condition, context))
    && (alternatives.length === 0 || alternatives.some((condition) => featureConditionMet(state, attacker, target, condition, context)));
}

function featureConditionMet(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  condition: FeatureCondition,
  context: AttackFeatureContext
): boolean {
  if (condition === "always") return true;
  if (condition === "attack-has-advantage") return context.rollMode === "advantage";
  if (condition === "attack-has-no-disadvantage") return context.rollMode !== "disadvantage";
  if (condition === "ally-adjacent-to-target") {
    return state.snapshot.combatants.some((combatant) => combatant.id !== attacker.id
      && combatant.faction === attacker.faction
      && combatant.state === "active"
      && gridDistance(combatant.position, target.position, state.snapshot.map.grid) <= 5);
  }
  if (condition === "target-bloodied") return isBloodied(state.snapshot, target);
  if (condition === "self-bloodied") return isBloodied(state.snapshot, attacker);
  return false;
}

function featureConditionsMetForSelf(
  definition: CreatureDefinition,
  combatant: CombatantState,
  effect: FeatureEffect
): boolean {
  const required = [
    ...("condition" in effect && effect.condition ? [effect.condition] : []),
    ...("allConditions" in effect && effect.allConditions ? effect.allConditions : [])
  ];
  const alternatives = "anyConditions" in effect && effect.anyConditions ? effect.anyConditions : [];
  return required.every((condition) => selfFeatureConditionMet(definition, combatant, condition))
    && (alternatives.length === 0 || alternatives.some((condition) => selfFeatureConditionMet(definition, combatant, condition)));
}

function featureConditionsMetForConditionTarget(
  state: EngineState,
  target: CombatantState,
  effect: FeatureEffect
): boolean {
  const targetDefinition = getDefinition(state.snapshot, target);
  return featureConditionsMetForSelf(targetDefinition, target, effect);
}

function selfFeatureConditionMet(
  definition: CreatureDefinition,
  combatant: CombatantState,
  condition: FeatureCondition
): boolean {
  if (condition === "always") return true;
  if (condition === "self-bloodied" || condition === "target-bloodied") {
    return combatant.currentHp <= Math.floor(definition.maxHp / 2);
  }
  if (condition === "attack-has-no-disadvantage") return true;
  return false;
}

function swarmDamageFor(effect: Extract<FeatureEffect, { kind: "swarm-damage" }>, attacker: CombatantState, definition: CreatureDefinition): DamageComponent[] {
  return attacker.currentHp <= Math.floor(definition.maxHp / 2)
    ? effect.bloodiedDamage ?? []
    : effect.fullHpDamage;
}

function isBloodied(snapshot: EncounterSnapshot, combatant: CombatantState): boolean {
  const definition = getDefinition(snapshot, combatant);
  return combatant.currentHp <= Math.floor(definition.maxHp / 2);
}

function firstActionDamageType(action: AttackActionDefinition): DamageType | undefined {
  const damageType = action.damage[0]?.damageType;
  return damageType === "same-as-attack" ? undefined : damageType;
}

function proficiencyFromDefinition(definition: CreatureDefinition): number {
  const level = definition.character?.level ?? definition.character?.classes?.reduce((sum, entry) => sum + entry.level, 0) ?? 1;
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

function resolveConcentration(state: EngineState, combatant: CombatantState, damageTaken: number): void {
  if (!combatant.concentration) {
    return;
  }
  const definition = getDefinition(state.snapshot, combatant);
  const conBonus = definition.saves?.con ?? abilityModifier(definition.abilities.con);
  const featureSaveBonus = featureSaveModifier(definition, combatant, "con");
  const featureSaveAdvantage = featureSaveAdvantageModifier(definition, combatant, "con");
  const dc = Math.max(10, Math.floor(damageTaken / 2));
  const roll = rollD20WithBonus(state.rng, conBonus + featureSaveBonus.total, {
    advantage: featureSaveAdvantage.applied
  });
  const success = roll.total >= dc;
  if (!success) {
    const sourceConditionId = combatant.concentration.sourceConditionId;
    combatant.concentration = undefined;
    if (sourceConditionId) {
      combatant.conditions = (combatant.conditions ?? []).filter((condition) => condition.id !== sourceConditionId);
    }
  }
  state.log.push(event(state, "ConcentrationChecked", `${combatant.displayName} checked concentration`, {
    combatantId: combatant.id,
    dc,
    roll,
    featureSaveBonus: featureSaveBonus.total,
    appliedSaveEffects: [...featureSaveBonus.sources, ...featureSaveAdvantage.sources],
    success
  }));
}

function doubleDice(expression: string): string {
  return expression.replace(/(\d*)d(\d+)/gi, (_match, count: string, sides: string) => {
    const parsedCount = count ? Number.parseInt(count, 10) : 1;
    return `${parsedCount * 2}d${sides}`;
  });
}

function withBonus(expression: string, bonus: number): string {
  if (bonus === 0) {
    return expression;
  }
  return `${expression}${bonus > 0 ? "+" : ""}${bonus}`;
}

function moveAlongPath(
  state: EngineState,
  combatant: CombatantState,
  cells: Point[],
  provokeOpportunityAttacks: boolean
): Point[] {
  if (cells.length === 0) {
    return [];
  }
  const movedCells = [cells[0] as Point];
  combatant.position = cells[0] as Point;
  for (let index = 1; index < cells.length; index += 1) {
    const from = cells[index - 1] as Point;
    const to = cells[index] as Point;
    combatant.position = from;
    if (provokeOpportunityAttacks) {
      resolveOpportunityAttacksForStep(state, combatant, from, to);
      if (combatant.state !== "active") {
        return movedCells;
      }
    }
    combatant.position = to;
    movedCells.push(to);
  }
  return movedCells;
}

function resolveOpportunityAttacksForStep(
  state: EngineState,
  mover: CombatantState,
  from: Point,
  to: Point
): void {
  for (const reactor of state.snapshot.combatants) {
    if (reactor.id === mover.id || reactor.faction === mover.faction || reactor.state !== "active" || mover.state !== "active") {
      continue;
    }
    const action = opportunityAttackAction(state.snapshot, reactor, from, to);
    if (!action) {
      continue;
    }
    const reactorDefinition = getDefinition(state.snapshot, reactor);
    const reactionAction: AttackActionDefinition = { ...action, actionType: "reaction" };
    state.log.push(event(state, "OpportunityAttackTriggered", `${reactor.displayName} makes an opportunity attack against ${mover.displayName}`, {
      reactorId: reactor.id,
      moverId: mover.id,
      actionId: action.id,
      from,
      to
    }));
    resolveAttackCore(state, reactor, mover, reactorDefinition, reactionAction, {}, true);
  }
}

function opportunityAttackAction(
  snapshot: EncounterSnapshot,
  reactor: CombatantState,
  from: Point,
  to: Point
): AttackActionDefinition | undefined {
  if (reactor.actionEconomy?.reaction === false) {
    return undefined;
  }
  const definition = getDefinition(snapshot, reactor);
  return getExecutableActions(definition).find((action): action is AttackActionDefinition => {
    if (action.kind !== "attack" || action.attackType !== "melee" || action.automationSupport !== "full") {
      return false;
    }
    if (!canSpendResource(reactor, action)) {
      return false;
    }
    const reach = action.reach ?? action.range;
    const wasInReach = gridDistance(reactor.position, from, snapshot.map.grid) <= reach;
    const leavesReach = gridDistance(reactor.position, to, snapshot.map.grid) > reach;
    return wasInReach
      && leavesReach
      && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, reactor.position, from));
  });
}

function occupiedCells(snapshot: EncounterSnapshot, movingCombatantId: Id): Point[] {
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

function canSpendResource(combatant: CombatantState, action: ActionDefinition): boolean {
  if (!("resourceCost" in action) || !action.resourceCost) {
    return true;
  }
  return (combatant.resources?.[action.resourceCost.resourceId] ?? 0) >= action.resourceCost.amount;
}

function pointsEqual(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
