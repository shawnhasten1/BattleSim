import { beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type ActionDefinition, type CombatantState, type CreatureDefinition, type HealingActionDefinition, type ItemDefinition } from "@/engine";
import { SRD_ITEMS } from "@/data/srd";
import { prepareLibrary, searchAdd } from "@/lib/ability-editor/add";
import { drinkTiming, giveTiming, itemUseChoices, withDrinkTiming, withGiveTiming, withItemType } from "@/lib/ability-editor/items";
import { checkRecordJson, recordJson } from "@/lib/ability-editor/json";
import { abilityList } from "@/lib/ability-editor/list";
import { poolOptions } from "@/lib/ability-editor/pools";
import { sectionsFor } from "@/lib/ability-editor/sections";
import { stepChoices } from "@/lib/ability-editor/sequence";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { resourceRows, withResourceSize } from "@/lib/actor-sheet/resources";
import { withoutDefinitionItem } from "@/lib/definition-edits";
import { costText, itemStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";

/** ITEMS_PLAN.md Phase 2: items on the sheet, as the list, the statblock, the resources, Add and the editor read them. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();

const FIGHTER = structuredClone(sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!);

/** A stack of three Potions of Healing, attached. */
const potions = (overrides: Partial<ItemDefinition> = {}): ItemDefinition => ({
  id: "potions", name: "Potion of Healing", type: "potion", magical: true, supply: { id: "item:potions", size: 3, unit: "count" },
  give: { actionType: "action" },
  grantedActions: [{
    kind: "healing", id: "potions-granted-1", name: "Potion of Healing", actionType: "action", range: 0, healing: [{ dice: "2d4+2" }],
    targeting: { target: "self" }, resourceCost: { resourceId: "item:potions", amount: 1 }, automationSupport: "full"
  }],
  automationSupport: "full",
  ...overrides
});

const wand: ItemDefinition = {
  id: "wand", name: "Wand of Web", type: "wand", magical: true, attunement: { attuned: true },
  supply: { id: "item:wand", size: 7, unit: "charges", regains: "dawn" },
  grantedActions: [{
    kind: "save", id: "wand-granted-1", name: "Web", actionType: "action", range: 60, saveAbility: "dex", dc: 15, damage: [],
    halfDamageOnSuccess: false, onSuccess: "negates", resourceCost: { resourceId: "item:wand", amount: 1 }, automationSupport: "full"
  } as ActionDefinition],
  automationSupport: "full"
};

const ring = (attuned = true): ItemDefinition => ({
  id: "ring", name: "Ring of Protection", type: "worn", magical: true, attunement: { attuned },
  effects: [{ kind: "armor-class-bonus", bonus: { base: 1 } }, { kind: "save-bonus", bonus: { base: 1 } }],
  automationSupport: "full"
});

function carrying(items: ItemDefinition[], resources: Record<string, number> = {}): CreatureDefinition {
  return { ...FIGHTER, items, resources: { ...FIGHTER.resources, ...resources } };
}

const token = (resources: Record<string, number>): CombatantState => ({ ...sampleEncounter.combatants[0]!, resources });

describe("the Abilities list", () => {
  it("has an Items group after Spellcasting, each row with how many are left", () => {
    const definition = carrying([potions(), wand, ring()], { "item:potions": 3, "item:wand": 7 });
    const groups = abilityList(definition, token({ "item:potions": 2, "item:wand": 5 }));
    expect(groups.map((group) => group.id)).toEqual(["actions", "bonus", "items"]);
    const items = groups.find((group) => group.id === "items")!;
    expect(items.title).toBe("Items");
    expect(items.note).toBe("attuned 2 of 3");
    expect(items.rows.map((row) => [row.name, row.cost, row.chips])).toEqual([
      ["Potion of Healing", "2 of 3", []],
      ["Wand of Web", "5 of 7 charges", ["attuned"]],
      ["Ring of Protection", undefined, ["attuned"]]
    ]);
    expect(items.rows[0]!.line).toBe("drink or give (5 ft): 7 (2d4 + 2) HP · action");
    expect(items.rows.every((row) => row.itemType === "item" && row.moves.length === 0)).toBe(true);
  });

  it("says what every token starts with for a creature on its own, and marks an item that isn't attuned", () => {
    const groups = abilityList(carrying([potions(), ring(false)], { "item:potions": 3 }));
    const rows = groups.find((group) => group.id === "items")!.rows;
    expect(rows[0]!.cost).toBe("×3");
    expect(rows[1]!.chips).toEqual(["not attuned"]);
    expect(rows[1]!.automation).toBe("partial");
  });
});

describe("the statblock", () => {
  it("says what drinking and giving a potion take and do", () => {
    const definition = carrying([potions()]);
    expect(itemStatblock(potions(), definition)).toMatchObject({
      title: "Potion of Healing",
      text: "Drinking it, or giving it to a creature within 5 feet, takes an action. The drinker regains 7 (2d4 + 2) hit points.",
      short: "drink or give (5 ft): 7 (2d4 + 2) HP · action",
      support: "simulated"
    });
    const split = withDrinkTiming(potions(), "bonus");
    expect(itemStatblock(split, carrying([split])).short).toBe("drink: 7 (2d4 + 2) HP · bonus action · give (5 ft): action");
    const kept = withGiveTiming(potions(), "never");
    expect(itemStatblock(kept, carrying([kept])).text).toMatch(/^Drinking it takes an action\./);
  });

  it("names a wand's charges, and what an item gives while carried", () => {
    const definition = carrying([wand, ring()]);
    const entry = itemStatblock(wand, definition);
    expect(entry.text).toContain("It has 7 charges and regains them at dawn.");
    expect(entry.text).toContain("Uses 1 charge.");
    expect(entry.text).toContain("It requires attunement, and is attuned.");
    expect(itemStatblock(ring(), definition).short).toContain("+1 AC");
  });

  it("is reference text for an item kept for reference, and no combat effect for plain gear", () => {
    const rope: ItemDefinition = { id: "rope", name: "Rope", type: "gear", automationSupport: "full" };
    expect(itemStatblock(rope, carrying([rope])).support).toBe("no-effect");
    const noted = { ...potions(), automationSupport: "manual-only" as const, description: "A strange brew." };
    expect(itemStatblock(noted, carrying([noted]))).toMatchObject({ support: "reference", short: "A strange brew" });
  });

  it("names an item's pool after the item when spending it", () => {
    const definition = carrying([potions(), wand]);
    expect(costText({ resourceId: "item:potions", amount: 1 }, definition)).toBe("1 Potion of Healing");
    expect(costText({ resourceId: "item:wand", amount: 2 }, definition)).toBe("2 charges");
    expect(costText({ resourceId: "item:gone", amount: 1 })).toBe("1 use");
  });
});

describe("the resource list", () => {
  it("lists a stack under its item's name and charges as its charges", () => {
    const definition = carrying([potions(), wand], { "item:potions": 3, "item:wand": 7 });
    const rows = resourceRows(definition, token({ "item:potions": 1, "item:wand": 7 })).filter((row) => row.kind === "item");
    expect(rows).toEqual([
      { id: "item:potions", kind: "item", label: "Potion of Healing", left: 1, full: 3 },
      { id: "item:wand", kind: "item", label: "Wand of Web charges", left: 7, full: 7, note: "regains them at dawn" }
    ]);
  });

  it("keeps a stack's size in step with its item", () => {
    const sized = withResourceSize(carrying([potions()], { "item:potions": 3 }), "item:potions", 5);
    expect(sized.resources?.["item:potions"]).toBe(5);
    expect(sized.items?.[0]?.supply?.size).toBe(5);
  });

  it("drops an item's pool when the item is deleted", () => {
    const after = withoutDefinitionItem(carrying([potions()], { "item:potions": 3 }), "item", "potions");
    expect(after.items).toEqual([]);
    expect(after.resources?.["item:potions"]).toBeUndefined();
    expect(after.resources?.["second-wind"]).toBe(1);
  });
});

describe("the item editor's model", () => {
  it("has its own sections: what it does and what it gives while carried", () => {
    const definition = carrying([potions()]);
    const sections = sectionsFor({ ref: { list: "items", id: "potions" }, record: potions(), definition });
    expect(sections.map((section) => [section.id, section.title])).toEqual([
      ["basics", "Basics"], ["use", "Use & cost"], ["grants", "What it does"], ["while-active", "While carried"], ["notes", "Notes & AI"]
    ]);
    expect(sections.find((section) => section.id === "use")!.summary).toBe("×3 · drink: action · give (5 ft): action");
    expect(sections.find((section) => section.id === "basics")!.summary).toBe("Potion of Healing · potion · magic");
  });

  it("changes type: a wand gets charges and can't be given; a potion gets a stack and is given for an action", () => {
    const asWand = withItemType(potions(), "wand");
    expect(asWand.supply).toEqual({ id: "item:potions", size: 3, unit: "charges", regains: "dawn" });
    expect(asWand.give).toBeUndefined();
    const asPotion = withItemType({ id: "x", name: "Brew", type: "gear", automationSupport: "full" }, "potion");
    expect(asPotion.give).toEqual({ actionType: "action" });
    expect(asPotion.supply).toEqual({ id: "supply", size: 1, unit: "count" });
  });

  it("sets what drinking and giving take", () => {
    const quick = withDrinkTiming(potions(), "bonus");
    expect(drinkTiming(quick)).toBe("bonus");
    expect((quick.grantedActions![0] as HealingActionDefinition).actionType).toBe("bonus");
    expect(giveTiming(withGiveTiming(quick, "never"))).toBe("never");
    expect(withGiveTiming(quick, "bonus").give).toEqual({ actionType: "bonus" });
  });

  it("offers a potion's use as drunk, named after it, spending one of the stack at its drink's timing", () => {
    const choices = itemUseChoices(withDrinkTiming(potions(), "bonus"));
    expect(choices.map((choice) => choice.label)).toEqual(["A heal", "A benefit"]);
    expect(choices[0]!.make()).toMatchObject({
      kind: "healing", name: "Potion of Healing", actionType: "bonus", targeting: { target: "self" }, resourceCost: { resourceId: "item:potions", amount: 1 }
    });
    // Without a stack or charges, a use is at will.
    const plain = itemUseChoices({ id: "r", name: "Ring", type: "worn", automationSupport: "full" });
    expect(plain.every((choice) => !("resourceCost" in choice.make() && (choice.make() as { resourceCost?: unknown }).resourceCost))).toBe(true);
  });

  it("offers the item's stack or charges first in a use's pool picker, by name", () => {
    const options = poolOptions(carrying([potions(), wand], { "item:potions": 3 }));
    expect(options.slice(0, 2)).toEqual([
      { id: "item:potions", label: "Potion of Healing (the stack)", size: 3 },
      { id: "item:wand", label: "Wand of Web's charges", size: 7 }
    ]);
  });

  it("never offers an item's attack or spell as a multiattack step", () => {
    const flask: ItemDefinition = {
      id: "acid", name: "Vial of Acid", type: "thrown", supply: { id: "item:acid", size: 1, unit: "count" },
      grantedActions: [{ kind: "attack", id: "acid-granted-1", name: "Vial of Acid", actionType: "action", attackType: "ranged", ability: "dex", range: 20, damage: [{ dice: "2d6", damageType: "acid" }], resourceCost: { resourceId: "item:acid", amount: 1 }, automationSupport: "full" }],
      automationSupport: "full"
    };
    const labels = stepChoices(carrying([flask, wand])).map((choice) => choice.label);
    expect(labels).not.toContain("Vial of Acid");
    expect(labels).not.toContain("Web");
  });

  it("checks an item's JSON, and refuses one that isn't an item", () => {
    const definition = carrying([potions()], { "item:potions": 3 });
    const ref = { list: "items" as const, id: "potions" };
    const same = checkRecordJson(recordJson(potions()), potions(), ref, definition);
    expect(same.ok && same.changed).toBe(false);
    const bad = checkRecordJson(JSON.stringify({ ...potions(), type: "sword", supply: { id: "item:potions", size: -1, unit: "pints" } }), potions(), ref, definition);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems.map((problem) => problem.path)).toEqual(["type", "supply.size", "supply.unit"]);
  });
});

describe("warnings", () => {
  const warningsOf = (definition: CreatureDefinition, item: ItemDefinition) =>
    abilityWarnings(definition, { list: "items", id: item.id }, item).map((warning) => warning.id);

  it("warns about an item that isn't attuned, too many attuned, an empty stack and a potion that does nothing", () => {
    expect(warningsOf(carrying([ring(false)]), ring(false))).toEqual(["item-not-attuned"]);
    const four = [ring(), { ...ring(), id: "r2" }, { ...ring(), id: "r3" }, { ...ring(), id: "r4" }];
    expect(warningsOf(carrying(four), four[3]!)).toEqual(["too-many-attuned"]);
    const empty = potions({ supply: { id: "item:potions", size: 0, unit: "count" } });
    expect(warningsOf(carrying([empty], { "item:potions": 0 }), empty)).toEqual(["empty-stack"]);
    const dud = potions({ grantedActions: [] });
    expect(warningsOf(carrying([dud], { "item:potions": 3 }), dud)).toEqual(["item-does-nothing"]);
  });

  it("warns that a scroll above what the reader can cast is read without its check", () => {
    const scroll: ItemDefinition = {
      id: "scroll", name: "Scroll of Fireball", type: "scroll", supply: { id: "item:scroll", size: 1, unit: "count" },
      grantedActions: [{ ...wand.grantedActions![0]!, id: "scroll-granted-1", name: "Fireball", spellLevel: 3, resourceCost: { resourceId: "item:scroll", amount: 1 } } as ActionDefinition],
      automationSupport: "full"
    };
    expect(warningsOf(carrying([scroll], { "item:scroll": 1 }), scroll)).toEqual(["scroll-above-level"]);
    expect(warningsOf(carrying([scroll], { "item:scroll": 1, "slot-3": 2 }), scroll)).toEqual([]);
  });

  it("doesn't call a new item's own stack missing while its use is edited", () => {
    const fresh = potions({ id: "", supply: { id: "supply", size: 1, unit: "count" } });
    const use = { ...fresh.grantedActions![0]!, resourceCost: { resourceId: "supply", amount: 1 } } as ActionDefinition;
    const ids = abilityWarnings(carrying([fresh]), { list: "granted", parent: { list: "items", id: "" }, id: use.id }, use).map((warning) => warning.id);
    expect(ids).not.toContain("missing-pool");
  });
});

describe("Add and the library", () => {
  it("finds library potions and item recipes under Items", () => {
    const results = searchAdd("potion", "items", undefined);
    expect(results.library.map((entry) => entry.name)).toEqual(["Potion of Greater Healing", "Potion of Healing", "Potion of Superior Healing", "Potion of Supreme Healing"]);
    expect(results.recipes.map((recipe) => recipe.label)).toEqual(["Buff potion", "Healing potion"]);
    expect(searchAdd("", "items", undefined).recipes.map((recipe) => recipe.label)).toEqual(["Buff potion", "Healing potion", "Other gear", "Thrown flask", "Wand", "Worn item"]);
  });

  it("opens a library item in the editor with where it came from", () => {
    const prepared = prepareLibrary("item", "srd:item:potion-of-healing", FIGHTER)!;
    expect(prepared.list).toBe("items");
    expect(prepared.record).toMatchObject({ name: "Potion of Healing", type: "potion", source: { documentName: "SRD", slug: "srd:item:potion-of-healing" } });
  });

  it("attaches a library potion with its own pool, seeded on the creature and its tokens", () => {
    const id = store().attachSrdItem("def-fighter", "srd:item:potion-of-greater-healing")!;
    const fighter = store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    const item = fighter.items!.find((candidate) => candidate.id === id)!;
    expect(item.supply).toEqual({ id: `item:${id}`, size: 1, unit: "count" });
    expect((item.grantedActions![0] as HealingActionDefinition).healing[0]).toMatchObject({ dice: "4d4+4", diceCount: 4, diceSize: 4, flatBonus: 4 });
    expect(fighter.resources?.[`item:${id}`]).toBe(1);
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources?.[`item:${id}`]).toBe(1);
    expect(SRD_ITEMS.every((entry) => entry.id.startsWith("srd:item:"))).toBe(true);
  });

  it("resizing a stack in the editor: a token that had them all follows, one with fewer keeps them", () => {
    const id = store().attachSrdItem("def-fighter", "srd:item:potion-of-healing")!;
    const pool = `item:${id}`;
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === "pc-fighter" ? { ...combatant, resources: { ...combatant.resources, [pool]: 1 } } : combatant)) }
    }));
    const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;
    const item = fighter().items!.find((candidate) => candidate.id === id)!;
    store().replaceAbilityRecord("def-fighter", { list: "items", id }, { ...item, supply: { ...item.supply!, size: 4 } });
    expect(fighter().resources?.[pool]).toBe(4);
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources?.[pool]).toBe(4);
    // Spend down to 2, then resize to 3: it keeps its 2.
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === "pc-fighter" ? { ...combatant, resources: { ...combatant.resources, [pool]: 2 } } : combatant)) }
    }));
    store().replaceAbilityRecord("def-fighter", { list: "items", id }, { ...fighter().items!.find((candidate) => candidate.id === id)!, supply: { ...item.supply!, size: 3 } });
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources?.[pool]).toBe(2);
  });

  it("saving an item unedited changes nothing and makes no undo step", () => {
    const id = store().attachSrdItem("def-fighter", "srd:item:potion-of-healing")!;
    const depth = store().undoStack.length;
    const item = store().encounter.definitions.find((definition) => definition.id === "def-fighter")!.items!.find((candidate) => candidate.id === id)!;
    store().replaceAbilityRecord("def-fighter", { list: "items", id }, structuredClone(item));
    expect(store().undoStack.length).toBe(depth);
  });
});
