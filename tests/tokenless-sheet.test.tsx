// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatureDefinition } from "@/engine";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import type { Compendium } from "@/hooks/useCompendium";
import { useEncounterStore } from "@/store/encounter-store";
import { LIBRARY_SAVE_DELAY_MS, useLibrarySyncStore } from "@/store/library-sync-store";
import { openActorSheet, useSheetWindowsStore } from "@/store/sheet-windows-store";
import { resetSheetWindows, sheetWindows } from "./helpers/sheet";

/**
 * Sheets with no token (ACTORS_TAB_PLAN.md, Phase 2): an actor's sheet opens from the Actors tab with no token on the
 * map. Its creature goes on the bench (into the scene with no token, never saved with it) while the window is open, and
 * the sheet hides what belongs to one token. An SRD monster or a shared template opened that way is read-only.
 */

const pristine = useEncounterStore.getState();
const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const windowsStore = () => useSheetWindowsStore.getState();
const inScene = (id: string) => store().encounter.definitions.some((definition) => definition.id === id);
const definitionOf = (id: string) => store().encounter.definitions.find((definition) => definition.id === id)!;

/** A library actor with no token in the scene: a goblin boss, of the goblin. */
function boss(): CreatureDefinition {
  return { ...structuredClone(definitionOf("def-goblin")), id: "def-boss", name: "Goblin Boss", maxHp: 21 };
}

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  useLibrarySyncStore.getState().reset();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useLibrarySyncStore.getState().reset();
});

describe("the bench", () => {
  it("takes a creature into the scene with no token and no undo step, and lets it go again", () => {
    store().benchCreature(boss());
    expect(inScene("def-boss")).toBe(true);
    expect(store().benchIds).toEqual(["def-boss"]);
    expect(store().undoStack).toEqual([]);
    store().unbenchCreature("def-boss");
    expect(inScene("def-boss")).toBe(false);
    expect(store().benchIds).toEqual([]);
    expect(store().undoStack).toEqual([]);
  });

  it("edits a benched creature with undo, and undo past the bench keeps it there", () => {
    store().updateCombatant("pc-fighter", { displayName: "Sir Fighter" });
    store().benchCreature(boss());
    store().updateCreatureDefinition("def-boss", { name: "Big Boss" });
    store().undo();
    expect(definitionOf("def-boss").name).toBe("Goblin Boss");
    store().undo();
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.displayName).not.toBe("Sir Fighter");
    expect(definitionOf("def-boss").name).toBe("Goblin Boss");
  });

  it("once its sheet closes, undo and redo can't bring it back", () => {
    store().benchCreature(boss());
    store().updateCreatureDefinition("def-boss", { name: "Big Boss" });
    store().unbenchCreature("def-boss");
    store().undo();
    expect(inScene("def-boss")).toBe(false);
    store().redo();
    expect(inScene("def-boss")).toBe(false);
  });

  it("a token placed takes it off the bench: it stays when its sheet closes", () => {
    store().benchCreature(boss());
    store().addCreatureDefinition(definitionOf("def-boss"), "enemy");
    expect(store().benchIds).toEqual([]);
    store().unbenchCreature("def-boss");
    expect(inScene("def-boss")).toBe(true);
  });

  it("stays when something in the scene names it", () => {
    store().benchCreature(boss());
    const goblin = definitionOf("def-goblin");
    store().updateCreatureDefinition("def-goblin", {
      actions: [...(goblin.actions ?? []), {
        id: "call-boss", name: "Call the Boss", kind: "summon", actionType: "action", automationSupport: "full",
        options: [{ definitionId: "def-boss", count: 1 }]
      } as unknown as NonNullable<CreatureDefinition["actions"]>[number]]
    });
    store().unbenchCreature("def-boss");
    expect(inScene("def-boss")).toBe(true);
  });

  it("is never saved with the scene", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ projects: [] }), { status: 200 });
    }));
    useEncounterStore.setState({ currentProjectId: "p1", currentEncounterId: "e1" });
    store().benchCreature(boss());
    await store().saveCurrentEncounter();
    const saved = (bodies[0] as { encounter: { definitions: CreatureDefinition[] } }).encounter;
    expect(saved.definitions.some((definition) => definition.id === "def-boss")).toBe(false);
    const persisted = useEncounterStore.persist.getOptions().partialize!(store()) as { encounter: { definitions: CreatureDefinition[] } };
    expect(persisted.encounter.definitions.some((definition) => definition.id === "def-boss")).toBe(false);
  });

  it("empties when the scene changes", () => {
    store().benchCreature(boss());
    useEncounterStore.setState({ encounter: { ...structuredClone(store().encounter), id: "another-scene" } });
    expect(store().benchIds).toEqual([]);
  });

  it("refuses any change to a template on it, and says so", () => {
    const told = vi.fn();
    useEncounterStore.setState({ templateDefinitionIds: ["def-boss"], definitionsLibrary: [boss()] });
    store().benchCreature(boss());
    return import("@/lib/actor-sheet/bench").then(({ onLockedEdit }) => {
      const stop = onLockedEdit(told);
      store().updateCreatureDefinition("def-boss", { name: "Mine now" });
      stop();
      expect(definitionOf("def-boss").name).toBe("Goblin Boss");
      expect(told).toHaveBeenCalledWith("def-boss");
      expect(store().undoStack).toEqual([]);
    });
  });

  it("saves a benched library actor's edits to the library (it's linked)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    useEncounterStore.setState({ definitionsLibrary: [boss()], templateDefinitionIds: [] });
    store().benchCreature(boss());
    store().updateCreatureDefinition("def-boss", { name: "Big Boss" });
    await vi.advanceTimersByTimeAsync(LIBRARY_SAVE_DELAY_MS);
    expect(fetchMock).toHaveBeenCalledWith("/api/definitions/def-boss", expect.objectContaining({ method: "PUT" }));
  });
});

describe("a sheet with no token", () => {
  async function openBoss(options: { template?: boolean; style?: "standard" | "codex" } = {}) {
    useEncounterStore.setState({ definitionsLibrary: [boss()], templateDefinitionIds: options.template ? ["def-boss"] : [] });
    const view = render(<SheetWindowsHost compendium={compendium} />);
    await act(async () => { await openActorSheet("def-boss", options.style ? { style: options.style } : undefined); });
    return view;
  }

  it("opens from the library with no token: its creature on the bench, the window keyed to no token", async () => {
    await openBoss();
    expect(sheetWindows()).toHaveLength(1);
    expect(sheetWindows()[0]!.combatantId).toBeNull();
    expect(store().benchIds).toEqual(["def-boss"]);
    const sheet = screen.getByRole("dialog", { name: "Goblin Boss sheet" });
    expect(sheet.textContent).toContain("in your library, no tokens here");
    expect(sheet.textContent).toContain("New tokens");
    // Nothing that belongs to one token: hit points taken, temp HP, conditions.
    expect(within(sheet).queryByRole("textbox", { name: "Hit points" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "+ Condition" })).toBeNull();
    expect(sheet.textContent).toContain("HP 21");
  });

  it("offers no token items in ⋯", async () => {
    await openBoss();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Delete token" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Duplicate token" })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Export JSON" })).toBeTruthy();
  });

  it("its Token tab sets what new tokens start with", async () => {
    await openBoss();
    await userEvent.click(screen.getByRole("tab", { name: "Token" }));
    expect(screen.queryByText("Token name")).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Tactics profile" }), "brute");
    expect(definitionOf("def-boss").defaultTactics).toBe("brute");
  });

  it("opens in the Codex too, without conditions or death saves", async () => {
    await openBoss({ style: "codex" });
    const sheet = await screen.findByRole("dialog", { name: "Goblin Boss sheet" });
    await screen.findByLabelText("Portrait and vitals");
    expect(sheet.textContent).not.toContain("Conditions · ");
    expect(within(sheet).queryByRole("group", { name: "Death saves" })).toBeNull();
    expect(within(sheet).queryByRole("textbox", { name: "Current hit points" })).toBeNull();
  });

  it("closing it takes its creature off the bench and out of the scene", async () => {
    await openBoss();
    act(() => { windowsStore().close(sheetWindows()[0]!.id); });
    expect(inScene("def-boss")).toBe(false);
    expect(store().benchIds).toEqual([]);
  });

  it("becomes that token's sheet when a token is placed", async () => {
    await openBoss();
    act(() => { store().addCreatureDefinition(definitionOf("def-boss"), "enemy"); });
    const placed = store().encounter.combatants.find((combatant) => combatant.definitionId === "def-boss")!;
    expect(sheetWindows()[0]!.combatantId).toBe(placed.id);
    expect(screen.getByRole("textbox", { name: "Hit points" })).toBeTruthy();
  });

  it("opens the token's sheet instead when the creature has a token here", async () => {
    render(<SheetWindowsHost compendium={compendium} />);
    await act(async () => { await openActorSheet("def-goblin"); });
    expect(sheetWindows()[0]!.combatantId).toBe("enemy-goblin-1");
    expect(store().benchIds).toEqual([]);
  });

  it("a template is read-only: a banner, boxes that don't take typing, and Copy to my library opening the copy", async () => {
    const copy = { ...boss(), id: "def-boss-copy", name: "Goblin Boss (Copy)" };
    const copyLibraryDefinition = vi.fn(async () => {
      useEncounterStore.setState((state) => ({ definitionsLibrary: [...state.definitionsLibrary, copy] }));
      return copy.id;
    });
    useEncounterStore.setState({ copyLibraryDefinition });
    await openBoss({ template: true });
    const sheet = screen.getByRole("dialog", { name: "Goblin Boss sheet" });
    expect(sheet.textContent).toContain("Shared template: read-only");
    expect((within(sheet).getByRole("textbox", { name: "Name" }) as HTMLInputElement).readOnly).toBe(true);
    await userEvent.click(within(sheet).getByRole("button", { name: "Copy to my library" }));
    expect(copyLibraryDefinition).toHaveBeenCalledWith("def-boss");
    await screen.findByRole("dialog", { name: "Goblin Boss (Copy) sheet" });
    expect(inScene("def-boss")).toBe(false);
    expect(store().benchIds).toEqual(["def-boss-copy"]);
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).readOnly).toBe(false);
  });

  it("an SRD monster opens read-only, loaded on demand", async () => {
    render(<SheetWindowsHost compendium={compendium} />);
    await act(async () => { await openActorSheet("srd:monster:goblin"); });
    const sheet = await screen.findByRole("dialog", { name: /Goblin sheet/ });
    expect(sheet.textContent).toContain("SRD monster: read-only");
    expect(store().benchIds).toEqual(["srd:monster:goblin"]);
  });
});
