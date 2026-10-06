import type { FeatureEffect, OnHitOption } from "@/engine";
import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, weaponMasteryFeature } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("rogue");

const sneakAttack = runs("rogue_sneak-attack", {
  effects: [{
    kind: "damage-bonus",
    oncePerTurn: true,
    // Advantage, or an ally next to the target and no disadvantage.
    condition: "attack-has-no-disadvantage",
    anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"],
    attackTypes: ["melee", "ranged"],
    weaponProperties: ["finesse", "ranged"],
    damage: [{ dice: "1d6", damageType: "same-as-attack" }]
  }]
});

/** The builder's id for Sneak Attack (the class's id prefix and the grant's key): what Cunning Strike spends dice of. */
const SNEAK_ATTACK_ID = "rogue-sneak-attack";
/** A Cunning Strike save's DC: 8 + Dexterity modifier + proficiency bonus. */
const CUNNING_DC = { base: 8, ability: "dex" as const, proficiency: true };

/** A Cunning Strike effect: an on-hit option paid in Sneak Attack dice, landing only with Sneak Attack's damage. */
const cunningStrike = (name: string, dice: number, option: Partial<OnHitOption>): FeatureEffect => ({
  kind: "on-hit-option",
  option: { name: `Cunning Strike: ${name}`, tradesDice: { featureId: SNEAK_ATTACK_ID, dice }, riders: [], ...option }
});

const cunningStrikes = runs("rogue_cunning-strike", {
  effects: [
    // Poison assumes the rogue carries a Poisoner's Kit.
    cunningStrike("Poison", 1, {
      riders: [{
        kind: "condition", when: "on-hit", condition: "poisoned", duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" },
        save: { ability: "con", dcFormula: CUNNING_DC, onSuccess: "negates" }
      }]
    }),
    cunningStrike("Trip", 1, {
      riders: [{
        kind: "condition", when: "on-hit", condition: "prone", maxSize: "large", duration: { kind: "until-start-of-next-turn" },
        save: { ability: "dex", dcFormula: CUNNING_DC, onSuccess: "negates" }
      }]
    }),
    cunningStrike("Withdraw", 1, { move: { noOpportunityAttacks: true } })
  ]
});

const deviousStrikes = runs("rogue_devious-strikes", {
  effects: [
    cunningStrike("Knock Out", 6, {
      riders: [{
        kind: "condition", when: "on-hit", condition: "unconscious", endsOnDamage: true,
        duration: { kind: "rounds", rounds: 10, repeatSaveAt: "turn-end" },
        save: { ability: "con", dcFormula: CUNNING_DC, onSuccess: "negates" }
      }]
    }),
    cunningStrike("Obscure", 3, {
      riders: [{
        kind: "condition", when: "on-hit", condition: "blinded", duration: { kind: "until-end-of-next-turn" },
        save: { ability: "dex", dcFormula: CUNNING_DC, onSuccess: "negates" }
      }]
    }),
    // On its next turn it can only move, take an action or take a bonus action.
    cunningStrike("Daze", 2, {
      riders: [{
        kind: "condition", when: "on-hit", condition: { custom: "Dazed" }, conditionKey: "Daze", modifiers: { oneThingPerTurn: true },
        duration: { kind: "until-end-of-next-turn" }, save: { ability: "con", dcFormula: CUNNING_DC, onSuccess: "negates" }
      }]
    })
  ]
});

const cunningAction = runs("rogue_cunning-action", {
  grantedActions: [
    { kind: "utility", id: "cunning-dash", name: "Cunning Action: Dash", actionType: "bonus", mode: "dash", automationSupport: "full" },
    { kind: "utility", id: "cunning-disengage", name: "Cunning Action: Disengage", actionType: "bonus", mode: "disengage", automationSupport: "full" },
    { kind: "utility", id: "cunning-hide", name: "Cunning Action: Hide", actionType: "bonus", mode: "hide", automationSupport: "partial" }
  ]
});

const steadyAim = runs("rogue_steady-aim", {
  grantedActions: [{
    kind: "activate-feature", id: "steady-aim", name: "Steady Aim", actionType: "bonus", featureId: "",
    // Before moving; advantage on its next attack roll, and no more movement, this turn.
    stillOnly: true,
    condition: {
      id: "steady-aim-active", name: "custom", durationRounds: 0,
      modifiers: { movementMultiplier: 999 },
      nextAttack: { role: "made", mode: "advantage" }
    },
    automationSupport: "full"
  }]
});

export const ROGUE: ClassDefinition = {
  id: "srd:class:rogue",
  name: "Rogue",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["dex"],
  // As a multiclass character: one skill from the class's list.
  multiclass: { skills: 1 },
  saves: ["dex", "int"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial-finesse-or-light"],
  armorTraining: ["light"],
  weaponMastery: Array(20).fill(2),
  subclassLevel: 3,
  subclassLabel: "Rogue Subclass",
  featLevels: [4, 8, 10, 12, 16],
  table: srdColumns("rogue"),
  levels: [
    {
      level: 1,
      grants: [
        grant("sneak-attack", sneakAttack, { scale: [{ path: "effects.0.damage.0.dice", value: "{col:sneak-attack}" }] }),
        grant("thieves-cant", informational("rogue_thieves-cant")),
        grant("weapon-mastery", weaponMasteryFeature("rogue_weapon-mastery"))
      ],
      choices: [
        choice({ kind: "expertise", id: "expertise", count: 2 }, "rogue_expertise"),
        choice({ kind: "weapon-mastery", id: "weapon-mastery" }, "rogue_weapon-mastery")
      ]
    },
    { level: 2, grants: [grant("cunning-action", cunningAction)] },
    {
      level: 3,
      grants: [grant("steady-aim", steadyAim)],
      choices: [choice({ kind: "subclass", id: "subclass" }, "rogue_rogue-subclass")]
    },
    {
      level: 5,
      grants: [
        grant("cunning-strike", cunningStrikes),
        grant("uncanny-dodge", runs("rogue_uncanny-dodge", {
          grantedActions: [{
            kind: "activate-feature", id: "uncanny-dodge", name: "Uncanny Dodge", actionType: "reaction", featureId: "",
            reaction: { trigger: { kind: "would-take-damage", attackOnly: true }, target: "self", priority: "worthwhile" },
            damageCut: { kind: "halve" }, automationSupport: "full"
          }]
        }))
      ]
    },
    { level: 6, grants: [], choices: [choice({ kind: "expertise", id: "expertise", count: 2 }, "rogue_expertise")] },
    {
      level: 7,
      grants: [
        grant("evasion", runs("rogue_evasion", { effects: [{ kind: "evasion" }] })),
        grant("reliable-talent", informational("rogue_reliable-talent"))
      ]
    },
    // Two Cunning Strike effects on one hit, paying both in Sneak Attack dice.
    { level: 11, grants: [grant("improved-cunning-strike", runs("rogue_improved-cunning-strike", { effects: [{ kind: "paired-on-hit-options", featureId: SNEAK_ATTACK_ID }] }))] },
    { level: 14, grants: [grant("devious-strikes", deviousStrikes)] },
    { level: 15, grants: [grant("slippery-mind", informational("rogue_slippery-mind"), { adjust: { saves: ["wis", "cha"] } })] },
    { level: 18, grants: [grant("elusive", runs("rogue_elusive", { effects: [{ kind: "no-advantage-against" }] }))] },
    {
      level: 20,
      grants: [grant("stroke-of-luck", runs("rogue_stroke-of-luck", {
        effects: [{ kind: "d20-change", rolls: ["attack", "save"], change: "twenty", resourceCost: { resourceId: "stroke-of-luck", amount: 1 } }]
      }), { pool: { id: "stroke-of-luck", size: 1 } })]
    }
  ],
  startingEquipment: [
    {
      id: "A",
      label: "Leather armor, two daggers, a shortsword and a shortbow (and arrows, thieves' tools, a pack and 8 GP)",
      items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:dagger", count: 2 }, { ref: "srd:weapon:shortsword" }, { ref: "srd:weapon:shortbow" }],
      gold: 8
    },
    { id: "B", label: "100 GP", items: [], gold: 100 }
  ],
  suggested: {
    abilities: ["dex", "con", "wis", "int", "cha", "str"],
    tactics: "skirmisher",
    background: "srd:background:criminal",
    skills: ["stealth", "perception", "acrobatics", "insight", "investigation", "deception"],
    expertise: ["stealth", "perception", "acrobatics", "insight"],
    epicBoon: "srd:feat:boon-of-the-night-spirit",
    masteries: ["shortsword", "shortbow", "dagger", "rapier", "scimitar"],
    equipment: "A"
  },
  description: "A dexterous expert in stealth and subterfuge."
};

export const THIEF: SubclassDefinition = {
  id: "srd:subclass:thief",
  name: "Thief",
  source: srd52Source("srd-2024_thief"),
  edition: "2024",
  classId: "srd:class:rogue",
  levels: [
    {
      level: 3,
      grants: [
        grant("fast-hands", informational("rogue_thief_fast-hands")),
        grant("second-story-work", informational("rogue_thief_second-story-work"), { adjust: { movementEqualToSpeed: ["climb"] } })
      ]
    },
    { level: 9, grants: [grant("supreme-sneak", reference("rogue_thief_supreme-sneak"))] },
    { level: 13, grants: [grant("use-magic-device", informational("rogue_thief_use-magic-device"))] },
    { level: 17, grants: [grant("thiefs-reflexes", reference("rogue_thief_thiefs-reflexes"))] }
  ]
};
