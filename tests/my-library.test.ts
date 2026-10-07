import { beforeEach, describe, expect, it } from "vitest";
import { effectiveDefinition, getExecutableActions, type CreatureDefinition, type FeatureDefinition, type ItemDefinition, type WeaponDefinition } from "@/engine";
import { findSrdItem } from "@/data/srd";
import {
  linkedEntry,
  listOf,
  MY_LIBRARY,
  parseSavedAbility,
  prepareSaved,
  savedFrom,
  savedKindOf,
  searchSaved,
  type SavedAbility
} from "@/lib/ability-editor/my-library";
import { useEncounterStore } from "@/store/encounter-store";

/** My library: abilities saved from the editor in library form, and added to any creature again. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();
const definition = (id: string) => store().encounter.definitions.find((candidate) => candidate.id === id)! as CreatureDefinition;

/** The SRD's Boots of Speed changed to add 10 ft, as it would be on a fighter's sheet. */
function swiftBootsOnTheFighter(): ItemDefinition {
  const boots = structuredClone(findSrdItem("srd:item:boots-of-speed")!);
  boots.name = "Boots of the Swift";
  boots.grantedActions = undefined;
  boots.effects = [{ kind: "speed", bonusFt: 10 }];
  store().insertAbilityRecord("def-fighter", "items", boots);
  return definition("def-fighter").items!.find((item) => item.name === "Boots of the Swift")!;
}

describe("saving to My library", () => {
  it("keeps an item out of the creature's way: its stack named supply again, its uses pointed at it", () => {
    const flask = structuredClone(findSrdItem("srd:item:alchemists-fire")!) as ItemDefinition;
    store().insertAbilityRecord("def-fighter", "items", { ...structuredClone(findSrdItem("srd:item:potion-of-healing")!), name: "Strong Potion" });
    const onSheet = definition("def-fighter").items!.find((item) => item.name === "Strong Potion")!;
    expect(onSheet.supply?.id).toMatch(/^item:/);
    const entry = savedFrom("item", onSheet, definition("def-fighter"), { id: "mine:potion", name: "Strong Potion" });
    const record = entry.record as ItemDefinition;
    expect(record.supply?.id).toBe("supply");
    expect(record.grantedActions?.map((use) => "resourceCost" in use ? use.resourceCost?.resourceId : undefined)).toEqual(["supply"]);
    expect(record.source).toMatchObject({ provider: "homebrew", documentName: MY_LIBRARY, slug: "mine:potion" });
    expect(entry.pools).toBeUndefined();
    expect(flask.id).toBe("srd:item:alchemists-fire");
  });

  it("brings the pools a feature spends, with their sizes, but not slots or its own uses", () => {
    const rage: FeatureDefinition = {
      id: "f", name: "Rage", category: "feature", automationSupport: "full",
      grantedActions: [{ kind: "activate-feature", id: "a", name: "Rage", actionType: "bonus", featureId: "f", resourceCost: { resourceId: "rage", amount: 1 }, automationSupport: "full" }]
    };
    const entry = savedFrom("feature", rage, { resources: { rage: 3, "slot-1": 2 } }, { id: "mine:rage", name: "Rage" });
    expect(entry.pools).toEqual({ rage: 3 });
    expect(savedFrom("feature", rage, { resources: {} }, { id: "mine:rage", name: "Rage", newPools: { rage: 2 } }).pools).toEqual({ rage: 2 });
  });

  it("takes a weapon's charges out of the creature's namespace", () => {
    const wand: WeaponDefinition = {
      id: "weapon-1", name: "Staff", attackType: "melee", ability: "str", range: 5, damage: [{ dice: "1d6", damageType: "bludgeoning" }],
      charges: { id: "weapon-1:charges", max: 10 },
      onHit: [{ id: "r", kind: "damage", when: "on-hit", components: [{ dice: "1d6", damageType: "fire" }], resourceCost: { resourceId: "weapon-1:charges", amount: 1 } }]
    } as WeaponDefinition;
    const record = savedFrom("weapon", wand, { resources: { "weapon-1:charges": 10 } }, { id: "mine:staff", name: "Staff" }).record as WeaponDefinition;
    expect(record.charges?.id).toBe("charges");
    expect(JSON.stringify(record.onHit)).toContain("\"resourceId\":\"charges\"");
  });

  it("says which kinds can be saved", () => {
    expect(["item", "weapon", "spell", "feature", "action", "legendary", "death"].map(savedKindOf)).toEqual(["item", "weapon", "spell", "feature", undefined, undefined, undefined]);
  });
});

describe("adding from My library", () => {
  it("puts a saved item on another creature, working, and pointing back at its entry", () => {
    const entry = savedFrom("item", swiftBootsOnTheFighter(), definition("def-fighter"), { id: "mine:swift", name: "Boots of the Swift" });
    const prepared = prepareSaved(entry, definition("def-archer"));
    expect(prepared.list).toBe("items");
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record, prepared.pools ? { pools: prepared.pools } : undefined);
    const archer = definition("def-archer");
    const boots = archer.items!.find((item) => item.name === "Boots of the Swift")!;
    expect(boots.id).not.toBe(entry.record.id);
    expect(boots.source?.slug).toBe("mine:swift");
    expect(effectiveDefinition(archer).speed).toBe(archer.speed + 10);
    expect(linkedEntry(boots, [entry])).toBe(entry);
  });

  it("gives a saved feature the pools it needs", () => {
    const rage: FeatureDefinition = {
      id: "f", name: "Rage", category: "feature", automationSupport: "full",
      grantedActions: [{ kind: "activate-feature", id: "a", name: "Rage", actionType: "bonus", featureId: "f", resourceCost: { resourceId: "rage", amount: 1 }, condition: { name: "custom", durationRounds: 10 }, automationSupport: "full" }]
    };
    const entry = savedFrom("feature", rage, { resources: { rage: 3 } }, { id: "mine:rage", name: "Rage" });
    const prepared = prepareSaved(entry, definition("def-archer"));
    store().insertAbilityRecord("def-archer", prepared.list, prepared.record, prepared.pools ? { pools: prepared.pools } : undefined);
    const archer = definition("def-archer");
    expect(archer.resources?.rage).toBe(3);
    expect(getExecutableActions(archer).some((action) => action.name === "Rage")).toBe(true);
  });

  it("lists a trait under traits", () => {
    expect(listOf({ kind: "feature", record: { id: "t", name: "T", category: "trait", automationSupport: "full" } })).toBe("traits");
  });
});

describe("finding and checking entries", () => {
  const entries: SavedAbility[] = [
    { id: "mine:a", kind: "item", name: "Boots of the Swift", record: { id: "a", name: "Boots of the Swift", type: "worn", automationSupport: "full" }, savedAt: "" },
    { id: "mine:b", kind: "feature", name: "Tough", record: { id: "b", name: "Tough", category: "feature", automationSupport: "full" }, savedAt: "" }
  ];
  it("searches by name under a filter", () => {
    expect(searchSaved(entries, "", "mine").map((entry) => entry.name)).toEqual(["Boots of the Swift", "Tough"]);
    expect(searchSaved(entries, "boots", "all").map((entry) => entry.name)).toEqual(["Boots of the Swift"]);
    expect(searchSaved(entries, "", "features").map((entry) => entry.name)).toEqual(["Tough"]);
    expect(searchSaved(entries, "", "monster")).toEqual([]);
  });

  it("checks what the server sends", () => {
    expect(parseSavedAbility(entries[0]).entry?.name).toBe("Boots of the Swift");
    expect(parseSavedAbility({ ...entries[0], id: "srd:item:x" }).problem).toMatch(/^id/);
    expect(parseSavedAbility({ ...entries[0], kind: "legendary" }).problem).toMatch(/^kind/);
    expect(parseSavedAbility({ ...entries[0], name: " " }).problem).toMatch(/^name/);
  });
});
