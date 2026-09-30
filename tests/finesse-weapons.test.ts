import { describe, expect, it } from "vitest";
import { getExecutableActions, normalizeWeaponDefinition, type CreatureDefinition, type WeaponDefinition } from "@/engine";
import { findSrdWeapon } from "@/data/srd";

/**
 * A finesse weapon's damage adds the same ability as its attack roll: whichever of STR and DEX is better. The SRD
 * library leaves the modifier off finesse weapons for the engine to resolve; it used to be left off entirely, so a
 * DEX 18 rogue's rapier dealt 1d8 instead of 1d8 + 4.
 */

function wielder(abilities: Partial<CreatureDefinition["abilities"]>, weapon: WeaponDefinition): CreatureDefinition {
  const scores = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...abilities };
  return {
    id: "wielder", name: "Wielder", size: "medium", armorClass: 14, maxHp: 30, speed: 30, proficiencyBonus: 2,
    abilities: scores, actions: [], weapons: [{ ...normalizeWeaponDefinition(structuredClone(weapon), scores), id: "w", actionId: "w-attack" }]
  };
}

const attackOf = (definition: CreatureDefinition) => {
  const attack = getExecutableActions(definition).find((action) => action.id === "w-attack");
  if (attack?.kind !== "attack") throw new Error("no weapon attack");
  return attack;
};

describe("finesse weapon damage", () => {
  const rapier = findSrdWeapon("srd:weapon:rapier")!;

  it("adds DEX when DEX is the better score, as the attack roll does", () => {
    const attack = attackOf(wielder({ dex: 18 }, rapier));
    expect(attack.ability).toBe("dex");
    expect(attack.damage[0]).toMatchObject({ dice: "1d8", abilityModifier: "dex" });
  });

  it("adds STR when STR is the better score", () => {
    expect(attackOf(wielder({ str: 16, dex: 12 }, rapier)).damage[0]?.abilityModifier).toBe("str");
  });

  it("keeps a modifier the weapon names itself, and leaves extra damage alone", () => {
    const flaming: WeaponDefinition = {
      ...rapier,
      damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "str" }, { dice: "2d6", damageType: "fire" }]
    };
    const attack = attackOf(wielder({ dex: 18 }, flaming));
    expect(attack.damage[0]?.abilityModifier).toBe("str");
    expect(attack.damage[1]?.abilityModifier).toBeUndefined();
  });

  it("doesn't change a weapon that isn't finesse", () => {
    const longsword = findSrdWeapon("srd:weapon:longsword")!;
    expect(attackOf(wielder({ str: 16 }, longsword)).damage[0]?.abilityModifier).toBe("str");
    const net = findSrdWeapon("srd:weapon:net")!;
    expect(attackOf(wielder({ dex: 16 }, net)).damage[0]?.abilityModifier).toBeUndefined();
  });
});
