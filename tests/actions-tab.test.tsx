// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import type { CreatureDefinition } from "@/engine";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* noop */ }
  // the sample def-fighter carries its Longsword as an `actions` entry; give it a
  // real `weapons` record so the Weapons group has something to edit.
  useEncounterStore.getState().attachSrdWeapon("def-fighter", "srd:weapon:rapier");
});
afterEach(() => { document.body.innerHTML = ""; });

function fighter() {
  const encounter = useEncounterStore.getState().encounter;
  return {
    combatant: encounter.combatants.find((c) => c.id === "pc-fighter")!,
    definition: encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition
  };
}

function renderTab() {
  const { combatant, definition } = fighter();
  return render(<ActionsTab combatant={combatant} definition={definition} />);
}

describe("ActionsTab", () => {
  it("lists the actor's weapons with an edit affordance", () => {
    renderTab();
    expect(screen.getByText("Weapons")).toBeTruthy();
    expect(screen.getByText("Rapier", { selector: "strong" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Rapier" })).toBeTruthy();
  });

  it("opens the + Add popover with all four routes", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    expect(screen.getByRole("button", { name: "Library" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preset" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Blank" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import" })).toBeTruthy();
  });

  it("searches and filters the SRD library, and attaches on click", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    const search = screen.getByLabelText("Search the library");
    await userEvent.type(search, "fireball");
    const fireball = screen.getByRole("button", { name: /Fireball/ });
    expect(fireball).toBeTruthy();

    await userEvent.click(fireball);
    const spells = useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.spells ?? [];
    expect(spells.some((s) => s.name === "Fireball")).toBe(true);
  });

  it("the Weapon / Spell filter narrows the library", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Spells" }));
    await userEvent.type(screen.getByLabelText("Search the library"), "dagger");
    // "Dagger" the weapon must not appear under the Spells filter
    expect(screen.queryByText("Dagger", { selector: "strong" })).toBeNull();
    await userEvent.clear(screen.getByLabelText("Search the library"));
    await userEvent.click(screen.getByRole("button", { name: "Weapons" }));
    await userEvent.type(screen.getByLabelText("Search the library"), "dagger");
    expect(screen.getByText("Dagger", { selector: "strong" })).toBeTruthy();
  });

  it("Simple / Advanced toggle persists to localStorage", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    expect(localStorage.getItem("actions-builder-mode")).toBe("advanced");
    await userEvent.click(screen.getByRole("button", { name: "Simple" }));
    expect(localStorage.getItem("actions-builder-mode")).toBe("simple");
  });

  it("edits a weapon in place in a single undo step", async () => {
    renderTab();
    const undoDepthBefore = useEncounterStore.getState().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Rapier");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Flametongue");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const weapons = useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.weapons ?? [];
    expect(weapons[0]?.name).toBe("Flametongue");
    expect(useEncounterStore.getState().undoStack.length).toBe(undoDepthBefore + 1);

    useEncounterStore.getState().undo();
    expect((useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.weapons ?? [])[0]?.name).toBe("Rapier");
  });

  it("a preset stamps a builder with the right shape", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Preset" }));
    await userEvent.click(screen.getByRole("button", { name: "Save-or-condition spell" }));

    // the builder is now open with a spell shape of "Saving throw (one target)"
    const shape = screen.getByLabelText("What it does") as HTMLSelectElement;
    expect(shape.value).toBe("save");
    // and an Effects rider list with a condition
    expect(screen.getByRole("button", { name: "+ Add effect" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    const spells = useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.spells ?? [];
    expect(spells.length).toBe(1);
    expect(spells[0]?.action?.kind).toBe("save");
  });

  it("shows only weapon fields when editing a weapon — no Save DC", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));
    expect(screen.getByLabelText("Attack roll uses")).toBeTruthy();
    expect(screen.queryByLabelText("Save DC")).toBeNull();
    expect(screen.queryByLabelText("Shape")).toBeNull();
  });

  it("builds a multiattack from the Extra Attack quick-start, with an aim-at column only when split is on", async () => {
    renderTab();
    // no "Aim at" column until the split toggle is checked
    expect(screen.queryByText("Aim at")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Extra Attack (2 swings)" }));
    expect(screen.getByRole("spinbutton", { name: "Attack 1 count" })).toHaveProperty("value", "2");

    await userEvent.click(screen.getByLabelText(/different enemy/));
    expect(screen.getByText("Aim at")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Create multiattack" }));
    const actions = useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.actions;
    const ma = actions.find((a) => a.kind === "multiattack");
    expect(ma?.kind).toBe("multiattack");
    if (ma?.kind === "multiattack") {
      expect(ma.attacks).toHaveLength(1);
      expect(ma.attacks[0]?.count).toBe(2);
    }
  });
});
