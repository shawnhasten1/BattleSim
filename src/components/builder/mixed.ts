import { increasesSource, type CharacterBuild } from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";

/**
 * When a character's class, species and background aren't all of one edition (D10), what that means: each keeps its own
 * edition's rules, and where the ability increases come from. Undefined when they're all one edition.
 */
export function mixedRulesNote(build: CharacterBuild, sources: BuildSources): string | undefined {
  const firstClass = sources.catalog.classes.find((entry) => entry.id === build.levels[0]?.classId);
  if (!firstClass) return undefined;
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const others = [species, background].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry) && entry!.edition !== firstClass.edition);
  if (!others.length) return undefined;
  const from = increasesSource(build, sources) === "species" && species ? `the ${species.name.toLowerCase()} (the 2014 rule)` : "the background";
  return `Mixed rules: a ${firstClass.edition} ${firstClass.name} with ${others.map((entry) => `the ${entry.edition} ${entry.name}`).join(" and ")}. `
    + `Each keeps its own edition's rules. Ability increases come from ${from}: switch it in Abilities.`;
}
