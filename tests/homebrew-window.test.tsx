// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomebrewWindow } from "@/components/homebrew/HomebrewWindow";
import { CreateTokenModal } from "@/components/modals/CreateTokenModal";
import type { Compendium } from "@/hooks/useCompendium";
import { quickBuild, readBuild, type CatalogEntry, type ClassDefinition, type SubclassDefinition } from "@/lib/character-builder";
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
    await userEvent.selectOptions(within(window).getByLabelText("New entry"), "class");
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
    await userEvent.selectOptions(within(window).getByLabelText("New entry"), "class");
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

/** Makes a new entry of a kind in the open window, names it, and returns the window. */
async function newEntry(kind: string, name: string) {
  const window = screen.getByRole("dialog", { name: "Homebrew" });
  await userEvent.selectOptions(within(window).getByLabelText("New entry"), kind);
  const field = within(window).getByLabelText("Name");
  await userEvent.clear(field);
  await userEvent.type(field, name);
  return window;
}

/** Adds a feature at a level (or to a feat) through the ability editor. */
async function addFeature(window: HTMLElement, name: string, level?: string) {
  if (level) await userEvent.click(within(window).getByRole("button", { name: level }));
  await userEvent.click(within(window).getAllByRole("button", { name: "+ Feature" })[0]!);
  const editor = within(screen.getByRole("dialog", { name: "Homebrew" })).getByRole("region", { name: /Edit/ });
  const field = within(editor).getByLabelText("Name");
  await userEvent.clear(field);
  await userEvent.type(field, name);
  await userEvent.click(within(editor).getByRole("button", { name: "Done" }));
}

async function saveOpen(window: HTMLElement, name: string) {
  await userEvent.click(within(window).getByRole("button", { name: /^Save/ }));
  await within(window).findByText(new RegExp(`Saved ${name}`));
}

describe("the Homebrew window's other editors (Phase 8c)", { timeout: 30000 }, () => {
  it("makes a third-caster subclass for the SRD Rogue, which a rogue then takes", async () => {
    render(<HomebrewWindow onClose={() => undefined} />);
    const window = await newEntry("subclass", "Shadow Arcanist");
    await userEvent.selectOptions(within(window).getByLabelText("Class"), "srd:class:rogue");
    await userEvent.click(within(window).getByRole("button", { name: "+ Spellcasting" }));
    await userEvent.selectOptions(within(window).getByLabelText("Spell slots"), "third");
    for (let level = 3; level <= 20; level += 1) {
      fireEvent.change(within(window).getByLabelText(`Cantrips known, level ${level}`), { target: { value: "3" } });
      fireEvent.change(within(window).getByLabelText(`Spells prepared, level ${level}`), { target: { value: String(Math.min(13, level)) } });
    }
    await addFeature(window, "Veil Step", "Level 3");
    await saveOpen(window, "Shadow Arcanist");

    const saved = posted[0] as { kind: string; entry: SubclassDefinition };
    expect(saved).toMatchObject({ kind: "subclass", entry: { classId: "srd:class:rogue", spellcasting: { kind: "third", ability: "int", list: "wizard" } } });
    const sources = useCatalogStore.getState().sources;
    const build = quickBuild(sources, { classId: "srd:class:rogue", level: 5 });
    const chosen = { ...build, levels: build.levels.map((entry, index) => (index === 2 ? { ...entry, choices: { ...entry.choices, subclass: saved.entry.id } } : entry)) };
    const id = useEncounterStore.getState().createCharacter({ name: "Nyx", build: chosen });
    const nyx = useEncounterStore.getState().encounter.definitions.find((definition) => definition.id === id)!;
    expect(nyx.features?.some((feature) => feature.name === "Veil Step")).toBe(true);
    expect(nyx.resources?.["slot-1"]).toBeGreaterThan(0);
  });

  it("makes an origin feat, a background that gives it, and a species", async () => {
    render(<HomebrewWindow onClose={() => undefined} />);
    let window = await newEntry("feat", "Lucky Charm");
    await userEvent.selectOptions(within(window).getByLabelText("Category"), "origin");
    await addFeature(window, "Charm");
    await saveOpen(window, "Lucky Charm");

    window = await newEntry("background", "Wanderer");
    const feat = (posted[0] as { entry: { id: string } }).entry.id;
    expect(within(within(window).getByLabelText("Origin feat")).getByRole("option", { name: "Lucky Charm (Homebrew)" })).toBeTruthy();
    await userEvent.selectOptions(within(window).getByLabelText("Origin feat"), feat);
    const skills = within(window).getByRole("group", { name: "Skills" });
    await userEvent.click(within(skills).getByRole("checkbox", { name: "Survival" }));
    await userEvent.click(within(skills).getByRole("checkbox", { name: "Perception" }));
    await saveOpen(window, "Wanderer");

    window = await newEntry("species", "Tallfolk");
    fireEvent.change(within(window).getByLabelText("Speed"), { target: { value: "35" } });
    await addFeature(window, "Long Stride", "Character level 1");
    await saveOpen(window, "Tallfolk");

    const sources = useCatalogStore.getState().sources;
    const background = sources.catalog.backgrounds.find((entry) => entry.name === "Wanderer")!;
    const species = sources.catalog.species.find((entry) => entry.name === "Tallfolk")!;
    expect(background).toMatchObject({ feat, skills: ["perception", "survival"] });
    const id = useEncounterStore.getState().createCharacter({ name: "Wren", build: quickBuild(sources, { classId: "srd:class:fighter", level: 1, backgroundId: background.id, speciesId: species.id }) });
    const wren = useEncounterStore.getState().encounter.definitions.find((definition) => definition.id === id)!;
    const names = (wren.features ?? []).map((feature) => feature.name);
    expect(names).toEqual(expect.arrayContaining(["Charm", "Long Stride"]));
    expect(wren.speed).toBe(35);
  });
});
