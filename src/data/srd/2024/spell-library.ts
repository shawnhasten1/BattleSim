import type { ActionDefinition, SourceMetadata, SpellDefinition } from "@/engine";
import { spellRuns } from "@/lib/character-builder/spells";
import { SRD_SPELLS } from "../spells";
import { srd52Source } from "./reference";
import type { ReferenceSpell, Srd2024SpellIndex } from "./reference-types";
import { AUTHORED_2024, COPY_FIXES, SAME_AS_2014, type AuthoredSpell, type CopyFix } from "./spell-authoring";

/**
 * The 2024 spell library built from the spell index: a copy of the 2014 spell where nothing changed, the authored 2024
 * spell where something did, and the SRD 5.2 text as a reference-only spell for the rest (`spell-authoring.ts`). Pure,
 * so the generator can build the coverage audit from a fresh index; `spells.ts` builds the bundle from the committed one.
 */

/** A 2024 spell's library id: `srd:spell:<slug>-2024`, never the 2014 spell's. */
export const srd2024SpellId = (slug: string) => `srd:spell:${slug}-2024`;

/** Where a 2024 spell's simulation comes from. */
export type SpellBasis = "2014" | "authored" | "reference";

export function spellBasisOf(slug: string): SpellBasis {
  if (AUTHORED_2024[slug]) return "authored";
  if (SAME_AS_2014[slug]) return "2014";
  return "reference";
}

const slotCost = (level: number) => (level > 0 ? { resourceId: `slot-${level}`, amount: 1 } : undefined);

/** `150 feet` → 150; `Self`, `Touch`; a mile is 5280 ft; anything else (Sight, Special, Unlimited) reads as Self. */
function rangeOf(text: string): SpellDefinition["range"] {
  const lower = text.toLowerCase();
  if (lower === "touch") return "touch";
  const feet = /^(\d+) feet$/.exec(lower);
  if (feet) return Number(feet[1]);
  const miles = /^(\d+) miles?$/.exec(lower);
  if (miles) return Number(miles[1]) * 5280;
  return "self";
}

function castingTimeOf(text: string): SpellDefinition["castingTime"] {
  return text === "bonus" || text === "reaction" ? text : "action";
}

/** The SRD's text as a description: what the record's own fields can't say, the text, and its higher-level text. */
function referenceText(entry: ReferenceSpell): string {
  const facts = [
    castingTimeOf(entry.castingTime) !== entry.castingTime ? `Casting time: ${entry.castingTime}.` : "",
    entry.reactionTrigger ? `A reaction, ${entry.reactionTrigger}.` : "",
    typeof rangeOf(entry.range) === "number" || /^(self|touch)$/i.test(entry.range) ? "" : `Range: ${entry.range}.`,
    `Duration: ${entry.duration}.`
  ].filter(Boolean).join(" ");
  return [facts, entry.text, entry.higherLevel ? `Using a higher-level spell slot. ${entry.higherLevel}` : ""].filter(Boolean).join("\n\n");
}

function componentsOf(text: string): SpellDefinition["components"] {
  const material = /M \((.*)\)$/.exec(text)?.[1];
  return {
    ...(/\bV\b/.test(text) ? { v: true } : {}),
    ...(/\bS\b/.test(text) ? { s: true } : {}),
    // The source names some materials only as "M".
    ...(/\bM\b/.test(text) ? { m: material || "a material component" } : {})
  };
}

/**
 * A spell that isn't simulated: the SRD's facts and text, for the DM. A 2024 spell by default; the 2014 library builds its
 * own with its id and source (`2014/spells.ts`).
 */
export function referenceSpell(entry: ReferenceSpell, id = srd2024SpellId(entry.slug), source: SourceMetadata = srd52Source(entry.key)): SpellDefinition {
  return {
    id,
    name: entry.name,
    source,
    level: entry.level,
    school: entry.school,
    castingTime: castingTimeOf(entry.castingTime),
    ...(entry.ritual ? { ritual: true } : {}),
    range: rangeOf(entry.range),
    ...(entry.concentration ? { concentration: true } : {}),
    components: componentsOf(entry.components),
    description: referenceText(entry),
    automationSupport: "manual-only"
  };
}

/** A 2014 or authored spell under its 2024 identity: id, name, source, level, school, and its slot cost. */
function stamped(entry: ReferenceSpell, spell: SpellDefinition | AuthoredSpell): SpellDefinition {
  const id = srd2024SpellId(entry.slug);
  const cost = slotCost(entry.level);
  if (!spell.action) {
    // A smite: its hit's upgrade runs, nothing to stamp but the spell itself.
    const { id: _id, source: _source, ...rest } = spell as SpellDefinition;
    return { ...rest, id, name: entry.name, source: srd52Source(entry.key), level: entry.level, school: entry.school, ...(cost ? { resourceCost: spell.resourceCost ?? cost } : {}), components: componentsOf(entry.components) };
  }
  const action = spell.action as ActionDefinition;
  const actionCost = "resourceCost" in action && action.resourceCost ? action.resourceCost : cost;
  const placed = {
    ...action,
    id: `${id}:action`,
    name: entry.name,
    ...(actionCost ? { resourceCost: actionCost } : {}),
    // A reaction spell's activation points back at the spell (Shield).
    ...("featureId" in action ? { featureId: id } : {})
  } as ActionDefinition;
  const { id: _id, source: _source, ...rest } = spell as SpellDefinition;
  return {
    ...rest,
    id,
    name: entry.name,
    source: srd52Source(entry.key),
    level: entry.level,
    school: entry.school,
    ...((spell.resourceCost ?? cost) ? { resourceCost: spell.resourceCost ?? cost } : {}),
    components: componentsOf(entry.components),
    action: placed
  };
}

/** A copy with its 2024 fixes (`COPY_FIXES`): its range, where its area goes, when its lasting area strikes. */
function withFix(spell: SpellDefinition, fix: CopyFix | undefined): SpellDefinition {
  if (!fix || !spell.action) return spell;
  let action = spell.action as ActionDefinition;
  if (fix.range !== undefined) {
    action = { ...action, range: fix.range } as ActionDefinition;
    if (action.kind === "area-save" && action.targeting && (fix.centeredOnPoint || action.targeting.origin === "point")) {
      action = { ...action, targeting: { ...action.targeting, origin: "point", range: fix.range } };
    }
  }
  if (fix.zone && action.kind === "area-save" && action.zone) action = { ...action, zone: { ...action.zone, ...fix.zone } };
  return { ...spell, ...(fix.range !== undefined ? { range: fix.range } : {}), action };
}

/** Every spell in the index as a library record, in the index's order. */
export function buildSrd2024SpellLibrary(index: Srd2024SpellIndex): SpellDefinition[] {
  const byId = new Map(SRD_SPELLS.map((spell) => [spell.id, spell]));
  return index.spells.map((entry) => {
    const authored = AUTHORED_2024[entry.slug];
    if (authored) return stamped(entry, structuredClone(authored));
    const from = SAME_AS_2014[entry.slug];
    const copy = from ? byId.get(from) : undefined;
    if (copy?.action) return stamped(entry, withFix(structuredClone(copy) as SpellDefinition, COPY_FIXES[entry.slug]));
    return referenceSpell(entry);
  });
}

/** How many of a class list's spells run, by spell level (0–9). `idOf` is the library's id for a spell (2024 by default). */
export function runningByLevel(
  index: Pick<Srd2024SpellIndex, "spells">,
  library: readonly SpellDefinition[],
  classSlug: string,
  idOf: (slug: string) => string = srd2024SpellId
): Array<{ level: number; total: number; running: number }> {
  const byId = new Map(library.map((spell) => [spell.id, spell]));
  return Array.from({ length: 10 }, (_, level) => {
    const entries = index.spells.filter((entry) => entry.level === level && entry.classes.includes(classSlug));
    return { level, total: entries.length, running: entries.filter((entry) => spellRuns(byId.get(idOf(entry.slug)))).length };
  });
}
