import type { SourceMetadata } from "@/engine";
import referenceFile from "./generated/reference.json";
import type { ReferenceClass, ReferenceColumn, ReferenceFeat, ReferenceFeature, Srd2024Reference } from "./reference-types";

/**
 * The SRD 5.2 reference data, for the catalog to take its text and tables from: a feature's description is the SRD's
 * own text (`srdFeatureText`), and a class's table columns are the SRD's (`srdColumns`), so neither is typed by hand.
 */
export const SRD_2024_REFERENCE = referenceFile as unknown as Srd2024Reference;

export type { ReferenceClass, ReferenceColumn, ReferenceFeat, ReferenceFeature, Srd2024Reference } from "./reference-types";

const PREFIX = "srd-2024_";
const withPrefix = (key: string) => (key.startsWith(PREFIX) ? key : `${PREFIX}${key}`);

const featuresByKey = new Map<string, { feature: ReferenceFeature; owner: ReferenceClass }>();
for (const owner of SRD_2024_REFERENCE.classes) {
  for (const feature of owner.features) featuresByKey.set(feature.key, { feature, owner });
}

/** Where SRD 5.2 content comes from, on every record the builder makes from it. */
export function srd52Source(slug?: string): SourceMetadata {
  return {
    provider: "srd",
    documentKey: "srd-2024",
    documentName: "System Reference Document 5.2",
    ...(slug ? { slug } : {})
  };
}

export function srdClass(key: string): ReferenceClass {
  const found = SRD_2024_REFERENCE.classes.find((entry) => entry.key === withPrefix(key));
  if (!found) throw new Error(`No SRD 5.2 class ${key}`);
  return found;
}

export function srdFeature(key: string): ReferenceFeature {
  const found = featuresByKey.get(withPrefix(key));
  if (!found) throw new Error(`No SRD 5.2 feature ${key}`);
  return found.feature;
}

/** A class or subclass feature's SRD text. */
export function srdFeatureText(key: string): string {
  return srdFeature(key).text;
}

export function srdFeat(key: string): ReferenceFeat {
  const found = SRD_2024_REFERENCE.feats.find((entry) => entry.key === withPrefix(key));
  if (!found) throw new Error(`No SRD 5.2 feat ${key}`);
  return found;
}

/** A feat's SRD text: its introduction and each of its benefits. */
export function srdFeatText(key: string): string {
  const feat = srdFeat(key);
  return [feat.text, ...feat.benefits].filter(Boolean).join("\n\n");
}

/** A species trait's SRD text. */
export function srdTraitText(speciesKey: string, traitName: string): string {
  const species = SRD_2024_REFERENCE.species.find((entry) => entry.key === withPrefix(speciesKey));
  const trait = species?.traits.find((entry) => entry.name === traitName);
  if (!trait) throw new Error(`No SRD 5.2 trait ${speciesKey}: ${traitName}`);
  return trait.text;
}

/** A class's features-table columns, as the catalog's `table`. */
export function srdColumns(key: string, ids?: string[]): Array<{ id: string; label: string; values: Array<string | number | null> }> {
  return srdClass(key).columns
    .filter((column) => !ids || ids.includes(column.id))
    .map(({ id, label, values }) => ({ id, label, values }));
}

/** One column's 20 values as numbers (blanks as 0): a weapon mastery count, a prepared-spell count. */
export function srdNumbers(key: string, id: string): number[] {
  const column = srdClass(key).columns.find((entry) => entry.id === id);
  if (!column) throw new Error(`No column ${id} on ${key}`);
  return column.values.map((value) => (typeof value === "number" ? value : 0));
}
