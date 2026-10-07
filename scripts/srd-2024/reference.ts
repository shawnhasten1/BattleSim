/**
 * SRD 5.2 cache (Open5e V2, `npm run srd:2024:fetch`) → the reference data the character builder is authored against:
 * classes and subclasses with every feature's text and levels and every table column, feats, backgrounds, species,
 * weapons with their mastery, and armor. Pure; no I/O. See PC_BUILDER_PLAN.md, Phase 0.
 *
 * The source is semi-structured and has errors. Rules this follows:
 * - Saving throws, skills, weapons and armor come from each class's Core Traits table: its `saving_throws` field is
 *   wrong for the Fighter and the Monk (checked against the PDF).
 * - Table values become numbers where they're numbers ("+2" → 2, "+10 ft." → 10, "3rd" → 3) and dice stay text.
 * - A level listed twice keeps its last value; a feature's levels are deduped and sorted.
 * - Fixes that need the PDF are overrides with a reason (`src/data/srd/2024/overrides.ts`).
 */
import type { Ability } from "../../src/engine";
import { SRD_52_ATTRIBUTION } from "../../src/data/srd/attribution";
import { COLUMN_OVERRIDES, FEATURE_OVERRIDES, type ColumnOverride, type FeatureOverride } from "../../src/data/srd/2024/overrides";
import type {
  ReferenceArmor,
  ReferenceBackground,
  ReferenceClass,
  ReferenceColumn,
  ReferenceFeat,
  ReferenceFeature,
  ReferenceSpecies,
  ReferenceWeapon,
  Srd2024Reference
} from "../../src/data/srd/2024/reference-types";

type Raw = Record<string, unknown>;

/** An SRD's fixes to its features and table columns, by Open5e key: the 2024 ones here, the 2014 ones in `srd-2014`. */
export interface ReferenceOverrides {
  features: Record<string, FeatureOverride>;
  columns: Record<string, ColumnOverride>;
}

const OVERRIDES_2024: ReferenceOverrides = { features: FEATURE_OVERRIDES, columns: COLUMN_OVERRIDES };

export interface Srd2024Cache {
  document: string;
  classes: Raw[];
  feats: Raw[];
  backgrounds: Raw[];
  species: Raw[];
  weapons: Raw[];
  armor: Raw[];
  spells?: Raw[];
}

export const ABILITY_NAMES: Record<string, Ability> = {
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"
};

/** The 18 skills by the ids the sheet uses (`sleight_of_hand`). */
const SKILL_IDS = [
  "acrobatics", "animal_handling", "arcana", "athletics", "deception", "history", "insight", "intimidation",
  "investigation", "medicine", "nature", "perception", "performance", "persuasion", "religion", "sleight_of_hand",
  "stealth", "survival"
];

export const str = (value: unknown): string => (typeof value === "string" ? value : "");
export const slug = (text: string) => text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function abilitiesIn(text: string): Ability[] {
  const found: Ability[] = [];
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    const ability = ABILITY_NAMES[word];
    if (ability && !found.includes(ability)) found.push(ability);
  }
  return found;
}

/** A skill's id from its printed name, ignoring the stray spaces the source has ("In sight", "Na ture"). */
function skillId(name: string): string | undefined {
  const squashed = name.toLowerCase().replace(/[^a-z]/g, "");
  return SKILL_IDS.find((id) => id.replace(/_/g, "") === squashed);
}

export function skillsIn(text: string): string[] {
  return text.split(/,|\bor\b|\band\b/).map((part) => skillId(part.replace(/^.*:/, ""))).filter((id): id is string => Boolean(id));
}

/** `|Label|Value|` rows of a markdown table. */
function tableRows(markdown: string): Map<string, string> {
  const rows = new Map<string, string>();
  for (const line of markdown.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length >= 4 && cells[1] && cells[2] && !/^-+$/.test(cells[1])) rows.set(cells[1], cells[2]);
  }
  return rows;
}

/** A table value as the builder reads it: a number where it is one, dice and other text as text. */
export function columnValue(raw: string): string | number {
  const text = raw.trim();
  const dice = /^(\d*)[dD](\d+)$/.exec(text);
  if (dice) return `${dice[1] ?? ""}d${dice[2]}`;
  const number = /^\+?(-?\d+)(?:\s*ft\.?|st|nd|rd|th)?$/.exec(text);
  if (number) return Number(number[1]);
  return text;
}

export function columnOf(feature: Raw, ownerKey: string, warnings: string[], overrides: ReferenceOverrides = OVERRIDES_2024): ReferenceColumn | undefined {
  const data = (feature.data_for_class_table as Array<{ level: number; column_value: string }> | undefined) ?? [];
  if (!data.length) return undefined;
  const key = str(feature.key);
  const override = overrides.columns[key];
  const type = str(feature.feature_type);
  let label = override?.label ?? overrides.features[key]?.name ?? str(feature.name);
  let id = override?.id;
  if (!id) {
    if (type === "SPELL_SLOTS") {
      const level = columnValue(label);
      id = `slots-${level}`;
      label = `${label}-level slots`;
    } else {
      id = slug(label);
    }
  }
  const values: Array<string | number | null> = Array(20).fill(null);
  for (const entry of data) {
    if (entry.level < 1 || entry.level > 20) {
      warnings.push(`${ownerKey}: column ${id} has level ${entry.level}`);
      continue;
    }
    values[entry.level - 1] = columnValue(entry.column_value);
  }
  return { key, id, label, values };
}

export function featureOf(feature: Raw, overrides: ReferenceOverrides = OVERRIDES_2024): ReferenceFeature {
  const key = str(feature.key);
  const override = overrides.features[key];
  const type = str(feature.feature_type);
  const name = override?.name ?? str(feature.name);
  const levels = override?.levels
    ?? [...new Set(((feature.gained_at as Array<{ level: number }> | undefined) ?? []).map((gained) => gained.level))].sort((a, b) => a - b);
  const kind: ReferenceFeature["kind"] = type === "CLASS_FEATURE_OPTION_LIST"
    ? "options"
    : / Spell List$/.test(name) ? "spell-list" : "feature";
  // A class's spell list is better read from each spell's own class list (Phase 5a); its tables here are incomplete.
  let text = kind === "spell-list" ? "" : override?.text ?? str(feature.desc);
  for (const [from, to] of override?.replace ?? []) {
    if (text.split(from).length !== 2) throw new Error(`override ${key}: "${from.trim()}" isn't in its text exactly once`);
    text = text.replace(from, to);
  }
  return { key, name, levels, kind, text };
}

function classOf(raw: Raw, warnings: string[]): ReferenceClass {
  const key = str(raw.key);
  const features = (raw.features as Raw[] | undefined) ?? [];
  const core = features.find((feature) => feature.feature_type === "CORE_TRAITS_TABLE");
  const rows = core ? tableRows(str(core.desc)) : new Map<string, string>();
  const subclassOf = (raw.subclass_of as { key?: string } | null | undefined)?.key ?? null;

  const savesText = rows.get("Saving Throw Proficiencies") ?? "";
  const saves = abilitiesIn(savesText);
  const fieldSaves = ((raw.saving_throws as Array<{ name: string }> | undefined) ?? []).map((save) => ABILITY_NAMES[save.name.toLowerCase()]).filter(Boolean) as Ability[];
  if (!subclassOf && saves.length && fieldSaves.length && saves.slice().sort().join() !== fieldSaves.slice().sort().join()) {
    warnings.push(`${key}: saving_throws says ${fieldSaves.join("+")}, the Core Traits table says ${saves.join("+")} (using the table)`);
  }
  const skillsText = rows.get("Skill Proficiencies") ?? "";
  const skillCount = Number(/Choose (?:any )?(\d+)/i.exec(skillsText)?.[1] ?? 0);
  const anySkill = /any \d+ skills?/i.test(skillsText);

  const columns: ReferenceColumn[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    const type = str(feature.feature_type);
    if (type === "PROFICIENCY_BONUS") continue;
    const column = columnOf(feature, key, warnings);
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
    // A feature that's only a table column ("Cantrips Known" for the druid's Wild Shape uses) is kept as the column.
    .filter((feature) => !(((feature.data_for_class_table as unknown[] | undefined) ?? []).length && str(feature.desc).startsWith("[Column data]")))
    .map((feature) => featureOf(feature))
    .sort((a, b) => (a.levels[0] ?? 99) - (b.levels[0] ?? 99) || a.name.localeCompare(b.name));

  const hitDie = Number(/(\d+)/.exec(str(raw.hit_dice))?.[1] ?? 0) || undefined;
  return {
    key,
    name: str(raw.name),
    subclassOf,
    ...(hitDie && !subclassOf ? { hitDie } : {}),
    casterType: str(raw.caster_type) || null,
    ...(subclassOf ? {} : {
      primaryAbilities: abilitiesIn(rows.get("Primary Ability") ?? ""),
      saves,
      skills: { count: skillCount, from: anySkill ? "any" as const : skillsIn(skillsText.replace(/^Choose[^:]*:/i, "")) },
      weapons: rows.get("Weapon Proficiencies") ?? "",
      armor: rows.get("Armor Training") ?? "",
      tools: rows.get("Tool Proficiencies") ?? "",
      equipment: rows.get("Starting Equipment") ?? ""
    }),
    features: kept,
    columns
  };
}

function featOf(raw: Raw): ReferenceFeat {
  const category = slug(str(raw.type)) as ReferenceFeat["category"];
  const benefits = ((raw.benefits as Array<{ desc: string }> | undefined) ?? []).map((benefit) => benefit.desc);
  return { key: str(raw.key), name: str(raw.name), category, prerequisite: str(raw.prerequisite), text: str(raw.desc).trim(), benefits };
}

function backgroundOf(raw: Raw): ReferenceBackground {
  const benefits = (raw.benefits as Array<{ name: string; desc: string; type: string }> | undefined) ?? [];
  const of = (type: string) => benefits.find((benefit) => benefit.type === type)?.desc ?? "";
  return {
    key: str(raw.key),
    name: str(raw.name),
    abilities: abilitiesIn(of("ability_score")),
    feat: of("feat"),
    skills: skillsIn(of("skill_proficiency")),
    tool: of("tool_proficiency"),
    equipment: of("equipment")
  };
}

function speciesOf(raw: Raw): ReferenceSpecies {
  const traits = (raw.traits as Array<{ name: string; type: string | null; desc: string }> | undefined) ?? [];
  const size = traits.find((trait) => trait.type === "SIZE")?.desc.trim() ?? "";
  const speed = Number(/(\d+)/.exec(traits.find((trait) => trait.type === "SPEED")?.desc ?? "")?.[1] ?? 30);
  return {
    key: str(raw.key),
    name: str(raw.name),
    size,
    speed,
    traits: traits.filter((trait) => trait.type !== "SIZE" && trait.type !== "SPEED").map((trait) => ({ name: trait.name, text: trait.desc.trim() }))
  };
}

export function weaponOf(raw: Raw): ReferenceWeapon {
  const properties = (raw.properties as Array<{ property: { name: string; type: string | null }; detail?: string | null }> | undefined) ?? [];
  const mastery = properties.find((entry) => entry.property.type === "Mastery")?.property.name ?? null;
  return {
    key: str(raw.key),
    name: str(raw.name),
    category: raw.is_simple ? "simple" : "martial",
    damage: str(raw.damage_dice),
    damageType: (raw.damage_type as { key?: string } | undefined)?.key ?? "",
    range: Number(raw.range ?? 0) || 0,
    longRange: Number(raw.long_range ?? 0) || 0,
    properties: properties.filter((entry) => entry.property.type !== "Mastery").map((entry) => (entry.detail ? `${entry.property.name} (${entry.detail})` : entry.property.name)),
    mastery
  };
}

export function armorOf(raw: Raw): ReferenceArmor {
  return {
    key: str(raw.key),
    name: str(raw.name),
    category: str(raw.category),
    acBase: Number(raw.ac_base ?? 0),
    addsDex: Boolean(raw.ac_add_dexmod),
    dexCap: raw.ac_cap_dexmod == null ? null : Number(raw.ac_cap_dexmod),
    strength: raw.strength_score_required == null ? null : Number(raw.strength_score_required),
    stealthDisadvantage: Boolean(raw.grants_stealth_disadvantage)
  };
}

export const byKey = <T extends { key: string }>(a: T, b: T) => a.key.localeCompare(b.key);
export const ofDocument = (document: string) => (raw: Raw) => (raw.document as { key?: string } | undefined)?.key === document;

export interface Srd2024ReferenceBuild {
  reference: Srd2024Reference;
  warnings: string[];
}

export function buildSrd2024Reference(cache: Srd2024Cache): Srd2024ReferenceBuild {
  const warnings: string[] = [];
  const inDocument = ofDocument(cache.document);
  const usedOverrides = new Set<string>();
  const classes = cache.classes.filter(inDocument).map((raw) => classOf(raw, warnings)).sort(byKey);
  for (const entry of classes) {
    for (const feature of entry.features) if (FEATURE_OVERRIDES[feature.key]) usedOverrides.add(feature.key);
    for (const column of entry.columns) if (COLUMN_OVERRIDES[column.key]) usedOverrides.add(column.key);
  }
  for (const key of [...Object.keys(FEATURE_OVERRIDES), ...Object.keys(COLUMN_OVERRIDES)]) {
    if (!usedOverrides.has(key)) warnings.push(`override ${key} matches nothing in the source`);
  }
  return {
    reference: {
      attribution: SRD_52_ATTRIBUTION,
      document: cache.document,
      classes,
      feats: cache.feats.filter(inDocument).map(featOf).sort(byKey),
      backgrounds: cache.backgrounds.filter(inDocument).map(backgroundOf).sort(byKey),
      species: cache.species.filter(inDocument).map(speciesOf).sort(byKey),
      weapons: cache.weapons.filter(inDocument).map(weaponOf).sort(byKey),
      armor: cache.armor.filter(inDocument).map(armorOf).sort(byKey)
    },
    warnings
  };
}
