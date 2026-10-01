import type { CreatureDefinition } from "@/engine";

type Character = NonNullable<CreatureDefinition["character"]>;

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
