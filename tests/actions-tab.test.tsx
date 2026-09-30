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

  it("builds a multiattack from the Extra Attack quick-start, with no target split to offer", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Extra Attack (2 swings)" }));
    expect(screen.getByRole("spinbutton", { name: "Attack 1 count" })).toHaveProperty("value", "2");
    // "Aim at" had no effect in play (the AI picks every swing's target), so it isn't offered.
    expect(screen.queryByText("Aim at")).toBeNull();
    expect(screen.queryByLabelText(/different enemy/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Create multiattack" }));
    const actions = useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.actions;
    const ma = actions.find((a) => a.kind === "multiattack");
    expect(ma?.kind).toBe("multiattack");
    if (ma?.kind === "multiattack") {
      expect(ma.attacks).toHaveLength(1);
      expect(ma.attacks[0]?.count).toBe(2);
    }
  });

  it("shows Spirit Guardians' zone as following the caster, and hides drift/reposition for a self-anchored zone", async () => {
    useEncounterStore.getState().attachSrdSpell("def-fighter", "srd:spell:spirit-guardians");
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Spirit Guardians" }));

    expect((screen.getByLabelText("Follows") as HTMLSelectElement).value).toBe("self");
    expect(screen.queryByLabelText("Drifts away from the caster")).toBeNull();
    expect(screen.queryByLabelText("Caster can reposition it")).toBeNull();
  });

  it("a fresh area spell's zone hides drift/reposition once set to follow the caster", async () => {
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Advanced" }));
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Blank" }));
    await userEvent.click(screen.getByRole("button", { name: "Spell" }));
    await userEvent.selectOptions(screen.getByLabelText("What it does"), "area");
    await userEvent.click(screen.getByLabelText("Leaves a persistent zone"));

    expect(screen.getByLabelText("Follows")).toBeTruthy();
    expect(screen.getByLabelText("Drifts away from the caster")).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Follows"), "self");
    expect(screen.queryByLabelText("Drifts away from the caster")).toBeNull();
    expect(screen.queryByLabelText("Caster can reposition it")).toBeNull();
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

  it("saving with nothing changed writes nothing, so it adds no undo step", async () => {
    renderTab();
    const undoDepth = useEncounterStore.getState().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(useEncounterStore.getState().undoStack.length).toBe(undoDepth);
  });

  it("renaming an innate melee attack leaves it a +5 melee STR attack", async () => {
    renderTab();
    const before = fighterActions().find((a) => a.id === "longsword")!;
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Arming Sword");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const after = fighterActions().find((a) => a.id === "longsword")!;
    expect(after).toMatchObject({ ...before, name: "Arming Sword" });
    expect("attackBonusFormula" in after && after.attackBonusFormula).toBeFalsy();
  });
});

describe("ActionsTab multiattack editing", () => {
  it("lists the steps by name, and the pencil edits the multiattack in place", async () => {
    useEncounterStore.getState().addMultiattack("def-fighter", { name: "Multiattack", attacks: [{ actionId: "longsword", count: 2 }] });
    const id = fighterActions().find((a) => a.kind === "multiattack")!.id;
    render(<LiveTab />);

    expect(screen.getByText("2 × Longsword")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Edit Multiattack" }));
    expect(screen.getByText("Edit multiattack")).toBeTruthy();
    const count = screen.getByRole("spinbutton", { name: "Attack 1 count" });
    expect(count).toHaveProperty("value", "2");

    fireEvent.change(count, { target: { value: "3" } });
    await userEvent.click(screen.getByRole("button", { name: "Save multiattack" }));

    const multiattacks = fighterActions().filter((a) => a.kind === "multiattack");
    expect(multiattacks).toHaveLength(1);
    expect(multiattacks[0]).toMatchObject({ id, attacks: [{ actionId: "longsword", count: 3 }] });
    expect(screen.getByRole("button", { name: "Create multiattack" })).toBeTruthy();
  });

  it("Cancel leaves the multiattack as it was", async () => {
    useEncounterStore.getState().addMultiattack("def-fighter", { name: "Multiattack", attacks: [{ actionId: "longsword", count: 2 }] });
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Multiattack" }));
    await userEvent.click(screen.getByRole("button", { name: "Extra Attack (3 swings)" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(fighterActions().find((a) => a.kind === "multiattack")).toMatchObject({ attacks: [{ actionId: "longsword", count: 2 }] });
    expect(screen.getByRole("button", { name: "Create multiattack" })).toBeTruthy();
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

  it("keeps a multiattack's saved target groups through an edit", async () => {
    routine([{ actionId: "longsword", count: 1 }, { actionId: "longsword", count: 1, targetGroup: 1 }]);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Multiattack" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Attack 1 count" }), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "Save multiattack" }));

    expect(fighterActions().find((a) => a.kind === "multiattack")).toMatchObject({
      attacks: [{ actionId: "longsword", count: 2 }, { actionId: "longsword", count: 1, targetGroup: 1 }]
    });
  });
});
