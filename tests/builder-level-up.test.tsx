// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { CreateTokenModal } from "@/components/modals/CreateTokenModal";
import type { Compendium } from "@/hooks/useCompendium";
import { quickBuild, readBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";

// CHARACTER_BUILDER_UX_PLAN.md §4, D12, D13: Level up on the builder's parts, and Create Token's carry-over.

const pristine = useEncounterStore.getState();
const moved = vi.fn(async () => undefined);
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useEncounterStore.setState({ moveDefinitionToFolder: moved });
  moved.mockClear();
  useBuilderUiStore.setState({ window: null, homebrew: false });
  useCatalogStore.getState().setEntries([]);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useBuilderUiStore.getState().close();
});

const store = () => useEncounterStore.getState();
const compendium = { status: "", setStatus: vi.fn(), importCreature: vi.fn() } as unknown as Compendium;

function levelUp(build = quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:wizard", level: 4, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" })) {
  const id = store().createCharacter({ name: "Tamsin", build });
  useBuilderUiStore.getState().open({ kind: "level-up", definitionId: id });
  render(<BuilderHost onCreated={() => undefined} />);
  return { id, dialog: screen.getByRole("dialog", { name: "Level up" }) };
}

describe("Level up", { timeout: 30000 }, () => {
  it("turns the level, says what it gains and the hit points it adds, and folds the spells it chose", async () => {
    const { id, dialog } = levelUp();
    expect(within(dialog).getByRole("img", { name: "Level 4 to level 5" })).toBeTruthy();
    expect(dialog.textContent).toMatch(/Wizard 4 \(Evoker\) · Sage · Dwarf\s*→ Wizard 5/);
    const gain = within(dialog).getByRole("region", { name: "You gain" });
    expect(gain.textContent).toMatch(/Memorize Spell/);
    expect(gain.textContent).toMatch(/Proficiency \+3/);
    expect(gain.textContent).toMatch(/3rd-level slots 2/);
    const hp = within(dialog).getByRole("region", { name: "Hit points" });
    expect(hp.textContent).toMatch(/\+6/);
    await userEvent.click(within(within(hp).getByRole("group", { name: "Hit points this level" })).getByRole("button", { name: "Rolled" }));
    await userEvent.type(within(hp).getByLabelText("Hit die roll"), "2");
    expect(hp.textContent).toMatch(/\+4/);
    expect(hp.textContent).toMatch(/rolled 2/);
    // Its spells: suggested, so folded; open one to change it.
    const choices = within(dialog).getByRole("region", { name: "Choices" });
    await userEvent.click(within(choices).getByRole("button", { name: /^Spellbook\s*2 of 2/, expanded: false }));
    expect(within(choices).getByRole("group", { name: "Spellbook" })).toBeTruthy();
    expect(within(dialog).getByText("All made")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Level up to 5" }));
    const after = readBuild(store().encounter.definitions.find((definition) => definition.id === id))!;
    expect(after.levels).toHaveLength(5);
    // Levels 2 to 4 took the average; level 5 the roll typed (a full list, 0 for none).
    expect(after.hp).toEqual({ method: "rolled", rolls: [0, 0, 0, 2] });
  });

  it("has the edition filter: a 2014 filter offers the 2014 classes to multiclass into", async () => {
    const { dialog } = levelUp();
    const rules = within(dialog).getByRole("group", { name: "Rules shown" });
    expect(within(rules).getByRole("button", { name: "2024" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(within(dialog).getByRole("button", { name: "Multiclass…" }));
    const classes = within(dialog).getByRole("radiogroup", { name: "Class to level" });
    expect(within(classes).getByRole("radio", { name: "Fighter (2024)" })).toBeTruthy();
    await userEvent.click(within(rules).getByRole("button", { name: "2014" }));
    expect(within(classes).queryByRole("radio", { name: "Fighter (2024)" })).toBeNull();
    expect(within(classes).getByRole("radio", { name: "Fighter (2014)" })).toBeTruthy();
    // The other edition's version of its own class can't be taken.
    expect(within(classes).getByRole("radio", { name: "Wizard (2014)" }).getAttribute("aria-disabled")).toBe("true");
  });
});

describe("Create Token's carry-over (D13)", { timeout: 30000 }, () => {
  it("Open the builder carries the edition filter and the folder, and the character is filed there", async () => {
    render(<CreateTokenModal compendium={compendium} onClose={() => undefined} targetFolderId="folder-1" />);
    await userEvent.click(screen.getByRole("tab", { name: "Character" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Edition" })).getByRole("button", { name: "2014" }));
    await userEvent.click(screen.getByRole("button", { name: /open the builder/i }));
    // The 2014 filter turned the chosen class into its 2014 version, and the builder gets both.
    expect(useBuilderUiStore.getState().window).toMatchObject({ kind: "create", seed: { classId: "srd:class:barbarian-2014", edition: "2014", folderId: "folder-1" } });
    cleanup();
    render(<BuilderHost onCreated={() => undefined} />);
    const builder = screen.getByRole("dialog", { name: "Character builder" });
    expect(within(within(builder).getByRole("group", { name: "Rules shown" })).getByRole("button", { name: "2014" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(within(builder).getByRole("button", { name: "Create character" }));
    const made = store().encounter.definitions.at(-1)!;
    expect(moved).toHaveBeenCalledWith(made.id, "folder-1");
  });

  it("Quick party files every member into the folder", async () => {
    render(<CreateTokenModal compendium={compendium} onClose={() => undefined} targetFolderId="folder-1" />);
    await userEvent.click(screen.getByRole("tab", { name: "Character" }));
    await userEvent.click(screen.getByRole("button", { name: /Quick party: 4 at level 1/ }));
    expect(moved).toHaveBeenCalledTimes(4);
    expect(moved.mock.calls.every((call) => (call as unknown[])[1] === "folder-1")).toBe(true);
  });
});
