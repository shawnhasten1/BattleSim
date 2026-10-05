import { cellIntersectsArea, combatantsInArea, HAZARD_PATHING_MULTIPLIER, hazardPathingOverlay, zoneTerrainOverlay, type AimVector } from "./areas";
import { activeMastery, isLightWeapon, masteryRiders } from "./mastery";
import { rollDice, abilityModifier, parseDiceExpression, repeatDice, resolveScaledDamage, type DiceRollResult } from "./dice";
import { coverBetween, distanceWithHeight, footprintCells, footprintGroundHeight, groundHeightAt, gridDistance, movementOptionsFor, movementProfileOf, movementReference, isFootprintLegal, lineOfEffect, findPath, findReachableCells, pathCostAlong, sizeFootprint, stepCost, stepDistance, terrainAtCell, type CoverBlocker, type CoverResult, type OccupancyMovementOptions, type PathResult } from "./geometry";
import { attackFamilyId, canPayFor, defaultSwingAttack, multiattackVariants, stepAbility, swingCandidates, swingsOf, type MultiattackSwing } from "./multiattack";
import { armoredAc, type ArmoredAc, type UnarmoredFormula } from "./armor";
import { compileItemUses, withArticle, workingItems } from "./items";
import { SeededRandom, type RandomSource } from "./rng";
import { MAX_STEP_HEIGHT_FT, type TraitEmanation } from "./types";
import type {
  Ability,
  ActionDefinition,
  ActionUsage,
  SizeCategory,
  ActionRider,
  ActivateFeatureActionDefinition,
  ActiveZone,
  AreaSaveActionDefinition,
  AreaTargeting,
  AreaTemplate,
  AttackActionDefinition,
  BattleMapState,
  BuffActionDefinition,
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
  DeathEffectDefinition,
  EncounterSnapshot,
  Faction,
  FeatureCondition,
  FeatureEffect,
  FeatureEffectConditionApplication,
  FeatureEffectSaveGate,
  HealingActionDefinition,
  HealingComponent,
  Id,
  ItemUseMeta,
  MultiattackActionDefinition,
  NumericFormula,
  Point,
  ReactionMeta,
  ReactionTrigger,
  CounterCheck,
  RepositionActionDefinition,
  ResourceCost,
  RiderDuration,
  RiderGate,
  SaveActionDefinition,
  TerrainZone,
  UtilityActionDefinition,
  ZoneTrigger
} from "./types";
import {
  askDecision,
  type DecisionHost,
  type LegendaryResistanceRequest,
  type ReactionContext,
  type ReactionOption,
  type ReactionRequest,
  type RollOutcome,
  type RollRequest,
  type CounterOdds,
  type SpellThreat,
  type SwingRequest
} from "./decisions";

export interface EngineState extends DecisionHost {
  snapshot: EncounterSnapshot;
  log: CombatLogEvent[];
  rng: RandomSource;
  /** Re-entrancy guard for `runReactionWindow` — a reaction can't open the same window past depth 2. */
  reactionDepth?: number;
  /** Re-entrancy guard for `resolveDeathEffect` — one death effect's blast can kill another creature and trigger its death effect in turn, up to `MAX_DEATH_EFFECT_DEPTH`. */
  deathEffectDepth?: number;
  /**
   * A save a DM just overruled (Play), until it's logged: whoever logs the save (a dozen places do) gets it marked,
   * "(DM override)", by `event`.
   */
  saveOverride?: { targetId: Id; outcome: RollOutcome };
}

/** How deep reaction windows may nest (a counter-counterspell is legal; a third is not). */
const MAX_REACTION_DEPTH = 2;

/** How deep death-effect chains may cascade (a room of gas spores can chain-explode, but not infinitely). */
const MAX_DEATH_EFFECT_DEPTH = 10;

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

export interface RepositionResult {
  moved: boolean;
  from?: Point;
  to?: Point;
}

export interface BuffResult {
  targetIds: Id[];
  tempHpApplied?: number;
}

export interface HealingBurstResult {
  healingApplied: number;
  targetIds: Id[];
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
  // A shapechanger in another form resolves to that form's definition, so AC / speed / actions / traits swap
  // everywhere at once. HP, position and conditions live on the combatant and are untouched.
  const definition = snapshot.definitions.find((candidate) => candidate.id === (combatant.activeForm?.definitionId ?? combatant.definitionId));
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
    .flatMap((spell) => (spell.action ? [stampSpellContext(spell.action, spell, definition)] : []));
  // An optional variant rule (a demon's Summon Demon) grants nothing until the DM switches it on.
  const grantedActions = [
    ...(definition.features ?? []),
    ...(definition.traits ?? [])
  ].filter((feature) => !feature.optional || feature.enabled).flatMap((feature) => feature.grantedActions ?? []);
  // Anything that spends a spell slot can spend a higher one: a spell, or an older sheet's spell kept as an action.
  const spellUpcastActions = [
    ...spellActions,
    ...definition.actions,
    ...(definition.bonusActions ?? []),
    ...(definition.reactions ?? []),
    ...grantedActions
  ].flatMap((action) => spellUpcastVariants(definition, action));
  const weaponGrantedActions = (definition.weapons ?? []).flatMap((weapon) => weapon.grantedActions ?? []);
  const itemUses = workingItems(definition).flatMap(compileItemUses);

  const listed = [
    ...definition.actions,
    ...(definition.bonusActions ?? []),
    ...(definition.reactions ?? []),
    ...weaponActions,
    ...spellActions,
    ...spellUpcastActions,
    ...grantedActions,
    ...weaponGrantedActions,
    ...itemUses
  ];
  const declared = [...listed, ...nickVariants(definition, listed)]
    // A multiattack's options ("…or it makes two ranged attacks") are each an action of their own.
    .flatMap((action): ActionDefinition[] => (action.kind === "multiattack" ? multiattackVariants(action) : [action]));

  return dedupeActionsById([
    ...declared,
    ...synthesizeUtilityActions(declared),
    ...legendaryVariants(definition, declared),
    ...lairVariants(definition)
  ]).map(withEffectiveAutomationSupport);
}

/**
 * Weapon mastery's Nick: the extra attack of two light weapons is part of the Attack action, not a bonus action. For a
 * creature with a light weapon it uses Nick with, and another light weapon, each Attack routine of any weapons gets a
 * copy with one more swing of that weapon ("Attack (Nick)"); without one, a single attack plus the swing. Simplified:
 * the first attack needn't be made with a light weapon.
 */
function nickVariants(definition: CreatureDefinition, listed: ActionDefinition[]): ActionDefinition[] {
  const light = (definition.weapons ?? []).filter((weapon) => weapon.attackType === "melee" && isLightWeapon(weapon));
  const nick = light.find((weapon) => activeMastery(definition, weapon) === "nick");
  if (!nick || light.length < 2) return [];
  const nickAttackId = nick.actionId ?? `weapon:${nick.id}`;
  const routines = listed.filter((action): action is MultiattackActionDefinition => action.kind === "multiattack"
    && action.actionType === "action" && action.attacks.every((step) => step.any !== undefined));
  if (routines.length) {
    return routines.map((routine) => ({
      ...routine,
      id: `${routine.id}:nick`,
      name: `${routine.name} (Nick)`,
      attacks: [...routine.attacks, { actionId: nickAttackId, count: 1 }],
      options: undefined
    }));
  }
  return [{
    kind: "multiattack", id: `nick:${nick.id}`, name: `Attack (Nick: ${nick.name})`, actionType: "action",
    attacks: [{ any: "weapon", count: 1 }, { actionId: nickAttackId, count: 1 }], automationSupport: "full"
  }];
}

/** The pool legendary actions spend from; refilled to `legendary.pool` at the start of the creature's own turn. */
export const LEGENDARY_POINTS = "legendary-points";
/** Legendary versions of an action carry this id suffix, so they can be told apart from the action they copy. */
export const LEGENDARY_SUFFIX = ":legendary";

export function isLegendaryVariant(action: { id: string }): boolean {
  return action.id.endsWith(LEGENDARY_SUFFIX);
}

/**
 * A legendary action is the creature's own action (or a self-contained one) taken between other turns for
 * `cost` points. Each becomes a copy that spends no action / bonus action / reaction (`"free"`), so a normal
 * turn never picks it, and pays its cost from the legendary pool.
 */
function legendaryVariants(definition: CreatureDefinition, declared: ActionDefinition[]): ActionDefinition[] {
  const refs = definition.legendary?.actions ?? [];
  return refs.flatMap((ref): ActionDefinition[] => {
    const base = ref.action ?? declared.find((action) => action.id === ref.actionId);
    if (!base || base.kind === "unsupported") return [];
    const { usage: _usage, ...rest } = base as ActionDefinition & { usage?: ActionUsage };
    return [{
      ...rest,
      id: `${base.id}${LEGENDARY_SUFFIX}`,
      name: ref.name,
      actionType: "free",
      resourceCost: { resourceId: LEGENDARY_POINTS, amount: ref.cost }
    } as ActionDefinition];
  });
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
  { mode: "escape", name: "Escape a grapple", automationSupport: "full" },
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

/**
 * A rider needs a human when the engine can't resolve it: a reference `note`, or
 * a `{ custom }` condition with no explicit `modifiers` (a bare custom *name* has
 * no mechanical meaning — but `{ custom }` + `modifiers` is fully specified).
 */
export function riderNeedsHuman(rider: ActionRider): boolean {
  return rider.kind === "note"
    || (rider.kind === "condition" && typeof rider.condition !== "string" && !rider.modifiers);
}

function ridersNeedHuman(riders: ActionRider[]): boolean {
  return riders.some(riderNeedsHuman);
}

export function findActionDefinition(definition: CreatureDefinition, actionId: Id): ActionDefinition | undefined {
  return getExecutableActions(definition).find((candidate) => candidate.id === actionId);
}

/** The abilities a spellcaster casts with, in the order a tie goes. */
const SPELLCASTING_ABILITIES: Ability[] = ["int", "wis", "cha"];

/**
 * The ability a creature casts spells with when it hasn't been set: the one its spells' DC and attack bonus formulas
 * name most (ties to the higher modifier), or else its highest of INT, WIS and CHA.
 */
export function inferSpellcastingAbility(definition: CreatureDefinition): Ability {
  const named = new Map<Ability, number>();
  for (const spell of definition.spells ?? []) {
    const action = spell.action;
    const formula = action?.kind === "attack" ? action.attackBonusFormula : action?.kind === "save" || action?.kind === "area-save" ? action.dcFormula : undefined;
    if (formula?.ability && formula.ability !== "spellcasting") named.set(formula.ability, (named.get(formula.ability) ?? 0) + 1);
  }
  const score = (ability: Ability) => definition.abilities[ability] ?? 10;
  const candidates = named.size ? [...named.keys()] : SPELLCASTING_ABILITIES;
  return candidates.reduce((best, ability) => {
    const byCount = (named.get(ability) ?? 0) - (named.get(best) ?? 0);
    if (byCount !== 0) return byCount > 0 ? ability : best;
    return score(ability) > score(best) ? ability : best;
  });
}

/** The ability a creature casts spells with: its own (`spellcasting.ability`), or the inferred one. */
export function spellcastingAbility(definition: CreatureDefinition): Ability {
  return definition.spellcasting?.ability ?? inferSpellcastingAbility(definition);
}

/** A formula's ability as the ability it stands for: `"spellcasting"` is the creature's spellcasting ability. */
export function formulaAbility(ability: NumericFormula["ability"], definition: CreatureDefinition): Ability | undefined {
  return ability === "spellcasting" ? spellcastingAbility(definition) : ability;
}

export function resolveNumericFormula(formula: NumericFormula | undefined, definition: CreatureDefinition): number {
  if (!formula) {
    return 0;
  }
  const base = formula.base ?? 0;
  const ability = formulaAbility(formula.ability, definition);
  const abilityBonus = ability ? abilityModifier(definition.abilities[ability]) : 0;
  const proficiencyBonus = formula.proficiency ? (definition.proficiencyBonus ?? proficiencyFromDefinition(definition)) : 0;
  return Math.trunc((base + abilityBonus + proficiencyBonus) * (formula.multiplier ?? 1));
}

export function resolveAttackBonus(action: AttackActionDefinition, definition: CreatureDefinition): number {
  if (action.attackBonusFormula) {
    return resolveNumericFormula(action.attackBonusFormula, definition);
  }
  return action.attackBonus ?? (abilityModifier(definition.abilities[action.ability]) + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition)));
}

/** 8 + ability modifier + proficiency bonus — the standard 5e save DC fallback when no explicit `dc`/`dcFormula` is set. */
function defaultSaveDc(definition: CreatureDefinition, ability: Ability): number {
  return 8 + abilityModifier(definition.abilities[ability]) + (definition.proficiencyBonus ?? proficiencyFromDefinition(definition));
}

/**
 * A save action's DC. With the caster's token, what its active conditions give counts too (Innate Sorcery's +1); the AI's
 * estimates read the definition alone.
 */
export function resolveSaveDc(action: SaveActionDefinition | AreaSaveActionDefinition, definition: CreatureDefinition, caster?: CombatantState): number {
  const featureDcBonus = featureSaveDcModifier(definition, action, caster);
  if (action.dcFormula) {
    return resolveNumericFormula(action.dcFormula, definition) + featureDcBonus.total;
  }
  return (action.dc ?? defaultSaveDc(definition, action.saveAbility)) + featureDcBonus.total;
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

/**
 * The turn-order comparator: initiative, then Dex modifier, then id. `rollInitiative`, `syncTurnOrder`'s re-sort (Step,
 * Play) and `insertIntoTurnOrder`'s splice position all use this. Auto Run's `ensureInitiative` still sorts initiative
 * that was rolled before the run by initiative then id, as it always has — see there.
 */
export function compareInitiative(snapshot: EncounterSnapshot, a: CombatantState, b: CombatantState): number {
  const aDefinition = getDefinition(snapshot, a);
  const bDefinition = getDefinition(snapshot, b);
  return (b.initiative ?? 0) - (a.initiative ?? 0)
    || abilityModifier(bDefinition.abilities.dex) - abilityModifier(aDefinition.abilities.dex)
    || a.id.localeCompare(b.id);
}

export function rollInitiative(state: EngineState): void {
  const rolls = state.snapshot.combatants.map((combatant) => {
    const definition = getDefinition(state.snapshot, combatant);
    const dex = abilityModifier(definition.abilities.dex);
    const roll = rollDice(withBonus("1d20", dex), state.rng);
    combatant.initiative = roll.total;
    return { combatant, definition, roll };
  });

  state.snapshot.combatants.sort((a, b) => compareInitiative(state.snapshot, a, b));

  state.log.push(event(state, "InitiativeRolled", "Initiative order established", {
    rolls: rolls.map(({ combatant, roll }) => ({
      combatantId: combatant.id,
      total: roll.total,
      rolls: roll.rolls
    })),
    order: state.snapshot.combatants.map((combatant) => combatant.id)
  }));
}

/**
 * Route `start` -> `goal` steered away from hazard terrain when a
 * comparably-priced detour exists (`routeMap` — `map` run through
 * `hazardPathingOverlay`), but costed against the real map afterward so the
 * detour preference never leaks into real movement-budget accounting. Falls
 * back to a plain route on `map` if the hazard-avoiding search can't reach
 * the goal at all (walls/occupancy make it illegal outright — inflating a
 * hazard tile's cost alone never does, since it stays finite).
 */
function hazardAwarePath(
  map: BattleMapState,
  routeMap: BattleMapState,
  start: Point,
  goal: Point,
  footprint: number,
  occupied: Point[],
  options: OccupancyMovementOptions
): PathResult {
  const planned = findPath(routeMap, start, goal, footprint, occupied, options);
  if (!planned.reachable) {
    return findPath(map, start, goal, footprint, occupied, options);
  }
  return { reachable: true, cost: pathCostAlong(map, planned.cells, footprint, occupied, options), cells: planned.cells };
}

/* ─── Phase 9: charges, trigger-gated follow-ups, trait auras, evasion, lair actions ─────────────────────── */

/** Lair versions of an action carry this id suffix; they spend no action and are taken on initiative 20. */
export const LAIR_SUFFIX = ":lair";

export function isLairVariant(action: { id: string }): boolean {
  return action.id.endsWith(LAIR_SUFFIX);
}

/** `definition.lairActions`, as `"free"` actions the engine can resolve by id (`<id>:lair`). */
function lairVariants(definition: CreatureDefinition): ActionDefinition[] {
  return (definition.lairActions ?? [])
    .filter((action) => action.kind !== "unsupported")
    .map((action) => ({ ...action, id: action.id.endsWith(LAIR_SUFFIX) ? action.id : `${action.id}${LAIR_SUFFIX}`, actionType: "free" } as ActionDefinition));
}

/**
 * Charge / Pounce: whether `attacker` has closed at least `feet` on `target` this turn, measured from where its
 * movement began. Closing distance rather than distance walked is what makes it "straight toward": a detour around a
 * wall covers ground without getting any closer.
 */
export function hasChargedAt(snapshot: EncounterSnapshot, attacker: CombatantState, target: CombatantState, feet = 20): boolean {
  const from = attacker.turnFlags?.movedFrom;
  if (!from) return false;
  const grid = snapshot.map.grid;
  return gridDistance(from, target.position, grid) - gridDistance(attacker.position, target.position, grid) >= feet;
}

/** A charge-conditioned effect just landed on `target`: remember it, so Pounce's follow-up bite can go after it. */
function noteChargeHit(attacker: CombatantState, target: CombatantState, effect: FeatureEffect): void {
  const gated = ("condition" in effect && effect.condition === "charged")
    || ("allConditions" in effect && effect.allConditions?.includes("charged"));
  if (!gated) return;
  const hits = attacker.turnFlags?.chargeHitTargetIds ?? [];
  if (!hits.includes(target.id)) attacker.turnFlags = { ...(attacker.turnFlags ?? {}), chargeHitTargetIds: [...hits, target.id] };
}

/**
 * Whether a trigger-gated attack (`onlyAfter`, `requiresTargetCondition`) can be made against `target` right now:
 * Pounce's bite only against the prone creature its charge hit, Rampage's bite only after a kill this turn.
 */
export function attackPrerequisitesMet(actor: CombatantState, action: ActionDefinition, target: CombatantState): boolean {
  if (action.kind !== "attack") return true;
  if (action.onlyAfter === "charge-hit" && !(actor.turnFlags?.chargeHitTargetIds ?? []).includes(target.id)) return false;
  if (action.onlyAfter === "dropped-creature" && !actor.turnFlags?.droppedCreature) return false;
  if (action.requiresTargetCondition && !(target.conditions ?? []).some((condition) => condition.name === action.requiresTargetCondition)) return false;
  return true;
}

/** Evasion: a Dexterity save for half damage negates it on a success and halves it on a failure. */
export function saveDamageOutcome(
  state: EngineState,
  target: CombatantState,
  ability: Ability | undefined,
  onSuccess: "half" | "none" | "negates" | undefined,
  success: boolean | null
): { dealsDamage: boolean; halve: boolean } {
  const evades = ability === "dex" && onSuccess === "half" && success !== null
    && featureSources(getDefinition(state.snapshot, target), target).some((feature) => (feature.effects ?? []).some((effect) => effect.kind === "evasion"));
  if (evades) return { dealsDamage: success === false, halve: success === false };
  return {
    dealsDamage: !(success === true && (onSuccess === "none" || onSuccess === "negates")),
    halve: success === true && onSuccess === "half"
  };
}

/** Heated Body / Corrosive Form / Fire Aura: hitting the bearer in melee from close by hurts the attacker. */
function applyMeleeRetaliation(state: EngineState, attacker: CombatantState, target: CombatantState, action: AttackActionDefinition): void {
  if (action.attackType !== "melee" || attacker.state !== "active") return;
  const targetDefinition = getDefinition(state.snapshot, target);
  for (const feature of featureSources(targetDefinition, target)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "melee-retaliation" || spatialDistance(state.snapshot, attacker, target) > (effect.withinFt ?? 5)) continue;
      state.log.push(event(state, "FeatureEffectApplied", `${attacker.displayName} is hurt by ${target.displayName}'s ${feature.name}`, {
        combatantId: target.id, attackerId: attacker.id, targetId: attacker.id, featureId: feature.id, featureName: feature.name, effectKind: effect.kind
      }));
      applyDamageComponents(state, attacker, effect.damage, targetDefinition, false, {}, target.id);
      if (attacker.state !== "active") return;
    }
  }
}

/**
 * Trait auras (Stench, Fear Aura, Fire Aura) for the turn that is starting: every other creature's
 * `"target-turn-start"` aura that reaches `actor`, then `actor`'s own `"bearer-turn-start"` aura on everyone near it.
 */
export function applyEmanations(state: EngineState, actor: CombatantState): void {
  const live = (combatant: CombatantState) => combatant.state === "active" || combatant.state === "downed";
  for (const bearer of state.snapshot.combatants) {
    if (bearer.id === actor.id || bearer.state !== "active" || !live(actor)) continue;
    for (const feature of featureSources(getDefinition(state.snapshot, bearer), bearer)) {
      const emanation = "emanation" in feature ? feature.emanation : undefined;
      if (emanation?.timing === "target-turn-start") applyEmanation(state, bearer, feature, emanation, actor);
    }
  }
  if (actor.state !== "active") return;
  for (const feature of featureSources(getDefinition(state.snapshot, actor), actor)) {
    const emanation = "emanation" in feature ? feature.emanation : undefined;
    if (emanation?.timing !== "bearer-turn-start") continue;
    for (const other of [...state.snapshot.combatants]) {
      if (other.id !== actor.id && live(other)) applyEmanation(state, actor, feature, emanation, other);
    }
  }
}

function applyEmanation(state: EngineState, bearer: CombatantState, feature: FeatureDefinitionSource, emanation: TraitEmanation, target: CombatantState): void {
  if (target.containedBy || bearer.containedBy) return;
  if (emanation.affects === "hostile" && effectiveFaction(state.snapshot, bearer) === effectiveFaction(state.snapshot, target)) return;
  if (spatialDistance(state.snapshot, bearer, target) > emanation.range) return;
  // "free": incapacitated or not. Its action is spent once its own turn is over, which mustn't silence the aura.
  if (emanation.suppressedWhenIncapacitated && !canAct(bearer, "free")) return;
  const immunityKey = `${bearer.id}:${feature.id}`;
  if (emanation.immuneOnSave && (target.savedAgainst ?? []).includes(immunityKey)) return;
  const bearerDefinition = getDefinition(state.snapshot, bearer);

  let success: boolean | null = null;
  if (emanation.save) {
    const save = rollSavingThrow(state, target, {
      ability: emanation.save.ability, dc: emanation.save.dc, kind: "feature",
      conditions: emanation.condition ? [emanation.condition] : undefined
    });
    success = save.success;
    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${emanation.save.ability.toUpperCase()} save against ${bearer.displayName}'s ${feature.name}`, {
      attackerId: bearer.id, targetId: target.id, featureId: feature.id, saveRoll: save.roll, total: save.roll.total, dc: emanation.save.dc,
      featureSaveBonus: save.featureBonus.total, appliedSaveEffects: [...save.featureBonus.sources, ...save.featureAdvantage.sources], success
    }));
    if (success && emanation.immuneOnSave) {
      target.savedAgainst = [...(target.savedAgainst ?? []), immunityKey];
    }
  } else {
    state.log.push(event(state, "FeatureEffectApplied", `${target.displayName} is caught in ${bearer.displayName}'s ${feature.name}`, {
      combatantId: bearer.id, targetId: target.id, featureId: feature.id, featureName: feature.name, effectKind: "emanation"
    }));
  }

  if (emanation.damage?.length && (success !== true || emanation.halfOnSave)) {
    applyDamageComponents(state, target, emanation.damage, bearerDefinition, false, { halve: success === true }, bearer.id);
  }
  if (emanation.condition && success !== true && (target.state === "active" || target.state === "downed")) {
    const index = state.snapshot.combatants.findIndex((combatant) => combatant.id === target.id);
    const { expiresAt } = riderDurationToExpiry(state, { kind: "until-start-of-next-turn" }, index >= 0 ? index : undefined);
    applyCondition(state, target.id, {
      id: `${target.id}:${bearer.id}:${feature.id}`,
      name: emanation.condition,
      modifiers: defaultConditionModifiers(emanation.condition),
      sourceId: feature.id,
      sourceName: feature.name,
      sourceCombatantId: bearer.id,
      startedRound: state.snapshot.round,
      // Applied at the start of the target's own turn, so it lasts through that turn to the start of its next.
      expiresAt: expiresAt && expiresAt.round === state.snapshot.round && expiresAt.turnIndex === state.snapshot.turnIndex
        ? { ...expiresAt, round: expiresAt.round + 1 }
        : expiresAt
    });
  }
}

/**
 * Height above the datum of `combatant` (or of where it would be at `position` / `altitude`): the ground under its
 * footprint plus how far it is flying above it. A map with no ground heights skips the lookup.
 */
export function combatantHeight(
  snapshot: EncounterSnapshot,
  combatant: CombatantState,
  at: { position?: Point; altitude?: number } = {}
): number {
  const altitude = at.altitude ?? combatant.altitude ?? 0;
  if (!snapshot.map.elevation) return altitude;
  const footprint = sizeFootprint(getDefinition(snapshot, combatant).size);
  return footprintGroundHeight(snapshot.map, at.position ?? combatant.position, footprint) + altitude;
}

/**
 * Feet between two combatants, height included — every reach, range, aura and hold check goes through this so a
 * dragon 30 ft up is out of a spearman's reach but not a bowman's. `at` overrides where either one is standing
 * (an opportunity attack asks about a cell the mover has not reached yet). On a flat map with nobody airborne this
 * is exactly the old flat grid distance.
 */
export function spatialDistance(
  snapshot: EncounterSnapshot,
  a: CombatantState,
  b: CombatantState,
  at: { a?: Point; b?: Point; aAltitude?: number; bAltitude?: number } = {}
): number {
  const aPosition = at.a ?? a.position;
  const bPosition = at.b ?? b.position;
  const aAltitude = at.aAltitude ?? a.altitude ?? 0;
  const bAltitude = at.bAltitude ?? b.altitude ?? 0;
  if (!snapshot.map.elevation && aAltitude === 0 && bAltitude === 0) {
    return gridDistance(aPosition, bPosition, snapshot.map.grid);
  }
  const vertical = combatantHeight(snapshot, a, { position: aPosition, altitude: aAltitude })
    - combatantHeight(snapshot, b, { position: bPosition, altitude: bAltitude });
  return distanceWithHeight(snapshot.map.grid, aPosition, bPosition, vertical);
}

/** Feet from a combatant to a point on the ground (an area's origin, a spell's aim point). */
export function spatialDistanceToPoint(snapshot: EncounterSnapshot, from: CombatantState, point: Point): number {
  if (!snapshot.map.elevation && !from.altitude) {
    return gridDistance(from.position, point, snapshot.map.grid);
  }
  const vertical = combatantHeight(snapshot, from) - groundHeightAt(snapshot.map, point);
  return distanceWithHeight(snapshot.map.grid, from.position, point, vertical);
}

export function moveCombatant(
  state: EngineState,
  combatantId: Id,
  destination: Point,
  options: { provokeOpportunityAttacks?: boolean; altitude?: number } = {}
): Point[] {
  const combatant = findCombatant(state.snapshot, combatantId);
  const definition = getDefinition(state.snapshot, combatant);
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCells(state.snapshot, combatantId);
  const start = combatant.position;
  const map = zoneTerrainOverlay(state.snapshot.map, state.snapshot.activeZones);
  const routeMap = hazardPathingOverlay(map);
  const pathOptions = movementOptionsFor(definition);
  const path = plannedPath(state.snapshot, combatantId, destination);
  const movementBudget = remainingMovementBudget(state.snapshot, combatant);

  // Rising or dropping is flying, and costs movement like any other flying.
  if (!combatant.turnFlags?.movedFrom) {
    combatant.turnFlags = { ...(combatant.turnFlags ?? {}), movedFrom: { ...start } };
  }
  const startAltitude = combatant.altitude ?? 0;
  const targetAltitude = options.altitude === undefined ? startAltitude : Math.max(0, options.altitude);
  const verticalFt = Math.abs(targetAltitude - startAltitude);
  if (verticalFt > 0 && !movementProfileOf(definition).fly) {
    throw new Error(`${combatant.displayName} can't fly`);
  }
  const altitudeCost = altitudeMoveCost(state.snapshot, definition, verticalFt);

  if (!path.reachable || path.cost + altitudeCost > movementBudget) {
    throw new Error(`Destination is not reachable with ${definition.speed} ft. of movement`);
  }

  const provoke = (options.provokeOpportunityAttacks ?? true)
    && !moverAvoidsOpportunityAttacks(state.snapshot, combatant);
  const movedCells = moveAlongPath(state, combatant, path.cells, provoke);
  const actualPath = pointsEqual(combatant.position, destination)
    ? path
    : hazardAwarePath(map, routeMap, start, combatant.position, footprint, occupied, pathOptions);

  // The altitude change happens once it has arrived; rising out of a foe's reach provokes just like walking out of it.
  let changedAltitude = false;
  if (verticalFt > 0 && combatant.state === "active" && pointsEqual(combatant.position, destination)) {
    if (provoke) {
      runReactionWindow(state, {
        kind: "enemy-leaves-reach", sourceId: combatant.id, from: combatant.position, to: combatant.position,
        fromAltitude: startAltitude, toAltitude: targetAltitude
      });
    }
    if (combatant.state === "active") {
      combatant.altitude = targetAltitude > 0 ? targetAltitude : undefined;
      changedAltitude = true;
    }
  }

  combatant.turnFlags = {
    ...(combatant.turnFlags ?? {}),
    movementUsed: (combatant.turnFlags?.movementUsed ?? 0) + (actualPath.reachable ? actualPath.cost : 0) + (changedAltitude ? altitudeCost : 0)
  };
  const walked = movedCells.length > 1;
  const altitudePhrase = !changedAltitude ? ""
    : targetAltitude === 0 ? "lands"
      : targetAltitude > startAltitude ? `climbs to ${targetAltitude} ft` : `descends to ${targetAltitude} ft`;
  state.log.push(event(state, "CombatantMoved",
    walked ? `${combatant.displayName} moved${altitudePhrase ? ` and ${altitudePhrase}` : ""}` : altitudePhrase ? `${combatant.displayName} ${altitudePhrase}` : `${combatant.displayName} moved`, {
    combatantId,
    destination: combatant.position,
    requestedDestination: destination,
    cost: (actualPath.reachable ? actualPath.cost : 0) + (changedAltitude ? altitudeCost : 0),
    requestedCost: path.cost + altitudeCost,
    cells: movedCells,
    interrupted: combatant.state !== "active" && !pointsEqual(combatant.position, destination),
    ...(changedAltitude ? { altitude: targetAltitude, fromAltitude: startAltitude } : {})
  }));
  checkZoneOnEnter(state, combatant, movedCells);
  checkTerrainHazardOnEnter(state, combatant, movedCells);
  recenterSelfAnchoredZones(state, combatant);
  return movedCells;
}

/**
 * The route `moveCombatant` takes from where `combatantId` stands to `destination`, and what it costs (in squares):
 * around walls and other creatures, preferring a way round hazards when one costs about the same. A move preview
 * shows this, so it can't disagree with the move.
 */
export function plannedPath(snapshot: EncounterSnapshot, combatantId: Id, destination: Point, from?: Point): PathResult {
  const combatant = findCombatant(snapshot, combatantId);
  const definition = getDefinition(snapshot, combatant);
  const map = zoneTerrainOverlay(snapshot.map, snapshot.activeZones);
  return hazardAwarePath(map, hazardPathingOverlay(map), from ?? combatant.position, destination, sizeFootprint(definition.size), occupiedCells(snapshot, combatantId), movementOptionsFor(definition));
}

/**
 * Every square `combatantId` could end a move on with `budget` squares of movement (by default what it has left this
 * turn), setting off from `from` (by default where it stands), and what getting there costs. The routes are the ones
 * `plannedPath` takes — round a hazard where a detour costs about the same, costed on the real map — so a square
 * listed here is one a move there reaches.
 */
export function reachableCells(
  snapshot: EncounterSnapshot,
  combatantId: Id,
  options: { from?: Point; budget?: number } = {}
): Array<{ cell: Point; cost: number }> {
  const combatant = findCombatant(snapshot, combatantId);
  const definition = getDefinition(snapshot, combatant);
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCells(snapshot, combatantId);
  const pathOptions = movementOptionsFor(definition);
  const start = options.from ?? combatant.position;
  // To within a hair, as a move's own check is.
  const budget = (options.budget ?? remainingMovementBudget(snapshot, combatant)) + 1e-9;
  const map = zoneTerrainOverlay(snapshot.map, snapshot.activeZones);
  const routeMap = hazardPathingOverlay(map);
  if (routeMap === map) {
    return findReachableCells(map, start, footprint, budget, occupied, pathOptions).map(({ cell, cost }) => ({ cell, cost }));
  }
  // Planning a route that keeps off hazards costs at most HAZARD_PATHING_MULTIPLIER times what walking it does. Each
  // square's route is its parent's plus one step, so its real cost is too.
  const realCost = new Map<string, number>([[`${start.x},${start.y}`, 0]]);
  const keyOf = (cell: Point) => `${cell.x},${cell.y}`;
  const costAlong = (cells: Point[]): number => {
    let known = cells.length - 1;
    while (known > 0 && !realCost.has(keyOf(cells[known]!))) known -= 1;
    let total = realCost.get(keyOf(cells[known]!)) ?? 0;
    for (let next = known + 1; next < cells.length; next += 1) {
      total += stepCost(map, cells[next - 1]!, cells[next]!, footprint, occupied, pathOptions);
      realCost.set(keyOf(cells[next]!), total);
    }
    return total;
  };
  return findReachableCells(routeMap, start, footprint, budget * HAZARD_PATHING_MULTIPLIER, occupied, pathOptions)
    .map(({ cell, cells }) => ({ cell, cost: costAlong(cells) }))
    .filter(({ cost }) => cost <= budget);
}

/** What each step along `cells` (a route `combatantId` takes) costs it, in squares, beside what the step would cost on open ground. */
export function routeStepCosts(snapshot: EncounterSnapshot, combatantId: Id, cells: Point[]): Array<{ cost: number; open: number }> {
  const combatant = findCombatant(snapshot, combatantId);
  const definition = getDefinition(snapshot, combatant);
  const footprint = sizeFootprint(definition.size);
  const occupied = occupiedCells(snapshot, combatantId);
  const pathOptions = movementOptionsFor(definition);
  const map = zoneTerrainOverlay(snapshot.map, snapshot.activeZones);
  return cells.slice(1).map((cell, index) => ({
    cost: stepCost(map, cells[index]!, cell, footprint, occupied, pathOptions),
    open: stepDistance(cells[index]!, cell, map.grid)
  }));
}

/** Why `combatantId` can't stand at `destination` — off the map, another creature there, or ground nothing stands on — if it can't. */
export function standingProblem(snapshot: EncounterSnapshot, combatantId: Id, destination: Point): string | undefined {
  const combatant = findCombatant(snapshot, combatantId);
  const footprint = sizeFootprint(getDefinition(snapshot, combatant).size);
  const map = zoneTerrainOverlay(snapshot.map, snapshot.activeZones);
  const cells = footprintCells(destination, footprint);
  if (cells.some((cell) => cell.x < 0 || cell.y < 0 || cell.x >= map.grid.width || cell.y >= map.grid.height)) {
    return "That's off the map";
  }
  const there = snapshot.combatants.find((other) => other.id !== combatantId && other.state === "active"
    && footprintCells(other.position, sizeFootprint(getDefinition(snapshot, other).size)).some((cell) => cells.some((own) => pointsEqual(own, cell))));
  if (there) {
    return `${there.displayName} is there`;
  }
  if (cells.some((cell) => terrainAtCell(map.terrain, cell)?.type === "impassable")) {
    return "Nothing can stand there";
  }
  return undefined;
}

/**
 * The DM puts a creature on a square in the middle of a fight: no movement spent, nothing provoked, nothing on the way
 * or where it lands goes off. An aura it carries goes with it. Logged (`source: "dm"`), so a replay and the report
 * see it.
 */
export function placeByDm(state: EngineState, combatantId: Id, destination: Point): void {
  const combatant = findCombatant(state.snapshot, combatantId);
  if (pointsEqual(combatant.position, destination)) {
    throw new Error(`${combatant.displayName} is already there`);
  }
  const problem = standingProblem(state.snapshot, combatantId, destination);
  if (problem) {
    throw new Error(problem);
  }
  const from = { ...combatant.position };
  combatant.position = { ...destination };
  for (const inside of state.snapshot.combatants) if (inside.containedBy === combatant.id) inside.position = { ...destination };
  const footprint = sizeFootprint(getDefinition(state.snapshot, combatant).size);
  for (const zone of state.snapshot.activeZones ?? []) {
    if (zone.sourceCombatantId === combatant.id && zone.anchor === "self") zone.origin = selfOriginFor(combatant.position, footprint);
  }
  state.log.push(event(state, "CombatantMoved", `The DM moved ${combatant.displayName}`, {
    combatantId, destination: { ...destination }, cells: [from, { ...destination }], cost: 0, source: "dm"
  }));
}

/**
 * The DM sets a creature's hit points (and, if given, its temporary hit points), in a fight. Logged as damage or healing
 * with `source: "dm"`, so the report and a replay see it; dropping to 0 downs or defeats it as damage would, and
 * bringing a fallen creature above 0 stands it back up, as healing would.
 */
export function setHpByDm(state: EngineState, combatantId: Id, hp: number, tempHp?: number): void {
  const target = findCombatant(state.snapshot, combatantId);
  const definition = getDefinition(state.snapshot, target);
  const before = target.currentHp;
  const next = Math.min(definition.maxHp, Math.max(0, Math.round(hp)));
  const temp = tempHp === undefined ? target.tempHp : Math.max(0, Math.round(tempHp));
  if (next === before && temp === target.tempHp) {
    throw new Error(`${target.displayName} already has that`);
  }
  if (temp !== target.tempHp) {
    target.tempHp = temp;
    state.log.push(event(state, "TempHpChanged", `The DM set ${target.displayName}'s temporary HP to ${temp}`, {
      targetId: target.id, tempHp: temp, source: "dm"
    }));
  }
  if (next < before) {
    target.currentHp = next;
    state.log.push(event(state, "DamageApplied", `The DM took ${target.displayName} down to ${next} HP`, {
      targetId: target.id, totalApplied: before - next, currentHp: next, tempHp: target.tempHp, source: "dm"
    }));
    updateDefeatState(state, target);
  } else if (next > before) {
    target.currentHp = next;
    if (target.state === "downed" || target.state === "defeated") {
      target.state = "active";
      target.deathSaves = { successes: 0, failures: 0, stable: false };
      target.conditions = (target.conditions ?? []).filter((condition) => condition.name !== "unconscious");
    }
    state.log.push(event(state, "HealingApplied", `The DM brought ${target.displayName} up to ${next} HP`, {
      targetId: target.id, healingApplied: next - before, currentHp: next, source: "dm"
    }));
  }
}

/** The DM puts a condition on a creature (with its usual effects), or takes one off it. Logged as the engine logs conditions, with `source: "dm"`. */
export function conditionByDm(state: EngineState, combatantId: Id, change: { add?: ConditionName; removeId?: Id }): void {
  const target = findCombatant(state.snapshot, combatantId);
  if (change.add) {
    const applied = applyCondition(state, target.id, {
      id: `${target.id}:dm:${change.add}:${state.log.length}`,
      name: change.add,
      sourceName: "the DM",
      startedRound: state.snapshot.round,
      modifiers: defaultConditionModifiers(change.add)
    }, { force: true });
    if (!applied) throw new Error(`${target.displayName} can't be ${change.add}`);
    const logged = state.log.at(-1);
    if (logged?.type === "ConditionApplied") logged.data = { ...(logged.data ?? {}), source: "dm" };
    return;
  }
  const condition = (target.conditions ?? []).find((candidate) => candidate.id === change.removeId);
  if (!condition) throw new Error(`${target.displayName} has no such condition`);
  target.conditions = (target.conditions ?? []).filter((candidate) => candidate.id !== condition.id);
  state.log.push(event(state, "ConditionExpired", `The DM took ${condition.name === "custom" ? condition.sourceName ?? "an effect" : condition.name} off ${target.displayName}`, {
    combatantId: target.id, condition, source: "dm"
  }));
}

/** The DM gives a creature back the reaction it has used this round. */
export function restoreReactionByDm(state: EngineState, combatantId: Id): void {
  const target = findCombatant(state.snapshot, combatantId);
  if (target.actionEconomy?.reaction !== false) throw new Error(`${target.displayName} still has its reaction`);
  target.actionEconomy = { ...target.actionEconomy, reaction: true };
  state.log.push(event(state, "ReactionRestored", `The DM gave ${target.displayName} its reaction back`, { combatantId: target.id, source: "dm" }));
}

/** The DM opens or closes a door (a wall with a door state). */
export function toggleDoorByDm(state: EngineState, wallId: Id, open: boolean): void {
  const wall = state.snapshot.map.walls.find((candidate) => candidate.id === wallId);
  if (!wall?.doorState) throw new Error("That isn't a door");
  if (wall.doorState === "destroyed") throw new Error("That door is destroyed");
  const doorState = open ? "open" : "closed";
  if (wall.doorState === doorState) throw new Error(`The door is already ${doorState}`);
  wall.doorState = doorState;
  state.log.push(event(state, "DoorToggled", `The DM ${open ? "opened" : "closed"} a door`, { wallId, doorState, source: "dm" }));
}

/** Movement (in squares of the creature's fastest speed) spent rising or dropping `feet` while flying. */
export function altitudeMoveCost(snapshot: EncounterSnapshot, definition: CreatureDefinition, feet: number): number {
  if (feet <= 0) return 0;
  const profile = movementProfileOf(definition);
  const fly = profile.fly ?? 0;
  if (fly <= 0) return Number.POSITIVE_INFINITY;
  return (feet / snapshot.map.grid.distancePerSquare) * (movementReference(profile) / fly);
}

/**
 * A combatant's current fighting side, accounting for domination (Dominate
 * Person/Beast, Planar Binding). Live-derived, never stored: the moment the
 * bearer's `"dominated"` condition is gone (expiry, a broken concentration,
 * a shaken-off save, or a DM clearing conditions), this reverts on its own —
 * mirrors how aura/zone membership is also recomputed live rather than
 * persisted. `depth` guards against a pathological dominator-of-a-dominator
 * cycle; real content should never chain more than one deep.
 */
export function effectiveFaction(snapshot: EncounterSnapshot, combatant: CombatantState, depth = 0): Faction {
  if (depth >= 4) {
    return combatant.faction;
  }
  const dominated = combatant.conditions?.find((condition) => condition.name === "dominated");
  if (!dominated?.sourceCombatantId) {
    return combatant.faction;
  }
  const dominator = snapshot.combatants.find((c) => c.id === dominated.sourceCombatantId);
  if (!dominator || dominator.id === combatant.id) {
    return combatant.faction;
  }
  return effectiveFaction(snapshot, dominator, depth + 1);
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
      if (committedReactors.has(reactor.id) || reactor.id === mover.id || effectiveFaction(snapshot, reactor) === effectiveFaction(snapshot, mover) || reactor.state !== "active") {
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
  })), attackerDefinition, attacker.id);
  state.log.push(event(state, "AttackRolled", `${attacker.displayName} auto-hit ${target.displayName} with ${action.name}`, {
    attackerId: attacker.id, targetId: target.id, actionId: action.id, autoHit: true, hit: true, critical: false, damageApplied
  }));
  if (action.riders?.length) {
    applyActionRiders(state, attacker, target, attackerDefinition, action.riders, {
      actionId: action.id, landed: true, saved: null, origin: attacker.position,
      fallbackDc: defaultSaveDc(attackerDefinition, action.ability)
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
  const beamCount = resolveBeamCount(action, casterLevelOf(attackerDefinition), options.slotLevel ?? spellSlotLevel(action.resourceCost?.resourceId));
  declareAction(state, attacker, action, { target: findCombatant(state.snapshot, targetIds[0] as Id) });
  // Beam i goes at targetIds[i], the last named taking any left over.
  const beamTargets = Array.from({ length: beamCount }, (_, index) => targetIds[Math.min(index, targetIds.length - 1)] as Id);
  if (counterspellWindow(state, attacker, action, { targetIds: beamTargets })) {
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

/**
 * Whether a save step inside a multiattack has anyone left to affect: a hostile within its range who hasn't
 * already made the save against it (`immuneAfterSave`) and doesn't already carry the condition it inflicts.
 */
function saveStepWorthTaking(state: EngineState, attacker: CombatantState, action: Extract<ActionDefinition, { kind: "save" | "area-save" }>): boolean {
  const inflicted = conditionsOfRiders(action.riders);
  return state.snapshot.combatants.some((candidate) => candidate.state === "active"
    && effectiveFaction(state.snapshot, candidate) !== effectiveFaction(state.snapshot, attacker)
    && spatialDistance(state.snapshot, attacker, candidate) <= action.range
    && !isImmuneAfterSave(attacker, candidate, action)
    && !(action.damage.length === 0 && inflicted.length > 0 && inflicted.every((name) => candidate.conditions?.some((condition) => condition.name === name))));
}

/** What a multiattack's caller (the AI) is told before each swing, to decide it after the previous one landed. */
export interface MultiattackSwingContext {
  swing: MultiattackSwing;
  /** The attacks this swing can use right now: affordable, and the same weapon when the routine is held to one. */
  candidates: AttackActionDefinition[];
  /** The swing before it, if one was made. */
  previous?: { targetId: Id; actionId: Id; hit: boolean };
  /** Everyone an earlier swing of this use attacked. */
  targetedIds: Id[];
}

/** The caller's decision for one swing: whom, with what; or to skip it. Anything left out falls back to the defaults. */
export interface MultiattackSwingChoice {
  targetId?: Id;
  actionId?: Id;
  skip?: boolean;
}

/** Spend what an attack or ability inside a routine costs (a charge, ki, a recharge), without spending another action. */
function spendEmbeddedCost(combatant: CombatantState, action: { resourceCost?: ResourceCost }): void {
  const cost = action.resourceCost;
  if (!cost) return;
  const available = combatant.resources?.[cost.resourceId] ?? 0;
  if (available < cost.amount) throw new Error(`${combatant.displayName} lacks ${cost.resourceId}`);
  combatant.resources = { ...(combatant.resources ?? {}), [cost.resourceId]: available - cost.amount };
}

export function resolveMultiattackAction(
  state: EngineState,
  attackerId: Id,
  targetIds: Id | Id[],
  actionId: Id,
  options: {
    advantage?: boolean;
    disadvantage?: boolean;
    coverBonus?: number;
    /**
     * One target id per individual attack (flattened across every step × count),
     * consumed in order. Overrides `targetGroup`; falls through to the next live
     * `targetIds` entry when the assigned target is already down.
     */
    attackTargetIds?: Id[];
    /** One attack per swing, as `attackTargetIds`: which of its candidates (a power attack, the longbow) to use. */
    attackActionIds?: Id[];
    /**
     * Called before each attack swing, after the one before it resolved: the AI re-decides the swing there (and may
     * move first, with the movement it has left). Its answer wins over `attackTargetIds` / `attackActionIds`.
     */
    beforeSwing?: (context: MultiattackSwingContext) => MultiattackSwingChoice | undefined;
  } = {}
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
  const executables = getExecutableActions(attackerDefinition);

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
  const skipped = (swing: MultiattackSwing, reason: string) => state.log.push(event(state, "MultiattackSwingSkipped", `${attacker.displayName} skips a ${action.name} attack: ${reason}`, {
    attackerId, actionId, step: swing.stepIndex, swing: swing.index, reason
  }));

  const attacks: AttackResult[] = [];
  let previous: MultiattackSwingContext["previous"];
  const targetedIds: Id[] = [];
  // "One weapon per Attack action": the first swing's weapon, for the rest.
  let weapon: Id | undefined;
  for (const swing of swingsOf(action.attacks)) {
    const { step } = swing;
    const ability = stepAbility(step, executables);
    if (ability) {
      // "It can use its Frightful Presence. It then makes three attacks": a save step, taken first when it would
      // do something (someone in range who hasn't already resisted it or been affected) and it can pay for it.
      const first = pickTarget(step.targetGroup ?? 0);
      if (first && attacker.state === "active" && canPayFor(attacker, ability) && saveStepWorthTaking(state, attacker, ability)) {
        spendEmbeddedCost(attacker, ability);
        // Aimed at the target, as when the ability is used on its own: a breath from itself points its cone that way.
        if (ability.kind === "area-save") resolveAreaSaveAction(state, attackerId, first.position, ability.id, { embedded: true });
        else resolveSaveAction(state, attackerId, first.id, ability.id, { embedded: true });
      }
      continue;
    }
    if (step.actionId && !executables.some((candidate) => candidate.id === step.actionId)) {
      skipped(swing, "it no longer has that ability");
      continue;
    }
    if (step.actionId && executables.find((candidate) => candidate.id === step.actionId)?.kind !== "attack") {
      throw new Error(`Multiattack child action ${step.actionId} is not an attack`);
    }
    // A `hit-by-attack` reaction (Hellish Rebuke) can drop the attacker mid-multiattack.
    if (attacker.state !== "active") {
      break;
    }
    if (step.requiresPreviousHit && !previous?.hit) {
      skipped(swing, "the attack before it missed");
      previous = undefined;
      continue;
    }
    const candidates = swingCandidates(step, executables)
      .filter((candidate) => canPayFor(attacker, candidate))
      .filter((candidate) => !weapon || attackFamilyId(candidate, executables) === weapon);
    if (candidates.length === 0) {
      skipped(swing, "nothing it can attack with");
      continue;
    }
    const choice = options.beforeSwing?.({ swing, candidates, previous, targetedIds: [...targetedIds] });
    // The hook may have moved the attacker into an opportunity attack.
    if (attacker.state !== "active") {
      break;
    }
    if (choice?.skip) {
      skipped(swing, "its controller passed");
      continue;
    }

    // Whom: the rule first, then the caller's choice, then the planned spread.
    const find = (id: Id | undefined) => (id ? state.snapshot.combatants.find((combatant) => combatant.id === id) : undefined);
    let target: CombatantState | undefined;
    if (step.target === "same-as-previous" && previous) {
      target = find(previous.targetId);
    } else {
      const explicit = find(choice?.targetId) ?? find(options.attackTargetIds?.[swing.index]);
      target = isLiveTarget(explicit) ? explicit : pickTarget(step.targetGroup ?? 0);
    }
    if (step.target === "different" && target && targetedIds.includes(target.id)) {
      target = targets.find((candidate) => isLiveTarget(candidate) && !targetedIds.includes(candidate.id)
        && candidates.some((attack) => !targetingProblem(state.snapshot, attacker, candidate, attack)));
    }
    if (!isLiveTarget(target)) {
      skipped(swing, step.target === "different" ? "no other creature to attack" : "no target left");
      continue;
    }

    // With what: the caller's choice when it can reach, else whatever of its candidates does.
    const reaching = (candidate: CombatantState) => candidates.filter((attack) => !targetingProblem(state.snapshot, attacker, candidate, attack));
    let usable = reaching(target);
    if (usable.length === 0 && step.target !== "same-as-previous") {
      // Out of this swing's reach (a claw aimed past a 10-ft bite): someone else it does reach instead.
      const other = targets.find((candidate) => candidate !== target && isLiveTarget(candidate)
        && !(step.target === "different" && targetedIds.includes(candidate.id)) && reaching(candidate).length > 0);
      if (other) {
        target = other;
        usable = reaching(other);
      }
    }
    const wanted = usable.find((candidate) => candidate.id === choice?.actionId)
      ?? usable.find((candidate) => candidate.id === options.attackActionIds?.[swing.index]);
    const attack = wanted ?? defaultSwingAttack(step, usable);
    if (!attack) {
      skipped(swing, `${target.displayName} is out of its reach`);
      continue;
    }
    spendEmbeddedCost(attacker, attack);
    const result = resolveAttackCore(state, attacker, target, attackerDefinition, attack, options, false, action);
    attacks.push(result);
    targetedIds.push(target.id);
    previous = { targetId: target.id, actionId: attack.id, hit: result.hit };
    if (action.oneWeapon && !weapon) weapon = attackFamilyId(attack, executables);
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
  } else if (action.mode === "escape") {
    attemptEscape(state, actor);
  } else {
    state.log.push(event(state, "AutomationWarning", `${actor.displayName}'s ${action.mode} action is not automated`, {
      combatantId: actorId, actionId, mode: action.mode
    }));
  }

  state.log.push(event(state, "UtilityActionResolved", `${actor.displayName} took the ${action.name} action`, {
    actorId, actionId, mode: action.mode, actionType: action.actionType
  }));
}

/* ─── Using an ability by hand (Play) ─────────────────────────────────────────── */

/** What a player aims an ability at: creatures, a point, a destination square, or one of its options. */
export interface UseTarget {
  /** Creatures, in order: the target (and any more a spell allows), or one per beam. */
  targetIds?: Id[];
  /** Where an area is centred, or the point a cone or line is aimed at. */
  aim?: Point;
  /** Where a teleport takes its mover. */
  destination?: Point;
  /** Who a teleport moves, when it isn't the user. */
  moverId?: Id;
  /** Which creature to summon, or which form to take. */
  optionId?: Id;
}

/**
 * Use one of `actorId`'s abilities the way a player chose: the same resolver the AI's plan would call for it, aimed
 * where the player aimed it. A multiattack asks for each swing after the first through `askingSwingHook`.
 * Throws (as the resolvers do) when the choice isn't legal.
 */
export function resolveUse(state: EngineState, actorId: Id, actionId: Id, use: UseTarget = {}): void {
  const actor = findCombatant(state.snapshot, actorId);
  const action = findActionDefinition(getDefinition(state.snapshot, actor), actionId);
  if (!action) {
    throw new Error(`${actor.displayName} has no ${actionId}`);
  }
  const ids = use.targetIds ?? [];
  const first = ids[0];
  const needTarget = (): Id => {
    if (!first) throw new Error(`${action.name} needs a target`);
    return first;
  };
  switch (action.kind) {
    case "attack":
      resolveAttack(state, actorId, action.attackDelivery === "beams" ? (ids.length ? ids : [needTarget()]) : needTarget(), actionId);
      return;
    case "multiattack":
      resolveMultiattackAction(state, actorId, [needTarget()], actionId, { beforeSwing: askingSwingHook(state, actorId, actionId, { targetId: needTarget() }) });
      return;
    case "save":
      resolveSaveAction(state, actorId, action.targeting?.target === "self" ? actorId : needTarget(), actionId, { bonusTargetIds: ids.slice(1) });
      return;
    case "area-save":
      if (!use.aim && action.targeting?.origin !== "self") throw new Error(`${action.name} needs a point to aim at`);
      resolveAreaSaveAction(state, actorId, use.aim ?? actor.position, actionId);
      return;
    case "healing":
      if (action.targeting?.target === "chosen" || action.targeting?.target === "area") {
        resolveHealingBurstAction(state, actorId, actionId, ids, use.aim);
      } else {
        resolveHealingAction(state, actorId, action.targeting?.target === "self" ? actorId : needTarget(), actionId);
      }
      return;
    case "buff":
      resolveBuffAction(state, actorId, actionId, action.targeting?.target === "self" || ids.length === 0 ? [actorId] : ids);
      return;
    case "reposition":
      if (!use.destination) throw new Error(`${action.name} needs a destination`);
      resolveRepositionAction(state, actorId, action.targeting?.target === "single" ? use.moverId ?? needTarget() : actorId, use.destination, actionId);
      return;
    case "activate-feature":
      resolveActivateFeatureAction(state, actorId, actionId);
      return;
    case "utility":
      resolveUtilityAction(state, actorId, actionId);
      return;
    case "summon":
      resolveSummonAction(state, actorId, actionId, use.optionId);
      return;
    case "transform":
      resolveTransformAction(state, actorId, actionId, use.optionId ?? BASE_FORM_ID);
      return;
    case "unsupported":
      throw new Error(`${action.name} isn't simulated: use it by hand`);
  }
}

/**
 * The swing-by-swing choices of a multiattack a player is making: the first swing at `first` (what the player aimed
 * the routine at), then a `multiattack-swing` decision before each later one — whom, with what, a move first, or skip.
 * With no answer the routine's own default applies.
 */
export function askingSwingHook(
  state: EngineState,
  attackerId: Id,
  actionId: Id,
  first: { targetId?: Id; actionId?: Id }
): (context: MultiattackSwingContext) => MultiattackSwingChoice | undefined {
  const attacker = findCombatant(state.snapshot, attackerId);
  const executables = getExecutableActions(getDefinition(state.snapshot, attacker));
  const action = executables.find((candidate) => candidate.id === actionId);
  const attackSwings = action?.kind === "multiattack"
    ? swingsOf(action.attacks).filter((swing) => !stepAbility(swing.step, executables)).map((swing) => swing.index)
    : [];
  let calls = 0;
  return (context) => {
    calls += 1;
    if (calls === 1) {
      return { targetId: first.targetId, actionId: first.actionId };
    }
    const answer = askDecision<SwingRequest>(state, {
      kind: "multiattack-swing", attackerId, actionId,
      swing: attackSwings.indexOf(context.swing.index) + 1, of: attackSwings.length,
      candidates: context.candidates.map((candidate) => candidate.id), previous: context.previous, targetedIds: context.targetedIds
    }, attackerId);
    if (!answer) {
      return undefined;
    }
    if (answer.skip) {
      return { skip: true };
    }
    if (answer.moveTo) {
      moveCombatant(state, attackerId, answer.moveTo, { altitude: answer.altitude });
    }
    return { targetId: answer.targetId, actionId: answer.actionId };
  };
}

/**
 * Use an ability the engine doesn't (fully) run, by hand: it takes its slot and its cost and is logged, and the DM
 * applies what it does. Abilities that are only reference text, partly simulated ones, Hide and Help.
 */
export function resolveManualAction(state: EngineState, actorId: Id, actionId: Id, options: { targetIds?: Id[]; note?: string } = {}): void {
  const actor = findCombatant(state.snapshot, actorId);
  const action = findActionDefinition(getDefinition(state.snapshot, actor), actionId);
  if (!action) {
    throw new Error(`${actor.displayName} has no ${actionId}`);
  }
  validateAndSpendAction(actor, action);
  if ("concentration" in action && action.concentration) {
    breakConcentration(state, actorId);
  }
  const targets = (options.targetIds ?? []).map((id) => findCombatant(state.snapshot, id));
  declareAction(state, actor, action, { target: targets[0] });
  const on = targets.length ? ` on ${targets.map((target) => target.displayName).join(", ")}` : "";
  state.log.push(event(state, "ManualActionUsed", `${actor.displayName} uses ${action.name}${on}: resolve it by hand`, {
    actorId, actionId, actionName: action.name, targetIds: options.targetIds ?? [], note: options.note,
    description: "description" in action ? action.description : undefined
  }));
}

/** Movement-budget multiplier from the Dash action (turn flag set by `resolveUtilityAction`). */
export function dashFactor(combatant: CombatantState): number {
  return combatant.turnFlags?.dashed ? 2 : 1;
}

/**
 * How much movement (in grid squares) `combatant` has left this turn — its full
 * per-turn budget (speed, slowed/dashed as applicable) minus whatever `movementUsed`
 * already tracked. Shared by `moveCombatant` and every movement-candidate search so
 * a turn has one real movement pool instead of each caller granting a fresh full move.
 */
export function remainingMovementBudget(snapshot: EncounterSnapshot, combatant: CombatantState): number {
  return Math.max(0, turnMovementBudget(snapshot, combatant) - (combatant.turnFlags?.movementUsed ?? 0));
}

/** A turn's whole movement, in squares: its fastest speed (slowed or Dashed, as it is now), plus any granted this turn. */
export function turnMovementBudget(snapshot: EncounterSnapshot, combatant: CombatantState): number {
  const definition = getDefinition(snapshot, combatant);
  const movementMultiplier = Math.max(1, ...(combatant.conditions ?? []).map((condition) => condition.modifiers?.movementMultiplier ?? 1));
  // Feet off its speed (weapon mastery's Slow): the largest, not their sum.
  const penaltyFt = Math.max(0, ...(combatant.conditions ?? []).map((condition) => condition.modifiers?.speedPenaltyFt ?? 0));
  const speedFt = Math.max(0, movementReference(movementProfileOf(definition)) - penaltyFt);
  const fullBudget = speedFt / snapshot.map.grid.distancePerSquare / movementMultiplier * dashFactor(combatant);
  return fullBudget + (combatant.turnFlags?.bonusMovement ?? 0);
}

/** The condition holding `combatant` where it is (grappled, restrained, paralyzed…), if one is. */
export function heldInPlaceBy(combatant: CombatantState): ConditionInstance | undefined {
  return (combatant.conditions ?? []).find((condition) => (condition.modifiers?.movementMultiplier ?? 1) >= HELD_IN_PLACE);
}

/** A condition that divides speed by this much or more leaves none to speak of (grappled, restrained: 999). */
const HELD_IN_PLACE = 100;

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

/** Everything an attack roll adds to the d20 and is measured against: shared by `resolveAttackCore` and the previews. */
export interface AttackRollInputs {
  advantage: boolean;
  disadvantage: boolean;
  rollMode: AttackRollMode;
  /** Features giving advantage or disadvantage (Pack Tactics). */
  featureAdvantage: { advantage: boolean; disadvantage: boolean; sources: string[] };
  /** Beyond normal range, within long range: disadvantage. */
  longRange: boolean;
  /** The attack's own bonus. */
  attackBonus: number;
  featureAttackBonus: { total: number; sources: string[] };
  /** All of it: what the d20 is added to. */
  totalBonus: number;
  /** The target's AC with cover. */
  targetAc: number;
  cover: { level: CoverLevel; acBonus: number; sources: string[] };
}

/**
 * What `attacker`'s attack roll against `target` adds and must beat, right now: advantage and disadvantage and why,
 * the bonus, and the AC with cover. Pure. `resolveAttackCore` rolls against it after the pre-roll reactions (a Shield
 * raises the AC it reads), and the previews read it to give a chance to hit.
 */
export function attackRollInputs(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number; forcedDisadvantage?: boolean } = {},
  knownCover?: { level: CoverLevel; acBonus: number; sources: string[] }
): AttackRollInputs {
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const targetDefinition = getDefinition(state.snapshot, target);
  const cover = knownCover ?? (options.coverBonus === undefined && action.attackType !== "melee"
    ? coverAgainst(state.snapshot, attacker, target)
    : { level: "none" as const, acBonus: options.coverBonus ?? 0, sources: [] as string[] });
  const featureAdvantage = featureAttackAdvantage(state, attacker, target, action, attackerDefinition);
  // Weapon mastery's Sap (the attacker's next roll) and Vex (the next roll against a creature it vexed).
  const nextAttack = nextAttackConditions(attacker, target);
  for (const { condition } of nextAttack) featureAdvantage.sources.push(condition.sourceName ?? condition.id);
  const longRange = attackIsAtLongRange(state.snapshot, attacker, target, action);
  const advantage = Boolean(options.advantage || featureAdvantage.advantage || nextAttack.some(({ condition }) => condition.nextAttack?.mode === "advantage"));
  const disadvantage = Boolean(options.disadvantage || longRange || options.forcedDisadvantage || featureAdvantage.disadvantage
    || nextAttack.some(({ condition }) => condition.nextAttack?.mode === "disadvantage"));
  const rollMode = attackRollMode({ advantage, disadvantage });
  const attackBonus = resolveAttackBonus(action, attackerDefinition);
  const featureAttackBonus = featureAttackModifier(state, attacker, target, action, attackerDefinition, { rollMode, critical: false });
  const totalBonus = attackBonus + conditionAttackModifier(attacker)
    + conditionIncomingAttackModifier(target) + featureIncomingAttackModifier(state, target, targetDefinition) + featureAttackBonus.total;
  const targetAc = effectiveArmorClass(state, targetDefinition, target) + cover.acBonus;
  return { advantage, disadvantage, rollMode, featureAdvantage, longRange, attackBonus, featureAttackBonus, totalBonus, targetAc, cover };
}

/**
 * The conditions that change this attack roll and are used up by it (weapon mastery's Sap and Vex): the attacker's own
 * "next attack roll", and the target's "next attack roll by this attacker".
 */
function nextAttackConditions(attacker: CombatantState, target: CombatantState): Array<{ bearer: CombatantState; condition: ConditionInstance }> {
  const found: Array<{ bearer: CombatantState; condition: ConditionInstance }> = [];
  for (const condition of attacker.conditions ?? []) {
    if (condition.nextAttack?.role === "made") found.push({ bearer: attacker, condition });
  }
  for (const condition of target.conditions ?? []) {
    if (condition.nextAttack?.role === "against" && condition.nextAttack.by === attacker.id) found.push({ bearer: target, condition });
  }
  return found;
}

/** An attack roll was made: the Sap or Vex it used is spent. */
function spendNextAttackConditions(state: EngineState, attacker: CombatantState, target: CombatantState): void {
  for (const { bearer, condition } of nextAttackConditions(attacker, target)) {
    bearer.conditions = (bearer.conditions ?? []).filter((candidate) => candidate.id !== condition.id);
    state.log.push(event(state, "ConditionExpired", `${bearer.displayName}'s ${condition.sourceName ?? condition.name} is used up`, {
      combatantId: bearer.id, conditionId: condition.id, condition, reason: "next-attack-made"
    }));
  }
}

/**
 * Weapon mastery's Cleave: after a melee hit, once per turn, an attack with the same weapon against a second creature
 * within 5 ft of the first and in reach. Its damage has no positive ability modifier. The second creature is the one
 * likeliest to drop: the fewest hit points left.
 */
function cleaveAfterHit(state: EngineState, attacker: CombatantState, first: CombatantState, attackerDefinition: CreatureDefinition, action: AttackActionDefinition): void {
  const useKey = `${action.id}:cleave`;
  if (wasRiderUsedThisTurn(state, attacker.id, useKey)) return;
  const cleaveAction: AttackActionDefinition = {
    ...action,
    name: `${action.name} (Cleave)`,
    cleave: false,
    damage: action.damage.map((component) => component.abilityModifier && abilityModifier(attackerDefinition.abilities[component.abilityModifier]) > 0
      ? { ...component, abilityModifier: undefined }
      : component)
  };
  const attackerFaction = effectiveFaction(state.snapshot, attacker);
  const second = state.snapshot.combatants
    .filter((candidate) => candidate.id !== first.id && candidate.id !== attacker.id && candidate.state === "active"
      && effectiveFaction(state.snapshot, candidate) !== attackerFaction
      && spatialDistance(state.snapshot, first, candidate) <= 5
      && !targetingProblem(state.snapshot, attacker, candidate, cleaveAction))
    .sort((a, b) => a.currentHp - b.currentHp || a.id.localeCompare(b.id))[0];
  if (!second) return;
  state.log.push(event(state, "RiderApplied", `${attacker.displayName} cleaves into ${second.displayName}`, {
    sourceId: attacker.id, targetId: second.id, actionId: action.id, riderKind: "cleave", riderUseKey: useKey
  }));
  resolveAttackCore(state, attacker, second, attackerDefinition, cleaveAction, { suppressDeclare: true }, false);
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
  options: { advantage?: boolean; disadvantage?: boolean; coverBonus?: number; suppressDeclare?: boolean; slotLevel?: number },
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
  if (spendAction && !parentAction && counterspellWindow(state, attacker, action, { targetIds: [target.id] })) {
    return emptyAttackResult();
  }

  // Pre-roll reactions: Shield raises `target`'s AC (a condition `effectiveArmorClass`
  // reads below); Protection forces the roll to disadvantage.
  runReactionWindow(state, {
    kind: "targeted-by-attack", sourceId: attacker.id, targetId: target.id, attackType: action.attackType, actionId: action.id, actionName: action.name
  });
  const forcedDisadvantage = runReactionWindow(state, {
    kind: "ally-targeted-by-attack", sourceId: attacker.id, targetId: target.id, attackType: action.attackType, actionId: action.id, actionName: action.name
  }).imposedDisadvantage === true;

  const inputs = attackRollInputs(state, attacker, target, action, { ...options, forcedDisadvantage }, cover);
  const { featureAdvantage, longRange, rollMode, attackBonus, featureAttackBonus } = inputs;
  let targetAc = inputs.targetAc;
  const d20 = rollD20(state.rng, { advantage: inputs.advantage, disadvantage: inputs.disadvantage });
  spendNextAttackConditions(state, attacker, target);
  const total = d20.total + inputs.totalBonus;
  const natural = d20.total;
  let critical = natural === 20;
  let hit = critical || (natural !== 1 && total >= targetAc);
  // A DM may overrule the roll (Play): a hit, a critical hit or a miss, whatever the die said.
  const overridden = askDecision<RollRequest>(state, {
    kind: "roll", rollerId: attacker.id, purpose: "attack", natural, total, against: targetAc,
    outcome: critical ? "critical" : hit ? "success" : "failure", targetId: target.id, label: action.name
  }, attacker.id)?.outcome;
  if (overridden) {
    hit = overridden !== "failure";
    critical = overridden === "critical";
  }
  // Adamantine: a critical hit against it is a normal hit.
  const criticalNegatedBy = critical && !overridden
    ? featureSources(targetDefinition, target).find((feature) => (feature.effects ?? []).some((effect) => effect.kind === "no-critical-hits"))?.name
    : undefined;
  if (criticalNegatedBy) critical = false;
  // Shield, Parry: the roll is known and it hits — the target may raise its AC to make it miss. Nothing stops a
  // critical hit, and a DM's ruling on the roll stands.
  let endsAfterAttack: ReactionWindowResult["endsAfterAttack"];
  if (hit && !critical && !overridden) {
    endsAfterAttack = runReactionWindow(state, {
      kind: "would-be-hit", sourceId: attacker.id, targetId: target.id, attackType: action.attackType, actionId: action.id, actionName: action.name,
      attackTotal: total, attackNatural: natural, targetAc
    }).endsAfterAttack;
    const raisedAc = effectiveArmorClass(state, targetDefinition, target) + inputs.cover.acBonus;
    if (raisedAc !== targetAc) {
      targetAc = raisedAc;
      hit = total >= raisedAc;
    }
  }
  const featureDamage = hit
    ? featureDamageEntries(state, attacker, target, action, attackerDefinition, { rollMode, critical })
    : { entries: [], sources: [] };
  const targetHitDamage = hit
    ? targetIncomingHitDamageEntries(state, attacker, target, action, { rollMode, critical })
    : { entries: [], sources: [] };
  const scaling = damageScalingContext(attackerDefinition, action, options.slotLevel ?? spellSlotLevel(action.resourceCost?.resourceId));
  const targetWasUp = target.state === "active";
  const damageApplied = hit
    ? applyDamageEntries(state, target, [
      ...(action.bloodiedDamage && attacker.currentHp <= Math.floor(attackerDefinition.maxHp / 2) ? action.bloodiedDamage : action.damage).map((component, index) => ({
        component, critical, triggerDamageType: firstActionDamageType(action), casterLevel: scaling.casterLevel,
        extraDice: index === 0 ? scaling.upcastDamageDice || undefined : undefined
      })),
      ...featureDamage.entries,
      ...targetHitDamage.entries
    ], attackerDefinition, attacker.id)
    : 0;
  let appliedConditionEffects: string[] = [];
  if (hit) {
    consumeTriggeredConditions(state, target, targetHitDamage.consumedConditionIds ?? []);
    appliedConditionEffects = applyOnHitFeatureConditions(state, attacker, target, action, attackerDefinition, { rollMode, critical });
  }
  if (action.riders?.length) {
    const riderOutcome = applyActionRiders(state, attacker, target, attackerDefinition, action.riders, {
      actionId: action.id, landed: hit, critical, saved: null, origin: attacker.position,
      fallbackDc: defaultSaveDc(attackerDefinition, action.ability),
      concentrating: action.concentration
    });
    appliedConditionEffects = [...appliedConditionEffects, ...riderOutcome.appliedConditions];
  }

  // Post-hit reactions — Hellish Rebuke: `target` retaliates against `attacker`.
  if (hit) {
    runReactionWindow(state, {
      kind: "hit-by-attack", sourceId: attacker.id, targetId: target.id, attackType: action.attackType, actionId: action.id, actionName: action.name,
      attackTotal: total, attackNatural: natural, targetAc, damageTaken: damageApplied
    });
  }

  const coverNote = cover.level !== "none" ? ` (${target.displayName} had ${coverLabel(cover.level)})` : "";
  const overrideNote = overridden ? " (DM override)" : "";
  state.log.push(event(state, "AttackRolled", `${attacker.displayName} ${hit ? "hit" : "missed"} ${target.displayName} with ${action.name}${coverNote}${overrideNote}`, {
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
    ...(criticalNegatedBy ? { criticalNegatedBy } : {}),
    damageApplied,
    ...(overridden ? { overridden } : {})
  }));

  // Rampage: dropping a creature with a melee attack on its own turn unlocks the follow-up bite (and its move).
  if (hit && action.attackType === "melee" && targetWasUp && target.state !== "active"
    && state.snapshot.combatants[state.snapshot.turnIndex]?.id === attacker.id && !attacker.turnFlags?.droppedCreature) {
    const rampage = getExecutableActions(attackerDefinition)
      .find((candidate) => candidate.kind === "attack" && candidate.onlyAfter === "dropped-creature");
    const extraSquares = rampage && rampage.kind === "attack" && rampage.grantsMovementFeet
      ? rampage.grantsMovementFeet / state.snapshot.map.grid.distancePerSquare
      : 0;
    attacker.turnFlags = { ...(attacker.turnFlags ?? {}), droppedCreature: true, bonusMovement: (attacker.turnFlags?.bonusMovement ?? 0) + extraSquares };
  }
  if (hit) applyMeleeRetaliation(state, attacker, target, action);
  if (hit && action.cleave && action.attackType === "melee" && attacker.state === "active") {
    cleaveAfterHit(state, attacker, target, attackerDefinition, action);
  }
  // A Parry's bonus is for this attack only.
  for (const { combatantId, conditionId } of endsAfterAttack ?? []) {
    const bearer = state.snapshot.combatants.find((combatant) => combatant.id === combatantId);
    const condition = bearer?.conditions?.find((candidate) => candidate.id === conditionId);
    if (!bearer || !condition) continue;
    bearer.conditions = bearer.conditions!.filter((candidate) => candidate.id !== conditionId);
    state.log.push(event(state, "ConditionExpired", `${bearer.displayName}'s ${condition.sourceName ?? "reaction"} ends with the attack`, {
      combatantId, conditionId, condition, reason: "triggering-attack-resolved"
    }));
  }

  return { hit, critical, attackRoll: d20, total, targetAc, damageApplied };
}

export function resolveSaveAction(
  state: EngineState,
  attackerId: Id,
  targetId: Id,
  actionId: Id,
  options: { slotLevel?: number; bonusTargetIds?: Id[]; embedded?: boolean } = {}
): SaveResult {
  const attacker = findCombatant(state.snapshot, attackerId);
  const attackerDefinition = getDefinition(state.snapshot, attacker);
  const action = findActionDefinition(attackerDefinition, actionId);
  if (!action || action.kind !== "save") {
    throw new Error(`Save action ${actionId} is not available to ${attacker.displayName}`);
  }
  const target = findCombatant(state.snapshot, action.targeting?.target === "self" ? attackerId : targetId);
  if (action.targeting?.target !== "self") {
    validateTargeting(state.snapshot, attacker, target, action);
  }
  if (!options.embedded) validateAndSpendAction(attacker, action);
  if (action.concentration) {
    breakConcentration(state, attackerId);
  }
  declareAction(state, attacker, action, { target });
  if (isImmuneAfterSave(attacker, target, action)) {
    state.log.push(event(state, "ConditionResisted", `${target.displayName} is immune to ${attacker.displayName}'s ${action.name}`, { attackerId, targetId: target.id, actionId }));
    return { success: true, saveRoll: { expression: "immune", rolls: [], modifier: 0, total: 0 }, total: 0, dc: 0, damageApplied: 0 };
  }
  if (counterspellWindow(state, attacker, action, { targetIds: [target.id, ...(options.bonusTargetIds ?? []).filter((id) => id !== target.id)] })) {
    return { success: true, saveRoll: { expression: "countered", rolls: [], modifier: 0, total: 0 }, total: 0, dc: 0, damageApplied: 0 };
  }

  const scaling = damageScalingContext(attackerDefinition, action, options.slotLevel ?? spellSlotLevel(action.resourceCost?.resourceId));
  const dc = resolveSaveDc(action, attackerDefinition, attacker);
  const result = resolveSaveAgainstTarget(state, attacker, attackerDefinition, action, target, scaling, dc, actionId);

  // Upcast-granted bonus targets (Hold Person-style): same save/DC/riders, no extra resource spend.
  for (const bonusId of options.bonusTargetIds ?? []) {
    if (bonusId === target.id) continue;
    const bonusTarget = findCombatant(state.snapshot, bonusId);
    if (bonusTarget.state !== "active" && bonusTarget.state !== "downed") continue;
    resolveSaveAgainstTarget(state, attacker, attackerDefinition, action, bonusTarget, scaling, dc, actionId);
  }

  return result;
}

function resolveSaveAgainstTarget(
  state: EngineState,
  attacker: CombatantState,
  attackerDefinition: CreatureDefinition,
  action: SaveActionDefinition,
  target: CombatantState,
  scaling: DamageScalingContext,
  dc: number,
  actionId: Id
): SaveResult {
  const targetDefinition = getDefinition(state.snapshot, target);
  const cover = action.saveAbility === "dex" ? coverAgainst(state.snapshot, attacker, target) : null;
  const coverSaveBonus = cover?.acBonus ?? 0;
  const save = rollSavingThrow(state, target, actionSaveContext(action, dc, coverSaveBonus));
  const { roll: saveRoll, success, featureBonus: featureSaveBonus, featureAdvantage: featureSaveAdvantage } = save;
  if (success) recordSavedAgainst(attacker, target, action);
  const onSuccess = resolveOnSuccess(action);
  const outcome = saveDamageOutcome(state, target, action.saveAbility, onSuccess, success);
  const dealsDamage = outcome.dealsDamage;
  const damageApplied = dealsDamage
    ? applyDamageComponents(state, target, action.damage, attackerDefinition, false, {
      halve: outcome.halve,
      casterLevel: scaling.casterLevel,
      extraDiceOnFirst: scaling.upcastDamageDice
    }, attacker.id)
    : 0;

  if (!(success && onSuccess === "negates")) {
    applyActionRiders(state, attacker, target, attackerDefinition, action.riders, {
      actionId, landed: true, saved: success, saveAbility: action.saveAbility, fallbackDc: dc,
      concentrating: action.concentration, origin: attacker.position
    });
  }

  state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${action.saveAbility.toUpperCase()} save against ${action.name}`, {
    attackerId: attacker.id,
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
  options: { slotLevel?: number; embedded?: boolean } = {}
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
  if (!options.embedded) validateAndSpendAction(attacker, action);
  if (action.concentration) {
    breakConcentration(state, attackerId);
  }
  declareAction(state, attacker, action, { origin, aimVector });
  const declaredIds = areaSaveTargets(state.snapshot, attacker, action, placement).map(({ target }) => target.id);
  if (counterspellWindow(state, attacker, action, { targetIds: declaredIds, origin, aimVector })) {
    state.log.push(event(state, "AreaSaveResolved", `${attacker.displayName}'s ${action.name} was countered`, {
      attackerId, actionId, origin, aim, targets: []
    }));
    return { targets: [] };
  }

  const dc = resolveSaveDc(action, attackerDefinition, attacker);

  // A persistent zone spell (Insect Plague, Web) usually only settles onto the
  // board — it doesn't also blast everyone standing there at cast time, unlike
  // an instant area-save. `applyOnCast` opts a zone spell into doing both.
  if (action.zone && !action.zone.applyOnCast) {
    createZone(state, attacker, action, origin, dc);
    state.log.push(event(state, "AreaSaveResolved", `${attacker.displayName} settles ${action.name} at (${origin.x}, ${origin.y})`, {
      attackerId, actionId, origin, aim, targets: []
    }));
    return { targets: [] };
  }

  const scaling = damageScalingContext(attackerDefinition, action, options.slotLevel ?? spellSlotLevel(action.resourceCost?.resourceId));
  const onSuccess = resolveOnSuccess(action);
  const caught = areaSaveTargets(state.snapshot, attacker, action, placement);
  const affected = caught.map(({ target }) => target);
  const areaCoverFor = (target: CombatantState) => caught.find((entry) => entry.target === target)?.cover ?? null;

  // 5e: roll the blast's damage once — every creature takes the same numbers,
  // differing only by resistance / vulnerability and whether they saved.
  const blastRoll = action.damage.length
    ? rollAreaDamage(state, action.damage, attackerDefinition, {
      casterLevel: scaling.casterLevel,
      extraDiceOnFirst: scaling.upcastDamageDice
    })
    : [];

  const targets = affected.map((target) => {
    const targetDefinition = getDefinition(state.snapshot, target);
    const cover = areaCoverFor(target);
    const coverSaveBonus = action.saveAbility === "dex" ? (cover?.dexSaveBonus ?? 0) : 0;
    const save = rollSavingThrow(state, target, actionSaveContext(action, dc, coverSaveBonus));
    const { roll: saveRoll, success, featureBonus: featureSaveBonus, featureAdvantage: featureSaveAdvantage } = save;
    if (success) recordSavedAgainst(attacker, target, action);
    const outcome = saveDamageOutcome(state, target, action.saveAbility, onSuccess, success);
    const dealsDamage = outcome.dealsDamage;
    const damageApplied = dealsDamage && blastRoll.length
      ? applyRolledAreaDamage(state, target, blastRoll, outcome.halve, attacker.id)
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
  if (action.zone?.applyOnCast) {
    createZone(state, attacker, action, origin, dc);
  }
  return { targets };
}

/**
 * Who an area save catches with its template at `placement`, and the cover each has from its origin: everyone in it of
 * the sides it affects, never the caster of a template that comes from it, nobody behind total cover from the origin
 * (when line of effect is enforced), and nobody who has already made its save (Frightful Presence). Shared by
 * `resolveAreaSaveAction` and the previews. Pure.
 */
export function areaSaveTargets(
  snapshot: EncounterSnapshot,
  attacker: CombatantState,
  action: AreaSaveActionDefinition,
  placement: { origin: Point; aimVector?: { x: number; y: number }; fromSelf: boolean }
): Array<{ target: CombatantState; cover: CoverResult | null }> {
  const definitionsById = new Map(snapshot.definitions.map((definition) => [definition.id, definition]));
  const coverFor = (target: CombatantState) => snapshot.rules.cover
    ? coverBetween(
      snapshot.map,
      placement.origin,
      1,
      target.position,
      sizeFootprint(getDefinition(snapshot, target).size),
      { blockers: coverBlockersFor(snapshot, attacker.id, target.id) }
    )
    : null;
  return combatantsInArea(snapshot.map, placement.origin, action.area, snapshot.combatants, definitionsById, placement.aimVector)
    .filter((target) => action.affects === "all" || effectiveFaction(snapshot, target) !== effectiveFaction(snapshot, attacker))
    // A self-origin template (cone / line / burst centred on the caster) emanates
    // *from* the caster — it never catches them, even when `affects: "all"`.
    .filter((target) => !(placement.fromSelf && target.id === attacker.id))
    .map((target) => ({ target, cover: coverFor(target) }))
    // Total cover from the blast origin shields a target entirely (when line of effect is enforced).
    .filter(({ cover }) => !(snapshot.rules.requireLineOfEffect && cover?.blocksTargeting))
    // Someone who already made the save against this action is immune to it (Frightful Presence).
    .filter(({ target }) => !isImmuneAfterSave(attacker, target, action));
}

/** The saving throw a save or area-save action calls for (`dc` resolved, a Dexterity save's cover bonus given). Shared with the previews. */
export function actionSaveContext(action: SaveActionDefinition | AreaSaveActionDefinition, dc: number, coverSaveBonus = 0): SaveContext {
  return {
    ability: action.saveAbility, dc, kind: action.kind === "save" ? "action" : "area", sourceAction: saveSourceOf(action),
    conditions: conditionsOfRiders(action.riders), expectedDamage: expectedFailureDamage(action), situationalBonus: coverSaveBonus,
    label: action.name
  };
}

/** A Dexterity save's cover bonus against a single-target save action from `attacker` (none for other abilities). */
export function saveActionCoverBonus(snapshot: EncounterSnapshot, attacker: CombatantState, target: CombatantState, action: SaveActionDefinition): number {
  return action.saveAbility === "dex" ? coverAgainst(snapshot, attacker, target).acBonus : 0;
}

const savedKey = (attackerId: Id, action: { id: Id }) => `${attackerId}:${action.id}`;

/** Whether `target` already made the save against this `immuneAfterSave` action from `attacker`. */
export function isImmuneAfterSave(attacker: { id: Id }, target: CombatantState, action: { id: Id; immuneAfterSave?: boolean }): boolean {
  return action.immuneAfterSave === true && (target.savedAgainst ?? []).includes(savedKey(attacker.id, action));
}

function recordSavedAgainst(attacker: { id: Id }, target: CombatantState, action: { id: Id; immuneAfterSave?: boolean }): void {
  if (action.immuneAfterSave !== true) return;
  const key = savedKey(attacker.id, action);
  if (!(target.savedAgainst ?? []).includes(key)) target.savedAgainst = [...(target.savedAgainst ?? []), key];
}

function normalizeVector(vector: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(vector.x, vector.y);
  return length === 0 ? { x: 1, y: 0 } : { x: vector.x / length, y: vector.y / length };
}

/** A creature's own footprint-centred origin — shared by self-targeted area templates (`resolveAreaTargeting`) and self-anchored zone recentering (`recenterSelfAnchoredZones`). */
function selfOriginFor(position: Point, footprint: number): Point {
  return {
    x: Math.floor(position.x + (footprint - 1) / 2),
    y: Math.floor(position.y + (footprint - 1) / 2)
  };
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
  action: { targeting?: AreaTargeting },
  aim: Point
): { origin: Point; aimVector?: { x: number; y: number }; fromSelf: boolean } {
  const selfOrigin = selfOriginFor(attacker.position, sizeFootprint(attackerDefinition.size));
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
  actionId: Id,
  options: { slotLevel?: number } = {}
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
  if (counterspellWindow(state, healer, action, { targetIds: [target.id] })) {
    return { healingApplied: 0 };
  }

  const slotLevel = options.slotLevel ?? spellSlotLevel(action.resourceCost?.resourceId);
  const slotsAboveBase = slotLevel != null && action.spellLevel != null ? Math.max(0, slotLevel - action.spellLevel) : 0;
  const perSlotDice = action.upcast?.perSlotAboveBase?.damageDice;
  const upcastDice = slotsAboveBase > 0 && perSlotDice ? repeatDice(perSlotDice, slotsAboveBase) : "";

  let healingApplied = 0;
  const rolls = action.healing.map((component, index) => {
    const abilityBonus = component.abilityModifier ? abilityModifier(healerDefinition.abilities[component.abilityModifier]) : 0;
    const dice = index === 0 && upcastDice ? `${component.dice}+${upcastDice}` : component.dice;
    const roll = rollDice(withBonus(dice, abilityBonus), state.rng);
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

/**
 * Instantly moves `targetId` (or the actor, in `"self"` mode) to `destination`
 * — Misty Step, Dimension Door. Deliberately does not call `moveCombatant`:
 * no pathfinding, no movement budget, no per-step opportunity-attack scan or
 * zone movement damage (those price *walking through* squares, which a
 * teleport never does). Still runs the same "you've arrived" side effects a
 * normal step would (on-enter zone/terrain triggers, self-anchored zone
 * recentering) since those model standing in a place, not the act of
 * traveling there.
 */
export function resolveRepositionAction(
  state: EngineState,
  actorId: Id,
  targetId: Id,
  destination: Point,
  actionId: Id
): RepositionResult {
  const actor = findCombatant(state.snapshot, actorId);
  const actorDefinition = getDefinition(state.snapshot, actor);
  const action = findActionDefinition(actorDefinition, actionId);
  if (!action || action.kind !== "reposition") {
    throw new Error(`Reposition action ${actionId} is not available to ${actor.displayName}`);
  }
  const isSelf = action.targeting?.target !== "single";
  const mover = findCombatant(state.snapshot, isSelf ? actorId : targetId);
  validateRepositionTargeting(state.snapshot, actor, mover, destination, action);
  validateAndSpendAction(actor, action);
  declareAction(state, actor, action, { target: isSelf ? undefined : mover, origin: destination });
  if (counterspellWindow(state, actor, action, { targetIds: [mover.id], origin: destination })) {
    return { moved: false };
  }

  const from = { ...mover.position };
  mover.position = { ...destination };
  for (const inside of state.snapshot.combatants) if (inside.containedBy === mover.id) inside.position = { ...destination };
  state.log.push(event(state, "CombatantMoved", `${mover.displayName} teleports away`, {
    combatantId: mover.id,
    from,
    destination,
    cells: [from, destination],
    teleport: true,
    actionId,
    casterId: actor.id
  }));

  checkZoneOnEnter(state, mover, [from, destination]);
  checkTerrainHazardOnEnter(state, mover, [from, destination]);
  recenterSelfAnchoredZones(state, mover);

  return { moved: true, from, to: destination };
}

export function validateRepositionTargeting(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  mover: CombatantState,
  destination: Point,
  action: RepositionActionDefinition
): void {
  if (mover.state !== "active") {
    throw new Error(`${mover.displayName} cannot be repositioned`);
  }
  const moverDistance = spatialDistance(snapshot, actor, mover);
  if (moverDistance > action.range) {
    throw new Error(`${mover.displayName} is ${moverDistance} ft. away, beyond ${action.range} ft. range`);
  }
  const destinationDistance = spatialDistanceToPoint(snapshot, actor, destination);
  if (destinationDistance > action.range) {
    throw new Error(`Destination is ${destinationDistance} ft. away, beyond ${action.range} ft. range`);
  }
  const moverDefinition = getDefinition(snapshot, mover);
  const footprint = sizeFootprint(moverDefinition.size);
  if (!isFootprintLegal(snapshot.map, destination, footprint, occupiedCells(snapshot, mover.id))) {
    throw new Error("Destination is occupied or impassable");
  }
  if (action.requiresLineOfEffect && snapshot.rules.requireLineOfEffect
    && !lineOfEffect(snapshot.map, actor.position, destination)) {
    throw new Error("Line of effect to destination is blocked");
  }
}

/**
 * Grants a beneficial condition (and optional temp HP) to one or more
 * willing allies — Bless, Shield of Faith. `targetIds` is caller-resolved
 * (the AI selector picks them; there's no manual targeting UI in this app)
 * — `"self"` mode ignores it, `"single"` uses the first id, `"chosen"` takes
 * up to `targeting.count` of them. No save: unlike `applyConditionRider`
 * (adversarial, on-hit/on-save-fail gated), this mirrors
 * `applyFeatureActivationCondition`'s simpler duration handling — a willing
 * target has nothing to resist.
 */
export function resolveBuffAction(
  state: EngineState,
  actorId: Id,
  actionId: Id,
  targetIds: Id[]
): BuffResult {
  const actor = findCombatant(state.snapshot, actorId);
  const actorDefinition = getDefinition(state.snapshot, actor);
  const action = findActionDefinition(actorDefinition, actionId);
  if (!action || action.kind !== "buff") {
    throw new Error(`Buff action ${actionId} is not available to ${actor.displayName}`);
  }
  const mode = action.targeting?.target ?? "single";
  const resolvedIds = mode === "self"
    ? [actorId]
    : mode === "chosen"
      ? targetIds.slice(0, chosenTargetCount(action) ?? targetIds.length)
      : [targetIds[0] as Id];
  const targets = resolvedIds.map((id) => findCombatant(state.snapshot, id));
  for (const target of targets) {
    if (target.id !== actorId) {
      validateBuffTargeting(state.snapshot, actor, target, action);
    } else if (action.targeting?.notSelf) {
      throw new Error(notSelfProblem(actor, action));
    }
  }

  validateAndSpendAction(actor, action);
  if (action.concentration) {
    breakConcentration(state, actorId);
  }
  declareAction(state, actor, action, { target: mode === "self" ? undefined : targets[0] });
  if (counterspellWindow(state, actor, action, { targetIds: targets.map((target) => target.id) })) {
    return { targetIds: [] };
  }

  // Rolled once for the whole cast, applied identically to every target — same
  // "roll once, reuse per target" convention `resolveAreaSaveAction` uses for
  // its blast damage.
  let tempHpAmount = 0;
  for (const component of action.tempHp ?? []) {
    const abilityBonus = component.abilityModifier ? abilityModifier(actorDefinition.abilities[component.abilityModifier]) : 0;
    tempHpAmount += rollDice(withBonus(component.dice, abilityBonus), state.rng).total;
  }

  const conditionId = action.appliedCondition.id ?? upcastBaseId(action.id);
  for (const target of targets) {
    const instance: ConditionInstance = {
      id: conditionId,
      name: action.appliedCondition.name ?? "custom",
      sourceId: action.id,
      sourceName: action.name,
      sourceCombatantId: actorId,
      startedRound: state.snapshot.round,
      expiresAt: action.appliedCondition.durationRounds
        ? { round: state.snapshot.round + action.appliedCondition.durationRounds, turnIndex: state.snapshot.turnIndex, timing: "end" }
        : undefined,
      modifiers: action.appliedCondition.modifiers,
      effects: action.appliedCondition.effects,
      concentration: action.concentration || undefined
    };
    if (!applyCondition(state, target.id, instance)) {
      continue; // an immune target never gets it, so it doesn't hold the caster's concentration either
    }
    // Mirrors `applyConditionRider`'s own link-up — `breakConcentration` sweeps
    // every combatant's conditions by `sourceCombatantId` + `concentration`,
    // so one link on the caster tears down the condition on every target.
    if (instance.concentration) {
      actor.concentration = { sourceConditionId: actor.concentration?.sourceConditionId ?? conditionId };
    }
    if (tempHpAmount > 0) {
      target.tempHp = Math.max(target.tempHp, tempHpAmount);
      state.log.push(event(state, "FeatureEffectApplied", `${target.displayName} gains ${tempHpAmount} temporary hit points`, {
        targetId: target.id, actionId, amount: tempHpAmount, tempHp: target.tempHp
      }));
    }
  }

  return { targetIds: targets.map((target) => target.id), tempHpApplied: tempHpAmount || undefined };
}

export function validateBuffTargeting(
  snapshot: EncounterSnapshot,
  actor: CombatantState,
  target: CombatantState,
  action: BuffActionDefinition
): void {
  if (action.targeting?.notSelf && target.id === actor.id) {
    throw new Error(notSelfProblem(actor, action));
  }
  if (target.state !== "active") {
    throw new Error(`${target.displayName} cannot be buffed`);
  }
  const distance = spatialDistance(snapshot, actor, target);
  if (distance > action.range) {
    throw new Error(`${target.displayName} is ${distance} ft. away, beyond ${action.range} ft. range`);
  }
  if (snapshot.rules.requireLineOfEffect && !lineOfEffect(snapshot.map, actor.position, target.position)) {
    throw new Error("Line of effect is blocked");
  }
}

/**
 * Heals several targets at once — Prayer of Healing (`"chosen"`), Mass Cure
 * Wounds (`"area"`). Deliberately a separate resolver from
 * `resolveHealingAction`, not a widened version of it: `HealingPlan`/
 * `resolveHealingAction` are consumed by the `BonusPick`/joint-turn-planning
 * system as a strictly single-target shape — branching that resolver
 * internally would force every one of those call sites to handle a plural
 * result. `targetIds`/`aim` is caller-resolved, same reasoning as
 * `resolveBuffAction`.
 */
export function resolveHealingBurstAction(
  state: EngineState,
  healerId: Id,
  actionId: Id,
  targetIds: Id[],
  aim?: Point
): HealingBurstResult {
  const healer = findCombatant(state.snapshot, healerId);
  const healerDefinition = getDefinition(state.snapshot, healer);
  const action = findActionDefinition(healerDefinition, actionId);
  if (!action || action.kind !== "healing") {
    throw new Error(`Healing action ${actionId} is not available to ${healer.displayName}`);
  }
  const mode = action.targeting?.target;
  if (mode !== "chosen" && mode !== "area") {
    throw new Error(`${action.name} is not a multi-target healing action`);
  }

  let targets: CombatantState[];
  let origin: Point | undefined;
  if (mode === "chosen") {
    targets = targetIds.slice(0, chosenTargetCount(action) ?? targetIds.length).map((id) => findCombatant(state.snapshot, id));
    for (const target of targets) {
      validateHealingTargeting(state.snapshot, healer, target, action);
    }
  } else {
    if (!action.area || !aim) {
      throw new Error(`${action.name} has no area to place`);
    }
    const placement = resolveAreaTargeting(healer, healerDefinition, { targeting: action.areaTargeting }, aim);
    origin = placement.origin;
    if (!placement.fromSelf) {
      const distance = spatialDistanceToPoint(state.snapshot, healer, origin);
      if (distance > (action.areaTargeting?.range ?? action.range)) {
        throw new Error(`Origin is ${distance} ft. away, beyond range`);
      }
      if (state.snapshot.rules.requireLineOfEffect && !lineOfEffect(state.snapshot.map, healer.position, origin)) {
        throw new Error("Line of effect to area origin is blocked");
      }
    }
    const definitionsById = new Map(state.snapshot.definitions.map((definition) => [definition.id, definition]));
    targets = combatantsInArea(
      state.snapshot.map, origin, action.area, state.snapshot.combatants, definitionsById, placement.aimVector,
      { includeDowned: true }
    ).filter((target) => effectiveFaction(state.snapshot, target) === effectiveFaction(state.snapshot, healer));
  }

  validateAndSpendAction(healer, action);
  declareAction(state, healer, action, origin ? { origin } : { target: targets[0] });
  if (counterspellWindow(state, healer, action, { targetIds: targets.map((target) => target.id), ...(origin ? { origin } : {}) })) {
    return { healingApplied: 0, targetIds: [] };
  }

  // Rolled once for the whole cast — 5e RAW for both Prayer of Healing and
  // Mass Cure Wounds, and matches `resolveAreaSaveAction`'s own roll-once
  // convention for its blast damage.
  let healingApplied = 0;
  const rolls = action.healing.map((component) => {
    const abilityBonus = component.abilityModifier ? abilityModifier(healerDefinition.abilities[component.abilityModifier]) : 0;
    const roll = rollDice(withBonus(component.dice, abilityBonus), state.rng);
    healingApplied += roll.total;
    return roll;
  });

  for (const target of targets) {
    const targetDefinition = getDefinition(state.snapshot, target);
    target.currentHp = Math.min(targetDefinition.maxHp, target.currentHp + healingApplied);
    if (target.currentHp > 0 && (target.state === "downed" || target.state === "defeated")) {
      target.state = "active";
      target.deathSaves = { successes: 0, failures: 0, stable: false };
      target.conditions = (target.conditions ?? []).filter((condition) => condition.name !== "unconscious");
    }
    state.log.push(event(state, "HealingApplied", `${target.displayName} regained ${healingApplied} HP`, {
      healerId, targetId: target.id, actionId, rolls, healingApplied, currentHp: target.currentHp
    }));
    applyActionRiders(state, healer, target, healerDefinition, action.riders, {
      actionId, landed: true, saved: null,
      fallbackDc: 8 + (healerDefinition.proficiencyBonus ?? proficiencyFromDefinition(healerDefinition)),
      origin: healer.position
    });
  }

  return { healingApplied, targetIds: targets.map((target) => target.id) };
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
  // A self-contained activation (its own `condition` buff, or a reaction whose
  // effect is the window result — Shield, Counterspell) needs no feature record.
  if (!feature && !action.condition && !action.reaction) {
    state.log.push(event(state, "AutomationWarning", `${actor.displayName} activated an unknown feature`, {
      combatantId: actorId,
      actionId,
      featureId: action.featureId
    }));
  }

  // Action Surge & friends: an `extra-action` effect hands back a spent slot;
  // `resource-regain` with `timing: "on-activate"` tops up a named pool.
  for (const effect of feature?.effects ?? []) {
    if (effect.kind === "extra-action" && featureConditionsMetForSelf(actorDefinition, actor, effect)) {
      actor.actionEconomy ??= { action: true, bonus: true, reaction: true };
      actor.actionEconomy[effect.slot] = true;
      state.log.push(event(state, "ActionEconomyRefreshed", `${actor.displayName} regained a ${effect.slot} from ${feature?.name ?? action.name}`, {
        combatantId: actorId, actionId, featureId: feature?.id, slot: effect.slot
      }));
    }
    if (effect.kind === "resource-regain" && effect.timing === "on-activate") {
      const previous = actor.resources?.[effect.resourceId] ?? 0;
      const next = Math.min(effect.max ?? Number.POSITIVE_INFINITY, previous + resolveNumericFormula(effect.amount, actorDefinition));
      actor.resources = { ...(actor.resources ?? {}), [effect.resourceId]: next };
      state.log.push(event(state, "FeatureEffectApplied", `${actor.displayName} regained ${effect.resourceId}`, {
        combatantId: actorId, actionId, featureId: feature?.id, effect, previous, next
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
  // A DM may overrule it (Play): one success or one failure, without a natural 20's or 1's extra effect.
  const overridden = askDecision<RollRequest>(state, {
    kind: "roll", rollerId: combatant.id, purpose: "death-save", natural, total: natural, against: 10,
    outcome: natural >= 10 ? "success" : "failure", label: "Death save"
  }, combatant.id)?.outcome;
  if (overridden) {
    if (overridden === "failure") combatant.deathSaves.failures += 1;
    else combatant.deathSaves.successes += 1;
  } else if (natural === 20) {
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
    resolveDeathEffect(state, combatantId);
  } else if (combatant.deathSaves.successes >= 3) {
    combatant.deathSaves.stable = true;
    state.log.push(event(state, "CombatantStabilized", `${combatant.displayName} stabilized`, { combatantId }));
  }

  state.log.push(event(state, "DeathSaveRolled", `${combatant.displayName} rolled a death save${overridden ? " (DM override)" : ""}`, {
    combatantId,
    roll,
    deathSaves: combatant.deathSaves,
    state: combatant.state,
    ...(overridden ? { overridden } : {})
  }));

  return {
    roll,
    successes: combatant.deathSaves.successes,
    failures: combatant.deathSaves.failures,
    stable: combatant.deathSaves.stable,
    died: combatant.state === "dead"
  };
}

const ALL_DAMAGE_TYPES: DamageType[] = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];

/**
 * Whether a creature can't be given this condition at all (its `conditionImmunities`). Being dominated is a
 * form of being charmed, so a creature immune to charm is immune to domination too. `custom` conditions
 * (labelled by their rider) are matched by that label, which callers pass as `name`.
 */
export function isImmuneToCondition(definition: CreatureDefinition, name: ConditionName | string): boolean {
  const immunities = definition.conditionImmunities;
  if (!immunities?.length) {
    return false;
  }
  const label = String(name).toLowerCase();
  return (immunities as string[]).includes(label) || (label === "dominated" && (immunities as string[]).includes("charmed"));
}

/**
 * Gives a combatant a condition — unless it is immune, in which case nothing lands and a `ConditionResisted`
 * event says so. Returns whether the condition was applied. The DM's manual apply passes `force` (a
 * DM's word beats a creature's immunity).
 */
/** Conditions that leave a flying creature unable to stay up: knocked prone, or speed 0 / unable to move. */
const GROUNDING_CONDITIONS = new Set(["prone", "restrained", "grappled", "paralyzed", "stunned", "unconscious", "petrified"]);

/**
 * A fall: 1d6 bludgeoning per 10 ft (up to 20d6), landing prone. `feet` is the drop, whether from flying height or a
 * ledge. The creature is back on the ground before the damage and the prone condition are applied, so neither can
 * start a second fall.
 */
export function fallCombatant(state: EngineState, combatant: CombatantState, feet: number, why: string): void {
  if (feet <= 0 || combatant.state === "fled") return;
  const fromAltitude = combatant.altitude ?? 0;
  combatant.altitude = undefined;
  const dice = Math.min(20, Math.floor(feet / 10));
  state.log.push(event(state, "CombatantFell", `${combatant.displayName} falls ${feet} ft (${why})`, {
    combatantId: combatant.id, feet, fromAltitude, damageDice: dice > 0 ? `${dice}d6` : undefined
  }));
  if (combatant.state === "defeated" || combatant.state === "dead") return;
  if (dice > 0) {
    applyDamageComponents(state, combatant, [{ dice: `${dice}d6`, damageType: "bludgeoning" }], getDefinition(state.snapshot, combatant), false, {}, combatant.id);
  }
  if (combatant.state === "active" || combatant.state === "downed") {
    applyCondition(state, combatant.id, { id: `${combatant.id}-fall-prone-${state.log.length}`, name: "prone", startedRound: state.snapshot.round, modifiers: defaultConditionModifiers("prone") });
  }
}

export function applyCondition(state: EngineState, targetId: Id, condition: ConditionInstance, options: { force?: boolean } = {}): boolean {
  const target = findCombatant(state.snapshot, targetId);
  if (!options.force && isImmuneToCondition(getDefinition(state.snapshot, target), condition.name)) {
    logConditionResisted(state, target, condition.name);
    return false;
  }
  target.conditions = [
    ...(target.conditions ?? []).filter((existing) => existing.id !== condition.id),
    condition
  ];
  state.log.push(event(state, "ConditionApplied", `${target.displayName} gained ${condition.name}`, {
    targetId,
    condition
  }));
  // A flier that can no longer move (or is knocked prone) drops, unless it can hover.
  if ((target.altitude ?? 0) > 0 && GROUNDING_CONDITIONS.has(condition.name) && !movementProfileOf(getDefinition(state.snapshot, target)).hover) {
    fallCombatant(state, target, target.altitude ?? 0, `it is ${condition.name}`);
  }
  return true;
}

function logConditionResisted(state: EngineState, target: CombatantState, name: string): void {
  state.log.push(event(state, "ConditionResisted", `${target.displayName} is immune to ${name}`, {
    targetId: target.id,
    condition: name
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

/* ─── Persistent zones ────────────────────────────────────────────────────────
 * A standing `ActiveZone` created from an `AreaSaveActionDefinition.zone`
 * (Insect Plague, Web) — reuses the action's own damage / save / riders for
 * each trigger firing instead of a bespoke effect shape. See `ZonePersistence`.
 */

/**
 * Resolve a spell's `zone` config into a live `ActiveZone` and log
 * `ZoneCreated`. Links the caster's concentration directly — a zone has no
 * condition rider of its own to carry that link the way `applyConditionRider` does.
 */
function createZone(
  state: EngineState,
  source: CombatantState,
  action: AreaSaveActionDefinition,
  origin: Point,
  dc: number
): void {
  const zone = action.zone;
  if (!zone) {
    return;
  }
  const concentration = zone.duration.kind === "concentration";
  const expiresAtRound = zone.duration.kind === "rounds"
    ? state.snapshot.round + Math.max(0, zone.duration.rounds)
    : undefined;
  const instance: ActiveZone = {
    id: `zone-${action.id}-${source.id}-${state.log.length}`,
    name: action.name,
    sourceCombatantId: source.id,
    sourceActionId: action.id,
    origin,
    area: action.area,
    anchor: zone.anchor,
    affects: action.affects,
    trigger: zone.trigger,
    movement: zone.movement,
    repositionable: zone.repositionable,
    movementDamage: zone.movementDamage,
    terrain: zone.terrain,
    blocksSight: zone.blocksSight,
    saveAbility: action.saveAbility,
    dc,
    damage: action.damage.length ? action.damage : undefined,
    onSuccess: resolveOnSuccess(action),
    riders: action.riders,
    concentration,
    expiresAtRound,
    createdRound: state.snapshot.round,
    color: zone.color
  };
  state.snapshot.activeZones = [...(state.snapshot.activeZones ?? []), instance];
  if (concentration) {
    source.concentration = { sourceConditionId: source.concentration?.sourceConditionId };
  }
  state.log.push(event(state, "ZoneCreated", `${source.displayName}'s ${action.name} settles at (${origin.x}, ${origin.y})`, {
    zone: instance
  }));
}

/** Shared shape between `ActiveZone` and a terrain tile's `hazard` — whatever `applySaveGatedEffect` needs to roll a save and apply damage/riders, independent of where those fields actually live. */
interface SaveGatedEffectSpec {
  name: string;
  /** Combatant this effect is attributed to, for definition lookups (spell mod, resistances) and rider "source". Omitted for terrain hazards — the environment has no caster, so the target stands in as its own source. */
  sourceId?: Id;
  /** Rider gating/log attribution key. Zones use `sourceActionId`; terrain hazards have no action, so callers pass the tile's own id. */
  actionId: Id;
  saveAbility?: Ability;
  dc?: number;
  damage?: DamageComponent[];
  onSuccess?: "half" | "none" | "negates";
  riders?: ActionRider[];
  concentration?: boolean;
  origin?: Point;
  /** Which `SaveRolled` log flag to set, purely for downstream log filtering/attribution. */
  via: "zone" | "terrain";
}

/**
 * Roll `target`'s save against `spec` (if it has one), apply damage — halved
 * on a successful "half" save, skipped entirely on "none"/"negates" — and
 * riders — skipped on a successful "negates" save. Shared by `applyZoneEffect`
 * (spell/hazard zones) and `applyTerrainHazardEffect` (acid/lava/... tiles):
 * the two differ only in what "source" means (a caster vs. the environment)
 * and how they dedupe repeat triggers, which callers handle themselves.
 */
function applySaveGatedEffect(state: EngineState, spec: SaveGatedEffectSpec, target: CombatantState): void {
  const source = (spec.sourceId ? state.snapshot.combatants.find((combatant) => combatant.id === spec.sourceId) : undefined) ?? target;
  const sourceDefinition = getDefinition(state.snapshot, source);
  const targetDefinition = getDefinition(state.snapshot, target);

  let success: boolean | null = null;
  let dealsDamage = true;
  let halve = false;
  if (spec.saveAbility && spec.dc != null) {
    const save = rollSavingThrow(state, target, {
      ability: spec.saveAbility, dc: spec.dc, kind: spec.via === "terrain" ? "terrain" : "zone",
      // A zone is a spell's lingering effect, so Magic Resistance applies; a terrain hazard has no caster.
      sourceAction: spec.via === "zone" ? saveSourceOf(findActionDefinition(sourceDefinition, spec.actionId)) : undefined,
      conditions: conditionsOfRiders(spec.riders)
    });
    const { roll: saveRoll, featureBonus: featureSaveBonus, featureAdvantage: featureSaveAdvantage } = save;
    success = save.success;
    ({ dealsDamage, halve } = saveDamageOutcome(state, target, spec.saveAbility, spec.onSuccess, success));
    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${spec.saveAbility.toUpperCase()} save against ${spec.name}`, {
      attackerId: source.id,
      targetId: target.id,
      actionId: spec.actionId,
      saveRoll,
      total: saveRoll.total,
      dc: spec.dc,
      featureSaveBonus: featureSaveBonus.total,
      appliedSaveEffects: [...featureSaveBonus.sources, ...featureSaveAdvantage.sources],
      success,
      viaZone: spec.via === "zone",
      viaTerrain: spec.via === "terrain"
    }));
  }

  if (dealsDamage && spec.damage?.length) {
    applyDamageComponents(state, target, spec.damage, sourceDefinition, false, { halve }, source.id);
  }
  if (!(success && spec.onSuccess === "negates")) {
    applyActionRiders(state, source, target, sourceDefinition, spec.riders, {
      actionId: spec.actionId,
      landed: true,
      saved: success,
      saveAbility: spec.saveAbility,
      fallbackDc: spec.dc ?? 10,
      concentrating: spec.concentration,
      origin: spec.origin
    });
  }
}

/**
 * Re-apply an `ActiveZone`'s save/damage/riders to one combatant currently in
 * it. Dedupes on `zone.appliedRounds` so a combatant that both enters and
 * starts its turn in the same zone the same round is only hit once (5e:
 * "when it enters the area or starts its turn there").
 */
function applyZoneEffect(state: EngineState, zone: ActiveZone, target: CombatantState): void {
  if (target.state !== "active" || zone.appliedRounds?.[target.id] === state.snapshot.round) {
    return;
  }
  const source = state.snapshot.combatants.find((combatant) => combatant.id === zone.sourceCombatantId) ?? target;
  if (zone.affects === "hostile" && effectiveFaction(state.snapshot, source) === effectiveFaction(state.snapshot, target)) {
    return;
  }
  applySaveGatedEffect(state, {
    name: zone.name,
    sourceId: zone.sourceCombatantId,
    actionId: zone.sourceActionId,
    saveAbility: zone.saveAbility,
    dc: zone.dc,
    damage: zone.damage,
    onSuccess: zone.onSuccess,
    riders: zone.riders,
    concentration: zone.concentration,
    origin: zone.origin,
    via: "zone"
  }, target);
  zone.appliedRounds = { ...(zone.appliedRounds ?? {}), [target.id]: state.snapshot.round };
}

/**
 * Re-apply a terrain tile's `hazard` save/damage/riders to one combatant
 * standing in or entering it. Dedupes on `tile.hazardAppliedRounds`, the
 * terrain equivalent of `zone.appliedRounds`. Unlike zones, a hazard tile has
 * no caster and no faction filter — acid and lava burn everyone who steps in
 * them, so `applySaveGatedEffect` gets no `sourceId` (the target stands in as
 * its own "source" for definition lookups).
 */
function applyTerrainHazardEffect(state: EngineState, tile: TerrainZone, target: CombatantState): void {
  const hazard = tile.hazard;
  if (!hazard || target.state !== "active" || tile.hazardAppliedRounds?.[target.id] === state.snapshot.round) {
    return;
  }
  applySaveGatedEffect(state, {
    name: tile.name,
    actionId: tile.id,
    saveAbility: hazard.saveAbility,
    dc: hazard.dc,
    damage: hazard.damage,
    onSuccess: hazard.onSuccess,
    riders: hazard.riders,
    via: "terrain"
  }, target);
  tile.hazardAppliedRounds = { ...(tile.hazardAppliedRounds ?? {}), [target.id]: state.snapshot.round };
}

/**
 * `on-enter` zones for cells a combatant just moved through. Checks every
 * step of the path (skipping the starting cell — that's where they already
 * were, not somewhere they just entered), not just the final position, so a
 * creature that passes through a zone without stopping in it still triggers
 * the zone once. Called from `moveCombatant` after the move lands.
 */
function checkZoneOnEnter(state: EngineState, combatant: CombatantState, cells: Point[]): void {
  const zones = state.snapshot.activeZones;
  if (!zones?.length || combatant.state !== "active" || cells.length < 2) {
    return;
  }
  const distancePerSquare = state.snapshot.map.grid.distancePerSquare;
  for (const zone of zones) {
    if (!zone.trigger.includes("on-enter")) {
      continue;
    }
    const entered = cells.slice(1).some((cell) => cellIntersectsArea(cell, zone.origin, zone.area, distancePerSquare));
    if (entered) {
      applyZoneEffect(state, zone, combatant);
    }
  }
}

/**
 * `on-enter` hazard terrain tiles for cells a combatant just moved through —
 * same "skip the starting cell, check every step" rule as `checkZoneOnEnter`
 * (a creature that passes through a hazard tile without stopping still
 * triggers it once). Called from `moveCombatant` alongside `checkZoneOnEnter`.
 */
function checkTerrainHazardOnEnter(state: EngineState, combatant: CombatantState, cells: Point[]): void {
  const terrain = state.snapshot.map.terrain;
  if (!terrain.length || combatant.state !== "active" || cells.length < 2) {
    return;
  }
  const appliedTileIds = new Set<Id>();
  for (const cell of cells.slice(1)) {
    const tile = terrainAtCell(terrain, cell);
    if (tile?.hazard?.trigger.includes("on-enter") && !appliedTileIds.has(tile.id)) {
      appliedTileIds.add(tile.id);
      applyTerrainHazardEffect(state, tile, combatant);
    }
  }
}

/**
 * `start-of-turn-in-zone` / `end-of-turn-in-zone` hazard terrain for the
 * combatant whose turn boundary this is — the terrain equivalent of
 * `applyZoneTriggers`. Call alongside it in the turn loop.
 */
export function applyTerrainHazardTriggers(state: EngineState, combatantId: Id, timing: "turn-start" | "turn-end"): void {
  const combatant = state.snapshot.combatants.find((candidate) => candidate.id === combatantId);
  if (!combatant || combatant.state !== "active") {
    return;
  }
  // A creature that flies passes over acid, lava and ice rather than standing in it.
  if (movementProfileOf(getDefinition(state.snapshot, combatant)).fly) {
    return;
  }
  const tile = terrainAtCell(state.snapshot.map.terrain, combatant.position);
  const trigger: ZoneTrigger = timing === "turn-start" ? "start-of-turn-in-zone" : "end-of-turn-in-zone";
  if (tile?.hazard?.trigger.includes(trigger)) {
    applyTerrainHazardEffect(state, tile, combatant);
  }
}

/**
 * Re-center every `anchor: "self"` zone `combatant` sources on their latest
 * position (Spirit Guardians-style) and sweep it for newly-covered targets.
 * Called from `moveCombatant` right after `checkZoneOnEnter`, which handles
 * the opposite direction (the mover's own path against zones that haven't
 * moved) — this handles the zone itself moving over everyone else.
 */
function recenterSelfAnchoredZones(state: EngineState, combatant: CombatantState): void {
  const zones = state.snapshot.activeZones;
  if (!zones?.length) {
    return;
  }
  const footprint = sizeFootprint(getDefinition(state.snapshot, combatant).size);
  const newOrigin = selfOriginFor(combatant.position, footprint);
  for (const zone of zones) {
    if (zone.sourceCombatantId !== combatant.id || zone.anchor !== "self") {
      continue;
    }
    zone.origin = newOrigin;
    sweepSelfAnchoredZoneOnMove(state, zone);
  }
}

/**
 * A self-anchored zone sweeping over other combatants as its source moves
 * counts as those combatants being entered by the zone (5e: spirits sweeping
 * into a creature's space damage it), not just them walking into it — so
 * this re-checks every other combatant against the zone's new position
 * rather than relying on their own (unchanged) path. `applyZoneEffect`'s
 * existing `appliedRounds` dedup keeps this from double-hitting a target
 * that was already covered before this move.
 */
function sweepSelfAnchoredZoneOnMove(state: EngineState, zone: ActiveZone): void {
  if (!zone.trigger.includes("on-enter")) {
    return;
  }
  const definitionsById = new Map(state.snapshot.definitions.map((definition) => [definition.id, definition]));
  const others = state.snapshot.combatants.filter((candidate) => candidate.id !== zone.sourceCombatantId);
  for (const target of combatantsInArea(state.snapshot.map, zone.origin, zone.area, others, definitionsById)) {
    applyZoneEffect(state, zone, target);
  }
}

/**
 * `start-of-turn-in-zone` / `end-of-turn-in-zone` zones for the combatant
 * whose turn boundary this is. Call alongside `expireConditions` /
 * `applyTimedFeatureEffects` in the turn loop.
 */
export function applyZoneTriggers(state: EngineState, combatantId: Id, timing: "turn-start" | "turn-end"): void {
  const combatant = state.snapshot.combatants.find((candidate) => candidate.id === combatantId);
  const zones = state.snapshot.activeZones;
  if (!combatant || combatant.state !== "active" || !zones?.length) {
    return;
  }
  const trigger: ZoneTrigger = timing === "turn-start" ? "start-of-turn-in-zone" : "end-of-turn-in-zone";
  const definitionsById = new Map(state.snapshot.definitions.map((definition) => [definition.id, definition]));
  for (const zone of zones) {
    if (!zone.trigger.includes(trigger)) {
      continue;
    }
    if (combatantsInArea(state.snapshot.map, zone.origin, zone.area, [combatant], definitionsById).length > 0) {
      applyZoneEffect(state, zone, combatant);
    }
  }
}

/**
 * Expire round-limited zones at the round boundary. Concentration zones are
 * torn down by `breakConcentration` instead; permanent zones never expire
 * here. Call alongside `admitReinforcements` when a new round starts.
 */
export function tickZones(state: EngineState): void {
  const zones = state.snapshot.activeZones;
  if (!zones?.length) {
    return;
  }
  const remaining = zones.filter((zone) => {
    const expired = zone.expiresAtRound != null && state.snapshot.round >= zone.expiresAtRound;
    if (expired) {
      state.log.push(event(state, "ZoneExpired", `${zone.name} fades away`, { zone, concentrationEnded: false }));
    }
    return !expired;
  });
  state.snapshot.activeZones = remaining;
}

/**
 * Cloudkill-style automatic drift: any zone sourced by `casterId` with a
 * `movement` config steps `driftFeetPerCasterTurn` directly away from the
 * caster's current position. Call at the start of the caster's own turn —
 * unrelated to `applyZoneTriggers`, which fires per-combatant on *their* own
 * turn boundary. A zone sitting exactly on the caster (no direction to drift
 * away from) falls back to due east, matching `normalizeVector`'s convention
 * for a zero-length vector elsewhere in this file.
 */
export function driftZones(state: EngineState, casterId: Id): void {
  const zones = state.snapshot.activeZones;
  if (!zones?.length) {
    return;
  }
  const caster = state.snapshot.combatants.find((combatant) => combatant.id === casterId);
  if (!caster) {
    return;
  }
  const distancePerSquare = state.snapshot.map.grid.distancePerSquare;
  for (const zone of zones) {
    if (zone.sourceCombatantId !== casterId || !zone.movement) {
      continue;
    }
    const direction = normalizeVector({ x: zone.origin.x - caster.position.x, y: zone.origin.y - caster.position.y });
    const stepSquares = zone.movement.driftFeetPerCasterTurn / distancePerSquare;
    zone.origin = { x: zone.origin.x + direction.x * stepSquares, y: zone.origin.y + direction.y * stepSquares };
    state.log.push(event(state, "ZoneMoved", `${zone.name} drifts`, { zone }));
  }
}

/**
 * Moonbeam-style caster-directed reposition: move `zoneId` (must be sourced
 * by `casterId`, and carry `repositionable`) to `destination`, capped at
 * `maxFeetPerCasterTurn` from its current origin. Spends the caster's bonus
 * action — matches Moonbeam; see `ZoneReposition`. Called both by the AI
 * (`maybeRepositionZone` in simulation.ts) and available for a manual/player
 * driver to call directly.
 */
export function repositionZone(state: EngineState, casterId: Id, zoneId: Id, destination: Point): void {
  const caster = findCombatant(state.snapshot, casterId);
  const zone = state.snapshot.activeZones?.find((candidate) => candidate.id === zoneId);
  if (!zone || zone.sourceCombatantId !== casterId || !zone.repositionable) {
    throw new Error(`${caster.displayName} has no repositionable zone ${zoneId}`);
  }
  caster.actionEconomy ??= { action: true, bonus: true, reaction: true };
  if (!canAct(caster, "bonus") || caster.actionEconomy.bonus === false) {
    throw new Error(`${caster.displayName} has no bonus action to move ${zone.name}`);
  }
  const distancePerSquare = state.snapshot.map.grid.distancePerSquare;
  const stepSquares = Math.hypot(destination.x - zone.origin.x, destination.y - zone.origin.y);
  const maxSquares = zone.repositionable.maxFeetPerCasterTurn / distancePerSquare;
  if (stepSquares > maxSquares + 1e-6) {
    throw new Error(`${zone.name} can only move ${zone.repositionable.maxFeetPerCasterTurn} ft`);
  }
  caster.actionEconomy.bonus = false;
  zone.origin = destination;
  state.log.push(event(state, "ZoneMoved", `${caster.displayName} moves ${zone.name}`, { zone }));
}

/** The hidden pool an action's `usage` spends from; actions sharing a `poolId` share it. */
export function usagePoolId(action: { id: string; usage?: ActionUsage }): string {
  return `usage:${action.usage?.poolId ?? action.id}`;
}

/**
 * 5e "Recharge N–6": at the start of its turn a creature rolls a die for each spent recharge ability and
 * regains it on N or higher. The pool is the same resource the action spends, so nothing else needs to know.
 */
export function rollRecharges(state: EngineState, actor: CombatantState): void {
  const definition = getDefinition(state.snapshot, actor);
  const seen = new Set<string>();
  for (const action of getExecutableActions(definition)) {
    const usage = "usage" in action ? action.usage : undefined;
    if (usage?.kind !== "recharge" || !usage.recharge) continue;
    const poolId = usagePoolId(action as { id: string; usage?: ActionUsage });
    if (seen.has(poolId) || (actor.resources?.[poolId] ?? 0) >= 1) continue;
    seen.add(poolId);
    const die = usage.recharge.die ?? 6;
    const roll = rollDice(`1d${die}`, state.rng);
    const overridden = askDecision<RollRequest>(state, {
      kind: "roll", rollerId: actor.id, purpose: "recharge", natural: roll.total, total: roll.total, against: usage.recharge.min,
      outcome: roll.total >= usage.recharge.min ? "success" : "failure", label: action.name
    }, actor.id)?.outcome;
    const recharged = overridden ? overridden !== "failure" : roll.total >= usage.recharge.min;
    if (recharged) {
      actor.resources = { ...(actor.resources ?? {}), [poolId]: 1 };
    }
    state.log.push(event(state, "AbilityRecharged", `${actor.displayName} ${recharged ? "recharged" : "failed to recharge"} ${action.name} (rolled ${roll.total}, needs ${usage.recharge.min}+${overridden ? ", DM override" : ""})`, {
      combatantId: actor.id, actionId: action.id, resourceId: poolId, roll: roll.total, min: usage.recharge.min, recharged, ...(overridden ? { overridden } : {})
    }));
  }
}

/* ─── Holds: grapples ──────────────────────────────────────────────────────── */

const SIZE_ORDER: SizeCategory[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

/** The conditions that make up one creature's grapple on `victim`. */
function holdConditions(victim: CombatantState, holderId?: Id): ConditionInstance[] {
  return (victim.conditions ?? []).filter((condition) => condition.hold && (holderId === undefined || condition.sourceCombatantId === holderId));
}

/** Everything a holder can reach out to grip with: its longest melee reach (at least 5 ft). */
function holdReach(definition: CreatureDefinition): number {
  return Math.max(5, ...getExecutableActions(definition).map((action) => action.kind === "attack" && action.attackType === "melee" ? action.reach ?? action.range : 0));
}

/**
 * Apply a `hold` rider: the target is grappled (and restrained, when the rider says so) by `holder`, if it is
 * small enough and the holder still has a free grip. Returns whether anything was applied.
 */
function applyHold(
  state: EngineState,
  holder: CombatantState,
  target: CombatantState,
  targetDefinition: CreatureDefinition,
  rider: Extract<ActionRider, { kind: "hold" }>,
  actionId: Id
): boolean {
  if (rider.maxSize && SIZE_ORDER.indexOf(targetDefinition.size) > SIZE_ORDER.indexOf(rider.maxSize)) return false;
  if (holdConditions(target, holder.id).some((condition) => condition.sourceId === actionId)) return false;
  const held = state.snapshot.combatants.filter((candidate) =>
    holdConditions(candidate, holder.id).some((condition) => condition.sourceId === actionId && condition.name === "grappled")).length;
  if (held >= (rider.limit ?? 1)) return false;
  const base = { sourceId: actionId, sourceCombatantId: holder.id, startedRound: state.snapshot.round, hold: { escapeDc: rider.escapeDc, recurringDamage: rider.recurringDamage } };
  const grappled = applyCondition(state, target.id, { ...base, id: `${target.id}:${actionId}:hold`, name: "grappled", modifiers: defaultConditionModifiers("grappled") });
  if (!grappled) return false;
  if (rider.restrained) {
    applyCondition(state, target.id, {
      ...base, id: `${target.id}:${actionId}:hold-restrained`, name: "restrained",
      modifiers: { ...defaultConditionModifiers("restrained"), incomingAttackRoll: 5 }
    });
  }
  state.log.push(event(state, "HoldApplied", `${holder.displayName} grapples ${target.displayName}${rider.restrained ? " (restrained)" : ""} (escape DC ${rider.escapeDc})`, {
    holderId: holder.id, targetId: target.id, actionId, escapeDc: rider.escapeDc, restrained: rider.restrained === true
  }));
  return true;
}

/** Frees `victim` from one holder's grip (every condition that grip caused). */
function releaseHold(state: EngineState, victim: CombatantState, holderId: Id | undefined, actionId: Id | undefined, why: string): void {
  const freed = (victim.conditions ?? []).filter((condition) => condition.hold && condition.sourceCombatantId === holderId && condition.sourceId === actionId);
  if (freed.length === 0) return;
  victim.conditions = (victim.conditions ?? []).filter((condition) => !freed.includes(condition));
  for (const condition of freed) {
    state.log.push(event(state, "ConditionExpired", `${victim.displayName} is no longer ${condition.name} (${why})`, { combatantId: victim.id, condition, viaHold: true }));
  }
}

/** Everyone a defeated / incapacitated holder was gripping is let go. */
export function releaseHoldsBy(state: EngineState, holderId: Id, onlyVictimId?: Id): void {
  for (const victim of state.snapshot.combatants) {
    if (onlyVictimId && victim.id !== onlyVictimId) continue;
    for (const condition of holdConditions(victim, holderId)) releaseHold(state, victim, holderId, condition.sourceId, "the holder let go");
  }
}

/**
 * At the start of a held creature's turn: a grip that can no longer be kept (holder down, incapacitated or out of
 * reach) lets go; the ones that remain deal their recurring damage.
 */
function runHoldsAtTurnStart(state: EngineState, actor: CombatantState): void {
  for (const condition of [...holdConditions(actor)]) {
    const holder = state.snapshot.combatants.find((candidate) => candidate.id === condition.sourceCombatantId);
    const holderDefinition = holder ? getDefinition(state.snapshot, holder) : undefined;
    const keeps = holder && holderDefinition && holder.state === "active" && canAct(holder, "free")
      && spatialDistance(state.snapshot, holder, actor) <= holdReach(holderDefinition) + state.snapshot.map.grid.distancePerSquare;
    if (!keeps) {
      releaseHold(state, actor, condition.sourceCombatantId, condition.sourceId, "the hold was broken");
      continue;
    }
    if (condition.name === "grappled" && condition.hold?.recurringDamage?.length) {
      applyDamageComponents(state, actor, condition.hold.recurringDamage, holderDefinition, false, {}, holder.id);
    }
  }
}

/** The bonus for an Athletics (Str) or Acrobatics (Dex) check: whichever is better. */
function escapeBonus(definition: CreatureDefinition): number {
  const skill = (name: string) => Object.entries(definition.skills ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
  return Math.max(skill("athletics") ?? abilityModifier(definition.abilities.str), skill("acrobatics") ?? abilityModifier(definition.abilities.dex));
}

/** Chance that `combatant` breaks free of the easiest grip it is in with one check, or 0 if it isn't held. */
export function escapeChance(definition: CreatureDefinition, combatant: CombatantState): number {
  const dcs = holdConditions(combatant).map((condition) => condition.hold!.escapeDc);
  if (dcs.length === 0) return 0;
  return Math.min(0.95, Math.max(0.05, (21 - (Math.min(...dcs) - escapeBonus(definition))) / 20));
}

/** Spend the action to break free: an Athletics / Acrobatics check against the easiest grip's escape DC. */
function attemptEscape(state: EngineState, actor: CombatantState): void {
  const holds = holdConditions(actor).filter((condition) => condition.name === "grappled");
  if (holds.length === 0) return;
  const target = holds.reduce((easiest, condition) => (condition.hold!.escapeDc < easiest.hold!.escapeDc ? condition : easiest));
  const definition = getDefinition(state.snapshot, actor);
  const roll = rollDice(withBonus("1d20", escapeBonus(definition)), state.rng);
  const overridden = askDecision<RollRequest>(state, {
    kind: "roll", rollerId: actor.id, purpose: "check", natural: roll.total - roll.modifier, total: roll.total, against: target.hold!.escapeDc,
    outcome: roll.total >= target.hold!.escapeDc ? "success" : "failure", label: "Escape a grapple"
  }, actor.id)?.outcome;
  const success = overridden ? overridden !== "failure" : roll.total >= target.hold!.escapeDc;
  state.log.push(event(state, "EscapeAttempted", `${actor.displayName} ${success ? "breaks free" : "fails to break free"} (rolled ${roll.total} vs DC ${target.hold!.escapeDc}${overridden ? ", DM override" : ""})`, {
    combatantId: actor.id, roll, dc: target.hold!.escapeDc, success, ...(overridden ? { overridden } : {})
  }));
  if (success) releaseHold(state, actor, target.sourceCombatantId, target.sourceId, "escaped");
}

/* ─── Holds: swallowing ────────────────────────────────────────────────────── */

const SWALLOW_SOURCE = "swallowed";

/** A free cell as close to `origin` as possible for a creature of this footprint (spiralling out), or `origin` itself. */
function nearestFreeCell(state: EngineState, origin: Point, footprint: number, ignoreId: Id): Point {
  const occupied = state.snapshot.combatants
    .filter((candidate) => candidate.id !== ignoreId && candidate.state !== "defeated" && !candidate.containedBy)
    .flatMap((candidate) => footprintCells(candidate.position, sizeFootprint(getDefinition(state.snapshot, candidate).size)));
  for (let radius = 1; radius <= 6; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const cell = { x: origin.x + dx, y: origin.y + dy };
        if (isFootprintLegal(state.snapshot.map, cell, footprint, occupied)) return cell;
      }
    }
  }
  return origin;
}

/** Swallows `target` if it fits, isn't saved against and (when required) is already held. */
function applySwallow(
  state: EngineState,
  holder: CombatantState,
  target: CombatantState,
  targetDefinition: CreatureDefinition,
  rider: Extract<ActionRider, { kind: "swallow" }>,
  actionId: Id
): boolean {
  if (target.containedBy) return false;
  if (rider.maxSize && SIZE_ORDER.indexOf(targetDefinition.size) > SIZE_ORDER.indexOf(rider.maxSize)) return false;
  if (rider.requiresHeld && holdConditions(target, holder.id).length === 0) return false;
  const inside = state.snapshot.combatants.filter((candidate) => candidate.containedBy === holder.id).length;
  if (inside >= (rider.capacity ?? 1)) return false;
  if (rider.save) {
    const save = rollSavingThrow(state, target, { ability: rider.save.ability, dc: rider.save.dc, kind: "rider" });
    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${rider.save.ability.toUpperCase()} save against being swallowed`, {
      attackerId: holder.id, targetId: target.id, actionId, saveRoll: save.roll, total: save.roll.total, dc: rider.save.dc, success: save.success, viaRider: true
    }));
    if (save.success) return false;
  }
  releaseHoldsBy(state, holder.id, target.id);
  target.containedBy = holder.id;
  target.containment = { damage: rider.damage, regurgitate: rider.regurgitate };
  target.position = { ...holder.position };
  for (const name of ["blinded", "restrained"] as const) {
    applyCondition(state, target.id, {
      id: `${target.id}:${actionId}:swallowed-${name}`, name, sourceId: SWALLOW_SOURCE, sourceCombatantId: holder.id,
      startedRound: state.snapshot.round, modifiers: defaultConditionModifiers(name)
    }, { force: true });
  }
  state.log.push(event(state, "Swallowed", `${holder.displayName} swallows ${target.displayName}`, { holderId: holder.id, targetId: target.id, actionId }));
  return true;
}

/** Spits one swallowed creature out, prone, next to the swallower. */
function expel(state: EngineState, holder: CombatantState, inside: CombatantState, why: string): void {
  inside.containedBy = undefined;
  inside.containment = undefined;
  inside.conditions = (inside.conditions ?? []).filter((condition) => !(condition.sourceId === SWALLOW_SOURCE && condition.sourceCombatantId === holder.id));
  inside.position = nearestFreeCell(state, holder.position, sizeFootprint(getDefinition(state.snapshot, inside).size), inside.id);
  if (inside.state !== "defeated") {
    applyCondition(state, inside.id, { id: `${inside.id}:expelled-prone`, name: "prone", startedRound: state.snapshot.round, modifiers: defaultConditionModifiers("prone") }, { force: true });
  }
  state.log.push(event(state, "Regurgitated", `${inside.displayName} is expelled by ${holder.displayName} (${why})`, { holderId: holder.id, targetId: inside.id, position: inside.position }));
}

function expelAll(state: EngineState, holder: CombatantState, why: string): void {
  for (const inside of state.snapshot.combatants) if (inside.containedBy === holder.id) expel(state, holder, inside, why);
}

/** At the start of the swallower's turn: a fresh damage count, and the acid (or whatever) inside hurts. */
function runContainmentAtTurnStart(state: EngineState, holder: CombatantState): void {
  holder.insideDamage = undefined;
  const holderDefinition = getDefinition(state.snapshot, holder);
  for (const inside of state.snapshot.combatants.filter((candidate) => candidate.containedBy === holder.id)) {
    if (inside.containment?.damage?.length) applyDamageComponents(state, inside, inside.containment.damage, holderDefinition, false, {}, holder.id);
  }
}

/** Ochre Jelly / Black Pudding: taking damage of one of its trigger types splits it, if it's still big enough. */
const splitCapableCache = new WeakMap<CreatureDefinition, boolean>();

function checkSplit(state: EngineState, target: CombatantState, damageTypes: DamageType[]): void {
  if (target.state !== "active" || damageTypes.length === 0) return;
  const definition = getDefinition(state.snapshot, target);
  // Runs on every instance of damage, so bail cheaply for the 99% of creatures that can't split.
  let capable = splitCapableCache.get(definition);
  if (capable === undefined) {
    capable = simulatedFeatures(definition).some((feature) => feature.effects?.some((effect) => effect.kind === "split-on-damage"));
    splitCapableCache.set(definition, capable);
  }
  if (!capable) return;
  for (const feature of featureSources(definition, target)) {
    const effect = (feature.effects ?? []).find((candidate): candidate is Extract<FeatureEffect, { kind: "split-on-damage" }> =>
      candidate.kind === "split-on-damage" && candidate.triggerDamageTypes.some((type) => damageTypes.includes(type)));
    if (!effect || target.currentHp < effect.minHp) continue;
    const half = Math.floor(target.currentHp / 2);
    if (half < 1) return;
    const footprint = sizeFootprint(definition.size);
    const cell = nearestFreeCell(state, target.position, footprint, target.id);
    const copy: CombatantState = {
      id: `combatant-split-${target.id}-${state.snapshot.round}-${state.log.length}`,
      definitionId: target.definitionId,
      displayName: `${target.displayName} (split)`,
      faction: target.faction,
      position: cell,
      currentHp: half,
      tempHp: 0,
      state: "active",
      tacticsProfile: target.tacticsProfile,
      resourceStance: target.resourceStance,
      resources: target.resources ? { ...target.resources } : undefined
    };
    target.currentHp = half;
    const { insertIndex } = insertIntoTurnOrder(state, [copy]);
    state.log.push(event(state, "CombatantSplit", `${target.displayName} splits into two`, {
      originalId: target.id, originalHp: target.currentHp, copy, insertIndex
    }));
    return;
  }
}

/** Damage dealt to a swallower by something inside it adds up; past the threshold it must save or spit them out. */
function checkRegurgitation(state: EngineState, holder: CombatantState, sourceId: Id | undefined, dealt: number): void {
  const source = state.snapshot.combatants.find((candidate) => candidate.id === sourceId);
  const rule = source?.containedBy === holder.id ? source.containment?.regurgitate : undefined;
  if (!rule) return;
  holder.insideDamage = (holder.insideDamage ?? 0) + dealt;
  if (holder.insideDamage < rule.damage) return;
  holder.insideDamage = undefined;
  const save = rollSavingThrow(state, holder, { ability: "con", dc: rule.dc, kind: "feature" });
  state.log.push(event(state, "SaveRolled", `${holder.displayName} rolled a CON save against regurgitating`, {
    targetId: holder.id, saveRoll: save.roll, total: save.roll.total, dc: rule.dc, success: save.success
  }));
  if (!save.success) expelAll(state, holder, "regurgitated");
}

/** A legendary creature's points come back at the start of its own turn (and start the fight full). */
export function refillLegendaryPoints(state: EngineState, actor: CombatantState): void {
  const legendary = getDefinition(state.snapshot, actor).legendary;
  if (legendary) actor.resources = { ...(actor.resources ?? {}), [LEGENDARY_POINTS]: legendary.pool };
}

/**
 * A creature that starts its turn prone gets up, which costs half its movement (5e) — unless it can't move at all
 * (grappled, restrained). Riders that knock a creature prone only "until the start of its next turn" have already
 * expired by now; this is for the ones with no end of their own (a fall, a charge, being spat out).
 */
function standUpFromProne(state: EngineState, actor: CombatantState): void {
  if (actor.state !== "active" || !(actor.conditions ?? []).some((condition) => condition.name === "prone")) return;
  if ((actor.conditions ?? []).some((condition) => (condition.modifiers?.movementMultiplier ?? 1) >= 999)) return;
  const half = remainingMovementBudget(state.snapshot, actor) / 2;
  actor.conditions = (actor.conditions ?? []).filter((condition) => condition.name !== "prone");
  actor.turnFlags = { ...(actor.turnFlags ?? {}), movementUsed: (actor.turnFlags?.movementUsed ?? 0) + half };
  state.log.push(event(state, "ConditionExpired", `${actor.displayName} stands up (half its movement)`, {
    combatantId: actor.id, condition: { name: "prone" }, reason: "stood-up"
  }));
}

/**
 * Everything that happens at the start of `actor`'s turn, before an AI (or a
 * manual driver) picks an action: refresh their own action economy first,
 * then anything that reacts to conditions/effects already on them, then
 * anything that reacts to where they're standing (zone triggers), then
 * anything that moves because their turn started (zone drift). Only call
 * this for an actor already confirmed `state === "active"` — callers are
 * responsible for handling downed/reserve combatants separately (death
 * saves, admitting reinforcements, etc.) before reaching this.
 *
 * Called only by the turn sequencer (`openNextTurn`, turns.ts), which Auto Run,
 * Step and Play share. Auto Run and Step used to hand-roll this sequence
 * separately, and their orderings drifted (Step reset the action economy *last*).
 */
export function runTurnStart(state: EngineState, actor: CombatantState): void {
  resetActionEconomy(actor);
  rollRecharges(state, actor);
  applyRegeneration(state, actor);
  refillLegendaryPoints(state, actor);
  runHoldsAtTurnStart(state, actor);
  runContainmentAtTurnStart(state, actor);
  expireConditions(state, "start");
  standUpFromProne(state, actor);
  applyTimedFeatureEffects(state, actor.id, "turn-start");
  applyEmanations(state, actor);
  runRepeatedSaves(state, actor.id, "turn-start");
  applyZoneTriggers(state, actor.id, "turn-start");
  applyTerrainHazardTriggers(state, actor.id, "turn-start");
  driftZones(state, actor.id);
}

/**
 * Everything that happens at the end of `actorId`'s turn. Called by `finishTurn`, which only the turn sequencer's
 * `closeTurn` calls — see `runTurnStart`.
 */
export function runTurnEnd(state: EngineState, actorId: Id): void {
  applyTimedFeatureEffects(state, actorId, "turn-end");
  runRepeatedSaves(state, actorId, "turn-end");
  applyZoneTriggers(state, actorId, "turn-end");
  applyTerrainHazardTriggers(state, actorId, "turn-end");
  expireConditions(state, "end");
}

export function activeFactions(snapshot: EncounterSnapshot): Set<string> {
  return new Set(
    snapshot.combatants
      .filter((combatant) => combatant.state === "active" && combatant.currentHp > 0
        // A scheduled reinforcement keeps its faction "in the fight" until it
        // arrives, so combat doesn't end in the empty rounds before it shows up.
        || combatant.state === "reserve"
        || (combatant.state === "downed" && combatant.downedRegen === true)
        || (snapshot.rules.playerDeathSaves
          && combatant.faction === "party"
          && combatant.state === "downed"
          && !combatant.deathSaves?.stable))
      .map((combatant) => combatant.faction)
  );
}

/**
 * Flip every `"reserve"` combatant whose `arrivesRound` has been reached to
 * `"active"` — a scheduled reinforcement entering the fight. Call at the start of
 * each round (after `round` is incremented), before turns are taken. Returns the
 * combatants that just arrived.
 */
export function admitReinforcements(state: EngineState): CombatantState[] {
  const arrived: CombatantState[] = [];
  for (const combatant of state.snapshot.combatants) {
    if (combatant.state !== "reserve") {
      continue;
    }
    const at = typeof combatant.arrivesRound === "number" ? combatant.arrivesRound : 1;
    if (state.snapshot.round >= at) {
      combatant.state = "active";
      combatant.actionEconomy = undefined;
      combatant.turnFlags = undefined;
      arrived.push(combatant);
      state.log.push(event(state, "ReinforcementArrived", `${combatant.displayName} arrives`, {
        combatantId: combatant.id,
        faction: combatant.faction,
        round: state.snapshot.round
      }));
    }
  }
  return arrived;
}

/**
 * Adds `newCombatants` to the fight mid-encounter (a summon, a split) — rolls one shared initiative for the whole
 * batch (5e: conjured creatures act as a group on one roll) and splices them into their correctly sorted turn-order
 * position, which either lands later this round or, if it's at or before whoever is currently acting, next round:
 *
 * - If the splice position is at or before `state.snapshot.turnIndex` (the currently-acting combatant), the group
 *   still goes in there — so a later re-sort (Step re-sorts on every call) finds them in the right place — but
 *   `turnIndex` is bumped by the inserted count so "whoever's turn it is" doesn't silently change mid-turn, and the
 *   group is skipped this pass (it acts starting next round, same as arriving after its own count already passed).
 * - Existing `ConditionInstance.expiresAt.turnIndex` values (an array position captured when the condition was
 *   applied) are remapped so the splice doesn't move an unrelated condition's expiry to the wrong turn.
 *
 * Mechanical only — logs nothing; the caller (a distinct `Summoned`/`CombatantSplit`-style event per mechanic)
 * knows what to say. Safe to call mid-turn (a caster's own summon action) or between turns.
 */
export function insertIntoTurnOrder(state: EngineState, newCombatants: CombatantState[]): { initiative: number; insertIndex: number } {
  const dex = abilityModifier(getDefinition(state.snapshot, newCombatants[0]!).abilities.dex);
  const roll = rollDice(withBonus("1d20", dex), state.rng);
  for (const combatant of newCombatants) combatant.initiative = roll.total;
  // Tie-broken among themselves by the shared comparator (falls back to id) so the batch's internal order is
  // deterministic and seed-reproducible.
  const batch = [...newCombatants].sort((a, b) => compareInitiative(state.snapshot, a, b));

  const combatants = state.snapshot.combatants;
  let insertIndex = combatants.findIndex((existing) => compareInitiative(state.snapshot, batch[0]!, existing) < 0);
  if (insertIndex === -1) insertIndex = combatants.length;

  combatants.splice(insertIndex, 0, ...batch);
  if (insertIndex <= state.snapshot.turnIndex) {
    state.snapshot.turnIndex += batch.length;
  }
  for (const existing of combatants) {
    for (const condition of existing.conditions ?? []) {
      if (condition.expiresAt && condition.expiresAt.turnIndex >= insertIndex) {
        condition.expiresAt = { ...condition.expiresAt, turnIndex: condition.expiresAt.turnIndex + batch.length };
      }
    }
  }
  return { initiative: roll.total, insertIndex };
}

/* ─── Summoning ───────────────────────────────────────────────────────────── */

/** How many "generations" of summon-of-a-summon are allowed before a spawned creature's own summon actions refuse. */
const DEFAULT_SUMMON_GENERATION_CAP = 2;
/** A hard ceiling on one encounter's combatant count, so a summon/split chain can't run away. */
export const MAX_ENCOUNTER_COMBATANTS = 40;

/** Up to `count` distinct free cells within `range` ft of `origin` for a footprint of `footprint` squares — nearest first, and never refuses outright (falls back past `range` into open ground, then to `origin` itself). */
function summonCells(state: EngineState, origin: Point, footprint: number, range: number, count: number): Point[] {
  const maxRadius = Math.max(6, Math.round(range / state.snapshot.map.grid.distancePerSquare));
  const occupied = state.snapshot.combatants
    .filter((candidate) => candidate.state !== "defeated" && !candidate.containedBy)
    .flatMap((candidate) => footprintCells(candidate.position, sizeFootprint(getDefinition(state.snapshot, candidate).size)));
  const placed: Point[] = [];
  for (let index = 0; index < count; index += 1) {
    let found: Point | undefined;
    for (let radius = 1; radius <= maxRadius && !found; radius += 1) {
      for (let dy = -radius; dy <= radius && !found; dy += 1) {
        for (let dx = -radius; dx <= radius && !found; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const cell = { x: origin.x + dx, y: origin.y + dy };
          if (isFootprintLegal(state.snapshot.map, cell, footprint, occupied)) found = cell;
        }
      }
    }
    const cell = found ?? origin;
    placed.push(cell);
    occupied.push(...footprintCells(cell, footprint));
  }
  return placed;
}

/** "Dretch" → "Dretches", "Imp" → "Imps" — good enough for log text. */
function pluralName(name: string): string {
  return /(s|x|z|ch|sh)$/i.test(name) ? `${name}es` : `${name}s`;
}

/**
 * Conjure Animals / Summon Demon / Animate Dead. Rolls the action's `chance` gate (if any), picks one option
 * (the caller's `optionId` for `choice: "pick"`, or a uniform roll for `"random"`), rolls its count, places
 * each new combatant near the caster and inserts the whole batch into the turn order on one shared roll
 * (`insertIntoTurnOrder`). Returns the combatants actually produced — empty if the chance roll failed, the
 * option/definition can't be resolved, or the encounter is already at `MAX_ENCOUNTER_COMBATANTS`.
 */
export function resolveSummonAction(state: EngineState, casterId: Id, actionId: Id, optionId?: Id): CombatantState[] {
  const caster = findCombatant(state.snapshot, casterId);
  const casterDefinition = getDefinition(state.snapshot, caster);
  const action = findActionDefinition(casterDefinition, actionId);
  if (!action || action.kind !== "summon") {
    throw new Error(`Summon action ${actionId} is not available to ${caster.displayName}`);
  }
  const generation = (caster.summon?.generation ?? 0) + 1;
  if (generation > (action.maxGeneration ?? DEFAULT_SUMMON_GENERATION_CAP)) {
    throw new Error(`${caster.displayName} can't summon this many generations deep`);
  }
  validateAndSpendAction(caster, action);
  if (action.concentration) {
    breakConcentration(state, casterId);
  }
  // A chancy summon is announced as an attempt, and the d100 that decides it is shown either way.
  declareAction(state, caster, action, {
    message: action.chance !== undefined
      ? `${caster.displayName} attempts to summon with ${action.name} (${action.chance}% chance)`
      : `${caster.displayName} uses ${action.name}`
  });

  const chanceRoll = action.chance === undefined ? undefined : state.rng.nextInt(1, 100);
  const succeeded = action.chance === undefined || chanceRoll! <= action.chance;
  if (!succeeded) {
    state.log.push(event(state, "CombatantSpawned", `Fail - ${action.name}: ${caster.displayName} rolled ${chanceRoll}, needed ${action.chance} or less`, {
      combatantId: caster.id, actionId, summonerId: casterId, combatants: [], chance: action.chance, roll: chanceRoll, success: false
    }));
    return [];
  }

  const chosen = action.choice === "random"
    ? action.options[state.rng.nextInt(0, action.options.length - 1)]
    : action.options.find((option) => option.id === optionId) ?? action.options[0];
  if (!chosen) {
    return [];
  }
  const summonedDefinition = state.snapshot.definitions.find((definition) => definition.id === chosen.definitionId);
  if (!summonedDefinition) {
    throw new Error(`${caster.displayName}'s ${action.name} references an unknown creature "${chosen.definitionId}" — is it embedded in this encounter?`);
  }

  const requestedCount = typeof chosen.count === "number" ? chosen.count : Math.max(1, rollDice(chosen.count.dice, state.rng).total);
  const count = Math.min(requestedCount, Math.max(0, MAX_ENCOUNTER_COMBATANTS - state.snapshot.combatants.length));
  if (count < requestedCount) {
    state.log.push(event(state, "AutomationWarning",
      `${caster.displayName}'s ${action.name} is capped at ${MAX_ENCOUNTER_COMBATANTS} combatants in one encounter — only ${count} of ${requestedCount} appear`,
      { combatantId: caster.id, actionId }));
  }
  if (count <= 0) {
    return [];
  }

  const footprint = sizeFootprint(summonedDefinition.size);
  const cells = summonCells(state, caster.position, footprint, action.range, count);
  const alreadyNamed = state.snapshot.combatants.filter((combatant) => combatant.definitionId === summonedDefinition.id).length;
  const created: CombatantState[] = cells.map((position, index) => ({
    id: `combatant-summon-${casterId}-${state.snapshot.round}-${state.log.length}-${index}`,
    definitionId: summonedDefinition.id,
    displayName: `${summonedDefinition.name} ${alreadyNamed + index + 1}`,
    faction: caster.faction,
    position,
    currentHp: summonedDefinition.maxHp,
    tempHp: 0,
    resources: summonedDefinition.resources ? { ...summonedDefinition.resources } : undefined,
    state: "active",
    tacticsProfile: summonedDefinition.defaultTactics ?? "basic-melee",
    resourceStance: summonedDefinition.defaultResourceStance ?? "balanced",
    summon: {
      summonerId: casterId,
      generation,
      expiresRound: action.durationRounds ? state.snapshot.round + action.durationRounds : undefined,
      concentrationSourceId: action.concentration ? casterId : undefined
    }
  }));

  const { initiative, insertIndex } = insertIntoTurnOrder(state, created);
  if (action.concentration) {
    caster.concentration = { sourceConditionId: undefined };
  }
  state.log.push(event(state, "CombatantSpawned",
    `Success - ${action.name}: ${caster.displayName}${chanceRoll === undefined ? "" : ` rolled ${chanceRoll} against ${action.chance}% and`} summons ${created.length} ${created.length === 1 ? summonedDefinition.name : pluralName(summonedDefinition.name)} (initiative ${initiative})`, {
      combatantId: caster.id, actionId, summonerId: casterId, definitionId: summonedDefinition.id, initiative, insertIndex,
      chance: action.chance, roll: chanceRoll, success: true,
      // The full combatant objects, not just ids: replay reconstructs board state purely by folding the log
      // forward over the pre-run snapshot, which never had these combatants in it. (`event` keeps a copy.)
      combatants: created
    }));
  return created;
}

/** Pass as the `formId` of `resolveTransformAction` to return to the creature's own (non-`hidden`) definition. */
export const BASE_FORM_ID = "__base__";

/**
 * Shapechanger / Change Shape: puts the actor into one of the action's `forms` (or back to its true form with
 * `BASE_FORM_ID`). Every form's definition must carry its own copy of the `transform` action — the actor's
 * actions come from whichever form it is in, so a Wolf that couldn't transform would be stuck as a wolf.
 * HP, position, conditions and resources stay on the combatant; only what `getDefinition` returns changes.
 */
export function resolveTransformAction(state: EngineState, actorId: Id, actionId: Id, formId: Id): void {
  const actor = findCombatant(state.snapshot, actorId);
  const action = findActionDefinition(getDefinition(state.snapshot, actor), actionId);
  if (!action || action.kind !== "transform") {
    throw new Error(`Transform action ${actionId} is not available to ${actor.displayName}`);
  }
  const target = formId === BASE_FORM_ID ? undefined : action.forms.find((form) => form.id === formId);
  if (formId !== BASE_FORM_ID && !target) {
    throw new Error(`${action.name} has no form "${formId}"`);
  }
  if (target && !state.snapshot.definitions.some((definition) => definition.id === target.definitionId)) {
    throw new Error(`${action.name}'s ${target.label} form ("${target.definitionId}") isn't embedded in this encounter`);
  }
  if (!target && action.canRevert === false) {
    throw new Error(`${actor.displayName} can't return to its true form with ${action.name}`);
  }
  validateAndSpendAction(actor, action);
  declareAction(state, actor, action, {
    message: target ? `${actor.displayName} uses ${action.name} to change shape` : `${actor.displayName} uses ${action.name} to return to its true form`
  });
  actor.activeForm = target ? { definitionId: target.definitionId } : undefined;
  state.log.push(event(state, "Transformed", `Success - ${action.name}: ${actor.displayName} ${target ? `becomes ${target.label}` : "returns to its true form"}`, {
    combatantId: actorId, actionId, formId, activeForm: actor.activeForm ?? null, success: true
  }));
}

/** A shapechanger that dies "reverts to its true form" — only cosmetic, but the sheet and reports should show the real creature. */
function revertFormOnDeath(state: EngineState, target: CombatantState): void {
  if (!target.activeForm) return;
  const reverting = getExecutableActions(getDefinition(state.snapshot, target)).find((action) => action.kind === "transform" && action.revertOnDeath);
  if (!reverting) return;
  target.activeForm = undefined;
  state.log.push(event(state, "Transformed", `${reverting.name}: ${target.displayName} reverts to its true form on death`, {
    combatantId: target.id, actionId: reverting.id, formId: BASE_FORM_ID, activeForm: null
  }));
}

/** Every live combatant `summonerId` has out, optionally only the ones tied to its current concentration. */
function summonsOf(state: EngineState, summonerId: Id, onlyConcentration: boolean): CombatantState[] {
  return state.snapshot.combatants.filter((combatant) =>
    combatant.summon?.summonerId === summonerId
    && combatant.state !== "fled" && combatant.state !== "defeated" && combatant.state !== "dead"
    && (!onlyConcentration || combatant.summon?.concentrationSourceId === summonerId));
}

/** Ends a batch of summoned creatures — `"fled"`, released from any hold/containment, logged once each. */
function despawnSummons(state: EngineState, targets: CombatantState[], why: string): void {
  for (const target of targets) {
    target.state = "fled";
    releaseHoldsBy(state, target.id);
    expelAll(state, target, why);
    state.log.push(event(state, "SummonExpired", `${target.displayName} ${why}`, {
      combatantId: target.id, summonerId: target.summon?.summonerId
    }));
  }
}

/** Whoever's `summon.expiresRound` has come due leaves. Call once per round, alongside `tickZones`. */
export function despawnExpiredSummons(state: EngineState): void {
  const expired = state.snapshot.combatants.filter((combatant) =>
    combatant.summon?.expiresRound != null
    && state.snapshot.round >= combatant.summon.expiresRound
    && combatant.state !== "fled" && combatant.state !== "defeated" && combatant.state !== "dead");
  despawnSummons(state, expired, "vanishes — its duration ended");
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
  // A save just overruled (Play) is logged as such, wherever it's logged.
  const ruled = state.saveOverride;
  const savedFor = data?.targetId ?? data?.combatantId;
  if (ruled && (type === "SaveRolled" || type === "ConcentrationChecked") && savedFor === ruled.targetId) {
    state.saveOverride = undefined;
    message = `${message} (DM override)`;
    data = { ...data, overridden: ruled.outcome };
  }
  return {
    id: `${type}-${state.log.length + 1}`,
    round: state.snapshot.round,
    turnIndex: state.snapshot.turnIndex,
    type,
    message,
    // A copy: callers pass live objects (a zone, a condition, a summoned creature) that keep changing for the rest of
    // the fight, and replay rebuilds the board from what each event says happened at the time.
    data: data === undefined ? undefined : structuredClone(data)
  };
}

function declareAction(
  state: EngineState,
  actor: CombatantState,
  action: ActionDefinition,
  targetInfo: { target?: CombatantState; origin?: Point; aimVector?: { x: number; y: number }; message?: string } = {}
): void {
  const targetText = targetInfo.target
    ? ` on ${targetInfo.target.displayName}`
    : targetInfo.origin
      ? ` at (${targetInfo.origin.x}, ${targetInfo.origin.y})`
      : "";
  const resourceCost = "resourceCost" in action && action.resourceCost ? action.resourceCost : undefined;
  // Area shape + aim + damage type travel with the declaration so consumers (the
  // replay AoE flash) don't have to re-resolve the action definition. Without the
  // aim vector a cone / line flash falls back to the template's cardinal
  // `direction` (always east) regardless of where it was actually pointed.
  const area = "area" in action ? action.area : undefined;
  const damageType = "damage" in action ? action.damage?.[0]?.damageType : undefined;
  // An item says which, and how many of its stack or charges are left (the cost is already spent).
  const item = action.item;
  const itemData = item
    ? {
      id: item.id,
      name: item.name,
      type: item.type,
      ...(item.use ? { use: item.use } : {}),
      ...(item.full ? { full: true } : {}),
      ...(resourceCost ? { left: actor.resources?.[resourceCost.resourceId] ?? 0 } : {}),
      // Used on a creature at 0 HP (a potion poured into a downed ally): the reports count who it got back up.
      ...(targetInfo.target && targetInfo.target.id !== actor.id && targetInfo.target.state !== "active" ? { targetDown: true } : {})
    }
    : undefined;
  const message = targetInfo.message
    ?? (item ? itemDeclaration(actor, action, item, targetInfo.target, targetText) : `${actor.displayName} uses ${action.name}${targetText}`);
  state.log.push(event(state, "ActionDeclared", message, {
    actorId: actor.id,
    actionId: action.id,
    actionName: action.name,
    actionKind: action.kind,
    actionType: action.actionType,
    targetId: targetInfo.target?.id,
    origin: targetInfo.origin,
    aimVector: targetInfo.aimVector,
    resourceCost,
    area,
    damageType,
    ...(itemData ? { item: itemData } : {})
  }));
}

/** What using an item looks like in the log: "Kael drinks a Potion of Healing", "Kael gives Mira a Potion of Healing". */
function itemDeclaration(actor: CombatantState, action: ActionDefinition, item: ItemUseMeta, target: CombatantState | undefined, targetText: string): string {
  const named = withArticle(item.name);
  // An action spent where a bonus action would do: the full amount, a flat number on the copy.
  const full = item.full && action.kind === "healing"
    ? ` with its action, for the full ${action.healing.reduce((sum, component) => sum + (Number(component.dice) || 0), 0)} HP`
    : "";
  if (item.use === "give" && target) return `${actor.displayName} gives ${target.displayName} ${named}${full}`;
  if (item.use === "drink") return `${actor.displayName} drinks ${named}${full}`;
  if (item.type === "scroll") return `${actor.displayName} reads ${named}${targetText}`;
  if (item.type === "thrown") return `${actor.displayName} throws ${named}${target ? ` at ${target.displayName}` : targetText}`;
  // A wand's spell for more than one charge (or several beads at once): the level that casts it at, and what it spends.
  const cost = "resourceCost" in action ? action.resourceCost : undefined;
  const level = "spellLevel" in action ? action.spellLevel : undefined;
  const tier = cost && cost.amount > 1 && level != null
    ? ` at ${level}${level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th"} level, ${cost.amount} ${item.consumes ? "at once" : "charges"}`
    : "";
  const what = action.name !== item.name || tier ? ` (${action.name}${tier})` : "";
  return `${actor.displayName} uses ${item.name}${what}${targetText}`;
}

/** Why an ability that can't target its user (giving a potion) was aimed at it anyway. */
function notSelfProblem(actor: CombatantState, action: ActionDefinition): string {
  return action.item?.use === "give"
    ? `${actor.displayName} can't give itself ${withArticle(action.item.name)}: it drinks it instead`
    : `${actor.displayName} can't target itself with ${action.name}`;
}

function validateTargeting(
  snapshot: EncounterSnapshot,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition | SaveActionDefinition
): void {
  const problem = targetingProblem(snapshot, attacker, target, action);
  if (problem) {
    throw new Error(problem);
  }
}

/** Why `attacker` can't use `action` on `target` right now (out of reach, behind a wall…), or `undefined` when it can. */
export function targetingProblem(
  snapshot: EncounterSnapshot,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition | SaveActionDefinition
): string | undefined {
  if (target.state !== "active" && target.state !== "downed") {
    return "Target is not a legal active combatant";
  }
  // Someone swallowed can be attacked only by the swallower, and can attack only it.
  if ((target.containedBy && target.containedBy !== attacker.id) || (attacker.containedBy && attacker.containedBy !== target.id)) {
    return "Target is inside another creature";
  }
  if (action.kind === "attack" && action.requiresHeld && holdConditions(target, attacker.id).length === 0) {
    return `${target.displayName} isn't grappled by ${attacker.displayName}`;
  }
  if (!attackPrerequisitesMet(attacker, action, target)) {
    return `${action.name} can't be used against ${target.displayName} right now`;
  }
  const distance = spatialDistance(snapshot, attacker, target);
  const range = action.kind === "attack"
    ? action.attackType === "melee"
      ? action.reach ?? action.range
      : action.longRange ?? action.range
    : action.range;
  if (distance > range) {
    return `Target is ${distance} ft. away, beyond ${range} ft. range`;
  }
  if (snapshot.rules.requireLineOfEffect && !lineOfEffect(snapshot.map, attacker.position, target.position)) {
    return "Line of effect is blocked";
  }
  return undefined;
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
  const distance = spatialDistance(snapshot, attacker, target);
  return distance > action.range && distance <= action.longRange;
}

export function validateOriginTargeting(
  snapshot: EncounterSnapshot,
  attacker: CombatantState,
  origin: Point,
  action: AreaSaveActionDefinition
): void {
  const distance = spatialDistanceToPoint(snapshot, attacker, origin);
  if (distance > action.range) {
    throw new Error(`Origin is ${distance} ft. away, beyond ${action.range} ft. range`);
  }
  if (snapshot.rules.requireLineOfEffect && !lineOfEffect(snapshot.map, attacker.position, origin)) {
    throw new Error("Line of effect to area origin is blocked");
  }
}

export function validateHealingTargeting(
  snapshot: EncounterSnapshot,
  healer: CombatantState,
  target: CombatantState,
  action: HealingActionDefinition
): void {
  if (target.state === "dead" || target.state === "fled") {
    throw new Error("Target cannot be healed");
  }
  if (action.targeting?.notSelf && target.id === healer.id) {
    throw new Error(notSelfProblem(healer, action));
  }
  const distance = spatialDistance(snapshot, healer, target);
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
  options: { halve?: boolean; casterLevel?: number; extraDiceOnFirst?: string } = {},
  sourceId?: Id
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
    source,
    sourceId
  );
}

function applyDamageEntries(
  state: EngineState,
  target: CombatantState,
  entries: DamageApplicationEntry[],
  source: CreatureDefinition,
  sourceId?: Id
): number {
  const targetDefinition = getDefinition(state.snapshot, target);
  const hpBefore = target.currentHp + target.tempHp;
  let totalApplied = 0;
  let totalAbsorbed = 0;
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
    const targetAdjustments = damageAdjustmentsFor(targetDefinition, target);
    const origin: DamageOrigin = { magical: component.magical === true, material: component.material };
    const damageType = component.damageTypeOptions?.length
      ? bestDamageTypeOption(component.damageTypeOptions, targetAdjustments, origin)
      : resolveDamageTypeReference(component.damageType, entry.triggerDamageType);
    const resolved = resolveDamageAdjustment(roll.total + formulaBonus, damageType, targetAdjustments, origin);
    const adjusted = resolved.amount;
    const finalAmount = entry.halve ? Math.floor(adjusted / 2) : adjusted;
    const absorbed = entry.halve ? Math.floor(resolved.absorbed / 2) : resolved.absorbed;
    totalApplied += applyHpDamage(target, finalAmount);
    totalAbsorbed += absorbed;
    return {
      damageType,
      roll,
      adjusted,
      finalAmount,
      ...(absorbed > 0 ? { absorbed } : {}),
      sourceFeatureId: entry.sourceFeatureId,
      sourceFeatureName: entry.sourceFeatureName,
      sourceEffectKind: entry.sourceEffectKind
    };
  });
  // Absorption (a Flesh Golem hit by lightning) heals instead. Done before the event so it records the new HP.
  const healedByAbsorption = absorbHealing(target, targetDefinition, totalAbsorbed);

  state.log.push(event(state, "DamageApplied", `${target.displayName} took ${totalApplied} damage${healedByAbsorption > 0 ? ` and absorbed ${healedByAbsorption}` : ""}`, {
    targetId: target.id,
    sourceId,
    components,
    totalApplied,
    ...(healedByAbsorption > 0 ? { absorbed: healedByAbsorption } : {}),
    currentHp: target.currentHp,
    tempHp: target.tempHp
  }));
  const hitDamageTypes = components.filter((c) => c.finalAmount > 0).map((c) => c.damageType);
  if (totalApplied > 0) {
    resolveConcentration(state, target, totalApplied);
    checkRegurgitation(state, target, sourceId, totalApplied);
  }
  // Split cares about being subjected to the damage, not about it getting through: a pudding is immune to slashing.
  checkSplit(state, target, components.filter((c) => c.roll.total > 0).map((c) => c.damageType));
  updateDefeatState(state, target, sourceId, recordHit(target, hpBefore, totalApplied, hitDamageTypes, entries.some((entry) => entry.critical)));
  return totalApplied;
}

/** What one instance of damage did, for the rules that care about more than the HP total. */
interface HitInfo {
  taken: number;
  /** Damage left over after the target reached 0 HP. */
  overkill: number;
  damageTypes: DamageType[];
  critical: boolean;
}

/** Notes the damage types on the target (regeneration switches off after acid / fire) and summarizes the hit. */
function recordHit(target: CombatantState, hpBefore: number, taken: number, damageTypes: DamageType[], critical: boolean): HitInfo {
  if (damageTypes.length > 0) {
    target.recentDamageTypes = [...new Set([...(target.recentDamageTypes ?? []), ...damageTypes])];
  }
  return { taken, overkill: Math.max(0, taken - hpBefore), damageTypes, critical };
}

/** One component's dice rolled once, with no target — for area effects where every creature takes the same numbers. */
interface RolledDamageComponent {
  damageType: DamageType;
  roll: DiceRollResult;
  /** `roll.total` plus any `bonusFormula` — before per-target resistance / vulnerability and any half-on-save. */
  base: number;
  magical: boolean;
  material?: DamageComponent["material"];
}

/**
 * Roll an area action's damage **once** (5e: "roll damage once and apply it to
 * every creature"). The result is then handed to `applyRolledAreaDamage` per
 * target so each creature only differs by its own resistances and whether it
 * saved — not by a fresh dice roll.
 */
function rollAreaDamage(
  state: EngineState,
  damage: DamageComponent[],
  source: CreatureDefinition,
  options: { casterLevel?: number; extraDiceOnFirst?: string } = {}
): RolledDamageComponent[] {
  return damage.map((component, index) => {
    const scaledBase = resolveScaledDamage(component.dice, component.scaling, { casterLevel: options.casterLevel });
    const dice = index === 0 && options.extraDiceOnFirst ? `${scaledBase}+${options.extraDiceOnFirst}` : scaledBase;
    const abilityBonus = component.abilityModifier ? abilityModifier(source.abilities[component.abilityModifier]) : 0;
    const roll = rollDice(withBonus(dice, abilityBonus), state.rng);
    return {
      damageType: resolveDamageTypeReference(component.damageType, undefined),
      roll,
      base: roll.total + resolveNumericFormula(component.bonusFormula, source),
      magical: component.magical === true,
      material: component.material
    };
  });
}

/** Apply an already-rolled area blast to one creature: its own resistances / vulnerability, then half on a made save. */
function applyRolledAreaDamage(
  state: EngineState,
  target: CombatantState,
  rolled: RolledDamageComponent[],
  halve: boolean,
  sourceId?: Id
): number {
  const targetDefinition = getDefinition(state.snapshot, target);
  const hpBefore = target.currentHp + target.tempHp;
  let totalApplied = 0;
  let totalAbsorbed = 0;
  const components = rolled.map((entry) => {
    const resolved = resolveDamageAdjustment(
      entry.base,
      entry.damageType,
      damageAdjustmentsFor(targetDefinition, target),
      { magical: entry.magical, material: entry.material }
    );
    const adjusted = resolved.amount;
    const finalAmount = halve ? Math.floor(adjusted / 2) : adjusted;
    const absorbed = halve ? Math.floor(resolved.absorbed / 2) : resolved.absorbed;
    totalApplied += applyHpDamage(target, finalAmount);
    totalAbsorbed += absorbed;
    return { damageType: entry.damageType, roll: entry.roll, adjusted, finalAmount, ...(absorbed > 0 ? { absorbed } : {}) };
  });
  const healedByAbsorption = absorbHealing(target, targetDefinition, totalAbsorbed);

  state.log.push(event(state, "DamageApplied", `${target.displayName} took ${totalApplied} damage${healedByAbsorption > 0 ? ` and absorbed ${healedByAbsorption}` : ""}`, {
    ...(healedByAbsorption > 0 ? { absorbed: healedByAbsorption } : {}),
    targetId: target.id,
    sourceId,
    components,
    totalApplied,
    currentHp: target.currentHp,
    tempHp: target.tempHp
  }));
  const areaHitDamageTypes = components.filter((c) => c.finalAmount > 0).map((c) => c.damageType);
  if (totalApplied > 0) {
    resolveConcentration(state, target, totalApplied);
  }
  checkSplit(state, target, components.filter((c) => c.roll.total > 0).map((c) => c.damageType));
  updateDefeatState(state, target, sourceId, recordHit(target, hpBefore, totalApplied, areaHitDamageTypes, false));
  return totalApplied;
}

function applyHpDamage(target: CombatantState, amount: number): number {
  const tempAbsorbed = Math.min(target.tempHp, amount);
  target.tempHp -= tempAbsorbed;
  const remaining = amount - tempAbsorbed;
  target.currentHp = Math.max(0, target.currentHp - remaining);
  return amount;
}

/**
 * The single choke point for a combatant's `currentHp <= 0` transition —
 * downs a party member (or defeats outright, per `rules.playerDeathSaves`) or
 * defeats a monster, exactly once per transition, and fires `resolveDeathEffect`.
 * Exported so manual HP edits (`updateHp` in the store — dragging a token's HP
 * to 0 outside of simulated combat) go through the same path as damage applied
 * during a simulated attack, rather than silently skipping death effects.
 */
export function updateDefeatState(state: EngineState, target: CombatantState, killerId?: Id, hit?: HitInfo): void {
  if (target.currentHp > 0) {
    return;
  }
  const definition = getDefinition(state.snapshot, target);
  // 5e massive damage: what's left after reaching 0 HP, if it's at least the creature's maximum, kills outright.
  if (hit && state.snapshot.rules.massiveDamage && hit.overkill >= definition.maxHp && target.state !== "defeated") {
    state.log.push(event(state, "MassiveDamage", `${target.displayName} takes massive damage (${hit.overkill} past 0) and dies outright`, {
      combatantId: target.id, overkill: hit.overkill, maxHp: definition.maxHp
    }));
    defeatCombatant(state, target, killerId);
    return;
  }
  if (target.state === "downed" && target.downedRegen) {
    // Already down and waiting to regenerate: the thing that stops the regeneration finishes it.
    const regen = downedRegeneration(state, target);
    if (hit && regen && hit.damageTypes.some((type) => regen.suppressedByDamageTypes?.includes(type))) {
      defeatCombatant(state, target, killerId);
    }
    return;
  }
  if (target.state === "active" && hit && survivesLethal(state, target, definition, hit)) {
    return;
  }
  const activeRegen = target.state === "active" ? downedRegeneration(state, target) : undefined;
  if (activeRegen && !(target.faction === "party" && state.snapshot.rules.playerDeathSaves)) {
    if (hit && hit.damageTypes.some((type) => activeRegen.suppressedByDamageTypes?.includes(type))) {
      // The blow that dropped it also shut its regeneration off, so it would die at the start of its turn: it dies now.
      defeatCombatant(state, target, killerId);
      return;
    }
    target.state = "downed";
    target.downedRegen = true;
    applyCondition(state, target.id, { id: `${target.id}-unconscious`, name: "unconscious", startedRound: state.snapshot.round }, { force: true });
    state.log.push(event(state, "CombatantDowned", `${target.displayName} is down, but regenerating`, { combatantId: target.id, killerId, regenerating: true }));
    breakConcentration(state, target.id);
    return;
  }
  if (target.faction === "party" && state.snapshot.rules.playerDeathSaves) {
    if (target.state === "downed") {
      // Already down — further overkill damage doesn't re-trigger the transition.
      return;
    }
    target.state = "downed";
    target.deathSaves = { successes: 0, failures: 0, stable: false };
    applyCondition(state, target.id, {
      id: `${target.id}-unconscious`,
      name: "unconscious",
      startedRound: state.snapshot.round
    });
    state.log.push(event(state, "CombatantDowned", `${target.displayName} is downed`, { combatantId: target.id, killerId }));
    // Unconscious is incapacitated — 5e: concentration ends when you're incapacitated or killed.
    breakConcentration(state, target.id);
    return;
  }
  defeatCombatant(state, target, killerId);
}

/** Marks a combatant defeated exactly once, ends its concentration and fires its death effects. */
function defeatCombatant(state: EngineState, target: CombatantState, killerId?: Id): void {
  if (target.state === "defeated") {
    // Already defeated — further overkill damage doesn't re-trigger the transition
    // (and must not re-fire the death effect below).
    return;
  }
  revertFormOnDeath(state, target);
  target.state = "defeated";
  target.downedRegen = undefined;
  releaseHoldsBy(state, target.id);
  expelAll(state, target, "the swallower died");
  state.log.push(event(state, "CombatantDefeated", `${target.displayName} is defeated`, { combatantId: target.id, killerId }));
  if ((target.altitude ?? 0) > 0) {
    fallCombatant(state, target, target.altitude ?? 0, "it died in the air");
  }
  breakConcentration(state, target.id);
  despawnSummons(state, summonsOf(state, target.id, false), "vanishes — its summoner died");
  resolveDeathEffect(state, target.id, killerId);
}

/** The `hp-regen` effect that lets this creature keep going at 0 HP (a troll), if it has one. */
function downedRegeneration(state: EngineState, target: CombatantState): Extract<FeatureEffect, { kind: "hp-regen" }> | undefined {
  const definition = getDefinition(state.snapshot, target);
  for (const feature of featureSources(definition, target)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind === "hp-regen" && effect.worksAtZero) return effect;
    }
  }
  return undefined;
}

/** Undead Fortitude / Relentless: drop to 1 HP instead of 0, when the hit qualifies. */
function survivesLethal(state: EngineState, target: CombatantState, definition: CreatureDefinition, hit: HitInfo): boolean {
  for (const feature of featureSources(definition, target)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "survive-lethal") continue;
      if (effect.excludeCritical && hit.critical) continue;
      if (effect.excludedDamageTypes?.some((type) => hit.damageTypes.includes(type))) continue;
      if (effect.maxDamage !== undefined && hit.taken > effect.maxDamage) continue;
      if (effect.resourceId && (target.resources?.[effect.resourceId] ?? 0) < 1) continue;
      if (effect.save) {
        const dc = effect.save.dcBase + hit.taken;
        const save = rollSavingThrow(state, target, { ability: effect.save.ability, dc, kind: "feature" });
        state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${effect.save.ability.toUpperCase()} save against ${feature.name}`, {
          targetId: target.id, saveRoll: save.roll, total: save.roll.total, dc, success: save.success, featureId: feature.id
        }));
        if (!save.success) continue;
      }
      if (effect.resourceId) {
        target.resources = { ...(target.resources ?? {}), [effect.resourceId]: (target.resources?.[effect.resourceId] ?? 0) - 1 };
      }
      target.currentHp = 1;
      state.log.push(event(state, "SurvivedLethal", `${target.displayName} refuses to fall (${feature.name}) and stays at 1 HP`, {
        combatantId: target.id, featureId: feature.id, resourceId: effect.resourceId,
        ...(effect.resourceId ? { next: target.resources?.[effect.resourceId] } : {})
      }));
      return true;
    }
  }
  return false;
}

/**
 * At the start of its turn a regenerating creature heals — unless something that switches it off (acid, fire
 * for a troll) hit it since its last turn, or it's at 0 HP and the trait doesn't work there. Clears the record
 * either way, so a suppression lasts exactly one turn.
 */
export function applyRegeneration(state: EngineState, actor: CombatantState): void {
  const definition = getDefinition(state.snapshot, actor);
  const recent = actor.recentDamageTypes ?? [];
  actor.recentDamageTypes = undefined;
  for (const feature of featureSources(definition, actor)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "hp-regen") continue;
      if (effect.suppressedByDamageTypes?.some((type) => recent.includes(type))) {
        state.log.push(event(state, "Regenerated", `${actor.displayName}'s ${feature.name} is switched off this turn`, { combatantId: actor.id, amount: 0, suppressed: true }));
        continue;
      }
      if (actor.currentHp < 1 && !effect.worksAtZero) continue;
      const healed = Math.min(effect.amount, definition.maxHp - actor.currentHp);
      if (healed <= 0) continue;
      actor.currentHp += healed;
      state.log.push(event(state, "Regenerated", `${actor.displayName} regains ${healed} HP (${feature.name})`, { combatantId: actor.id, amount: healed, currentHp: actor.currentHp }));
    }
  }
}

/**
 * A downed combatant's turn. A regenerating monster stands up (and regenerates in the normal turn start that
 * follows) unless something already finished it; everyone else rolls a death save. Returns `"recovered"` when the
 * caller should carry on with a full turn.
 */
export function runDownedTurn(state: EngineState, combatant: CombatantState): "recovered" | "done" {
  if (combatant.downedRegen) {
    const regen = downedRegeneration(state, combatant);
    const suppressed = regen?.suppressedByDamageTypes?.some((type) => combatant.recentDamageTypes?.includes(type)) ?? false;
    if (!regen || suppressed) {
      defeatCombatant(state, combatant);
      return "done";
    }
    combatant.downedRegen = undefined;
    combatant.state = "active";
    combatant.conditions = (combatant.conditions ?? []).filter((condition) => condition.name !== "unconscious");
    state.log.push(event(state, "Regenerated", `${combatant.displayName} gets back up`, { combatantId: combatant.id, amount: 0, standingUp: true }));
    return "recovered";
  }
  resolveDeathSave(state, combatant.id);
  return "done";
}

/** A creature that can be attacked as an enemy: fighting, or down but about to get back up. */
export function isTargetable(combatant: CombatantState): boolean {
  return !combatant.containedBy && (combatant.state === "active" || (combatant.state === "downed" && combatant.downedRegen === true));
}

/**
 * Fire every `deathEffects` entry on `deceasedId`'s definition once, automatically —
 * no action economy is spent (the creature is dead) and no player chooses a target.
 * Only the `area-save` action shape is automatable without a chosen target; other
 * shapes log an `AutomationWarning` and are skipped. Guarded by `deathEffectDepth`
 * so a chain of explosions (one death effect kills a creature with its own) can
 * cascade without risking infinite recursion.
 */
export function resolveDeathEffect(state: EngineState, deceasedId: Id, killerId?: Id): void {
  const depth = state.deathEffectDepth ?? 0;
  if (depth >= MAX_DEATH_EFFECT_DEPTH) {
    state.log.push(event(state, "AutomationWarning", "Death effect chain stopped at max depth", { combatantId: deceasedId }));
    return;
  }
  const deceased = findCombatant(state.snapshot, deceasedId);
  const definition = getDefinition(state.snapshot, deceased);
  const deathEffects = definition.deathEffects;
  if (!deathEffects?.length) {
    return;
  }
  state.deathEffectDepth = depth + 1;
  try {
    for (const deathEffect of deathEffects) {
      resolveOneDeathEffect(state, deceased, definition, deathEffect, killerId);
    }
  } finally {
    state.deathEffectDepth = depth;
  }
}

function resolveOneDeathEffect(
  state: EngineState,
  deceased: CombatantState,
  definition: CreatureDefinition,
  deathEffect: DeathEffectDefinition,
  killerId: Id | undefined
): void {
  const action = deathEffect.action;
  if (action.kind !== "area-save") {
    state.log.push(event(state, "AutomationWarning",
      `${deceased.displayName}'s death effect "${deathEffect.name}" (${action.kind}) has no automatic target and was skipped`,
      { combatantId: deceased.id, deathEffectId: deathEffect.id, actionKind: action.kind }));
    return;
  }

  const footprint = sizeFootprint(definition.size);
  const origin: Point = {
    x: Math.floor(deceased.position.x + (footprint - 1) / 2),
    y: Math.floor(deceased.position.y + (footprint - 1) / 2)
  };
  // Same `ActionDeclared` a spell's area-save logs — the board's AoE flash and
  // floating action-name cue (`combatFeedback.ts`) key off that event type, so
  // a death effect gets the same on-board indicator for free, no new UI wiring.
  declareAction(state, deceased, action, { origin });

  const onSuccess = resolveOnSuccess(action);
  const dc = resolveSaveDc(action, definition, deceased);
  const definitionsById = new Map(state.snapshot.definitions.map((d) => [d.id, d]));
  const areaCoverFor = (target: CombatantState) => state.snapshot.rules.cover
    ? coverBetween(
      state.snapshot.map,
      origin,
      1,
      target.position,
      sizeFootprint(getDefinition(state.snapshot, target).size),
      { blockers: coverBlockersFor(state.snapshot, deceased.id, target.id) }
    )
    : null;

  // No aim vector: a death effect has no one choosing where to point a cone/line,
  // so directional shapes fall back to their authored cardinal `direction` (east by
  // default) — the same fallback `cellIntersectsArea` already applies when a
  // template carries no `aimVector`.
  const affected = combatantsInArea(state.snapshot.map, origin, action.area, state.snapshot.combatants, definitionsById)
    .filter((target) => action.affects === "all" || effectiveFaction(state.snapshot, target) !== effectiveFaction(state.snapshot, deceased))
    .filter((target) => !(state.snapshot.rules.requireLineOfEffect && areaCoverFor(target)?.blocksTargeting));

  const blastRoll = action.damage.length
    ? rollAreaDamage(state, action.damage, definition)
    : [];

  const targets = affected.map((target) => {
    const targetDefinition = getDefinition(state.snapshot, target);
    const cover = areaCoverFor(target);
    const coverSaveBonus = action.saveAbility === "dex" ? (cover?.dexSaveBonus ?? 0) : 0;
    const save = rollSavingThrow(state, target, {
      ability: action.saveAbility, dc, kind: "death-effect", sourceAction: saveSourceOf(action), conditions: conditionsOfRiders(action.riders), situationalBonus: coverSaveBonus
    });
    const { roll: saveRoll, success, featureBonus: featureSaveBonus, featureAdvantage: featureSaveAdvantage } = save;
    const outcome = saveDamageOutcome(state, target, action.saveAbility, onSuccess, success);
    const dealsDamage = outcome.dealsDamage;
    const damageApplied = dealsDamage && blastRoll.length
      ? applyRolledAreaDamage(state, target, blastRoll, outcome.halve, deceased.id)
      : 0;

    if (!(success && onSuccess === "negates")) {
      applyActionRiders(state, deceased, target, definition, action.riders, {
        actionId: deathEffect.id, landed: true, saved: success, saveAbility: action.saveAbility, fallbackDc: dc, origin
      });
    }

    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${action.saveAbility.toUpperCase()} save against ${deathEffect.name}`, {
      attackerId: deceased.id,
      targetId: target.id,
      actionId: deathEffect.id,
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

  state.log.push(event(state, "DeathEffectTriggered", `${deceased.displayName}'s ${deathEffect.name} triggers`, {
    combatantId: deceased.id,
    deathEffectId: deathEffect.id,
    killerId,
    origin,
    targets
  }));
}

/** What the damage being adjusted came from — decides whether "nonmagical … not silvered" resistance applies. */
export interface DamageOrigin {
  magical?: boolean;
  material?: DamageComponent["material"];
}

/**
 * Whether an adjustment applies to damage of `damageType` from `origin`. "Nonmagical" adjustments are
 * bypassed by magical damage, and any adjustment listing `exceptMaterials` is bypassed by damage from a weapon
 * of that material (silvered / adamantine).
 */
function adjustmentApplies(adjustment: DamageAdjustment, damageType: DamageType, origin: DamageOrigin): boolean {
  if (adjustment.damageType !== damageType) {
    return false;
  }
  if (adjustment.nonMagicalOnly && origin.magical) {
    return false;
  }
  if (origin.material && adjustment.exceptMaterials?.includes(origin.material)) {
    return false;
  }
  return true;
}

/**
 * Applies a creature's absorption / immunity / resistance / vulnerability to one damage roll. Absorption
 * takes precedence over immunity: the creature takes nothing and `absorbed` reports how much it heals by.
 */
export function resolveDamageAdjustment(
  amount: number,
  damageType: DamageType,
  adjustments: CreatureDefinition["damageAdjustments"],
  origin: DamageOrigin = {}
): { amount: number; absorbed: number } {
  const applies = (type: DamageAdjustment["type"]) =>
    adjustments?.some((adjustment) => adjustment.type === type && adjustmentApplies(adjustment, damageType, origin)) ?? false;
  if (applies("absorb")) {
    return { amount: 0, absorbed: Math.max(0, amount) };
  }
  if (applies("immunity")) {
    return { amount: 0, absorbed: 0 };
  }
  if (applies("resistance")) {
    return { amount: Math.floor(amount / 2), absorbed: 0 };
  }
  if (applies("vulnerability")) {
    return { amount: amount * 2, absorbed: 0 };
  }
  return { amount, absorbed: 0 };
}

function adjustDamage(
  amount: number,
  damageType: DamageType,
  adjustments: CreatureDefinition["damageAdjustments"],
  origin: DamageOrigin = {}
): number {
  return resolveDamageAdjustment(amount, damageType, adjustments, origin).amount;
}

/**
 * How much of a damage roll of this type survives the creature's defenses, as a multiplier: 0 immune,
 * 0.5 resistant, 1 normal, 2 vulnerable, and −1 when it absorbs the type (the damage would heal it). The AI
 * uses this so it doesn't throw fire at a fire-immune creature or lightning at a Flesh Golem.
 */
export function damageAdjustmentMultiplier(
  damageType: DamageType,
  adjustments: CreatureDefinition["damageAdjustments"],
  origin: DamageOrigin = {}
): number {
  const resolved = resolveDamageAdjustment(1000, damageType, adjustments, origin);
  return resolved.absorbed > 0 ? -resolved.absorbed / 1000 : resolved.amount / 1000;
}

/** Heals a creature by the damage it absorbed, up to its maximum. Returns how much it actually healed. */
function absorbHealing(target: CombatantState, definition: CreatureDefinition, absorbed: number): number {
  if (absorbed <= 0 || target.state !== "active") {
    return 0;
  }
  const healed = Math.max(0, Math.min(absorbed, definition.maxHp - target.currentHp));
  target.currentHp += healed;
  return healed;
}

/** Of the wielder's damage-type choices, the one that gets through `adjustments` best; ties go to the first listed. */
function bestDamageTypeOption(
  options: DamageType[],
  adjustments: CreatureDefinition["damageAdjustments"],
  origin: DamageOrigin
): DamageType {
  let best = options[0];
  let bestAmount = adjustDamage(1000, best, adjustments, origin);
  for (const option of options.slice(1)) {
    const amount = adjustDamage(1000, option, adjustments, origin);
    if (amount > bestAmount) {
      best = option;
      bestAmount = amount;
    }
  }
  return best;
}

function resolveDamageTypeReference(damageType: DamageTypeReference, triggerDamageType: DamageType | undefined): DamageType {
  return damageType === "same-as-attack" ? triggerDamageType ?? "slashing" : damageType;
}

export function damageAdjustmentsFor(definition: CreatureDefinition, combatant: CombatantState): NonNullable<CreatureDefinition["damageAdjustments"]> {
  const effectAdjustments = featureSources(definition, combatant).flatMap((feature) => (feature.effects ?? [])
    .filter((effect): effect is Extract<FeatureEffect, { kind: "damage-adjustment" }> => effect.kind === "damage-adjustment")
    .filter((effect) => featureConditionsMetForSelf(definition, combatant, effect))
    .map((effect) => effect.adjustment));
  const conditionAdjustments = (combatant.conditions ?? []).flatMap((condition) => condition.modifiers?.damageAdjustments ?? []);
  return [...(definition.damageAdjustments ?? []), ...conditionAdjustments, ...effectAdjustments];
}

/** A creature's AC formulas without armor from its features and worn items (Unarmored Defense): kept per definition. */
const unarmoredFormulasByDefinition = new WeakMap<CreatureDefinition, UnarmoredFormula[]>();

function unarmoredFormulasOf(sources: ReturnType<typeof featureSources>): UnarmoredFormula[] {
  return sources.flatMap((source) => (source.effects ?? [])
    .filter((effect): effect is Extract<FeatureEffect, { kind: "unarmored-ac" }> => effect.kind === "unarmored-ac")
    .map((effect) => ({ label: source.name, base: effect.base, abilities: effect.abilities, ...(effect.noShield ? { noShield: true } : {}) })));
}

/**
 * The AC a creature's armor gives it (`armoredAc`), with what works out its AC without armor: its features' and worn
 * items' (Unarmored Defense), and with `combatant` its conditions' (Mage Armor). Before AC bonuses from features, items,
 * auras and conditions (`effectiveArmorClass`).
 */
export function armorClassOf(definition: CreatureDefinition, combatant?: Pick<CombatantState, "conditions">): ArmoredAc {
  let own = unarmoredFormulasByDefinition.get(definition);
  if (!own) {
    own = unarmoredFormulasOf(featureSources(definition));
    unarmoredFormulasByDefinition.set(definition, own);
  }
  const fromConditions = (combatant?.conditions ?? []).flatMap((condition) => (condition.effects ?? [])
    .filter((effect): effect is Extract<FeatureEffect, { kind: "unarmored-ac" }> => effect.kind === "unarmored-ac")
    .map((effect) => ({ label: condition.sourceName ?? condition.id, base: effect.base, abilities: effect.abilities, ...(effect.noShield ? { noShield: true } : {}) })));
  return armoredAc(definition, fromConditions.length ? [...own, ...fromConditions] : own);
}

function effectiveArmorClass(state: EngineState, definition: CreatureDefinition, combatant: CombatantState): number {
  const armored = armorClassOf(definition, combatant);
  // Bracers of Defense: only with no armor and no shield worn.
  const unarmored = !armored.armor && !armored.shield;
  const ownFeatureBonus = featureSources(definition, combatant)
    .reduce((sum, feature) => sum + (feature.effects ?? []).reduce((effectSum, effect) => {
      return effect.kind === "armor-class-bonus" && (!effect.unarmoredOnly || unarmored) ? effectSum + resolveNumericFormula(effect.bonus, definition) : effectSum;
    }, 0), 0);
  const auraFeatureBonus = auraSources(state, combatant)
    .reduce((sum, { feature, sourceDefinition }) => sum + (feature.effects ?? []).reduce((effectSum, effect) => {
      return effect.kind === "armor-class-bonus" ? effectSum + resolveNumericFormula(effect.bonus, sourceDefinition) : effectSum;
    }, 0), 0);
  return armored.total + ownFeatureBonus + auraFeatureBonus + (combatant.conditions ?? [])
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
export const INCAPACITATING_CONDITIONS: ReadonlySet<ConditionName> = new Set<ConditionName>([
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

/** A charge-gated rider the wielder may choose to hold back — it's compiled as a separate "spend charge" candidate action rather than folded into the base attack. */
function isOptionalRider(rider: ActionRider): rider is Exclude<ActionRider, { kind: "note" }> & { resourceCost: ResourceCost } {
  return "resourceCost" in rider && Boolean(rider.resourceCost) && rider.activation === "optional";
}

/** The base attack's riders, excluding any `"optional"` charge-gated ones — those instead spawn their own "spend charge" candidate action in `weaponToActions`. */
function mandatoryRiders(onHit: ActionRider[] | undefined): ActionRider[] | undefined {
  if (!onHit?.length) {
    return onHit;
  }
  const filtered = onHit.filter((rider) => !isOptionalRider(rider));
  return filtered.length ? filtered : undefined;
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
  // Weapon mastery: only for a wielder that has mastered this kind of weapon.
  const mastery = activeMastery(definition, weapon);
  const weaponDamageType = damageSource[0]?.damageType;
  const masteryAdds = mastery ? masteryRiders(mastery, ability, weaponDamageType === "same-as-attack" ? undefined : weaponDamageType) : [];
  const riders = mandatoryRiders(weapon.onHit);
  return {
    kind: "attack",
    id: weapon.actionId ?? `weapon:${weapon.id}`,
    name: weapon.name,
    actionType: "action",
    ...(mastery ? { mastery } : {}),
    ...(mastery === "cleave" ? { cleave: true } : {}),
    // Never "focus" here — `weaponToActions` returns early for a focus weapon before this runs.
    attackType: weapon.attackType as "melee" | "ranged",
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
    damage: damageSource.map((component, index) => ({
      ...component,
      // A finesse weapon's damage adds the ability its attack roll uses; the library leaves that to be resolved here.
      abilityModifier: component.abilityModifier ?? (weapon.ability === "finesse" && index === 0 ? ability : undefined),
      magical: component.magical || isMagical || undefined,
      material: component.material ?? weapon.material,
      bonusFormula: magicBonus
        ? { ...(component.bonusFormula ?? {}), base: (component.bonusFormula?.base ?? 0) + magicBonus }
        : component.bonusFormula
    })),
    riders: masteryAdds.length ? [...(riders ?? []), ...masteryAdds] : riders,
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
  if (weapon.attackType === "focus") {
    return [];
  }
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

  const optionalRiders = (weapon.onHit ?? []).filter(isOptionalRider);
  if (optionalRiders.length) {
    const upgraded = out.flatMap((action) => optionalRiders.map((rider, index) => ({
      ...action,
      id: `${action.id}:charged${optionalRiders.length > 1 ? `-${index + 1}` : ""}`,
      name: `${action.name} (${spendLabel(rider.resourceCost, weapon.charges?.id)})`,
      riders: [...(action.riders ?? []), rider],
      // Surface the rider's cost on the action itself so the AI's existing
      // resourceCost-based affordability filter / scoring penalty (which only
      // ever looks at the action's own `resourceCost`) sees this variant as
      // costing something, and won't offer it when unaffordable.
      resourceCost: rider.resourceCost
    })));
    out.push(...upgraded);
  }

  return out;
}

/**
 * What an optional on-hit upgrade spends, for its variant's name: "spend charge" for the weapon's own charges, otherwise
 * the pool's ("1 focus point" for Stunning Strike on a Monk's Unarmed Strike).
 */
function spendLabel(cost: ResourceCost | undefined, chargesId: string | undefined): string {
  if (!cost || cost.resourceId === chargesId) return "spend charge";
  const words = cost.resourceId.replace(/^.*:/, "").replace(/-/g, " ");
  return `${cost.amount} ${cost.amount === 1 ? words.replace(/s$/, "") : words}`;
}

/** A weapon compiles to full automation unless an on-hit rider needs a human (a note or an unspecified custom condition). */
function weaponAutomationSupport(weapon: NonNullable<CreatureDefinition["weapons"]>[number]): "full" | "partial" {
  const manual = (weapon.onHit ?? []).some(riderNeedsHuman);
  return manual ? "partial" : "full";
}

/**
 * A spell attack whose bonus follows the creature's spellcasting ability, with `ability` set to that ability: rider DCs
 * and ability-scoped effects (Rage's STR, a finesse check) read `ability`, not the formula.
 */
export function withSpellcastingAttackAbility(action: ActionDefinition, definition: CreatureDefinition): ActionDefinition {
  if (action.kind !== "attack" || action.attackBonusFormula?.ability !== "spellcasting") {
    return action;
  }
  const ability = spellcastingAbility(definition);
  return action.ability === ability ? action : { ...action, ability };
}

/** Fold a spell's level / upcast / concentration onto its compiled action so resolvers never need the spell. */
function stampSpellContext(
  action: ActionDefinition,
  spell: NonNullable<CreatureDefinition["spells"]>[number],
  definition: CreatureDefinition
): ActionDefinition {
  if (action.kind !== "attack" && action.kind !== "save" && action.kind !== "area-save" && action.kind !== "healing" && action.kind !== "reposition" && action.kind !== "buff") {
    return action;
  }
  const stamped = {
    ...withSpellcastingAttackAbility(action, definition),
    spellLevel: action.spellLevel ?? spell.level,
    upcast: action.upcast ?? spell.upcast,
    ...(action.kind === "area-save" && spell.zone && !action.zone ? { zone: spell.zone } : {})
  };
  if (action.kind !== "healing" && spell.concentration && !action.concentration) {
    return { ...stamped, concentration: true } as ActionDefinition;
  }
  return stamped;
}

/**
 * One extra compiled variant per spell-slot tier above a spell's base level
 * that this creature's resource pool declares — mirrors `weaponToActions`'
 * optional-charge variants (see the "spend charge" weapon actions above) so
 * the AI's existing resourceCost-based affordability filter and scoring
 * penalty see each higher slot as its own candidate action, each spending
 * (and only spending) the slot it upcasts to.
 *
 * Every leveled spell gets them, whether or not a higher slot makes it
 * stronger: a creature out of 4th-level slots casts Blight with a 5th. A copy
 * that adds nothing (`upcastAddsSomething`) is only offered to the AI once
 * every cheaper slot is gone (`isDominatedUpcast`).
 */
function spellUpcastVariants(definition: CreatureDefinition, action: ActionDefinition): ActionDefinition[] {
  const cost = action.kind !== "multiattack" && "resourceCost" in action ? action.resourceCost : undefined;
  const baseLevel = spellSlotLevel(cost?.resourceId);
  if (!cost || baseLevel == null) {
    return [];
  }
  const higherTiers = Object.keys(definition.resources ?? {})
    .map((resourceId) => spellSlotLevel(resourceId))
    .filter((level): level is number => level != null && level > baseLevel)
    .sort((a, b) => a - b);
  return higherTiers.map((level) => ({
    ...action,
    id: `${action.id}${UPCAST_SUFFIX}${level}`,
    name: `${action.name} (upcast to slot ${level})`,
    resourceCost: { resourceId: `slot-${level}`, amount: cost.amount },
    upcastFrom: baseLevel
  } as ActionDefinition));
}

const UPCAST_SUFFIX = ":upcast-";
const UPCAST_ID = /:upcast-\d+$/;

/** Whether `action` is a spell cast with a higher slot than its own (`<id>:upcast-N`). */
export function isUpcastVariant(action: Pick<ActionDefinition, "id">): boolean {
  return UPCAST_ID.test(action.id);
}

/** The spell a higher-slot copy is a copy of: `blight:upcast-5` → `blight`. Any other id is its own. */
export function upcastBaseId(id: Id): Id {
  return id.replace(UPCAST_ID, "");
}

/**
 * Whether casting `action` with a higher slot changes what it does: more dice, beams or targets, or (a counter) a
 * higher level it stops outright. A spell whose `upcast` names nothing its kind reads only costs more.
 */
export function upcastAddsSomething(action: ActionDefinition): boolean {
  if (action.kind === "activate-feature") return action.reaction?.trigger.kind === "enemy-casts-spell";
  const per = "upcast" in action ? action.upcast?.perSlotAboveBase : undefined;
  if (!per) return false;
  switch (action.kind) {
    case "attack":
      return Boolean(per.damageDice && action.damage.length) || Boolean(per.beams && action.attackDelivery === "beams");
    case "save":
      return Boolean(per.damageDice && action.damage.length) || Boolean(per.targets && action.targeting?.target !== "self");
    case "area-save":
      return Boolean(per.damageDice && action.damage.length);
    case "healing":
      return Boolean(per.damageDice) || Boolean(per.targets && action.targeting?.target === "chosen");
    case "buff":
      return Boolean(per.targets && action.targeting?.target === "chosen");
    default:
      return false;
  }
}

/**
 * How many creatures a buff or healing spell aimed at "up to N" creatures takes: N, plus what its upcast slot adds
 * (Bless with a 2nd-level slot: four). Undefined when it names no limit.
 */
export function chosenTargetCount(action: Extract<ActionDefinition, { kind: "buff" | "healing" }>): number | undefined {
  const count = action.targeting?.count;
  if (count === undefined) return undefined;
  const perSlot = action.upcast?.perSlotAboveBase?.targets;
  const slot = spellSlotLevel(action.resourceCost?.resourceId);
  const above = perSlot && action.spellLevel != null && slot != null ? Math.max(0, slot - action.spellLevel) : 0;
  return count + above * (perSlot ?? 0);
}

/** A spell and each copy of it cast with a higher slot, cheapest slot first. Anything else is just itself. */
export function slotCopiesOf(definition: CreatureDefinition, actionId: Id): ActionDefinition[] {
  const baseId = upcastBaseId(actionId);
  return getExecutableActions(definition).filter((action) => action.id === baseId || (isUpcastVariant(action) && upcastBaseId(action.id) === baseId));
}

/** The cheapest way `combatant` can still cast a spell: its own slot, else the lowest higher slot it has left. */
export function cheapestCastable(definition: CreatureDefinition, combatant: Pick<CombatantState, "resources">, actionId: Id): ActionDefinition | undefined {
  return slotCopiesOf(definition, actionId).find((action) => {
    const cost = "resourceCost" in action ? action.resourceCost : undefined;
    return !cost || (combatant.resources?.[cost.resourceId] ?? 0) >= cost.amount;
  });
}

/**
 * A higher-slot copy that adds nothing while a cheaper slot it could use is still left: the same spell for more. A
 * player may still choose it; the AI never does, so its choices don't grow until the cheaper slots run out.
 */
export function isDominatedUpcast(combatant: Pick<CombatantState, "resources">, action: ActionDefinition): boolean {
  const from = action.upcastFrom;
  const to = "resourceCost" in action ? spellSlotLevel(action.resourceCost?.resourceId) : undefined;
  if (from == null || to == null || upcastAddsSomething(action)) return false;
  const amount = ("resourceCost" in action ? action.resourceCost?.amount : undefined) ?? 1;
  for (let level = from; level < to; level += 1) {
    if ((combatant.resources?.[`slot-${level}`] ?? 0) >= amount) return true;
  }
  return false;
}

/** The level a creature casts at: what scales its cantrips (and Eldritch Blast's beams). */
export function casterLevelOf(definition: CreatureDefinition): number {
  return definition.character?.level ?? 1;
}

/** Parse `slot-3` → 3. Anything else → undefined. */
export function spellSlotLevel(resourceId: string | undefined): number | undefined {
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

export function featureSources(definition: CreatureDefinition, combatant?: CombatantState): FeatureDefinitionSource[] {
  const activeConditionSources = (combatant?.conditions ?? [])
    .filter((condition) => condition.effects?.length)
    .map((condition) => ({
      id: condition.sourceId ?? condition.id,
      name: condition.sourceName ?? condition.id,
      category: "feature" as const,
      effects: condition.effects,
      automationSupport: "full" as const
    }));
  const weaponSources = (definition.weapons ?? [])
    .filter((weapon) => weapon.effects?.length)
    .map((weapon) => ({
      id: weapon.id,
      name: weapon.name,
      category: "feature" as const,
      effects: weapon.effects,
      automationSupport: "full" as const
    }));
  // What a worn item gives while it works (attuned, if it needs to be), unless it's kept for reference only.
  const itemSources = workingItems(definition)
    .filter((item) => item.effects?.length && item.automationSupport !== "manual-only" && item.automationSupport !== "unsupported")
    .map((item) => ({
      id: item.id,
      name: item.name,
      category: "feature" as const,
      effects: item.effects,
      automationSupport: "full" as const
    }));
  return [...simulatedFeatures(definition), ...weaponSources, ...itemSources, ...activeConditionSources];
}

/**
 * The features and traits whose effects, auras and emanations the simulator applies: not ones kept for reference only
 * (the DM resolves them), unsupported, or marked as having no combat effect.
 */
export function simulatedFeatures(definition: CreatureDefinition): FeatureDefinitionSource[] {
  return [...(definition.features ?? []), ...(definition.traits ?? [])].filter((feature) =>
    !feature.informational && feature.automationSupport !== "manual-only" && feature.automationSupport !== "unsupported");
}

type FeatureDefinitionSource = NonNullable<CreatureDefinition["features"]>[number];

/** An aura-tagged feature paired with ITS bearer's own definition — a `NumericFormula` like `{ ability: "cha" }` on an aura effect must resolve against the aura's source, not whoever it's currently buffing. */
interface AuraContribution {
  feature: FeatureDefinitionSource;
  sourceDefinition: CreatureDefinition;
}

/**
 * Passive buffs radiating onto `target` from OTHER combatants' `aura`-tagged
 * features/traits (Aura of Protection). Recomputed fresh on every call — the
 * `bearer.state !== "active"` check is the entire lifecycle story for a
 * buff aura (no concentration link, no teardown hook): the instant a
 * bearer goes down, the very next call simply stops finding their aura.
 * Skips `bearer.id === target.id`: RAW ("You and friendly creatures...")
 * reads as the bearer benefiting too, but they already do — `featureSources`
 * reads a combatant's own `traits` unconditionally, aura-tagged or not — so
 * radiating the aura back onto its own source here would double-count it.
 */
function auraSources(state: EngineState, target: CombatantState): AuraContribution[] {
  const contributions: AuraContribution[] = [];
  for (const bearer of state.snapshot.combatants) {
    if (bearer.id === target.id || bearer.state !== "active") {
      continue;
    }
    const bearerDefinition = getDefinition(state.snapshot, bearer);
    for (const feature of simulatedFeatures(bearerDefinition)) {
      if (!feature.aura) {
        continue;
      }
      if (feature.aura.affects === "hostile" && effectiveFaction(state.snapshot, bearer) === effectiveFaction(state.snapshot, target)) {
        continue;
      }
      if (feature.aura.affects === "allies" && effectiveFaction(state.snapshot, bearer) !== effectiveFaction(state.snapshot, target)) {
        continue;
      }
      if (spatialDistance(state.snapshot, bearer, target) > feature.aura.range) {
        continue;
      }
      contributions.push({ feature, sourceDefinition: bearerDefinition });
    }
  }
  return contributions;
}

function featureAttackAdvantage(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  action: AttackActionDefinition,
  definition: CreatureDefinition
): { advantage: boolean; disadvantage: boolean; sources: string[] } {
  const advantage: string[] = [];
  const disadvantage: string[] = [];
  for (const feature of featureSources(definition, attacker)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "attack-advantage"
        || !featureAppliesToAction(effect, action)
        || !featureConditionsMet(state, attacker, target, effect, { rollMode: "normal", critical: false })) {
        continue;
      }
      (effect.mode === "disadvantage" ? disadvantage : advantage).push(feature.name);
    }
  }
  return { advantage: advantage.length > 0, disadvantage: disadvantage.length > 0, sources: [...advantage, ...disadvantage] };
}

/** Sum of `incoming-attack-modifier` feature effects active on the target (+5 ≈ advantage against it). */
function featureIncomingAttackModifier(
  state: EngineState,
  target: CombatantState,
  targetDefinition: CreatureDefinition
): number {
  let total = 0;
  for (const feature of featureSources(targetDefinition, target)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind === "incoming-attack-modifier" && featureConditionsMetForSelf(targetDefinition, target, effect)) {
        total += effect.amount;
      }
    }
  }
  return total;
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
        noteChargeHit(attacker, target, effect);
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
      noteChargeHit(attacker, target, effect);
      const recipient = effect.target === "self" ? attacker : target;
      if (effect.save && recipient.id !== attacker.id) {
        const recipientDefinition = getDefinition(state.snapshot, recipient);
        const dc = resolveFeatureSaveDc(effect.save, definition);
        const conditionName = effect.appliedCondition.name;
        if (conditionName && isImmuneToCondition(recipientDefinition, conditionName)) {
          logConditionResisted(state, recipient, conditionName);
          continue;
        }
        const save = rollSavingThrow(state, recipient, { ability: effect.save.ability, dc, kind: "feature", conditions: conditionName ? [conditionName] : undefined });
        state.log.push(event(state, "SaveRolled", `${recipient.displayName} rolled a ${effect.save.ability.toUpperCase()} save against ${feature.name}`, {
          attackerId: attacker.id, targetId: recipient.id, actionId: action.id, featureId: feature.id, effectKind: effect.kind,
          saveRoll: save.roll, total: save.roll.total, dc, featureSaveBonus: save.featureBonus.total,
          appliedSaveEffects: [...save.featureBonus.sources, ...save.featureAdvantage.sources], success: save.success
        }));
        if (save.success) continue;
      }
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
        modifiers: effect.appliedCondition.modifiers ?? (effect.appliedCondition.name ? defaultConditionModifiers(effect.appliedCondition.name) : undefined),
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

function riderDurationToExpiry(state: EngineState, duration: RiderDuration, bearerTurnIndex?: number, sourceTurnIndex?: number): {
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
    case "until-source-turn": {
      // The source's next turn: later this round if it hasn't come yet, otherwise next round (its own, now, included).
      const sourceIdx = sourceTurnIndex ?? state.snapshot.turnIndex;
      const laterThisRound = sourceIdx > state.snapshot.turnIndex;
      return {
        expiresAt: {
          round: state.snapshot.round + (laterThisRound ? 0 : 1),
          turnIndex: sourceIdx,
          timing: duration.timing
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

/**
 * Crude, engine-consistent mechanical effect of a bare condition name: what a fall, a hold or the sheet's + Condition
 * (the store's `applyConditionToCombatant`) gives a creature.
 */
export function defaultConditionModifiers(name: ConditionName): ConditionInstance["modifiers"] | undefined {
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
    case "petrified":
      // Turned to stone: incapacitated, can't move, attackers effectively have advantage, and resistant to
      // all damage.
      return {
        deniesActions: true, deniesBonusActions: true, deniesReactions: true,
        movementMultiplier: 999, incomingAttackRoll: 5,
        damageAdjustments: ALL_DAMAGE_TYPES.map((damageType) => ({ type: "resistance" as const, damageType }))
      };
    case "surprised":
      // Can't act, react, or move on this first turn of combat only (no
      // attacker advantage from this alone, unlike stunned/paralyzed).
      return { deniesActions: true, deniesBonusActions: true, deniesReactions: true, movementMultiplier: 999 };
    default:
      return undefined;
  }
}

function clampToGrid(value: number, max: number): number {
  return Math.min(Math.max(0, Math.round(value)), Math.max(0, max));
}

/** Straight-line forced movement away from `origin`, stopping at a sight/effect-blocking wall. */
export function pushCombatant(state: EngineState, target: CombatantState, distanceFt: number, origin: Point): void {
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
  const targetDefinition = getDefinition(state.snapshot, target);
  const footprint = sizeFootprint(targetDefinition.size);
  // Only someone standing on the ground can be shoved into a cliff face or off a ledge; a flier just gets carried.
  const grounded = (target.altitude ?? 0) === 0 && !movementProfileOf(targetDefinition).fly;
  let fallFt = 0;
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
    if (grounded && state.snapshot.map.elevation) {
      const rise = footprintGroundHeight(state.snapshot.map, next, footprint) - footprintGroundHeight(state.snapshot.map, position, footprint);
      if (rise > MAX_STEP_HEIGHT_FT) {
        break;
      }
      if (-rise > MAX_STEP_HEIGHT_FT) {
        fallFt += -rise;
      }
    }
    position = next;
  }
  if (position.x !== target.position.x || position.y !== target.position.y) {
    const from = target.position;
    target.position = position;
    state.log.push(event(state, "CombatantMoved", `${target.displayName} was pushed`, {
      combatantId: target.id, from, to: position, destination: position, forced: true
    }));
    if (fallFt > 0) {
      fallCombatant(state, target, fallFt, "pushed off a ledge");
    }
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
  // An immune creature doesn't roll a save or take the condition at all — check before anything else.
  const riderConditionName = typeof rider.condition === "string" ? rider.condition : rider.condition.custom;
  if (isImmuneToCondition(targetDefinition, riderConditionName)) {
    logConditionResisted(state, target, riderConditionName);
    return null;
  }

  // The rider rolls its own initial save only when the parent action had none
  // (an attack context). In a save / area context the action's save already
  // gated the rider via its `when`, so the condition just lands.
  if (rider.save && ctx.saved === null) {
    const dc = resolveRiderSaveDc(rider.save, sourceDefinition, ctx.fallbackDc);
    const save = rollSavingThrow(state, target, {
      ability: rider.save.ability, dc, kind: "rider",
      sourceAction: saveSourceOf(findActionDefinition(sourceDefinition, ctx.actionId)),
      conditions: typeof rider.condition === "string" ? [rider.condition] : undefined
    });
    const { roll, success } = save;
    state.log.push(event(state, "SaveRolled", `${target.displayName} rolled a ${rider.save.ability.toUpperCase()} save against ${ctx.actionId}`, {
      attackerId: source.id, targetId: target.id, actionId: ctx.actionId,
      appliedSaveEffects: [...save.featureBonus.sources, ...save.featureAdvantage.sources],
      saveRoll: roll, total: roll.total, dc, success, viaRider: true
    }));
    if (success && rider.save.onSuccess === "negates") {
      return null;
    }
  }

  const conditionName: ConditionName = typeof rider.condition === "string" ? rider.condition : "custom";
  // A keyed condition (weapon mastery's Slow) replaces itself rather than stacking with the same from another weapon.
  const conditionId = rider.conditionKey ? `${target.id}:${rider.conditionKey}` : `${target.id}:${ctx.actionId}:${rider.id ?? "cond"}`;
  const bearerTurnIndex = state.snapshot.combatants.findIndex((c) => c.id === target.id);
  const sourceTurnIndex = state.snapshot.combatants.findIndex((c) => c.id === source.id);
  const expiry = riderDurationToExpiry(state, rider.duration, bearerTurnIndex >= 0 ? bearerTurnIndex : undefined, sourceTurnIndex >= 0 ? sourceTurnIndex : undefined);
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
    ...(rider.conditionKey ? { sourceName: rider.conditionKey } : {}),
    ...(rider.nextAttack ? { nextAttack: { ...rider.nextAttack, ...(rider.nextAttack.role === "against" ? { by: source.id } : {}) } } : {}),
    repeatSave: expiry.repeatTiming && repeatAbility
      ? { ability: repeatAbility, dc: repeatDc, timing: expiry.repeatTiming }
      : undefined,
    concentration: expiry.concentration || ctx.concentrating || undefined
  };
  if (!applyCondition(state, target.id, instance)) {
    return null; // immune after all (the label check above should have caught it) — nothing landed
  }

  if (instance.concentration) {
    source.concentration = { sourceConditionId: source.concentration?.sourceConditionId ?? conditionId };
  }
  return conditionName;
}

/**
 * Whether a rider can affect a creature of `target`'s type (Dominate Person: humanoids only). A creature with no
 * type set never matches a restriction — set one on its sheet. The AI's scoring asks the same question.
 */
export function riderAffectsCreatureType(rider: ActionRider, target: CreatureDefinition): boolean {
  if (rider.kind === "note" || !rider.restrictToCreatureTypes?.length) {
    return true;
  }
  return Boolean(target.type && rider.restrictToCreatureTypes.includes(target.type));
}

/** Say why a type-restricted rider did nothing, so a failed save with no effect after it isn't a mystery. */
function logRiderSkippedForType(
  state: EngineState,
  source: CombatantState,
  target: CombatantState,
  targetDefinition: CreatureDefinition,
  rider: ActionRider,
  actionId: Id,
  index: number
): void {
  const allowed = rider.kind === "note" ? [] : rider.restrictToCreatureTypes ?? [];
  const actionName = findActionDefinition(getDefinition(state.snapshot, source), upcastBaseId(actionId))?.name ?? actionId;
  const effect = rider.kind === "condition"
    ? (typeof rider.condition === "string" ? rider.condition : rider.condition.custom)
    : rider.kind === "damage" ? "extra damage" : rider.kind;
  const why = targetDefinition.type ? `${target.displayName} is ${targetDefinition.type}` : `${target.displayName} has no creature type set`;
  const allowedText = allowed.length > 1 ? `${allowed.slice(0, -1).join(", ")} or ${allowed[allowed.length - 1]}` : allowed[0];
  state.log.push(event(state, "RiderSkipped",
    `${target.displayName} is unaffected by ${actionName} (${effect}): it only affects ${allowedText} creatures, and ${why}`, {
      sourceId: source.id, targetId: target.id, actionId, riderKind: rider.kind, riderUseKey: riderUseKey(actionId, rider, index),
      reason: "creature-type", allowedTypes: allowed, targetType: targetDefinition.type ?? null
    }));
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
    if (!riderAffectsCreatureType(rider, targetDefinition)) {
      logRiderSkippedForType(state, source, target, targetDefinition, rider, ctx.actionId, index);
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
      }, source.id);
    } else if (rider.kind === "healing") {
      const recipient = rider.target === "self" ? source : target;
      outcome.healing += applyRiderHealing(state, recipient, sourceDefinition, rider.components);
    } else if (rider.kind === "push") {
      // Weapon mastery's Push: only a Large or smaller creature moves.
      if (rider.maxSize && SIZE_ORDER.indexOf(targetDefinition.size) > SIZE_ORDER.indexOf(rider.maxSize)) return;
      pushCombatant(state, target, rider.distance, ctx.origin ?? source.position);
    } else if (rider.kind === "swallow") {
      if (!applySwallow(state, source, target, targetDefinition, rider, ctx.actionId)) {
        return;
      }
    } else if (rider.kind === "hold") {
      if (!applyHold(state, source, target, targetDefinition, rider, ctx.actionId)) {
        return;
      }
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
  const zonesBefore = state.snapshot.activeZones ?? [];
  const zonesAfter = zonesBefore.filter((zone) => !(zone.concentration && zone.sourceCombatantId === casterId));
  if (zonesAfter.length !== zonesBefore.length) {
    for (const removed of zonesBefore) {
      if (!zonesAfter.includes(removed)) {
        state.log.push(event(state, "ZoneExpired", `${removed.name} dissipates`, { zone: removed, concentrationEnded: true }));
      }
    }
    state.snapshot.activeZones = zonesAfter;
  }
  despawnSummons(state, summonsOf(state, casterId, true), "vanishes — concentration ended");

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
    // A repeated save is against the same effect as the first: same source action (a spell's Magic Resistance
    // still applies) and the condition being shaken off.
    const conditionSource = condition.sourceCombatantId
      ? state.snapshot.combatants.find((candidate) => candidate.id === condition.sourceCombatantId)
      : undefined;
    const save = rollSavingThrow(state, combatant, {
      ability: repeat.ability, dc: repeat.dc, kind: "repeat",
      sourceAction: conditionSource && condition.sourceId
        ? saveSourceOf(findActionDefinition(getDefinition(state.snapshot, conditionSource), condition.sourceId))
        : undefined,
      conditions: [condition.name]
    });
    const { roll, success } = save;
    state.log.push(event(state, "SaveRolled", `${combatant.displayName} repeated a ${repeat.ability.toUpperCase()} save vs ${condition.name}`, {
      targetId: combatantId, conditionId: condition.id, saveRoll: roll, total: roll.total, dc: repeat.dc, success, repeatSave: true,
      appliedSaveEffects: [...save.featureBonus.sources, ...save.featureAdvantage.sources]
    }));
    if (success) {
      // Shaking the effect off also earns immunity to it ("or the effect ends for it, the creature is immune").
      if (conditionSource && condition.sourceId) {
        const sourceAction = findActionDefinition(getDefinition(state.snapshot, conditionSource), condition.sourceId);
        if (sourceAction && (sourceAction.kind === "save" || sourceAction.kind === "area-save")) recordSavedAgainst(conditionSource, combatant, sourceAction);
      }
      state.log.push(event(state, "ConditionExpired", `${combatant.displayName} shook off ${condition.name}`, {
        combatantId, condition, viaSave: true
      }));
    } else {
      surviving.push(condition);
    }
  }
  combatant.conditions = surviving;
}

export function resolveOnSuccess(action: SaveActionDefinition | AreaSaveActionDefinition): "half" | "none" | "negates" {
  return action.onSuccess ?? (action.halfDamageOnSuccess ? "half" : "none");
}

function featureSaveModifier(
  state: EngineState,
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
  for (const { feature, sourceDefinition } of auraSources(state, combatant)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind === "save-bonus" && (!effect.ability || effect.ability === ability)) {
        total += resolveNumericFormula(effect.bonus, sourceDefinition);
        sources.push(feature.name);
      }
    }
  }
  return { total, sources };
}

/**
 * Whether a `save-advantage` effect applies to this particular save: its ability filter, and its `against`
 * scope — spells / magical effects (by the forcing action's spell level or magical flag) and "saves against
 * being charmed / frightened / prone…" (by the condition the save is against). A save against being dominated
 * also counts as one against being charmed.
 */
export function saveAdvantageApplies(effect: Extract<FeatureEffect, { kind: "save-advantage" }>, ctx: Pick<SaveContext, "ability" | "sourceAction" | "conditions">): boolean {
  const hasAbilityFilter = effect.ability !== undefined || (effect.abilities?.length ?? 0) > 0;
  if (hasAbilityFilter && effect.ability !== ctx.ability && !effect.abilities?.includes(ctx.ability)) {
    return false;
  }
  const against = effect.against;
  if (against?.source) {
    const isSpell = ctx.sourceAction?.spellLevel !== undefined;
    const isMagical = isSpell || ctx.sourceAction?.magical === true;
    if (against.source === "spell" ? !isSpell : !isMagical) {
      return false;
    }
  }
  if (against?.conditions?.length) {
    const forced = new Set<string>(ctx.conditions ?? []);
    if (forced.has("dominated")) {
      forced.add("charmed");
    }
    if (!against.conditions.some((condition) => forced.has(condition))) {
      return false;
    }
  }
  return true;
}

function featureSaveAdvantageModifier(
  state: EngineState,
  definition: CreatureDefinition,
  combatant: CombatantState,
  ctx: Pick<SaveContext, "ability" | "sourceAction" | "conditions">
): { applied: boolean; sources: string[] } {
  const sources: string[] = [];
  for (const feature of [...featureSources(definition, combatant), ...auraSources(state, combatant).map((contribution) => contribution.feature)]) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind === "save-advantage"
        && saveAdvantageApplies(effect, ctx)
        && featureConditionsMetForSelf(definition, combatant, effect)) {
        sources.push(feature.name);
      }
    }
  }
  return { applied: sources.length > 0, sources };
}

/** The spell level / magical flag of an action, for judging whether a save against it is "against magic". */
function saveSourceOf(action: ActionDefinition | undefined): SaveContext["sourceAction"] {
  if (!action) {
    return undefined;
  }
  return {
    spellLevel: "spellLevel" in action ? action.spellLevel : undefined,
    magical: ("magical" in action && action.magical === true) || (action.kind === "attack" && action.attackType === "spell") || undefined
  };
}

/** The conditions a rider list would inflict on a failed save — what "advantage on saves against being charmed" is against. */
function conditionsOfRiders(riders: ActionRider[] | undefined): ConditionName[] {
  return (riders ?? [])
    .filter((rider): rider is Extract<ActionRider, { kind: "condition" }> => rider.kind === "condition")
    .flatMap((rider) => (typeof rider.condition === "string" ? [rider.condition] : []));
}

/** Where a saving throw comes from, so scoped effects (Magic Resistance, "advantage against being charmed") can tell. */
export type SaveKind = "action" | "area" | "zone" | "terrain" | "rider" | "repeat" | "concentration" | "feature" | "death-effect";

export interface SaveContext {
  ability: Ability;
  dc: number;
  kind: SaveKind;
  /** The action forcing the save — its spell level / magical flag decides whether Magic Resistance applies. */
  sourceAction?: { spellLevel?: number; magical?: boolean };
  /** The conditions this save is against being afflicted with (advantage on saves against being charmed). */
  conditions?: ConditionName[];
  /** A flat situational bonus, e.g. cover on a Dexterity save. */
  situationalBonus?: number;
  /** Roughly how much damage failing would cost — lets a Legendary Resistance decide whether the save is worth it. */
  expectedDamage?: number;
  /** What forced the save ("Fireball"), for a prompt or the roll strip. */
  label?: string;
}

export interface SavingThrowResult {
  roll: DiceRollResult;
  success: boolean;
  dc: number;
  featureBonus: { total: number; sources: string[] };
  featureAdvantage: { applied: boolean; sources: string[] };
  /** Set when the target failed the roll and a Legendary Resistance turned it into a success. */
  legendaryResistance?: { feature: string; resourceId: string; remaining: number };
  /** Set when a DM overruled how the roll came out. */
  overridden?: RollOutcome;
}

/** Relative disabling value of a condition, 0..1. */
export function conditionSeverity(name: ConditionName): number {
  switch (name) {
    case "paralyzed":
    case "stunned":
    case "unconscious":
    case "dominated":
    case "petrified":
      return 1;
    case "incapacitated":
    case "restrained":
    case "confused":
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

/** Average of a dice expression, ignoring anything it can't parse. */
export function averageOfDice(expression: string): number {
  try {
    const parsed = parseDiceExpression(expression);
    return parsed.terms.reduce((sum, term) => sum + term.sign * term.count * (term.sides + 1) / 2, 0) + parsed.modifier;
  } catch {
    return 0;
  }
}

/** What a save-forcing action would do on a failed save, on average — the "stakes" for a Legendary Resistance. */
function expectedFailureDamage(action: { damage?: DamageComponent[] }): number {
  return (action.damage ?? []).reduce((sum, component) => sum + averageOfDice(component.dice), 0);
}

/**
 * Legendary Resistance policy. Severity thresholds by `resourceStance`: conservative keeps its uses for
 * near-certain disablers (paralysis, stun) or a hit worth ~40% of its HP; balanced spends on real control
 * (0.45+) or 25% of its HP; liberal spends on anything it fails.
 */
function wantsLegendaryResistance(target: CombatantState, ctx: SaveContext): boolean {
  const stance = target.resourceStance ?? "balanced";
  if (stance === "liberal") return true;
  const [severityNeeded, damageShareNeeded] = stance === "conservative" ? [0.65, 0.4] : [0.45, 0.25];
  const severity = Math.max(0, ...(ctx.conditions ?? []).map(conditionSeverity));
  const damageShare = (ctx.expectedDamage ?? 0) / Math.max(1, target.currentHp);
  return severity >= severityNeeded || damageShare >= damageShareNeeded;
}

/**
 * The one place a saving throw is rolled: the target's own bonus (proficiency-inclusive `saves` or the raw
 * modifier), condition modifiers, feature bonuses and aura bonuses, and advantage from features — for every
 * kind of save (actions, areas, zones, terrain, riders, repeats, concentration). It used to be copied into
 * eight places, two of which (rider saves and repeated saves) forgot the feature bonuses and advantage, so an
 * Aura of Protection didn't apply to a Hold Person-style save.
 */
export function rollSavingThrow(state: EngineState, target: CombatantState, ctx: SaveContext): SavingThrowResult {
  const definition = getDefinition(state.snapshot, target);
  const { bonus, featureBonus, featureAdvantage } = saveRollInputs(state, target, ctx);
  const roll = rollD20WithBonus(state.rng, bonus, {
    advantage: featureAdvantage.applied
  });
  const result: SavingThrowResult = { roll, success: roll.total >= ctx.dc, dc: ctx.dc, featureBonus, featureAdvantage };
  // A DM may overrule the roll (Play). Legendary Resistance below then sees the outcome as ruled.
  const overridden = askDecision<RollRequest>(state, {
    kind: "roll", rollerId: target.id, purpose: ctx.kind === "concentration" ? "concentration" : "save", natural: roll.total - roll.modifier, total: roll.total, against: ctx.dc,
    outcome: result.success ? "success" : "failure", label: ctx.label
  }, target.id)?.outcome;
  state.saveOverride = overridden ? { targetId: target.id, outcome: overridden } : undefined;
  if (overridden) {
    result.success = overridden !== "failure";
    result.overridden = overridden;
  }
  if (!result.success && ctx.kind !== "concentration") {
    const resistance = legendaryResistanceFor(state, definition, target, ctx);
    const usesLeft = resistance ? target.resources?.[resistance.resourceId] ?? 0 : 0;
    const use = resistance
      ? askDecision<LegendaryResistanceRequest>(state, {
        kind: "legendary-resistance", combatantId: target.id, feature: resistance.feature, ability: ctx.ability, dc: ctx.dc,
        rolled: roll.total, usesLeft, against: ctx.label, aiChoice: wantsLegendaryResistance(target, ctx)
      }, target.id)?.use ?? wantsLegendaryResistance(target, ctx)
      : false;
    if (resistance && use) {
      const remaining = (target.resources?.[resistance.resourceId] ?? 0) - 1;
      target.resources = { ...(target.resources ?? {}), [resistance.resourceId]: remaining };
      result.success = true;
      result.legendaryResistance = { feature: resistance.feature, resourceId: resistance.resourceId, remaining };
      state.log.push(event(state, "LegendaryResistanceUsed", `${target.displayName} uses ${resistance.feature} and succeeds instead (${remaining} left)`, {
        combatantId: target.id, resourceId: resistance.resourceId, next: remaining, roll: roll.total, dc: ctx.dc
      }));
    }
  }
  return result;
}

/** What `target`'s saving throw adds to the d20, and whether it has advantage: shared by `rollSavingThrow` and the previews. Pure. */
export function saveRollInputs(state: EngineState, target: CombatantState, ctx: SaveContext): {
  bonus: number;
  featureBonus: { total: number; sources: string[] };
  featureAdvantage: { applied: boolean; sources: string[] };
} {
  const definition = getDefinition(state.snapshot, target);
  const base = (definition.saves?.[ctx.ability] ?? abilityModifier(definition.abilities[ctx.ability]))
    + conditionSaveModifier(target, ctx.ability);
  const featureBonus = featureSaveModifier(state, definition, target, ctx.ability);
  const featureAdvantage = featureSaveAdvantageModifier(state, definition, target, ctx);
  return { bonus: base + featureBonus.total + (ctx.situationalBonus ?? 0), featureBonus, featureAdvantage };
}

/** Whether `target` could turn a failed save like this into a success with Legendary Resistance (and has a use left). */
export function hasLegendaryResistanceFor(state: EngineState, target: CombatantState, ctx: SaveContext): boolean {
  return legendaryResistanceFor(state, getDefinition(state.snapshot, target), target, ctx) !== undefined;
}

/** The first `auto-succeed-save` feature this creature can still pay for that covers this save. */
function legendaryResistanceFor(
  state: EngineState, definition: CreatureDefinition, target: CombatantState, ctx: SaveContext
): { feature: string; resourceId: string } | undefined {
  for (const feature of featureSources(definition, target)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind === "auto-succeed-save"
        && (target.resources?.[effect.resourceId] ?? 0) >= 1
        && saveAdvantageApplies({ kind: "save-advantage", against: effect.against }, ctx)) {
        return { feature: feature.name, resourceId: effect.resourceId };
      }
    }
  }
  return undefined;
}

function featureSaveDcModifier(
  definition: CreatureDefinition,
  action: SaveActionDefinition | AreaSaveActionDefinition,
  caster?: CombatantState
): { total: number; sources: string[] } {
  let total = 0;
  const sources: string[] = [];
  for (const feature of featureSources(definition, caster)) {
    for (const effect of feature.effects ?? []) {
      if (effect.kind !== "save-dc-bonus") {
        continue;
      }
      if (effect.actionIds && !effect.actionIds.includes(upcastBaseId(action.id))) {
        continue;
      }
      if (effect.spellsOnly && action.spellLevel === undefined) {
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
  const dc = resolveFeatureSaveDc(effect.save, definition);
  const save = rollSavingThrow(state, target, { ability: saveAbility, dc, kind: "feature", sourceAction: saveSourceOf(action) });
  const { roll: saveRoll, success, featureBonus: featureSaveBonus, featureAdvantage: featureSaveAdvantage } = save;

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
  return save.dc ?? defaultSaveDc(definition, save.ability);
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
  if ("actionIds" in effect && effect.actionIds && !effect.actionIds.includes(upcastBaseId(action.id))) {
    return false;
  }
  if ("attackTypes" in effect && effect.attackTypes && !effect.attackTypes.includes(action.attackType)) {
    return false;
  }
  if ("spellsOnly" in effect && effect.spellsOnly && action.spellLevel === undefined) {
    return false;
  }
  if ("damageTypes" in effect && effect.damageTypes
    && !action.damage.some((component) => effect.damageTypes!.includes(component.damageType))) {
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
  const chargeFeet = "chargeFeet" in effect ? effect.chargeFeet : undefined;
  if (!whileConditionHeld(attacker, effect)) return false;
  return required.every((condition) => featureConditionMet(state, attacker, target, condition, context, chargeFeet))
    && (alternatives.length === 0 || alternatives.some((condition) => featureConditionMet(state, attacker, target, condition, context, chargeFeet)));
}

function featureConditionMet(
  state: EngineState,
  attacker: CombatantState,
  target: CombatantState,
  condition: FeatureCondition,
  context: AttackFeatureContext,
  chargeFeet?: number
): boolean {
  if (condition === "always") return true;
  if (condition === "charged") return hasChargedAt(state.snapshot, attacker, target, chargeFeet ?? 20);
  if (condition === "target-injured") return target.currentHp < getDefinition(state.snapshot, target).maxHp;
  if (condition === "target-surprised") return (target.conditions ?? []).some((instance) => instance.name === "surprised");
  if (condition === "target-grappled-by-self") return holdConditions(target, attacker.id).length > 0;
  if (condition === "attack-has-advantage") return context.rollMode === "advantage";
  if (condition === "attack-has-no-disadvantage") return context.rollMode !== "disadvantage";
  if (condition === "ally-adjacent-to-target") {
    return state.snapshot.combatants.some((combatant) => combatant.id !== attacker.id
      && effectiveFaction(state.snapshot, combatant) === effectiveFaction(state.snapshot, attacker)
      && combatant.state === "active"
      && spatialDistance(state.snapshot, combatant, target) <= 5);
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
  if (!whileConditionHeld(combatant, effect)) return false;
  return required.every((condition) => selfFeatureConditionMet(definition, combatant, condition))
    && (alternatives.length === 0 || alternatives.some((condition) => selfFeatureConditionMet(definition, combatant, condition)));
}

/** An effect that works only while its bearer holds a condition (Frenzy while raging): whether it does now. */
function whileConditionHeld(bearer: CombatantState, effect: FeatureEffect): boolean {
  const required = "whileCondition" in effect ? effect.whileCondition : undefined;
  return !required || (bearer.conditions ?? []).some((condition) => condition.id === required);
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

/** Proficiency bonus from a character's level (or 1): the fallback when a definition doesn't state one. */
export function proficiencyFromDefinition(definition: CreatureDefinition): number {
  const level = definition.character?.level ?? definition.character?.classes?.reduce((sum, entry) => sum + entry.level, 0) ?? 1;
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

/** Proficiency bonus a challenge rating gives (5e DMG table); the SRD generator's `proficiencyForCr` uses the same. */
export function proficiencyForChallengeRating(cr: number): number {
  if (cr < 5) return 2;
  if (cr < 9) return 3;
  if (cr < 13) return 4;
  if (cr < 17) return 5;
  if (cr < 21) return 6;
  if (cr < 25) return 7;
  if (cr < 29) return 8;
  return 9;
}

function resolveConcentration(state: EngineState, combatant: CombatantState, damageTaken: number): void {
  if (!combatant.concentration) {
    return;
  }
  const definition = getDefinition(state.snapshot, combatant);
  const dc = Math.max(10, Math.floor(damageTaken / 2));
  const save = rollSavingThrow(state, combatant, { ability: "con", dc, kind: "concentration" });
  const { roll, success, featureBonus: featureSaveBonus, featureAdvantage: featureSaveAdvantage } = save;
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
  for (const inside of state.snapshot.combatants) if (inside.containedBy === combatant.id) inside.position = { ...(cells[0] as Point) };
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
    for (const inside of state.snapshot.combatants) if (inside.containedBy === combatant.id) inside.position = { ...to };
    movedCells.push(to);
    applyZoneMovementDamage(state, combatant, to);
    if (combatant.state !== "active") {
      return movedCells;
    }
  }
  return movedCells;
}

/**
 * Spike Growth-style automatic damage: one roll per grid step whose
 * destination lands inside a zone with `movementDamage` set — no save,
 * independent of `applyZoneEffect`'s save-gated on-enter/turn-boundary path.
 * Called per step from `moveAlongPath`, same granularity as the opportunity-
 * attack check beside it.
 */
function applyZoneMovementDamage(state: EngineState, mover: CombatantState, to: Point): void {
  const zones = state.snapshot.activeZones;
  if (!zones?.length) {
    return;
  }
  const distancePerSquare = state.snapshot.map.grid.distancePerSquare;
  for (const zone of zones) {
    if (!zone.movementDamage || !cellIntersectsArea(to, zone.origin, zone.area, distancePerSquare)) {
      continue;
    }
    const source = state.snapshot.combatants.find((combatant) => combatant.id === zone.sourceCombatantId) ?? mover;
    if (zone.affects === "hostile" && effectiveFaction(state.snapshot, source) === effectiveFaction(state.snapshot, mover)) {
      continue;
    }
    const sourceDefinition = getDefinition(state.snapshot, source);
    applyDamageComponents(
      state,
      mover,
      [{ dice: zone.movementDamage.dice, damageType: zone.movementDamage.damageType }],
      sourceDefinition,
      false,
      {},
      source.id
    );
    if (mover.state !== "active") {
      return;
    }
  }
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
  to: Point,
  altitudes?: { from?: number; to?: number }
): AttackActionDefinition | undefined {
  return preferredLeaveReach(leaveReachReactions(snapshot, reactor, mover, from, to, altitudes));
}

/**
 * Every melee attack `reactor` could punish `mover` with for leaving its reach on the step `from → to`: compiled
 * `"reaction"` copies (authored / weapon-derived, trigger `enemy-leaves-reach`) and plain `"action"`-typed melee attacks
 * (the universal "any melee weapon threatens an OA" rule) unless explicitly barred (`opportunityAttack === false`).
 */
function leaveReachReactions(
  snapshot: EncounterSnapshot,
  reactor: CombatantState,
  mover: CombatantState,
  from: Point,
  to: Point,
  altitudes?: { from?: number; to?: number }
): AttackActionDefinition[] {
  if (effectiveFaction(snapshot, reactor) === effectiveFaction(snapshot, mover) || !canAct(reactor, "reaction")) {
    return [];
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
    } else if (action.actionType !== "action" || action.opportunityAttack === false || action.item) {
      // An item's attack (a flask) is an action of its own, never the "any melee attack" opportunity attack.
      return false;
    }
    if (!canSpendResource(reactor, action)) {
      return false;
    }
    const reach = action.reach ?? action.range;
    const wasInReach = spatialDistance(snapshot, reactor, mover, { b: from, bAltitude: altitudes?.from }) <= reach;
    const leavesReach = spatialDistance(snapshot, reactor, mover, { b: to, bAltitude: altitudes?.to }) > reach;
    return wasInReach && leavesReach
      && (!snapshot.rules.requireLineOfEffect || lineOfEffect(snapshot.map, reactor.position, from));
  };
  return getExecutableActions(definition).filter(eligible);
}

/** The opportunity attack the AI makes: an authored reaction copy over the synthesised "any melee attack" one. */
function preferredLeaveReach(actions: AttackActionDefinition[]): AttackActionDefinition | undefined {
  return actions.find((action) => action.actionType === "reaction") ?? actions[0];
}

/** The opportunity attacks to offer a player: one per attack, the reaction copy rather than the action it was compiled from. */
function distinctOpportunityAttacks(actions: AttackActionDefinition[]): AttackActionDefinition[] {
  const byAttack = new Map<string, AttackActionDefinition>();
  for (const action of actions) {
    const key = action.id.replace(/:reaction(?=:|$)/, "");
    const seen = byAttack.get(key);
    if (!seen || (seen.actionType !== "reaction" && action.actionType === "reaction")) byAttack.set(key, action);
  }
  return [...byAttack.values()];
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
  /** Level of the spell being cast (`enemy-casts-spell`): the slot it's cast with. */
  spellLevel?: number;
  /** What the spell is being cast at (`enemy-casts-spell`), for a counterer weighing whether to stop it. */
  declared?: DeclaredCast;
  /** The triggering attack's type — for `meleeOnly` triggers. */
  attackType?: AttackActionDefinition["attackType"];
  /** Movement step, for `enemy-leaves-reach`. */
  from?: Point;
  to?: Point;
  /** The mover's altitude before / after the step, when the step is (or includes) rising or dropping. */
  fromAltitude?: number;
  toAltitude?: number;
  /** The triggering attack or spell, for a prompt: what it is, and the roll against the AC once it's been made. */
  actionId?: Id;
  actionName?: string;
  attackTotal?: number;
  attackNatural?: number;
  targetAc?: number;
  /** Damage the triggering hit dealt (`hit-by-attack`). */
  damageTaken?: number;
}

export interface ReactionWindowResult {
  /** A Counterspell landed — the calling spell resolver must abort with an empty result. */
  countered?: boolean;
  /** A Protection-style reaction forces the triggering attack roll to disadvantage. */
  imposedDisadvantage?: boolean;
  /** Conditions a reaction gave that last for the triggering attack only (Parry): removed once it's resolved. */
  endsAfterAttack?: Array<{ combatantId: Id; conditionId: Id }>;
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
    case "would-be-hit": {
      // Only when it would turn this hit into a miss: what it gives must lift the AC past the roll.
      const gain = reactionArmorClassGain(action);
      return reactor.id === event.targetId
        && (!trigger.meleeOnly || event.attackType === "melee")
        && gain > 0 && event.attackTotal !== undefined && event.targetAc !== undefined
        && event.attackTotal < event.targetAc + gain;
    }
    case "ally-targeted-by-attack": {
      if (!event.targetId || reactor.id === event.targetId) {
        return false;
      }
      const ally = state.snapshot.combatants.find((c) => c.id === event.targetId);
      if (!ally || effectiveFaction(state.snapshot, ally) !== effectiveFaction(state.snapshot, reactor)) {
        return false;
      }
      // `gridDistance` already returns feet.
      return spatialDistance(state.snapshot, reactor, ally) <= trigger.withinFt;
    }
    case "enemy-casts-spell": {
      const caster = state.snapshot.combatants.find((c) => c.id === event.sourceId);
      if (!caster || effectiveFaction(state.snapshot, caster) === effectiveFaction(state.snapshot, reactor) || event.spellLevel == null || event.origin === undefined) {
        return false;
      }
      if (trigger.maxSpellLevel != null && event.spellLevel > trigger.maxSpellLevel) {
        return false;
      }
      const withinRange = spatialDistanceToPoint(state.snapshot, reactor, event.origin) <= trigger.withinFt;
      // A spell no higher than the counter's slot is stopped outright; one above it takes the check, if it has one.
      const counterSlot = "resourceCost" in action ? spellSlotLevel(action.resourceCost?.resourceId) : undefined;
      return withinRange && counterSlot != null && (counterSlot >= event.spellLevel || Boolean(trigger.checkAbove));
    }
    case "manual":
      return false;
  }
}

/** Rough mean of every dice expression in a damage list (used only for AI gating, not resolution). */
function roughAverageDamage(components: ReadonlyArray<{ dice: string }> | undefined): number {
  let total = 0;
  for (const component of components ?? []) {
    try {
      const parsed = parseDiceExpression(component.dice);
      total += parsed.modifier + parsed.terms.reduce((sum, term) => sum + term.sign * term.count * (term.sides + 1) / 2, 0);
    } catch {
      // unparseable expression — ignore
    }
  }
  return total;
}

/** How much a reaction raises its reactor's AC while it lasts (Shield's +5, a Parry's +2). */
function reactionArmorClassGain(action: ActionDefinition): number {
  return action.kind === "activate-feature" ? action.condition?.modifiers?.armorClass ?? 0 : 0;
}

/** Value gate for `priority: "worthwhile"`: fire only when the reaction is clearly worth the slot. */
function reactionClearsValueBar(state: EngineState, reaction: EligibleReaction, event: ReactionEvent): boolean {
  const { action, meta } = reaction;
  if (meta.trigger.kind === "would-be-hit") {
    // It's only offered when it turns a hit into a miss: always worth it.
    return true;
  }
  if (meta.trigger.kind === "enemy-casts-spell") {
    // Counters are weighed together, slot by slot (`counterOutlook`); this is only the fallback's bar.
    return (event.spellLevel ?? 0) >= 2;
  }
  if (meta.trigger.kind === "ally-targeted-by-attack") {
    const ally = state.snapshot.combatants.find((c) => c.id === event.targetId);
    const allyDefinition = ally ? getDefinition(state.snapshot, ally) : undefined;
    return !!ally && !!allyDefinition && ally.currentHp * 2 <= allyDefinition.maxHp;
  }
  // A damaging reaction (Hellish Rebuke) is worth it once it averages ~4+.
  return (action.kind === "attack" || action.kind === "save" || action.kind === "area-save")
    && roughAverageDamage(action.damage) >= 4;
}

/**
 * Every reaction `reactor` could take for `event`, whatever the AI would make of it, in the creature's own order.
 * A player is offered all of them; `aiReactionPick` is the AI's choice among them. A higher slot that adds nothing
 * (Shield with a 2nd-level slot while a 1st is left) isn't one of them.
 */
function reactionOptionsFor(
  state: EngineState,
  reactor: CombatantState,
  event: ReactionEvent
): EligibleReaction[] {
  if (!canAct(reactor, "reaction")) {
    return [];
  }
  const definition = getDefinition(state.snapshot, reactor);
  const options: EligibleReaction[] = [];
  for (const action of getExecutableActions(definition)) {
    if (action.actionType !== "reaction" || action.automationSupport !== "full" || !canSpendResource(reactor, action) || isDominatedUpcast(reactor, action)) {
      continue;
    }
    const meta = reactionMetaFor(action);
    if (!meta || !reactionTriggerPasses(state, reactor, meta.trigger, event, action)) {
      continue;
    }
    const targetId = meta.target === "self"
      ? reactor.id
      : meta.target === "trigger-target"
        ? event.targetId ?? event.sourceId
        : event.sourceId;
    options.push({ reactor, action: action as EligibleReaction["action"], meta, targetId });
  }
  return options;
}

/** The reaction the AI takes: the first that isn't left to a human (`"manual"`) and, if only `"worthwhile"`, is worth it. */
function aiReactionPick(state: EngineState, options: EligibleReaction[], event: ReactionEvent): EligibleReaction | undefined {
  return options.find((reaction) => reaction.meta.priority !== "manual"
    && !(reaction.meta.priority === "worthwhile" && !reactionClearsValueBar(state, reaction, event)));
}

/* ─── Counters: which slot, or none ───────────────────────────────────────────
 * The engine knows the rules: which slot stops which spell outright, and the check a lower slot needs. Whether a spell
 * is worth stopping, and with which slot, is the AI's call (`assessCounter`, simulation.ts), which registers itself
 * here because the AI module imports this one, not the other way round.
 */

/** What a spell is being cast at, as declared: its targets (one per beam, for beams), and an area's placement. */
export interface DeclaredCast {
  targetIds: Id[];
  origin?: Point;
  aimVector?: AimVector;
}

export interface CounterAdvice {
  snapshot: EncounterSnapshot;
  reactor: CombatantState;
  caster: CombatantState;
  /** The spell as it's being cast, when the counterer can see it (`rules.counterspellReadsSpell`). */
  spell?: { action: ActionDefinition; declared: DeclaredCast };
  /** The level the counterer judges by: the spell's own, or with the spell unseen a guess from the caster's sheet. */
  level: number;
  /** Each slot it could counter with, and the chance it stops a spell of `level`. */
  options: Array<{ actionId: Id; slot: number; chance: number; priority: ReactionMeta["priority"] }>;
}

export interface CounterAssessment {
  threat: SpellThreat;
  /** Each option's worth: chance × threat, less what the slot and the reaction cost. */
  scores: Array<{ actionId: Id; score: number; slotCost: number }>;
  /** The option it takes, if any is worth it. */
  pick?: Id;
}

export type CounterAdvisor = (advice: CounterAdvice) => CounterAssessment;

let counterAdvisor: CounterAdvisor | undefined;

/** Register the AI's counter judgement (simulation.ts does on load). `undefined` puts back the level-only fallback. */
export function setCounterAdvisor(advisor: CounterAdvisor | undefined): void {
  counterAdvisor = advisor;
}

/** A spell's own name, without the slot its copy names: "Fireball (upcast to slot 5)" → "Fireball". */
export function spellNameOf(name: string | undefined): string {
  return (name ?? "the spell").replace(/ \(upcast to slot \d+\)$/, "");
}

/** A spell valued by its level alone: when its effect can't be read, or the counterer can't see what it is. */
export function threatByLevel(level: number): SpellThreat {
  return { total: 6 * level, basis: "level", creatures: [] };
}

/** Without the AI module: counter a spell of 2nd level or higher with the cheapest slot that's sure to stop it. */
function fallbackCounterAssessment(advice: CounterAdvice): CounterAssessment {
  const threat = threatByLevel(advice.level);
  const scores = advice.options.map((option) => ({ actionId: option.actionId, score: option.chance * threat.total - option.slot * 4, slotCost: option.slot * 4 }));
  const sure = advice.options.filter((option) => option.chance >= 1 && option.priority !== "manual").sort((a, b) => a.slot - b.slot)[0];
  return { threat, scores, pick: advice.level >= 2 ? sure?.actionId : undefined };
}

/** The level a counterer guesses a spell it can't see is cast at: the caster's highest slot, else its highest spell. */
function guessedCastLevel(definition: CreatureDefinition): number {
  const slots = Object.keys(definition.resources ?? {}).map((resourceId) => spellSlotLevel(resourceId) ?? 0);
  const spells = (definition.spells ?? []).map((spell) => spell.level);
  return Math.max(1, ...slots, ...spells);
}

/** The check a counter makes against a spell above its slot: its own, or none (`checkAbove: false`). */
function counterCheckOf(meta: ReactionMeta): CounterCheck | undefined {
  return meta.trigger.kind === "enemy-casts-spell" && meta.trigger.checkAbove ? meta.trigger.checkAbove : undefined;
}

/** The reactor's bonus to a counter's check: its spellcasting ability, plus the check's own bonus. */
function counterCheckModifier(definition: CreatureDefinition, check: CounterCheck): number {
  return abilityModifier(definition.abilities[spellcastingAbility(definition)]) + (check.bonus ?? 0);
}

/** Chance a counter cast with `slot` stops a spell of `level`: certain at or below its slot, else the check's. */
function counterChance(slot: number, level: number, check: CounterCheck | undefined, modifier: number): number {
  if (slot >= level) return 1;
  if (!check) return 0;
  return Math.min(1, Math.max(0, (21 - (check.dcBase + level - modifier)) / 20));
}

interface CounterOutlook {
  /** Whether the counterer can see the spell (`rules.counterspellReadsSpell`). */
  known: boolean;
  threat: SpellThreat;
  odds: Map<Id, CounterOdds>;
  assessment: CounterAssessment;
  pick?: EligibleReaction;
}

/** How each slot `reactor` could counter with would fare against the spell, and which (if any) the AI takes. */
function counterOutlook(state: EngineState, reactor: CombatantState, options: EligibleReaction[], ev: ReactionEvent): CounterOutlook {
  const snapshot = state.snapshot;
  const caster = findCombatant(snapshot, ev.sourceId);
  const casterDefinition = getDefinition(snapshot, caster);
  const reactorDefinition = getDefinition(snapshot, reactor);
  const known = snapshot.rules.counterspellReadsSpell !== false;
  const action = ev.actionId ? findActionDefinition(casterDefinition, ev.actionId) : undefined;
  const trueLevel = ev.spellLevel ?? 0;
  const level = known ? trueLevel : guessedCastLevel(casterDefinition);
  const odds = new Map<Id, CounterOdds>();
  const adviceOptions: CounterAdvice["options"] = [];
  for (const option of options) {
    const slot = spellSlotLevel("resourceCost" in option.action ? option.action.resourceCost?.resourceId : undefined) ?? 0;
    const check = counterCheckOf(option.meta);
    const modifier = check ? counterCheckModifier(reactorDefinition, check) : 0;
    odds.set(option.action.id, {
      slot,
      ...(check ? { check: { dcBase: check.dcBase, modifier } } : {}),
      ...(known ? { chance: counterChance(slot, trueLevel, check, modifier), ...(check && slot < trueLevel ? { dc: check.dcBase + trueLevel } : {}) } : {})
    });
    adviceOptions.push({ actionId: option.action.id, slot, chance: counterChance(slot, level, check, modifier), priority: option.meta.priority });
  }
  const advice: CounterAdvice = {
    snapshot, reactor, caster, level, options: adviceOptions,
    ...(known && action && ev.declared ? { spell: { action, declared: ev.declared } } : {})
  };
  const assessment = (counterAdvisor ?? fallbackCounterAssessment)(advice);
  return {
    known,
    threat: assessment.threat,
    odds,
    assessment,
    pick: options.find((option) => option.action.id === assessment.pick)
  };
}

/** The AI's counter decision, with its numbers, so a DM can see why it did (or didn't) counter. */
function logCounterDecision(state: EngineState, reactor: CombatantState, ev: ReactionEvent, outlook: CounterOutlook): void {
  const spell = outlook.known ? `${spellNameOf(ev.actionName)} at level ${ev.spellLevel}` : "the spell";
  const threat = Math.round(outlook.threat.total);
  const picked = outlook.assessment.scores.find((score) => score.actionId === outlook.pick?.action.id);
  const odds = outlook.pick ? outlook.odds.get(outlook.pick.action.id) : undefined;
  const chance = odds?.chance !== undefined && odds.chance < 1 ? ` (${Math.round(odds.chance * 100)}% with the check)` : "";
  const message = outlook.pick
    ? `${reactor.displayName} counters ${spell} with a level ${odds?.slot} slot${chance}: threat ≈${threat}${outlook.threat.basis === "level" ? " (valued by level)" : ""}, slot cost ${Math.round(picked?.slotCost ?? 0)}`
    : `${reactor.displayName} lets ${spell} through: threat ≈${threat}${outlook.threat.basis === "level" ? " (valued by level)" : ""} isn't worth a slot`;
  state.log.push(event(state, "AiDecision", message, {
    combatantId: reactor.id,
    counterActionId: outlook.pick?.action.id,
    spellActionId: ev.actionId,
    threat: outlook.threat,
    options: outlook.assessment.scores.map((score) => ({ ...score, ...outlook.odds.get(score.actionId) }))
  }));
}

function reactionContext(ev: ReactionEvent): ReactionContext {
  return {
    attack: ev.actionId && ev.attackType
      ? { actionId: ev.actionId, actionName: ev.actionName ?? "", attackType: ev.attackType, total: ev.attackTotal, natural: ev.attackNatural, targetAc: ev.targetAc }
      : undefined,
    spell: ev.kind === "enemy-casts-spell" && ev.actionId
      ? { actionId: ev.actionId, name: ev.actionName ?? "", level: ev.spellLevel ?? 0 }
      : undefined,
    step: ev.from && ev.to ? { from: ev.from, to: ev.to } : undefined,
    damageTaken: ev.damageTaken
  };
}

function reactionOptionOf(action: ActionDefinition, targetId: Id): ReactionOption {
  return { actionId: action.id, name: action.name, resourceCost: "resourceCost" in action ? action.resourceCost : undefined, targetId };
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
        const actions = leaveReachReactions(state.snapshot, reactor, source, ev.from, ev.to, { from: ev.fromAltitude, to: ev.toAltitude });
        let action = preferredLeaveReach(actions);
        if (!action) {
          continue;
        }
        if (state.decide) {
          const answer = askDecision<ReactionRequest>(state, {
            kind: "reaction", reactorId: reactor.id, trigger: "enemy-leaves-reach", sourceId: source.id,
            options: distinctOpportunityAttacks(actions).map((option) => reactionOptionOf(option, source.id)),
            aiChoice: action.id, context: reactionContext(ev)
          }, reactor.id);
          if (answer) {
            action = answer.actionId === null ? undefined : actions.find((option) => option.id === answer.actionId) ?? action;
          }
          if (!action) {
            continue;
          }
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
      const options = reactionOptionsFor(state, reactor, ev);
      if (options.length === 0) {
        continue;
      }
      // A counter is weighed slot by slot against what the spell would do; anything else takes the first worth it.
      const outlook = ev.kind === "enemy-casts-spell" ? counterOutlook(state, reactor, options, ev) : undefined;
      let reaction = outlook ? outlook.pick : aiReactionPick(state, options, ev);
      let answered = false;
      if (state.decide) {
        const context = reactionContext(ev);
        const answer = askDecision<ReactionRequest>(state, {
          kind: "reaction", reactorId: reactor.id, trigger: ev.kind, sourceId: ev.sourceId, targetId: ev.targetId,
          options: options.map((option) => ({
            ...reactionOptionOf(option.action, option.targetId),
            ...(outlook ? { counter: outlook.odds.get(option.action.id) } : {})
          })),
          aiChoice: reaction?.action.id ?? null,
          context: outlook && context.spell ? { ...context, spell: outlook.known ? { ...context.spell, known: true, threat: outlook.threat } : { actionId: "", name: "", level: 0, known: false } } : context
        }, reactor.id);
        if (answer) {
          answered = true;
          reaction = answer.actionId === null ? undefined : options.find((option) => option.action.id === answer.actionId) ?? reaction;
        }
      }
      if (outlook && !answered) {
        logCounterDecision(state, reactor, ev, outlook);
      }
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
      if (outcome.endsAfterAttack) {
        result.endsAfterAttack = [...(result.endsAfterAttack ?? []), ...outcome.endsAfterAttack];
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
      // Counterspell: spend the reaction (+ its slot). A spell no higher than the slot is stopped; above it, the check.
      resolveActivateFeatureAction(state, reactor.id, action.id);
      const slot = spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined) ?? 0;
      const level = ev.spellLevel ?? 0;
      const check = counterCheckOf(meta);
      if (slot >= level) return { countered: true };
      if (!check) return {};
      return counterCheck(state, reactor, check, level, ev) ? { countered: true } : {};
    }
    switch (action.kind) {
      case "attack": {
        const asReaction = action.actionType === "reaction" ? action : { ...action, actionType: "reaction" as const };
        const target = findCombatant(state.snapshot, targetId);
        if (action.autoHit) {
          // Damage that lands without a roll (a goliath's Storm's Thunder): spend the reaction, then hit.
          validateTargeting(state.snapshot, reactor, target, asReaction);
          validateAndSpendAction(reactor, asReaction);
          declareAction(state, reactor, asReaction, { target });
          resolveAutoHitBeam(state, reactor, target, reactorDefinition, asReaction);
          return {};
        }
        resolveAttackCore(state, reactor, target, reactorDefinition, asReaction, {}, true);
        return {};
      }
      case "save":
        resolveSaveAction(state, reactor.id, targetId, action.id);
        return {};
      case "area-save":
        resolveAreaSaveAction(state, reactor.id, findCombatant(state.snapshot, targetId).position, action.id);
        return {};
      case "activate-feature": {
        const { conditionId } = resolveActivateFeatureAction(state, reactor.id, action.id);
        if (!conditionId || !meta.lastsFor) return {};
        if (meta.lastsFor === "triggering-attack") return { endsAfterAttack: [{ combatantId: reactor.id, conditionId }] };
        const condition = reactor.conditions?.find((candidate) => candidate.id === conditionId);
        if (condition) {
          const reactorIndex = state.snapshot.combatants.findIndex((combatant) => combatant.id === reactor.id);
          condition.expiresAt = riderDurationToExpiry(state, { kind: "until-start-of-next-turn" }, reactorIndex >= 0 ? reactorIndex : undefined).expiresAt;
        }
        return {};
      }
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
 * A counter cast with a slot below the spell's level: a check with the reactor's spellcasting ability against
 * `dcBase` + the spell's level. A DM may overrule it in Play. Whether it stopped the spell.
 */
function counterCheck(state: EngineState, reactor: CombatantState, check: CounterCheck, level: number, ev: ReactionEvent): boolean {
  const definition = getDefinition(state.snapshot, reactor);
  const dc = check.dcBase + level;
  const roll = rollDice(withBonus("1d20", counterCheckModifier(definition, check)), state.rng);
  const spell = ev.actionName ?? "the spell";
  const overridden = askDecision<RollRequest>(state, {
    kind: "roll", rollerId: reactor.id, purpose: "check", natural: roll.total - roll.modifier, total: roll.total, against: dc,
    outcome: roll.total >= dc ? "success" : "failure", label: `Counter ${spell}`
  }, reactor.id)?.outcome;
  const success = overridden ? overridden !== "failure" : roll.total >= dc;
  state.log.push(event(state, "CounterspellCheck", `${reactor.displayName} ${success ? "stops" : "fails to stop"} ${spell} (rolled ${roll.total} vs DC ${dc}${overridden ? ", DM override" : ""})`, {
    combatantId: reactor.id, casterId: ev.sourceId, actionId: ev.actionId, spellLevel: level, roll, dc, success, ...(overridden ? { overridden } : {})
  }));
  return success;
}

/**
 * Counterspell window for a spell resolver. Call right after the caster's action
 * + slot are spent and the action is declared; a `true` return means the spell
 * was countered and the resolver must return an empty result.
 */
function counterspellWindow(state: EngineState, caster: CombatantState, action: ActionDefinition, declared: DeclaredCast): boolean {
  const spellLevel = castLevelOf(action);
  if (spellLevel == null) {
    return false;
  }
  const { countered } = runReactionWindow(state, {
    kind: "enemy-casts-spell",
    sourceId: caster.id,
    origin: caster.position,
    spellLevel,
    actionId: action.id,
    actionName: action.name,
    declared
  });
  if (countered) {
    state.log.push(event(state, "SpellCountered", `${caster.displayName}'s ${action.name} was countered`, {
      casterId: caster.id, actionId: action.id, spellLevel
    }));
  }
  return countered === true;
}

/**
 * The level a spell is cast at: the slot it spends (an upcast Fireball with a 5th-level slot is a 5th-level spell, and
 * a warlock's pact slot casts at its own level), or its printed level when it spends no slot. Undefined for anything
 * that isn't a spell.
 */
export function castLevelOf(action: ActionDefinition): number | undefined {
  if (!("spellLevel" in action) || action.spellLevel == null) return undefined;
  return spellSlotLevel("resourceCost" in action ? action.resourceCost?.resourceId : undefined) ?? action.spellLevel;
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
