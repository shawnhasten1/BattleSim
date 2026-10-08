import { describe, expect, it } from "vitest";
import {
  buildCharacter,
  classTable,
  quickBuild,
  startBuild,
  timeline,
  withClass,
  withLevelUp,
  withSuggestions,
  type CharacterBuild
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

// CHARACTER_BUILDER_UX_PLAN.md D7: the Class step's timeline, the class table, and changing a new character's class.

const S = SRD_BUILD_SOURCES;
const lineOf = (build: CharacterBuild) => timeline(build, buildCharacter(build, S), S);
const names = (level: { features: Array<{ feature: { name: string } }> }) => level.features.map((entry) => entry.feature.name);

describe("the timeline", () => {
  const wizard = quickBuild(S, { classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" });
  const line = lineOf(wizard);

  it("has every level the character has, each with its class, hit points and what got bigger", () => {
    expect(line.levels.map((level) => `${level.level} ${level.className} ${level.classLevel}`)).toEqual(["1 Wizard 1", "2 Wizard 2", "3 Wizard 3", "4 Wizard 4", "5 Wizard 5"]);
    const [first, , third, , fifth] = line.levels;
    // A 2024 dwarf's CON is the wizard's 14 + the Sage's +1: +2.
    expect(first!.hitPoints).toMatchObject({ die: 6, roll: 6, first: true, gained: 8 });
    expect(fifth!.hitPoints).toMatchObject({ die: 6, roll: 4, first: false, rolled: false, gained: 6 });
    expect(first!.grows).toEqual(expect.arrayContaining(["Cantrips 3", "1st-level slots 2"]));
    expect(first!.grows.some((grow) => grow.startsWith("Proficiency"))).toBe(false);
    expect(third!.grows).toContain("2nd-level slots 2");
    expect(fifth!.grows).toEqual(expect.arrayContaining(["Proficiency +3", "3rd-level slots 2"]));
  });

  it("lists each level's own features, with their first lines, and the subclass's apart", () => {
    const [first, , third] = line.levels;
    expect(names(first!)).toEqual(expect.arrayContaining(["Spellcasting", "Arcane Recovery"]));
    expect(first!.features.every((entry) => entry.owner === "Wizard" && !entry.subclass && entry.line.length > 0)).toBe(true);
    // Neither the species' traits nor the background's feat are the class's.
    expect(line.levels.flatMap(names)).not.toContain("Darkvision");
    expect(line.levels.flatMap(names)).not.toContain("Magic Initiate");
    const evoker = third!.features.filter((entry) => entry.subclass);
    expect(evoker.length).toBeGreaterThan(0);
    expect(evoker.every((entry) => entry.owner === "Evoker")).toBe(true);
  });

  it("puts each level's choices on it: class skills at 1, the subclass at 3, a feat at 4", () => {
    const kinds = line.levels.map((level) => level.choices.map((slot) => slot.spec.kind));
    expect(kinds[0]).toEqual(expect.arrayContaining(["skills", "spells"]));
    expect(kinds[2]).toContain("subclass");
    expect(kinds[3]).toContain("feat");
    expect(line.levels.flatMap((level) => level.choices).every((slot) => slot.scope.kind === "level")).toBe(true);
  });

  it("shows what's ahead to 20, names only: the subclass's features, feats and the Epic Boon", () => {
    expect(line.ahead[0]!.level).toBeGreaterThanOrEqual(6);
    expect(line.ahead[line.ahead.length - 1]!.level).toBe(20);
    const at = (level: number) => line.ahead.find((entry) => entry.level === level)?.names ?? [];
    expect(at(6)).toContain("Sculpt Spells");
    expect(at(8)).toContain("Ability Score Improvement");
    expect(at(19)).toContain("Epic Boon");
  });

  it("names a multiclass level's class, and goes on in the class of the last level", () => {
    const build = withSuggestions(withLevelUp(quickBuild(S, { classId: "srd:class:fighter", level: 1 }), "srd:class:wizard"), S);
    const multi = lineOf(build);
    expect(multi.levels.map((level) => `${level.className} ${level.classLevel}`)).toEqual(["Fighter 1", "Wizard 1"]);
    expect(multi.levels[1]!.hitPoints).toMatchObject({ die: 6, first: false });
    expect(multi.ahead[0]).toMatchObject({ level: 3, className: "Wizard", classLevel: 2 });
  });

  it("works for every SRD class at level 20, in both editions", { timeout: 60000 }, () => {
    for (const definition of S.catalog.classes.filter((entry) => entry.source.provider === "srd")) {
      const build = quickBuild(S, { classId: definition.id, level: 20 });
      const full = lineOf(build);
      expect(full.levels, definition.id).toHaveLength(20);
      expect(full.levels.every((level) => level.hitPoints), definition.id).toBe(true);
      expect(full.ahead, definition.id).toEqual([]);
      expect(full.levels.some((level) => level.features.length > 0), definition.id).toBe(true);
    }
  });
});

describe("the class table", () => {
  it("runs 1 to 20, with the class's numbers and the spell slots in one column", () => {
    const wizard = S.catalog.classes.find((entry) => entry.id === "srd:class:wizard")!;
    const table = classTable(wizard, undefined, S);
    expect(table.rows).toHaveLength(20);
    expect(table.columns).toEqual(["Cantrips", "Prepared Spells", "Spell slots"]);
    expect(table.rows[4]).toMatchObject({ level: 5, proficiency: "+3", values: ["4", "9", "4 · 3 · 2"] });
    expect(table.rows[2]!.features).toContain("Wizard Subclass");
    expect(table.rows[3]!.features).toContain("Ability Score Improvement");
  });

  it("drops columns with nothing in them, and names the subclass's features once one is chosen", () => {
    const fighter = S.catalog.classes.find((entry) => entry.id === "srd:class:fighter")!;
    const champion = S.catalog.subclasses.find((entry) => entry.classId === fighter.id)!;
    const table = classTable(fighter, champion, S);
    expect(table.columns).not.toContain("Spell slots");
    expect(table.rows[2]!.features).not.toContain(fighter.subclassLabel);
    expect(table.rows[2]!.features.length).toBeGreaterThan(0);
  });
});

describe("changing a new character's class (D11)", () => {
  it("keeps the scores, background, species, origin choices and hit point method", () => {
    const start = quickBuild(S, { classId: "srd:class:wizard", level: 3, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" });
    const before: CharacterBuild = {
      ...start,
      abilities: { method: "point-buy", base: { str: 8, dex: 14, con: 15, int: 15, wis: 10, cha: 8 } },
      hp: { method: "rolled", rolls: [5, 6] }
    };
    const after = withSuggestions(withClass(before, "srd:class:fighter-2014", S), S);
    expect(after.levels.map((level) => level.classId)).toEqual(Array(3).fill("srd:class:fighter-2014"));
    expect(after.edition).toBe("2014");
    expect(after.abilities).toEqual(before.abilities);
    expect(after.background).toEqual(before.background);
    expect(after.species).toEqual(before.species);
    expect(after.hp).toEqual({ method: "rolled" });
    expect(buildCharacter(after, S).choices.filter((slot) => slot.pending)).toEqual([]);
    expect(after.equipment?.classOption).toBe(S.catalog.classes.find((entry) => entry.id === "srd:class:fighter-2014")!.suggested.equipment ?? S.catalog.classes.find((entry) => entry.id === "srd:class:fighter-2014")!.startingEquipment?.[0]?.id);
  });

  it("leaves an unknown class alone", () => {
    const build = startBuild(S, { classId: "srd:class:wizard" });
    expect(withClass(build, "srd:class:nobody", S)).toBe(build);
  });
});
