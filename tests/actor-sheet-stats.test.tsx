// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abilityModifier, type CreatureDefinition } from "@/engine";
import { SRD_MONSTER_INDEX, loadSrdMonster } from "@/data/srd/monsters";
import { StatsTab } from "@/components/sheet/sheet-tabs/StatsTab";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 3, driven: the Stats tab as a statblock. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((definition) => definition.id === "def-fighter")!;

function LiveStats() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <StatsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

function patchFighter(patch: Partial<CreatureDefinition>) {
  useEncounterStore.setState((state) => ({
    encounter: { ...state.encounter, definitions: state.encounter.definitions.map((definition) => (definition.id === "def-fighter" ? { ...definition, ...patch } : definition)) },
    undoStack: []
  }));
}

const section = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title.replace(/[&]/g, "\\$&")}`) });
async function retype(box: HTMLElement, text: string) {
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

describe("the Stats tab", { timeout: 20000 }, () => {
  it("folds its sections to statblock lines, and remembers which are open", async () => {
    const view = render(<LiveStats />);
    for (const title of ["Skills", "Defenses", "Senses & languages", "Level & CR"]) expect(section(title).getAttribute("aria-expanded")).toBe("false");
    expect(section("Senses & languages").textContent).toContain("passive Perception");
    await userEvent.click(section("Skills"));
    view.unmount();
    render(<LiveStats />);
    expect(section("Skills").getAttribute("aria-expanded")).toBe("true");
  });

  it("switches a save's proficiency with its ◆, and takes a whole bonus typed in", async () => {
    patchFighter({ saves: undefined });
    render(<LiveStats />);
    const mark = screen.getByRole("button", { name: "DEX save proficiency" });
    await userEvent.click(mark);
    const dex = abilityModifier(fighter().abilities.dex) + (fighter().proficiencyBonus ?? 2);
    expect(fighter().saves).toEqual({ dex });
    expect(mark.getAttribute("data-kind")).toBe("proficient");
    await userEvent.click(mark);
    expect(fighter().saves).toBeUndefined();
    await userEvent.type(screen.getByLabelText("DEX save"), "9");
    expect(fighter().saves).toEqual({ dex: 9 });
    expect(mark.getAttribute("data-kind")).toBe("custom");
  });

  it("adds a skill at modifier + proficiency, makes it expert, and removes it", async () => {
    render(<LiveStats />);
    await userEvent.click(section("Skills"));
    await userEvent.selectOptions(screen.getByLabelText("Add a skill"), "athletics");
    const proficient = abilityModifier(fighter().abilities.str) + (fighter().proficiencyBonus ?? 2);
    expect(fighter().skills).toEqual({ athletics: proficient });
    await userEvent.click(screen.getByRole("button", { name: "Expertise" }));
    expect(fighter().skills).toEqual({ athletics: proficient + (fighter().proficiencyBonus ?? 2) });
    await userEvent.click(screen.getByRole("button", { name: "Remove Athletics" }));
    expect(fighter().skills).toBeUndefined();
  });

  it("adds a fly speed that hovers, and taking fly away takes hover with it", async () => {
    render(<LiveStats />);
    await userEvent.selectOptions(screen.getByLabelText("Add a speed"), "fly");
    expect(fighter().movement?.fly).toBe(fighter().speed);
    await userEvent.click(screen.getByLabelText("Hovers"));
    expect(fighter().movement?.hover).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Remove fly speed" }));
    expect(fighter().movement).toEqual({ walk: fighter().speed });
  });

  it("changes size and senses, and the summary follows", async () => {
    render(<LiveStats />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Size" }), "large");
    expect(fighter().size).toBe("large");
    await userEvent.click(section("Senses & languages"));
    await userEvent.type(screen.getByLabelText("darkvision range"), "60");
    expect(fighter().senses).toEqual({ darkvision: 60 });
    expect(section("Senses & languages").textContent).toContain("darkvision 60 ft");
  });

  it("sets a challenge rating's proficiency, and a character's classes and their total level", async () => {
    patchFighter({ proficiencyBonus: undefined, challengeRating: undefined, character: undefined });
    render(<LiveStats />);
    await userEvent.click(section("Level & CR"));
    await userEvent.selectOptions(screen.getByLabelText("Challenge rating"), "5");
    expect([fighter().challengeRating, fighter().proficiencyBonus]).toEqual([5, 3]);
    await userEvent.click(screen.getByRole("button", { name: "+ Add a class" }));
    await userEvent.type(screen.getByLabelText("Class 1"), "Fighter");
    await retype(screen.getByLabelText("Class 1 level"), "5");
    await userEvent.click(screen.getByRole("button", { name: "+ Add a class" }));
    await userEvent.type(screen.getByLabelText("Class 2"), "Wizard");
    expect(fighter().character).toEqual({ level: 6, classes: [{ name: "Fighter", level: 5 }, { name: "Wizard", level: 1 }] });
    expect(section("Level & CR").textContent).toContain("Level 6 Fighter 5 / Wizard 1 · CR 5");
    await userEvent.click(screen.getByRole("button", { name: "Remove Wizard" }));
    expect(fighter().character).toEqual({ level: 5, classes: [{ name: "Fighter", level: 5 }] });
  });

  it("renders every SRD monster's Stats without changing anything", async () => {
    const view = render(<StatsTab combatant={store().encounter.combatants[0]!} definition={fighter()} />);
    for (const entry of SRD_MONSTER_INDEX) {
      const monster = (await loadSrdMonster(entry.id))!;
      view.rerender(<StatsTab combatant={store().encounter.combatants[0]!} definition={monster} />);
      expect(within(document.body).getByRole("button", { name: /^Level & CR/ }).textContent, monster.name).toMatch(/proficiency \+\d/);
    }
    expect(store().undoStack).toHaveLength(0);
  }, 120000);
});
