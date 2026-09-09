import { describe, expect, it } from "vitest";
import { getExecutableActions } from "@/engine";
import type { AttackActionDefinition, CreatureDefinition, WeaponDefinition } from "@/engine";

function creatureWith(...weapons: WeaponDefinition[]): CreatureDefinition {
  return {
    id: "def-grip",
    name: "Grip Tester",
    size: "medium",
    armorClass: 15,
    maxHp: 30,
    speed: 30,
    proficiencyBonus: 2,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
    actions: [],
    weapons
  };
}

const longsword: WeaponDefinition = {
  id: "longsword",
  name: "Longsword",
  attackType: "melee",
  ability: "str",
  range: 5,
  reach: 5,
  damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
  versatileDamage: [{ dice: "1d10", damageType: "slashing", abilityModifier: "str" }]
};

function attacks(definition: CreatureDefinition): AttackActionDefinition[] {
  return getExecutableActions(definition).filter((a): a is AttackActionDefinition => a.kind === "attack");
}

describe("weapon grips", () => {
  it("defaults to the one-handed die when no grip is set", () => {
    const [attack] = attacks(creatureWith(longsword));
    expect(attack?.grip).toBe("one-handed");
    expect(attack?.damage[0]?.dice).toBe("1d8");
  });

  it("grip: two-handed always uses versatileDamage", () => {
    const [attack] = attacks(creatureWith({ ...longsword, grip: "two-handed" }));
    expect(attack?.grip).toBe("two-handed");
    expect(attack?.damage[0]?.dice).toBe("1d10");
  });

  it("grip: versatile uses the two-handed die when there is no drawn off-hand weapon", () => {
    const [attack] = attacks(creatureWith({ ...longsword, grip: "versatile" }));
    expect(attack?.grip).toBe("two-handed");
    expect(attack?.damage[0]?.dice).toBe("1d10");
  });

  it("grip: versatile falls back to one-handed when a sibling weapon is usable as a bonus action", () => {
    const offHand: WeaponDefinition = {
      id: "shortsword", name: "Shortsword", attackType: "melee", ability: "str", range: 5, reach: 5,
      damage: [{ dice: "1d6", damageType: "piercing", abilityModifier: "str" }],
      usableAs: ["bonus"]
    };
    const list = attacks(creatureWith({ ...longsword, grip: "versatile" }, offHand));
    const main = list.find((a) => a.name === "Longsword");
    expect(main?.grip).toBe("one-handed");
    expect(main?.damage[0]?.dice).toBe("1d8");
  });
});

describe("weapon usableAs", () => {
  it("compiles one attack per slot, suffixing the non-action ids", () => {
    const list = attacks(creatureWith({ ...longsword, id: "dagger", name: "Dagger", usableAs: ["action", "bonus"] }));
    const ids = list.map((a) => a.id).sort();
    expect(ids).toEqual(["weapon:dagger", "weapon:dagger:bonus"]);
    expect(list.find((a) => a.id === "weapon:dagger")?.actionType).toBe("action");
    expect(list.find((a) => a.id === "weapon:dagger:bonus")?.actionType).toBe("bonus");
  });

  it("a reaction-only weapon compiles no action-typed attack", () => {
    const list = attacks(creatureWith({ ...longsword, id: "spike", name: "Reactive Spike", usableAs: ["reaction"] }));
    expect(list).toHaveLength(1);
    expect(list[0]?.actionType).toBe("reaction");
    expect(list[0]?.id).toBe("weapon:spike:reaction");
  });

  it("melee defaults to an action attack + an opportunity-attack reaction copy", () => {
    const list = attacks(creatureWith(longsword));
    expect(list.map((a) => a.actionType).sort()).toEqual(["action", "reaction"]);
    const reactionCopy = list.find((a) => a.actionType === "reaction");
    expect(reactionCopy?.reaction?.trigger.kind).toBe("enemy-leaves-reach");
    expect(reactionCopy?.reaction?.priority).toBe("always");
  });

  it("ranged defaults to a single action attack (no reaction copy)", () => {
    const list = attacks(creatureWith({ ...longsword, id: "bow", name: "Shortbow", attackType: "ranged" }));
    expect(list).toHaveLength(1);
    expect(list[0]?.actionType).toBe("action");
  });
});

describe("weapon powerAttack", () => {
  it("adds a -5 / +10 power variant alongside the plain attack", () => {
    const list = attacks(creatureWith({ ...longsword, id: "maul", name: "Maul", grip: "two-handed", powerAttack: true }));
    const plain = list.find((a) => a.id === "weapon:maul");
    const power = list.find((a) => a.id === "weapon:maul:power");
    expect(plain).toBeDefined();
    expect(power?.name).toBe("Maul (Power Attack)");
    expect((power?.attackBonusFormula?.base ?? 0) - (plain?.attackBonusFormula?.base ?? 0)).toBe(-5);
    // the +10 rides on an appended flat component
    expect(power?.damage.at(-1)).toMatchObject({ dice: "10", damageType: "slashing" });
    expect(power?.damage.length).toBe((plain?.damage.length ?? 0) + 1);
  });

  it("emits a power copy for each usable slot", () => {
    const list = attacks(creatureWith({
      ...longsword, id: "bow", name: "Longbow", attackType: "ranged", usableAs: ["action", "bonus"], powerAttack: true
    }));
    expect(list.map((a) => a.id).sort()).toEqual([
      "weapon:bow", "weapon:bow:bonus", "weapon:bow:bonus:power", "weapon:bow:power"
    ]);
  });
});
