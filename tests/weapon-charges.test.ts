import { describe, expect, it } from "vitest";
import { getExecutableActions } from "@/engine";
import type { AttackActionDefinition, CreatureDefinition, WeaponDefinition } from "@/engine";

/**
 * A weapon's charges: actions it grants alongside its own attack, and on-hit riders that spend a charge. A focus or a
 * wand, which has no attack of its own, is an item now (`tests/items-foci.test.ts`).
 */

function creatureWith(...weapons: WeaponDefinition[]): CreatureDefinition {
  return {
    id: "def-focus",
    name: "Focus Tester",
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

function attacks(definition: CreatureDefinition): AttackActionDefinition[] {
  return getExecutableActions(definition).filter((a): a is AttackActionDefinition => a.kind === "attack");
}

const dagger: WeaponDefinition = {
  id: "dagger", name: "Dagger", attackType: "melee", ability: "str", range: 5, reach: 5,
  damage: [{ dice: "1d4", damageType: "piercing", abilityModifier: "str" }],
  usableAs: ["action"]
};

describe("a weapon's granted actions", () => {
  it("a weapon can grant actions alongside its own attack", () => {
    const sword: WeaponDefinition = {
      ...dagger,
      id: "flame-tongue",
      charges: { id: "charge", max: 2, recharge: "dawn" },
      grantedActions: [{
        kind: "attack", id: "flame-tongue-burst", name: "Fire Burst", actionType: "action", attackType: "spell",
        ability: "int", range: 30, damage: [{ dice: "2d6", damageType: "fire" }],
        resourceCost: { resourceId: "charge", amount: 1 }, automationSupport: "full"
      }]
    };
    const ids = getExecutableActions(creatureWith(sword)).map((a) => a.id);
    expect(ids).toContain("weapon:flame-tongue");
    expect(ids).toContain("flame-tongue-burst");
  });
});

describe("optional-activation on-hit riders", () => {
  it("compiles a plain attack plus a separate 'spend charge' candidate", () => {
    const sword: WeaponDefinition = {
      ...dagger,
      id: "frost-dagger",
      charges: { id: "charge", max: 3, recharge: "dawn" },
      onHit: [{
        id: "frost-rider", kind: "damage", when: "on-hit", components: [{ dice: "1d6", damageType: "cold" }],
        resourceCost: { resourceId: "charge", amount: 1 }, activation: "optional"
      }]
    };
    const compiled = attacks(creatureWith(sword));
    const plain = compiled.find((a) => a.id === "weapon:frost-dagger");
    const charged = compiled.find((a) => a.id === "weapon:frost-dagger:charged");
    expect(plain?.riders ?? []).toHaveLength(0);
    expect(charged).toBeDefined();
    expect(charged?.resourceCost).toEqual({ resourceId: "charge", amount: 1 });
    expect(charged?.riders).toHaveLength(1);
  });

  it("an 'always' activation rider stays folded into the single compiled attack", () => {
    const sword: WeaponDefinition = {
      ...dagger,
      id: "fear-dagger",
      onHit: [{
        id: "fear-rider", kind: "condition", when: "on-hit", condition: "frightened",
        duration: { kind: "rounds", rounds: 1 }, resourceCost: { resourceId: "charge", amount: 1 }
      }]
    };
    const compiled = attacks(creatureWith(sword));
    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.riders).toHaveLength(1);
    expect(compiled[0]?.resourceCost).toBeUndefined();
  });
});
