import type { ActionRider, FeatureEffect, OnHitMove } from "@/engine";
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

const RECKLESS_ACTIVE = "reckless-attack-active";

/** Brutal Strike's effects: what each adds to the hit beyond the extra die. */
const BLOWS: Array<{ name: string; riders: ActionRider[]; move?: OnHitMove }> = [
  {
    // Only one at a time, the most recent: a keyed condition replaces itself.
    name: "Hamstring", riders: [{
      kind: "condition", when: "on-hit", condition: { custom: "Hamstrung" }, conditionKey: "Hamstring Blow",
      modifiers: { speedPenaltyFt: 15 }, duration: { kind: "until-source-turn", timing: "start" }
    }]
  },
  // Pushed 15 ft; the move toward it is half its speed, provoking no opportunity attacks (not held to a straight line).
  { name: "Forceful", riders: [{ kind: "push", when: "on-hit", distance: 15 }], move: { noOpportunityAttacks: true } },
  {
    name: "Staggering", riders: [
      { kind: "condition", when: "on-hit", condition: { custom: "Staggered" }, conditionKey: "Staggering Blow", nextSave: { mode: "disadvantage" }, duration: { kind: "permanent" } },
      {
        kind: "condition", when: "on-hit", condition: { custom: "No opportunity attacks" }, conditionKey: "Staggering Blow: no opportunity attacks",
        modifiers: { deniesOpportunityAttacks: true }, duration: { kind: "until-source-turn", timing: "start" }
      }
    ]
  },
  {
    name: "Sundering", riders: [{
      kind: "condition", when: "on-hit", condition: { custom: "Sundered" }, conditionKey: "Sundering Blow",
      nextAttack: { role: "against", bonus: 5, byOthers: true }, duration: { kind: "until-source-turn", timing: "start" }
    }]
  }
];

/**
 * A Brutal Strike with these blows: an on-hit option on a Strength attack roll, once a turn while Reckless Attack is on,
 * paid with the roll's advantage. On the hit, the extra damage of the weapon's type and each blow's effects.
 */
const brutalStrike = (blows: typeof BLOWS, dice: string): FeatureEffect => ({
  kind: "on-hit-option",
  option: {
    name: `Brutal Strike: ${blows.map((blow) => blow.name).join(" + ")} Blow${blows.length > 1 ? "s" : ""}`,
    abilities: ["str"], forgoesAdvantage: { whileCondition: RECKLESS_ACTIVE }, oncePerTurn: true, onceKey: "brutal-strike",
    riders: [{ kind: "damage", when: "on-hit", components: [{ dice, damageType: "same-as-attack" }] }, ...blows.flatMap((blow) => blow.riders)],
    ...(blows.some((blow) => blow.move) ? { move: { noOpportunityAttacks: true } } : {})
  }
});

/** Two different blows each (Improved Brutal Strike at 17th level). */
const PAIRS = BLOWS.flatMap((first, index) => BLOWS.slice(index + 1).map((second) => [first, second]));

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
        grant("feral-instinct", runs("barbarian_feral-instinct", { effects: [{ kind: "initiative", advantage: true }] })),
        grant("instinctive-pounce", runs("barbarian_instinctive-pounce", { effects: [{ kind: "free-move", on: { spends: "rage" } }] }))
      ]
    },
    { level: 9, grants: [grant("brutal-strike", runs("barbarian_brutal-strike", { effects: BLOWS.slice(0, 2).map((blow) => brutalStrike([blow], "1d10")) }))] },
    {
      level: 11,
      grants: [grant("relentless-rage", runs("barbarian_relentless-rage", {
        effects: [{ kind: "survive-lethal", whileCondition: "rage-active", save: { ability: "con", dcBase: 10 }, dcStep: 5, hpTo: 22 }]
      }), { scale: [{ path: "effects.0.hpTo", value: "{level*2}" }] })]
    },
    // All four blows (Brutal Strike's two among them), the earlier feature's place taken.
    {
      level: 13,
      grants: [grant("improved-brutal-strike", runs("barbarian_improved-brutal-strike", { effects: BLOWS.map((blow) => brutalStrike([blow], "1d10")) }), { replaces: "brutal-strike" })]
    },
    { level: 15, grants: [grant("persistent-rage", informational("barbarian_persistent-rage"))] },
    // 2d10, and two different blows: one costs no more than two, so every Brutal Strike is a pair.
    {
      level: 17,
      grants: [grant("improved-brutal-strike-enhanced", runs("barbarian_improved-brutal-strike-enhanced", {
        effects: PAIRS.map((pair) => brutalStrike(pair, "2d10"))
      }), { replaces: "improved-brutal-strike" })]
    },
    { level: 18, grants: [grant("indomitable-might", runs("barbarian_indomitable-might", { effects: [{ kind: "save-floor", ability: "str" }] }))] },
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
    {
      level: 6,
      grants: [grant("mindless-rage", runs("path-of-the-berserker_mindless-rage", {
        effects: [{ kind: "condition-immunity", conditions: ["charmed", "frightened"], whileCondition: RAGE_ACTIVE }]
      }))]
    },
    {
      level: 10,
      grants: [grant("retaliation", runs("path-of-the-berserker_retaliation", {
        effects: [{ kind: "reaction-attack", trigger: { kind: "hit-by-attack", withinFt: 5, damaged: true }, attackTypes: ["melee"] }],
        notSimulated: "damage from within 5 feet that isn't an attack's hit (a spell's save, an aura) doesn't offer it."
      }))]
    },
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
