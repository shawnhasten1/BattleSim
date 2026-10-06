import { describe, expect, it } from "vitest";
import {
  blankCharacter,
  buildCharacter,
  catalogFile,
  entryLabel,
  homebrewId,
  mergeCatalog,
  missingFromCatalog,
  parseCatalogEntry,
  quickBuild,
  readBuild,
  readCatalogFile,
  rebuildActor,
  withLevelUp,
  withSuggestions,
  type CatalogEntry,
  type CharacterBuild,
  type ClassDefinition,
  type SubclassDefinition
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { creatureDefinitionSchema, type CreatureDefinition } from "@/engine";

/** PC builder plan, Phase 8a: homebrew entries, checked, merged after the SRD's, and in a file. */

const homebrew = { provider: "homebrew" as const };
const third = [0, 0, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
const rising = (from: number) => Array.from({ length: 20 }, (_, index) => (index + 1 >= from ? Math.min(13, 3 + Math.floor((index + 1 - from) / 2)) : 0));

/** A third caster on the SRD Rogue, with a feature that follows a column of its own and one that replaces it. */
const arcanist: SubclassDefinition = {
  id: "homebrew:subclass:shadow-arcanist",
  name: "Shadow Arcanist",
  source: homebrew,
  edition: "2024",
  classId: "srd:class:rogue",
  spellcasting: { ability: "int", kind: "third", list: "wizard", cantrips: [0, 0, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], prepared: rising(3) },
  table: [{ id: "veil", label: "Veil", values: third }],
  levels: [
    {
      level: 3,
      grants: [{
        key: "veil",
        feature: { id: "veil", name: "Veil of Shadows", category: "feature", automationSupport: "manual-only", description: "Shadows cling to you." },
        pool: { id: "veil", size: "{col:veil}" }
      }]
    },
    {
      level: 9,
      grants: [{
        key: "deep-veil",
        replaces: "veil",
        feature: { id: "deep-veil", name: "Deep Veil", category: "feature", automationSupport: "manual-only", description: "Deeper shadows." },
        pool: { id: "veil", size: "{col:veil}" }
      }]
    }
  ]
};

/** A homebrew class with a spell list of its own, a column-scaled feature, and its own subclass. */
const gunslinger: ClassDefinition = {
  id: "homebrew:class:gunslinger",
  name: "Gunslinger",
  source: homebrew,
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["dex"],
  saves: ["dex", "wis"],
  skills: { count: 2, from: ["acrobatics", "perception", "insight"] },
  weaponProficiency: ["simple"],
  armorTraining: ["light"],
  spellcasting: {
    ability: "wis", kind: "half", list: "gunslinger",
    spells: ["srd:spell:cure-wounds-2024", "srd:spell:faerie-fire-2024", "srd:spell:web-2024", "srd:spell:fire-bolt-2024"],
    cantrips: Array.from({ length: 20 }, () => 1),
    prepared: Array.from({ length: 20 }, (_, index) => Math.min(3, 1 + Math.floor(index / 4)))
  },
  subclassLevel: 3,
  subclassLabel: "Gunslinger Path",
  featLevels: [4, 8, 12, 16, 19],
  table: [{ id: "grit", label: "Grit", values: Array.from({ length: 20 }, (_, index) => 2 + Math.floor(index / 5)) }],
  levels: [
    {
      level: 1,
      grants: [{
        key: "grit",
        feature: { id: "grit", name: "Grit", category: "feature", automationSupport: "manual-only", description: "Grit points." },
        pool: { id: "grit", size: "{col:grit}" }
      }]
    },
    { level: 3, grants: [], choices: [{ kind: "subclass", id: "subclass" }] }
  ],
  suggested: { abilities: ["dex", "wis", "con", "str", "int", "cha"], tactics: "basic-ranged" }
};

const deadeye: SubclassDefinition = {
  id: "homebrew:subclass:deadeye",
  name: "Deadeye",
  source: homebrew,
  edition: "2024",
  classId: "homebrew:class:gunslinger",
  levels: [{ level: 3, grants: [{ key: "steady", feature: { id: "steady", name: "Steady Hand", category: "feature", automationSupport: "manual-only" } }] }]
};

const entries: CatalogEntry[] = [
  { kind: "subclass", entry: arcanist },
  { kind: "class", entry: gunslinger },
  { kind: "subclass", entry: deadeye }
];
const sources = mergeCatalog(SRD_BUILD_SOURCES, entries);

/** Levels a character from 1 to `to` as the Level up window does: one level, suggestions, a rebuild, each time. */
function levelUp(classId: string, to: number, subclass?: string): { actor: CreatureDefinition; warnings: string[] } {
  let build = quickBuild(sources, { classId, level: 1 });
  let actor = rebuildActor(blankCharacter("pc", "Hero"), build, sources).definition;
  const warnings: string[] = [];
  for (let level = 2; level <= to; level += 1) {
    build = withLevelUp(readBuild(actor)!);
    if (subclass && level === 3) build = { ...build, levels: build.levels.map((entry, index) => (index === 2 ? { ...entry, choices: { ...entry.choices, subclass } } : entry)) };
    build = withSuggestions(build, sources);
    const result = rebuildActor(actor, build, sources);
    warnings.push(...result.warnings.map((warning) => `level ${level}: ${warning}`));
    actor = result.definition;
  }
  return { actor, warnings };
}

describe("homebrew entries", () => {
  it("are checked by their kind's schema, and an srd: id or a broken grant is turned down with where", () => {
    expect(parseCatalogEntry({ kind: "class", entry: gunslinger }).entry).toEqual({ kind: "class", entry: gunslinger });
    expect(parseCatalogEntry({ kind: "class", entry: { ...gunslinger, id: "srd:class:gunslinger" } }).problem).toMatch(/srd:/);
    expect(parseCatalogEntry({ kind: "spell", entry: gunslinger }).problem).toMatch(/unknown kind/);
    const broken = { ...gunslinger, levels: [{ level: 1, grants: [{ feature: "srd:feature:rage" }] }] };
    expect(parseCatalogEntry({ kind: "class", entry: broken }).problem).toMatch(/levels\.0\.grants\.0\.key/);
  });

  it("join the SRD's after it, a same-named one kept apart and shown with its source", () => {
    const rogue: ClassDefinition = { ...gunslinger, id: "homebrew:class:rogue", name: "Rogue" };
    const merged = mergeCatalog(SRD_BUILD_SOURCES, [{ kind: "class", entry: rogue }]);
    const rogues = merged.catalog.classes.filter((entry) => entry.name === "Rogue");
    expect(rogues.map((entry) => entry.id)).toEqual(["srd:class:rogue", "homebrew:class:rogue"]);
    expect(rogues.map(entryLabel)).toEqual(["Rogue", "Rogue (Homebrew)"]);
    expect(entryLabel({ name: "Marshal", source: { provider: "open5e", documentName: "Adventurer's Guide" } })).toBe("Marshal (Adventurer's Guide)");
    // Nothing to add: the SRD's sources as they are, so their caches stay warm.
    expect(mergeCatalog(SRD_BUILD_SOURCES, [])).toBe(SRD_BUILD_SOURCES);
  });

  it("get ids of their own that don't clash", () => {
    expect(homebrewId("class", "Spiritbound Marksman", [])).toBe("homebrew:class:spiritbound-marksman");
    expect(homebrewId("class", "Gunslinger", ["homebrew:class:gunslinger", "homebrew:class:gunslinger-2"])).toBe("homebrew:class:gunslinger-3");
  });

  it("can bring a spell list of their own", () => {
    expect(sources.library.spellsOn?.("gunslinger")).toEqual(gunslinger.spellcasting!.spells);
    expect(sources.library.spellsOn?.("wizard")).toEqual(SRD_BUILD_SOURCES.library.spellsOn?.("wizard"));
    const { actor } = levelUp("homebrew:class:gunslinger", 5);
    // The class's own (the background's Magic Initiate brings a cleric cantrip besides).
    const spells = (actor.spells ?? []).filter((spell) => spell.spellClass === "gunslinger").map((spell) => spell.name);
    expect(spells.length).toBeGreaterThan(0);
    const own = new Set(gunslinger.spellcasting!.spells!.map((id) => sources.library.spell?.(id)?.name));
    for (const name of spells) expect(own.has(name), name).toBe(true);
  });
});

describe("a homebrew subclass on an SRD class", () => {
  it("levels from 1 to 20 as a third caster, its pool following its column, a replaced feature gone", { timeout: 60000 }, () => {
    const { actor, warnings } = levelUp("srd:class:rogue", 20, arcanist.id);
    expect(warnings).toEqual([]);
    expect(creatureDefinitionSchema.safeParse(actor).success).toBe(true);
    const names = (actor.features ?? []).map((feature) => feature.name);
    expect(names).toContain("Deep Veil");
    expect(names).not.toContain("Veil of Shadows");
    expect(names).toContain("Sneak Attack");
    expect(actor.resources?.veil).toBe(3);
    // A third caster at Rogue 20: 4/3/3/1.
    expect([1, 2, 3, 4, 5].map((level) => actor.resources?.[`slot-${level}`] ?? 0)).toEqual([4, 3, 3, 1, 0]);
    expect((actor.spells ?? []).filter((spell) => spell.level === 0).length).toBeGreaterThanOrEqual(4);
  });

  it("a homebrew class takes a homebrew subclass", () => {
    const { actor, warnings } = levelUp("homebrew:class:gunslinger", 6, deadeye.id);
    expect(warnings).toEqual([]);
    expect((actor.features ?? []).map((feature) => feature.name)).toEqual(expect.arrayContaining(["Grit", "Steady Hand"]));
    expect(actor.resources?.grit).toBe(3);
  });
});

describe("a build whose homebrew is gone", () => {
  it("names what's missing: its class, and a homebrew subclass its choices name", () => {
    const build: CharacterBuild = quickBuild(sources, { classId: "homebrew:class:gunslinger", level: 3 });
    const withSub = { ...build, levels: build.levels.map((entry, index) => (index === 2 ? { ...entry, choices: { ...entry.choices, subclass: deadeye.id } } : entry)) };
    expect(missingFromCatalog(withSub, sources.catalog)).toEqual([]);
    expect(missingFromCatalog(withSub, SRD_BUILD_SOURCES.catalog)).toEqual(["homebrew:subclass:deadeye", "homebrew:class:gunslinger"]);
    expect(missingFromCatalog(quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:rogue", level: 5 }), SRD_BUILD_SOURCES.catalog)).toEqual([]);
    expect(buildCharacter(withSub, SRD_BUILD_SOURCES).warnings[0]).toMatch(/no class homebrew:class:gunslinger/);
  });
});

describe("the catalog file", () => {
  it("round-trips, and reports each entry it can't take", () => {
    const file = JSON.parse(JSON.stringify(catalogFile(entries, new Date("2026-10-06T00:00:00Z"))));
    expect(readCatalogFile(file)).toEqual({ entries, problems: [] });
    const bad = { ...file, entries: [...file.entries, { kind: "feat", entry: { id: "homebrew:feat:x", name: "Broken Feat" } }] };
    const read = readCatalogFile(bad);
    expect(read.entries).toHaveLength(3);
    expect(read.problems).toEqual([expect.stringMatching(/^Entry 4, Broken Feat: /)]);
  });

  it("takes a single entry, and turns down something else or a newer version", () => {
    expect(readCatalogFile({ kind: "class", entry: gunslinger }).entries).toEqual([{ kind: "class", entry: gunslinger }]);
    expect(readCatalogFile({ kind: "combatant-package" }).problems[0]).toMatch(/isn't a catalog file/);
    expect(readCatalogFile({ ...catalogFile([]), schemaVersion: 2 }).problems[0]).toMatch(/newer version/);
  });
});
