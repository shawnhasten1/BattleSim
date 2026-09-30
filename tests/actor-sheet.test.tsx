// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ActorSheet } from "@/components/sheet/ActorSheet";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));
afterEach(() => { document.body.innerHTML = ""; });

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;

describe("ActorSheet", () => {
  it("closes an open ability builder when the sheet switches to another creature", async () => {
    // Give the goblin an action with the fighter's action id, as two SRD monsters' "bite" actions share one.
    const encounter = useEncounterStore.getState().encounter;
    const goblin = encounter.combatants.find((combatant) => combatant.faction === "enemy")!;
    const longsword = encounter.definitions.find((definition) => definition.id === "def-fighter")!.actions.find((action) => action.id === "longsword")!;
    useEncounterStore.setState({
      selectedCombatantId: "pc-fighter",
      encounter: {
        ...encounter,
        definitions: encounter.definitions.map((definition) => definition.id === goblin.definitionId
          ? { ...definition, actions: [...definition.actions, { ...longsword, name: "Goblin Longsword" }] }
          : definition)
      }
    });

    render(<ActorSheet compendium={compendium} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Longsword");

    act(() => useEncounterStore.setState({ selectedCombatantId: goblin.id }));
    expect(screen.getByRole("button", { name: "Edit Goblin Longsword" })).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });
});
