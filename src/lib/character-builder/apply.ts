import {
  normalizeItemDefinition,
  normalizeWeaponDefinition,
  withItemPool,
  type CreatureDefinition,
  type FeatureDefinition,
  type ItemDefinition,
  type WeaponDefinition
} from "@/engine";
import { skillName } from "@/lib/actor-sheet/edits";
import type { CharacterBuild } from "./build-record";
import type { BuilderLibrary, BuiltCharacter, BuiltFeature, BuiltFields } from "./build";
import { fingerprint } from "./fingerprint";

/**
 * Putting a built character on its actor (plan D5): the builder replaces only what it made last time and the DM hasn't
 * changed since. A feature, a field or a pool the DM edited (or deleted) stays as the DM left it, and the change list says
 * so; `update` names the ones to replace anyway ("Update to this level's version"). Equipment goes on once, on the first
 * build, and is the DM's from then on.
 *
 * What the builder made is remembered in the build's `made` map: a feature by `feature:<id>`, a field by `field:<name>`,
 * a save, a skill, a sense or a pool by `save:<ability>`, `skill:<id>`, `sense:<sense>`, `resource:<id>`.
 */

export type BuildChange =
  | { kind: "gained"; key: string; name: string }
  | { kind: "lost"; key: string; name: string }
  | { kind: "changed"; key: string; name: string; details: string[] }
  | { kind: "kept"; key: string; name: string; reason: "edited" | "removed" | "not-granted"; details?: string[] }
  | { kind: "field"; key: string; name: string; before: unknown; after: unknown };

export interface ApplyResult {
  definition: CreatureDefinition;
  build: CharacterBuild;
  changes: BuildChange[];
  warnings: string[];
}

export interface ApplyOptions {
  library: BuilderLibrary;
  /** `made` keys to replace even though the DM changed them. */
  update?: string[];
}

type Made = CharacterBuild["made"];

interface FieldSpec {
  key: keyof BuiltFields;
  label: string;
  get: (definition: CreatureDefinition) => unknown;
  set: (definition: CreatureDefinition, value: unknown) => CreatureDefinition;
}

const top = <K extends keyof CreatureDefinition>(key: K, label: string): FieldSpec => ({
  key: key as keyof BuiltFields,
  label,
  get: (definition) => definition[key],
  set: (definition, value) => {
    if (value === undefined) {
      const { [key]: _gone, ...rest } = definition;
      return rest as CreatureDefinition;
    }
    return { ...definition, [key]: value };
  }
});

const FIELDS: FieldSpec[] = [
  {
    key: "level", label: "Level",
    get: (definition) => definition.character?.level,
    set: (definition, value) => ({ ...definition, character: { ...definition.character, level: value as number } })
  },
  {
    key: "classes", label: "Classes",
    get: (definition) => definition.character?.classes,
    set: (definition, value) => ({ ...definition, character: { ...definition.character, classes: value as NonNullable<CreatureDefinition["character"]>["classes"] } })
  },
  top("abilities", "Ability scores"),
  top("maxHp", "Hit point maximum"),
  top("proficiencyBonus", "Proficiency bonus"),
  top("armorClass", "AC without armor"),
  top("speed", "Speed"),
  top("movement", "Movement"),
  top("size", "Size"),
  top("type", "Creature type"),
  top("spellcasting", "Spellcasting ability"),
  top("defaultTactics", "Tactics"),
  top("defaultResourceStance", "Resource stance"),
  top("conditionImmunities", "Condition immunities")
];

/** The entries of a record-valued field the builder owns one by one, so the DM can add their own beside them. */
const ENTRY_FIELDS = [
  { prefix: "save", field: "saves" as const, label: (id: string) => `${id.toUpperCase()} save` },
  { prefix: "skill", field: "skills" as const, label: (id: string) => skillName(id) },
  { prefix: "sense", field: "senses" as const, label: (id: string) => `${id.charAt(0).toUpperCase()}${id.slice(1)}` },
  { prefix: "resource", field: "resources" as const, label: (id: string) => (/^slot-\d$/.test(id) ? `Level ${id.slice(5)} spell slots` : `${id.replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase())} uses`) }
];

const describe = (value: unknown): string => {
  if (value === undefined) return "none";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

function getPath(target: unknown, path: string): unknown {
  let node = target as Record<string, unknown> | undefined;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = node[part] as Record<string, unknown> | undefined;
  }
  return node;
}

/** What changed in a feature the builder rewrote: its scaled numbers, and its name. */
function featureDetails(before: FeatureDefinition, after: BuiltFeature): string[] {
  const details: string[] = [];
  if (before.name !== after.feature.name) details.push(`${before.name} → ${after.feature.name}`);
  for (const path of after.scaled) {
    const was = getPath(before, path);
    const now = getPath(after.feature, path);
    if (was !== now) details.push(`${describe(was)} → ${describe(now)}`);
  }
  return details;
}

export function applyBuild(definition: CreatureDefinition, build: CharacterBuild, built: BuiltCharacter, options: ApplyOptions): ApplyResult {
  const update = new Set(options.update ?? []);
  const made: Made = {};
  const changes: BuildChange[] = [];
  const warnings = [...built.warnings];
  let next: CreatureDefinition = definition;

  /** Whether the builder may write `key` over what's there now. */
  const mayWrite = (key: string, current: unknown) => {
    const previous = build.made[key];
    return !previous || update.has(key) || fingerprint(current) === previous.fingerprint;
  };

  // Fields.
  for (const spec of FIELDS) {
    const key = `field:${spec.key}`;
    const current = spec.get(next);
    const raw = built.fields[spec.key];
    // An empty list is nothing to own (no condition immunities).
    const value = Array.isArray(raw) && raw.length === 0 ? undefined : raw;
    if (value === undefined) {
      // No longer the builder's: take it away if it's as the builder left it.
      if (build.made[key] && fingerprint(current) === build.made[key]!.fingerprint) next = spec.set(next, undefined);
      continue;
    }
    if (mayWrite(key, current)) {
      if (fingerprint(current) !== fingerprint(value)) changes.push({ kind: "field", key, name: spec.label, before: current, after: value });
      next = spec.set(next, value);
      made[key] = { key, fingerprint: fingerprint(value) };
    } else {
      changes.push({ kind: "kept", key, name: spec.label, reason: "edited", details: [`yours: ${describe(current)}`, `the build's: ${describe(value)}`] });
      made[key] = build.made[key]!;
    }
  }

  // Saves, skills, senses and pools, entry by entry.
  for (const entry of ENTRY_FIELDS) {
    const builtEntries = (entry.field === "resources" ? built.resources : built.fields[entry.field]) as Record<string, unknown>;
    const current = { ...((next[entry.field] as Record<string, unknown> | undefined) ?? {}) };
    const previousKeys = Object.keys(build.made).filter((key) => key.startsWith(`${entry.prefix}:`)).map((key) => key.slice(entry.prefix.length + 1));
    for (const id of new Set([...Object.keys(builtEntries), ...previousKeys])) {
      const key = `${entry.prefix}:${id}`;
      const value = builtEntries[id];
      if (value === undefined) {
        if (build.made[key] && fingerprint(current[id]) === build.made[key]!.fingerprint) {
          if (current[id] !== undefined) changes.push({ kind: "field", key, name: entry.label(id), before: current[id], after: undefined });
          delete current[id];
        }
        continue;
      }
      if (mayWrite(key, current[id])) {
        if (current[id] !== value) changes.push({ kind: "field", key, name: entry.label(id), before: current[id], after: value });
        current[id] = value;
        made[key] = { key, fingerprint: fingerprint(value) };
      } else {
        changes.push({ kind: "kept", key, name: entry.label(id), reason: "edited", details: [`yours: ${describe(current[id])}`, `the build's: ${describe(value)}`] });
        made[key] = build.made[key]!;
      }
    }
    next = { ...next, [entry.field]: Object.keys(current).length ? current : undefined };
  }

  // Features and traits.
  const builtIds = new Set(built.features.map((entry) => `feature:${entry.feature.id}`));
  const madeFeatureIds = new Set(Object.keys(build.made).filter((key) => key.startsWith("feature:")));
  for (const bucket of ["features", "traits"] as const) {
    const existing = next[bucket] ?? [];
    const byId = new Map(existing.map((feature) => [feature.id, feature]));
    const placed: FeatureDefinition[] = [];
    for (const entry of built.features.filter((candidate) => candidate.bucket === bucket)) {
      const key = `feature:${entry.feature.id}`;
      const current = byId.get(entry.feature.id);
      const previous = build.made[key];
      if (!current) {
        if (previous && !update.has(key)) {
          changes.push({ kind: "kept", key, name: entry.feature.name, reason: "removed" });
          made[key] = previous;
          continue;
        }
        changes.push({ kind: "gained", key, name: entry.feature.name });
        placed.push(entry.feature);
        made[key] = { key: entry.key, fingerprint: fingerprint(entry.feature) };
        continue;
      }
      if (!previous && !update.has(key)) {
        warnings.push(`${entry.feature.name}: the actor already has its own feature with id ${entry.feature.id}`);
        continue;
      }
      if (update.has(key) || fingerprint(current) === previous!.fingerprint) {
        const details = featureDetails(current, entry);
        if (fingerprint(current) !== fingerprint(entry.feature)) changes.push({ kind: "changed", key, name: entry.feature.name, details });
        placed.push(entry.feature);
        made[key] = { key: entry.key, fingerprint: fingerprint(entry.feature) };
      } else {
        const details = featureDetails(current, entry);
        changes.push({ kind: "kept", key, name: current.name, reason: "edited", ...(details.length ? { details } : {}) });
        placed.push(current);
        made[key] = previous!;
      }
    }
    // What the builder made before and no longer grants: gone if untouched, kept if the DM edited it.
    for (const feature of existing) {
      const key = `feature:${feature.id}`;
      if (!madeFeatureIds.has(key) || builtIds.has(key)) continue;
      if (fingerprint(feature) === build.made[key]!.fingerprint) {
        changes.push({ kind: "lost", key, name: feature.name });
      } else {
        changes.push({ kind: "kept", key, name: feature.name, reason: "not-granted" });
        placed.push(feature);
        made[key] = build.made[key]!;
      }
    }
    const others = existing.filter((feature) => !madeFeatureIds.has(`feature:${feature.id}`) && !builtIds.has(`feature:${feature.id}`));
    // The actor's own features with an id the builder wanted are kept as they are.
    const clashes = existing.filter((feature) => builtIds.has(`feature:${feature.id}`) && !build.made[`feature:${feature.id}`] && !update.has(`feature:${feature.id}`));
    const list = [...placed, ...clashes, ...others];
    next = { ...next, [bucket]: list.length ? list : undefined };
  }

  // The builder's own weapons (the Monk's Unarmed Strike), kept by the same rules as features.
  {
    const existing = next.weapons ?? [];
    const builtIds = new Set(built.weapons.map((entry) => `weapon:${entry.weapon.id}`));
    const madeIds = new Set(Object.keys(build.made).filter((key) => key.startsWith("weapon:")));
    const placed: WeaponDefinition[] = [];
    for (const entry of built.weapons) {
      const key = `weapon:${entry.weapon.id}`;
      const weapon = normalizeWeaponDefinition(structuredClone(entry.weapon), next.abilities);
      const current = existing.find((candidate) => candidate.id === entry.weapon.id);
      const previous = build.made[key];
      if (!current) {
        if (previous && !update.has(key)) {
          changes.push({ kind: "kept", key, name: weapon.name, reason: "removed" });
          made[key] = previous;
          continue;
        }
        changes.push({ kind: "gained", key, name: weapon.name });
        placed.push(weapon);
        made[key] = { key: entry.key, fingerprint: fingerprint(weapon) };
        continue;
      }
      if (!previous && !update.has(key)) {
        warnings.push(`${weapon.name}: the actor already has its own weapon with id ${weapon.id}`);
        continue;
      }
      if (update.has(key) || fingerprint(current) === previous!.fingerprint) {
        if (fingerprint(current) !== fingerprint(weapon)) {
          const details = entry.scaled.map((path) => `${String(getPath(current, path) ?? "none")} → ${String(getPath(weapon, path) ?? "none")}`)
            .filter((detail) => !/^(.*) → \1$/.test(detail));
          changes.push({ kind: "changed", key, name: weapon.name, details });
        }
        placed.push(weapon);
        made[key] = { key: entry.key, fingerprint: fingerprint(weapon) };
      } else {
        changes.push({ kind: "kept", key, name: current.name, reason: "edited" });
        placed.push(current);
        made[key] = previous!;
      }
    }
    for (const weapon of existing) {
      const key = `weapon:${weapon.id}`;
      if (!madeIds.has(key) || builtIds.has(key)) continue;
      if (fingerprint(weapon) === build.made[key]!.fingerprint) {
        changes.push({ kind: "lost", key, name: weapon.name });
      } else {
        changes.push({ kind: "kept", key, name: weapon.name, reason: "not-granted" });
        placed.push(weapon);
        made[key] = build.made[key]!;
      }
    }
    const clashes = existing.filter((weapon) => builtIds.has(`weapon:${weapon.id}`) && !build.made[`weapon:${weapon.id}`] && !update.has(`weapon:${weapon.id}`));
    const others = existing.filter((weapon) => !madeIds.has(`weapon:${weapon.id}`) && !builtIds.has(`weapon:${weapon.id}`));
    const list = [...placed, ...clashes, ...others];
    next = { ...next, weapons: list.length ? list : undefined };
  }

  // Equipment, once.
  let equipment = build.equipment;
  if (equipment && !equipment.applied) {
    const weapons: WeaponDefinition[] = [...(next.weapons ?? [])];
    const items: ItemDefinition[] = [...(next.items ?? [])];
    const taken = new Set([...weapons.map((weapon) => weapon.id), ...items.map((item) => item.id)]);
    const freshId = (ref: string) => {
      const base = `pcb-${ref.slice(ref.lastIndexOf(":") + 1)}`;
      let id = base;
      for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
      taken.add(id);
      return id;
    };
    for (const { ref } of built.equipment) {
      const source = { provider: "homebrew" as const, documentName: "SRD", slug: ref };
      if (ref.startsWith("srd:weapon:")) {
        const weapon = options.library.weapon(ref);
        if (!weapon) { warnings.push(`No library weapon ${ref}`); continue; }
        const id = freshId(ref);
        const normalized = normalizeWeaponDefinition(structuredClone(weapon), next.abilities);
        weapons.push({ ...normalized, id, actionId: `weapon-action-${id}`, source });
        changes.push({ kind: "gained", key: `equipment:${ref}`, name: weapon.name });
      } else {
        const item = options.library.item(ref);
        if (!item) { warnings.push(`No library item ${ref}`); continue; }
        const id = freshId(ref);
        items.push(withItemPool({ ...normalizeItemDefinition(structuredClone(item)), id, source }, id));
        changes.push({ kind: "gained", key: `equipment:${ref}`, name: item.name });
      }
    }
    next = { ...next, weapons, ...(items.length ? { items } : {}) };
    equipment = { ...equipment, applied: true };
  }

  const nextBuild: CharacterBuild = { ...build, made, ...(equipment ? { equipment } : {}) };
  next = { ...next, character: { ...next.character, build: nextBuild } };
  return { definition: next, build: nextBuild, changes, warnings };
}
