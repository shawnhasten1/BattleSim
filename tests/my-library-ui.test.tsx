// @vitest-environment happy-dom
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findSrdItem } from "@/data/srd";
import type { CreatureDefinition, ItemDefinition } from "@/engine";
import type { Compendium } from "@/hooks/useCompendium";
import { prepareSaved, savedFrom, type SavedAbility } from "@/lib/ability-editor/my-library";
import { useEncounterStore } from "@/store/encounter-store";
import { useMyLibraryStore } from "@/store/my-library-store";
import { openAdd, openFromLibrary } from "./helpers/abilities-tab";
import { renderSheet, resetSheetWindows } from "./helpers/sheet";

/** My library from the sheet: an SRD item changed and saved as a new one, added to a creature, updated and removed. */

const pristine = useEncounterStore.getState();
let posted: SavedAbility[] = [];
let deleted: string[] = [];
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useMyLibraryStore.getState().setEntries([]);
  resetSheetWindows();
  posted = [];
  deleted = [];
  // The server keeps what it's sent and hands it back, as `/api/my-library` does for a valid entry.
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/my-library" && init?.method === "POST") {
      const { entry } = JSON.parse(String(init.body)) as { entry: SavedAbility };
      posted.push(entry);
      return new Response(JSON.stringify({ entry }), { status: 201 });
    }
    if (url.startsWith("/api/my-library/") && init?.method === "DELETE") {
      deleted.push(decodeURIComponent(url.slice("/api/my-library/".length)));
      return new Response(JSON.stringify({ ok: true }));
    }
    return new Response("{}", { status: 404 });
  }));
  vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const fighter = () => useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const prompt = () => within(screen.getByRole("group", { name: "Save to my library" }));

describe("My library on the sheet", { timeout: 20000 }, () => {
  it("saves a library item, changed, as a new one, and adds it from My library", async () => {
    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await openFromLibrary("Boots of Striding and Springing", "striding");
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Boots of the Swift");

    await userEvent.click(screen.getByRole("button", { name: "Save to my library", expanded: false }));
    expect((prompt().getByLabelText("Name in my library") as HTMLInputElement).value).toBe("Boots of the Swift");
    expect(prompt().queryByRole("radiogroup", { name: "Save it as" })).toBeNull();
    await userEvent.click(prompt().getByRole("button", { name: "Save to my library" }));

    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ kind: "item", name: "Boots of the Swift", record: { name: "Boots of the Swift", effects: findSrdItem("srd:item:boots-of-striding-and-springing")!.effects } });
    expect(posted[0]!.id).toMatch(/^mine:/);
    expect(screen.getByRole("status").textContent).toMatch(/Saved “Boots of the Swift” to My library/);
    // The sheet itself isn't changed until the editor's own button.
    expect(fighter().items ?? []).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await openAdd();
    await userEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "My library" }));
    const mine = within(screen.getByRole("region", { name: "My library" }));
    await userEvent.click(mine.getByRole("button", { name: "Add Boots of the Swift" }));
    const boots = fighter().items!.find((item) => item.name === "Boots of the Swift")!;
    expect(boots.effects).toEqual(findSrdItem("srd:item:boots-of-striding-and-springing")!.effects);
    expect(boots.source?.slug).toBe(posted[0]!.id);
    expect(mine.getByRole("button", { name: /^Boots of the Swift/ }).textContent).toMatch(/on the sheet/);

    await userEvent.click(mine.getByRole("button", { name: "Remove Boots of the Swift from my library" }));
    expect(deleted).toEqual([posted[0]!.id]);
    expect(screen.queryByRole("region", { name: "My library" })).toBeNull();
    // The copy on the fighter stays.
    expect(fighter().items?.some((item) => item.name === "Boots of the Swift")).toBe(true);
  });

  it("updates the entry a sheet's copy came from, or saves a new one beside it", async () => {
    const boots = { ...structuredClone(findSrdItem("srd:item:winged-boots")!), name: "Skyboots" } as ItemDefinition;
    const entry = savedFrom("item", boots, fighter(), { id: "mine:sky", name: "Skyboots" });
    useMyLibraryStore.getState().setEntries([entry]);
    const prepared = prepareSaved(entry, fighter());
    useEncounterStore.getState().insertAbilityRecord("def-fighter", prepared.list, prepared.record);

    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Items" })).getByRole("button", { name: "Edit Skyboots" }));
    await userEvent.click(screen.getByRole("button", { name: "Save to my library", expanded: false }));
    const choice = within(prompt().getByRole("radiogroup", { name: "Save it as" }));
    expect(choice.getByRole("radio", { name: "An update to “Skyboots”" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(prompt().getByRole("button", { name: "Update in my library" }));
    expect(posted.map((saved) => saved.id)).toEqual(["mine:sky"]);

    await userEvent.click(screen.getByRole("button", { name: "Save to my library", expanded: false }));
    await userEvent.click(within(prompt().getByRole("radiogroup", { name: "Save it as" })).getByRole("radio", { name: "A new one" }));
    const nameBox = prompt().getByLabelText("Name in my library");
    await userEvent.clear(nameBox);
    await userEvent.type(nameBox, "Skyboots II");
    await userEvent.click(prompt().getByRole("button", { name: "Save to my library" }));
    expect(posted[1]).toMatchObject({ name: "Skyboots II" });
    expect(posted[1]!.id).not.toBe("mine:sky");
    expect(useMyLibraryStore.getState().entries.map((saved) => saved.name)).toEqual(["Skyboots", "Skyboots II"]);
  });

  it("says why a broken ability can't be saved there", async () => {
    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await openFromLibrary("Ring of Swimming", "swimming");
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.click(screen.getByRole("button", { name: "Save to my library", expanded: false }));
    expect(screen.queryByRole("group", { name: "Save to my library" })).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(posted).toEqual([]);
  });
});
