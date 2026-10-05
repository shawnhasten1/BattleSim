// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreatureDefinition, HealingActionDefinition, ItemDefinition } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { useEncounterStore } from "@/store/encounter-store";
import { addFromLibrary, group, openFromLibrary, startFromScratch, useRecipe } from "./helpers/abilities-tab";

/** ITEMS_PLAN.md Phase 2: items on the Abilities tab, added from the library or from scratch, and edited. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")! as CreatureDefinition;
const token = () => store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
const items = () => fighter().items ?? [];

function LiveTab() {
  const encounter = useEncounterStore((state) => state.encounter);
  return (
    <ActionsTab
      combatant={encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!}
      definition={encounter.definitions.find((definition) => definition.id === "def-fighter")!}
    />
  );
}

const section = (name: RegExp) => screen.getByRole("button", { name });
const save = () => userEvent.click(screen.getByRole("button", { name: /^(Add to sheet|Save)$/ }));

describe("items on the Abilities tab", { timeout: 20000 }, () => {
  it("adds a library potion with its + and lists it under Items with how many the token has", async () => {
    render(<LiveTab />);
    await addFromLibrary("Potion of Healing", "potion of healing");
    expect(items().map((item) => item.name)).toEqual(["Potion of Healing"]);
    const row = group("Items").getByRole("button", { name: "Edit Potion of Healing" }).closest("[data-row-id]")!;
    expect(row.textContent).toContain("1 of 1");
    expect(row.textContent).toContain("drink or give (5 ft): 7 (2d4 + 2) HP · action");
  });

  it("starts an item from scratch: a healing potion, added under Items", async () => {
    render(<LiveTab />);
    await startFromScratch("Item");
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Elixir of Mending");
    await save();
    const item = items()[0]!;
    expect(item).toMatchObject({ name: "Elixir of Mending", type: "potion", give: { actionType: "action" } });
    // The potion's drink follows its name, and spends one of its stack.
    expect(item.grantedActions?.[0]).toMatchObject({ kind: "healing", name: "Elixir of Mending", targeting: { target: "self" }, resourceCost: { resourceId: item.supply!.id, amount: 1 } });
    expect(item.supply).toEqual({ id: `item:${item.id}`, size: 1, unit: "count" });
    expect(group("Items").getByRole("button", { name: "Edit Elixir of Mending" })).toBeTruthy();
  });

  it("sets how many it carries, and what drinking and giving take", async () => {
    render(<LiveTab />);
    await openFromLibrary("Potion of Healing", "potion of healing");
    await userEvent.clear(screen.getByLabelText("How many"));
    await userEvent.type(screen.getByLabelText("How many"), "3");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Drinking it takes" })).getByRole("radio", { name: "A bonus action" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Giving it to a creature within 5 ft" })).getByRole("radio", { name: "Can't" }));
    await save();
    const item = items()[0]!;
    expect(item.supply?.size).toBe(3);
    expect((item.grantedActions![0] as HealingActionDefinition).actionType).toBe("bonus");
    expect(item.give).toBeUndefined();
    expect(fighter().resources?.[item.supply!.id]).toBe(3);
    expect(token().resources?.[item.supply!.id]).toBe(3);
  });

  it("builds each type from its recipe", async () => {
    render(<LiveTab />);
    const recipes: Array<[string, ItemDefinition["type"]]> = [
      ["Healing potion", "potion"], ["Buff potion", "potion"], ["Wand", "wand"], ["Thrown flask", "thrown"], ["Worn item", "worn"], ["Other gear", "gear"]
    ];
    for (const [label] of recipes) {
      await useRecipe(label);
      await save();
    }
    expect(items().map((item) => item.type)).toEqual(recipes.map(([, type]) => type));
    const wand = items()[2]!;
    expect(wand.supply).toMatchObject({ size: 7, unit: "charges", regains: "dawn" });
    expect(wand.grantedActions?.[0]).toMatchObject({ resourceCost: { resourceId: wand.supply!.id, amount: 1 } });
    expect(items()[4]!.attunement).toEqual({ attuned: true });
    expect(items()[5]!.grantedActions).toBeUndefined();
  });

  it("attunes and un-attunes from Basics, and the row says so", async () => {
    render(<LiveTab />);
    await useRecipe("Worn item");
    await save();
    await userEvent.click(group("Items").getByRole("button", { name: "Edit New ring" }));
    await userEvent.click(section(/^Basics/));
    await userEvent.click(screen.getByRole("checkbox", { name: "Attuned" }));
    await save();
    expect(items()[0]!.attunement).toEqual({ attuned: false });
    const row = group("Items").getByRole("button", { name: "Edit New ring" }).closest("[data-row-id]")!;
    expect(row.textContent).toContain("not attuned");
  });

  it("turns a potion into a wand from Basics: its stack becomes charges", async () => {
    render(<LiveTab />);
    await addFromLibrary("Potion of Healing", "potion of healing");
    await userEvent.click(group("Items").getByRole("button", { name: "Edit Potion of Healing" }));
    await userEvent.click(section(/^Basics/));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "It's" })).getByRole("radio", { name: "Wand" }));
    await userEvent.click(section(/^Use & cost/));
    expect((screen.getByLabelText("Charges") as HTMLInputElement).value).toBe("1");
    await save();
    expect(items()[0]).toMatchObject({ type: "wand", supply: { unit: "charges", regains: "dawn" } });
    expect(items()[0]!.give).toBeUndefined();
  });

  it("deletes an item, and its pool with it", async () => {
    render(<LiveTab />);
    await addFromLibrary("Potion of Healing", "potion of healing");
    const pool = items()[0]!.supply!.id;
    await userEvent.click(screen.getByRole("button", { name: "More for Potion of Healing" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(items()).toEqual([]);
    expect(fighter().resources?.[pool]).toBeUndefined();
  });
});
