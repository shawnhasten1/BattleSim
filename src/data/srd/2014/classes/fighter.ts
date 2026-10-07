import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { srd51Source } from "../../source";
import { choice, fromLevels, grant, runs } from "../authoring";
import { srd14Class } from "../reference";

/**
 * The 2014 Fighter and its Champion (SRD 5.1). Where a feature works as its 2024 namesake does it runs the same way (Action
 * Surge, Improved Critical); where the 2014 rules differ it's written for them: Second Wind is once a rest, Indomitable
 * only rerolls, Extra Attack is one feature growing at 11th and 20th, and Survivor has no death-save part.
 */
const ref = srd14Class("fighter");

/** Improved and Superior Critical: a weapon attack is a critical hit from `minimum` up. */
const critical = (key: string, minimum: number, name?: string) =>
  runs(key, { ...(name ? { name } : {}), effects: [{ kind: "critical-range", condition: "always", minimum, attackTypes: ["melee", "ranged"] }] });

/** Extra Attack and its later forms: the Attack action as a multiattack of any weapons. */
function attacks(count: number, name?: string) {
  return runs("fighter_extra-attack", {
    ...(name ? { name } : {}),
    grantedActions: [{
      kind: "multiattack", id: "attack", name: "Attack", actionType: "action", attackAction: true,
      attacks: [{ any: "weapon", count }], automationSupport: "full"
    }]
  });
}

export const FIGHTER_2014: ClassDefinition = {
  id: "srd:class:fighter-2014",
  name: "Fighter",
  source: srd51Source(ref.key),
  edition: "2014",
  hitDie: 10,
  // Multiclassing: Strength 13 or Dexterity 13.
  primaryAbilities: ["str", "dex"],
  primaryAbilityAny: true,
  saves: ref.saves!,
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "heavy", "shield"],
  subclassLevel: 3,
  subclassLabel: "Martial Archetype",
  featLevels: [4, 6, 8, 12, 14, 16, 19],
  table: [
    { id: "action-surge", label: "Action Surge", values: fromLevels([[2, 1], [17, 2]]) },
    { id: "indomitable", label: "Indomitable", values: fromLevels([[9, 1], [13, 2], [17, 3]]) }
  ],
  levels: [
    {
      level: 1,
      grants: [
        grant("second-wind", runs("fighter_second-wind", {
          grantedActions: [{
            kind: "healing", id: "second-wind", name: "Second Wind", actionType: "bonus", range: 0,
            healing: [{ dice: "1d10+1" }], targeting: { target: "self" },
            resourceCost: { resourceId: "second-wind", amount: 1 }, automationSupport: "full"
          }]
        }), { scale: [{ path: "grantedActions.0.healing.0.dice", value: "1d10+{level}" }], pool: { id: "second-wind", size: 1 } })
      ],
      choices: [choice({ kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Fighting Style" }, "fighter_fighting-style")]
    },
    {
      level: 2,
      grants: [grant("action-surge", runs("fighter_action-surge", {
        effects: [{ kind: "extra-action", slot: "action" }],
        grantedActions: [{
          kind: "activate-feature", id: "action-surge", name: "Action Surge", actionType: "free", featureId: "",
          resourceCost: { resourceId: "action-surge", amount: 1 }, automationSupport: "full"
        }]
      }), { pool: { id: "action-surge", size: "{col:action-surge}" } })]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "fighter_martial-archetype")] },
    { level: 5, grants: [grant("extra-attack", attacks(2))] },
    {
      level: 9,
      grants: [grant("indomitable", runs("fighter_indomitable", {
        effects: [{ kind: "d20-change", rolls: ["save"], change: "reroll", resourceCost: { resourceId: "indomitable", amount: 1 } }]
      }), { pool: { id: "indomitable", size: "{col:indomitable}" } })]
    },
    { level: 11, grants: [grant("extra-attack-3", attacks(3, "Extra Attack (three attacks)"), { replaces: "extra-attack" })] },
    { level: 20, grants: [grant("extra-attack-4", attacks(4, "Extra Attack (four attacks)"), { replaces: "extra-attack-3" })] }
  ],
  equipmentLines: [
    {
      id: "armor",
      options: [
        { id: "a", label: "(a) Chain mail", items: [{ ref: "srd:item:chain-mail" }] },
        { id: "b", label: "(b) Leather armor, a longbow and 20 arrows", items: [{ ref: "srd:item:leather-armor" }, { ref: "srd:weapon:longbow" }] }
      ]
    },
    {
      id: "weapons",
      options: [
        { id: "a", label: "(a) A martial weapon and a shield", items: [{ ref: "srd:item:shield" }], anyWeapon: { category: "martial", count: 1 } },
        { id: "b", label: "(b) Two martial weapons", items: [], anyWeapon: { category: "martial", count: 2 } }
      ]
    },
    {
      id: "ranged",
      options: [
        { id: "a", label: "(a) A light crossbow and 20 bolts", items: [{ ref: "srd:weapon:light-crossbow" }] },
        { id: "b", label: "(b) Two handaxes", items: [{ ref: "srd:weapon:handaxe", count: 2 }] }
      ]
    }
  ],
  suggested: {
    abilities: ["str", "con", "dex", "wis", "cha", "int"],
    tactics: "brute",
    background: "srd:background:acolyte-2014",
    skills: ["athletics", "perception", "intimidation", "survival"],
    fightingStyle: "srd:feat:defense-2014",
    equipmentLines: { armor: "a", weapons: "a", ranged: "a" },
    equipmentWeapons: { weapons: ["srd:weapon:longsword"] }
  },
  description: "A master of martial combat, skilled with a variety of weapons and armor."
};

export const CHAMPION_2014: SubclassDefinition = {
  id: "srd:subclass:champion-2014",
  name: "Champion",
  source: srd51Source("srd_champion"),
  edition: "2014",
  classId: "srd:class:fighter-2014",
  levels: [
    { level: 3, grants: [grant("improved-critical", critical("champion_improved-critical", 19))] },
    {
      level: 7,
      // Half its proficiency bonus (rounded up) on Strength, Dexterity and Constitution checks it isn't proficient in:
      // initiative is a Dexterity check, so it's on the roll; the other checks are outside a fight.
      grants: [grant("remarkable-athlete", runs("champion_remarkable-athlete", { effects: [{ kind: "initiative", bonus: { base: 1 } }] }), {
        scale: [{ path: "effects.0.bonus.base", value: "{pb+1/2}" }]
      })]
    },
    {
      level: 10,
      grants: [],
      choices: [choice({ kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Additional Fighting Style" }, "champion_additional-fighting-style")]
    },
    { level: 15, grants: [grant("superior-critical", critical("champion_superior-critical", 18), { replaces: "improved-critical" })] },
    {
      level: 18,
      grants: [grant("survivor", runs("champion_survivor", { effects: [{ kind: "hp-regen", amount: 5, whileBloodied: true }] }), {
        scale: [{ path: "effects.0.amount", value: "{mod:con+5}" }]
      })]
    }
  ]
};
