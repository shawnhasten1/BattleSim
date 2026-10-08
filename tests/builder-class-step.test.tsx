// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { quickBuild, readBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";

// CHARACTER_BUILDER_UX_PLAN.md §3.1 and D7: the Class step, a timeline of the character's levels with their choices
// inline, its hit points, the class table, what's ahead, and changing the class.

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

function openBuilder(seed: { name: string; classId: string; level: number; backgroundId?: string; speciesId?: string } = WIZARD) {
  useBuilderUiStore.getState().open({ kind: "create", seed });
  render(<BuilderHost onCreated={() => undefined} />);
  return screen.getByRole("dialog", { name: "Character builder" });
}
const level = (builder: HTMLElement, n: number) => within(builder).getByRole("region", { name: `Level ${n}` });
const card = () => screen.queryByRole("complementary", { name: /: rules$/ });
const railStep = (builder: HTMLElement, name: string) =>
  within(within(builder).getByRole("navigation", { name: "Builder steps" })).getByRole("button", { name: new RegExp(`^\\d+\\s*${name}`) });

describe("the Class step", { timeout: 30000 }, () => {
  it("lists every level with its features, hit points and what got bigger, and what's ahead", () => {
    const builder = openBuilder();
    expect([1, 2, 3, 4, 5].map((n) => level(builder, n))).toHaveLength(5);
    const first = level(builder, 1);
    expect(within(first).getByRole("heading").textContent).toMatch(/Level 1\s*Wizard 1/);
    expect(first.textContent).toMatch(/HP 8 \(d6: 6, CON \+2\)/);
    expect(first.textContent).toMatch(/Cantrips 3/);
    expect(level(builder, 2).textContent).toMatch(/\+6 HP \(4 average, CON \+2\)/);
    expect(level(builder, 5).textContent).toMatch(/Proficiency \+3/);
    // A feature's row shows its card on focus.
    act(() => { within(first).getByRole("button", { name: /Arcane Recovery/ }).focus(); });
    expect(within(card()!).getByText("Arcane Recovery")).toBeTruthy();
    // The subclass's features come under it, marked with its name.
    expect(within(level(builder, 3)).getByRole("button", { name: /Potent Cantrip/ }).textContent).toMatch(/Evoker/);
    const ahead = within(builder).getByRole("region", { name: "Ahead" });
    expect(ahead.textContent).toMatch(/6\s*Sculpt Spells/);
    expect(ahead.textContent).toMatch(/19\s*.*Epic Boon/);
  });

  it("puts each level's choices inline, in pickers that fit, with the suggestions marked", async () => {
    const builder = openBuilder();
    // Class skills: chips with the ability and the bonus they'd have.
    const skills = within(level(builder, 1)).getByRole("group", { name: "Class skills" });
    expect(within(skills).getByRole("checkbox", { name: /^Arcana INT \+\d/ })).toBeTruthy();
    // The subclass and the feat are cards; the builder's picks are marked "✦ suggested".
    const subclass = within(level(builder, 3)).getByRole("radiogroup", { name: "Wizard Subclass" });
    expect(within(subclass).getByRole("radio", { name: /^Evoker/ }).getAttribute("aria-checked")).toBe("true");
    const feat = within(level(builder, 4)).getByRole("radiogroup", { name: "Ability Score Improvement or another feat" });
    // Under "Both", the 2014 Ability Score Improvement is listed beside the 2024 one; the 2024 one is chosen.
    expect(within(feat).getAllByRole("radio", { name: /^Ability Score Improvement/ }).filter((radio) => radio.getAttribute("aria-checked") === "true").map((radio) => radio.getAttribute("aria-label"))).toEqual(["Ability Score Improvement (2024)"]);
    expect(within(level(builder, 4)).getAllByText("✦ suggested").length).toBeGreaterThan(0);
    // Taking a skill back opens the choice: "Choose for me" makes it again.
    const chosen = within(skills).getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked);
    await userEvent.click(chosen[0]!);
    expect(within(level(builder, 1)).getByText("1 of 2")).toBeTruthy();
    expect(within(builder).getByText("1 still to choose")).toBeTruthy();
    await userEvent.click(within(level(builder, 1)).getByRole("button", { name: "Choose for me" }));
    expect(within(builder).getByText("All made")).toBeTruthy();
  });

  it("sends a level's spell choices to Spells, in one line with their counts", async () => {
    const builder = openBuilder();
    const spells = within(level(builder, 1)).getByRole("button", { name: /Cantrips 3 of 3.*Spells ›/ });
    await userEvent.click(spells);
    expect(railStep(builder, "Spells").getAttribute("aria-current")).toBe("step");
  });

  it("switches hit points to rolled: a roll per level, typed or rolled here", async () => {
    const builder = openBuilder();
    const hp = within(builder).getByRole("region", { name: "Hit points" });
    expect(hp.textContent).toMatch(/Max HP\s*37/);
    expect(hp.textContent).toMatch(/Dwarven Toughness \+5/);
    await userEvent.click(within(within(hp).getByRole("group", { name: "Hit points per level" })).getByRole("button", { name: "Rolled" }));
    const roll = within(level(builder, 2)).getByLabelText("Level 2 hit die roll") as HTMLInputElement;
    await userEvent.type(roll, "1");
    expect(hp.textContent).toMatch(/Max HP\s*34/);
    expect(level(builder, 2).textContent).toMatch(/\+3 HP \(rolled 1, CON \+2\)/);
    await userEvent.click(within(level(builder, 3)).getByRole("button", { name: "Roll d6 for level 3" }));
    const rolled = Number((within(level(builder, 3)).getByLabelText("Level 3 hit die roll") as HTMLInputElement).value);
    expect(rolled).toBeGreaterThanOrEqual(1);
    expect(rolled).toBeLessThanOrEqual(6);
  });

  it("opens the class table, 1 to 20", async () => {
    const builder = openBuilder();
    await userEvent.click(within(builder).getByRole("button", { name: "The class table, 1–20" }));
    const table = within(builder).getByRole("table", { name: "The Wizard table" });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    expect(within(table).getByRole("columnheader", { name: "Spell slots" })).toBeTruthy();
  });

  it("changes the class, keeping the scores, background and species", async () => {
    const builder = openBuilder();
    await userEvent.click(within(builder).getByRole("button", { name: "Change class" }));
    const classes = within(builder).getByRole("radiogroup", { name: "Class" });
    await userEvent.click(within(classes).getByRole("radio", { name: "Fighter (2024)" }));
    const note = within(builder).getByRole("note");
    expect(note.textContent).toMatch(/Switching to the 2024 Fighter rebuilds levels 1–5 as a fighter\. Your scores, background, species and origin choices stay\./);
    await userEvent.click(within(note).getByRole("button", { name: "Keep the Wizard" }));
    expect(within(builder).queryByRole("note")).toBeNull();
    await userEvent.click(within(classes).getByRole("radio", { name: "Fighter (2024)" }));
    await userEvent.click(within(builder).getByRole("button", { name: "Switch" }));
    expect(within(within(builder).getByRole("region", { name: "Your class" })).getByRole("heading", { name: "Fighter" })).toBeTruthy();
    expect(within(builder).getByText("All made")).toBeTruthy();
    // A fighter's weapon mastery is a table.
    const mastery = within(level(builder, 1)).getByRole("group", { name: "Weapon Mastery" });
    expect(within(mastery).getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked)).toHaveLength(3);
    act(() => { within(mastery).getAllByRole("button", { name: "Sap" })[0]!.focus(); });
    expect(card()!.textContent).toMatch(/Sap/);

    await userEvent.click(within(builder).getByRole("button", { name: "Create character" }));
    const made = readBuild(useEncounterStore.getState().encounter.definitions.find((definition) => definition.name === "Tamsin"))!;
    const wizard = quickBuild(SRD_BUILD_SOURCES, WIZARD);
    expect(made.levels.map((entry) => entry.classId)).toEqual(Array(5).fill("srd:class:fighter"));
    expect(made.abilities).toEqual(wizard.abilities);
    expect(made.background).toEqual(wizard.background);
    expect(made.species).toEqual(wizard.species);
  });

  it("doesn't offer to change a built character's class: that's Level up's", () => {
    const id = useEncounterStore.getState().createCharacter({ name: "Vex", build: quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:rogue", level: 3 }) });
    useBuilderUiStore.getState().open({ kind: "edit", definitionId: id });
    render(<BuilderHost onCreated={() => undefined} />);
    const builder = screen.getByRole("dialog", { name: "Character builder" });
    act(() => { railStep(builder, "Class").click(); });
    expect(within(builder).queryByRole("button", { name: "Change class" })).toBeNull();
    expect(level(builder, 3).textContent).toMatch(/Sneak Attack 2d6/);
  });
});
