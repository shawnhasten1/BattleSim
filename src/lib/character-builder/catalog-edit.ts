import type { Edition, FeatureDefinition } from "@/engine";
import { buildCharacter, type BuildSources } from "./build";
import type {
  BackgroundDefinition,
  ChoiceSpec,
  ClassDefinition,
  ClassLevel,
  FeatDefinition,
  FeatureGrant,
  PickOption,
  SpeciesDefinition,
  SubclassDefinition
} from "./catalog";
import { homebrewId, mergeCatalog, parseCatalogEntry, type CatalogEntry, type CatalogKind } from "./homebrew";
import { blankCharacter, quickBuild, rebuildActor } from "./quick";

/**
 * What the Homebrew window's editors need besides the catalog types (plan Phase 8b): blank entries, a copy of an SRD
 * entry to start from, the numbers in a feature that can follow a table column, and what's wrong with an entry as it
 * stands, worked out by building with it.
 */

const homebrew = { provider: "homebrew" as const };
const twenty = <T>(value: T): T[] => Array.from({ length: 20 }, () => value);

/**
 * A new entry of a kind, named, with an id nothing else has, written for `edition`'s rules: a 2014 class has an Ability
 * Score Improvement at 19th level (no Epic Boon), a 2014 background no increases or feat, a 2014 race its own increases.
 */
export function blankEntry(kind: CatalogKind, name: string, taken: Iterable<string>, classId = "srd:class:fighter", edition: Edition = "2024"): CatalogEntry {
  const id = homebrewId(kind, name, taken);
  const old = edition === "2014";
  switch (kind) {
    case "class": {
      const entry: ClassDefinition = {
        id, name, source: homebrew, edition, hitDie: 8,
        primaryAbilities: ["str"], saves: ["str", "con"], skills: { count: 2, from: "any" },
        weaponProficiency: ["simple"], armorTraining: ["light"],
        // An Epic Boon at 19 is every 2024 class's (the builder asks for it), so it isn't a feat level there.
        subclassLevel: 3, subclassLabel: `${name} Subclass`, featLevels: old ? [4, 8, 12, 16, 19] : [4, 8, 12, 16],
        table: [], levels: [{ level: 3, grants: [], choices: [{ kind: "subclass", id: "subclass" }] }],
        suggested: { abilities: ["str", "con", "dex", "wis", "cha", "int"], tactics: "basic-melee" }
      };
      return { kind, entry };
    }
    case "subclass": {
      const entry: SubclassDefinition = { id, name, source: homebrew, edition, classId, levels: [] };
      return { kind, entry };
    }
    case "feat": {
      const entry: FeatDefinition = { id, name, source: homebrew, edition, category: "general", grants: [] };
      return { kind, entry };
    }
    case "background": {
      const entry: BackgroundDefinition = old
        ? { id, name, source: homebrew, edition, skills: [] }
        : { id, name, source: homebrew, edition, abilities: ["str", "dex", "con"], skills: [], feat: "srd:feat:alert" };
      return { kind, entry };
    }
    case "species": {
      const entry: SpeciesDefinition = { id, name, source: homebrew, edition, sizes: ["medium"], speed: 30, type: "humanoid", levels: [], ...(old ? { abilities: {} } : {}) };
      return { kind, entry };
    }
  }
}

/**
 * A copy of an entry to make one's own: a new id, "(homebrew)" after the name, a homebrew source. A copied class's SRD
 * subclasses stay with the SRD class; the copy's subclass choice offers subclasses made for the copy.
 */
export function copyAsHomebrew(item: CatalogEntry, taken: Iterable<string>, name = `${item.entry.name} (homebrew)`): CatalogEntry {
  const entry = structuredClone(item.entry);
  return { kind: item.kind, entry: { ...entry, id: homebrewId(item.kind, name, taken), name, source: homebrew } } as CatalogEntry;
}

/** A grant key from a name, unique among `taken` (`sneak-attack`, `sneak-attack-2`). */
export function grantKeyFor(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "feature";
  let key = base;
  for (let n = 2; used.has(key); n += 1) key = `${base}-${n}`;
  return key;
}

/** A new feature for a grant: reference only until the DM gives it something to run. */
export function blankFeature(name: string, key: string): FeatureDefinition {
  return { id: key, name, category: "feature", automationSupport: "manual-only", description: "" };
}

/** Every grant key an entry uses, at any depth (picks' options too): what `replaces`, `onHitOf` and scale keys name. */
export function grantKeysOf(levels: ClassLevel[] | undefined, grants: FeatureGrant[] = []): string[] {
  const keys: string[] = [];
  const fromGrants = (list: FeatureGrant[]) => { for (const grant of list) keys.push(grant.key); };
  const fromChoices = (choices: ChoiceSpec[] | undefined) => {
    for (const choice of choices ?? []) {
      if (choice.kind !== "pick") continue;
      for (const option of choice.options) { fromGrants(option.grants); fromChoices(option.choices); }
    }
  };
  fromGrants(grants);
  for (const level of levels ?? []) { fromGrants(level.grants); fromChoices(level.choices); }
  return keys;
}

/** A dice expression a scale entry can rewrite: `1d6`, `2d8+3`. */
const DICE = /^\d*d\d+([+-]\d+)?$/;
/** Fields that name or label things, never a number to scale. */
const NOT_SCALED = new Set(["id", "name", "description", "featureId", "resourceId", "kind", "category", "automationSupport", "notSimulated", "label"]);

/**
 * The numbers and dice in a feature that a table column (or a template) could set, as dot paths:
 * `grantedActions.0.damage.0.dice`, `effects.0.bonus`. What a scale entry's path can be.
 */
export function scalablePaths(feature: unknown, prefix = ""): Array<{ path: string; value: string | number }> {
  if (Array.isArray(feature)) return feature.flatMap((item, index) => scalablePaths(item, `${prefix}${index}.`));
  if (!feature || typeof feature !== "object") return [];
  return Object.entries(feature).flatMap(([key, value]) => {
    if (NOT_SCALED.has(key)) return [];
    const path = `${prefix}${key}`;
    if (typeof value === "number") return [{ path, value }];
    if (typeof value === "string") return DICE.test(value.replace(/\s+/g, "")) ? [{ path, value }] : [];
    return scalablePaths(value, `${path}.`);
  });
}

/** A level of an entry's level list, made if it hasn't one yet; the list stays in level order. */
export function levelEntry(levels: ClassLevel[], level: number): ClassLevel {
  let found = levels.find((entry) => entry.level === level);
  if (!found) {
    found = { level, grants: [] };
    levels.push(found);
    levels.sort((a, b) => a.level - b.level);
  }
  return found;
}

/** A new option for a pick. */
export function blankOption(name: string, taken: Iterable<string>): PickOption {
  return { id: grantKeyFor(name, taken), name, grants: [] };
}

/** Columns filled out to 20 levels (a new column is blank at every level). */
export const blankColumnValues = () => twenty<string | number | null>(null);

/**
 * What's wrong with an entry as it stands: what its schema says, then what building with it says. A class or subclass is
 * built at every level with the builder's suggestions (a subclass on its class, chosen at the subclass level); a species
 * or background on a 1st-level character of the first class. Each line names the level it came from.
 */
export function entryProblems(item: CatalogEntry, base: BuildSources, others: CatalogEntry[] = []): string[] {
  const parsed = parseCatalogEntry(item);
  if (parsed.problem) return [parsed.problem];
  const sources = mergeCatalog(base, [item, ...others.filter((other) => other.entry.id !== item.entry.id)]);
  const problems = new Set<string>();
  const firstClass = sources.catalog.classes[0]?.id;
  try {
    if (item.kind === "class" || item.kind === "subclass") {
      const classId = item.kind === "class" ? item.entry.id : item.entry.classId;
      const definition = sources.catalog.classes.find((entry) => entry.id === classId);
      if (!definition) return [`Its class (${classId}) isn't in the catalog.`];
      for (let level = 1; level <= 20; level += 1) {
        let build = quickBuild(sources, { classId, level });
        if (item.kind === "subclass" && level >= definition.subclassLevel) {
          build = {
            ...build,
            levels: build.levels.map((entry, index) => (index === definition.subclassLevel - 1
              ? { ...entry, choices: { ...entry.choices, subclass: item.entry.id } } : entry))
          };
        }
        for (const warning of buildCharacter(build, sources).warnings) problems.add(`Level ${level}: ${warning}`);
      }
    } else if ((item.kind === "species" || item.kind === "background") && firstClass) {
      const build = quickBuild(sources, item.kind === "species" ? { classId: firstClass, level: 20, speciesId: item.entry.id } : { classId: firstClass, level: 1, backgroundId: item.entry.id });
      for (const warning of buildCharacter(build, sources).warnings) problems.add(warning);
    }
  } catch (error) {
    problems.add(error instanceof Error ? error.message : String(error));
  }
  return [...problems];
}

/** The stand-in a feature is previewed on in the ability editor: the class (or the first class) built to a level. */
export function previewCharacter(sources: BuildSources, classId: string | undefined, level: number) {
  const id = classId && sources.catalog.classes.some((entry) => entry.id === classId) ? classId : sources.catalog.classes[0]?.id;
  if (!id) return blankCharacter("preview", "Preview");
  try {
    return rebuildActor(blankCharacter("preview", "Preview"), quickBuild(sources, { classId: id, level: Math.max(1, Math.min(20, level)) }), sources).definition;
  } catch {
    return blankCharacter("preview", "Preview");
  }
}
