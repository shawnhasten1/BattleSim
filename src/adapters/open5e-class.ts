import type { Ability, SourceMetadata } from "@/engine";
import { SKILLS } from "@/lib/actor-sheet/edits";
import type {
  ClassDefinition,
  ClassLevel,
  ClassTableColumn,
  FeatureGrant,
  SpellcastingProgression,
  SubclassDefinition
} from "@/lib/character-builder/catalog";
import type { CatalogEntry } from "@/lib/character-builder/homebrew";
import type { Open5eImportedPayload } from "./open5e-client";

/**
 * Open5e's `/v2/classes/` records as catalog skeletons (PC builder plan, Phase 8d): a class or subclass with its hit die,
 * saves, proficiencies, table columns, feat levels, subclass level and each feature at the levels it comes, as reference
 * text. Nothing here runs yet: the DM maps features to runnable ones in the Homebrew window. The source document is
 * kept, and the id (`open5e:class:<key>`) never collides with the SRD's same-named class.
 */

interface Open5eFeature {
  key?: string;
  name?: string;
  desc?: string;
  feature_type?: string;
  gained_at?: Array<{ level?: number; detail?: string | null }>;
  data_for_class_table?: Array<{ level?: number; column_value?: string }>;
}

const ABILITY_NAMES: Record<string, Ability> = {
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"
};

/** The 2014 names of a class's subclass feature: the subclass is chosen at its level. */
const SUBCLASS_FEATURE = /(subclass|archetype|sacred oath|divine domain|druid circle|arcane tradition|otherworldly patron|sorcerous origin|bard college|primal path|monastic tradition|conclave)$/i;
/** Features the builder adds by itself, or that aren't features: not copied as grants. */
const NOT_GRANTED = /^(ability score improvement|epic boon|proficiency bonus)$/i;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "feature";
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});
const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

/** Abilities named in text, in order ("Dexterity and Intelligence", "Strength or Dexterity"). */
function abilitiesIn(value: string | undefined): Ability[] {
  if (!value) return [];
  const found = [...value.toLowerCase().matchAll(/strength|dexterity|constitution|intelligence|wisdom|charisma/g)].map((match) => ABILITY_NAMES[match[0]]!);
  return [...new Set(found)];
}

/** The proficiencies table: 2024's markdown rows (`|Saving Throw Proficiencies|…|`), or 2014's `**Saving Throws:** …` lines. */
function traitsOf(features: Open5eFeature[]): Map<string, string> {
  const traits = new Map<string, string>();
  for (const feature of features) {
    if (feature.feature_type !== "CORE_TRAITS_TABLE" && feature.feature_type !== "PROFICIENCIES") continue;
    for (const line of (feature.desc ?? "").split(/\r?\n/)) {
      const row = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/.exec(line.trim()) ?? /^\*\*([^*]+?):?\*\*:?\s*(.+)$/.exec(line.trim());
      if (row && !/^-+$/.test(row[1]!)) traits.set(row[1]!.toLowerCase().replace(/:$/, ""), row[2]!.trim());
    }
  }
  return traits;
}

function trait(traits: Map<string, string>, ...names: string[]): string | undefined {
  for (const name of names) {
    const found = [...traits.entries()].find(([key]) => key.startsWith(name));
    if (found) return found[1];
  }
  return undefined;
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

/** "Choose 4: Acrobatics, …, or Stealth" / "Choose four from …" / "Choose any three". */
function skillsOf(value: string | undefined): ClassDefinition["skills"] {
  if (!value) return { count: 2, from: "any" };
  const count = /choose\s+(?:any\s+)?(\d+|one|two|three|four|five|six)/i.exec(value);
  const n = count ? Number(count[1]) || NUMBER_WORDS[count[1]!.toLowerCase()] || 2 : 2;
  if (/choose\s+any/i.test(value)) return { count: n, from: "any" };
  const lower = value.toLowerCase();
  const from = SKILLS.filter((skill) => lower.includes(skill.name.toLowerCase())).map((skill) => skill.id);
  return { count: n, from: from.length ? from : "any" };
}

function weaponsOf(value: string | undefined): string[] {
  if (!value) return ["simple"];
  const kinds: string[] = [];
  if (/simple/i.test(value)) kinds.push("simple");
  if (/martial weapons(?!\s+that)/i.test(value)) kinds.push("martial");
  else if (/martial weapons that have the finesse or light/i.test(value)) kinds.push("martial-finesse-or-light");
  return kinds.length ? kinds : ["simple"];
}

function armorOf(value: string | undefined): ClassDefinition["armorTraining"] {
  if (!value || /^none/i.test(value)) return [];
  const armor: ClassDefinition["armorTraining"] = [];
  if (/light/i.test(value)) armor.push("light");
  if (/medium/i.test(value)) armor.push("medium");
  if (/heavy|all armor/i.test(value)) armor.push("heavy");
  if (/shield/i.test(value)) armor.push("shield");
  return armor;
}

/** A column's values by level from Open5e's rows: a level it skips keeps the level before's; numbers stay numbers. */
function columnValues(rows: NonNullable<Open5eFeature["data_for_class_table"]>): Array<string | number | null> {
  const at = new Map(rows.filter((row) => typeof row.level === "number").map((row) => [row.level!, row.column_value ?? null]));
  let last: string | number | null = null;
  return Array.from({ length: 20 }, (_, index) => {
    const value = at.get(index + 1);
    if (value !== undefined && value !== null && value !== "—" && value !== "-") last = /^-?\d+$/.test(value.trim()) ? Number(value) : value.trim();
    return last;
  });
}

/** Each feature at each level it comes, reference text only; a second time (Expertise at 6) under a key of its own. */
function levelsOf(features: Open5eFeature[], skip: (feature: Open5eFeature) => boolean): ClassLevel[] {
  const levels = new Map<number, FeatureGrant[]>();
  const used = new Set<string>();
  for (const feature of features) {
    if (feature.feature_type !== "CLASS_LEVEL_FEATURE" || !feature.name || NOT_GRANTED.test(feature.name) || skip(feature)) continue;
    const at = [...new Set((feature.gained_at ?? []).map((entry) => entry.level).filter((level): level is number => typeof level === "number" && level >= 1 && level <= 20))].sort((a, b) => a - b);
    at.forEach((level, index) => {
      let key = index === 0 ? slug(feature.name!) : `${slug(feature.name!)}-${level}`;
      while (used.has(key)) key = `${key}-2`;
      used.add(key);
      const grant: FeatureGrant = {
        key,
        ...(feature.key ? { ref: feature.key } : {}),
        feature: {
          id: key, name: feature.name!, category: "feature", automationSupport: "manual-only",
          description: index === 0 ? feature.desc ?? "" : `${feature.name} again at level ${level}. ${feature.desc ?? ""}`.trim()
        }
      };
      levels.set(level, [...(levels.get(level) ?? []), grant]);
    });
  }
  return [...levels.entries()].sort(([a], [b]) => a - b).map(([level, grants]) => ({ level, grants }));
}

const CASTER_KINDS: Record<string, SpellcastingProgression["kind"]> = { FULL: "full", HALF: "half", THIRD: "third", PACT: "pact" };

/** The catalog id a subclass's Open5e class key names: the bundled SRD 5.2 class it is, or the Open5e one imported. */
export function open5eClassId(key: string): string {
  const srd = /^srd-2024_([a-z-]+)$/.exec(key);
  return srd ? `srd:class:${srd[1]}` : `open5e:class:${key}`;
}

/** An Open5e class or subclass record (`/v2/classes/<key>/`), as a catalog skeleton. */
export function normalizeOpen5eClass(imported: Open5eImportedPayload): CatalogEntry {
  const raw = imported.raw;
  const key = text(raw.key) ?? imported.key ?? imported.slug;
  const name = text(raw.name) ?? key;
  const document = record(raw.document);
  const documentKey = text(document.key) ?? imported.documentKey;
  const source: SourceMetadata = {
    provider: "open5e",
    ...(documentKey ? { documentKey } : {}),
    ...(text(document.display_name) ?? text(document.name) ? { documentName: text(document.display_name) ?? text(document.name) } : {}),
    slug: key,
    importedAt: imported.importedAt,
    url: `https://api.open5e.com/v2/classes/${key}/`
  };
  const edition = documentKey?.includes("2024") ? "2024" : "2014";
  const features = Array.isArray(raw.features) ? raw.features as Open5eFeature[] : [];
  const columns: ClassTableColumn[] = features
    .filter((feature) => (feature.feature_type === "CLASS_TABLE_DATA" || feature.feature_type === "CLASS_LEVEL_FEATURE") && feature.data_for_class_table?.length && feature.name)
    .map((feature) => ({ id: slug(feature.name!), label: feature.name!, values: columnValues(feature.data_for_class_table!) }));
  const description = [text(raw.desc), `Imported from Open5e (${source.documentName ?? documentKey ?? "unknown document"}): its features are reference text until you make them runnable.`]
    .filter(Boolean).join("\n\n");
  const parent = record(raw.subclass_of);

  if (text(parent.key)) {
    const subclass: SubclassDefinition = {
      id: `open5e:subclass:${key}`, name, source, edition, classId: open5eClassId(text(parent.key)!),
      ...(columns.length ? { table: columns } : {}),
      levels: levelsOf(features, () => false),
      description
    };
    return { kind: "subclass", entry: subclass };
  }

  const traits = traitsOf(features);
  const subclassFeature = features.find((feature) => feature.feature_type === "CLASS_LEVEL_FEATURE" && feature.name && SUBCLASS_FEATURE.test(feature.name));
  const subclassLevel = subclassFeature?.gained_at?.map((entry) => entry.level).find((level): level is number => typeof level === "number") ?? 3;
  const asi = features.find((feature) => feature.name && /^ability score improvement$/i.test(feature.name));
  const featLevels = [...new Set((asi?.gained_at ?? []).map((entry) => entry.level).filter((level): level is number => typeof level === "number" && level !== 19))].sort((a, b) => a - b);
  const hitDie = Number(/(\d+)/.exec(text(raw.hit_dice) ?? text(record(raw.hit_points).hit_dice) ?? "")?.[1] ?? 8);
  const primary = [
    ...abilitiesIn(trait(traits, "primary ability")),
    ...(Array.isArray(raw.primary_abilities) ? raw.primary_abilities.flatMap((entry) => abilitiesIn(text(record(entry).name) ?? text(entry))) : [])
  ];
  // The table's saves first: the record's own list is wrong for some classes.
  const saves = abilitiesIn(trait(traits, "saving throw"));
  const savesFallback = Array.isArray(raw.saving_throws) ? raw.saving_throws.flatMap((entry) => abilitiesIn(text(record(entry).name))) : [];
  const casterKind = CASTER_KINDS[text(raw.caster_type) ?? ""];
  const firstPrimary = primary[0] ?? "str";
  const levels = levelsOf(features, (feature) => feature === subclassFeature);
  const atSubclass = levels.find((entry) => entry.level === subclassLevel);
  if (atSubclass) atSubclass.choices = [{ kind: "subclass", id: "subclass" }];
  else levels.push({ level: subclassLevel, grants: [], choices: [{ kind: "subclass", id: "subclass" }] });
  levels.sort((a, b) => a.level - b.level);

  const entry: ClassDefinition = {
    // Its own id even when it's an SRD class: the bundled one is never replaced or merged with it.
    id: `open5e:class:${key}`, name, source, edition,
    hitDie: ([6, 8, 10, 12].includes(hitDie) ? hitDie : 8) as ClassDefinition["hitDie"],
    primaryAbilities: primary.length ? [...new Set(primary)] : ["str"],
    saves: saves.length ? saves : savesFallback,
    skills: skillsOf(trait(traits, "skill")),
    weaponProficiency: weaponsOf(trait(traits, "weapon")),
    armorTraining: armorOf(trait(traits, "armor")),
    ...(casterKind ? {
      spellcasting: {
        ability: (["int", "wis", "cha"] as Ability[]).includes(firstPrimary) ? firstPrimary as SpellcastingProgression["ability"] : "int",
        kind: casterKind, list: slug(name),
        cantrips: Array.from({ length: 20 }, () => 0), prepared: Array.from({ length: 20 }, () => 0)
      }
    } : {}),
    subclassLevel,
    subclassLabel: subclassFeature?.name ?? `${name} Subclass`,
    featLevels: featLevels.length ? featLevels : [4, 8, 12, 16],
    table: columns,
    levels,
    suggested: { abilities: [...new Set([...primary, "con", "dex", "str", "wis", "cha", "int"] as Ability[])], tactics: "basic-melee" },
    description
  };
  return { kind: "class", entry };
}
