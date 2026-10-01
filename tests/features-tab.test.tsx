// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { openAdd, startFromScratch, useRecipe } from "./helpers/abilities-tab";
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
  it("lists features where they're used (Second Wind with the bonus actions) and starts a trait from scratch", async () => {
    renderTab();
    expect(within(screen.getByRole("region", { name: "Bonus actions" })).getByRole("button", { name: "Edit Second Wind" })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Actions" })).getByRole("button", { name: "Edit Action Surge" })).toBeTruthy();
    expect(screen.getByText("Standard actions")).toBeTruthy();
    await openAdd();
    expect(within(screen.getByRole("region", { name: "Start from scratch" })).getByRole("button", { name: "Trait or feature" })).toBeTruthy();
  });

  it("the Rage preset opens the editor switched on, and adds an activate-feature bonus action", async () => {
    renderTab();
    await useRecipe("Rage");
    const works = screen.getByRole("radiogroup", { name: "It works" });
    expect(within(works).getByRole("radio", { name: "When switched on" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    const feature = (def().features ?? []).find((f) => f.name === "Rage");
    expect(feature).toBeDefined();
    const activate = feature?.grantedActions?.[0];
    expect(activate?.kind).toBe("activate-feature");
    expect(activate?.actionType).toBe("bonus");
    // It shows up as a bonus action in the compiled action list, and the creature gets its rage pool.
    expect(getExecutableActions(def()).some((a) => a.kind === "activate-feature" && a.actionType === "bonus")).toBe(true);
    expect(def().resources?.rage).toBe(3);
  });

  it("edits an attached feature in place in a single undo step", async () => {
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:pack-tactics");
    renderTab();
    const undoBefore = useEncounterStore.getState().undoStack.length;
    const group = screen.getByRole("region", { name: "Traits" });
    await userEvent.click(within(group).getByRole("button", { name: "Edit Pack Tactics" }));
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Wolf Pack");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect((def().traits ?? []).some((f) => f.name === "Wolf Pack")).toBe(true);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoBefore + 1);
  });

  it("shows the attached Aura of Protection's aura and what it shares", async () => {
    useEncounterStore.getState().attachSrdFeature("def-fighter", "srd:feature:aura-of-protection");
    renderTab();
    const group = screen.getByRole("region", { name: "Traits" });
    await userEvent.click(within(group).getByRole("button", { name: "Edit Aura of Protection" }));
    await userEvent.click(screen.getByRole("button", { name: /^Aura/ }));

    expect((screen.getByLabelText("Shares its effects with creatures nearby") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Aura range (ft)") as HTMLInputElement).value).toBe("10");
    expect(within(screen.getByRole("radiogroup", { name: "Shares them with" })).getByRole("radio", { name: "Its allies" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/They get: \+\d+ to saves|They get: .*saves/)).toBeTruthy();
  });

  it("a fresh feature can share a hostile-affecting aura", async () => {
    renderTab();
    await startFromScratch("Trait or feature");

    expect(screen.queryByLabelText("Aura range (ft)")).toBeNull();
    await userEvent.click(screen.getByLabelText("Shares its effects with creatures nearby"));
    expect(screen.getByLabelText("Aura range (ft)")).toBeTruthy();
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Shares them with" })).getByRole("radio", { name: "Its enemies" }));
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Unnerving Presence");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    const feature = (def().features ?? []).find((f) => f.name === "Unnerving Presence");
    expect(feature?.aura).toEqual({ range: 10, affects: "hostile" });
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
