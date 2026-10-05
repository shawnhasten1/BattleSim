import {
  abilityModifier,
  type Ability,
  type ConditionImmunity,
  type CreatureSenses,
  type CreatureType,
  type FeatureDefinition,
  type ItemDefinition,
  type MovementProfile,
  type ResourceStance,
  type SizeCategory,
  type TacticsProfile,
  type WeaponDefinition
} from "@/engine";
import { SKILLS, skillName } from "@/lib/actor-sheet/edits";
import type {
  BackgroundDefinition,
  Catalog,
  ChoiceSpec,
  ClassDefinition,
  ClassTableColumn,
  FeatDefinition,
  FeatureGrant,
  PickOption,
  SpeciesDefinition,
  SubclassDefinition
} from "./catalog";
import type { CharacterBuild, ChoiceValue, FeatChoice } from "./build-record";
import { spellSlots } from "./slots";
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
  /** Pools the builder sizes: a feature's (`rage`, `second-wind`) and spell slots (`slot-1`…). */
  resources: Record<string, number>;
  /** The starting packages' weapons and armor, as library ids: put on the actor once, on its first build. */
  equipment: Array<{ ref: string; count: number }>;
  /** Weapon kinds mastered. */
  masteries: string[];
  choices: ChoiceSlot[];
  warnings: string[];
}

export const pbForLevel = (level: number) => 2 + Math.floor((Math.max(level, 1) - 1) / 4);
const slugOf = (id: string) => id.slice(id.lastIndexOf(":") + 1);
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
    count: "count" in spec ? spec.count : 1, options: []
  };
  const offer = fixed === undefined;
  const priority = priorityOf(state);
  const suggestionsOf = context.classDefinition?.suggested ?? classOf(state.sources, state.build.levels[0]?.classId ?? "")?.suggested;

  switch (spec.kind) {
    case "subclass": {
      const classId = context.owner.classId;
      const options = state.sources.catalog.subclasses.filter((entry) => entry.classId === classId);
      slot.options = options.map((entry) => ({ id: entry.id, name: entry.name, detail: entry.source.documentName }));
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
      const chosen = (asStrings(stored) ?? []).filter((id) => {
        const ok = spec.options.some((option) => option.id === id);
        if (!ok) slot.problem = `${id} isn't an option`;
        return ok;
      }).slice(0, spec.count);
      slot.options = spec.options.map((option) => ({ id: option.id, name: option.name, ...(option.description ? { detail: option.description } : {}) }));
      slot.suggestion = spec.options.slice(0, spec.count).map((option) => option.id);
      if (stored !== undefined) slot.value = chosen;
      slot.pending = chosen.length < spec.count;
      if (offer) state.choices.push(slot);
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
      // Spells arrive in Phase 5: the choice is listed, but nothing is offered yet.
      slot.pending = false;
      break;
  }
  if (offer) state.choices.push(slot);
}

function visitOption(state: WalkState, option: PickOption, pick: Extract<ChoiceSpec, { kind: "pick" }>, context: ChoiceContext, parentPath: string[]) {
  if (option.feat) {
    const feat = featOf(state.sources, option.feat);
    if (feat) takeFeat(state, feat, undefined, context, [...parentPath, `${pick.id}.${option.id}`]);
    return;
  }
  const owner: Owner = { ...context.owner, key: `${context.owner.key}:${pick.id}=${option.id}` };
  for (const grant of option.grants) state.grants.push({ grant, owner });
  for (const nested of option.choices ?? []) {
    visitChoice(state, { ...nested, id: `${pick.id}.${option.id}.${nested.id}` } as ChoiceSpec, { ...context, owner }, parentPath);
  }
}

function visitFeatChoice(state: WalkState, spec: Extract<ChoiceSpec, { kind: "feat" }>, stored: ChoiceValue | undefined, slot: ChoiceSlot, context: ChoiceContext, path: string[]) {
  const level = context.characterLevel ?? state.build.levels.length;
  const eligible = state.sources.catalog.feats.filter((feat) =>
    spec.categories.includes(feat.category)
    && (feat.repeatable || !state.feats.has(feat.id))
    && meetsPrerequisite(state, feat, level));
  const suggested = context.classDefinition?.suggested;
  const pickSuggestion = (): string | undefined => {
    const wanted = spec.categories.includes("epic-boon") ? suggested?.epicBoon
      : spec.categories.includes("fighting-style") ? suggested?.fightingStyle
      : spec.categories.includes("general") ? "srd:feat:ability-score-improvement"
      : spec.categories.includes("origin") ? "srd:feat:skilled" : undefined;
    return eligible.find((feat) => feat.id === wanted)?.id ?? eligible[0]?.id;
  };
  const suggestedFeat = pickSuggestion();
  slot.options = eligible.map((feat) => ({ id: feat.id, name: feat.name, detail: feat.category }));
  slot.suggestion = suggestedFeat ? { feat: suggestedFeat } : undefined;
  const choice = stored && typeof stored === "object" && !Array.isArray(stored) && "feat" in stored ? (stored as FeatChoice) : undefined;
  if (!choice) return;
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
    ...(background?.equipment?.find((entry) => entry.id === build.equipment?.backgroundOption)?.items ?? [])
  ].map((item) => item.ref).filter((ref) => ref.startsWith("srd:weapon:"));
  const kinds = refs.map((ref) => sources.library.weapon(ref)?.baseWeapon ?? ref.slice("srd:weapon:".length));
  return kinds.filter((kind, index) => kinds.indexOf(kind) === index);
}

/** Walk the whole build in order: background, then each level, gathering grants and choices. */
function walk(build: CharacterBuild, sources: BuildSources): WalkState & { classLevels: Map<string, number>; subclassOf: Map<string, SubclassDefinition> } {
  const state: WalkState & { classLevels: Map<string, number>; subclassOf: Map<string, SubclassDefinition> } = {
    build, sources,
    abilities: { ...build.abilities.base },
    skills: new Set(), expertise: new Set(), masteries: [], carriedKinds: carriedKindsOf(build, sources), feats: new Map(),
    grants: [], choices: [], warnings: [], saves: new Set(),
    classLevels: new Map(), subclassOf: new Map()
  };

  // The background: its ability increases, its skills and its origin feat.
  const background = build.background.id
    ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id)
    : undefined;
  if (build.background.id && !background) state.warnings.push(`No background ${build.background.id}`);
  const custom = build.background.custom;
  const backgroundAbilities = background?.abilities ?? (custom?.abilities as BackgroundDefinition["abilities"] | undefined) ?? [];
  const backgroundName = background?.name ?? (custom ? "Custom background" : "No background");
  const backgroundOwner: Owner = { key: `background:${background?.id ?? "custom"}`, idPrefix: "background", name: backgroundName, level: build.levels.length, columns: [] };
  const backgroundContext: ChoiceContext = { scope: { kind: "background" }, owner: backgroundOwner, ownerName: backgroundName, where: "background", fixed: background?.featChoices as Record<string, ChoiceValue> | undefined };
  if (backgroundAbilities.length) {
    visitChoice(state, { kind: "abilities", id: "increases", label: "Ability score increases", points: 3, from: [...backgroundAbilities], maxPerAbility: 2, cap: 20 }, backgroundContext);
  }
  for (const skill of background?.skills ?? custom?.skills ?? []) state.skills.add(skill);
  const originFeat = featOf(sources, background?.feat ?? custom?.feat ?? "");
  if (originFeat) {
    takeFeat(state, originFeat, { feat: originFeat.id, choices: build.background.choices }, backgroundContext, []);
  } else if (background?.feat ?? custom?.feat) {
    state.warnings.push(`No feat ${background?.feat ?? custom?.feat}`);
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
    // A character's first level gives its class's skills; the builder asks for them as that level's first choice.
    if (index === 0 && definition.skills.count > 0) {
      visitChoice(state, { kind: "skills", id: "class-skills", count: definition.skills.count, from: definition.skills.from }, context);
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
    if (classLevel === 19) {
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
  });
  return state;
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

/** A feature as it goes on the actor: its own id, its granted actions' ids after it, pointing back at it. */
function placedFeature(feature: FeatureDefinition, id: string): FeatureDefinition {
  const grantedActions = feature.grantedActions?.map((action, index) => {
    const actionId = `${id}-granted-${index + 1}`;
    return "featureId" in action ? { ...action, id: actionId, featureId: id } : { ...action, id: actionId };
  });
  return { ...feature, id, ...(grantedActions ? { grantedActions } : {}) };
}

export function buildCharacter(build: CharacterBuild, sources: BuildSources): BuiltCharacter {
  const state = walk(build, sources);
  const firstClass = classOf(sources, build.levels[0]?.classId ?? "");
  const characterLevel = build.levels.length;
  const pb = pbForLevel(characterLevel);

  // Grants that a later one replaces drop out, within the same class (and its subclass).
  const replaced = new Set<string>();
  for (const collected of state.grants) {
    if (collected.grant.replaces) replaced.add(`${collected.owner.classId ?? collected.owner.key}|${collected.grant.replaces}`);
  }
  const live = state.grants.filter((collected) => !replaced.has(`${collected.owner.classId ?? collected.owner.key}|${collected.grant.key}`));

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
        const feature = structuredClone(source) as FeatureDefinition;
        const scaled: string[] = [];
        for (const binding of (grant.scale ?? []).filter((candidate) => !candidate.path.startsWith("weapon."))) {
          const value = evaluate(`${label} ${binding.path}`, () => evaluateTemplate(binding.value, scope));
          if (value === undefined) continue;
          if (setPath(feature, binding.path, value)) scaled.push(binding.path);
          else state.warnings.push(`${label}: no ${binding.path} to scale`);
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
    if (grant.onHitOf) {
      const target = weapons.find((entry) => entry.key.endsWith(`:${grant.onHitOf!.grant}`));
      if (!target) state.warnings.push(`${label}: no weapon from ${grant.onHitOf.grant} to add to`);
      else target.weapon = { ...target.weapon, onHit: [...(target.weapon.onHit ?? []), ...structuredClone(grant.onHitOf.riders)] };
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

  // Spell slots, from every casting class (Phase 5 brings the spells themselves).
  const casters: Array<{ kind: "full" | "half" | "third" | "pact"; classLevel: number }> = [];
  let spellcasting: { ability: Ability } | undefined;
  for (const [classId, classLevel] of state.classLevels) {
    const definition = classOf(sources, classId)!;
    const progression = definition.spellcasting ?? state.subclassOf.get(classId)?.spellcasting;
    if (!progression) continue;
    casters.push({ kind: progression.kind, classLevel });
    spellcasting ??= { ability: progression.ability };
  }
  Object.assign(resources, spellSlots(casters));

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
    resources,
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
  const tried = new Set<string>();
  for (let step = 0; step < 400; step += 1) {
    const slot = buildCharacter(next, sources).choices.find((candidate) =>
      candidate.pending && candidate.suggestion !== undefined && !tried.has(slotKey(candidate)));
    if (!slot) return next;
    const merged = mergeSuggestion(slot);
    const filled = merged === undefined ? next : withChoice(next, slot.scope, slot.path, merged, slot.spec);
    // A suggestion that still leaves the choice open (too few skills left to pick) isn't tried again.
    tried.add(slotKey(slot));
    next = filled;
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
    const count = "count" in spec ? spec.count : suggestion.length + kept.length;
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
