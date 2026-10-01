// @vitest-environment happy-dom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { StatsTab } from "@/components/sheet/sheet-tabs/StatsTab";
import { useEncounterStore } from "@/store/encounter-store";
import { group, rowMenu, startFromScratch } from "./helpers/abilities-tab";

/** Phase 7 in the Abilities tab: legendary, lair and death abilities, summons, shapechanges, a focus, and the JSON view. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { document.body.innerHTML = ""; });

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

function patchFighter(patch: Partial<CreatureDefinition>) {
  const encounter = store().encounter;
  useEncounterStore.setState({ encounter: { ...encounter, definitions: encounter.definitions.map((d) => (d.id === "def-fighter" ? { ...d, ...patch } : d)) } });
}

const radio = (group: string, name: string) => userEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name }));
const checked = (group: string) => screen.getByRole("radiogroup", { name: group }).querySelector("[aria-checked=true]")?.textContent;
const sectionIds = () => [...document.querySelectorAll<HTMLElement>("[data-section]")].map((section) => section.dataset.section);
const addToSheet = () => userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

describe("a legendary action, from scratch", { timeout: 30000 }, () => {
  it("uses one of its abilities, or has its own, at a cost, with how many a round", async () => {
    render(<LiveTab />);
    await startFromScratch("Legendary action");
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Longsword Attack");
    expect(checked("It")).toBe("Uses one of its abilities");
    expect((screen.getByLabelText("Uses") as HTMLSelectElement).value).toBe("longsword");
    expect(sectionIds()).toEqual(["use", "does", "notes"]);

    // Its own ability: a copy of the longsword attack, with the attack's sections.
    await radio("It", "Has its own ability");
    expect(sectionIds()).toEqual(["use", "does", "target", "roll", "damage", "effects", "notes"]);
    await radio("It", "Reference only");
    expect(sectionIds()).toEqual(["use", "does", "notes"]);
    await radio("It", "Uses one of its abilities");
    expect((screen.getByLabelText("Uses") as HTMLSelectElement).value).toBe("longsword");

    await radio("Costs", "2 actions");
    const pool = screen.getByLabelText("Legendary actions a round");
    await userEvent.clear(pool);
    await userEvent.type(pool, "2");
    // The summary follows the field, before it's saved.
    expect(screen.getByRole("button", { name: /^Use & cost/ }).textContent).toContain("costs 2 legendary actions · 2 a round");
    await addToSheet();
    expect(fighter().legendary).toEqual({ pool: 2, actions: [{ name: "Longsword Attack", cost: 2, description: "", actionId: "longsword" }] });
    expect(group("Legendary actions").getByRole("button", { name: "Edit Longsword Attack" })).toBeTruthy();
  });

  it("asks before deleting an ability a legendary action uses, which then becomes reference text", async () => {
    patchFighter({ legendary: { pool: 3, actions: [{ name: "Swipe", cost: 1, description: "It swings.", actionId: "longsword" }] } });
    render(<LiveTab />);
    await rowMenu("Longsword", "Delete");
    const prompt = screen.getByRole("alertdialog", { name: "Delete Longsword?" });
    expect(prompt.textContent).toContain("Swipe, a legendary action, uses Longsword. Without it, Swipe will be reference only.");
    await userEvent.click(within(prompt).getByRole("button", { name: "Delete Longsword" }));
    expect(fighter().legendary!.actions).toEqual([{ name: "Swipe", cost: 1, description: "It swings." }]);
  });

  it("edits how many it takes a round from the pools", async () => {
    patchFighter({ legendary: { pool: 3, actions: [{ name: "Swipe", cost: 1, description: "", actionId: "longsword" }] } });
    render(<LiveTab />);
    await userEvent.click(within(screen.getByRole("group", { name: "Pools" })).getByRole("button", { name: "Legendary actions: 3 a round" }));
    const full = within(screen.getByRole("group", { name: "Pool sizes" })).getByLabelText("Legendary actions full");
    await userEvent.clear(full);
    await userEvent.type(full, "1");
    expect(fighter().legendary!.pool).toBe(1);
  });
});

describe("on death and lair actions, from scratch", { timeout: 30000 }, () => {
  it("makes a death burst around the creature: a sphere or a cube, no cost, no lingering area", async () => {
    render(<LiveTab />);
    await startFromScratch("On death");
    expect(sectionIds()).toEqual(["target", "roll", "damage", "effects", "notes"]);
    expect(within(screen.getByRole("radiogroup", { name: "Shape" })).getAllByRole("radio").map((option) => option.textContent)).toEqual(["Sphere", "Cube"]);
    expect(screen.queryByRole("radiogroup", { name: "Starts" })).toBeNull();
    await radio("Shape", "Cube");
    await addToSheet();
    expect(fighter().deathEffects![0]).toMatchObject({ name: "Death Burst", action: { kind: "area-save", area: { type: "square" }, targeting: { origin: "self" } } });
    expect(group("On death").getByRole("button", { name: "Edit Death Burst" })).toBeTruthy();
  });

  it("says when a lair action happens, and offers only an attack or a save", async () => {
    render(<LiveTab />);
    await startFromScratch("Lair action");
    expect(screen.getByText(/On initiative 20 each round, while a token of it is in its lair/)).toBeTruthy();
    expect(within(screen.getByRole("radiogroup", { name: "How it works" })).getAllByRole("radio").map((option) => option.textContent)).toEqual(["Attack roll", "Saving throw"]);
    await addToSheet();
    expect(fighter().lairActions).toHaveLength(1);
  });
});

describe("summons, shapechanges and standard actions", { timeout: 30000 }, () => {
  it("won't add a summon with nothing to summon; picks a library creature, how many and the chance, and brings it into the scene", async () => {
    render(<LiveTab />);
    await startFromScratch("Summon");
    await addToSheet();
    expect(screen.getByRole("alert").textContent).toBe("Pick a creature for it to summon first.");
    await userEvent.type(screen.getByRole("searchbox", { name: "Add a creature to summon" }), "dire wolf");
    await userEvent.click(within(screen.getByRole("group", { name: "Add a creature to summon: found" })).getByRole("button", { name: /^Dire Wolf/ }));
    const count = screen.getByLabelText("How many Dire Wolf");
    await userEvent.clear(count);
    await userEvent.type(count, "1d4");
    await userEvent.type(screen.getByLabelText("Chance it works (%)"), "50");
    // It can need concentration, like a spell's summon.
    const use = document.querySelector<HTMLElement>("[data-section=\"use\"]")!;
    const mores = within(use).getAllByRole("button", { name: /More options/ });
    await userEvent.click(mores[mores.length - 1]!);
    await userEvent.click(screen.getByRole("checkbox", { name: "Needs concentration" }));
    // The library's dire wolf is fetched while it's picked, and embedded with the summon.
    await waitFor(async () => {
      await addToSheet();
      expect(fighter().actions.some((action) => action.kind === "summon")).toBe(true);
    }, { timeout: 5000 });
    expect(fighter().actions.find((action) => action.kind === "summon")).toMatchObject({
      options: [{ definitionId: "srd:monster:dire-wolf", label: "Dire Wolf", count: { dice: "1d4" } }], chance: 50, concentration: true
    });
    expect(store().encounter.definitions.some((definition) => definition.id === "srd:monster:dire-wolf")).toBe(true);
  });

  it("changes shape into a picked creature, which gets the shapechange too", async () => {
    render(<LiveTab />);
    await startFromScratch("Shapechange");
    await userEvent.type(screen.getByRole("searchbox", { name: "Add a form to change into" }), "brown bear");
    await userEvent.click(within(screen.getByRole("group", { name: "Add a form to change into: found" })).getByRole("button", { name: /^Brown Bear/ }));
    const label = screen.getByLabelText("Name of the Brown Bear form");
    await userEvent.clear(label);
    await userEvent.type(label, "Bear");
    await waitFor(async () => {
      await addToSheet();
      expect(fighter().actions.some((action) => action.kind === "transform")).toBe(true);
    }, { timeout: 5000 });
    const shift = fighter().actions.find((action) => action.kind === "transform")!;
    expect(shift).toMatchObject({ forms: [{ label: "Bear", definitionId: "srd:monster:brown-bear" }], canRevert: true, revertOnDeath: true });
    const bear = store().encounter.definitions.find((definition) => definition.id === "srd:monster:brown-bear")!;
    expect(bear.actions.find((action) => action.id === shift.id)).toEqual(shift);
  });

  it("turns an attack into a standard action, taken as an action or a bonus action", async () => {
    render(<LiveTab />);
    await startFromScratch("Attack");
    await radio("How it works", "Automatic");
    await radio("It", "Takes a standard action");
    await radio("Takes the", "Disengage");
    expect(within(screen.getByRole("radiogroup", { name: "Takes" })).getAllByRole("radio").map((option) => option.textContent)).toEqual(["Action", "Bonus action"]);
    await radio("Takes", "Bonus action");
    await addToSheet();
    expect(fighter().bonusActions?.find((action) => action.kind === "utility")).toMatchObject({ mode: "disengage", actionType: "bonus", automationSupport: "full" });
  });
});

describe("a focus", { timeout: 30000 }, () => {
  it("is a weapon with no attack of its own: charges, what it does while carried, and what it grants", async () => {
    render(<LiveTab />);
    await startFromScratch("Weapon");
    await radio("It's", "A focus or wand");
    expect(sectionIds()).toEqual(["basics", "use", "while-active", "grants", "notes"]);
    expect(screen.queryByText("Attacks with it as")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "It has charges" }));
    await addToSheet();
    expect(fighter().weapons![0]).toMatchObject({ attackType: "focus", charges: { max: 1 } });
  });
});

describe("the JSON view", { timeout: 30000 }, () => {
  it("checks an edit, shows what changes, and applies it to the editor for Save", async () => {
    render(<LiveTab />);
    await userEvent.click(group("Actions").getByRole("button", { name: "Edit Longsword" }));
    await userEvent.click(screen.getByRole("button", { name: /^Notes & AI/ }));
    await userEvent.click(screen.getByRole("button", { name: "Edit as JSON" }));
    const box = screen.getByLabelText("The record as JSON") as HTMLTextAreaElement;
    const longsword = JSON.parse(box.value) as ActionDefinition;

    // Not JSON: where it stops.
    await userEvent.clear(box);
    await userEvent.type(box, "{{ \"name\": }}");
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("alert", { name: "Problems" }).textContent).toMatch(/^Line 1, column \d+: /);

    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    // userEvent.type reads braces as keys: set the text directly.
    await userEvent.clear(box);
    await userEvent.click(box);
    await userEvent.paste(JSON.stringify({ ...longsword, name: "Arming Sword" }, null, 2));
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByLabelText("What changes").textContent).toContain("+   \"name\": \"Arming Sword\",");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Arming Sword");
    expect(fighter().actions.find((action) => action.id === "longsword")!.name).toBe("Longsword");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fighter().actions.find((action) => action.id === "longsword")!.name).toBe("Arming Sword");
  });
});

describe("the Stats tab's saving throws", () => {
  it("sets a save's whole bonus as printed, and clears it back to the ability's modifier", async () => {
    function LiveStats() {
      const encounter = useEncounterStore((s) => s.encounter);
      return <StatsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
    }
    render(<LiveStats />);
    const dex = screen.getByLabelText("DEX save") as HTMLInputElement;
    expect(dex.placeholder).toBe("+1");
    await userEvent.type(dex, "6");
    expect(fighter().saves).toMatchObject({ dex: 6 });
    await userEvent.clear(dex);
    expect(fighter().saves?.dex).toBeUndefined();
  });
});
