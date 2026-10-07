/**
 * The 2014 coverage audit (EDITIONS_PLAN.md, Phase 4): every SRD 5.1 class feature and race trait with a verdict read from
 * the 2014 catalog, the gap codes of what doesn't run in full (`src/data/srd/2014/coverage.ts`), and the spells, rendered
 * as `COVERAGE.md`. Pure; no I/O. A class or race the catalog hasn't got yet is listed as to do, not as an error.
 */
import type { FeatureDefinition, SpellDefinition } from "../../src/engine";
import { ALL_GAPS, FEATURE_GAPS_2014, type Gap2014 } from "../../src/data/srd/2014/coverage";
import type { ReferenceClass, ReferenceRace, Srd2014Reference, Srd2014SpellIndex } from "../../src/data/srd/2014/reference-types";
import { srd2014SpellId } from "../../src/data/srd/2014/spell-library";
import { runningByLevel } from "../../src/data/srd/2024/spell-library";
import type { Catalog, ChoiceSpec, FeatureGrant } from "../../src/lib/character-builder/catalog";
import { spellRuns } from "../../src/lib/character-builder/spells";

export type Verdict2014 = "full" | "partial" | "manual" | "builder" | "info";

interface Covered {
  verdict: Verdict2014;
  note?: string;
}

/** A race trait's key in the audit: `srd_dwarf:Dwarven Resilience`. */
export const raceTraitKey = (raceKey: string, traitName: string) => `${raceKey}:${traitName}`;

function verdictOf(feature: FeatureDefinition): Covered {
  const note = /Not simulated: ([\s\S]*)$/.exec(feature.description ?? "")?.[1]?.trim();
  if (feature.informational) return { verdict: "info" };
  if (feature.automationSupport === "manual-only" || feature.automationSupport === "unsupported") return { verdict: "manual", ...(note ? { note } : {}) };
  if (feature.automationSupport === "partial") return { verdict: "partial", ...(note ? { note } : {}) };
  return { verdict: "full" };
}

/** Each reference key the catalog covers, and how: a grant's feature by its \`ref\` or source slug, a choice by its \`ref\`. */
export function catalogVerdicts(catalog: Catalog): Map<string, Covered> {
  const covered = new Map<string, Covered>();
  const grant = (entry: FeatureGrant) => {
    if (!entry.feature || typeof entry.feature === "string") return;
    const key = entry.ref ?? entry.feature.source?.slug;
    if (key && !covered.has(key)) covered.set(key, verdictOf(entry.feature));
  };
  const choices = (list: readonly ChoiceSpec[] | undefined) => {
    for (const choice of list ?? []) {
      const ref = (choice as { ref?: string }).ref;
      if (ref && !covered.has(ref)) covered.set(ref, { verdict: "builder" });
      if (choice.kind === "pick") for (const option of choice.options) { option.grants.forEach(grant); choices(option.choices); }
    }
  };
  for (const entry of [...catalog.classes, ...catalog.subclasses, ...catalog.species]) {
    for (const level of entry.levels) { level.grants.forEach(grant); choices(level.choices); }
  }
  for (const feat of catalog.feats) { feat.grants.forEach(grant); choices(feat.choices); }
  for (const background of catalog.backgrounds) ((background as { grants?: FeatureGrant[] }).grants ?? []).forEach(grant);
  return covered;
}

const edition2014 = (catalog: Catalog | undefined) => ({
  classes: (catalog?.classes ?? []).filter((entry) => entry.edition === "2014"),
  subclasses: (catalog?.subclasses ?? []).filter((entry) => entry.edition === "2014"),
  species: (catalog?.species ?? []).filter((entry) => entry.edition === "2014")
});

/** The reference classes and races the catalog has a 2014 entry for, by their source's Open5e key. */
function inCatalog(reference: Srd2014Reference, catalog: Catalog | undefined): { classes: Set<string>; races: Set<string> } {
  const { classes, subclasses, species } = edition2014(catalog);
  const keys = new Set([...classes, ...subclasses, ...species].map((entry) => entry.source.slug ?? ""));
  return {
    classes: new Set(reference.classes.filter((entry) => keys.has(entry.key)).map((entry) => entry.key)),
    races: new Set(reference.races.filter((entry) => keys.has(entry.key)).map((entry) => entry.key))
  };
}

/** Every feature of a class (or race) in the catalog has a verdict, and every one that doesn't run in full says why. */
export function checkCoverage2014(reference: Srd2014Reference, catalog: Catalog | undefined): string[] {
  const errors: string[] = [];
  const verdicts = catalog ? catalogVerdicts(catalog) : new Map<string, Covered>();
  const present = inCatalog(reference, catalog);
  const keys: string[] = [];
  for (const entry of reference.classes) {
    if (!present.classes.has(entry.key)) continue;
    for (const feature of entry.features) {
      keys.push(feature.key);
      if (!verdicts.has(feature.key)) errors.push(`${entry.name}: ${feature.name} (${feature.key}) has no grant or choice in the 2014 catalog`);
    }
  }
  for (const race of reference.races) {
    if (!present.races.has(race.key)) continue;
    for (const trait of race.traits) {
      const key = raceTraitKey(race.key, trait.name);
      keys.push(key);
      if (!verdicts.has(key)) errors.push(`${race.name}: ${trait.name} (${key}) has no grant in the 2014 catalog`);
    }
  }
  for (const key of keys) {
    const verdict = verdicts.get(key)?.verdict;
    if ((verdict === "partial" || verdict === "manual") && !FEATURE_GAPS_2014[key]?.length) errors.push(`${key} is ${verdict} but names no gap in FEATURE_GAPS_2014`);
  }
  const known = new Set([...reference.classes.flatMap((entry) => entry.features.map((feature) => feature.key)), ...reference.races.flatMap((race) => race.traits.map((trait) => raceTraitKey(race.key, trait.name)))]);
  for (const [key, gaps] of Object.entries(FEATURE_GAPS_2014)) {
    if (!known.has(key)) errors.push(`FEATURE_GAPS_2014 names ${key}, which isn't in the reference`);
    for (const gap of gaps) if (!(gap in ALL_GAPS)) errors.push(`${key} names an unknown gap ${gap}`);
  }
  return errors;
}

const ORDINAL = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const cell = (text: string | undefined) => (text ?? "").replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
const VERDICTS: Verdict2014[] = ["full", "partial", "manual", "builder", "info"];

export function renderCoverage2014(reference: Srd2014Reference, spells: Srd2014SpellIndex, library: readonly SpellDefinition[], catalog: Catalog | undefined): string {
  const verdicts = catalog ? catalogVerdicts(catalog) : new Map<string, Covered>();
  const present = inCatalog(reference, catalog);
  const lines: string[] = [];
  const line = (text = "") => lines.push(text);
  line("# 2014 rules coverage (SRD 5.1)");
  line();
  line("Generated by `npm run srd:2014` from the Open5e SRD 5.1 cache and the 2014 catalog. Don't edit by hand. See EDITIONS_PLAN.md.");
  line();
  line(reference.attribution);
  line();
  line("**full**: runs with what the engine has today. **partial**: some of it runs; the note says what doesn't. **manual**: on the actor as");
  line("text for the DM. **builder**: the character builder does it (scores, proficiencies, choices, pools). **info**: nothing to do in a fight.");
  line("Each partial or manual feature names its gaps (`src/data/srd/2014/coverage.ts`), which rank the engine work (plan Phase 10).");
  line();

  const classes = reference.classes.filter((entry) => !entry.subclassOf);
  const subclassOf = (entry: ReferenceClass) => reference.classes.find((sub) => sub.subclassOf === entry.key);
  const count = (features: ReferenceClass["features"]) => {
    const tally = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<Verdict2014, number>;
    for (const feature of features) { const verdict = verdicts.get(feature.key)?.verdict; if (verdict) tally[verdict] += 1; }
    return tally;
  };
  line("## Summary");
  line();
  line("| | Features | Full | Partial | Manual | Builder | Info |");
  line("|---|---|---|---|---|---|---|");
  for (const entry of classes) {
    const sub = subclassOf(entry);
    const features = [...entry.features, ...(sub?.features ?? [])];
    const label = `${entry.name}${sub ? ` (${sub.name})` : ""}`;
    if (!present.classes.has(entry.key)) { line(`| ${label} | ${features.length} | not in the 2014 catalog yet | | | | |`); continue; }
    const tally = count(features);
    line(`| ${label} | ${features.length} | ${VERDICTS.map((verdict) => tally[verdict]).join(" | ")} |`);
  }
  const races = reference.races.filter((race) => !race.subraceOf);
  const raceTraits = (race: ReferenceRace) => [race, ...reference.races.filter((sub) => sub.subraceOf === race.key)].flatMap((entry) => entry.traits.map((trait) => ({ race: entry, trait })));
  const raceDone = races.filter((race) => present.races.has(race.key));
  line(`| Race traits | ${races.reduce((sum, race) => sum + raceTraits(race).length, 0)} | ${raceDone.length} of ${races.length} races in the catalog | | | | |`);
  line();

  const gapCounts = new Map<Gap2014, string[]>();
  for (const [key, gaps] of Object.entries(FEATURE_GAPS_2014)) for (const gap of gaps) gapCounts.set(gap, [...(gapCounts.get(gap) ?? []), key]);
  line("## Gaps, most widespread first");
  line();
  if (!gapCounts.size) line("None recorded yet.");
  else {
    line("| Gap | What the engine lacks | Features |");
    line("|---|---|---|");
    for (const [gap, keys] of [...gapCounts].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) line(`| \`${gap}\` | ${cell(ALL_GAPS[gap])} | ${keys.length} |`);
  }
  line();

  for (const entry of classes) {
    for (const owner of [entry, subclassOf(entry)].filter((value): value is ReferenceClass => Boolean(value))) {
      line(owner.subclassOf ? `### ${owner.name} (${entry.name} subclass)` : `## ${owner.name}`);
      line();
      if (!present.classes.has(entry.key)) { line(`Not in the 2014 catalog yet: ${owner.features.length} features.`); line(); continue; }
      line("| Level | Feature | Verdict | Gaps | Note |");
      line("|---|---|---|---|---|");
      for (const feature of owner.features) {
        const covered = verdicts.get(feature.key);
        line(`| ${feature.levels.join(", ") || "—"} | ${cell(feature.name)} | ${covered?.verdict ?? "—"} | ${(FEATURE_GAPS_2014[feature.key] ?? []).join(", ")} | ${cell(covered?.note)} |`);
      }
      line();
    }
  }

  line("## Races");
  line();
  for (const race of races) {
    if (!present.races.has(race.key)) { line(`- ${race.name}: not in the 2014 catalog yet.`); continue; }
    line(`### ${race.name}`);
    line();
    line("| Trait | Verdict | Gaps | Note |");
    line("|---|---|---|---|");
    for (const { race: owner, trait } of raceTraits(race)) {
      const key = raceTraitKey(owner.key, trait.name);
      const covered = verdicts.get(key);
      line(`| ${cell(owner.subraceOf ? `${owner.name}: ${trait.name}` : trait.name)} | ${covered?.verdict ?? "—"} | ${(FEATURE_GAPS_2014[key] ?? []).join(", ")} | ${cell(covered?.note)} |`);
    }
    line();
  }
  line();

  const running = library.filter((spell) => spellRuns(spell)).length;
  line("## Spells");
  line();
  line(`${spells.spells.length} SRD 5.1 spells, ${running} of which run in the simulator (the library's authored spells). The rest are`);
  line("reference only: on an actor, a spell's SRD text for the DM.");
  line();
  const lists = [...new Set(spells.spells.flatMap((spell) => spell.classes))].sort();
  line(`| Class | Spells | Run | ${ORDINAL.join(" | ")} |`);
  line(`|---|---|---|${ORDINAL.map(() => "---").join("|")}|`);
  for (const list of lists) {
    const levels = runningByLevel(spells, library, list, srd2014SpellId);
    const total = levels.reduce((sum, level) => sum + level.total, 0);
    const run = levels.reduce((sum, level) => sum + level.running, 0);
    line(`| ${list[0]!.toUpperCase()}${list.slice(1)} | ${total} | ${run} | ${levels.map((level) => (level.total ? `${level.running}/${level.total}` : "—")).join(" | ")} |`);
  }
  line();
  return `${lines.join("\n")}\n`;
}
