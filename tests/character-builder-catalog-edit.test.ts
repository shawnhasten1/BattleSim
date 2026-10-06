import { describe, expect, it } from "vitest";
import {
  blankEntry,
  CATALOG_KINDS,
  copyAsHomebrew,
  entryProblems,
  grantKeyFor,
  grantKeysOf,
  parseCatalogEntry,
  previewCharacter,
  scalablePaths,
  type CatalogEntry,
  type ClassDefinition
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/** PC builder plan, Phase 8b: what the Homebrew window's editors are made from. */

const rogue = SRD_BUILD_SOURCES.catalog.classes.find((entry) => entry.id === "srd:class:rogue")!;

describe("a new entry", () => {
  it("of every kind passes its schema, with an id of its own", () => {
    for (const kind of CATALOG_KINDS) {
      const item = blankEntry(kind, "New thing", ["homebrew:class:new-thing"]);
      expect(parseCatalogEntry(item).problem, kind).toBeUndefined();
      expect(item.entry.id).toBe(kind === "class" ? "homebrew:class:new-thing-2" : `homebrew:${kind}:new-thing`);
    }
  });

  it("a blank class builds at every level without a problem", () => {
    expect(entryProblems(blankEntry("class", "Blank", []), SRD_BUILD_SOURCES)).toEqual([]);
  });
});

describe("a copy of an SRD class", () => {
  it("is the class again, homebrew, under an id and name of its own, and builds as the SRD one does", () => {
    const copy = copyAsHomebrew({ kind: "class", entry: rogue }, [], "Swashbuckler") as Extract<CatalogEntry, { kind: "class" }>;
    expect(copy.entry).toMatchObject({ id: "homebrew:class:swashbuckler", name: "Swashbuckler", source: { provider: "homebrew" }, hitDie: 8 });
    expect(copy.entry.levels).toEqual(rogue.levels);
    expect(rogue.source.provider).toBe("srd");
    expect(parseCatalogEntry(copy).problem).toBeUndefined();
    expect(entryProblems(copy, SRD_BUILD_SOURCES)).toEqual([]);
  });
});

describe("the numbers a feature can scale", () => {
  it("are its numbers and dice, by path, not its names or ids", () => {
    const sneak = rogue.levels[0]!.grants.find((grant) => grant.key === "sneak-attack")!;
    const paths = scalablePaths(sneak.feature).map((entry) => entry.path);
    expect(paths).toContain("effects.0.damage.0.dice");
    expect(paths.some((path) => path.endsWith(".id") || path.endsWith("name"))).toBe(false);
  });

  it("include a granted action's damage dice", () => {
    const feature = {
      id: "x", name: "Blast", category: "feature", automationSupport: "full",
      grantedActions: [{ kind: "attack", id: "a", name: "Blast", range: 60, damage: [{ dice: "1d10", type: "force" }] }]
    };
    expect(scalablePaths(feature)).toEqual(expect.arrayContaining([
      { path: "grantedActions.0.range", value: 60 },
      { path: "grantedActions.0.damage.0.dice", value: "1d10" }
    ]));
  });
});

describe("grant keys", () => {
  it("are made from names, unique, and found at any depth", () => {
    expect(grantKeyFor("Sneak Attack", ["sneak-attack"])).toBe("sneak-attack-2");
    const keys = grantKeysOf(SRD_BUILD_SOURCES.catalog.classes.find((entry) => entry.id === "srd:class:warlock")!.levels);
    expect(keys).toContain("pact-magic");
    // An invocation's grant, inside a pick's option.
    expect(keys.length).toBeGreaterThan(20);
  });
});

describe("what's wrong with an entry", () => {
  it("names the level where a scale path doesn't resolve, and a subclass without its class", () => {
    const broken: ClassDefinition = {
      ...(blankEntry("class", "Broken", []).entry as ClassDefinition),
      table: [{ id: "grit", label: "Grit", values: Array.from({ length: 20 }, () => 2) }],
      levels: [{ level: 2, grants: [{ key: "grit", feature: { id: "grit", name: "Grit", category: "feature", automationSupport: "manual-only" }, scale: [{ path: "effects.0.bonus", value: "{col:grit}" }] }] }]
    };
    const problems = entryProblems({ kind: "class", entry: broken }, SRD_BUILD_SOURCES);
    expect(problems[0]).toMatch(/^Level 2: .*no effects\.0\.bonus to scale/);
    expect(problems).toHaveLength(19);
    const orphan = blankEntry("subclass", "Orphan", [], "homebrew:class:gone");
    expect(entryProblems(orphan, SRD_BUILD_SOURCES)).toEqual(["Its class (homebrew:class:gone) isn't in the catalog."]);
    expect(entryProblems({ kind: "class", entry: { ...broken, hitDie: 7 } } as unknown as CatalogEntry, SRD_BUILD_SOURCES)[0]).toMatch(/hitDie/);
  });
});

describe("the preview character", () => {
  it("is the class built to the level, or a blank one when the class can't be built", () => {
    expect(previewCharacter(SRD_BUILD_SOURCES, "srd:class:rogue", 5).character?.level).toBe(5);
    expect(previewCharacter(SRD_BUILD_SOURCES, "homebrew:class:gone", 3).character?.classes?.[0]?.name).toBe(SRD_BUILD_SOURCES.catalog.classes[0]!.name);
  });
});
