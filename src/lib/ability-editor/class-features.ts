import { levelOf, type CreatureDefinition, type FeatureDefinition } from "@/engine";
import { attachedSource } from "@/data/srd";
import type { Srd2024Feature } from "@/data/srd/2024/feature-library";
import { proficiencyOf } from "@/lib/actor-sheet/edits";
import { scaledFeature } from "@/lib/character-builder/build";
import { evaluateNumber, type TemplateScope } from "@/lib/character-builder/template";

/**
 * A 2024 class feature, feat or species trait on any creature (EDITIONS_PLAN.md Phase 2), at a class level: its numbers
 * worked out as the character builder works them out for a character of that level (`scaledFeature`), and the pool it
 * spends sized the same way.
 */

/**
 * The level it's added at on this creature, unless the DM picks one: the creature's level in that class (or its character
 * level), never below the level the feature is gained.
 */
export function startingLevel(entry: Srd2024Feature, definition: CreatureDefinition): number {
  const own = entry.ownerKind === "class" ? levelOf(definition, entry.owner) : 0;
  const level = own || (definition.character ? levelOf(definition) : 0);
  return Math.min(20, Math.max(entry.level, level));
}

/** The words for where it comes from and at what level: "Barbarian 5", "Alert (feat)", "Dwarf". */
export function featureFrom(entry: Srd2024Feature, level?: number): string {
  if (entry.ownerKind === "feat") return `${entry.owner} (feat)`;
  if (entry.ownerKind === "species") return entry.owner;
  return `${entry.owner} ${level ?? entry.level}`;
}

/**
 * The feature at `level` for this creature: the latest version reached, scaled, with a line saying what level its numbers
 * are, under the library entry's source; and the pool it spends with its size, for the creature to start with.
 */
export function featureAtLevel(entry: Srd2024Feature, level: number, definition: CreatureDefinition): { feature: FeatureDefinition; pools?: Record<string, number> } {
  const at = Math.min(20, Math.max(entry.level, Math.round(level)));
  const version = [...entry.versions].reverse().find((candidate) => candidate.level <= at) ?? entry.versions[0]!;
  const scope: TemplateScope = {
    level: at,
    charLevel: Math.max(at, definition.character ? levelOf(definition) : 0),
    pb: proficiencyOf(definition),
    abilities: definition.abilities,
    columns: entry.columns
  };
  const { feature } = scaledFeature(version.grant.feature, version.grant, scope);
  const note = entry.ownerKind === "feat" || entry.ownerKind === "species"
    ? `Added at character level ${at}: its numbers are that level's.`
    : `Added at ${entry.owner} level ${at}: its numbers are that level's.`;
  let pools: Record<string, number> | undefined;
  const pool = version.grant.pool;
  if (pool) {
    try {
      pools = { [pool.id]: Math.max(0, evaluateNumber(pool.size, scope)) };
    } catch {
      // A size it can't work out is left for the DM to set on the sheet.
    }
  }
  return {
    feature: {
      ...feature,
      id: entry.id,
      description: [feature.description, note].filter(Boolean).join("\n\n"),
      source: attachedSource(entry.feature, entry.id)
    },
    ...(pools ? { pools } : {})
  };
}
