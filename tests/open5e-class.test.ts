import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeOpen5eClass, open5eClassId, Open5eClient, type Open5eImportedPayload } from "@/adapters";
import { entryLabel, entryProblems, mergeCatalog, parseCatalogEntry, quickBuild, type ClassDefinition, type SubclassDefinition } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/** PC builder plan, Phase 8d: Open5e's `/v2/classes/` records as catalog skeletons. Payloads are trimmed real ones. */

function payload(key: string): Open5eImportedPayload {
  const raw = JSON.parse(readFileSync(`tests/fixtures/open5e-classes/${key}.json`, "utf-8")) as Record<string, unknown>;
  return { provider: "open5e", resource: "class", slug: key, key, documentKey: (raw.document as { key: string }).key, importedAt: "2026-10-06T00:00:00.000Z", payloadVersion: "v2", raw };
}

const asClass = (key: string) => {
  const item = normalizeOpen5eClass(payload(key));
  expect(item.kind).toBe("class");
  return item.entry as ClassDefinition;
};

describe("an Open5e class", () => {
  it("2024 (the Core Traits table): hit die, saves, skills, weapons, armor, the table, feat and subclass levels", () => {
    const rogue = asClass("srd-2024_rogue");
    expect(rogue).toMatchObject({
      id: "open5e:class:srd-2024_rogue", name: "Rogue", edition: "2024", hitDie: 8,
      primaryAbilities: ["dex"], saves: ["dex", "int"],
      weaponProficiency: ["simple", "martial-finesse-or-light"], armorTraining: ["light"],
      subclassLevel: 3, subclassLabel: "Rogue Subclass", featLevels: [4, 8, 10, 12, 16],
      source: { provider: "open5e", documentKey: "srd-2024", slug: "srd-2024_rogue", importedAt: "2026-10-06T00:00:00.000Z" }
    });
    expect(rogue.skills).toEqual({ count: 4, from: ["acrobatics", "athletics", "deception", "insight", "intimidation", "investigation", "perception", "persuasion", "sleight_of_hand", "stealth"] });
    expect(rogue.table).toEqual([{ id: "sneak-attack", label: "Sneak Attack", values: ["1d6", "1d6", "2d6", "2d6", "3d6", "3d6", "4d6", "4d6", "5d6", "5d6", "6d6", "6d6", "7d6", "7d6", "8d6", "8d6", "9d6", "9d6", "10d6", "10d6"] }]);
    // Features at their levels, reference text; the subclass feature is the subclass choice; Expertise twice.
    const at = (level: number) => rogue.levels.find((entry) => entry.level === level);
    expect(at(3)?.choices).toEqual([{ kind: "subclass", id: "subclass" }]);
    expect(at(3)?.grants.map((grant) => (grant.feature as { name: string }).name)).toEqual(["Steady Aim"]);
    expect(at(6)?.grants.map((grant) => grant.key)).toEqual(["expertise-6"]);
    expect(at(1)?.grants.find((grant) => grant.key === "sneak-attack")?.feature).toMatchObject({ automationSupport: "manual-only", name: "Sneak Attack" });
    expect(rogue.levels.flatMap((entry) => entry.grants).some((grant) => /ability score|epic boon/i.test((grant.feature as { name: string }).name))).toBe(false);
  });

  it("2014 (the Proficiencies list), and a third-party class with text columns", () => {
    const rogue = asClass("srd_rogue");
    // A 2014 class keeps its 19th-level Ability Score Improvement: it has no Epic Boon.
    expect(rogue).toMatchObject({ edition: "2014", hitDie: 8, saves: ["dex", "int"], armorTraining: ["light"], subclassLabel: "Roguish Archetype", featLevels: [4, 8, 10, 12, 16, 19] });
    expect(rogue.skills.count).toBe(4);
    expect(rogue.table[0]).toMatchObject({ id: "sneak-attack", label: "Sneak Attack" });
    const marshal = asClass("a5e_marshal");
    expect(marshal).toMatchObject({ id: "open5e:class:a5e_marshal", hitDie: 10, subclassLevel: 3, subclassLabel: "Marshal Archetype" });
    expect(entryLabel(marshal)).toBe("Marshal (Adventurer's Guide)");
    const presence = marshal.table.find((column) => column.id === "commanding-presence")!;
    expect(presence.values[0]).toBe("10 feet");
    expect(marshal.table.some((column) => column.id === "proficiency-bonus")).toBe(false);
  });

  it("passes its schema, merges beside the SRD's same-named class, and builds at every level", () => {
    for (const key of ["srd-2024_rogue", "srd_rogue", "a5e_marshal"]) {
      const item = normalizeOpen5eClass(payload(key));
      expect(parseCatalogEntry(item).problem, key).toBeUndefined();
      expect(entryProblems(item, SRD_BUILD_SOURCES), key).toEqual([]);
    }
    const imported = normalizeOpen5eClass(payload("srd-2024_rogue"));
    const merged = mergeCatalog(SRD_BUILD_SOURCES, [imported]);
    expect(merged.catalog.classes.filter((entry) => entry.name === "Rogue").map(entryLabel)).toEqual(["Rogue", "Rogue (5e 2024 Rules)"]);
    const build = quickBuild(merged, { classId: imported.entry.id, level: 5 });
    expect(build.levels[0]?.classId).toBe("open5e:class:srd-2024_rogue");
  });
});

describe("searching Open5e's classes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("filters by name here (the endpoint ignores name__icontains), a subclass found by its class's name too", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => {
      fetched.push(String(url));
      return new Response(JSON.stringify({ count: 3, results: [
        { key: "a5e_marshal", name: "Marshal", document: { key: "a5e-ag", name: "Adventurer's Guide" } },
        { key: "a5e_gambling-general", name: "Gambling General", document: { key: "a5e-ag" }, subclass_of: { key: "a5e_marshal", name: "Marshal" } },
        { key: "toh_ranger", name: "Ranger", document: { key: "toh" } }
      ] }));
    }));
    const found = await new Open5eClient().searchClasses({ query: "MARSH" });
    expect(found.map((entry) => entry.name)).toEqual(["Marshal", "Gambling General"]);
    expect(found[1]?.subclassOf).toEqual({ key: "a5e_marshal", name: "Marshal" });
    expect(fetched[0]).not.toContain("name__icontains");
    expect((await new Open5eClient().searchClasses({ query: "" })).length).toBe(3);
  });
});

describe("an Open5e subclass", () => {
  it("attaches to its class: an imported one by its Open5e id, an SRD 5.2 one to the bundled class", () => {
    const general = normalizeOpen5eClass(payload("a5e_gambling-general"));
    expect(general.kind).toBe("subclass");
    expect((general.entry as SubclassDefinition).classId).toBe("open5e:class:a5e_marshal");
    expect((general.entry as SubclassDefinition).levels.length).toBeGreaterThan(0);
    expect(open5eClassId("srd-2024_rogue")).toBe("srd:class:rogue");
    const marshal = normalizeOpen5eClass(payload("a5e_marshal"));
    expect(entryProblems(general, SRD_BUILD_SOURCES, [marshal])).toEqual([]);
    expect(entryProblems(general, SRD_BUILD_SOURCES)).toEqual(["Its class (open5e:class:a5e_marshal) isn't in the catalog."]);
  });
});
