import type { FeatureDefinition } from "@/engine";
import type { ChoiceSpec, ClassTableColumn, FeatureGrant } from "@/lib/character-builder/catalog";
import { CLASS_COVERAGE } from "./coverage";
import { SRD_2024_CATALOG } from "./index";

/**
 * The 2024 class features, feats and species traits as library entries (EDITIONS_PLAN.md Phase 2): what the character
 * builder places, offered in Add ability for any creature, beside the 2014 features. Each is added at a class level
 * (`featureAtLevel`, lib/ability-editor/class-features.ts), which works its numbers out the way the builder does.
 *
 * Listed: every grant whose feature runs in full or in part. Left out:
 * - the informational and reference-only ones (nothing to run), and the class features the builder places (its audit
 *   says `builder`: Spellcasting, Pact Magic, Eldritch Invocations, Aura Expansion);
 * - a library-feature reference (a string), which the builder resolves;
 * - a grant that works through something besides its feature, which a feature added alone would lose: another grant's
 *   weapon or action (`onHitOf`, `actionPatch`, `formsOf`), spells (`spells`, `freeCasts`, `spellChanges`), its own
 *   weapon (`weapon`), or the creature's speed, hit points, senses or saves (`adjust`).
 */

/** A grant whose feature is a record, not a library reference. */
export type FeatureVersion = { level: number; grant: FeatureGrant & { feature: FeatureDefinition } };

export interface Srd2024Feature {
  /** `srd:feature:<owner>-<name>-2024`. */
  id: string;
  name: string;
  /** What gives it: "Barbarian", "Path of the Berserker", "Alert", "Dwarf". */
  owner: string;
  ownerKind: "class" | "subclass" | "feat" | "species";
  /** The table its numbers read (`{col:…}`): a class's, or a subclass's after its class's. A feat's or species' has none. */
  columns: ClassTableColumn[];
  /** The level it's gained at: a class level, or for a feat or a species trait a character level. */
  level: number;
  /** Each level it changes at, earliest first (Font of Magic at 3rd, 5th, 7th and 9th): the latest one reached applies. */
  versions: FeatureVersion[];
  /** The earliest version's feature, as the library lists it, under the entry's id. */
  feature: FeatureDefinition;
}

const ELSEWHERE: ReadonlyArray<keyof FeatureGrant> = ["adjust", "onHitOf", "actionPatch", "formsOf", "spells", "freeCasts", "spellChanges", "weapon"];

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const tail = (id: string) => id.slice(id.lastIndexOf(":") + 1);

function listed(grant: FeatureGrant): grant is FeatureGrant & { feature: FeatureDefinition } {
  const feature = grant.feature;
  if (!feature || typeof feature === "string" || feature.informational) return false;
  if (feature.automationSupport !== "full" && feature.automationSupport !== "partial") return false;
  if (grant.ref && CLASS_COVERAGE[grant.ref.replace(/^srd-2024_/, "")]?.verdict === "builder") return false;
  return !ELSEWHERE.some((key) => grant[key] !== undefined);
}

interface Owner {
  name: string;
  kind: Srd2024Feature["ownerKind"];
  slug: string;
  columns: ClassTableColumn[];
}

function buildIndex(): Srd2024Feature[] {
  const byId = new Map<string, Srd2024Feature>();
  const add = (owner: Owner, level: number, grant: FeatureGrant) => {
    if (!listed(grant)) return;
    const feature = grant.feature as FeatureDefinition;
    const id = `srd:feature:${owner.slug}-${slug(feature.name)}-2024`;
    const found = byId.get(id);
    if (found) {
      if (!found.versions.some((version) => version.level === level)) found.versions.push({ level, grant });
      return;
    }
    byId.set(id, {
      id, name: feature.name, owner: owner.name, ownerKind: owner.kind, columns: owner.columns, level,
      versions: [{ level, grant }], feature: { ...feature, id }
    });
  };
  const addChoices = (owner: Owner, level: number, choices: readonly ChoiceSpec[] | undefined) => {
    for (const choice of choices ?? []) {
      if (choice.kind !== "pick") continue;
      for (const option of choice.options) {
        for (const grant of option.grants) add(owner, Math.max(level, option.prerequisite?.level ?? 0), grant);
        addChoices(owner, level, option.choices);
      }
    }
  };

  const { classes, subclasses, feats, species } = SRD_2024_CATALOG;
  for (const entry of classes) {
    const owner: Owner = { name: entry.name, kind: "class", slug: tail(entry.id), columns: entry.table };
    for (const level of entry.levels) {
      for (const grant of level.grants) add(owner, level.level, grant);
      addChoices(owner, level.level, level.choices);
    }
  }
  for (const entry of subclasses) {
    const parent = classes.find((candidate) => candidate.id === entry.classId);
    const owner: Owner = { name: entry.name, kind: "subclass", slug: tail(entry.id), columns: [...(parent?.table ?? []), ...(entry.table ?? [])] };
    for (const level of entry.levels) {
      for (const grant of level.grants) add(owner, level.level, grant);
      addChoices(owner, level.level, level.choices);
    }
  }
  for (const entry of feats) {
    const owner: Owner = { name: entry.name, kind: "feat", slug: `feat-${tail(entry.id)}`, columns: [] };
    const level = entry.prerequisite?.level ?? 1;
    for (const grant of entry.grants) add(owner, level, grant);
    addChoices(owner, level, entry.choices);
  }
  for (const entry of species) {
    const owner: Owner = { name: entry.name, kind: "species", slug: tail(entry.id), columns: [] };
    for (const level of entry.levels) {
      for (const grant of level.grants) add(owner, level.level, grant);
      addChoices(owner, level.level, level.choices);
    }
  }
  for (const entry of byId.values()) entry.versions.sort((a, b) => a.level - b.level);
  return [...byId.values()];
}

export const SRD_2024_FEATURES: readonly Srd2024Feature[] = buildIndex();

const FEATURES_BY_ID = new Map(SRD_2024_FEATURES.map((entry) => [entry.id, entry]));

export function findSrd2024Feature(id: string): Srd2024Feature | undefined {
  return FEATURES_BY_ID.get(id);
}
