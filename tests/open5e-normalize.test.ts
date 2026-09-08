import { describe, expect, it } from "vitest";
import { normalizeOpen5eConditionName, normalizeOpen5eCreature, normalizeOpen5eFeatureReference, normalizeOpen5eSpell, normalizeOpen5eWeapon } from "@/adapters";

describe("Open5e normalization", () => {
  it("keeps same-named creatures from different documents distinguishable", () => {
    const first = normalizeOpen5eCreature({
      provider: "open5e",
      resource: "creature",
      slug: "scout",
      documentKey: "srd-2014",
      importedAt: "2026-09-06T00:00:00.000Z",
      payloadVersion: "v2",
      raw: { name: "Scout", armor_class: 13, hit_points: 16, document: { key: "srd-2014", name: "SRD 2014" } }
    });
    const second = normalizeOpen5eCreature({
      provider: "open5e",
      resource: "creature",
      slug: "scout",
      documentKey: "srd-2024",
      importedAt: "2026-09-06T00:00:00.000Z",
      payloadVersion: "v2",
      raw: { name: "Scout", armor_class: 13, hit_points: 18, document: { key: "srd-2024", name: "SRD 2024" } }
    });

    expect(first.name).toBe(second.name);
    expect(first.id).not.toBe(second.id);
    expect(first.source?.documentKey).toBe("srd-2014");
    expect(second.source?.documentKey).toBe("srd-2024");
    expect(first.actions[0]?.automationSupport).toBe("unsupported");
  });

  it("maps Open5e item weapon payloads into executable weapon definitions", () => {
    const weapon = normalizeOpen5eWeapon({
      provider: "open5e",
      resource: "item",
      slug: "srd-2024_longsword",
      key: "srd-2024_longsword",
      documentKey: "srd-2024",
      importedAt: "2026-09-08T00:00:00.000Z",
      payloadVersion: "v2",
      raw: {
        key: "srd-2024_longsword",
        name: "Longsword",
        weapon: {
          name: "Longsword",
          damage_dice: "1d8",
          damage_type: { key: "slashing", name: "Slashing" },
          range: 0,
          long_range: 0,
          properties: [{ property: { name: "Versatile" }, detail: "1d10" }]
        },
        document: { key: "srd-2024", name: "System Reference Document 5.2" }
      }
    });

    expect(weapon).toMatchObject({
      name: "Longsword",
      attackType: "melee",
      ability: "str",
      damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
      source: { provider: "open5e", documentKey: "srd-2024" }
    });
    expect(weapon?.properties).toContain("Versatile (1d10)");
  });

  it("preserves source metadata on imported spell references", () => {
    const spell = normalizeOpen5eSpell({
      provider: "open5e",
      resource: "spell",
      slug: "srd-2024_fire-bolt",
      key: "srd-2024_fire-bolt",
      documentKey: "srd-2024",
      importedAt: "2026-09-08T00:00:00.000Z",
      payloadVersion: "v2",
      raw: {
        key: "srd-2024_fire-bolt",
        name: "Fire Bolt",
        level: 0,
        range: 120,
        desc: "Make a ranged spell attack.",
        document: { key: "srd-2024", name: "System Reference Document 5.2" }
      }
    });

    expect(spell).toMatchObject({
      name: "Fire Bolt",
      automationSupport: "manual-only",
      source: {
        provider: "open5e",
        documentKey: "srd-2024",
        slug: "srd-2024_fire-bolt"
      }
    });
  });

  it("keeps broad compendium feature results as manual-only references", () => {
    const feature = normalizeOpen5eFeatureReference({
      key: "search:srd-2024:sneak-attack:0",
      objectKey: "srd-2024_rogue",
      slug: "srd-2024_rogue",
      name: "Rogue",
      resource: "feature",
      model: "CharacterClass",
      route: "v2/classes/",
      documentKey: "srd-2024",
      documentTitle: "System Reference Document 5.2",
      text: "Sneak Attack reference text.",
      raw: {}
    });

    expect(feature).toMatchObject({
      name: "Rogue",
      category: "feature",
      description: "Sneak Attack reference text.",
      automationSupport: "manual-only",
      source: { provider: "open5e", documentKey: "srd-2024" }
    });
  });

  it("maps supported Open5e condition names to engine conditions", () => {
    expect(normalizeOpen5eConditionName("Prone")).toBe("prone");
    expect(normalizeOpen5eConditionName("Bloodied")).toBeUndefined();
  });
});
