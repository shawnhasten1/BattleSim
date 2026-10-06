import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, spell, srdSpellcasting, weaponMasteryFeature } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("ranger");
const HUNTERS_MARK = spell("hunters-mark");

const attacks = (key: string, count: number) => runs(key, {
  grantedActions: [{ kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attackAction: true, attacks: [{ any: "weapon", count }], automationSupport: "full" }]
});

export const RANGER: ClassDefinition = {
  id: "srd:class:ranger",
  name: "Ranger",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 10,
  primaryAbilities: ["dex", "wis"],
  // As a multiclass character: one skill from the class's list.
  multiclass: { skills: 1 },
  saves: ["str", "dex"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "shield"],
  weaponMastery: Array.from({ length: 20 }, () => 2),
  spellcasting: srdSpellcasting("ranger", "wis", "half"),
  subclassLevel: 3,
  subclassLabel: "Ranger Subclass",
  featLevels: [4, 8, 12, 16],
  table: srdColumns("ranger"),
  levels: [
    {
      level: 1,
      grants: [
        grant("favored-enemy", runs("ranger_favored-enemy"), {
          spells: [HUNTERS_MARK], freeCasts: [{ spell: HUNTERS_MARK, uses: "{col:favored-enemy}" }]
        }),
        grant("spellcasting", runs("ranger_spellcasting")),
        grant("weapon-mastery", weaponMasteryFeature("ranger_weapon-mastery"))
      ],
      choices: [choice({ kind: "weapon-mastery", id: "weapon-mastery" }, "ranger_weapon-mastery")]
    },
    {
      level: 2,
      grants: [],
      choices: [
        choice({ kind: "expertise", id: "deft-explorer", count: 1 }, "ranger_deft-explorer"),
        choice({
          kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Fighting Style",
          extraOptions: [{
            id: "druidic-warrior", name: "Druidic Warrior", description: "Two Druid cantrips",
            grants: [{ key: "druidic-warrior", feature: runs("ranger_fighting-style", { name: "Fighting Style: Druidic Warrior" }) }],
            choices: [{ kind: "spells", id: "cantrips", what: "cantrips", count: 2, lists: ["druid"], label: "Druidic Warrior: two Druid cantrips" }]
          }]
        }, "ranger_fighting-style")
      ]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "ranger_ranger-subclass")] },
    { level: 5, grants: [grant("extra-attack", attacks("ranger_extra-attack", 2))] },
    { level: 6, grants: [grant("roving", informational("ranger_roving"), { adjust: { speed: 10, movementEqualToSpeed: ["climb", "swim"] } })] },
    { level: 9, grants: [], choices: [choice({ kind: "expertise", id: "expertise", count: 2 }, "ranger_expertise")] },
    {
      level: 10,
      grants: [grant("tireless", runs("ranger_tireless", {
        grantedActions: [{
          kind: "buff", id: "tireless", name: "Tireless", actionType: "action", range: 0, targeting: { target: "self" },
          appliedCondition: { id: "tireless", name: "custom", durationRounds: 1 },
          tempHp: [{ dice: "1d8", abilityModifier: "wis" }],
          resourceCost: { resourceId: "tireless", amount: 1 }, automationSupport: "full"
        }]
      }), { pool: { id: "tireless", size: "{mod:wis|min:1}" } })]
    },
    {
      level: 13,
      grants: [grant("relentless-hunter", runs("ranger_relentless-hunter"), { spellChanges: [{ spell: HUNTERS_MARK, mark: { keepsConcentrationOnDamage: true } }] })]
    },
    { level: 14, grants: [grant("natures-veil", reference("ranger_natures-veil"), { pool: { id: "natures-veil", size: "{mod:wis|min:1}" } })] },
    {
      level: 17,
      grants: [grant("precise-hunter", runs("ranger_precise-hunter", {
        effects: [{ kind: "attack-advantage", condition: "always", targetMarked: "hunters-mark" }]
      }))]
    },
    { level: 18, grants: [grant("feral-senses", informational("ranger_feral-senses"), { adjust: { senses: { blindsight: 30 } } })] },
    { level: 20, grants: [grant("foe-slayer", runs("ranger_foe-slayer"), { spellChanges: [{ spell: HUNTERS_MARK, mark: { dice: "1d10" } }] })] }
  ],
  startingEquipment: [
    {
      id: "A", label: "Studded leather armor, a scimitar, a shortsword, a longbow, 20 arrows, a quiver, a druidic focus, an explorer's pack and 7 GP",
      items: [{ ref: "srd:item:studded-leather-armor" }, { ref: "srd:weapon:scimitar" }, { ref: "srd:weapon:shortsword" }, { ref: "srd:weapon:longbow" }], gold: 7
    },
    { id: "B", label: "150 GP", items: [], gold: 150 }
  ],
  suggested: {
    abilities: ["dex", "wis", "con", "str", "int", "cha"],
    tactics: "basic-ranged",
    background: "srd:background:soldier",
    skills: ["perception", "stealth", "survival", "nature"],
    expertise: ["perception", "stealth", "survival"],
    fightingStyle: "srd:feat:archery",
    masteries: ["longbow", "shortsword"],
    epicBoon: "srd:feat:boon-of-dimensional-travel",
    equipment: "A",
    cantrips: ["starry-wisp", "guidance"].map(spell),
    spells: ["ensnaring-strike", "cure-wounds", "entangle", "spike-growth", "gust-of-wind", "aid", "stoneskin", "dominate-beast"].map(spell)
  },
  description: "A wandering warrior who hunts with weapon and spell."
};

export const HUNTER: SubclassDefinition = {
  id: "srd:subclass:hunter",
  name: "Hunter",
  source: srd52Source("srd-2024_hunter"),
  edition: "2024",
  classId: "srd:class:ranger",
  levels: [
    {
      level: 3,
      grants: [grant("hunters-lore", informational("ranger_hunter_hunters-lore"))],
      choices: [choice({
        kind: "pick", id: "hunters-prey", label: "Hunter's Prey", count: 1,
        options: [
          {
            id: "colossus-slayer", name: "Colossus Slayer", description: "1d8 more, once a turn, on a creature missing hit points",
            grants: [{
              key: "hunters-prey",
              feature: runs("ranger_hunter_hunters-prey", {
                name: "Hunter's Prey: Colossus Slayer",
                effects: [{ kind: "damage-bonus", oncePerTurn: true, condition: "target-injured", attackTypes: ["melee", "ranged"], damage: [{ dice: "1d8", damageType: "same-as-attack" }] }]
              })
            }]
          },
          {
            id: "horde-breaker", name: "Horde Breaker", description: "Another attack on a creature next to the first",
            grants: [{
              key: "hunters-prey",
              feature: runs("ranger_hunter_hunters-prey", { name: "Hunter's Prey: Horde Breaker", effects: [{ kind: "follow-up-attack", withinFt: 5 }] })
            }]
          }
        ]
      }, "ranger_hunter_hunters-prey")]
    },
    {
      level: 7,
      grants: [],
      choices: [choice({
        kind: "pick", id: "defensive-tactics", label: "Defensive Tactics", count: 1,
        options: [
          {
            id: "escape-the-horde", name: "Escape the Horde", description: "Opportunity attacks against it have disadvantage",
            grants: [{
              key: "defensive-tactics",
              feature: runs("ranger_hunter_defensive-tactics", { name: "Defensive Tactics: Escape the Horde", effects: [{ kind: "attack-defense", against: "opportunity" }] })
            }]
          },
          {
            id: "multiattack-defense", name: "Multiattack Defense", description: "One that hits it has disadvantage on its other attacks against it this turn",
            grants: [{
              key: "defensive-tactics",
              feature: runs("ranger_hunter_defensive-tactics", { name: "Defensive Tactics: Multiattack Defense", effects: [{ kind: "attack-defense", against: "after-hit" }] })
            }]
          }
        ]
      }, "ranger_hunter_defensive-tactics")]
    },
    {
      level: 11,
      grants: [grant("superior-hunters-prey", runs("ranger_hunter_superior-hunters-prey"), {
        spellChanges: [{ spell: HUNTERS_MARK, mark: { spillWithinFt: 30 } }]
      })]
    },
    {
      level: 15,
      grants: [grant("superior-hunters-defense", runs("ranger_hunter_superior-hunters-defense", {
        grantedActions: [{
          kind: "activate-feature", id: "superior-hunters-defense", name: "Superior Hunter's Defense", actionType: "reaction", featureId: "",
          reaction: { trigger: { kind: "would-take-damage" }, target: "self", priority: "worthwhile" },
          damageCut: { kind: "resist" }, automationSupport: "full"
        }]
      }))]
    }
  ]
};
