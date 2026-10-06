import type { ActionDefinition, DamageType, WeaponDefinition } from "@/engine";
import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, fromLevels, grant, informational, reference, runs, weaponMasteryFeature } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("monk");

/** The Monk's Unarmed Strike: a weapon the builder owns, its die the Martial Arts column's. Its id is `monk-martial-arts`. */
const UNARMED: WeaponDefinition = {
  id: "unarmed-strike",
  name: "Unarmed Strike",
  baseWeapon: "unarmed-strike",
  category: "simple",
  attackType: "melee",
  // Dexterous Attacks: the better of Strength and Dexterity.
  ability: "finesse",
  range: 5,
  reach: 5,
  damage: [{ dice: "1d6", damageType: "bludgeoning" }],
  // Bonus Unarmed Strike, and an opportunity attack.
  usableAs: ["action", "bonus", "reaction"]
};
const UNARMED_BONUS = "monk-martial-arts:bonus";
const FOCUS_DC = { base: 8, ability: "wis" as const, proficiency: true };

/** Deflect Attacks (or Energy): a reaction to an attack's hit of these types, 1d10 + Dexterity + monk level (scaled) off it. */
const deflect = (id: string, name: string, damageTypes: DamageType[]): ActionDefinition => ({
  kind: "activate-feature", id, name, actionType: "reaction", featureId: "",
  reaction: { trigger: { kind: "would-take-damage", attackOnly: true, damageTypes }, target: "self", priority: "worthwhile" },
  damageCut: { kind: "reduce", dice: "1d10", abilityModifier: "dex", bonus: 1 },
  automationSupport: "full"
});

const martialArts = runs("monk_martial-arts", {
  automationSupport: "full",
  notSimulated: "the Martial Arts die is the Unarmed Strike's; monk weapons keep their own die, and wearing armor or a shield isn't checked."
});

const monksFocus = runs("monk_monks-focus", {
  grantedActions: [
    {
      kind: "multiattack", id: "flurry-of-blows", name: "Flurry of Blows", actionType: "bonus",
      attacks: [{ actionId: UNARMED_BONUS, count: 2 }],
      resourceCost: { resourceId: "focus-points", amount: 1 }, automationSupport: "full"
    },
    { kind: "utility", id: "patient-defense", name: "Patient Defense: Disengage", actionType: "bonus", mode: "disengage", automationSupport: "full" },
    {
      kind: "utility", id: "patient-defense-dodge", name: "Patient Defense: Dodge", actionType: "bonus", mode: "dodge",
      resourceCost: { resourceId: "focus-points", amount: 1 }, automationSupport: "full"
    },
    { kind: "utility", id: "step-of-the-wind", name: "Step of the Wind: Dash", actionType: "bonus", mode: "dash", automationSupport: "full" }
  ],
  notSimulated: "spending a point gives the Dodge alone (not Disengage too) for Patient Defense; Step of the Wind's spent point isn't offered."
});

const attacks = (key: string, count: number) => runs(key, {
  grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attacks: [{ any: "weapon", count }], automationSupport: "full" }]
});

export const MONK: ClassDefinition = {
  id: "srd:class:monk",
  name: "Monk",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["dex", "wis"],
  saves: ["str", "dex"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial-light"],
  armorTraining: [],
  subclassLevel: 3,
  subclassLabel: "Monk Subclass",
  featLevels: [4, 8, 12, 16],
  table: [
    ...srdColumns("monk"),
    { id: "flurry-strikes", label: "Flurry of Blows strikes", values: fromLevels([[2, 2], [10, 3]]) },
    {
      id: "unarmed-damage", label: "Unarmed Strike damage",
      values: Array.from({ length: 20 }, (_, index) => (index + 1 >= 6 ? "force" : "bludgeoning"))
    }
  ],
  levels: [
    {
      level: 1,
      grants: [
        grant("martial-arts", martialArts, {
          weapon: UNARMED,
          scale: [
            { path: "weapon.damage.0.dice", value: "{col:martial-arts}" },
            // Empowered Strikes (6th level): force damage.
            { path: "weapon.damage.0.damageType", value: "{col:unarmed-damage}" }
          ]
        }),
        grant("unarmored-defense", runs("monk_unarmored-defense", { effects: [{ kind: "unarmored-ac", base: 10, abilities: ["dex", "wis"], noShield: true }] }))
      ]
    },
    {
      level: 2,
      grants: [
        grant("monks-focus", monksFocus, {
          scale: [{ path: "grantedActions.0.attacks.0.count", value: "{col:flurry-strikes}" }],
          pool: { id: "focus-points", size: "{col:focus-points}" }
        }),
        grant("unarmored-movement", informational("monk_unarmored-movement"), { adjust: { speed: "{col:unarmored-movement}" } }),
        grant("uncanny-metabolism", informational("monk_uncanny-metabolism"))
      ]
    },
    {
      level: 3,
      grants: [grant("deflect-attacks", runs("monk_deflect-attacks", {
        grantedActions: [deflect("deflect-attacks", "Deflect Attacks", ["bludgeoning", "piercing", "slashing"])],
        notSimulated: "spending a Focus Point to redirect the attack when the damage drops to 0."
      }), { scale: [{ path: "grantedActions.0.damageCut.bonus", value: "{level}" }] })],
      choices: [choice({ kind: "subclass", id: "subclass" }, "monk_monk-subclass")]
    },
    { level: 4, grants: [grant("slow-fall", informational("monk_slow-fall"))] },
    {
      level: 5,
      grants: [
        grant("extra-attack", attacks("monk_extra-attack", 2)),
        grant("stunning-strike", runs("monk_stunning-strike", {
          notSimulated: "a successful save's halved speed and advantage against the target; it works with the Unarmed Strike, not monk weapons."
        }), {
          onHitOf: {
            grant: "martial-arts",
            riders: [{
              kind: "condition", when: "on-hit", condition: "stunned", oncePerTurn: true,
              duration: { kind: "until-source-turn", timing: "start" },
              save: {
                ability: "con", dcFormula: FOCUS_DC, onSuccess: "negates",
                // On a success: speed halved, and the monk's next attack against it with advantage, until its next turn.
                instead: {
                  condition: { custom: "Staggered" }, conditionKey: "Stunning Strike", duration: { kind: "until-source-turn", timing: "start" },
                  modifiers: { movementMultiplier: 2 }, nextAttack: { role: "against", mode: "advantage" }
                }
              },
              resourceCost: { resourceId: "focus-points", amount: 1 }, activation: "optional"
            }]
          }
        })
      ]
    },
    { level: 6, grants: [grant("empowered-strikes", runs("monk_empowered-strikes"))] },
    { level: 7, grants: [grant("evasion", runs("monk_evasion", { effects: [{ kind: "evasion" }] }))] },
    { level: 9, grants: [grant("acrobatic-movement", informational("monk_acrobatic-movement"))] },
    {
      level: 10,
      grants: [
        grant("heightened-focus", runs("monk_heightened-focus", { notSimulated: "Patient Defense's temporary hit points and Step of the Wind carrying an ally." })),
        grant("self-restoration", reference("monk_self-restoration"))
      ]
    },
    {
      level: 13,
      // Deflect Attacks against any other damage: a reaction of its own for the other types, so each hit offers one.
      grants: [grant("deflect-energy", runs("monk_deflect-energy", {
        grantedActions: [deflect("deflect-energy", "Deflect Energy", ["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "psychic", "radiant", "thunder"])]
      }), { scale: [{ path: "grantedActions.0.damageCut.bonus", value: "{level}" }] })]
    },
    {
      level: 14,
      grants: [grant("disciplined-survivor", runs("monk_disciplined-survivor", {
        effects: [{ kind: "d20-change", rolls: ["save"], change: "reroll", resourceCost: { resourceId: "focus-points", amount: 1 } }]
      }), { adjust: { saves: "all" } })]
    },
    { level: 15, grants: [grant("perfect-focus", informational("monk_perfect-focus"))] },
    {
      level: 18,
      grants: [grant("superior-defense", runs("monk_superior-defense", {
        grantedActions: [{
          kind: "activate-feature", id: "superior-defense", name: "Superior Defense", actionType: "free", featureId: "",
          resourceCost: { resourceId: "focus-points", amount: 3 },
          condition: {
            id: "superior-defense-active", name: "custom", durationRounds: 10,
            effects: (["acid", "bludgeoning", "cold", "fire", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"] as const)
              .map((damageType) => ({ kind: "damage-adjustment" as const, adjustment: { type: "resistance" as const, damageType } }))
          },
          automationSupport: "full"
        }]
      }))]
    },
    { level: 20, grants: [grant("body-and-mind", informational("monk_body-and-mind"), { adjust: { abilities: { dex: 4, wis: 4 }, abilityMax: 25 } })] }
  ],
  startingEquipment: [
    { id: "A", label: "A spear and five daggers (and tools or an instrument, a pack and 11 GP)", items: [{ ref: "srd:weapon:spear" }, { ref: "srd:weapon:dagger", count: 5 }], gold: 11 },
    { id: "B", label: "50 GP", items: [], gold: 50 }
  ],
  suggested: {
    abilities: ["dex", "wis", "con", "str", "int", "cha"],
    tactics: "skirmisher",
    background: "srd:background:criminal",
    skills: ["acrobatics", "insight", "stealth", "athletics"],
    epicBoon: "srd:feat:boon-of-irresistible-offense",
    equipment: "A"
  },
  description: "A martial artist of supernatural focus."
};

export const OPEN_HAND: SubclassDefinition = {
  id: "srd:subclass:warrior-of-the-open-hand",
  name: "Warrior of the Open Hand",
  source: srd52Source("srd-2024_warrior-of-the-open-hand"),
  edition: "2024",
  classId: "srd:class:monk",
  levels: [
    {
      level: 3,
      grants: [grant("open-hand-technique", runs("monk_warrior-of-the-open-hand_open-hand-technique", {
        effects: [{
          kind: "apply-condition-on-hit", actionIds: [UNARMED_BONUS], condition: "always",
          appliedCondition: { name: "prone" },
          save: { ability: "dex", dcFormula: FOCUS_DC }
        }],
        notSimulated: "every Flurry hit tries Topple (a Dexterity save or prone); Push and Addle aren't offered, and the bonus action's single Unarmed Strike gets it too."
      }))]
    },
    {
      level: 6,
      grants: [grant("wholeness-of-body", runs("monk_warrior-of-the-open-hand_wholeness-of-body", {
        grantedActions: [{
          kind: "healing", id: "wholeness-of-body", name: "Wholeness of Body", actionType: "bonus", range: 0,
          healing: [{ dice: "1d8", abilityModifier: "wis" }], targeting: { target: "self" },
          resourceCost: { resourceId: "wholeness-of-body", amount: 1 }, automationSupport: "full"
        }]
      }), {
        scale: [{ path: "grantedActions.0.healing.0.dice", value: "{col:martial-arts}" }],
        pool: { id: "wholeness-of-body", size: "{mod:wis|min:1}" }
      })]
    },
    { level: 11, grants: [grant("fleet-step", reference("monk_warrior-of-the-open-hand_fleet-step"))] },
    { level: 17, grants: [grant("quivering-palm", reference("monk_warrior-of-the-open-hand_quivering-palm"))] }
  ]
};
