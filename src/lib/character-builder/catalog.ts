import { z } from "zod";
import type {
  Ability,
  ActionRider,
  ConditionImmunity,
  CreatureSenses,
  CreatureType,
  FeatureDefinition,
  ResourceStance,
  WeaponDefinition,
  SizeCategory,
  SourceMetadata,
  TacticsProfile
} from "@/engine";

/**
 * The character builder's catalog: classes, subclasses, feats, backgrounds and species, as data the builder reads to
 * make an actor (PC_BUILDER_PLAN.md). Nothing here is engine data: what the builder writes onto an actor is ordinary
 * features, spells, weapons and resources, so the engine never learns what a class is.
 *
 * Numbers that grow with level are worked out when the character is built (plan D4). A grant says where its numbers come
 * from with templates (`Template`), so SRD data and homebrew classes (stored as JSON) scale the same way.
 */

export type Edition = "2014" | "2024";

/**
 * A number or text worked out for one character at one level. Text with `{…}` slots; each slot is a term with optional
 * whole-number arithmetic and a floor:
 * - `level`: the granting class's level; `charLevel`: the character's level; `pb`: the proficiency bonus;
 * - `col:<id>`: the granting class's (or subclass's) table column at its level;
 * - `mod:<ability>`: that ability's modifier, from the built scores.
 * Then any of `*N`, `/N` (rounded down), `+N`, `-N`, in order, and `|min:N`. `"1d10+{level}"`, `"{col:sneak-attack}"`,
 * `"{level*5}"`, `"{mod:cha|min:1}"`. A template that is a single slot and nothing else gives a number when the slot's
 * value is a number.
 */
export type Template = string;

/** One column of a class's features table, by level: `values[level - 1]`. A blank (no entry yet at that level) is null. */
export interface ClassTableColumn {
  id: string;
  label: string;
  values: Array<string | number | null>;
}

/** A starting equipment package (option A, B or C). Only weapons and armor reach the sheet (plan D15). */
export interface EquipmentPackage {
  id: string;
  label: string;
  /** Library ids (`srd:weapon:…`, `srd:item:…`), with how many. */
  items: Array<{ ref: string; count?: number }>;
  gold?: number;
}

/** Where one of a grant's numbers comes from: the value at `path` (dot path into the feature) becomes `value`. */
export interface ScaleBinding {
  path: string;
  value: Template;
}

/** What a grant changes outside its feature: speed, scores, hit points, senses, proficiencies. */
export interface GrantAdjust {
  /** Feet added to the walking speed. */
  speed?: Template | number;
  /** Climb or swim speeds equal to the walking speed (Roving, Second-Story Work). */
  movementEqualToSpeed?: Array<"climb" | "swim">;
  /** Added to ability scores (Primal Champion's +4), up to `abilityMax`. */
  abilities?: Partial<Record<Ability, number>>;
  abilityMax?: number;
  /** Added to the hit point maximum (Draconic Resilience: `"{level}"`; Dwarven Toughness: `"{charLevel}"`). */
  hpBonus?: Template | number;
  /** Senses set to at least these ranges (darkvision 60, blindsight 30). */
  senses?: CreatureSenses;
  /** Saving throw proficiencies it adds ("all" for Disciplined Survivor). */
  saves?: Ability[] | "all";
  /** Conditions it can't be given (Nature's Ward: Poisoned). */
  conditionImmunities?: ConditionImmunity[];
}

/** What a level, feat, species or background gives: a feature, and anything it changes beside it. */
export interface FeatureGrant {
  /** Stable within what grants it ("sneak-attack"): how a rebuild knows a feature it made before. */
  key: string;
  /** The SRD (Open5e) feature key this grant covers, for the coverage cross-check. */
  ref?: string;
  /** A library feature id (`srd:feature:…`) or the feature itself. Absent: the grant only adjusts. */
  feature?: string | FeatureDefinition;
  /**
   * A weapon the builder owns, as it owns features (the Monk's Unarmed Strike). Its id and action id are the grant's
   * feature id; `scale` paths starting `weapon.` write into it.
   */
  weapon?: WeaponDefinition;
  /**
   * On-hit riders this grant adds to a weapon an earlier grant gave (by that grant's key): Stunning Strike on the Monk's
   * Unarmed Strike.
   */
  onHitOf?: { grant: string; riders: ActionRider[] };
  /** The key of an earlier grant this one takes the place of (Superior Critical replaces Improved Critical). */
  replaces?: string;
  scale?: ScaleBinding[];
  /** A resource pool the feature spends, and its size. */
  pool?: { id: string; size: Template | number };
  adjust?: GrantAdjust;
  /**
   * Spells it gives, always prepared and not counted against the prepared number (a subclass's spells, Paladin's Smite's
   * Divine Smite), cast with the granting class's ability. Library spell ids.
   */
  spells?: string[];
  /** Spells it lets the character cast without a slot, from a pool of their own (Favored Enemy: Hunter's Mark). */
  freeCasts?: FreeCast[];
}

/** A spell cast without a slot, `uses` times (a pool of its own, named after the spell). */
export interface FreeCast {
  spell: string;
  uses: Template | number;
}

export type FeatCategory = "origin" | "general" | "fighting-style" | "epic-boon";

/**
 * Something a level (or a feat, a species, a background) asks the player to choose. `id` is stable within its level;
 * `ref` is the SRD feature it covers ("Ability Score Improvement", "Fighter Subclass"), for the coverage cross-check.
 */
export type ChoiceSpec = { id: string; ref?: string } & (
  | { kind: "subclass" }
  | { kind: "feat"; categories: FeatCategory[]; label?: string; extraOptions?: PickOption[] }
  | { kind: "skills"; count: number; from: string[] | "any" }
  | { kind: "expertise"; count: number; from?: string[] }
  | { kind: "weapon-mastery" }
  | SpellsChoice
  | { kind: "abilities"; label: string; points: number; from: Ability[]; maxPerAbility: number; cap: number }
  | { kind: "pick"; label: string; count: number; options: PickOption[] }
);

/**
 * Spells to choose: cantrips learned, spells prepared, or spells written in a spellbook. A spellcasting class's choices
 * are made by the builder from its progression at each level (their count is how much the table's number went up); a
 * feat's or a subclass's are in the catalog (Magic Initiate's two cantrips and one 1st-level spell).
 */
export interface SpellsChoice {
  kind: "spells";
  what: "cantrips" | "prepared" | "spellbook";
  /** How many. A class's own choices always say. */
  count?: number;
  label?: string;
  /** The spell lists it chooses from (`"wizard"`). Absent: the class's own list, or the list another choice picked. */
  lists?: string[];
  /** The id of an earlier choice (in the same feat or level) whose value is the list (Magic Initiate's). */
  listFrom?: string;
  /** The id of an earlier choice whose value is the spellcasting ability for these spells (Magic Initiate's). */
  abilityFrom?: string;
  /** Exactly this spell level (Magic Initiate's 1st-level spell). Absent: 1st up to the highest the class can cast. */
  level?: number;
  /** Always prepared, not counted against the class's number (Magical Discoveries; a feat's spell). */
  alwaysPrepared?: boolean;
  /** Each spell chosen can also be cast this many times without a slot (Magic Initiate: once). */
  freeCasts?: Template | number;
}

/** One option of a `pick` choice (a fighting style, an invocation, a lineage): what choosing it grants. */
export interface PickOption {
  id: string;
  name: string;
  description?: string;
  grants: FeatureGrant[];
  /** Further choices it brings (a lineage's spellcasting ability). */
  choices?: ChoiceSpec[];
  /** A feat the option is (a Fighting Style feat), instead of its own grants. */
  feat?: string;
}

/** What one level of a class, subclass or species gives and asks. */
export interface ClassLevel {
  level: number;
  grants: FeatureGrant[];
  choices?: ChoiceSpec[];
}

/**
 * How a class casts spells. The builder asks for its cantrips, prepared spells and spellbook at each level, as many as
 * the numbers went up. Always-prepared spells and free casts are grants (`FeatureGrant.spells`, `freeCasts`).
 */
export interface SpellcastingProgression {
  ability: Ability;
  kind: "full" | "half" | "third" | "pact";
  /** The class spell list key ("wizard"). */
  list: string;
  /** Cantrips known, by class level (20 entries). */
  cantrips?: number[];
  /** Level 1+ spells prepared, by class level (20 entries). Every 2024 caster prepares. */
  prepared: number[];
  /** A wizard's spellbook: how many 1st-level spells it starts with, and how many each level adds. It prepares from it. */
  spellbook?: { start: number; perLevel: number };
}

export interface ClassDefinition {
  /** `srd:class:<slug>` for the bundle; any unique id for homebrew. */
  id: string;
  name: string;
  /** Where it's from: never merged with a same-named class from another source. */
  source: SourceMetadata;
  edition: Edition;
  hitDie: 6 | 8 | 10 | 12;
  primaryAbilities: Ability[];
  /** Proficient only when this is the character's first class. */
  saves: Ability[];
  skills: { count: number; from: string[] | "any" };
  /** `"simple"`, `"martial"`, or a narrower note ("martial-finesse-or-light"): sets `WeaponDefinition.proficient`. */
  weaponProficiency: string[];
  armorTraining: Array<"light" | "medium" | "heavy" | "shield">;
  /** Weapon kinds mastered, by class level (20 entries). */
  weaponMastery?: number[];
  spellcasting?: SpellcastingProgression;
  subclassLevel: number;
  subclassLabel: string;
  /** Levels with a feat choice (Ability Score Improvement or another). An Epic Boon is a feat choice of its own. */
  featLevels: number[];
  table: ClassTableColumn[];
  levels: ClassLevel[];
  startingEquipment?: EquipmentPackage[];
  suggested: ClassSuggestions;
  description?: string;
}

/**
 * What the builder picks when the player doesn't (plan D7): a Quick build takes every one of these. Ability priority
 * fills the standard array; the rest name catalog ids or skill ids.
 */
export interface ClassSuggestions {
  abilities: Ability[];
  tactics: TacticsProfile;
  stance?: ResourceStance;
  background?: string;
  skills?: string[];
  expertise?: string[];
  fightingStyle?: string;
  epicBoon?: string;
  /** Weapon kinds to master first (`longsword`, `shortbow`). */
  masteries?: string[];
  equipment?: string;
  /**
   * Spells to choose first, most wanted first (library ids): cantrips, then leveled spells. A leveled choice takes the
   * highest-level ones it can, so this list is read level by level. Spells that run come before reference-only ones.
   */
  cantrips?: string[];
  spells?: string[];
}

export interface SubclassDefinition {
  id: string;
  name: string;
  source: SourceMetadata;
  edition: Edition;
  /** The class it belongs to: a homebrew subclass can attach to an SRD class. */
  classId: string;
  /** A third caster (Arcane Trickster, Eldritch Knight). */
  spellcasting?: SpellcastingProgression;
  table?: ClassTableColumn[];
  levels: ClassLevel[];
  description?: string;
}

export interface FeatDefinition {
  id: string;
  name: string;
  source: SourceMetadata;
  edition: Edition;
  category: FeatCategory;
  prerequisite?: { level?: number; abilities?: Partial<Record<Ability, number>>; anyOf?: boolean; feature?: string; text?: string };
  grants: FeatureGrant[];
  choices?: ChoiceSpec[];
  repeatable?: boolean;
  description?: string;
}

export interface BackgroundDefinition {
  id: string;
  name: string;
  source: SourceMetadata;
  edition: Edition;
  /** The three abilities its increases go to: +2 and +1, or +1 to all three. */
  abilities: [Ability, Ability, Ability];
  skills: string[];
  /** Its origin feat, and any choice that feat needs made for it (Magic Initiate's spell list). */
  feat: string;
  featChoices?: Record<string, unknown>;
  equipment?: EquipmentPackage[];
  description?: string;
}

export interface SpeciesDefinition {
  id: string;
  name: string;
  source: SourceMetadata;
  edition: Edition;
  /** More than one: the player chooses (a human or a tiefling is Medium or Small). */
  sizes: SizeCategory[];
  speed: number;
  type: CreatureType;
  senses?: CreatureSenses;
  /** Traits by character level (Draconic Flight at 5th, a lineage's spells at 3rd and 5th). */
  levels: ClassLevel[];
  description?: string;
}

/** Everything the builder can build from. */
export interface Catalog {
  classes: ClassDefinition[];
  subclasses: SubclassDefinition[];
  feats: FeatDefinition[];
  backgrounds: BackgroundDefinition[];
  species: SpeciesDefinition[];
}

/* ── schemas: for catalog entries that arrive as JSON (homebrew, imports; Phase 8) ─────────────────────────────────── */

const abilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const editionSchema = z.enum(["2014", "2024"]);
const templateOrNumber = z.union([z.string(), z.number()]);

const sourceSchema = z.object({
  provider: z.enum(["homebrew", "open5e", "srd"]),
  documentKey: z.string().optional(),
  documentName: z.string().optional(),
  slug: z.string().optional(),
  importedAt: z.string().optional(),
  url: z.string().optional()
}).passthrough();

/** Features are engine data, checked by the engine where they're used; here only their shape is. */
const featureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["feature", "trait"]),
  automationSupport: z.enum(["full", "partial", "manual-only", "unsupported"])
}).passthrough() as unknown as z.ZodType<FeatureDefinition>;

const sensesSchema = z.object({
  darkvision: z.number().optional(),
  blindsight: z.number().optional(),
  tremorsense: z.number().optional(),
  truesight: z.number().optional()
});

export const featureGrantSchema: z.ZodType<FeatureGrant> = z.object({
  key: z.string().min(1),
  ref: z.string().optional(),
  feature: z.union([z.string().min(1), featureSchema]).optional(),
  weapon: z.object({ id: z.string(), name: z.string().min(1) }).passthrough().optional(),
  onHitOf: z.object({ grant: z.string().min(1), riders: z.array(z.object({ kind: z.string() }).passthrough()) }).optional(),
  replaces: z.string().optional(),
  scale: z.array(z.object({ path: z.string().min(1), value: z.string() })).optional(),
  pool: z.object({ id: z.string().min(1), size: templateOrNumber }).optional(),
  spells: z.array(z.string().min(1)).optional(),
  freeCasts: z.array(z.object({ spell: z.string().min(1), uses: templateOrNumber })).optional(),
  adjust: z.object({
    speed: templateOrNumber.optional(),
    movementEqualToSpeed: z.array(z.enum(["climb", "swim"])).optional(),
    abilities: z.record(abilitySchema, z.number()).optional(),
    abilityMax: z.number().optional(),
    hpBonus: templateOrNumber.optional(),
    senses: sensesSchema.optional(),
    saves: z.union([z.array(abilitySchema), z.literal("all")]).optional(),
    conditionImmunities: z.array(z.string()).optional()
  }).optional()
}) as z.ZodType<FeatureGrant>;

const featCategorySchema = z.enum(["origin", "general", "fighting-style", "epic-boon"]);

const pickOptionSchema: z.ZodType<PickOption> = z.lazy(() => z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  grants: z.array(featureGrantSchema),
  choices: z.array(choiceSpecSchema).optional(),
  feat: z.string().optional()
})) as z.ZodType<PickOption>;

export const choiceSpecSchema: z.ZodType<ChoiceSpec> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("subclass"), id: z.string(), ref: z.string().optional() }),
  z.object({ kind: z.literal("feat"), id: z.string(), ref: z.string().optional(), categories: z.array(featCategorySchema), label: z.string().optional(), extraOptions: z.array(pickOptionSchema).optional() }),
  z.object({ kind: z.literal("skills"), id: z.string(), ref: z.string().optional(), count: z.number().int().min(0), from: z.union([z.array(z.string()), z.literal("any")]) }),
  z.object({ kind: z.literal("expertise"), id: z.string(), ref: z.string().optional(), count: z.number().int().min(0), from: z.array(z.string()).optional() }),
  z.object({ kind: z.literal("weapon-mastery"), id: z.string(), ref: z.string().optional() }),
  z.object({
    kind: z.literal("spells"), id: z.string(), ref: z.string().optional(),
    what: z.enum(["cantrips", "prepared", "spellbook"]),
    count: z.number().int().min(0).optional(),
    label: z.string().optional(),
    lists: z.array(z.string()).optional(),
    listFrom: z.string().optional(),
    abilityFrom: z.string().optional(),
    level: z.number().int().min(0).max(9).optional(),
    alwaysPrepared: z.boolean().optional(),
    freeCasts: templateOrNumber.optional()
  }),
  z.object({ kind: z.literal("abilities"), id: z.string(), ref: z.string().optional(), label: z.string(), points: z.number().int().min(1), from: z.array(abilitySchema), maxPerAbility: z.number().int().min(1), cap: z.number().int() }),
  z.object({ kind: z.literal("pick"), id: z.string(), ref: z.string().optional(), label: z.string(), count: z.number().int().min(1), options: z.array(pickOptionSchema) })
])) as z.ZodType<ChoiceSpec>;

const classLevelSchema: z.ZodType<ClassLevel> = z.object({
  level: z.number().int().min(1).max(20),
  grants: z.array(featureGrantSchema),
  choices: z.array(choiceSpecSchema).optional()
});

const twenty = (item: z.ZodTypeAny) => z.array(item).length(20);

const tableColumnSchema = z.object({
  id: z.string().min(1),
  label: z.string(),
  values: twenty(z.union([z.string(), z.number(), z.null()]))
});

const equipmentSchema = z.object({
  id: z.string(),
  label: z.string(),
  items: z.array(z.object({ ref: z.string(), count: z.number().int().min(1).optional() })),
  gold: z.number().optional()
});

const spellcastingSchema = z.object({
  ability: abilitySchema,
  kind: z.enum(["full", "half", "third", "pact"]),
  list: z.string(),
  cantrips: twenty(z.number().int().min(0)).optional(),
  prepared: twenty(z.number().int().min(0)),
  spellbook: z.object({ start: z.number().int(), perLevel: z.number().int() }).optional()
});

export const classDefinitionSchema: z.ZodType<ClassDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: sourceSchema,
  edition: editionSchema,
  hitDie: z.union([z.literal(6), z.literal(8), z.literal(10), z.literal(12)]),
  primaryAbilities: z.array(abilitySchema),
  saves: z.array(abilitySchema),
  skills: z.object({ count: z.number().int().min(0), from: z.union([z.array(z.string()), z.literal("any")]) }),
  weaponProficiency: z.array(z.string()),
  armorTraining: z.array(z.enum(["light", "medium", "heavy", "shield"])),
  weaponMastery: twenty(z.number().int().min(0)).optional(),
  spellcasting: spellcastingSchema.optional(),
  subclassLevel: z.number().int().min(1).max(20),
  subclassLabel: z.string(),
  featLevels: z.array(z.number().int().min(1).max(20)),
  table: z.array(tableColumnSchema),
  levels: z.array(classLevelSchema),
  startingEquipment: z.array(equipmentSchema).optional(),
  suggested: z.object({
    abilities: z.array(abilitySchema),
    tactics: z.enum(["basic-melee", "basic-ranged", "skirmisher", "brute", "defender", "controller"]),
    stance: z.enum(["conservative", "balanced", "liberal"]).optional(),
    background: z.string().optional(),
    skills: z.array(z.string()).optional(),
    expertise: z.array(z.string()).optional(),
    fightingStyle: z.string().optional(),
    epicBoon: z.string().optional(),
    masteries: z.array(z.string()).optional(),
    equipment: z.string().optional(),
    cantrips: z.array(z.string()).optional(),
    spells: z.array(z.string()).optional()
  }),
  description: z.string().optional()
}) as z.ZodType<ClassDefinition>;

export const subclassDefinitionSchema: z.ZodType<SubclassDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: sourceSchema,
  edition: editionSchema,
  classId: z.string().min(1),
  spellcasting: spellcastingSchema.optional(),
  table: z.array(tableColumnSchema).optional(),
  levels: z.array(classLevelSchema),
  description: z.string().optional()
}) as z.ZodType<SubclassDefinition>;

export const featDefinitionSchema: z.ZodType<FeatDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: sourceSchema,
  edition: editionSchema,
  category: featCategorySchema,
  prerequisite: z.object({
    level: z.number().int().optional(),
    abilities: z.record(abilitySchema, z.number()).optional(),
    anyOf: z.boolean().optional(),
    feature: z.string().optional(),
    text: z.string().optional()
  }).optional(),
  grants: z.array(featureGrantSchema),
  choices: z.array(choiceSpecSchema).optional(),
  repeatable: z.boolean().optional(),
  description: z.string().optional()
}) as z.ZodType<FeatDefinition>;

export const backgroundDefinitionSchema: z.ZodType<BackgroundDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: sourceSchema,
  edition: editionSchema,
  abilities: z.tuple([abilitySchema, abilitySchema, abilitySchema]),
  skills: z.array(z.string()),
  feat: z.string().min(1),
  featChoices: z.record(z.string(), z.unknown()).optional(),
  equipment: z.array(equipmentSchema).optional(),
  description: z.string().optional()
}) as z.ZodType<BackgroundDefinition>;

export const speciesDefinitionSchema: z.ZodType<SpeciesDefinition> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: sourceSchema,
  edition: editionSchema,
  sizes: z.array(z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"])).min(1),
  speed: z.number().int().min(0),
  type: z.string() as unknown as z.ZodType<CreatureType>,
  senses: sensesSchema.optional(),
  levels: z.array(classLevelSchema),
  description: z.string().optional()
}) as z.ZodType<SpeciesDefinition>;
