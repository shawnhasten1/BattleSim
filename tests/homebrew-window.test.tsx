// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomebrewWindow } from "@/components/homebrew/HomebrewWindow";
import { CreateTokenModal } from "@/components/modals/CreateTokenModal";
import type { Compendium } from "@/hooks/useCompendium";
import { quickBuild, readBuild, type CatalogEntry, type ClassDefinition } from "@/lib/character-builder";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";

/** PC builder plan, Phase 8b: making a class in the Homebrew window, saving it, and building a character from it. */

const pristine = useEncounterStore.getState();
let posted: unknown[] = [];

beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useCatalogStore.getState().setEntries([]);
  useCatalogStore.setState({ status: "ready", problems: [] });
  posted = [];
  // The server takes what it's sent and hands it back, as `/api/catalog` does for valid entries.
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/catalog" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { entries: CatalogEntry[] };
      posted.push(...body.entries);
      return new Response(JSON.stringify({ entries: body.entries, problems: [] }), { status: 201 });
    }
    if (url.startsWith("/api/catalog/") && init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }));
    return new Response("{}", { status: 404 });
  }));
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const compendium = { status: "", setStatus: vi.fn(), importCreature: vi.fn() } as unknown as Compendium;

describe("the Homebrew window", { timeout: 30000 }, () => {
  it("makes a class: its basics, a table column, a level 1 feature from the ability editor with a pool that follows the column", async () => {
    render(<HomebrewWindow onClose={() => undefined} />);
    const window = screen.getByRole("dialog", { name: "Homebrew" });
    await userEvent.click(within(window).getByRole("button", { name: /New class/ }));
    const name = within(window).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Gunslinger");
    await userEvent.selectOptions(within(window).getByLabelText("Hit die"), "10");

    // A column: Grit, 2 at every level.
    await userEvent.click(within(window).getByRole("button", { name: "+ Column" }));
    const columnName = within(window).getByLabelText("Column 1 name");
    await userEvent.clear(columnName);
    await userEvent.type(columnName, "Grit");
    for (let level = 1; level <= 20; level += 1) await userEvent.type(within(window).getByLabelText(`Grit at level ${level}`), level < 10 ? "2" : "3");

    // Level 1: a feature, made in the ability editor and handed back.
    await userEvent.click(within(window).getByRole("button", { name: "Level 1" }));
    await userEvent.click(within(window).getByRole("button", { name: "+ Feature" }));
    const editor = within(screen.getByRole("dialog", { name: "Homebrew" })).getByRole("region", { name: /Edit/ });
    const featureName = within(editor).getByLabelText("Name");
    await userEvent.clear(featureName);
    await userEvent.type(featureName, "Quick Draw");
    await userEvent.click(within(editor).getByRole("button", { name: "Done" }));

    const back = screen.getByRole("dialog", { name: "Homebrew" });
    expect(within(back).getByRole("button", { name: "Level 1" }).textContent).toContain("Quick Draw");
    // Its details: a pool of uses that follows the Grit column.
    await userEvent.click(within(back).getByRole("button", { name: "Show Quick Draw's details" }));
    await userEvent.click(within(back).getByRole("checkbox", { name: "A pool of uses" }));
    const card = within(back).getByRole("group", { name: "Feature Quick Draw" });
    await userEvent.click(within(card).getByRole("button", { name: "Pool size: Grit" }));

    await userEvent.click(within(back).getByRole("button", { name: /^Save/ }));
    await within(back).findByText(/Saved Gunslinger/);
    const saved = posted[0] as { kind: string; entry: ClassDefinition };
    expect(saved.kind).toBe("class");
    expect(saved.entry).toMatchObject({ name: "Gunslinger", hitDie: 10, table: [{ label: "Grit", values: [2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] }] });
    const grant = saved.entry.levels.find((level) => level.level === 1)!.grants[0]!;
    expect(grant).toMatchObject({ key: "quick-draw", feature: { name: "Quick Draw" }, pool: { id: "quick-draw", size: `{col:${saved.entry.table[0]!.id}}` } });
    expect(within(back).getByText("It builds at every level without a problem.")).toBeTruthy();

    // The class is the builder's now: a character built from it has the feature and its pool.
    const sources = useCatalogStore.getState().sources;
    const id = useEncounterStore.getState().createCharacter({ name: "Dex", build: quickBuild(sources, { classId: saved.entry.id, level: 12 }) });
    const dex = useEncounterStore.getState().encounter.definitions.find((definition) => definition.id === id)!;
    expect(dex.features?.some((feature) => feature.name === "Quick Draw")).toBe(true);
    expect(dex.resources?.["quick-draw"]).toBe(3);
    expect(readBuild(dex)?.levels[0]?.classId).toBe(saved.entry.id);
  });

  it("copies an SRD class to change, asks before leaving unsaved changes, and deletes", async () => {
    render(<HomebrewWindow onClose={() => undefined} />);
    const window = screen.getByRole("dialog", { name: "Homebrew" });
    await userEvent.selectOptions(within(window).getByLabelText("Copy an SRD entry"), "class|srd:class:rogue");
    expect((within(window).getByLabelText("Name") as HTMLInputElement).value).toBe("Rogue (homebrew)");
    expect(within(window).getByRole("button", { name: "Level 1" }).textContent).toContain("Sneak Attack");
    expect(within(window).getByText("Not saved yet")).toBeTruthy();

    // Leaving it asks first.
    await userEvent.click(within(window).getByRole("button", { name: /New class/ }));
    expect(within(window).getByRole("alert").textContent).toMatch(/unsaved changes/);
    await userEvent.click(within(window).getByRole("button", { name: "Keep editing" }));
    expect((within(window).getByLabelText("Name") as HTMLInputElement).value).toBe("Rogue (homebrew)");

    await userEvent.click(within(window).getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(useCatalogStore.getState().entries).toHaveLength(1));
    expect(within(window).getByRole("button", { name: "Rogue (homebrew) (Homebrew)" })).toBeTruthy();
    await userEvent.click(within(window).getByRole("button", { name: /Delete/ }));
    await userEvent.click(within(window).getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(useCatalogStore.getState().entries).toHaveLength(0));
  });

  it("imports a file, reporting what it couldn't take, and Create Token offers what it brought", async () => {
    render(<HomebrewWindow onClose={() => undefined} />);
    const window = screen.getByRole("dialog", { name: "Homebrew" });
    const rogue = useCatalogStore.getState().sources.catalog.classes.find((entry) => entry.id === "srd:class:rogue")!;
    const file = {
      kind: "battlesim-catalog", schemaVersion: 1, exportedAt: "2026-10-06T00:00:00Z",
      entries: [
        { kind: "class", entry: { ...rogue, id: "homebrew:class:cutpurse", name: "Cutpurse", source: { provider: "homebrew" } } },
        { kind: "subclass", entry: { id: "homebrew:subclass:x", name: "Lost Path", source: { provider: "homebrew" }, edition: "2024", classId: "homebrew:class:nowhere", levels: [] } },
        { kind: "feat", entry: { id: "homebrew:feat:bad", name: "Bad Feat" } }
      ]
    };
    await userEvent.upload(within(window).getByLabelText("Import a catalog file"), new File([JSON.stringify(file)], "party.catalog.json", { type: "application/json" }));
    await waitFor(() => expect(within(window).getByRole("status").textContent).toMatch(/Imported Cutpurse, Lost Path/));
    const status = within(window).getByRole("status").textContent!;
    expect(status).toMatch(/Entry 3, Bad Feat/);
    expect(status).toMatch(/Lost Path: its class \(homebrew:class:nowhere\) isn't in the catalog/);
    cleanup();

    render(<CreateTokenModal compendium={compendium} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Character" }));
    expect(within(screen.getByLabelText("Class")).getByRole("option", { name: "Cutpurse (Homebrew)" })).toBeTruthy();
  });
});
