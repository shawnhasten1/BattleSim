// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveNumericFormula, type ActionDefinition, type CreatureDefinition, type FeatureDefinition, type FeatureEffect } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { legacyBonusEffects } from "@/lib/ability-editor/features";
import { useEncounterStore } from "@/store/encounter-store";
import { startFromScratch } from "./helpers/abilities-tab";

/**
 * Phase 8 in the Abilities tab: no classic editor to fall back on, and what it was pointed at done in the editor itself
 * (a formula read out, a feature's old bonuses made effects, a buff's other modifiers as cards); the controls the old
 * builder's tests covered (a weapon's uses, an area's width, a lingering area's triggers, casting before combat); and
 * summons as the old summon editor's tests had them (the scene's creatures, edited in place, a loop refused, a pool).
 */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { document.body.innerHTML = ""; });

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const allActions = () => [...fighter().actions, ...(fighter().bonusActions ?? []), ...(fighter().reactions ?? [])];

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

function patchDefinition(id: string, patch: Partial<CreatureDefinition>) {
  const encounter = store().encounter;
  useEncounterStore.setState({ encounter: { ...encounter, definitions: encounter.definitions.map((d) => (d.id === id ? { ...d, ...patch } : d)) } });
}

const section = (id: string) => document.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
async function openSection(id: string) {
  const head = section(id).querySelector<HTMLButtonElement>(":scope > button")!;
  if (head.getAttribute("aria-expanded") !== "true") await userEvent.click(head);
  return within(section(id));
}
const radio = (group: string, option: string) => userEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
const checkedIn = (group: string) => screen.getByRole("radiogroup", { name: group }).querySelector("[aria-checked=true]")?.textContent ?? null;
const pressed = (group: string, name: string) => within(screen.getByRole("group", { name: group })).getByRole("button", { name }).getAttribute("aria-pressed") === "true";
const addToSheet = () => userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));
const warnings = () => document.querySelector("[aria-label=\"Warnings\"]")?.textContent ?? "";

/** A trait on the fighter, opened in the editor on its effect card named `label`. */
async function openTraitCard(trait: Partial<FeatureDefinition>, label: string) {
  store().insertAbilityRecord("def-fighter", "traits", { id: "", category: "trait", automationSupport: "full", ...trait } as FeatureDefinition);
  render(<LiveTab />);
  await userEvent.click(screen.getByRole("button", { name: `Edit ${trait.name}` }));
  const effects = await openSection("while-active");
  await userEvent.click(effects.getByRole("button", { name: `Edit ${label.toLowerCase()} effect` }));
  return within(screen.getByRole("group", { name: `${label} effect` }));
}

describe("no classic editor", { timeout: 30000 }, () => {
  it("opens every row in the ability editor, with nothing to fall back on", async () => {
    store().attachSrdSpell("def-fighter", "srd:spell:fireball");
    store().attachSrdWeapon("def-fighter", "srd:weapon:longbow");
    store().insertAbilityRecord("def-fighter", "actions", {
      kind: "summon", id: "", name: "Call a Goblin", actionType: "action", range: 30, choice: "pick",
      options: [{ id: "goblin", definitionId: "def-goblin", label: "Goblin", count: 1 }], automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    const names = screen.getAllByRole("button", { name: /^Edit / }).map((button) => button.getAttribute("aria-label")!.slice("Edit ".length));
    expect(names).toEqual(expect.arrayContaining(["Fireball", "Longbow", "Call a Goblin", "Second Wind"]));
    for (const name of names) {
      await userEvent.click(screen.getByRole("button", { name: `Edit ${name}` }));
      expect(screen.getByRole("region", { name: `Edit ${name}` })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /classic editor/ })).toBeNull();
      expect(document.body.textContent).not.toMatch(/classic editor/);
      await userEvent.click(screen.getByRole("button", { name: "Back to abilities" }));
    }
  });
});

describe("a bonus that adds more than one thing", { timeout: 20000 }, () => {
  it("is read out, and switching it to a number replaces it", async () => {
    const formula = { base: 1, ability: "cha" as const, proficiency: true };
    const card = await openTraitCard({ name: "Insight", effects: [{ kind: "save-bonus", bonus: formula }] }, "Bonus to its saves");
    const total = resolveNumericFormula(formula, fighter());
    const words = card.getByText("(1 + CHA modifier + proficiency bonus)");
    expect(words.parentElement!.textContent).toBe(`${total < 0 ? total : `+${total}`} (1 + CHA modifier + proficiency bonus)`);
    // What to do about it is a tooltip away.
    expect(card.getByRole("button", { name: "About this formula" })).toBeTruthy();
    expect(checkedIn("Save bonus is")).toBeNull();
    await radio("Save bonus is", "A number");
    expect((card.getByLabelText("Save bonus") as HTMLInputElement).value).toBe("+1");
    await userEvent.click(card.getByRole("button", { name: "Done" }));
    await save();
    expect((fighter().traits ?? []).find((trait) => trait.name === "Insight")!.effects).toEqual([{ kind: "save-bonus", bonus: { base: 1 } }]);
  });

  it("shows a spellcasting ability's modifier as one", async () => {
    const card = await openTraitCard({ name: "Focus", effects: [{ kind: "save-dc-bonus", bonus: { ability: "spellcasting" } }] }, "Bonus to its save DCs");
    const select = card.getByLabelText("DC bonus ability") as HTMLSelectElement;
    expect(select.value).toBe("spellcasting");
    expect(select.selectedOptions[0]!.textContent).toBe("Spellcasting");
    expect(checkedIn("DC bonus is")).toBe("An ability modifier");
  });
});

describe("a feature's old bonuses", { timeout: 20000 }, () => {
  it("warn, and become effects the simulator applies", async () => {
    const modifiers: FeatureDefinition["modifiers"] = { armorClass: { base: 1 }, savingThrows: { wis: { base: 2 } } };
    store().insertAbilityRecord("def-fighter", "traits", { id: "", name: "Ward", category: "trait", modifiers, automationSupport: "full" } as FeatureDefinition);
    render(<LiveTab />);
    const row = screen.getByRole("button", { name: "Edit Ward" }).closest("[data-row-id]")!;
    expect(row.querySelector("[data-automation]")!.getAttribute("data-automation")).toBe("partial");

    await userEvent.click(screen.getByRole("button", { name: "Edit Ward" }));
    expect(warnings()).toContain("It lists bonuses the simulator doesn't apply (from an older save): make them effects in While active.");
    const effects = await openSection("while-active");
    expect(effects.getByText(/^It also lists bonuses the simulator doesn.t apply: .*AC/)).toBeTruthy();
    await userEvent.click(effects.getByRole("button", { name: "Make them effects" }));
    expect(effects.queryByRole("button", { name: "Make them effects" })).toBeNull();
    expect(effects.getByRole("button", { name: "Edit ac bonus effect" })).toBeTruthy();
    expect(effects.getByRole("button", { name: "Edit bonus to its saves effect" })).toBeTruthy();
    expect(warnings()).not.toContain("bonuses the simulator doesn't apply");
    await save();
    const ward = (fighter().traits ?? []).find((trait) => trait.name === "Ward")!;
    expect(ward.modifiers).toBeUndefined();
    expect(ward.effects).toEqual(legacyBonusEffects(modifiers));
  });
});

describe("a buff's other modifiers", { timeout: 20000 }, () => {
  it("are cards beside its effects: a speed change removed, an immunity made a vulnerability", async () => {
    store().insertAbilityRecord("def-fighter", "actions", {
      kind: "buff", id: "", name: "Stone Skin", actionType: "action", range: 30, targeting: { target: "single" },
      appliedCondition: {
        name: "custom", durationRounds: 10,
        modifiers: { armorClass: 2, movementMultiplier: 2, damageAdjustments: [{ type: "resistance", damageType: "fire" }, { type: "immunity", damageType: "poison" }] }
      },
      automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Stone Skin" }));
    const benefit = await openSection("outcome");
    expect((benefit.getByLabelText("AC bonus") as HTMLInputElement).value).toBe("+2");
    expect(benefit.queryByText(/classic editor/)).toBeNull();
    await userEvent.click(benefit.getByRole("button", { name: "Remove speed effect" }));
    await userEvent.click(benefit.getByRole("button", { name: "Edit immunity effect" }));
    const card = within(screen.getByRole("group", { name: "Immunity effect" }));
    await userEvent.click(within(card.getByRole("radiogroup", { name: "It has" })).getByRole("radio", { name: "Vulnerability" }));
    await userEvent.click(card.getByRole("button", { name: "Done" }));
    await save();
    const skin = allActions().find((action) => action.name === "Stone Skin") as Extract<ActionDefinition, { kind: "buff" }>;
    expect(skin.appliedCondition.modifiers).toEqual({
      armorClass: 2, damageAdjustments: [{ type: "resistance", damageType: "fire" }, { type: "vulnerability", damageType: "poison" }]
    });
  });
});

describe("what the old builder's tests covered, in the editor", { timeout: 30000 }, () => {
  const weapon = () => (fighter().weapons ?? []).find((candidate) => candidate.name === "New weapon")!;

  it("a weapon used as an action, a bonus action, or for opportunity attacks", async () => {
    render(<LiveTab />);
    await startFromScratch("Weapon");
    let use = await openSection("use");
    await userEvent.click(use.getByRole("checkbox", { name: "A bonus action" }));
    await userEvent.click(use.getByRole("checkbox", { name: "An action" }));
    // The last one ticked can't be cleared.
    expect((use.getByRole("checkbox", { name: "A bonus action" }) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(use.getAllByRole("button", { name: /More options/ }).at(-1)!);
    await userEvent.click(use.getByRole("checkbox", { name: "Can make opportunity attacks with it" }));
    await addToSheet();
    // An off-hand weapon: only a bonus action, and it never makes opportunity attacks.
    expect(weapon().usableAs).toEqual(["bonus"]);

    await userEvent.click(screen.getByRole("button", { name: "Edit New weapon" }));
    use = await openSection("use");
    await userEvent.click(use.getByRole("checkbox", { name: "An action" }));
    await userEvent.click(use.getAllByRole("button", { name: /More options/ }).at(-1)!);
    await userEvent.click(use.getByRole("checkbox", { name: "Can make opportunity attacks with it" }));
    await save();
    expect(weapon().usableAs).toEqual(["action", "bonus", "reaction"]);

    await userEvent.click(screen.getByRole("button", { name: "Edit New weapon" }));
    use = await openSection("use");
    await userEvent.click(use.getByRole("checkbox", { name: "A bonus action" }));
    await save();
    // An action and opportunity attacks is every melee weapon's default, so nothing is stored.
    expect(weapon().usableAs).toBeUndefined();
  });

  it("an area's width is a line's, and a lingering area's triggers go on and off each on its own", async () => {
    render(<LiveTab />);
    await startFromScratch("Spell");
    await radio("How it works", "Saving throw");
    await radio("Reaches", "An area");
    await radio("Shape", "Line");
    expect(screen.getByLabelText("Width (ft)")).toBeTruthy();
    for (const shape of ["Cone", "Cube", "Sphere"]) {
      await radio("Shape", shape);
      expect(screen.queryByLabelText("Width (ft)"), shape).toBeNull();
    }

    await userEvent.click(screen.getByRole("checkbox", { name: "Leaves a lingering area" }));
    const triggers = "It affects a creature that";
    const toggle = (name: string) => userEvent.click(within(screen.getByRole("group", { name: triggers })).getByRole("button", { name }));
    const on = () => ["enters it", "starts its turn in it", "ends its turn in it"].filter((name) => pressed(triggers, name));
    expect(on()).toEqual(["enters it", "starts its turn in it"]);
    await toggle("enters it");
    expect(on()).toEqual(["starts its turn in it"]);
    await toggle("ends its turn in it");
    expect(on()).toEqual(["starts its turn in it", "ends its turn in it"]);
    await toggle("starts its turn in it");
    expect(on()).toEqual(["ends its turn in it"]);
    await addToSheet();
    const spell = fighter().spells!.at(-1)!;
    expect(spell.action).toMatchObject({ kind: "area-save", area: { type: "circle" }, zone: { trigger: ["end-of-turn-in-zone"] } });
  });

  it("a buff, spell or action, cast before combat", async () => {
    render(<LiveTab />);
    await startFromScratch("Spell");
    await radio("How it works", "Automatic");
    await radio("It", "Grants a benefit");
    let use = await openSection("use");
    await userEvent.click(use.getAllByRole("button", { name: /More options/ }).at(-1)!);
    await userEvent.click(use.getByRole("checkbox", { name: "Cast before combat" }));
    await addToSheet();
    expect(fighter().spells!.at(-1)!.action).toMatchObject({ kind: "buff", prepOnly: true });

    await startFromScratch("Special action");
    await radio("How it works", "Automatic");
    await radio("It", "Grants a benefit");
    use = await openSection("use");
    await userEvent.click(use.getAllByRole("button", { name: /More options/ }).at(-1)!);
    await userEvent.click(use.getByRole("checkbox", { name: "Cast before combat" }));
    await addToSheet();
    expect(allActions().find((action) => action.kind === "buff")).toMatchObject({ prepOnly: true });
  });
});

describe("summons, as the old summon editor's tests had them", { timeout: 30000 }, () => {
  const summons = () => allActions().filter((action): action is Extract<ActionDefinition, { kind: "summon" }> => action.kind === "summon");
  async function pickArcher() {
    await userEvent.type(screen.getByRole("searchbox", { name: "Add a creature to summon" }), "archer");
    await userEvent.click(within(screen.getByRole("group", { name: "Add a creature to summon: found" })).getByRole("button", { name: /^Test Archer/ }));
  }

  it("offers the scene's own creatures, and a limited one seeds its pool on the creature and its tokens", async () => {
    render(<LiveTab />);
    await startFromScratch("Summon");
    await pickArcher();
    await radio("Limit", "Uses");
    await addToSheet();
    const [summon] = summons();
    expect(summon).toMatchObject({ options: [{ definitionId: "def-archer", count: 1 }] });
    const pool = summon!.resourceCost!.resourceId;
    expect(pool).toMatch(/^usage:/);
    expect(fighter().resources?.[pool]).toBe(1);
    expect(store().encounter.combatants.filter((combatant) => combatant.definitionId === "def-fighter").every((combatant) => combatant.resources?.[pool] === 1)).toBe(true);
  });

  it("reopens a summon filled in, and saves an edit in its place", async () => {
    store().insertAbilityRecord("def-fighter", "actions", {
      kind: "summon", id: "", name: "Call Goblins", actionType: "action", range: 30, choice: "pick", chance: 40,
      options: [{ id: "goblin", definitionId: "def-goblin", label: "Goblin", count: { dice: "1d4" } }], automationSupport: "full"
    } as ActionDefinition);
    const id = summons()[0]!.id;
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Call Goblins" }));
    const summon = await openSection("outcome");
    const chance = summon.getByLabelText("Chance it works (%)") as HTMLInputElement;
    expect(chance.value).toBe("40");
    expect((summon.getByLabelText("How many Goblin") as HTMLInputElement).value).toBe("1d4");
    await userEvent.clear(chance);
    await userEvent.type(chance, "75");
    await save();
    expect(summons()).toHaveLength(1);
    expect(summons()[0]).toMatchObject({ id, name: "Call Goblins", chance: 75 });
  });

  it("refuses a summon that would loop back on itself", async () => {
    patchDefinition("def-archer", {
      actions: [{
        kind: "summon", id: "call-fighter", name: "Call Fighter", actionType: "action", range: 30, choice: "pick",
        options: [{ id: "fighter", definitionId: "def-fighter", label: "Fighter", count: 1 }], automationSupport: "full"
      }]
    });
    render(<LiveTab />);
    await startFromScratch("Summon");
    await pickArcher();
    await addToSheet();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/^That summon would loop back on itself: .*Test Archer/));
    expect(summons()).toEqual([]);
  });
});
