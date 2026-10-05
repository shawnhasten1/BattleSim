// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { armoredAc, type CreatureDefinition, type ItemDefinition } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { StatsCore } from "@/components/sheet/stats/StatsCore";
import { withArmor, withItemType } from "@/lib/ability-editor/items";
import { abilityList } from "@/lib/ability-editor/list";
import { sectionsFor } from "@/lib/ability-editor/sections";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { itemStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";
import { group, useRecipe } from "./helpers/abilities-tab";

/** ARMOR_PLAN.md Phase 1: armor and shields on the sheet, in the item editor, and in the Stats tab's AC. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")! as CreatureDefinition;
const items = () => fighter().items ?? [];

const CHAIN_MAIL: ItemDefinition = {
  id: "chain", name: "Chain Mail", type: "armor", armor: { category: "heavy", ac: 16, strength: 13, stealthDisadvantage: true }, automationSupport: "full"
};
const SHIELD: ItemDefinition = { id: "shield", name: "Shield", type: "shield", armor: { category: "shield", ac: 2 }, automationSupport: "full" };
const carrying = (...list: ItemDefinition[]): CreatureDefinition => ({ ...structuredClone(fighter()), items: list });

describe("the item editor's model", () => {
  it("makes an item armor (leather, worn) or a shield (+2), and back, its stack dropped", () => {
    const potion = { id: "p", name: "Thing", type: "potion", supply: { id: "supply", size: 1, unit: "count" }, give: { actionType: "action" }, automationSupport: "full" } as ItemDefinition;
    const suit = withItemType(potion, "armor");
    expect(suit).toMatchObject({ type: "armor", armor: { category: "light", ac: 11 } });
    expect(suit.supply).toBeUndefined();
    expect(suit.give).toBeUndefined();
    expect(withItemType(suit, "shield").armor).toEqual({ category: "shield", ac: 2 });
    expect(withItemType(suit, "gear").armor).toBeUndefined();
    expect(withArmor(CHAIN_MAIL, { strength: undefined, magicBonus: 1 }).armor).toEqual({ category: "heavy", ac: 16, stealthDisadvantage: true, magicBonus: 1 });
  });

  it("gives armor an Armor section after Basics, saying what it is", () => {
    const sections = sectionsFor({ ref: { list: "items", id: "chain" }, record: CHAIN_MAIL, definition: carrying(CHAIN_MAIL) });
    expect(sections.map((section) => section.id).slice(0, 2)).toEqual(["basics", "armor"]);
    expect(sections.find((section) => section.id === "armor")).toMatchObject({ title: "Armor", summary: "AC 16 · heavy · Str 13 · worn" });
    const shield = sectionsFor({ ref: { list: "items", id: "shield" }, record: { ...SHIELD, equipped: false }, definition: carrying(SHIELD) });
    expect(shield.find((section) => section.id === "armor")).toMatchObject({ title: "Shield", summary: "+2 AC · carried" });
  });

  it("says what armor does on its row", () => {
    expect(itemStatblock(CHAIN_MAIL, carrying(CHAIN_MAIL)).short).toBe("AC 16 · heavy · Str 13 · stealth disadvantage");
    expect(itemStatblock(CHAIN_MAIL, carrying(CHAIN_MAIL)).text)
      .toBe("Heavy armor: worn, its wearer's AC is 16. A wearer with a Strength score below 13 is 10 feet slower. It has disadvantage on Dexterity (Stealth) checks.");
    const leather: ItemDefinition = { id: "l", name: "Leather", type: "armor", armor: { category: "light", ac: 11, magicBonus: 1 }, automationSupport: "full" };
    expect(itemStatblock(leather, carrying(leather)).short).toBe("AC 12 + Dex · light");
    expect(itemStatblock(leather, carrying(leather)).text).toBe("Light armor: worn, its wearer's AC is 12 + its Dexterity modifier (+1 magic).");
    expect(itemStatblock(SHIELD, carrying(SHIELD)).short).toBe("+2 AC");
    const rows = abilityList(carrying(CHAIN_MAIL, { ...SHIELD, equipped: false })).find((candidate) => candidate.id === "items")!.rows;
    expect(rows.map((row) => [row.name, row.worn])).toEqual([["Chain Mail", true], ["Shield", false]]);
  });

  it("warns about a second suit or shield worn, and a shield that isn't a bonus", () => {
    const second: ItemDefinition = { ...CHAIN_MAIL, id: "plate", name: "Plate Armor", armor: { category: "heavy", ac: 18 } };
    const definition = carrying(CHAIN_MAIL, second, SHIELD);
    expect(abilityWarnings(definition, { list: "items", id: "plate" }, second).map((warning) => warning.message))
      .toContain("It also wears Chain Mail: only the better suit counts. Untick Worn on the one it carries.");
    const big = { ...SHIELD, armor: { category: "shield" as const, ac: 7 } };
    expect(abilityWarnings(carrying(big), { list: "items", id: "shield" }, big).map((warning) => warning.id)).toContain("shield-bonus");
    expect(abilityWarnings(carrying(CHAIN_MAIL, { ...second, equipped: false }), { list: "items", id: "chain" }, CHAIN_MAIL).map((warning) => warning.id)).not.toContain("second-suit");
  });
});

function LiveTab() {
  const encounter = useEncounterStore((state) => state.encounter);
  return (
    <ActionsTab
      combatant={encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!}
      definition={encounter.definitions.find((definition) => definition.id === "def-fighter")!}
    />
  );
}

function LiveStats() {
  const definition = useEncounterStore((state) => state.encounter.definitions.find((candidate) => candidate.id === "def-fighter")!);
  return <StatsCore definition={definition} />;
}

const save = () => userEvent.click(screen.getByRole("button", { name: /^(Add to sheet|Save)$/ }));

describe("on the sheet", { timeout: 30000 }, () => {
  it("builds chain mail from the Armor recipe, and the AC follows it", async () => {
    render(<LiveTab />);
    await useRecipe("Armor");
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Chain Mail");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Weight" })).getByRole("radio", { name: "Heavy" }));
    await userEvent.clear(screen.getByLabelText("Base AC"));
    await userEvent.type(screen.getByLabelText("Base AC"), "16");
    await userEvent.type(screen.getByLabelText("Strength needed"), "13");
    await userEvent.click(screen.getByRole("checkbox", { name: "Disadvantage on Stealth" }));
    expect(screen.getByLabelText("What it makes the AC").textContent).toBe("Worn, Test Fighter's AC is 16 (Chain Mail 16), before rings, features and conditions.");
    await save();
    expect(items()[0]).toMatchObject({ name: "Chain Mail", type: "armor", armor: { category: "heavy", ac: 16, strength: 13, stealthDisadvantage: true } });
    expect(armoredAc(fighter()).total).toBe(16);
  });

  it("puts armor on and takes it off from its row", async () => {
    store().insertAbilityRecord("def-fighter", "items", { ...SHIELD, id: "" });
    render(<LiveTab />);
    const worn = group("Items").getByRole("checkbox", { name: "Worn" }) as HTMLInputElement;
    expect(worn.checked).toBe(true);
    expect(armoredAc(fighter()).total).toBe(18);
    await userEvent.click(worn);
    expect(items()[0]!.equipped).toBe(false);
    expect(armoredAc(fighter()).total).toBe(16);
    await userEvent.click(group("Items").getByRole("checkbox", { name: "Worn" }));
    expect(items()[0]!.equipped).toBeUndefined();
  });

  it("shows the AC worn armor gives on the Stats tab, and keeps the typed AC as the AC without armor", async () => {
    render(<LiveStats />);
    expect(screen.queryByRole("status", { name: "Armor Class" })).toBeNull();
    store().insertAbilityRecord("def-fighter", "items", { ...CHAIN_MAIL, id: "" });
    store().insertAbilityRecord("def-fighter", "items", { ...SHIELD, id: "" });
    const total = await screen.findByLabelText("Armor Class", { selector: "output" });
    expect(total.textContent).toBe("18");
    expect(screen.getByText("Chain Mail 16 + Shield 2")).toBeTruthy();
    expect(screen.getByText("Without armor")).toBeTruthy();
  });
});
