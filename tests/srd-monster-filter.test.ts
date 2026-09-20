import { describe, expect, it } from "vitest";
import { SRD_MONSTER_INDEX } from "@/data/srd/monsters";
import {
  EMPTY_SRD_FILTERS, SRD_CR_VALUES, SRD_ENVIRONMENTS,
  activeSrdFilterCount, filterSrdMonsters, withCrRange, type SrdMonsterFilters
} from "@/lib/srd-monster-filter";

const filter = (patch: Partial<SrdMonsterFilters>) => filterSrdMonsters(SRD_MONSTER_INDEX, { ...EMPTY_SRD_FILTERS, ...patch });
const names = (patch: Partial<SrdMonsterFilters>) => filter(patch).map((entry) => entry.name);

describe("SRD monster filters", () => {
  it("an empty filter matches all 325", () => {
    expect(filter({})).toHaveLength(325);
    expect(activeSrdFilterCount(EMPTY_SRD_FILTERS)).toBe(0);
  });

  describe("search", () => {
    it("matches names case-insensitively as a substring", () => {
      expect(names({ query: "GOBLIN" })).toEqual(expect.arrayContaining(["Goblin", "Hobgoblin", "Goblin Boss"].filter((name) => SRD_MONSTER_INDEX.some((entry) => entry.name === name))));
      expect(names({ query: "gobl" }).every((name) => /gobl/i.test(name))).toBe(true);
    });

    it("requires every word, in any order", () => {
      const both = names({ query: "red dragon" });
      expect(both).toEqual(expect.arrayContaining(["Adult Red Dragon", "Ancient Red Dragon", "Red Dragon Wyrmling", "Young Red Dragon"]));
      expect(both).not.toContain("Adult Blue Dragon");
      expect(names({ query: "dragon red" })).toEqual(both);
    });

    it("also searches the family and the creature type", () => {
      // "Chromatic" only appears in the family ("Dragons, Chromatic"), never in a name.
      const chromatic = filter({ query: "chromatic" });
      expect(chromatic).toHaveLength(20);
      expect(chromatic.every((entry) => entry.type === "dragon")).toBe(true);
      // "undead" is a type, not part of most names.
      expect(names({ query: "undead" })).toEqual(expect.arrayContaining(["Zombie", "Wight", "Lich"]));
      expect(filter({ query: "undead" }).every((entry) => entry.type === "undead")).toBe(true);
    });

    it("ignores surrounding whitespace and finds nothing for gibberish", () => {
      expect(filter({ query: "   wolf  " })).toEqual(filter({ query: "wolf" }));
      expect(filter({ query: "zzzzqq" })).toEqual([]);
    });
  });

  describe("challenge rating range", () => {
    it("offers every CR in the library, fractions first", () => {
      expect(SRD_CR_VALUES.slice(0, 5)).toEqual([0, 0.125, 0.25, 0.5, 1]);
      expect(SRD_CR_VALUES[SRD_CR_VALUES.length - 1]).toBe(30);
    });

    it("is inclusive at both ends", () => {
      expect(filter({ crMin: 5, crMax: 5 })).toHaveLength(25);
      expect(filter({ crMin: 30 }).map((entry) => entry.name)).toEqual(["Tarrasque"]);
      expect(filter({ crMax: 0 })).toHaveLength(32);
    });

    it("handles fractional ratings", () => {
      expect(filter({ crMin: 0.125, crMax: 0.125 })).toHaveLength(19);
      expect(filter({ crMin: 0.25, crMax: 0.5 })).toHaveLength(32 + 33);
    });

    it("works with only a minimum or only a maximum", () => {
      expect(filter({ crMin: 17 }).every((entry) => entry.cr >= 17)).toBe(true);
      expect(filter({ crMax: 1 }).every((entry) => entry.cr <= 1)).toBe(true);
      expect(filter({ crMin: 17 }).length + filter({ crMax: 16 }).length).toBe(325);
    });

    it("keeps the range coherent when one end crosses the other", () => {
      const start = { ...EMPTY_SRD_FILTERS, crMin: 5, crMax: 8 };
      expect(withCrRange(start, { crMin: 10 })).toMatchObject({ crMin: 10, crMax: 10 }); // raising min lifts max
      expect(withCrRange(start, { crMax: 2 })).toMatchObject({ crMin: 2, crMax: 2 }); // lowering max drags min
      expect(withCrRange(start, { crMin: 6 })).toMatchObject({ crMin: 6, crMax: 8 }); // valid changes are untouched
      expect(withCrRange(start, { crMax: null })).toMatchObject({ crMin: 5, crMax: null });
      expect(withCrRange({ ...EMPTY_SRD_FILTERS, crMax: 3 }, { crMin: 7 })).toMatchObject({ crMin: 7, crMax: 7 });
    });
  });

  describe("other filters", () => {
    it("filters by size, including several at once", () => {
      expect(filter({ sizes: ["gargantuan"] })).toHaveLength(15);
      expect(filter({ sizes: ["tiny", "gargantuan"] })).toHaveLength(24 + 15);
    });

    it("filters by environment", () => {
      expect(SRD_ENVIRONMENTS).toHaveLength(31);
      const environment = SRD_ENVIRONMENTS[0]!;
      const matches = filter({ environment });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.length).toBeLessThan(325);
      expect(matches.every((entry) => entry.environments.includes(environment))).toBe(true);
    });

    it("filters by automation tier; the three tiers partition the library", () => {
      const counts = (["full", "partial", "manual"] as const).map((tier) => filter({ tiers: [tier] }).length);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(325);
      expect(names({ tiers: ["full"] })).toContain("Goblin");
      expect(names({ tiers: ["partial", "manual"] })).not.toContain("Goblin");
    });

    it("filters legendary, flying and spellcasting creatures", () => {
      expect(filter({ legendary: true })).toHaveLength(30);
      expect(filter({ flies: true })).toHaveLength(102);
      expect(filter({ flies: true }).every((entry) => (entry.speed.fly ?? 0) > 0)).toBe(true);
      const casters = names({ spellcaster: true });
      expect(casters).toEqual(expect.arrayContaining(["Lich", "Mage", "Archmage"]));
      expect(casters).not.toContain("Goblin");
    });

    it("combines filters with AND", () => {
      const result = names({ legendary: true, flies: true, crMin: 17 });
      expect(result).toContain("Adult Red Dragon");
      expect(result).not.toContain("Goblin");
      expect(filter({ legendary: true, flies: true, crMin: 17 }).every((entry) => entry.legendary && (entry.speed.fly ?? 0) > 0 && entry.cr >= 17)).toBe(true);
      expect(names({ query: "dragon", sizes: ["huge"], crMin: 10, crMax: 12 }).every((name) => /dragon/i.test(name))).toBe(true);
    });
  });

  it("counts how many separate filters are on", () => {
    expect(activeSrdFilterCount({ ...EMPTY_SRD_FILTERS, query: "  " })).toBe(0);
    expect(activeSrdFilterCount({ ...EMPTY_SRD_FILTERS, query: "wolf", crMin: 1, crMax: 3 })).toBe(3);
    expect(activeSrdFilterCount({ ...EMPTY_SRD_FILTERS, sizes: ["tiny", "small"], tiers: ["full"], environment: "Desert", legendary: true, flies: true, spellcaster: true })).toBe(6);
  });
});
