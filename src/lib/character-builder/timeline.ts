import type { FeatureDefinition } from "@/engine";
import { epicBoonLevelOf, pbForLevel, type BuildSources, type BuiltCharacter, type ChoiceSlot } from "./build";
import type { CharacterBuild } from "./build-record";
import type { ChoiceSpec, ClassDefinition, ClassLevel, ClassTableColumn, SubclassDefinition } from "./catalog";
import { firstParagraph, supportOf, type Support } from "./describe";

/*
 * The Class step's timeline (CHARACTER_BUILDER_UX_PLAN.md D7): every level the character has, with what it gives on its
 * own (features with their first line, the hit points it adds, what got bigger) and the choices it asks for; then the
 * levels ahead, names only. Pure: worked out from the build, what it built, and the catalog.
 */

/** A feature a level gives, as the timeline lists it. */
export interface TimelineFeature {
  /** The built feature's key (`class:srd:class:wizard:arcane-recovery`). */
  key: string;
  feature: FeatureDefinition;
  /** What gave it: "Wizard", "Evoker". */
  owner: string;
  /** Whether it comes from the subclass (listed after the level's choices, under the subclass picked). */
  subclass: boolean;
  support: Support;
  /** Its first paragraph, plain. */
  line: string;
}

/** The hit points a level adds. */
export interface TimelineHitPoints {
  die: number;
  /** The die's value used: its maximum at 1st level, the average, or the roll typed. */
  roll: number;
  rolled: boolean;
  conMod: number;
  gained: number;
  /** The character's first level: the die's maximum. */
  first: boolean;
}

export interface TimelineLevel {
  /** The character level. */
  level: number;
  classId: string;
  className: string;
  classLevel: number;
  hitPoints?: TimelineHitPoints;
  /** What got bigger: "Proficiency +3", "3rd-level slots 2", "Sneak Attack 3d6". */
  grows: string[];
  features: TimelineFeature[];
  /** Every choice this level asks for, in order: the class's, a subclass's, a feat's own. */
  choices: ChoiceSlot[];
}

/** A level still to come, in the class of the character's last level. */
export interface TimelineAhead {
  level: number;
  className: string;
  classLevel: number;
  names: string[];
}

export interface Timeline {
  levels: TimelineLevel[];
  ahead: TimelineAhead[];
}

const classOf = (sources: BuildSources, id: string) => sources.catalog.classes.find((entry) => entry.id === id);

/** The subclass a built character has for a class, if it's chosen. */
function subclassOf(built: BuiltCharacter, classId: string, sources: BuildSources): SubclassDefinition | undefined {
  const id = built.fields.classes.find((entry) => entry.id === classId)?.subclass?.id;
  return id ? sources.catalog.subclasses.find((entry) => entry.id === id) : undefined;
}

const columnsOf = (definition: ClassDefinition, subclass: SubclassDefinition | undefined): ClassTableColumn[] => [...definition.table, ...(subclass?.table ?? [])];

const filled = (value: string | number | null | undefined) => value !== null && value !== undefined && value !== "" && value !== 0;

/**
 * What a level made bigger: the proficiency bonus (by character level), and each class table number that changed at this
 * class level (all of them at the class's first level).
 */
export function levelGrows(columns: readonly ClassTableColumn[], classLevel: number, characterLevel: number): string[] {
  const grows: string[] = [];
  if (characterLevel > 1 && pbForLevel(characterLevel) !== pbForLevel(characterLevel - 1)) grows.push(`Proficiency +${pbForLevel(characterLevel)}`);
  for (const column of columns) {
    const now = column.values[classLevel - 1];
    const before = classLevel > 1 ? column.values[classLevel - 2] : null;
    if (!filled(now) || now === before) continue;
    grows.push(`${column.label} ${now}`);
  }
  return grows;
}

/** A choice's name in a class table: its label, or for an unlabelled expertise, pick or feat its id ("Scholar"). */
function choiceName(choice: ChoiceSpec): string | undefined {
  if ("label" in choice && choice.label) return choice.label.split(":")[0]!.trim();
  if (choice.kind !== "expertise" && choice.kind !== "pick" && choice.kind !== "feat") return undefined;
  return choice.id.split("-").map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

const grantNames = (level: ClassLevel | undefined, sources: BuildSources): string[] =>
  (level?.grants ?? []).flatMap((grant) => {
    if (!grant.feature || grant.atLevel) return [];
    const feature = typeof grant.feature === "string" ? sources.library.feature(grant.feature) : grant.feature;
    return feature ? [feature.name] : [];
  });

/**
 * What each class level gives, by name, as a class table lists it (20 entries): its features, its subclass's (when one is
 * chosen), the subclass choice, the choices it names, and its feat. A feature or choice that comes back at a later level
 * (Font of Magic rescaled, Evocation Savant's two more spells) is named at the first: the table's numbers say the rest.
 */
export function classLevelNames(definition: ClassDefinition, subclass: SubclassDefinition | undefined, sources: BuildSources): string[][] {
  const seen = new Set<string>();
  const once = (names: string[]) => names.filter((name) => !seen.has(name) && Boolean(seen.add(name)));
  return Array.from({ length: 20 }, (_, index) => {
    const classLevel = index + 1;
    const own = definition.levels.find((entry) => entry.level === classLevel);
    const theirs = subclass?.levels.find((entry) => entry.level === classLevel);
    const choices = (level: ClassLevel | undefined) => (level?.choices ?? []).map(choiceName).filter((name): name is string => Boolean(name));
    const names = once([...grantNames(own, sources), ...choices(own)]);
    if (classLevel === definition.subclassLevel && !subclass) names.push(definition.subclassLabel || "Subclass");
    names.push(...once([...grantNames(theirs, sources), ...choices(theirs)]));
    if (definition.featLevels.includes(classLevel)) names.push("Ability Score Improvement");
    if (classLevel === epicBoonLevelOf(definition)) names.push("Epic Boon");
    return names.filter((name, at) => names.indexOf(name) === at);
  });
}

/** Whether a built feature is the class's or its subclass's own (not a feat's, a pick's, a species'). */
function classFeature(key: string, classId: string, subclass: SubclassDefinition | undefined): "class" | "subclass" | undefined {
  // A pick's option owns its features as `…:<pick>=<option>`; the pick is shown as the choice it is.
  if (key.includes("=")) return undefined;
  if (key.startsWith(`class:${classId}:`)) return "class";
  if (subclass && key.startsWith(`subclass:${subclass.id}:`)) return "subclass";
  return undefined;
}

export function timeline(build: CharacterBuild, built: BuiltCharacter, sources: BuildSources): Timeline {
  const classLevels = new Map<string, number>();
  const levels: TimelineLevel[] = [];
  build.levels.forEach((entry, index) => {
    const characterLevel = index + 1;
    const definition = classOf(sources, entry.classId);
    const classLevel = (classLevels.get(entry.classId) ?? 0) + 1;
    classLevels.set(entry.classId, classLevel);
    if (!definition) return;
    const subclass = subclassOf(built, definition.id, sources);
    const hp = built.breakdown.hitPoints.levels[index];
    const features = built.features.flatMap((placed): TimelineFeature[] => {
      if (placed.gainedAt !== characterLevel) return [];
      const kind = classFeature(placed.key, definition.id, subclass);
      if (!kind) return [];
      return [{
        key: placed.key, feature: placed.feature, owner: placed.ownerName, subclass: kind === "subclass",
        support: supportOf(placed.feature), line: firstParagraph(placed.feature.description)
      }];
    });
    levels.push({
      level: characterLevel,
      classId: definition.id,
      className: definition.name,
      classLevel,
      ...(hp ? { hitPoints: { die: hp.die, roll: hp.roll, rolled: hp.rolled, conMod: hp.conMod, gained: hp.gained, first: index === 0 } } : {}),
      grows: levelGrows(columnsOf(definition, subclass), classLevel, characterLevel),
      features,
      choices: built.choices.filter((slot) => slot.scope.kind === "level" && slot.scope.index === index)
    });
  });

  // Ahead: the class of the last level, on to 20.
  const ahead: TimelineAhead[] = [];
  const last = build.levels[build.levels.length - 1];
  const lastClass = last ? classOf(sources, last.classId) : undefined;
  if (lastClass) {
    const subclass = subclassOf(built, lastClass.id, sources);
    const from = classLevels.get(lastClass.id) ?? 0;
    const named = classLevelNames(lastClass, subclass, sources);
    for (let classLevel = from + 1; classLevel <= 20; classLevel += 1) {
      const level = build.levels.length + (classLevel - from);
      if (level > 20) break;
      const names = named[classLevel - 1]!;
      if (names.length) ahead.push({ level, className: lastClass.name, classLevel, names });
    }
  }
  return { levels, ahead };
}

/** A class's table, 1 to 20 (the subclass's columns too, once it's chosen): spell slots in one column. */
export interface ClassTable {
  columns: string[];
  rows: Array<{ level: number; proficiency: string; features: string; values: string[] }>;
}

export function classTable(definition: ClassDefinition, subclass: SubclassDefinition | undefined, sources: BuildSources): ClassTable {
  const columns = columnsOf(definition, subclass).filter((column) => column.values.some(filled));
  const slots = columns.filter((column) => /^slots-\d$/.test(column.id));
  const others = columns.filter((column) => !slots.includes(column));
  const named = classLevelNames(definition, subclass, sources);
  return {
    columns: [...others.map((column) => column.label), ...(slots.length ? ["Spell slots"] : [])],
    rows: Array.from({ length: 20 }, (_, index) => {
      const level = index + 1;
      const values = others.map((column) => (filled(column.values[index]) ? String(column.values[index]) : "—"));
      if (slots.length) values.push(slots.map((column) => column.values[index]).filter(filled).join(" · ") || "—");
      return { level, proficiency: `+${pbForLevel(level)}`, features: named[index]!.join(", ") || "—", values };
    })
  };
}
