import { describe, expect, it } from "vitest";
import type { CreatureDefinition } from "../src/engine";
import { buildSheetItems, describeAction, formatAutomationSupport, resourceIdsForEditor } from "../src/lib/sheet";

const base: CreatureDefinition = {
  id: "def-test",
  name: "Test Creature",
  size: "medium",
  armorClass: 15,
  maxHp: 30,
  speed: 30,
  proficiencyBonus: 2,
  abilities: { str: 14, dex: 12, con: 13, int: 10, wis: 11, cha: 8 },
  actions: [
    {
      kind: "attack",
      id: "claw",
      name: "Claw",
      actionType: "action",
      attackType: "melee",
      ability: "str",
      attackBonusFormula: { ability: "str", proficiency: true },
      range: 5,
      reach: 5,
      damage: [{ dice: "1d6", damageType: "slashing", abilityModifier: "str" }],
      automationSupport: "full"
    },
    {
      kind: "unsupported",
      id: "roar",
      name: "Frightful Roar",
      actionType: "action",
      description: "needs mapping",
      automationSupport: "unsupported"
    }
  ],
  weapons: [
    {
      id: "w1",
      name: "Handaxe",
      attackType: "melee",
      ability: "str",
      range: 5,
      damage: [{ dice: "1d6", damageType: "slashing" }]
    }
  ],
  spells: [
    {
      id: "s1",
      name: "Firebolt",
      level: 0,
      castingTime: "action",
      range: 120,
      automationSupport: "manual-only"
    }
  ],
  features: [
    { id: "f1", name: "Pack Tactics", category: "trait", automationSupport: "full", effects: [] }
  ]
};

describe("buildSheetItems", () => {
  it("flattens weapons, spells, and features into their own row lists", () => {
    const items = buildSheetItems(base);
    expect(items.weapons.map((i) => i.name)).toEqual(["Handaxe"]);
    expect(items.spells.map((i) => i.name)).toEqual(["Firebolt"]);
    expect(items.features.map((i) => i.name)).toEqual(["Pack Tactics"]);
    expect(items.actions.map((i) => i.name)).toContain("Claw");
    expect(items.actions.map((i) => i.name)).toContain("Frightful Roar");
    expect(items.all).toEqual([...items.actions, ...items.spells, ...items.features, ...items.weapons]);
  });

  it("reports the worst automation level present across every row", () => {
    const items = buildSheetItems(base);
    expect(items.counts.full).toBeGreaterThan(0);
    expect(items.counts.unsupported).toBe(1);
    expect(items.counts["manual-only"]).toBe(1);
    expect(items.worst).toBe("unsupported"); // roar drags it down
  });

  it('worst is "manual-only" when nothing is unsupported', () => {
    const noRoar: CreatureDefinition = { ...base, actions: [base.actions[0]] };
    expect(buildSheetItems(noRoar).worst).toBe("manual-only"); // Firebolt
  });

  it('degrades worst to "full" when everything is fully automated', () => {
    const clean: CreatureDefinition = { ...base, actions: [base.actions[0]], spells: [], features: [] };
    expect(buildSheetItems(clean).worst).toBe("full");
  });

  it("tags bonus/reaction actions by their timing", () => {
    const claw = base.actions[0];
    if (claw.kind !== "attack") throw new Error("fixture drift");
    const withBonus: CreatureDefinition = {
      ...base,
      actions: [{ ...claw, id: "quick", name: "Quick Jab", actionType: "bonus" }]
    };
    expect(buildSheetItems(withBonus).actions[0].type).toBe("bonusAction");
  });
});

describe("describeAction", () => {
  it("summarizes an attack with its bonus and damage", () => {
    const text = describeAction(base.actions[0], base);
    expect(text).toContain("action melee");
    expect(text).toContain("1d6");
    expect(text).toContain("slashing");
  });

  it('flags unsupported actions as "mapping required"', () => {
    expect(describeAction(base.actions[1], base)).toBe("mapping required");
  });
});

describe("resourceIdsForEditor", () => {
  it("falls back to a placeholder when a creature has no resources", () => {
    expect(resourceIdsForEditor(base, { resources: undefined } as never)).toEqual(["limited-use"]);
  });

  it("merges and slot-sorts definition, combatant, and action-cost resources", () => {
    const def: CreatureDefinition = { ...base, resources: { "slot-2": 3, rage: 2 } };
    const ids = resourceIdsForEditor(def, { resources: { "slot-1": 1 } } as never);
    expect(ids).toEqual(["slot-1", "slot-2", "rage"]);
  });
});

describe("formatAutomationSupport", () => {
  it('renames "manual-only" to "reference-only"', () => {
    expect(formatAutomationSupport("manual-only")).toBe("reference-only");
    expect(formatAutomationSupport("full")).toBe("full");
  });
});
