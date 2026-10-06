// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderSheet, resetSheetWindows, sheetWindows } from "./helpers/sheet";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
});
afterEach(() => { document.body.innerHTML = ""; });

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;

describe("ActorSheet", () => {
  it("closes an open ability builder when the window moves to another creature", async () => {
    // Two creatures sharing an action id, as two SRD monsters' "bite" actions do: a goblin made its own creature.
    const encounter = useEncounterStore.getState().encounter;
    const goblin = encounter.combatants.find((combatant) => combatant.faction === "enemy")!;
    const longsword = encounter.definitions.find((definition) => definition.id === "def-fighter")!.actions.find((action) => action.id === "longsword")!;
    useEncounterStore.setState({
      encounter: {
        ...encounter,
        definitions: encounter.definitions.map((definition) => definition.id === goblin.definitionId
          ? { ...definition, actions: [...definition.actions, { ...longsword, name: "Goblin Longsword" }] }
          : definition)
      }
    });

    renderSheet(compendium, goblin.id);
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Goblin Longsword" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Goblin Longsword");

    // Its token made its own creature: the window follows it (plan D2), and the editor doesn't carry over.
    act(() => { useEncounterStore.getState().makeOwnCreature(goblin.id); });
    expect(sheetWindows()[0]!.definitionId).not.toBe(goblin.definitionId);
    expect(screen.getByRole("button", { name: "Edit Goblin Longsword" })).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});
