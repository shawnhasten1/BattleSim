import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, fromLevels, grant, informational, reference, runs } from "../authoring";
import { srd52Source, srdClass, srdColumns, srdNumbers } from "../reference";

const ref = srdClass("fighter");

const secondWind = runs("fighter_second-wind", {
  grantedActions: [{
    kind: "healing", id: "second-wind", name: "Second Wind", actionType: "bonus", range: 0,
    healing: [{ dice: "1d10+1" }], targeting: { target: "self" },
    resourceCost: { resourceId: "second-wind", amount: 1 }, automationSupport: "full"
  }]
});

const actionSurge = runs("fighter_action-surge", {
  effects: [{ kind: "extra-action", slot: "action" }],
  grantedActions: [{
    kind: "activate-feature", id: "action-surge", name: "Action Surge", actionType: "free", featureId: "",
    resourceCost: { resourceId: "action-surge", amount: 1 }, automationSupport: "full"
  }]
});

/** Extra Attack and its later forms: the Attack action as a multiattack of any weapons. */
function attacks(key: string, count: number) {
  return runs(key, {
    grantedActions: [{
      kind: "multiattack", id: "attack", name: "Attack", actionType: "action",
      attacks: [{ any: "weapon", count }], automationSupport: "full"
    }]
  });
}

export const FIGHTER: ClassDefinition = {
  id: "srd:class:fighter",
  name: "Fighter",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 10,
  primaryAbilities: ["str", "dex"],
  saves: ["str", "con"],
  skills: ref.skills as ClassDefinition["skills"],
  weaponProficiency: ["simple", "martial"],
  armorTraining: ["light", "medium", "heavy", "shield"],
  weaponMastery: srdNumbers("fighter", "weapon-mastery"),
  subclassLevel: 3,
  subclassLabel: "Fighter Subclass",
  featLevels: [4, 6, 8, 12, 14, 16],
  table: [
    ...srdColumns("fighter"),
    { id: "action-surge", label: "Action Surge", values: fromLevels([[2, 1], [17, 2]]) },
    { id: "indomitable", label: "Indomitable", values: fromLevels([[9, 1], [13, 2], [17, 3]]) }
  ],
  levels: [
    {
      level: 1,
      grants: [
        grant("second-wind", secondWind, {
          scale: [{ path: "grantedActions.0.healing.0.dice", value: "1d10+{level}" }],
          pool: { id: "second-wind", size: "{col:second-wind}" }
        }),
        grant("weapon-mastery", reference("fighter_weapon-mastery"))
      ],
      choices: [
        choice({ kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Fighting Style" }, "fighter_fighting-style"),
        choice({ kind: "weapon-mastery", id: "weapon-mastery" }, "fighter_weapon-mastery")
      ]
    },
    {
      level: 2,
      grants: [
        grant("action-surge", actionSurge, { pool: { id: "action-surge", size: "{col:action-surge}" } }),
        grant("tactical-mind", informational("fighter_tactical-mind"))
      ]
    },
    { level: 3, grants: [], choices: [choice({ kind: "subclass", id: "subclass" }, "fighter_fighter-subclass")] },
    {
      level: 5,
      grants: [
        grant("extra-attack", attacks("fighter_extra-attack", 2)),
        grant("tactical-shift", reference("fighter_tactical-shift"))
      ]
    },
    {
      level: 9,
      grants: [
        grant("indomitable", reference("fighter_indomitable"), { pool: { id: "indomitable", size: "{col:indomitable}" } }),
        grant("tactical-master", reference("fighter_tactical-master"))
      ]
    },
    { level: 11, grants: [grant("two-extra-attacks", attacks("fighter_two-extra-attacks", 3), { replaces: "extra-attack" })] },
    { level: 13, grants: [grant("studied-attacks", reference("fighter_studied-attacks"))] },
    { level: 20, grants: [grant("three-extra-attacks", attacks("fighter_three-extra-attacks", 4), { replaces: "two-extra-attacks" })] }
  ],
  startingEquipment: [
    {
      id: "A",
      label: "Chain mail, a greatsword and a flail (and 8 javelins, a pack and 4 GP)",
      items: [{ ref: "srd:item:chain-mail" }, { ref: "srd:weapon:greatsword" }, { ref: "srd:weapon:flail" }],
      gold: 4
    },
    {
      id: "B",
      label: "Studded leather, a scimitar, a shortsword and a longbow (and arrows, a pack and 11 GP)",
      items: [{ ref: "srd:item:studded-leather-armor" }, { ref: "srd:weapon:scimitar" }, { ref: "srd:weapon:shortsword" }, { ref: "srd:weapon:longbow" }],
      gold: 11
    },
    { id: "C", label: "155 GP", items: [], gold: 155 }
  ],
  suggested: {
    abilities: ["str", "con", "dex", "wis", "cha", "int"],
    tactics: "brute",
    background: "srd:background:soldier",
    skills: ["athletics", "perception", "intimidation", "survival"],
    fightingStyle: "srd:feat:defense",
    epicBoon: "srd:feat:boon-of-combat-prowess",
    masteries: ["greatsword", "flail", "longbow", "longsword", "battleaxe", "javelin"],
    equipment: "A"
  },
  description: "A master of martial combat, skilled with a variety of weapons and armor."
};

export const CHAMPION: SubclassDefinition = {
  id: "srd:subclass:champion",
  name: "Champion",
  source: srd52Source("srd-2024_champion"),
  edition: "2024",
  classId: "srd:class:fighter",
  levels: [
    {
      level: 3,
      grants: [
        grant("improved-critical", reference("fighter_champion_improved-critical")),
        grant("remarkable-athlete", reference("fighter_champion_remarkable-athlete"))
      ]
    },
    {
      level: 7,
      grants: [],
      choices: [choice({ kind: "feat", id: "fighting-style", categories: ["fighting-style"], label: "Additional Fighting Style" }, "fighter_champion_additional-fighting-style")]
    },
    { level: 10, grants: [grant("heroic-warrior", reference("fighter_champion_heroic-warrior"))] },
    { level: 15, grants: [grant("superior-critical", reference("fighter_champion_superior-critical"), { replaces: "improved-critical" })] },
    { level: 18, grants: [grant("survivor", reference("fighter_champion_survivor"))] }
  ]
};
