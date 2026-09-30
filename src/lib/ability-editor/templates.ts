/**
 * Starting points for a new ability in the editor: blank kinds and recipes. Each is a whole record; nothing is added
 * to the creature until the DM saves it.
 */
import type { ActionDefinition, WeaponDefinition } from "@/engine";

type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;

export interface WeaponTemplate {
  label: string;
  /** One line under the label in the Add panel. */
  hint: string;
  record: WeaponDefinition;
}

/** A blank weapon: a plain one-handed melee weapon the DM renames and adjusts. */
export function blankWeapon(): WeaponDefinition {
  return {
    id: "", name: "New weapon", attackType: "melee", ability: "str", range: 5, reach: 5,
    damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }]
  };
}

/** A blank natural attack (a claw, a bite, a slam): to-hit worked out from STR and proficiency until a number is typed. */
export function blankAttack(): AttackAction {
  return {
    kind: "attack", id: "", name: "New attack", actionType: "action", attackType: "melee", ability: "str", range: 5, reach: 5,
    damage: [{ dice: "1d6", damageType: "bludgeoning", abilityModifier: "str" }], automationSupport: "full"
  };
}

export const WEAPON_TEMPLATES: WeaponTemplate[] = [
  { label: "Melee weapon", hint: "A longsword-style weapon: STR, 1d8 slashing", record: blankWeapon() },
  {
    label: "Ranged weapon",
    hint: "A longbow-style weapon: DEX, 1d8 piercing, 150/600 ft",
    record: {
      id: "", name: "New ranged weapon", attackType: "ranged", ability: "dex", range: 150, longRange: 600,
      damage: [{ dice: "1d8", damageType: "piercing", abilityModifier: "dex" }]
    }
  },
  {
    label: "Weapon with a rider",
    hint: "A melee weapon whose hit can frighten (WIS save)",
    record: {
      ...blankWeapon(),
      name: "New weapon",
      onHit: [{
        kind: "condition", when: "on-hit", condition: "frightened", save: { ability: "wis", onSuccess: "negates" },
        duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" }
      }]
    }
  }
];
