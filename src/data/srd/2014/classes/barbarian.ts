import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { choice, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns } from "../reference";

/**
 * The 2014 Barbarian and its Path of the Berserker (SRD 5.1). Rage, Unarmored Defense, Danger Sense, Fast Movement,
 * Feral Instinct and Relentless Rage run as their 2024 namesakes do; the 2014 rage helps only melee attacks, Reckless
 * Attack only melee attacks, and there's no Weapon Mastery, Primal Knowledge, Instinctive Pounce or Brutal Strike.
 */
const ref = srd14Class("barbarian");

const RAGE_ACTIVE = "rage-active";

const rage = runs("barbarian_rage", {
  grantedActions: [{
    kind: "activate-feature", id: "rage", name: "Rage", actionType: "bonus", featureId: "",
    resourceCost: { resourceId: "rage", amount: 1 },
    condition: {
      id: RAGE_ACTIVE, name: "custom", durationRounds: 10,
      // No spells or concentration; it lapses on a turn without an attack.
      modifiers: { noSpellcasting: true },
      upkeep: { by: ["attack"] },
      endsOnIncapacitated: true,
      effects: [
        // A melee weapon attack using Strength.
        { kind: "damage-bonus", abilities: ["str"], attackTypes: ["melee"], damage: [{ dice: "2", damageType: "same-as-attack" }] },
        { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "bludgeoning" } },
        { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "piercing" } },
        { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "slashing" } },
        { kind: "save-advantage", ability: "str" }
      ]
    },
    automationSupport: "full"
  }],
  notSimulated: "taking damage keeping the rage going (only an attack does), and only falling unconscious ending it early (being incapacitated does)."
});

const recklessAttack = runs("barbarian_reckless-attack", {
  grantedActions: [{
    kind: "activate-feature", id: "reckless-attack", name: "Reckless Attack", actionType: "free", featureId: "",
    condition: {
      id: "reckless-attack-active", name: "custom", durationRounds: 1,
      modifiers: { incomingAttackRoll: 5 },
      effects: [{ kind: "attack-advantage", condition: "always", abilities: ["str"], attackTypes: ["melee"] }]
    },
    automationSupport: "full"
  }]
});

export const BARBARIAN_2014: ClassDefinition = {
  id: "srd:class:barbarian-2014",
  name: "Barbarian",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 12,
  primaryAbilities: ["str"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "shield"],
  subclassLevel: 3,
  subclassLabel: "Primal Path",
  featLevels: [4, 8, 12, 16, 19],
  // Unlimited rages at 20th level: more than a fight can use.
  table: srd14Columns("barbarian").map((column) => (column.id === "rages" ? { ...column, values: column.values.map((value) => (typeof value === "number" ? value : 99)) } : column)),
  levels: [
    {
      level: 1,
      grants: [
        grant("rage", rage, {
          scale: [{ path: "grantedActions.0.condition.effects.0.damage.0.dice", value: "{col:rage-damage}" }],
          pool: { id: "rage", size: "{col:rages}" }
        }),
        grant("unarmored-defense", runs("barbarian_unarmored-defense", { effects: [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "con"] }] }))
      ]
    },
    {
      level: 2,
      grants: [
        // Advantage on Dexterity saves (against what it can see, unless blinded, deafened or incapacitated: not checked).
        grant("danger-sense", runs("barbarian_danger-sense", { effects: [{ kind: "save-advantage", ability: "dex" }] })),
        grant("reckless-attack", recklessAttack)
      ]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "barbarian_primal-path")] },
    {
      level: 5,
      grants: [
        grant("extra-attack", runs("barbarian_extra-attack", {
          grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attackAction: true, attacks: [{ any: "weapon", count: 2 }], automationSupport: "full" }]
        })),
        grant("fast-movement", runs("barbarian_fast-movement", { effects: [{ kind: "speed", bonusFt: 10, armor: "not-heavy" }] }))
      ]
    },
    {
      level: 7,
      grants: [grant("feral-instinct", runs("barbarian_feral-instinct", {
        effects: [{ kind: "initiative", advantage: true }],
        notSimulated: "acting while surprised by raging first."
      }))]
    },
    // One more weapon die on a melee critical hit (two at 13th, three at 17th): the engine has no extra critical dice yet.
    { level: 9, grants: [grant("brutal-critical", reference("barbarian_brutal-critical"))] },
    {
      level: 11,
      grants: [grant("relentless-rage", runs("barbarian_relentless-rage", {
        effects: [{ kind: "survive-lethal", whileCondition: RAGE_ACTIVE, save: { ability: "con", dcBase: 10 }, dcStep: 5 }]
      }))]
    },
    {
      level: 15,
      // No upkeep; only falling unconscious ends it early. Still a minute.
      grants: [grant("persistent-rage", runs("barbarian_persistent-rage", { effects: [{ kind: "condition-persists", conditionId: RAGE_ACTIVE, durationRounds: 10 }] }))]
    },
    // A Strength check's total below the Strength score uses the score: only escaping a grapple is a check in a fight.
    { level: 18, grants: [grant("indomitable-might", reference("barbarian_indomitable-might"))] },
    { level: 20, grants: [grant("primal-champion", informational("barbarian_primal-champion"), { adjust: { abilities: { str: 4, con: 4 }, abilityMax: 24 } })] }
  ],
  equipmentLines: [
    {
      id: "melee",
      options: [
        { id: "a", label: "(a) A greataxe", items: [{ ref: "srd:weapon:greataxe" }] },
        { id: "b", label: "(b) Any martial melee weapon", items: [], anyWeapon: { category: "martial", melee: true, count: 1 } }
      ]
    },
    {
      id: "second",
      options: [
        { id: "a", label: "(a) Two handaxes", items: [{ ref: "srd:weapon:handaxe", count: 2 }] },
        { id: "b", label: "(b) Any simple weapon", items: [], anyWeapon: { category: "simple", count: 1 } }
      ]
    },
    {
      id: "kit",
      options: [{ id: "a", label: "An explorer's pack and four javelins", items: [{ ref: "srd:weapon:javelin", count: 4 }] }]
    }
  ],
  suggested: {
    abilities: ["str", "con", "dex", "wis", "cha", "int"],
    tactics: "brute",
    background: "srd:background:acolyte-2014",
    skills: ["athletics", "perception", "intimidation", "survival"],
    equipmentLines: { melee: "a", second: "a", kit: "a" }
  },
  description: "A fierce warrior of primitive background who can enter a battle rage."
};

export const BERSERKER_2014: SubclassDefinition = {
  id: "srd:subclass:path-of-the-berserker-2014",
  name: "Path of the Berserker",
  source: srd51Source("srd_path-of-the-berserker"),
  edition: "2014",
  classId: "srd:class:barbarian-2014",
  levels: [
    // A melee weapon attack as a bonus action each turn while raging, and a level of exhaustion when the rage ends.
    { level: 3, grants: [grant("frenzy", reference("path-of-the-berserker_frenzy"))] },
    {
      level: 6,
      grants: [grant("mindless-rage", runs("path-of-the-berserker_mindless-rage", {
        effects: [{ kind: "condition-immunity", conditions: ["charmed", "frightened"], whileCondition: RAGE_ACTIVE }]
      }))]
    },
    {
      level: 10,
      // One creature within 30 ft: a Wisdom save or frightened until the end of the barbarian's next turn.
      grants: [grant("intimidating-presence", runs("path-of-the-berserker_intimidating-presence", {
        grantedActions: [{
          kind: "save", id: "intimidating-presence", name: "Intimidating Presence", actionType: "action", range: 30,
          saveAbility: "wis", dcFormula: { base: 8, ability: "cha", proficiency: true },
          damage: [], halfDamageOnSuccess: false, onSuccess: "none",
          riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "until-source-turn", timing: "end" } }],
          automationSupport: "full"
        }],
        notSimulated: "keeping it going with an action on later turns, and a creature that saves being safe from it for 24 hours."
      }))]
    },
    {
      level: 14,
      grants: [grant("retaliation", runs("path-of-the-berserker_retaliation", {
        effects: [{ kind: "reaction-attack", trigger: { kind: "hit-by-attack", withinFt: 5, damaged: true, anyDamage: true }, attackTypes: ["melee"] }]
      }))]
    }
  ]
};
