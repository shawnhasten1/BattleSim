/**
 * Every kind of feature effect the editor offers (plan §3.4's While active cards), in one place: what it's called,
 * which group it sits in in the Add effect picker, the words and filled-in examples that find it (EFFECTS_PLAN.md,
 * Phase 0), what a new one starts as, and which shared settings it takes ("When" from `FeatureEffectConditions`, "Which
 * attacks" from `FeatureEffectScope`). The cards, the picker and the tests read it.
 */
import type { Ability, ConditionInstance, DamageAdjustment, FeatureCondition, FeatureEffect, NumericFormula } from "@/engine";

export type EffectKind = FeatureEffect["kind"];

/**
 * The Add effect picker's groups, named for what the DM wants to change (EFFECTS_PLAN.md, Phase 0). The class and
 * monster mechanics come last, in a fold of their own.
 */
export type EffectGroup = "movement" | "hit-points" | "defense" | "attacks" | "spells" | "saves" | "turn" | "mechanics";

export const GROUPS: Array<{ group: EffectGroup; label: string }> = [
  { group: "movement", label: "Movement" },
  { group: "hit-points", label: "Hit points" },
  { group: "defense", label: "AC & defenses" },
  { group: "attacks", label: "Attacks & damage" },
  { group: "spells", label: "Spells" },
  { group: "saves", label: "Saves & d20 rolls" },
  { group: "turn", label: "Actions & turn" },
  { group: "mechanics", label: "Class & monster mechanics" }
];

/** What the effects belong to: a trait or feature, an item that works while it's carried, or a buff while it lasts. */
export type EffectOwner = "feature" | "item" | "buff";

/** A named example of a kind, filled in: picking it adds the effect as it stands. */
export interface EffectExample {
  /** The row's name: what it's like ("Pack Tactics", "+1, like a Ring or Cloak of Protection"). Never starts with a kind's label. */
  label: string;
  /** One line about what it sets. */
  hint?: string;
  /** More words that find it. */
  keywords?: string[];
  /** What it adds: one effect, or several that show as one card (resistance to three damage types). */
  effects: () => FeatureEffect[];
}

export interface EffectKindSpec {
  kind: EffectKind;
  /** The card's name and the picker's row. */
  label: string;
  /** One line under it in the picker. */
  hint: string;
  group: EffectGroup;
  /** Words a DM might type for it, beside its label and hint ("ac", "armour", "ring of protection"). */
  keywords: string[];
  /** Filled-in examples, the best known first. */
  examples?: EffectExample[];
  /** Its name in the picker's Common row, where it's one of the usual effects (`COMMON`). */
  short?: string;
  /**
   * It takes "When". An attack's effects can ask about the attack and the target (advantage, an ally beside it, a
   * charge); the rest are checked on the creature alone, where only "it's bloodied" means anything to the engine.
   */
  when: false | "attack" | "self";
  /** It takes "Which attacks": melee, ranged or spell, an ability, specific attacks. */
  scope: boolean;
  /** The engine reads it only from a condition (an activation), never from a trait that's always on. */
  conditionOnly?: boolean;
  blank: () => FeatureEffect;
}

const RESIST_BPS = (nonMagicalOnly?: boolean): FeatureEffect[] => (["bludgeoning", "piercing", "slashing"] as const).map((damageType) => ({
  kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType, ...(nonMagicalOnly ? { nonMagicalOnly } : {}) }
}));

/** Every kind, grouped as the picker shows them, the usual ones first in each group. */
export const EFFECT_KINDS: EffectKindSpec[] = [
  // Movement
  {
    kind: "avoids-opportunity-attacks", label: "Never provokes opportunity attacks", hint: "Mobile, a creature that moves freely", group: "movement", when: "self", scope: false,
    keywords: ["opportunity attack", "disengage", "mobile", "moves freely", "slippery", "flyby", "movement"],
    blank: () => ({ kind: "avoids-opportunity-attacks", condition: "always" })
  },
  {
    kind: "free-move", label: "A move with something else", hint: "Instinctive Pounce with Rage, Tactical Shift with Second Wind, a move after a critical hit", group: "movement", when: false, scope: false,
    keywords: ["move", "movement", "pounce", "tactical shift", "reposition", "extra movement"],
    blank: () => ({ kind: "free-move", on: "critical-hit" })
  },
  // Hit points
  {
    kind: "hp-regen", label: "Regenerates", hint: "Regains hit points at the start of its turn", group: "hit-points", when: false, scope: false, short: "Regenerates",
    keywords: ["regenerate", "regeneration", "regain", "heal each turn", "hit points", "hp", "troll", "heroic rally"],
    examples: [{
      label: "Troll Regeneration", hint: "10 a turn, even at 0 HP; acid or fire stops it for a turn", keywords: ["troll"],
      effects: () => [{ kind: "hp-regen", amount: 10, worksAtZero: true, suppressedByDamageTypes: ["acid", "fire"] }]
    }],
    blank: () => ({ kind: "hp-regen", amount: 10 })
  },
  {
    kind: "survive-lethal", label: "Drops to 1 HP instead of 0", hint: "Undead Fortitude, Relentless", group: "hit-points", when: false, scope: false,
    keywords: ["1 hp", "one hit point", "undead fortitude", "relentless", "relentless endurance", "dying", "0 hp", "zero", "hit points"],
    examples: [{
      label: "Undead Fortitude", hint: "a CON save, DC 5 + the damage; never against radiant damage or a critical hit", keywords: ["zombie"],
      effects: () => [{ kind: "survive-lethal", save: { ability: "con", dcBase: 5 }, excludedDamageTypes: ["radiant"], excludeCritical: true }]
    }],
    blank: () => ({ kind: "survive-lethal", save: { ability: "con", dcBase: 5 } })
  },
  {
    kind: "on-kill", label: "Temporary hit points on a kill", hint: "Dark One's Blessing: when it drops an enemy, or one drops near it", group: "hit-points", when: false, scope: false,
    keywords: ["kill", "drops", "temporary hit points", "temp hp", "thp", "dark ones blessing", "hit points"],
    blank: () => ({ kind: "on-kill", tempHp: { base: 1 } })
  },
  {
    kind: "damage-vitality", label: "Temporary hit points when a spell deals damage", hint: "Improved Blessed Strikes: twice its Wisdom modifier, to itself or a creature within 60 ft, when a Cleric cantrip deals damage", group: "hit-points", when: false, scope: false,
    keywords: ["temporary hit points", "temp hp", "thp", "blessed strikes", "spell", "hit points"],
    blank: () => ({ kind: "damage-vitality", tempHp: { ability: "wis", multiplier: 2 }, withinFt: 60, cantripsOnly: true, spellClasses: ["cleric"] })
  },
  {
    kind: "healing-bonus", label: "Bigger healing", hint: "Disciple of Life, Blessed Healer, Supreme Healing", group: "hit-points", when: false, scope: false,
    keywords: ["heal", "healing", "cure", "life domain", "hit points"],
    examples: [
      { label: "Disciple of Life", hint: "2 + the slot's level more for each creature a spell with a slot heals", effects: () => [{ kind: "healing-bonus", slotBonus: true }] },
      { label: "Blessed Healer", hint: "it heals itself as much when it heals someone else", effects: () => [{ kind: "healing-bonus", selfOnOthers: true }] },
      { label: "Supreme Healing", hint: "its healing dice give their highest", effects: () => [{ kind: "healing-bonus", maximize: true }] }
    ],
    blank: () => ({ kind: "healing-bonus", slotBonus: true })
  },
  {
    kind: "death-saves", label: "Better death saves", hint: "Defy Death: advantage, and 18–20 counting as a 20", group: "hit-points", when: false, scope: false,
    keywords: ["death save", "death saving throw", "dying", "defy death", "0 hp", "unconscious"],
    blank: () => ({ kind: "death-saves", advantage: true })
  },
  // AC & defenses
  {
    kind: "armor-class-bonus", label: "AC bonus", hint: "A flat bonus or an ability modifier", group: "defense", when: false, scope: false, short: "AC bonus",
    keywords: ["ac", "armor class", "armour class", "armor", "armour", "defense", "defence", "ring of protection", "cloak of protection", "bracers", "shield of faith", "harder to hit"],
    examples: [
      { label: "+1, like a Ring or Cloak of Protection", hint: "they add 1 to its saves too: add a Bonus to its saves", effects: () => [{ kind: "armor-class-bonus", bonus: { base: 1 } }] },
      { label: "+2 with no armor or shield, like Bracers of Defense", effects: () => [{ kind: "armor-class-bonus", bonus: { base: 2 }, unarmoredOnly: true }] },
      { label: "+2, like Shield of Faith", effects: () => [{ kind: "armor-class-bonus", bonus: { base: 2 } }] }
    ],
    blank: () => ({ kind: "armor-class-bonus", bonus: { base: 1 } })
  },
  {
    kind: "unarmored-ac", label: "AC without armor", hint: "Unarmored Defense, Mage Armor: a base plus ability modifiers", group: "defense", when: false, scope: false,
    keywords: ["ac", "armor class", "armour class", "unarmored", "unarmoured", "mage armor", "natural armor", "draconic resilience", "no armor"],
    examples: [
      { label: "Barbarian's Unarmored Defense", hint: "10 + DEX + CON", effects: () => [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "con"] }] },
      { label: "Monk's Unarmored Defense", hint: "10 + DEX + WIS, without a shield", effects: () => [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "wis"], noShield: true }] },
      { label: "Mage Armor", hint: "13 + DEX", effects: () => [{ kind: "unarmored-ac", base: 13, abilities: ["dex"] }] }
    ],
    blank: () => ({ kind: "unarmored-ac", base: 10, abilities: ["dex", "con"] })
  },
  {
    kind: "damage-adjustment", label: "Resistance, immunity or vulnerability", hint: "To one or more damage types, or absorbing them as healing", group: "defense", when: "self", scope: false, short: "Resistance",
    keywords: [
      "resist", "resistance", "resistant", "immune", "immunity", "vulnerable", "vulnerability", "damage type", "absorb", "nonmagical", "acid", "cold", "fire",
      "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder", "bludgeoning", "piercing", "slashing"
    ],
    examples: [
      { label: "Fire resistance, like a Ring of Resistance", hint: "pick another damage type on the card", effects: () => [{ kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "fire" } }] },
      { label: "Bludgeoning, piercing and slashing resistance, like Rage", effects: () => RESIST_BPS() },
      { label: "Nonmagical weapon resistance", hint: "bludgeoning, piercing and slashing from nonmagical attacks, as many monsters have", keywords: ["monster"], effects: () => RESIST_BPS(true) },
      { label: "Poison immunity", effects: () => [{ kind: "damage-adjustment", condition: "always", adjustment: { type: "immunity", damageType: "poison" } }] }
    ],
    blank: () => ({ kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "fire" } })
  },
  {
    kind: "condition-immunity", label: "Immune to a condition", hint: "Mindless Rage while raging; on an aura, its allies too (Aura of Courage)", group: "defense", when: false, scope: false, short: "Condition immunity",
    keywords: ["immune", "immunity", "condition", "frightened", "fear", "charmed", "charm", "poisoned", "paralyzed", "restrained", "stunned", "prone", "aura of courage", "mindless rage"],
    examples: [
      { label: "Can't be charmed or frightened", effects: () => [{ kind: "condition-immunity", conditions: ["charmed", "frightened"] }] },
      { label: "Can't be paralyzed or restrained, like Freedom of Movement", keywords: ["free action"], effects: () => [{ kind: "condition-immunity", conditions: ["paralyzed", "restrained"] }] }
    ],
    blank: () => ({ kind: "condition-immunity", conditions: ["frightened"] })
  },
  {
    kind: "shed-conditions", label: "Ends a condition on itself each turn", hint: "Self-Restoration: one of Charmed, Frightened or Poisoned at the end of its turn", group: "defense", when: false, scope: false,
    keywords: ["end a condition", "shake off", "self restoration", "recover", "frightened", "charmed", "poisoned", "condition"],
    blank: () => ({ kind: "shed-conditions", conditions: ["charmed", "frightened", "poisoned"], timing: "turn-end" })
  },
  {
    kind: "incoming-attack-modifier", label: "Attacks against it", hint: "Attackers have advantage or disadvantage", group: "defense", when: "self", scope: false, short: "Attacks against it",
    keywords: ["attacks against", "attackers", "dodge", "blur", "harder to hit", "easier to hit", "disadvantage against", "advantage against"],
    examples: [
      { label: "Attackers have disadvantage, like Blur or Dodge", effects: () => [{ kind: "incoming-attack-modifier", condition: "always", amount: -5 }] },
      { label: "Attackers have advantage, like Reckless Attack's price", effects: () => [{ kind: "incoming-attack-modifier", condition: "always", amount: 5 }] }
    ],
    blank: () => ({ kind: "incoming-attack-modifier", condition: "always", amount: -5 })
  },
  {
    kind: "no-advantage-against", label: "No advantage against it", hint: "Elusive: attack rolls against it can't have advantage while it can act", group: "defense", when: false, scope: false,
    keywords: ["elusive", "advantage", "attacks against"],
    blank: () => ({ kind: "no-advantage-against" })
  },
  {
    kind: "attack-defense", label: "Disadvantage on some attacks against it", hint: "Escape the Horde: opportunity attacks; Multiattack Defense: further attacks this turn by one that hit it", group: "defense", when: false, scope: false,
    keywords: ["opportunity attack", "disadvantage", "defensive tactics", "attacks against"],
    examples: [
      { label: "Escape the Horde", hint: "opportunity attacks against it", effects: () => [{ kind: "attack-defense", against: "opportunity" }] },
      { label: "Multiattack Defense", hint: "a creature's further attacks this turn, once it has hit", effects: () => [{ kind: "attack-defense", against: "after-hit" }] }
    ],
    blank: () => ({ kind: "attack-defense", against: "opportunity" })
  },
  {
    kind: "no-critical-hits", label: "No critical hits against it", hint: "Adamantine armor: a critical hit becomes a normal hit", group: "defense", when: false, scope: false,
    keywords: ["crit", "critical", "critical hit", "adamantine"],
    blank: () => ({ kind: "no-critical-hits" })
  },
  {
    kind: "evasion", label: "Evasion", hint: "A DEX save for half takes none on a success", group: "defense", when: false, scope: false,
    keywords: ["dexterity save", "dex save", "half damage", "area", "fireball", "breath"],
    blank: () => ({ kind: "evasion" })
  },
  {
    kind: "melee-retaliation", label: "Hurts what hits it in melee", hint: "Heated Body, a balor's Fire Aura", group: "defense", when: false, scope: false,
    keywords: ["fire aura", "heated body", "thorns", "spikes", "retaliate", "fire shield", "touch"],
    examples: [{ label: "Fire Shield's warm shield", hint: "2d8 fire to a creature within 5 ft that hits it in melee", effects: () => [{ kind: "melee-retaliation", damage: [{ dice: "2d8", damageType: "fire" }], withinFt: 5 }] }],
    blank: () => ({ kind: "melee-retaliation", damage: [{ dice: "1d10", damageType: "fire" }], withinFt: 5 })
  },
  // Attacks & damage
  {
    kind: "attack-bonus", label: "Bonus to hit", hint: "A flat bonus or an ability modifier on its attack rolls", group: "attacks", when: "attack", scope: true, short: "Bonus to hit",
    keywords: ["to hit", "hit", "attack roll", "attack bonus", "accuracy", "magic weapon", "spell attack"],
    examples: [
      { label: "Archery", hint: "+2 on ranged attacks", effects: () => [{ kind: "attack-bonus", condition: "always", bonus: { base: 2 }, attackTypes: ["ranged"] }] },
      { label: "+1 on spell attacks, like a Wand of the War Mage", effects: () => [{ kind: "attack-bonus", condition: "always", bonus: { base: 1 }, attackTypes: ["spell"] }] }
    ],
    blank: () => ({ kind: "attack-bonus", condition: "always", bonus: { base: 1 } })
  },
  {
    kind: "attack-advantage", label: "Advantage on its attacks", hint: "Or disadvantage: Pack Tactics, Reckless Attack", group: "attacks", when: "attack", scope: true, short: "Advantage on attacks",
    keywords: ["advantage", "disadvantage", "roll twice", "attack roll"],
    examples: [
      { label: "Pack Tactics", hint: "when an ally is next to the target", effects: () => [{ kind: "attack-advantage", condition: "ally-adjacent-to-target" }] },
      { label: "Reckless Attack", hint: "its melee Strength attacks", effects: () => [{ kind: "attack-advantage", condition: "always", attackTypes: ["melee"], abilities: ["str"] }] },
      { label: "Disadvantage on its attacks, like a curse", effects: () => [{ kind: "attack-advantage", condition: "always", mode: "disadvantage" }] }
    ],
    blank: () => ({ kind: "attack-advantage", condition: "always" })
  },
  {
    kind: "damage-bonus", label: "Extra damage on its hits", hint: "Sneak Attack, Rage's +2, Divine Fury", group: "attacks", when: "attack", scope: true, short: "Extra damage",
    keywords: ["damage", "extra damage", "more damage", "dueling", "radiant", "fire", "flame"],
    examples: [
      { label: "Dueling", hint: "+2 on melee hits", effects: () => [{ kind: "damage-bonus", condition: "always", attackTypes: ["melee"], damage: [{ dice: "2", damageType: "same-as-attack" }] }] },
      { label: "Rage's +2", hint: "on melee Strength hits", effects: () => [{ kind: "damage-bonus", condition: "always", attackTypes: ["melee"], abilities: ["str"], damage: [{ dice: "2", damageType: "same-as-attack" }] }] },
      {
        label: "Sneak Attack", hint: "3d6 once a turn, with advantage or an ally next to the target",
        effects: () => [{
          kind: "damage-bonus", oncePerTurn: true, condition: "always", anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"],
          attackTypes: ["melee", "ranged"], damage: [{ dice: "3d6", damageType: "same-as-attack" }]
        }]
      }
    ],
    blank: () => ({ kind: "damage-bonus", condition: "always", damage: [{ dice: "1d6", damageType: "same-as-attack" }] })
  },
  {
    kind: "save-gated-damage", label: "Damage on its hits, with a save", hint: "A poisonous bite: CON save or take more", group: "attacks", when: "attack", scope: true,
    keywords: ["poison", "venom", "venomous", "save", "bite", "sting", "damage"],
    blank: () => ({ kind: "save-gated-damage", condition: "always", damage: [{ dice: "2d6", damageType: "poison" }], save: { ability: "con", dc: 11, halfDamageOnSuccess: true } })
  },
  {
    kind: "apply-condition-on-hit", label: "A condition on its hits", hint: "A charge that knocks prone, a grab that restrains", group: "attacks", when: "attack", scope: true,
    keywords: ["condition", "prone", "knock down", "knocked prone", "grab", "restrain", "stun", "poisoned", "frightened", "on hit"],
    examples: [{
      label: "Knocked prone after a charge", hint: "a STR save, DC 13, when it closed 20 ft on the target this turn", keywords: ["charge", "trample"],
      effects: () => [{ kind: "apply-condition-on-hit", condition: "charged", appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 } }]
    }],
    blank: () => ({ kind: "apply-condition-on-hit", condition: "always", appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 } })
  },
  {
    kind: "damage-dice", label: "Better damage dice", hint: "Great Weapon Fighting's 1s and 2s as 3s, Savage Attacker's second roll", group: "attacks", when: "attack", scope: true,
    keywords: ["damage dice", "reroll damage", "minimum", "roll twice", "damage"],
    examples: [
      { label: "Great Weapon Fighting", hint: "1s and 2s count as 3s, two-handed melee", effects: () => [{ kind: "damage-dice", condition: "always", minimumDie: 3, attackTypes: ["melee"], twoHanded: true }] },
      { label: "Savage Attacker", hint: "rolls the damage dice twice once a turn, keeping the higher", effects: () => [{ kind: "damage-dice", condition: "always", rollTwice: true, oncePerTurn: true }] }
    ],
    blank: () => ({ kind: "damage-dice", condition: "always", minimumDie: 3 })
  },
  {
    kind: "critical-range", label: "Critical hits on a lower roll", hint: "Improved Critical: a 19 or 20; Superior Critical: 18 to 20", group: "attacks", when: "attack", scope: true,
    keywords: ["crit", "critical", "critical hit", "19", "18", "champion", "expanded crit"],
    examples: [
      { label: "Improved Critical", hint: "19 or 20", effects: () => [{ kind: "critical-range", condition: "always", minimum: 19 }] },
      { label: "Superior Critical", hint: "18 to 20", effects: () => [{ kind: "critical-range", condition: "always", minimum: 18 }] }
    ],
    blank: () => ({ kind: "critical-range", condition: "always", minimum: 19 })
  },
  {
    kind: "natural-twenty-damage", label: "Extra damage on a 20", hint: "Overwhelming Strike: the attack's ability score in extra damage when the d20 shows 20", group: "attacks", when: false, scope: true,
    keywords: ["natural 20", "nat 20", "20", "damage", "crit"],
    blank: () => ({ kind: "natural-twenty-damage" })
  },
  {
    kind: "ignore-resistance", label: "Damage that ignores resistance", hint: "Boon of Irresistible Offense: its bludgeoning, piercing and slashing damage", group: "attacks", when: false, scope: false,
    keywords: ["resistance", "ignore resistance", "irresistible", "penetrate", "bypass", "damage"],
    blank: () => ({ kind: "ignore-resistance", damageTypes: ["bludgeoning", "piercing", "slashing"] })
  },
  {
    kind: "incoming-hit-damage", label: "Hits against it deal more", hint: "A mark: the next hit on it deals extra damage", group: "attacks", when: "self", scope: false, conditionOnly: true,
    keywords: ["mark", "marked", "hunters mark", "hex", "curse", "damage"],
    examples: [
      {
        label: "Hunter's Mark", hint: "1d6 force on each hit from the creature that marked it",
        effects: () => [{ kind: "incoming-hit-damage", condition: "always", onlyFromSource: true, consumeCondition: false, critical: true, damage: [{ dice: "1d6", damageType: "force", magical: true }] }]
      },
      {
        label: "Hex", hint: "1d6 necrotic on each hit from the creature that cursed it",
        effects: () => [{ kind: "incoming-hit-damage", condition: "always", onlyFromSource: true, consumeCondition: false, critical: true, damage: [{ dice: "1d6", damageType: "necrotic", magical: true }] }]
      }
    ],
    blank: () => ({ kind: "incoming-hit-damage", condition: "always", damage: [{ dice: "1d6", damageType: "same-as-attack" }] })
  },
  {
    kind: "reaction-attack", label: "An attack back when hit", hint: "Retaliation: its reaction, one melee attack against the attacker", group: "attacks", when: false, scope: false,
    keywords: ["retaliation", "reaction", "riposte", "counterattack", "attack back", "hit back"],
    blank: () => ({ kind: "reaction-attack", trigger: { kind: "hit-by-attack", withinFt: 5, damaged: true }, attackTypes: ["melee"] })
  },
  {
    kind: "follow-up-attack", label: "Another attack at a creature beside the target", hint: "Horde Breaker: once a turn, after a weapon attack, one more at a creature within 5 ft of the first", group: "attacks", when: false, scope: true,
    keywords: ["horde breaker", "another attack", "extra attack", "cleave", "second target"],
    blank: () => ({ kind: "follow-up-attack", withinFt: 5 })
  },
  // Spells
  {
    kind: "save-dc-bonus", label: "Bonus to its save DCs", hint: "A spellcasting focus", group: "spells", when: false, scope: false, short: "Save DC bonus",
    keywords: ["dc", "save dc", "spell dc", "spell save", "focus", "rod", "wand", "staff", "spellcasting", "+1"],
    blank: () => ({ kind: "save-dc-bonus", bonus: { base: 1 }, spellsOnly: true })
  },
  {
    kind: "spell-damage-ability", label: "An ability on spell damage", hint: "Potent Spellcasting, Empowered Evocation: its modifier on one damage roll of some spells", group: "spells", when: false, scope: false,
    keywords: ["spell damage", "cantrip", "elemental affinity", "modifier", "damage"],
    examples: [
      { label: "Potent Spellcasting", hint: "WIS on its cantrips' damage", effects: () => [{ kind: "spell-damage-ability", ability: "wis", cantripsOnly: true }] },
      { label: "Empowered Evocation", hint: "INT on its evocation spells' damage", effects: () => [{ kind: "spell-damage-ability", ability: "int", spellSchools: ["evocation"] }] }
    ],
    blank: () => ({ kind: "spell-damage-ability", ability: "wis", cantripsOnly: true })
  },
  {
    kind: "spell-half-on-miss", label: "Half damage when a spell misses", hint: "Potent Cantrip: half on a miss or a made save, and nothing else", group: "spells", when: false, scope: false,
    keywords: ["cantrip", "miss", "half", "potent cantrip"],
    blank: () => ({ kind: "spell-half-on-miss", cantripsOnly: true })
  },
  {
    kind: "spell-range", label: "Longer spell range", hint: "Improved Elemental Fury: 300 ft more on a cantrip reaching 10 ft or more", group: "spells", when: false, scope: false,
    keywords: ["range", "distance", "farther", "spell range"],
    blank: () => ({ kind: "spell-range", bonus: 300, minRange: 10, cantripsOnly: true })
  },
  {
    kind: "spare-allies", label: "Allies spared by its area spells", hint: "Sculpt Spells: 1 + the spell's level of its allies succeed and take no damage", group: "spells", when: false, scope: false,
    keywords: ["sculpt spells", "allies", "friendly fire", "careful", "area", "safe"],
    blank: () => ({ kind: "spare-allies", base: 1, plusSpellLevel: true, spellSchools: ["evocation"] })
  },
  {
    kind: "max-damage", label: "Spells at their maximum damage", hint: "Overchannel: a Wizard spell of level 1-5 that deals damage, at its dice's highest, once", group: "spells", when: false, scope: false,
    keywords: ["overchannel", "maximum", "max damage", "maximize", "damage"],
    blank: () => ({ kind: "max-damage", maxSlot: 5, resourceCost: { resourceId: "overchannel", amount: 1 }, spellClasses: ["wizard"] })
  },
  {
    kind: "metamagic", label: "A Metamagic option", hint: "Quickened, Twinned, Heightened…: a copy of each spell it changes, for sorcery points", group: "spells", when: false, scope: false,
    keywords: ["metamagic", "quickened", "twinned", "heightened", "subtle", "distant", "empowered", "careful", "extended", "transmuted", "sorcery points", "sorcerer"],
    blank: () => ({ kind: "metamagic", option: "quickened", resourceCost: { resourceId: "sorcery-points", amount: 2 } })
  },
  {
    kind: "slot-recall", label: "A spell slot kept on a lucky roll", hint: "Boon of Spell Recall: a level 1-4 slot isn't spent when a d4 comes up its level", group: "spells", when: false, scope: false,
    keywords: ["spell slot", "slot", "recall", "keep"],
    blank: () => ({ kind: "slot-recall", maxLevel: 4, die: 4 })
  },
  // Saves & d20 rolls
  {
    kind: "save-bonus", label: "Bonus to its saves", hint: "All saves or one ability's", group: "saves", when: false, scope: false, short: "Bonus to saves",
    keywords: ["save", "saves", "saving throw", "saving throws", "cloak of protection", "ring of protection", "proficiency", "proficient", "bless", "+1"],
    examples: [
      { label: "+1 to every save, like a Cloak of Protection", effects: () => [{ kind: "save-bonus", bonus: { base: 1 } }] },
      {
        label: "Proficiency in one save, like Resilient", hint: "its proficiency bonus on Constitution saves: pick the ability on the card", keywords: ["resilient", "proficiency", "proficient"],
        effects: () => [{ kind: "save-bonus", ability: "con", bonus: { proficiency: true } }]
      },
      { label: "Its Charisma modifier on every save, like Aura of Protection", hint: "for its allies too: give the feature an Aura", effects: () => [{ kind: "save-bonus", bonus: { ability: "cha" } }] }
    ],
    blank: () => ({ kind: "save-bonus", bonus: { base: 1 } })
  },
  {
    kind: "save-advantage", label: "Advantage on its saves", hint: "Magic Resistance, against being frightened…", group: "saves", when: "self", scope: false, short: "Advantage on saves",
    keywords: ["save", "saves", "saving throw", "advantage", "spells", "magic", "concentration", "war caster", "frightened", "charmed", "brave"],
    examples: [
      { label: "Magic Resistance", hint: "against spells and other magical effects", effects: () => [{ kind: "save-advantage", against: { source: "magical" } }] },
      { label: "Against being charmed, like Fey Ancestry", effects: () => [{ kind: "save-advantage", against: { conditions: ["charmed"] } }] },
      { label: "Concentration saves, like Eldritch Mind", effects: () => [{ kind: "save-advantage", against: { concentration: true } }] },
      { label: "Dexterity saves, like Danger Sense", effects: () => [{ kind: "save-advantage", ability: "dex" }] }
    ],
    blank: () => ({ kind: "save-advantage" })
  },
  {
    kind: "save-floor", label: "A save no lower than the score", hint: "Indomitable Might: a Strength save totalling less than the score uses the score", group: "saves", when: false, scope: false,
    keywords: ["indomitable might", "minimum", "floor", "score", "save"],
    blank: () => ({ kind: "save-floor", ability: "str" })
  },
  {
    kind: "auto-succeed-save", label: "Turns a failed save into a success", hint: "Legendary Resistance, from a pool of uses", group: "saves", when: false, scope: false,
    keywords: ["legendary resistance", "succeed", "auto succeed", "automatically succeed", "save"],
    blank: () => ({ kind: "auto-succeed-save", resourceId: "legendary-resistance" })
  },
  {
    kind: "d20-change", label: "Change a failed roll", hint: "Luck, Indomitable, Heroic Inspiration: reroll a failed save or a missed attack, add a die, make it a 20, or hit", group: "saves", when: false, scope: false,
    keywords: ["reroll", "re roll", "luck", "lucky", "inspiration", "bardic inspiration", "d20", "natural 1"],
    examples: [{
      label: "Halfling Luck", hint: "reroll a natural 1 on an attack roll or a save", keywords: ["halfling"],
      effects: () => [{ kind: "d20-change", rolls: ["attack", "save"], change: "reroll", onNatural1: true }]
    }],
    blank: () => ({ kind: "d20-change", rolls: ["save"], change: "reroll" })
  },
  // Actions & turn
  {
    kind: "extra-action", label: "An extra action", hint: "Action Surge: when it activates, another action this turn", group: "turn", when: "self", scope: false,
    keywords: ["action surge", "extra action", "another action", "second action"],
    blank: () => ({ kind: "extra-action", slot: "action" })
  },
  {
    kind: "resource-regain", label: "Regains a resource", hint: "Points or charges back, each turn or when it activates", group: "turn", when: false, scope: false,
    keywords: ["regain", "recover", "recharge", "points", "charges", "ki", "focus points", "sorcery points", "uses"],
    blank: () => ({ kind: "resource-regain", timing: "turn-start", resourceId: "", amount: { base: 1 } })
  },
  {
    kind: "initiative", label: "Initiative", hint: "Advantage on the roll (Feral Instinct) or a bonus to it (Alert)", group: "turn", when: false, scope: false,
    keywords: ["initiative", "go first", "turn order"],
    examples: [
      { label: "Alert", hint: "its proficiency bonus on initiative", effects: () => [{ kind: "initiative", bonus: { proficiency: true } }] },
      { label: "Feral Instinct", hint: "advantage on initiative", effects: () => [{ kind: "initiative", advantage: true }] }
    ],
    blank: () => ({ kind: "initiative", advantage: true })
  },
  // Class & monster mechanics
  {
    kind: "on-hit-option", label: "An upgrade it can add to a hit", hint: "Eldritch Smite, Fire's Burn, Cunning Strike: a choice made on a hit, paid with a use or with Sneak Attack dice", group: "mechanics", when: false, scope: false,
    keywords: ["smite", "on hit", "upgrade", "eldritch smite", "cunning strike", "fires burn"],
    blank: () => ({ kind: "on-hit-option", option: { name: "Upgrade", riders: [] } })
  },
  {
    kind: "paired-on-hit-options", label: "Two on-hit options on one hit", hint: "Improved Cunning Strike: two Cunning Strike effects at once, paying both in Sneak Attack dice", group: "mechanics", when: false, scope: false,
    keywords: ["improved cunning strike", "cunning strike", "rogue"],
    blank: () => ({ kind: "paired-on-hit-options", featureId: "" })
  },
  {
    kind: "mastery-swap", label: "Another mastery for an attack", hint: "Tactical Master: Push, Sap or Slow in place of a weapon's own mastery", group: "mechanics", when: false, scope: false,
    keywords: ["weapon mastery", "mastery", "tactical master", "push", "sap", "slow"],
    blank: () => ({ kind: "mastery-swap", masteries: ["push", "sap", "slow"] })
  },
  {
    kind: "martial-arts-weapons", label: "Monk weapons as its Unarmed Strike", hint: "Martial Arts: Dexterity, the Martial Arts die and Stunning Strike on its Monk weapons too", group: "mechanics", when: false, scope: false,
    keywords: ["monk", "martial arts", "unarmed strike"],
    blank: () => ({ kind: "martial-arts-weapons", weaponId: "" })
  },
  {
    kind: "metamagic-boost", label: "More Metamagic while a condition lasts", hint: "Sorcery Incarnate: two options on a spell; Arcane Apotheosis: one free option a turn, while Innate Sorcery is active", group: "mechanics", when: false, scope: false,
    keywords: ["metamagic", "sorcery incarnate", "arcane apotheosis", "innate sorcery"],
    blank: () => ({ kind: "metamagic-boost", whileCondition: "innate-sorcery-active", pairs: true })
  },
  {
    kind: "condition-persists", label: "An activation that keeps going on its own", hint: "Persistent Rage: Rage needs no attacks to keep it up, and only falling unconscious ends it early", group: "mechanics", when: false, scope: false,
    keywords: ["persistent rage", "rage", "keeps going", "duration", "upkeep"],
    blank: () => ({ kind: "condition-persists", conditionId: "rage-active", durationRounds: 100 })
  },
  {
    kind: "swarm-damage", label: "Swarm damage", hint: "Its attacks weaken once it's down to half its hit points", group: "mechanics", when: false, scope: true,
    keywords: ["swarm", "bloodied", "half hit points"],
    blank: () => ({ kind: "swarm-damage", fullHpDamage: [{ dice: "4d4", damageType: "piercing" }], bloodiedDamage: [{ dice: "2d4", damageType: "piercing" }] })
  },
  {
    kind: "split-on-damage", label: "Splits when damaged", hint: "An ochre jelly hit by slashing or lightning", group: "mechanics", when: false, scope: false,
    keywords: ["split", "ooze", "jelly", "pudding", "divide"],
    blank: () => ({ kind: "split-on-damage", triggerDamageTypes: ["slashing"], minHp: 10 })
  }
];

export const EFFECT_SPECS = Object.fromEntries(EFFECT_KINDS.map((spec) => [spec.kind, spec])) as Record<EffectKind, EffectKindSpec>;

/** The usual effects for what they belong to, in the picker's Common row. Each has a `short` name. */
export const COMMON: Record<EffectOwner, EffectKind[]> = {
  item: ["armor-class-bonus", "save-bonus", "damage-adjustment", "attack-bonus", "damage-bonus", "save-advantage", "save-dc-bonus"],
  buff: ["attack-bonus", "attack-advantage", "armor-class-bonus", "save-bonus", "damage-adjustment", "damage-bonus", "incoming-attack-modifier"],
  feature: ["damage-adjustment", "save-advantage", "damage-bonus", "attack-advantage", "armor-class-bonus", "condition-immunity", "hp-regen"]
};

/* ─── finding an effect ──────────────────────────────────────────────────── */

const STOP_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "is", "it", "its", "like", "of", "on", "or", "the", "to", "with"]);

/** Text as search words: lower case, apostrophes dropped ("hunter's" is "hunters"), split on anything else. */
const words = (text: string): string[] => text.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9+]+/).filter(Boolean);

/** A query's words, without the little ones ("of", "the", "like"). */
export function searchTokens(query: string): string[] {
  return words(query).filter((word) => !STOP_WORDS.has(word));
}

/** Where a word was found, and what finding it there is worth: whole, or as the start of a longer word. */
interface SearchField {
  words: string[];
  phrases: string[];
  exact: number;
  prefix: number;
}

const field = (texts: string[], exact: number, prefix: number): SearchField => ({
  words: texts.flatMap(words),
  phrases: texts.map((text) => words(text).join(" ")),
  exact,
  prefix
});

function tokenScore(token: string, fields: SearchField[]): number {
  let best = 0;
  for (const { words: list, exact, prefix } of fields) {
    for (const word of list) {
      if (word === token) best = Math.max(best, exact);
      else if (token.length >= 2 && word.startsWith(token)) best = Math.max(best, prefix);
    }
  }
  return best;
}

/** The whole query is a label or a keyword: a name typed in full ("magic resistance") beats words scattered across hints. */
function phraseBonus(query: string, fields: SearchField[]): number {
  let best = 0;
  for (const { phrases } of fields) {
    for (const phrase of phrases) {
      if (phrase === query) best = Math.max(best, 10);
      else if (query.length >= 3 && phrase.startsWith(query)) best = Math.max(best, 4);
    }
  }
  return best;
}

const kindFields = (spec: EffectKindSpec) => [field([spec.label], 6, 4), field(spec.keywords, 5, 3), field([spec.hint], 2, 1)];
const exampleFields = (example: EffectExample) => [field([example.label], 6, 4), field(example.keywords ?? [], 5, 3), field(example.hint ? [example.hint] : [], 2, 1)];

export interface EffectSearchResult {
  spec: EffectKindSpec;
  /** How well the kind matches on its own; 0 when only an example does. */
  score: number;
  /** Its examples to show: the ones that match, best first, and with a matching kind, the rest after them (score 0). */
  examples: Array<{ example: EffectExample; score: number }>;
}

/** What a search result's best row is: the kind's, or an example's when one matched better. */
export function bestOf(result: EffectSearchResult): { score: number; example?: EffectExample } {
  const [top] = result.examples;
  return top && top.score > result.score ? { score: top.score, example: top.example } : { score: result.score };
}

/**
 * The kinds, and their examples, that a search finds, best first. Every word of the query must be found, in the kind's
 * label, keywords or hint, or for an example in its own (with at least one word its own, so "resistance fire" finds
 * "Fire resistance…" but "resistance" alone lists the kind and all of its examples). A word counts whole or as the start
 * of a longer one ("resist" finds "resistance"); the label counts most, then keywords, then the hint.
 */
export function searchEffects(query: string, offered: (spec: EffectKindSpec) => boolean = () => true): EffectSearchResult[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const phrase = tokens.join(" ");
  const results: Array<EffectSearchResult & { order: number }> = [];
  EFFECT_KINDS.forEach((spec, order) => {
    if (!offered(spec)) return;
    const own = kindFields(spec);
    const kindScores = tokens.map((token) => tokenScore(token, own));
    const score = kindScores.every((value) => value > 0) ? kindScores.reduce((sum, value) => sum + value, 0) + phraseBonus(phrase, own) : 0;
    const examples = (spec.examples ?? []).map((example, index) => {
      const fields = exampleFields(example);
      const mine = tokens.map((token) => tokenScore(token, fields));
      if (!mine.some((value) => value > 0)) return { example, score: 0, index };
      const either = mine.map((value, i) => Math.max(value, kindScores[i]!));
      if (!either.every((value) => value > 0)) return { example, score: 0, index };
      // Words only the kind has count a little less than the example's own.
      const borrowed = mine.every((value) => value > 0) ? 0 : 1;
      return { example, score: either.reduce((sum, value) => sum + value, 0) + phraseBonus(phrase, fields) - borrowed, index };
    });
    const matched = examples.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
    if (!score && !matched.length) return;
    const rest = score ? examples.filter((entry) => entry.score === 0) : [];
    results.push({ spec, score, examples: [...matched, ...rest].map(({ example, score: value }) => ({ example, score: value })), order });
  });
  return results
    .sort((a, b) => bestOf(b).score - bestOf(a).score || a.order - b.order)
    .map(({ order: _order, ...result }) => result);
}

/** Effects that fire once, the moment a feature activates: the engine reads them from the feature, not its condition. */
export function firesOnActivate(effect: FeatureEffect): boolean {
  return effect.kind === "extra-action" || (effect.kind === "resource-regain" && effect.timing === "on-activate");
}

/* ─── "When" ─────────────────────────────────────────────────────────────── */

export const WHEN_CONDITIONS: Array<{ value: Exclude<FeatureCondition, "always">; label: string }> = [
  { value: "attack-has-advantage", label: "the attack has advantage" },
  { value: "ally-adjacent-to-target", label: "an ally is next to the target" },
  { value: "charged", label: "it charged the target" },
  { value: "self-bloodied", label: "it's bloodied" },
  { value: "target-bloodied", label: "the target is bloodied" },
  { value: "target-injured", label: "the target is hurt" },
  { value: "target-surprised", label: "the target is surprised" },
  { value: "target-grappled-by-self", label: "it's grappling the target" },
  { value: "attack-has-no-disadvantage", label: "the attack has no disadvantage" }
];

/** What an effect checked on the creature alone can ask: the engine reads only whether it's bloodied. */
export const SELF_WHEN_CONDITIONS: typeof WHEN_CONDITIONS = [{ value: "self-bloodied", label: "it's bloodied" }];

/** The conditions an effect needs, and whether all of them must hold or any one. Nothing listed means always. */
export interface WhenValue {
  conditions: Array<Exclude<FeatureCondition, "always">>;
  mode: "any" | "all";
  chargeFeet?: number;
}

type Gated = { condition?: FeatureCondition; allConditions?: FeatureCondition[]; anyConditions?: FeatureCondition[]; chargeFeet?: number };

/** An effect's "When", read from `condition`, `allConditions` and `anyConditions` however they're spelled. */
export function whenOf(effect: FeatureEffect): WhenValue {
  const gated = effect as Gated;
  const real = (list: FeatureCondition[] | undefined) => (list ?? []).filter((c): c is Exclude<FeatureCondition, "always"> => c !== "always");
  const main = real(gated.condition ? [gated.condition] : []);
  const any = real(gated.anyConditions);
  const all = real(gated.allConditions);
  if (any.length) return { conditions: [...new Set([...main, ...any])], mode: "any", chargeFeet: gated.chargeFeet };
  if (all.length) return { conditions: [...new Set([...main, ...all])], mode: "all", chargeFeet: gated.chargeFeet };
  // One condition or none: a second one picked means either will do (Sneak Attack), until the DM says all.
  return { conditions: main, mode: "any", chargeFeet: gated.chargeFeet };
}

/**
 * The effect with a new "When": one condition goes in `condition`; several go in `anyConditions` or `allConditions`
 * with `condition` "always" (which `attack-advantage` requires and the rest read as "no extra condition").
 */
export function withWhen<E extends FeatureEffect>(effect: E, when: WhenValue): E {
  const next = { ...effect } as E & Gated;
  delete next.allConditions;
  delete next.anyConditions;
  delete next.chargeFeet;
  const [only] = when.conditions;
  if (when.conditions.length <= 1) {
    next.condition = only ?? "always";
  } else {
    next.condition = "always";
    if (when.mode === "any") next.anyConditions = [...when.conditions];
    else next.allConditions = [...when.conditions];
  }
  // A charge distance only means something with "charged"; one that was spelled out (even the default 20) stays.
  if (when.conditions.includes("charged") && when.chargeFeet !== undefined) next.chargeFeet = when.chargeFeet;
  return next;
}

/* ─── resistances, folded into one card per kind ─────────────────────────── */

/** The cards a list of effects shows: resistances of one kind (and qualifiers) fold into a single card. */
export interface EffectCardView {
  effect: FeatureEffect;
  /** The places in the list it stands for (several for a folded resistance). */
  indices: number[];
  /** For a folded resistance: every damage type it covers. */
  damageTypes?: DamageAdjustment["damageType"][];
}

const adjustmentKey = (effect: Extract<FeatureEffect, { kind: "damage-adjustment" }>) => {
  const { type, nonMagicalOnly, exceptMaterials } = effect.adjustment;
  const when = whenOf(effect);
  return `${type}|${nonMagicalOnly ? 1 : 0}|${[...(exceptMaterials ?? [])].sort().join(",")}|${when.mode}:${when.conditions.join(",")}`;
};

/**
 * The cards for a list of effects. `apart` keeps the effects at those places a card of their own (the one just added,
 * while it's being edited), so a new resistance doesn't vanish into another before the DM has set it.
 */
export function effectCards(effects: FeatureEffect[], apart?: { from: number; count: number }): EffectCardView[] {
  const cards: EffectCardView[] = [];
  const folded = new Map<string, EffectCardView>();
  let own: EffectCardView | undefined;
  effects.forEach((effect, index) => {
    if (apart && index >= apart.from && index < apart.from + apart.count) {
      if (own && effect.kind === "damage-adjustment" && own.damageTypes) {
        own.indices.push(index);
        own.damageTypes.push(effect.adjustment.damageType);
        return;
      }
      own = { effect, indices: [index], ...(effect.kind === "damage-adjustment" ? { damageTypes: [effect.adjustment.damageType] } : {}) };
      cards.push(own);
      return;
    }
    if (effect.kind === "damage-adjustment") {
      const key = adjustmentKey(effect);
      const card = folded.get(key);
      if (card) {
        card.indices.push(index);
        card.damageTypes!.push(effect.adjustment.damageType);
        return;
      }
      const fresh: EffectCardView = { effect, indices: [index], damageTypes: [effect.adjustment.damageType] };
      folded.set(key, fresh);
      cards.push(fresh);
      return;
    }
    cards.push({ effect, indices: [index] });
  });
  return cards;
}

/** A folded resistance card back as one effect per damage type. */
export function expandCard(effect: FeatureEffect, damageTypes?: DamageAdjustment["damageType"][]): FeatureEffect[] {
  if (effect.kind !== "damage-adjustment") return [effect];
  const types = damageTypes?.length ? damageTypes : [effect.adjustment.damageType];
  return types.map((damageType) => ({ ...effect, adjustment: { ...effect.adjustment, damageType } }));
}

/**
 * The list with one card replaced (or removed, with `next` undefined): the card's effects go where its first one was,
 * everything else keeps its place.
 */
export function withCardReplaced(effects: FeatureEffect[], card: EffectCardView, next: FeatureEffect[] | undefined): FeatureEffect[] {
  const first = Math.min(...card.indices);
  const out: FeatureEffect[] = [];
  effects.forEach((effect, index) => {
    if (index === first && next) out.push(...next);
    if (!card.indices.includes(index)) out.push(effect);
  });
  return out;
}

/** Condition modifiers an activation can grant directly (Reckless Attack's attackers-get-advantage). */
export type ConditionModifiers = NonNullable<ConditionInstance["modifiers"]>;

/* ─── a condition's modifiers, as cards beside its effects ───────────────── */

/**
 * One of a condition's modifiers (Shield's +5 AC, Reckless Attack's attackers-have-advantage) as a card. Most read as
 * the effect that says the same and edit with that kind's fields, kept to what a modifier can hold (a number, no
 * "When"). Saving throws are a card per bonus, with the saves it covers; what has no effect to match (speed, actions
 * it can't take) is shown, and can be removed, but not edited.
 */
export interface ModifierCardView {
  key: keyof ConditionModifiers;
  /** The effect that says the same, for its sentence and fields. */
  effect?: FeatureEffect;
  /** Saving throws: the abilities that share this bonus. */
  abilities?: Ability[];
  /** Resistances and the like: every damage type the card covers. */
  damageTypes?: DamageAdjustment["damageType"][];
}

const ALL_ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const READ_ONLY_MODIFIERS = [
  "movementMultiplier", "speedPenaltyFt", "deniesActions", "deniesBonusActions", "deniesReactions", "deniesOpportunityAttacks", "oneThingPerTurn",
  "forcesRandomAction", "noSpellcasting", "fleesFromSource", "flySpeed", "sizeTo", "speedBonusFt"
] as const;

export function modifierCards(modifiers: ConditionModifiers | undefined): ModifierCardView[] {
  if (!modifiers) return [];
  const cards: ModifierCardView[] = [];
  if (modifiers.armorClass) cards.push({ key: "armorClass", effect: { kind: "armor-class-bonus", bonus: { base: modifiers.armorClass } } });
  if (modifiers.attackRoll) cards.push({ key: "attackRoll", effect: { kind: "attack-bonus", condition: "always", bonus: { base: modifiers.attackRoll } } });
  if (modifiers.incomingAttackRoll) cards.push({ key: "incomingAttackRoll", effect: { kind: "incoming-attack-modifier", condition: "always", amount: modifiers.incomingAttackRoll } });
  // A card per bonus: Bless-style +2 to every save is one card; +2 WIS and +1 CON are two.
  const byValue = new Map<number, Ability[]>();
  for (const ability of ALL_ABILITIES) {
    const value = modifiers.savingThrows?.[ability];
    if (value) byValue.set(value, [...(byValue.get(value) ?? []), ability]);
  }
  for (const [value, abilities] of byValue) {
    cards.push({ key: "savingThrows", abilities, effect: { kind: "save-bonus", ...(abilities.length === 1 ? { ability: abilities[0] } : {}), bonus: { base: value } } });
  }
  const adjustments = (modifiers.damageAdjustments ?? []).map((adjustment) => ({ kind: "damage-adjustment" as const, condition: "always" as const, adjustment }));
  for (const card of effectCards(adjustments)) cards.push({ key: "damageAdjustments", effect: card.effect, damageTypes: card.damageTypes });
  for (const key of READ_ONLY_MODIFIERS) {
    const value = modifiers[key];
    if (key === "movementMultiplier" ? value !== undefined && value !== 1 : Boolean(value)) cards.push({ key });
  }
  return cards;
}

/** Just the modifiers one card stands for, for its sentence. */
export function modifierCardPart(modifiers: ConditionModifiers, card: ModifierCardView): ConditionModifiers {
  if (!card.effect) return { [card.key]: modifiers[card.key] };
  return withModifierCard(undefined, { key: card.key }, { effect: card.effect, abilities: card.abilities, damageTypes: card.damageTypes }) ?? {};
}

/** The modifiers with one card's edit written back (or the card removed, with `next` undefined). */
export function withModifierCard(
  modifiers: ConditionModifiers | undefined,
  card: ModifierCardView,
  next: { effect: FeatureEffect; abilities?: Ability[]; damageTypes?: DamageAdjustment["damageType"][] } | undefined
): ConditionModifiers | undefined {
  const out: ConditionModifiers = { ...(modifiers ?? {}) };
  const number = (effect: FeatureEffect | undefined): number | undefined => {
    if (!effect) return undefined;
    if (effect.kind === "incoming-attack-modifier") return effect.amount || undefined;
    if (effect.kind === "armor-class-bonus" || effect.kind === "attack-bonus" || effect.kind === "save-bonus") return effect.bonus.base || undefined;
    return undefined;
  };
  switch (card.key) {
    case "armorClass":
    case "attackRoll":
    case "incomingAttackRoll": {
      const value = number(next?.effect);
      delete out[card.key];
      if (value !== undefined) out[card.key] = value;
      break;
    }
    case "savingThrows": {
      const saves = { ...(out.savingThrows ?? {}) };
      for (const ability of card.abilities ?? []) delete saves[ability];
      const value = number(next?.effect);
      if (value !== undefined) for (const ability of next?.abilities?.length ? next.abilities : ALL_ABILITIES) saves[ability] = value;
      delete out.savingThrows;
      if (Object.keys(saves).length) out.savingThrows = saves;
      break;
    }
    case "damageAdjustments": {
      const before = card.effect?.kind === "damage-adjustment" ? card.effect.adjustment : undefined;
      const types = new Set(card.damageTypes ?? []);
      const materials = (adjustment: DamageAdjustment) => [...(adjustment.exceptMaterials ?? [])].sort().join(",");
      const mine = (adjustment: DamageAdjustment) => Boolean(before) && adjustment.type === before!.type && types.has(adjustment.damageType)
        && Boolean(adjustment.nonMagicalOnly) === Boolean(before!.nonMagicalOnly) && materials(adjustment) === materials(before!);
      // The card's adjustments go; its edit takes the place of the first of them.
      const list = out.damageAdjustments ?? [];
      const first = list.findIndex(mine);
      const edited = next?.effect.kind === "damage-adjustment" ? next.effect.adjustment : undefined;
      const replaced = edited ? (next!.damageTypes?.length ? next!.damageTypes : [edited.damageType]).map((damageType) => ({ ...edited, damageType })) : [];
      const kept: DamageAdjustment[] = [];
      list.forEach((adjustment, index) => {
        if (index === first) kept.push(...replaced);
        if (!mine(adjustment)) kept.push(adjustment);
      });
      if (first < 0) kept.push(...replaced);
      delete out.damageAdjustments;
      if (kept.length) out.damageAdjustments = kept;
      break;
    }
    default:
      // Shown, not edited: only removing it is offered.
      if (!next) delete out[card.key];
  }
  return Object.keys(out).length ? out : undefined;
}

/* ─── bonus formulas ─────────────────────────────────────────────────────── */

/**
 * How a bonus is edited: a number (+1 AC), an ability's modifier (Aura of Protection's CHA), or a formula that adds more
 * (a number and a modifier, a proficiency bonus, a multiplier), which a card reads out and the JSON view changes.
 */
export function formulaShape(formula: NumericFormula): "number" | "ability" | "formula" {
  const plain = !formula.proficiency && (formula.multiplier ?? 1) === 1;
  if (plain && !formula.ability) return "number";
  if (plain && !formula.base) return "ability";
  return "formula";
}

/** A formula in words: "1 + CHA modifier + proficiency bonus", "half of proficiency bonus, rounded down". */
export function formulaWords(formula: NumericFormula): string {
  const ability = formula.ability === "spellcasting" ? "spellcasting modifier" : formula.ability ? `${formula.ability.toUpperCase()} modifier` : undefined;
  const parts = [
    ...(formula.base ? [String(formula.base)] : []),
    ...(ability ? [ability] : []),
    ...(formula.proficiency ? ["proficiency bonus"] : [])
  ];
  const sum = parts.length ? parts.join(" + ") : "0";
  const multiplier = formula.multiplier ?? 1;
  if (multiplier === 1) return sum;
  // The engine multiplies the whole sum, then drops any fraction.
  const whole = parts.length > 1 ? `(${sum})` : sum;
  return multiplier === 0.5 ? `half of ${whole}, rounded down` : `${whole} × ${multiplier}`;
}
