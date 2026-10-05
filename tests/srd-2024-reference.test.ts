import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SRD_52_ATTRIBUTION } from "@/data/srd/attribution";
import { CLASS_COVERAGE } from "@/data/srd/2024/coverage";
import type { Srd2024Reference } from "@/data/srd/2024/reference-types";
import { checkCoverage } from "../scripts/srd-2024/coverage";
import { buildSrd2024Files, COVERAGE_PATH, REFERENCE_PATH } from "../scripts/srd-2024/files";
import { columnValue } from "../scripts/srd-2024/reference";

const root = fileURLToPath(new URL("../", import.meta.url));
const cachePath = `${root}srd_2024_cache.json`;
const reference = JSON.parse(readFileSync(`${root}${REFERENCE_PATH}`, "utf8")) as Srd2024Reference;
const classOf = (key: string) => reference.classes.find((entry) => entry.key === `srd-2024_${key}`)!;

describe("the SRD 5.2 reference data", () => {
  it("carries the SRD 5.2 attribution", () => {
    expect(reference.attribution).toBe(SRD_52_ATTRIBUTION);
    expect(readFileSync(`${root}${COVERAGE_PATH}`, "utf8")).toContain(SRD_52_ATTRIBUTION);
  });

  it("has the 12 classes, each with its one subclass", () => {
    const classes = reference.classes.filter((entry) => !entry.subclassOf);
    expect(classes.map((entry) => entry.name)).toEqual([
      "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"
    ]);
    for (const entry of classes) {
      expect(reference.classes.filter((sub) => sub.subclassOf === entry.key), entry.name).toHaveLength(1);
    }
    expect(reference.feats).toHaveLength(17);
    expect(reference.backgrounds.map((entry) => entry.name)).toEqual(["Acolyte", "Criminal", "Sage", "Soldier"]);
    expect(reference.species).toHaveLength(9);
  });

  it("takes saves from the Core Traits table, where the source's own field is wrong", () => {
    expect(classOf("fighter").saves).toEqual(["str", "con"]);
    expect(classOf("monk").saves).toEqual(["str", "dex"]);
    expect(classOf("rogue").saves).toEqual(["dex", "int"]);
  });

  it("reads the features tables as numbers and dice, level by level", () => {
    for (const entry of reference.classes) for (const column of entry.columns) expect(column.values, `${entry.key} ${column.id}`).toHaveLength(20);
    const column = (key: string, id: string) => classOf(key).columns.find((entry) => entry.id === id)!.values;
    expect(column("rogue", "sneak-attack")[6]).toBe("4d6");
    expect(column("barbarian", "rage-damage")[8]).toBe(3);
    expect(column("monk", "unarmored-movement")[0]).toBeNull();
    expect(column("monk", "unarmored-movement")[17]).toBe(30);
    expect(column("warlock", "slot-level")[4]).toBe(3);
    expect(column("druid", "wild-shape")).toEqual([null, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4]);
    expect(column("wizard", "slots-9")[16]).toBe(1);
    expect(column("fighter", "weapon-mastery")[0]).toBe(3);
    expect(columnValue("D12")).toBe("d12");
    expect(columnValue("+10 ft.")).toBe(10);
  });

  it("applies the overrides checked against the SRD 5.2 PDF", () => {
    const feature = (owner: string, key: string) => classOf(owner).features.find((entry) => entry.key === `srd-2024_${key}`)!;
    expect(feature("fighter", "fighter_studied-attacks").name).toBe("Studied Attacks");
    expect(feature("monk", "monk_deflect-attacks").levels).toEqual([3]);
    expect(feature("circle-of-the-land", "druid_circle-of-the-land_natures-ward").text).toMatch(/^You are immune to the Poisoned condition/);
    expect(feature("circle-of-the-land", "druid_circle-of-the-land_natures-sanctuary").text).toMatch(/^As a Magic action, you can expend a use of your Wild Shape/);
  });

  it("gives every weapon its mastery", () => {
    expect(reference.weapons.every((weapon) => weapon.mastery)).toBe(true);
    expect(reference.weapons.find((weapon) => weapon.name === "Greataxe")?.mastery).toBe("Cleave");
  });
});

describe("the coverage audit", () => {
  it("has a verdict for every feature, feat and species trait, and none for anything else", () => {
    expect(checkCoverage(reference)).toEqual([]);
  });

  it("tags every feature it doesn't fully run with a gap", () => {
    for (const [key, entry] of Object.entries(CLASS_COVERAGE)) {
      if (entry.verdict === "partial" || entry.verdict === "manual") expect(entry.gaps?.length, key).toBeGreaterThan(0);
      if (entry.verdict === "partial") expect(entry.note, key).toBeTruthy();
    }
  });

  it.skipIf(!existsSync(cachePath))("is up to date with the cache (npm run srd:2024)", () => {
    const { files, errors } = buildSrd2024Files(JSON.parse(readFileSync(cachePath, "utf8")));
    expect(errors).toEqual([]);
    for (const [path, content] of files) {
      expect(readFileSync(`${root}${path}`, "utf8").replace(/\r\n/g, "\n"), path).toBe(content);
    }
  });
});
