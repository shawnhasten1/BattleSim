/**
 * Starting points for a new ability in the editor: blank kinds and recipes. Each is a whole record; nothing is added
 * to the creature until the DM saves it.
 */
import type { Ability, ActionDefinition, DamageComponent, FeatureDefinition, SpellDefinition, WeaponDefinition } from "@/engine";
import { followUpFrom } from "./features";

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

/** A blank heal it takes on itself as a bonus action (Second Wind): Target makes it a touch or a heal for others. */
export function blankHeal(): Extract<ActionDefinition, { kind: "healing" }> {
  return {
    kind: "healing", id: "", name: "New heal", actionType: "bonus", range: 0, healing: [{ dice: "1d10", diceCount: 1, diceSize: 10 }],
    targeting: { target: "self" }, automationSupport: "full"
  };
}

/** A blank benefit it gives itself as a bonus action, for a minute: Benefit says what it grants. */
export function blankBuff(): Extract<ActionDefinition, { kind: "buff" }> {
  return {
    kind: "buff", id: "", name: "New benefit", actionType: "bonus", range: 0, targeting: { target: "self" },
    appliedCondition: { name: "custom", durationRounds: 10 }, automationSupport: "full"
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

/* ─── features and traits ────────────────────────────────────────────────── */

export interface FeatureTemplate {
  label: string;
  hint: string;
  /** The feature for a creature: a follow-up attack (Pounce, Rampage) copies one of its melee attacks. */
  record: (attacks: AttackAction[]) => FeatureDefinition;
}

/** A blank feature: always on, doing nothing yet. While active and Aura say what it does. */
export function blankFeature(category: "feature" | "trait" = "feature"): FeatureDefinition {
  return { id: "", name: category === "trait" ? "New trait" : "New feature", category, automationSupport: "full" };
}

const RESIST_BPS = (["bludgeoning", "piercing", "slashing"] as const).map((damageType) => ({ kind: "damage-adjustment" as const, adjustment: { type: "resistance" as const, damageType } }));

/** One of the creature's melee attacks as a follow-up (Pounce's bite after a charge, Rampage's after a kill). */
function followUp(attacks: AttackAction[], featureName: string, after: "charge-hit" | "dropped-creature"): ActionDefinition[] | undefined {
  const base = attacks.find((attack) => attack.attackType === "melee");
  return base ? [followUpFrom(base, featureName, after, "granted-1")] : undefined;
}

export const FEATURE_TEMPLATES: FeatureTemplate[] = [
  {
    label: "Rage",
    hint: "A bonus action: +2 melee damage, resistance to B/P/S and advantage on STR saves for a minute",
    record: () => ({
      id: "", name: "Rage", category: "feature", automationSupport: "full",
      grantedActions: [{
        kind: "activate-feature", id: "activate", name: "Rage", actionType: "bonus", featureId: "", resourceCost: { resourceId: "rage", amount: 1 }, automationSupport: "full",
        condition: {
          name: "custom", durationRounds: 10,
          effects: [
            { kind: "damage-bonus", attackTypes: ["melee"], abilities: ["str"], damage: [{ dice: "2", damageType: "same-as-attack" }] },
            ...RESIST_BPS,
            { kind: "save-advantage", ability: "str" }
          ]
        }
      }]
    })
  },
  {
    label: "Reckless Attack",
    hint: "No action: advantage on STR melee attacks this turn, but attackers have advantage until its next turn",
    record: () => ({
      id: "", name: "Reckless Attack", category: "feature", automationSupport: "full",
      grantedActions: [{
        kind: "activate-feature", id: "activate", name: "Reckless Attack", actionType: "free", featureId: "", automationSupport: "full",
        condition: { name: "custom", durationRounds: 1, modifiers: { incomingAttackRoll: 5 }, effects: [{ kind: "attack-advantage", condition: "always", attackTypes: ["melee"], abilities: ["str"] }] }
      }]
    })
  },
  {
    label: "Action Surge",
    hint: "Once per rest: one more action this turn",
    record: () => ({
      id: "", name: "Action Surge", category: "feature", automationSupport: "full",
      effects: [{ kind: "extra-action", slot: "action" }],
      grantedActions: [{ kind: "activate-feature", id: "activate", name: "Action Surge", actionType: "free", featureId: "", resourceCost: { resourceId: "action-surge", amount: 1 }, automationSupport: "full" }]
    })
  },
  {
    label: "Cunning Action",
    hint: "Dash, Disengage or Hide as a bonus action",
    record: () => ({
      id: "", name: "Cunning Action", category: "feature", automationSupport: "full",
      grantedActions: (["dash", "disengage", "hide"] as const).map((mode) => ({
        kind: "utility" as const, id: `grant-${mode}`, name: `Cunning Action: ${mode[0]!.toUpperCase()}${mode.slice(1)}`, actionType: "bonus" as const, mode,
        automationSupport: mode === "hide" ? "partial" as const : "full" as const
      }))
    })
  },
  {
    label: "Sneak Attack",
    hint: "Once a turn, +3d6 when it has advantage or an ally is next to the target",
    record: () => ({
      id: "", name: "Sneak Attack", category: "feature", automationSupport: "full",
      effects: [{
        kind: "damage-bonus", oncePerTurn: true, condition: "always", anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"],
        attackTypes: ["melee", "ranged"], damage: [{ dice: "3d6", damageType: "same-as-attack" }]
      }]
    })
  },
  {
    label: "Pack Tactics",
    hint: "Advantage when an ally is next to the target",
    record: () => ({ id: "", name: "Pack Tactics", category: "trait", automationSupport: "full", effects: [{ kind: "attack-advantage", condition: "ally-adjacent-to-target" }] })
  },
  {
    label: "Charge",
    hint: "After 20 ft straight at a target: +2d6, and a STR save or prone",
    record: () => ({
      id: "", name: "Charge", category: "trait", automationSupport: "full",
      effects: [
        { kind: "damage-bonus", condition: "charged", attackTypes: ["melee"], damage: [{ dice: "2d6", damageType: "same-as-attack" }] },
        { kind: "apply-condition-on-hit", condition: "charged", attackTypes: ["melee"], appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 } }
      ]
    })
  },
  {
    label: "Pounce",
    hint: "A charge knocks prone; then a bonus attack against the prone target",
    record: (attacks) => ({
      id: "", name: "Pounce", category: "trait", automationSupport: "full",
      effects: [{ kind: "apply-condition-on-hit", condition: "charged", attackTypes: ["melee"], appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 } }],
      grantedActions: followUp(attacks, "Pounce", "charge-hit")
    })
  },
  {
    label: "Rampage",
    hint: "After it drops a creature: move and make a bonus attack",
    record: (attacks) => ({ id: "", name: "Rampage", category: "trait", automationSupport: "full", grantedActions: followUp(attacks, "Rampage", "dropped-creature") })
  },
  {
    label: "Blood Frenzy",
    hint: "Advantage on melee attacks against a hurt target",
    record: () => ({ id: "", name: "Blood Frenzy", category: "trait", automationSupport: "full", effects: [{ kind: "attack-advantage", condition: "target-injured", attackTypes: ["melee"] }] })
  },
  {
    label: "Magic Resistance",
    hint: "Advantage on saves against spells and other magic",
    record: () => ({ id: "", name: "Magic Resistance", category: "trait", automationSupport: "full", effects: [{ kind: "save-advantage", against: { source: "magical" } }] })
  },
  {
    label: "Legendary Resistance",
    hint: "Three times a fight, a failed save becomes a success",
    record: () => ({ id: "", name: "Legendary Resistance (3/Day)", category: "trait", automationSupport: "full", effects: [{ kind: "auto-succeed-save", resourceId: "legendary-resistance" }] })
  },
  {
    label: "Regeneration",
    hint: "10 HP at the start of each turn, stopped by fire or acid",
    record: () => ({ id: "", name: "Regeneration", category: "trait", automationSupport: "full", effects: [{ kind: "hp-regen", amount: 10, suppressedByDamageTypes: ["acid", "fire"] }] })
  },
  {
    label: "Undead Fortitude",
    hint: "At 0 HP, a CON save (5 + damage) to drop to 1 instead",
    record: () => ({
      id: "", name: "Undead Fortitude", category: "trait", automationSupport: "full",
      effects: [{ kind: "survive-lethal", save: { ability: "con", dcBase: 5 }, excludedDamageTypes: ["radiant"], excludeCritical: true }]
    })
  },
  {
    label: "Stench",
    hint: "Creatures starting a turn within 10 ft: CON save or poisoned",
    record: () => ({
      id: "", name: "Stench", category: "trait", automationSupport: "full",
      emanation: { range: 10, timing: "target-turn-start", affects: "all", save: { ability: "con", dc: 14 }, condition: "poisoned", immuneOnSave: true }
    })
  },
  {
    label: "Fear Aura",
    hint: "Enemies starting a turn within 20 ft: WIS save or frightened",
    record: () => ({
      id: "", name: "Fear Aura", category: "trait", automationSupport: "full",
      emanation: { range: 20, timing: "target-turn-start", affects: "hostile", save: { ability: "wis", dc: 15 }, condition: "frightened", immuneOnSave: true, suppressedWhenIncapacitated: true }
    })
  },
  {
    label: "Fire Aura",
    hint: "3d6 fire to everything within 5 ft each turn, and to what hits it in melee",
    record: () => ({
      id: "", name: "Fire Aura", category: "trait", automationSupport: "full",
      emanation: { range: 5, timing: "bearer-turn-start", affects: "all", damage: [{ dice: "3d6", damageType: "fire" }] },
      effects: [{ kind: "melee-retaliation", withinFt: 5, damage: [{ dice: "3d6", damageType: "fire" }] }]
    })
  },
  {
    label: "Heated Body",
    hint: "1d10 fire to a creature that hits it in melee",
    record: () => ({ id: "", name: "Heated Body", category: "trait", automationSupport: "full", effects: [{ kind: "melee-retaliation", withinFt: 5, damage: [{ dice: "1d10", damageType: "fire" }] }] })
  },
  {
    label: "Aura of Protection",
    hint: "It and allies within 10 ft add its CHA modifier to saves",
    record: () => ({
      id: "", name: "Aura of Protection", category: "trait", automationSupport: "full",
      aura: { range: 10, affects: "allies", requiresConscious: true }, effects: [{ kind: "save-bonus", bonus: { ability: "cha" } }]
    })
  },
  {
    label: "Evasion",
    hint: "A DEX save for half damage: none on a success, half on a failure",
    record: () => ({ id: "", name: "Evasion", category: "feature", automationSupport: "full", effects: [{ kind: "evasion" }] })
  }
];
