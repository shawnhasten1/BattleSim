import { describe, expect, it } from "vitest";
import { getExecutableActions, type ActionDefinition, type CreatureDefinition, type MultiattackActionDefinition } from "@/engine";
import { multiattackLosses, withoutDefinitionItem } from "@/lib/definition-edits";

/** Deleting a record from a creature, and what that does to its multiattacks. */

const claw: ActionDefinition = {
  kind: "attack", id: "claw", name: "Claws", actionType: "action", attackType: "melee", ability: "str", attackBonus: 6, range: 5, reach: 5,
  damage: [{ dice: "2d6", damageType: "slashing", abilityModifier: "str" }], automationSupport: "full"
};
const bite: ActionDefinition = { ...claw, id: "bite", name: "Bite", damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "str" }] };

function multiattack(id: string, steps: Array<{ actionId: string; count: number; targetGroup?: number }>, actionType: "action" | "bonus" = "action"): MultiattackActionDefinition {
  return { kind: "multiattack", id, name: id === "multi" ? "Multiattack" : id, actionType, attacks: steps, automationSupport: "full" };
}

function creature(overrides: Partial<CreatureDefinition>): CreatureDefinition {
  return {
    id: "def-test", name: "Test", size: "large", armorClass: 11, maxHp: 34, speed: 40,
    abilities: { str: 19, dex: 10, con: 16, int: 2, wis: 13, cha: 7 },
    actions: [], ...overrides
  };
}

const multiattacksOf = (definition: CreatureDefinition) =>
  [...definition.actions, ...(definition.bonusActions ?? [])].filter((action): action is MultiattackActionDefinition => action.kind === "multiattack");

describe("withoutDefinitionItem", () => {
  it("takes a deleted attack out of the multiattack and keeps the rest", () => {
    const bear = creature({ actions: [bite, claw, multiattack("multi", [{ actionId: "bite", count: 1 }, { actionId: "claw", count: 1 }])] });
    const after = withoutDefinitionItem(bear, "action", "claw");
    expect(after.actions.map((action) => action.id)).toEqual(["bite", "multi"]);
    expect(multiattacksOf(after)[0]!.attacks).toEqual([{ actionId: "bite", count: 1 }]);
  });

  it("deletes a multiattack left with no steps", () => {
    const bear = creature({ actions: [claw, multiattack("multi", [{ actionId: "claw", count: 2 }])] });
    expect(withoutDefinitionItem(bear, "action", "claw").actions).toEqual([]);
  });

  it("removes a weapon's power-attack copy from multiattacks too", () => {
    const fighter = creature({
      weapons: [{ id: "axe", name: "Greataxe", attackType: "melee", ability: "str", range: 5, reach: 5, powerAttack: true, damage: [{ dice: "1d12", damageType: "slashing", abilityModifier: "str" }] }]
    });
    const [plain, power] = getExecutableActions(fighter).filter((action) => action.name.startsWith("Greataxe") && action.actionType === "action");
    expect(power?.id).toMatch(/power/);
    const withRoutine = { ...fighter, actions: [bite, multiattack("multi", [{ actionId: power!.id, count: 1 }, { actionId: plain!.id, count: 1 }, { actionId: "bite", count: 1 }])] };
    expect(multiattacksOf(withoutDefinitionItem(withRoutine, "weapon", "axe"))[0]!.attacks).toEqual([{ actionId: "bite", count: 1 }]);
  });

  it("removes a feature's granted attack from multiattacks", () => {
    const horns: ActionDefinition = { ...claw, id: "horns", name: "Horns" };
    const beast = creature({
      features: [{ id: "horned", name: "Horned", category: "trait", grantedActions: [horns], automationSupport: "full" }],
      actions: [claw, multiattack("multi", [{ actionId: "claw", count: 1 }, { actionId: "horns", count: 1 }])]
    });
    expect(multiattacksOf(withoutDefinitionItem(beast, "feature", "horned"))[0]!.attacks).toEqual([{ actionId: "claw", count: 1 }]);
  });

  it("scrubs a bonus-action multiattack as well", () => {
    const monk = creature({ actions: [claw], bonusActions: [multiattack("flurry", [{ actionId: "claw", count: 2 }], "bonus")] });
    expect(withoutDefinitionItem(monk, "action", "claw").bonusActions).toEqual([]);
  });

  it("leaves multiattacks alone when the deleted record isn't in one", () => {
    const bear = creature({ actions: [bite, claw, multiattack("multi", [{ actionId: "bite", count: 1 }])] });
    expect(multiattacksOf(withoutDefinitionItem(bear, "action", "claw"))).toEqual(multiattacksOf(bear));
  });
});

describe("multiattackLosses", () => {
  const bear = creature({ actions: [bite, claw, multiattack("multi", [{ actionId: "bite", count: 1 }, { actionId: "claw", count: 2 }])] });

  it("names a multiattack that would lose a step, and what it's left with", () => {
    const [loss] = multiattackLosses(bear, "action", "claw");
    expect(loss?.multiattack.id).toBe("multi");
    expect(loss?.after?.attacks).toEqual([{ actionId: "bite", count: 1 }]);
  });

  it("marks a multiattack that would be deleted", () => {
    const lone = creature({ actions: [claw, multiattack("multi", [{ actionId: "claw", count: 2 }])] });
    const [loss] = multiattackLosses(lone, "action", "claw");
    expect(loss?.multiattack.id).toBe("multi");
    expect(loss?.after).toBeUndefined();
  });

  it("finds nothing to ask about for an unused record, or for deleting the multiattack itself", () => {
    const withSpare = { ...bear, actions: [...bear.actions, { ...claw, id: "tail", name: "Tail" }] };
    expect(multiattackLosses(withSpare, "action", "tail")).toEqual([]);
    expect(multiattackLosses(bear, "action", "multi")).toEqual([]);
  });
});
