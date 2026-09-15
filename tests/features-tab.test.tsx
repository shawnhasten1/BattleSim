// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import {
  createEngineState,
  getExecutableActions,
  resolveActivateFeatureAction,
  resolveAttack
} from "@/engine";
import type { CreatureDefinition } from "@/engine";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* noop */ }
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
function def() {
  return useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!;
}

describe("Abilities tab — feature building", () => {
  it("has a Features & traits group and a Feature blank route", async () => {
    renderTab();
    expect(screen.getByText("Features & traits")).toBeTruthy();
    expect(screen.getByText("Standard actions")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Blank" }));
    expect(screen.getByRole("button", { name: "Feature / trait" })).toBeTruthy();
  });

  it("the Rage preset builds a FeatureDefinition with an activate-feature bonus action", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Preset" }));
    await userEvent.click(screen.getByRole("button", { name: "Rage" }));
    // the feature builder is open with the activated shape
    expect((screen.getByLabelText("What it does") as HTMLSelectElement).value).toBe("activated");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    const feature = (def().features ?? []).find((f) => f.name === "Rage");
    expect(feature).toBeDefined();
    const activate = feature?.grantedActions?.[0];
    expect(activate?.kind).toBe("activate-feature");
    expect(activate?.actionType).toBe("bonus");
    // it shows up as a bonus action in the compiled action list
    expect(getExecutableActions(def()).some((a) => a.kind === "activate-feature" && a.actionType === "bonus")).toBe(true);
  });

  it("edits an attached feature in place in a single undo step", async () => {
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:pack-tactics");
    renderTab();
    const undoBefore = useEncounterStore.getState().undoStack.length;
    const group = screen.getByText("Features & traits").closest("div")!;
    await userEvent.click(within(group).getByRole("button", { name: "Edit Pack Tactics" }));
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Wolf Pack");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect((def().traits ?? []).some((f) => f.name === "Wolf Pack")).toBe(true);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore + 1);
  });

  it("shows the attached Aura of Protection's aura fields, and hides the aura toggle on an activated feature", async () => {
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:aura-of-protection");
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    const group = screen.getByText("Features & traits").closest("div")!;
    await userEvent.click(within(group).getByRole("button", { name: "Edit Aura of Protection" }));

    const auraToggle = screen.getByLabelText("Radiates as an aura") as HTMLInputElement;
    expect(auraToggle.checked).toBe(true);
    expect((screen.getByLabelText("Range (ft)") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Affects") as HTMLSelectElement).value).toBe("allies");

    // Switching to an activated shape drops the aura fields entirely — an
    // aura is always-on, it doesn't fit the "spend a resource to trigger"
    // activated shape's instant/lingering effect split.
    await userEvent.selectOptions(screen.getByLabelText("What it does"), "activated");
    expect(screen.queryByLabelText("Radiates as an aura")).toBeNull();
  });

  it("a fresh passive feature can enable a hostile-affecting aura through the builder", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Blank" }));
    await userEvent.click(screen.getByRole("button", { name: "Feature / trait" }));

    expect(screen.queryByLabelText("Range (ft)")).toBeNull();
    await userEvent.click(screen.getByLabelText("Radiates as an aura"));
    expect(screen.getByLabelText("Range (ft)")).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText("Affects"), "hostile");
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Fear Aura");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    const feature = (def().features ?? []).find((f) => f.name === "Fear Aura");
    expect(feature?.aura).toEqual({ range: 10, affects: "hostile", requiresConscious: undefined });
  });
});

describe("SRD feature attach — engine effects", () => {
  it("Cunning Action grants three bonus-action utilities", () => {
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:cunning-action");
    const compiled = getExecutableActions(def()).filter((a) => a.kind === "utility" && a.actionType === "bonus");
    expect(compiled.map((a) => (a.kind === "utility" ? a.mode : "")).sort()).toEqual(["dash", "disengage", "hide"]);
  });

  it("Action Surge refreshes the action economy when activated", () => {
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:action-surge");
    const encounter = structuredClone(useEncounterStore.getState().encounter);
    encounter.combatants = encounter.combatants.filter((c) => c.id === "pc-fighter" || c.id === "enemy-goblin-1");
    encounter.combatants.find((c) => c.id === "pc-fighter")!.position = { x: 1, y: 1 };
    const goblin = encounter.combatants.find((c) => c.id === "enemy-goblin-1")!;
    goblin.position = { x: 2, y: 1 };
    goblin.currentHp = 200;
    const surge = getExecutableActions(encounter.definitions.find((d) => d.id === "def-fighter")!)
      .find((a) => a.kind === "activate-feature" && a.name === "Action Surge")!;

    const state = createEngineState(encounter);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", "longsword");
    expect(state.snapshot.combatants.find((c) => c.id === "pc-fighter")?.actionEconomy?.action).toBe(false);
    resolveActivateFeatureAction(state, "pc-fighter", surge.id);
    expect(state.snapshot.combatants.find((c) => c.id === "pc-fighter")?.actionEconomy?.action).toBe(true);
  });
});
