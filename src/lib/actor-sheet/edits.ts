import {
  abilityModifier,
  proficiencyForChallengeRating,
  proficiencyFromDefinition,
  type Ability,
  type CreatureDefinition
} from "@/engine";

type Character = NonNullable<CreatureDefinition["character"]>;
export type ClassEntry = NonNullable<Character["classes"]>[number];

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** The level the Stats tab shows: the character's, else its first class's, else 1. */
export function characterLevel(definition: Pick<CreatureDefinition, "character">): number {
  return definition.character?.level ?? definition.character?.classes?.[0]?.level ?? 1;
}

/**
 * The character at a new level. With one class, that class levels with it (keeping its id, subclass and source). With
 * several, they're left alone, since which one leveled can't be told; with none, none is made up.
 */
export function withLevel(character: CreatureDefinition["character"], level: number): Character {
  const classes = character?.classes;
  return {
    ...character,
    level,
    ...(classes?.length === 1 ? { classes: [{ ...classes[0]!, level }] } : {})
  };
}

/**
 * The character with its first class renamed, keeping that class's level, id, subclass and source, and every other
 * class. A creature with no class gets one, at `level`.
 */
export function withClassName(character: CreatureDefinition["character"], name: string, level: number): Character {
  const [first, ...others] = character?.classes ?? [];
  return { ...character, classes: first ? [{ ...first, name }, ...others] : [{ name, level }] };
}

/** The character with these classes, its level their total. Without any, it keeps its level (a monster's caster level). */
export function withClasses(character: CreatureDefinition["character"], classes: ClassEntry[]): Character {
  if (!classes.length) {
    const { classes: _gone, ...rest } = character ?? {};
    return rest;
  }
  return { ...character, classes, level: classes.reduce((sum, entry) => sum + entry.level, 0) };
}

/* ─── proficiency ─────────────────────────────────────────────────────────── */

/** The proficiency bonus it rolls with: its own, or what its level gives it. */
export function proficiencyOf(definition: CreatureDefinition): number {
  return definition.proficiencyBonus ?? proficiencyFromDefinition(definition);
}

/** The 18 skills, as statblocks name them, with the ability each uses. Ids are the SRD's (`sleight_of_hand`). */
export const SKILLS: ReadonlyArray<{ id: string; name: string; ability: Ability }> = [
  { id: "acrobatics", name: "Acrobatics", ability: "dex" },
  { id: "animal_handling", name: "Animal Handling", ability: "wis" },
  { id: "arcana", name: "Arcana", ability: "int" },
  { id: "athletics", name: "Athletics", ability: "str" },
  { id: "deception", name: "Deception", ability: "cha" },
  { id: "history", name: "History", ability: "int" },
  { id: "insight", name: "Insight", ability: "wis" },
  { id: "intimidation", name: "Intimidation", ability: "cha" },
  { id: "investigation", name: "Investigation", ability: "int" },
  { id: "medicine", name: "Medicine", ability: "wis" },
  { id: "nature", name: "Nature", ability: "int" },
  { id: "perception", name: "Perception", ability: "wis" },
  { id: "performance", name: "Performance", ability: "cha" },
  { id: "persuasion", name: "Persuasion", ability: "cha" },
  { id: "religion", name: "Religion", ability: "int" },
  { id: "sleight_of_hand", name: "Sleight of Hand", ability: "dex" },
  { id: "stealth", name: "Stealth", ability: "dex" },
  { id: "survival", name: "Survival", ability: "wis" }
];

/** A skill's name from its id: a known one as statblocks print it, any other spelled out ("sixth_sense" → "Sixth sense"). */
export function skillName(id: string): string {
  const known = SKILLS.find((skill) => skill.id === id)?.name;
  if (known) return known;
  const words = id.replace(/[-_]+/g, " ").trim();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** What a save's or a skill's bonus says about it: not set, proficient, expertise, or a number of its own. */
export type ProficiencyKind = "none" | "proficient" | "expertise" | "custom";

export function saveKind(definition: CreatureDefinition, ability: Ability): ProficiencyKind {
  const value = definition.saves?.[ability];
  if (value === undefined) return "none";
  return value === abilityModifier(definition.abilities[ability]) + proficiencyOf(definition) ? "proficient" : "custom";
}

export function skillKind(definition: CreatureDefinition, id: string): ProficiencyKind {
  const value = definition.skills?.[id];
  if (value === undefined) return "none";
  const skill = SKILLS.find((entry) => entry.id === id);
  if (!skill) return "custom";
  const modifier = abilityModifier(definition.abilities[skill.ability]);
  const proficiency = proficiencyOf(definition);
  if (value === modifier + proficiency) return "proficient";
  if (value === modifier + 2 * proficiency) return "expertise";
  return "custom";
}

/** A skill's bonus when it's proficient (or, with `expertise`, doubly so): what Add skill and Expertise write. */
export function skillBonus(definition: CreatureDefinition, id: string, expertise = false): number {
  const skill = SKILLS.find((entry) => entry.id === id);
  const modifier = skill ? abilityModifier(definition.abilities[skill.ability]) : 0;
  return modifier + (expertise ? 2 : 1) * proficiencyOf(definition);
}

/**
 * Plan D9: saves and skills that were proficient (or expert) in `before` follow a change to its scores or proficiency
 * bonus, so a proficient CON save goes from +4 to +5 when CON goes from 14 to 16. A number of its own (a printed +7 that
 * isn't modifier + proficiency) stays. `before` is the creature before the edit began, so typing 16 over 14 isn't read
 * from the 1 on the way. Saves or skills the change sets itself (`explicit`) are left as it sets them.
 */
export function withProficienciesFollowing(
  before: CreatureDefinition,
  after: CreatureDefinition,
  explicit: { saves?: boolean; skills?: boolean } = {}
): CreatureDefinition {
  const proficiency = proficiencyOf(after);
  let saves = after.saves;
  let skills = after.skills;
  if (!explicit.saves) {
    for (const ability of ABILITIES) {
      if (saveKind(before, ability) !== "proficient") continue;
      const next = abilityModifier(after.abilities[ability]) + proficiency;
      if (saves?.[ability] !== next) saves = { ...saves, [ability]: next };
    }
  }
  if (!explicit.skills) {
    for (const id of Object.keys(before.skills ?? {})) {
      const kind = skillKind(before, id);
      if ((kind !== "proficient" && kind !== "expertise") || skills?.[id] === undefined) continue;
      const next = skillBonus(after, id, kind === "expertise");
      if (skills[id] !== next) skills = { ...skills, [id]: next };
    }
  }
  return saves === after.saves && skills === after.skills ? after : { ...after, saves, skills };
}

/** A challenge rating, and the proficiency bonus it gives when the bonus was blank or what the old rating gave. */
export function withChallengeRating(definition: CreatureDefinition, cr: number | undefined): Partial<CreatureDefinition> {
  const old = definition.challengeRating;
  const followsRating = definition.proficiencyBonus === undefined || (old !== undefined && definition.proficiencyBonus === proficiencyForChallengeRating(old));
  return {
    challengeRating: cr,
    ...(cr !== undefined && followsRating ? { proficiencyBonus: proficiencyForChallengeRating(cr) } : {})
  };
}

/** The challenge ratings a statblock can have, smallest first. */
export const CHALLENGE_RATINGS: readonly number[] = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, index) => index + 1)];
