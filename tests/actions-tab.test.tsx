// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEncounterStore } from "@/store/encounter-store";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { blankLairAction } from "@/lib/ability-editor/templates";
import { getExecutableActions, type CreatureDefinition } from "@/engine";
import { addFromLibrary, group, openAdd, openFromLibrary, rowMenu, searchAdd, startFromScratch, useRecipe } from "./helpers/abilities-tab";

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
  it("lists the actor's weapons where they're used, with an edit affordance", () => {
    renderTab();
    expect(group("Actions").getByRole("button", { name: "Edit Rapier" })).toBeTruthy();
    expect(group("Actions").getByRole("button", { name: "Edit Longsword" })).toBeTruthy();
  });

  it("opens Add with one search, its filters, and blank kinds to start from scratch", async () => {
    renderTab();
    await openAdd();
    expect(screen.getByRole("searchbox", { name: "Search abilities" })).toBeTruthy();
    const filters = within(screen.getByRole("group", { name: "Show" })).getAllByRole("button").map((button) => button.textContent);
    expect(filters).toEqual(["All", "My library", "Weapons", "Spells", "Items", "Monster abilities", "Traits & features", "Recipes"]);
    const blanks = within(screen.getByRole("region", { name: "Start from scratch" })).getAllByRole("button").map((button) => button.textContent);
    expect(blanks).toEqual(["Weapon", "Attack", "Special action", "Multiattack", "Spell", "Trait or feature", "Item", "Reaction", "Legendary action", "Lair action", "On death", "Summon", "Shapechange"]);
  });

  it("adds a library entry with one click on its +, or opens it to check first and adds it on Save", async () => {
    renderTab();
    const spells = () => useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!.spells ?? [];
    await addFromLibrary("Fireball", "fireball");
    expect(spells().map((spell) => spell.name)).toEqual(["Fireball"]);

    await openFromLibrary("Magic Missile", "magic missile");
    // The editor is open on a copy: nothing is added until Save.
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Magic Missile");
    expect(spells().map((spell) => spell.name)).toEqual(["Fireball"]);
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    expect(spells().map((spell) => spell.name)).toEqual(["Fireball", "Magic Missile"]);
    expect(spells()[1]!.source).toMatchObject({ documentName: "System Reference Document 5.1", slug: "srd:spell:magic-missile", edition: "2014" });
  });

  it("the Weapons / Spells filters narrow the library", async () => {
    renderTab();
    await openAdd();
    await userEvent.click(screen.getByRole("button", { name: "Spells" }));
    await searchAdd("dagger");
    // "Dagger" the weapon must not appear under the Spells filter
    expect(screen.queryByRole("region", { name: "Library" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Weapons" }));
    expect(within(screen.getByRole("region", { name: "Library" })).getByRole("button", { name: /^Dagger ·/ })).toBeTruthy();
  });

  it("opens what used to need the classic forms in the ability editor, which has no classic form to fall back on", async () => {
    const encounter = useEncounterStore.getState().encounter;
    useEncounterStore.setState({
      encounter: { ...encounter, definitions: encounter.definitions.map((d) => (d.id === "def-fighter" ? { ...d, lairActions: [{ ...blankLairAction(), id: "lair-1", name: "Eruption" }] } : d)) }
    });
    renderTab();
    await userEvent.click(screen.getByRole("button", { name: "Edit Eruption" }));
    expect(screen.getByRole("region", { name: "Edit Eruption" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open it in the classic editor" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Advanced" })).toBeNull();
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
    await useRecipe("Save or condition");

    // The editor is open on a saving throw with a paralysis effect, its Roll and Effects to fill in.
    expect(screen.getByRole("radio", { name: "Saving throw" }).getAttribute("aria-checked")).toBe("true");
    expect(within(document.querySelector<HTMLElement>('[data-section="effects"]')!).getByText("On a failed save")).toBeTruthy();
    const filling = [...document.querySelectorAll<HTMLElement>("[data-section]")].filter((section) => section.textContent?.includes("fill in")).map((section) => section.dataset.section);
    expect(filling).toEqual(["roll", "effects"]);

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
    await startFromScratch("Spell");
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
    useEncounterStore.getState().insertAbilityRecord("def-fighter", "actions", { kind: "multiattack", id: "", name: "Multiattack", actionType: "action", attacks, automationSupport: "full" });
  const fighterDefinition = () => useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")!;
  const rapierAttackId = () => getExecutableActions(fighterDefinition()).find((a) => a.name === "Rapier" && a.actionType === "action")!.id;

  it("asks first when the multiattack would be deleted too, and Cancel keeps both", async () => {
    routine([{ actionId: "longsword", count: 2 }]);
    render(<LiveTab />);
    await rowMenu("Longsword", "Delete");
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
    await rowMenu("Longsword", "Delete");
    await userEvent.click(screen.getByRole("button", { name: "Delete Longsword and Multiattack" }));

    expect(fighterActions()).toEqual([]);
    expect(useEncounterStore.getState().undoStack.length).toBe(undoDepth + 1);
    useEncounterStore.getState().undo();
    expect(fighterActions().map((a) => a.kind)).toEqual(["attack", "multiattack"]);
  });

  it("says what a multiattack is left with when it keeps other steps", async () => {
    routine([{ actionId: "longsword", count: 1 }, { actionId: rapierAttackId(), count: 1 }]);
    render(<LiveTab />);
    await rowMenu("Longsword", "Delete");
    const prompt = screen.getByRole("alertdialog", { name: "Delete Longsword?" });
    expect(prompt.textContent).toContain("Multiattack uses Longsword. Without it, Multiattack will be: Rapier.");
    await userEvent.click(within(prompt).getByRole("button", { name: "Delete Longsword" }));

    expect(fighterActions().find((a) => a.kind === "multiattack")).toMatchObject({ attacks: [{ actionId: rapierAttackId(), count: 1 }] });
  });

  it("deletes at once when no multiattack uses the record, and Undo brings it back", async () => {
    routine([{ actionId: "longsword", count: 2 }]);
    render(<LiveTab />);
    await rowMenu("Rapier", "Delete");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fighterDefinition().weapons).toEqual([]);
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Deleted Rapier.");
    await userEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    expect(fighterDefinition().weapons!.map((weapon) => weapon.name)).toEqual(["Rapier"]);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
