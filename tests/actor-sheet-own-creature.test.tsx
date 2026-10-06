// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderSheet, resetSheetWindows } from "./helpers/sheet";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 6, driven: ⋯ › Make it its own creature. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const creature = (id: string) => store().encounter.definitions.find((definition) => definition.id === id)!;

function openSheet(combatantId: string) {
  useEncounterStore.setState({ selectedCombatantId: combatantId, undoStack: [] });
  return renderSheet(compendium);
}
const caption = (tab: string) => document.getElementById(screen.getByRole("tab", { name: tab }).getAttribute("aria-describedby")!)!.textContent;
const menuItem = async () => {
  await userEvent.click(screen.getByRole("button", { name: "More actions" }));
  return screen.getByRole("menuitem", { name: "Make it its own creature" }) as HTMLButtonElement;
};
const described = (item: HTMLElement) => document.getElementById(item.getAttribute("aria-describedby")!)!.textContent;

describe("⋯ › Make it its own creature", { timeout: 20000 }, () => {
  it("gives Goblin 2 its own creature, opens Stats with the name selected, and says so with an Undo", async () => {
    openSheet("enemy-goblin-2");
    await userEvent.click(screen.getByRole("tab", { name: "Token" }));
    expect(caption("Stats")).toBe("Imported Goblin Stand-in · 2 tokens in this scene");
    const item = await menuItem();
    expect(item.disabled).toBe(false);
    expect(described(item)).toBe("A copy of Imported Goblin Stand-in for this token alone, named Goblin 2.");
    await userEvent.click(item);

    expect(screen.getByRole("tab", { name: "Stats" }).getAttribute("aria-selected")).toBe("true");
    expect(caption("Stats")).toBe("Goblin 2 · its only token");
    const name = document.activeElement as HTMLInputElement;
    expect([name.value, name.selectionStart, name.selectionEnd]).toEqual(["Goblin 2", 0, "Goblin 2".length]);

    // Typing over the selected name renames only this goblin's creature.
    await userEvent.keyboard("Goblin Boss");
    expect(creature(token("enemy-goblin-2").definitionId).name).toBe("Goblin Boss");
    expect(creature("def-goblin").name).toBe("Imported Goblin Stand-in");
    expect(store().undoStack).toHaveLength(2);

    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Goblin 2 is its own creature now: changes to it reach only this token.");
  });

  it("the toast's Undo puts the token back on its creature, when nothing came after", async () => {
    openSheet("enemy-goblin-2");
    await userEvent.click(await menuItem());
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(token("enemy-goblin-2").definitionId).toBe("def-goblin");
    expect(store().encounter.definitions).toHaveLength(pristine.encounter.definitions.length);
    expect(caption("Stats")).toBe("Imported Goblin Stand-in · 2 tokens in this scene");
  });

  it("is disabled for the only token of its creature, saying why", async () => {
    openSheet("pc-fighter");
    const item = await menuItem();
    expect(item.disabled).toBe(true);
    expect(described(item)).toBe("It's the only Test Fighter in the scene, so changes to Test Fighter reach only it already.");
  });
});
