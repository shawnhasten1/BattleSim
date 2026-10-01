/**
 * Starting points for a new ability in the editor: blank kinds and recipes. Each is a whole record; nothing is added
 * to the creature until the DM saves it.
 */
import type { Ability, ActionDefinition, DamageComponent, SpellDefinition, WeaponDefinition } from "@/engine";

type AttackAction = Extract<ActionDefinition, { kind: "attack" }>;
type SaveAction = Extract<ActionDefinition, { kind: "save" }>;

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

/**
 * A blank special action (a breath, a gaze, a poison spit): one creature makes a CON save, its DC worked out from the
 * creature's CON and proficiency. Roll and Target turn it into an area, a heal or anything else.
 */
export function blankSpecialAction(): SaveAction {
  return {
    kind: "save", id: "", name: "New action", actionType: "action", saveAbility: "con", dcFormula: { base: 8, ability: "con", proficiency: true },
    range: 30, damage: [{ dice: "2d6", damageType: "poison" }], halfDamageOnSuccess: true, onSuccess: "half", automationSupport: "full"
  };
}

/* ─── spells ─────────────────────────────────────────────────────────────── */

/** A calculated DC or to-hit that follows the caster's spellcasting ability. */
const SPELL_DC = { base: 8, ability: "spellcasting", proficiency: true } as const;
const SPELL_TO_HIT = { ability: "spellcasting", proficiency: true } as const;
const magic = (dice: string, damageType: DamageComponent["damageType"]): DamageComponent => ({ dice, damageType, magical: true });
const slot = (level: number) => ({ resourceId: `slot-${level}`, amount: 1 });

export interface SpellTemplate {
  label: string;
  hint: string;
  /** The spell for a creature that casts with `ability` (a spell attack rolls it, a heal adds it). */
  record: (ability: Ability) => SpellDefinition;
}

/** A blank spell: a 1st-level ranged spell attack whose to-hit follows the caster's spellcasting ability. */
export function blankSpell(ability: Ability): SpellDefinition {
  return {
    id: "", name: "New spell", level: 1, school: "evocation", castingTime: "action", range: 120, resourceCost: slot(1), automationSupport: "full",
    action: {
      kind: "attack", id: "", name: "New spell", actionType: "action", attackType: "spell", ability, attackBonusFormula: { ...SPELL_TO_HIT },
      range: 120, damage: [magic("3d8", "fire")], resourceCost: slot(1), automationSupport: "full"
    }
  };
}

export const SPELL_TEMPLATES: SpellTemplate[] = [
  {
    label: "Damage cantrip",
    hint: "Like Fire Bolt: a spell attack for 1d10 fire that grows at levels 5, 11 and 17",
    record: (ability) => ({
      id: "", name: "New cantrip", level: 0, school: "evocation", castingTime: "action", range: 120, automationSupport: "full",
      action: {
        kind: "attack", id: "", name: "New cantrip", actionType: "action", attackType: "spell", ability, attackBonusFormula: { ...SPELL_TO_HIT }, range: 120,
        damage: [{ ...magic("1d10", "fire"), scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "2d10" }, { atLevel: 11, dice: "3d10" }, { atLevel: 17, dice: "4d10" }] } }],
        automationSupport: "full"
      }
    })
  },
  {
    label: "Save or condition",
    hint: "Like Hold Person: a WIS save or paralyzed, repeating the save each turn",
    record: () => ({
      id: "", name: "New spell", level: 2, school: "enchantment", castingTime: "action", range: 60, concentration: true, resourceCost: slot(2),
      upcast: { perSlotAboveBase: { targets: 1 } }, automationSupport: "full",
      action: {
        kind: "save", id: "", name: "New spell", actionType: "action", saveAbility: "wis", dcFormula: { ...SPELL_DC }, range: 60, damage: [],
        halfDamageOnSuccess: false, onSuccess: "negates", concentration: true, resourceCost: slot(2), automationSupport: "full",
        riders: [{ kind: "condition", when: "on-save-fail", condition: "paralyzed", duration: { kind: "save-ends", saveAt: "turn-end" } }]
      }
    })
  },
  {
    label: "Area blast",
    hint: "Like Fireball: a 20-ft sphere, DEX save for half, 8d6 fire",
    record: () => ({
      id: "", name: "New spell", level: 3, school: "evocation", castingTime: "action", range: 150, resourceCost: slot(3),
      upcast: { perSlotAboveBase: { damageDice: "1d6" } }, automationSupport: "full",
      action: {
        kind: "area-save", id: "", name: "New spell", actionType: "action", saveAbility: "dex", dcFormula: { ...SPELL_DC }, range: 150,
        area: { type: "circle", size: 20 }, targeting: { origin: "point", range: 150 }, damage: [magic("8d6", "fire")],
        halfDamageOnSuccess: true, onSuccess: "half", affects: "all", resourceCost: slot(3), automationSupport: "full"
      }
    })
  },
  {
    label: "Healing",
    hint: "Like Cure Wounds: 1d8 + the spellcasting modifier, by touch",
    record: (ability) => ({
      id: "", name: "New spell", level: 1, school: "evocation", castingTime: "action", range: "touch", resourceCost: slot(1),
      upcast: { perSlotAboveBase: { damageDice: "1d8" } }, automationSupport: "full",
      action: {
        kind: "healing", id: "", name: "New spell", actionType: "action", range: 5, healing: [{ dice: "1d8", abilityModifier: ability }],
        targeting: { target: "single" }, resourceCost: slot(1), automationSupport: "full"
      }
    })
  },
  {
    label: "Buff",
    hint: "Like Bless: up to three creatures gain +2 to attack rolls and saves",
    record: () => ({
      id: "", name: "New spell", level: 1, school: "enchantment", castingTime: "action", range: 30, concentration: true, resourceCost: slot(1),
      automationSupport: "full",
      action: {
        kind: "buff", id: "", name: "New spell", actionType: "action", range: 30, targeting: { target: "chosen", count: 3 },
        appliedCondition: { name: "custom", durationRounds: 10, modifiers: { attackRoll: 2, savingThrows: { str: 2, dex: 2, con: 2, int: 2, wis: 2, cha: 2 } } },
        concentration: true, resourceCost: slot(1), automationSupport: "full"
      }
    })
  },
  {
    label: "Teleport",
    hint: "Like Misty Step: teleport up to 30 ft as a bonus action",
    record: () => ({
      id: "", name: "New spell", level: 2, school: "conjuration", castingTime: "bonus", range: "self", resourceCost: slot(2), automationSupport: "full",
      action: { kind: "reposition", id: "", name: "New spell", actionType: "bonus", range: 30, targeting: { target: "self" }, resourceCost: slot(2), automationSupport: "full" }
    })
  },
  {
    label: "Reaction",
    hint: "Like Hellish Rebuke: when it's hit, the attacker makes a DEX save for 2d10 fire",
    record: () => ({
      id: "", name: "New spell", level: 1, school: "evocation", castingTime: "reaction", range: 60, resourceCost: slot(1),
      upcast: { perSlotAboveBase: { damageDice: "1d10" } }, automationSupport: "full",
      action: {
        kind: "save", id: "", name: "New spell", actionType: "reaction", saveAbility: "dex", dcFormula: { ...SPELL_DC }, range: 60,
        damage: [magic("2d10", "fire")], halfDamageOnSuccess: true, onSuccess: "half", resourceCost: slot(1), automationSupport: "full",
        reaction: { trigger: { kind: "hit-by-attack" } }
      }
    })
  }
];
