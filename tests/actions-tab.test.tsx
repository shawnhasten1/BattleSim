// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { getExecutableActions, type CreatureDefinition } from "@/engine";

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

  it("edits a weapon in the ability editor in a single undo step", async () => {
    renderTab();
    const undoDepthBefore = useEncounterStore.getState().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));

    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("Rapier");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Flametongue");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const weapons = useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.weapons ?? [];
    expect(weapons[0]?.name).toBe("Flametongue");
    expect(useEncounterStore.getState().undoStack.length).toBe(undoDepthBefore + 1);

    useEncounterStore.getState().undo();
    expect((useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.weapons ?? [])[0]?.name).toBe("Rapier");
  });

  it("a spell recipe opens the editor with its shape, and adds a spell that follows the spellcasting ability", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Preset" }));
    await userEvent.click(screen.getByRole("button", { name: "Save or condition" }));

    // The editor is open on a saving throw with a paralysis effect.
    expect(screen.getByRole("radio", { name: "Saving throw" }).getAttribute("aria-checked")).toBe("true");
    expect(within(document.querySelector<HTMLElement>('[data-section="effects"]')!).getByText("On a failed save")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    const spells = useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.spells ?? [];
    expect(spells.length).toBe(1);
    expect(spells[0]?.action).toMatchObject({ kind: "save", dcFormula: { ability: "spellcasting" } });
  });

  it("shows a weapon's own sections when editing one: no saving throw", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByRole("radiogroup", { name: "Uses" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Magic bonus" })).toBeTruthy();
    expect(screen.queryByLabelText("Save DC")).toBeNull();
    expect(screen.queryByLabelText("What it does")).toBeNull();
  });

  it("shows Spirit Guardians' area moving with its caster, with no drift or bonus-action move", async () => {
    useEncounterStore.getState().attachSrdSpell("def-fighter", "srd:spell:spirit-guardians");
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Edit Spirit Guardians" }));
    await userEvent.click(screen.getByRole("button", { name: /^Lingering area/ }));

    expect(screen.getByRole("radio", { name: "Moves with it" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByLabelText("Drifts (ft)")).toBeNull();
    expect(screen.queryByLabelText("Moves up to (ft)")).toBeNull();
  });

  it("turns a blank spell into a lingering area, and drops the drift once it follows its caster", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Blank" }));
    await userEvent.click(screen.getByRole("button", { name: "Spell" }));
    await userEvent.click(screen.getByRole("radio", { name: "Saving throw" }));
    await userEvent.click(screen.getByRole("radio", { name: "An area" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Leaves a lingering area" }));

    await userEvent.click(screen.getByRole("radio", { name: "Drifts away" }));
    expect(screen.getByLabelText("Drifts (ft)")).toBeTruthy();

    await userEvent.click(screen.getByRole("radio", { name: "Moves with it" }));
    expect(screen.queryByLabelText("Drifts (ft)")).toBeNull();
    expect(screen.queryByLabelText("Moves up to (ft)")).toBeNull();
  });
});

/** The tab as the sheet renders it: re-rendered from the store after every change. */
function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return (
    <ActionsTab
      combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!}
      definition={encounter.definitions.find((d) => d.id === "def-fighter")!}
    />
  );
}

const fighterActions = () => useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.actions;

describe("ActionsTab saves only what was edited", () => {
  it("Cancel closes the builder without saving", async () => {
    renderTab();
    const undoDepth = useEncounterStore.getState().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Flametongue");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.weapons![0]!.name).toBe("Rapier");
    expect(useEncounterStore.getState().undoStack.length).toBe(undoDepth);
  });

  it("offers no save until something changes, so an untouched ability adds no undo step", async () => {
    renderTab();
    const undoDepth = useEncounterStore.getState().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(useEncounterStore.getState().undoStack.length).toBe(undoDepth);
  });

  it("renaming an innate melee attack leaves it a +5 melee STR attack", async () => {
    renderTab();
    const before = fighterActions().find((a) => a.id === "longsword")!;
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Arming Sword");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const after = fighterActions().find((a) => a.id === "longsword")!;
    expect(after).toMatchObject({ ...before, name: "Arming Sword" });
    expect("attackBonusFormula" in after && after.attackBonusFormula).toBeFalsy();
  });
});

describe("ActionsTab asks before a delete changes a multiattack", () => {
  const routine = (attacks: Array<{ actionId: string; count: number; targetGroup?: number }>) =>
    useEncounterStore.getState().addMultiattack("def-fighter", { name: "Multiattack", attacks });
  const fighterDefinition = () => useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!;
  const rapierAttackId = () => getExecutableActions(fighterDefinition()).find((a) => a.name === "Rapier" && a.actionType === "action")!.id;

  it("asks first when the multiattack would be deleted too, and Cancel keeps both", async () => {
    routine([{ actionId: "longsword", count: 2 }]);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Longsword" }));
    const prompt = screen.getByRole("alertdialog", { name: "Delete Longsword?" });
    expect(prompt.textContent).toContain("Multiattack uses only Longsword, so it will be deleted too.");
    await userEvent.click(within(prompt).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fighterActions().map((a) => a.kind)).toEqual(["attack", "multiattack"]);
  });

  it("deletes both in one undo step when confirmed", async () => {
    routine([{ actionId: "longsword", count: 2 }]);
    render(<LiveTab />);
    const undoDepth = useEncounterStore.getState().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Remove Longsword" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Longsword and Multiattack" }));

    expect(fighterActions()).toEqual([]);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoDepth + 1);
    useEncounterStore.getState().undo();
    expect(fighterActions().map((a) => a.kind)).toEqual(["attack", "multiattack"]);
  });

  it("says what a multiattack is left with when it keeps other steps", async () => {
    routine([{ actionId: "longsword", count: 1 }, { actionId: rapierAttackId(), count: 1 }]);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Longsword" }));
    const prompt = screen.getByRole("alertdialog", { name: "Delete Longsword?" });
    expect(prompt.textContent).toContain("Multiattack uses Longsword. Without it, Multiattack will be: Rapier.");
    await userEvent.click(within(prompt).getByRole("button", { name: "Delete Longsword" }));

    expect(fighterActions().find((a) => a.kind === "multiattack")).toMatchObject({ attacks: [{ actionId: rapierAttackId(), count: 1 }] });
  });

  it("deletes at once when no multiattack uses the record", async () => {
    routine([{ actionId: "longsword", count: 2 }]);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Rapier" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fighterDefinition().weapons).toEqual([]);
  });
});
