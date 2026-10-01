// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActorSheet } from "@/components/sheet/ActorSheet";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  window.localStorage.clear();
});
afterEach(() => { document.body.innerHTML = ""; });

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const definition = (id: string) => store().encounter.definitions.find((candidate) => candidate.id === id)!;
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;

/** The sheet open on `combatantId`, on `tab`, with no undo history. */
async function openSheet(combatantId: string, tab: "Stats" | "Token") {
  useEncounterStore.setState({ selectedCombatantId: combatantId, undoStack: [] });
  render(<ActorSheet compendium={compendium} onClose={() => undefined} />);
  await userEvent.click(screen.getByRole("tab", { name: tab }));
}

/** Replaces what a box holds by typing, a key at a time. */
async function retype(box: HTMLElement, text: string) {
  await userEvent.clear(box);
  await userEvent.type(box, text);
}

describe("typing on the sheet", () => {
  it("a new max HP brings tokens at full along and keeps the wounded one's HP, as one undo step", async () => {
    store().updateHp("enemy-goblin-1", 3);
    await openSheet("enemy-goblin-2", "Stats");
    await retype(screen.getByLabelText("Max HP"), "12");
    expect(definition("def-goblin").maxHp).toBe(12);
    expect([token("enemy-goblin-1").currentHp, token("enemy-goblin-2").currentHp]).toEqual([3, 12]);
    expect(store().undoStack).toHaveLength(1);
    act(() => store().undo());
    expect(definition("def-goblin").maxHp).toBe(7);
    expect([token("enemy-goblin-1").currentHp, token("enemy-goblin-2").currentHp]).toEqual([3, 7]);
  });

  it("an emptied box writes nothing, and shows the value again when you leave it", async () => {
    await openSheet("enemy-goblin-2", "Stats");
    const ac = screen.getByLabelText("AC") as HTMLInputElement;
    const before = definition("def-goblin").armorClass;
    await userEvent.clear(ac);
    expect(definition("def-goblin").armorClass).toBe(before);
    await userEvent.tab();
    expect(ac.value).toBe(String(before));
    expect(store().undoStack).toHaveLength(0);
  });

  it("a number out of range isn't taken, and is marked until you leave the box", async () => {
    await openSheet("enemy-goblin-2", "Stats");
    const ac = screen.getByLabelText("AC") as HTMLInputElement;
    await retype(ac, "150");
    expect(definition("def-goblin").armorClass).toBe(15);
    expect(ac.getAttribute("aria-invalid")).toBe("true");
    await userEvent.tab();
    expect(ac.value).toBe("15");
    expect(ac.getAttribute("aria-invalid")).toBeNull();
  });

  it("a level or a class name changes only that, keeping the subclass", async () => {
    useEncounterStore.setState((state) => ({
      encounter: {
        ...state.encounter,
        definitions: state.encounter.definitions.map((candidate) => candidate.id === "def-fighter"
          ? { ...candidate, character: { level: 6, classes: [{ id: "bard", name: "Bard", level: 6, subclass: { id: "college-of-lore", name: "College of Lore" } }] } }
          : candidate)
      }
    }));
    await openSheet("pc-fighter", "Stats");
    await retype(screen.getByLabelText("Level"), "7");
    await retype(screen.getByLabelText("Class"), "Skald");
    expect(definition("def-fighter").character).toEqual({
      level: 7,
      classes: [{ id: "bard", name: "Skald", level: 7, subclass: { id: "college-of-lore", name: "College of Lore" } }]
    });
    expect(store().undoStack).toHaveLength(2);
  });

  it("a token's name is one undo step however long", async () => {
    await openSheet("enemy-goblin-2", "Token");
    await retype(screen.getByLabelText("Name"), "Boss Goblin");
    expect(token("enemy-goblin-2").displayName).toBe("Boss Goblin");
    expect(store().undoStack).toHaveLength(1);
  });

  it("a pool's size typed on the Abilities tab is one undo step", async () => {
    useEncounterStore.setState({ selectedCombatantId: "pc-fighter", undoStack: [] });
    render(<ActorSheet compendium={compendium} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Resources" })).getByRole("button", { name: /^Resources/ }));
    await retype(within(screen.getByRole("group", { name: "Resource sizes" })).getByLabelText("Second Wind full"), "12");
    expect(definition("def-fighter").resources?.["second-wind"]).toBe(12);
    expect(store().undoStack).toHaveLength(1);
  });

  it("a color picked by dragging in the picker is one undo step; the next pick is another", async () => {
    await openSheet("enemy-goblin-2", "Token");
    const border = screen.getByLabelText("Border");
    fireEvent.focus(border);
    for (const color of ["#110000", "#220000", "#330000"]) fireEvent.input(border, { target: { value: color } });
    fireEvent.change(border, { target: { value: "#330000" } });
    expect(token("enemy-goblin-2").tokenVisuals?.borderColor).toBe("#330000");
    expect(store().undoStack).toHaveLength(1);
    fireEvent.input(border, { target: { value: "#440000" } });
    expect(store().undoStack).toHaveLength(2);
  });
});
