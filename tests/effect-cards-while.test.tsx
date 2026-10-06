// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConditionInstance, CreatureDefinition, FeatureEffect } from "@/engine";
import { FeatureEffectCards, type EffectPlace } from "@/components/sheet/ability-editor/FeatureEffectCards";
import { pickEffect } from "./helpers/abilities-tab";

/** EFFECTS_PLAN.md, Phase 4: "While" on the cards, damage reduction, creature types, size, and a buff's speed and size modifiers. */

afterEach(() => cleanup());

const creature: CreatureDefinition = {
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 30, speed: 30,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, actions: []
};
type Modifiers = NonNullable<ConditionInstance["modifiers"]>;

let latest: { effects: FeatureEffect[]; modifiers?: Modifiers } = { effects: [] };
function Cards({ place = "always", effects = [], modifiers }: { place?: EffectPlace; effects?: FeatureEffect[]; modifiers?: Modifiers }) {
  const [list, setList] = useState(effects);
  const [mods, setMods] = useState(modifiers);
  latest = { effects: list, modifiers: mods };
  return (
    <div data-section="while-active">
      <FeatureEffectCards
        groups={[{ id: "g", place, effects: list, onChange: setList, modifiers: mods, onModifiers: setMods }]}
        definition={creature} newPools={{ pools: {}, add: () => undefined }} owner="feature" emptyText="Nothing."
      />
    </div>
  );
}
const section = () => within(document.querySelector<HTMLElement>('[data-section="while-active"]')!);
const card = (name: string) => within(screen.getByRole("group", { name: `${name} effect` }));

describe("While", () => {
  it("is on the AC card itself: Defense, +1 while it wears armor", async () => {
    render(<Cards />);
    await pickEffect(section(), "ac bonus", "AC bonus");
    await userEvent.selectOptions(card("AC bonus").getByLabelText("While it wears"), "worn");
    expect(latest.effects).toEqual([{ kind: "armor-class-bonus", bonus: { base: 1 }, armor: "worn" }]);
    expect(card("AC bonus").getByText("It gains a +1 bonus to AC while it wears armor.")).toBeTruthy();
  });

  it("reads Bracers of Defense's older flag as no armor and no shield, and becomes it when changed", async () => {
    render(<Cards effects={[{ kind: "armor-class-bonus", bonus: { base: 2 }, unarmoredOnly: true }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit ac bonus effect" }));
    expect((card("AC bonus").getByLabelText("While it wears") as HTMLSelectElement).value).toBe("none");
    expect((card("AC bonus").getByLabelText("While it holds") as HTMLSelectElement).value).toBe("no");
    await userEvent.selectOptions(card("AC bonus").getByLabelText("While it holds"), "");
    expect(latest.effects).toEqual([{ kind: "armor-class-bonus", bonus: { base: 2 }, armor: "none" }]);
  });

  it("sits under More options on other cards", async () => {
    render(<Cards />);
    await pickEffect(section(), "evasion", "Evasion");
    expect(card("Evasion").queryByLabelText("While it wears")).toBeNull();
    await userEvent.click(card("Evasion").getByRole("button", { name: /^More options/ }));
    await userEvent.selectOptions(card("Evasion").getByLabelText("While it wears"), "not-heavy");
    expect(latest.effects).toEqual([{ kind: "evasion", armor: "not-heavy" }]);
  });
});

describe("the new cards", () => {
  it("damage reduction, from the Heavy Armor Master example", async () => {
    render(<Cards />);
    await pickEffect(section(), "heavy armor master", "3 less from nonmagical bludgeoning, piercing and slashing, like Heavy Armor Master");
    expect(latest.effects).toEqual([{ kind: "damage-reduction", amount: { base: 3 }, damageTypes: ["bludgeoning", "piercing", "slashing"], nonMagicalOnly: true }]);
    await userEvent.click(card("Damage reduction").getByLabelText("Only from nonmagical attacks"));
    expect(latest.effects[0]).not.toHaveProperty("nonMagicalOnly");
  });

  it("size: one size larger, like Enlarge, or a size", async () => {
    render(<Cards />);
    await pickEffect(section(), "enlarge", "One size larger, like Enlarge");
    await userEvent.selectOptions(card("Size").getByLabelText("It becomes"), "to:huge");
    expect(latest.effects).toEqual([{ kind: "size", to: "huge" }]);
  });

  it("ignores difficult terrain", async () => {
    render(<Cards />);
    await pickEffect(section(), "freedom of movement", "Ignores difficult terrain");
    expect(latest.effects).toEqual([{ kind: "ignore-difficult-terrain" }]);
  });

  it("an attack's extra damage only against undead", async () => {
    render(<Cards />);
    await pickEffect(section(), "extra damage", "Extra damage on its hits");
    const damage = card("Extra damage on its hits");
    await userEvent.click(damage.getByRole("button", { name: /^More options/ }));
    await userEvent.click(within(damage.getByRole("group", { name: "Only against" })).getByRole("button", { name: "undead" }));
    expect(latest.effects[0]).toMatchObject({ kind: "damage-bonus", targetTypes: ["undead"] });
  });
});

describe("a buff's speed and size modifiers", () => {
  it("edit as Speed and Size cards, written back to the modifiers", async () => {
    render(<Cards place="condition" modifiers={{ movementMultiplier: 2, speedPenaltyFt: 10, sizeTo: "large" }} />);
    const [halved, slower] = screen.getAllByRole("button", { name: "Edit speed effect" });
    await userEvent.click(halved!);
    await userEvent.click(within(card("Speed").getByRole("radiogroup", { name: "Its speed is" })).getByRole("radio", { name: "Zero: it can't move" }));
    expect(latest.modifiers?.movementMultiplier).toBe(999);
    await userEvent.click(card("Speed").getByRole("button", { name: "Done" }));
    await userEvent.click(slower!);
    const feet = card("Speed").getByLabelText("Slower by (ft)");
    await userEvent.clear(feet);
    await userEvent.type(feet, "15");
    expect(latest.modifiers?.speedPenaltyFt).toBe(15);
    await userEvent.click(card("Speed").getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit size effect" }));
    expect(within(card("Size").getByLabelText("It becomes")).queryByRole("option", { name: "one size larger" })).toBeNull();
    await userEvent.selectOptions(card("Size").getByLabelText("It becomes"), "to:huge");
    expect(latest.modifiers).toEqual({ movementMultiplier: 999, speedPenaltyFt: 15, sizeTo: "huge" });
  });
});
