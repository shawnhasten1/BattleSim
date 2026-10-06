// @vitest-environment happy-dom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CreatureDefinition, ItemDefinition } from "@/engine";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";
import { pickEffect, startFromScratch } from "./helpers/abilities-tab";
import { renderSheet, resetSheetWindows } from "./helpers/sheet";

/**
 * EFFECTS_PLAN.md, Phase 1: the sheet edits the stored creature, never the one its effects make. (Found in the browser: a
 * creature with boots gained 10 ft of base speed on every save.)
 */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const boots: ItemDefinition = { id: "boots", name: "Boots of Striding", type: "worn", effects: [{ kind: "speed", bonusFt: 10 }], automationSupport: "full" };
const inSection = (id: string) => within(document.querySelector<HTMLElement>(`[data-section="${id}"]`)!);

describe("the sheet and a creature's effects", () => {
  it("shows the speed its effects make, and saving an ability keeps the base", async () => {
    store().updateCreatureDefinition("def-fighter", { items: [boots] });
    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("tab", { name: "Stats" }));
    expect(screen.getByLabelText("Speed with its effects").textContent).toBe("With its effects: 40 ft: 30 base, Boots of Striding +10");
    expect((screen.getByLabelText("Speed") as HTMLInputElement).value).toBe("30");

    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await startFromScratch("Trait or feature");
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Fleet");
    await pickEffect(inSection("while-active"), "speed", "Speed");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    expect(fighter().speed).toBe(30);
    expect(fighter()).not.toHaveProperty("speedIncludesArmor");
    expect(fighter().features?.find((feature) => feature.name === "Fleet")?.effects).toEqual([{ kind: "speed", bonusFt: 10 }]);
    await userEvent.click(screen.getByRole("tab", { name: "Stats" }));
    expect(screen.getByLabelText("Speed with its effects").textContent).toBe("With its effects: 50 ft: 30 base, Fleet +10, Boots of Striding +10");
  });
});
