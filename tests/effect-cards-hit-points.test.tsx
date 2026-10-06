// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { actualMaxHp, getExecutableActions, type CreatureDefinition, type FeatureEffect } from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { FeatureEffectCards } from "@/components/sheet/ability-editor/FeatureEffectCards";
import { useEncounterStore } from "@/store/encounter-store";
import { pickEffect } from "./helpers/abilities-tab";

/** EFFECTS_PLAN.md, Phase 2: building Tough by hand (D5), the hit point card, and Aid before the fight. */

afterEach(() => cleanup());

const barbarian: CreatureDefinition = {
  id: "c", name: "C", size: "medium", armorClass: 12, maxHp: 65, speed: 30,
  abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 }, actions: [],
  character: { level: 6, classes: [{ id: "barbarian", name: "Barbarian", level: 6 }] }
};

let latest: FeatureEffect[] = [];
function Cards({ definition = barbarian, effects = [] }: { definition?: CreatureDefinition; effects?: FeatureEffect[] }) {
  const [list, setList] = useState(effects);
  latest = list;
  return (
    <div data-section="while-active">
      <FeatureEffectCards
        groups={[{ id: "g", place: "always", effects: list, onChange: setList }]}
        definition={definition} newPools={{ pools: {}, add: () => undefined }} owner="feature" emptyText="Nothing."
      />
    </div>
  );
}
const section = () => within(document.querySelector<HTMLElement>('[data-section="while-active"]')!);
const card = () => within(screen.getByRole("group", { name: "Hit point maximum effect" }));

describe("the hit point card", () => {
  it("builds Tough from the example the search for “tough” finds", async () => {
    render(<Cards />);
    await pickEffect(section(), "tough", "+2 for each level, like the Tough feat");
    expect(latest).toEqual([{ kind: "hit-point-maximum", bonus: { perLevel: 2 } }]);
    expect((card().getByLabelText("Counted") as HTMLSelectElement).value).toBe("level");
    expect(card().getByText("That's +12 hit points now.")).toBeTruthy();
    expect(card().getByText("Its hit point maximum increases by 12 (2 for each of its levels).")).toBeTruthy();
  });

  it("counts in all, per level or per class level", async () => {
    render(<Cards />);
    await pickEffect(section(), "hit points", "Hit point maximum");
    expect(latest).toEqual([{ kind: "hit-point-maximum", bonus: { base: 5 } }]);
    const amount = card().getByLabelText("Hit points added");
    await userEvent.clear(amount);
    await userEvent.type(amount, "3");
    await userEvent.selectOptions(card().getByLabelText("Counted"), "class:Barbarian");
    expect(latest).toEqual([{ kind: "hit-point-maximum", bonus: { perLevel: 3, levelClass: "Barbarian" } }]);
    expect(card().getByText("That's +18 hit points now.")).toBeTruthy();
    await userEvent.selectOptions(card().getByLabelText("Counted"), "total");
    expect(latest).toEqual([{ kind: "hit-point-maximum", bonus: { base: 3 } }]);
  });

  it("warns when the creature has no level to count", async () => {
    const { character: _character, ...monster } = barbarian;
    render(<Cards definition={monster} effects={[{ kind: "hit-point-maximum", bonus: { perLevel: 2 } }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit hit point maximum effect" }));
    expect(card().getByText(/It has no level yet/)).toBeTruthy();
  });

  it("makes regeneration temporary hit points (Heroism)", async () => {
    render(<Cards />);
    await pickEffect(section(), "heroism", "Heroism's temporary hit points");
    expect(latest).toEqual([{ kind: "hp-regen", amount: 3, temporary: true }]);
    const regen = within(screen.getByRole("group", { name: "Regenerates effect" }));
    expect((regen.getByLabelText("As temporary hit points (they don't stack)") as HTMLInputElement).checked).toBe(true);
  });
});

describe("the ability score card", () => {
  it("sets a score to at least a number, or raises it to a maximum", async () => {
    render(<Cards />);
    await pickEffect(section(), "gauntlets", "Strength 19, like Gauntlets of Ogre Power");
    expect(latest).toEqual([{ kind: "ability-score", ability: "str", setTo: 19 }]);
    const score = within(screen.getByRole("group", { name: "Ability score effect" }));
    await userEvent.selectOptions(score.getByLabelText("Which score"), "con");
    await userEvent.click(within(score.getByRole("radiogroup", { name: "It" })).getByRole("radio", { name: "Goes up by" }));
    expect(latest).toEqual([{ kind: "ability-score", ability: "con", bonus: 2, max: 20 }]);
    expect(score.getByText("Its Constitution score increases by 2, to a maximum of 20.")).toBeTruthy();
  });

  it("warns that attacks with a fixed bonus won't follow", async () => {
    const claw = { kind: "attack" as const, id: "claw", name: "Claw", actionType: "action" as const, attackType: "melee" as const, ability: "str" as const, range: 5, reach: 5, attackBonus: 5, damage: [{ dice: "1d6", damageType: "slashing" as const }], automationSupport: "full" as const };
    render(<Cards definition={{ ...barbarian, actions: [claw] }} effects={[{ kind: "ability-score", ability: "str", setTo: 19 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit ability score effect" }));
    expect(screen.getByText(/fixed attack bonus/)).toBeTruthy();
  });
});

describe("Aid before the fight", () => {
  const pristine = useEncounterStore.getState();
  beforeEach(() => useEncounterStore.setState(pristine, true));
  const store = () => useEncounterStore.getState();
  const fighter = () => store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;

  it("raises the token's hit points with its maximum, and takes them back when switched off", () => {
    const spell = structuredClone(findSrdSpell("srd:spell:aid")!);
    spell.action = { ...spell.action!, resourceCost: spell.resourceCost } as typeof spell.action;
    store().updateCreatureDefinition("def-fighter", { spells: [spell], resources: { "second-wind": 1, "action-surge": 1, "slot-2": 1 } });
    useEncounterStore.setState({ encounter: { ...store().encounter, combatants: store().encounter.combatants.map((c) => (c.id === "pc-fighter" ? { ...c, resources: { ...c.resources, "slot-2": 1 } } : c)) } });
    const definition = store().encounter.definitions.find((d) => d.id === "def-fighter")!;
    const aid = getExecutableActions(definition).find((action) => action.id === "srd:spell:aid:action")!;
    store().togglePrepBuff("pc-fighter", aid.id);
    expect(fighter().currentHp).toBe(37);
    expect(actualMaxHp(definition, fighter())).toBe(37);
    store().togglePrepBuff("pc-fighter", aid.id);
    expect(fighter().currentHp).toBe(32);
  });
});
