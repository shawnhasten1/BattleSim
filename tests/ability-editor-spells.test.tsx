// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { StatsTab } from "@/components/sheet/sheet-tabs/StatsTab";
import { loadSrdMonster } from "@/data/srd/monsters";
import { actionStatblock, spellStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The ability editor for saves, areas and spells (ABILITY_BUILDER_REDESIGN_PLAN.md Phase 3): the worked examples built
 * from a blank ability through the editor, compared with the library's own on the same creature.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { document.body.innerHTML = ""; });

let dragon: CreatureDefinition;
beforeAll(async () => {
  dragon = (await loadSrdMonster("srd:monster:adult-red-dragon"))!;
});

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

async function blank(kind: "Spell" | "Special action") {
  render(<LiveTab />);
  await userEvent.click(screen.getByRole("button", { name: /^Add$/ }));
  await userEvent.click(screen.getByRole("button", { name: "Blank" }));
  await userEvent.click(screen.getByRole("button", { name: kind }));
}
const radio = (group: string, option: string) => userEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
async function retype(label: string, value: string) {
  const box = screen.getByLabelText(label);
  await userEvent.clear(box);
  if (value) await userEvent.type(box, value);
}
const preview = () => screen.getByLabelText("Preview").textContent ?? "";
const addToSheet = () => userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

/** The saved spell's statblock, and the library spell's on the same creature (attached the way the Library tab does). */
function compare(srdId: string) {
  const built = fighter().spells!.at(-1)!;
  const builtText = spellStatblock(built, fighter()).text;
  store().attachSrdSpell("def-fighter", srdId);
  const library = fighter().spells!.at(-1)!;
  const libraryText = spellStatblock(library, fighter()).text;
  store().undo();
  return { built: builtText, library: libraryText };
}

describe("spells built from a blank one", () => {
  it("Fireball: a saving throw over an area, half on a success, upcast by a die", async () => {
    await blank("Spell");
    await retype("Name", "Fireball");
    await radio("How it works", "Saving throw");
    await radio("Reaches", "An area");
    await retype("Point within (ft)", "150");
    await radio("A success", "Half damage");
    await userEvent.selectOptions(screen.getByLabelText("Damage die size"), "6");
    await retype("Damage dice count", "8");
    await userEvent.selectOptions(screen.getByLabelText("Level"), "3");
    await userEvent.click(screen.getByRole("checkbox", { name: "Stronger with a higher slot" }));
    expect((screen.getByLabelText("More damage per slot level") as HTMLInputElement).value).toBe("1d6");
    await addToSheet();

    const { built, library } = compare("srd:spell:fireball");
    expect(built).toBe(library);
    expect(fighter().spells!.at(-1)).toMatchObject({ level: 3, range: 150, resourceCost: { resourceId: "slot-3" }, upcast: { perSlotAboveBase: { damageDice: "1d6" } } });
  });

  it("Hold Person: a WIS save or paralyzed until it saves, a target more per slot", async () => {
    await blank("Spell");
    await retype("Name", "Hold Person");
    await userEvent.selectOptions(screen.getByLabelText("Level"), "2");
    await userEvent.selectOptions(screen.getByLabelText("School"), "enchantment");
    await userEvent.click(screen.getByRole("checkbox", { name: "Needs concentration" }));
    await radio("How it works", "Saving throw");
    await retype("Range (ft)", "60");
    await radio("Saving throw", "WIS");
    await radio("A success", "Avoids it");
    await userEvent.click(screen.getByRole("button", { name: "Remove damage" }));
    await userEvent.click(screen.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Condition/ }));
    const card = screen.getByRole("group", { name: "Condition effect" });
    // After a save the card has no save of its own: the spell's save decides it.
    expect(within(card).queryByRole("checkbox", { name: "A saving throw avoids it" })).toBeNull();
    await userEvent.selectOptions(within(card).getByLabelText("Condition"), "paralyzed");
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Stronger with a higher slot" }));
    await addToSheet();

    const { built, library } = compare("srd:spell:hold-person");
    expect(built).toBe(library);
    expect(fighter().spells!.at(-1)!.upcast).toEqual({ perSlotAboveBase: { targets: 1 } });
  });

  it("Cure Wounds: no roll, heals one creature it touches", async () => {
    await blank("Spell");
    await retype("Name", "Cure Wounds");
    await radio("How it works", "Automatic");
    expect(screen.getByText(/Pick what it does to switch/)).toBeTruthy();
    await radio("It", "Heals");
    // The Healing section the switch brings opens by itself.
    expect(screen.getByRole("button", { name: /^Healing/ }).getAttribute("aria-expanded")).toBe("true");
    await retype("Range (ft)", "5");
    await userEvent.click(screen.getByRole("checkbox", { name: "Stronger with a higher slot" }));
    await addToSheet();

    const { built, library } = compare("srd:spell:cure-wounds");
    expect(built).toBe(library);
    expect(fighter().spells!.at(-1)).toMatchObject({ range: "touch", action: { kind: "healing" } });
  });

  it("Bless: up to three creatures gain +2 to attacks and saves while it concentrates", async () => {
    await blank("Spell");
    await retype("Name", "Bless");
    await userEvent.click(screen.getByRole("checkbox", { name: "Needs concentration" }));
    await radio("How it works", "Automatic");
    await radio("It", "Grants a benefit");
    await radio("Reaches", "Several");
    await retype("Within (ft)", "30");
    await retype("AC bonus", "");
    await retype("Attack roll bonus", "2");
    await retype("Saving throw bonus", "2");
    await addToSheet();

    const { built, library } = compare("srd:spell:bless");
    expect(built).toBe(library);
  });

  it("Misty Step: a bonus-action teleport of itself", async () => {
    await blank("Spell");
    await retype("Name", "Misty Step");
    await userEvent.selectOptions(screen.getByLabelText("Level"), "2");
    await radio("Casting time", "Bonus action");
    await radio("How it works", "Automatic");
    await radio("It", "Teleports");
    await addToSheet();

    const { built, library } = compare("srd:spell:misty-step");
    expect(built).toBe(library);
  });

  it("Magic Missile: three darts that hit automatically, a dart more per slot", async () => {
    await blank("Spell");
    await retype("Name", "Magic Missile");
    await userEvent.click(screen.getByRole("checkbox", { name: "Several attacks (beams)" }));
    await userEvent.click(within(document.querySelector<HTMLElement>('[data-section="roll"]')!).getByRole("button", { name: /More options/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Hits automatically" }));
    await userEvent.selectOptions(screen.getByLabelText("Damage die size"), "4");
    await retype("Damage dice count", "1");
    await retype("Damage flat bonus", "1");
    await userEvent.selectOptions(screen.getByLabelText("Damage type"), "force");
    await userEvent.click(screen.getByRole("checkbox", { name: "Stronger with a higher slot" }));
    await addToSheet();

    const { built, library } = compare("srd:spell:magic-missile");
    expect(built).toBe(library);
    expect(fighter().spells!.at(-1)!.upcast).toEqual({ perSlotAboveBase: { beams: 1 } });
  });

  it("Web: restrained on a failed DEX save, a lingering area of difficult terrain", async () => {
    await blank("Spell");
    await retype("Name", "Web");
    await userEvent.selectOptions(screen.getByLabelText("Level"), "2");
    await userEvent.click(screen.getByRole("checkbox", { name: "Needs concentration" }));
    await radio("How it works", "Saving throw");
    await radio("Reaches", "An area");
    await radio("A success", "Avoids it");
    await userEvent.click(screen.getByRole("button", { name: "Remove damage" }));
    await userEvent.click(screen.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Condition/ }));
    const card = screen.getByRole("group", { name: "Condition effect" });
    await userEvent.selectOptions(within(card).getByLabelText("Condition"), "restrained");
    await userEvent.selectOptions(within(card).getByLabelText("Lasts"), "1-minute");
    // "Until it saves" repeated the save; a minute keeps repeating it.
    expect((within(card).getByRole("checkbox", { name: "It repeats the save" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(card).getByRole("button", { name: "Done" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Leaves a lingering area" }));
    expect(screen.getByRole("radio", { name: "While it concentrates" }).getAttribute("aria-checked")).toBe("true");
    await radio("The ground", "Difficult terrain");
    await addToSheet();

    const { built, library } = compare("srd:spell:web");
    expect(built).toBe(library);
  });
});

describe("a monster's special action built from a blank one", () => {
  it("Fire Breath: a 60-ft cone, DC 21 DEX as printed, half on a success, recharge 5–6", async () => {
    await blank("Special action");
    await retype("Name", "Fire Breath");
    await radio("Reaches", "An area");
    await radio("Shape", "Cone");
    await retype("Length (ft)", "60");
    await radio("Saving throw", "DEX");
    await radio("DC", "As printed");
    await retype("Printed DC", "21");
    await userEvent.selectOptions(screen.getByLabelText("Damage type"), "fire");
    await userEvent.selectOptions(screen.getByLabelText("Damage die size"), "6");
    await retype("Damage dice count", "18");
    await radio("Limit", "Recharge");
    await addToSheet();

    const built = fighter().actions.at(-1)!;
    const printed = dragon.actions.find((action) => action.name === "Fire Breath")!;
    expect(actionStatblock(built, fighter())).toMatchObject({ title: actionStatblock(printed, dragon).title, text: actionStatblock(printed, dragon).text });
    expect(built).toMatchObject({ kind: "area-save", dc: 21, usage: { kind: "recharge", recharge: { min: 5 } } });
  });
});

describe("the editor on existing spells", () => {
  it("opens a library spell with its sections, and has nothing to save until something changes", async () => {
    store().attachSrdSpell("def-fighter", "srd:spell:cloudkill");
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Cloudkill" }));
    const titles = [...document.querySelectorAll("[data-section]")].map((node) => node.getAttribute("data-section"));
    expect(titles).toEqual(["basics", "use", "target", "roll", "damage", "effects", "lingering", "notes"]);
    await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("radio", { name: "Drifts away" }).getAttribute("aria-checked")).toBe("true");
    expect(preview()).toContain("moves 10 feet away from it");
  });

  it("switches a spell attack to a save and back, bringing the attack back as it was", async () => {
    store().attachSrdSpell("def-fighter", "srd:spell:fire-bolt");
    render(<LiveTab />);
    const before = structuredClone(fighter().spells!.at(-1)!);
    await userEvent.click(screen.getByRole("button", { name: "Edit Fire Bolt" }));
    await userEvent.click(screen.getByRole("button", { name: /^Roll/ }));
    await radio("How it works", "Saving throw");
    expect(screen.getByRole("status").textContent).toMatch(/It's a saving throw now/);
    await radio("How it works", "Attack roll");
    await userEvent.click(screen.getByRole("button", { name: "Save" }).closest("div")!.querySelector("button")!); // back, nothing to save
    expect(fighter().spells!.at(-1)).toEqual(before);
  });

  it("follows the caster's spellcasting ability, or overrides it", async () => {
    store().attachSrdSpell("def-fighter", "srd:spell:hold-person");
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Hold Person" }));
    await userEvent.click(screen.getByRole("button", { name: /^Roll/ }));
    const ability = screen.getByLabelText("DC ability") as HTMLSelectElement;
    expect(ability.value).toBe("spellcasting");
    await userEvent.selectOptions(ability, "cha");
    expect(screen.getByText(/not the caster's spellcasting ability/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Follow the spellcasting ability" }));
    expect((screen.getByLabelText("DC ability") as HTMLSelectElement).value).toBe("spellcasting");
  });
});

describe("the Stats tab", () => {
  it("sets the spellcasting ability the spells follow", async () => {
    store().attachSrdSpell("def-fighter", "srd:spell:hold-person");
    function LiveStats() {
      const encounter = useEncounterStore((s) => s.encounter);
      return <StatsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
    }
    render(<LiveStats />);
    const select = screen.getByLabelText("Spellcasting ability") as HTMLSelectElement;
    // Attaching gave the fighter one: its highest of INT, WIS and CHA (all 10, so INT).
    expect(select.value).toBe("int");
    await userEvent.selectOptions(select, "wis");
    expect(fighter().spellcasting).toEqual({ ability: "wis" });
    const hold = fighter().spells!.at(-1)!;
    expect(spellStatblock(hold, fighter()).text).toContain("DC 10 Wisdom");
  });

  it("isn't shown for a creature with no spells", () => {
    function LiveStats() {
      const encounter = useEncounterStore((s) => s.encounter);
      return <StatsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
    }
    render(<LiveStats />);
    expect(screen.queryByLabelText("Spellcasting ability")).toBeNull();
  });
});

describe("an ability the simulator doesn't use yet", () => {
  it("opens as not simulated, and becomes a save with its reference text kept", async () => {
    const gaze: ActionDefinition = {
      kind: "unsupported", id: "", name: "Petrifying Gaze", actionType: "action", automationSupport: "unsupported",
      description: "Each creature within 30 feet that can see its eyes must make a DC 14 Constitution saving throw."
    };
    store().insertAbilityRecord("def-fighter", "actions", gaze);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Petrifying Gaze" }));
    await userEvent.click(screen.getByRole("button", { name: /^Roll/ }));
    expect(screen.getByRole("radio", { name: "Not simulated" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Pick how it works to simulate it/)).toBeTruthy();
    await radio("How it works", "Saving throw");
    expect(screen.getByRole("status").textContent).toMatch(/It's a saving throw now. The simulator uses it/);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = fighter().actions.find((action) => action.name === "Petrifying Gaze")!;
    expect(saved).toMatchObject({ kind: "save", automationSupport: "full", description: gaze.description });
  });
});
