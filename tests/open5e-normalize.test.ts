import { describe, expect, it } from "vitest";
import { normalizeOpen5eCreature } from "@/adapters";

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
});
