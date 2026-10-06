// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CombatantState, CreatureDefinition } from "@/engine";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";
import { MAX_SHEET_WINDOWS, useSheetWindowsStore } from "@/store/sheet-windows-store";
import { renderSheet, resetSheetWindows, sheetWindows } from "./helpers/sheet";

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
const windowsStore = () => useSheetWindowsStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const dialogs = () => screen.getAllByRole("dialog");

/** Nine creatures, a token each: one more than the windows that can be open. */
function nineCreatures() {
  const base = store().encounter.definitions.find((definition) => definition.id === "def-goblin")!;
  const template = token("enemy-goblin-1");
  const definitions: CreatureDefinition[] = Array.from({ length: 9 }, (_, index) => ({ ...base, id: `def-${index}`, name: `Creature ${index}` }));
  const combatants: CombatantState[] = definitions.map((definition, index) => ({
    ...template, id: `token-${index}`, definitionId: definition.id, displayName: `Token ${index}`, position: { x: index, y: 0 }
  }));
  useEncounterStore.setState((state) => ({ encounter: { ...state.encounter, definitions, combatants } }));
}

describe("opening sheets", () => {
  it("opens a window per creature: two creatures, two windows", () => {
    renderSheet(compendium, "pc-fighter");
    act(() => { windowsStore().open("enemy-goblin-1"); });
    expect(dialogs()).toHaveLength(2);
    expect(dialogs().map((dialog) => dialog.getAttribute("aria-label"))).toEqual(["Test Fighter sheet", "Imported Goblin Stand-in sheet"]);
  });

  it("opens one window for two tokens of one creature, showing the token opened last", () => {
    renderSheet(compendium, "enemy-goblin-1");
    act(() => { windowsStore().open("enemy-goblin-2"); });
    expect(dialogs()).toHaveLength(1);
    expect(sheetWindows()[0]!.combatantId).toBe("enemy-goblin-2");
    expect((screen.getByRole("combobox", { name: "Token shown" }) as HTMLSelectElement).value).toBe("enemy-goblin-2");
  });

  it("titles a creature with several tokens by its name and token count", () => {
    renderSheet(compendium, "enemy-goblin-1");
    expect(screen.getByRole("dialog").textContent).toContain("Imported Goblin Stand-in · 2 tokens");
  });

  it("brings an open window to the front when it's opened again", () => {
    renderSheet(compendium, "pc-fighter");
    act(() => { windowsStore().open("enemy-goblin-1"); });
    const fighter = sheetWindows().find((entry) => entry.definitionId === "def-fighter")!;
    const goblin = sheetWindows().find((entry) => entry.definitionId === "def-goblin")!;
    expect(goblin.z).toBeGreaterThan(fighter.z);
    act(() => { windowsStore().open("pc-fighter"); });
    expect(sheetWindows().find((entry) => entry.id === fighter.id)!.z).toBeGreaterThan(goblin.z);
    // Its rank is its z-index above the sheets' base.
    const [fighterDialog, goblinDialog] = dialogs();
    expect(fighterDialog!.style.zIndex).toContain("+ 1");
    expect(goblinDialog!.style.zIndex).toContain("+ 0");
  });

  it("cascades a new window from the one in front", () => {
    renderSheet(compendium, "pc-fighter");
    act(() => { windowsStore().open("enemy-goblin-1"); });
    const [first, second] = sheetWindows();
    expect(second!.origin).toEqual({ x: first!.origin.x + 28, y: first!.origin.y + 28 });
  });

  it("leaves an open sheet alone when another token is selected", () => {
    renderSheet(compendium, "pc-fighter");
    act(() => store().selectCombatant("enemy-goblin-1"));
    expect(dialogs()).toHaveLength(1);
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toBe("Test Fighter sheet");
  });
});

describe("a creature with several tokens", () => {
  it("edits the creature for every token, and HP for the token shown", async () => {
    act(() => store().duplicateCombatant("enemy-goblin-1"));
    const goblins = store().encounter.combatants.filter((combatant) => combatant.definitionId === "def-goblin");
    expect(goblins).toHaveLength(3);
    renderSheet(compendium, "enemy-goblin-2");

    // Speed is the creature's: every goblin shares it.
    const speed = screen.getByLabelText("Speed");
    await userEvent.clear(speed);
    await userEvent.type(speed, "40");
    expect(store().encounter.definitions.find((definition) => definition.id === "def-goblin")!.speed).toBe(40);

    // HP is the token's own.
    const hp = within(screen.getByRole("group", { name: "Vitals" })).getByLabelText("Hit points");
    await userEvent.clear(hp);
    await userEvent.type(hp, "3");
    const after = store().encounter.combatants.filter((combatant) => combatant.definitionId === "def-goblin");
    expect(after.find((combatant) => combatant.id === "enemy-goblin-2")!.currentHp).toBe(3);
    expect(after.filter((combatant) => combatant.currentHp === 3)).toHaveLength(1);
  });

  it("switches the token shown, and selects it on the map", async () => {
    renderSheet(compendium, "enemy-goblin-1");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Token shown" }), "enemy-goblin-2");
    expect(sheetWindows()[0]!.combatantId).toBe("enemy-goblin-2");
    expect(store().selectedCombatantId).toBe("enemy-goblin-2");
    expect(screen.getByRole("tab", { name: "Token" }).getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(screen.getByRole("tab", { name: "Token" }).getAttribute("aria-describedby")!)!.textContent).toBe("Goblin 2 · this token");
  });

  it("switches the token without asking, keeping an ability being edited", async () => {
    renderSheet(compendium, "enemy-goblin-1");
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Scimitar" }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await userEvent.type(name, "!");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Token shown" }), "enemy-goblin-2");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Scimitar!");
    expect(sheetWindows()[0]!.dirty).toBe(true);
  });

  it("has no switcher for a creature with one token", () => {
    renderSheet(compendium, "pc-fighter");
    expect(screen.queryByRole("combobox", { name: "Token shown" })).toBeNull();
  });
});

describe("keeping windows in step with the encounter", () => {
  it("moves to another token when the shown one is deleted, and closes with the last", () => {
    renderSheet(compendium, "enemy-goblin-1");
    act(() => store().removeCombatant("enemy-goblin-1"));
    expect(sheetWindows()[0]!.combatantId).toBe("enemy-goblin-2");
    expect(dialogs()).toHaveLength(1);
    act(() => store().removeCombatant("enemy-goblin-2"));
    expect(sheetWindows()).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes every window when the scene changes", () => {
    renderSheet(compendium, "pc-fighter");
    act(() => { windowsStore().open("enemy-goblin-1"); });
    act(() => useEncounterStore.setState({ currentEncounterId: "another-scene" }));
    expect(sheetWindows()).toHaveLength(0);
  });

  it("follows a token into the form it changes into, merging with that creature's window", () => {
    renderSheet(compendium, "enemy-goblin-1");
    act(() => { windowsStore().open("pc-archer"); });
    // Goblin 1 takes the archer's form: its window follows it, and the archer's window (in front) takes it in.
    act(() => useEncounterStore.setState((state) => ({
      encounter: {
        ...state.encounter,
        combatants: state.encounter.combatants.map((combatant) =>
          combatant.id === "enemy-goblin-1" ? { ...combatant, activeForm: { definitionId: "def-archer" } } as CombatantState : combatant)
      }
    })));
    expect(sheetWindows()).toHaveLength(1);
    expect(sheetWindows()[0]!.definitionId).toBe("def-archer");
  });

  it("moves to the new creature when its token is made its own creature", async () => {
    renderSheet(compendium, "enemy-goblin-2");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Make it its own creature/ }));
    const definitionId = token("enemy-goblin-2").definitionId;
    expect(definitionId).not.toBe("def-goblin");
    expect(sheetWindows()[0]!.definitionId).toBe(definitionId);
    expect(sheetWindows()[0]!.combatantId).toBe("enemy-goblin-2");
  });

  it("keeps a sheet's toast when it closes with its creature's last token deleted", async () => {
    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete token" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Deleted Fighter.");
    await userEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Undo" }));
    expect(token("pc-fighter")).toBeTruthy();
  });
});

describe(`at most ${MAX_SHEET_WINDOWS} windows`, () => {
  it("closes the one focused least recently to open another, with a notice", () => {
    nineCreatures();
    render(<SheetWindowsHost compendium={compendium} />);
    act(() => { for (let index = 0; index < 8; index += 1) windowsStore().open(`token-${index}`); });
    act(() => windowsStore().focus(sheetWindows()[0]!.id));
    act(() => { windowsStore().open("token-8"); });
    const open = sheetWindows().map((entry) => entry.definitionId);
    expect(open).toHaveLength(8);
    expect(open).toContain("def-0");
    expect(open).not.toContain("def-1");
    expect(screen.getByRole("status").textContent).toContain("Closed the Creature 1 sheet");
  });

  it("never closes a window with unsaved changes to make room", () => {
    nineCreatures();
    act(() => { for (let index = 0; index < 8; index += 1) windowsStore().open(`token-${index}`); });
    const [oldest, next] = sheetWindows();
    act(() => windowsStore().setDirty(oldest!.id, true));
    act(() => { windowsStore().open("token-8"); });
    expect(sheetWindows().some((entry) => entry.id === oldest!.id)).toBe(true);
    expect(sheetWindows().some((entry) => entry.id === next!.id)).toBe(false);
  });

  it("refuses a ninth when every open window has unsaved changes", () => {
    nineCreatures();
    act(() => { for (let index = 0; index < 8; index += 1) windowsStore().open(`token-${index}`); });
    act(() => sheetWindows().forEach((entry) => windowsStore().setDirty(entry.id, true)));
    let opened: string | null = "x";
    act(() => { opened = windowsStore().open("token-8"); });
    expect(opened).toBeNull();
    expect(sheetWindows()).toHaveLength(8);
    expect(windowsStore().notice?.message).toContain("unsaved changes");
  });
});
