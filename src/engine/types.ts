import { z } from "zod";

export const ENCOUNTER_SCHEMA_VERSION = 1;

export type Id = string;
export type Faction = "party" | "enemy" | "neutral";
/**
 * Which slot an action spends. `"free"` spends none of the action / bonus /
 * reaction economy (Action Surge's own activation, a Reckless-Attack toggle) —
 * it still runs the `canAct` state/condition checks and pays any `resourceCost`.
 */
export type ActionType = "action" | "bonus" | "reaction" | "free";
export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type SizeCategory = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
export type TerrainType = "normal" | "difficult" | "impassable" | "hazard" | "cover" | "elevation" | "custom";
/** How much an obstacle shields a creature on the far side of it (5e cover). */
export type CoverLevel = "none" | "half" | "three-quarters" | "total";
export type TacticsProfile =
  | "basic-melee"
  | "basic-ranged"
  | "skirmisher"
  | "brute"
  | "defender"
  | "controller";
/**
 * DM-assigned appetite for spending limited-use resources (spell slots, per-encounter
 * recharges). Scales the AI's existing resource-cost scoring penalty — see
 * `resourceStanceMultiplier()` in simulation.ts. Independent of tactics profile.
 */
export type ResourceStance = "conservative" | "balanced" | "liberal";
/**
 * DM-assigned combat flags that bias AI targeting/protection/healing decisions
 * independent of tactics profile. See `TAG_PRIORITY_VALUE` and `tacticsSettings()`
 * in simulation.ts for how each tag is weighted per profile.
 */
export type ActorTag = "high-priority" | "low-priority" | "protected";
export type ConditionName =
  | "blinded"
  | "charmed"
  | "deafened"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "unconscious"
  | "custom";
export type DamageType =
  | "acid"
  | "bludgeoning"
  | "cold"
  | "fire"
  | "force"
  | "lightning"
  | "necrotic"
  | "piercing"
  | "poison"
  | "psychic"
  | "radiant"
  | "slashing"
  | "thunder";
export type DamageTypeReference = DamageType | "same-as-attack";

export interface Point {
  x: number;
  y: number;
}

export interface WallSegment {
  id: Id;
  start: Point;
  end: Point;
  /** Independent — a creature cannot path through this segment. */
  blocksMovement: boolean;
  /** Independent — this segment blocks line of sight (vision / the LOS gizmo). */
  blocksSight: boolean;
  /**
   * Independent — this segment blocks line of effect (no shot through it at all).
   * Always `true` when `cover === "total"` (`normalizeWall` pins it); free to set
   * on any other level (e.g. a firing port: `half` cover, blocks projectiles off).
   */
  blocksProjectiles: boolean;
  /** How much AC / Dex-save bonus a creature tucked behind this segment gets (½ / ¾ / total). Its own axis. */
  cover?: CoverLevel;
  doorState?: "open" | "closed" | "locked" | "destroyed";
}

/**
 * Backfill `cover` on a wall from the legacy `blocksProjectiles` flag and keep
 * that flag mirrored to `cover === "total"`. Idempotent; runs on every parse
 * (via the schema) and on the in-memory sample / duplicate paths.
 */
export function normalizeWall(wall: WallSegment): WallSegment {
  const cover: CoverLevel = wall.cover ?? (wall.blocksProjectiles ? "total" : "none");
  return {
    ...wall,
    cover,
    // The three block flags are independent. `cover` is a pure AC / Dex-save
    // axis — except total cover, which always blocks line of effect (5e), so we
    // pin the flag on there; every other level leaves it to the wall's own value.
    blocksProjectiles: cover === "total" ? true : (wall.blocksProjectiles ?? false)
  };
}

export interface TerrainZone {
  id: Id;
  name: string;
  type: TerrainType;
  polygon: Point[];
  movementMultiplier?: number;
  tags?: string[];
}

export interface GridConfig {
  width: number;
  height: number;
  distancePerSquare: number;
  diagonalMode: "standard" | "five-ten-five";
  squareSizePx?: number;
  lineColor?: string;
  lineOpacity?: number;
  lineWidthPx?: number;
}

export interface MapImageSettings {
  offsetX: number;
  offsetY: number;
  scale: number;
  opacity: number;
}

export interface MapCanvasSettings {
  widthPx: number;
  heightPx: number;
}

export interface PlacedTemplate {
  id: Id;
  name: string;
  origin: Point;
  area: AreaTemplate;
  affects: "hostile" | "all";
  color?: string;
}

export interface BattleMapState {
  id: Id;
  name: string;
  grid: GridConfig;
  image?: MapImageSettings;
  canvas?: MapCanvasSettings;
  walls: WallSegment[];
  terrain: TerrainZone[];
  templates?: PlacedTemplate[];
}

export interface TokenVisuals {
  imageUrl?: string;
  portraitUrl?: string;
  scale?: number;
  tint?: string;
  borderColor?: string;
  showNameplate?: boolean;
}

export const DEFAULT_GRID_VISUALS = {
  squareSizePx: 44,
  lineColor: "#202522",
  lineOpacity: 0.18,
  lineWidthPx: 1
} as const;

export const DEFAULT_MAP_IMAGE_SETTINGS: MapImageSettings = {
  offsetX: 0,
  offsetY: 0,
  scale: 100,
  opacity: 1
};

export interface DamageAdjustment {
  type: "resistance" | "immunity" | "vulnerability";
  damageType: DamageType;
  /**
   * When true this adjustment only applies to non-magical damage — a
   * `DamageComponent` marked `magical` bypasses it (5e "resistance to … from
   * nonmagical attacks"). Absent ⇒ applies to all damage of the type.
   */
  nonMagicalOnly?: boolean;
}

export interface NumericFormula {
  base?: number;
  ability?: Ability;
  proficiency?: boolean;
  multiplier?: number;
}

export interface DamageComponent {
  /** Canonical dice expression, e.g. "2d6" or "2d6+1". Always populated after normalization. */
  dice: string;
  /**
   * Structured mirror of `dice`, kept in sync by `normalizeDamageComponent`:
   * parsed from `dice` when it is a clean `NdM(+K)` form, or authored directly by
   * the builder (which then compiles `dice`). Absent for expressions that do not
   * fit that form (a flat "6", a mixed "2d6+1d4").
   */
  diceCount?: number;
  diceSize?: number;
  /**
   * Flat, unconditional addend. Summed with `abilityModifier` and `bonusFormula`
   * at resolve time — it does not replace them. Mirrors the `+K` tail of `dice`.
   */
  flatBonus?: number;
  damageType: DamageTypeReference;
  abilityModifier?: Ability;
  bonusFormula?: NumericFormula;
  /**
   * This component's damage counts as magical — it ignores non-magical
   * resistance / immunity — regardless of any `bonusFormula`.
   */
  magical?: boolean;
  /** Level-driven dice growth (cantrip scaling, per-slot upcast). Resolved by `resolveScaledDamage`. */
  scaling?: DamageScaling;
}

export type DamageScaling =
  | { mode: "cantrip-by-level"; steps: Array<{ atLevel: number; dice: string }> }
  | { mode: "per-slot-above-base"; dice: string };

export type FeatureCondition =
  | "ally-adjacent-to-target"
  | "attack-has-advantage"
  | "attack-has-no-disadvantage"
  | "target-bloodied"
  | "self-bloodied"
  | "always";

export interface FeatureEffectScope {
  id?: Id;
  actionIds?: Id[];
  attackTypes?: Array<AttackActionDefinition["attackType"]>;
  abilities?: Ability[];
  /** Restrict to compiled spell actions (`action.spellLevel !== undefined`) — any shape, not just attacks. */
  spellsOnly?: boolean;
  /** Restrict to actions that already deal at least one of these damage types (a Frost Staff amplifying cold spells, not adding cold to everything). */
  damageTypes?: DamageTypeReference[];
}

export interface FeatureEffectConditions {
  condition?: FeatureCondition;
  allConditions?: FeatureCondition[];
  anyConditions?: FeatureCondition[];
}

export interface FeatureEffectSaveGate {
  ability: Ability;
  dc?: number;
  dcFormula?: NumericFormula;
  halfDamageOnSuccess?: boolean;
}

export interface FeatureEffectConditionApplication {
  id?: Id;
  name?: ConditionName;
  durationRounds?: number;
  modifiers?: ConditionInstance["modifiers"];
  effects?: FeatureEffect[];
}

export type FeatureEffect =
  | ({
    kind: "attack-advantage";
    condition: FeatureCondition;
    /** Whether the bearer's own attack rolls get advantage or disadvantage. Default `"advantage"`. */
    mode?: "advantage" | "disadvantage";
  } & FeatureEffectScope & Omit<FeatureEffectConditions, "condition">)
  | ({
    kind: "attack-bonus";
    bonus: NumericFormula;
  } & FeatureEffectScope & FeatureEffectConditions)
  | ({
    /**
     * Modifier added to attack rolls made *against* the bearer while active.
     * +5 ≈ attackers have advantage; -5 ≈ disadvantage (matches the crude
     * condition proxy). Read on the target in `resolveAttackCore`.
     */
    kind: "incoming-attack-modifier";
    amount: number;
  } & FeatureEffectConditions)
  | ({
    kind: "damage-bonus";
    damage: DamageComponent[];
    critical?: boolean;
    oncePerTurn?: boolean;
  } & FeatureEffectScope & FeatureEffectConditions)
  | ({
    kind: "save-gated-damage";
    damage: DamageComponent[];
    save: FeatureEffectSaveGate;
    critical?: boolean;
    oncePerTurn?: boolean;
  } & FeatureEffectScope & FeatureEffectConditions)
  | ({
    kind: "apply-condition-on-hit";
    target?: "self" | "target";
    appliedCondition: FeatureEffectConditionApplication;
    oncePerTurn?: boolean;
  } & FeatureEffectScope & FeatureEffectConditions)
  | ({
    kind: "incoming-hit-damage";
    damage: DamageComponent[];
    critical?: boolean;
    consumeCondition?: boolean;
    damageSource?: "triggering-attacker" | "condition-source";
  } & FeatureEffectConditions)
  | ({
    kind: "damage-adjustment";
    adjustment: DamageAdjustment;
  } & FeatureEffectConditions)
  | ({
    kind: "save-advantage";
    ability?: Ability;
  } & FeatureEffectConditions)
  | ({
    kind: "swarm-damage";
    fullHpDamage: DamageComponent[];
    bloodiedDamage?: DamageComponent[];
  } & FeatureEffectScope)
  | {
    kind: "armor-class-bonus";
    bonus: NumericFormula;
  }
  | {
    kind: "save-bonus";
    ability?: Ability;
    bonus: NumericFormula;
  }
  | {
    kind: "save-dc-bonus";
    bonus: NumericFormula;
    actionIds?: Id[];
    /** Restrict to compiled spell actions (`action.spellLevel !== undefined`) instead of listing every spell id by hand. */
    spellsOnly?: boolean;
  }
  | {
    kind: "resource-regain";
    /** `"on-activate"` fires once from `resolveActivateFeatureAction`; the others fire at the bearer's turn boundary. */
    timing: "turn-start" | "turn-end" | "on-activate";
    resourceId: string;
    amount: NumericFormula;
    max?: number;
  }
  | ({
    /**
     * Activating the owning feature hands back a spent economy slot (Action
     * Surge → a second `action`; War Caster → a reaction). Applied by
     * `resolveActivateFeatureAction`.
     */
    kind: "extra-action";
    slot: "action" | "bonus" | "reaction";
  } & FeatureEffectConditions)
  | ({
    /**
     * While this effect is active the creature never provokes opportunity
     * attacks (Mobile, "moves freely"). Checked in `moveCombatant` /
     * `opportunityAttackThreats`.
     */
    kind: "avoids-opportunity-attacks";
  } & FeatureEffectConditions);

export interface ResourceCost {
  resourceId: string;
  amount: number;
}

export interface HealingComponent {
  dice: string;
  /** Structured mirror of `dice` — see `DamageComponent`. */
  diceCount?: number;
  diceSize?: number;
  flatBonus?: number;
  abilityModifier?: Ability;
}

export interface AreaTemplate {
  type: "circle" | "cone" | "line" | "rectangle" | "square";
  /** Circle radius / cone length / line length / rectangle length, in feet. */
  size: number;
  /** Line & rectangle width (full width, not half), in feet. */
  width?: number;
  direction?: "north" | "east" | "south" | "west";
}

/** How an area action's template is placed and aimed. */
export interface AreaTargeting {
  /** `"self"` centres the template on the caster; `"point"` lets them choose one within `range`. */
  origin: "self" | "point";
  /** Cones / lines / rectangles emanate from the caster toward the chosen point. */
  aimedFromSelf?: boolean;
  /** How far the chosen point (or the near edge) may be, in feet. */
  range: number;
}

/* ─── Action riders ─────────────────────────────────────────────────────────────
 * A small, composable effect attached to an attack, save, or area action:
 * "deal this extra damage", "impose this condition on a failed save for N rounds",
 * "shove the target". Replaces hand-authored `FeatureEffect` wiring for the common
 * cases. Weapons carry them on `onHit`; save / area-save / healing actions carry
 * them on `riders`. Consumed by `applyActionRiders` (engine, phase 2a).
 */

export type RiderGate =
  | "always"
  | "on-hit"
  | "on-miss"
  | "on-crit"
  | "on-save-fail"
  | "on-save-success";

export type RiderDuration =
  | { kind: "rounds"; rounds: number; repeatSaveAt?: "turn-start" | "turn-end" }
  | { kind: "save-ends"; saveAt: "turn-start" | "turn-end" }
  | { kind: "concentration" }
  | { kind: "permanent" }
  /** Clears at the start of the bearer's next turn (Shield, Dodge, Shocking Grasp's reaction lock). */
  | { kind: "until-start-of-next-turn" };

export interface RiderSave {
  ability: Ability;
  dc?: number;
  dcFormula?: NumericFormula;
  /**
   * What a successful save does. `"negates"` — the effect never lands.
   * `"ends-early"` — it lands, but a later `repeatSaveAt` / `save-ends` roll can
   * clear it.
   */
  onSuccess: "negates" | "ends-early";
}

interface ActionRiderCommon {
  id?: Id;
  /** Fire at most once per the source creature's turn (Sneak-Attack style). */
  oncePerTurn?: boolean;
}

interface TriggeredRider extends ActionRiderCommon {
  when: RiderGate;
  /**
   * Charges this rider spends, on top of the parent action's own `resourceCost`.
   * If unpayable the rider is skipped and the parent action still resolves.
   */
  resourceCost?: ResourceCost;
  /**
   * Only meaningful alongside `resourceCost`. `"always"` (default) spends the
   * charge automatically whenever the gate fires and it's affordable — the
   * upgrade isn't a choice. `"optional"` means the charge *can* be spent for
   * the upgrade but doesn't have to be: `weaponToActions` compiles a second,
   * plain candidate action alongside the upgraded one so the AI (or a player)
   * can choose to hold the charge instead.
   */
  activation?: "always" | "optional";
}

export type ActionRider =
  | (TriggeredRider & { kind: "damage"; components: DamageComponent[] })
  | (TriggeredRider & { kind: "healing"; components: HealingComponent[]; target?: "self" | "target" })
  | (TriggeredRider & {
      kind: "condition";
      condition: ConditionName | { custom: string };
      duration: RiderDuration;
      /**
       * Omit for an automatic effect ("on a hit, frightened"). Present for a
       * gated one ("on a hit, WIS save or frightened"). Also supplies the roll
       * for `save-ends` / `repeatSaveAt` durations.
       */
      save?: RiderSave;
      modifiers?: ConditionInstance["modifiers"];
      effects?: FeatureEffect[];
    })
  | (TriggeredRider & { kind: "push"; distance: number })
  | (ActionRiderCommon & { kind: "note"; text: string });

/* ─── Reaction triggers ────────────────────────────────────────────────────────
 * What must happen for a `reaction`-typed action to become available. Consumed
 * by `runReactionWindow` (engine). Only meaningful on an action whose
 * `actionType === "reaction"`.
 */
export type ReactionTrigger =
  /** An enemy the reactor threatens leaves its melee reach (opportunity attack). */
  | { kind: "enemy-leaves-reach" }
  /** The reactor is targeted by an attack, before it resolves (Shield). */
  | { kind: "targeted-by-attack"; meleeOnly?: boolean }
  /** The reactor was hit by an attack (Hellish Rebuke). */
  | { kind: "hit-by-attack"; meleeOnly?: boolean }
  /** An ally within `withinFt` is targeted by an attack (Protection fighting style). */
  | { kind: "ally-targeted-by-attack"; withinFt: number }
  /** An enemy within `withinFt` casts a spell of level ≤ `maxSpellLevel` (Counterspell). */
  | { kind: "enemy-casts-spell"; withinFt: number; maxSpellLevel?: number }
  /** Author-described — reference only, never auto-fires. */
  | { kind: "manual"; note: string };

export interface ReactionMeta {
  trigger: ReactionTrigger;
  /**
   * Who the reaction acts on. `"trigger-source"` = the attacker / caster / mover;
   * `"trigger-target"` = the creature the triggering attack was aimed at;
   * `"self"` = the reactor. Default `"trigger-source"`.
   */
  target?: "trigger-source" | "self" | "trigger-target";
  /** How eagerly the AI spends the reaction. `"manual"` never auto-fires. Default `"worthwhile"`. */
  priority?: "always" | "worthwhile" | "manual";
}

export interface AttackActionDefinition {
  kind: "attack";
  id: Id;
  name: string;
  actionType: ActionType;
  attackType: "melee" | "ranged" | "spell";
  ability: Ability;
  /** Resolved wield for a weapon-compiled attack — sheet / log only. Set by `weaponToAction`. */
  grip?: "one-handed" | "two-handed";
  /** What makes this reaction available (only when `actionType === "reaction"`). */
  reaction?: ReactionMeta;
  /**
   * `false` explicitly bars this melee attack from being used as an opportunity
   * attack (a weapon whose `usableAs` omits `"reaction"`). Absent ⇒ eligible.
   */
  opportunityAttack?: boolean;
  attackBonus?: number;
  attackBonusFormula?: NumericFormula;
  range: number;
  longRange?: number;
  reach?: number;
  damage: DamageComponent[];
  /** `"beams"` = several small attacks from one action (Magic Missile, Scorching Ray, Eldritch Blast). Default `"single"`. */
  attackDelivery?: "single" | "beams";
  /** Base beam count (default 1) when `attackDelivery === "beams"`. */
  beamCount?: number;
  /** Cantrip-style beam growth — the highest `atLevel <= casterLevel` entry overrides `beamCount`. */
  beamCountByLevel?: Array<{ atLevel: number; count: number }>;
  /** Skip the attack roll — each beam's damage always lands (Magic Missile). */
  autoHit?: boolean;
  /** On-hit effects: extra damage, a save-or-condition, a shove. */
  riders?: ActionRider[];
  resourceCost?: ResourceCost;
  /** Using this action sets the actor's concentration (some spell attacks). */
  concentration?: boolean;
  /** Base level of the spell this came from — stamped by `getExecutableActions`. Drives `upcast`. */
  spellLevel?: number;
  upcast?: SpellUpcast;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface SaveActionDefinition {
  kind: "save";
  id: Id;
  name: string;
  actionType: ActionType;
  /** What makes this reaction available (only when `actionType === "reaction"`). */
  reaction?: ReactionMeta;
  saveAbility: Ability;
  dc?: number;
  dcFormula?: NumericFormula;
  range: number;
  damage: DamageComponent[];
  /** Legacy flag. Kept in sync with `onSuccess` by normalization (`onSuccess === "half"`). */
  halfDamageOnSuccess: boolean;
  /** What a successful save does to this action's damage. Generalises `halfDamageOnSuccess`. */
  onSuccess?: "half" | "none" | "negates";
  /** `"self"` targets the actor (buffs, self-heals). Default `"single"`. */
  targeting?: { target: "single" | "self" };
  /** Effects gated on the save result — usually `on-save-fail` conditions. */
  riders?: ActionRider[];
  resourceCost?: ResourceCost;
  concentration?: boolean;
  spellLevel?: number;
  upcast?: SpellUpcast;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface AreaSaveActionDefinition {
  kind: "area-save";
  id: Id;
  name: string;
  actionType: ActionType;
  /** What makes this reaction available (only when `actionType === "reaction"`). */
  reaction?: ReactionMeta;
  saveAbility: Ability;
  dc?: number;
  dcFormula?: NumericFormula;
  range: number;
  area: AreaTemplate;
  /** How the template is placed / aimed. Default: `{ origin: "point", range }`. */
  targeting?: AreaTargeting;
  damage: DamageComponent[];
  halfDamageOnSuccess: boolean;
  onSuccess?: "half" | "none" | "negates";
  affects: "hostile" | "all";
  riders?: ActionRider[];
  resourceCost?: ResourceCost;
  concentration?: boolean;
  spellLevel?: number;
  upcast?: SpellUpcast;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface HealingActionDefinition {
  kind: "healing";
  id: Id;
  name: string;
  actionType: ActionType;
  range: number;
  healing: HealingComponent[];
  /** `"self"` targets the actor. Default `"single"`. */
  targeting?: { target: "single" | "self" };
  riders?: ActionRider[];
  resourceCost?: ResourceCost;
  spellLevel?: number;
  upcast?: SpellUpcast;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface UnsupportedActionDefinition {
  kind: "unsupported";
  id: Id;
  name: string;
  description?: string;
  actionType: ActionType;
  automationSupport: "unsupported";
}

export interface ActivateFeatureActionDefinition {
  kind: "activate-feature";
  id: Id;
  name: string;
  actionType: ActionType;
  /** What makes this reaction available (only when `actionType === "reaction"`) — Shield, Counterspell. */
  reaction?: ReactionMeta;
  featureId: Id;
  resourceCost?: ResourceCost;
  condition?: {
    id?: Id;
    name?: ConditionName;
    durationRounds?: number;
    modifiers?: ConditionInstance["modifiers"];
    effects?: FeatureEffect[];
  };
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * A standard non-attack action — Dash / Disengage / Dodge (and reference-only
 * Hide / Help). `getExecutableActions` synthesises the `action`-cost forms for
 * every creature; a definition only authors the exceptions (a feature granting a
 * `bonus`-cost Disengage, a monster overriding Dash). Resolved by
 * `resolveUtilityAction`.
 */
export interface UtilityActionDefinition {
  kind: "utility";
  id: Id;
  name: string;
  actionType: "action" | "bonus";
  mode: "dash" | "disengage" | "dodge" | "hide" | "help";
  resourceCost?: ResourceCost;
  automationSupport: "full" | "partial";
}

export interface MultiattackActionDefinition {
  kind: "multiattack";
  id: Id;
  name: string;
  actionType: ActionType;
  attacks: Array<{
    actionId: Id;
    count: number;
    /**
     * Advanced: aim this step at the target the caller supplies at this index
     * (0 = primary). Out-of-range indices clamp; a dead target falls through to
     * the next live one. Default `0`.
     */
    targetGroup?: number;
  }>;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export type ActionDefinition =
  | AttackActionDefinition
  | SaveActionDefinition
  | AreaSaveActionDefinition
  | HealingActionDefinition
  | UnsupportedActionDefinition
  | ActivateFeatureActionDefinition
  | MultiattackActionDefinition
  | UtilityActionDefinition;

/** Limited-use pool backing a weapon's spell-like `onHit` riders. */
export interface WeaponCharges {
  /**
   * Resource id as authored (e.g. `"fear-strike"`). Namespaced to
   * `<weaponId>:<id>` and seeded into the creature's resources when the weapon
   * is attached.
   */
  id: string;
  max: number;
  recharge?: "dawn" | "short-rest" | "long-rest" | { dice: string };
}

export interface WeaponDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  category?: "simple" | "martial";
  /**
   * `"focus"` is a spellcasting focus / wand / wondrous item with no attack of
   * its own — `weaponToActions` compiles no base attack for it. Its `damage`
   * and `range` are unused placeholders in that case.
   */
  attackType: "melee" | "ranged" | "focus";
  /** An `Ability`, or `"finesse"` — resolved to the better of STR/DEX at attack time. */
  ability: Ability | "finesse";
  /** Default `true`. `false` drops the proficiency bonus from the attack roll. */
  proficient?: boolean;
  /** Damage counts as magical (bypasses non-magical resistance) even at +0. */
  magical?: boolean;
  /** Flat ± to the attack roll, independent of `magicBonus`. */
  toHitBonus?: number;
  range: number;
  longRange?: number;
  reach?: number;
  damage: DamageComponent[];
  /** Used when the weapon is wielded two-handed (Versatile property). */
  versatileDamage?: DamageComponent[];
  properties?: string[];
  /** Limited-use pool for `onHit` riders that carry a `resourceCost`. */
  charges?: WeaponCharges;
  /** Charges the attack itself spends (rare — most cost sits on an `onHit` rider). */
  resourceCost?: ResourceCost;
  /** Spell-like on-hit effects: extra damage, a save-or-condition, a shove. */
  onHit?: ActionRider[];
  /**
   * Additional independent actions this item grants — a spell-focus's tiered
   * spells (1 charge Firebolt, 3 charge Fireball), or a magic weapon that also
   * lets you cast something for charges. Each entry has its own `actionType`
   * (action/bonus/reaction) and its own `resourceCost` against this weapon's
   * `charges` pool; no `resourceCost` = at-will. Compiled the same way as
   * `FeatureDefinition.grantedActions`.
   */
  grantedActions?: ActionDefinition[];
  /**
   * Passive bonuses while this item is carried (spell attack/DC bonus, a
   * damage-type boost like a Frost Staff). Compiled the same way as
   * `FeatureDefinition.effects` — folded into `featureSources()`.
   */
  effects?: FeatureEffect[];
  actionId?: Id;
  /** +1 / +2 / +3 — adds to both the attack roll and every damage component. */
  magicBonus?: number;
  /**
   * Which economy slots this weapon's attack may spend. An explicit list makes
   * `weaponToActions` compile one attack per slot (`:bonus` / `:reaction` id
   * suffix) — `["action", "bonus"]` adds an off-hand attack, `["reaction"]`
   * makes it reaction-only. Absent ⇒ a single `"action"` attack; every melee
   * weapon can still make an opportunity attack via the OA scan (Phase 3 will
   * treat an absent list on a melee weapon as reaction-capable).
   */
  usableAs?: Array<"action" | "bonus" | "reaction">;
  /**
   * How the weapon is wielded. `"two-handed"` always uses `versatileDamage`;
   * `"versatile"` uses it only when the wielder has no drawn off-hand weapon
   * (a loose heuristic — a real hand model is a non-goal). Default `"one-handed"`.
   */
  grip?: "one-handed" | "two-handed" | "versatile";
  /**
   * Trigger for the compiled reaction copy (when `usableAs` includes
   * `"reaction"`). Default `{ kind: "enemy-leaves-reach" }` — a plain
   * opportunity attack.
   */
  reactionTrigger?: ReactionTrigger;
  /**
   * Great Weapon Master / Sharpshooter: also compile a "power" attack variant
   * at -5 to hit / +10 damage. The AI weighs it against the plain attack.
   */
  powerAttack?: boolean;
}

/** How a spell grows when cast with a slot above its base level. */
export interface SpellUpcast {
  perSlotAboveBase?: {
    damageDice?: string;
    beams?: number;
    /** Extra creatures a single-target `save` action can affect for free (Hold Person-style). */
    targets?: number;
  };
}

export interface SpellDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  level: number;
  school?: string;
  castingTime: "action" | "bonus" | "reaction";
  ritual?: boolean;
  /** Feet, or `"self"` / `"touch"` (resolved to 0 / 5 when compiling to an action). */
  range: number | "self" | "touch";
  concentration?: boolean;
  components?: { v?: boolean; s?: boolean; m?: string };
  resourceCost?: ResourceCost;
  upcast?: SpellUpcast;
  action?: ActionDefinition;
  description?: string;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface FeatureDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  category: "feature" | "trait";
  description?: string;
  effects?: FeatureEffect[];
  grantedActions?: ActionDefinition[];
  modifiers?: {
    armorClass?: NumericFormula;
    attackRoll?: NumericFormula;
    savingThrows?: Partial<Record<Ability, NumericFormula>>;
  };
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface SourceMetadata {
  provider: "homebrew" | "open5e";
  documentKey?: string;
  documentName?: string;
  slug?: string;
  importedAt?: string;
  url?: string;
}

export interface CreatureDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  size: SizeCategory;
  armorClass: number;
  maxHp: number;
  speed: number;
  proficiencyBonus?: number;
  resources?: Record<string, number>;
  tokenVisuals?: TokenVisuals;
  character?: {
    level?: number;
    classes?: Array<{
      id?: Id;
      name: string;
      level: number;
      subclass?: {
        id?: Id;
        name: string;
      };
      source?: {
        provider: "homebrew" | "open5e";
        documentKey?: string;
        documentName?: string;
        slug?: string;
        url?: string;
      };
    }>;
  };
  abilities: Record<Ability, number>;
  saves?: Partial<Record<Ability, number>>;
  damageAdjustments?: DamageAdjustment[];
  weapons?: WeaponDefinition[];
  spells?: SpellDefinition[];
  features?: FeatureDefinition[];
  traits?: FeatureDefinition[];
  actions: ActionDefinition[];
  bonusActions?: ActionDefinition[];
  reactions?: ActionDefinition[];
}

export interface ConditionInstance {
  id: Id;
  name: ConditionName;
  sourceId?: Id;
  sourceName?: string;
  sourceCombatantId?: Id;
  startedRound: number;
  expiresAt?: {
    round: number;
    turnIndex: number;
    timing: "start" | "end";
  };
  modifiers?: {
    attackRoll?: number;
    armorClass?: number;
    savingThrows?: Partial<Record<Ability, number>>;
    movementMultiplier?: number;
    damageAdjustments?: DamageAdjustment[];
    /** The bearer cannot spend that slot (incapacitated / stunned / paralyzed; Shocking Grasp sets `deniesReactions`). */
    deniesActions?: boolean;
    deniesBonusActions?: boolean;
    deniesReactions?: boolean;
    /**
     * Modifier applied to attack rolls made *against* the bearer. Positive =
     * easier to hit (attackers effectively have advantage: stunned / prone);
     * negative = harder (Dodge). Summed across the bearer's conditions.
     */
    incomingAttackRoll?: number;
  };
  effects?: FeatureEffect[];
  /**
   * The bearer re-rolls this save at the given timing on its own turn; a success
   * ends the condition. Set by `save-ends` / `repeatSaveAt` rider durations; the
   * `dc` is resolved from the source at application time.
   */
  repeatSave?: {
    ability: Ability;
    dc: number;
    timing: "turn-start" | "turn-end";
  };
  /**
   * Sustained by a concentrating caster (`sourceCombatantId`). Breaking that
   * caster's concentration ends every condition flagged this way.
   */
  concentration?: boolean;
}

export interface DeathSaveState {
  successes: number;
  failures: number;
  stable: boolean;
}

export interface ActionEconomyState {
  action: boolean;
  bonus: boolean;
  reaction: boolean;
}

/**
 * Transient, per-turn flags set by `resolveUtilityAction` and cleared by
 * `resetActionEconomy` at the start of the bearer's turn. Not meaningfully
 * persisted — a loaded encounter self-corrects on the bearer's next turn.
 */
export interface TurnFlags {
  /** Dash was taken — movement budget is doubled. */
  dashed?: boolean;
  /** Disengage was taken — movement provokes no opportunity attacks this turn. */
  disengaged?: boolean;
}

export interface CombatantState {
  id: Id;
  definitionId: Id;
  displayName: string;
  faction: Faction;
  position: Point;
  currentHp: number;
  tempHp: number;
  deathSaves?: DeathSaveState;
  conditions?: ConditionInstance[];
  resources?: Record<string, number>;
  tokenVisuals?: TokenVisuals;
  actionEconomy?: ActionEconomyState;
  concentration?: {
    sourceConditionId?: Id;
  };
  initiative?: number;
  turnFlags?: TurnFlags;
  /**
   * `"reserve"` = a scheduled reinforcement not yet on the board: it takes no
   * turns, cannot be targeted, blocks nothing, and is drawn ghosted. The engine
   * flips it to `"active"` at the start of `arrivesRound` (see
   * `admitReinforcements`). Its faction still counts as "in the fight" while it
   * waits, so combat doesn't end before it shows up.
   */
  state: "active" | "reserve" | "downed" | "dead" | "defeated" | "fled";
  /** Round this combatant enters play (1-based). Only meaningful with `state: "reserve"`. */
  arrivesRound?: number;
  tacticsProfile: TacticsProfile;
  /** DM-assigned appetite for spending limited-use resources. See `ResourceStance`. */
  resourceStance: ResourceStance;
  /** DM-assigned targeting/protection/healing flags. See `ActorTag`. */
  tags?: ActorTag[];
}

export interface CombatantExportPackage {
  kind: "battle-sim-combatant";
  schemaVersion: typeof ENCOUNTER_SCHEMA_VERSION;
  exportedAt?: string;
  definition: CreatureDefinition;
  combatant?: Omit<CombatantState, "id" | "definitionId" | "initiative" | "actionEconomy" | "concentration">;
}

export interface RuleProfile {
  playerDeathSaves: boolean;
  enemiesDropAtZero: boolean;
  requireLineOfEffect: boolean;
  /** Apply cover AC / Dex-save bonuses and let the AI weight cover. `total` cover still blocks line of effect regardless. */
  cover: boolean;
  /** Optional 5e rule: an intervening creature grants half cover. Off by default. */
  coverFromCreatures?: boolean;
}

export interface EncounterSnapshot {
  schemaVersion: typeof ENCOUNTER_SCHEMA_VERSION;
  id: Id;
  name: string;
  seed: string;
  round: number;
  turnIndex: number;
  map: BattleMapState;
  rules: RuleProfile;
  definitions: CreatureDefinition[];
  combatants: CombatantState[];
}

export interface CombatLogEvent {
  id: Id;
  round: number;
  turnIndex: number;
  type:
    | "InitiativeRolled"
    | "TurnStarted"
    | "CombatantMoved"
    | "ActionDeclared"
    | "AttackRolled"
    | "SaveRolled"
    | "AreaSaveResolved"
    | "MultiattackResolved"
    | "DamageApplied"
    | "HealingApplied"
    | "DeathSaveRolled"
    | "ConcentrationChecked"
    | "ConditionApplied"
    | "ConditionExpired"
    | "FeatureEffectApplied"
    | "RiderApplied"
    | "BeamsResolved"
    | "OpportunityAttackTriggered"
    | "ReactionTriggered"
    | "ReinforcementArrived"
    | "SpellCountered"
    | "UtilityActionResolved"
    | "ActionEconomyRefreshed"
    | "AiDecision"
    | "CombatantDowned"
    | "CombatantDefeated"
    | "CombatantDied"
    | "CombatantStabilized"
    | "CombatEnded"
    | "AutomationWarning";
  message: string;
  data?: Record<string, unknown>;
}

export const pointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite()
});

export const coverLevelSchema = z.union([
  z.literal("none"),
  z.literal("half"),
  z.literal("three-quarters"),
  z.literal("total")
]);

/* ─── Structured sub-schemas for actions / weapons / spells ──────────────────────
 * `creatureDefinitionSchema` still stores `actions` / `weapons` / `spells` as
 * `z.array(z.any())` — deep shape enforcement is the normalizer's job. These
 * exported schemas are the validation contract for the SRD library (phase 2) and
 * for tests; they are not yet wired into the definition schema.
 */

const abilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);

export const numericFormulaSchema = z.object({
  base: z.number().optional(),
  ability: abilitySchema.optional(),
  proficiency: z.boolean().optional(),
  multiplier: z.number().optional()
});

export const resourceCostSchema = z.object({
  resourceId: z.string().min(1),
  amount: z.number().int()
});

export const damageScalingSchema = z.union([
  z.object({
    mode: z.literal("cantrip-by-level"),
    steps: z.array(z.object({ atLevel: z.number().int(), dice: z.string().min(1) }))
  }),
  z.object({ mode: z.literal("per-slot-above-base"), dice: z.string().min(1) })
]);

export const damageComponentSchema = z.object({
  dice: z.string().min(1),
  diceCount: z.number().int().positive().optional(),
  diceSize: z.number().int().positive().optional(),
  flatBonus: z.number().optional(),
  damageType: z.string().min(1),
  abilityModifier: abilitySchema.optional(),
  bonusFormula: numericFormulaSchema.optional(),
  magical: z.boolean().optional(),
  scaling: damageScalingSchema.optional()
}).passthrough();

export const healingComponentSchema = z.object({
  dice: z.string().min(1),
  diceCount: z.number().int().positive().optional(),
  diceSize: z.number().int().positive().optional(),
  flatBonus: z.number().optional(),
  abilityModifier: abilitySchema.optional()
}).passthrough();

export const areaTemplateSchema = z.object({
  type: z.enum(["circle", "cone", "line", "rectangle", "square"]),
  size: z.number().positive(),
  width: z.number().positive().optional(),
  direction: z.enum(["north", "east", "south", "west"]).optional()
});

export const areaTargetingSchema = z.object({
  origin: z.enum(["self", "point"]),
  aimedFromSelf: z.boolean().optional(),
  range: z.number().min(0)
});

export const weaponChargesSchema = z.object({
  id: z.string().min(1),
  max: z.number().int().positive(),
  recharge: z.union([
    z.enum(["dawn", "short-rest", "long-rest"]),
    z.object({ dice: z.string().min(1) })
  ]).optional()
});

export const riderGateSchema = z.enum([
  "always", "on-hit", "on-miss", "on-crit", "on-save-fail", "on-save-success"
]);

export const riderDurationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rounds"),
    rounds: z.number().int().min(0),
    repeatSaveAt: z.enum(["turn-start", "turn-end"]).optional()
  }),
  z.object({ kind: z.literal("save-ends"), saveAt: z.enum(["turn-start", "turn-end"]) }),
  z.object({ kind: z.literal("concentration") }),
  z.object({ kind: z.literal("permanent") }),
  z.object({ kind: z.literal("until-start-of-next-turn") })
]);

export const riderSaveSchema = z.object({
  ability: abilitySchema,
  dc: z.number().int().optional(),
  dcFormula: numericFormulaSchema.optional(),
  onSuccess: z.enum(["negates", "ends-early"])
});

const triggeredRiderBase = {
  id: z.string().optional(),
  oncePerTurn: z.boolean().optional(),
  when: riderGateSchema,
  resourceCost: resourceCostSchema.optional()
};

export const actionRiderSchema: z.ZodType<ActionRider> = z.discriminatedUnion("kind", [
  z.object({ ...triggeredRiderBase, kind: z.literal("damage"), components: z.array(damageComponentSchema).min(1) }),
  z.object({
    ...triggeredRiderBase,
    kind: z.literal("healing"),
    components: z.array(healingComponentSchema).min(1),
    target: z.enum(["self", "target"]).optional()
  }),
  z.object({
    ...triggeredRiderBase,
    kind: z.literal("condition"),
    condition: z.union([z.string().min(1), z.object({ custom: z.string().min(1) })]),
    duration: riderDurationSchema,
    save: riderSaveSchema.optional(),
    modifiers: z.any().optional(),
    effects: z.array(z.any()).optional()
  }),
  z.object({ ...triggeredRiderBase, kind: z.literal("push"), distance: z.number() }),
  z.object({ id: z.string().optional(), oncePerTurn: z.boolean().optional(), kind: z.literal("note"), text: z.string() })
]) as z.ZodType<ActionRider>;

export const reactionTriggerSchema: z.ZodType<ReactionTrigger> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enemy-leaves-reach") }),
  z.object({ kind: z.literal("targeted-by-attack"), meleeOnly: z.boolean().optional() }),
  z.object({ kind: z.literal("hit-by-attack"), meleeOnly: z.boolean().optional() }),
  z.object({ kind: z.literal("ally-targeted-by-attack"), withinFt: z.number().min(0) }),
  z.object({ kind: z.literal("enemy-casts-spell"), withinFt: z.number().min(0), maxSpellLevel: z.number().int().min(0).optional() }),
  z.object({ kind: z.literal("manual"), note: z.string() })
]) as z.ZodType<ReactionTrigger>;

export const reactionMetaSchema: z.ZodType<ReactionMeta> = z.object({
  trigger: reactionTriggerSchema,
  target: z.enum(["trigger-source", "self", "trigger-target"]).optional(),
  priority: z.enum(["always", "worthwhile", "manual"]).optional()
});

const tacticsProfileSchema = z.preprocess(
  (value) => value === "manual" ? "basic-melee" : value,
  z.union([
    z.literal("basic-melee"),
    z.literal("basic-ranged"),
    z.literal("skirmisher"),
    z.literal("brute"),
    z.literal("defender"),
    z.literal("controller")
  ])
);

const resourceStanceSchema = z.union([
  z.literal("conservative"),
  z.literal("balanced"),
  z.literal("liberal")
]).default("balanced") as z.ZodType<ResourceStance>;

const actorTagSchema = z.enum(["high-priority", "low-priority", "protected"]) as z.ZodType<ActorTag>;

export const creatureDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.any().optional(),
  size: z.union([
    z.literal("tiny"),
    z.literal("small"),
    z.literal("medium"),
    z.literal("large"),
    z.literal("huge"),
    z.literal("gargantuan")
  ]),
  type: z.string().optional(),
  armorClass: z.number().int(),
  maxHp: z.number().int().positive(),
  speed: z.number().int().min(0),
  resources: z.record(z.number()).optional(),
  tokenVisuals: z.object({
    imageUrl: z.string().optional(),
    portraitUrl: z.string().optional(),
    scale: z.number().positive().optional(),
    tint: z.string().optional(),
    borderColor: z.string().optional(),
    showNameplate: z.boolean().optional()
  }).optional(),
  abilities: z.object({
    str: z.number().int(),
    dex: z.number().int(),
    con: z.number().int(),
    int: z.number().int(),
    wis: z.number().int(),
    cha: z.number().int()
  }),
  actions: z.array(z.any()),
  bonusActions: z.array(z.any()).optional(),
  reactions: z.array(z.any()).optional(),
  weapons: z.array(z.any()).optional(),
  spells: z.array(z.any()).optional(),
  features: z.array(z.any()).optional(),
  traits: z.array(z.any()).optional()
}).passthrough() as z.ZodType<CreatureDefinition>;

export const combatantExportSchema = z.object({
  kind: z.literal("battle-sim-combatant"),
  schemaVersion: z.literal(ENCOUNTER_SCHEMA_VERSION),
  exportedAt: z.string().optional(),
  definition: creatureDefinitionSchema,
  combatant: z.object({
    displayName: z.string().min(1),
    faction: z.union([z.literal("party"), z.literal("enemy"), z.literal("neutral")]),
    position: pointSchema,
    currentHp: z.number().int(),
    tempHp: z.number().int().min(0),
    deathSaves: z.object({
      successes: z.number().int().min(0),
      failures: z.number().int().min(0),
      stable: z.boolean()
    }).optional(),
    conditions: z.array(z.any()).optional(),
    resources: z.record(z.number()).optional(),
    tokenVisuals: z.object({
      imageUrl: z.string().optional(),
      portraitUrl: z.string().optional(),
      scale: z.number().positive().optional(),
      tint: z.string().optional(),
      borderColor: z.string().optional(),
      showNameplate: z.boolean().optional()
    }).optional(),
    state: z.union([
      z.literal("active"),
      z.literal("reserve"),
      z.literal("downed"),
      z.literal("dead"),
      z.literal("defeated"),
      z.literal("fled")
    ]),
    arrivesRound: z.number().int().min(1).optional(),
    tacticsProfile: tacticsProfileSchema,
    resourceStance: resourceStanceSchema,
    tags: z.array(actorTagSchema).optional()
  }).optional()
});

export const encounterSnapshotSchema = z.object({
  schemaVersion: z.literal(ENCOUNTER_SCHEMA_VERSION),
  id: z.string(),
  name: z.string().min(1),
  seed: z.string().min(1),
  round: z.number().int().min(0),
  turnIndex: z.number().int().min(0),
  map: z.object({
    id: z.string(),
    name: z.string(),
    grid: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      distancePerSquare: z.number().positive(),
      diagonalMode: z.union([z.literal("standard"), z.literal("five-ten-five")]),
      squareSizePx: z.number().positive().default(DEFAULT_GRID_VISUALS.squareSizePx),
      lineColor: z.string().default(DEFAULT_GRID_VISUALS.lineColor),
      lineOpacity: z.number().min(0).max(1).default(DEFAULT_GRID_VISUALS.lineOpacity),
      lineWidthPx: z.number().positive().default(DEFAULT_GRID_VISUALS.lineWidthPx)
    }),
    image: z.object({
      offsetX: z.number().finite().default(DEFAULT_MAP_IMAGE_SETTINGS.offsetX),
      offsetY: z.number().finite().default(DEFAULT_MAP_IMAGE_SETTINGS.offsetY),
      scale: z.number().positive().default(DEFAULT_MAP_IMAGE_SETTINGS.scale),
      opacity: z.number().min(0).max(1).default(DEFAULT_MAP_IMAGE_SETTINGS.opacity)
    }).default(DEFAULT_MAP_IMAGE_SETTINGS),
    canvas: z.object({
      widthPx: z.number().positive(),
      heightPx: z.number().positive()
    }).optional(),
    walls: z.array(
      z.object({
        id: z.string(),
        start: pointSchema,
        end: pointSchema,
        blocksMovement: z.boolean(),
        blocksSight: z.boolean(),
        blocksProjectiles: z.boolean(),
        cover: coverLevelSchema.optional(),
        doorState: z.union([
          z.literal("open"),
          z.literal("closed"),
          z.literal("locked"),
          z.literal("destroyed")
        ]).optional()
      }).transform(normalizeWall)
    ),
    terrain: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.union([
          z.literal("normal"),
          z.literal("difficult"),
          z.literal("impassable"),
          z.literal("hazard"),
          z.literal("cover"),
          z.literal("elevation"),
          z.literal("custom")
        ]),
        polygon: z.array(pointSchema).min(3),
        movementMultiplier: z.number().positive().optional(),
        tags: z.array(z.string()).optional()
      })
    ),
    templates: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        origin: pointSchema,
        area: z.object({
          type: z.union([z.literal("circle"), z.literal("cone"), z.literal("line"), z.literal("rectangle"), z.literal("square")]),
          size: z.number().positive(),
          width: z.number().positive().optional(),
          direction: z.union([z.literal("north"), z.literal("east"), z.literal("south"), z.literal("west")]).optional()
        }),
        affects: z.union([z.literal("hostile"), z.literal("all")]),
        color: z.string().optional()
      })
    ).optional()
  }),
  rules: z.object({
    playerDeathSaves: z.boolean(),
    enemiesDropAtZero: z.boolean(),
    requireLineOfEffect: z.boolean(),
    cover: z.boolean().default(true),
    coverFromCreatures: z.boolean().optional()
  }),
  definitions: z.array(z.any()),
  combatants: z.array(
    z.object({
      id: z.string(),
      definitionId: z.string(),
      displayName: z.string(),
      faction: z.union([z.literal("party"), z.literal("enemy"), z.literal("neutral")]),
      position: pointSchema,
      currentHp: z.number().int(),
      tempHp: z.number().int().min(0),
      deathSaves: z.object({
        successes: z.number().int().min(0),
        failures: z.number().int().min(0),
        stable: z.boolean()
      }).optional(),
      conditions: z.array(z.any()).optional(),
      resources: z.record(z.number()).optional(),
      tokenVisuals: z.object({
        imageUrl: z.string().optional(),
        portraitUrl: z.string().optional(),
        scale: z.number().positive().optional(),
        tint: z.string().optional(),
        borderColor: z.string().optional(),
        showNameplate: z.boolean().optional()
      }).optional(),
      actionEconomy: z.object({
        action: z.boolean(),
        bonus: z.boolean(),
        reaction: z.boolean()
      }).optional(),
      concentration: z.object({
        sourceConditionId: z.string().optional()
      }).optional(),
      turnFlags: z.object({
        dashed: z.boolean().optional(),
        disengaged: z.boolean().optional()
      }).optional(),
      initiative: z.number().optional(),
      state: z.union([
        z.literal("active"),
        z.literal("reserve"),
        z.literal("downed"),
        z.literal("dead"),
        z.literal("defeated"),
        z.literal("fled")
      ]),
      arrivesRound: z.number().int().min(1).optional(),
      tacticsProfile: tacticsProfileSchema,
      resourceStance: resourceStanceSchema,
      tags: z.array(actorTagSchema).optional()
    })
  )
});
