import { z } from "zod";

export const ENCOUNTER_SCHEMA_VERSION = 1;

export type Id = string;
export type Faction = "party" | "enemy" | "neutral";
export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type SizeCategory = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";
export type TerrainType = "normal" | "difficult" | "impassable" | "hazard" | "cover" | "elevation" | "custom";
export type TacticsProfile =
  | "basic-melee"
  | "basic-ranged"
  | "skirmisher"
  | "brute"
  | "defender"
  | "controller";
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
  blocksMovement: boolean;
  blocksSight: boolean;
  blocksProjectiles: boolean;
  doorState?: "open" | "closed" | "locked" | "destroyed";
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
}

export interface NumericFormula {
  base?: number;
  ability?: Ability;
  proficiency?: boolean;
  multiplier?: number;
}

export interface DamageComponent {
  dice: string;
  damageType: DamageTypeReference;
  abilityModifier?: Ability;
  bonusFormula?: NumericFormula;
}

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
  } & FeatureEffectScope & Omit<FeatureEffectConditions, "condition">)
  | ({
    kind: "attack-bonus";
    bonus: NumericFormula;
  } & FeatureEffectScope & FeatureEffectConditions)
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
  }
  | {
    kind: "resource-regain";
    timing: "turn-start" | "turn-end";
    resourceId: string;
    amount: NumericFormula;
    max?: number;
  };

export interface ResourceCost {
  resourceId: string;
  amount: number;
}

export interface HealingComponent {
  dice: string;
  abilityModifier?: Ability;
}

export interface AreaTemplate {
  type: "circle" | "cone" | "line" | "square";
  size: number;
  width?: number;
  direction?: "north" | "east" | "south" | "west";
}

export interface AttackActionDefinition {
  kind: "attack";
  id: Id;
  name: string;
  actionType: "action" | "bonus" | "reaction";
  attackType: "melee" | "ranged" | "spell";
  ability: Ability;
  attackBonus?: number;
  attackBonusFormula?: NumericFormula;
  range: number;
  longRange?: number;
  reach?: number;
  damage: DamageComponent[];
  resourceCost?: ResourceCost;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface SaveActionDefinition {
  kind: "save";
  id: Id;
  name: string;
  actionType: "action" | "bonus" | "reaction";
  saveAbility: Ability;
  dc?: number;
  dcFormula?: NumericFormula;
  range: number;
  damage: DamageComponent[];
  halfDamageOnSuccess: boolean;
  resourceCost?: ResourceCost;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface AreaSaveActionDefinition {
  kind: "area-save";
  id: Id;
  name: string;
  actionType: "action" | "bonus" | "reaction";
  saveAbility: Ability;
  dc?: number;
  dcFormula?: NumericFormula;
  range: number;
  area: AreaTemplate;
  damage: DamageComponent[];
  halfDamageOnSuccess: boolean;
  affects: "hostile" | "all";
  resourceCost?: ResourceCost;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface HealingActionDefinition {
  kind: "healing";
  id: Id;
  name: string;
  actionType: "action" | "bonus" | "reaction";
  range: number;
  healing: HealingComponent[];
  resourceCost?: ResourceCost;
  automationSupport: "full" | "partial" | "manual-only" | "unsupported";
}

export interface UnsupportedActionDefinition {
  kind: "unsupported";
  id: Id;
  name: string;
  description?: string;
  actionType: "action" | "bonus" | "reaction";
  automationSupport: "unsupported";
}

export interface ActivateFeatureActionDefinition {
  kind: "activate-feature";
  id: Id;
  name: string;
  actionType: "action" | "bonus" | "reaction";
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

export interface MultiattackActionDefinition {
  kind: "multiattack";
  id: Id;
  name: string;
  actionType: "action";
  attacks: Array<{
    actionId: Id;
    count: number;
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
  | MultiattackActionDefinition;

export interface WeaponDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  attackType: "melee" | "ranged";
  ability: Ability;
  range: number;
  longRange?: number;
  reach?: number;
  damage: DamageComponent[];
  properties?: string[];
  actionId?: Id;
  magicBonus?: number;
}

export interface SpellDefinition {
  id: Id;
  name: string;
  source?: SourceMetadata;
  level: number;
  school?: string;
  castingTime: "action" | "bonus" | "reaction";
  range: number;
  concentration?: boolean;
  resourceCost?: ResourceCost;
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
  };
  effects?: FeatureEffect[];
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
  state: "active" | "downed" | "dead" | "defeated" | "fled";
  tacticsProfile: TacticsProfile;
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
    | "OpportunityAttackTriggered"
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
      z.literal("downed"),
      z.literal("dead"),
      z.literal("defeated"),
      z.literal("fled")
    ]),
    tacticsProfile: tacticsProfileSchema
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
        doorState: z.union([
          z.literal("open"),
          z.literal("closed"),
          z.literal("locked"),
          z.literal("destroyed")
        ]).optional()
      })
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
          type: z.union([z.literal("circle"), z.literal("cone"), z.literal("line"), z.literal("square")]),
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
    requireLineOfEffect: z.boolean()
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
      initiative: z.number().optional(),
      state: z.union([
        z.literal("active"),
        z.literal("downed"),
        z.literal("dead"),
        z.literal("defeated"),
        z.literal("fled")
      ]),
      tacticsProfile: tacticsProfileSchema
    })
  )
});
