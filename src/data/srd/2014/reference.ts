import referenceFile from "./generated/reference.json";
import type { Reference2014Background, Reference2014Feat, ReferenceClass, ReferenceColumn, ReferenceFeature, ReferenceRace, Srd2014Reference } from "./reference-types";

/**
 * The SRD 5.1 reference data, for the 2014 catalog to take its text and tables from: a feature's description is the SRD's
 * own text (`srd14FeatureText`), and a class's table columns are the SRD's (`srd14Columns`), so neither is typed by hand.
 * Keys are Open5e's, with or without their `srd_` prefix.
 */
export const SRD_2014_REFERENCE = referenceFile as unknown as Srd2014Reference;

export const PREFIX_2014 = "srd_";
const withPrefix = (key: string) => (key.startsWith(PREFIX_2014) ? key : `${PREFIX_2014}${key}`);

const featuresByKey = new Map<string, ReferenceFeature>();
for (const owner of SRD_2014_REFERENCE.classes) for (const feature of owner.features) featuresByKey.set(feature.key, feature);

export function srd14Class(key: string): ReferenceClass {
  const found = SRD_2014_REFERENCE.classes.find((entry) => entry.key === withPrefix(key));
  if (!found) throw new Error(`No SRD 5.1 class ${key}`);
  return found;
}

export function srd14Feature(key: string): ReferenceFeature {
  const found = featuresByKey.get(withPrefix(key));
  if (!found) throw new Error(`No SRD 5.1 feature ${key}`);
  return found;
}

export const srd14FeatureText = (key: string) => srd14Feature(key).text.replace(/\r\n/g, "\n");

/** A class's table columns, as the catalog's `table` takes them. */
export function srd14Columns(classKey: string): Array<Omit<ReferenceColumn, "key">> {
  return srd14Class(classKey).columns.map(({ id, label, values }) => ({ id, label, values }));
}

/** One column's numbers by level (blanks as 0): a caster's cantrips or spells known, a monk's ki points. */
export function srd14Numbers(classKey: string, columnId: string): number[] {
  const column = srd14Class(classKey).columns.find((entry) => entry.id === columnId);
  if (!column) throw new Error(`No column ${columnId} on SRD 5.1 class ${classKey}`);
  return column.values.map((value) => (typeof value === "number" ? value : 0));
}

export function srd14Race(key: string): ReferenceRace {
  const found = SRD_2014_REFERENCE.races.find((entry) => entry.key === withPrefix(key));
  if (!found) throw new Error(`No SRD 5.1 race ${key}`);
  return found;
}

export function srd14TraitText(raceKey: string, trait: string): string {
  const found = srd14Race(raceKey).traits.find((entry) => entry.name === trait);
  if (!found) throw new Error(`No trait ${trait} on SRD 5.1 race ${raceKey}`);
  return found.text;
}

export function srd14Background(key: string): Reference2014Background {
  const found = SRD_2014_REFERENCE.backgrounds.find((entry) => entry.key === withPrefix(key));
  if (!found) throw new Error(`No SRD 5.1 background ${key}`);
  return found;
}

export function srd14Feat(key: string): Reference2014Feat {
  const found = SRD_2014_REFERENCE.feats.find((entry) => entry.key === withPrefix(key));
  if (!found) throw new Error(`No SRD 5.1 feat ${key}`);
  return found;
}
