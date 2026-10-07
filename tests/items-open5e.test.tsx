// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Open5eClient, normalizeOpen5eItem, type Open5eImportedPayload } from "@/adapters";
import { getExecutableActions, type ItemDefinition } from "@/engine";
import { srdItemOffer, srdItemOffers } from "@/lib/ability-editor/item-offers";
import { ItemOffers } from "@/components/sheet/abilities/ItemOffers";
import { useEncounterStore } from "@/store/encounter-store";

/** ITEMS_PLAN.md §7, Phase 5: an Open5e item is carried for reference, and the SRD's simulated item of its name offered. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;
const token = () => store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;

function payload(raw: Record<string, unknown>, document = "srd-2014"): Open5eImportedPayload {
  return {
    provider: "open5e", resource: "item", slug: String(raw.key), key: String(raw.key), documentKey: document,
    importedAt: "2026-10-05T00:00:00.000Z", payloadVersion: "v2", raw: { ...raw, document: { key: document, name: document === "srd-2014" ? "SRD 2014" : "Tome of Odds" } }
  };
}

const POTION_RAW = {
  key: "srd_potion-of-healing", name: "Potion of Healing", desc: "You regain 2d4 + 2 hit points when you drink this potion.",
  category: { key: "potion", name: "Potion" }, rarity: { key: "common", name: "Common" }, is_magic_item: true, requires_attunement: false
};

describe("an Open5e item", () => {
  it("is carried for reference, its kind from its category, its source kept", () => {
    const potion = normalizeOpen5eItem(payload(POTION_RAW));
    expect(potion).toMatchObject({
      id: "open5e:srd-2014:srd_potion-of-healing:item", name: "Potion of Healing", type: "potion", magical: true, automationSupport: "manual-only",
      description: "You regain 2d4 + 2 hit points when you drink this potion.",
      source: { provider: "open5e", documentKey: "srd-2014", documentName: "SRD 2014", slug: "srd_potion-of-healing" }
    });
    const ring = normalizeOpen5eItem(payload({ key: "ring-of-x", name: "Ring of Warmth", category: { key: "ring", name: "Ring" }, requires_attunement: true }));
    expect(ring).toMatchObject({ type: "worn", attunement: { attuned: true } });
    expect(normalizeOpen5eItem(payload({ key: "cloak", name: "Cloak of Elvenkind", category: { key: "wondrous-item" } })).type).toBe("gear");
    expect(normalizeOpen5eItem(payload({ key: "wand", name: "Wand of Secrets", category: { key: "wand" } })).type).toBe("wand");
  });

  it("from two documents under the same name stays two items", () => {
    const one = normalizeOpen5eItem(payload(POTION_RAW, "srd-2014"));
    const other = normalizeOpen5eItem(payload(POTION_RAW, "tome-of-odds"));
    expect(one.id).not.toBe(other.id);
    expect([one.source?.documentKey, other.source?.documentKey]).toEqual(["srd-2014", "tome-of-odds"]);
  });

  it("comes back from the compendium as an item, not a feature; a weapon still as a weapon", async () => {
    const { GET } = await import("../app/api/open5e/compendium/content/route");
    const importRecord = vi.spyOn(Open5eClient.prototype, "importCompendiumRecord");
    importRecord.mockResolvedValueOnce(payload(POTION_RAW));
    const item = await (await GET(new Request("http://local/api/open5e/compendium/content?route=v2/items/&key=srd_potion-of-healing"))).json();
    expect(item.item).toMatchObject({ name: "Potion of Healing", type: "potion", automationSupport: "manual-only" });
    expect(item.feature).toBeUndefined();
    importRecord.mockResolvedValueOnce(payload({ key: "longsword", name: "Longsword", weapon: { name: "Longsword", damage_dice: "1d8", damage_type: { name: "Slashing" } } }));
    const weapon = await (await GET(new Request("http://local/api/open5e/compendium/content?route=v2/items/&key=longsword"))).json();
    expect(weapon.weapon).toMatchObject({ name: "Longsword" });
    expect(weapon.item).toBeUndefined();
  });
});

describe("the SRD's item, offered", () => {
  const open5e = (raw: Record<string, unknown>) => normalizeOpen5eItem(payload(raw));

  it("for an Open5e item the library simulates, by name", () => {
    expect(srdItemOffer(open5e(POTION_RAW))).toMatchObject({ srdId: "srd:item:potion-of-healing", text: "The SRD's Potion of Healing is simulated.", from: "SRD 2014" });
    // "Acid (vial)" is the library's Vial of Acid.
    expect(srdItemOffer(open5e({ key: "acid", name: "Acid (vial)", category: { key: "adventuring-gear" } }))?.srdId).toBe("srd:item:acid-vial");
  });

  it("not for one the library only carries for reference too, one already simulated, or a homebrew item", () => {
    expect(srdItemOffer(open5e({ key: "fire", name: "Alchemist's Fire", category: { key: "adventuring-gear" } }))).toBeUndefined();
    expect(srdItemOffer({ ...open5e(POTION_RAW), automationSupport: "full" })).toBeUndefined();
    expect(srdItemOffer({ ...open5e(POTION_RAW), source: { provider: "homebrew" } })).toBeUndefined();
  });

  it("taken, swaps the library's item in: its place, its pool and how many kept, one undo step", () => {
    const reference = { ...open5e(POTION_RAW), supply: { id: "supply", size: 3, unit: "count" as const } };
    const ref = store().insertAbilityRecord("def-fighter", "items", reference as ItemDefinition)!;
    const id = (ref as { id: string }).id;
    expect(fighter().resources?.[`item:${id}`]).toBe(3);
    const [offer] = srdItemOffers(fighter());
    store().swapInSrdItem("def-fighter", id, offer!.srdId);
    const item = fighter().items!.find((candidate) => candidate.id === id)!;
    expect(item).toMatchObject({ name: "Potion of Healing", automationSupport: "full", supply: { id: `item:${id}`, size: 3 }, source: { documentName: "System Reference Document 5.1", slug: "srd:item:potion-of-healing", edition: "2014" } });
    expect(getExecutableActions(fighter()).filter((action) => action.item?.id === id).map((action) => action.item?.use)).toEqual(["drink", "give"]);
    expect(token().resources?.[`item:${id}`]).toBe(3);
    expect(srdItemOffers(fighter())).toEqual([]);
    store().undo();
    expect(fighter().items!.find((candidate) => candidate.id === id)?.automationSupport).toBe("manual-only");
  });

  it("a wand carried for reference gets the library's charges when it's swapped", () => {
    const ref = store().insertAbilityRecord("def-fighter", "items", open5e({ key: "fireballs", name: "Wand of Fireballs", category: { key: "wand" } }))!;
    const id = (ref as { id: string }).id;
    store().swapInSrdItem("def-fighter", id, "srd:item:wand-of-fireballs");
    expect(fighter().items!.find((candidate) => candidate.id === id)?.supply).toMatchObject({ id: `item:${id}`, size: 7, unit: "charges" });
    expect(fighter().resources?.[`item:${id}`]).toBe(7);
  });

  it("is offered on the Abilities tab, and taken with a click", async () => {
    const ref = store().insertAbilityRecord("def-fighter", "items", open5e(POTION_RAW))!;
    render(<ItemOffers definition={fighter()} />);
    expect(screen.getByText(/Potion of Healing \(SRD 2014\) is carried for reference\. The SRD's Potion of Healing is simulated\./)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use the SRD's simulated item for Potion of Healing (SRD 2014)" }));
    expect(fighter().items!.find((candidate) => candidate.id === (ref as { id: string }).id)?.automationSupport).toBe("full");
  });
});
