// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getExecutableActions, type CreatureDefinition } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { loadSrdMonster } from "@/data/srd/monsters";
import { abilityRefs, findAbility } from "@/lib/ability-editor/refs";
import { statblockFor } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";
import { startFromScratch, useRecipe } from "./helpers/abilities-tab";

/**
 * Phase 7's done-when: an Adult Red Dragon built entirely from scratch. Its stats are set as the Stats tab would; every
 * ability (traits, actions, multiattack, legendary actions) is built in the ability editor from Start from scratch or a
 * recipe, and each reads in its statblock exactly as the SRD dragon's does.
 */

const pristine = useEncounterStore.getState();
let srd: CreatureDefinition;
beforeAll(async () => { srd = (await loadSrdMonster("srd:monster:adult-red-dragon"))!; });
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
  // A blank creature with the dragon's numbers: what the Stats tab sets.
  const encounter = useEncounterStore.getState().encounter;
  const blank = (definition: CreatureDefinition): CreatureDefinition => ({
    ...definition, name: "Red Dragon", size: srd.size, type: srd.type, armorClass: srd.armorClass, maxHp: srd.maxHp, speed: srd.speed, movement: srd.movement,
    abilities: srd.abilities, saves: srd.saves, proficiencyBonus: srd.proficiencyBonus, damageAdjustments: srd.damageAdjustments,
    actions: [], bonusActions: [], reactions: [], weapons: [], spells: [], features: [], traits: [], resources: {}
  });
  useEncounterStore.setState({ encounter: { ...encounter, definitions: encounter.definitions.map((d) => (d.id === "def-fighter" ? blank(d) : d)) } });
});
afterEach(() => { document.body.innerHTML = ""; });

const built = () => useEncounterStore.getState().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

const radio = (group: string, option: string) => userEvent.click(within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
async function retype(label: string, value: string) {
  const box = screen.getByLabelText(label);
  await userEvent.clear(box);
  if (value) await userEvent.type(box, value);
}
const addToSheet = () => userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

/** A melee attack: its reach, a printed to-hit of +14, and damage lines of [count, die, type] adding STR to the first. */
async function attack(name: string, reach: number, lines: Array<[string, string, string]>) {
  await startFromScratch("Attack");
  await retype("Name", name);
  await retype("Reach (ft)", String(reach));
  await radio("To hit", "As printed");
  await retype("Printed to-hit bonus", "14");
  for (const [index, [count, die, type]] of lines.entries()) {
    const label = index === 0 ? "Damage" : `Damage ${index + 1}`;
    if (index > 0) await userEvent.click(screen.getByRole("button", { name: "Add a line" }));
    await userEvent.selectOptions(screen.getByLabelText(`${label} die size`), die);
    await retype(`${label} dice count`, count);
    await userEvent.selectOptions(screen.getByLabelText(`${label} type`), type);
    // Only the first line adds STR.
    if (index > 0) await userEvent.selectOptions(screen.getByLabelText(`${label} adds`), "none");
  }
  await addToSheet();
}

/** A saving throw over an area around itself: its size, who it affects, the save and its printed DC. */
async function areaAroundItself(radius: string, affects: "Everyone in it" | "Only its enemies", ability: string, dc: string) {
  await radio("Reaches", "An area");
  await radio("Shape", "Sphere");
  await radio("Starts", "Around itself");
  await retype("Radius (ft)", radius);
  await radio("Affects", affects);
  await radio("Saving throw", ability);
  await radio("DC", "As printed");
  await retype("Printed DC", dc);
  await radio("A success", "Avoids it");
}

async function buildTheDragon() {
  render(<LiveTab />);
  await useRecipe("Legendary Resistance");
  await addToSheet();

  await attack("Bite", 10, [["2", "10", "piercing"], ["2", "6", "fire"]]);
  await attack("Claw", 5, [["2", "6", "slashing"]]);
  await attack("Tail", 15, [["2", "8", "bludgeoning"]]);

  await startFromScratch("Special action");
  await retype("Name", "Frightful Presence");
  await areaAroundItself("120", "Only its enemies", "WIS", "19");
  await userEvent.click(screen.getByRole("button", { name: "Remove damage" }));
  await userEvent.click(within(document.querySelector<HTMLElement>("[data-section=\"roll\"]")!).getByRole("button", { name: /More options/ }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Immune after a successful save" }));
  // A condition on a failed save starts as frightened until it saves at the end of its turn.
  await userEvent.click(within(document.querySelector<HTMLElement>("[data-section=\"effects\"]")!).getByRole("button", { name: "Add effect" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /^Condition/ }));
  await userEvent.click(within(screen.getByRole("group", { name: "Condition effect" })).getByRole("button", { name: "Done" }));
  await addToSheet();

  await startFromScratch("Special action");
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

  // "The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws."
  await startFromScratch("Multiattack");
  await userEvent.selectOptions(screen.getByLabelText("Routine step 1 uses"), "Frightful Presence");
  await retype("Routine step 1 count", "1");
  await userEvent.click(screen.getByRole("button", { name: "Add a step" }));
  await userEvent.selectOptions(screen.getByLabelText("Routine step 2 uses"), "Bite");
  await retype("Routine step 2 count", "1");
  await userEvent.click(screen.getByRole("button", { name: "Add a step" }));
  await userEvent.selectOptions(screen.getByLabelText("Routine step 3 uses"), "Claw");
  await retype("Routine step 3 count", "2");
  await addToSheet();

  // Legendary actions: reference text, one of its attacks, and an ability of its own.
  await startFromScratch("Legendary action");
  await retype("Name", "Detect");
  await radio("It", "Reference only");
  await retype("Reference text", "The dragon makes a Wisdom (Perception) check.");
  await addToSheet();

  await startFromScratch("Legendary action");
  await retype("Name", "Tail Attack");
  await userEvent.selectOptions(screen.getByLabelText("Uses"), "Tail");
  await retype("Reference text", "The dragon makes a tail attack.");
  await addToSheet();

  await startFromScratch("Legendary action");
  await retype("Name", "Wing Attack");
  await radio("Costs", "2 actions");
  await radio("It", "Has its own ability");
  await radio("How it works", "Saving throw");
  await areaAroundItself("10", "Everyone in it", "DEX", "22");
  // It starts as a copy of the bite: two damage lines, the first adding STR.
  await userEvent.selectOptions(screen.getByLabelText("Damage 1 die size"), "6");
  await retype("Damage 1 dice count", "2");
  await userEvent.selectOptions(screen.getByLabelText("Damage 1 type"), "bludgeoning");
  await userEvent.click(screen.getByRole("button", { name: "Remove damage 2" }));
  await userEvent.click(within(document.querySelector<HTMLElement>("[data-section=\"effects\"]")!).getByRole("button", { name: "Add effect" }));
  await userEvent.click(screen.getByRole("menuitem", { name: /^Condition/ }));
  const prone = screen.getByRole("group", { name: "Condition effect" });
  await userEvent.selectOptions(within(prone).getByLabelText("Condition"), "prone");
  await userEvent.selectOptions(within(prone).getByLabelText("Lasts"), "next-turn");
  await userEvent.click(within(prone).getByRole("button", { name: "Done" }));
  await addToSheet();
}

describe("an Adult Red Dragon built from scratch", { timeout: 120000 }, () => {
  it("reads like the SRD dragon, ability by ability", async () => {
    await buildTheDragon();
    const dragon = built();
    const named = (definition: CreatureDefinition) => new Map(abilityRefs(definition).map((ref) => {
      const entry = statblockFor(definition, ref)!;
      return [(findAbility(definition, ref) as { name: string }).name, { title: entry.title, text: entry.text, support: entry.support }];
    }));
    const ours = named(dragon);
    const theirs = named(srd);
    expect([...ours.keys()].sort()).toEqual([...theirs.keys()].sort());
    for (const [name, entry] of theirs) expect(ours.get(name), name).toEqual(entry);
    expect(dragon.legendary!.pool).toBe(3);
  });

  it("fights like it: its legendary actions are ones the engine takes between turns", async () => {
    await buildTheDragon();
    const legendary = getExecutableActions(built()).filter((action) => action.id.endsWith(":legendary")).map((action) => `${action.name} ${action.kind} ${"resourceCost" in action ? action.resourceCost?.amount : ""}`);
    expect(legendary.sort()).toEqual(["Tail Attack attack 1", "Wing Attack area-save 2"]);
    expect(built().resources).toMatchObject({ "legendary-resistance": 3 });
  });
});
