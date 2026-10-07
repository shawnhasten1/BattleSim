// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConditionModifiers, type CombatantState } from "@/engine";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import { renderSheet, resetSheetWindows } from "./helpers/sheet";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  window.localStorage.clear();
});
// Unmount, so a menu or tooltip left open (portalled to the body) doesn't re-render into the next test.
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id);

function patchToken(id: string, patch: Partial<CombatantState>) {
  useEncounterStore.setState((state) => ({
    encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === id ? { ...combatant, ...patch } : combatant)) }
  }));
}

/** The sheet on `combatantId`, with no undo history. */
function openSheet(combatantId = "enemy-goblin-2") {
  useEncounterStore.setState({ selectedCombatantId: combatantId, undoStack: [] });
  return renderSheet(compendium);
}

const tab = (name: string) => screen.getByRole("tab", { name });
const vitals = () => within(screen.getByRole("group", { name: "Vitals" }));

describe("the tabs", () => {
  it("are three, grouped by what they change: the creature, or this token", () => {
    openSheet();
    expect(screen.getAllByRole("tab").map((entry) => entry.textContent)).toEqual(["Stats", "Abilities", "Token"]);
    const described = (name: string) => document.getElementById(tab(name).getAttribute("aria-describedby")!)!.textContent;
    expect(described("Stats")).toBe("Imported Goblin Stand-in · 2 tokens in this scene");
    expect(described("Abilities")).toBe(described("Stats"));
    expect(described("Token")).toBe("Goblin 2 · this token");
  });

  it("open on Stats the first time, then on the last one used", async () => {
    const first = openSheet();
    expect(tab("Stats").getAttribute("aria-selected")).toBe("true");
    await userEvent.click(tab("Token"));
    first.unmount();
    openSheet();
    expect(tab("Token").getAttribute("aria-selected")).toBe("true");
  });

  it("Token holds the tactics; its HP and conditions moved up to the vitals", async () => {
    openSheet();
    await userEvent.click(tab("Token"));
    expect(screen.getByRole("combobox", { name: "Tactics profile" })).toBeTruthy();
    expect(screen.queryByLabelText("Current HP")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Conditions" })).toBeNull();
  });
});

describe("the vitals", () => {
  it("edit HP and temp HP from any tab, one undo step each", async () => {
    openSheet();
    await userEvent.click(tab("Abilities"));
    const hp = vitals().getByLabelText("Hit points");
    await userEvent.clear(hp);
    await userEvent.type(hp, "3");
    const temp = vitals().getByLabelText("Temporary hit points");
    await userEvent.clear(temp);
    await userEvent.type(temp, "12");
    expect([token("enemy-goblin-2")!.currentHp, token("enemy-goblin-2")!.tempHp]).toEqual([3, 12]);
    expect(store().undoStack).toHaveLength(2);
  });

  it("add any condition with the engine's modifiers, explain it, and take it off with its ×", async () => {
    openSheet();
    await userEvent.click(vitals().getByRole("button", { name: "+ Condition" }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toContain("Prone");
    await userEvent.click(screen.getByRole("menuitem", { name: "Prone" }));
    const prone = token("enemy-goblin-2")!.conditions!.find((condition) => condition.name === "prone")!;
    expect(prone.modifiers).toEqual(defaultConditionModifiers("prone"));
    expect((screen.getByRole("menuitem", { name: /Prone/ }) as HTMLButtonElement).disabled).toBe(true);

    await userEvent.hover(vitals().getByRole("button", { name: "Prone" }));
    expect(screen.getByRole("tooltip").textContent).toContain("Prone: -2 to hit; stands up at the start of its turn, for half its movement.");
    await userEvent.click(vitals().getByRole("button", { name: "Remove Prone" }));
    expect(token("enemy-goblin-2")!.conditions ?? []).toEqual([]);
  });

  it("say when the creature is immune, though the DM's word still applies it", async () => {
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, definitions: state.encounter.definitions.map((definition) => (definition.id === "def-goblin" ? { ...definition, conditionImmunities: ["poisoned"] } : definition)) }
    }));
    openSheet();
    await userEvent.click(vitals().getByRole("button", { name: "+ Condition" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Poisoned (immune)" }));
    expect(token("enemy-goblin-2")!.conditions!.map((condition) => condition.name)).toEqual(["poisoned"]);
  });

  it("show a downed token's death saves and what a token is concentrating on", () => {
    patchToken("pc-fighter", { state: "downed", currentHp: 0, deathSaves: { successes: 1, failures: 2, stable: false }, concentration: {} });
    patchToken("enemy-goblin-1", { conditions: [{ id: "h", name: "paralyzed", startedRound: 1, sourceName: "Hold Person", sourceCombatantId: "pc-fighter", concentration: true }] });
    openSheet("pc-fighter");
    expect(vitals().getByText("Downed · death saves 1✓ 2✗")).toBeTruthy();
    expect(vitals().getByText("Concentrating on Hold Person")).toBeTruthy();
  });
});

describe("the ⋯ menu", () => {
  const menuItem = async (name: string) => {
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name }));
  };

  it("duplicates the token, and the sheet moves to the copy", async () => {
    openSheet();
    await menuItem("Duplicate token");
    expect(store().encounter.combatants.filter((combatant) => combatant.definitionId === "def-goblin")).toHaveLength(3);
    expect(screen.getByRole("status").textContent).toBe("Added Imported Goblin Stand-in 3, a copy of Goblin 2.");
    expect(document.getElementById(tab("Token").getAttribute("aria-describedby")!)!.textContent).toBe("Imported Goblin Stand-in 3 · this token");
  });

  it("deletes the token, and Undo brings it back, selected", async () => {
    openSheet();
    await menuItem("Delete token");
    expect(token("enemy-goblin-2")).toBeUndefined();
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Deleted Goblin 2.");
    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(token("enemy-goblin-2")).toBeTruthy();
    expect(store().selectedCombatantId).toBe("enemy-goblin-2");
  });

  it("saves the creature to the library, labelled for where it stands", async () => {
    const saveDefinition = vi.fn(async (definitionId: string) => {
      const definition = store().encounter.definitions.find((candidate) => candidate.id === definitionId)!;
      useEncounterStore.setState({ definitionsLibrary: [definition] });
    });
    useEncounterStore.setState({ saveDefinition });
    openSheet();
    await menuItem("Save to my library");
    expect(saveDefinition).toHaveBeenCalledWith("def-goblin");
    expect(screen.getByRole("status").textContent).toBe("Saved Imported Goblin Stand-in in your library.");
    // Linked now: its changes save to the library by themselves, so there's nothing left to offer.
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: /library/ })).toBeNull();
  });
});

describe("the automation count", () => {
  it("counts what the simulator runs, and opens the Abilities tab", async () => {
    openSheet();
    const count = screen.getByRole("button", { name: /abilities are simulated as written/ });
    expect(count.textContent).toMatch(/^\d+\/\d+$/);
    await userEvent.click(count);
    expect(tab("Abilities").getAttribute("aria-selected")).toBe("true");
  });
});

describe("a compendium message", () => {
  it("shows as a toast only when it arrives while the sheet is open", () => {
    const view = renderSheet({ ...compendium, status: "Imported Lore Bard" } as Compendium);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => view.rerender(<SheetWindowsHost compendium={{ ...compendium, status: "Attached Longsword" } as Compendium} />));
    expect(screen.getByRole("status").textContent).toBe("Attached Longsword");
  });
});
