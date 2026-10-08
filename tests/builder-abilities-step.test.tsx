// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";

// CHARACTER_BUILDER_UX_PLAN.md §3.3 and D9, D10: the Abilities step. Scores are placed, not typed (the standard array by
// click or drag, point buy's steppers and meter, typed or rolled by hand), and the increases say where they come from.

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useBuilderUiStore.setState({ window: null, homebrew: false });
  useCatalogStore.getState().setEntries([]);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useBuilderUiStore.getState().close();
});

const WIZARD = { name: "Tamsin", classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" };

async function openAbilities(seed: typeof WIZARD = WIZARD) {
  useBuilderUiStore.getState().open({ kind: "create", seed });
  render(<BuilderHost onCreated={() => undefined} />);
  const builder = screen.getByRole("dialog", { name: "Character builder" });
  await userEvent.click(within(within(builder).getByRole("navigation", { name: "Builder steps" })).getByRole("button", { name: /^\d+\s*Abilities/ }));
  return builder;
}
const scores = (builder: HTMLElement) => within(builder).getByRole("region", { name: "Ability scores" });
/** A score's base, from its button's name ("Strength: base 8, score 8"). */
const baseOf = (builder: HTMLElement, name: string) => {
  const button = within(scores(builder)).getByRole("button", { name: new RegExp(`^${name}: base`) });
  return Number(/base (\d+)/.exec(button.getAttribute("aria-label")!)![1]);
};

describe("the Abilities step: scores", { timeout: 30000 }, () => {
  it("places the standard array by clicking a value, then a score: the two swap", async () => {
    const builder = await openAbilities();
    expect(within(scores(builder)).getByRole("button", { name: "Standard array" }).getAttribute("aria-pressed")).toBe("true");
    const [str, int] = [baseOf(builder, "Strength"), baseOf(builder, "Intelligence")];
    expect(int).toBe(15);
    await userEvent.click(within(scores(builder)).getByRole("button", { name: "15, on Intelligence" }));
    await userEvent.click(within(scores(builder)).getByRole("button", { name: "Place 15 on Strength" }));
    expect(baseOf(builder, "Strength")).toBe(15);
    expect(baseOf(builder, "Intelligence")).toBe(str);
    expect(within(builder).getByText("All made")).toBeTruthy();
  });

  it("places a value dragged onto a score, and swaps two scores dragged onto each other", async () => {
    const builder = await openAbilities();
    const dex = baseOf(builder, "Dexterity");
    const target = within(scores(builder)).getByRole("button", { name: /^Wisdom: base/ });
    fireEvent.drop(target, { dataTransfer: { getData: () => "value:14" } });
    expect(baseOf(builder, "Wisdom")).toBe(14);
    const wis = baseOf(builder, "Wisdom");
    fireEvent.drop(within(scores(builder)).getByRole("button", { name: /^Dexterity: base/ }), { dataTransfer: { getData: () => "ability:wis" } });
    expect(baseOf(builder, "Dexterity")).toBe(wis);
    expect(baseOf(builder, "Wisdom")).not.toBe(wis);
    expect(dex).toBeGreaterThan(0);
  });

  it("buys points with steppers under a meter, each + saying what it costs", async () => {
    const builder = await openAbilities();
    await userEvent.click(within(scores(builder)).getByRole("button", { name: "Point buy" }));
    expect(scores(builder).textContent).toMatch(/27 points: 27 spent, 0 left/);
    expect((within(scores(builder)).getByRole("button", { name: "Raise Strength" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(scores(builder)).getByRole("button", { name: "Lower Strength" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(scores(builder)).getByRole("button", { name: "Lower Intelligence" }));
    expect(scores(builder).textContent).toMatch(/27 points: 25 spent, 2 left/);
    const raise = within(scores(builder)).getByRole("button", { name: "Raise Intelligence" });
    expect(raise.getAttribute("title")).toBe("14 → 15 costs 2");
    expect(within(scores(builder)).getByRole("meter", { name: "Points spent" }).getAttribute("aria-valuenow")).toBe("25");
    await userEvent.click(raise);
    expect(baseOf(builder, "Intelligence")).toBe(15);
  });

  it("types scores by hand, or rolls 4d6 and places the rolls", async () => {
    const builder = await openAbilities();
    await userEvent.click(within(scores(builder)).getByRole("button", { name: "Manual" }));
    const str = within(scores(builder)).getByLabelText("Base STR") as HTMLInputElement;
    await userEvent.clear(str);
    await userEvent.type(str, "17");
    expect(baseOf(builder, "Strength")).toBe(17);
    await userEvent.click(within(scores(builder)).getByRole("button", { name: "Roll 4d6, drop lowest" }));
    const rolls = within(scores(builder)).getAllByRole("button", { name: /^Rolled \d+$/ });
    expect(rolls).toHaveLength(6);
    const value = Number(/\d+/.exec(rolls[0]!.getAttribute("aria-label")!)![0]);
    expect(value).toBeGreaterThanOrEqual(3);
    expect(value).toBeLessThanOrEqual(18);
    await userEvent.click(rolls[0]!);
    await userEvent.click(within(scores(builder)).getByRole("button", { name: `Place ${value} on Charisma` }));
    expect(baseOf(builder, "Charisma")).toBe(value);
    expect((within(scores(builder)).getByRole("button", { name: `Rolled ${value}, placed` }) as HTMLButtonElement).disabled).toBe(true);
    // The class's suggestion puts the standard array back.
    await userEvent.click(within(scores(builder)).getByRole("button", { name: "✦ Suggested for a wizard" }));
    expect(baseOf(builder, "Intelligence")).toBe(15);
    expect(within(scores(builder)).getByRole("button", { name: "Standard array" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("explains each score: its base and every increase on top", async () => {
    const builder = await openAbilities();
    const int = within(scores(builder)).getByRole("button", { name: /^Intelligence: base/ }).closest("div")!;
    expect(int.textContent).toMatch(/Base\s*15/);
    expect(int.textContent).toMatch(/Ability Score Improvement \(level 4\)\s*\+2/);
    expect(scores(builder).textContent).toMatch(/★ The wizard's primary ability/);
  });
});

describe("the Abilities step: increases", { timeout: 30000 }, () => {
  it("a 2024 background's three points: +2 and +1, or +1 to all three", async () => {
    const builder = await openAbilities();
    const increases = within(builder).getByRole("region", { name: "Ability increases" });
    expect(increases.textContent).toMatch(/Increases come from your background, Sage \(2024\)\. Dwarf \(2024\) gives none: under the 2024 rules, increases come from the background\./);
    const plus2 = within(increases).getByRole("radiogroup", { name: "Sage's increases: plus 2" });
    const plus1 = within(increases).getByRole("radiogroup", { name: "Sage's increases: plus 1" });
    expect(within(plus2).getByRole("radio", { name: "INT" }).getAttribute("aria-checked")).toBe("true");
    // The +1 can't go where the +2 is; moving the +2 onto the +1's ability swaps them.
    expect(within(plus1).getByRole("radio", { name: "INT" }).getAttribute("aria-disabled")).toBe("true");
    const one = within(plus1).getAllByRole("radio").find((radio) => radio.getAttribute("aria-checked") === "true")!.textContent!;
    await userEvent.click(within(plus2).getByRole("radio", { name: one }));
    expect(within(plus1).getByRole("radio", { name: "INT" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(within(increases).getByRole("button", { name: "+1 to three" }));
    expect(increases.textContent).toMatch(/\+1 CON, \+1 INT, \+1 WIS/);
    const wis = within(scores(builder)).getByRole("button", { name: /^Wisdom: base/ }).closest("div")!;
    expect(wis.textContent).toMatch(/Sage\s*\+1/);
    expect(increases.textContent).toMatch(/Later increases are set where they're chosen: Ability Score Improvement at level 4, \+2 INT\./);
  });

  it("a 2014 race beside a 2024 background: two cards, each saying what it gives", async () => {
    const builder = await openAbilities({ ...WIZARD, speciesId: "srd:species:dwarf-2014" });
    expect(within(builder).getByRole("note").textContent).toMatch(/Mixed rules/);
    const from = within(builder).getByRole("radiogroup", { name: "Ability increases from" });
    const background = within(from).getByRole("radio", { name: "The background: Sage (2024)" });
    const race = within(from).getByRole("radio", { name: "The race: Dwarf (2014)" });
    expect(background.textContent).toMatch(/\+2 and \+1, or \+1 to all three, among CON, INT, WIS/);
    expect(race.textContent).toMatch(/\+2 CON/);
    await userEvent.click(race);
    expect(race.getAttribute("aria-checked")).toBe("true");
    const increases = within(builder).getByRole("region", { name: "Ability increases" });
    expect(increases.textContent).toMatch(/Dwarf \(2014\): \+2 CON.*The background gives none under this choice\./);
    expect(within(increases).queryByRole("radiogroup", { name: "Sage's increases: plus 2" })).toBeNull();
    const con = within(scores(builder)).getByRole("button", { name: /^Constitution: base/ }).closest("div")!;
    expect(con.textContent).toMatch(/Dwarf\s*\+2/);
  });
});
