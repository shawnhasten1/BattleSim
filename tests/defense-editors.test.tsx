// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition, DamageAdjustment, FeatureDefinition, FeatureEffect } from "@/engine";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { flattenGroups, groupAdjustments } from "@/components/sheet/stats/DamageAdjustmentGroup";
import { useEncounterStore } from "@/store/encounter-store";
import { startFromScratch } from "./helpers/abilities-tab";

/**
 * The editors for what protects a creature, and what it does to what it grabs: the Stats tab's damage adjustment
 * groups; the ability editor's cards for resistances, saves and staying alive; its grapple and swallow cards; and a
 * weapon's material.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => { document.body.innerHTML = ""; });

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;
const trait = () => (fighter().traits ?? []).find((candidate) => candidate.name === "Defenses")!;

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

const section = (id: string) => document.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
async function openSection(id: string) {
  const head = section(id).querySelector<HTMLButtonElement>(":scope > button")!;
  if (head.getAttribute("aria-expanded") !== "true") await userEvent.click(head);
  return within(section(id));
}
const radio = (scope: ReturnType<typeof within>, group: string, option: string) =>
  userEvent.click(within(scope.getByRole("radiogroup", { name: group })).getByRole("radio", { name: option }));
const chip = (scope: ReturnType<typeof within>, group: string, name: string) =>
  userEvent.click(within(scope.getByRole("group", { name: group })).getByRole("button", { name }));
const pressed = (scope: ReturnType<typeof within>, group: string, name: string) =>
  within(scope.getByRole("group", { name: group })).getByRole("button", { name }).getAttribute("aria-pressed") === "true";
const done = (card: ReturnType<typeof within>) => userEvent.click(card.getByRole("button", { name: "Done" }));
const save = () => userEvent.click(screen.getByRole("button", { name: "Save" }));

/** A trait with these effects on the fighter, opened in the editor on the card named `label`. */
async function openCard(effects: FeatureEffect[], label: string) {
  if (!(fighter().traits ?? []).some((candidate) => candidate.name === "Defenses")) {
    store().insertAbilityRecord("def-fighter", "traits", { id: "", name: "Defenses", category: "trait", effects, automationSupport: "full" } as FeatureDefinition);
    render(<LiveTab />);
  }
  await userEvent.click(screen.getByRole("button", { name: "Edit Defenses" }));
  const effectsSection = await openSection("while-active");
  await userEvent.click(effectsSection.getByRole("button", { name: `Edit ${label.toLowerCase()} effect` }));
  return within(screen.getByRole("group", { name: `${label} effect` }));
}

describe("damage adjustment groups", () => {
  const adjustments: DamageAdjustment[] = [
    { type: "resistance", damageType: "bludgeoning", nonMagicalOnly: true, exceptMaterials: ["silvered"] },
    { type: "resistance", damageType: "piercing", nonMagicalOnly: true, exceptMaterials: ["silvered"] },
    { type: "resistance", damageType: "fire" },
    { type: "absorb", damageType: "lightning" }
  ];

  it("groups by type, non-magical flag and material exceptions, and round-trips", () => {
    const groups = groupAdjustments(adjustments);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ type: "resistance", damageTypes: ["bludgeoning", "piercing"], nonMagicalOnly: true, exceptMaterials: ["silvered"] });
    expect(flattenGroups(groups)).toEqual(adjustments);
  });

  it("drops material exceptions when the group is no longer non-magical-only", () => {
    const [group] = groupAdjustments([adjustments[0]!]);
    expect(flattenGroups([{ ...group!, nonMagicalOnly: undefined }])).toEqual([{ type: "resistance", damageType: "bludgeoning" }]);
  });
});

describe("the effect cards for resistances, saves and staying alive", { timeout: 20000 }, () => {
  it("keeps a material exception on every type when another joins the card", async () => {
    const card = await openCard([{
      kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "slashing", nonMagicalOnly: true, exceptMaterials: ["adamantine"] }
    }], "Resistance");
    await userEvent.click(card.getByRole("button", { name: /More options/ }));
    expect(pressed(card, "Except from weapons that are", "adamantine")).toBe(true);
    await chip(card, "To", "piercing");
    await done(card);
    await save();
    expect(trait().effects).toEqual((["slashing", "piercing"] as const).map((damageType) => ({
      kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType, nonMagicalOnly: true, exceptMaterials: ["adamantine"] }
    })));
  });

  it("absorbs a damage type as well as resisting it", async () => {
    const card = await openCard([{ kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "acid" } }], "Resistance");
    await radio(card, "It has", "Absorbs it");
    await done(card);
    await save();
    expect(trait().effects).toEqual([{ kind: "damage-adjustment", condition: "always", adjustment: { type: "absorb", damageType: "acid" } }]);
  });

  it("scopes advantage on saves to magic, a condition and a save, and back to every save", async () => {
    let card = await openCard([{ kind: "save-advantage" }], "Advantage on its saves");
    await radio(card, "Against", "Spells and magic");
    await userEvent.click(card.getByRole("button", { name: /More options/ }));
    await chip(card, "Only against being", "charmed");
    await chip(card, "Which saves", "WIS");
    await done(card);
    await save();
    expect(trait().effects).toEqual([{ kind: "save-advantage", ability: "wis", against: { source: "magical", conditions: ["charmed"] } }]);

    card = await openCard([], "Advantage on its saves");
    await radio(card, "Against", "Anything");
    await userEvent.click(card.getByRole("button", { name: /More options/ }));
    await chip(card, "Only against being", "charmed");
    await chip(card, "Which saves", "WIS");
    await done(card);
    await save();
    expect(trait().effects).toEqual([{ kind: "save-advantage" }]);
  });

  it("reads back Gnome Cunning: INT, WIS and CHA saves against magic, with nothing to save", async () => {
    const card = await openCard([{ kind: "save-advantage", abilities: ["int", "wis", "cha"], against: { source: "magical" } }], "Advantage on its saves");
    expect(["STR", "DEX", "CON", "INT", "WIS", "CHA"].filter((ability) => pressed(card, "Which saves", ability))).toEqual(["INT", "WIS", "CHA"]);
    expect(within(card.getByRole("radiogroup", { name: "Against" })).getByRole("radio", { name: "Spells and magic" }).getAttribute("aria-checked")).toBe("true");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("regenerates even at 0 hit points, stopped by acid", async () => {
    const card = await openCard([{ kind: "hp-regen", amount: 10 }], "Regenerates");
    await userEvent.click(card.getByRole("checkbox", { name: "Even at 0 hit points" }));
    await chip(card, "Stopped by", "acid");
    await done(card);
    await save();
    expect(trait().effects).toEqual([{ kind: "hp-regen", amount: 10, worksAtZero: true, suppressedByDamageTypes: ["acid"] }]);
  });

  it("is Undead Fortitude with a save, or Relentless Endurance without one", async () => {
    const card = await openCard([{ kind: "survive-lethal", save: { ability: "con", dcBase: 5 } }], "Drops to 1 HP instead of 0");
    await chip(card, "Never against", "radiant");
    await userEvent.click(card.getByRole("checkbox", { name: "Not against a critical hit" }));
    await userEvent.click(card.getByRole("checkbox", { name: "Needs a saving throw" }));
    await userEvent.click(card.getByRole("button", { name: /More options/ }));
    await userEvent.type(card.getByLabelText("Most damage it survives"), "7");
    await done(card);
    await save();
    expect(trait().effects).toEqual([{ kind: "survive-lethal", excludedDamageTypes: ["radiant"], excludeCritical: true, maxDamage: 7 }]);
  });

  it("is Legendary Resistance against spells and magic", async () => {
    const card = await openCard([{ kind: "auto-succeed-save", resourceId: "legendary-resistance" }], "Turns a failed save into a success");
    await radio(card, "On saves against", "Spells and magic");
    await done(card);
    await save();
    expect(trait().effects).toEqual([{ kind: "auto-succeed-save", resourceId: "legendary-resistance", against: { source: "magical" } }]);
  });
});

describe("the grapple and swallow cards", { timeout: 20000 }, () => {
  async function blankAttackWith(card: RegExp, label: string) {
    render(<LiveTab />);
    await startFromScratch("Attack");
    const effects = await openSection("effects");
    await userEvent.click(effects.getByRole("button", { name: "Add effect" }));
    await userEvent.click(screen.getByRole("menuitem", { name: card }));
    return within(screen.getByRole("group", { name: `${label} effect` }));
  }
  const added = () => fighter().actions.find((action) => action.name === "New attack") as Extract<ActionDefinition, { kind: "attack" }>;

  it("grapples at an escape DC, restraining, and holds two at once", async () => {
    const card = await blankAttackWith(/^Grapple/, "Grapple");
    await userEvent.clear(card.getByLabelText("Escape DC"));
    await userEvent.type(card.getByLabelText("Escape DC"), "15");
    await userEvent.click(card.getByRole("checkbox", { name: "Also restrained while grappled" }));
    await userEvent.click(card.getByRole("button", { name: /More options/ }));
    await userEvent.clear(card.getByLabelText("Holds at once"));
    await userEvent.type(card.getByLabelText("Holds at once"), "2");
    await done(card);
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    expect(added().riders).toEqual([expect.objectContaining({ kind: "hold", when: "on-hit", escapeDc: 15, restrained: true, limit: 2 })]);
  });

  it("swallows any creature it hits, and spits it out after 30 damage unless it makes a DC 21 save", async () => {
    const card = await blankAttackWith(/^Swallow/, "Swallow");
    await userEvent.click(card.getByRole("checkbox", { name: "Only a creature it's grappling" }));
    await userEvent.type(card.getByLabelText("Spits it out after damage"), "30");
    const dc = card.getByLabelText("Spit-out save DC");
    expect((dc as HTMLInputElement).value).toBe("15");
    await userEvent.clear(dc);
    await userEvent.type(dc, "21");
    await done(card);
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    const swallow = added().riders?.find((rider) => rider.kind === "swallow");
    expect(swallow).toMatchObject({ kind: "swallow", regurgitate: { damage: 30, dc: 21 } });
    expect((swallow as { requiresHeld?: boolean }).requiresHeld).toBeUndefined();
  });
});

describe("a weapon's material", { timeout: 20000 }, () => {
  it("is silvered or adamantine, and back to ordinary", async () => {
    render(<LiveTab />);
    await startFromScratch("Weapon");
    const damage = await openSection("damage");
    await userEvent.click(damage.getByRole("button", { name: /More options/ }));
    await userEvent.selectOptions(damage.getByLabelText("Material"), "silvered");
    await userEvent.click(screen.getByRole("button", { name: "Add to sheet" }));
    const weapon = () => (fighter().weapons ?? []).find((candidate) => candidate.name === "New weapon")!;
    expect(weapon().material).toBe("silvered");

    await userEvent.click(screen.getByRole("button", { name: "Edit New weapon" }));
    const again = await openSection("damage");
    await userEvent.click(again.getByRole("button", { name: /More options/ }));
    await userEvent.selectOptions(again.getByLabelText("Material"), "");
    await save();
    expect(weapon().material).toBeUndefined();
  });
});
