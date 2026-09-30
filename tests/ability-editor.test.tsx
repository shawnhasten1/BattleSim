// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition, WeaponDefinition } from "@/engine";
import { ActorSheet } from "@/components/sheet/ActorSheet";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import type { Compendium } from "@/hooks/useCompendium";
import { blankWeapon } from "@/lib/ability-editor/templates";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The ability editor (ABILITY_BUILDER_REDESIGN_PLAN.md Phase 2): weapons and attacks open in place of the Abilities
 * list, with a statblock preview, collapsible sections and one undo step per save.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { document.body.innerHTML = ""; });

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const longsword = () => [...fighter().actions, ...(fighter().bonusActions ?? []), ...(fighter().reactions ?? [])].find((a) => a.id === "longsword")! as Extract<ActionDefinition, { kind: "attack" }>;

/** The tab as the sheet renders it: re-rendered from the store after every change. */
function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

async function openLongsword() {
  render(<LiveTab />);
  await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
  return screen.getByRole("region", { name: "Edit Longsword" });
}

const section = (name: RegExp) => screen.getByRole("button", { name });
const preview = () => screen.getByLabelText("Preview").textContent ?? "";
const nameBox = () => screen.getByLabelText("Name") as HTMLInputElement;

describe("the ability editor's shell", () => {
  it("opens in place of the list, with the ability as a statblock", async () => {
    const editor = await openLongsword();
    expect(editor).toBeTruthy();
    expect(screen.queryByText("Weapons")).toBeNull();
    expect(preview()).toContain("Longsword. Melee Weapon Attack: +5 to hit, reach 5 ft., one target.");
    expect(section(/^Roll/).textContent).toContain("Melee attack");
  });

  it("keeps Save off until something changes, then saves in one undo step and goes back to the row", async () => {
    await openLongsword();
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const undoDepth = store().undoStack.length;

    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), "Arming Sword");
    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(preview()).toContain("Arming Sword.");
    await userEvent.click(save);

    expect(longsword().name).toBe("Arming Sword");
    expect(store().undoStack.length).toBe(undoDepth + 1);
    expect(screen.queryByRole("region", { name: /^Edit/ })).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Edit Arming Sword");
  });

  it("Cancel discards", async () => {
    await openLongsword();
    const undoDepth = store().undoStack.length;
    await userEvent.type(nameBox(), " of Doom");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(longsword().name).toBe("Longsword");
    expect(store().undoStack.length).toBe(undoDepth);
  });

  it("Escape asks before throwing changes away", async () => {
    const editor = await openLongsword();
    await userEvent.type(nameBox(), " of Doom");
    fireEvent.keyDown(editor, { key: "Escape" });
    const prompt = screen.getByRole("alertdialog", { name: "Unsaved changes" });
    expect(prompt.textContent).toContain("Save your changes to Longsword of Doom?");

    await userEvent.click(within(prompt).getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(nameBox().value).toBe("Longsword of Doom");

    fireEvent.keyDown(editor, { key: "Escape" });
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    expect(screen.queryByRole("region", { name: /^Edit/ })).toBeNull();
    expect(longsword().name).toBe("Longsword");
  });

  it("Escape with nothing changed closes at once, and Ctrl+Enter saves", async () => {
    let editor = await openLongsword();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(screen.queryByRole("region", { name: /^Edit/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    editor = screen.getByRole("region", { name: "Edit Longsword" });
    await userEvent.type(nameBox(), "!");
    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
    expect(longsword().name).toBe("Longsword!");
  });

  it("won't save without a name", async () => {
    await openLongsword();
    await userEvent.clear(nameBox());
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toBe("Give it a name first.");
    expect(longsword().name).toBe("Longsword");
  });

  it("updates a section's summary and the preview as fields change", async () => {
    await openLongsword();
    await userEvent.click(section(/^Target/));
    const reach = screen.getByLabelText("Reach (ft)");
    await userEvent.clear(reach);
    await userEvent.type(reach, "10");
    expect(section(/^Target/).textContent).toContain("reach 10 ft");
    expect(preview()).toContain("reach 10 ft.");
  });

  it("points a warning at the section that fixes it", async () => {
    useEncounterStore.getState().replaceAbilityRecord("def-fighter", { list: "actions", id: "longsword" }, {
      ...longsword(), attackBonus: undefined, attackBonusFormula: { ability: "str", proficiency: true },
      damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "int" }]
    } as ActionDefinition);
    await openLongsword();
    const warnings = screen.getByRole("list", { name: "Warnings" });
    expect(warnings.textContent).toContain("The damage adds INT on a STR attack.");
    await userEvent.click(within(warnings).getByRole("button", { name: "Show" }));
    expect(section(/^Damage/).getAttribute("aria-expanded")).toBe("true");
  });
});

describe("Use & cost", () => {
  it("writes a recharge and uses the way the SRD does, and at will clears them", async () => {
    await openLongsword();
    await userEvent.click(section(/^Use & cost/));
    await userEvent.click(screen.getByRole("radio", { name: "Recharge" }));
    await userEvent.selectOptions(screen.getByLabelText("Recharges on a d6 roll of"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(longsword()).toMatchObject({ usage: { kind: "recharge", recharge: { min: 4 } }, resourceCost: { resourceId: "usage:longsword", amount: 1 } });
    expect(fighter().resources?.["usage:longsword"]).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.click(section(/^Use & cost/));
    await userEvent.click(screen.getByRole("radio", { name: "At will" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(longsword()).not.toHaveProperty("usage");
    expect(longsword()).not.toHaveProperty("resourceCost");
  });

  it("creates a new pool with the ability, in the same undo step", async () => {
    await openLongsword();
    const undoDepth = store().undoStack.length;
    await userEvent.click(section(/^Use & cost/));
    await userEvent.click(screen.getByRole("radio", { name: "Pool" }));
    await userEvent.selectOptions(screen.getByLabelText("Spends from"), "__new");
    await userEvent.type(screen.getByLabelText("New pool name"), "Ki points");
    await userEvent.clear(screen.getByLabelText("New pool size"));
    await userEvent.type(screen.getByLabelText("New pool size"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Create pool" }));
    expect(section(/^Use & cost/).textContent).toContain("1 ki point");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(longsword().resourceCost).toEqual({ resourceId: "ki-points", amount: 1 });
    expect(fighter().resources?.["ki-points"]).toBe(4);
    expect(store().undoStack.length).toBe(undoDepth + 1);
  });

  it("makes it a reaction, and moves it to the reactions list on save", async () => {
    await openLongsword();
    await userEvent.click(section(/^Use & cost/));
    await userEvent.click(screen.getByRole("radio", { name: "Reaction" }));
    expect(preview()).toContain("When it is hit by an attack (reaction): Melee Weapon Attack");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fighter().actions.some((a) => a.id === "longsword")).toBe(false);
    expect(fighter().reactions?.find((a) => a.id === "longsword")).toMatchObject({ actionType: "reaction", reaction: { trigger: { kind: "hit-by-attack" } } });
  });
});

describe("Roll and Damage", () => {
  it("switches a printed to-hit to a calculated one, and shows how it works out", async () => {
    await openLongsword();
    await userEvent.click(section(/^Roll/));
    expect(screen.getByText(/Calculated would be \+5 \(STR \+3, proficiency \+2\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Calculated" }));
    expect(screen.getByText(/To hit/, { selector: "p" }).textContent).toContain("+5 = STR +3, proficiency +2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(longsword()).not.toHaveProperty("attackBonus");
    expect(longsword().attackBonusFormula).toEqual({ ability: "str", proficiency: true });
  });

  it("adds a damage line, keeping every line's dice and mirror in step", async () => {
    await openLongsword();
    await userEvent.click(section(/^Damage/));
    await userEvent.click(screen.getByRole("button", { name: "Add a line" }));
    await userEvent.selectOptions(screen.getByLabelText("Damage 2 die size"), "8");
    await userEvent.selectOptions(screen.getByLabelText("Damage 2 type"), "radiant");
    expect(section(/^Damage/).textContent).toContain("4 (1d8) radiant");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(longsword().damage[1]).toMatchObject({ dice: "1d8", diceCount: 1, diceSize: 8, damageType: "radiant" });
  });
});

describe("controls that were easy to get wrong", () => {
  it("offers an attack only the reaction triggers it can swing on", async () => {
    await openLongsword();
    await userEvent.click(section(/^Use & cost/));
    await userEvent.click(screen.getByRole("radio", { name: "Reaction" }));
    const options = within(screen.getByLabelText("When", { selector: "select" })).getAllByRole("option").map((option) => option.getAttribute("value"));
    expect(options).toEqual(["enemy-leaves-reach", "targeted-by-attack", "hit-by-attack", "manual"]);
  });

  it("keeps a damage line written as an expression, even when it could be dice", async () => {
    await openLongsword();
    await userEvent.click(section(/^Damage/));
    await userEvent.click(screen.getByRole("button", { name: "More for damage" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Damage written as" })).getByRole("radio", { name: "Expression" }));
    const expression = screen.getByLabelText("Damage dice") as HTMLInputElement;
    expect(expression.value).toBe("1d8");
    fireEvent.change(expression, { target: { value: "2d6+1d4" } });
    expect(preview()).toContain("(2d6 + 1d4 + 3)");
  });

  it("gives a grapple card one More options, holding its size and damage too", async () => {
    await openLongsword();
    await userEvent.click(section(/^Effects/));
    await userEvent.click(screen.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Grapple/ }));
    const card = screen.getByRole("group", { name: "Grapple effect" });
    expect(within(card).getAllByRole("button", { name: /More options/ })).toHaveLength(1);
    await userEvent.click(within(card).getByRole("button", { name: /More options/ }));
    expect(within(card).getByLabelText("Up to size")).toBeTruthy();
    expect(within(card).getByRole("checkbox", { name: "Costs charges" })).toBeTruthy();
  });

  it("won't let a weapon lose both ways to attack", async () => {
    useEncounterStore.getState().attachSrdWeapon("def-fighter", "srd:weapon:rapier");
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Rapier" }));
    await userEvent.click(section(/^Use & cost/));
    expect((screen.getByRole("checkbox", { name: "An action" }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("checkbox", { name: "A bonus action" }));
    expect((screen.getByRole("checkbox", { name: "An action" }) as HTMLInputElement).disabled).toBe(false);
  });
});

describe("Effects", () => {
  it("adds a condition on a hit as a card, and saves it as a rider", async () => {
    await openLongsword();
    await userEvent.click(section(/^Effects/));
    await userEvent.click(screen.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Condition/ }));
    const card = screen.getByRole("group", { name: "Condition effect" });
    await userEvent.selectOptions(within(card).getByLabelText("Condition"), "poisoned");
    await userEvent.selectOptions(within(card).getByLabelText("Save"), "con");
    await userEvent.type(within(card).getByLabelText("Save DC"), "13");
    await userEvent.selectOptions(within(card).getByLabelText("Lasts"), "1-minute");
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    const effects = document.querySelector<HTMLElement>('[data-section="effects"]')!;
    expect(within(effects).getByText(/The target must succeed on a DC 13 Constitution saving throw or be poisoned for 1 minute\./)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(longsword().riders).toMatchObject([{
      kind: "condition", when: "on-hit", condition: "poisoned", save: { ability: "con", onSuccess: "negates", dc: 13 },
      duration: { kind: "rounds", rounds: 10 }
    }]);
  });
});

describe("weapons", () => {
  const weapons = () => fighter().weapons ?? [];

  async function newWeapon() {
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Blank" }));
    await userEvent.click(screen.getByRole("button", { name: "Weapon" }));
    return screen.getByRole("region", { name: "Edit New weapon" });
  }

  it("starts a new weapon expanded, with its name selected", async () => {
    await newWeapon();
    expect(document.activeElement).toBe(nameBox());
    expect(section(/^Damage/).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Add to sheet" })).toBeTruthy();
  });

  it("builds Longsword +1 from scratch", async () => {
    await newWeapon();
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), "Longsword +1");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Category" })).getByRole("radio", { name: "Martial" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Magic bonus" })).getByRole("radio", { name: "+1" }));
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Grip" })).getByRole("radio", { name: "Versatile" }));
    expect(preview()).toContain("Longsword +1. Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 9 (1d10 + 4) slashing damage.");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    expect(weapons().at(-1)).toMatchObject({
      name: "Longsword +1", category: "martial", ability: "str", magicBonus: 1, magical: true, grip: "versatile",
      damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
      versatileDamage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }]
    });
  });

  it("builds The Fear Sword: charges, and an effect that spends one", async () => {
    await newWeapon();
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), "The Fear Sword");
    await userEvent.click(screen.getByLabelText("It has charges"));
    await userEvent.click(screen.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Condition/ }));
    const card = screen.getByRole("group", { name: "Condition effect" });
    await userEvent.selectOptions(within(card).getByLabelText("Condition"), "frightened");
    await userEvent.selectOptions(within(card).getByLabelText("Save"), "wis");
    await userEvent.type(within(card).getByLabelText("Save DC"), "15");
    await userEvent.selectOptions(within(card).getByLabelText("Lasts"), "1-minute");
    await userEvent.click(within(card).getByRole("button", { name: /More options/ }));
    await userEvent.click(within(card).getByLabelText("Costs charges"));
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    expect(preview()).toContain("frightened for 1 minute (uses 1 charge)");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    const sword = weapons().at(-1) as WeaponDefinition;
    expect(sword.charges).toMatchObject({ id: `${sword.id}:charges`, max: 1, recharge: "dawn" });
    expect(sword.onHit?.[0]).toMatchObject({ kind: "condition", condition: "frightened", resourceCost: { resourceId: `${sword.id}:charges`, amount: 1 } });
    expect(fighter().resources?.[`${sword.id}:charges`]).toBe(1);
  });

  it("builds Dagger of Venom: finesse, poisoned on a failed CON save", async () => {
    await newWeapon();
    await userEvent.clear(nameBox());
    await userEvent.type(nameBox(), "Dagger of Venom");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Uses" })).getByRole("radio", { name: "Finesse" }));
    await userEvent.selectOptions(screen.getByLabelText("Damage die size"), "4");
    await userEvent.selectOptions(screen.getByLabelText("Damage type"), "piercing");
    await userEvent.click(within(screen.getByRole("radiogroup", { name: "Magic bonus" })).getByRole("radio", { name: "+1" }));
    await userEvent.click(screen.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Condition/ }));
    const card = screen.getByRole("group", { name: "Condition effect" });
    await userEvent.selectOptions(within(card).getByLabelText("Condition"), "poisoned");
    await userEvent.type(within(card).getByLabelText("Save DC"), "15");
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

    expect(weapons().at(-1)).toMatchObject({
      name: "Dagger of Venom", ability: "finesse", magicBonus: 1,
      damage: [{ dice: "1d4", damageType: "piercing" }],
      onHit: [{ kind: "condition", condition: "poisoned", save: { ability: "con", dc: 15 } }]
    });
    // Finesse leaves the modifier to the engine, which adds the better of STR and DEX.
    expect((weapons().at(-1) as WeaponDefinition).damage[0]?.abilityModifier).toBeUndefined();
  });

  it("lists what a weapon does while carried and what it grants, and says where to change them", async () => {
    store().insertAbilityRecord("def-fighter", "weapons", {
      ...blankWeapon(), name: "Sword of Warding",
      effects: [{ kind: "armor-class-bonus", bonus: { base: 1 } }],
      grantedActions: [{ ...longsword(), id: "warding-swing", name: "Warding Swing" }]
    });
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Sword of Warding" }));
    await userEvent.click(section(/^While active/));
    await userEvent.click(section(/^Grants/));

    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toContain("Warding Swing");
    expect(screen.getAllByText(/open the weapon in the classic editor/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Open it in the classic editor" })).toBeTruthy();
  });
});

describe("the sheet around the editor", () => {
  const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;

  async function editInSheet() {
    render(<ActorSheet compendium={compendium} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.type(nameBox(), " of Doom");
  }

  it("asks before a tab switch loses changes", async () => {
    await editInSheet();
    await userEvent.click(screen.getByRole("tab", { name: "Stats" }));
    const prompt = screen.getByRole("alertdialog", { name: "Unsaved changes" });
    expect(prompt.textContent).toContain("Save your changes to Longsword of Doom first?");
    await userEvent.click(within(prompt).getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("tab", { name: "Abilities" }).getAttribute("aria-selected")).toBe("true");

    await userEvent.click(screen.getByRole("tab", { name: "Stats" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("tab", { name: "Stats" }).getAttribute("aria-selected")).toBe("true");
    expect(longsword().name).toBe("Longsword of Doom");
  });

  it("stays on the creature being edited when another token is selected", async () => {
    await editInSheet();
    const goblin = store().encounter.combatants.find((c) => c.faction === "enemy")!;
    act(() => store().selectCombatant(goblin.id));

    const prompt = screen.getByRole("alertdialog", { name: "Unsaved changes" });
    expect(prompt.textContent).toContain(`You selected ${goblin.displayName}.`);
    expect(nameBox().value).toBe("Longsword of Doom");

    await userEvent.click(within(prompt).getByRole("button", { name: "Keep editing" }));
    expect(store().selectedCombatantId).toBe("pc-fighter");

    act(() => store().selectCombatant(goblin.id));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard and switch" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(longsword().name).toBe("Longsword");
    expect(screen.getByRole("dialog").getAttribute("aria-label")).toContain("Goblin");
  });

  it("asks before closing with changes", async () => {
    let closed = false;
    render(<ActorSheet compendium={compendium} onClose={() => { closed = true; }} />);
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.type(nameBox(), "!");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(closed).toBe(false);
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Discard" }));
    expect(closed).toBe(true);
  });
});
