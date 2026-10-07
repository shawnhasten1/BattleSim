import { z } from "zod";
import type { Ability, SizeCategory } from "@/engine";
import type { Edition } from "./catalog";

/**
 * What a player chose for one `ChoiceSpec`. Which shape it takes follows the spec's kind:
 * - `subclass`: the subclass id;
 * - `skills`, `expertise`, `weapon-mastery`, `pick`, `spells`: the ids chosen (a spell choice is one of cantrips,
 *   prepared spells or spellbook spells: library spell ids);
 * - `feat`: the feat, its ability increases and its own choices;
 * - `abilities`: the points put into each ability.
 */
export type ChoiceValue =
  | string
  | string[]
  | FeatChoice
  | Partial<Record<Ability, number>>;

export interface FeatChoice {
  feat: string;
  increases?: Partial<Record<Ability, number>>;
  choices?: Record<string, ChoiceValue>;
}

/**
 * A character's build: the recipe the builder makes its actor from (`definition.character.build`). Everything the
 * builder writes onto the actor can be worked out from this and the catalog, so leveling up, leveling down and changing
 * an earlier choice are all "change the recipe and rebuild".
 */
export interface CharacterBuild {
  version: 1;
  edition: Edition;
  abilities: { method: "standard-array" | "point-buy" | "manual"; base: Record<Ability, number> };
  /** A catalog background (`id`), or a custom one. `increases` are the points put into its abilities (+2/+1 or +1/+1/+1). */
  background: {
    id?: string;
    custom?: { abilities: Ability[]; skills: string[]; feat: string };
    increases: Partial<Record<Ability, number>>;
    choices?: Record<string, ChoiceValue>;
  };
  /** Absent: no species (size, speed and senses are set by hand). */
  species?: { id: string; size?: SizeCategory; choices?: Record<string, ChoiceValue> };
  /** Hit points: the average per level (plan D8), or rolls entered by hand for levels 2 and up; `adjust` is a typed change. */
  hp: { method: "average" | "rolled"; rolls?: number[]; adjust?: number };
  /** One entry per character level, in order: the class that level went to and what was chosen at it. */
  levels: Array<{ classId: string; choices: Record<string, ChoiceValue> }>;
  /**
   * The starting packages taken on the first build (a 2024 class's option A or B), or a 2014 class's pick on each line
   * (`lines`, by line id) with the weapons chosen where a line asks (`weapons`). Leveling up never touches equipment.
   */
  equipment?: { classOption?: string; backgroundOption?: string; lines?: Record<string, string>; weapons?: Record<string, string[]>; applied: boolean };
  /**
   * Where the character's ability increases come from (EDITIONS_PLAN.md D3): its background (2024 rules: three points on
   * the background's abilities, or on any three when the background has none) or its species (2014 rules: the race's
   * own). Absent: the background when it gives increases, otherwise the species.
   */
  increasesFrom?: "background" | "species";
  /**
   * What the builder last wrote: a record's id (or a field's name) → the grant key that made it and a fingerprint of it
   * as written. A record that no longer matches its fingerprint was edited by the DM, and a rebuild keeps it (plan D5).
   */
  made: Record<string, { key: string; fingerprint: string }>;
}

const abilitySchema = z.enum(["str", "dex", "con", "int", "wis", "cha"]);
const abilityPoints = z.record(abilitySchema, z.number().int());

const choiceValueSchema: z.ZodType<ChoiceValue> = z.lazy(() => z.union([
  z.string(),
  z.array(z.string()),
  z.object({
    feat: z.string().min(1),
    increases: abilityPoints.optional(),
    choices: z.record(z.string(), choiceValueSchema).optional()
  }),
  abilityPoints
])) as z.ZodType<ChoiceValue>;

const choicesSchema = z.record(z.string(), choiceValueSchema);

export const characterBuildSchema: z.ZodType<CharacterBuild> = z.object({
  version: z.literal(1),
  edition: z.enum(["2014", "2024"]),
  abilities: z.object({
    method: z.enum(["standard-array", "point-buy", "manual"]),
    base: z.object({
      str: z.number().int(), dex: z.number().int(), con: z.number().int(),
      int: z.number().int(), wis: z.number().int(), cha: z.number().int()
    })
  }),
  background: z.object({
    id: z.string().optional(),
    custom: z.object({ abilities: z.array(abilitySchema), skills: z.array(z.string()), feat: z.string() }).optional(),
    increases: abilityPoints,
    choices: choicesSchema.optional()
  }),
  species: z.object({
    id: z.string().min(1),
    size: z.enum(["tiny", "small", "medium", "large", "huge", "gargantuan"]).optional(),
    choices: choicesSchema.optional()
  }).optional(),
  hp: z.object({
    method: z.enum(["average", "rolled"]),
    rolls: z.array(z.number().int().min(1)).optional(),
    adjust: z.number().int().optional()
  }),
  levels: z.array(z.object({ classId: z.string().min(1), choices: choicesSchema })).min(1).max(20),
  equipment: z.object({
    classOption: z.string().optional(),
    backgroundOption: z.string().optional(),
    lines: z.record(z.string(), z.string()).optional(),
    weapons: z.record(z.string(), z.array(z.string())).optional(),
    applied: z.boolean()
  }).optional(),
  increasesFrom: z.enum(["background", "species"]).optional(),
  made: z.record(z.string(), z.object({ key: z.string(), fingerprint: z.string() }))
}) as z.ZodType<CharacterBuild>;

/**
 * A saved or imported build, checked. An invalid one comes back as `undefined` with why: the actor still works as a
 * hand-built one, it just can't be leveled by the builder (plan, Phase 2).
 */
export function parseCharacterBuild(raw: unknown): { build?: CharacterBuild; error?: string } {
  if (raw === undefined) return {};
  const parsed = characterBuildSchema.safeParse(raw);
  if (parsed.success) return { build: parsed.data };
  const issue = parsed.error.issues[0];
  return { error: issue ? `${issue.path.join(".") || "build"}: ${issue.message}` : "invalid build" };
}
