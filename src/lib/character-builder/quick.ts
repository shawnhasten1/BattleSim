import type { Ability, CreatureDefinition } from "@/engine";
import { applyBuild, type ApplyResult } from "./apply";
import { ABILITIES, buildCharacter, withSuggestions, type BuildSources } from "./build";
import type { CharacterBuild } from "./build-record";

/** The standard array (SRD 5.2): one each of 15, 14, 13, 12, 10 and 8. */
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/** Point buy: 27 points, scores 8 to 15 before the background, each costing this much. */
export const POINT_BUY_BUDGET = 27;
const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

/** What a set of scores costs under point buy, or `undefined` if one is outside 8 to 15. */
export function pointBuyCost(scores: Record<Ability, number>): number | undefined {
  let total = 0;
  for (const ability of ABILITIES) {
    const cost = POINT_BUY_COST[scores[ability]];
    if (cost === undefined) return undefined;
    total += cost;
  }
  return total;
}

/** The standard array dealt out by a priority order: the first ability gets the 15. */
export function standardArrayFor(priority: Ability[]): Record<Ability, number> {
  const order = [...priority, ...ABILITIES.filter((ability) => !priority.includes(ability))];
  const dealt = new Map(order.slice(0, 6).map((ability, index) => [ability, STANDARD_ARRAY[index]!]));
  return Object.fromEntries(ABILITIES.map((ability) => [ability, dealt.get(ability)!])) as Record<Ability, number>;
}

export interface StartOptions {
  classId: string;
  /** How many levels in that class. Default 1. */
  level?: number;
  /** A catalog background; default the class's suggestion, else the first. */
  backgroundId?: string;
  speciesId?: string;
  abilities?: CharacterBuild["abilities"];
  /** The class's starting package; default its suggestion. `null`: none. */
  classOption?: string | null;
  backgroundOption?: string | null;
}

/** A new build: the class's scores from the standard array, its suggested background and package, no choices made. */
export function startBuild(sources: BuildSources, options: StartOptions): CharacterBuild {
  const definition = sources.catalog.classes.find((entry) => entry.id === options.classId);
  if (!definition) throw new Error(`No class ${options.classId}`);
  const backgroundId = options.backgroundId
    ?? (sources.catalog.backgrounds.some((entry) => entry.id === definition.suggested.background) ? definition.suggested.background : sources.catalog.backgrounds[0]?.id);
  const classOption = options.classOption === null ? undefined : options.classOption ?? definition.suggested.equipment ?? definition.startingEquipment?.[0]?.id;
  const backgroundOption = options.backgroundOption === null ? undefined : options.backgroundOption ?? "A";
  return {
    version: 1,
    edition: definition.edition,
    abilities: options.abilities ?? { method: "standard-array", base: standardArrayFor(definition.suggested.abilities) },
    background: { ...(backgroundId ? { id: backgroundId } : {}), increases: {} },
    ...(options.speciesId ? { species: { id: options.speciesId } } : {}),
    hp: { method: "average" },
    levels: Array.from({ length: Math.min(Math.max(options.level ?? 1, 1), 20) }, () => ({ classId: definition.id, choices: {} })),
    equipment: { ...(classOption ? { classOption } : {}), ...(backgroundOption ? { backgroundOption } : {}), applied: false },
    made: {}
  };
}

/** Quick build: a new build with every choice the builder would make (plan D7). */
export function quickBuild(sources: BuildSources, options: StartOptions): CharacterBuild {
  return withSuggestions(startBuild(sources, options), sources);
}

/** The build one level higher, in `classId` (default the class of its last level), with no choices made yet. */
export function withLevelUp(build: CharacterBuild, classId?: string): CharacterBuild {
  if (build.levels.length >= 20) return build;
  const next = classId ?? build.levels[build.levels.length - 1]?.classId;
  if (!next) return build;
  return { ...build, levels: [...build.levels, { classId: next, choices: {} }] };
}

/**
 * What taking a level in a new class needs that the character hasn't got (plan D11, warned about, not enforced): 13 in
 * the primary ability of the new class and of each class it has ("Wizard needs Intelligence 13 (it has 10)"). Nothing
 * when the class is one it has already. Scores are the build's as it stands, before the new level.
 */
export function multiclassProblems(build: CharacterBuild, classId: string, sources: BuildSources): string[] {
  if (build.levels.some((entry) => entry.classId === classId)) return [];
  const scores = buildCharacter(build, sources).fields.abilities;
  const classes = [classId, ...new Set(build.levels.map((entry) => entry.classId))];
  const names: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };
  return classes.flatMap((id) => {
    const definition = sources.catalog.classes.find((entry) => entry.id === id);
    if (!definition?.primaryAbilities.length) return [];
    const short = definition.primaryAbilities.filter((ability) => scores[ability] < 13);
    const fails = definition.primaryAbilityAny ? short.length === definition.primaryAbilities.length : short.length > 0;
    if (!fails) return [];
    const named = definition.primaryAbilityAny ? definition.primaryAbilities : short;
    const needed = named.map((ability) => `${names[ability]} 13`).join(definition.primaryAbilityAny ? " or " : " and ");
    const has = named.length === 1 ? String(scores[named[0]!]) : named.map((ability) => `${names[ability]} ${scores[ability]}`).join(", ");
    return [`${definition.name} needs ${needed} (it has ${has})`];
  });
}

/** The build one level lower: the last level and what was chosen at it go. */
export function withLevelDown(build: CharacterBuild): CharacterBuild {
  if (build.levels.length <= 1) return build;
  const rolls = build.hp.rolls?.slice(0, build.levels.length - 2);
  return { ...build, levels: build.levels.slice(0, -1), hp: { ...build.hp, ...(rolls ? { rolls } : {}) } };
}

/** Build and apply in one go. */
export function rebuildActor(definition: CreatureDefinition, build: CharacterBuild, sources: BuildSources, update?: string[]): ApplyResult {
  return applyBuild(definition, build, buildCharacter(build, sources), { library: sources.library, update });
}

/** A blank actor for a new character, before its build is applied. */
export function blankCharacter(id: string, name: string): CreatureDefinition {
  return {
    id,
    name,
    size: "medium",
    type: "humanoid",
    armorClass: 10,
    maxHp: 1,
    speed: 30,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    actions: []
  };
}
