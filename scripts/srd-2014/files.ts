/**
 * The committed files built from the SRD 5.1 cache: the reference data, the spell index and the coverage audit
 * (EDITIONS_PLAN.md, Phase 4). Pure; no I/O. Paths are relative to the repo root.
 */
import { SRD_ATTRIBUTION } from "../../src/data/srd/attribution";
import { SPELL_OVERRIDES } from "../../src/data/srd/2014/overrides";
import type { Srd2014Reference, Srd2014SpellIndex } from "../../src/data/srd/2014/reference-types";
import { buildSrd2014SpellLibrary, srd2014SpellId } from "../../src/data/srd/2014/spell-library";
import type { Catalog } from "../../src/lib/character-builder/catalog";
import { buildSpellIndex } from "../srd-2024/spells";
import { checkCoverage2014, renderCoverage2014 } from "./coverage";
import { buildSrd2014Reference, PREFIX_2014, type Srd2014Cache } from "./reference";

export const REFERENCE_PATH = "src/data/srd/2014/generated/reference.json";
export const SPELLS_PATH = "src/data/srd/2014/generated/spells.json";
export const COVERAGE_PATH = "src/data/srd/2014/COVERAGE.md";

/** A spell's name for matching across sources: "Blindness/Deafness" and "blindness-deafness" are the same spell. */
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Each spell's classes from SRD 5.1's own spell lists (`spellClassLists`, see `fetch-srd.ts`), not Open5e's, which name
 * no Paladin and fold in subclasses' spells from outside the SRD. A list naming a spell the index hasn't got is an error.
 */
function withClassLists(spells: Srd2014SpellIndex, lists: Record<string, string[]> | undefined, errors: string[]): Srd2014SpellIndex {
  if (!lists) {
    errors.push("the cache has no spellClassLists: run npm run srd:2014:fetch");
    return spells;
  }
  const classesOf = new Map<string, string[]>();
  const known = new Set(spells.spells.map((spell) => nameKey(spell.name)));
  for (const [list, names] of Object.entries(lists)) {
    for (const name of names) {
      if (!known.has(nameKey(name))) errors.push(`the ${list} spell list names ${name}, which isn't in the SRD 5.1 index`);
      classesOf.set(nameKey(name), [...(classesOf.get(nameKey(name)) ?? []), list]);
    }
  }
  return { ...spells, spells: spells.spells.map((spell) => ({ ...spell, classes: (classesOf.get(nameKey(spell.name)) ?? []).sort() })) };
}

/** The reference data and the spell index: what the catalog reads, so they're written before the audit is built. */
export function buildSrd2014Data(cache: Srd2014Cache): { reference: Srd2014Reference; spells: Srd2014SpellIndex; warnings: string[]; errors: string[] } {
  const errors: string[] = [];
  const { reference, warnings } = buildSrd2014Reference(cache);
  const { index, warnings: spellWarnings } = buildSpellIndex(cache, { prefix: PREFIX_2014, attribution: SRD_ATTRIBUTION, overrides: SPELL_OVERRIDES });
  const spells = withClassLists(index, cache.spellClassLists, errors);
  return { reference, spells, warnings: [...warnings, ...spellWarnings], errors };
}

/** Every authored 2014 library spell is in the SRD 5.1 index, or it's a spell from outside the SRD (by library id). */
export function checkSpells2014(spells: Srd2014SpellIndex, libraryIds: string[], outsideSrd: readonly string[]): string[] {
  const ids = new Set(spells.spells.map((spell) => srd2014SpellId(spell.slug)));
  const errors = libraryIds.filter((id) => !ids.has(id) && !outsideSrd.includes(id)).map((id) => `library spell ${id} isn't in the SRD 5.1 index`);
  for (const id of outsideSrd) if (ids.has(id)) errors.push(`OUTSIDE_SRD_51 names ${id}, which is in the SRD 5.1 index`);
  return errors;
}

export function buildSrd2014Files(data: { reference: Srd2014Reference; spells: Srd2014SpellIndex }, catalog: Catalog | undefined): { files: Map<string, string>; errors: string[] } {
  const library = buildSrd2014SpellLibrary(data.spells);
  return {
    files: new Map([
      [REFERENCE_PATH, `${JSON.stringify(data.reference, null, 1)}\n`],
      [SPELLS_PATH, `${JSON.stringify(data.spells, null, 1)}\n`],
      [COVERAGE_PATH, renderCoverage2014(data.reference, data.spells, library, catalog)]
    ]),
    errors: checkCoverage2014(data.reference, catalog)
  };
}
