// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Ability, SourceMetadata } from "@/engine";
import { CatalogOptions } from "@/components/builder/CatalogSelect";
import {
  buildCharacter,
  epicBoonLevelOf,
  equipmentWeaponOptions,
  increasesSource,
  otherEditionTwin,
  preparedAt,
  spellSlots,
  startBuild,
  withChoice,
  withSuggestions,
  type BackgroundDefinition,
  type BuildSources,
  type CharacterBuild,
  type ClassDefinition,
  type SpeciesDefinition
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES, SRD_BUILDER_LIBRARY } from "@/lib/character-builder/srd";

/** EDITIONS_PLAN.md Phase 5: the builder takes the 2014 rules from the records it builds from, on test-only 2014 fixtures. */

afterEach(() => cleanup());

const srd51 = (slug: string): SourceMetadata => ({ provider: "srd", documentKey: "srd-2014", documentName: "System Reference Document 5.1", slug, edition: "2014" });
const zeros = () => Array.from({ length: 20 }, () => 0);
const suggested = (abilities: Ability[], extra: Partial<ClassDefinition["suggested"]> = {}): ClassDefinition["suggested"] => ({ abilities, tactics: "brute", ...extra });

/** A 2014 martial: an ASI at 19 (no Epic Boon), a 2014-style id, and its equipment a choice on each line. */
const WARRIOR: ClassDefinition = {
  id: "test:class:warrior-2014", name: "Warrior", source: srd51("srd_warrior"), edition: "2014", hitDie: 10,
  primaryAbilities: ["str"], saves: ["str", "con"], skills: { count: 2, from: ["athletics", "perception", "survival"] },
  weaponProficiency: ["simple", "martial"], armorTraining: ["light", "medium", "heavy", "shield"],
  subclassLevel: 3, subclassLabel: "Archetype", featLevels: [4, 8, 12, 16, 19], table: [],
  levels: [{
    level: 1,
    grants: [{ key: "second-wind", feature: { id: "second-wind", name: "Second Wind", category: "feature", automationSupport: "manual-only" } }]
  }],
  equipmentLines: [
    { id: "armor", options: [
      { id: "a", label: "(a) chain mail", items: [{ ref: "srd:item:chain-mail" }] },
      { id: "b", label: "(b) leather armor and a longbow", items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:longbow" }] }
    ] },
    { id: "weapon", options: [
      { id: "a", label: "(a) a martial weapon and a shield", items: [{ ref: "srd:item:shield" }], anyWeapon: { category: "martial", count: 1 } },
      { id: "b", label: "(b) two martial weapons", items: [], anyWeapon: { category: "martial", count: 2 } }
    ] }
  ],
  suggested: suggested(["str", "con", "dex", "wis", "cha", "int"], { equipmentWeapons: { weapon: ["srd:weapon:longsword"] } })
};

/** A 2014 Paladin-style half caster: no spells at 1st level, "modifier + half its level" prepared, rounding down multiclassed. */
const ZEALOT: ClassDefinition = {
  ...WARRIOR, id: "test:class:zealot-2014", name: "Zealot", source: srd51("srd_zealot"), equipmentLines: undefined,
  spellcasting: { ability: "cha", kind: "half", list: "paladin-2014", prepared: zeros(), preparedFormula: { add: "half-level" }, firstSlotsAt: 2, multiclassRounding: "down" },
  suggested: suggested(["str", "cha", "con", "dex", "wis", "int"])
};

/** A 2014 Cleric-style full caster: "modifier + level" prepared, from the 2014 list. */
const PRIEST: ClassDefinition = {
  ...WARRIOR, id: "test:class:priest-2014", name: "Priest", source: srd51("srd_priest"), equipmentLines: undefined, hitDie: 8,
  spellcasting: { ability: "wis", kind: "full", list: "cleric-2014", cantrips: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], prepared: zeros(), preparedFormula: { add: "level" } },
  suggested: suggested(["wis", "con", "str", "dex", "cha", "int"])
};

/** A 2014 Fighter, beside the 2024 one. */
const FIGHTER_2014: ClassDefinition = { ...WARRIOR, id: "test:class:fighter-2014", name: "Fighter", source: srd51("srd_fighter") };

/** A 2014 race with a subrace (Dwarf, Hill Dwarf), and one with increases of the player's choice (Half-Elf). */
const STOUT: SpeciesDefinition = {
  id: "test:species:stout-2014", name: "Stout", source: srd51("srd_stout"), edition: "2014", sizes: ["medium"], speed: 25, type: "humanoid",
  abilities: { con: 2 },
  levels: [{ level: 1, grants: [], choices: [{ kind: "pick", id: "subrace", label: "Subrace", count: 1, options: [{ id: "hill", name: "Hill Stout", grants: [], abilities: { wis: 1 } }] }] }]
};
const HALF: SpeciesDefinition = {
  id: "test:species:half-2014", name: "Half", source: srd51("srd_half"), edition: "2014", sizes: ["medium"], speed: 30, type: "humanoid",
  abilities: { cha: 2 }, abilityChoice: { count: 2, amount: 1, exclude: ["cha"] }, levels: []
};

/** A 2014 background: skills and a feature of its own, no increases, no feat. */
const ACOLYTE_2014: BackgroundDefinition = {
  id: "test:background:acolyte-2014", name: "Acolyte", source: srd51("srd_acolyte"), edition: "2014", skills: ["insight", "religion"],
  grants: [{ key: "shelter", feature: { id: "shelter", name: "Shelter of the Faithful", category: "feature", automationSupport: "manual-only", informational: true } }]
};

const SOURCES: BuildSources = {
  catalog: {
    ...SRD_BUILD_SOURCES.catalog,
    classes: [...SRD_BUILD_SOURCES.catalog.classes, WARRIOR, ZEALOT, PRIEST, FIGHTER_2014],
    species: [...SRD_BUILD_SOURCES.catalog.species, STOUT, HALF],
    backgrounds: [...SRD_BUILD_SOURCES.catalog.backgrounds, ACOLYTE_2014]
  },
  library: SRD_BUILDER_LIBRARY
};

const base = { str: 15, dex: 12, con: 14, int: 8, wis: 13, cha: 10 };
function buildOf(classId: string, options: { level?: number; backgroundId?: string; speciesId?: string; increasesFrom?: CharacterBuild["increasesFrom"] } = {}): CharacterBuild {
  const start = startBuild(SOURCES, { classId, level: options.level, backgroundId: options.backgroundId, speciesId: options.speciesId, abilities: { method: "manual", base } });
  return options.increasesFrom ? { ...start, increasesFrom: options.increasesFrom } : start;
}
const increaseSlots = (build: CharacterBuild) => buildCharacter(build, SOURCES).choices.filter((slot) => slot.spec.kind === "abilities" && slot.spec.id === "increases");

describe("where ability increases come from (D3)", () => {
  it("a 2014 race and a 2014 background: the race's, the subrace's too", () => {
    let build = buildOf(WARRIOR.id, { backgroundId: ACOLYTE_2014.id, speciesId: STOUT.id });
    expect(increasesSource(build, SOURCES)).toBe("species");
    build = withChoice(build, { kind: "species" }, ["subrace"], ["hill"]);
    const built = buildCharacter(build, SOURCES);
    expect(built.fields.abilities).toMatchObject({ con: 16, wis: 14, str: 15 });
    expect(increaseSlots(build)).toEqual([]);
  });

  it("a 2014 race and a 2024 background: the background's, unless the character says the race's", () => {
    const build = buildOf(WARRIOR.id, { backgroundId: "srd:background:acolyte", speciesId: STOUT.id });
    expect(increasesSource(build, SOURCES)).toBe("background");
    expect(increaseSlots(build).map((slot) => [slot.scope.kind, (slot.spec as { from: Ability[] }).from])).toEqual([["background", ["int", "wis", "cha"]]]);
    expect(buildCharacter(build, SOURCES).fields.abilities.con).toBe(14);
    const fromRace = { ...build, increasesFrom: "species" as const };
    expect(increaseSlots(fromRace)).toEqual([]);
    expect(buildCharacter(fromRace, SOURCES).fields.abilities.con).toBe(16);
  });

  it("a 2024 species and a 2014 background: three points on any abilities", () => {
    const build = buildOf(WARRIOR.id, { backgroundId: ACOLYTE_2014.id, speciesId: "srd:species:dwarf" });
    expect(increasesSource(build, SOURCES)).toBe("background");
    const [slot] = increaseSlots(build);
    expect(slot).toMatchObject({ scope: { kind: "background" }, spec: { points: 3, maxPerAbility: 2, from: ["str", "dex", "con", "int", "wis", "cha"] } });
  });

  it("a Half-Elf's increases of the player's choice, never on Charisma", () => {
    const build = buildOf(WARRIOR.id, { backgroundId: ACOLYTE_2014.id, speciesId: HALF.id });
    const [slot] = increaseSlots(build);
    expect(slot).toMatchObject({ scope: { kind: "species" }, spec: { points: 2, maxPerAbility: 1 } });
    expect((slot!.spec as { from: Ability[] }).from).not.toContain("cha");
    const chosen = withChoice(build, { kind: "species" }, ["increases"], { str: 1, con: 1 }, slot!.spec);
    expect(buildCharacter(chosen, SOURCES).fields.abilities).toMatchObject({ cha: 12, str: 16, con: 15 });
  });

  it("every mix of 2014 and 2024 origins takes one set of increases, never both or neither", () => {
    for (const backgroundId of [ACOLYTE_2014.id, "srd:background:acolyte"]) {
      for (const speciesId of [STOUT.id, "srd:species:dwarf"]) {
        const build = withSuggestions(buildOf(WARRIOR.id, { backgroundId, speciesId }), SOURCES);
        const scores = buildCharacter(build, SOURCES).fields.abilities;
        const gained = (Object.keys(base) as Ability[]).reduce((sum, ability) => sum + scores[ability] - base[ability], 0);
        // A 2014 Stout's +2 and its subrace's +1 (suggested), or a background's three points: one set either way.
        expect(gained, `${backgroundId} + ${speciesId}`).toBe(3);
        expect(increasesSource(build, SOURCES), `${backgroundId} + ${speciesId}`).toBe(backgroundId === ACOLYTE_2014.id && speciesId === STOUT.id ? "species" : "background");
      }
    }
  });

  it("a 2014 background's own feature is the character's", () => {
    const built = buildCharacter(buildOf(WARRIOR.id, { backgroundId: ACOLYTE_2014.id }), SOURCES);
    expect(built.features.map((entry) => entry.feature.name)).toContain("Shelter of the Faithful");
  });
});

describe("the 2014 classes' rules", () => {
  it("an Ability Score Improvement at 19 and no Epic Boon; a 2024 class keeps its Epic Boon", () => {
    expect(epicBoonLevelOf(WARRIOR)).toBeUndefined();
    expect(epicBoonLevelOf(SRD_BUILD_SOURCES.catalog.classes.find((entry) => entry.id === "srd:class:fighter")!)).toBe(19);
    const at19 = (classId: string) => buildCharacter(buildOf(classId, { level: 19 }), SOURCES).choices
      .filter((slot) => slot.scope.kind === "level" && slot.scope.index === 18 && slot.spec.kind === "feat").map((slot) => slot.spec.id);
    expect(at19(WARRIOR.id)).toEqual(["feat"]);
    expect(at19("srd:class:barbarian")).toEqual(["epic-boon"]);
  });

  it("a 2014 half caster has no slots at 1st level, and rounds down when multiclassed", () => {
    const slots = (level: number) => buildCharacter(buildOf(ZEALOT.id, { level }), SOURCES).resources;
    expect(slots(1)["slot-1"]).toBeUndefined();
    expect(slots(2)["slot-1"]).toBe(2);
    expect([slots(5)["slot-1"], slots(5)["slot-2"]]).toEqual([4, 2]);
    // Zealot 3 (half, rounded down: 1) and a full caster 2: caster level 3. Under the 2024 rule (up: 2), it would be 4.
    expect(spellSlots([{ kind: "half", classLevel: 3, firstSlotsAt: 2, multiclassRounding: "down" }, { kind: "full", classLevel: 2 }])).toEqual({ "slot-1": 4, "slot-2": 2 });
    expect(spellSlots([{ kind: "half", classLevel: 3 }, { kind: "full", classLevel: 2 }])).toEqual({ "slot-1": 4, "slot-2": 3 });
    // A 2014 half caster below its first slots counts for nothing.
    expect(spellSlots([{ kind: "half", classLevel: 1, firstSlotsAt: 2, multiclassRounding: "down" }, { kind: "full", classLevel: 1 }])).toEqual({ "slot-1": 2 });
  });

  it("prepares its modifier plus its level, and an ASI adds one", () => {
    const progression = PRIEST.spellcasting!;
    expect(preparedAt(progression, 1, { ...base, wis: 16 })).toBe(4);
    expect(preparedAt(ZEALOT.spellcasting!, 1, { ...base, cha: 16 })).toBe(0);
    expect(preparedAt(ZEALOT.spellcasting!, 2, { ...base, cha: 8 })).toBe(1);
    const start = buildOf(PRIEST.id, { level: 4, backgroundId: ACOLYTE_2014.id });
    const build = withSuggestions({ ...start, abilities: { method: "manual", base: { ...base, wis: 14 } } }, SOURCES);
    const prepared = buildCharacter(build, SOURCES).choices.filter((slot) => slot.spec.kind === "spells" && slot.spec.id === "prepared");
    // The background's suggested +2 makes Wisdom 16: 4 at 1st (+3 and 1), one more at 2nd and 3rd, and at 4th one for
    // the level and one for the ASI's +2 Wisdom (18: +4).
    expect(prepared.map((slot) => slot.count)).toEqual([4, 1, 1, 2]);
    expect(buildCharacter(build, SOURCES).fields.abilities.wis).toBe(18);
  });

  it("chooses 2014 spells from the 2014 list, and marks each choice's edition", () => {
    const built = buildCharacter(buildOf(PRIEST.id, { backgroundId: ACOLYTE_2014.id }), SOURCES);
    const cantrips = built.choices.find((slot) => slot.scope.kind === "level" && slot.spec.kind === "spells" && slot.spec.id === "cantrips")!;
    expect(cantrips.options.map((option) => option.id)).toContain("srd:spell:sacred-flame");
    expect(cantrips.options.every((option) => option.edition === "2014")).toBe(true);
    expect(SRD_BUILDER_LIBRARY.spell!("srd:spell:wish")?.automationSupport).toBe("manual-only");
    expect(SRD_BUILDER_LIBRARY.spellsOn!("paladin-2014")).toHaveLength(31);
  });

  it("a 2014 class's features keep its plain name in their ids", () => {
    expect(buildCharacter(buildOf(WARRIOR.id), SOURCES).features.map((entry) => entry.feature.id)).toContain("warrior-second-wind");
  });

  it("can't take the other edition's version of a class it has", () => {
    const build = buildOf("srd:class:fighter");
    expect(otherEditionTwin(build, FIGHTER_2014.id, SOURCES)).toMatch(/can't have both editions' Fighter/);
    expect(otherEditionTwin(build, WARRIOR.id, SOURCES)).toBeUndefined();
  });
});

describe("a 2014 class's starting equipment, a choice on each line", () => {
  it("takes each line's pick, and a weapon where the line asks", () => {
    const refs = (build: CharacterBuild) => buildCharacter(build, SOURCES).equipment.map((entry) => entry.ref).sort();
    const build = buildOf(WARRIOR.id);
    expect(refs(build)).toEqual(["srd:item:chain-mail", "srd:item:shield", "srd:weapon:longsword"]);
    const other = { ...build, equipment: { applied: false, lines: { armor: "b", weapon: "b" }, weapons: { weapon: ["srd:weapon:battleaxe", "srd:weapon:greatsword"] } } };
    expect(refs(other)).toEqual(["srd:item:leather-armor", "srd:weapon:battleaxe", "srd:weapon:greatsword", "srd:weapon:longbow"]);
  });

  it("offers only plain weapons of the line's kind", () => {
    const martial = equipmentWeaponOptions({ category: "martial", count: 1 }, SOURCES);
    expect(martial).toContain("srd:weapon:longsword");
    expect(martial).not.toContain("srd:weapon:dagger");
    expect(martial.every((ref) => !SRD_BUILDER_LIBRARY.weapon(ref)?.magical)).toBe(true);
    expect(equipmentWeaponOptions({ category: "martial", melee: true, count: 1 }, SOURCES)).not.toContain("srd:weapon:longbow");
  });
});

describe("the builder's lists", () => {
  const entries = [
    { id: "f24", name: "Fighter", edition: "2024" as const, source: { provider: "srd" as const } },
    { id: "f14", name: "Fighter", edition: "2014" as const, source: { provider: "srd" as const } },
    { id: "w14", name: "Wizard", edition: "2014" as const, source: { provider: "srd" as const } },
    { id: "hb", name: "Marksman", edition: "2024" as const, source: { provider: "homebrew" as const } }
  ];
  const groups = () => within(screen.getByRole("combobox")).getAllByRole("group").map((group) => `${group.getAttribute("label")}: ${within(group).getAllByRole("option").map((option) => option.textContent).join(", ")}`);

  it("group the SRD's entries by edition, homebrew apart", () => {
    render(<select><CatalogOptions entries={entries} choice="both" /></select>);
    expect(groups()).toEqual(["2024 rules: Fighter", "2014 rules: Fighter, Wizard", "Homebrew & imported: Marksman (Homebrew)"]);
  });

  it("under one edition, hide the other's twin, never homebrew or what's chosen", () => {
    render(<select><CatalogOptions entries={entries} choice="2024" keep="f14" /></select>);
    expect(groups()).toEqual(["2024 rules: Fighter", "2014 rules: Fighter, Wizard", "Homebrew & imported: Marksman (Homebrew)"]);
    cleanup();
    render(<select><CatalogOptions entries={entries} choice="2024" /></select>);
    expect(groups()).toEqual(["2024 rules: Fighter", "2014 rules: Wizard", "Homebrew & imported: Marksman (Homebrew)"]);
  });
});
