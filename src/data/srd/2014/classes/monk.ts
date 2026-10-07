import type { ActionRider, DamageType, FeatureEffect, WeaponDefinition } from "@/engine";
import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { choice, grant, informational, reference, runs } from "../authoring";
import { srd14Class, srd14Columns } from "../reference";

/**
 * The 2014 Monk and its Way of the Open Hand (SRD 5.1). Ki is the 2024 Monk's Focus by another name: Flurry of Blows,
 * Patient Defense (a Dodge) and Step of the Wind (a Dash or a Disengage) each cost a point. Its Stunning Strike lasts to
 * the end of the monk's next turn, isn't once a turn, and a success does nothing; Deflect Missiles is ranged weapon
 * attacks only; Ki-Empowered Strikes make its unarmed strikes magical rather than force.
 */
const ref = srd14Class("monk");

/** The Monk's unarmed strike: a weapon the builder owns, its die the Martial Arts column's. Its id is `monk-martial-arts`. */
const UNARMED: WeaponDefinition = {
  id: "unarmed-strike",
  name: "Unarmed Strike",
  baseWeapon: "unarmed-strike",
  category: "simple",
  attackType: "melee",
  // Dexterity in place of Strength: the better of the two.
  ability: "finesse",
  range: 5,
  reach: 5,
  damage: [{ dice: "1d4", damageType: "bludgeoning" }],
  // The bonus unarmed strike after the Attack action, and an opportunity attack.
  usableAs: ["action", "bonus", "reaction"]
};
const UNARMED_BONUS = "monk-martial-arts:bonus";
const KI = { resourceId: "ki", amount: 1 };
const KI_DC = { base: 8, ability: "wis" as const, proficiency: true };

/** An Open Hand Technique effect: an option on Flurry of Blows' strikes only. */
const openHand = (name: string, riders: ActionRider[]): FeatureEffect => ({
  kind: "on-hit-option", option: { name: `Open Hand: ${name}`, actionIds: [UNARMED_BONUS], routineOnly: true, riders }
});

const ki = runs("monk_ki", {
  grantedActions: [
    {
      kind: "multiattack", id: "flurry-of-blows", name: "Flurry of Blows", actionType: "bonus",
      attacks: [{ actionId: UNARMED_BONUS, count: 2 }], resourceCost: KI, automationSupport: "full"
    },
    { kind: "utility", id: "patient-defense", name: "Patient Defense", actionType: "bonus", mode: "dodge", resourceCost: KI, automationSupport: "full" },
    { kind: "utility", id: "step-of-the-wind-dash", name: "Step of the Wind: Dash", actionType: "bonus", mode: "dash", resourceCost: KI, automationSupport: "full" },
    { kind: "utility", id: "step-of-the-wind-disengage", name: "Step of the Wind: Disengage", actionType: "bonus", mode: "disengage", resourceCost: KI, automationSupport: "full" }
  ],
  notSimulated: "Flurry of Blows only after the Attack action; Step of the Wind's doubled jump."
});

const ALL_BUT_FORCE: DamageType[] = ["acid", "bludgeoning", "cold", "fire", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

export const MONK_2014: ClassDefinition = {
  id: "srd:class:monk-2014",
  name: "Monk",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 8,
  primaryAbilities: ["dex", "wis"],
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "shortsword"],
  armorTraining: [],
  subclassLevel: 3,
  subclassLabel: "Monastic Tradition",
  featLevels: [4, 8, 12, 16, 19],
  table: srd14Columns("monk"),
  levels: [
    {
      level: 1,
      grants: [
        grant("martial-arts", runs("monk_martial-arts", {
          effects: [{ kind: "martial-arts-weapons", weaponId: "monk-martial-arts", monkWeapons: "2014" }],
          notSimulated: "the bonus unarmed strike only after the Attack action."
        }), { weapon: UNARMED, scale: [{ path: "weapon.damage.0.dice", value: "{col:martial-arts}" }] }),
        grant("unarmored-defense", runs("monk_unarmored-defense", { effects: [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "wis"], noShield: true }] }))
      ]
    },
    {
      level: 2,
      grants: [
        grant("ki", ki, { pool: { id: "ki", size: "{col:ki-points}" } }),
        // Moving along walls and across liquids (9th level) is outside the grid.
        grant("unarmored-movement", runs("monk_unarmored-movement", { effects: [{ kind: "speed", bonusFt: 10, armor: "none", shield: false }] }), {
          scale: [{ path: "effects.0.bonusFt", value: "{col:unarmored-movement}" }]
        })
      ]
    },
    {
      level: 3,
      grants: [grant("deflect-missiles", runs("monk_deflect-missiles", {
        grantedActions: [{
          kind: "activate-feature", id: "deflect-missiles", name: "Deflect Missiles", actionType: "reaction", featureId: "",
          reaction: { trigger: { kind: "would-take-damage", rangedOnly: true }, target: "self", priority: "worthwhile" },
          damageCut: { kind: "reduce", dice: "1d10", abilityModifier: "dex", bonus: 1 },
          automationSupport: "full"
        }],
        notSimulated: "catching the missile and throwing it back for a ki point."
      }), { scale: [{ path: "grantedActions.0.damageCut.bonus", value: "{level}" }] })],
      choices: [choice({ kind: "subclass", id: "subclass" }, "monk_monastic-tradition")]
    },
    { level: 4, grants: [grant("slow-fall", informational("monk_slow-fall"))] },
    {
      level: 5,
      grants: [
        grant("extra-attack", runs("monk_extra-attack", {
          grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attackAction: true, attacks: [{ any: "weapon", count: 2 }], automationSupport: "full" }]
        })),
        // A ki point on a melee hit: a Constitution save or stunned until the end of the monk's next turn. Any hit.
        grant("stunning-strike", runs("monk_stunning-strike"), {
          onHitOf: {
            grant: "martial-arts",
            riders: [{
              kind: "condition", when: "on-hit", condition: "stunned",
              duration: { kind: "until-source-turn", timing: "end" },
              save: { ability: "con", dcFormula: KI_DC, onSuccess: "negates" },
              resourceCost: KI, activation: "optional"
            }]
          }
        })
      ]
    },
    // Its unarmed strikes count as magical against resistance and immunity.
    { level: 6, grants: [grant("ki-empowered-strikes", runs("monk_ki-empowered-strikes"), { weaponPatch: { grant: "martial-arts", patch: { magical: true } } })] },
    {
      level: 7,
      grants: [
        grant("evasion", runs("monk_evasion", { effects: [{ kind: "evasion" }] })),
        // An action to end a charm or fright on itself: nothing ends a condition on demand yet.
        grant("stillness-of-mind", reference("monk_stillness-of-mind"))
      ]
    },
    {
      level: 10,
      // Disease is outside a fight.
      grants: [grant("purity-of-body", runs("monk_purity-of-body", {
        effects: [{ kind: "damage-adjustment", adjustment: { type: "immunity", damageType: "poison" } }]
      }), { adjust: { conditionImmunities: ["poisoned"] } })]
    },
    { level: 13, grants: [grant("tongue-of-the-sun-and-moon", informational("monk_tongue-of-the-sun-and-moon"))] },
    {
      level: 14,
      grants: [grant("diamond-soul", runs("monk_diamond-soul", {
        effects: [{ kind: "d20-change", rolls: ["save"], change: "reroll", resourceCost: KI }]
      }), { adjust: { saves: "all" } })]
    },
    { level: 15, grants: [grant("timeless-body", informational("monk_timeless-body"))] },
    {
      level: 18,
      // 4 ki: invisible (attacks by it with advantage, against it with disadvantage) and resistant to all but force.
      grants: [grant("empty-body", runs("monk_empty-body", {
        grantedActions: [{
          kind: "activate-feature", id: "empty-body", name: "Empty Body", actionType: "action", featureId: "",
          resourceCost: { resourceId: "ki", amount: 4 },
          condition: {
            id: "empty-body-active", name: "custom", durationRounds: 10,
            modifiers: { attackRoll: 5, incomingAttackRoll: -5 },
            effects: ALL_BUT_FORCE.map((damageType) => ({ kind: "damage-adjustment" as const, adjustment: { type: "resistance" as const, damageType } }))
          },
          automationSupport: "full"
        }],
        notSimulated: "being unseen beyond the attack rolls, and Astral Projection for 8 ki."
      }))]
    },
    // Ki regained on rolling initiative with none left: a fight starts with a full pool.
    { level: 20, grants: [grant("perfect-self", informational("monk_perfect-self"))] }
  ],
  equipmentLines: [
    {
      id: "weapon",
      options: [
        { id: "a", label: "(a) A shortsword", items: [{ ref: "srd:weapon:shortsword" }] },
        { id: "b", label: "(b) Any simple weapon", items: [], anyWeapon: { category: "simple", count: 1 } }
      ]
    },
    { id: "kit", options: [{ id: "a", label: "A dungeoneer's or explorer's pack and 10 darts", items: [{ ref: "srd:weapon:dart", count: 10 }] }] }
  ],
  suggested: {
    abilities: ["dex", "wis", "con", "str", "int", "cha"],
    tactics: "skirmisher",
    background: "srd:background:acolyte-2014",
    skills: ["acrobatics", "insight", "stealth", "athletics"],
    equipmentLines: { weapon: "a", kit: "a" }
  },
  description: "A master of martial arts, harnessing the power of the body in pursuit of physical and spiritual perfection."
};

export const OPEN_HAND_2014: SubclassDefinition = {
  id: "srd:subclass:way-of-the-open-hand-2014",
  name: "Way of the Open Hand",
  source: srd51Source("srd_way-of-the-open-hand"),
  edition: "2014",
  classId: "srd:class:monk-2014",
  levels: [
    {
      level: 3,
      // One of three on each Flurry of Blows hit: a choice of strike in the routine.
      grants: [grant("open-hand-technique", runs("way-of-the-open-hand_open-hand-technique", {
        effects: [
          openHand("Prone", [{
            kind: "condition", when: "on-hit", condition: "prone", duration: { kind: "until-start-of-next-turn" },
            save: { ability: "dex", dcFormula: KI_DC, onSuccess: "negates" }
          }]),
          openHand("Push", [{ kind: "push", when: "on-hit", distance: 15, save: { ability: "str", dcFormula: KI_DC } }]),
          openHand("No reactions", [{
            kind: "condition", when: "on-hit", condition: { custom: "No reactions" }, conditionKey: "Open Hand: no reactions",
            modifiers: { deniesReactions: true }, duration: { kind: "until-source-turn", timing: "end" }
          }])
        ]
      }))]
    },
    {
      level: 6,
      grants: [grant("wholeness-of-body", runs("way-of-the-open-hand_wholeness-of-body", {
        grantedActions: [{
          kind: "healing", id: "wholeness-of-body", name: "Wholeness of Body", actionType: "action", range: 0,
          healing: [{ dice: "18" }], targeting: { target: "self" },
          resourceCost: { resourceId: "wholeness-of-body", amount: 1 }, automationSupport: "full"
        }]
      }), {
        // Three times the monk level, once a day.
        scale: [{ path: "grantedActions.0.healing.0.dice", value: "{level*3}" }],
        pool: { id: "wholeness-of-body", size: 1 }
      })]
    },
    // Sanctuary from each long rest: the simulator doesn't cast Sanctuary.
    { level: 11, grants: [grant("tranquility", reference("way-of-the-open-hand_tranquility"))] },
    { level: 17, grants: [grant("quivering-palm", reference("way-of-the-open-hand_quivering-palm"))] }
  ]
};
