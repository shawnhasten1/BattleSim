import type { Ability, CreatureDefinition, Edition } from "@/engine";
import { ABILITIES, buildCharacter, withSuggestions, type BuildSources } from "./build";
import type { CharacterBuild } from "./build-record";
import type { ClassDefinition } from "./catalog";
import { startBuild } from "./quick";
import { readBuild } from "./summary";

/**
 * "Rebuild with the builder" (plan D10): a hand-built PC becomes a built one at the level it is. Its classes are matched
 * by name, its ability scores and typed hit point maximum are kept (worked back into the build), and nothing is added
 * from a starting package. Its hand-made abilities stay; the ones named like something the builder adds are listed, for
 * the DM to remove.
 */

/**
 * A catalog class by a hand-built PC's class name ("rogue" finds the Rogue): the SRD's before a homebrew one, and of
 * `edition` where both editions have it (the builder's filter).
 */
export function matchClass(name: string | undefined, sources: BuildSources, edition?: Edition): ClassDefinition | undefined {
  const wanted = name?.trim().toLowerCase();
  if (!wanted) return undefined;
  const named = sources.catalog.classes.filter((entry) => entry.name.toLowerCase() === wanted);
  return (edition ? named.find((entry) => entry.edition === edition) : undefined) ?? named[0];
}

export interface Adoption {
  build: CharacterBuild;
  /** What couldn't be carried over ("Spellsword isn't a class the builder has: its 2 levels go to Fighter"). */
  notes: string[];
}

/**
 * The build a hand-built PC would have: its classes in order (one the catalog hasn't got becomes `fallbackClassId`'s
 * levels), each matched subclass chosen at its level, its scores and maximum hit points as they are. `fallbackClassId`
 * also stands for a PC with no class at all, at its level.
 */
export function adoptionBuild(definition: CreatureDefinition, sources: BuildSources, fallbackClassId?: string, edition?: Edition): Adoption | undefined {
  const notes: string[] = [];
  const entries = definition.character?.classes ?? [];
  const fallback = fallbackClassId ? sources.catalog.classes.find((entry) => entry.id === fallbackClassId) : undefined;
  const levels: CharacterBuild["levels"] = [];
  for (const entry of entries) {
    const matched = matchClass(entry.name, sources, edition) ?? fallback;
    if (!matched) {
      notes.push(`${entry.name || "A class with no name"} isn't a class the builder has: its levels are left out`);
      continue;
    }
    if (matched !== matchClass(entry.name, sources, edition)) notes.push(`${entry.name || "A class with no name"} isn't a class the builder has: its levels go to ${matched.name}`);
    const before = levels.filter((level) => level.classId === matched.id).length;
    const count = Math.max(1, Math.min(entry.level ?? 1, 20 - levels.length));
    for (let n = 0; n < count && levels.length < 20; n += 1) levels.push({ classId: matched.id, choices: {} });
    const subclass = entry.subclass?.name
      ? sources.catalog.subclasses.find((candidate) => candidate.classId === matched.id && candidate.name.toLowerCase() === entry.subclass!.name.trim().toLowerCase())
      : undefined;
    if (entry.subclass?.name && !subclass) notes.push(`${entry.subclass.name} isn't a ${matched.name} subclass the builder has: the builder suggests one`);
    // The level its class's count reaches the subclass level.
    if (subclass && before + count >= matched.subclassLevel) {
      let seen = 0;
      const at = levels.findIndex((level) => level.classId === matched.id && (seen += 1) === matched.subclassLevel);
      if (at >= 0) levels[at] = { ...levels[at]!, choices: { ...levels[at]!.choices, subclass: subclass.id } };
    }
  }
  if (!levels.length) {
    if (!fallback) return undefined;
    const level = Math.max(1, Math.min(20, definition.character?.level ?? 1));
    for (let n = 0; n < level; n += 1) levels.push({ classId: fallback.id, choices: {} });
  }

  // Its scores as they are: the build's base is worked back from what the builder adds (a background, feats).
  const scores = { ...definition.abilities } as Record<Ability, number>;
  const start = startBuild(sources, { classId: levels[0]!.classId, level: 1, abilities: { method: "manual", base: { ...scores } }, classOption: null, backgroundOption: null });
  let build: CharacterBuild = withSuggestions({ ...start, levels, equipment: { applied: true } }, sources);
  for (let pass = 0; pass < 2; pass += 1) {
    const built = buildCharacter(build, sources).fields.abilities;
    const base = { ...build.abilities.base };
    let off = false;
    for (const ability of ABILITIES) {
      const delta = built[ability] - scores[ability];
      if (delta !== 0) off = true;
      base[ability] = Math.max(1, Math.min(30, base[ability] - delta));
    }
    if (!off) break;
    build = { ...build, abilities: { method: "manual", base } };
  }
  const reached = buildCharacter(build, sources).fields;
  const missed = ABILITIES.filter((ability) => reached.abilities[ability] !== scores[ability]);
  if (missed.length) notes.push(`Its ${missed.map((ability) => ability.toUpperCase()).join(", ")} can't be kept exactly: the build's increases go past it`);
  // Its typed hit point maximum, as the build's adjustment (plan D6).
  const adjust = definition.maxHp - reached.maxHp;
  if (adjust) build = { ...build, hp: { ...build.hp, adjust } };
  return { build, notes };
}

export type AbilityListName = "features" | "traits" | "actions" | "weapons" | "spells";

/**
 * The hand-made abilities named like something the builder made (a hand-made "Rage" beside the builder's Rage): the
 * DM's to remove. Read on an actor after the build is applied.
 */
export function sameNamedAbilities(definition: CreatureDefinition): Array<{ list: AbilityListName; id: string; name: string }> {
  const made = readBuild(definition)?.made ?? {};
  const isMade = (prefix: string, id: string) => made[`${prefix}:${id}`] !== undefined;
  const builderNames = new Set<string>();
  for (const feature of [...(definition.features ?? []), ...(definition.traits ?? [])]) {
    if (!isMade("feature", feature.id)) continue;
    builderNames.add(feature.name.toLowerCase());
    for (const action of feature.grantedActions ?? []) builderNames.add(action.name.toLowerCase());
  }
  for (const weapon of definition.weapons ?? []) if (isMade("weapon", weapon.id)) builderNames.add(weapon.name.toLowerCase());
  for (const spell of definition.spells ?? []) if (isMade("spell", spell.id)) builderNames.add(spell.name.toLowerCase());

  const handMade: Array<{ list: AbilityListName; id: string; name: string }> = [
    ...(definition.features ?? []).filter((record) => !isMade("feature", record.id)).map((record) => ({ list: "features" as const, id: record.id, name: record.name })),
    ...(definition.traits ?? []).filter((record) => !isMade("feature", record.id)).map((record) => ({ list: "traits" as const, id: record.id, name: record.name })),
    ...(definition.actions ?? []).map((record) => ({ list: "actions" as const, id: record.id, name: record.name })),
    ...(definition.weapons ?? []).filter((record) => !isMade("weapon", record.id)).map((record) => ({ list: "weapons" as const, id: record.id, name: record.name })),
    ...(definition.spells ?? []).filter((record) => !isMade("spell", record.id)).map((record) => ({ list: "spells" as const, id: record.id, name: record.name }))
  ];
  return handMade.filter((record) => builderNames.has(record.name.toLowerCase()));
}

/** The actor without these abilities. */
export function withoutAbilities(definition: CreatureDefinition, records: Array<{ list: AbilityListName; id: string }>): CreatureDefinition {
  const gone = (list: AbilityListName) => new Set(records.filter((record) => record.list === list).map((record) => record.id));
  const next: CreatureDefinition = { ...definition };
  for (const list of ["features", "traits", "actions", "weapons", "spells"] as const) {
    const ids = gone(list);
    if (!ids.size || !next[list]) continue;
    (next as unknown as Record<string, Array<{ id: string }>>)[list] = (next[list] as Array<{ id: string }>).filter((record) => !ids.has(record.id));
  }
  return next;
}
