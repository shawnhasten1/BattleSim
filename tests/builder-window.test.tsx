// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { readBuild } from "@/lib/character-builder";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";
import { storedStyle } from "@/store/sheet-windows-store";

// CHARACTER_BUILDER_UX_PLAN.md §1 and D11: the builder's window: its steps and their counts, the draft it keeps, undo,
// and its look.

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useBuilderUiStore.setState({ window: null, homebrew: false });
  useCatalogStore.getState().setEntries([]);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useBuilderUiStore.getState().close();
});

const SEED = { name: "Tamsin", classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" };

function openBuilder() {
  useBuilderUiStore.getState().open({ kind: "create", seed: SEED });
  render(<BuilderHost onCreated={() => undefined} />);
  return screen.getByRole("dialog", { name: "Character builder" });
}
const rail = (builder: HTMLElement) => within(builder).getByRole("navigation", { name: "Builder steps" });
const railStep = (builder: HTMLElement, name: string) => within(rail(builder)).getByRole("button", { name: new RegExp(`^\\d+\\s*${name}`) });
const pills = (builder: HTMLElement) => within(builder).getAllByRole("button").map((button) => button.getAttribute("title") ?? "").filter(Boolean);

describe("the builder window", { timeout: 30000 }, () => {
  it("opens on Class with every step done, and counts what a change opens on its step", async () => {
    const builder = openBuilder();
    expect(railStep(builder, "Class").getAttribute("aria-current")).toBe("step");
    expect(within(rail(builder)).getAllByRole("button").filter((button) => /^\d/.test(button.textContent ?? "")).map((button) => button.textContent!.replace(/^\d+\s*/, "").replace("✓", ""))).toEqual(["Class", "Origin", "Abilities", "Spells", "Equipment", "Review"]);
    expect(within(builder).getByText("All made")).toBeTruthy();
    expect(within(railStep(builder, "Spells")).getByLabelText("done")).toBeTruthy();

    // A cantrip taken back: Spells has one open, and the header's button goes there.
    await userEvent.click(railStep(builder, "Spells"));
    await userEvent.click(within(builder).getAllByRole("button", { name: /^Cantrips/, expanded: false })[0]!);
    const cantrips = within(builder).getByRole("group", { name: "Cantrips" });
    const chosen = within(cantrips).getAllByRole("checkbox").filter((box) => box.getAttribute("aria-checked") === "true");
    await userEvent.click(chosen[0]!);
    expect(within(railStep(builder, "Spells")).getByLabelText("1 open")).toBeTruthy();
    expect(within(railStep(builder, "Class")).getByLabelText("done")).toBeTruthy();
    expect(within(builder).getByText("1 still to choose")).toBeTruthy();
    await userEvent.click(railStep(builder, "Review"));
    await userEvent.click(within(builder).getByRole("button", { name: /^1 choice left/ }));
    expect(railStep(builder, "Spells").getAttribute("aria-current")).toBe("step");

    // Back and Next walk the steps; a fighter has no Spells step.
    await userEvent.click(within(builder).getByRole("button", { name: "Next: Equipment ›" }));
    expect(railStep(builder, "Equipment").getAttribute("aria-current")).toBe("step");
    await userEvent.click(within(builder).getByRole("button", { name: "‹ Back" }));
    expect(railStep(builder, "Spells").getAttribute("aria-current")).toBe("step");
    expect(pills(builder)).toContain("Class: go to the Class step");
  });

  it("undoes and redoes a change, by button and by Ctrl+Z", async () => {
    const builder = openBuilder();
    const undo = within(builder).getByRole("button", { name: "Undo" }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    await userEvent.click(railStep(builder, "Origin"));
    await userEvent.click(within(builder).getByRole("radio", { name: "Dwarf (2014)" }));
    expect(within(builder).getByRole("radio", { name: "Dwarf (2014)" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(undo);
    expect(within(builder).getByRole("radio", { name: "Dwarf (2024)" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(within(builder).getByRole("button", { name: "Redo" }));
    expect(within(builder).getByRole("radio", { name: "Dwarf (2014)" }).getAttribute("aria-checked")).toBe("true");
    within(builder).getByRole("radio", { name: "Dwarf (2014)" }).focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(within(builder).getByRole("radio", { name: "Dwarf (2024)" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(within(builder).getByRole("radio", { name: "Dwarf (2014)" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps a draft when it closes by accident: offered, restored (one undo from the seed), or started over", async () => {
    let builder = openBuilder();
    await userEvent.click(railStep(builder, "Origin"));
    await userEvent.click(within(builder).getByRole("radio", { name: "Dwarf (2014)" }));
    // Closed without Cancel or Create.
    cleanup();
    useBuilderUiStore.getState().close();

    builder = openBuilder();
    const offer = within(builder).getByRole("status");
    expect(offer.textContent).toMatch(/You have a draft of this character/);
    await userEvent.click(within(offer).getByRole("button", { name: "Continue where you left off" }));
    expect(within(builder).queryByRole("status")).toBeNull();
    await userEvent.click(railStep(builder, "Origin"));
    expect(within(builder).getByRole("radio", { name: "Dwarf (2014)" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(within(builder).getByRole("button", { name: "Undo" }));
    expect(within(builder).getByRole("radio", { name: "Dwarf (2024)" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(within(builder).getByRole("button", { name: "Redo" }));
    cleanup();
    useBuilderUiStore.getState().close();

    // Started over: the seed's character, and the draft is gone.
    builder = openBuilder();
    await userEvent.click(within(within(builder).getByRole("status")).getByRole("button", { name: "Start over" }));
    await userEvent.click(railStep(builder, "Origin"));
    expect(within(builder).getByRole("radio", { name: "Dwarf (2024)" }).getAttribute("aria-checked")).toBe("true");
    cleanup();
    useBuilderUiStore.getState().close();
    builder = openBuilder();
    expect(within(builder).queryByRole("status")).toBeNull();
  });

  it("forgets the draft once the character is created, or the window cancelled", async () => {
    let builder = openBuilder();
    await userEvent.click(railStep(builder, "Origin"));
    await userEvent.click(within(builder).getByRole("radio", { name: "Dwarf (2014)" }));
    await userEvent.click(within(builder).getByRole("button", { name: "Create character" }));
    const tamsin = useEncounterStore.getState().encounter.definitions.find((definition) => definition.name === "Tamsin")!;
    expect(readBuild(tamsin)?.species?.id).toBe("srd:species:dwarf-2014");
    cleanup();
    builder = openBuilder();
    expect(within(builder).queryByRole("status")).toBeNull();

    await userEvent.click(railStep(builder, "Origin"));
    await userEvent.click(within(builder).getByRole("radio", { name: "Dwarf (2014)" }));
    await userEvent.click(within(builder).getByRole("button", { name: "Cancel" }));
    cleanup();
    builder = openBuilder();
    expect(within(builder).queryByRole("status")).toBeNull();
  });

  it("switches look, and the PC sheets open in the look it was left in", async () => {
    let builder = openBuilder();
    const look = () => builder.querySelector("[data-look]")!.getAttribute("data-look");
    expect(look()).toBe("standard");
    expect(within(builder).queryByRole("group", { name: "Codex colours" })).toBeNull();
    await userEvent.click(within(within(builder).getByRole("group", { name: "Builder look" })).getByRole("button", { name: "Codex" }));
    expect(look()).toBe("codex");
    expect(storedStyle("pc")).toBe("codex");
    expect(within(builder).getByRole("group", { name: "Codex colours" })).toBeTruthy();
    cleanup();
    builder = openBuilder();
    expect(look()).toBe("codex");
    await userEvent.click(within(within(builder).getByRole("group", { name: "Builder look" })).getByRole("button", { name: "Standard" }));
    expect(storedStyle("pc")).toBe("standard");
  });
});
