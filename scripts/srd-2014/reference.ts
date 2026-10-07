/**
 * SRD 5.1 cache (Open5e V2, `npm run srd:2014:fetch`) → the reference data the 2014 catalog is authored against:
 * classes and subclasses with every feature's text and levels and every table column, races and subraces with their
 * ability increases, the Acolyte, Grappler, weapons and armor. Pure; no I/O. See EDITIONS_PLAN.md, Phase 4.
 *
 * What differs from SRD 5.2 (`../srd-2024/reference.ts`, whose helpers this shares):
 * - Open5e's keys start \`srd_\`, not \`srd-2014_\`.
 * - A class's saves, skills, weapons and armor are \`**Saving Throws:** …\` lines in its Proficiencies feature, not a
 *   Core Traits table, and its starting equipment is a feature of its own.
 * - A race's ability increases, size and speed are only in its traits' text ("Your Constitution score increases by 2").
 * - A background has a feature of its own and no ability increases or feat; the one feat has no category.
 * - Open5e's weapon filter lets the 2024 weapons through: only the document's own are kept.
 */
import type { Ability } from "../../src/engine";
import { SRD_ATTRIBUTION } from "../../src/data/srd/attribution";
import { COLUMN_OVERRIDES, FEATURE_OVERRIDES } from "../../src/data/srd/2014/overrides";
import type { Reference2014Background, Reference2014Feat, ReferenceRace, Srd2014Reference } from "../../src/data/srd/2014/reference-types";
import type { ReferenceClass, ReferenceColumn } from "../../src/data/srd/2024/reference-types";
import {
  ABILITY_NAMES,
  abilitiesIn,
  armorOf,
  byKey,
  columnOf,
  featureOf,
  ofDocument,
  skillsIn,
  str,
  weaponOf,
  type ReferenceOverrides
} from "../srd-2024/reference";

type Raw = Record<string, unknown>;

export interface Srd2014Cache {
  document: string;
  classes: Raw[];
  feats: Raw[];
  backgrounds: Raw[];
  species: Raw[];
  weapons: Raw[];
  armor: Raw[];
  spells?: Raw[];
  /** SRD 5.1's class spell lists by class (`bard`), each a list of spell names (`fetch-srd.ts`). */
  spellClassLists?: Record<string, string[]>;
}

/** The prefix SRD 5.1's Open5e keys start with. */
export const PREFIX_2014 = "srd_";

const OVERRIDES: ReferenceOverrides = { features: FEATURE_OVERRIDES, columns: COLUMN_OVERRIDES };

/** `**Saving Throws:** Strength, Constitution` lines, by their label in lower case ("saving throws"). */
function proficiencyLines(text: string): Map<string, string> {
  const lines = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const row = /^\*\*([^*]+?):?\*\*:?\s*(.+)$/.exec(line.trim());
    if (row) lines.set(row[1]!.toLowerCase().replace(/:$/, ""), row[2]!.trim());
  }
  return lines;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** "Choose two skills from Acrobatics, …" / "Choose any three". */
function skillChoice(text: string): { count: number; from: string[] | "any" } {
  const count = /choose\s+(?:any\s+)?(\d+|one|two|three|four|five|six)/i.exec(text);
  const n = count ? Number(count[1]) || NUMBER_WORDS[count[1]!.toLowerCase()] || 0 : 0;
  if (/choose\s+any/i.test(text)) return { count: n, from: "any" };
  return { count: n, from: skillsIn(text.replace(/^Choose[^:]*?(?:from|:)\s*/i, "")) };
}

function classOf(raw: Raw, warnings: string[]): ReferenceClass {
  const key = str(raw.key);
  const features = (raw.features as Raw[] | undefined) ?? [];
  const subclassOf = (raw.subclass_of as { key?: string } | null | undefined)?.key ?? null;
  const lines = proficiencyLines(str(features.find((feature) => feature.feature_type === "PROFICIENCIES")?.desc));
  const saves = abilitiesIn(lines.get("saving throws") ?? "");
  const fieldSaves = ((raw.saving_throws as Array<{ name: string }> | undefined) ?? []).map((save) => ABILITY_NAMES[save.name.toLowerCase()]).filter(Boolean) as Ability[];
  if (!subclassOf && saves.slice().sort().join() !== fieldSaves.slice().sort().join()) {
    warnings.push(`${key}: saving_throws says ${fieldSaves.join("+")}, the Proficiencies feature says ${saves.join("+")} (using the feature)`);
  }

  const columns: ReferenceColumn[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    if (str(feature.feature_type) === "PROFICIENCY_BONUS") continue;
    const column = columnOf(feature, key, warnings, OVERRIDES);
    if (!column) continue;
    if (seen.has(column.id)) {
      warnings.push(`${key}: two columns named ${column.id}`);
      column.id = `${column.id}-2`;
    }
    seen.add(column.id);
    columns.push(column);
  }
  columns.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  const kept = features
    .filter((feature) => ["CLASS_LEVEL_FEATURE", "CLASS_FEATURE_OPTION_LIST"].includes(str(feature.feature_type)))
    .filter((feature) => !(((feature.data_for_class_table as unknown[] | undefined) ?? []).length && str(feature.desc).startsWith("[Column data]")))
    .map((feature) => featureOf(feature, OVERRIDES))
    .sort((a, b) => (a.levels[0] ?? 99) - (b.levels[0] ?? 99) || a.name.localeCompare(b.name));

  const hitDie = Number(/(\d+)/.exec(str(raw.hit_dice))?.[1] ?? 0) || undefined;
  const equipment = str(features.find((feature) => feature.feature_type === "STARTING_EQUIPMENT")?.desc);
  return {
    key,
    name: str(raw.name),
    subclassOf,
    ...(hitDie && !subclassOf ? { hitDie } : {}),
    casterType: str(raw.caster_type) || null,
    ...(subclassOf ? {} : {
      // SRD 5.1 doesn't name a class's primary ability: the catalog says it, from the multiclassing prerequisites.
      primaryAbilities: [],
      saves,
      skills: skillChoice(lines.get("skills") ?? ""),
      weapons: lines.get("weapons") ?? "",
      armor: lines.get("armor") ?? "",
      tools: lines.get("tools") ?? "",
      equipment: equipment.replace(/\r\n/g, "\n")
    }),
    features: kept,
    columns
  };
}

const ABILITY_WORDS = "strength|dexterity|constitution|intelligence|wisdom|charisma";

/**
 * A race's "Ability Score Increase": "Your Constitution score increases by 2.", "…, and your Charisma score increases by
 * 1.", "Your ability scores each increase by 1." (Human), "…, and two other ability scores of your choice increase by 1."
 * (Half-Elf).
 */
export function raceIncreases(text: string): Pick<ReferenceRace, "abilities" | "abilityChoice"> {
  const abilities: Partial<Record<Ability, number>> = {};
  const each = /ability scores each increase by (\d+)/i.exec(text);
  if (each) {
    for (const ability of Object.values(ABILITY_NAMES)) abilities[ability] = Number(each[1]);
    return { abilities };
  }
  for (const match of text.matchAll(new RegExp(`your (${ABILITY_WORDS}) score increases by (\\d+)`, "gi"))) {
    abilities[ABILITY_NAMES[match[1]!.toLowerCase()]!] = Number(match[2]);
  }
  const choice = /(one|two|three) other ability scores? of your choice increases? by (\d+)/i.exec(text);
  if (!choice) return { abilities };
  return {
    abilities,
    abilityChoice: { count: NUMBER_WORDS[choice[1]!.toLowerCase()]!, amount: Number(choice[2]), exclude: Object.keys(abilities) as Ability[] }
  };
}

/** What a race's traits list without saying anything the builder needs as a trait. */
const NOT_TRAITS = new Set(["Ability Score Increase", "Age", "Alignment", "Size", "Speed", "Languages", "Extra Language"]);

function raceOf(raw: Raw, warnings: string[]): ReferenceRace {
  const key = str(raw.key);
  const traits = (raw.traits as Array<{ name: string; desc: string }> | undefined) ?? [];
  const trait = (name: string) => traits.find((entry) => entry.name === name)?.desc ?? "";
  const parent = raw.subspecies_of as { key?: string } | string | null | undefined;
  const subraceOf = (typeof parent === "string" ? parent : parent?.key) ?? null;
  const increases = raceIncreases(trait("Ability Score Increase"));
  if (!Object.keys(increases.abilities).length) warnings.push(`${key}: no ability increase read from "${trait("Ability Score Increase")}"`);
  const size = /your size is (\w+)/i.exec(trait("Size"))?.[1] ?? "";
  const speed = /walking speed is (\d+)/i.exec(trait("Speed"))?.[1];
  if (!subraceOf && (!size || !speed)) warnings.push(`${key}: size "${size}" or speed "${speed}" not read`);
  return {
    key,
    name: str(raw.name),
    subraceOf,
    size: size ? size[0]!.toUpperCase() + size.slice(1).toLowerCase() : "",
    speed: speed ? Number(speed) : null,
    ...increases,
    traits: traits.filter((entry) => !NOT_TRAITS.has(entry.name)).map((entry) => ({ name: entry.name, text: entry.desc.trim().replace(/\r\n/g, "\n") }))
  };
}

function backgroundOf(raw: Raw): Reference2014Background {
  const benefits = (raw.benefits as Array<{ name: string; desc: string; type: string }> | undefined) ?? [];
  const feature = benefits.find((benefit) => benefit.type === "feature");
  return {
    key: str(raw.key),
    name: str(raw.name),
    skills: skillsIn(benefits.find((benefit) => benefit.type === "skill_proficiency")?.desc ?? ""),
    feature: { name: feature?.name ?? "", text: (feature?.desc ?? "").trim().replace(/\r\n/g, "\n") },
    equipment: benefits.find((benefit) => benefit.type === "equipment")?.desc ?? ""
  };
}

function featOf(raw: Raw): Reference2014Feat {
  const benefits = ((raw.benefits as Array<{ desc: string }> | undefined) ?? []).map((benefit) => benefit.desc);
  return { key: str(raw.key), name: str(raw.name), prerequisite: str(raw.prerequisite), text: str(raw.desc).trim(), benefits };
}

export interface Srd2014ReferenceBuild {
  reference: Srd2014Reference;
  warnings: string[];
}

export function buildSrd2014Reference(cache: Srd2014Cache): Srd2014ReferenceBuild {
  const warnings: string[] = [];
  const inDocument = ofDocument(cache.document);
  const classes = cache.classes.filter(inDocument).map((raw) => classOf(raw, warnings)).sort(byKey);
  const used = new Set<string>();
  for (const entry of classes) {
    for (const feature of entry.features) if (FEATURE_OVERRIDES[feature.key]) used.add(feature.key);
    for (const column of entry.columns) if (COLUMN_OVERRIDES[column.key]) used.add(column.key);
  }
  for (const key of [...Object.keys(FEATURE_OVERRIDES), ...Object.keys(COLUMN_OVERRIDES)]) {
    if (!used.has(key)) warnings.push(`override ${key} matches nothing in the source`);
  }
  return {
    reference: {
      attribution: SRD_ATTRIBUTION,
      document: cache.document,
      classes,
      feats: cache.feats.filter(inDocument).map(featOf).sort(byKey),
      backgrounds: cache.backgrounds.filter(inDocument).map(backgroundOf).sort(byKey),
      races: cache.species.filter(inDocument).map((raw) => raceOf(raw, warnings)).sort(byKey),
      weapons: cache.weapons.filter(inDocument).map(weaponOf).sort(byKey),
      armor: cache.armor.filter(inDocument).map(armorOf).sort(byKey)
    },
    warnings
  };
}
