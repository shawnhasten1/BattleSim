import {
  abilityModifier,
  type Ability,
  type ActionDefinition,
  type ConditionImmunity,
  type CreatureSenses,
  type CreatureType,
  type Edition,
  type FeatureDefinition,
  type ItemDefinition,
  type MovementProfile,
  type ResourceStance,
  type SizeCategory,
  type SourceMetadata,
  type SpellDefinition,
  type TacticsProfile,
  type WeaponDefinition
} from "@/engine";
import { SKILLS, skillName } from "@/lib/actor-sheet/edits";
import { editionOf } from "@/lib/editions";
import type {
  BackgroundDefinition,
  Catalog,
  ChoiceSpec,
  ClassDefinition,
  ClassSuggestions,
  ClassTableColumn,
  EquipmentLine,
  FeatDefinition,
  FeatureGrant,
  FreeCast,
  PickOption,
  SpeciesDefinition,
  SpellcastingProgression,
  SpellChange,
  SpellsChoice,
  SubclassDefinition,
  Template
} from "./catalog";
import type { CharacterBuild, ChoiceValue, FeatChoice } from "./build-record";
import { sourceLabel } from "./homebrew";
import { spellSlots, type SlotCaster } from "./slots";
import { castAs, maxSpellLevel, spellRuns, spellSlug } from "./spells";
import { evaluateNumber, evaluateTemplate, type TemplateScope } from "./template";

/**
 * Building a character: its build (the recipe) and the catalog in, everything the builder writes onto its actor out
 * (PC_BUILDER_PLAN.md). Pure and deterministic: the same build gives the same character. `applyBuild` (apply.ts) then
 * puts it on an actor, keeping what the DM has edited.
 *
 * A choice the build hasn't made yet is left out (its grants aren't given) and listed in `choices` as pending, with a
 * suggestion: `withSuggestions` fills them in, which is what Quick build does.
 */

export const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Library records the catalog names by id, and weapon kinds' mastery properties. */
export interface BuilderLibrary {
  feature(id: string): FeatureDefinition | undefined;
  weapon(id: string): WeaponDefinition | undefined;
  item(id: string): ItemDefinition | undefined;
  /** A weapon kind (`longsword`): its name and its SRD 5.2 mastery property. */
  weaponKind?(kind: string): { name: string; mastery: string } | undefined;
  /** Every weapon kind there is, for the mastery choice. */
  weaponKinds?(): string[];
  /** The library's plain weapons (no magic ones), by id: what a 2014 "any martial weapon" equipment line offers. */
  weaponRefs?(): string[];
  /** A library spell, by id. */
  spell?(id: string): SpellDefinition | undefined;
  /** The spells on a class's spell list (`"wizard"`), by library id. */
  spellsOn?(list: string): string[];
}

export interface BuildSources {
  catalog: Catalog;
  library: BuilderLibrary;
}

/** Where a choice's value lives in the build. */
export type ChoiceScope = { kind: "level"; index: number } | { kind: "background" } | { kind: "species" };

/** One choice the build asks for, with what it holds and what the builder would pick. */
export interface ChoiceSlot {
  scope: ChoiceScope;
  /** The choice's id, and for a feat's own choices the feat choice's id first: `["feat", "increase"]`. */
  path: string[];
  spec: ChoiceSpec;
  /** What asks for it: "Fighter 4", "Soldier", "Ability Score Improvement". */
  owner: string;
  characterLevel?: number;
  classLevel?: number;
  /** The value the build holds, if it's valid. A partly valid value keeps its valid part. */
  value?: ChoiceValue;
  /** Why the build's value isn't used (in full). */
  problem?: string;
  /** A choice still to make: no value, or not all of one (two skills of four). */
  pending: boolean;
  suggestion?: ChoiceValue;
  /** How many to choose (skills, masteries, picks), or the points to spend (ability increases). */
  count: number;
  /** What can be chosen, for the UI. `taken`: already had another way (a skill the background gives). */
  options: ChoiceOption[];
}

export interface ChoiceOption {
  id: string;
  name: string;
  detail?: string;
  taken?: boolean;
  /** A spell's level, for grouping (0: a cantrip). */
  level?: number;
  /** A spell the simulator doesn't cast: it goes on the actor as its text, for the DM. */
  reference?: boolean;
  /** Where a homebrew or imported subclass or feat is from ("Homebrew"), shown beside its name. Absent for the SRD's. */
  from?: string;
  /** The rules it's written for, when it says: a badge beside it (EDITIONS_PLAN.md D2). */
  edition?: Edition;
}

/** A spell the builder puts on the actor: prepared, always prepared, or the copy a free cast spends its own pool on. */
export interface BuiltSpell {
  key: string;
  spell: SpellDefinition;
  /** The library spell it's a copy of. */
  from: string;
}

/** A weapon the builder puts on the actor (the Monk's Unarmed Strike), with the grant it came from. */
export interface BuiltWeapon {
  key: string;
  weapon: WeaponDefinition;
  scaled: string[];
}

/** A feature the builder puts on the actor, with the grant it came from. */
export interface BuiltFeature {
  /** The `made` key: what owns it and its grant key. */
  key: string;
  feature: FeatureDefinition;
  bucket: "features" | "traits";
  /** The paths its numbers were written to, for the level-up diff ("Sneak Attack: 2d6 → 3d6"). */
  scaled: string[];
}

export interface BuiltFields {
  level: number;
  classes: Array<{ id: string; name: string; level: number; subclass?: { id: string; name: string } }>;
  abilities: Record<Ability, number>;
  maxHp: number;
  proficiencyBonus: number;
  /** The AC without armor: 10 + Dexterity. Armor and Unarmored Defense do the rest, as for any actor. */
  armorClass: number;
  speed: number;
  movement: MovementProfile;
  size: SizeCategory;
  type: CreatureType;
  senses: CreatureSenses;
  saves: Partial<Record<Ability, number>>;
  skills: Record<string, number>;
  conditionImmunities: ConditionImmunity[];
  spellcasting?: { ability: Ability };
  defaultTactics: TacticsProfile;
  defaultResourceStance?: ResourceStance;
}

export interface BuiltCharacter {
  fields: BuiltFields;
  features: BuiltFeature[];
  /** Weapons the builder owns (not the starting packages, which are the DM's once on the actor). */
  weapons: BuiltWeapon[];
  /** Spells: cantrips, prepared and always-prepared spells, and free casts. */
  spells: BuiltSpell[];
  /** Pools the builder sizes: a feature's (`rage`, `second-wind`), spell slots (`slot-1`…) and free casts. */
  resources: Record<string, number>;
  /** What to call a pool that isn't a feature's or a slot level's: a free cast's ("Hunter's Mark without a slot"). */
  poolLabels: Record<string, string>;
  /** The starting packages' weapons and armor, as library ids: put on the actor once, on its first build. */
  equipment: Array<{ ref: string; count: number }>;
  /** Weapon kinds mastered. */
  masteries: string[];
  choices: ChoiceSlot[];
  warnings: string[];
}

export const pbForLevel = (level: number) => 2 + Math.floor((Math.max(level, 1) - 1) / 4);
/** An id's last part: `fighter`. A 2014 class's (`srd:class:fighter-2014`) gives the same, so its features are `fighter-…`. */
const slugOf = (id: string) => id.slice(id.lastIndexOf(":") + 1).replace(/-2014$/, "");
const skillAbility = (id: string): Ability => SKILLS.find((skill) => skill.id === id)?.ability ?? "int";
const ALL_SKILLS = SKILLS.map((skill) => skill.id);

/* ── reading and writing the build's choices ──────────────────────────────────────────────────────────────────── */

function choiceMap(build: CharacterBuild, scope: ChoiceScope): Record<string, ChoiceValue> | undefined {
  if (scope.kind === "level") return build.levels[scope.index]?.choices;
  if (scope.kind === "background") return build.background.choices;
  return build.species?.choices;
}

/** The value stored for a choice. A feat's own choices live in its `FeatChoice` (`increases`, then `choices`). */
export function storedChoice(build: CharacterBuild, scope: ChoiceScope, path: string[], spec?: ChoiceSpec): ChoiceValue | undefined {
  if (scope.kind === "background" && path.length === 1 && path[0] === "increases") return build.background.increases;
  const map = choiceMap(build, scope);
  if (!map) return undefined;
  if (path.length === 1) return map[path[0]!];
  const parent = map[path[0]!] as FeatChoice | undefined;
  if (!parent || typeof parent !== "object" || Array.isArray(parent) || !("feat" in parent)) return undefined;
  if (spec?.kind === "abilities") return parent.increases;
  return parent.choices?.[path[1]!];
}

/** The build with one choice set (or cleared, with `undefined`). */
export function withChoice(build: CharacterBuild, scope: ChoiceScope, path: string[], value: ChoiceValue | undefined, spec?: ChoiceSpec): CharacterBuild {
  if (scope.kind === "background" && path.length === 1 && path[0] === "increases") {
    return { ...build, background: { ...build.background, increases: (value as Partial<Record<Ability, number>>) ?? {} } };
  }
  const map = { ...(choiceMap(build, scope) ?? {}) };
  if (path.length === 1) {
    if (value === undefined) delete map[path[0]!];
    else map[path[0]!] = value;
  } else {
    const parent = map[path[0]!] as FeatChoice | undefined;
    if (!parent || typeof parent !== "object" || !("feat" in parent)) return build;
    if (spec?.kind === "abilities") {
      map[path[0]!] = { ...parent, increases: value as Partial<Record<Ability, number>> | undefined };
    } else {
      const choices = { ...(parent.choices ?? {}) };
      if (value === undefined) delete choices[path[1]!];
      else choices[path[1]!] = value;
      map[path[0]!] = { ...parent, choices };
    }
  }
  if (scope.kind === "level") {
    return { ...build, levels: build.levels.map((entry, index) => (index === scope.index ? { ...entry, choices: map } : entry)) };
  }
  if (scope.kind === "background") return { ...build, background: { ...build.background, choices: map } };
  return build.species ? { ...build, species: { ...build.species, choices: map } } : build;
}

/* ── the walk ─────────────────────────────────────────────────────────────────────────────────────────────────── */

interface Owner {
  /** `class:srd:class:fighter`, `subclass:…`, `feat:srd:feat:alert@background` … */
  key: string;
  /** Feature ids on the actor start with this: `fighter`, `champion`, `feat-alert`. */
  idPrefix: string;
  name: string;
  /** Templates' `{level}`: the class's level, or the character's. */
  level: number;
  classId?: string;
  columns: ClassTableColumn[];
  /** The ability its spells are cast with, when it isn't a class's (a species' chosen one). */
  castingAbility?: Ability;
}

interface CollectedGrant {
  grant: FeatureGrant;
  owner: Owner;
  /** Appended to the feature's text ("Mastered: …", "Taken at 4th level: +2 Dexterity"). */
  note?: string;
  nameSuffix?: string;
}

interface WalkState {
  build: CharacterBuild;
  sources: BuildSources;
  abilities: Record<Ability, number>;
  skills: Set<string>;
  expertise: Set<string>;
  masteries: string[];
  /** The kinds of weapon its starting packages give it: what a mastery suggestion picks first. */
  carriedKinds: string[];
  feats: Map<string, number>;
  grants: CollectedGrant[];
  choices: ChoiceSlot[];
  warnings: string[];
  saves: Set<Ability>;
  classLevels: Map<string, number>;
  subclassOf: Map<string, SubclassDefinition>;
  /** Spells chosen so far (cantrips, prepared, a feat's). Spellbook spells are in `spellbooks`. */
  spellPicks: SpellPick[];
  /** A spellbook class's book (the Wizard's), by class id. */
  spellbooks: Map<string, string[]>;
  /**
   * Spells a grant somewhere in the build makes always prepared, and what grants them (a first walk finds them): a
   * choice can't take one, even at a level before the grant (Bless before Life Domain's 3rd level).
   */
  reserved: Map<string, string>;
  /** Options taken in earlier picks, by the class (or owner) and the pick's id: a later Metamagic pick can't repeat one. */
  picked: Map<string, Set<string>>;
  /** Whether to rank spells for suggestions: not on the first of two walks, which only finds always-prepared spells. */
  suggest: boolean;
  /** The character's increases come from its species (a 2014 race's, a subrace's): `increasesSource`. */
  speciesIncreases: boolean;
  /** Each class's spells prepared so far, by class id: a 2014 caster's number follows its modifier (`preparedFormula`). */
  preparedSoFar: Map<string, number>;
}

/** A spell the character has, and how. */
interface SpellPick {
  spell: string;
  owner: Owner;
  /** The ability it's cast with. Absent: the character's spellcasting ability. */
  ability?: Ability;
  via: "cantrip" | "prepared" | "always" | "free";
  /** Casts without a slot, from a pool of its own. */
  freeCasts?: Template | number | "at-will";
  /** A free cast's shared pool, name, action and level (`FreeCast`). */
  freeCast?: Pick<FreeCast, "pool" | "label" | "asAction" | "castAt">;
  /** The one class list it was chosen from (Magic Initiate's Cleric list): whose spell it counts as, with no class of its own. */
  list?: string;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
const ABILITY_NAMES: Record<Ability, string> = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

function addAbilities(state: WalkState, increases: Partial<Record<Ability, number>>, cap: number) {
  for (const ability of ABILITIES) {
    const amount = increases[ability] ?? 0;
    if (amount > 0) state.abilities[ability] = Math.min(cap, state.abilities[ability] + amount);
  }
}

function increasesText(increases: Partial<Record<Ability, number>>): string {
  return ABILITIES.filter((ability) => (increases[ability] ?? 0) > 0).map((ability) => `+${increases[ability]} ${ABILITY_NAMES[ability]}`).join(", ");
}

/** Points a choice of ability increases can take, and the ones that are wrong. */
function validIncreases(value: unknown, spec: Extract<ChoiceSpec, { kind: "abilities" }>): { increases: Partial<Record<Ability, number>>; problem?: string; complete: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { increases: {}, complete: false };
  const increases: Partial<Record<Ability, number>> = {};
  let total = 0;
  let problem: string | undefined;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const amount = typeof raw === "number" ? Math.trunc(raw) : 0;
    if (amount <= 0) continue;
    if (!spec.from.includes(key as Ability)) { problem = `${key} can't be increased by this`; continue; }
    if (amount > spec.maxPerAbility) { problem = `at most +${spec.maxPerAbility} to one score`; continue; }
    if (total + amount > spec.points) { problem = `at most ${spec.points} points`; continue; }
    increases[key as Ability] = amount;
    total += amount;
  }
  return { increases, problem, complete: total === spec.points };
}

/** The best ability increases for a character: its priority order, up to the cap, as the spec allows. */
function suggestIncreases(spec: Extract<ChoiceSpec, { kind: "abilities" }>, abilities: Record<Ability, number>, priority: Ability[]): Partial<Record<Ability, number>> {
  const order = [...priority.filter((ability) => spec.from.includes(ability)), ...spec.from.filter((ability) => !priority.includes(ability))];
  const increases: Partial<Record<Ability, number>> = {};
  let points = spec.points;
  for (const ability of order) {
    if (points <= 0) break;
    const room = Math.max(0, spec.cap - abilities[ability]);
    const amount = Math.min(points, spec.maxPerAbility, room);
    if (amount > 0) {
      increases[ability] = amount;
      points -= amount;
    }
  }
  return increases;
}

/** A non-SRD option's source, to show beside its name. */
function fromOf(source: SourceMetadata | undefined): { from?: string } {
  const from = sourceLabel(source);
  return from ? { from } : {};
}

function asStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function classOf(sources: BuildSources, id: string): ClassDefinition | undefined {
  return sources.catalog.classes.find((entry) => entry.id === id);
}

function featOf(sources: BuildSources, id: string): FeatDefinition | undefined {
  return sources.catalog.feats.find((entry) => entry.id === id);
}

function priorityOf(state: WalkState): Ability[] {
  const first = classOf(state.sources, state.build.levels[0]?.classId ?? "");
  return first?.suggested.abilities ?? ["con", "dex", "str", "wis", "cha", "int"];
}

interface ChoiceContext {
  scope: ChoiceScope;
  owner: Owner;
  ownerName: string;
  characterLevel?: number;
  classLevel?: number;
  /** Values fixed by the catalog (a background's Magic Initiate list): not offered, just used. */
  fixed?: Record<string, ChoiceValue>;
  classDefinition?: ClassDefinition;
  /** Where the choice is made, for a feat's name and its owner key. */
  where: string;
}

/** Record a choice slot, and act on its value: grants, scores, skills, masteries, nested choices. */
function visitChoice(state: WalkState, spec: ChoiceSpec, context: ChoiceContext, parentPath: string[] = []) {
  const path = [...parentPath, spec.id];
  const fixed = context.fixed?.[spec.id];
  const stored = fixed ?? storedChoice(state.build, context.scope, path, spec);
  const slot: ChoiceSlot = {
    scope: context.scope, path, spec, owner: context.ownerName,
    characterLevel: context.characterLevel, classLevel: context.classLevel, pending: true,
    count: "count" in spec ? spec.count ?? 0 : 1, options: []
  };
  const offer = fixed === undefined;
  const priority = priorityOf(state);
  const suggestionsOf = context.classDefinition?.suggested ?? classOf(state.sources, state.build.levels[0]?.classId ?? "")?.suggested;

  switch (spec.kind) {
    case "subclass": {
      const classId = context.owner.classId;
      const options = state.sources.catalog.subclasses.filter((entry) => entry.classId === classId);
      slot.options = options.map((entry) => ({ id: entry.id, name: entry.name, detail: entry.source.documentName, ...fromOf(entry.source), edition: entry.edition }));
      slot.suggestion = options[0]?.id;
      if (typeof stored === "string") {
        if (options.some((entry) => entry.id === stored)) {
          slot.value = stored;
          slot.pending = false;
        } else slot.problem = `no subclass ${stored} for this class`;
      }
      break;
    }
    case "skills": {
      const from = spec.from === "any" ? ALL_SKILLS : spec.from;
      const takenBefore = new Set(state.skills);
      slot.options = from.map((skill) => ({ id: skill, name: skillName(skill), ...(takenBefore.has(skill) ? { taken: true } : {}) }));
      const chosen = (asStrings(stored) ?? []).filter((skill) => {
        const ok = from.includes(skill) && !state.skills.has(skill);
        if (!ok) slot.problem = `${skill} isn't one of these skills, or is already proficient`;
        return ok;
      }).slice(0, spec.count);
      const preferred = [...(suggestionsOf?.skills ?? []), ...from].filter((skill, index, all) => from.includes(skill) && all.indexOf(skill) === index);
      slot.suggestion = preferred.filter((skill) => !state.skills.has(skill)).slice(0, spec.count);
      for (const skill of chosen) state.skills.add(skill);
      if (stored !== undefined) slot.value = chosen;
      slot.pending = chosen.length < Math.min(spec.count, from.filter((skill) => !state.skills.has(skill) || chosen.includes(skill)).length);
      break;
    }
    case "expertise": {
      const chosen = (asStrings(stored) ?? []).filter((skill) => {
        const ok = state.skills.has(skill) && !state.expertise.has(skill) && (!spec.from || spec.from.includes(skill));
        if (!ok) slot.problem = `${skill} isn't a proficient skill without expertise`;
        return ok;
      }).slice(0, spec.count);
      const candidates = [...state.skills].filter((skill) => !state.expertise.has(skill) && (!spec.from || spec.from.includes(skill)));
      slot.options = [...state.skills].sort().filter((skill) => !spec.from || spec.from.includes(skill))
        .map((skill) => ({ id: skill, name: skillName(skill), ...(state.expertise.has(skill) && !chosen.includes(skill) ? { taken: true } : {}) }));
      const preferred = [...(suggestionsOf?.expertise ?? []), ...candidates.sort((a, b) => state.abilities[skillAbility(b)] - state.abilities[skillAbility(a)])];
      slot.suggestion = preferred.filter((skill, index) => candidates.includes(skill) && preferred.indexOf(skill) === index).slice(0, spec.count);
      for (const skill of chosen) state.expertise.add(skill);
      if (stored !== undefined) slot.value = chosen;
      slot.pending = chosen.length < Math.min(spec.count, candidates.length);
      break;
    }
    case "weapon-mastery": {
      const definition = context.classDefinition;
      const table = definition?.weaponMastery;
      const level = context.classLevel ?? 1;
      const count = table ? (table[level - 1] ?? 0) - (level > 1 ? table[level - 2] ?? 0 : 0) : 0;
      const known = state.sources.library.weaponKinds?.();
      const masteredBefore = new Set(state.masteries);
      slot.count = count;
      slot.options = (known ?? []).map((kind) => {
        const about = state.sources.library.weaponKind?.(kind);
        return { id: kind, name: about?.name ?? kind, ...(about?.mastery ? { detail: about.mastery } : {}), ...(masteredBefore.has(kind) ? { taken: true } : {}) };
      });
      const chosen = (asStrings(stored) ?? []).filter((kind) => {
        const ok = !state.masteries.includes(kind) && (!known || known.includes(kind));
        if (!ok) slot.problem = `${kind} is already mastered, or isn't a weapon`;
        return ok;
      }).slice(0, count);
      const preferred = [...state.carriedKinds, ...(suggestionsOf?.masteries ?? []), ...(known ?? [])];
      slot.suggestion = preferred.filter((kind, index) => preferred.indexOf(kind) === index && !state.masteries.includes(kind) && (!known || known.includes(kind))).slice(0, count);
      state.masteries.push(...chosen);
      if (stored !== undefined) slot.value = chosen;
      slot.pending = chosen.length < count;
      if (count <= 0) return; // nothing to choose at this level
      break;
    }
    case "abilities": {
      const { increases, problem, complete } = validIncreases(stored, spec);
      slot.count = spec.points;
      slot.options = spec.from.map((ability) => ({ id: ability, name: ABILITY_NAMES[ability], detail: String(state.abilities[ability]) }));
      slot.suggestion = suggestIncreases(spec, state.abilities, priority);
      if (problem) slot.problem = problem;
      if (stored !== undefined) slot.value = increases;
      slot.pending = !complete;
      addAbilities(state, increases, spec.cap);
      break;
    }
    case "pick": {
      // A pick made again at a later level (Metamagic at 2nd, 10th and 17th) can't take what an earlier one took.
      const pickKey = `${context.owner.classId ?? context.owner.key}|${spec.id}`;
      const before = state.picked.get(pickKey) ?? new Set<string>();
      const classLevel = context.classLevel ?? state.build.levels.length;
      const taken = (option: PickOption) => before.has(option.id) && !option.repeatable;
      // What an option still needs: a level, or an option of this pick taken before it (or earlier in this one).
      const needs = (option: PickOption, alongside: string[]): string | undefined => {
        const prerequisite = option.prerequisite;
        if (prerequisite?.level && classLevel < prerequisite.level) return `from ${ordinal(prerequisite.level)} level`;
        const missing = (prerequisite?.options ?? []).filter((id) => !before.has(id) && !alongside.includes(id));
        // An option of another pick in the family (a 2014 Pact Boon) by its id in words: "Pact of the Blade".
        const named = (id: string) => spec.options.find((candidate) => candidate.id === id)?.name
          ?? id.split("-").map((word, index) => (index > 0 && ["of", "the", "and"].includes(word) ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`)).join(" ");
        if (missing.length) return `needs ${missing.map(named).join(", ")}`;
        return undefined;
      };
      const chosen: string[] = [];
      for (const id of asStrings(stored) ?? []) {
        if (chosen.length >= spec.count) break;
        const option = spec.options.find((candidate) => candidate.id === id);
        const problem = !option ? `${id} isn't an option`
          : taken(option) ? `${option.name} was chosen at an earlier level`
          : chosen.includes(id) ? `${option.name} is chosen twice (a repeatable one can be taken again at a later level)`
          : needs(option, chosen);
        if (problem) slot.problem = option && !taken(option) && problem !== `${id} isn't an option` ? `${option.name}: ${problem}` : problem;
        else chosen.push(id);
      }
      slot.options = spec.options.map((option) => {
        const blocked = taken(option) ? "chosen at an earlier level" : needs(option, chosen);
        return {
          id: option.id, name: option.name,
          ...(blocked && !chosen.includes(option.id) ? { taken: true, detail: blocked } : option.description ? { detail: option.description } : {})
        };
      });
      // A choice of abilities (Magic Initiate's spellcasting ability) suggests the character's best; others take the
      // class's preferred order for this pick, then the catalog's.
      const preferred = (context.classDefinition?.suggested.picks ?? classOf(state.sources, state.build.levels[0]?.classId ?? "")?.suggested.picks)?.[spec.id] ?? [];
      const ordered = spec.options.every((option) => (ABILITIES as string[]).includes(option.id))
        ? [...spec.options].sort((a, b) => state.abilities[b.id as Ability] - state.abilities[a.id as Ability]
          || priority.indexOf(a.id as Ability) - priority.indexOf(b.id as Ability))
        : [...spec.options].sort((a, b) => {
          const rank = (option: PickOption) => (preferred.includes(option.id) ? preferred.indexOf(option.id) : preferred.length + spec.options.indexOf(option));
          return rank(a) - rank(b);
        });
      const suggestion = [...chosen];
      for (const option of ordered) {
        if (suggestion.length >= spec.count) break;
        if (!taken(option) && !suggestion.includes(option.id) && !needs(option, suggestion)) suggestion.push(option.id);
      }
      const open = ordered.filter((option) => !taken(option) && !chosen.includes(option.id) && !needs(option, suggestion));
      slot.suggestion = suggestion;
      if (stored !== undefined) slot.value = chosen;
      slot.pending = chosen.length < Math.min(spec.count, chosen.length + open.filter((option) => !chosen.includes(option.id)).length);
      if (offer) state.choices.push(slot);
      state.picked.set(pickKey, new Set([...before, ...chosen]));
      for (const id of chosen) {
        const option = spec.options.find((candidate) => candidate.id === id)!;
        visitOption(state, option, spec, context, parentPath);
      }
      return;
    }
    case "feat": {
      if (offer) state.choices.push(slot);
      visitFeatChoice(state, spec, stored, slot, context, path);
      return;
    }
    case "spells":
      visitSpells(state, spec, context, slot, stored, parentPath);
      if (slot.count <= 0) return; // nothing to choose at this level
      break;
  }
  if (offer) state.choices.push(slot);
}

/** What a spell choice needs to know of a library spell, worked out once per library: choices read it many times. */
interface SpellFacts {
  name: string;
  level: number;
  school?: string;
  castingTime: string;
  runs: boolean;
  edition?: Edition;
}

const SPELL_FACTS = new WeakMap<BuilderLibrary, Map<string, SpellFacts | null>>();
const LIST_SPELLS = new WeakMap<BuilderLibrary, Map<string, string[]>>();

function spellFacts(library: BuilderLibrary, id: string): SpellFacts | undefined {
  let cache = SPELL_FACTS.get(library);
  if (!cache) SPELL_FACTS.set(library, (cache = new Map()));
  let facts = cache.get(id);
  if (facts === undefined) {
    const spell = library.spell?.(id);
    const edition = spell ? editionOf(spell) : undefined;
    facts = spell ? { name: spell.name, level: spell.level, school: spell.school, castingTime: spell.castingTime, runs: spellRuns(spell), ...(edition ? { edition } : {}) } : null;
    cache.set(id, facts);
  }
  return facts ?? undefined;
}

/** The spells on any of these lists, each once. */
function listSpells(library: BuilderLibrary, lists: string[]): string[] {
  let cache = LIST_SPELLS.get(library);
  if (!cache) LIST_SPELLS.set(library, (cache = new Map()));
  const key = lists.join("|");
  let spells = cache.get(key);
  if (!spells) cache.set(key, (spells = [...new Set(lists.flatMap((list) => library.spellsOn?.(list) ?? []))]));
  return spells;
}

/** Names in a fixed order, fast (spell lists are sorted many times while Quick build fills choices). */
const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The spellcasting a class has: its own, or its subclass's (a third caster's). */
function progressionOf(state: WalkState, classId: string): SpellcastingProgression | undefined {
  return classOf(state.sources, classId)?.spellcasting ?? state.subclassOf.get(classId)?.spellcasting;
}

/** The ability a grant's spells are cast with: the granting class's. Absent: the character's own. */
function grantAbility(state: WalkState, owner: Owner): Ability | undefined {
  return owner.castingAbility ?? (owner.classId ? progressionOf(state, owner.classId)?.ability : undefined);
}

/** Whether a grant applies yet: one with `atLevel` waits for its class to reach that level. */
function grantActive(state: WalkState, collected: CollectedGrant): boolean {
  const atLevel = collected.grant.atLevel;
  if (atLevel === undefined) return true;
  const classId = collected.owner.classId;
  return (classId ? state.classLevels.get(classId) ?? 0 : state.build.levels.length) >= atLevel;
}

/** The spells the character has so far, and what gave each: picks, and grants' always-prepared spells. */
function spellsHeld(state: WalkState): Map<string, { name: string; ownerKey: string }> {
  const held = new Map<string, { name: string; ownerKey: string }>();
  for (const pick of state.spellPicks) {
    if (pick.via !== "free" && !held.has(pick.spell)) held.set(pick.spell, { name: pick.owner.name, ownerKey: pick.owner.key });
  }
  for (const collected of state.grants) {
    if (!grantActive(state, collected)) continue;
    for (const id of collected.grant.spells ?? []) if (!held.has(id)) held.set(id, { name: collected.owner.name, ownerKey: collected.owner.key });
  }
  return held;
}

/** Every spell a grant in the build makes always prepared, with what grants it. */
function grantedSpells(state: WalkState): Map<string, string> {
  const granted = new Map<string, string>();
  for (const collected of state.grants) {
    if (!grantActive(state, collected)) continue;
    for (const id of collected.grant.spells ?? []) if (!granted.has(id)) granted.set(id, collected.owner.name);
  }
  return granted;
}

/** The spell lists a class's own prepared spells come from: its list, and any a grant adds (Magical Secrets). */
function classSpellLists(state: WalkState, classId: string, own: string): string[] {
  const lists = new Set([own]);
  for (const collected of state.grants) {
    if (collected.owner.classId !== classId || !grantActive(state, collected)) continue;
    for (const list of collected.grant.adjust?.spellLists ?? []) lists.add(list);
  }
  return [...lists];
}

/**
 * What a spell choice offers, suggests and takes. The suggestion puts spells that run first, then the highest level
 * the choice allows, then the classes' preferences (the first class's, then every class's), then the name.
 */
function visitSpells(state: WalkState, spec: SpellsChoice, context: ChoiceContext, slot: ChoiceSlot, stored: ChoiceValue | undefined, parentPath: string[]) {
  const library = state.sources.library;
  const sibling = (id: string | undefined): string | undefined => {
    if (!id) return undefined;
    const value = context.fixed?.[id] ?? storedChoice(state.build, context.scope, [...parentPath, id]);
    return Array.isArray(value) ? (typeof value[0] === "string" ? value[0] : undefined) : typeof value === "string" ? value : undefined;
  };
  const classId = context.owner.classId;
  const progression = classId ? progressionOf(state, classId) : undefined;
  // A class's own choices (no lists of their own) read its list, and for prepared spells any a grant added (Magical
  // Secrets: not cantrips).
  const classLists = progression && classId
    ? (spec.what === "prepared" ? classSpellLists(state, classId, progression.list) : [progression.list])
    : [];
  const lists = spec.lists ?? (spec.listFrom ? [sibling(spec.listFrom)].filter((list): list is string => Boolean(list)) : classLists);
  const ability = (sibling(spec.abilityFrom) as Ability | undefined) ?? progression?.ability;
  const castable = progression ? maxSpellLevel(progression.kind, context.classLevel ?? 1, progression.firstSlotsAt) : 1;
  const top = spec.what === "cantrips" ? 0 : spec.level ?? Math.min(castable, spec.maxLevel ?? 9);
  const bottom = spec.what === "cantrips" ? 0 : spec.level ?? spec.minLevel ?? 1;
  const count = spec.count ?? 0;
  slot.count = count;
  if (count <= 0) return;

  const book = classId && progression?.spellbook ? (state.spellbooks.get(classId) ?? []) : undefined;
  if (book && classId && !state.spellbooks.has(classId)) state.spellbooks.set(classId, book);
  const held = spellsHeld(state);
  const from = spec.from === "held"
    // What the character has from what asks (the subclass, and the options chosen in it).
    ? [...held].filter(([, have]) => have.ownerKey.startsWith(context.owner.key)).map(([id]) => id)
    : (spec.what === "prepared" || spec.from === "spellbook") && book ? book
      : listSpells(library, lists);
  const spellOf = (id: string) => spellFacts(library, id);
  const inRange = from.filter((id) => {
    const spell = spellOf(id);
    return spell !== undefined && spell.level >= bottom && spell.level <= top && (!spec.school || spell.school === spec.school)
      && (!spec.actionOnly || spell.castingTime === "action");
  });
  const inBook = new Set(book ?? []);
  // A choice of free casts can take a spell the character has (Spell Mastery's from the book, Natural Recovery's).
  const freeOnly = spec.freeCasts !== undefined && (spec.from === "held" || spec.from === "spellbook");
  const takenBy = (id: string): string | undefined => {
    if (spec.what === "spellbook") return inBook.has(id) ? "already in the spellbook" : undefined;
    if (freeOnly) return state.spellPicks.some((pick) => pick.spell === id && pick.via === "free") ? "already cast without a slot" : undefined;
    const reserved = state.reserved.get(id);
    if (reserved) return `always prepared (${reserved})`;
    const have = held.get(id);
    return have ? `already had (${have.name})` : undefined;
  };
  const nameOf = (id: string) => spellOf(id)?.name ?? id;
  // The first of two walks only needs what's chosen, not what could be (see buildCharacter).
  slot.options = !state.suggest ? [] : inRange
    .map((id): ChoiceOption => {
      const spell = spellOf(id)!;
      const taken = takenBy(id);
      return { id, name: spell.name, level: spell.level, ...(spell.runs ? {} : { reference: true }), ...(taken ? { taken: true, detail: taken } : {}), ...(spell.edition ? { edition: spell.edition } : {}) };
    })
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || byName(a.name, b.name));

  const chosen: string[] = [];
  const offered = new Set(inRange);
  for (const id of asStrings(stored) ?? []) {
    if (chosen.length >= count || chosen.includes(id)) continue;
    if (!offered.has(id)) {
      slot.problem = `${nameOf(id)} isn't one of the spells this can choose`;
      continue;
    }
    const taken = takenBy(id);
    if (taken) {
      slot.problem = `${nameOf(id)} is ${taken}: choose another`;
      continue;
    }
    chosen.push(id);
  }

  // The suggestion: what runs, then the highest level, then the classes' preferences. A full choice needs none.
  if (chosen.length >= count || !state.suggest) {
    if (stored !== undefined) slot.value = chosen;
    slot.suggestion = chosen;
    slot.pending = false;
    recordSpellPicks(state, spec, context, chosen, book, ability, freeOnly, lists);
    return;
  }
  const firstClass = classOf(state.sources, state.build.levels[0]?.classId ?? "");
  const own = context.classDefinition?.suggested ?? firstClass?.suggested;
  // The class's own preferences, then those of the classes whose lists it's choosing from (Magic Initiate's Cleric
  // spells read the Cleric's), then every other class's.
  const listClasses = state.sources.catalog.classes.filter((entry) => entry.spellcasting && lists.includes(entry.spellcasting.list));
  const otherClasses = state.sources.catalog.classes.filter((entry) => !listClasses.includes(entry));
  const preferences = (entry: ClassSuggestions | undefined) => (spec.what === "cantrips" ? entry?.cantrips : entry?.spells) ?? [];
  const wantedList = [own, ...listClasses.map((entry) => entry.suggested), ...otherClasses.map((entry) => entry.suggested)].flatMap(preferences);
  const wanted = new Map<string, number>();
  wantedList.forEach((id, index) => { if (!wanted.has(id)) wanted.set(id, index); });
  const candidates = inRange.filter((id) => !takenBy(id) && !chosen.includes(id));
  const keyOf = new Map(candidates.map((id) => {
    const spell = spellOf(id);
    return [id, { runs: spell?.runs ? 0 : 1, level: -(spell?.level ?? 0), wanted: wanted.get(id) ?? Number.MAX_SAFE_INTEGER, name: spell?.name ?? id }];
  }));
  candidates.sort((a, b) => {
    const x = keyOf.get(a)!;
    const y = keyOf.get(b)!;
    return x.runs - y.runs || x.level - y.level || x.wanted - y.wanted || byName(x.name, y.name);
  });
  slot.suggestion = [...chosen, ...candidates].slice(0, count);

  if (stored !== undefined) slot.value = chosen;
  slot.pending = chosen.length < Math.min(count, chosen.length + candidates.length);
  recordSpellPicks(state, spec, context, chosen, book, ability, freeOnly, lists);
}

/** What a spell choice took: into the class's spellbook, or the character's spells. */
function recordSpellPicks(
  state: WalkState, spec: SpellsChoice, context: ChoiceContext, chosen: string[], book: string[] | undefined, ability: Ability | undefined, freeOnly: boolean,
  lists: string[]
) {
  for (const id of chosen) {
    if (spec.what === "spellbook") {
      book?.push(id);
      continue;
    }
    state.spellPicks.push({
      spell: id, owner: context.owner, ...(ability ? { ability } : {}),
      via: freeOnly ? "free" : spec.what === "cantrips" ? "cantrip" : spec.alwaysPrepared ? "always" : "prepared",
      ...(spec.freeCasts !== undefined ? { freeCasts: spec.freeCasts } : {}),
      ...(lists.length === 1 ? { list: lists[0] } : {})
    });
  }
}

function visitOption(state: WalkState, option: PickOption, pick: Extract<ChoiceSpec, { kind: "pick" }>, context: ChoiceContext, parentPath: string[]) {
  if (option.feat) {
    const feat = featOf(state.sources, option.feat);
    if (feat) takeFeat(state, feat, undefined, context, [...parentPath, `${pick.id}.${option.id}`]);
    return;
  }
  const owner: Owner = { ...context.owner, key: `${context.owner.key}:${pick.id}=${option.id}` };
  // A 2014 subrace's increases, when the character's come from its species.
  if (option.abilities && state.speciesIncreases && context.scope.kind === "species") addAbilities(state, option.abilities, 20);
  for (const grant of option.grants) state.grants.push({ grant, owner });
  for (const nested of option.choices ?? []) {
    visitChoice(state, { ...nested, id: `${pick.id}.${option.id}.${nested.id}` } as ChoiceSpec, { ...context, owner }, parentPath);
  }
}

function visitFeatChoice(state: WalkState, spec: Extract<ChoiceSpec, { kind: "feat" }>, stored: ChoiceValue | undefined, slot: ChoiceSlot, context: ChoiceContext, path: string[]) {
  const level = context.characterLevel ?? state.build.levels.length;
  const eligible = state.sources.catalog.feats.filter((feat) =>
    spec.categories.includes(feat.category)
    && (!spec.names || spec.names.includes(feat.name))
    && (feat.repeatable || !state.feats.has(feat.id))
    && meetsPrerequisite(state, feat, level));
  const suggested = context.classDefinition?.suggested;
  const pickSuggestion = (): string | undefined => {
    // A 2014 class's Ability Score Improvement is the 2014 one, when the catalog has it.
    const asi = context.classDefinition?.edition === "2014" && eligible.some((feat) => feat.id === ASI_2014) ? ASI_2014 : "srd:feat:ability-score-improvement";
    const wanted = spec.categories.includes("epic-boon") ? suggested?.epicBoon
      : spec.categories.includes("fighting-style") ? suggested?.fightingStyle
      : spec.categories.includes("general") ? asi
      : spec.categories.includes("origin") ? "srd:feat:skilled" : undefined;
    return eligible.find((feat) => feat.id === wanted)?.id ?? eligible[0]?.id;
  };
  // Options beside the feats (a Paladin's Blessed Warrior instead of a Fighting Style feat).
  const extras = spec.extraOptions ?? [];
  const suggestedExtra = spec.categories.includes("fighting-style") ? extras.find((option) => option.id === suggested?.fightingStyle)?.id : undefined;
  const suggestedFeat = suggestedExtra ?? pickSuggestion();
  slot.options = [
    ...eligible.map((feat) => ({ id: feat.id, name: feat.name, detail: feat.category, ...fromOf(feat.source), edition: feat.edition })),
    ...extras.map((option) => ({ id: option.id, name: option.name, ...(option.description ? { detail: option.description } : {}) }))
  ];
  slot.suggestion = suggestedFeat ? { feat: suggestedFeat } : undefined;
  const choice = stored && typeof stored === "object" && !Array.isArray(stored) && "feat" in stored ? (stored as FeatChoice) : undefined;
  if (!choice) return;
  const extra = extras.find((option) => option.id === choice.feat);
  if (extra) {
    slot.value = { feat: extra.id };
    slot.pending = false;
    const owner: Owner = { ...context.owner, key: `${context.owner.key}:${spec.id}=${extra.id}` };
    for (const grant of extra.grants) state.grants.push({ grant, owner });
    // Its own choices are kept in the feat choice's `choices`, as a feat's are.
    for (const nested of extra.choices ?? []) visitChoice(state, nested, { ...context, owner, ownerName: extra.name }, path);
    return;
  }
  const feat = featOf(state.sources, choice.feat);
  if (!feat || !spec.categories.includes(feat.category)) {
    slot.problem = `${choice.feat} isn't a feat this choice offers`;
    return;
  }
  if (!feat.repeatable && state.feats.has(feat.id)) {
    slot.problem = `${feat.name} is already taken`;
    return;
  }
  if (!meetsPrerequisite(state, feat, level)) state.warnings.push(`${feat.name} at ${context.ownerName}: its prerequisite isn't met`);
  slot.value = { feat: feat.id };
  slot.pending = false;
  takeFeat(state, feat, choice, context, path);
}

function meetsPrerequisite(state: WalkState, feat: FeatDefinition, level: number): boolean {
  const prerequisite = feat.prerequisite;
  if (!prerequisite) return true;
  if (prerequisite.level !== undefined && level < prerequisite.level) return false;
  if (prerequisite.abilities) {
    const checks = Object.entries(prerequisite.abilities).map(([ability, score]) => state.abilities[ability as Ability] >= (score ?? 0));
    if (prerequisite.anyOf ? !checks.some(Boolean) : !checks.every(Boolean)) return false;
  }
  return true;
}

/** A feat taken: its grants, and its own choices (its ability increases, its spell list …). */
function takeFeat(state: WalkState, feat: FeatDefinition, choice: FeatChoice | undefined, context: ChoiceContext, path: string[]) {
  state.feats.set(feat.id, (state.feats.get(feat.id) ?? 0) + 1);
  const where = context.where;
  const owner: Owner = {
    key: `feat:${feat.id}@${where}`,
    idPrefix: `feat-${slugOf(feat.id)}${feat.repeatable && where !== "background" ? `-${where.toLowerCase()}` : ""}`,
    name: feat.name,
    level: state.build.levels.length,
    columns: []
  };
  const before = { ...state.abilities };
  for (const nested of feat.choices ?? []) {
    visitChoice(state, nested, { ...context, owner, ownerName: feat.name, fixed: context.scope.kind === "background" ? context.fixed : undefined }, path);
  }
  const gained = Object.fromEntries(ABILITIES.map((ability) => [ability, state.abilities[ability] - before[ability]]).filter(([, amount]) => (amount as number) > 0)) as Partial<Record<Ability, number>>;
  const takenAt = context.characterLevel ? `Taken at ${ordinal(context.characterLevel)} level` : `From ${context.ownerName}`;
  const note = Object.keys(gained).length ? `${takenAt}: ${increasesText(gained)}.` : undefined;
  for (const grant of feat.grants) {
    state.grants.push({ grant, owner, note, nameSuffix: feat.repeatable && context.characterLevel ? ` (${ordinal(context.characterLevel)} level)` : undefined });
  }
}

/** The kinds of weapon the build's starting packages give (the first class's and the background's), in order. */
function carriedKindsOf(build: CharacterBuild, sources: BuildSources): string[] {
  const firstClass = classOf(sources, build.levels[0]?.classId ?? "");
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const refs = [
    ...(firstClass?.startingEquipment?.find((entry) => entry.id === build.equipment?.classOption)?.items ?? []),
    ...(firstClass ? equipmentLineItems(build, firstClass, sources) : []),
    ...(background?.equipment?.find((entry) => entry.id === build.equipment?.backgroundOption)?.items ?? [])
  ].map((item) => item.ref).filter((ref) => ref.startsWith("srd:weapon:"));
  const kinds = refs.map((ref) => sources.library.weapon(ref)?.baseWeapon ?? ref.slice("srd:weapon:".length));
  return kinds.filter((kind, index) => kinds.indexOf(kind) === index);
}

/** Walk the whole build in order: background, then each level, gathering grants and choices. */
function walk(build: CharacterBuild, sources: BuildSources, reserved: Map<string, string>, suggest = true): WalkState {
  const fromSpecies = increasesSource(build, sources) === "species";
  const state: WalkState = {
    build, sources,
    abilities: { ...build.abilities.base },
    skills: new Set(), expertise: new Set(), masteries: [], carriedKinds: carriedKindsOf(build, sources), feats: new Map(),
    grants: [], choices: [], warnings: [], saves: new Set(),
    classLevels: new Map(), subclassOf: new Map(), spellPicks: [], spellbooks: new Map(), reserved, picked: new Map(), suggest,
    speciesIncreases: fromSpecies, preparedSoFar: new Map()
  };

  // The background: its ability increases (unless they come from the species), its skills, its origin feat (2024) or
  // its own feature (2014).
  const background = build.background.id
    ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id)
    : undefined;
  if (build.background.id && !background) state.warnings.push(`No background ${build.background.id}`);
  const custom = build.background.custom;
  const backgroundAbilities = background?.abilities ?? (custom?.abilities as BackgroundDefinition["abilities"] | undefined) ?? [];
  const backgroundName = background?.name ?? (custom ? "Custom background" : "No background");
  const backgroundOwner: Owner = { key: `background:${background?.id ?? "custom"}`, idPrefix: "background", name: backgroundName, level: build.levels.length, columns: [] };
  const backgroundContext: ChoiceContext = { scope: { kind: "background" }, owner: backgroundOwner, ownerName: backgroundName, where: "background", fixed: background?.featChoices as Record<string, ChoiceValue> | undefined };
  if (!fromSpecies && (background || custom)) {
    // A background with no abilities of its own (2014's Acolyte): the 2024 rule's three points, on any abilities.
    const from = backgroundAbilities.length ? [...backgroundAbilities] : [...ABILITIES];
    visitChoice(state, {
      kind: "abilities", id: "increases", label: backgroundAbilities.length ? "Ability score increases" : "Ability score increases (any three)",
      points: 3, from, maxPerAbility: 2, cap: 20
    }, backgroundContext);
  }
  for (const skill of background?.skills ?? custom?.skills ?? []) state.skills.add(skill);
  for (const grant of background?.grants ?? []) state.grants.push({ grant, owner: backgroundOwner });
  const originFeat = featOf(sources, background?.feat ?? custom?.feat ?? "");
  if (originFeat) {
    takeFeat(state, originFeat, { feat: originFeat.id, choices: build.background.choices }, backgroundContext, []);
  } else if (background?.feat ?? custom?.feat) {
    state.warnings.push(`No feat ${background?.feat ?? custom?.feat}`);
  }

  // The species: its traits up to the character's level, and its choices (a lineage, an ancestry, a skill), before the
  // class levels so a class's skill choices know what it gave.
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  if (species && fromSpecies) {
    // A 2014 race's increases: its own, then those of the player's choice (a Half-Elf's). A subrace's come with it.
    addAbilities(state, species.abilities ?? {}, 20);
    const choice = species.abilityChoice;
    if (choice) {
      const owner: Owner = { key: `species:${species.id}`, idPrefix: slugOf(species.id), name: species.name, level: build.levels.length, columns: [] };
      visitChoice(state, {
        kind: "abilities", id: "increases", label: "Ability score increases", points: choice.count * choice.amount,
        from: ABILITIES.filter((ability) => !(choice.exclude ?? []).includes(ability)), maxPerAbility: choice.amount, cap: 20
      }, { scope: { kind: "species" }, owner, ownerName: species.name, where: "species" });
    }
  }
  if (species) {
    const characterLevel = build.levels.length;
    const abilityChoice = species.spellcastingAbilityChoice ? storedChoice(build, { kind: "species" }, [species.spellcastingAbilityChoice]) : undefined;
    const castingAbility = ((Array.isArray(abilityChoice) ? abilityChoice[0] : abilityChoice) ?? species.spellcastingAbility) as Ability | undefined;
    for (const skill of species.skills ?? []) state.skills.add(skill);
    const owner: Owner = {
      key: `species:${species.id}`, idPrefix: slugOf(species.id), name: species.name, level: characterLevel, columns: [],
      ...(castingAbility && (ABILITIES as string[]).includes(castingAbility) ? { castingAbility } : {})
    };
    // No character level: a feat it gives (Versatile) is "from Human", not "taken at 5th level".
    const context: ChoiceContext = { scope: { kind: "species" }, owner, ownerName: species.name, where: "species" };
    for (const level of species.levels.filter((entry) => entry.level <= characterLevel).sort((a, b) => a.level - b.level)) {
      for (const grant of level.grants) state.grants.push({ grant, owner });
      for (const choice of level.choices ?? []) visitChoice(state, choice, context);
    }
  }

  // Each level, in order.
  const firstClass = classOf(sources, build.levels[0]?.classId ?? "");
  for (const save of firstClass?.saves ?? []) state.saves.add(save);
  build.levels.forEach((entry, index) => {
    const definition = classOf(sources, entry.classId);
    if (!definition) {
      state.warnings.push(`Level ${index + 1}: no class ${entry.classId}`);
      return;
    }
    const classLevel = (state.classLevels.get(definition.id) ?? 0) + 1;
    state.classLevels.set(definition.id, classLevel);
    const characterLevel = index + 1;
    const subclass = state.subclassOf.get(definition.id);
    const owner: Owner = {
      key: `class:${definition.id}`, idPrefix: slugOf(definition.id), name: definition.name, level: classLevel,
      classId: definition.id, columns: [...definition.table, ...(subclass?.table ?? [])]
    };
    const context: ChoiceContext = {
      scope: { kind: "level", index }, owner, ownerName: `${definition.name} ${classLevel}`,
      characterLevel, classLevel, classDefinition: definition, where: `L${characterLevel}`
    };
    // A character's first level gives its class's skills; the builder asks for them as that level's first choice. A
    // class taken later gives what its multiclass rule says (one skill for a Bard, a Ranger or a Rogue).
    if (index === 0 && definition.skills.count > 0) {
      visitChoice(state, { kind: "skills", id: "class-skills", count: definition.skills.count, from: definition.skills.from }, context);
    } else if (index > 0 && classLevel === 1 && definition.multiclass?.skills) {
      visitChoice(state, { kind: "skills", id: "multiclass-skills", count: definition.multiclass.skills, from: definition.skills.from }, context);
    }
    const level = definition.levels.find((candidate) => candidate.level === classLevel);
    for (const grant of level?.grants ?? []) state.grants.push({ grant, owner });
    for (const choice of level?.choices ?? []) visitChoice(state, choice, context);
    // Weapon Mastery grows with the table: a choice wherever the count goes up (the level 1 choice is the catalog's).
    if (classLevel > 1 && definition.weaponMastery && (definition.weaponMastery[classLevel - 1] ?? 0) > (definition.weaponMastery[classLevel - 2] ?? 0)) {
      visitChoice(state, { kind: "weapon-mastery", id: "weapon-mastery" }, context);
    }
    if (definition.featLevels.includes(classLevel)) {
      visitChoice(state, { kind: "feat", id: "feat", categories: ["general"], label: "Ability Score Improvement or another feat" }, context);
    }
    if (classLevel === epicBoonLevelOf(definition)) {
      visitChoice(state, { kind: "feat", id: "epic-boon", categories: ["epic-boon", "general"], label: "Epic Boon or another feat" }, context);
    }
    // The subclass: chosen at its level (above), its features from then on.
    const chosenSubclass = state.subclassOf.get(definition.id) ?? (() => {
      const pick = classLevel >= definition.subclassLevel ? storedChoice(build, { kind: "level", index }, ["subclass"]) : undefined;
      const found = typeof pick === "string" ? sources.catalog.subclasses.find((candidate) => candidate.id === pick && candidate.classId === definition.id) : undefined;
      if (found) state.subclassOf.set(definition.id, found);
      return found;
    })();
    if (chosenSubclass) {
      const subOwner: Owner = {
        key: `subclass:${chosenSubclass.id}`, idPrefix: slugOf(chosenSubclass.id), name: chosenSubclass.name, level: classLevel,
        classId: definition.id, columns: [...definition.table, ...(chosenSubclass.table ?? [])]
      };
      const subLevel = chosenSubclass.levels.find((candidate) => candidate.level === classLevel);
      for (const grant of subLevel?.grants ?? []) state.grants.push({ grant, owner: subOwner });
      for (const choice of subLevel?.choices ?? []) visitChoice(state, choice, { ...context, owner: subOwner, ownerName: `${chosenSubclass.name} ${classLevel}` });
    }
    // Spells: as many cantrips, spellbook spells and prepared spells as the class's numbers went up at this level.
    const progression = progressionOf(state, definition.id);
    if (progression) {
      const gained = (values: number[] | undefined) =>
        values ? (values[classLevel - 1] ?? 0) - (classLevel > 1 ? values[classLevel - 2] ?? 0 : 0) : 0;
      const cantrips = gained(progression.cantrips);
      if (cantrips > 0) visitChoice(state, { kind: "spells", id: "cantrips", what: "cantrips", count: cantrips, label: "Cantrips" }, context);
      if (progression.spellbook) {
        const count = classLevel === 1 ? progression.spellbook.start : progression.spellbook.perLevel;
        visitChoice(state, { kind: "spells", id: "spellbook", what: "spellbook", count, label: "Spellbook" }, context);
      }
      // The number prepared now, less what's prepared already: a 2014 caster's follows its modifier (an Ability Score
      // Improvement at this level adds a spell).
      const before = state.preparedSoFar.get(definition.id) ?? 0;
      const target = preparedAt(progression, classLevel, state.abilities);
      state.preparedSoFar.set(definition.id, Math.max(before, target));
      const prepared = Math.max(0, target - before);
      const label = progression.preparedFormula ? "Prepared spells" : definition.edition === "2014" ? "Spells known" : "Prepared spells";
      if (prepared > 0) visitChoice(state, { kind: "spells", id: "prepared", what: "prepared", count: prepared, label }, context);
    }
  });
  return state;
}

/** The Ability Score Improvement a 2014 class's feat levels suggest, when the catalog has it. */
const ASI_2014 = "srd:feat:ability-score-improvement-2014";

/** The class level with an Epic Boon choice: its own, or 19 for a 2024 class and none for a 2014 one. */
export function epicBoonLevelOf(definition: Pick<ClassDefinition, "epicBoonLevel" | "edition">): number | undefined {
  return definition.epicBoonLevel ?? (definition.edition === "2024" ? 19 : undefined);
}

/**
 * How many leveled spells a class has prepared (or known) at a class level: its table's number, or a 2014 prepared
 * caster's modifier plus its level (or half of it), at least 1. None before its spellcasting starts (`firstSlotsAt`).
 */
export function preparedAt(progression: SpellcastingProgression, classLevel: number, abilities: Record<Ability, number>): number {
  if (classLevel < (progression.firstSlotsAt ?? 1)) return 0;
  const formula = progression.preparedFormula;
  if (!formula) return progression.prepared[classLevel - 1] ?? 0;
  const levels = formula.add === "level" ? classLevel : Math.floor(classLevel / 2);
  return Math.max(1, abilityModifier(abilities[progression.ability]) + levels);
}

/**
 * Where a build's ability increases come from (EDITIONS_PLAN.md D3): its own `increasesFrom`, or the background when
 * the background gives increases (a 2024 one), otherwise the species when it gives some (a 2014 race), otherwise the
 * background (the 2024 rule's three points on any abilities).
 */
export function increasesSource(build: CharacterBuild, sources: BuildSources): "background" | "species" {
  if (build.increasesFrom) return build.increasesFrom;
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  if (background?.abilities?.length || build.background.custom?.abilities?.length) return "background";
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  return species && speciesGivesIncreases(species) ? "species" : "background";
}

/** Whether a species has ability increases of its own (a 2014 race), or a subrace that has. */
export function speciesGivesIncreases(species: SpeciesDefinition): boolean {
  if (Object.keys(species.abilities ?? {}).length || species.abilityChoice) return true;
  return species.levels.some((level) => (level.choices ?? []).some((choice) => choice.kind === "pick" && choice.options.some((option) => option.abilities)));
}

/**
 * The library items a 2014 class's equipment lines give: each line's pick (the build's, the class's suggestion, or its
 * first option), and the weapons chosen where it asks for "any martial weapon".
 */
export function equipmentLineItems(build: CharacterBuild, definition: ClassDefinition, sources: BuildSources): Array<{ ref: string; count?: number }> {
  const items: Array<{ ref: string; count?: number }> = [];
  for (const line of definition.equipmentLines ?? []) {
    const option = equipmentLineOption(build, definition, line);
    items.push(...option.items);
    if (option.anyWeapon) items.push(...equipmentLineWeapons(build, definition, line.id, option.anyWeapon, sources).map((ref) => ({ ref })));
  }
  return items;
}

/** A line's option as the build has it: its pick, the class's suggestion, or the first. */
export function equipmentLineOption(build: CharacterBuild, definition: ClassDefinition, line: EquipmentLine): EquipmentLine["options"][number] {
  const id = build.equipment?.lines?.[line.id] ?? definition.suggested.equipmentLines?.[line.id];
  return line.options.find((option) => option.id === id) ?? line.options[0]!;
}

/** The library weapons a line's "any … weapon" option can take: the plain weapons of its category (melee ones, if it says). */
export function equipmentWeaponOptions(anyWeapon: NonNullable<EquipmentLine["options"][number]["anyWeapon"]>, sources: BuildSources): string[] {
  return (sources.library.weaponRefs?.() ?? []).filter((ref) => {
    const weapon = sources.library.weapon(ref);
    return weapon?.category === anyWeapon.category && (!anyWeapon.melee || weapon.attackType === "melee");
  });
}

/** The weapons a line's "any … weapon" option takes: the build's, the class's suggestion, or the first it can. */
export function equipmentLineWeapons(build: CharacterBuild, definition: ClassDefinition, lineId: string, anyWeapon: NonNullable<EquipmentLine["options"][number]["anyWeapon"]>, sources: BuildSources): string[] {
  const allowed = equipmentWeaponOptions(anyWeapon, sources);
  const wanted = (build.equipment?.weapons?.[lineId] ?? definition.suggested.equipmentWeapons?.[lineId] ?? []).filter((ref) => allowed.includes(ref));
  const filled = [...wanted];
  while (filled.length < anyWeapon.count && allowed.length) filled.push(allowed[0]!);
  return filled.slice(0, anyWeapon.count);
}

/* ── turning grants into features and numbers ─────────────────────────────────────────────────────────────────── */

function getPath(target: unknown, path: string): unknown {
  let node = target as Record<string, unknown> | undefined;
  for (const part of path.split(".")) {
    if (!node || typeof node !== "object") return undefined;
    node = node[part] as Record<string, unknown> | undefined;
  }
  return node;
}

/** Write a scaled value. A field that holds text gets text: Rage's "+2" is the dice string "2", not the number 2. */
function setPath(target: unknown, path: string, value: unknown): boolean {
  if (typeof getPath(target, path) === "string" && typeof value === "number") value = String(value);
  const parts = path.split(".");
  let node = target as Record<string, unknown> | unknown[];
  for (let index = 0; index < parts.length - 1; index += 1) {
    const next = (node as Record<string, unknown>)[parts[index]!];
    if (!next || typeof next !== "object") return false;
    node = next as Record<string, unknown>;
  }
  const last = parts[parts.length - 1]!;
  if (!(last in (node as Record<string, unknown>))) return false;
  (node as Record<string, unknown>)[last] = value;
  return true;
}

/**
 * A grant's feature at one level: a copy with its scale bindings worked out (all but the `weapon.` ones, which go into
 * the grant's weapon). The builder places every feature this way, and Add ability a 2024 class feature put on any creature
 * at a class level (EDITIONS_PLAN.md Phase 2), so the two never work a number out differently. `problems` names each
 * binding it couldn't work out (`error`) or found nothing to write into.
 */
export function scaledFeature(source: FeatureDefinition, grant: Pick<FeatureGrant, "scale">, scope: TemplateScope): {
  feature: FeatureDefinition;
  scaled: string[];
  problems: Array<{ path: string; error?: string }>;
} {
  const feature = structuredClone(source) as FeatureDefinition;
  const scaled: string[] = [];
  const problems: Array<{ path: string; error?: string }> = [];
  for (const binding of (grant.scale ?? []).filter((candidate) => !candidate.path.startsWith("weapon."))) {
    let value: string | number;
    try {
      value = evaluateTemplate(binding.value, scope);
    } catch (error) {
      problems.push({ path: binding.path, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (setPath(feature, binding.path, value)) scaled.push(binding.path);
    else problems.push({ path: binding.path });
  }
  return { feature, scaled, problems };
}

/** A feature as it goes on the actor: its own id, its granted actions' ids after it, pointing back at it. */
function placedFeature(feature: FeatureDefinition, id: string): FeatureDefinition {
  const grantedActions = feature.grantedActions?.map((action, index) => {
    const actionId = `${id}-granted-${index + 1}`;
    // Each rider its own id: two conditions from one action (Turn Undead's) would otherwise be one condition.
    const riders = "riders" in action && action.riders
      ? { riders: action.riders.map((rider, riderIndex) => ({ ...rider, id: rider.id ?? `${actionId}-rider-${riderIndex + 1}` })) }
      : {};
    return { ...action, id: actionId, ...("featureId" in action ? { featureId: id } : {}), ...riders } as typeof action;
  });
  return { ...feature, id, ...(grantedActions ? { grantedActions } : {}) };
}

/** A spell as it goes on the actor: its own id, its action's after it (pointing back at it), its riders' too. */
function placedSpell(spell: SpellDefinition, id: string): SpellDefinition {
  const action = spell.action;
  if (!action) return { ...spell, id };
  const riders = "riders" in action && action.riders
    ? action.riders.map((rider, index) => ({ ...rider, id: `${id}-rider-${index + 1}` }))
    : undefined;
  const placed = {
    ...action,
    id: `${id}-action`,
    ...("featureId" in action ? { featureId: id } : {}),
    ...(riders ? { riders } : {})
  } as typeof action;
  return { ...spell, id, action: placed };
}

/** A mark with a feature's change: its die (Foe Slayer), its spill (Superior Hunter's Prey), its concentration (Relentless Hunter). */
function changedMark(action: Extract<ActionDefinition, { kind: "buff" }>, change: NonNullable<SpellChange["mark"]>): ActionDefinition {
  const effects = (action.appliedCondition.effects ?? []).map((effect) => (effect.kind === "incoming-hit-damage" && effect.onlyFromSource
    ? {
      ...effect,
      ...(change.dice ? { damage: effect.damage.map((component, index) => (index === 0 ? { ...component, dice: change.dice! } : component)) } : {}),
      ...(change.spillWithinFt ? { spillWithinFt: change.spillWithinFt } : {})
    }
    : effect));
  return {
    ...action,
    appliedCondition: { ...action.appliedCondition, effects },
    mark: { ...action.mark, ...(change.keepsConcentrationOnDamage ? { keepsConcentrationOnDamage: true } : {}) }
  };
}

/** A placed spell with a feature's change: an ability on its first damage roll, a longer range, more riders. */
function changedSpell(spell: SpellDefinition, change: SpellChange): SpellDefinition {
  const action = spell.action;
  if (!action) return spell;
  let next = { ...action } as ActionDefinition;
  if (change.damageAbility && "damage" in next && next.damage.length) {
    next = { ...next, damage: next.damage.map((component, index) => (index === 0 ? { ...component, abilityModifier: change.damageAbility } : component)) } as ActionDefinition;
  }
  if (change.range !== undefined && "range" in next) next = { ...next, range: change.range } as ActionDefinition;
  if (change.mark && next.kind === "buff" && next.mark) next = changedMark(next, change.mark);
  if (change.concentrationOptional && next.kind === "summon") next = { ...next, concentrationOptional: change.concentrationOptional };
  if (change.riders?.length && "riders" in next) {
    const existing = next.riders ?? [];
    next = { ...next, riders: [...existing, ...change.riders.map((rider, index) => ({ ...rider, id: `${action.id}-rider-${existing.length + index + 1}` }))] } as ActionDefinition;
  } else if (change.riders?.length && (next.kind === "attack" || next.kind === "save" || next.kind === "area-save")) {
    next = { ...next, riders: change.riders.map((rider, index) => ({ ...rider, id: `${action.id}-rider-${index + 1}` })) } as ActionDefinition;
  }
  return { ...spell, ...(change.range !== undefined ? { range: change.range } : {}), action: next };
}

export function buildCharacter(build: CharacterBuild, sources: BuildSources): BuiltCharacter {
  // Twice: a quick first walk finds the spells grants make always prepared, so the second knows them from the start,
  // and an earlier choice that took one (Bless at 1st level, before Life Domain's 3rd) asks again.
  const reserved = grantedSpells(walk(build, sources, new Map(), false));
  const state = walk(build, sources, reserved);
  const firstClass = classOf(sources, build.levels[0]?.classId ?? "");
  const characterLevel = build.levels.length;
  const pb = pbForLevel(characterLevel);

  // Grants that a later one replaces drop out, within the same class (and its subclass).
  const replaced = new Set<string>();
  for (const collected of state.grants) {
    if (collected.grant.replaces) replaced.add(`${collected.owner.classId ?? collected.owner.key}|${collected.grant.replaces}`);
  }
  const live = state.grants.filter((collected) =>
    !replaced.has(`${collected.owner.classId ?? collected.owner.key}|${collected.grant.key}`) && grantActive(state, collected));

  // Scores: base, the background, feats (already in `state.abilities`), then features that raise them past 20.
  const abilities = { ...state.abilities };
  for (const { grant } of live) {
    const raise = grant.adjust?.abilities;
    if (!raise) continue;
    const cap = grant.adjust?.abilityMax ?? 20;
    for (const ability of ABILITIES) {
      const amount = raise[ability] ?? 0;
      if (amount > 0) abilities[ability] = Math.min(cap, abilities[ability] + amount);
    }
  }

  // A class's features read its level now, not the level they were gained at: Second Wind heals 1d10 + 5 at 5th level.
  const scopeFor = (owner: Owner): TemplateScope => ({
    level: owner.classId ? state.classLevels.get(owner.classId) ?? owner.level : characterLevel,
    charLevel: characterLevel,
    pb,
    abilities,
    columns: owner.columns
  });
  const evaluate = <T>(what: string, run: () => T): T | undefined => {
    try {
      return run();
    } catch (error) {
      state.warnings.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  };

  const features: BuiltFeature[] = [];
  const weapons: BuiltWeapon[] = [];
  const resources: Record<string, number> = {};
  let speedBonus = 0;
  let hpBonus = 0;
  const senses: CreatureSenses = {};
  const movementModes = new Set<"climb" | "swim">();
  const conditionImmunities = new Set<ConditionImmunity>();
  const takenIds = new Set<string>();

  for (const collected of live) {
    const { grant, owner } = collected;
    const scope = scopeFor(owner);
    const label = `${owner.name}: ${grant.key}`;
    if (grant.feature) {
      const source = typeof grant.feature === "string" ? sources.library.feature(grant.feature) : grant.feature;
      if (!source) {
        state.warnings.push(`${label}: no library feature ${grant.feature as string}`);
      } else {
        const { feature, scaled, problems } = scaledFeature(source, grant, scope);
        for (const problem of problems) {
          state.warnings.push(problem.error ? `${label} ${problem.path}: ${problem.error}` : `${label}: no ${problem.path} to scale`);
        }
        if (collected.note) feature.description = [feature.description, collected.note].filter(Boolean).join("\n\n");
        if (collected.nameSuffix) feature.name = `${feature.name}${collected.nameSuffix}`;
        let id = `${owner.idPrefix}-${grant.key}`;
        if (owner.key.includes("=")) id = `${owner.idPrefix}-${owner.key.slice(owner.key.lastIndexOf("=") + 1)}-${grant.key}`;
        if (id.endsWith("-feat")) id = id.slice(0, -"-feat".length);
        while (takenIds.has(id)) id = `${id}-2`;
        takenIds.add(id);
        features.push({
          key: `${owner.key}:${grant.key}`,
          feature: placedFeature(feature, id),
          bucket: feature.category === "trait" ? "traits" : "features",
          scaled
        });
      }
    }
    if (grant.weapon) {
      const weapon = structuredClone(grant.weapon) as WeaponDefinition;
      const scaled: string[] = [];
      for (const binding of (grant.scale ?? []).filter((candidate) => candidate.path.startsWith("weapon."))) {
        const path = binding.path.slice("weapon.".length);
        const value = evaluate(`${label} ${binding.path}`, () => evaluateTemplate(binding.value, scope));
        if (value === undefined) continue;
        if (setPath(weapon, path, value)) scaled.push(path);
        else state.warnings.push(`${label}: no ${binding.path} to scale`);
      }
      const id = `${owner.idPrefix}-${grant.key}`;
      weapons.push({ key: `${owner.key}:${grant.key}`, weapon: { ...weapon, id, actionId: id }, scaled });
    }
    if (grant.actionPatch) {
      const { grant: earlier, action: index, patch } = grant.actionPatch;
      const target = features.find((entry) => entry.key.endsWith(`:${earlier}`));
      const action = target?.feature.grantedActions?.[index];
      if (!target || !action) {
        state.warnings.push(`${label}: no action ${index} from ${earlier} to change`);
      } else {
        // Its templates ("{col:martial-arts}") read this grant's owner.
        const evaluated = (value: unknown): unknown => {
          if (typeof value === "string" && value.includes("{")) return evaluate(`${label} change`, () => evaluateTemplate(value, scope)) ?? value;
          if (Array.isArray(value)) return value.map(evaluated);
          if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, evaluated(inner)]));
          return value;
        };
        const changed = { ...action, ...(evaluated(patch) as Record<string, unknown>) } as typeof action;
        target.feature = { ...target.feature, grantedActions: target.feature.grantedActions!.map((candidate, at) => (at === index ? changed : candidate)) };
      }
    }
    if (grant.weaponPatch) {
      const { grant: earlier, patch } = grant.weaponPatch;
      const target = weapons.find((entry) => entry.key.endsWith(`:${earlier}`));
      if (!target) state.warnings.push(`${label}: no weapon from ${earlier} to change`);
      else target.weapon = { ...target.weapon, ...patch };
    }
    // Wild Shape's known forms: added to the transform an earlier grant gave (once each).
    if (grant.formsOf) {
      const { grant: earlier, action: index, forms } = grant.formsOf;
      const target = features.find((entry) => entry.key.endsWith(`:${earlier}`));
      const action = target?.feature.grantedActions?.[index];
      if (!target || !action || action.kind !== "transform") {
        state.warnings.push(`${label}: no shapechange ${index} from ${earlier} to add a form to`);
      } else {
        const added = forms.filter((form) => !action.forms.some((existing) => existing.id === form.id));
        const changed = { ...action, forms: [...action.forms, ...added] };
        target.feature = { ...target.feature, grantedActions: target.feature.grantedActions!.map((candidate, at) => (at === index ? changed : candidate)) };
      }
    }
    if (grant.onHitOf) {
      const onHitOf = grant.onHitOf;
      // A rider's dice can be a template ("{mod:wis|min:1}d8").
      const riders = structuredClone(onHitOf.riders).map((rider) => {
        if (!("components" in rider)) return rider;
        const components = rider.components.map((component) => {
          if (!component.dice.includes("{")) return component;
          const dice = evaluate(`${label} rider dice`, () => evaluateTemplate(component.dice, scope));
          return dice === undefined ? component : { ...component, dice: String(dice) };
        });
        return { ...rider, components } as typeof rider;
      });
      if (onHitOf.action === undefined) {
        const target = weapons.find((entry) => entry.key.endsWith(`:${onHitOf.grant}`));
        if (!target) state.warnings.push(`${label}: no weapon from ${onHitOf.grant} to add to`);
        else target.weapon = { ...target.weapon, onHit: [...(target.weapon.onHit ?? []), ...riders] };
      } else {
        const target = features.find((entry) => entry.key.endsWith(`:${onHitOf.grant}`));
        const action = target?.feature.grantedActions?.[onHitOf.action];
        if (!target || !action || !("riders" in action || action.kind === "area-save" || action.kind === "save" || action.kind === "healing")) {
          state.warnings.push(`${label}: no action ${onHitOf.action} from ${onHitOf.grant} to add to`);
        } else {
          const existing = ("riders" in action ? action.riders : undefined) ?? [];
          const placed = riders.map((rider, index) => ({ ...rider, id: `${action.id}-rider-${existing.length + index + 1}` }));
          const grantedActions = target.feature.grantedActions!.map((candidate, index) =>
            (index === onHitOf.action ? { ...candidate, riders: [...existing, ...placed] } as typeof candidate : candidate));
          target.feature = { ...target.feature, grantedActions };
        }
      }
    }
    if (grant.pool) {
      const size = evaluate(`${label} pool`, () => evaluateNumber(grant.pool!.size, scope));
      if (size !== undefined) resources[grant.pool.id] = Math.max(0, size);
    }
    const adjust = grant.adjust;
    if (adjust) {
      if (adjust.speed !== undefined) speedBonus += evaluate(`${label} speed`, () => evaluateNumber(adjust.speed!, scope)) ?? 0;
      if (adjust.hpBonus !== undefined) hpBonus += evaluate(`${label} hit points`, () => evaluateNumber(adjust.hpBonus!, scope)) ?? 0;
      for (const [sense, range] of Object.entries(adjust.senses ?? {}) as Array<[keyof CreatureSenses, number]>) {
        senses[sense] = Math.max(senses[sense] ?? 0, range);
      }
      for (const mode of adjust.movementEqualToSpeed ?? []) movementModes.add(mode);
      if (adjust.saves === "all") for (const ability of ABILITIES) state.saves.add(ability);
      else for (const ability of adjust.saves ?? []) state.saves.add(ability);
      for (const condition of adjust.conditionImmunities ?? []) conditionImmunities.add(condition);
    }
  }

  // Spells: the choices', then the grants' (always prepared, and free casts), each cast with what gave it.
  const casters: SlotCaster[] = [];
  let spellcasting: { ability: Ability } | undefined;
  for (const [classId, classLevel] of state.classLevels) {
    const progression = progressionOf(state, classId);
    if (!progression) continue;
    casters.push({
      kind: progression.kind, classLevel,
      ...(progression.firstSlotsAt ? { firstSlotsAt: progression.firstSlotsAt } : {}),
      ...(progression.multiclassRounding ? { multiclassRounding: progression.multiclassRounding } : {})
    });
    spellcasting ??= { ability: progression.ability };
  }
  const picks: SpellPick[] = [...state.spellPicks];
  for (const { grant, owner } of live) {
    const ability = grantAbility(state, owner);
    for (const spell of grant.spells ?? []) picks.push({ spell, owner, ...(ability ? { ability } : {}), via: "always" });
    for (const free of grant.freeCasts ?? []) {
      picks.push({
        spell: free.spell, owner, ...(ability ? { ability } : {}), via: "free", freeCasts: free.uses,
        ...(free.pool || free.label || free.asAction || free.castAt ? { freeCast: { pool: free.pool, label: free.label, asAction: free.asAction, castAt: free.castAt } } : {})
      });
    }
  }
  // A character whose only spells are a feat's casts with that feat's ability.
  spellcasting ??= picks.find((pick) => pick.ability)?.ability ? { ability: picks.find((pick) => pick.ability)!.ability! } : undefined;
  const slots = spellSlots(casters);
  const highestSlot = Math.max(0, ...Object.keys(slots).map((id) => Number(id.slice("slot-".length))));
  const spells: BuiltSpell[] = [];
  const poolLabels: Record<string, string> = {};
  const placedSpells = new Set<string>();
  for (const pick of picks) {
    const source = sources.library.spell?.(pick.spell);
    if (!source) {
      state.warnings.push(`${pick.owner.name}: no library spell ${pick.spell}`);
      continue;
    }
    const slug = spellSlug(pick.spell);
    const cast = castAs(structuredClone(source) as SpellDefinition, pick.ability ?? spellcasting?.ability ?? "int", spellcasting?.ability);
    // A class's (or its subclass's) spell is one of that class's spells: a "Cleric cantrip", a "Sorcerer spell". A feat's,
    // chosen from one class's list (Magic Initiate's Cleric spells), counts as that class's.
    const spellClass = pick.owner.classId ? slugOf(pick.owner.classId) : pick.list;
    if (spellClass) cast.spellClass = spellClass;
    let id = `${pick.owner.idPrefix}-${slug}`;
    // A spell cast with slots: once, and only if there's a slot it can be cast with (a fighter's Magic Initiate spell
    // is its free cast alone).
    const slotted = pick.via !== "free" && (source.level === 0 || highestSlot >= source.level);
    // Known twice (Magic Initiate's, then the class's): the one placed is still the class's spell too.
    if (slotted && placedSpells.has(pick.spell) && cast.spellClass) {
      for (const entry of spells) if (entry.from === pick.spell && !entry.spell.spellClass) entry.spell = { ...entry.spell, spellClass: cast.spellClass };
    }
    if (slotted && !placedSpells.has(pick.spell)) {
      while (takenIds.has(id)) id = `${id}-2`;
      takenIds.add(id);
      placedSpells.add(pick.spell);
      spells.push({ key: `${pick.owner.key}:spell:${slug}`, spell: placedSpell(cast, id), from: pick.spell });
    }
    if (pick.freeCasts !== undefined && source.level > 0) {
      // At will (Spell Mastery): a copy that costs nothing. Otherwise a copy spending a pool of its own.
      const atWill = pick.freeCasts === "at-will";
      const uses = atWill ? Infinity : evaluate(`${pick.owner.name}: ${source.name} free casts`, () => evaluateNumber(pick.freeCasts as Template | number, scopeFor(pick.owner))) ?? 0;
      if (uses <= 0) continue;
      let freeId = `${pick.owner.idPrefix}-${slug}-${atWill ? "at-will" : "free"}`;
      while (takenIds.has(freeId)) freeId = `${freeId}-2`;
      takenIds.add(freeId);
      // Its own pool, named after the spell so the sheet reads "Magic missile free casts"; or a shared one (Divine
      // Intervention's), made once.
      const shared = pick.freeCast?.pool;
      let poolId = shared ?? `${slug}-free-casts`;
      while (!atWill && !shared && resources[poolId] !== undefined) poolId = `${poolId}-2`;
      const cost = atWill ? undefined : { resourceId: poolId, amount: 1 };
      const name = `${cast.name} (${atWill ? "at will" : pick.freeCast?.label ?? "free"})`;
      const { upcast: _upcast, resourceCost: _cost, ...rest } = cast;
      const strip = <A extends object>(action: A): A => {
        const { resourceCost: _actionCost, ...actionRest } = action as A & { resourceCost?: unknown };
        return actionRest as A;
      };
      const free: SpellDefinition = {
        ...rest,
        name,
        ...(cost ? { resourceCost: cost } : {}),
        ...(cast.action ? {
          action: { ...strip(cast.action), name, ...(cost ? { resourceCost: cost } : {}), ...(pick.freeCast?.asAction ? { actionType: "action" } : {}) } as SpellDefinition["action"]
        } : {}),
        ...(pick.freeCast?.asAction ? { castingTime: "action" as const } : {}),
        // At a higher level than its own: what that slot would add (it spends no slot, so no slot copies are made).
        ...(pick.freeCast?.castAt && pick.freeCast.castAt > source.level ? { castAt: pick.freeCast.castAt, ...(cast.upcast ? { upcast: cast.upcast } : {}) } : {})
      };
      spells.push({ key: `${pick.owner.key}:spell:${slug}:${atWill ? "at-will" : "free"}`, spell: placedSpell(free, freeId), from: pick.spell });
      if (cost && !(shared && resources[poolId] !== undefined)) {
        resources[poolId] = uses;
        poolLabels[poolId] = shared ? (pick.freeCast?.label ?? poolId) : `${cast.name} without a slot`;
      }
    }
  }
  // What features change about the spells (Agonizing Blast's Charisma on Eldritch Blast), on every copy of them.
  for (const { grant } of live) {
    for (const change of grant.spellChanges ?? []) {
      for (const entry of spells.filter((candidate) => candidate.from === change.spell)) entry.spell = changedSpell(entry.spell, change);
    }
  }
  spells.sort((a, b) => a.spell.level - b.spell.level || byName(a.spell.name, b.spell.name));

  // The Weapon Mastery feature says which weapons were chosen.
  const masteryNote = state.masteries.length
    ? `Mastered: ${state.masteries.map((kind) => {
      const known = sources.library.weaponKind?.(kind);
      return known ? `${known.name} (${known.mastery})` : kind;
    }).join(", ")}.`
    : undefined;
  for (const built of features) {
    if (!built.key.endsWith(":weapon-mastery")) continue;
    // The kinds chosen, for the engine (`weapon-mastery`) and for the DM (the note).
    const effects = (built.feature.effects ?? []).map((effect) => (effect.kind === "weapon-mastery" ? { ...effect, weapons: [...state.masteries] } : effect));
    built.feature = {
      ...built.feature,
      ...(built.feature.effects ? { effects } : {}),
      ...(masteryNote ? { description: [built.feature.description, masteryNote].filter(Boolean).join("\n\n") } : {})
    };
  }

  // Species: size, speed, type and senses (Phase 6); without one, a Medium humanoid walking 30 ft.
  const species: SpeciesDefinition | undefined = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  if (build.species && !species) state.warnings.push(`No species ${build.species.id}`);
  for (const [sense, range] of Object.entries(species?.senses ?? {}) as Array<[keyof CreatureSenses, number]>) {
    senses[sense] = Math.max(senses[sense] ?? 0, range);
  }
  const speed = (species?.speed ?? 30) + speedBonus;
  const movement: MovementProfile = { walk: speed };
  for (const mode of movementModes) movement[mode] = speed;

  // Hit points: the first class's die in full at 1st level, then the average (or the roll) of each level's class die.
  const conMod = abilityModifier(abilities.con);
  let maxHp = 0;
  build.levels.forEach((entry, index) => {
    const die = classOf(sources, entry.classId)?.hitDie ?? 8;
    const roll = index === 0 ? die : build.hp.method === "rolled" && build.hp.rolls?.[index - 1] ? Math.min(die, build.hp.rolls[index - 1]!) : die / 2 + 1;
    maxHp += Math.max(1, roll + conMod);
  });
  maxHp = Math.max(1, maxHp + hpBonus + (build.hp.adjust ?? 0));

  // Saves and skills, as bonuses.
  const saves: Partial<Record<Ability, number>> = {};
  for (const ability of ABILITIES) if (state.saves.has(ability)) saves[ability] = abilityModifier(abilities[ability]) + pb;
  const skills: Record<string, number> = {};
  for (const skill of [...state.skills].sort()) {
    skills[skill] = abilityModifier(abilities[skillAbility(skill)]) + (state.expertise.has(skill) ? 2 : 1) * pb;
  }

  // Spell slots, from every casting class.
  Object.assign(resources, slots);

  // The classes, in the order the character took them.
  const classes: BuiltFields["classes"] = [...state.classLevels].map(([classId, classLevel]) => {
    const definition = classOf(sources, classId)!;
    const subclass = state.subclassOf.get(classId);
    return { id: classId, name: definition.name, level: classLevel, ...(subclass ? { subclass: { id: subclass.id, name: subclass.name } } : {}) };
  });

  // The starting packages (the first class's, and the background's).
  const equipment: BuiltCharacter["equipment"] = [];
  const addPackage = (packages: ClassDefinition["startingEquipment"], option: string | undefined) => {
    const chosen = option ? packages?.find((entry) => entry.id === option) : undefined;
    if (option && !chosen) state.warnings.push(`No equipment option ${option}`);
    for (const item of chosen?.items ?? []) {
      if (!equipment.some((existing) => existing.ref === item.ref)) equipment.push({ ref: item.ref, count: item.count ?? 1 });
    }
  };
  addPackage(firstClass?.startingEquipment, build.equipment?.classOption);
  // A 2014 class's lines: each line's pick, and the weapons chosen where it asks.
  if (firstClass?.equipmentLines?.length) {
    for (const item of equipmentLineItems(build, firstClass, sources)) {
      const existing = equipment.find((entry) => entry.ref === item.ref);
      if (existing) existing.count += item.count ?? 1;
      else equipment.push({ ref: item.ref, count: item.count ?? 1 });
    }
  }
  const backgroundDefinition = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  addPackage(backgroundDefinition?.equipment, build.equipment?.backgroundOption);

  return {
    fields: {
      level: characterLevel,
      classes,
      abilities,
      maxHp,
      proficiencyBonus: pb,
      armorClass: 10 + abilityModifier(abilities.dex),
      speed,
      movement,
      size: build.species?.size ?? species?.sizes[0] ?? "medium",
      type: species?.type ?? "humanoid",
      senses,
      saves,
      skills,
      conditionImmunities: [...conditionImmunities].sort(),
      ...(spellcasting ? { spellcasting } : {}),
      defaultTactics: firstClass?.suggested.tactics ?? "basic-melee",
      ...(firstClass?.suggested.stance ? { defaultResourceStance: firstClass.suggested.stance } : {})
    },
    features,
    weapons,
    spells,
    resources,
    poolLabels,
    equipment,
    masteries: state.masteries,
    choices: state.choices,
    warnings: state.warnings
  };
}

/* ── suggestions ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The build with every pending choice given the builder's suggestion (plan D7): Quick build. Choices can open further
 * choices (a subclass's, a feat's), so it fills, rebuilds and fills again until nothing pending has a suggestion.
 */
export function withSuggestions(build: CharacterBuild, sources: BuildSources): CharacterBuild {
  // One choice at a time, in order: each suggestion sees the ones before it (the second Ability Score Improvement
  // knows what the first raised), and a choice can open further ones (a subclass's, a feat's).
  let next = build;
  // A slot is tried once with the value it has: a suggestion that leaves it open (too few skills left to pick) isn't
  // tried again, but a slot a later choice reopened (a spell a 3rd-level grant now makes always prepared) is.
  const tried = new Set<string>();
  const triedKey = (slot: ChoiceSlot) => `${slotKey(slot)}|${JSON.stringify(slot.value ?? null)}`;
  for (let step = 0; step < 400; step += 1) {
    const slot = buildCharacter(next, sources).choices.find((candidate) =>
      candidate.pending && candidate.suggestion !== undefined && !tried.has(triedKey(candidate)));
    if (!slot) return next;
    tried.add(triedKey(slot));
    const merged = mergeSuggestion(slot);
    if (merged !== undefined) next = withChoice(next, slot.scope, slot.path, merged, slot.spec);
  }
  return next;
}

const slotKey = (slot: ChoiceSlot) => `${JSON.stringify(slot.scope)}|${slot.path.join("/")}`;

/** A slot's value once its suggestion completes it: what the "Suggest" button sets. */
export function suggestedValue(slot: ChoiceSlot): ChoiceValue | undefined {
  return mergeSuggestion(slot);
}

/** A suggestion completes what's there, never replaces a valid part of it. */
function mergeSuggestion(slot: ChoiceSlot): ChoiceValue | undefined {
  const { value, suggestion, spec } = slot;
  if (suggestion === undefined) return undefined;
  if (Array.isArray(suggestion)) {
    const kept = Array.isArray(value) ? value : [];
    const count = "count" in spec && spec.count !== undefined ? spec.count : suggestion.length + kept.length;
    const combined = [...kept, ...suggestion.filter((item) => !kept.includes(item))];
    return combined.slice(0, Math.max(count, kept.length));
  }
  if (spec.kind === "feat") {
    return value ?? suggestion;
  }
  if (spec.kind === "abilities") {
    const current = (value ?? {}) as Partial<Record<Ability, number>>;
    const used = Object.values(current).reduce((sum, amount) => sum + (amount ?? 0), 0);
    if (used === 0) return suggestion;
    return current;
  }
  return value ?? suggestion;
}
