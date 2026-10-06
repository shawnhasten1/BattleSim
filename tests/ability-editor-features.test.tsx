// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getExecutableActions, type ActionDefinition, type CreatureDefinition, type FeatureDefinition } from "@/engine";
import { SRD_FEATURES, findSrdFeature } from "@/data/srd";
import { loadSrdMonster } from "@/data/srd/monsters";
import { ActorSheet } from "@/components/sheet/ActorSheet";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import type { Compendium } from "@/hooks/useCompendium";
import { activationOf } from "@/lib/ability-editor/features";
import { featureStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";
import { startFromScratch } from "./helpers/abilities-tab";
import { blankCharacter, quickBuild, rebuildActor } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/** Phase 4's done-when: features and traits built from a blank one in the editor, matching the library and the SRD. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { document.body.innerHTML = ""; });

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const allFeatures = () => [...(fighter().features ?? []), ...(fighter().traits ?? [])];
const named = (name: string) => allFeatures().find((feature) => feature.name === name)!;

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

async function blankFeature(name: string) {
  render(<LiveTab />);
  await startFromScratch("Trait or feature");
  const box = screen.getByLabelText("Name") as HTMLInputElement;
  await userEvent.clear(box);
  await userEvent.type(box, name);
}
const inSection = (id: string) => within(document.querySelector<HTMLElement>(`[data-section="${id}"]`)!);
const radio = (scope: ReturnType<typeof within>, group: string, option: string) =>
  userEvent.click(within(scope.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
const chip = (scope: ReturnType<typeof within>, group: string, name: string) =>
  userEvent.click(within(scope.getByRole("group", { name: group })).getByRole("button", { name }));
async function addEffect(menuItem: RegExp, cardLabel: string) {
  await userEvent.click(inSection("while-active").getByRole("button", { name: "Add effect" }));
  await userEvent.click(screen.getByRole("menuitem", { name: menuItem }));
  return within(screen.getByRole("group", { name: `${cardLabel} effect` }));
}
async function retype(box: HTMLElement, value: string) {
  await userEvent.clear(box);
  await userEvent.type(box, value);
}
const done = (card: ReturnType<typeof within>) => userEvent.click(card.getByRole("button", { name: "Done" }));
const addToSheet = () => userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));

describe("traits built from a blank one", { timeout: 20000 }, () => {
  it("Pack Tactics: advantage when an ally is next to the target", async () => {
    await blankFeature("Pack Tactics");
    await radio(inSection("basics"), "Listed as", "Trait");
    const card = await addEffect(/^Advantage on its attacks/, "Advantage on its attacks");
    await chip(card, "When", "an ally is next to the target");
    await done(card);
    await addToSheet();
    expect(named("Pack Tactics")).toMatchObject({ category: "trait", effects: findSrdFeature("srd:feature:pack-tactics")!.effects });
    expect((fighter().traits ?? []).some((trait) => trait.name === "Pack Tactics")).toBe(true);
  });

  it("Superior Critical: a critical hit on 18 to 20 with melee and ranged attacks", async () => {
    await blankFeature("Superior Critical");
    const card = await addEffect(/^Critical hits on a lower roll/, "Critical hits on a lower roll");
    await retype(card.getByLabelText("Lowest critical roll"), "18");
    await chip(card, "Attacks", "melee");
    await chip(card, "Attacks", "ranged");
    await done(card);
    await addToSheet();
    expect(named("Superior Critical").effects).toEqual([{ kind: "critical-range", condition: "always", minimum: 18, attackTypes: ["melee", "ranged"] }]);
    expect(featureStatblock(named("Superior Critical"), fighter()).text).toContain("score a critical hit on a roll of 18–20");
  });

  it("Initiative: advantage, a bonus, or both", async () => {
    await blankFeature("Quick Start");
    const card = await addEffect(/^Initiative/, "Initiative");
    // Advantage to start with; a bonus ticked on starts at the proficiency bonus.
    expect((card.getByRole("checkbox", { name: "Advantage on Initiative rolls" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(card.getByRole("checkbox", { name: "A bonus to them" }));
    await userEvent.click(card.getByRole("checkbox", { name: "Advantage on Initiative rolls" }));
    await done(card);
    await addToSheet();
    expect(named("Quick Start").effects).toEqual([{ kind: "initiative", bonus: { proficiency: true } }]);
    expect(featureStatblock(named("Quick Start"), fighter()).text).toMatch(/^It gains a \+\d bonus to Initiative rolls\.$/);
  });

  it("Change a failed roll: each roll, each change, and its limits", async () => {
    await blankFeature("Lucky Break");
    const card = await addEffect(/^Change a failed roll/, "Change a failed roll");
    // A failed save and a reroll to start with; a missed attack too, and "Hit instead" appears.
    expect(within(card.getByRole("radiogroup", { name: "It can" })).queryByRole("radio", { name: "Hit instead" })).toBeNull();
    await chip(card, "Rolls it changes", "a missed attack");
    await radio(card, "It can", "Add a die");
    await retype(card.getByLabelText("Die it adds"), "1d8");
    await userEvent.click(card.getByRole("checkbox", { name: "Only on a natural 1" }));
    await userEvent.click(card.getByRole("checkbox", { name: "Once until the start of its next turn" }));
    await done(card);
    await addToSheet();
    expect(named("Lucky Break").effects).toEqual([{ kind: "d20-change", rolls: ["save", "attack"], change: "add", dice: "1d8", onNatural1: true, oncePerTurn: true }]);
  });

  it("Change a failed roll: a reroll with a bonus, or a hit, spending a pool", async () => {
    await blankFeature("Second Try");
    const card = await addEffect(/^Change a failed roll/, "Change a failed roll");
    await userEvent.click(card.getByRole("checkbox", { name: "Adding a bonus to the new roll" }));
    expect(card.getAllByLabelText(/^Bonus to the new roll/).length).toBeGreaterThan(0);
    await userEvent.click(card.getByRole("checkbox", { name: "Adding a bonus to the new roll" }));
    await chip(card, "Rolls it changes", "a missed attack");
    await radio(card, "It can", "Hit instead");
    // No attack, no hit: back to a reroll.
    await chip(card, "Rolls it changes", "a missed attack");
    expect(within(card.getByRole("radiogroup", { name: "It can" })).getByRole("radio", { name: "Reroll" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(card.getByRole("checkbox", { name: "Spends a use" }));
    expect(card.getByLabelText(/name/i)).toBeTruthy();
    await userEvent.click(card.getByRole("checkbox", { name: "Spends a use" }));
    await done(card);
    await addToSheet();
    expect(named("Second Try").effects).toEqual([{ kind: "d20-change", rolls: ["save"], change: "reroll" }]);
  });

  it("An ability on spell damage: the ability, and which spells", async () => {
    await blankFeature("Searing Focus");
    const card = await addEffect(/^An ability on spell damage/, "An ability on spell damage");
    await userEvent.selectOptions(card.getByLabelText("Ability it adds"), "cha");
    await userEvent.click(card.getByRole("checkbox", { name: "Cantrips only" }));
    await chip(card, "Spells of the school", "evocation");
    await chip(card, "Spells cast as a class", "sorcerer");
    await chip(card, "Only spells dealing", "fire");
    await done(card);
    await addToSheet();
    expect(named("Searing Focus").effects).toEqual([{ kind: "spell-damage-ability", ability: "cha", spellSchools: ["evocation"], spellClasses: ["sorcerer"], damageTypes: ["fire"] }]);
    expect(featureStatblock(named("Searing Focus"), fighter()).text).toBe("It adds its Charisma modifier to one damage roll of its Sorcerer evocation spells that deal fire damage.");
  });

  it("Half damage when a spell misses, and a longer spell range", async () => {
    await blankFeature("Reach and Bite");
    const half = await addEffect(/^Half damage when a spell misses/, "Half damage when a spell misses");
    await chip(half, "Spells cast as a class", "wizard");
    await done(half);
    const range = await addEffect(/^Longer spell range/, "Longer spell range");
    await retype(range.getByLabelText("Feet farther"), "60");
    await retype(range.getByLabelText("Shortest range it lengthens"), "30");
    await userEvent.click(range.getByRole("checkbox", { name: "Cantrips only" }));
    await done(range);
    await addToSheet();
    expect(named("Reach and Bite").effects).toEqual([
      { kind: "spell-half-on-miss", cantripsOnly: true, spellClasses: ["wizard"] },
      { kind: "spell-range", bonus: 60, minRange: 30 }
    ]);
  });

  it("A move with something else: when, how far, and opportunity attacks", async () => {
    await blankFeature("Quick Feet");
    const card = await addEffect(/^A move with something else/, "A move with something else");
    await userEvent.click(card.getByRole("checkbox", { name: "Half its speed" }));
    await retype(card.getByLabelText("Feet it moves"), "15");
    await userEvent.click(card.getByRole("checkbox", { name: "Without provoking opportunity attacks" }));
    await radio(card, "It moves when it", "Spends a use of a pool");
    // The creature has Second Wind's pool to pick.
    const pool = card.getAllByRole("combobox").find((box) => within(box).queryByRole("option", { name: /second wind/i }));
    expect(pool).toBeDefined();
    await userEvent.selectOptions(pool!, within(pool!).getByRole("option", { name: /second wind/i }));
    await done(card);
    await addToSheet();
    expect(named("Quick Feet").effects).toEqual([{ kind: "free-move", on: { spends: "second-wind" }, feet: 15, noOpportunityAttacks: true }]);
  });

  it("An upgrade on a hit: what it adds, a move after it, paid in dice of a damage bonus, once a turn", async () => {
    await blankFeature("Low Cut");
    const card = await addEffect(/^An upgrade it can add to a hit/, "An upgrade it can add to a hit");
    await retype(card.getByLabelText("Its name"), "Low Cut");
    await chip(card, "After hits with", "melee");
    await userEvent.click(card.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Push/ }));
    await userEvent.click(card.getAllByRole("button", { name: "Done" })[0]!);
    await userEvent.click(card.getByRole("checkbox", { name: "A move after the hit" }));
    await retype(card.getByLabelText("Up to (ft)"), "10");
    await userEvent.click(card.getByRole("checkbox", { name: /^Paid in dice of a damage bonus/ }));
    await retype(card.getByLabelText("Dice it gives up"), "2");
    // Paid in dice: no use to spend, no bonus action.
    expect(card.queryByRole("checkbox", { name: "Spends a use" })).toBeNull();
    await userEvent.click(card.getByRole("checkbox", { name: "Once per turn" }));
    await done(card);
    await addToSheet();
    expect(named("Low Cut").effects).toMatchObject([{
      kind: "on-hit-option",
      option: {
        name: "Low Cut", attackTypes: ["melee"], riders: [{ kind: "push", when: "on-hit" }],
        move: { noOpportunityAttacks: true, feet: 10 }, tradesDice: { featureId: "", dice: 2 }, oncePerTurn: true
      }
    }]);
  });

  it("An upgrade paid with the roll's advantage, on Strength attacks only (Brutal Strike)", async () => {
    await blankFeature("Wild Swing");
    const card = await addEffect(/^An upgrade it can add to a hit/, "An upgrade it can add to a hit");
    await chip(card, "Only attacks using", "STR");
    await userEvent.click(card.getByRole("checkbox", { name: /^Paid with the roll's advantage/ }));
    expect(card.getByLabelText("Only while it has")).toBeTruthy();
    await userEvent.click(card.getByRole("checkbox", { name: "Once per turn" }));
    await done(card);
    await addToSheet();
    const effect = named("Wild Swing").effects?.[0];
    expect(effect).toMatchObject({ kind: "on-hit-option", option: { abilities: ["str"], oncePerTurn: true } });
    expect(effect?.kind === "on-hit-option" && effect.option.forgoesAdvantage).toBeTruthy();
  });

  it("An attack back when hit: melee or ranged, how near, and only when it hurts (Retaliation)", async () => {
    await blankFeature("Riposte");
    const card = await addEffect(/^An attack back when hit/, "An attack back when hit");
    await chip(card, "It attacks back with", "ranged");
    await retype(card.getByLabelText("Attacker within (ft)"), "10");
    await userEvent.click(card.getByRole("checkbox", { name: "Only when the hit damages it" }));
    await userEvent.click(card.getByRole("checkbox", { name: "Melee hits only" }));
    await done(card);
    await addToSheet();
    expect(named("Riposte").effects).toEqual([{ kind: "reaction-attack", trigger: { kind: "hit-by-attack", withinFt: 10, meleeOnly: true }, attackTypes: ["melee", "ranged"] }]);
    // Its swings are on the sheet as reactions.
    expect(getExecutableActions(fighter()).some((action) => action.actionType === "reaction" && action.name.endsWith("(Riposte)"))).toBe(true);
  });

  it("A Metamagic option: which, and what it spends", async () => {
    await blankFeature("Quick Casting");
    const card = await addEffect(/^A Metamagic option/, "A Metamagic option");
    await userEvent.selectOptions(card.getByLabelText("Metamagic option"), "heightened");
    await done(card);
    await addToSheet();
    expect(named("Quick Casting").effects).toEqual([{ kind: "metamagic", option: "heightened", resourceCost: { resourceId: "sorcery-points", amount: 2 } }]);
  });

  it("Allies spared by its area spells: how many, and which spells", async () => {
    await blankFeature("Careful Weave");
    const card = await addEffect(/^Allies spared by its area spells/, "Allies spared by its area spells");
    await retype(card.getByLabelText("Allies it spares"), "2");
    await userEvent.click(card.getByRole("checkbox", { name: "plus the spell's level" }));
    await done(card);
    await addToSheet();
    expect(named("Careful Weave").effects).toEqual([{ kind: "spare-allies", base: 2, spellSchools: ["evocation"] }]);
  });

  it("A spell slot kept on a lucky roll: how high, and the die", async () => {
    await blankFeature("Lucky Slots");
    const card = await addEffect(/^A spell slot kept on a lucky roll/, "A spell slot kept on a lucky roll");
    await retype(card.getByLabelText("Highest slot level"), "3");
    await retype(card.getByLabelText("Die size"), "6");
    await done(card);
    await addToSheet();
    expect(named("Lucky Slots").effects).toEqual([{ kind: "slot-recall", maxLevel: 3, die: 6 }]);
  });

  it("Ends a condition on itself each turn: which, and when (Self-Restoration)", async () => {
    await blankFeature("Clear Mind");
    const card = await addEffect(/^Ends a condition on itself each turn/, "Ends a condition on itself each turn");
    await chip(card, "Ends one of", "poisoned");
    await radio(card, "At the", "Start of its turn");
    await done(card);
    await addToSheet();
    expect(named("Clear Mind").effects).toEqual([{ kind: "shed-conditions", conditions: ["charmed", "frightened"], timing: "turn-start" }]);
  });

  it("Another attack at a creature beside the target: how near (Horde Breaker)", async () => {
    await blankFeature("Sweep");
    const card = await addEffect(/^Another attack at a creature beside the target/, "Another attack at a creature beside the target");
    await retype(card.getByLabelText("Of the target (ft)"), "10");
    await done(card);
    await addToSheet();
    expect(named("Sweep").effects).toEqual([{ kind: "follow-up-attack", withinFt: 10 }]);
  });

  it("Change a failed roll: an ally's too, for its reaction, against some conditions, with advantage (Countercharm)", async () => {
    await blankFeature("Steady Song");
    const card = await addEffect(/^Change a failed roll/, "Change a failed roll");
    await userEvent.click(card.getByRole("checkbox", { name: "The new roll has advantage" }));
    await userEvent.click(card.getByRole("checkbox", { name: "An ally's roll too" }));
    await retype(card.getByLabelText("Ally within (ft)"), "20");
    await userEvent.click(card.getByRole("checkbox", { name: "Takes its reaction" }));
    await chip(card, "Only saves against", "frightened");
    await done(card);
    await addToSheet();
    expect(named("Steady Song").effects).toEqual([{
      kind: "d20-change", rolls: ["save"], change: "reroll", advantage: true, forOthers: { withinFt: 20, includeSelf: true }, reaction: true, againstConditions: ["frightened"]
    }]);
  });

  it("Spells at their maximum damage: up to which slot, and which spells (Overchannel)", async () => {
    await blankFeature("Overload");
    const card = await addEffect(/^Spells at their maximum damage/, "Spells at their maximum damage");
    await retype(card.getByLabelText("Highest slot level"), "3");
    await chip(card, "Spells cast as a class", "wizard");
    await chip(card, "Spells cast as a class", "sorcerer");
    await done(card);
    await addToSheet();
    expect(named("Overload").effects).toEqual([{ kind: "max-damage", maxSlot: 3, resourceCost: { resourceId: "overchannel", amount: 1 }, spellClasses: ["sorcerer"] }]);
  });

  it("Damage that ignores resistance: which types (Boon of Irresistible Offense)", async () => {
    await blankFeature("Sunder");
    const card = await addEffect(/^Damage that ignores resistance/, "Damage that ignores resistance");
    await chip(card, "Its damage ignores resistance to", "piercing");
    await chip(card, "Its damage ignores resistance to", "fire");
    await done(card);
    await addToSheet();
    expect(named("Sunder").effects).toEqual([{ kind: "ignore-resistance", damageTypes: ["bludgeoning", "slashing", "fire"] }]);
  });

  it("Temporary hit points when a spell deals damage: how many, how far, which spells (Improved Blessed Strikes)", async () => {
    await blankFeature("Warding Flame");
    const card = await addEffect(/^Temporary hit points when a spell deals damage/, "Temporary hit points when a spell deals damage");
    await radio(card, "Temporary hit points is", "A number");
    await retype(card.getByLabelText("Temporary hit points"), "5");
    await retype(card.getByLabelText("Reach of the gift (ft)"), "30");
    await userEvent.click(card.getByRole("checkbox", { name: "Cantrips only" }));
    await done(card);
    await addToSheet();
    expect(named("Warding Flame").effects).toEqual([{ kind: "damage-vitality", tempHp: { base: 5 }, withinFt: 30, spellClasses: ["cleric"] }]);
  });

  it("An activation that keeps going on its own: how long (Persistent Rage)", async () => {
    await blankFeature("Unending");
    const card = await addEffect(/^An activation that keeps going on its own/, "An activation that keeps going on its own");
    expect((card.getByLabelText("Which activation") as HTMLSelectElement).value).toBe("rage-active");
    await retype(card.getByLabelText("Rounds it lasts"), "50");
    await done(card);
    await addToSheet();
    expect(named("Unending").effects).toEqual([{ kind: "condition-persists", conditionId: "rage-active", durationRounds: 50 }]);
  });

  it("Extra damage on a 20: nothing to set (Overwhelming Strike)", async () => {
    await blankFeature("Crushing Blow");
    const card = await addEffect(/^Extra damage on a 20/, "Extra damage on a 20");
    expect(card.getByText(/Nothing to set/)).toBeTruthy();
    await done(card);
    await addToSheet();
    expect(named("Crushing Blow").effects).toEqual([{ kind: "natural-twenty-damage" }]);
  });

  it("Change a failed roll: a die off a foe's hit instead, for its reaction (Cutting Words)", async () => {
    await blankFeature("Jeer");
    const card = await addEffect(/^Change a failed roll/, "Change a failed roll");
    await radio(card, "It can", "Take a die off a foe's roll");
    await chip(card, "Rolls it changes", "a foe's hit");
    await chip(card, "Rolls it changes", "a foe's made save");
    await retype(card.getByLabelText("Die it takes off"), "1d8");
    await retype(card.getByLabelText("Foe within (ft)"), "30");
    await userEvent.click(card.getByRole("checkbox", { name: "Takes its reaction" }));
    await done(card);
    await addToSheet();
    expect(named("Jeer").effects).toEqual([{ kind: "d20-change", rolls: ["attack"], change: "subtract", dice: "1d8", againstFoes: { withinFt: 30 }, reaction: true }]);
  });

  it("Disadvantage on some attacks against it: which (Defensive Tactics)", async () => {
    await blankFeature("Wary");
    const card = await addEffect(/^Disadvantage on some attacks against it/, "Disadvantage on some attacks against it");
    await radio(card, "Attacks at disadvantage", "Further attacks by one that hit it, this turn");
    await done(card);
    await addToSheet();
    expect(named("Wary").effects).toEqual([{ kind: "attack-defense", against: "after-hit" }]);
  });

  it("Another mastery for an attack: which (Tactical Master)", async () => {
    await blankFeature("Adaptable");
    const card = await addEffect(/^Another mastery for an attack/, "Another mastery for an attack");
    await chip(card, "Masteries it can use instead", "slow");
    await chip(card, "Masteries it can use instead", "topple");
    await done(card);
    await addToSheet();
    expect(named("Adaptable").effects).toEqual([{ kind: "mastery-swap", masteries: ["push", "sap", "topple"] }]);
  });

  it("Two on-hit options on one hit: which damage bonus pays (Improved Cunning Strike)", async () => {
    await blankFeature("Double Feint");
    const card = await addEffect(/^Two on-hit options on one hit/, "Two on-hit options on one hit");
    const select = card.getByLabelText("Damage bonus it pays in") as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toContain("(pick one)");
    await done(card);
    await addToSheet();
    expect(named("Double Feint").effects).toEqual([{ kind: "paired-on-hit-options", featureId: "" }]);
  });

  it("Rage's no-spells card on the sheet (7ae)", async () => {
    const barbarian = rebuildActor(blankCharacter("def-b", "PC"), quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:barbarian", level: 5 }), SRD_BUILD_SOURCES).definition;
    const rage = barbarian.features!.find((feature) => feature.name === "Rage")!;
    store().insertAbilityRecord("def-fighter", "features", structuredClone(rage));
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Rage" }));
    const head = document.querySelector<HTMLElement>('[data-section="while-active"] > button')!;
    if (head.getAttribute("aria-expanded") !== "true") await userEvent.click(head);
    // A read-only card: it can be removed, not edited.
    expect(inSection("while-active").getByRole("button", { name: "Remove no spells effect" })).toBeTruthy();
    expect(inSection("while-active").getByText("It can't cast spells or concentrate on them.")).toBeTruthy();
  });

  it("Bigger healing: each of its three parts", async () => {
    await blankFeature("Life's Gift");
    const card = await addEffect(/^Bigger healing/, "Bigger healing");
    await userEvent.click(card.getByRole("checkbox", { name: /^Slot-cast healing spells/ }));
    await userEvent.click(card.getByRole("checkbox", { name: "Healing someone else with a slot heals it too" }));
    await userEvent.click(card.getByRole("checkbox", { name: /^Healing dice of spells/ }));
    await done(card);
    await addToSheet();
    expect(named("Life's Gift").effects).toEqual([{ kind: "healing-bonus", selfOnOthers: true, maximize: true }]);
  });

  it("Better damage dice: a minimum die, a second roll, and weapons that are two-handed or finesse", async () => {
    await blankFeature("Heavy Hands");
    const card = await addEffect(/^Better damage dice/, "Better damage dice");
    await retype(card.getByLabelText("Lowest a damage die counts"), "2");
    await userEvent.click(card.getByRole("checkbox", { name: "Roll the weapon's damage dice twice, keep the higher" }));
    await userEvent.click(card.getByRole("checkbox", { name: "Once per turn" }));
    await userEvent.click(card.getByRole("button", { name: /^More options/ }));
    await chip(card, "Only weapons that are", "finesse");
    await userEvent.click(card.getByRole("checkbox", { name: "Only a weapon held in two hands" }));
    await done(card);
    await addToSheet();
    expect(named("Heavy Hands").effects).toEqual([{ kind: "damage-dice", condition: "always", minimumDie: 2, rollTwice: true, oncePerTurn: true, weaponProperties: ["finesse"], twoHanded: true }]);
  });

  it("Last-ditch defenses: no advantage against it, a save floor, better death saves, bloodied regeneration", async () => {
    await blankFeature("Stubborn");
    await done(await addEffect(/^No advantage against it/, "No advantage against it"));
    const floor = await addEffect(/^A save no lower than the score/, "A save no lower than the score");
    await userEvent.selectOptions(floor.getByLabelText("Which save"), "con");
    await done(floor);
    const death = await addEffect(/^Better death saves/, "Better death saves");
    await retype(death.getByLabelText("Counts as a 20 from"), "18");
    await userEvent.click(death.getByRole("checkbox", { name: "Advantage on death saves" }));
    await done(death);
    const regen = await addEffect(/^Regenerates/, "Regenerates");
    await userEvent.click(regen.getByRole("checkbox", { name: "Only while it's bloodied" }));
    await done(regen);
    const mind = await addEffect(/^Advantage on its saves/, "Advantage on its saves");
    await userEvent.click(mind.getByRole("checkbox", { name: "Only saves to keep concentration" }));
    await done(mind);
    await addToSheet();
    const effects = named("Stubborn").effects!;
    expect(effects.slice(0, 3)).toEqual([{ kind: "no-advantage-against" }, { kind: "save-floor", ability: "con" }, { kind: "death-saves", twentyFrom: 18 }]);
    expect(effects[3]).toMatchObject({ kind: "hp-regen", whileBloodied: true });
    expect(effects[4]).toMatchObject({ kind: "save-advantage", against: { concentration: true } });
  });

  it("A condition on its misses that sets up the next attack (Studied Attacks)", async () => {
    await blankFeature("Studied");
    const card = await addEffect(/^A condition on its hits/, "A condition on its hits");
    await userEvent.click(card.getByRole("checkbox", { name: "On a miss instead of a hit" }));
    await radio(card, "The next attack roll", "Its next against the target: advantage");
    await done(card);
    await addToSheet();
    expect(named("Studied").effects?.[0]).toMatchObject({ kind: "apply-condition-on-hit", onMiss: true, appliedCondition: { nextAttack: { role: "against", mode: "advantage" } } });
  });

  it("Immune to a condition, and temporary hit points on a kill", async () => {
    await blankFeature("Fearless Reaper");
    const immune = await addEffect(/^Immune to a condition/, "Immune to a condition");
    await chip(immune, "Immune to", "charmed");
    await done(immune);
    const kill = await addEffect(/^Temporary hit points on a kill/, "Temporary hit points on a kill");
    await userEvent.click(kill.getByRole("checkbox", { name: "Also when one drops near it" }));
    await retype(kill.getByLabelText("Within (ft)"), "15");
    await done(kill);
    await addToSheet();
    expect(named("Fearless Reaper").effects).toEqual([
      { kind: "condition-immunity", conditions: ["frightened", "charmed"] },
      { kind: "on-kill", tempHp: { base: 1 }, nearbyFt: 15 }
    ]);
  });

  it("Magic Resistance: advantage on saves against spells and other magic", async () => {
    await blankFeature("Magic Resistance");
    const card = await addEffect(/^Advantage on its saves/, "Advantage on its saves");
    await radio(card, "Against", "Spells and magic");
    await done(card);
    await addToSheet();
    expect(named("Magic Resistance").effects).toEqual([{ kind: "save-advantage", against: { source: "magical" } }]);
  });

  it("Regeneration: 10 hit points a turn, stopped by acid or fire", async () => {
    await blankFeature("Regeneration");
    const card = await addEffect(/^Regenerates/, "Regenerates");
    await chip(card, "Stopped by", "acid");
    await chip(card, "Stopped by", "fire");
    await done(card);
    await addToSheet();
    expect(named("Regeneration").effects).toEqual([{ kind: "hp-regen", amount: 10, suppressedByDamageTypes: ["acid", "fire"] }]);
  });

  it("Stench: creatures starting a turn within 10 ft make a DC 14 CON save or are poisoned", async () => {
    const hezrou = (await loadSrdMonster("srd:monster:hezrou"))!;
    await blankFeature("Stench");
    await userEvent.click(inSection("aura").getByLabelText("Affects creatures nearby each round"));
    await retype(inSection("aura").getByLabelText("Aura save DC"), "14");
    await addToSheet();
    const stench = [...(hezrou.traits ?? []), ...(hezrou.features ?? [])].find((trait) => trait.name === "Stench")!;
    expect(named("Stench").emanation).toEqual(stench.emanation);
  });

  it("Fire Aura: 3d6 fire to everything within 5 ft each turn, and to what hits it in melee", async () => {
    const balor = (await loadSrdMonster("srd:monster:balor"))!;
    await blankFeature("Fire Aura");
    const aura = inSection("aura");
    await userEvent.click(aura.getByLabelText("Affects creatures nearby each round"));
    await radio(aura, "When", "It starts its own turn");
    await retype(aura.getByLabelText("Aura reach (ft)"), "5");
    await userEvent.click(aura.getByLabelText("A saving throw avoids it"));
    await userEvent.selectOptions(aura.getByLabelText("Condition"), "");
    await userEvent.click(aura.getByRole("button", { name: "Add aura damage" }));
    await retype(aura.getByLabelText("Aura damage dice count"), "3");
    const card = await addEffect(/^Hurts what hits it in melee/, "Hurts what hits it in melee");
    await retype(card.getByLabelText("Damage to the attacker dice count"), "3");
    await userEvent.selectOptions(card.getByLabelText("Damage to the attacker die size"), "6");
    await done(card);
    await addToSheet();

    const fire = [...(balor.traits ?? []), ...(balor.features ?? [])].find((trait) => trait.name === "Fire Aura")!;
    const built = named("Fire Aura");
    expect(built.emanation).toMatchObject({ ...fire.emanation, damage: [{ dice: "3d6", damageType: "fire" }] });
    expect(built.emanation?.save).toBeUndefined();
    expect(built.emanation?.condition).toBeUndefined();
    expect(built.effects).toMatchObject(fire.effects!);
    expect(featureStatblock(built, fighter()).text).toBe(featureStatblock(fire, fighter()).text);
  });
});

describe("features built from a blank one", { timeout: 30000 }, () => {
  it("the Zealot's Rage with Divine Fury: switched on with a bonus action, from a pool of rages", async () => {
    await blankFeature("Rage (Zealot)");
    const use = inSection("use");
    await radio(use, "It works", "When switched on");
    expect(within(use.getByRole("radiogroup", { name: "Takes" })).getByRole("radio", { name: "Bonus action" }).getAttribute("aria-checked")).toBe("true");
    await radio(use, "Limit", "Pool");
    await userEvent.selectOptions(use.getByLabelText("Spends from"), "__new");
    await userEvent.type(use.getByLabelText("New pool name"), "rage");
    await userEvent.click(use.getByRole("button", { name: "Create pool" }));
    expect((use.getByLabelText("Lasts") as HTMLSelectElement).value).toBe("10");

    // +2 on Strength melee hits.
    let card = await addEffect(/^Extra damage on its hits/, "Extra damage on its hits");
    await userEvent.click(card.getByRole("button", { name: "More for extra damage" }));
    await radio(card, "Extra damage written as", "Flat");
    await retype(card.getByLabelText("Extra damage amount"), "2");
    await chip(card, "Attacks", "melee");
    await chip(card, "Using", "STR");
    await done(card);

    // Divine Fury: once a turn, 1d6 + 2 radiant or necrotic.
    card = await addEffect(/^Extra damage on its hits/, "Extra damage on its hits");
    await retype(card.getByLabelText("Extra damage flat bonus"), "2");
    await userEvent.selectOptions(card.getByLabelText("Extra damage type"), "radiant");
    await userEvent.click(card.getByRole("button", { name: "More for extra damage" }));
    await userEvent.click(card.getByLabelText("Choose the type each time"));
    await chip(card, "Extra damage type choices", "lightning");
    await chip(card, "Extra damage type choices", "necrotic");
    await userEvent.click(card.getByLabelText("Once per turn"));
    await chip(card, "Attacks", "melee");
    await chip(card, "Attacks", "ranged");
    await done(card);

    card = await addEffect(/^Resistance, immunity or vulnerability/, "Resistance");
    for (const type of ["bludgeoning", "piercing", "slashing", "fire"]) await chip(card, "To", type);
    await done(card);

    card = await addEffect(/^Advantage on its saves/, "Advantage on its saves");
    await chip(card, "Which saves", "STR");
    await done(card);
    await addToSheet();

    const built = named("Rage (Zealot)");
    const zealot = findSrdFeature("srd:feature:rage-zealot")!;
    expect(activationOf(built)).toMatchObject({ actionType: "bonus", resourceCost: { resourceId: "rage", amount: 1 }, condition: { durationRounds: 10 } });
    expect(fighter().resources?.rage).toBe(3);
    // It reads exactly as the library's does.
    expect(featureStatblock(built, fighter()).text).toBe(featureStatblock(zealot, fighter()).text);
    expect(activationOf(built)!.condition!.effects).toMatchObject(activationOf(zealot)!.condition!.effects!.map((effect) => ({ ...effect })));
  });

  it("Pounce: a bonus-action bite after a charge, added through Grants", async () => {
    await blankFeature("Pounce");
    const card = await addEffect(/^A condition on its hits/, "A condition on its hits");
    await chip(card, "When", "it charged the target");
    await chip(card, "Attacks", "melee");
    await done(card);
    await userEvent.click(inSection("grants").getByRole("button", { name: "Add an ability it grants" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^An attack after a charge/ }));
    // The follow-up opens nested, copied from the fighter's longsword.
    expect(screen.getByRole("button", { name: "Back to Pounce" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Longsword (Pounce)");
    expect(within(screen.getByRole("radiogroup", { name: "Only after" })).getByRole("radio", { name: "A charge hits" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await addToSheet();

    const pounce = named("Pounce");
    expect(pounce.effects).toEqual([{
      kind: "apply-condition-on-hit", condition: "charged", attackTypes: ["melee"], appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 }
    }]);
    expect(pounce.grantedActions?.[0]).toMatchObject({ kind: "attack", name: "Longsword (Pounce)", actionType: "bonus", onlyAfter: "charge-hit", requiresTargetCondition: "prone" });
  });

  it("a Second Wind of its own: a heal it grants, from a pool, made with a new pool", async () => {
    // The fighter already has Second Wind (and its pool): this one is built beside it.
    await blankFeature("Catch Breath");
    await userEvent.click(inSection("grants").getByRole("button", { name: "Add an ability it grants" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^A heal/ }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Catch Breath");
    await radio(inSection("use"), "Limit", "Pool");
    await userEvent.selectOptions(inSection("use").getByLabelText("Spends from"), "__new");
    await userEvent.type(inSection("use").getByLabelText("New pool name"), "breath");
    await retype(inSection("use").getByLabelText("New pool size"), "2");
    await userEvent.click(inSection("use").getByRole("button", { name: "Create pool" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(inSection("use").getByText("What it grants is used like any other ability: see Grants.")).toBeTruthy();
    await addToSheet();

    const breath = named("Catch Breath");
    expect(breath.grantedActions?.[0]).toMatchObject({ kind: "healing", name: "Catch Breath", actionType: "bonus", targeting: { target: "self" }, resourceCost: { resourceId: "breath", amount: 1 } });
    // A pool made inside the granted ability is saved with the feature.
    expect(fighter().resources?.breath).toBe(2);
  });
});

describe("activations of their own, buffs, and the sheet around a nested editor", { timeout: 20000 }, () => {
  it("edits a Parry: a reaction on itself, its AC bonus a card", async () => {
    store().insertAbilityRecord("def-fighter", "reactions", {
      kind: "activate-feature", id: "", name: "Parry", actionType: "reaction", featureId: "parry",
      reaction: { trigger: { kind: "targeted-by-attack", meleeOnly: true }, target: "self", priority: "always" },
      condition: { id: "parry-active", name: "custom", durationRounds: 1, modifiers: { armorClass: 2 } }, automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Parry" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    expect(inSection("use").queryByRole("radiogroup", { name: "It acts on" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^While active/ }));
    expect(inSection("while-active").getByText("It gains a +2 bonus to AC.")).toBeTruthy();
    await userEvent.click(inSection("while-active").getByRole("button", { name: "Edit ac bonus effect" }));
    await retype(inSection("while-active").getByLabelText("AC bonus"), "3");
    await done(inSection("while-active"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const parry = (fighter().reactions ?? []).find((action) => action.name === "Parry")!;
    expect(parry).toMatchObject({ kind: "activate-feature", condition: { id: "parry-active", durationRounds: 1, modifiers: { armorClass: 3 } }, reaction: { priority: "always" } });
  });

  it("a Parry saved before waits for an attack that would hit it, for that attack only; how long it lasts can change", async () => {
    // Inserted as an old save had it (before the roll); the store brings it up to date.
    store().insertAbilityRecord("def-fighter", "reactions", {
      kind: "activate-feature", id: "", name: "Parry", actionType: "reaction", featureId: "parry",
      reaction: { trigger: { kind: "targeted-by-attack", meleeOnly: true }, target: "self", priority: "always" },
      condition: { id: "parry-active", name: "custom", durationRounds: 1, modifiers: { armorClass: 2 } }, automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Parry" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    const use = inSection("use");
    expect((use.getByRole("combobox", { name: "When" }) as HTMLSelectElement).value).toBe("would-be-hit");
    expect((use.getByRole("checkbox", { name: "Melee attacks only" }) as HTMLInputElement).checked).toBe(true);
    expect(within(use.getByRole("radiogroup", { name: "What it gives lasts" })).getByRole("radio", { name: "For that attack" }).getAttribute("aria-checked")).toBe("true");
    expect(use.getByText(/Offered only when the AC it gives makes the attack miss/)).toBeTruthy();
    await radio(use, "What it gives lasts", "Until its next turn");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const parry = (fighter().reactions ?? []).find((action) => action.name === "Parry")!;
    expect(parry).toMatchObject({ reaction: { trigger: { kind: "would-be-hit", meleeOnly: true }, lastsFor: "until-start-of-next-turn" } });
  });

  it("a reaction to damage about to land: each part of the trigger, and what it does to the damage", async () => {
    store().insertAbilityRecord("def-fighter", "reactions", {
      kind: "activate-feature", id: "", name: "Brace", actionType: "reaction", featureId: "brace",
      reaction: { trigger: { kind: "targeted-by-attack" }, target: "self", priority: "worthwhile" }, automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Brace" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    const use = inSection("use");
    await userEvent.selectOptions(use.getByRole("combobox", { name: "When" }), "would-take-damage");
    // Halving it to start with.
    expect(within(use.getByRole("radiogroup", { name: "What it does to the damage" })).getByRole("radio", { name: "Halves it" }).getAttribute("aria-checked")).toBe("true");
    expect(use.getByText(/Offered once the damage is rolled/)).toBeTruthy();
    await userEvent.click(use.getByRole("checkbox", { name: "From an attack roll only" }));
    await chip(use, "Only damage of these types", "fire");
    await radio(use, "What it does to the damage", "Takes off a roll");
    await retype(use.getByLabelText("Dice it takes off"), "1d12");
    await userEvent.selectOptions(use.getByLabelText("Ability it adds"), "con");
    await retype(use.getByLabelText("Flat amount it adds"), "2");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((fighter().reactions ?? []).find((action) => action.name === "Brace")).toMatchObject({
      reaction: { trigger: { kind: "would-take-damage", attackOnly: true, damageTypes: ["fire"] } },
      damageCut: { kind: "reduce", dice: "1d12", abilityModifier: "con", bonus: 2 }
    });

    // Resisting instead; then another trigger, and it cuts nothing.
    await userEvent.click(screen.getByRole("button", { name: "Edit Brace" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    await radio(inSection("use"), "What it does to the damage", "Resists its type this turn");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((fighter().reactions ?? []).find((action) => action.name === "Brace")).toMatchObject({ damageCut: { kind: "resist" } });
    await userEvent.click(screen.getByRole("button", { name: "Edit Brace" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    await userEvent.selectOptions(inSection("use").getByRole("combobox", { name: "When" }), "hit-by-attack");
    expect(inSection("use").queryByRole("radiogroup", { name: "What it does to the damage" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((fighter().reactions ?? []).find((action) => action.name === "Brace")).not.toHaveProperty("damageCut");
  });

  it("a damage cut that redirects what it stops (Deflect Attacks): the save, the damage, how far", async () => {
    store().insertAbilityRecord("def-fighter", "reactions", {
      kind: "activate-feature", id: "", name: "Turn Aside", actionType: "reaction", featureId: "turn-aside",
      reaction: { trigger: { kind: "would-take-damage", attackOnly: true }, target: "self", priority: "worthwhile" },
      damageCut: {
        kind: "reduce", dice: "1d10",
        redirect: { resourceCost: { resourceId: "second-wind", amount: 1 }, damage: [{ dice: "2d6", damageType: "same-as-attack" }], save: { ability: "dex", dcFormula: { base: 8, ability: "wis", proficiency: true } }, meleeFt: 5, rangedFt: 60 }
      },
      automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Turn Aside" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    const use = inSection("use");
    expect((use.getByRole("checkbox", { name: /^When that takes it to 0, it can redirect it/ }) as HTMLInputElement).checked).toBe(true);
    await retype(use.getByLabelText("Damage it sends back"), "3d6");
    await userEvent.selectOptions(use.getByLabelText("Ability it adds to the damage"), "dex");
    await userEvent.selectOptions(use.getByLabelText("Save against it"), "con");
    await userEvent.selectOptions(use.getByLabelText("The save DC's ability"), "dex");
    await retype(use.getByLabelText("After a ranged attack (ft)"), "30");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((fighter().reactions ?? []).find((action) => action.name === "Turn Aside")).toMatchObject({
      damageCut: {
        kind: "reduce",
        redirect: {
          resourceCost: { resourceId: "second-wind" }, damage: [{ dice: "3d6", abilityModifier: "dex", damageType: "same-as-attack" }],
          save: { ability: "con", dcFormula: { base: 8, ability: "dex", proficiency: true } }, meleeFt: 5, rangedFt: 30
        }
      }
    });
    // Switched off, it's gone.
    await userEvent.click(screen.getByRole("button", { name: "Edit Turn Aside" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    await userEvent.click(inSection("use").getByRole("checkbox", { name: /^When that takes it to 0, it can redirect it/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const turned = (fighter().reactions ?? []).find((action) => action.name === "Turn Aside");
    expect(turned?.kind === "activate-feature" && turned.damageCut).not.toHaveProperty("redirect");
  });

  it("an activation that turns one resource into another, only with none of a third left", async () => {
    store().insertAbilityRecord("def-fighter", "bonusActions", {
      kind: "activate-feature", id: "", name: "Second Breath", actionType: "bonus", featureId: "second-breath",
      resourceCost: { resourceId: "second-wind", amount: 1 }, automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Second Breath" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    const use = inSection("use");
    await userEvent.click(use.getByRole("checkbox", { name: /^Gives a resource back/ }));
    // The new control's pool list, waiting on "A new pool…".
    const gains = use.getAllByRole("combobox").find((box) => (box as HTMLSelectElement).value === "__new");
    await userEvent.selectOptions(gains!, within(gains!).getByRole("option", { name: /second wind/i }));
    await userEvent.click(use.getByRole("checkbox", { name: "As many as the spent slot's level" }));
    await retype(use.getByLabelText("Never more than"), "3");
    await userEvent.click(use.getByRole("checkbox", { name: /^Only with none of a resource left/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((fighter().bonusActions ?? []).find((action) => action.name === "Second Breath")).toMatchObject({
      gains: { resourceId: "second-wind", amount: "slot-level", max: 3 }, onlyWhenEmpty: ""
    });
  });

  it("a counter by the 2024 rules: the caster's save, no check above the slot", async () => {
    store().insertAbilityRecord("def-fighter", "reactions", {
      kind: "activate-feature", id: "", name: "Hush", actionType: "reaction", featureId: "hush",
      reaction: { trigger: { kind: "enemy-casts-spell", withinFt: 60, checkAbove: { dcBase: 10 } }, priority: "worthwhile" },
      resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Hush" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    const use = inSection("use");
    await userEvent.click(use.getByRole("checkbox", { name: /The caster makes a Constitution save/ }));
    expect(use.queryByRole("checkbox", { name: /Above its slot's level/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((fighter().reactions ?? []).find((action) => action.name === "Hush")).toMatchObject({ reaction: { trigger: { casterSave: "con" } } });
  });

  it("an activation only before it moves, giving its next attack advantage (Steady Aim)", async () => {
    store().insertAbilityRecord("def-fighter", "bonusActions", {
      kind: "activate-feature", id: "", name: "Take Aim", actionType: "bonus", featureId: "take-aim",
      condition: { id: "take-aim-active", name: "custom", durationRounds: 1 }, automationSupport: "full"
    } as ActionDefinition);
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Take Aim" }));
    await userEvent.click(screen.getByRole("button", { name: /^Use & cost/ }));
    await userEvent.click(inSection("use").getByRole("checkbox", { name: "Only before it moves on its turn" }));
    await userEvent.click(inSection("use").getByRole("checkbox", { name: "Its next attack roll has advantage (used up by it)" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((fighter().bonusActions ?? []).find((action) => action.name === "Take Aim")).toMatchObject({
      stillOnly: true, condition: { nextAttack: { role: "made", mode: "advantage" } }
    });
  });

  it("gives a buff's other effects as cards: advantage on attacks while it lasts", async () => {
    render(<LiveTab />);
    await startFromScratch("Spell");
    await retype(screen.getByLabelText("Name"), "Battle Focus");
    await radio(inSection("roll"), "How it works", "Automatic");
    await radio(inSection("roll"), "It", "Grants a benefit");
    await userEvent.click(inSection("outcome").getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Advantage on its attacks/ }));
    const card = within(screen.getByRole("group", { name: "Advantage on its attacks effect" }));
    await chip(card, "Attacks", "melee");
    await done(card);
    expect(screen.getByLabelText("Preview").textContent).toMatch(/advantage on melee attack rolls/);
    await addToSheet();
    const spell = fighter().spells!.find((candidate) => candidate.name === "Battle Focus")!;
    expect(spell.action).toMatchObject({ kind: "buff", appliedCondition: { effects: [{ kind: "attack-advantage", condition: "always", attackTypes: ["melee"] }] } });
  });

  it("keeps a granted ability's edits when the sheet saves on a tab switch", async () => {
    // The fighter has Second Wind: a feature that grants a bonus-action heal.
    const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
    render(<ActorSheet compendium={compendium} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    // Second Wind grants a bonus-action heal, so it's listed with the bonus actions.
    const features = screen.getByRole("region", { name: "Bonus actions" });
    await userEvent.click(within(features).getByRole("button", { name: "Edit Second Wind" }));
    await userEvent.click(screen.getByRole("button", { name: /^Grants/ }));
    await userEvent.click(inSection("grants").getByRole("button", { name: "Edit Second Wind" }));
    await retype(screen.getByLabelText("Name"), "Second Breath");
    await userEvent.click(screen.getByRole("tab", { name: "Stats" }));
    const prompt = screen.getByRole("alertdialog", { name: "Unsaved changes" });
    await userEvent.click(within(prompt).getByRole("button", { name: "Save" }));
    expect(screen.getByRole("tab", { name: "Stats" }).getAttribute("aria-selected")).toBe("true");
    expect(named("Second Wind").grantedActions?.map((action) => action.name)).toEqual(["Second Breath"]);
  });
});

describe("the library's features in the editor", { timeout: 60000 }, () => {
  let attached: FeatureDefinition[] = [];
  beforeAll(() => {
    attached = [...SRD_FEATURES];
  });

  it("opens all 19 with every section and card shown, changing nothing", async () => {
    expect(attached).toHaveLength(19);
    for (const feature of attached) store().attachSrdFeature("def-fighter", feature.id);
    render(<LiveTab />);
    for (const feature of attached) {
      const name = feature.name;
      await userEvent.click(screen.getAllByRole("button", { name: `Edit ${name}` })[0]!);
      await userEvent.click(screen.getByRole("button", { name: "Expand all" }));
      for (const edit of screen.queryAllByRole("button", { name: /^Edit .* effect$/ })) {
        await userEvent.click(edit);
        await userEvent.click(screen.getByRole("button", { name: "Done" }));
      }
      expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled, name).toBe(true);
      await userEvent.click(screen.getByRole("button", { name: "Back to abilities" }));
    }
  });
});
