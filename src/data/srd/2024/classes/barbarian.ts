import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, weaponMasteryFeature } from "../authoring";
import { srd52Source, srdClass, srdColumns, srdNumbers } from "../reference";

const ref = srdClass("barbarian");

const RAGE_ACTIVE = "rage-active";

const rage = runs("barbarian_rage", {
  grantedActions: [{
    kind: "activate-feature", id: "rage", name: "Rage", actionType: "bonus", featureId: "",
    resourceCost: { resourceId: "rage", amount: 1 },
    condition: {
      id: RAGE_ACTIVE, name: "custom", durationRounds: 10,
      effects: [
        // Any attack using Strength: a weapon, a thrown weapon or an Unarmed Strike.
        { kind: "damage-bonus", abilities: ["str"], damage: [{ dice: "2", damageType: "same-as-attack" }] },
        { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "bludgeoning" } },
        { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "piercing" } },
        { kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "slashing" } },
        { kind: "save-advantage", ability: "str" }
      ]
    },
    automationSupport: "full"
  }],
  notSimulated: "it lasts the fight's first 10 rounds whether or not the barbarian keeps attacking, and raging doesn't stop it casting spells or concentrating."
});

const recklessAttack = runs("barbarian_reckless-attack", {
  grantedActions: [{
    kind: "activate-feature", id: "reckless-attack", name: "Reckless Attack", actionType: "free", featureId: "",
    condition: {
      id: "reckless-attack-active", name: "custom", durationRounds: 1,
      modifiers: { incomingAttackRoll: 5 },
      effects: [{ kind: "attack-advantage", condition: "always", abilities: ["str"] }]
    },
    automationSupport: "full"
  }]
});

const attacks = (key: string, count: number) => runs(key, {
  grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attacks: [{ any: "weapon", count }], automationSupport: "full" }]
});

export const BARBARIAN: ClassDefinition = {
  id: "srd:class:barbarian",
  name: "Barbarian",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 12,
  primaryAbilities: ["str"],
  saves: ["str", "con"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "shield"],
  weaponMastery: srdNumbers("barbarian", "weapon-mastery"),
  subclassLevel: 3,
  subclassLabel: "Barbarian Subclass",
  featLevels: [4, 8, 12, 16],
  table: srdColumns("barbarian"),
  levels: [
    {
      level: 1,
      grants: [
        grant("rage", rage, {
          scale: [{ path: "grantedActions.0.condition.effects.0.damage.0.dice", value: "{col:rage-damage}" }],
          pool: { id: "rage", size: "{col:rages}" }
        }),
        grant("unarmored-defense", runs("barbarian_unarmored-defense", { effects: [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "con"] }] })),
        grant("weapon-mastery", weaponMasteryFeature("barbarian_weapon-mastery"))
      ],
      choices: [choice({ kind: "weapon-mastery", id: "weapon-mastery" }, "barbarian_weapon-mastery")]
    },
    {
      level: 2,
      grants: [
        grant("danger-sense", runs("barbarian_danger-sense", { effects: [{ kind: "save-advantage", ability: "dex" }] })),
        grant("reckless-attack", recklessAttack)
      ]
    },
    {
      level: 3,
      grants: [grant("primal-knowledge", informational("barbarian_primal-knowledge"))],
      choices: [
        choice({ kind: "subclass", id: "subclass" }, "barbarian_barbarian-subclass"),
        choice({ kind: "skills", id: "primal-knowledge", count: 1, from: (ref.skills?.from as string[]) ?? [] }, "barbarian_primal-knowledge")
      ]
    },
    {
      level: 5,
      grants: [
        grant("extra-attack", attacks("barbarian_extra-attack", 2)),
        grant("fast-movement", informational("barbarian_fast-movement"), { adjust: { speed: 10 } })
      ]
    },
    {
      level: 7,
      grants: [
        grant("feral-instinct", reference("barbarian_feral-instinct")),
        grant("instinctive-pounce", reference("barbarian_instinctive-pounce"))
      ]
    },
    { level: 9, grants: [grant("brutal-strike", reference("barbarian_brutal-strike"))] },
    { level: 11, grants: [grant("relentless-rage", reference("barbarian_relentless-rage"))] },
    { level: 13, grants: [grant("improved-brutal-strike", reference("barbarian_improved-brutal-strike"))] },
    { level: 15, grants: [grant("persistent-rage", informational("barbarian_persistent-rage"))] },
    { level: 17, grants: [grant("improved-brutal-strike-enhanced", reference("barbarian_improved-brutal-strike-enhanced"))] },
    { level: 18, grants: [grant("indomitable-might", reference("barbarian_indomitable-might"))] },
    { level: 20, grants: [grant("primal-champion", informational("barbarian_primal-champion"), { adjust: { abilities: { str: 4, con: 4 }, abilityMax: 25 } })] }
  ],
  startingEquipment: [
    { id: "A", label: "A greataxe and four handaxes (and a pack and 15 GP)", items: [{ ref: "srd:weapon:greataxe" }, { ref: "srd:weapon:handaxe", count: 4 }], gold: 15 },
    { id: "B", label: "75 GP", items: [], gold: 75 }
  ],
  suggested: {
    abilities: ["str", "con", "dex", "wis", "cha", "int"],
    tactics: "brute",
    background: "srd:background:soldier",
    skills: ["athletics", "perception", "intimidation", "survival"],
    epicBoon: "srd:feat:boon-of-irresistible-offense",
    masteries: ["greataxe", "handaxe", "greatsword", "maul"],
    equipment: "A"
  },
  description: "A fierce warrior of primal rage."
};

export const BERSERKER: SubclassDefinition = {
  id: "srd:subclass:path-of-the-berserker",
  name: "Path of the Berserker",
  source: srd52Source("srd-2024_path-of-the-berserker"),
  edition: "2024",
  classId: "srd:class:barbarian",
  levels: [
    {
      level: 3,
      grants: [
        grant("frenzy", runs("path-of-the-berserker_frenzy", {
          effects: [{
            kind: "damage-bonus", oncePerTurn: true, whileCondition: RAGE_ACTIVE, condition: "attack-has-advantage",
            abilities: ["str"], damage: [{ dice: "2d6", damageType: "same-as-attack" }]
          }],
          notSimulated: "it's dealt on the first Strength hit each turn with advantage while raging, whether the advantage came from Reckless Attack or not."
        }), { scale: [{ path: "effects.0.damage.0.dice", value: "{col:rage-damage}d6" }] })
      ]
    },
    { level: 6, grants: [grant("mindless-rage", reference("path-of-the-berserker_mindless-rage"))] },
    { level: 10, grants: [grant("retaliation", reference("path-of-the-berserker_retaliation"))] },
    {
      level: 14,
      grants: [grant("intimidating-presence", runs("path-of-the-berserker_intimidating-presence", {
        grantedActions: [{
          kind: "area-save", id: "intimidating-presence", name: "Intimidating Presence", actionType: "bonus",
          range: 0, area: { type: "circle", size: 30 }, targeting: { origin: "self", range: 0 }, affects: "hostile",
          saveAbility: "wis", dcFormula: { base: 8, ability: "str", proficiency: true },
          damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
          riders: [{ kind: "condition", when: "on-save-fail", condition: "frightened", duration: { kind: "save-ends", saveAt: "turn-end" } }],
          resourceCost: { resourceId: "intimidating-presence", amount: 1 },
          automationSupport: "full"
        }]
      }), { pool: { id: "intimidating-presence", size: 1 } })]
    }
  ]
};
