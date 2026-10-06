// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { ConditionInstance, CreatureDefinition, FeatureEffect } from "@/engine";
import { FeatureEffectCards, type EffectPlace } from "@/components/sheet/ability-editor/FeatureEffectCards";
import { pickEffect } from "./helpers/abilities-tab";

/** EFFECTS_PLAN.md, Phase 1: the Speed card, its "While", and a buff's older speed modifiers as Speed cards. */

afterEach(() => cleanup());

const creature: CreatureDefinition = {
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 30, speed: 30,
  abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: []
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
        definition={creature} newPools={{ pools: {}, add: () => undefined }} owner="item" emptyText="Nothing."
      />
    </div>
  );
}
const section = () => within(document.querySelector<HTMLElement>('[data-section="while-active"]')!);
const card = () => within(screen.getByRole("group", { name: "Speed effect" }));

describe("the Speed card", () => {
  it("is found by searching for boots, and an example comes filled in", async () => {
    render(<Cards />);
    await pickEffect(section(), "boots", "Doubled, like Boots of Speed");
    expect(latest.effects).toEqual([{ kind: "speed", multiplier: 2 }]);
    expect(within(card().getByRole("radiogroup", { name: "Its speed is" })).getByRole("radio", { name: "Doubled" }).getAttribute("aria-checked")).toBe("true");
  });

  it("builds Fast Movement from a blank one: +10 ft while it wears no heavy armor", async () => {
    render(<Cards />);
    await pickEffect(section(), "speed", "Speed");
    const box = card().getByLabelText("Speed change (ft)");
    await userEvent.clear(box);
    await userEvent.type(box, "15");
    await userEvent.selectOptions(card().getByLabelText("While it wears"), "not-heavy");
    expect(latest.effects).toEqual([{ kind: "speed", bonusFt: 15, armor: "not-heavy" }]);
    expect(card().getByText("Its walking speed increases by 15 ft while it wears no heavy armor.")).toBeTruthy();
  });

  it("sets a minimum, a multiplier and a new movement mode", async () => {
    render(<Cards effects={[{ kind: "speed" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit speed effect" }));
    await userEvent.click(card().getByLabelText("At least"));
    await userEvent.click(within(card().getByRole("radiogroup", { name: "Its speed is" })).getByRole("radio", { name: "Halved" }));
    await userEvent.selectOptions(card().getByLabelText("Flying speed"), "walk");
    await userEvent.click(card().getByLabelText("It can hover"));
    await userEvent.selectOptions(card().getByLabelText("Swimming speed"), "feet");
    expect(latest.effects).toEqual([{ kind: "speed", minimumFt: 30, multiplier: 0.5, modes: { fly: "walk", swim: 30 }, hover: true }]);
    await userEvent.selectOptions(card().getByLabelText("Flying speed"), "");
    expect(latest.effects[0]).toMatchObject({ modes: { swim: 30 } });
    expect((latest.effects[0] as { modes?: object }).modes).not.toHaveProperty("fly");
    await userEvent.click(card().getByRole("button", { name: /^More options/ }));
    await userEvent.click(card().getByLabelText("Its other speeds change too (Haste)"));
    await userEvent.click(card().getByLabelText("Heavy armor doesn't slow it"));
    expect(latest.effects[0]).toMatchObject({ allModes: true, noArmorSlowdown: true });
  });

  it("edits a buff's older speed and fly modifiers as Speed cards, written back to the modifiers", async () => {
    render(<Cards place="condition" modifiers={{ sizeTo: "large", speedBonusFt: 10, flySpeed: "walk" }} />);
    const [speed, fly] = screen.getAllByRole("button", { name: "Edit speed effect" });
    await userEvent.click(speed!);
    const box = card().getByLabelText("Speed change (ft)");
    await userEvent.clear(box);
    await userEvent.type(box, "20");
    expect(latest.modifiers).toEqual({ sizeTo: "large", speedBonusFt: 20, flySpeed: "walk" });
    expect(card().queryByLabelText("Flying speed")).toBeNull();
    await userEvent.click(card().getByRole("button", { name: "Done" }));
    await userEvent.click(fly!);
    await userEvent.selectOptions(card().getByLabelText("Flying speed"), "feet");
    expect(latest.modifiers).toEqual({ sizeTo: "large", speedBonusFt: 20, flySpeed: 30 });
  });
});
