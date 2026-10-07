import { beforeEach, describe, expect, it } from "vitest";
import type { CreatureDefinition, FeatureDefinition, ItemDefinition, SpellDefinition } from "@/engine";
import { SRD_FEATURES, SRD_ITEMS, SRD_SPELL_SCROLLS, SRD_SPELLS, SRD_WEAPONS, findSrdItem } from "@/data/srd";
import { SRD_2024_CATALOG } from "@/data/srd/2024";
import { srd52Source } from "@/data/srd/2024/reference";
import { SRD_2024_SPELLS } from "@/data/srd/2024/spells";
import { normalizeOpen5eItem, normalizeOpen5eSpell } from "@/adapters/open5e-normalize";
import type { Open5eImportedPayload } from "@/adapters/open5e-client";
import { srdItemOffer } from "@/lib/ability-editor/item-offers";
import { prepareLibrary } from "@/lib/ability-editor/add";
import { prepareSaved, savedFrom } from "@/lib/ability-editor/my-library";
import { srdTwin, srdUpcastOffer } from "@/lib/ability-editor/upcasting";
import { editionOf, open5eEdition } from "@/lib/editions";
import { useEncounterStore } from "@/store/encounter-store";

/** EDITIONS_PLAN.md Phase 0: every record says which rules it's written for, and nothing matches across editions by name. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((candidate) => candidate.id === "def-fighter")! as CreatureDefinition;

const NOT_IN_SRD_51 = ["srd:feature:rage-bear-totem", "srd:feature:rage-zealot", "srd:feature:mobile", "srd:feature:great-weapon-master", "srd:feature:sharpshooter"];

describe("every bundled record has an edition", () => {
  it("the 2014 library: weapons, spells, features, items and scrolls", () => {
    for (const record of [...SRD_WEAPONS, ...SRD_SPELLS, ...SRD_FEATURES, ...SRD_ITEMS, ...SRD_SPELL_SCROLLS]) {
      expect(editionOf(record), record.id).toBe("2014");
    }
  });

  it("the SRD's own records say SRD 5.1, and its slug is the library id a sheet matches on", () => {
    expect(SRD_SPELLS.find((spell) => spell.id === "srd:spell:fireball")!.source).toEqual({
      provider: "srd", documentKey: "srd-2014", documentName: "System Reference Document 5.1", slug: "srd:spell:fireball", edition: "2014"
    });
    expect(SRD_SPELL_SCROLLS.find((scroll) => scroll.id === "srd:item:scroll-of-fireball")!.source?.slug).toBe("srd:item:scroll-of-fireball");
  });

  it("the 2014-rules features from outside SRD 5.1 are never called SRD content", () => {
    for (const id of NOT_IN_SRD_51) {
      const source = SRD_FEATURES.find((feature) => feature.id === id)!.source!;
      expect(source.provider, id).toBe("homebrew");
      expect(source.documentKey, id).toBeUndefined();
      expect(source.documentName, id).not.toMatch(/SRD|System Reference/);
      expect(source.edition, id).toBe("2014");
    }
    const others = SRD_FEATURES.filter((feature) => !NOT_IN_SRD_51.includes(feature.id));
    expect(others.length).toBeGreaterThan(10);
    for (const feature of others) expect(feature.source?.documentKey, feature.id).toBe("srd-2014");
  });

  it("the 2024 spells and catalog", () => {
    for (const spell of SRD_2024_SPELLS) expect(editionOf(spell), spell.id).toBe("2024");
    const { classes, subclasses, feats, backgrounds, species } = SRD_2024_CATALOG;
    for (const entry of [...classes, ...subclasses, ...feats, ...backgrounds, ...species]) {
      expect(editionOf(entry), entry.id).toBe("2024");
      expect(entry.source.edition, entry.id).toBe("2024");
    }
  });
});

describe("editionOf", () => {
  it("reads a catalog entry's field first, then its source", () => {
    expect(editionOf({ edition: "2014", source: srd52Source() })).toBe("2014");
    expect(editionOf({ source: srd52Source("srd-2024_fireball") })).toBe("2024");
    expect(editionOf(srd52Source())).toBe("2024");
  });

  it("reads a document key: the monsters' sources", () => {
    expect(editionOf({ provider: "srd", documentKey: "srd-2014", slug: "goblin" })).toBe("2014");
    expect(editionOf({ provider: "open5e", documentKey: "srd-2024" })).toBe("2024");
  });

  it("reads the stamp a library record got when it was attached before records had sources", () => {
    expect(editionOf({ source: { provider: "homebrew", documentName: "SRD", slug: "srd:spell:fireball" } })).toBe("2014");
    expect(editionOf({ provider: "homebrew", documentName: "SRD", slug: "srd:spell:fireball-2024" })).toBeUndefined();
  });

  it("has nothing to say about homebrew", () => {
    expect(editionOf({ provider: "homebrew" })).toBeUndefined();
    expect(editionOf({ source: { provider: "homebrew", documentName: "My library", slug: "mine:x" } })).toBeUndefined();
    expect(editionOf({})).toBeUndefined();
    expect(editionOf(undefined)).toBeUndefined();
  });

  it("an Open5e record's game system says its edition; another game's says none", () => {
    expect(open5eEdition({ document: { key: "tob", gamesystem: { key: "5e-2014" } } }, "tob")).toEqual({ edition: "2014" });
    expect(open5eEdition({ document: { key: "srd-2024", gamesystem: { key: "5e-2024" } } }, "srd-2024")).toEqual({ edition: "2024" });
    expect(open5eEdition({ document: { key: "a5e-ag", gamesystem: { key: "a5e" } } }, "a5e-ag")).toEqual({});
    expect(open5eEdition({}, "srd-2014")).toEqual({ edition: "2014" });
  });
});

const payload = (resource: "spell" | "item", raw: Record<string, unknown>, documentKey: string, gamesystem: string): Open5eImportedPayload => ({
  provider: "open5e", resource, slug: String(raw.key), key: String(raw.key), documentKey,
  importedAt: "2026-10-07T00:00:00.000Z", payloadVersion: "v2",
  raw: { ...raw, document: { key: documentKey, name: documentKey, gamesystem: { key: gamesystem } } }
} as Open5eImportedPayload);

describe("imports and copies keep the edition", () => {
  it("an Open5e spell or item carries its document's edition", () => {
    const spell = normalizeOpen5eSpell(payload("spell", { key: "srd-2024_fireball", name: "Fireball", level: 3 }, "srd-2024", "5e-2024"));
    expect(spell.source).toMatchObject({ provider: "open5e", documentKey: "srd-2024", edition: "2024" });
    const item = normalizeOpen5eItem(payload("item", { key: "tob_widget", name: "Widget" }, "tob", "5e-2014"));
    expect(item.source?.edition).toBe("2014");
  });

  it("a library record added to a sheet keeps its source, stamped with when", () => {
    const prepared = prepareLibrary("spell", "srd:spell:fireball", fighter())!;
    expect(prepared.record.source).toMatchObject({ provider: "srd", documentKey: "srd-2014", slug: "srd:spell:fireball", edition: "2014" });
    expect(prepared.record.source?.importedAt).toBeTruthy();
    const id = store().attachSrdSpell("def-fighter", "srd:spell:fireball")!;
    expect(fighter().spells!.find((spell) => spell.id === id)!.source).toMatchObject({ edition: "2014", slug: "srd:spell:fireball" });
    const weaponId = store().attachSrdWeapon("def-fighter", "srd:weapon:longsword")!;
    expect(fighter().weapons!.find((weapon) => weapon.id === weaponId)!.source).toMatchObject({ edition: "2014", slug: "srd:weapon:longsword" });
    const featureId = store().attachSrdFeature("def-fighter", "srd:feature:great-weapon-master")!;
    expect(fighter().features!.find((feature) => feature.id === featureId)!.source).toMatchObject({ provider: "homebrew", edition: "2014" });
  });

  it("My library keeps the edition of what it saved, and gives it back", () => {
    const barbarian = SRD_2024_CATALOG.classes.find((entry) => entry.id === "srd:class:barbarian")!;
    const rage = barbarian.levels[0]!.grants.find((grant) => grant.key === "rage")!.feature as FeatureDefinition;
    const entry = savedFrom("feature", structuredClone(rage), fighter(), { id: "mine:rage", name: "My Rage" });
    expect(entry.record.source).toMatchObject({ documentName: "My library", slug: "mine:rage", edition: "2024" });
    expect(prepareSaved(entry, fighter()).record.source).toMatchObject({ slug: "mine:rage", edition: "2024" });
    const homebrew = savedFrom("feature", { id: "h", name: "Hm", category: "feature", automationSupport: "manual-only" }, fighter(), { id: "mine:h", name: "Hm" });
    expect(homebrew.record.source?.edition).toBeUndefined();
  });
});

describe("nothing is matched across editions by name", () => {
  const like = (spell: SpellDefinition, source: SpellDefinition["source"]): SpellDefinition => {
    const { upcast: _upcast, ...rest } = structuredClone(spell);
    const action = rest.action ? { ...rest.action } : undefined;
    if (action) delete (action as { upcast?: unknown }).upcast;
    return { ...rest, ...(action ? { action } : {}), id: "mine", source };
  };

  it("a 2024 spell's SRD twin is the 2024 spell, a 2014 or homebrew spell's the 2014 one", () => {
    const fireball2014 = SRD_SPELLS.find((spell) => spell.id === "srd:spell:fireball")!;
    expect(srdTwin(like(fireball2014, srd52Source("srd-2024_fireball")))?.id).toBe("srd:spell:fireball-2024");
    expect(srdTwin(like(fireball2014, { provider: "srd", documentKey: "srd-2014", edition: "2014" }))?.id).toBe("srd:spell:fireball");
    expect(srdTwin(like(fireball2014, { provider: "homebrew" }))?.id).toBe("srd:spell:fireball");
    expect(srdTwin(like(fireball2014, undefined))?.id).toBe("srd:spell:fireball");
  });

  it("the upcast offer says which edition's spell it is", () => {
    const fireball = SRD_SPELLS.find((spell) => spell.id === "srd:spell:fireball")!;
    expect(srdUpcastOffer(like(fireball, undefined))?.text).toMatch(/^The SRD's 2014 Fireball adds 1d6 damage/);
    expect(srdUpcastOffer(like(fireball, srd52Source("srd-2024_fireball")))?.text).toMatch(/^The SRD's 2024 Fireball adds 1d6 damage/);
  });

  it("an Open5e 2024 item is offered the library's 2014 one, and told so", () => {
    const raw = { key: "srd-2024_potion-of-healing", name: "Potion of Healing", category: { key: "potion" }, desc: "Heals." };
    const potion: ItemDefinition = normalizeOpen5eItem(payload("item", raw, "srd-2024", "5e-2024"));
    expect(srdItemOffer(potion)?.text).toBe("The SRD's 2014 Potion of Healing is simulated.");
    const raw2014 = { ...raw, key: "srd_potion-of-healing" };
    expect(srdItemOffer(normalizeOpen5eItem(payload("item", raw2014, "srd-2014", "5e-2014")))?.text).toBe("The SRD's Potion of Healing is simulated.");
    expect(findSrdItem("srd:item:potion-of-healing")).toBeTruthy();
  });
});
