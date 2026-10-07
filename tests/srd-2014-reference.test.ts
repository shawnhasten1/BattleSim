import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SRD_ATTRIBUTION } from "@/data/srd/attribution";
import { findSrdSpell } from "@/data/srd";
import { OUTSIDE_SRD_51, SRD_2014_CATALOG } from "@/data/srd/2014";
import type { Srd2014Reference } from "@/data/srd/2014/reference-types";
import { SRD_2014_REFERENCE_SPELLS, SRD_2014_SPELL_INDEX, SRD_2014_SPELLS, findSrd2014Spell, srd2014SpellEntry } from "@/data/srd/2014/spells";
import { SRD_2014_REFERENCE_SCROLLS, findLibraryItem, findLibrarySpell } from "@/data/srd/library";
import { prepareLibrary, searchAdd } from "@/lib/ability-editor/add";
import { editionOf } from "@/lib/editions";
import { sampleEncounter, type CreatureDefinition } from "@/engine";
import { raceIncreases } from "../scripts/srd-2014/reference";
import { buildSrd2014Data, buildSrd2014Files, checkSpells2014, COVERAGE_PATH, REFERENCE_PATH } from "../scripts/srd-2014/files";

/** EDITIONS_PLAN.md Phase 4: the SRD 5.1 reference data, the 2014 spell list and its class lists. */

const root = fileURLToPath(new URL("../", import.meta.url));
const cachePath = `${root}srd_2014_cache.json`;
const reference = JSON.parse(readFileSync(`${root}${REFERENCE_PATH}`, "utf8")) as Srd2014Reference;
const classOf = (key: string) => reference.classes.find((entry) => entry.key === `srd_${key}`)!;
const fighter = sampleEncounter.definitions.find((entry) => entry.id === "def-fighter") as CreatureDefinition;

describe("the SRD 5.1 reference data", () => {
  it("carries the SRD 5.1 attribution", () => {
    expect(reference.attribution).toBe(SRD_ATTRIBUTION);
    expect(SRD_2014_SPELL_INDEX.attribution).toBe(SRD_ATTRIBUTION);
    expect(readFileSync(`${root}${COVERAGE_PATH}`, "utf8")).toContain(SRD_ATTRIBUTION);
  });

  it("has the 12 classes with a subclass each, 9 races and 4 subraces, the Acolyte and Grappler", () => {
    const classes = reference.classes.filter((entry) => !entry.subclassOf);
    expect(classes.map((entry) => entry.name)).toEqual([
      "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"
    ]);
    for (const entry of classes) expect(reference.classes.filter((sub) => sub.subclassOf === entry.key), entry.name).toHaveLength(1);
    expect(reference.races.filter((race) => !race.subraceOf)).toHaveLength(9);
    expect(reference.races.filter((race) => race.subraceOf).map((race) => race.name)).toEqual(["High Elf", "Hill Dwarf", "Lightfoot", "Rock Gnome"]);
    expect(reference.backgrounds).toEqual([expect.objectContaining({ name: "Acolyte", skills: ["insight", "religion"], feature: expect.objectContaining({ name: "Shelter of the Faithful" }) })]);
    expect(reference.feats).toEqual([expect.objectContaining({ name: "Grappler", prerequisite: "Strength 13 or higher" })]);
    expect(reference.weapons).toHaveLength(37);
    expect(reference.armor).toHaveLength(12);
  });

  it("reads every race's ability increases, size and speed from its traits (checked against the SRD 5.1 PDF)", () => {
    const increases = Object.fromEntries(reference.races.map((race) => [race.name, { ...race.abilities, ...(race.abilityChoice ? { choice: race.abilityChoice } : {}) }]));
    expect(increases).toEqual({
      Dragonborn: { str: 2, cha: 1 },
      Dwarf: { con: 2 },
      "Hill Dwarf": { wis: 1 },
      Elf: { dex: 2 },
      "High Elf": { int: 1 },
      Gnome: { int: 2 },
      "Rock Gnome": { con: 1 },
      "Half-Elf": { cha: 2, choice: { count: 2, amount: 1, exclude: ["cha"] } },
      "Half-Orc": { str: 2, con: 1 },
      Halfling: { dex: 2 },
      Lightfoot: { cha: 1 },
      Human: { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 },
      Tiefling: { int: 1, cha: 2 }
    });
    const race = (name: string) => reference.races.find((entry) => entry.name === name)!;
    expect([race("Dwarf").size, race("Dwarf").speed]).toEqual(["Medium", 25]);
    expect([race("Halfling").size, race("Halfling").speed]).toEqual(["Small", 25]);
    expect([race("Hill Dwarf").size, race("Hill Dwarf").speed]).toEqual(["", null]);
    expect(raceIncreases("Your Wisdom score increases by 1.")).toEqual({ abilities: { wis: 1 } });
    // The traits keep what a character needs; the flavour that says nothing for a fight goes.
    expect(race("Dwarf").traits.map((trait) => trait.name)).toEqual(["Darkvision", "Dwarven Resilience", "Dwarven Combat Training", "Tool Proficiency", "Stonecunning"]);
  });

  it("takes saves and skills from each class's Proficiencies", () => {
    expect(classOf("fighter")).toMatchObject({ hitDie: 10, saves: ["str", "con"], skills: { count: 2 }, armor: "All armor, shields" });
    expect(classOf("fighter").skills!.from).toHaveLength(8);
    expect(classOf("rogue").skills).toMatchObject({ count: 4 });
    expect(classOf("bard").skills).toEqual({ count: 3, from: "any" });
    expect(classOf("wizard").saves).toEqual(["int", "wis"]);
    expect(classOf("fighter").equipment).toMatch(/\(\*a\*\) chain mail or \(\*b\*\) leather armor, longbow, and 20 arrows/);
  });

  it("reads the features tables as numbers and dice, level by level", () => {
    for (const entry of reference.classes) for (const column of entry.columns) expect(column.values, `${entry.key} ${column.id}`).toHaveLength(20);
    const column = (key: string, id: string) => classOf(key).columns.find((entry) => entry.id === id)!.values;
    expect(column("rogue", "sneak-attack")[6]).toBe("4d6");
    expect(column("barbarian", "rages")[0]).toBe(2);
    expect(column("barbarian", "rage-damage")[8]).toBe(3);
    expect(column("monk", "martial-arts")[0]).toBe("1d4");
    expect(column("monk", "ki-points")[1]).toBe(2);
    expect(column("warlock", "slot-level")[4]).toBe(3);
    expect(column("wizard", "slots-9")[16]).toBe(1);
    expect(column("sorcerer", "spells-known")[0]).toBe(2);
    // The ASI levels, as the features say them: the Fighter's 6th and 14th too.
    expect(classOf("fighter").features.find((feature) => feature.name === "Ability Score Improvement")!.levels).toEqual([4, 6, 8, 12, 14, 16, 19]);
  });

  it.skipIf(!existsSync(cachePath))("is up to date with the cache (npm run srd:2014)", () => {
    const data = buildSrd2014Data(JSON.parse(readFileSync(cachePath, "utf8")));
    expect(data.errors).toEqual([]);
    const { files, errors } = buildSrd2014Files(data, SRD_2014_CATALOG);
    expect(errors).toEqual([]);
    for (const [path, content] of files) expect(readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n"), path).toBe(content);
  });
});

describe("the 2014 spells", () => {
  const entry = (slug: string) => SRD_2014_SPELL_INDEX.spells.find((spell) => spell.slug === slug)!;

  it("are all 319, with each class's own list as SRD 5.1 prints it", () => {
    expect(SRD_2014_SPELL_INDEX.spells).toHaveLength(319);
    const lists = new Map<string, number>();
    for (const spell of SRD_2014_SPELL_INDEX.spells) for (const list of spell.classes) lists.set(list, (lists.get(list) ?? 0) + 1);
    expect(Object.fromEntries(lists)).toEqual({ bard: 111, cleric: 105, druid: 106, paladin: 31, ranger: 37, sorcerer: 120, warlock: 64, wizard: 204 });
    expect(entry("fireball").classes).toEqual(["sorcerer", "wizard"]);
    expect(entry("cure-wounds").classes).toEqual(["bard", "cleric", "druid", "paladin", "ranger"]);
    // A Trickery domain's spell isn't the Cleric's own; Dispel Magic is.
    expect(entry("dimension-door").classes).not.toContain("cleric");
    expect(entry("dispel-magic").classes).toContain("cleric");
  });

  it("are the library's authored spells where it has them, and reference-only otherwise, every one 2014", () => {
    expect(SRD_2014_SPELLS).toHaveLength(319);
    for (const spell of SRD_2014_SPELLS) expect(editionOf(spell), spell.id).toBe("2014");
    expect(findSrd2014Spell("srd:spell:fireball")).toBe(findSrdSpell("srd:spell:fireball"));
    // Open5e's "blindnessdeafness" is the library's Blindness/Deafness.
    expect(findSrd2014Spell("srd:spell:blindness-deafness")).toBe(findSrdSpell("srd:spell:blindness-deafness"));
    expect(srd2014SpellEntry("srd:spell:blindness-deafness")?.name).toBe("Blindness/Deafness");
    const wish = findSrd2014Spell("srd:spell:wish")!;
    expect(wish).toMatchObject({ name: "Wish", level: 9, automationSupport: "manual-only" });
    expect(wish.action).toBeUndefined();
    expect(SRD_2014_REFERENCE_SPELLS.every((spell) => spell.automationSupport === "manual-only")).toBe(true);
  });

  it("keep the library's spells from outside the SRD, and check them", () => {
    expect(OUTSIDE_SRD_51).toEqual(["srd:spell:toll-the-dead"]);
    expect(checkSpells2014(SRD_2014_SPELL_INDEX, ["srd:spell:fireball", "srd:spell:made-up"], OUTSIDE_SRD_51)).toEqual(["library spell srd:spell:made-up isn't in the SRD 5.1 index"]);
  });

  it("are in Add ability for a search, badged 2014, with a scroll each", () => {
    const wishes = searchAdd("wish", "spells", undefined).library.filter((row) => row.name === "Wish");
    expect(wishes.map((row) => `${row.edition} ${row.reference ? "ref" : ""}`.trim())).toEqual(["2014 ref", "2024 ref"]);
    expect(findLibrarySpell("srd:spell:wish")?.name).toBe("Wish");
    expect(prepareLibrary("spell", "srd:spell:wish", fighter)!.record.source).toMatchObject({ edition: "2014", slug: "srd:spell:wish" });
    expect(SRD_2014_REFERENCE_SCROLLS).toHaveLength(SRD_2014_REFERENCE_SPELLS.length);
    expect(findLibraryItem("srd:item:scroll-of-wish")).toMatchObject({ name: "Scroll of Wish", type: "scroll", source: { edition: "2014" } });
  });
});
