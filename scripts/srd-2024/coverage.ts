/**
 * The coverage audit (`src/data/srd/2024/coverage.ts`) checked against the SRD 5.2 reference data, and rendered as
 * `COVERAGE.md`, with the spells (`spell-authoring.ts`, against the spell index). Pure; no I/O.
 */
import type { SpellDefinition } from "../../src/engine";
import { SRD_SPELLS } from "../../src/data/srd/spells";
import { buildSrd2024SpellLibrary, spellBasisOf, srd2024SpellId } from "../../src/data/srd/2024/spell-library";
import { AUTHORED_2024, COPY_FIXES, NOT_COPIED, SAME_AS_2014, SPELL_GAPS } from "../../src/data/srd/2024/spell-authoring";
import { spellRuns } from "../../src/lib/character-builder/spells";
import {
  CLASS_COVERAGE,
  FEAT_COVERAGE,
  GAPS,
  SPECIES_COVERAGE,
  type CoverageEntry,
  type GapCode,
  type Verdict
} from "../../src/data/srd/2024/coverage";
import type { ReferenceClass, Srd2024Reference, Srd2024SpellIndex } from "../../src/data/srd/2024/reference-types";

const PREFIX = "srd-2024_";
const VERDICTS: Verdict[] = ["full", "partial", "manual", "builder", "info"];

const bare = (key: string) => (key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key);
const traitSlug = (name: string) => name.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const speciesTraitKey = (speciesKey: string, traitName: string) => `${bare(speciesKey)}:${traitSlug(traitName)}`;

/** Every feature, feat and trait with a verdict, every verdict for something that exists. */
export function checkCoverage(reference: Srd2024Reference): string[] {
  const errors: string[] = [];
  const compare = (what: string, keys: string[], audit: Record<string, CoverageEntry>) => {
    const known = new Set(keys);
    for (const key of keys) if (!audit[key]) errors.push(`${what} ${key} has no verdict in coverage.ts`);
    for (const key of Object.keys(audit)) if (!known.has(key)) errors.push(`coverage.ts has a verdict for ${what} ${key}, which isn't in the reference`);
    for (const [key, entry] of Object.entries(audit)) {
      if ((entry.verdict === "partial" || entry.verdict === "manual") && !entry.gaps?.length) errors.push(`${what} ${key} is ${entry.verdict} but names no gap`);
      for (const gap of entry.gaps ?? []) if (!(gap in GAPS)) errors.push(`${what} ${key} names an unknown gap ${gap}`);
    }
  };
  compare("feature", reference.classes.flatMap((entry) => entry.features.map((feature) => bare(feature.key))), CLASS_COVERAGE);
  compare("feat", reference.feats.map((feat) => bare(feat.key)), FEAT_COVERAGE);
  compare("trait", reference.species.flatMap((species) => species.traits.map((trait) => speciesTraitKey(species.key, trait.name))), SPECIES_COVERAGE);
  return errors;
}

/** Every authored or copied spell is in the index, and every 2014 library spell is copied or says why not. */
export function checkSpellCoverage(index: Srd2024SpellIndex): string[] {
  const errors: string[] = [];
  const slugs = new Set(index.spells.map((spell) => spell.slug));
  const library = new Map(SRD_SPELLS.map((spell) => [spell.id, spell]));
  for (const [slug, from] of Object.entries(SAME_AS_2014)) {
    if (!slugs.has(slug)) errors.push(`SAME_AS_2014 names ${slug}, which isn't an SRD 5.2 spell`);
    if (!library.get(from)?.action) errors.push(`SAME_AS_2014 copies ${from}, which isn't a 2014 library spell with an action`);
    if (AUTHORED_2024[slug]) errors.push(`${slug} is both copied and authored`);
  }
  for (const slug of Object.keys(AUTHORED_2024)) if (!slugs.has(slug)) errors.push(`AUTHORED_2024 has ${slug}, which isn't an SRD 5.2 spell`);
  for (const slug of Object.keys(COPY_FIXES)) if (!SAME_AS_2014[slug]) errors.push(`COPY_FIXES names ${slug}, which isn't a copied spell`);
  for (const [slug, gap] of Object.entries(SPELL_GAPS)) {
    if (!slugs.has(slug)) errors.push(`SPELL_GAPS names ${slug}, which isn't an SRD 5.2 spell`);
    else if (spellBasisOf(slug) !== "reference") errors.push(`SPELL_GAPS names ${slug}, which runs`);
    for (const code of gap.gaps) if (!(code in GAPS)) errors.push(`spell ${slug} names an unknown gap ${code}`);
  }
  const copied = new Set(Object.values(SAME_AS_2014));
  for (const id of library.keys()) {
    if (copied.has(id) && NOT_COPIED[id]) errors.push(`${id} is copied, and also listed as not copied`);
    if (!copied.has(id) && !NOT_COPIED[id]) errors.push(`the 2014 library's ${id} is neither copied to 2024 (SAME_AS_2014) nor in NOT_COPIED`);
  }
  for (const id of Object.keys(NOT_COPIED)) if (!library.has(id)) errors.push(`NOT_COPIED names ${id}, which isn't a 2014 library spell`);
  return errors;
}

/** A spell's verdict: it runs, runs in part (its description says what doesn't), or is reference only. */
function spellVerdict(spell: SpellDefinition | undefined): Verdict {
  if (!spell?.action || spell.automationSupport === "manual-only") return "manual";
  if (!spellRuns(spell)) return "partial";
  return spell.automationSupport === "full" ? "full" : "partial";
}

const ORDINALS = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** Whether a 2024 spell was re-authored because its 2014 version changed (rather than written new). */
const changedSince2014 = (slug: string) => Object.entries(NOT_COPIED).some(([id, why]) => id === `srd:spell:${slug}` && why.startsWith("re-authored"));

function renderSpells(index: Srd2024SpellIndex, line: (text?: string) => void) {
  const library = buildSrd2024SpellLibrary(index);
  const byId = new Map(library.map((spell) => [spell.id, spell]));
  const spellOf = (slug: string) => byId.get(srd2024SpellId(slug));
  const runs = (slug: string) => spellRuns(spellOf(slug));
  const copies = index.spells.filter((entry) => spellBasisOf(entry.slug) === "2014");
  const authored = index.spells.filter((entry) => spellBasisOf(entry.slug) === "authored");
  const changed = authored.filter((entry) => changedSince2014(entry.slug));
  line("## Spells");
  line();
  line(`${index.spells.length} SRD 5.2 spells, ${index.spells.filter((entry) => runs(entry.slug)).length} of which run in the simulator. ${copies.length} are copied from the 2014 library`);
  line(`(their rules didn't change in a way the simulator models) and ${authored.length} are written for 2024: ${changed.length} that changed,`);
  line(`${authored.length - changed.length} new. The rest are reference only: on an actor, a spell's SRD text for the DM. The builder offers every`);
  line("spell on a class's list and suggests the ones that run first.");
  line();
  line(`| Class | Spells | Run | ${ORDINALS.join(" | ")} |`);
  line(`|---|---|---|${ORDINALS.map(() => "---").join("|")}|`);
  const classes = [...new Set(index.spells.flatMap((entry) => entry.classes))].sort();
  for (const slug of classes) {
    const own = index.spells.filter((entry) => entry.classes.includes(slug));
    const cells = ORDINALS.map((_, level) => {
      const at = own.filter((entry) => entry.level === level);
      return at.length ? `${at.filter((entry) => runs(entry.slug)).length}/${at.length}` : "—";
    });
    const name = slug.charAt(0).toUpperCase() + slug.slice(1);
    line(`| ${name} | ${own.length} | ${own.filter((entry) => runs(entry.slug)).length} | ${cells.join(" | ")} |`);
  }
  line();
  line("### Spells with a simulation");
  line();
  line("| Spell | Level | Classes | From | Verdict | Note |");
  line("|---|---|---|---|---|---|");
  for (const entry of [...index.spells].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))) {
    const spell = spellOf(entry.slug);
    if (!spell?.action) continue;
    const from = spellBasisOf(entry.slug) === "2014" ? "2014 copy" : changedSince2014(entry.slug) ? "changed in 2024" : "new";
    const verdict = spellVerdict(spell);
    const noted = "riders" in spell.action && spell.action.riders?.some((rider) => rider.kind === "note");
    const fixed = COPY_FIXES[entry.slug] ? `Changed from the 2014 copy: ${COPY_FIXES[entry.slug]!.why}.` : "";
    const note = [noted ? "Its effect is a note for the DM, so the AI doesn't cast it." : verdict === "partial" ? spell.description ?? "" : "", fixed].filter(Boolean).join(" ");
    line(`| ${cell(entry.name)} | ${ORDINALS[entry.level]} | ${entry.classes.join(", ")} | ${from} | ${verdict} | ${cell(note)} |`);
  }
  line();
  line("### Reference only, waiting on the engine");
  line();
  line("| Spell | Level | Classes | Gaps | Note |");
  line("|---|---|---|---|---|");
  for (const [slug, gap] of Object.entries(SPELL_GAPS)) {
    const entry = index.spells.find((candidate) => candidate.slug === slug);
    if (!entry) continue;
    line(`| ${cell(entry.name)} | ${ORDINALS[entry.level]} | ${entry.classes.join(", ")} | ${gapList(gap.gaps)} | ${cell(gap.note)} |`);
  }
  line();
  line("### 2014 library spells without a 2024 copy");
  line();
  for (const [id, why] of Object.entries(NOT_COPIED)) line(`- ${SRD_SPELLS.find((spell) => spell.id === id)?.name ?? id}: ${why}.`);
  line();
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const gapList = (gaps: GapCode[] | undefined) => (gaps?.length ? gaps.map((gap) => `\`${gap}\``).join(", ") : "");

function counts(entries: CoverageEntry[]): Record<Verdict, number> {
  const tally = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<Verdict, number>;
  for (const entry of entries) tally[entry.verdict] += 1;
  return tally;
}

interface GapUse {
  classes: Set<string>;
  features: string[];
  firstLevel: number;
}

export function renderCoverage(reference: Srd2024Reference, spells: Srd2024SpellIndex): string {
  const classes = reference.classes.filter((entry) => !entry.subclassOf);
  const subclassesOf = (key: string) => reference.classes.filter((entry) => entry.subclassOf === key);
  const lines: string[] = [];
  const line = (text = "") => lines.push(text);

  line("# 2024 rules coverage (SRD 5.2)");
  line();
  line("Generated by `npm run srd:2024` from `coverage.ts` and the SRD 5.2 reference data (`generated/reference.json`). Don't");
  line("edit it by hand: change a verdict in `coverage.ts` and regenerate. See PC_BUILDER_PLAN.md, Phase 0.");
  line();
  line("What the character builder can do with each 2024 class and subclass feature, feat and species trait. The builder");
  line("adds every feature whatever its verdict: one the engine can't run goes on the actor as reference text, tagged with");
  line("its gaps, never dropped and never approximated without saying so.");
  line();
  line("- **full**: runs with what the engine has today. **partial**: some of it runs; the note says what doesn't.");
  line("- **manual**: doesn't run; it's on the actor for the DM. **builder**: the builder does it (scores, proficiencies,");
  line("  skills, speed, hit points, spells, choices, pools). **info**: nothing to do in a fight.");
  line();

  // Summary
  line("## Summary");
  line();
  line("| | Features | Full | Partial | Manual | Builder | Info |");
  line("|---|---|---|---|---|---|---|");
  const row = (label: string, entries: CoverageEntry[]) => {
    const tally = counts(entries);
    line(`| ${label} | ${entries.length} | ${tally.full} | ${tally.partial} | ${tally.manual} | ${tally.builder} | ${tally.info} |`);
  };
  const classEntries = (entry: ReferenceClass) =>
    [entry, ...subclassesOf(entry.key)].flatMap((owner) => owner.features.map((feature) => CLASS_COVERAGE[bare(feature.key)]!).filter(Boolean));
  for (const entry of classes) row(`${entry.name} (${subclassesOf(entry.key).map((sub) => sub.name).join(", ")})`, classEntries(entry));
  row("Feats", Object.values(FEAT_COVERAGE));
  row("Species traits", Object.values(SPECIES_COVERAGE));
  line();

  // Gaps
  const uses = new Map<GapCode, GapUse>();
  const note = (gaps: GapCode[] | undefined, owner: string, feature: string, level: number) => {
    for (const gap of gaps ?? []) {
      const use = uses.get(gap) ?? { classes: new Set<string>(), features: [], firstLevel: 99 };
      use.classes.add(owner);
      use.features.push(feature);
      use.firstLevel = Math.min(use.firstLevel, level);
      uses.set(gap, use);
    }
  };
  for (const entry of classes) {
    for (const owner of [entry, ...subclassesOf(entry.key)]) {
      for (const feature of owner.features) {
        note(CLASS_COVERAGE[bare(feature.key)]?.gaps, entry.name, `${feature.name} (${owner.name})`, feature.levels[0] ?? 99);
      }
    }
  }
  for (const feat of reference.feats) note(FEAT_COVERAGE[bare(feat.key)]?.gaps, "Feats", `${feat.name} (feat)`, 1);
  for (const species of reference.species) {
    for (const trait of species.traits) note(SPECIES_COVERAGE[speciesTraitKey(species.key, trait.name)]?.gaps, "Species", `${trait.name} (${species.name})`, 1);
  }
  // A spell's "first level" is the class level it can first be cast at by a full caster.
  for (const [slug, gap] of Object.entries(SPELL_GAPS)) {
    const entry = spells.spells.find((candidate) => candidate.slug === slug);
    if (entry) note(gap.gaps, "Spells", `${entry.name} (spell)`, entry.level === 0 ? 1 : entry.level * 2 - 1);
  }
  line("## Gaps, most widespread first");
  line();
  line("Ranked by how many classes (and feats, species) need it, then by how early it's met. One engine change per gap");
  line("closes every feature it lists (plan Phase 7; weapon mastery is Phase 3).");
  line();
  line("| Gap | What's missing | Where | First level | Features |");
  line("|---|---|---|---|---|");
  const ranked = [...uses.entries()].sort(([codeA, a], [codeB, b]) =>
    b.classes.size - a.classes.size || a.firstLevel - b.firstLevel || b.features.length - a.features.length || codeA.localeCompare(codeB));
  for (const [code, use] of ranked) {
    line(`| \`${code}\` | ${cell(GAPS[code])} | ${[...use.classes].join(", ")} | ${use.firstLevel === 99 ? "—" : use.firstLevel} | ${cell(use.features.join("; "))} |`);
  }
  const unused = (Object.keys(GAPS) as GapCode[]).filter((code) => !uses.has(code));
  if (unused.length) {
    line();
    line(`Not used by any verdict: ${unused.map((code) => `\`${code}\``).join(", ")}.`);
  }
  line();

  // Per class
  for (const entry of classes) {
    for (const owner of [entry, ...subclassesOf(entry.key)]) {
      line(owner.subclassOf ? `### ${owner.name} (${entry.name} subclass)` : `## ${owner.name}`);
      line();
      line("| Level | Feature | Verdict | Gaps | Note |");
      line("|---|---|---|---|---|");
      for (const feature of owner.features) {
        const audit = CLASS_COVERAGE[bare(feature.key)];
        if (!audit) continue;
        const level = feature.levels.length ? feature.levels.join(", ") : "—";
        line(`| ${level} | ${cell(feature.name)} | ${audit.verdict} | ${gapList(audit.gaps)} | ${cell(audit.note ?? "")} |`);
      }
      line();
    }
  }

  line("## Feats");
  line();
  line("| Feat | Category | Verdict | Gaps | Note |");
  line("|---|---|---|---|---|");
  for (const feat of reference.feats) {
    const audit = FEAT_COVERAGE[bare(feat.key)];
    if (!audit) continue;
    line(`| ${cell(feat.name)} | ${feat.category} | ${audit.verdict} | ${gapList(audit.gaps)} | ${cell(audit.note ?? "")} |`);
  }
  line();

  line("## Species");
  line();
  line("| Species | Trait | Verdict | Gaps | Note |");
  line("|---|---|---|---|---|");
  for (const species of reference.species) {
    for (const trait of species.traits) {
      const audit = SPECIES_COVERAGE[speciesTraitKey(species.key, trait.name)];
      if (!audit) continue;
      line(`| ${species.name} | ${cell(trait.name)} | ${audit.verdict} | ${gapList(audit.gaps)} | ${cell(audit.note ?? "")} |`);
    }
  }
  line();

  renderSpells(spells, line);

  line("## Backgrounds");
  line();
  line("All built by the builder: three abilities for +2 and +1 (or +1 to each), two skills and an origin feat. Tools and");
  line("equipment other than weapons and armor are outside a fight.");
  line();
  line("| Background | Abilities | Skills | Feat |");
  line("|---|---|---|---|");
  for (const background of reference.backgrounds) {
    line(`| ${background.name} | ${background.abilities.join(", ")} | ${background.skills.join(", ")} | ${cell(background.feat)} |`);
  }
  line();
  line("## Attribution");
  line();
  line(reference.attribution);
  return `${lines.join("\n")}\n`;
}
