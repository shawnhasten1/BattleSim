import type { ClassDefinition, SubclassDefinition } from "@/lib/character-builder/catalog";
import { choice, grant, informational, reference, runs, weaponMasteryFeature } from "../authoring";
import { srd52Source, srdClass, srdColumns } from "../reference";

const ref = srdClass("rogue");

const sneakAttack = runs("rogue_sneak-attack", {
  effects: [{
    kind: "damage-bonus",
    oncePerTurn: true,
    condition: "always",
    anyConditions: ["attack-has-advantage", "ally-adjacent-to-target"],
    attackTypes: ["melee", "ranged"],
    damage: [{ dice: "1d6", damageType: "same-as-attack" }]
  }],
  notSimulated: "any weapon attack can deal it, not only a finesse or ranged one, and an ally's help still counts with disadvantage."
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
    condition: {
      id: "steady-aim-active", name: "custom", durationRounds: 1,
      modifiers: { movementMultiplier: 0 },
      effects: [{ kind: "attack-advantage", condition: "always" }]
    },
    // Not having moved first isn't checked, so the AI doesn't take it on its own: it would stop where it stands.
    automationSupport: "partial"
  }],
  notSimulated: "that it can't be used after moving this turn. The AI leaves it to you."
});

export const ROGUE: ClassDefinition = {
  id: "srd:class:rogue",
  name: "Rogue",
  source: srd52Source(ref.key),
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["dex"],
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
        grant("cunning-strike", reference("rogue_cunning-strike")),
        grant("uncanny-dodge", reference("rogue_uncanny-dodge"))
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
    { level: 11, grants: [grant("improved-cunning-strike", reference("rogue_improved-cunning-strike"))] },
    { level: 14, grants: [grant("devious-strikes", reference("rogue_devious-strikes"))] },
    { level: 15, grants: [grant("slippery-mind", informational("rogue_slippery-mind"), { adjust: { saves: ["wis", "cha"] } })] },
    { level: 18, grants: [grant("elusive", reference("rogue_elusive"))] },
    { level: 20, grants: [grant("stroke-of-luck", reference("rogue_stroke-of-luck"))] }
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
