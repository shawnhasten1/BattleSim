/**
 * The committed files built from the SRD 5.2 cache: the reference data, the spell index and the coverage audit. Pure; no
 * I/O. Paths are relative to the repo root.
 */
import { buildSrd2024Reference, type Srd2024Cache } from "./reference";
import { renderCoverage, checkCoverage, checkSpellCoverage } from "./coverage";
import { buildSrd2024Spells } from "./spells";

export const REFERENCE_PATH = "src/data/srd/2024/generated/reference.json";
export const COVERAGE_PATH = "src/data/srd/2024/COVERAGE.md";
export const SPELLS_PATH = "src/data/srd/2024/generated/spells.json";

export function buildSrd2024Files(cache: Srd2024Cache): { files: Map<string, string>; warnings: string[]; errors: string[] } {
  const { reference, warnings } = buildSrd2024Reference(cache);
  const { index: spells, warnings: spellWarnings } = buildSrd2024Spells(cache);
  warnings.push(...spellWarnings);
  const errors = [...checkCoverage(reference), ...checkSpellCoverage(spells)];
  const files = new Map<string, string>([
    [REFERENCE_PATH, `${JSON.stringify(reference, null, 1)}\n`],
    [SPELLS_PATH, `${JSON.stringify(spells, null, 1)}\n`],
    [COVERAGE_PATH, renderCoverage(reference, spells)]
  ]);
  return { files, warnings, errors };
}
