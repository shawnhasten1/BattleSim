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
/** Standard 5e creature types. Drives which type-restricted spell/effect riders can affect this creature. */
export type CreatureType =
  | "aberration" | "beast" | "celestial" | "construct" | "dragon"
  | "elemental" | "fey" | "fiend" | "giant" | "humanoid"
  | "monstrosity" | "ooze" | "plant" | "undead";
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
  | "confused"
  | "deafened"
  | "dominated"
  | "frightened"
  | "grappled"
  | "incapacitated"
  | "invisible"
  | "paralyzed"
  | "petrified"
  | "poisoned"
  | "prone"
  | "restrained"
  | "stunned"
  | "surprised"
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

/**
 * A damaging/status-inflicting terrain tile (acid, lava, ...). Deliberately
 * mirrors `ActiveZone`'s own save/damage/rider fields so `combat.ts` can
 * apply both through one shared helper (`applySaveGatedEffect`) — terrain
 * hazards just have no caster (environmental: affects every faction, and
 * `sourceId` is omitted so the target is its own "source" for definition
 * lookups) and dedupe on the tile itself (`hazardAppliedRounds`) instead of
 * an `ActiveZone`'s `appliedRounds`.
 */
export interface TerrainHazardEffect {
  trigger: ZoneTrigger[];
  saveAbility?: Ability;
  /** Resolved to a concrete number — a terrain hazard's DC doesn't change round to round. */
  dc?: number;
  damage?: DamageComponent[];
  onSuccess?: "half" | "none" | "negates";
  riders?: ActionRider[];
}

export interface TerrainZone {
  id: Id;
  name: string;
  type: TerrainType;
  polygon: Point[];
  movementMultiplier?: number;
  tags?: string[];
  /** Set only for terrain painted with the tile brush: the exact grid cell this
   * 1x1 tile occupies, used for O(1) paint/erase lookup. Undefined for
   * hand-drawn region polygons (predates the tile brush), which keep working
   * as arbitrary-shape terrain untouched by the tile tools. */
  cell?: Point;
  /** Damage/status effect for hazard-type tiles (acid, lava, ice, ...). */
  hazard?: TerrainHazardEffect;
  /** Last round each combatant was hit by this tile's hazard, keyed by combatant id — dedupes on-enter + start-of-turn firing twice in the same round (same purpose as `ActiveZone.appliedRounds`). */
  hazardAppliedRounds?: Record<Id, number>;
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
  /** Pixel dimensions of the uploaded background as actually stored (i.e. after
   * any downscale re-encode), captured so the aspect ratio survives compression
   * and canvas sizing can be derived from it without re-decoding the image. */
  naturalWidthPx?: number;
  naturalHeightPx?: number;
  /** The pixel size `pxPerSquare` is measured against: the uploaded file's own
   * size before any downscale when known, otherwise the stored image's. A VTT
   * export is exactly columns × its px per square, so this is the size a grid
   * can be read from. */
  sourceWidthPx?: number;
  sourceHeightPx?: number;
  /** Pixels per grid square at the source size. Set together with the source
   * size, it pins the image to the grid: the image covers exactly
   * `sourceWidthPx / pxPerSquare` squares at any square size, and `offsetX`,
   * `offsetY`, `scale` and `map.canvas` no longer place it. */
  pxPerSquare?: number;
  /** Where the grid's top-left corner sits in a pinned image, in source px (a
   * map drawn with a border). Missing means 0. */
  originX?: number;
  originY?: number;
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

/**
 * Ground height, independent of terrain (a lake and lava can sit on any hill). Only cells that differ from the
 * datum are stored: `"x,y"` -> feet above it. Walkers can step between neighbours whose heights differ by at most
 * `MAX_STEP_HEIGHT_FT`; anything steeper is a cliff.
 */
export interface MapElevation {
  cells: Record<string, number>;
}

/** The tallest step a walker takes in stride — a stair, a kerb, a ramp square. Bigger differences are cliffs. */
export const MAX_STEP_HEIGHT_FT = 5;

export interface BattleMapState {
  id: Id;
  name: string;
  grid: GridConfig;
  image?: MapImageSettings;
  canvas?: MapCanvasSettings;
  /** Visual buffer, in grid squares, rendered around the canvas/grid on every
   * side (Foundry-style scene padding). Missing/undefined means 0 — only maps
   * created after this field existed get a nonzero default. */
  paddingSquares?: number;
  /** Foundry-style padding instead: this percent of the scene's width (and, separately, its
   * height) on each side, rounded up to whole squares. Wins over `paddingSquares` when set. */
  paddingPercent?: number;
  walls: WallSegment[];
  terrain: TerrainZone[];
  templates?: PlacedTemplate[];
  /** Ground heights (Phase 5B). Missing means a flat map, and everything behaves exactly as it did before. */
  elevation?: MapElevation;
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
  /**
   * `"absorb"`: damage of this type deals no damage and instead heals the creature by that much
   * (a Flesh Golem vs lightning). It takes precedence over immunity.
   */
  type: "resistance" | "immunity" | "vulnerability" | "absorb";
  damageType: DamageType;
  /**
   * When true this adjustment only applies to non-magical damage — a
   * `DamageComponent` marked `magical` bypasses it (5e "resistance to … from
   * nonmagical attacks"). Absent ⇒ applies to all damage of the type.
   */
  nonMagicalOnly?: boolean;
  /**
   * With `nonMagicalOnly`: weapons made of these materials bypass the adjustment
   * too ("nonmagical attacks not made with silvered weapons"). Damage dealt by a
   * weapon of that material carries `DamageComponent.material`.
   */
  exceptMaterials?: Array<"silvered" | "adamantine">;
}

/**
 * Conditions a creature can be immune to — any `ConditionName`, plus `"exhaustion"`, which no effect in the
 * engine applies (an immunity to it is recorded for the sheet and does nothing).
 */
export type ConditionImmunity = ConditionName | "exhaustion";

/** Per-mode movement speeds in feet. `CreatureDefinition.speed` stays the walk speed. */
export interface MovementProfile {
  walk: number;
  fly?: number;
  swim?: number;
  climb?: number;
  burrow?: number;
  hover?: boolean;
  /** Set only on a derived definition's movement (an `ignore-difficult-terrain` effect): difficult terrain costs it nothing extra. */
  ignoresDifficultTerrain?: boolean;
}

/** Ranges in feet. Informational until the engine models light and vision. */
export interface CreatureSenses {
  darkvision?: number;
  blindsight?: number;
  tremorsense?: number;
  truesight?: number;
}

/**
 * Limited use of an action: a recharge roll (`recharge: { min: 5 }` = "Recharge 5-6")
 * or a per-encounter pool (`uses`, which is how X/day reads in a single-encounter sim).
 * `poolId` shares one pool across several actions (a dragon's two breath weapons).
 * Recorded now; the engine enforces it from the limited-use phase on.
 */
export interface ActionUsage {
  kind: "recharge" | "uses";
  recharge?: { min: number; die?: number };
  uses?: number;
  poolId?: string;
}

/** One legendary action a creature can take between other creatures' turns. */
export interface LegendaryActionRef {
  name: string;
  /** Legendary action points it costs (1-3). */
  cost: number;
  description: string;
  /** One of this creature's own actions it performs ("makes a Tail attack"). */
  actionId?: Id;
  /** A self-contained action when the text isn't just a reference to an existing one. */
  action?: ActionDefinition;
  /** Where it was copied from: My library's entry (its `slug`). */
  source?: SourceMetadata;
}

export interface LegendaryConfig {
  /** Legendary action points per round (5e default 3). */
  pool: number;
  actions: LegendaryActionRef[];
}

export interface NumericFormula {
  base?: number;
  /**
   * The ability whose modifier it adds. `"spellcasting"` follows the creature's spellcasting ability
   * (`CreatureDefinition.spellcasting`), so a spell's DC and attack bonus move with it; see `spellcastingAbility`.
   */
  ability?: Ability | "spellcasting";
  proficiency?: boolean;
  /**
   * This many for each of its levels: its character level, or with `levelClass` its level in that class (Tough: 2;
   * Draconic Resilience: 1, sorcerer). Without a level it counts as level 1 (`levelOf`).
   */
  perLevel?: number;
  /** With `perLevel`: the class whose level counts, by its id or name as `character.classes` has it. */
  levelClass?: string;
  multiplier?: number;
}

export interface DamageComponent {
  /** Canonical dice expression, e.g. "2d6" or "2d6+1". Always populated after normalization. */
  dice: string;
  /**
   * Structured mirror of `dice`, kept in sync by `normalizeDamageComponent`:
   * parsed from `dice` when it is a clean `NdM(+K)` form, or written with it by
   * the ability editor's dice controls. Absent for expressions that do not
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
  /**
   * The wielder picks one of these each time the component deals damage (Zealot's
   * Divine Fury: radiant or necrotic). Resolved per target in `applyDamageEntries`
   * — the type that gets through the target's resistances best, ties going to the
   * earliest listed. `damageType` stays as the fallback / display type.
   */
  damageTypeOptions?: DamageType[];
  abilityModifier?: Ability;
  bonusFormula?: NumericFormula;
  /**
   * This component's damage counts as magical — it ignores non-magical
   * resistance / immunity — regardless of any `bonusFormula`.
   */
  magical?: boolean;
  /**
   * The weapon this damage comes from is silvered or adamantine, so it gets through "nonmagical … not made
   * with silvered weapons" resistance (`DamageAdjustment.exceptMaterials`). Stamped from
   * `WeaponDefinition.material`; natural attacks have none.
   */
  material?: "silvered" | "adamantine";
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
  /** Charge / Pounce: this turn the attacker closed at least `chargeFeet` (default 20) straight toward the target. */
  | "charged"
  /** Blood Frenzy: the target is missing any hit points. */
  | "target-injured"
  /** Surprise Attack / Assassinate: the target is surprised. */
  | "target-surprised"
  /** Grappler: the target is grappled by the attacker. */
  | "target-grappled-by-self"
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
  /** Only spells of these schools (Empowered Evocation: `["evocation"]`). */
  spellSchools?: string[];
  /** Only spells it casts as one of these classes (`SpellDefinition.spellClass`; Innate Sorcery: `["sorcerer"]`). */
  spellClasses?: string[];
  /** Only cantrips (Potent Spellcasting, Potent Cantrip). */
  cantripsOnly?: boolean;
  /**
   * Only attacks with a weapon having one of these properties (`AttackActionDefinition.weaponProperties`); `"ranged"`
   * takes a ranged weapon's attack too (Sneak Attack: `["finesse", "ranged"]`).
   */
  weaponProperties?: string[];
  /** Only attacks with a weapon held in two hands (Great Weapon Fighting). */
  twoHanded?: boolean;
}

export interface FeatureEffectConditions {
  condition?: FeatureCondition;
  allConditions?: FeatureCondition[];
  anyConditions?: FeatureCondition[];
  /** For a `"charged"` condition: how far the attacker must have closed on the target this turn, in feet. Default 20. */
  chargeFeet?: number;
  /**
   * Only while the creature has a condition with this id: an activation's (Rage: `"rage-active"`). Frenzy's extra
   * damage while raging.
   */
  whileCondition?: string;
  /** Only while it has every one of these condition ids too (Frenzy: raging and Reckless Attack's). */
  whileConditions?: string[];
  /**
   * Only against a creature bearing a condition with this id that this creature put on it: its own mark (Precise
   * Hunter: advantage against the creature its Hunter's Mark is on).
   */
  targetMarked?: string;
  /** Only against a creature of one of these types (a favored enemy's damage, a slayer's). */
  targetTypes?: CreatureType[];
}

/**
 * "While": what an effect checked on the creature alone needs of it (EFFECTS_PLAN.md): armor worn or not, a shield or
 * not, an activation's condition. Read by `selfGateHolds` (stats.ts). All given must hold.
 */
export interface SelfGate {
  /** `"worn"`: a suit of armor on (Defense); `"none"`: no suit (Unarmored Movement); `"not-heavy"`: no heavy suit (Fast Movement). */
  armor?: "worn" | "none" | "not-heavy";
  /** `true`: only holding a shield; `false`: only without one. */
  shield?: boolean;
  /** Only while it has a condition with this id: an activation's (Rage: `"rage-active"`). */
  whileCondition?: string;
}

/** What kind of save a `save-advantage` effect applies to. See `FeatureEffect` "save-advantage". */
export interface SaveScope {
  source?: "spell" | "magical";
  conditions?: ConditionName[];
  /** Only saves to keep concentration (Eldritch Mind). */
  concentration?: boolean;
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
  /** It changes, and is used up by, the next attack roll (Studied Attacks: the next against the target, by its giver). */
  nextAttack?: { role: "made" | "against"; mode: "advantage" | "disadvantage" };
}

/** Every effect can take "While" (`SelfGate`): `featureSources` leaves out one whose armor, shield or activation it lacks. */
export type FeatureEffect = (
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
  | {
    /**
     * Changing one of its own d20 rolls once it's seen: a failed save or a missed attack roll, or with `onNatural1`
     * only a natural 1 (Luck). `change`: `"reroll"` and use the new roll, `bonus` added (Indomitable: the fighter
     * level); `"add"` `dice` to it (Dark One's Own Luck: 1d10); `"twenty"`, the d20 becomes a 20 (Stroke of Luck);
     * `"hit"`, the attack hits (Boon of Combat Prowess). `resourceCost` is spent each time (Heroic Inspiration, a
     * pool); `oncePerTurn` allows it once until the start of the creature's next turn. Each one once a roll.
     */
    kind: "d20-change";
    rolls: Array<"attack" | "save">;
    change: "reroll" | "add" | "twenty" | "hit" | "subtract";
    bonus?: NumericFormula;
    dice?: string;
    onNatural1?: boolean;
    resourceCost?: ResourceCost;
    oncePerTurn?: boolean;
    /** On a condition: using it ends the condition (a Bardic Inspiration die, given by a bard's buff). */
    usedUp?: boolean;
    /** Its resource comes back when the roll still fails (Peerless Skill). */
    refundOnFailure?: boolean;
    /** Only a spell's attack roll (Seeking Spell). */
    spellAttacksOnly?: boolean;
    /**
     * Another creature's roll: an ally's within `withinFt` (its own too with `includeSelf`). Countercharm: 30 ft, self
     * included; Boon of Fate: 60 ft.
     */
    forOthers?: { withinFt: number; includeSelf?: boolean };
    /** It takes the owner's reaction (Countercharm). */
    reaction?: boolean;
    /** Only a save against one of these conditions (Countercharm: Charmed, Frightened). */
    againstConditions?: ConditionName[];
    /** The reroll has advantage (Countercharm). */
    advantage?: boolean;
    /**
     * A foe's roll that succeeded, by a creature within `withinFt` of the owner: `"subtract"` takes `dice` off it, maybe
     * making it fail (Cutting Words: the Bardic Inspiration die, off an attack roll; Boon of Fate: 2d4, off an attack
     * roll or a save). Not a critical hit.
     */
    againstFoes?: { withinFt: number };
  }
  | {
    /**
     * Moving as part of something else: up to half its speed (or `feet`) more this turn, when it spends a use of
     * `on.spends` (Rage: Instinctive Pounce; Second Wind: Tactical Shift) or scores a critical hit on its turn
     * (Remarkable Athlete). `noOpportunityAttacks`: none for the rest of the turn (the rules say only for that move).
     */
    kind: "free-move";
    on: { spends: string } | "critical-hit";
    feet?: number;
    noOpportunityAttacks?: boolean;
  }
  | {
    /**
     * Its healing grows: a healing spell cast with a slot gives each creature it heals 2 + the slot's level more
     * (`slotBonus`: Disciple of Life), and heals it too, by as much, when it heals someone else (`selfOnOthers`: Blessed
     * Healer); healing dice of its spells and Channel Divinity give their highest (`maximize`: Supreme Healing).
     */
    kind: "healing-bonus";
    slotBonus?: boolean;
    selfOnOthers?: boolean;
    maximize?: boolean;
  }
  | ({
    /**
     * Its weapon's damage dice (on a hit, as scoped): none lower than `minimumDie` (Great Weapon Fighting: a 1 or 2 counts
     * as 3), or rolled twice and the higher kept (`rollTwice`: Savage Attacker, once a turn with `oncePerTurn`).
     * `criticalDice`: on a critical hit, this many more of the weapon's damage dice, rolled once (Brutal Critical:
     * 1, 2 from 13th level, 3 from 17th; Savage Attacks: 1).
     */
    kind: "damage-dice";
    minimumDie?: number;
    rollTwice?: boolean;
    criticalDice?: number;
    oncePerTurn?: boolean;
  } & FeatureEffectScope & FeatureEffectConditions)
  | {
    /** Its initiative rolls: advantage (Feral Instinct, Remarkable Athlete), and a bonus added (Alert: the proficiency bonus). */
    kind: "initiative";
    advantage?: boolean;
    bonus?: NumericFormula;
  }
  | ({
    /**
     * Its attack rolls score a critical hit (and so hit) on a natural `minimum` or higher: Improved Critical's 19,
     * Superior Critical's 18. The lowest of several wins. Scoped like any attack effect (`attackTypes`: melee and ranged,
     * a weapon's and an Unarmed Strike's).
     */
    kind: "critical-range";
    minimum: number;
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
    /** On a miss instead of a hit (Studied Attacks). */
    onMiss?: boolean;
    /** The target resists with this save (a charge's "DC 13 Strength saving throw or be knocked prone"). */
    save?: FeatureEffectSaveGate;
  } & FeatureEffectScope & FeatureEffectConditions)
  | ({
    kind: "incoming-hit-damage";
    damage: DamageComponent[];
    critical?: boolean;
    consumeCondition?: boolean;
    damageSource?: "triggering-attacker" | "condition-source";
    /** Only the hits of the creature that put the condition on it: a mark's (Hunter's Mark, Hex). */
    onlyFromSource?: boolean;
    /**
     * Once on each of the marker's turns, the same damage to another of its foes within this many feet of the creature
     * hit (Superior Hunter's Prey: 30). Read with `onlyFromSource`.
     */
    spillWithinFt?: number;
  } & FeatureEffectConditions)
  | ({
    kind: "damage-adjustment";
    adjustment: DamageAdjustment;
  } & FeatureEffectConditions)
  | ({
    kind: "save-advantage";
    /** Only this ability's saves (omit for every save). */
    ability?: Ability;
    /** Only these abilities' saves — for "Int, Wis and Cha saves against magic" (Gnome Cunning). Combined with `ability` it is either/or. */
    abilities?: Ability[];
    /**
     * Narrows which saves this applies to. Every field given must hold; omit it for all saves.
     * - `source: "spell"` — only saves forced by a spell;
     * - `source: "magical"` — spells and other magical effects (Magic Resistance);
     * - `conditions` — only saves against being afflicted with one of these ("advantage on saves against being
     *   charmed" — Fey Ancestry, Brave, Dark Devotion; "…knocked prone" — Sure-Footed).
     */
    against?: SaveScope;
  } & FeatureEffectConditions)
  | {
    /**
     * Its hit point maximum increases by `bonus` while this works (Tough: 2 per level; Aid: 5), as `effectiveDefinition`
     * works it out (stats.ts). From a condition, its current hit points rise by as much when it lands, and are capped at
     * the maximum again when it ends.
     */
    kind: "hit-point-maximum";
    bonus: NumericFormula;
  }
  | {
    /**
     * Its `ability` score while this works (stats.ts, `scoresWith`): at least `setTo` (Gauntlets of Ogre Power: Strength
     * 19; nothing if it's already higher), or `bonus` more up to `max` (an Ioun Stone of Fortitude: +2, to 20). The
     * highest `setTo` first, then each bonus. What's worked out from the score follows it, and so do listed save and
     * skill totals; a creature with a character level gains Constitution's change for each level in hit points (D4).
     */
    kind: "ability-score";
    ability: Ability;
    setTo?: number;
    bonus?: number;
    max?: number;
  }
  | {
    /**
     * Regains `amount` hit points at the start of the bearer's turn. `worksAtZero` (a troll) lets it work — and
     * keeps the creature from dying — at 0 HP; without it the creature needs at least 1 HP. Damage of a type in
     * `suppressedByDamageTypes` taken since its last turn switches it off for that turn (acid and fire vs a troll).
     */
    kind: "hp-regen";
    amount: number;
    worksAtZero?: boolean;
    suppressedByDamageTypes?: DamageType[];
    /** Only while it's bloodied and has at least 1 hit point (Heroic Rally). */
    whileBloodied?: boolean;
    /** Temporary hit points instead, replacing fewer it has (Heroism): they don't stack. */
    temporary?: boolean;
  }
  | {
    /**
     * Drops to 1 HP instead of 0 (Undead Fortitude, Relentless). `save` makes it a saving throw against
     * `dcBase` + the damage taken; `maxDamage` only covers hits up to that size; `resourceId` limits it to the uses of
     * a pool. It never covers damage of an `excludedDamageTypes` type, nor a critical hit with `excludeCritical`.
     */
    kind: "survive-lethal";
    save?: { ability: Ability; dcBase: number };
    maxDamage?: number;
    excludedDamageTypes?: DamageType[];
    excludeCritical?: boolean;
    resourceId?: string;
    /**
     * Relentless Rage: the save's DC is `dcBase` plus this for each time it was tried before this fight's (in place of
     * the damage taken), only while it holds `whileCondition`, and it's left at `hpTo` hit points rather than 1.
     */
    dcStep?: number;
    whileCondition?: string;
    hpTo?: number;
  }
  | {
    /** Attack rolls against it can't have advantage while it isn't incapacitated (Elusive). */
    kind: "no-advantage-against";
  }
  | {
    /**
     * Immunity to these conditions (Mindless Rage while raging: `whileCondition`; on an aura, its allies' too: Aura of
     * Courage). One it already has ends when the immunity starts, or at the start of its turn.
     */
    kind: "condition-immunity";
    conditions: ConditionName[];
    whileCondition?: string;
  }
  | {
    /**
     * When it drops a hostile creature to 0 hit points, or someone else does within `nearbyFt` of it, it gains `tempHp`
     * temporary hit points (at least 1: Dark One's Blessing).
     */
    kind: "on-kill";
    tempHp: NumericFormula;
    nearbyFt?: number;
  }
  | {
    /** A saving throw of `ability` totalling less than that score uses the score (Indomitable Might). */
    kind: "save-floor";
    ability: Ability;
  }
  | {
    /** Its death saving throws: advantage, and a natural roll from `twentyFrom` up counts as a 20 (Defy Death). */
    kind: "death-saves";
    advantage?: boolean;
    twentyFrom?: number;
  }
  | {
    /**
     * Legendary Resistance: when this creature fails a saving throw it may spend one use of `resourceId`
     * to succeed instead. Whether it bothers is up to its `resourceStance` and how bad the failure would be.
     * `against` limits it to some saves, as for `save-advantage`.
     */
    kind: "auto-succeed-save";
    resourceId: string;
    against?: SaveScope;
  }
  | {
    /**
     * Ochre Jelly / Black Pudding: taking damage of one of `damageTypes` splits off a copy of itself next to it, at
     * half its (post-damage) current HP each, as long as that would leave at least `minHp`. The copy shares this
     * creature's definition and acts on its own initiative, right after the original this round.
     */
    kind: "split-on-damage";
    triggerDamageTypes: DamageType[];
    minHp: number;
  }
  | ({
    kind: "swarm-damage";
    fullHpDamage: DamageComponent[];
    bloodiedDamage?: DamageComponent[];
  } & FeatureEffectScope)
  | {
    kind: "armor-class-bonus";
    bonus: NumericFormula;
    /** Only while the creature wears no armor and no shield (Bracers of Defense). Without armor items it always applies. */
    unarmoredOnly?: boolean;
  }
  | {
    /**
     * An AC without armor worked out from abilities: `base` plus each ability's modifier (Unarmored Defense: 10 + DEX +
     * CON; Mage Armor: 13 + DEX). The creature uses the best of these and its typed AC while it wears no armor;
     * `noShield`, only while it carries no shield either (the monk's).
     */
    kind: "unarmored-ac";
    base: number;
    abilities: Ability[];
    noShield?: boolean;
  }
  | ({
    /**
     * Its speed while this works (stats.ts, `speedWith`): `bonusFt` feet more, or less (Fast Movement, Longstrider: 10);
     * `multiplier` times it (Boots of Speed, Haste: 2; the largest counts); at least `minimumFt` (Boots of Striding and
     * Springing: 30); movement `modes` it gains, a number of feet or its walking speed (Winged Boots: fly "walk"; Ring of
     * Swimming: swim 40), with `hover`. `allModes`: the bonus and multiplier change its other speeds too (Haste).
     * `noArmorSlowdown`: heavy armor too heavy for it doesn't slow it.
     */
    kind: "speed";
    bonusFt?: number;
    multiplier?: number;
    minimumFt?: number;
    modes?: Partial<Record<"fly" | "swim" | "climb" | "burrow", number | "walk">>;
    hover?: boolean;
    allModes?: boolean;
    noArmorSlowdown?: boolean;
  } & SelfGate)
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
    /** Only spells it casts as one of these classes (Innate Sorcery: `["sorcerer"]`). */
    spellClasses?: string[];
  }
  | ({
    /**
     * Its spells (as `FeatureEffectScope` narrows them) add an ability modifier to one damage roll: Potent
     * Spellcasting (Wisdom on Cleric or Druid cantrips), Empowered Evocation (Intelligence on evocation spells),
     * Elemental Affinity (Charisma on spells of its type: the first damage of that type). Folded into each compiled
     * spell.
     */
    kind: "spell-damage-ability";
    ability: Ability;
  } & FeatureEffectScope)
  | ({
    /** Its spells (as scoped) deal half damage on a missed attack roll or a made save, and nothing else (Potent Cantrip). */
    kind: "spell-half-on-miss";
    /** Only on a made save, never a missed attack roll (the 2014 Potent Cantrip). */
    savesOnly?: boolean;
  } & FeatureEffectScope)
  | ({
    /** Its spells (as scoped) with a range of at least `minRange` feet reach `bonus` feet farther (Improved Elemental Fury: 300). */
    kind: "spell-range";
    bonus: number;
    minRange?: number;
  } & FeatureEffectScope)
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
  } & FeatureEffectConditions)
  | {
    /**
     * Heated Body, Corrosive Form, a balor's Fire Aura: a creature that hits the bearer with a melee attack while
     * within `withinFt` (default 5) takes this damage.
     */
    kind: "melee-retaliation";
    damage: DamageComponent[];
    withinFt?: number;
  }
  | {
    /** Evasion: a Dexterity save that would halve damage instead negates it on a success and halves it on a failure. */
    kind: "evasion";
  }
  | {
    /** Adamantine armor: a critical hit against the bearer becomes a normal hit (a DM's ruling on the roll stands). */
    kind: "no-critical-hits";
  }
  | {
    /**
     * Weapon Mastery (SRD 5.2): the kinds of weapon (`WeaponDefinition.baseWeapon`) whose mastery property this creature
     * can use, or `"all"`. A weapon's attacks carry its property only for a wielder that has mastered its kind.
     */
    kind: "weapon-mastery";
    weapons: string[] | "all";
  }
  | {
    /**
     * Martial Arts: while it wears no armor and holds no shield, its Monk weapons (simple melee weapons, and martial
     * melee weapons with the Light property) attack as its Unarmed Strike (`weaponId`) does: with Dexterity when that's
     * better, the Martial Arts die when that's bigger, and the Unarmed Strike's options on a hit (Stunning Strike).
     */
    kind: "martial-arts-weapons";
    weaponId: Id;
    /**
     * Which weapons are Monk weapons: the 2024 rule's (simple melee, and martial melee with the Light property), or the
     * 2014 rule's (shortswords, and simple melee weapons without the Two-Handed or Heavy property).
     */
    monkWeapons?: "2014" | "2024";
  }
  | {
    /**
     * Improved Cunning Strike: two of its on-hit options that trade dice of this feature's damage bonus (Sneak Attack)
     * on one hit, paying both: a compiled copy for each pair.
     */
    kind: "paired-on-hit-options";
    featureId: Id;
  }
  | {
    /**
     * Tactical Master: an attack with a weapon whose mastery it uses can use one of these masteries instead: a compiled
     * copy of the attack for each (`<id>:mastery-<property>`).
     */
    kind: "mastery-swap";
    masteries: WeaponMastery[];
  }
  | {
    /** Something its hits can be upgraded with for a cost paid only when it lands (Eldritch Smite, Fire's Burn). */
    kind: "on-hit-option";
    option: OnHitOption;
  }
  | ({
    /**
     * Horde Breaker: once on each of its turns, after an attack with a weapon (hit or miss), another attack with the same
     * weapon against a different creature within `withinFt` of the first target, in its reach or range, that it hasn't
     * attacked this turn.
     */
    kind: "follow-up-attack";
    withinFt: number;
  } & FeatureEffectScope)
  | {
    /**
     * Persistent Rage: its condition with this id (an activation's) needs no upkeep and isn't ended by being
     * incapacitated, only by falling unconscious; with `durationRounds`, it lasts that long instead.
     */
    kind: "condition-persists";
    conditionId: Id;
    durationRounds?: number;
  }
  | {
    /**
     * Hunter's Defensive Tactics: attack rolls against it at disadvantage: opportunity attacks (`"opportunity"`, Escape
     * the Horde), or the other attack rolls this turn of a creature that hit it (`"after-hit"`, Multiattack Defense).
     */
    kind: "attack-defense";
    against: "opportunity" | "after-hit";
  }
  | ({
    /**
     * Overwhelming Strike: on an attack roll of 20, extra damage of the attack's type equal to the score of the ability
     * the attack uses (the one the boon raised). Not doubled by the critical hit.
     */
    kind: "natural-twenty-damage";
  } & FeatureEffectScope)
  | {
    /** Boon of Irresistible Offense: its damage of these types ignores resistance (not immunity). */
    kind: "ignore-resistance";
    damageTypes: DamageType[];
  }
  | ({
    /**
     * Overchannel: a copy of each spell in scope cast with a slot of level 1 to `maxSlot` that deals damage, at its
     * dice's highest (`<id>:overchannel`), paying `resourceCost` beside the slot.
     */
    kind: "max-damage";
    maxSlot: number;
    resourceCost: ResourceCost;
  } & FeatureEffectScope)
  | ({
    /**
     * Improved Blessed Strikes (Potent Spellcasting): when a spell in scope deals damage, `tempHp` temporary hit points
     * to the caster or a creature within `withinFt` of it: the ally with the least of its hit points left.
     */
    kind: "damage-vitality";
    tempHp: NumericFormula;
    withinFt: number;
  } & FeatureEffectScope)
  | {
    /**
     * Self-Restoration: at the start or end of each of its turns, it ends one of these conditions on itself (the worst).
     */
    kind: "shed-conditions";
    conditions: ConditionName[];
    timing: "turn-start" | "turn-end";
  }
  | {
    /**
     * Boon of Spell Recall: casting a spell with a slot of `maxLevel` or lower, a d`die` that comes up the slot's level
     * means the slot isn't spent.
     */
    kind: "slot-recall";
    maxLevel: number;
    die: number;
  }
  | ({
    /**
     * Sculpt Spells: its area spells in scope (evocations) spare `base` (+ the spell's level, with `plusSpellLevel`) of
     * its allies in the area, who succeed on their saves without rolling and take no damage on a success.
     */
    kind: "spare-allies";
    base: number;
    plusSpellLevel?: boolean;
  } & FeatureEffectScope)
  | {
    /**
     * A Metamagic option it knows: each spell it can change gets a copy cast with it ("Fireball (Quickened)"), paying
     * `resourceCost` (sorcery points) beside the spell's own (`extraCost`).
     */
    kind: "metamagic";
    option: MetamagicOption;
    resourceCost: ResourceCost;
  }
  | {
    /**
     * Sorcery Incarnate, Arcane Apotheosis: while it has a condition with this id (Innate Sorcery's), two of its Metamagic
     * options on one spell (`pairs`: a copy for each pair, paying both), or one of them once on each of its turns for no
     * sorcery points (`freeOncePerTurn`).
     */
    kind: "metamagic-boost";
    whileCondition: Id;
    pairs?: boolean;
    freeOncePerTurn?: boolean;
  }
  | {
    /**
     * A reaction attack when hit (Retaliation): each of its attacks of these types (default melee) gets a reaction copy,
     * made against the attacker when `trigger` passes.
     */
    kind: "reaction-attack";
    trigger: Extract<ReactionTrigger, { kind: "hit-by-attack" }>;
    attackTypes?: Array<"melee" | "ranged" | "spell">;
  }
  | ({
    /**
     * Damage of these types (any, without `damageTypes`) that each hit or effect deals it is reduced by `amount`, before
     * resistance as the rules order it, coming off the parts it covers in order (Heavy Armor Master: bludgeoning,
     * piercing and slashing from nonmagical attacks, by 3; the 2024 feat: its proficiency bonus, in heavy armor).
     */
    kind: "damage-reduction";
    amount: NumericFormula;
    damageTypes?: DamageType[];
    nonMagicalOnly?: boolean;
  } & FeatureEffectConditions)
  | {
    /** Difficult terrain costs it no extra movement (Freedom of Movement, Land's Stride). Hazards still work. */
    kind: "ignore-difficult-terrain";
  }
  | {
    /**
     * Its size while this works: `to` a size, or `steps` larger (1, Enlarge) or smaller (-1, Reduce) than its own
     * (stats.ts). A condition's older `sizeTo` modifier comes after it.
     */
    kind: "size";
    to?: SizeCategory;
    steps?: number;
  }
) & SelfGate;

/**
 * Something an attack's hit can be upgraded with, for a cost paid only when it lands: a smite spell (Divine Smite), an
 * invocation (Eldritch Smite), a species' boon (a goliath's Fire's Burn). Compiled into a variant of each attack it can
 * follow ("Longsword (Divine Smite)"), the upgrade as on-hit riders; the AI picks the variant when the damage is worth
 * the cost, and the cost is paid only on a hit.
 */
export interface OnHitOption {
  /** On the variant's name: "Longsword (Divine Smite)". */
  name: string;
  /** The attacks it can follow, by type. Absent: any. */
  attackTypes?: Array<"melee" | "ranged" | "spell">;
  /** Only these attacks (a pact weapon's), by action id. */
  actionIds?: Id[];
  /** Only weapon attacks (a melee weapon or an Unarmed Strike), not spells. Default false. */
  weaponOnly?: boolean;
  /** What the hit gets: damage, a condition. */
  riders: ActionRider[];
  /** What a use spends: a spell slot, a pool. */
  resourceCost?: ResourceCost;
  /** It takes the bonus action (a smite spell is cast as one). */
  bonusAction?: boolean;
  /** Once a turn, whichever attack it follows. */
  oncePerTurn?: boolean;
  /** With `oncePerTurn`: options with the same key share the once (Brutal Strike's blows: one of them a turn). */
  onceKey?: string;
  /**
   * Cast with a higher slot: this much more on its first damage rider per level above the spell's. A variant per slot.
   * `maxAbove`: no more than this many levels' worth (the 2014 Divine Smite's 5d8: three above a 1st-level slot's 2d8).
   */
  upcast?: { damageDice: string; maxAbove?: number };
  /**
   * Paid in dice of a damage bonus instead of a resource (Cunning Strike: Sneak Attack's). It's offered only on the
   * attacks that bonus can add to, and comes only with the bonus's damage, which loses the dice.
   */
  tradesDice?: OnHitDiceTrade;
  /** On the hit, the attacker can move up to this far (default half its speed), with `noOpportunityAttacks` provoking none (Withdraw). */
  move?: OnHitMove;
  /**
   * Paid with the attack roll's advantage (Brutal Strike): only while the attacker holds `whileCondition` (Reckless
   * Attack's), the roll gives up any advantage, and one with disadvantage can't take it.
   */
  forgoesAdvantage?: { whileCondition?: string };
  /** Only attacks that use one of these abilities (Brutal Strike: Strength). */
  abilities?: Ability[];
  /**
   * Only as a swing of a routine, not on its own (Open Hand Technique: Flurry of Blows' strikes, not the Martial Arts
   * bonus one). With `actionIds`, a bonus action's attack can take it too.
   */
  routineOnly?: boolean;
}

/**
 * Metamagic (SRD 5.2). `quickened`: an action's spell cast with a bonus action, with no other level 1+ spell that turn.
 * `distant`: double range (touch: 30 ft). `twinned`: one more target for a spell that gains them by slot. `transmuted`:
 * acid, cold, fire, lightning, poison or thunder damage as the best of those. `subtle`: it can't be countered.
 * `heightened`, `careful`, `empowered`, `extended`: see `metamagicVariant`.
 */
export type MetamagicOption = "careful" | "distant" | "empowered" | "extended" | "heightened" | "quickened" | "subtle" | "transmuted" | "twinned";

/** Cunning Strike's cost: this many dice of the feature's `damage-bonus` (Sneak Attack's d6s). */
export interface OnHitDiceTrade {
  featureId: Id;
  dice: number;
}

/** A move an on-hit option gives the attacker: up to `feet` (default half its speed), after the hit. */
export interface OnHitMove {
  feet?: number;
  noOpportunityAttacks?: boolean;
}
/**
 * An always-on aura a creature radiates (Stench, Fear Aura, a balor's Fire Aura). Unlike `FeatureDefinition.aura`
 * (a buff it shares), this does something TO the creatures near it at a turn boundary:
 * - `"target-turn-start"`: each creature that starts its turn within `range` (Stench, Fear Aura);
 * - `"bearer-turn-start"`: at the start of the bearer's own turn, everyone within `range` (Fire Aura).
 * A `save` gates the rest; `immuneOnSave` makes a creature that succeeds immune for the encounter (the 24-hour rule).
 */
export interface TraitEmanation {
  range: number;
  timing: "target-turn-start" | "bearer-turn-start";
  affects: "hostile" | "all";
  save?: { ability: Ability; dc: number };
  damage?: DamageComponent[];
  /** With a save and damage: half damage on a success (otherwise a success takes none). */
  halfOnSave?: boolean;
  /** Applied on a failed save (or always, without a save), lasting until the start of the affected creature's next turn. */
  condition?: ConditionName;
  immuneOnSave?: boolean;
  /** The aura goes quiet while the bearer is incapacitated (Fear Aura: "unless the pit fiend is incapacitated"). */
  suppressedWhenIncapacitated?: boolean;
}

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
  | { kind: "until-start-of-next-turn" }
  /**
   * Clears at the start or the end of the next turn of the creature that applied it (weapon mastery: Sap and Slow
   * "until the start of your next turn", Vex "before the end of your next turn").
   */
  | { kind: "until-source-turn"; timing: "start" | "end" }
  /** Clears at the end of the bearer's next turn (Cunning Strike's Obscure: blinded "until the end of its next turn"). */
  | { kind: "until-end-of-next-turn" };

/**
 * A change to the next attack roll, used up by it. `"made"`: the bearer's own (Sap: disadvantage; Steady Aim:
 * advantage). `"against"`: the next one made against the bearer, by the creature that set it (Vex), or with `byOthers`
 * by anyone else (Sundering Blow: +5).
 */
export interface NextAttackChange {
  role: "made" | "against";
  mode?: "advantage" | "disadvantage";
  bonus?: number;
  byOthers?: boolean;
}

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
  /**
   * With `"negates"`: a lesser condition a made save gives instead (Stunning Strike: speed halved, and the next attack
   * against it with advantage, until the start of the source's next turn).
   */
  instead?: {
    condition: ConditionName | { custom: string };
    duration: RiderDuration;
    modifiers?: ConditionInstance["modifiers"];
    conditionKey?: string;
    nextAttack?: NextAttackChange;
  };
}

interface ActionRiderCommon {
  id?: Id;
  /** Fire at most once per the source creature's turn (Sneak-Attack style). */
  oncePerTurn?: boolean;
  /**
   * With `oncePerTurn`: riders with the same key share the once, whatever action carries them (one Eldritch Smite a
   * turn, whichever weapon hits). Without it, each action's rider has its own.
   */
  onceKey?: string;
  /**
   * Riders in a group land together: once one is skipped (no resource, no bonus action, already used this turn), the
   * rest of its group after it are too (Divine Smite's extra die against undead needs the smite).
   */
  group?: string;
}

interface TriggeredRider extends ActionRiderCommon {
  when: RiderGate;
  /**
   * Takes the source's bonus action when it fires (a smite spell, cast as a bonus action right after a hit). Skipped,
   * costing nothing, when that's already been used this turn.
   */
  economy?: "bonus";
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
  /**
   * If set, this rider's effect only applies to targets whose `CreatureDefinition.type`
   * is in this list — every other target is treated as automatically unaffected by this
   * rider (no roll; the rider is silently skipped for them). The action's own attack/save
   * roll and any other riders still resolve normally.
   */
  restrictToCreatureTypes?: CreatureType[];
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
      /**
       * A fixed name for the condition on its bearer, so it replaces rather than stacks with the same effect from another
       * source (two Slow weapons: still only 10 ft slower). Also its name in the log and on the token.
       */
      conditionKey?: string;
      /** It changes, and is used up by, the next attack roll: see `ConditionInstance.nextAttack`. */
      nextAttack?: NextAttackChange;
      /** It changes, and is used up by, the bearer's next saving throw (Staggering Blow: disadvantage). */
      nextSave?: { mode: "advantage" | "disadvantage" };
      /** It ends when its bearer takes damage, other than the same action's (Turn Undead, Abjure Foes). */
      endsOnDamage?: boolean;
      /** It ends when the creature that gave it is incapacitated or dies (Turn Undead). */
      endsWithSource?: boolean;
      /** Only a creature this size or smaller (Cunning Strike's Trip: Large). */
      maxSize?: SizeCategory;
    })
  | (TriggeredRider & {
      kind: "push";
      distance: number;
      /** Only pushes a creature this size or smaller (weapon mastery's Push: Large). */
      maxSize?: SizeCategory;
      /** A made save stops it (Open Hand Technique's Push: Strength). */
      save?: { ability: Ability; dc?: number; dcFormula?: NumericFormula };
    })
  | (TriggeredRider & {
      /**
       * Swallows the target (a behir, a purple worm, a kraken): it is blinded and restrained inside, can't be reached
       * from outside or caught in outside area effects, and can only attack the swallower. Any grapple on it ends.
       */
      kind: "swallow";
      /** Only swallows a creature this size or smaller. */
      maxSize?: SizeCategory;
      /** Only swallows a creature the swallower is already grappling ("the target it is grappling"). */
      requiresHeld?: boolean;
      /** The target avoids being swallowed with this save (a purple worm's Dexterity save). */
      save?: { ability: Ability; dc: number };
      /** Damage the swallowed creature takes at the start of each of the swallower's turns. */
      damage?: DamageComponent[];
      /** If the swallower takes `damage` or more in one turn from creatures inside it, it makes a Constitution save or spits them out. */
      regurgitate?: { damage: number; dc: number };
      /** How many creatures it can hold inside at once. Default 1. */
      capacity?: number;
    })
  | (TriggeredRider & {
      /**
       * Grapples the target ("grappled (escape DC 13)"). The target stays held until it escapes with an
       * action, the holder is stopped (incapacitated, dead) or gets out of reach.
       */
      kind: "hold";
      escapeDc: number;
      /** Only holds a creature this size or smaller. */
      maxSize?: SizeCategory;
      /** The target is also restrained until the hold ends. */
      restrained?: boolean;
      /** How many creatures the holder can hold with this action at once (a crab's two claws: 2). Default 1. */
      limit?: number;
      /** Damage the held creature takes at the start of each of its turns (a chain devil's chains). */
      recurringDamage?: DamageComponent[];
    })
  | (ActionRiderCommon & { kind: "note"; text: string });

/* ─── Reaction triggers ────────────────────────────────────────────────────────
 * What must happen for a `reaction`-typed action to become available. Consumed
 * by `runReactionWindow` (engine). Only meaningful on an action whose
 * `actionType === "reaction"`.
 */
export type ReactionTrigger =
  /** An enemy the reactor threatens leaves its melee reach (opportunity attack). */
  | { kind: "enemy-leaves-reach" }
  /** The reactor is targeted by an attack, before the roll. */
  | { kind: "targeted-by-attack"; meleeOnly?: boolean }
  /**
   * An attack roll against the reactor hits, before damage, and the reaction would make it miss (Shield, Parry). Never
   * on a critical hit. Offered only when what the reaction gives raises the reactor's AC past the roll.
   */
  | { kind: "would-be-hit"; meleeOnly?: boolean }
  /** The reactor was hit by an attack (Hellish Rebuke). */
  | {
    kind: "hit-by-attack"; meleeOnly?: boolean;
    /** Only an attacker within this many feet (Retaliation: 5). */
    withinFt?: number;
    /** Only when the hit dealt the reactor damage (Retaliation: "when you take damage"). */
    damaged?: boolean;
    /** Damage from the creature that isn't an attack's hit counts too: a spell's save, an area (Retaliation). */
    anyDamage?: boolean;
  }
  /**
   * The reactor is about to take damage: rolled, its resistances counted, not yet landed. An activation's `damageCut`
   * cuts it (Uncanny Dodge, Deflect Attacks, Stone's Endurance) or resists it (Superior Hunter's Defense).
   * `attackOnly`: only an attack roll's hit; `damageTypes`: only damage that includes one of these (Deflect Attacks:
   * bludgeoning, piercing, slashing).
   */
  | {
    kind: "would-take-damage"; attackOnly?: boolean; damageTypes?: DamageType[];
    /** Only a ranged weapon attack's hit (Deflect Missiles). */
    rangedOnly?: boolean;
    /**
     * Its own side's damage too, from a creature within `withinFt` of the reactor: the reactor or any ally about to take
     * it (Cutting Words: a foe's damage roll within 60 ft, the bard's die off it).
     */
    forAllies?: { withinFt: number };
  }
  /** An ally within `withinFt` is targeted by an attack (Protection fighting style). */
  | { kind: "ally-targeted-by-attack"; withinFt: number }
  /**
   * An enemy within `withinFt` casts a spell of level ≤ `maxSpellLevel` (Counterspell). A spell no higher than the
   * reaction's slot is stopped outright; one above it takes a check with the reactor's spellcasting ability against
   * `checkAbove.dcBase` + the spell's level (Counterspell: 10). `false`: it can't counter above its slot at all. A saved
   * counter without it is given Counterspell's (`migrateDefinition`).
   */
  | {
    kind: "enemy-casts-spell"; withinFt: number; maxSpellLevel?: number; checkAbove?: CounterCheck | false;
    /**
     * The 2024 Counterspell: the caster makes this saving throw against the counterer's spell save DC instead, a failure
     * stopping the spell whatever its level (and its slot isn't spent); the counter's own slot level doesn't matter.
     */
    casterSave?: Ability;
  }
  /** Author-described — reference only, never auto-fires. */
  | { kind: "manual"; note: string };

/** The check a counter makes against a spell above its slot's level: DC `dcBase` + the spell's level. */
export interface CounterCheck {
  dcBase: number;
  /** Added to the roll (an Abjurer's proficiency bonus, a homebrew item). */
  bonus?: number;
}

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
  /**
   * How long what an activation gives lasts, in place of its condition's own duration: `"triggering-attack"` only
   * against the attack that set it off (Parry); `"until-start-of-next-turn"` until the start of the reactor's next
   * turn (Shield).
   */
  lastsFor?: "triggering-attack" | "until-start-of-next-turn";
}

export interface AttackActionDefinition {
  kind: "attack";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  /** Its riders' saves count as saves against a magical effect. Implied by `attackType: "spell"` / `spellLevel`. */
  magical?: boolean;
  attackType: "melee" | "ranged" | "spell";
  /** Can only target a creature this attacker is grappling (a swallow: "one bite attack against a target it is grappling"). */
  requiresHeld?: boolean;
  /** Half its damage on a miss, and nothing else (Potent Cantrip's cantrips). */
  halfDamageOnMiss?: boolean;
  /** The properties of the weapon it's made with (finesse, light, two-handed, versatile…). Absent for anything but a weapon. */
  weaponProperties?: string[];
  /**
   * Only usable after something this turn: `"charge-hit"` against a creature its charge / pounce already hit (Pounce,
   * Trampling Charge); `"dropped-creature"` once it has dropped a creature to 0 HP with a melee attack (Rampage).
   */
  onlyAfter?: "charge-hit" | "dropped-creature";
  /** Only against a target that has this condition (Pounce's bite: "If the target is prone"). */
  requiresTargetCondition?: ConditionName;
  /** Extra movement this attack grants before it is made, in feet (Rampage: "move up to half its speed"). */
  grantsMovementFeet?: number;
  /** Damage instead of `damage` while the attacker is at half its hit points or fewer (a swarm's weaker bite). */
  bloodiedDamage?: DamageComponent[];
  /** The weapon mastery property this attack uses, stamped by `weaponToActions` when its wielder has mastered it. */
  mastery?: WeaponMastery;
  /**
   * Cleave: on a melee hit, once per turn, an attack with the same weapon against a second creature within 5 ft of the
   * first and in reach, its damage without a positive ability modifier.
   */
  cleave?: boolean;
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
  /** Only as a swing of a routine (Open Hand Technique's options on Flurry of Blows' strikes). */
  routineOnly?: boolean;
  /**
   * True Strike: the spell is an attack with one of the caster's weapons (`WeaponCantrip`). `getExecutableActions`
   * compiles a copy of the spell for each weapon that fits and drops this action, whose own numbers aren't used.
   */
  withWeapon?: WeaponCantrip;
  /**
   * Its `resourceCost` is an on-hit rider's, shown on the attack so planning sees what it spends: paid when the rider
   * lands, not when the attack is made (a weapon's charge, Stunning Strike's focus point, a smite's slot).
   */
  costPaidOnHit?: boolean;
  /**
   * A variant made from an on-hit option with terms beyond a cost (`onHitOptionVariants`): its riders (those in
   * `group`) and its move land only when they're met. With `tradesDice`, only with that damage bonus's damage, which
   * gives up the dice (Cunning Strike).
   */
  onHitTerms?: {
    group: string;
    name: string;
    tradesDice?: OnHitDiceTrade;
    move?: OnHitMove;
    /** Brutal Strike: the roll gives up its advantage, while the attacker holds this condition. */
    forgoesAdvantage?: { whileCondition?: string };
    /** Once a turn: the key its riders share (`wasRiderUsedThisTurn`). */
    onceKey?: string;
  };
  /** On-hit effects: extra damage, a save-or-condition, a shove. */
  riders?: ActionRider[];
  resourceCost?: ResourceCost;
  /** Using this action sets the actor's concentration (some spell attacks). */
  concentration?: boolean;
  /** Base level of the spell this came from — stamped by `getExecutableActions`. Drives `upcast`. */
  spellLevel?: number;
  upcast?: SpellUpcast;
  /** Limited use (recharge / per-encounter). Recorded by the SRD generator; enforced in a later phase. */
  usage?: ActionUsage;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface SaveActionDefinition {
  kind: "save";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  /** A magical effect (a spell, "against this magic"): Magic Resistance and similar effects apply to its save. Implied by `spellLevel`. */
  magical?: boolean;
  /** A creature that makes the save is immune to this creature's action afterwards ("…is immune to the dragon's Frightful Presence for the next 24 hours"). */
  immuneAfterSave?: boolean;
  /** Breath Weapon: it takes the place of one of the Attack action's attacks (`MultiattackActionDefinition.attackAction`). */
  replacesAttack?: boolean;
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
  /** Limited use (recharge / per-encounter). Recorded by the SRD generator; enforced in a later phase. */
  usage?: ActionUsage;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface AreaSaveActionDefinition {
  kind: "area-save";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  /** A magical effect (a spell, "against this magic"): Magic Resistance and similar effects apply to its save. Implied by `spellLevel`. */
  magical?: boolean;
  /** A creature that makes the save is immune to this creature's action afterwards ("…is immune to the dragon's Frightful Presence for the next 24 hours"). */
  immuneAfterSave?: boolean;
  /** Breath Weapon: it takes the place of one of the Attack action's attacks (`MultiattackActionDefinition.attackAction`). */
  replacesAttack?: boolean;
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
  /**
   * Land's Aid: one of the caster's side in the area (itself too) regains this much: the one with the least of its hit
   * points left, a creature at 0 first.
   */
  healsOneAlly?: HealingComponent[];
  /**
   * Abjure Foes: only this many of the creatures in the area, chosen by the caster (`chosenAreaTargets`: its foes with the
   * most hit points left).
   */
  maxTargets?: number;
  riders?: ActionRider[];
  resourceCost?: ResourceCost;
  concentration?: boolean;
  spellLevel?: number;
  upcast?: SpellUpcast;
  /** Leaves a standing `ActiveZone` on the board instead of (or alongside) resolving once at cast time — see `ZonePersistence`. */
  zone?: ZonePersistence;
  /** Limited use (recharge / per-encounter). Recorded by the SRD generator; enforced in a later phase. */
  usage?: ActionUsage;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/** When during a bearer's presence in a zone it re-triggers the zone's damage/save/riders. */
export type ZoneTrigger = "on-enter" | "start-of-turn-in-zone" | "end-of-turn-in-zone";

/**
 * How long a persistent zone lasts. A narrower vocabulary than `RiderDuration`
 * — a zone has no bearer to roll a repeat save, so `save-ends` /
 * `until-start-of-next-turn` don't apply; it only ever ticks at the global
 * round boundary or tears down with the caster's concentration.
 */
export type ZoneDuration =
  | { kind: "rounds"; rounds: number }
  | { kind: "concentration" }
  | { kind: "permanent" };

/**
 * Cloudkill-style automatic drift: at the start of each of the caster's own
 * turns, the zone moves this many feet directly away from the caster's
 * current position — no choice involved (5e: "The fog moves 10 feet away
 * from you..."). Distinct from `ZoneReposition` (Moonbeam-style, a choice).
 */
export interface ZoneMovement {
  driftFeetPerCasterTurn: number;
}

/**
 * Moonbeam-style caster-directed repositioning: the caster may spend a bonus
 * action to move the zone up to this many feet from its current origin
 * toward wherever they choose. Modeled as a special AI hook
 * (`repositionZone` in combat.ts, considered by `maybeRepositionZone` in
 * simulation.ts) rather than a compiled `ActionDefinition` — the option only
 * exists while the caster actually has a zone of their own on the board, which
 * doesn't fit the static, definition-compiled action model. Always spends the
 * caster's bonus action (matches Moonbeam; no spell needing an `action`-cost
 * reposition exists yet to justify a configurable slot).
 */
export interface ZoneReposition {
  maxFeetPerCasterTurn: number;
}

/**
 * Zone-imposed movement cost, layered onto the map's own terrain wherever the
 * zone currently sits (`zoneTerrainOverlay` in areas.ts) — Web and Spike
 * Growth both become difficult terrain. Uses the same vocabulary as
 * `TerrainZone.type` minus `"normal"`/`"hazard"`/`"cover"`/`"elevation"`/`"custom"`,
 * which don't apply to a spell-imposed effect.
 */
export interface ZoneTerrainEffect {
  type: "difficult" | "impassable";
  /** Only meaningful for `"difficult"`. Default 2 (double cost), matching 5e. */
  movementMultiplier?: number;
}

/**
 * Spike Growth-style automatic movement damage: a creature that moves into
 * or within the zone takes this damage — no saving throw, independent of
 * `trigger`/`saveAbility`/`damage` (which are for the save-gated on-enter /
 * turn-boundary effects other zones use). Applied once per grid step whose
 * *destination* cell falls inside the zone (matches the level of granularity
 * `moveAlongPath` already resolves opportunity attacks at — this engine
 * doesn't model sub-5-ft movement anywhere else either).
 */
export interface ZoneMovementDamage {
  dice: string;
  damageType: DamageType;
}

/**
 * A standing area a spell leaves on the map instead of (or alongside)
 * resolving once at cast time — Insect Plague, Cloudkill, Web. Authored on
 * `AreaSaveActionDefinition.zone` (or `SpellDefinition.zone`, stamped onto the
 * action by `stampSpellContext` the same way `concentration` is); resolved
 * into a runtime `ActiveZone` by `resolveAreaSaveAction`. The zone reuses the
 * action's own `damage` / `saveAbility` / `dc` / `riders` / `affects` /
 * `restrictToCreatureTypes` for each trigger firing — no separate effect
 * authoring. `anchor: "fixed"` plants the zone at the cast location, same as
 * Insect Plague/Cloudkill; `anchor: "self"` instead re-centers the zone on
 * `sourceCombatantId`'s live position every time they move (Spirit
 * Guardians-style auras) — see `recenterSelfAnchoredZones` in combat.ts.
 * `movement`/`repositionable` are only meaningful on an `anchor: "fixed"`
 * zone (a `"self"`-anchored zone already follows its caster continuously).
 */
export interface ZonePersistence {
  duration: ZoneDuration;
  trigger: ZoneTrigger[];
  anchor: "fixed" | "self";
  /** Cloudkill-style automatic drift away from the caster. Only meaningful with `anchor: "fixed"`. Absent = stays put. */
  movement?: ZoneMovement;
  /** Moonbeam-style caster-chosen repositioning (a bonus action). Only meaningful with `anchor: "fixed"`. Absent = the caster can't move it. */
  repositionable?: ZoneReposition;
  /** Spike Growth-style automatic per-step movement damage. Independent of `trigger` — no save. */
  movementDamage?: ZoneMovementDamage;
  /** Web / Spike Growth-style difficult (or impassable) terrain layered onto the map while the zone stands. */
  terrain?: ZoneTerrainEffect;
  /**
   * Heavily obscures the zone's area — checked only by the manual sight
   * gizmo (`lineOfSight`) today, not by targeting/cover (which stay governed
   * by walls + `requireLineOfEffect`, per the existing rules profile).
   */
  blocksSight?: boolean;
  /**
   * Also resolve the action's normal area-save burst at cast time, in
   * addition to creating the zone. Default `false` — most persistent zones
   * (Insect Plague, Web) don't damage anyone the instant they're cast.
   */
  applyOnCast?: boolean;
  color?: string;
}

/**
 * A live persistent-area instance on the board, created by casting a spell
 * whose compiled action carries `zone`. Lives on `EncounterSnapshot.activeZones`
 * — mutated by the engine (`combat.ts`) and folded forward by the replay
 * reducer (`ZoneCreated` / `ZoneExpired` log events) the same way conditions are.
 */
export interface ActiveZone {
  id: Id;
  name: string;
  sourceCombatantId: Id;
  sourceActionId: Id;
  origin: Point;
  area: AreaTemplate;
  /** `"fixed"` stays where it was cast; `"self"` is kept re-centered on `sourceCombatantId`'s live position by `recenterSelfAnchoredZones` (combat.ts) every time that combatant moves. */
  anchor: "fixed" | "self";
  affects: "hostile" | "all";
  trigger: ZoneTrigger[];
  movement?: ZoneMovement;
  repositionable?: ZoneReposition;
  movementDamage?: ZoneMovementDamage;
  terrain?: ZoneTerrainEffect;
  blocksSight?: boolean;
  saveAbility?: Ability;
  /** Resolved to a concrete number at creation — a spell's DC doesn't change round to round. */
  dc?: number;
  damage?: DamageComponent[];
  onSuccess?: "half" | "none" | "negates";
  riders?: ActionRider[];
  concentration: boolean;
  /** Absolute round this zone expires at (checked at the round boundary). Absent for concentration/permanent zones. */
  expiresAtRound?: number;
  createdRound: number;
  /** Last round each combatant was hit by this zone, keyed by combatant id — dedupes on-enter + start-of-turn firing twice in the same round. */
  appliedRounds?: Record<Id, number>;
  color?: string;
}

export interface HealingActionDefinition {
  kind: "healing";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  range: number;
  healing: HealingComponent[];
  /**
   * `"self"` targets the actor. `"chosen"` picks up to `count` allies within
   * `range` of the caster (Prayer of Healing). `"area"` heals everyone
   * caught in `area` (Mass Cure Wounds) — resolved via `resolveHealingBurstAction`,
   * not this shape's own `resolveHealingAction`, which stays single-target
   * only. Default `"single"`. `notSelf`: never the actor (giving a potion: drinking it is its own use).
   */
  targeting?: { target: "single" | "self" | "chosen" | "area"; count?: number; notSelf?: boolean };
  /** Only meaningful when `targeting.target === "area"`. */
  area?: AreaTemplate;
  /** Only meaningful when `targeting.target === "area"`. Placement/aim, same shape `area-save` actions use. */
  areaTargeting?: AreaTargeting;
  riders?: ActionRider[];
  resourceCost?: ResourceCost;
  spellLevel?: number;
  upcast?: SpellUpcast;
  /** Limited use (recharge / per-encounter). Recorded by the SRD generator; enforced in a later phase. */
  usage?: ActionUsage;
  /**
   * Healing drawn from a pool by any amount (Lay on Hands): `healing` is ignored; it restores what the target is
   * missing, up to what's left in `resourceId`, spending the pool point for point. Unusable with the pool empty.
   */
  fromPool?: { resourceId: string };
  /**
   * With `fromPool`: conditions it can end on the creature, `poolCost` of the pool each (Lay On Hands: Poisoned for 5;
   * Restoring Touch adds Blinded, Charmed, Deafened, Frightened, Paralyzed and Stunned). The worst go first, as far as
   * the pool goes; what's left heals.
   */
  cures?: { conditions: ConditionName[]; poolCost: number };
  /**
   * Healing shared out (Preserve Life, with `targeting: "chosen"`): `total` hit points, `healing` ignored, divided among
   * the creatures chosen, the most hurt first. `upToHalf`: none past half its hit point maximum; `bloodiedOnly`: only
   * creatures at half their hit points or fewer.
   */
  divided?: { total: number; upToHalf?: boolean; bloodiedOnly?: boolean };
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * Instantly moves a combatant to a chosen point within `range` — Misty Step,
 * Dimension Door. Bypasses `moveCombatant`'s pathfinding, movement budget,
 * and opportunity-attack scan entirely (that's the point of a teleport); the
 * resolver still runs the same "arrival" side effects a normal step would
 * (on-enter zone/terrain triggers, self-anchored zone recentering), just
 * never the per-step ones (opportunity attacks, movement damage) since the
 * mover never occupies the intervening squares.
 */
export interface RepositionActionDefinition {
  kind: "reposition";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  /** Max feet from the caster to both the mover (in `"single"` mode) and the chosen destination. */
  range: number;
  /** `"single"` moves another creature within `range`. `"self"`, or leaving it out, moves the actor (`resolveRepositionAction`). */
  targeting?: { target: "single" | "self" };
  /**
   * Gate the destination behind `RuleProfile.requireLineOfEffect` like every
   * other targeted action. Default/omitted = `false` — a teleport bypassing
   * mundane sightline blocking is the point of the spell (Misty Step), so
   * this is opt-in for the rare spell that should require seeing the
   * destination, not opt-out.
   */
  requiresLineOfEffect?: boolean;
  resourceCost?: ResourceCost;
  concentration?: boolean;
  spellLevel?: number;
  upcast?: SpellUpcast;
  /** Limited use (recharge / per-encounter). Recorded by the SRD generator; enforced in a later phase. */
  usage?: ActionUsage;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * Grants a beneficial condition at range — Bless, Haste, Shield of Faith.
 * Every other shape is adversarial (`attack`/`save`/`area-save` roll
 * against a target) or self-only (a Feature's own bearer, `healing`'s
 * `self` mode) — nothing else lets a spell target a willing ally with
 * something good. No save: the target is always willing, so there's no
 * gate to roll, unlike `ActionRider`'s `condition` kind.
 */
export interface BuffActionDefinition {
  kind: "buff";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  /** Max feet from the caster to each target. Irrelevant (but still required — use 0) for `"self"`. */
  range: number;
  /**
   * `"chosen"` picks up to `count` allies, each independently within `range` of the caster (Bless: "up to three
   * creatures within range of you" — not an area template). Default `"single"`. `notSelf`: never the actor (giving a
   * potion).
   */
  targeting?: { target: "self" | "single" | "chosen"; count?: number; notSelf?: boolean };
  /** The condition granted. Reuses the same shape `apply-condition-on-hit` already carries — no save block, matching `ActivateFeatureActionDefinition.condition`'s pattern rather than `ActionRider`'s (which has one, since a rider is adversarial). */
  appliedCondition: FeatureEffectConditionApplication;
  /** Temporary HP granted alongside the condition (Aid-style). Rolled once, applied identically to every resolved target via `Math.max` (5e: temp HP doesn't stack). */
  tempHp?: HealingComponent[];
  resourceCost?: ResourceCost;
  concentration?: boolean;
  spellLevel?: number;
  upcast?: SpellUpcast;
  /**
   * Conventionally always cast before combat for its long (8-24 hour) real
   * duration rather than spent as an in-combat action (Aid, Mage Armor,
   * Heroes' Feast) — never offered to the AI as an in-combat candidate
   * (`selectBuffAction`/`selectBuffBurstAction` filter it out); applied
   * instead via a DM toggle in the encounter setup UI
   * (`togglePrepBuff`, `encounter-store.ts`), permanently (no `expiresAt`)
   * until toggled off or the encounter restarts.
   */
  prepOnly?: boolean;
  /**
   * A mark (Hunter's Mark, Hex): the condition goes on a foe, its `incoming-hit-damage` (`onlyFromSource`) adding to the
   * caster's hits on it. When the marked creature drops, a compiled `<id>:move-mark` action (a bonus action unless
   * `moveWith` says otherwise) moves the mark to another creature, without a slot, for as long as concentration lasts.
   */
  mark?: MarkSpec;
  /**
   * Shillelagh: while the condition lasts, attacks with the caster's weapons that fit are made as `WeaponCantrip`
   * says: compiled copies of those weapons' attacks, usable only while it does. Without a weapon that fits, the
   * spell isn't offered.
   */
  imbuesWeapon?: WeaponCantrip;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * True Strike, Shillelagh: an attack with one of the caster's weapons (one it carries, never an Unarmed Strike) that
 * uses its spellcasting ability for the attack and damage rolls.
 */
export interface WeaponCantrip {
  /** Only weapons of these kinds (`WeaponDefinition.baseWeapon`; Shillelagh: club, quarterstaff). None: any. */
  weapons?: string[];
  /** Only its melee attacks (Shillelagh). */
  meleeOnly?: boolean;
  /** The ability it uses: the caster's spellcasting ability unless a class or feat cast it with another. */
  ability?: Ability | "spellcasting";
  /** The weapon's damage die becomes this (Shillelagh: a d8, growing with the caster's level). */
  damage?: Pick<DamageComponent, "dice" | "scaling">;
  /** It can deal this type instead of the weapon's (True Strike: radiant; Shillelagh: force). */
  damageTypeOption?: DamageType;
  /** More damage with it (True Strike's radiant, from 5th level: dice of "0" until then). */
  extraDamage?: DamageComponent[];
}

export interface MarkSpec {
  moveWith?: "action" | "bonus";
  /** Taking damage doesn't break the caster's concentration on it (Relentless Hunter). */
  keepsConcentrationOnDamage?: boolean;
  /** Set on the compiled `:move-mark` action only: it moves a dropped creature's mark rather than casting a new one. */
  moving?: boolean;
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
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  /** What makes this reaction available (only when `actionType === "reaction"`) — Shield, Counterspell. */
  reaction?: ReactionMeta;
  featureId: Id;
  resourceCost?: ResourceCost;
  /**
   * What using it gives back, paid for by `resourceCost`: a resource turned into another (Font of Magic: sorcery points
   * into a spell slot, or a slot into as many points as its level, `"slot-level"`; Font of Inspiration: a slot into a
   * Bardic Inspiration use). Never past `max`.
   */
  gains?: { resourceId: string; amount: number | "slot-level"; max?: number };
  /** Only with none of this left (Sorcery Incarnate: Innate Sorcery for sorcery points once its uses are gone). */
  onlyWhenEmpty?: string;
  /** Once on each of its turns (Wild Resurgence's Wild Shape use from a slot). */
  oncePerTurn?: boolean;
  /** Only before it has moved this turn (Steady Aim). */
  stillOnly?: boolean;
  condition?: {
    id?: Id;
    name?: ConditionName;
    /** Rounds it lasts, ending at the end of the turn it was taken on (0: the end of this turn). */
    durationRounds?: number;
    modifiers?: ConditionInstance["modifiers"];
    effects?: FeatureEffect[];
    /** It changes, and is used up by, the next attack roll (Steady Aim: its own next one, with advantage). */
    nextAttack?: { role: "made" | "against"; mode: "advantage" | "disadvantage" };
    /** Rage: what keeps it going from turn to turn. */
    upkeep?: ConditionUpkeep;
    /** Rage: it ends when the bearer is incapacitated. */
    endsOnIncapacitated?: boolean;
  };
  /** What a `would-take-damage` reaction does to the damage about to land. */
  damageCut?: DamageCut;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * A reaction's cut to the damage about to be taken: `"halve"` it, rounding down (Uncanny Dodge); `"reduce"` it by a roll,
 * `dice` plus an ability modifier plus `bonus` (Deflect Attacks: 1d10 + Dexterity + monk level; Stone's Endurance:
 * 1d12 + Constitution); `"resist"` its damage types until the end of the turn (Superior Hunter's Defense).
 */
export type DamageCut =
  | { kind: "halve" }
  | { kind: "reduce"; dice: string; abilityModifier?: Ability; bonus?: number; redirect?: DamageRedirect }
  | { kind: "resist" };

/**
 * Deflect Attacks: when the cut leaves no damage, it can pay `resourceCost` to send some back. A creature within
 * `meleeFt` (a melee attack's) or `rangedFt` (a ranged one's), the attacker if it's there, makes the save or takes
 * `damage`, of the attack's type ("same-as-attack").
 */
export interface DamageRedirect {
  resourceCost: ResourceCost;
  damage: DamageComponent[];
  save: { ability: Ability; dcFormula: NumericFormula };
  meleeFt: number;
  rangedFt: number;
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
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: "action" | "bonus";
  mode: "dash" | "disengage" | "dodge" | "hide" | "help" | "escape";
  /** More of these taken with it, in the same slot (Patient Defense for a Focus Point: Disengage and Dodge). */
  also?: Array<"dash" | "disengage" | "dodge">;
  /** Temporary hit points it gives (Adrenaline Rush: the proficiency bonus; Heightened Focus: two Martial Arts dice). */
  tempHp?: HealingComponent[];
  resourceCost?: ResourceCost;
  automationSupport: "full" | "partial";
}

/** A generic multiattack step: any of the creature's melee attacks, ranged attacks, or weapon attacks (not spells). */
export type MultiattackGeneric = "melee" | "ranged" | "weapon";

/**
 * One step of a multiattack routine: `count` swings with one ability, or with any attack of a kind.
 * A step naming an attack can use any of its variants swing by swing (a weapon's power attack, a
 * charge it spends); a generic step picks the best matching attack for each swing.
 */
export interface MultiattackStep {
  /** The ability the step uses: a compiled action id (a weapon's attack, an action, a save). Absent for a generic step. */
  actionId?: Id;
  /** A generic step: any melee, ranged or weapon attack the creature has ("two melee attacks", Extra Attack). */
  any?: MultiattackGeneric;
  count: number;
  /**
   * Legacy: aim this step at the target the caller supplies at this index
   * (0 = primary). Out-of-range indices clamp; a dead target falls through to
   * the next live one. Default `0`. Read, no longer written.
   */
  targetGroup?: number;
  /**
   * Whom the step's swings may target. `"different"`: a creature no other swing of this use targets
   * (Tyrannosaurus: "can't make both attacks against the same target"). `"same-as-previous"`: the
   * previous swing's target (Grick: "…against the same target"). Default: anyone in reach.
   */
  target?: "different" | "same-as-previous";
  /** Only if the previous swing hit (Grick: "If that attack hits, the grick can make one beak attack"). */
  requiresPreviousHit?: boolean;
}

export interface MultiattackActionDefinition {
  kind: "multiattack";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  /** The routine. With `options`, the first of the routines it can choose between. */
  attacks: MultiattackStep[];
  /**
   * Other routines it can use instead ("…or it makes two ranged attacks", "It can use its Life Drain in place of one
   * longsword attack"). Each compiles to its own action (`<id>:option-N`), so the AI chooses between them.
   */
  options?: Array<{ label?: string; attacks: MultiattackStep[] }>;
  /** What one use spends (Flurry of Blows: 1 ki). */
  resourceCost?: ResourceCost;
  /** Every swing of one use is made with the same weapon (the DM's choice for Extra Attack). Default: each swing picks. */
  oneWeapon?: boolean;
  /**
   * It's the Attack action (Extra Attack's routine): an ability with `replacesAttack` (Breath Weapon) can take the place
   * of one of its attacks, as a compiled copy (`<id>:with-<ability>`).
   */
  attackAction?: boolean;
  /** Statblock sentences the routine doesn't run ("It uses Reel.", a Hydra's heads), shown as not simulated. */
  unsimulated?: string[];
  /** Limited use (recharge / per-encounter). Recorded by the SRD generator; enforced in a later phase. */
  usage?: ActionUsage;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/** One creature this summon can produce. */
export interface SummonOption {
  id: Id;
  /** The `CreatureDefinition` id to spawn — an SRD monster or any of the caller's own saved actors. */
  definitionId: Id;
  label: string;
  /** A flat count, or a dice expression rolled once per use ("2d4 dretches"). */
  count: number | { dice: string };
  /**
   * A spell's own stat block, made when it's summoned from the summoner's numbers and the slot's level (Find Steed's
   * Otherworldly Steed, Summon Dragon's Draconic Spirit). `definitionId` then only names the template.
   */
  template?: SummonTemplate;
}

/** A stat block a spell's summon uses (SRD 5.2), and the choice made when it's cast. */
export type SummonTemplate =
  | { kind: "otherworldly-steed"; creatureType: "celestial" | "fey" | "fiend" }
  | { kind: "draconic-spirit"; damageType: "acid" | "cold" | "fire" | "lightning" | "poison" };

/**
 * Conjure Animals / Summon Demon / Animate Dead — produces new combatants allied with the caster.
 * `chance` (a balor's "50 percent chance of summoning…", a mephit's 25%) gates the whole action: on failure
 * the action is still spent but nothing is produced. Omit for "always works" (Animate Dead has no chance).
 * Once it succeeds, `choice` decides which one of `options` is produced: `"random"` picks uniformly among
 * them (matches a single-option list, e.g. the mephits); `"pick"` is the caster's own choice (an SRD "the
 * demon chooses" — the AI picks the option with the best expected value; a human player is offered the list).
 */
export interface SummonActionDefinition {
  kind: "summon";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  range: number;
  chance?: number;
  options: SummonOption[];
  choice: "pick" | "random";
  /** Omit for "lasts the rest of the encounter" (a permanent ally, e.g. Animate Dead). 1 minute = 10 rounds for spell-style summons. */
  durationRounds?: number;
  /** Ends when the caster's concentration ends, in addition to any `durationRounds`. */
  concentration?: boolean;
  /** It shares the summoner's initiative, taking its turn right after the summoner's (Find Steed, Summon Dragon). */
  sharesInitiative?: boolean;
  /**
   * Dragon Companion: it can also be cast without concentration, lasting this many rounds instead: a compiled copy
   * (`<id>:no-concentration`).
   */
  concentrationOptional?: { durationRounds: number };
  /** How many summoned-of-summoned generations deep this can go before a spawned creature's own summon actions are refused. Default 2. */
  maxGeneration?: number;
  resourceCost?: ResourceCost;
  usage?: ActionUsage;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/** One shape a `transform` action can put the bearer into. */
export interface TransformForm {
  id: Id;
  label: string;
  /** The `CreatureDefinition` id this form's stats/actions come from (a `hidden`, `formOf`-tagged actor). */
  definitionId: Id;
}

/**
 * Shapechanger (werewolf, vampire) / Change Shape — swaps which definition `getDefinition` resolves for this
 * combatant. HP, conditions and position stay on the combatant; only AC/speed/actions/traits/type change.
 */
export interface TransformActionDefinition {
  kind: "transform";
  id: Id;
  name: string;
  /** Reference text shown with the ability (its statblock wording, a note for the DM). Not read by the simulator. */
  description?: string;
  actionType: ActionType;
  forms: TransformForm[];
  /** Drop back to the creature's own (non-`hidden`) base definition instead of one of `forms`. */
  canRevert?: boolean;
  /** Forced back to its base form if this transform's HP-holder dies in a non-base form (lycanthropes/vampires revert on death). */
  revertOnDeath?: boolean;
  /**
   * Wild Shape: each form names a Beast, and the form is that beast's body with what the shifter keeps of itself
   * (`wildShapeForm`, made when it shifts). It gains `tempHp` temporary hit points on shifting; going back costs nothing;
   * being incapacitated ends the form. With `keepsSpells` it can cast its spells in a form (Beast Spells).
   *
   * `hp: "form"` (the 2014 rules): the form has the beast's own hit points, and `tempHp` is ignored. Going back, or
   * being incapacitated, restores the hit points the druid had; a form dropped to 0 goes back with what's left of the
   * damage carried into the druid's own. Default `"temp"` (the 2024 rules).
   */
  wildShape?: { tempHp: number; keepsSpells?: boolean; hp?: "temp" | "form" };
  /** What shifting spends (Wild Shape's uses). Going back to its own form spends nothing. */
  resourceCost?: ResourceCost;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/** What `getExecutableActions` stamps on the copies it compiles. Never authored. */
export interface CompiledActionMeta {
  /** On a spell's action: its school, and the class it's cast as (`SpellDefinition.spellClass`), for features scoped to them. */
  spellSchool?: string;
  spellClass?: string;
  /**
   * On a spell cast with a higher slot (`<id>:upcast-N`): the slot level the spell's own cost names. Any leveled spell
   * can be cast with a higher slot, whether or not that makes it stronger.
   */
  upcastFrom?: number;
  /** On a spell cast at a fixed level without a slot (`SpellDefinition.castAt`): that level. */
  castAt?: number;
  /** On an item's use: the item it comes from. The AI, the hotbar, the log and the report read it. */
  item?: ItemUseMeta;
  /** On a spell cast with Metamagic (`<id>:meta-<option>`): the option, and what it's called ("Quickened Spell"). */
  metamagic?: { option: MetamagicOption; name: string; also?: MetamagicOption; free?: boolean };
  /** A second cost paid along with `resourceCost`: Metamagic's sorcery points beside the spell's slot. */
  extraCost?: ResourceCost;
  /**
   * Only once the creature has taken the Attack action this turn (`TurnFlags.attackActionTaken`): the 2014 Martial
   * Arts' bonus unarmed strike and Flurry of Blows. A weapon's bonus copy gets it from `bonusAfterAttack`.
   */
  afterAttackAction?: boolean;
  /** Empowered Spell: up to this many of its damage dice below average rolled again (the first damage line's). */
  rerollDamageDice?: number;
  /** Overchannel (`<id>:overchannel`): its damage dice give their highest. */
  maximizeDamage?: boolean;
  /** An Attack action with one attack replaced (`<id>:with-<ability>`, Breath Weapon): the ability that replaces it. */
  withReplacement?: { id: Id; name: string; resourceCost?: ResourceCost };
  /** Only as a step of a routine: an ability that replaces one of the Attack action's attacks (Breath Weapon). */
  routineOnly?: boolean;
  /** Tactical Master's copies (`<id>:mastery-<property>`): the weapon's own mastery, and the one used instead. */
  swappedMastery?: { from: WeaponMastery; to: WeaponMastery };
  /** True Strike's copies (`<spell>:with-<weapon>`): the weapon it's made with. */
  viaWeapon?: { id: Id; name: string };
  /** Shillelagh's copies (`<weapon attack>:imbued`): usable only while the attacker has this condition (the spell's). */
  whileCondition?: { id: Id; name: string };
  /**
   * Careful Spell, Sculpt Spells: this many of the caster's allies in the area (the fewest hit points first) succeed on
   * their saves without rolling, and take no damage when a success would halve it.
   */
  spares?: { count: number };
}

/** Which item a compiled action uses, and how. Stamped by `getExecutableActions` on every item use. */
export interface ItemUseMeta {
  id: Id;
  name: string;
  type: ItemType;
  /** Using it spends one of a stack (a potion, a scroll, a flask) rather than a charge. */
  consumes: boolean;
  /** A potion's use: drinking it (its own, self-targeted use) or giving it to a creature within 5 ft (a compiled copy). */
  use?: "drink" | "give";
  /** An action copy of a bonus-action heal that heals its full amount (`ItemDefinition.fullWithAction`). */
  full?: boolean;
}

export type ActionDefinition = (
  | AttackActionDefinition
  | SaveActionDefinition
  | AreaSaveActionDefinition
  | HealingActionDefinition
  | RepositionActionDefinition
  | BuffActionDefinition
  | UnsupportedActionDefinition
  | ActivateFeatureActionDefinition
  | MultiattackActionDefinition
  | UtilityActionDefinition
  | SummonActionDefinition
  | TransformActionDefinition
) & CompiledActionMeta & ActionProvenance;

/** Where an action was copied from, when that matters later: My library's entry (its `slug`), to update or mark it. */
export interface ActionProvenance {
  source?: SourceMetadata;
}

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

/** A weapon's mastery property (SRD 5.2), usable only by a wielder that has mastered that kind of weapon. */
export type WeaponMastery = "cleave" | "graze" | "nick" | "push" | "sap" | "slow" | "topple" | "vex";

export interface WeaponDefinition {
  id: Id;
  name: string;
  /**
   * The kind of weapon it is (`longsword` for a +1 longsword, `dagger` for a Dagger of Venom): what Weapon Mastery is
   * chosen by. Absent: its name, kebab-cased.
   */
  baseWeapon?: string;
  /** Its mastery property (SRD 5.2). It works only for a wielder that has mastered `baseWeapon` (a `weapon-mastery` effect). */
  mastery?: WeaponMastery;
  /** Reference text shown with the weapon. Not read by the simulator. */
  description?: string;
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
  /** Silvered or adamantine: bypasses resistance to "nonmagical … not made with silvered / adamantine weapons". */
  material?: "silvered" | "adamantine";
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
  /** Its bonus-action copy only once the wielder has taken the Attack action this turn (the 2014 Martial Arts). */
  bonusAfterAttack?: boolean;
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
    /**
     * Extra creatures per slot level above the spell's: a single-target `save` action affects them for free (Hold
     * Person), and a buff or healing spell aimed at "up to N" creatures takes that many more (Bless).
     */
    targets?: number;
    /** A buff's hit point maximum bonus grows by this much per slot level above the spell's (Aid: 5). */
    hitPoints?: number;
  };
  /**
   * What a higher slot does that the simulator doesn't model, said in a few words for the DM (a longer duration, a
   * bigger sphere, another bolt). The spell can still be cast with a higher slot; it just does the same thing.
   */
  notModelled?: string;
  /**
   * On an item's use (a Wand of Fireballs): each extra charge it spends casts the spell a level higher, growing as
   * `perSlotAboveBase` says, up to every charge the item holds (and 9th level). Compiled into a copy per charge count,
   * `<use id>:charges-N` (`compileItemUses`).
   */
  byCharges?: boolean;
}

export interface SpellDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  level: number;
  school?: string;
  /**
   * The class this creature casts it as (`"cleric"`), when it's one of that class's spells: what makes it a "Cleric
   * cantrip" for Potent Spellcasting or a "Sorcerer spell" for Innate Sorcery. The character builder sets it.
   */
  spellClass?: string;
  castingTime: "action" | "bonus" | "reaction";
  ritual?: boolean;
  /** Feet, or `"self"` / `"touch"` (resolved to 0 / 5 when compiling to an action). */
  range: number | "self" | "touch";
  concentration?: boolean;
  components?: { v?: boolean; s?: boolean; m?: string };
  resourceCost?: ResourceCost;
  upcast?: SpellUpcast;
  /**
   * Cast as a spell of this level without spending a slot: a free cast at a fixed level (a 2014 tiefling's Hellish
   * Rebuke, "as a 2nd-level spell"). Its upcast applies as if cast with that slot, and a counter sees that level.
   */
  castAt?: number;
  /** Authoring convenience for an `area-save` action's `zone` — stamped onto the compiled action by `stampSpellContext`, same as `concentration`. */
  zone?: ZonePersistence;
  action?: ActionDefinition;
  /**
   * A spell cast as an attack hits (a smite): what it adds to the hit. It has no action of its own; each attack it can
   * follow gets a variant with it (`OnHitOption`).
   */
  onHit?: OnHitOption;
  description?: string;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * A one-time effect that fires automatically when this creature drops to 0 HP
 * (monster `"defeated"` transition, or a PC's 3rd failed death save). Wraps a
 * full `ActionDefinition` so it can reuse the same damage/save/area/riders
 * machinery as a spell — `actionType`/`castingTime`-shaped fields on the
 * wrapped action are ignored since the trigger is automatic, not spent from
 * the dying creature's action economy.
 */
export interface DeathEffectDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  description?: string;
  action: ActionDefinition;
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
  /**
   * Marks this feature as radiating its `effects` to OTHER nearby combatants
   * (in addition to any self-only reading `featureSources` already does) —
   * Aura of Protection, Aura of Courage. Distance is bearer-to-target via
   * `gridDistance` (footprint-agnostic, same simplification Pack Tactics'
   * `ally-adjacent-to-target` proximity check already makes). Gathered live
   * by `auraSources` every time a save/AC is computed — there is no
   * persisted "am I buffed" state, matching how zone membership is also
   * recomputed live rather than stored. Currently only merged into the
   * save-bonus/save-advantage/armor-class family (`featureSaveModifier`,
   * `featureSaveAdvantageModifier`, `effectiveArmorClass`) — the
   * attack-roll family doesn't read auras yet (no SRD aura needs it).
   */
  aura?: {
    /** Feet. */
    range: number;
    affects: "allies" | "all" | "hostile";
    /** Bearer must be `state === "active"` (conscious) for the aura to apply. Default `true`. */
    requiresConscious?: boolean;
  };
  /** An aura that acts on nearby creatures at a turn boundary (Stench, Fear Aura, Fire Aura). See `TraitEmanation`. */
  emanation?: TraitEmanation;
  /** Nothing to simulate: flavour, senses, or out-of-combat rules (Keen Smell, Amphibious). Shown as reference, never as a gap. */
  informational?: boolean;
  /** A variant / optional rule from the source text: shown as opt-in reference, not on by default. */
  optional?: boolean;
  /** For an `optional` feature: the DM has switched it on, so the actions it grants are available. Off (absent) by default. */
  enabled?: boolean;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * What sort of item it is: how the sheet, the hotbar and the AI treat it. A potion is drunk, or given within 5 ft. (Its
 * field is `type`, never `kind`: the editor tells an action from other records by `kind`.)
 */
export type ItemType = "potion" | "scroll" | "wand" | "thrown" | "worn" | "gear" | "armor" | "shield";

/** How heavy a suit of armor is (it caps the Dexterity it adds), or a shield (ARMOR_PLAN.md). */
export type ArmorCategory = "light" | "medium" | "heavy" | "shield";

/** What armor or a shield does for AC while it's worn (`armoredAc`). */
export interface ArmorStats {
  category: ArmorCategory;
  /** Armor's base AC (11 for leather, 18 for plate), or a shield's bonus (2). */
  ac: number;
  /** +1, +2 or +3: magic armor's or a magic shield's bonus to AC. It needs attunement when the item does. */
  magicBonus?: number;
  /** The most Dexterity it adds, when it isn't its weight's (light: all of it; medium: +2; heavy: none). */
  maxDex?: number;
  /** Heavy armor: the Strength score its wearer needs; below it, the wearer's walking speed drops 10 ft. */
  strength?: number;
  /** Disadvantage on Dexterity (Stealth) checks: said on the item; there's no stealth in the simulator. */
  stealthDisadvantage?: boolean;
}

/**
 * What an item's uses spend: a stack used up one at a time (`count`: three potions), or charges (`charges`: a wand,
 * which stays). Sized in `definition.resources` like any other pool.
 */
export interface ItemSupply {
  /** The pool its uses' `resourceCost` names: `item:<item id>` once attached; a library entry authors `"supply"`. */
  id: string;
  size: number;
  unit: "count" | "charges";
  /** When charges come back. Reference only: there's no rest in a fight. */
  regains?: WeaponCharges["recharge"];
}

/** Something a creature carries and can use, or that works while it's carried. */
export interface ItemDefinition {
  id: Id;
  name: string;
  /** Reference text shown with the item. Not read by the simulator. */
  description?: string;
  source?: SourceMetadata;
  type: ItemType;
  supply?: ItemSupply;
  /**
   * What using it does: whole abilities, each with its own action type and a cost against `supply`. A potion's is
   * drunk (a self-targeted heal or buff); its give copies are compiled from it.
   */
  grantedActions?: ActionDefinition[];
  /** A potion can also be given to a creature within 5 ft, which takes this. Absent: it can't be given. */
  give?: { actionType: "action" | "bonus" };
  /** A potion's drink and give follow the campaign's potion rule unless this is `false` (it keeps its own timing). */
  followsTableRule?: boolean;
  /** Armor or a shield (`type` "armor" or "shield"): what it does for AC while it's worn. */
  armor?: ArmorStats;
  /**
   * Armor or a shield is worn (absent or `true`) or only carried (`false`): only worn armor counts toward AC, and only
   * worn armor's properties and uses work.
   */
  equipped?: boolean;
  /**
   * What the simulator doesn't run of it, in a few words for the DM ("the larger size and the advantage on Strength
   * checks"): the sheet marks it partly simulated and says so. Not read by the simulator.
   */
  notSimulated?: string;
  /**
   * Used with an action where a bonus action would do, its heal is its full amount (a Potion of Healing: 10, not
   * 2d4 + 2): each bonus-action heal it has gets an action copy that heals the maximum. Written from the campaign's rule
   * onto a potion that follows it (`withItemRules`).
   */
  fullWithAction?: boolean;
  /** Bonuses while it's carried (a Ring of Protection's +1 AC and saves), folded into `featureSources` like a focus's. */
  effects?: FeatureEffect[];
  /** It needs attunement: until it's attuned, it does nothing. */
  attunement?: { attuned: boolean };
  magical?: boolean;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

/**
 * Which rules a record is written for: the 2014 rules (SRD 5.1) or the 2024 rules (SRD 5.2). Carried, never read by the
 * simulator: a record runs as it's written, whichever edition it comes from (EDITIONS_PLAN.md).
 */
export type Edition = "2014" | "2024";

export interface SourceMetadata {
  provider: "homebrew" | "open5e" | "srd";
  documentKey?: string;
  documentName?: string;
  slug?: string;
  importedAt?: string;
  url?: string;
  /** The rules it's written for, when it says (`editionOf` in `lib/editions.ts`). */
  edition?: Edition;
}

export interface CreatureDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  size: SizeCategory;
  type?: CreatureType;
  /** The tactics a token of this creature starts with (the DM can change it per token). Absent: derived from its attacks. */
  defaultTactics?: TacticsProfile;
  /** The resource stance a token of this creature starts with. Absent: balanced. */
  defaultResourceStance?: ResourceStance;
  armorClass: number;
  maxHp: number;
  speed: number;
  /**
   * Set only on the definition `getDefinition` derives (stats.ts): its `speed` already takes off heavy armor's 10 ft, so
   * `movementProfileOf` doesn't again. Never saved.
   */
  speedIncludesArmor?: boolean;
  /** All movement modes. `speed` mirrors `movement.walk`. */
  movement?: MovementProfile;
  proficiencyBonus?: number;
  /** Challenge rating (0, 0.125, 0.25, 0.5, 1..30). Informational; derives `proficiencyBonus` when absent. */
  challengeRating?: number;
  alignment?: string;
  environments?: string[];
  senses?: CreatureSenses;
  /** Total skill bonuses by lowercase skill name (SRD statblock values). Informational. */
  skills?: Record<string, number>;
  languages?: string;
  conditionImmunities?: ConditionImmunity[];
  /** Legendary actions (SRD). Recorded now; resolved by the legendary-actions phase. */
  legendary?: LegendaryConfig;
  /** A form-only actor (werewolf's wolf form): never listed in browsers, only a transform target. */
  hidden?: boolean;
  /** For a `hidden` form actor, the base actor it belongs to. */
  formOf?: Id;
  /**
   * A shapechanger that starts the fight already transformed (a werewolf in Hybrid Form): the `definitionId` of
   * the form a new token of this creature takes on when it's placed. Absent: it starts in its own (base) form.
   */
  defaultActiveForm?: Id;
  resources?: Record<string, number>;
  /** Which ActorFolder this saved actor is filed under. Undefined/null = unfiled (root). */
  folderId?: Id | null;
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
    /**
     * A player character's build: the recipe the character builder makes it from (`CharacterBuild`,
     * src/lib/character-builder). The engine never reads it.
     */
    build?: unknown;
  };
  abilities: Record<Ability, number>;
  /**
   * How it casts spells. A spell whose DC or attack bonus formula names `"spellcasting"` uses `ability`; one that
   * names an ability of its own overrides it. Absent: the ability its spells name most, else its highest of INT, WIS
   * and CHA (`spellcastingAbility`).
   */
  spellcasting?: { ability: Ability };
  saves?: Partial<Record<Ability, number>>;
  damageAdjustments?: DamageAdjustment[];
  weapons?: WeaponDefinition[];
  /** What it carries: potions, scrolls, wands, flasks, worn magic items. */
  items?: ItemDefinition[];
  spells?: SpellDefinition[];
  deathEffects?: DeathEffectDefinition[];
  /**
   * Lair actions: when a token of this creature is `inLair`, it takes one of these on initiative count 20 each round
   * (losing ties), never the same one twice in a row. They cost no action. Hand-authored — the SRD statblocks have none.
   */
  lairActions?: ActionDefinition[];
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
  /** Set on the conditions of a grapple: the holder is `sourceCombatantId`. */
  hold?: { escapeDc: number; recurringDamage?: DamageComponent[] };
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
    /** Confusion: the bearer's turn is overridden by a random attack/move/do-nothing roll instead of normal AI decisions. */
    forcesRandomAction?: boolean;
    /** Feet taken off the bearer's speed (weapon mastery's Slow: 10). The largest of these counts, not their sum. */
    speedPenaltyFt?: number;
    /** The bearer can't make opportunity attacks (Staggering Blow). */
    deniesOpportunityAttacks?: boolean;
    /**
     * On its turns the bearer can do only one of: move, take an action, take a bonus action (Daze, Abjure Foes). Once it
     * does one, the others close (`canAct`, `turnMovementBudget`).
     */
    oneThingPerTurn?: boolean;
    /** Rage: the bearer can't cast spells, and taking the condition breaks its concentration. */
    noSpellcasting?: boolean;
    /** Turn Undead: on its turns the bearer moves as far as it can from the creature that gave it the condition. */
    fleesFromSource?: boolean;
    /** Draconic Flight, Dragon Wings: a fly speed while it lasts, its walking speed (`"walk"`) or so many feet. */
    flySpeed?: "walk" | number;
    /** Large Form: the bearer's size while it lasts. */
    sizeTo?: SizeCategory;
    /** Large Form: feet added to its speed while it lasts. */
    speedBonusFt?: number;
  };
  /** Rage: what keeps it going from one of the bearer's turns to the next (`ConditionUpkeep`). */
  upkeep?: ConditionUpkeep;
  /** Rage: it ends when the bearer is incapacitated (stunned, paralyzed, unconscious…). */
  endsOnIncapacitated?: boolean;
  /**
   * Weapon mastery's Sap and Vex: the condition changes one attack roll and is used up by it. `"made"`: the bearer's own
   * next attack roll (Sap: disadvantage). `"against"`: the next attack roll `by` makes against the bearer (Vex: the
   * attacker's advantage).
   */
  nextAttack?: { role: "made" | "against"; mode?: "advantage" | "disadvantage"; bonus?: number; by?: Id; notBy?: Id };
  /** Staggering Blow: it changes, and is used up by, the bearer's next saving throw. */
  nextSave?: { mode: "advantage" | "disadvantage" };
  /** It ends when its bearer takes damage, other than from the action that gave it (`sourceId`): Turn Undead. */
  endsOnDamage?: boolean;
  /** It ends when the creature that gave it (`sourceCombatantId`) is incapacitated or dies: Turn Undead. */
  endsWithSource?: boolean;
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
    /** Heightened Spell: its target's saves against the spell are at disadvantage, the repeats too. */
    disadvantage?: boolean;
  };
  /**
   * Sustained by a concentrating caster (`sourceCombatantId`). Breaking that
   * caster's concentration ends every condition flagged this way.
   */
  concentration?: boolean;
}

/**
 * Rage's upkeep: at the end of each of the bearer's turns after the one it began on, the condition ends unless that turn
 * the bearer made an attack roll against an enemy (`"attack"`) or forced one to make a saving throw (`"save"`); with
 * `"bonus-action"`, a bonus action it still has is spent to keep it instead.
 */
export interface ConditionUpkeep {
  by: Array<"attack" | "save" | "bonus-action">;
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
  /** Movement already spent this turn, in grid squares (path-cost units). */
  movementUsed?: number;
  /** Activations used this turn that are once a turn (Wild Resurgence). */
  activationsUsed?: Id[];
  /** Arcane Apotheosis: its free Metamagic option was used this turn. */
  freeMetamagicUsed?: boolean;
  /** Where this turn's movement began — a charge is measured from here. */
  movedFrom?: Point;
  /** Creatures a charge / pounce has hit this turn (unlocks `onlyAfter: "charge-hit"` attacks against them). */
  chargeHitTargetIds?: Id[];
  /** The Attack action was taken this turn: a weapon attack, or an Attack routine (unlocks `afterAttackAction`). */
  attackActionTaken?: boolean;
  /** Dropped a creature to 0 HP with a melee attack this turn (unlocks `onlyAfter: "dropped-creature"`). */
  droppedCreature?: boolean;
  /** Extra movement granted this turn (Rampage), in grid squares. */
  bonusMovement?: number;
  /** `d20-change` effects used since the start of its turn (`<feature id>:<effect index>`), for `oncePerTurn`. */
  d20ChangesUsed?: string[];
  /**
   * Under `oneThingPerTurn`, the AI's choice made at the start of its turn: `"act"` (its action, from where it stands)
   * or `"move"`. A person's choice is read from what they've used.
   */
  limitedTo?: "act" | "move";
  /** A level 1+ spell was cast this turn: Quickened Spell can't be used after it. */
  leveledSpellCast?: boolean;
  /** A spell was cast with Quickened Spell this turn: no level 1+ spell after it. */
  quickenedSpell?: boolean;
  /** Routines a person's creature is making a swing at a time (Play), at most one per slot. Closed when its turn ends. */
  routines?: OpenRoutine[];
}

/**
 * The Attack action (or a Multiattack, or Flurry of Blows) a person's creature has started and has swings left of
 * (HOTBAR_REDESIGN_PLAN.md §4.1). Each swing is its own command, so it can move, use its bonus action or drink a potion
 * between them.
 */
export interface OpenRoutine {
  /** The slot it took. */
  slot: "action" | "bonus";
  /**
   * The compiled routines it can still be (`<id>`, `<id>:option-N`, `<id>:with-<ability>`): those the swings made so far
   * fit. The routine is settled only when it has to be (a vampire's unarmed strike may yet be followed by a bite).
   */
  candidates: Id[];
  /** The swings made so far, in order. */
  made: Array<{ actionId: Id; targetId?: Id; hit?: boolean }>;
}

export interface CombatantState {
  id: Id;
  definitionId: Id;
  displayName: string;
  faction: Faction;
  position: Point;
  /** Feet above the ground it stands over. Above 0 it is airborne: out of reach of most melee, and it falls if it can't stay up. */
  altitude?: number;
  currentHp: number;
  tempHp: number;
  deathSaves?: DeathSaveState;
  /** `<attacker id>:<action id>` of every `immuneAfterSave` action this creature has made the save against. */
  savedAgainst?: string[];
  /** Fighting in its lair: takes a lair action on initiative 20 each round. Only meaningful if its creature has `lairActions`. */
  inLair?: boolean;
  /** The lair action it took most recently — it can't use the same one two rounds running. */
  lastLairActionId?: Id;
  /** Swallowed by this combatant: not on the board for anyone else, and can only act against the swallower. */
  containedBy?: Id;
  /** What swallowing does to the creature inside: recurring damage, and the swallower's regurgitation threshold. */
  containment?: { damage?: DamageComponent[]; regurgitate?: { damage: number; dc: number } };
  /** Damage this creature has taken from creatures it has swallowed since its turn started. */
  insideDamage?: number;
  /** Damage types taken since this creature's last turn started — what switches a regeneration off. */
  recentDamageTypes?: DamageType[];
  /** Down at 0 HP but not dying: a regenerating monster (a troll) that stands up at its next turn unless it's stopped. */
  downedRegen?: boolean;
  /** Set on a creature that was summoned into the fight, not placed by the DM. */
  summon?: {
    summonerId: Id;
    /** How many summons deep this is (the summoner's own `summon.generation`, or 0 for a DM-placed summoner). A summoned creature that itself summons is capped. */
    generation: number;
    /** Ends (goes `"fled"`) at the start of this round, if set. */
    expiresRound?: number;
    /** Ends when this combatant's concentration source loses concentration (set for a concentration summon). */
    concentrationSourceId?: Id;
    /** It takes its turn right after its summoner's, on the same initiative (`SummonActionDefinition.sharesInitiative`). */
    followsSummoner?: boolean;
  };
  /** Currently wearing another of its own definitions (a werewolf in Hybrid Form). Resolved by `getDefinition`. */
  /** The form it's in. `ownHp`: a 2014 Wild Shape form's druid's own hit points, to go back to. */
  activeForm?: { definitionId: Id; ownHp?: number };
  conditions?: ConditionInstance[];
  resources?: Record<string, number>;
  tokenVisuals?: TokenVisuals;
  actionEconomy?: ActionEconomyState;
  concentration?: {
    sourceConditionId?: Id;
    /** Taking damage doesn't make it check (Relentless Hunter, concentrating on Hunter's Mark). */
    keptOnDamage?: boolean;
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
  /** 5e: damage left over after reaching 0 HP that is at least the creature's maximum HP kills it outright. Off when absent (older saves). */
  massiveDamage?: boolean;
  /**
   * A creature that can counter a spell sees which spell it is, at what level and at whom, and weighs whether it's
   * worth stopping. Off, it only sees that a spell is being cast, as the rules are written. On when absent. Set by the
   * encounter's campaign (`withCampaignRules`).
   */
  counterspellReadsSpell?: boolean;
  /**
   * What drinking or giving a potion takes, for every potion that follows the table's rule (`withItemRules` writes it
   * into them): `"action"` (2014 rules, the default), `"bonus"` (2024 rules) or `"drink-bonus"` (the house rule: drinking
   * takes a bonus action, giving an action). Set by the encounter's campaign.
   */
  potionUse?: PotionUse;
  /** Where a potion can be drunk or given with a bonus action, an action instead heals its full amount. Off when absent. */
  potionActionHealsFull?: boolean;
  /**
   * What being grappled does (EDITIONS_PLAN.md D4): `"speed"`, speed 0 (2014 rules, the default), or
   * `"speed-and-attacks"`, speed 0 and disadvantage on attack rolls against anyone but the grappler (2024 rules).
   */
  grappled?: GrappledRule;
  /** What being stunned does to movement: `"cant-move"` (2014 rules, the default) or `"can-move"` (2024 rules). */
  stunned?: StunnedRule;
  /**
   * What being surprised does: `"lose-turn"`, no actions, reactions or movement on its first turn (2014 rules, the
   * default), or `"initiative"`, initiative rolled at disadvantage and nothing else (2024 rules).
   */
  surprise?: SurpriseRule;
}

/** What drinking or giving a potion takes, as a table rule (`RuleProfile.potionUse`). */
export type PotionUse = "action" | "bonus" | "drink-bonus";

/** What being grappled does, as a table rule (`RuleProfile.grappled`). */
export type GrappledRule = "speed" | "speed-and-attacks";

/** Whether a stunned creature can move, as a table rule (`RuleProfile.stunned`). */
export type StunnedRule = "cant-move" | "can-move";

/** What being surprised does, as a table rule (`RuleProfile.surprise`). */
export type SurpriseRule = "lose-turn" | "initiative";

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
  /** Standing persistent-area effects currently on the board. See `ActiveZone`. */
  activeZones?: ActiveZone[];
  /** The round whose initiative-20 lair actions have been taken. */
  lairRound?: number;
}

export interface CombatLogEvent {
  id: Id;
  round: number;
  turnIndex: number;
  type:
    | "InitiativeRolled"
    | "TurnStarted"
    | "CombatantMoved"
    | "CombatantFell"
    | "LairAction"
    | "ActionDeclared"
    | "AttackRolled"
    | "SaveRolled"
    | "AreaSaveResolved"
    | "MultiattackResolved"
    | "MultiattackSwingSkipped"
    | "DamageApplied"
    | "HealingApplied"
    | "DeathSaveRolled"
    | "ConcentrationChecked"
    | "ConditionApplied"
    | "ConditionResisted"
    | "AbilityRecharged"
    | "EscapeAttempted"
    | "CounterspellCheck"
    | "HoldApplied"
    | "Swallowed"
    | "Regurgitated"
    | "LegendaryResistanceUsed"
    | "RollChanged"
    | "Regenerated"
    | "LegendaryActionUsed"
    | "SurvivedLethal"
    | "MassiveDamage"
    | "ConditionExpired"
    | "ZoneCreated"
    | "ZoneMoved"
    | "ZoneExpired"
    | "FeatureEffectApplied"
    | "RiderApplied"
    | "RiderSkipped"
    | "BeamsResolved"
    | "OpportunityAttackTriggered"
    | "ReactionTriggered"
    | "ReinforcementArrived"
    | "CombatantSpawned"
    | "CombatantSplit"
    | "SummonExpired"
    | "Transformed"
    | "SpellCountered"
    | "UtilityActionResolved"
    | "ManualActionUsed"
    | "DoorToggled"
    | "TempHpChanged"
    | "HitPointMaximumChanged"
    | "ReactionRestored"
    | "ActionEconomyRefreshed"
    | "AiDecision"
    | "CombatantDowned"
    | "CombatantDefeated"
    | "CombatantDied"
    | "DeathEffectTriggered"
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
  damageTypeOptions: z.array(z.string().min(1)).optional(),
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
  z.object({ kind: z.literal("until-start-of-next-turn") }),
  z.object({ kind: z.literal("until-source-turn"), timing: z.enum(["start", "end"]) }),
  z.object({ kind: z.literal("until-end-of-next-turn") })
]);

export const riderSaveSchema = z.object({
  ability: abilitySchema,
  dc: z.number().int().optional(),
  dcFormula: numericFormulaSchema.optional(),
  onSuccess: z.enum(["negates", "ends-early"])
});

export const creatureTypeSchema = z.enum([
  "aberration", "beast", "celestial", "construct", "dragon",
  "elemental", "fey", "fiend", "giant", "humanoid",
  "monstrosity", "ooze", "plant", "undead"
]) as z.ZodType<CreatureType>;

const sizeSchema = z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

const triggeredRiderBase = {
  id: z.string().optional(),
  oncePerTurn: z.boolean().optional(),
  onceKey: z.string().optional(),
  group: z.string().optional(),
  economy: z.literal("bonus").optional(),
  when: riderGateSchema,
  resourceCost: resourceCostSchema.optional(),
  activation: z.enum(["always", "optional"]).optional(),
  restrictToCreatureTypes: z.array(creatureTypeSchema).optional()
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
    effects: z.array(z.any()).optional(),
    conditionKey: z.string().min(1).optional(),
    nextAttack: z.object({
      role: z.enum(["made", "against"]), mode: z.enum(["advantage", "disadvantage"]).optional(),
      bonus: z.number().int().optional(), byOthers: z.boolean().optional()
    }).optional(),
    nextSave: z.object({ mode: z.enum(["advantage", "disadvantage"]) }).optional(),
    endsOnDamage: z.boolean().optional(),
    maxSize: sizeSchema.optional()
  }),
  z.object({
    ...triggeredRiderBase, kind: z.literal("push"), distance: z.number(), maxSize: sizeSchema.optional(),
    save: z.object({ ability: abilitySchema, dc: z.number().int().optional(), dcFormula: numericFormulaSchema.optional() }).optional()
  }),
  z.object({
    ...triggeredRiderBase,
    kind: z.literal("swallow"),
    maxSize: sizeSchema.optional(),
    requiresHeld: z.boolean().optional(),
    save: z.object({ ability: abilitySchema, dc: z.number().int() }).optional(),
    damage: z.array(damageComponentSchema).optional(),
    regurgitate: z.object({ damage: z.number().min(0), dc: z.number().int() }).optional(),
    capacity: z.number().int().positive().optional()
  }),
  z.object({
    ...triggeredRiderBase,
    kind: z.literal("hold"),
    escapeDc: z.number().int(),
    maxSize: sizeSchema.optional(),
    restrained: z.boolean().optional(),
    limit: z.number().int().positive().optional(),
    recurringDamage: z.array(damageComponentSchema).optional()
  }),
  z.object({ id: z.string().optional(), oncePerTurn: z.boolean().optional(), kind: z.literal("note"), text: z.string() })
]) as z.ZodType<ActionRider>;

export const reactionTriggerSchema: z.ZodType<ReactionTrigger> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("enemy-leaves-reach") }),
  z.object({ kind: z.literal("targeted-by-attack"), meleeOnly: z.boolean().optional() }),
  z.object({ kind: z.literal("would-be-hit"), meleeOnly: z.boolean().optional() }),
  z.object({ kind: z.literal("would-take-damage"), attackOnly: z.boolean().optional(), damageTypes: z.array(z.string().min(1)).optional(), rangedOnly: z.boolean().optional() }),
  z.object({ kind: z.literal("hit-by-attack"), meleeOnly: z.boolean().optional(), withinFt: z.number().min(0).optional(), damaged: z.boolean().optional() }),
  z.object({ kind: z.literal("ally-targeted-by-attack"), withinFt: z.number().min(0) }),
  z.object({
    kind: z.literal("enemy-casts-spell"), withinFt: z.number().min(0), maxSpellLevel: z.number().int().min(0).optional(),
    checkAbove: z.union([z.literal(false), z.object({ dcBase: z.number().int(), bonus: z.number().int().optional() })]).optional(),
    casterSave: abilitySchema.optional()
  }),
  z.object({ kind: z.literal("manual"), note: z.string() })
]) as z.ZodType<ReactionTrigger>;

export const reactionMetaSchema: z.ZodType<ReactionMeta> = z.object({
  trigger: reactionTriggerSchema,
  target: z.enum(["trigger-source", "self", "trigger-target"]).optional(),
  priority: z.enum(["always", "worthwhile", "manual"]).optional(),
  lastsFor: z.enum(["triggering-attack", "until-start-of-next-turn"]).optional()
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
  type: creatureTypeSchema.optional(),
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
  spellcasting: z.object({
    ability: z.union([z.literal("str"), z.literal("dex"), z.literal("con"), z.literal("int"), z.literal("wis"), z.literal("cha")])
  }).optional(),
  actions: z.array(z.any()),
  bonusActions: z.array(z.any()).optional(),
  reactions: z.array(z.any()).optional(),
  weapons: z.array(z.any()).optional(),
  items: z.array(z.any()).optional(),
  spells: z.array(z.any()).optional(),
  deathEffects: z.array(z.any()).optional(),
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
    altitude: z.number().min(0).optional(),
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
      opacity: z.number().min(0).max(1).default(DEFAULT_MAP_IMAGE_SETTINGS.opacity),
      naturalWidthPx: z.number().positive().optional(),
      naturalHeightPx: z.number().positive().optional(),
      sourceWidthPx: z.number().positive().optional(),
      sourceHeightPx: z.number().positive().optional(),
      pxPerSquare: z.number().positive().optional(),
      originX: z.number().finite().optional(),
      originY: z.number().finite().optional()
    }).default(DEFAULT_MAP_IMAGE_SETTINGS),
    canvas: z.object({
      widthPx: z.number().positive(),
      heightPx: z.number().positive()
    }).optional(),
    paddingSquares: z.number().min(0).optional(),
    paddingPercent: z.number().min(0).max(100).optional(),
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
        tags: z.array(z.string()).optional(),
        // Painted tiles carry their grid cell and any hazard; zod strips unknown keys, so name them or an import loses them.
        cell: pointSchema.optional(),
        hazard: z.custom<TerrainHazardEffect>().optional(),
        hazardAppliedRounds: z.record(z.number()).optional()
      })
    ),
    elevation: z.object({ cells: z.record(z.number().finite()) }).optional(),
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
    coverFromCreatures: z.boolean().optional(),
    massiveDamage: z.boolean().optional(),
    counterspellReadsSpell: z.boolean().optional(),
    potionUse: z.enum(["action", "bonus", "drink-bonus"]).optional(),
    potionActionHealsFull: z.boolean().optional(),
    grappled: z.enum(["speed", "speed-and-attacks"]).optional(),
    stunned: z.enum(["cant-move", "can-move"]).optional(),
    surprise: z.enum(["lose-turn", "initiative"]).optional()
  }),
  definitions: z.array(z.any()),
  activeZones: z.array(z.any()).optional(),
  lairRound: z.number().int().optional(),
  combatants: z.array(
    z.object({
      id: z.string(),
      definitionId: z.string(),
      displayName: z.string(),
      faction: z.union([z.literal("party"), z.literal("enemy"), z.literal("neutral")]),
      position: pointSchema,
      altitude: z.number().min(0).optional(),
      inLair: z.boolean().optional(),
      lastLairActionId: z.string().optional(),
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
        disengaged: z.boolean().optional(),
        movementUsed: z.number().optional(),
        routines: z.array(z.object({
          slot: z.union([z.literal("action"), z.literal("bonus")]),
          candidates: z.array(z.string()),
          made: z.array(z.object({ actionId: z.string(), targetId: z.string().optional(), hit: z.boolean().optional() }))
        })).optional()
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
      tags: z.array(actorTagSchema).optional(),
      savedAgainst: z.array(z.string()).optional(),
      containedBy: z.string().optional(),
      containment: z.object({
        damage: z.array(z.any()).optional(),
        regurgitate: z.object({ damage: z.number(), dc: z.number() }).optional()
      }).optional(),
      insideDamage: z.number().optional(),
      recentDamageTypes: z.array(z.any()).optional(),
      downedRegen: z.boolean().optional(),
      summon: z.object({
        summonerId: z.string(),
        generation: z.number().int().min(0),
        expiresRound: z.number().int().optional(),
        concentrationSourceId: z.string().optional()
      }).optional(),
      activeForm: z.object({ definitionId: z.string(), ownHp: z.number().int().min(0).optional() }).optional()
    })
  )
});
