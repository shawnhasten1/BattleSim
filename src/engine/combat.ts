import { combatantsInArea } from "./areas";
import { rollDice, abilityModifier, repeatDice, resolveScaledDamage, type DiceRollResult } from "./dice";
import { coverBetween, gridDistance, lineOfEffect, findPath, sizeFootprint, type CoverBlocker } from "./geometry";
import { SeededRandom, type RandomSource } from "./rng";
import type {
  Ability,
  ActionDefinition,
  ActionRider,
  ActivateFeatureActionDefinition,
  AreaSaveActionDefinition,
  AttackActionDefinition,
  CombatLogEvent,
  CombatantState,
  ConditionInstance,
  ConditionName,
  CoverLevel,
  CreatureDefinition,
  DamageAdjustment,
  DamageComponent,
  DamageType,
  DamageTypeReference,
  EncounterSnapshot,
  FeatureCondition,
  FeatureEffect,
  FeatureEffectSaveGate,
  HealingActionDefinition,
  HealingComponent,
  Id,
  MultiattackActionDefinition,
  NumericFormula,
  Point,
  ReactionMeta,
  ReactionTrigger,
  RiderDuration,
  RiderGate,
  SaveActionDefinition,
  UtilityActionDefinition
} from "./types";

export interface EngineState {
  snapshot: EncounterSnapshot;
  log: CombatLogEvent[];
  rng: RandomSource;
  /** Re-entrancy guard for `runReactionWindow` — a reaction can't open the same window past depth 2. */
  reactionDepth?: number;
}

/** How deep reaction windows may nest (a counter-counterspell is legal; a third is not). */
const MAX_REACTION_DEPTH = 2;

export interface AttackResult {
  hit: boolean;
  critical: boolean;
  attackRoll: DiceRollResult;
  total: number;
  targetAc: number;
  damageApplied: number;
  /** Present when the action used `attackDelivery: "beams"` — one entry per beam. */
  beams?: AttackResult[];
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
  /** Caster level for a component's `cantrip-by-level` scaling. */
  casterLevel?: number;
  /** Extra dice appended before crit-doubling (per-slot upcast bonus). */
  extraDice?: string;
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

/**
 * `getExecutableActions` is pure in `definition` and called on hot paths (every
 * reaction window scans it per combatant). Definitions are immutable for the
 * life of an engine run — the store hands out a fresh object on every edit — so
 * memoising on object identity is safe.
 */
const executableActionsCache = new WeakMap<CreatureDefinition, ActionDefinition[]>();

export function getExecutableActions(definition: CreatureDefinition): ActionDefinition[] {
  const cached = executableActionsCache.get(definition);
  if (cached) {
    return cached;
  }
  const compiled = compileExecutableActions(definition);
  executableActionsCache.set(definition, compiled);
  return compiled;
}

function compileExecutableActions(definition: CreatureDefinition): ActionDefinition[] {
  const weaponActions = (definition.weapons ?? []).flatMap((weapon) => weaponToActions(definition, weapon));
  const spellActions = (definition.spells ?? [])
    .flatMap((spell) => (spell.action ? [stampSpellContext(spell.action, spell)] : []));
  const grantedActions = [
    ...(definition.features ?? []),
    ...(definition.traits ?? [])
  ].flatMap((feature) => feature.grantedActions ?? []);

  const declared = [
    ...definition.actions,
    ...(definition.bonusActions ?? []),
    ...(definition.reactions ?? []),
    ...weaponActions,
    ...spellActions,
    ...grantedActions
  ];

  return dedupeActionsById([
    ...declared,
    ...synthesizeUtilityActions(declared)
  ]).map(withEffectiveAutomationSupport);
}

/** The standard non-attack actions every creature has, and whether the engine can drive them. */
const STANDARD_UTILITY_MODES: ReadonlyArray<{
  mode: UtilityActionDefinition["mode"];
  name: string;
  automationSupport: "full" | "partial";
}> = [
  { mode: "dash", name: "Dash", automationSupport: "full" },
  { mode: "disengage", name: "Disengage", automationSupport: "full" },
  { mode: "dodge", name: "Dodge", automationSupport: "full" },
  { mode: "hide", name: "Hide", automationSupport: "partial" },
  { mode: "help", name: "Help", automationSupport: "partial" }
];

/**
 * Synthesise the `action`-cost Dash / Disengage / Dodge / Hide / Help for a
 * creature, skipping any mode it already authors as an `action`-cost utility (or
 * whose `utility:<mode>` id is already taken). A feature-granted `bonus`-cost
 * Disengage (Cunning Action) doesn't suppress the full-action one.
 */
function synthesizeUtilityActions(declared: ActionDefinition[]): UtilityActionDefinition[] {
  const declaredIds = new Set(declared.map((action) => action.id));
  const authoredActionModes = new Set(
    declared
      .filter((action): action is UtilityActionDefinition => action.kind === "utility" && action.actionType === "action")
      .map((action) => action.mode)
  );
  return STANDARD_UTILITY_MODES
    .filter(({ mode }) => !authoredActionModes.has(mode) && !declaredIds.has(`utility:${mode}`))
    .map(({ mode, name, automationSupport }) => ({
      kind: "utility",
      id: `utility:${mode}`,
      name,
      actionType: "action",
      mode,
      automationSupport
    }));
}

/** Down-grade an action's `automationSupport` when a rider needs a human, keeping object identity otherwise. */
function withEffectiveAutomationSupport(action: ActionDefinition): ActionDefinition {
  const effective = effectiveAutomationSupport(action);
  const authored = "automationSupport" in action ? action.automationSupport : "full";
  return effective === authored ? action : ({ ...action, automationSupport: effective } as ActionDefinition);
}

/**
 * The automation level an action's riders permit. Never *raises* the authored
 * level; lowers `full` → `partial` when a rider is reference-only (`note`) or
 * carries a condition the engine cannot apply (`{ custom }`).
 */
export function effectiveAutomationSupport(
  action: ActionDefinition
): "full" | "partial" | "manual-only" | "unsupported" {
  const authored = "automationSupport" in action ? action.automationSupport : "full";
  if (authored !== "full") {
    return authored;
  }
  const riders = "riders" in action ? action.riders ?? [] : [];
  return ridersNeedHuman(riders) ? "partial" : "full";
}

function ridersNeedHuman(riders: ActionRider[]): boolean {
  return riders.some((rider) =>
    rider.kind === "note" || (rider.kind === "condition" && typeof rider.condition !== "string"));
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
  const movementBudget = definition.speed / state.snapshot.map.grid.distancePerSquare / movementMultiplier * dashFactor(combatant);

  if (!path.reachable || path.cost > movementBudget) {
    throw new Error(`Destination is not reachable with ${definition.speed} ft. of movement`);
  }

  const provoke = (options.provokeOpportunityAttacks ?? true)
    && !moverAvoidsOpportunityAttacks(state.snapshot, combatant);
  const movedCells = moveAlongPath(state, combatant, path.cells, provoke);
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
  if (mover.state !== "active" || cells.length < 2 || moverAvoidsOpportunityAttacks(snapshot, mover)) {
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
      const action = findLeaveReachReaction(snapshot, reactor, mover, from, to);
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
  targetIds: Id | Id[],
  actionId: Id,
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number; slotLevel?: number } = {}
): AttackResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "attack") {
    throw new Error(`Attack action ${actionId} is not available to ${attacker.displayName}`);
  }
  const ids = Array.isArray(targetIds) ? targetIds : [targetIds];
  if (ids.length === 0) {
    throw new Error(`Attack action ${actionId} needs at least one target`);
  }
  if (action.attackDelivery === "beams") {
    return resolveBeamAttack(state, attacker, attackerDefinition, action, ids, options);
  }
  const target = findCombatant(state.snapshot, ids[0] as Id);
  return resolveAttackCore(state, attacker, target, attackerDefinition, action, options, true);
}

export function resolveBeamCount(action: AttackActionDefinition, casterLevel: number, slotLevel: number | undefined): number {
  let count = action.beamCount ?? 1;
  for (const step of action.beamCountByLevel ?? []) {
    if (casterLevel >= step.atLevel) {
      count = step.count;
    }
  }
  if (slotLevel != null && action.spellLevel != null && action.upcast?.perSlotAboveBase?.beams) {
    count += Math.max(0, slotLevel - action.spellLevel) * action.upcast.perSlotAboveBase.beams;
  }
  return Math.max(1, count);
}

function resolveAutoHitBeam(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  attackerDefinition: CreatureDefinition,
  action: AttackActionDefinition
): AttackResult {
  const casterLevel = casterLevelOf(attackerDefinition);
  const damageApplied = applyDamageEntries(state, target, action.damage.map((component) => ({
    component, critical: false, triggerDamageType: firstActionDamageType(action), casterLevel
  })), attackerDefinition);
  state.log.push(event(state, "AttackRolled", `${attacker.displayName} auto-hit ${target.displayName} with ${action.name}`, {
    attackerId: attacker.id, targetId: target.id, actionId: action.id, autoHit: true, hit: true, critical: false, damageApplied
  }));
  if (action.riders?.length) {
    applyActionRiders(state, attacker, target, attackerDefinition, action.riders, {
      actionId: action.id, landed: true, saved: null, origin: attacker.position,
      fallbackDc: 8 + (attackerDefinition.proficiencyBonus ?? proficiencyFromDefinition(attackerDefinition))
    });
  }
  return {
    hit: true, critical: false,
    attackRoll: { expression: "auto-hit", rolls: [], modifier: 0, total: 0 },
    total: 0, targetAc: 0, damageApplied
  };
}

function resolveBeamAttack(
  state: EngineState,
  attacker: CombatantState,
  attackerDefinition: CreatureDefinition,
  action: AttackActionDefinition,
  targetIds: Id[],
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number; slotLevel?: number }
): AttackResult {
  validateAndSpendAction(attacker, action);
  if (action.concentration) {
    breakConcentration(state, attacker.id);
  }
  const beamCount = resolveBeamCount(action, casterLevelOf(attackerDefinition), options.slotLevel);
  declareAction(state, attacker, action, { target: findCombatant(state.snapshot, targetIds[0] as Id) });
  if (counterspellWindow(state, attacker, action)) {
    return emptyAttackResult();
  }

  const beams: AttackResult[] = [];
  let totalDamage = 0;
  for (let index = 0; index < beamCount; index += 1) {
    const targetId = targetIds[Math.min(index, targetIds.length - 1)] as Id;
    const target = findCombatant(state.snapshot, targetId);
    if (target.state !== "active" && target.state !== "downed") {
      continue;
    }
    const beam = action.autoHit
      ? resolveAutoHitBeam(state, attacker, target, attackerDefinition, action)
      : resolveAttackCore(state, attacker, target, attackerDefinition, action, { ...options, suppressDeclare: true }, false);
    beams.push(beam);
    totalDamage += beam.damageApplied;
  }

  state.log.push(event(state, "BeamsResolved", `${attacker.displayName} resolved ${action.name} (${beams.length} beams)`, {
    attackerId: attacker.id, actionId: action.id, beams: beams.length, totalDamage, autoHit: action.autoHit === true
  }));

  const first = beams[0];
  return {
    hit: beams.some((beam) => beam.hit),
    critical: beams.some((beam) => beam.critical),
    attackRoll: first?.attackRoll ?? { expression: "beams", rolls: [], modifier: 0, total: 0 },
    total: first?.total ?? 0,
    targetAc: first?.targetAc ?? 0,
    damageApplied: totalDamage,
    beams
  };
}

/** A multiattack target is still worth swinging at while active or merely downed. */
function isLiveTarget(target: CombatantState | undefined): target is CombatantState {
  return !!target && (target.state === "active" || target.state === "downed");
}

export function resolveMultiattackAction(
  state: EngineState,
  attackerId: Id,
  targetIds: Id | Id[],
  actionId: Id,
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number } = {}
): MultiattackResult {
  const ids = (Array.isArray(targetIds) ? targetIds : [targetIds]).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("resolveMultiattackAction needs at least one target");
  }
  const attacker = findCombatant(state.snapshot, attackerId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "multiattack") {
    throw new Error(`Multiattack action ${actionId} is not available to ${attacker.displayName}`);
  }
  validateAndSpendAction(attacker, action);

  const targets = ids.map((id) => findCombatant(state.snapshot, id));
  declareAction(state, attacker, action, { target: targets[0] });

  // A step aims at its `targetGroup` index; if that target is down we spill to
  // the next live one (mirrors beam spread), scanning forward then wrapping.
  const pickTarget = (preferred: number): CombatantState | undefined => {
    const start = Math.min(Math.max(0, preferred), targets.length - 1);
    for (let offset = 0; offset < targets.length; offset += 1) {
      const candidate = targets[(start + offset) % targets.length];
      if (isLiveTarget(candidate)) {
        return candidate;
      }
    }
    return undefined;
  };

  const attacks: AttackResult[] = [];
  for (const step of action.attacks) {
    const child = findActionDefinition(attackerDefinition, step.actionId);
    if (!child || child.kind !== "attack") {
      throw new Error(`Multiattack child action ${step.actionId} is not an attack`);
    }
    for (let index = 0; index < step.count; index += 1) {
      // A `hit-by-attack` reaction (Hellish Rebuke) can drop the attacker mid-multiattack.
      if (attacker.state !== "active") {
        break;
      }
      const target = pickTarget(step.targetGroup ?? 0);
      if (!target) {
        break;
      }
      attacks.push(resolveAttackCore(state, attacker, target, attackerDefinition, child, options, false, action));
    }
  }

  state.log.push(event(state, "MultiattackResolved", `${attacker.displayName} resolved ${action.name}`, {
    attackerId,
    targetId: ids[0],
    targetIds: ids,
    actionId,
    attacks: attacks.length
  }));

  return { attacks };
}

/**
 * Take a standard non-attack action. Dash sets the `dashed` turn flag (movement
 * budget ×2); Disengage sets `disengaged` (movement provokes nothing this turn);
 * Dodge applies a self-condition that shifts incoming attacks and DEX saves
 * until the actor's next turn. Hide / Help are logged but not modelled.
 */
export function resolveUtilityAction(state: EngineState, actorId: Id, actionId: Id): void {
  const actor = findCombatant(state.snapshot, actorId);
  const definition = getDefinition(state.snapshot, actor);
  const action = findActionDefinition(definition, actionId);
  if (!action || action.kind !== "utility") {
    throw new Error(`Utility action ${actionId} is not available to ${actor.displayName}`);
  }
  validateAndSpendAction(actor, action);
  declareAction(state, actor, action);

  actor.turnFlags ??= {};
  if (action.mode === "dash") {
    actor.turnFlags.dashed = true;
  } else if (action.mode === "disengage") {
    actor.turnFlags.disengaged = true;
  } else if (action.mode === "dodge") {
    const bearerIdx = state.snapshot.combatants.findIndex((c) => c.id === actorId);
    const { expiresAt } = riderDurationToExpiry(
      state,
      { kind: "until-start-of-next-turn" },
      bearerIdx >= 0 ? bearerIdx : undefined
    );
    applyCondition(state, actorId, {
      id: `${actorId}:dodge`,
      name: "custom",
      sourceName: "Dodge",
      sourceCombatantId: actorId,
      startedRound: state.snapshot.round,
      expiresAt,
      // -4 ≈ disadvantage for the sim; the proper "attacker rolls with
      // disadvantage" model is a later condition-interaction pass.
      modifiers: { incomingAttackRoll: -4, savingThrows: { dex: 2 } }
    });
  } else {
    state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s ${action.mode} action is not automated`, {
      combatantId: actorId, actionId, mode: action.mode
    }));
  }

  state.log.push(event(state, "UtilityActionResolved", `${actor.displayName} took the ${action.name} action`, {
    actorId, actionId, mode: action.mode, actionType: action.actionType
  }));
}

/** Movement-budget multiplier from the Dash action (turn flag set by `resolveUtilityAction`). */
export function dashFactor(combatant: CombatantState): number {
  return combatant.turnFlags?.dashed ? 2 : 1;
}

function coverLabel(level: CoverLevel): string {
  return level === "half" ? "half cover"
    : level === "three-quarters" ? "three-quarters cover"
      : level === "total" ? "total cover"
        : "no cover";
}

/** Active combatants (other than the two given) as cover blockers, when the optional creature-cover rule is on. */
function coverBlockersFor(snapshot: EncounterSnapshot, ...excludeIds: Id[]): CoverBlocker[] {
  if (!snapshot.rules.coverFromCreatures) {
    return [];
  }
  return snapshot.combatants
    .filter((combatant) => combatant.state === "active" && !excludeIds.includes(combatant.id))
    .map((combatant) => ({
      position: combatant.position,
      footprint: sizeFootprint(getDefinition(snapshot, combatant).size)
    }));
}

/**
 * Cover for `target` from `from`'s position, for a ranged/effect line. Melee is
 * unaffected. Respects `rules.cover`; `total` cover yields an AC bonus only in
 * the "soft" profile where line of effect is not enforced (otherwise the shot is
 * refused before this matters).
 */
function coverAgainst(
  snapshot: EncounterSnapshot,
  from: CombatantState,
  target: CombatantState
): { level: CoverLevel; acBonus: number; sources: string[] } {
  if (!snapshot.rules.cover) {
    return { level: "none", acBonus: 0, sources: [] };
  }
  const result = coverBetween(
    snapshot.map,
    from.position,
    sizeFootprint(getDefinition(snapshot, from).size),
    target.position,
    sizeFootprint(getDefinition(snapshot, target).size),
    { blockers: coverBlockersFor(snapshot, from.id, target.id) }
  );
  const acBonus = result.blocksTargeting
    ? (snapshot.rules.requireLineOfEffect ? 0 : 5)
    : result.acBonus;
  return { level: result.level, acBonus, sources: result.sources };
}

/** The result a spell resolver returns when the spell was countered before it could take effect. */
function emptyAttackResult(): AttackResult {
  return {
    hit: false, critical: false,
    attackRoll: { expression: "countered", rolls: [], modifier: 0, total: 0 },
    total: 0, targetAc: 0, damageApplied: 0
  };
}

function resolveAttackCore(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  attackerDefinition: CreatureDefinition,
  action: AttackActionDefinition,
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number; suppressDeclare?: boolean },
  spendAction: boolean,
  parentAction?: MultiattackActionDefinition
): AttackResult {
  const targetDefinition = getDefinition(state.snapshot, target);
  validateTargeting(state.snapshot, attacker, target, action);
  const cover = options.coverBonus === undefined && action.attackType !== "melee"
    ? coverAgainst(state.snapshot, attacker, target)
    : { level: "none" as const, acBonus: options.coverBonus ?? 0, sources: [] as string[] };
  if (spendAction) {
    validateAndSpendAction(attacker, action);
  }
  if (spendAction && action.concentration) {
    breakConcentration(state, attacker.id);
  }
  if (!parentAction && !options.suppressDeclare) {
    declareAction(state, attacker, action, { target });
  }

  // Counterspell — spell attacks only, and only when this call owns the cast.
  if (spendAction && !parentAction && counterspellWindow(state, attacker, action)) {
    return emptyAttackResult();
  }

  // Pre-roll reactions: Shield raises `target`'s AC (a condition `effectiveArmorClass`
  // reads below); Protection forces the roll to disadvantage.
  runReactionWindow(state, {
    kind: "targeted-by-attack", sourceId: attacker.id, targetId: target.id, attackType: action.attackType
  });
  const forcedDisadvantage = runReactionWindow(state, {
    kind: "ally-targeted-by-attack", sourceId: attacker.id, targetId: target.id, attackType: action.attackType
  }).imposedDisadvantage === true;

  const featureAdvantage = featureAttackAdvantage(state, attacker, target, action, attackerDefinition);
  const longRange = attackIsAtLongRange(state.snapshot, attacker, target, action);
  const attackOptions = {
    ...options,
    advantage: options.advantage || featureAdvantage.applied,
    disadvantage: options.disadvantage || longRange || forcedDisadvantage
  };
  const rollMode = attackRollMode({
    ...attackOptions
  });
  const d20 = rollD20(state.rng, attackOptions);
  const attackBonus = resolveAttackBonus(action, attackerDefinition);
  const featureAttackBonus = featureAttackModifier(state, attacker, target, action, attackerDefinition, { rollMode, critical: false });
  const total = d20.total + attackBonus + conditionAttackModifier(attacker)
    + conditionIncomingAttackModifier(target) + featureAttackBonus.total;
  const targetAc = effectiveArmorClass(targetDefinition, target) + cover.acBonus;
  const natural = d20.total;
  const critical = natural === 20;
  const hit = critical || (natural !== 1 && total >= targetAc);
  const featureDamage = hit
    ? featureDamageEntries(state, attacker, target, action, attackerDefinition, { rollMode, critical })
    : { entries: [], sources: [] };
  const targetHitDamage = hit
    ? targetIncomingHitDamageEntries(state, attacker, target, action, { rollMode, critical })
    : { entries: [], sources: [] };
  const casterLevel = casterLevelOf(attackerDefinition);
  const damageApplied = hit
    ? applyDamageEntries(state, target, [
      ...action.damage.map((component) => ({ component, critical, triggerDamageType: firstActionDamageType(action), casterLevel })),
      ...featureDamage.entries,
      ...targetHitDamage.entries
    ], attackerDefinition)
    : 0;
  let appliedConditionEffects: string[] = [];
  if (hit) {
    consumeTriggeredConditions(state, target, targetHitDamage.consumedConditionIds ?? []);
    appliedConditionEffects = applyOnHitFeatureConditions(state, attacker, target, action, attackerDefinition, { rollMode, critical });
  }
  if (action.riders?.length) {
    const riderOutcome = applyActionRiders(state, attacker, target, attackerDefinition, action.riders, {
      actionId: action.id, landed: hit, critical, saved: null, origin: attacker.position,
      fallbackDc: 8 + (attackerDefinition.proficiencyBonus ?? proficiencyFromDefinition(attackerDefinition)),
      concentrating: action.concentration
    });
    appliedConditionEffects = [...appliedConditionEffects, ...riderOutcome.appliedConditions];
  }

  // Post-hit reactions — Hellish Rebuke: `target` retaliates against `attacker`.
  if (hit) {
    runReactionWindow(state, {
      kind: "hit-by-attack", sourceId: attacker.id, targetId: target.id, attackType: action.attackType
    });
  }

  const coverNote = cover.level !== "none" ? ` (${target.displayName} had ${coverLabel(cover.level)})` : "";
  state.log.push(event(state, "AttackRolled", `${attacker.displayName} ${hit ? "hit" : "missed"} ${target.displayName} with ${action.name}${coverNote}`, {
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
    cover: cover.level,
    coverAcBonus: cover.acBonus,
    coverSources: cover.sources,
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
  actionId: Id,
  options: { slotLevel?: number } = {}
): SaveResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "save") {
    throw new Error(`Save action ${actionId} is not available to ${attacker.displayName}`);
  }
  const target = findCombatant(state.snapshot, action.targeting?.target === "self" ? attackerId : targetId);
  const targetDefinition = getDefinition(state.snapshot, target);
  if (action.targeting?.target !== "self") {
    validateTargeting(state.snapshot, attacker, target, action);
  }
  validateAndSpendAction(attacker, action);
  if (action.concentration) {
    breakConcentration(state, attackerId);
  }
  declareAction(state, attacker, action, { target });
  if (counterspellWindow(state, attacker, action)) {
    return { success: true, saveRoll: { expression: "countered", rolls: [], modifier: 0, total: 0 }, total: 0, dc: 0, damageApplied: 0 };
  }

  const scaling = damageScalingContext(attackerDefinition, action, options.slotLevel);
  const cover = action.saveAbility === "dex" ? coverAgainst(state.snapshot, attacker, target) : null;
  const coverSaveBonus = cover?.acBonus ?? 0;
  const saveBonus = (targetDefinition.saves?.[action.saveAbility]
    ?? abilityModifier(targetDefinition.abilities[action.saveAbility]))
    + conditionSaveModifier(target, action.saveAbility);
  const featureSaveBonus = featureSaveModifier(targetDefinition, target, action.saveAbility);
  const featureSaveAdvantage = featureSaveAdvantageModifier(targetDefinition, target, action.saveAbility);
  const saveRoll = rollD20WithBonus(state.rng, saveBonus + featureSaveBonus.total + coverSaveBonus, {
    advantage: featureSaveAdvantage.applied
  });
  const dc = resolveSaveDc(action, attackerDefinition);
  const success = saveRoll.total >= dc;
  const onSuccess = resolveOnSuccess(action);
  const dealsDamage = !(success && (onSuccess === "none" || onSuccess === "negates"));
  const damageApplied = dealsDamage
    ? applyDamageComponents(state, target, action.damage, attackerDefinition, false, {
      halve: success && onSuccess === "half",
      casterLevel: scaling.casterLevel,
      extraDiceOnFirst: scaling.upcastDamageDice
    })
    : 0;

  if (!(success && onSuccess === "negates")) {
    applyActionRiders(state, attacker, target, attackerDefinition, action.riders, {
      actionId, landed: true, saved: success, saveAbility: action.saveAbility, fallbackDc: dc,
      concentrating: action.concentration, origin: attacker.position
    });
  }

  state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${action.saveAbility.toUpperCase()} save against ${action.name}`, {
    attackerId,
    targetId: target.id,
    actionId,
    saveRoll,
    total: saveRoll.total,
    dc,
    featureSaveBonus: featureSaveBonus.total,
    cover: cover?.level ?? "none",
    coverSaveBonus,
    appliedSaveEffects: [...featureSaveBonus.sources, ...featureSaveAdvantage.sources],
    success,
    damageApplied
  }));

  return { success, saveRoll, total: saveRoll.total, dc, damageApplied };
}

export function resolveAreaSaveAction(
  state: EngineState,
  attackerId: Id,
  aim: Point,
  actionId: Id,
  options: { slotLevel?: number } = {}
): AreaSaveResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "area-save") {
    throw new Error(`Area save action ${actionId} is not available to ${attacker.displayName}`);
  }

  // Resolve where the template sits and which way it points.
  const placement = resolveAreaTargeting(attacker, attackerDefinition, action, aim);
  const { origin, aimVector } = placement;

  if (!placement.fromSelf) {
    validateOriginTargeting(state.snapshot, attacker, origin, action);
  }
  validateAndSpendAction(attacker, action);
  if (action.concentration) {
    breakConcentration(state, attackerId);
  }
  declareAction(state, attacker, action, { origin });
  if (counterspellWindow(state, attacker, action)) {
    state.log.push(event(state, "AreaSaveResolved", `${attacker.displayName}'s ${action.name} was countered`, {
      attackerId, actionId, origin, aim, targets: []
    }));
    return { targets: [] };
  }

  const scaling = damageScalingContext(attackerDefinition, action, options.slotLevel);
  const onSuccess = resolveOnSuccess(action);
  const dc = resolveSaveDc(action, attackerDefinition);
  const definitionsById = new Map(state.snapshot.definitions.map((definition) => [definition.id, definition]));
  const areaCoverFor = (target: CombatantState) => state.snapshot.rules.cover
    ? coverBetween(
      state.snapshot.map,
      origin,
      1,
      target.position,
      sizeFootprint(getDefinition(state.snapshot, target).size),
      { blockers: coverBlockersFor(state.snapshot, attacker.id, target.id) }
    )
    : null;
  const affected = combatantsInArea(state.snapshot.map, origin, action.area, state.snapshot.combatants, definitionsById, aimVector)
    .filter((target) => action.affects === "all" || target.faction !== attacker.faction)
    // Total cover from the blast origin shields a target entirely (when line of effect is enforced).
    .filter((target) => !(state.snapshot.rules.requireLineOfEffect && areaCoverFor(target)?.blocksTargeting));
  const targets = affected.map((target) => {
    const targetDefinition = getDefinition(state.snapshot, target);
    const cover = areaCoverFor(target);
    const coverSaveBonus = action.saveAbility === "dex" ? (cover?.dexSaveBonus ?? 0) : 0;
    const saveBonus = (targetDefinition.saves?.[action.saveAbility]
      ?? abilityModifier(targetDefinition.abilities[action.saveAbility]))
      + conditionSaveModifier(target, action.saveAbility);
    const featureSaveBonus = featureSaveModifier(targetDefinition, target, action.saveAbility);
    const featureSaveAdvantage = featureSaveAdvantageModifier(targetDefinition, target, action.saveAbility);
    const saveRoll = rollD20WithBonus(state.rng, saveBonus + featureSaveBonus.total + coverSaveBonus, {
      advantage: featureSaveAdvantage.applied
    });
    const success = saveRoll.total >= dc;
    const dealsDamage = !(success && (onSuccess === "none" || onSuccess === "negates"));
    const damageApplied = dealsDamage
      ? applyDamageComponents(state, target, action.damage, attackerDefinition, false, {
        halve: success && onSuccess === "half",
        casterLevel: scaling.casterLevel,
        extraDiceOnFirst: scaling.upcastDamageDice
      })
      : 0;

    if (!(success && onSuccess === "negates")) {
      applyActionRiders(state, attacker, target, attackerDefinition, action.riders, {
        actionId, landed: true, saved: success, saveAbility: action.saveAbility, fallbackDc: dc,
        concentrating: action.concentration, origin
      });
    }

    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${action.saveAbility.toUpperCase()} save against ${action.name}`, {
      attackerId,
      targetId: target.id,
      actionId,
      saveRoll,
      total: saveRoll.total,
      dc,
      featureSaveBonus: featureSaveBonus.total,
      cover: cover?.level ?? "none",
      coverSaveBonus,
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
    aim,
    targets
  }));
  return { targets };
}

function normalizeVector(vector: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(vector.x, vector.y);
  return length === 0 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

/**
 * Where an area action's template sits and which way it points, given the
 * caster's chosen `aim` point. Single source of truth shared by
 * `resolveAreaSaveAction` and the simulation's area scoring.
 * - `origin: "self"` centres the template on the caster's footprint.
 * - `aimedFromSelf` derives a unit `aimVector` from the caster toward `aim`.
 */
export function resolveAreaTargeting(
  attacker: CombatantState,
  attackerDefinition: CreatureDefinition,
  action: AreaSaveActionDefinition,
  aim: Point
): { origin: Point; aimVector?: { x: number; y: number }; fromSelf: boolean } {
  const footprint = sizeFootprint(attackerDefinition.size);
  const selfOrigin: Point = {
    x: Math.floor(attacker.position.x + (footprint - 1) / 2),
    y: Math.floor(attacker.position.y + (footprint - 1) / 2)
  };
  const fromSelf = action.targeting?.origin === "self";
  return {
    origin: fromSelf ? selfOrigin : aim,
    aimVector: action.targeting?.aimedFromSelf
      ? normalizeVector({ x: aim.x - selfOrigin.x, y: aim.y - selfOrigin.y })
      : undefined,
    fromSelf
  };
}

export function resolveHealingAction(
  state: EngineState,
  healerId: Id,
  targetId: Id,
  actionId: Id
): HealingResult {
  const healer = findCombatant(state.snapshot, healerId);
  const healerDefinition = getDefinition(state.snapshot, healer);
  const action = findActionDefinition(healerDefinition, actionId);
  if (!action || action.kind !== "healing") {
    throw new Error(`Healing action ${actionId} is not available to ${healer.displayName}`);
  }
  const target = findCombatant(state.snapshot, action.targeting?.target === "self" ? healerId : targetId);
  const targetDefinition = getDefinition(state.snapshot, target);
  if (action.targeting?.target !== "self") {
    validateHealingTargeting(state.snapshot, healer, target, action);
  }
  validateAndSpendAction(healer, action);
  declareAction(state, healer, action, { target });
  if (counterspellWindow(state, healer, action)) {
    return { healingApplied: 0 };
  }

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
    targetId: target.id,
    actionId,
    rolls,
    healingApplied,
    currentHp: target.currentHp
  }));

  applyActionRiders(state, healer, target, healerDefinition, action.riders, {
    actionId, landed: true, saved: null,
    fallbackDc: 8 + (healerDefinition.proficiencyBonus ?? proficiencyFromDefinition(healerDefinition)),
    origin: healer.position
  });

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

  // Action Surge & friends: an `extra-action` effect hands back a spent slot.
  for (const effect of feature?.effects ?? []) {
    if (effect.kind === "extra-action" && featureConditionsMetForSelf(actorDefinition, actor, effect)) {
      actor.actionEconomy ??= { action: true, bonus: true, reaction: true };
      actor.actionEconomy[effect.slot] = true;
      state.log.push(event(state, "ActionEconomyRefreshed", `${actor.displayName} regained a ${effect.slot} from ${feature?.name ?? action.name}`, {
        combatantId: actorId, actionId, featureId: feature?.id, slot: effect.slot
      }));
    }
  }

  const conditionId = applyFeatureActivationCondition(state, actor, action);
  return { conditionId };
}

export function resetActionEconomy(combatant: CombatantState): void {
  combatant.actionEconomy = { action: true, bonus: true, reaction: true };
  // Dash / Disengage are turn-scoped — clear them at the bearer's turn start.
  combatant.turnFlags = undefined;
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
  options: { halve?: boolean; casterLevel?: number; extraDiceOnFirst?: string } = {}
): number {
  return applyDamageEntries(
    state,
    target,
    damage.map((component, index) => ({
      component,
      critical,
      halve: options.halve,
      casterLevel: options.casterLevel,
      extraDice: index === 0 ? options.extraDiceOnFirst || undefined : undefined
    })),
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
    const scaledBase = resolveScaledDamage(component.dice, component.scaling, { casterLevel: entry.casterLevel });
    const withExtra = entry.extraDice ? `${scaledBase}+${entry.extraDice}` : scaledBase;
    const dice = entry.critical ? doubleDice(withExtra) : withExtra;
    const damageSource = entry.sourceDefinition ?? source;
    const abilityBonus = component.abilityModifier ? abilityModifier(damageSource.abilities[component.abilityModifier]) : 0;
    // `component.dice` is canonical and already carries any flat "+K" (mirrored by `flatBonus`), so it is not added again here.
    const formulaBonus = resolveNumericFormula(component.bonusFormula, damageSource);
    const roll = rollDice(withBonus(dice, abilityBonus), state.rng);
    const damageType = resolveDamageTypeReference(component.damageType, entry.triggerDamageType);
    const adjusted = adjustDamage(
      roll.total + formulaBonus,
      damageType,
      damageAdjustmentsFor(targetDefinition, target),
      component.magical === true
    );
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

function adjustDamage(
  amount: number,
  damageType: DamageType,
  adjustments: CreatureDefinition["damageAdjustments"],
  isMagical = false
): number {
  const applies = (adjustment: DamageAdjustment) =>
    adjustment.damageType === damageType && !(adjustment.nonMagicalOnly && isMagical);
  if (adjustments?.some((adjustment) => adjustment.type === "immunity" && applies(adjustment))) {
    return 0;
  }
  if (adjustments?.some((adjustment) => adjustment.type === "resistance" && applies(adjustment))) {
    return Math.floor(amount / 2);
  }
  if (adjustments?.some((adjustment) => adjustment.type === "vulnerability" && applies(adjustment))) {
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

/** Sum of `incomingAttackRoll` across a target's conditions — added to attack rolls made against it (stunned +, Dodge -). */
function conditionIncomingAttackModifier(target: CombatantState): number {
  return (target.conditions ?? []).reduce((sum, condition) => sum + (condition.modifiers?.incomingAttackRoll ?? 0), 0);
}

function conditionSaveModifier(combatant: CombatantState, ability: keyof CreatureDefinition["abilities"]): number {
  return (combatant.conditions ?? []).reduce((sum, condition) => sum + (condition.modifiers?.savingThrows?.[ability] ?? 0), 0);
}

/** Condition names that (5e) are or imply *incapacitated* — no action, bonus, or reaction. */
const INCAPACITATING_CONDITIONS: ReadonlySet<ConditionName> = new Set<ConditionName>([
  "incapacitated", "stunned", "paralyzed", "unconscious"
]);

const DENIAL_FLAG: Record<"action" | "bonus" | "reaction", "deniesActions" | "deniesBonusActions" | "deniesReactions"> = {
  action: "deniesActions",
  bonus: "deniesBonusActions",
  reaction: "deniesReactions"
};

/**
 * Can this combatant spend the given slot right now? One rule for the whole
 * engine: the combatant must be active, the slot un-spent, and no condition may
 * deny it — either by an explicit `modifiers.denies*` flag (Shocking Grasp) or by
 * carrying an incapacitating condition name (which denies all three).
 *
 * `"free"` (Action Surge's own activation, a Reckless-Attack toggle) spends no
 * slot, so only the state / incapacitation checks apply — an incapacitated
 * creature still can't Action-Surge.
 */
export function canAct(combatant: CombatantState, slot: "action" | "bonus" | "reaction" | "free"): boolean {
  if (combatant.state !== "active") {
    return false;
  }
  const economy = combatant.actionEconomy;
  if (slot !== "free" && economy && economy[slot] === false) {
    return false;
  }
  const denialFlag = slot === "free" ? "deniesActions" : DENIAL_FLAG[slot];
  for (const condition of combatant.conditions ?? []) {
    if (condition.modifiers?.[denialFlag]) {
      return false;
    }
    if (INCAPACITATING_CONDITIONS.has(condition.name)) {
      return false;
    }
  }
  return true;
}

function validateAndSpendAction(combatant: CombatantState, action: ActionDefinition): void {
  combatant.actionEconomy ??= { action: true, bonus: true, reaction: true };
  const slot = action.actionType;
  if (slot === "free") {
    if (!canAct(combatant, "free")) {
      throw new Error(`${combatant.displayName} cannot act right now`);
    }
  } else {
    if (combatant.actionEconomy[slot] === false) {
      throw new Error(`${combatant.displayName} has already used a ${slot}`);
    }
    if (!canAct(combatant, slot)) {
      throw new Error(`${combatant.displayName} cannot take a ${slot} right now`);
    }
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
  if (slot !== "free") {
    combatant.actionEconomy[slot] = false;
  }
}

type WeaponInput = NonNullable<CreatureDefinition["weapons"]>[number];

/**
 * v1 grip heuristic (a real main-/off-hand loadout model is a non-goal): a
 * `"versatile"` weapon is swung two-handed unless the creature also carries a
 * weapon it can use as a bonus action (a drawn off-hand weapon).
 */
function wieldsTwoHanded(definition: CreatureDefinition, weapon: WeaponInput): boolean {
  if (weapon.grip === "two-handed") {
    return true;
  }
  if (weapon.grip !== "versatile") {
    return false;
  }
  return !(definition.weapons ?? []).some(
    (sibling) => sibling.id !== weapon.id && (sibling.usableAs ?? []).includes("bonus")
  );
}

/**
 * Which economy slots a weapon compiles a distinct attack for. An absent
 * `usableAs` defaults to `["action", "reaction"]` for melee (every melee weapon
 * can make an opportunity attack) and `["action"]` for ranged. An explicit list
 * is honoured verbatim (order-normalised so `"action"`, if present, is first).
 */
function weaponUsableSlots(weapon: WeaponInput): Array<"action" | "bonus" | "reaction"> {
  if (!weapon.usableAs?.length) {
    return weapon.attackType === "melee" ? ["action", "reaction"] : ["action"];
  }
  const slots = [...new Set(weapon.usableAs)];
  return slots.includes("action") ? ["action", ...slots.filter((slot) => slot !== "action")] : slots;
}

function weaponToAction(definition: CreatureDefinition, weapon: WeaponInput): AttackActionDefinition {
  const magicBonus = weapon.magicBonus ?? 0;
  const toHitBonus = weapon.toHitBonus ?? 0;
  // "finesse" resolves to whichever of STR / DEX gives the better modifier.
  const ability = weapon.ability === "finesse"
    ? (abilityModifier(definition.abilities.dex) >= abilityModifier(definition.abilities.str) ? "dex" : "str")
    : weapon.ability;
  const isMagical = weapon.magical === true;
  const twoHanded = wieldsTwoHanded(definition, weapon);
  const damageSource = twoHanded && weapon.versatileDamage?.length ? weapon.versatileDamage : weapon.damage;
  return {
    kind: "attack",
    id: weapon.actionId ?? `weapon:${weapon.id}`,
    name: weapon.name,
    actionType: "action",
    attackType: weapon.attackType,
    ability,
    grip: twoHanded ? "two-handed" : "one-handed",
    attackBonusFormula: {
      // magicBonus adds to hit AND damage; toHitBonus adds to hit only.
      base: magicBonus + toHitBonus,
      ability,
      proficiency: weapon.proficient !== false
    },
    range: weapon.range,
    longRange: weapon.longRange,
    reach: weapon.reach,
    damage: damageSource.map((component) => ({
      ...component,
      magical: component.magical || isMagical || undefined,
      bonusFormula: magicBonus
        ? { ...(component.bonusFormula ?? {}), base: (component.bonusFormula?.base ?? 0) + magicBonus }
        : component.bonusFormula
    })),
    riders: weapon.onHit,
    resourceCost: weapon.resourceCost,
    automationSupport: weaponAutomationSupport(weapon)
  };
}

/** A -5 to hit / +10 damage "power" copy of a compiled weapon attack (Great Weapon Master / Sharpshooter). */
function powerAttackVariant(base: AttackActionDefinition): AttackActionDefinition {
  const damageType = base.damage[0]?.damageType ?? "bludgeoning";
  return {
    ...base,
    id: `${base.id}:power`,
    name: `${base.name} (Power Attack)`,
    attackBonusFormula: base.attackBonusFormula
      ? { ...base.attackBonusFormula, base: (base.attackBonusFormula.base ?? 0) - 5 }
      : { base: -5, ability: base.ability, proficiency: true },
    damage: [...base.damage, { dice: "10", damageType }]
  };
}

/**
 * Compile a weapon to one attack per usable economy slot (`weaponUsableSlots`),
 * plus a power-attack copy of each when `weapon.powerAttack` is set. The
 * `"action"` slot keeps the plain compiled id; `"bonus"` / `"reaction"` copies
 * get an `:<slot>` suffix. The `"reaction"` copy carries a `reaction` meta
 * (default: an opportunity attack); when a melee weapon opts *out* of reaction
 * via an explicit `usableAs`, its `"action"` copy is marked `opportunityAttack:
 * false` so the OA scan skips it.
 */
function weaponToActions(definition: CreatureDefinition, weapon: WeaponInput): AttackActionDefinition[] {
  const base = weaponToAction(definition, weapon);
  const slots = weaponUsableSlots(weapon);
  const barsOpportunityAttack = weapon.attackType === "melee" && !slots.includes("reaction");
  const out: AttackActionDefinition[] = [];
  for (const slot of slots) {
    let forSlot: AttackActionDefinition;
    if (slot === "action") {
      forSlot = barsOpportunityAttack ? { ...base, opportunityAttack: false } : base;
    } else if (slot === "reaction") {
      forSlot = {
        ...base,
        id: `${base.id}:reaction`,
        actionType: "reaction",
        reaction: {
          trigger: weapon.reactionTrigger ?? { kind: "enemy-leaves-reach" },
          target: "trigger-source",
          priority: "always"
        }
      };
    } else {
      forSlot = { ...base, id: `${base.id}:${slot}`, actionType: slot };
    }
    out.push(forSlot);
    if (weapon.powerAttack) {
      out.push(powerAttackVariant(forSlot));
    }
  }
  return out;
}

/** A weapon compiles to full automation unless an on-hit rider needs a human (a note or a custom condition). */
function weaponAutomationSupport(weapon: NonNullable<CreatureDefinition["weapons"]>[number]): "full" | "partial" {
  const manual = (weapon.onHit ?? []).some((rider) =>
    rider.kind === "note" || (rider.kind === "condition" && typeof rider.condition !== "string"));
  return manual ? "partial" : "full";
}

/** Fold a spell's level / upcast / concentration onto its compiled action so resolvers never need the spell. */
function stampSpellContext(
  action: ActionDefinition,
  spell: NonNullable<CreatureDefinition["spells"]>[number]
): ActionDefinition {
  if (action.kind !== "attack" && action.kind !== "save" && action.kind !== "area-save" && action.kind !== "healing") {
    return action;
  }
  const stamped = {
    ...action,
    spellLevel: action.spellLevel ?? spell.level,
    upcast: action.upcast ?? spell.upcast
  };
  if (action.kind !== "healing" && spell.concentration && !action.concentration) {
    return { ...stamped, concentration: true } as ActionDefinition;
  }
  return stamped;
}

function casterLevelOf(definition: CreatureDefinition): number {
  return definition.character?.level ?? 1;
}

/** Parse `slot-3` → 3. Anything else → undefined. */
function spellSlotLevel(resourceId: string | undefined): number | undefined {
  const match = resourceId ? /^slot-(\d+)$/.exec(resourceId) : null;
  return match ? Number.parseInt(match[1] as string, 10) : undefined;
}

interface DamageScalingContext {
  casterLevel: number;
  /** Extra dice appended to the first damage component (per-slot upcast bonus). "" when none. */
  upcastDamageDice: string;
}

function damageScalingContext(
  definition: CreatureDefinition,
  action: AttackActionDefinition | SaveActionDefinition | AreaSaveActionDefinition,
  slotLevel: number | undefined
): DamageScalingContext {
  const slotsAboveBase = slotLevel != null && action.spellLevel != null
    ? Math.max(0, slotLevel - action.spellLevel)
    : 0;
  const perSlotDice = action.upcast?.perSlotAboveBase?.damageDice;
  return {
    casterLevel: casterLevelOf(definition),
    upcastDamageDice: slotsAboveBase > 0 && perSlotDice ? repeatDice(perSlotDice, slotsAboveBase) : ""
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

/* ─── Action riders (weapon `onHit` / save & area `riders`) ─────────────────────
 * Consumed by every offensive resolver. Gates on the outcome, spends any per-rider
 * charge, then applies damage / healing / a condition / a shove.
 */

interface RiderContext {
  actionId: Id;
  /** Attack landed, or (for save / area actions) `true` — the action resolved. */
  landed: boolean;
  critical?: boolean;
  /** Save result for save / area actions; `null` for attacks. */
  saved: boolean | null;
  /** The action's save ability, so a rider without its own `save` can still repeat one. */
  saveAbility?: Ability;
  /** Baseline DC for a rider whose `save` omits `dc` / `dcFormula`. */
  fallbackDc: number;
  /** The action sets the caster's concentration — condition riders link to it. */
  concentrating?: boolean;
  /** Origin for push direction (usually the source's position or an area origin). */
  origin?: Point;
}

interface RiderOutcome {
  appliedConditions: string[];
  extraDamage: number;
  healing: number;
  sources: string[];
}

function riderGatePasses(gate: RiderGate, ctx: RiderContext): boolean {
  switch (gate) {
    case "always": return true;
    case "on-hit": return ctx.landed;
    case "on-miss": return !ctx.landed;
    case "on-crit": return ctx.landed && ctx.critical === true;
    case "on-save-fail": return ctx.saved === false;
    case "on-save-success": return ctx.saved === true;
    default: return false;
  }
}

function riderUseKey(actionId: Id, rider: ActionRider, index: number): string {
  const explicit = "id" in rider && typeof rider.id === "string" ? rider.id : String(index);
  return `${actionId}:${explicit}`;
}

function wasRiderUsedThisTurn(state: EngineState, sourceId: Id, key: string): boolean {
  return state.log.some((entry) => entry.type === "RiderApplied"
    && entry.round === state.snapshot.round
    && entry.turnIndex === state.snapshot.turnIndex
    && entry.data?.sourceId === sourceId
    && entry.data.riderUseKey === key);
}

function riderDurationToExpiry(state: EngineState, duration: RiderDuration, bearerTurnIndex?: number): {
  expiresAt?: ConditionInstance["expiresAt"];
  repeatTiming?: "turn-start" | "turn-end";
  concentration?: boolean;
} {
  switch (duration.kind) {
    case "permanent":
      return {};
    case "concentration":
      return { concentration: true };
    case "until-start-of-next-turn": {
      // Clears when initiative next reaches the bearer. If the bearer still acts
      // later this round it's this round; otherwise the next.
      const bearerIdx = bearerTurnIndex ?? state.snapshot.turnIndex;
      const laterThisRound = bearerIdx > state.snapshot.turnIndex;
      return {
        expiresAt: {
          round: state.snapshot.round + (laterThisRound ? 0 : 1),
          turnIndex: bearerIdx,
          timing: "start"
        }
      };
    }
    case "save-ends":
      // A far cap so it still lapses if the repeat save is somehow never rolled.
      return {
        expiresAt: { round: state.snapshot.round + 100, turnIndex: state.snapshot.turnIndex, timing: "end" },
        repeatTiming: duration.saveAt
      };
    case "rounds":
      return {
        expiresAt: {
          round: state.snapshot.round + Math.max(0, duration.rounds),
          turnIndex: state.snapshot.turnIndex,
          timing: "end"
        },
        repeatTiming: duration.repeatSaveAt
      };
    default:
      return {};
  }
}

function resolveRiderSaveDc(
  save: NonNullable<Extract<ActionRider, { kind: "condition" }>["save"]>,
  sourceDefinition: CreatureDefinition,
  fallbackDc: number
): number {
  if (save.dc != null) {
    return save.dc;
  }
  if (save.dcFormula) {
    return resolveNumericFormula(save.dcFormula, sourceDefinition);
  }
  return fallbackDc;
}

/** Crude, engine-consistent mechanical effect of a bare condition name (mirrors the store's `applyConditionToCombatant`). */
function defaultConditionModifiers(name: ConditionName): ConditionInstance["modifiers"] | undefined {
  switch (name) {
    case "poisoned":
    case "frightened":
    case "prone":
      return { attackRoll: -2 };
    case "blinded":
      return { attackRoll: -5 };
    case "restrained":
      return { attackRoll: -2, movementMultiplier: 999 };
    case "grappled":
      return { movementMultiplier: 999 };
    case "incapacitated":
      // No actions of any kind. (RAW leaves movement / AC alone; `canAct` + the
      // AI "loses its turn" pass handle the turn, so no crude `attackRoll: -20`.)
      return { deniesActions: true, deniesBonusActions: true, deniesReactions: true };
    case "stunned":
    case "paralyzed":
    case "unconscious":
      // Incapacitated + can't move + attackers effectively have advantage.
      return {
        deniesActions: true, deniesBonusActions: true, deniesReactions: true,
        movementMultiplier: 999, incomingAttackRoll: 5
      };
    default:
      return undefined;
  }
}

function clampToGrid(value: number, max: number): number {
  return Math.min(Math.max(0, Math.round(value)), Math.max(0, max));
}

/** Straight-line forced movement away from `origin`, stopping at a sight/effect-blocking wall. */
function pushCombatant(state: EngineState, target: CombatantState, distanceFt: number, origin: Point): void {
  const grid = state.snapshot.map.grid;
  const cells = Math.round(distanceFt / grid.distancePerSquare);
  if (cells <= 0) {
    return;
  }
  const dx = target.position.x - origin.x;
  const dy = target.position.y - origin.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const footprint = sizeFootprint(getDefinition(state.snapshot, target).size);
  let position = { ...target.position };
  for (let step = 0; step < cells; step += 1) {
    const next = {
      x: clampToGrid(position.x + ux, grid.width - footprint),
      y: clampToGrid(position.y + uy, grid.height - footprint)
    };
    if (next.x === position.x && next.y === position.y) {
      break;
    }
    if (!lineOfEffect(state.snapshot.map, position, next)) {
      break;
    }
    position = next;
  }
  if (position.x !== target.position.x || position.y !== target.position.y) {
    const from = target.position;
    target.position = position;
    state.log.push(event(state, "CombatantMoved", `${target.displayName} was pushed`, {
      combatantId: target.id, from, to: position, forced: true
    }));
  }
}

function applyRiderHealing(
  state: EngineState,
  recipient: CombatantState,
  sourceDefinition: CreatureDefinition,
  components: HealingComponent[]
): number {
  const recipientDefinition = getDefinition(state.snapshot, recipient);
  let total = 0;
  for (const component of components) {
    const bonus = component.abilityModifier ? abilityModifier(sourceDefinition.abilities[component.abilityModifier]) : 0;
    total += rollDice(withBonus(component.dice, bonus), state.rng).total;
  }
  recipient.currentHp = Math.min(recipientDefinition.maxHp, recipient.currentHp + total);
  if (recipient.currentHp > 0 && (recipient.state === "downed" || recipient.state === "defeated")) {
    recipient.state = "active";
    recipient.deathSaves = { successes: 0, failures: 0, stable: false };
    recipient.conditions = (recipient.conditions ?? []).filter((condition) => condition.name !== "unconscious");
  }
  state.log.push(event(state, "HealingApplied", `${recipient.displayName} regained ${total} HP`, {
    targetId: recipient.id, healingApplied: total, currentHp: recipient.currentHp, viaRider: true
  }));
  return total;
}

function applyConditionRider(
  state: EngineState,
  source: CombatantState,
  target: CombatantState,
  sourceDefinition: CreatureDefinition,
  targetDefinition: CreatureDefinition,
  rider: Extract<ActionRider, { kind: "condition" }>,
  ctx: RiderContext
): string | null {
  // The rider rolls its own initial save only when the parent action had none
  // (an attack context). In a save / area context the action's save already
  // gated the rider via its `when`, so the condition just lands.
  if (rider.save && ctx.saved === null) {
    const dc = resolveRiderSaveDc(rider.save, sourceDefinition, ctx.fallbackDc);
    const saveBonus = (targetDefinition.saves?.[rider.save.ability]
      ?? abilityModifier(targetDefinition.abilities[rider.save.ability]))
      + conditionSaveModifier(target, rider.save.ability);
    const roll = rollD20WithBonus(state.rng, saveBonus);
    const success = roll.total >= dc;
    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${rider.save.ability.toUpperCase()} save against ${ctx.actionId}`, {
      attackerId: source.id, targetId: target.id, actionId: ctx.actionId,
      saveRoll: roll, total: roll.total, dc, success, viaRider: true
    }));
    if (success && rider.save.onSuccess === "negates") {
      return null;
    }
  }

  const conditionName: ConditionName = typeof rider.condition === "string" ? rider.condition : "custom";
  const conditionId = `${target.id}:${ctx.actionId}:${rider.id ?? "cond"}`;
  const bearerTurnIndex = state.snapshot.combatants.findIndex((c) => c.id === target.id);
  const expiry = riderDurationToExpiry(state, rider.duration, bearerTurnIndex >= 0 ? bearerTurnIndex : undefined);
  const repeatAbility = rider.save?.ability ?? ctx.saveAbility;
  const repeatDc = rider.save ? resolveRiderSaveDc(rider.save, sourceDefinition, ctx.fallbackDc) : ctx.fallbackDc;

  const instance: ConditionInstance = {
    id: conditionId,
    name: conditionName,
    sourceId: ctx.actionId,
    sourceCombatantId: source.id,
    startedRound: state.snapshot.round,
    expiresAt: expiry.expiresAt,
    modifiers: rider.modifiers ?? defaultConditionModifiers(conditionName),
    effects: rider.effects,
    repeatSave: expiry.repeatTiming && repeatAbility
      ? { ability: repeatAbility, dc: repeatDc, timing: expiry.repeatTiming }
      : undefined,
    concentration: expiry.concentration || ctx.concentrating || undefined
  };
  applyCondition(state, target.id, instance);

  if (instance.concentration) {
    source.concentration = { sourceConditionId: source.concentration?.sourceConditionId ?? conditionId };
  }
  return conditionName;
}

function applyActionRiders(
  state: EngineState,
  source: CombatantState,
  target: CombatantState,
  sourceDefinition: CreatureDefinition,
  riders: ActionRider[] | undefined,
  ctx: RiderContext
): RiderOutcome {
  const outcome: RiderOutcome = { appliedConditions: [], extraDamage: 0, healing: 0, sources: [] };
  if (!riders?.length) {
    return outcome;
  }
  const targetDefinition = getDefinition(state.snapshot, target);

  riders.forEach((rider, index) => {
    if (rider.kind === "note" || !riderGatePasses(rider.when, ctx)) {
      return;
    }
    const useKey = riderUseKey(ctx.actionId, rider, index);
    if (rider.oncePerTurn && wasRiderUsedThisTurn(state, source.id, useKey)) {
      return;
    }
    if (rider.resourceCost) {
      const held = source.resources?.[rider.resourceCost.resourceId] ?? 0;
      if (held < rider.resourceCost.amount) {
        state.log.push(event(state, "AutomationWarning",
          `${source.displayName} has no ${rider.resourceCost.resourceId} left for ${rider.kind} on ${ctx.actionId}`,
          { sourceId: source.id, actionId: ctx.actionId, riderUseKey: useKey }));
        return;
      }
      source.resources = { ...(source.resources ?? {}), [rider.resourceCost.resourceId]: held - rider.resourceCost.amount };
    }

    if (rider.kind === "damage") {
      outcome.extraDamage += applyDamageComponents(state, target, rider.components, sourceDefinition, ctx.critical === true, {
        casterLevel: casterLevelOf(sourceDefinition)
      });
    } else if (rider.kind === "healing") {
      const recipient = rider.target === "self" ? source : target;
      outcome.healing += applyRiderHealing(state, recipient, sourceDefinition, rider.components);
    } else if (rider.kind === "push") {
      pushCombatant(state, target, rider.distance, ctx.origin ?? source.position);
    } else if (rider.kind === "condition") {
      const applied = applyConditionRider(state, source, target, sourceDefinition, targetDefinition, rider, ctx);
      if (applied) {
        outcome.appliedConditions.push(applied);
      }
    }

    state.log.push(event(state, "RiderApplied", `${source.displayName}: ${rider.kind} rider from ${ctx.actionId}`, {
      sourceId: source.id, targetId: target.id, actionId: ctx.actionId, riderKind: rider.kind, riderUseKey: useKey
    }));
    outcome.sources.push(`${rider.kind} rider`);
  });

  return outcome;
}

/**
 * End `casterId`'s concentration: clear the flag and drop every condition it
 * sustained — both the ones flagged `concentration` with a matching
 * `sourceCombatantId` (multi-target spells) and the legacy single
 * `concentration.sourceConditionId` link. Emits a `ConditionExpired` per drop; a
 * `ConcentrationChecked` (with the roll) is the caller's job.
 */
function breakConcentration(state: EngineState, casterId: Id): void {
  const caster = state.snapshot.combatants.find((combatant) => combatant.id === casterId);
  if (!caster?.concentration) {
    return;
  }
  const linkedId = caster.concentration.sourceConditionId;
  caster.concentration = undefined;
  for (const combatant of state.snapshot.combatants) {
    const before = combatant.conditions ?? [];
    const after = before.filter((condition) =>
      !((condition.concentration && condition.sourceCombatantId === casterId) || (linkedId && condition.id === linkedId)));
    if (after.length !== before.length) {
      for (const removed of before.filter((condition) => !after.includes(condition))) {
        state.log.push(event(state, "ConditionExpired", `${combatant.displayName} lost ${removed.name}`, {
          combatantId: combatant.id, condition: removed, concentrationEnded: true
        }));
      }
      combatant.conditions = after;
    }
  }
}

/**
 * The bearer re-rolls each `repeatSave`-tagged condition at the given timing on
 * its own turn; a success ends that condition. Call alongside
 * `applyTimedFeatureEffects` in the turn loop.
 */
export function runRepeatedSaves(state: EngineState, combatantId: Id, timing: "turn-start" | "turn-end"): void {
  const combatant = state.snapshot.combatants.find((candidate) => candidate.id === combatantId);
  if (!combatant?.conditions?.length) {
    return;
  }
  const definition = getDefinition(state.snapshot, combatant);
  const surviving: ConditionInstance[] = [];
  for (const condition of combatant.conditions) {
    const repeat = condition.repeatSave;
    if (!repeat || repeat.timing !== timing) {
      surviving.push(condition);
      continue;
    }
    const saveBonus = (definition.saves?.[repeat.ability] ?? abilityModifier(definition.abilities[repeat.ability]))
      + conditionSaveModifier(combatant, repeat.ability);
    const roll = rollD20WithBonus(state.rng, saveBonus);
    const success = roll.total >= repeat.dc;
    state.log.push(event(state, "SaveRolled", `${combatant.displayName} repeated a ${repeat.ability.toUpperCase()} save vs ${condition.name}`, {
      targetId: combatantId, conditionId: condition.id, saveRoll: roll, total: roll.total, dc: repeat.dc, success, repeatSave: true
    }));
    if (success) {
      state.log.push(event(state, "ConditionExpired", `${combatant.displayName} shook off ${condition.name}`, {
        combatantId, condition, viaSave: true
      }));
    } else {
      surviving.push(condition);
    }
  }
  combatant.conditions = surviving;
}

function resolveOnSuccess(action: SaveActionDefinition | AreaSaveActionDefinition): "half" | "none" | "negates" {
  return action.onSuccess ?? (action.halfDamageOnSuccess ? "half" : "none");
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
    breakConcentration(state, combatant.id);
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
  runReactionWindow(state, { kind: "enemy-leaves-reach", sourceId: mover.id, from, to });
}

/** True when the mover currently ignores opportunity attacks — Disengaged this turn, or a `avoids-opportunity-attacks` feature effect. */
function moverAvoidsOpportunityAttacks(snapshot: EncounterSnapshot, mover: CombatantState): boolean {
  if (mover.turnFlags?.disengaged) {
    return true;
  }
  const definition = getDefinition(snapshot, mover);
  return featureSources(definition, mover).some((source) =>
    (source.effects ?? []).some((effect) =>
      effect.kind === "avoids-opportunity-attacks"
      && featureConditionsMetForSelf(definition, mover, effect)));
}

/**
 * The melee attack `reactor` would use to punish `mover` for leaving its reach on
 * the step `from → to`, or `undefined`. Accepts a compiled `"reaction"` copy
 * (authored / weapon-derived, trigger `enemy-leaves-reach`) or any plain
 * `"action"`-typed melee attack (the universal "any melee weapon threatens an
 * OA" rule) unless it is explicitly barred (`opportunityAttack === false`).
 */
function findLeaveReachReaction(
  snapshot: EncounterSnapshot,
  reactor: CombatantState,
  mover: CombatantState,
  from: Point,
  to: Point
): AttackActionDefinition | undefined {
  if (reactor.faction === mover.faction || !canAct(reactor, "reaction")) {
    return undefined;
  }
  const definition = getDefinition(snapshot, reactor);
  const eligible = (action: ActionDefinition): action is AttackActionDefinition => {
    if (action.kind !== "attack" || action.attackType !== "melee" || action.automationSupport !== "full") {
      return false;
    }
    if (action.actionType === "reaction") {
      if (action.reaction && action.reaction.trigger.kind !== "enemy-leaves-reach") {
        return false;
      }
    } else if (action.actionType !== "action" || action.opportunityAttack === false) {
      return false;
    }
    if (!canSpendResource(reactor, action)) {
      return false;
    }
    const reach = action.reach ?? action.range;
    const wasInReach = gridDistance(reactor.position, from, snapshot.map.grid) <= reach;
    const leavesReach = gridDistance(reactor.position, to, snapshot.map.grid) > reach;
    return wasInReach && leavesReach
      && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, reactor.position, from));
  };
  const actions = getExecutableActions(definition).filter(eligible);
  // Prefer an authored reaction copy over the synthesised "any melee attack" one.
  return actions.find((action) => action.actionType === "reaction") ?? actions[0];
}

/* ─── Reaction windows ─────────────────────────────────────────────────────────
 * One dispatcher, `runReactionWindow`, is opened at each point a reaction may
 * trigger. It finds every eligible reactor, fires the best reaction (spending
 * that reactor's reaction via the normal resolver), and returns whatever the
 * caller needs to know (`countered`, `imposedDisadvantage`).
 */

export interface ReactionEvent {
  kind: ReactionTrigger["kind"];
  /** The attacker / caster / mover whose action opened the window. */
  sourceId: Id;
  /** The attack's target (for `targeted-by-attack` / `hit-by-attack` / `ally-targeted-by-attack`). */
  targetId?: Id;
  /** Point the range check is measured from (`enemy-casts-spell`). */
  origin?: Point;
  /** Level of the spell being cast (`enemy-casts-spell`). */
  spellLevel?: number;
  /** The triggering attack's type — for `meleeOnly` triggers. */
  attackType?: AttackActionDefinition["attackType"];
  /** Movement step, for `enemy-leaves-reach`. */
  from?: Point;
  to?: Point;
}

export interface ReactionWindowResult {
  /** A Counterspell landed — the calling spell resolver must abort with an empty result. */
  countered?: boolean;
  /** A Protection-style reaction forces the triggering attack roll to disadvantage. */
  imposedDisadvantage?: boolean;
}

/** The reaction `reactor` will spend on `event`, plus the resolved reaction target, or `undefined`. */
interface EligibleReaction {
  reactor: CombatantState;
  action: Extract<ActionDefinition, { reaction?: ReactionMeta }>;
  meta: ReactionMeta;
  targetId: Id;
}

function reactionMetaFor(action: ActionDefinition): ReactionMeta | undefined {
  if ("reaction" in action && action.reaction) {
    return action.reaction;
  }
  // A bare reaction-typed melee attack is treated as an opportunity attack.
  if (action.kind === "attack" && action.actionType === "reaction" && action.attackType === "melee") {
    return { trigger: { kind: "enemy-leaves-reach" }, target: "trigger-source", priority: "always" };
  }
  return undefined;
}

function reactionTriggerPasses(
  state: EngineState,
  reactor: CombatantState,
  trigger: ReactionTrigger,
  event: ReactionEvent,
  action: ActionDefinition
): boolean {
  if (trigger.kind !== event.kind) {
    return false;
  }
  switch (trigger.kind) {
    case "enemy-leaves-reach":
      // Handled by `findLeaveReachReaction` — this window builds its list there.
      return true;
    case "targeted-by-attack":
    case "hit-by-attack":
      return reactor.id === event.targetId
        && (!trigger.meleeOnly || event.attackType === "melee");
    case "ally-targeted-by-attack": {
      if (!event.targetId || reactor.id === event.targetId) {
        return false;
      }
      const ally = state.snapshot.combatants.find((c) => c.id === event.targetId);
      if (!ally || ally.faction !== reactor.faction) {
        return false;
      }
      // `gridDistance` already returns feet.
      return gridDistance(reactor.position, ally.position, state.snapshot.map.grid) <= trigger.withinFt;
    }
    case "enemy-casts-spell": {
      const caster = state.snapshot.combatants.find((c) => c.id === event.sourceId);
      if (!caster || caster.faction === reactor.faction || event.spellLevel == null || event.origin === undefined) {
        return false;
      }
      if (trigger.maxSpellLevel != null && event.spellLevel > trigger.maxSpellLevel) {
        return false;
      }
      const withinRange = gridDistance(reactor.position, event.origin, state.snapshot.map.grid) <= trigger.withinFt;
      // v1 Counterspell: auto-succeeds only if the counter slot's level ≥ the spell's.
      const counterSlot = "resourceCost" in action ? spellSlotLevel(action.resourceCost?.resourceId) : undefined;
      return withinRange && counterSlot != null && counterSlot >= event.spellLevel;
    }
    case "manual":
      return false;
  }
}

/** Crude value gate for `priority: "worthwhile"` — Phase 4 replaces this with the full EV bar. */
function reactionClearsValueBar(state: EngineState, reaction: EligibleReaction, event: ReactionEvent): boolean {
  const { action, meta } = reaction;
  if (meta.trigger.kind === "enemy-casts-spell") {
    return (event.spellLevel ?? 0) >= 2;
  }
  if (meta.trigger.kind === "ally-targeted-by-attack") {
    const ally = state.snapshot.combatants.find((c) => c.id === event.targetId);
    const allyDefinition = ally ? getDefinition(state.snapshot, ally) : undefined;
    return !!ally && !!allyDefinition && ally.currentHp * 2 <= allyDefinition.maxHp;
  }
  // Any reaction that deals damage clears the bar.
  return (action.kind === "attack" || action.kind === "save" || action.kind === "area-save")
    && (action.damage?.length ?? 0) > 0;
}

function eligibleReactionFor(
  state: EngineState,
  reactor: CombatantState,
  event: ReactionEvent
): EligibleReaction | undefined {
  if (!canAct(reactor, "reaction")) {
    return undefined;
  }
  const definition = getDefinition(state.snapshot, reactor);
  for (const action of getExecutableActions(definition)) {
    if (action.actionType !== "reaction" || action.automationSupport !== "full" || !canSpendResource(reactor, action)) {
      continue;
    }
    const meta = reactionMetaFor(action);
    if (!meta || meta.priority === "manual") {
      continue;
    }
    if (!reactionTriggerPasses(state, reactor, meta.trigger, event, action)) {
      continue;
    }
    const targetId = meta.target === "self"
      ? reactor.id
      : meta.target === "trigger-target"
        ? event.targetId ?? event.sourceId
        : event.sourceId;
    const reaction: EligibleReaction = { reactor, action: action as EligibleReaction["action"], meta, targetId };
    if (meta.priority === "worthwhile" && !reactionClearsValueBar(state, reaction, event)) {
      continue;
    }
    return reaction;
  }
  return undefined;
}

/**
 * Open a reaction window. Finds every eligible reactor (initiative order), fires
 * one reaction each, and reports back. Nesting past `MAX_REACTION_DEPTH` is a
 * no-op (a counter-counterspell is legal; a third is not).
 */
export function runReactionWindow(state: EngineState, ev: ReactionEvent): ReactionWindowResult {
  const depth = state.reactionDepth ?? 0;
  if (depth >= MAX_REACTION_DEPTH) {
    return {};
  }
  state.reactionDepth = depth + 1;
  const result: ReactionWindowResult = {};
  try {
    const source = state.snapshot.combatants.find((c) => c.id === ev.sourceId);
    if (!source) {
      return result;
    }

    // The leave-reach window has its own reach-aware finder (covers both authored
    // reaction copies and the universal "any melee weapon" opportunity attack).
    if (ev.kind === "enemy-leaves-reach") {
      if (!ev.from || !ev.to || source.state !== "active") {
        return result;
      }
      for (const reactor of orderedByInitiative(state.snapshot.combatants)) {
        if (source.state !== "active") {
          break;
        }
        const action = findLeaveReachReaction(state.snapshot, reactor, source, ev.from, ev.to);
        if (!action) {
          continue;
        }
        const reactorDefinition = getDefinition(state.snapshot, reactor);
        const reactionAction: AttackActionDefinition = action.actionType === "reaction"
          ? action
          : { ...action, actionType: "reaction" };
        logReactionTriggered(state, reactor, action.id, "enemy-leaves-reach", ev);
        state.log.push(event(state, "OpportunityAttackTriggered", `${reactor.displayName} makes an opportunity attack against ${source.displayName}`, {
          reactorId: reactor.id, moverId: source.id, actionId: action.id, from: ev.from, to: ev.to
        }));
        resolveAttackCore(state, reactor, source, reactorDefinition, reactionAction, {}, true);
      }
      return result;
    }

    for (const reactor of orderedByInitiative(state.snapshot.combatants)) {
      const reaction = eligibleReactionFor(state, reactor, ev);
      if (!reaction) {
        continue;
      }
      logReactionTriggered(state, reactor, reaction.action.id, ev.kind, ev);
      const outcome = fireReaction(state, reaction, ev);
      if (outcome.countered) {
        result.countered = true;
      }
      if (outcome.imposedDisadvantage) {
        result.imposedDisadvantage = true;
      }
      if (ev.kind === "enemy-casts-spell" && result.countered) {
        break;
      }
    }
    return result;
  } finally {
    state.reactionDepth = depth;
  }
}

function orderedByInitiative(combatants: CombatantState[]): CombatantState[] {
  return [...combatants].sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0) || a.id.localeCompare(b.id));
}

function logReactionTriggered(state: EngineState, reactor: CombatantState, actionId: Id, kind: ReactionTrigger["kind"], ev: ReactionEvent): void {
  state.log.push(event(state, "ReactionTriggered", `${reactor.displayName} reacts (${kind})`, {
    reactorId: reactor.id, actionId, trigger: kind, sourceId: ev.sourceId, targetId: ev.targetId
  }));
}

/** Resolve one eligible reaction through its normal resolver. A resolver throw is contained. */
function fireReaction(state: EngineState, reaction: EligibleReaction, ev: ReactionEvent): ReactionWindowResult {
  const { reactor, action, meta, targetId } = reaction;
  const reactorDefinition = getDefinition(state.snapshot, reactor);
  try {
    if (meta.trigger.kind === "ally-targeted-by-attack") {
      // Protection: spend the reaction, impose disadvantage on the triggering roll.
      validateAndSpendAction(reactor, action);
      return { imposedDisadvantage: true };
    }
    if (meta.trigger.kind === "enemy-casts-spell") {
      // Counterspell: spend the reaction (+ its slot) and report the counter.
      resolveActivateFeatureAction(state, reactor.id, action.id);
      return { countered: true };
    }
    switch (action.kind) {
      case "attack":
        resolveAttackCore(state, reactor, findCombatant(state.snapshot, targetId), reactorDefinition,
          action.actionType === "reaction" ? action : { ...action, actionType: "reaction" }, {}, true);
        return {};
      case "save":
        resolveSaveAction(state, reactor.id, targetId, action.id);
        return {};
      case "area-save":
        resolveAreaSaveAction(state, reactor.id, findCombatant(state.snapshot, targetId).position, action.id);
        return {};
      case "activate-feature":
        resolveActivateFeatureAction(state, reactor.id, action.id);
        return {};
      default:
        return {};
    }
  } catch (error) {
    state.log.push(event(state, "AutomationWarning", `${reactor.displayName}'s reaction (${meta.trigger.kind}) could not resolve`, {
      reactorId: reactor.id, actionId: action.id, sourceId: ev.sourceId, error: error instanceof Error ? error.message : String(error)
    }));
    return {};
  }
}

/**
 * Counterspell window for a spell resolver. Call right after the caster's action
 * + slot are spent and the action is declared; a `true` return means the spell
 * was countered and the resolver must return an empty result.
 */
function counterspellWindow(state: EngineState, caster: CombatantState, action: ActionDefinition): boolean {
  if (!("spellLevel" in action) || action.spellLevel == null) {
    return false;
  }
  const { countered } = runReactionWindow(state, {
    kind: "enemy-casts-spell",
    sourceId: caster.id,
    origin: caster.position,
    spellLevel: action.spellLevel
  });
  if (countered) {
    state.log.push(event(state, "SpellCountered", `${caster.displayName}'s ${action.name} was countered`, {
      casterId: caster.id, actionId: action.id, spellLevel: action.spellLevel
    }));
  }
  return countered === true;
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
