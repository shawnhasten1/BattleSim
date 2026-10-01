// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getExecutableActions, type ActionDefinition, type CreatureDefinition, type MultiattackActionDefinition } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import {
  blankMultiattack,
  movedStep,
  referenceAc,
  replacementRoutine,
  routineStats,
  stepChoices,
  withoutRoutine,
  withNewOption
} from "@/lib/ability-editor/sequence";
import { actionStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";

/** Phase 5's editor: a multiattack's Sequence section, deletes that offer a replacement, and the library's Extra Attack. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
  // The sample fighter's Longsword is an `actions` entry; a Rapier and a Longbow give it weapons too.
  store().attachSrdWeapon("def-fighter", "srd:weapon:rapier");
  store().attachSrdWeapon("def-fighter", "srd:weapon:longbow");
});
afterEach(() => { document.body.innerHTML = ""; });

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const routines = () => [...fighter().actions, ...(fighter().bonusActions ?? [])].filter((a): a is MultiattackActionDefinition => a.kind === "multiattack");
const weaponAttack = (name: string) => getExecutableActions(fighter()).find((a) => a.name === name && a.kind === "attack" && a.actionType === "action")!.id;

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

const inSection = (id: string) => within(document.querySelector<HTMLElement>(`[data-section="${id}"]`)!);
const radio = (scope: ReturnType<typeof within>, group: string, option: string) =>
  userEvent.click(within(scope.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
const preview = () => screen.getByRole("group", { name: "Preview" }).textContent ?? "";
async function retype(box: HTMLElement, value: string) {
  await userEvent.clear(box);
  await userEvent.type(box, value);
}

async function blankMultiattackEditor() {
  render(<LiveTab />);
  await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
  await userEvent.click(screen.getByRole("button", { name: "Blank" }));
  await userEvent.click(screen.getByRole("button", { name: "Multiattack" }));
}

async function editRoutine(attacks: Array<{ actionId: string; count: number; targetGroup?: number }>) {
  store().addMultiattack("def-fighter", { name: "Multiattack", attacks });
  render(<LiveTab />);
  await userEvent.click(screen.getByRole("button", { name: "Edit Multiattack" }));
}

describe("the Sequence section", { timeout: 20000 }, () => {
  it("Blank → Multiattack starts with two swings of any weapon attack, and lists it first under Actions", async () => {
    await blankMultiattackEditor();
    const sequence = inSection("sequence");
    expect((sequence.getByLabelText("Routine step 1 uses") as HTMLSelectElement).value).toBe("any:weapon");
    expect((sequence.getByLabelText("Routine step 1 count") as HTMLInputElement).value).toBe("2");
    expect(preview()).toContain("It makes two attacks.");
    // Each swing at its best weapon against the reference AC (13 for a creature with no level or rating).
    expect(sequence.getByLabelText("Routine per round").textContent).toMatch(/≈ \d+ damage a round vs AC 13/);
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    expect(routines()).toEqual([expect.objectContaining({ name: "Multiattack", attacks: [{ any: "weapon", count: 2 }] })]);
    const actionRows = [...document.querySelectorAll("h4")].find((head) => head.textContent === "Actions")!.parentElement!;
    expect(actionRows.querySelector("strong")?.textContent).toBe("Multiattack");
  });

  it("edits a routine in place: a step's count and what it uses", async () => {
    await editRoutine([{ actionId: "longsword", count: 2 }]);
    const id = routines()[0]!.id;
    const sequence = inSection("sequence");
    await retype(sequence.getByLabelText("Routine step 1 count"), "3");
    await userEvent.selectOptions(sequence.getByLabelText("Routine step 1 uses"), `id:${weaponAttack("Rapier")}`);
    expect(preview()).toContain("It makes three rapier attacks.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(routines()).toEqual([expect.objectContaining({ id, attacks: [{ actionId: weaponAttack("Rapier"), count: 3 }] })]);
  });

  it("Cancel leaves it as it was, and what it doesn't show (a saved target group) survives a save", async () => {
    await editRoutine([{ actionId: "longsword", count: 1 }, { actionId: "longsword", count: 1, targetGroup: 1 }]);
    await retype(inSection("sequence").getByLabelText("Routine step 1 count"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(routines()[0]!.attacks).toEqual([{ actionId: "longsword", count: 1 }, { actionId: "longsword", count: 1, targetGroup: 1 }]);

    await userEvent.click(screen.getByRole("button", { name: "Edit Multiattack" }));
    await retype(inSection("sequence").getByLabelText("Routine step 1 count"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(routines()[0]!.attacks).toEqual([{ actionId: "longsword", count: 2 }, { actionId: "longsword", count: 1, targetGroup: 1 }]);
  });

  it("builds a grick: a second attack after a hit, on the same creature", async () => {
    await editRoutine([{ actionId: "longsword", count: 1 }]);
    const sequence = inSection("sequence");
    await userEvent.click(sequence.getByRole("button", { name: "Add a step" }));
    await userEvent.selectOptions(sequence.getByLabelText("Routine step 2 uses"), `id:${weaponAttack("Rapier")}`);
    await userEvent.click(sequence.getByRole("button", { name: "Rules for routine step 2" }));
    await radio(sequence, "Routine step 2 target", "The previous attack's target");
    await userEvent.click(sequence.getByRole("checkbox", { name: "Only if the previous attack hit" }));
    expect(preview()).toContain("It makes one longsword attack. If that attack hits, it can make one rapier attack against the same target.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(routines()[0]!.attacks).toEqual([
      { actionId: "longsword", count: 1 },
      { actionId: weaponAttack("Rapier"), count: 1, target: "same-as-previous", requiresPreviousHit: true }
    ]);
  });

  it("builds a tyrannosaurus: an attack that can't join the other's target; and moves and removes steps", async () => {
    await editRoutine([{ actionId: "longsword", count: 1 }, { actionId: weaponAttack("Rapier"), count: 1 }]);
    const sequence = inSection("sequence");
    await userEvent.click(sequence.getByRole("button", { name: "Rules for routine step 2" }));
    await radio(sequence, "Routine step 2 target", "A different creature");
    expect(preview()).toContain("It can't make both attacks against the same target.");
    await userEvent.click(sequence.getByRole("button", { name: "Move routine step 2 up" }));
    expect((sequence.getByLabelText("Routine step 1 uses") as HTMLSelectElement).value).toBe(`id:${weaponAttack("Rapier")}`);
    expect((sequence.getByRole("button", { name: "Move routine step 1 up" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(sequence.getByRole("button", { name: "Add a step" }));
    await userEvent.click(sequence.getByRole("button", { name: "Remove routine step 3" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(routines()[0]!.attacks).toEqual([{ actionId: weaponAttack("Rapier"), count: 1, target: "different" }, { actionId: "longsword", count: 1 }]);
  });

  it("“Replace one attack with…” adds an option the preview reads as a replacement (a wight's Life Drain)", async () => {
    await editRoutine([{ actionId: "longsword", count: 2 }]);
    const sequence = inSection("sequence");
    await userEvent.click(sequence.getByRole("button", { name: "↳ Replace one attack with…" }));
    const row = within(sequence.getByRole("group", { name: "Replace one attack" }));
    await userEvent.selectOptions(row.getByLabelText("Replacement"), `id:${weaponAttack("Rapier")}`);
    await userEvent.click(row.getByRole("button", { name: "Add as an option" }));
    expect(preview()).toContain("It makes two longsword attacks. It can make one rapier attack in place of one longsword attack.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(routines()[0]!.options).toEqual([{ label: "Rapier", attacks: [{ actionId: "longsword", count: 1 }, { actionId: weaponAttack("Rapier"), count: 1 }] }]);
  });

  it("“…or another routine” adds an option to label and change; one can be removed", async () => {
    await editRoutine([{ actionId: "longsword", count: 2 }]);
    const sequence = inSection("sequence");
    await userEvent.click(sequence.getByRole("button", { name: "…or another routine" }));
    await userEvent.type(sequence.getByLabelText("Option 2 label"), "Longbow");
    const option = within(sequence.getByRole("group", { name: "Longbow" }));
    await userEvent.selectOptions(option.getByLabelText("Longbow step 1 uses"), "any:ranged");
    expect(preview()).toContain("It makes two longsword attacks or two ranged attacks.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(routines()[0]!.options).toEqual([{ label: "Longbow", attacks: [{ any: "ranged", count: 2 }] }]);

    await userEvent.click(screen.getByRole("button", { name: "Edit Multiattack" }));
    await userEvent.click(inSection("sequence").getByRole("button", { name: "Remove Longbow" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(routines()[0]!.options).toBeUndefined();
  });

  it("offers “One weapon per Attack action” for any-weapon swings, and notes what isn't simulated", async () => {
    await blankMultiattackEditor();
    const sequence = inSection("sequence");
    await userEvent.click(sequence.getByRole("checkbox", { name: "One weapon per Attack action" }));
    expect(preview()).toContain("It makes two attacks. It makes them all with the same weapon.");
    await userEvent.click(sequence.getByRole("button", { name: "Not simulated" }));
    await userEvent.type(sequence.getByLabelText("Not simulated"), "It can also shove.");
    expect(screen.getAllByText("Not simulated: It can also shove.").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    expect(routines()[0]).toMatchObject({ oneWeapon: true, unsimulated: ["It can also shove."] });
  });

  it("makes Flurry of Blows: a bonus-action routine that costs ki", async () => {
    await blankMultiattackEditor();
    await retype(screen.getByLabelText("Name"), "Flurry of Blows");
    const use = inSection("use");
    await radio(use, "Takes", "Bonus action");
    await radio(use, "Limit", "Pool");
    await userEvent.selectOptions(use.getByLabelText("Spends from"), "__new");
    await userEvent.type(use.getByLabelText("New pool name"), "ki");
    await retype(use.getByLabelText("New pool size"), "4");
    await userEvent.click(use.getByRole("button", { name: "Create pool" }));
    expect(preview()).toContain("It makes two attacks.");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    const flurry = fighter().bonusActions!.find((action) => action.name === "Flurry of Blows")!;
    expect(flurry).toMatchObject({ kind: "multiattack", actionType: "bonus", resourceCost: { resourceId: "ki", amount: 1 } });
    expect(fighter().resources?.ki).toBe(4);
  });

  it("warns about a generic step with nothing to swing, and shows where", async () => {
    await editRoutine([{ actionId: "longsword", count: 1 }]);
    store().removeDefinitionItem("def-fighter", "weapon", fighter().weapons!.find((w) => w.name === "Longbow")!.id);
    document.body.innerHTML = "";
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Multiattack" }));
    await userEvent.selectOptions(inSection("sequence").getByLabelText("Routine step 1 uses"), "any:ranged");
    const warnings = within(screen.getByRole("list", { name: "Warnings" }));
    expect(warnings.getByText("It has no ranged attack to make: add one, or change that step.")).toBeTruthy();
  });
});

describe("deleting an ability a routine uses", { timeout: 20000 }, () => {
  it("offers to replace it in the routine, in one undo step", async () => {
    await editRoutine([{ actionId: "longsword", count: 2 }]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const undoDepth = store().undoStack.length;
    await userEvent.click(screen.getByRole("button", { name: "Remove Longsword" }));
    const prompt = within(screen.getByRole("alertdialog", { name: "Delete Longsword?" }));
    expect(prompt.getByRole("button", { name: "Delete Longsword and Multiattack" })).toBeTruthy();
    await userEvent.selectOptions(prompt.getByLabelText("Replace Longsword with"), "any:melee");
    expect(screen.getByRole("alertdialog").textContent).toContain("Multiattack uses Longsword. With Any melee attack instead, Multiattack will be: 2 × any melee attack.");
    await userEvent.click(prompt.getByRole("button", { name: "Delete Longsword" }));

    expect(fighter().actions.map((action) => action.kind)).toEqual(["multiattack"]);
    expect(routines()[0]!.attacks).toEqual([{ any: "melee", count: 2 }]);
    expect(store().undoStack.length).toBe(undoDepth + 1);
    store().undo();
    expect(routines()[0]!.attacks).toEqual([{ actionId: "longsword", count: 2 }]);
  });
});

describe("the library's Extra Attack", { timeout: 20000 }, () => {
  it("grants a routine of two weapon attacks, edited from the feature's Grants (a level 11 fighter's three)", async () => {
    store().attachSrdFeature("def-fighter", "srd:feature:extra-attack");
    const granted = () => (fighter().features ?? []).find((feature) => feature.name === "Extra Attack")!.grantedActions![0] as ActionDefinition;
    expect(granted()).toMatchObject({ kind: "multiattack", name: "Extra Attack", attacks: [{ any: "weapon", count: 2 }] });
    expect(getExecutableActions(fighter()).some((action) => action.kind === "multiattack" && action.name === "Extra Attack")).toBe(true);

    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Extra Attack" }));
    await userEvent.click(screen.getByRole("button", { name: /^Grants/ }));
    await userEvent.click(inSection("grants").getByRole("button", { name: "Edit Extra Attack" }));
    await retype(inSection("sequence").getByLabelText("Routine step 1 count"), "3");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(granted()).toMatchObject({ attacks: [{ any: "weapon", count: 3 }] });
  });
});

describe("the routine model", () => {
  const definition = () => fighter();

  it("offers its attacks, any attack of a kind, and its save and area abilities; a step's missing ability stays shown", () => {
    const choices = stepChoices(definition(), [{ actionId: "gone", count: 1 }]);
    expect(choices.filter((choice) => choice.group === "attack").map((choice) => choice.label)).toEqual(["Longsword", "Rapier", "Longbow", "gone (missing)"]);
    expect(choices.filter((choice) => choice.group === "generic").map((choice) => choice.value)).toEqual(["any:weapon", "any:melee", "any:ranged"]);
  });

  it("replaces one swing, moves steps, and hands the main routine to its first option", () => {
    expect(replacementRoutine([{ actionId: "a", count: 2 }, { actionId: "b", count: 1 }], 0, "id:drain")).toEqual([
      { actionId: "a", count: 1 }, { actionId: "drain", count: 1 }, { actionId: "b", count: 1 }
    ]);
    expect(movedStep([{ any: "melee", count: 1 }, { any: "ranged", count: 1 }], 1, -1)).toEqual([{ any: "ranged", count: 1 }, { any: "melee", count: 1 }]);
    const base = blankMultiattack(definition());
    const both = withNewOption(base, [{ any: "ranged", count: 2 }], "Ranged");
    expect(withoutRoutine(both, 0)).toMatchObject({ attacks: [{ any: "ranged", count: 2 }] });
    expect(withoutRoutine(both, 0).options).toBeUndefined();
  });

  it("says it holds to one weapon when any routine picks its weapon swing by swing", () => {
    const routine = withNewOption({ ...blankMultiattack(definition()), attacks: [{ actionId: "longsword", count: 2 }], oneWeapon: true }, [{ any: "melee", count: 3 }]);
    expect(actionStatblock(routine, definition()).text).toBe("It makes two longsword attacks or three melee attacks. It makes them all with the same weapon.");
  });

  it("works out a routine's damage a round at an AC, and each step's reach", () => {
    const stats = routineStats(definition(), [{ actionId: "longsword", count: 2 }, { any: "ranged", count: 1 }], 13);
    // Longsword +5 (as printed) vs AC 13 hits 65% of the time for 7 (the statblock average); the longbow +3 hits 55% for 5.
    expect(stats.damage).toBeCloseTo(0.65 * 7 * 2 + 0.55 * 5, 5);
    expect(stats.reach).toEqual(["longsword 5 ft", "any ranged attack 150/600 ft"]);
    expect(referenceAc({ ...definition(), challengeRating: 10 })).toBe(17);
  });
});
