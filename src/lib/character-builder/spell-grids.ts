import type { BuildSources, BuiltCharacter, ChoiceOption, ChoiceSlot } from "./build";
import type { CharacterBuild } from "./build-record";
import type { SpellsChoice } from "./catalog";
import { spellFacts, type SpellFacts } from "./describe";

/*
 * The Spells step's grids (CHARACTER_BUILDER_UX_PLAN.md D4, §3.4), as a model with no UI: each spell choice keeps its own
 * grid and is stored as today. What changes is how a grid reads: its picks first, its levels highest first, what the
 * character already has tucked away with the reason, shared filters; "Your spells" over all of them; and which grid opens
 * next once one is done.
 */

/** A spell choice's stable key: where it's stored. */
export const spellSlotKey = (slot: Pick<ChoiceSlot, "scope" | "path">) =>
  `${slot.scope.kind}${slot.scope.kind === "level" ? `:${slot.scope.index}` : ""}|${slot.path.join("/")}`;

const isSpells = (slot: ChoiceSlot): slot is ChoiceSlot & { spec: SpellsChoice } => slot.spec.kind === "spells";
const asList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

/** The filters every grid shares. */
export interface SpellFilters {
  query: string;
  school: string;
  cost: "all" | SpellFacts["cost"];
  /** Only spells the simulator runs (D8). */
  runs: boolean;
  concentration: boolean;
  ritual: boolean;
}

export const NO_FILTERS: SpellFilters = { query: "", school: "all", cost: "all", runs: false, concentration: false, ritual: false };

export const filtersOn = (filters: SpellFilters) =>
  Boolean(filters.query.trim()) || filters.school !== "all" || filters.cost !== "all" || filters.runs || filters.concentration || filters.ritual;

/** Whether a spell passes the filters. A reference-only option never "runs". */
export function passesFilters(facts: SpellFacts | undefined, option: Pick<ChoiceOption, "name" | "reference">, filters: SpellFilters): boolean {
  const query = filters.query.trim().toLowerCase();
  if (query && !option.name.toLowerCase().includes(query)) return false;
  if (!facts) return !filtersOn({ ...filters, query: "" });
  if (filters.school !== "all" && facts.school !== filters.school) return false;
  if (filters.cost !== "all" && facts.cost !== filters.cost) return false;
  if (filters.runs && (option.reference || facts.support === "manual")) return false;
  if (filters.concentration && !facts.concentration) return false;
  if (filters.ritual && !facts.ritual) return false;
  return true;
}

/** One spell in a grid. */
export interface GridTile {
  id: string;
  name: string;
  level: number;
  facts?: SpellFacts;
  /** The simulator doesn't cast it: it goes on the actor as its text (D8). */
  reference: boolean;
  edition?: ChoiceOption["edition"];
  /** Why it can't be chosen here (tucked away): "already in the spellbook", "always prepared (Life Domain)". */
  reason?: string;
}

export interface GridView {
  key: string;
  count: number;
  /** The slot's picks, in the order chosen. */
  chosen: GridTile[];
  /** The rest it can choose, by spell level, highest first, as the filters leave them. */
  levels: Array<{ level: number; tiles: GridTile[] }>;
  /** What the character already has, tucked away, each with its reason. */
  tucked: GridTile[];
  /** How many choosable spells the filters hide. */
  hidden: number;
  full: boolean;
  /** The highest spell level it offers: 0 for cantrips. */
  top: number;
  /** Prepared from a spellbook, or from a list. */
  what: SpellsChoice["what"];
}

const tileOf = (option: ChoiceOption, sources: BuildSources): GridTile => {
  const facts = spellFacts(option.id, sources);
  return {
    id: option.id, name: option.name, level: option.level ?? facts?.level ?? 0, reference: Boolean(option.reference),
    ...(facts ? { facts } : {}), ...(option.edition ? { edition: option.edition } : {}), ...(option.taken ? { reason: option.detail ?? "already had" } : {})
  };
};

/**
 * A spell choice's grid: its picks split out as "chosen", what it can still choose by spell level from the highest down,
 * and what the character already has tucked away with the reason. `options` is the slot's options as the edition filter
 * leaves them (default: all of them).
 */
export function gridView(slot: ChoiceSlot, filters: SpellFilters, sources: BuildSources, options: readonly ChoiceOption[] = slot.options): GridView {
  if (!isSpells(slot)) throw new Error("gridView: not a spell choice");
  const picked = asList(slot.value);
  const byId = new Map(slot.options.map((option) => [option.id, option]));
  const chosen = picked.map((id) => byId.get(id)).filter((option): option is ChoiceOption => Boolean(option)).map((option) => tileOf({ ...option, taken: false }, sources));
  const rest = options.filter((option) => !picked.includes(option.id));
  const tucked = rest.filter((option) => option.taken).map((option) => tileOf(option, sources));
  const open = rest.filter((option) => !option.taken).map((option) => tileOf(option, sources));
  const shown = open.filter((tile) => passesFilters(tile.facts, { name: tile.name, reference: tile.reference }, filters));
  const levels = [...new Set(shown.map((tile) => tile.level))].sort((a, b) => b - a)
    .map((level) => ({ level, tiles: shown.filter((tile) => tile.level === level).sort((a, b) => a.name.localeCompare(b.name)) }));
  const top = Math.max(0, ...slot.options.map((option) => option.level ?? 0));
  return {
    key: spellSlotKey(slot), count: slot.count, chosen, levels, tucked, hidden: open.length - shown.length,
    full: picked.length >= slot.count, top, what: slot.spec.what
  };
}

/**
 * The spell choice that opens next: the first still open after `after` (by key, in the build's order), else the first
 * still open before it. Undefined when every one is made.
 */
export function nextOpenSpellSlot(choices: readonly ChoiceSlot[], after?: string): ChoiceSlot | undefined {
  const spells = choices.filter(isSpells);
  const at = after ? spells.findIndex((slot) => spellSlotKey(slot) === after) : -1;
  const ordered = at >= 0 ? [...spells.slice(at + 1), ...spells.slice(0, at)] : spells;
  return ordered.find((slot) => slot.pending);
}

/** The spell choices in groups by what asks for them: the background, the species or race, each level, in order. */
export interface SpellGroup {
  key: string;
  label: string;
  slots: ChoiceSlot[];
}

export function spellGroups(build: CharacterBuild, built: BuiltCharacter, sources: BuildSources): SpellGroup[] {
  const groups: SpellGroup[] = [];
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  const classLevels = new Map<string, number>();
  const levelNames = build.levels.map((entry) => {
    const level = (classLevels.get(entry.classId) ?? 0) + 1;
    classLevels.set(entry.classId, level);
    return `${sources.catalog.classes.find((candidate) => candidate.id === entry.classId)?.name ?? "Class"} ${level}`;
  });
  for (const slot of built.choices.filter(isSpells)) {
    const key = slot.scope.kind === "level" ? `level:${slot.scope.index}` : slot.scope.kind;
    const label = slot.scope.kind === "level" ? `Level ${slot.scope.index + 1} · ${levelNames[slot.scope.index] ?? ""}`
      : slot.scope.kind === "background" ? `Background · ${background?.name ?? "Custom"}${slot.owner && slot.owner !== background?.name ? ` · ${slot.owner}` : ""}`
        : `${species?.edition === "2014" ? "Race" : "Species"} · ${species?.name ?? ""}`;
    const last = groups[groups.length - 1];
    if (last?.key === key) last.slots.push(slot);
    else groups.push({ key, label, slots: [slot] });
  }
  return groups;
}

/** A spell the character has, as "Your spells" lists it. */
export interface YourSpell {
  id: string;
  name: string;
  level: number;
  facts?: SpellFacts;
  /** Prepared: castable with slots (a cantrip, a prepared or always-prepared spell). A spellbook spell may not be. */
  prepared: boolean;
  /** Always prepared, and what makes it so ("Life Domain", "Magic Initiate"). Locked: no grid holds it. */
  always?: string;
  /** Cast without a slot, and what lets it ("Magic Initiate"). */
  free?: string;
  /** The grids that chose it, by key: clicking it opens the first. */
  slots: string[];
}

/** What owns a built record, by its key's prefix (`subclass:srd:subclass:life-domain:spell:bless` → "Life Domain"). */
function ownerOf(key: string, build: CharacterBuild, sources: BuildSources): string {
  const owner = key.slice(0, key.indexOf(":spell:"));
  const [kind] = owner.split(":");
  const id = owner.slice(kind!.length + 1).split(/[@:]/)[0]!;
  const id2 = owner.slice(kind!.length + 1).replace(/@.*$/, "");
  if (kind === "class") return sources.catalog.classes.find((entry) => owner.startsWith(`class:${entry.id}`))?.name ?? id;
  if (kind === "subclass") return sources.catalog.subclasses.find((entry) => owner.startsWith(`subclass:${entry.id}`))?.name ?? id;
  if (kind === "species") return sources.catalog.species.find((entry) => owner.startsWith(`species:${entry.id}`))?.name ?? id;
  if (kind === "feat") return sources.catalog.feats.find((entry) => id2.startsWith(entry.id))?.name ?? id;
  if (kind === "background") return sources.catalog.backgrounds.find((entry) => entry.id === build.background.id)?.name ?? "Background";
  return id;
}

/**
 * Every spell the character has (D4's "Your spells"), each once, by spell level: what it chose (linked to the grids that
 * chose it, prepared or only in the spellbook), and what it's given (always prepared, or cast without a slot, with
 * what gives it).
 */
export function yourSpells(build: CharacterBuild, built: BuiltCharacter, sources: BuildSources): Array<{ level: number; spells: YourSpell[] }> {
  const spells = new Map<string, YourSpell>();
  const add = (id: string, fill: Partial<YourSpell> & { slot?: string }) => {
    const facts = spellFacts(id, sources);
    const known = spells.get(id) ?? {
      id, name: facts?.name ?? sources.library.spell?.(id)?.name ?? id, level: facts?.level ?? sources.library.spell?.(id)?.level ?? 0,
      ...(facts ? { facts } : {}), prepared: false, slots: []
    };
    if (fill.slot && !known.slots.includes(fill.slot)) known.slots.push(fill.slot);
    if (fill.prepared) known.prepared = true;
    if (fill.always && !known.always) known.always = fill.always;
    if (fill.free && !known.free) known.free = fill.free;
    spells.set(id, known);
  };
  for (const slot of built.choices.filter(isSpells)) {
    const key = spellSlotKey(slot);
    const free = slot.spec.freeCasts !== undefined;
    for (const id of asList(slot.value)) {
      add(id, {
        slot: key,
        prepared: slot.spec.what !== "spellbook" && !(free && (slot.spec.from === "spellbook" || slot.spec.from === "held")),
        ...(slot.spec.alwaysPrepared ? { always: slot.owner } : {}),
        ...(free ? { free: slot.owner } : {})
      });
    }
  }
  // Granted spells: always prepared (a domain's), or a free cast's copy; never in a grid.
  for (const entry of built.spells) {
    const owner = ownerOf(entry.key, build, sources);
    const isFree = /:(free|at-will)$/.test(entry.key);
    if (spells.has(entry.from)) {
      const known = spells.get(entry.from)!;
      if (isFree && !known.free) known.free = owner;
      known.prepared ||= !isFree;
      continue;
    }
    add(entry.from, isFree ? { free: owner } : { prepared: true, always: owner });
  }
  const levels = [...new Set([...spells.values()].map((spell) => spell.level))].sort((a, b) => a - b);
  return levels.map((level) => ({
    level,
    spells: [...spells.values()].filter((spell) => spell.level === level).sort((a, b) => a.name.localeCompare(b.name))
  }));
}
